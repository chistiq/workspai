import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../../contracts/index.js';
import type {
  GraphFileInventoryRequest,
  GraphFileInventoryResult,
  GraphFileSourcePort,
} from '../../ports/index.js';

function portableLocator(root: string, target: string): string | null {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..'))
    return null;
  return relative.split(path.sep).join('/');
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' || (!path.isAbsolute(relative) && !relative.split(path.sep).includes('..'))
  );
}

function mediaType(locator: string): string {
  const extension = path.posix.extname(locator).toLowerCase();
  return (
    (
      {
        '.c': 'text/x-c',
        '.cpp': 'text/x-c++',
        '.cs': 'text/x-csharp',
        '.css': 'text/css',
        '.go': 'text/x-go',
        '.html': 'text/html',
        '.java': 'text/x-java',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.jsx': 'text/jsx',
        '.md': 'text/markdown',
        '.php': 'text/x-php',
        '.py': 'text/x-python',
        '.rb': 'text/x-ruby',
        '.rs': 'text/x-rust',
        '.toml': 'application/toml',
        '.ts': 'text/typescript',
        '.tsx': 'text/tsx',
        '.xml': 'application/xml',
        '.yaml': 'application/yaml',
        '.yml': 'application/yaml',
      } as Readonly<Record<string, string>>
    )[extension] ?? 'application/octet-stream'
  );
}

function knownSensitiveFile(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === '.env' ||
    normalized.startsWith('.env.') ||
    ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials.json'].includes(normalized) ||
    ['.key', '.pem', '.p12', '.pfx'].some((extension) => normalized.endsWith(extension))
  );
}

async function readStableFile(
  file: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array; size: number }> {
  if (signal?.aborted) throw new Error('Repository read was cancelled.');
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      throw new Error('Repository input exceeds its admitted read budget.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      signal?.aborted ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    ) {
      throw new Error('Repository input changed while it was being read.');
    }
    return { bytes: new Uint8Array(bytes), size: before.size };
  } finally {
    await handle.close();
  }
}

