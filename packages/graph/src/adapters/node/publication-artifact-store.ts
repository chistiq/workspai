import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  GraphProjectArtifact,
  GraphProjectArtifactName,
  GraphProjectArtifactStorePort,
  GraphProjectPublicationResult,
} from '../../ports/index.js';

export interface NodePublicationArtifactStoreConfig {
  readonly scopeLabel: string;
  readonly rootLabel: string;
  readonly artifactFiles: Readonly<Record<GraphProjectArtifactName, string>>;
  readonly lockFileName: string;
  readonly validateArtifacts: (
    generationKey: string,
    artifacts: readonly GraphProjectArtifact[]
  ) => void;
}

function portable(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join(path.posix.sep);
}

async function ensureSafeDirectory(root: string, target: string, rootLabel: string): Promise<void> {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Artifact directory must remain below the admitted ${rootLabel}.`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error('Artifact path contains a non-directory or symbolic link.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error('Artifact directory creation crossed an unsafe filesystem boundary.');
      }
    }
  }
  const resolved = await realpath(target);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact directory escaped the admitted ${rootLabel}.`);
  }
}

async function writeDurable(file: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function existingGenerationMatches(
  generationDirectory: string,
  artifacts: readonly GraphProjectArtifact[],
  artifactFiles: Readonly<Record<GraphProjectArtifactName, string>>
): Promise<boolean> {
  try {
    if (!(await stat(generationDirectory)).isDirectory()) return false;
    for (const artifact of artifacts) {
      const existing = await readFile(path.join(generationDirectory, artifactFiles[artifact.name]));
      if (!existing.equals(Buffer.from(artifact.bytes))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Creates a locked, immutable and pointer-last publication store for one scope. */
export function createNodePublicationArtifactStore(
  hostRoot: string,
  config: NodePublicationArtifactStoreConfig
): GraphProjectArtifactStorePort {
  return {
    async publish(request): Promise<GraphProjectPublicationResult> {
      if (!/^[a-f0-9]{64}$/u.test(request.generationKey)) {
        throw new Error('Generation key must be a lowercase SHA-256 digest.');
      }
      config.validateArtifacts(request.generationKey, request.artifacts);
      request.signal?.throwIfAborted();

      const rootEntry = await lstat(hostRoot);
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
        throw new Error(`${config.rootLabel} must be a real directory, not a symbolic link.`);
      }
      const root = await realpath(hostRoot);
      const reports = path.join(root, '.workspai', 'reports');
      const generations = path.join(reports, 'graph-generations');
      await ensureSafeDirectory(root, generations, config.rootLabel);

      const lockPath = path.join(reports, config.lockFileName);
      const lock = await open(lockPath, 'wx', 0o600);
      const token = randomUUID();
      const staging = path.join(generations, `.staging-${token}`);
      const pointerTemporary = path.join(reports, `.graph-generation-${token}.tmp`);
      const generationDirectory = path.join(generations, request.generationKey);
      const pointer = path.join(reports, 'graph-generation.json');
      try {
        await lock.writeFile(token);
        await lock.sync();
        request.signal?.throwIfAborted();

        const alreadyStored = await existingGenerationMatches(
          generationDirectory,
          request.artifacts,
          config.artifactFiles
        );
        if (!alreadyStored) {
          try {
            await stat(generationDirectory);
            throw new Error('Existing graph generation does not match its content identity.');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          await mkdir(staging, { mode: 0o700 });
          for (const artifact of request.artifacts) {
            request.signal?.throwIfAborted();
            await writeDurable(
              path.join(staging, config.artifactFiles[artifact.name]),
              artifact.bytes
            );
          }
          await rename(staging, generationDirectory);
        }

        const publication = request.artifacts.find((artifact) => artifact.name === 'publication');
        if (!publication) throw new Error('Publication pointer artifact is missing.');
        let alreadyCurrent = false;
        try {
          alreadyCurrent = (await readFile(pointer)).equals(Buffer.from(publication.bytes));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (!alreadyCurrent) {
          request.signal?.throwIfAborted();
          await writeDurable(pointerTemporary, publication.bytes);
          await rename(pointerTemporary, pointer);
        }

        const paths = Object.fromEntries(
          request.artifacts.map((artifact) => [
            artifact.name,
            artifact.name === 'publication'
              ? portable(root, pointer)
              : portable(root, path.join(generationDirectory, config.artifactFiles[artifact.name])),
          ])
        ) as Record<GraphProjectArtifactName, string>;
        return {
          status: alreadyStored && alreadyCurrent ? 'already-current' : 'committed',
          pointer: portable(root, pointer),
          artifacts: paths,
        };
      } finally {
        await lock.close();
        await unlink(lockPath).catch(() => undefined);
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        await unlink(pointerTemporary).catch(() => undefined);
      }
    },
  };
}

export function parsePublicationArtifact(artifact: GraphProjectArtifact): Record<string, unknown> {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Graph publication requires valid JSON object artifacts.');
  }
}

export function publicationProperty(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function validatePublicationArtifactIntegrity(
  artifacts: readonly GraphProjectArtifact[],
  requiredArtifacts: readonly GraphProjectArtifactName[],
  scopeLabel: string
): void {
  const names = artifacts.map((artifact) => artifact.name).sort();
  if (
    names.length !== requiredArtifacts.length ||
    names.some((name, index) => name !== requiredArtifacts[index])
  ) {
    throw new Error(
      `${scopeLabel} publication requires exactly one artifact of every required kind.`
    );
  }
  for (const artifact of artifacts) {
    const observed = createHash('sha256').update(artifact.bytes).digest('hex');
    if (
      artifact.mediaType !== 'application/json' ||
      artifact.digest.algorithm !== 'sha256' ||
      !/^[a-f0-9]{64}$/u.test(artifact.digest.value) ||
      observed !== artifact.digest.value
    ) {
      throw new Error(`${scopeLabel} publication artifact integrity validation failed.`);
    }
  }
}