export function createNodeGraphFileSource(): GraphFileSourcePort {
  return {
    async inventory(request: GraphFileInventoryRequest): Promise<GraphFileInventoryResult> {
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const unsupportedZones: GraphUnsupportedZone[] = [];
      const inputs: GraphProviderInput[] = [];
      let omittedFiles = 0;
      let omittedBytes = 0;
      let totalBytes = 0;
      try {
        const rootStat = await fs.lstat(request.root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
          throw new Error('Repository root must be a real directory, not a symbolic link.');
        }
        const root = await fs.realpath(request.root);
        const excluded = new Set(request.excludedDirectories);
        const pending = [{ directory: root, depth: 0 }];
        while (pending.length > 0) {
          if (request.signal?.aborted) {
            return {
              status: 'cancelled',
              inputs,
              diagnostics,
              omittedFiles,
              omittedBytes,
              unknownZones,
              unsupportedZones,
            };
          }
          const current = pending.pop();
          if (!current) continue;
          const entries = [];
          for await (const entry of await fs.opendir(current.directory)) {
            if (entries.length >= request.maxDirectoryEntries) {
              unknownZones.push({
                code: 'graph.repository-directory-truncated',
                scope: portableLocator(root, current.directory) ?? 'repository',
                reason: 'Directory traversal stopped at the admitted entry budget.',
              });
              break;
            }
            entries.push(entry);
          }
          entries.sort((left, right) => left.name.localeCompare(right.name));
          for (const entry of entries) {
            const target = path.join(current.directory, entry.name);
            const locator = portableLocator(root, target);
            if (!locator) {
              diagnostics.push({
                code: 'GRAPH_FILE_LOCATOR_REJECTED',
                severity: 'warning',
                path: '/inventory',
                message: 'A repository entry could not be represented as a portable locator.',
              });
              omittedFiles += 1;
              continue;
            }
            if (entry.isDirectory()) {
              if (!excluded.has(entry.name)) {
                if (current.depth >= request.maxDepth) {
                  unknownZones.push({
                    code: 'graph.repository-depth-truncated',
                    scope: locator,
                    reason: 'Repository traversal stopped at the admitted depth budget.',
                  });
                } else pending.push({ directory: target, depth: current.depth + 1 });
              }
              continue;
            }
            if (entry.isSymbolicLink() || !entry.isFile()) {
              omittedFiles += 1;
              diagnostics.push({
                code: 'GRAPH_FILE_SPECIAL_ENTRY_OMITTED',
                severity: 'info',
                path: locator,
                message: 'Symbolic links and special filesystem entries are not inventoried.',
              });
              continue;
            }
            const stat = await fs.stat(target);
            if (request.sensitiveFiles === 'omit-known' && knownSensitiveFile(entry.name)) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              unsupportedZones.push({
                code: 'graph.sensitive-input-omitted',
                scope: locator,
                reason: 'A known sensitive file was excluded by the default repository policy.',
              });
              continue;
            }
            if (stat.size > request.maxFileBytes) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              diagnostics.push({
                code: 'GRAPH_FILE_SIZE_LIMIT_OMITTED',
                severity: 'warning',
                path: locator,
                message: 'Repository input exceeds the per-file inventory budget.',
              });
              continue;
            }
            if (
              inputs.length >= request.maxFiles ||
              totalBytes + stat.size > request.maxTotalBytes
            ) {
              omittedFiles += 1;
              omittedBytes += stat.size;
              continue;
            }
            const stable = await readStableFile(target, request.maxFileBytes, request.signal);
            const value = createHash('sha256').update(stable.bytes).digest('hex');
            inputs.push({
              locator,
              mediaType: mediaType(locator),
              byteLength: stable.size,
              digest: { algorithm: 'sha256', value },
            });
            totalBytes += stable.size;
          }
        }
        inputs.sort((left, right) => left.locator.localeCompare(right.locator));
        return {
          status:
            omittedFiles > 0 || unknownZones.length > 0 || unsupportedZones.length > 0
              ? 'partial'
              : 'complete',
          inputs,
          diagnostics,
          omittedFiles,
          omittedBytes,
          unknownZones,
          unsupportedZones,
        };
      } catch {
        return {
          status: request.signal?.aborted ? 'cancelled' : 'failed',
          inputs: [],
          diagnostics: [
            {
              code: request.signal?.aborted
                ? 'GRAPH_FILE_INVENTORY_CANCELLED'
                : 'GRAPH_FILE_INVENTORY_FAILED',
              severity: request.signal?.aborted ? 'info' : 'error',
              path: '/inventory',
              message: request.signal?.aborted
                ? 'Repository inventory was cancelled.'
                : 'Repository inventory failed at the host filesystem boundary.',
            },
          ],
          omittedFiles,
          omittedBytes,
          unknownZones,
          unsupportedZones,
        };
      }
    },

    async read(rootInput, input, options) {
      try {
        if (
          !input.locator ||
          path.posix.isAbsolute(input.locator) ||
          input.locator.includes('\\') ||
          input.locator.split('/').includes('..')
        ) {
          throw new Error('Repository input locator is not portable.');
        }
        const root = await fs.realpath(rootInput);
        const target = path.resolve(root, ...input.locator.split('/'));
        const realTarget = await fs.realpath(target);
        if (!inside(root, realTarget)) throw new Error('Repository input escapes its root.');
        const stable = await readStableFile(realTarget, options.maxBytes, options.signal);
        const digest = createHash('sha256').update(stable.bytes).digest('hex');
        if (stable.size !== input.byteLength || digest !== input.digest.value) {
          throw new Error('Repository input no longer matches its admitted content digest.');
        }
        return stable.bytes;
      } catch {
        throw new Error('Repository input could not be read within the admitted boundary.');
      }
    },
  };
}
