import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import * as readline from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

import fsExtra from 'fs-extra';
import * as yauzl from 'yauzl';
import * as yazl from 'yazl';

import {
  WORKSPACE_ARCHIVE_MANIFEST_CONTRACT_PATH,
  WORKSPACE_ARCHIVE_MANIFEST_SCHEMA_VERSION,
  WORKSPACE_ARCHIVE_OPERATION_RESULT_CONTRACT_PATH,
  WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
} from '../contracts/workspace-archive-contract.js';
import { assertJsonSchemaContract } from './json-schema-contract.js';
import {
  hasWorkspaceRootMarkers,
  toWorkspaiArtifactPath,
  workspaceMetadataCandidates,
  workspaceMetadataPath,
} from './workspace-paths.js';
import type { WorkspaceContract } from './workspace-contract.js';

export const WORKSPACE_ARCHIVE_MANIFEST_PATH = '.workspai/archive-manifest.json';
const LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH = '.rapidkit/archive-manifest.json';
export const WORKSPACE_ARCHIVE_KIND = 'workspai.workspace.archive';

export interface WorkspaceArchiveManifest {
  /** Added by current exporters; omitted by legacy v1 archives. */
  schemaVersion?: typeof WORKSPACE_ARCHIVE_MANIFEST_SCHEMA_VERSION;
  version: 1;
  kind: typeof WORKSPACE_ARCHIVE_KIND;
  workspaceName: string;
  exportedAt: string;
  exportedBy?: 'workspai' | 'workspai-vscode';
  archiveFormat?: 'zip-store' | 'zip-deflate';
  containerFormat?: 'zip' | 'zip64';
  compression?: 'store' | 'deflate';
  streaming?: boolean;
  security: {
    envFilesIncluded: boolean;
    excludedByDefault: string[];
  };
  externalProjects?: Array<{
    name: string;
    relationship: 'adopted' | 'linked' | 'imported' | 'managed' | 'restored';
    included: false;
    requiredAction: 'relink';
  }>;
  /**
   * A path-neutral snapshot of the canonical contract. It preserves manual
   * ports, APIs, ownership, events, and dependency declarations while
   * intentionally excluding projects whose identity depends on a source
   * machine's absolute path.
   */
  portableContract?: WorkspaceContract;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

export interface WorkspaceArchiveExportOptions {
  workspacePath: string;
  outputPath?: string;
  includeEnv?: boolean;
  now?: Date;
  compression?: 'store' | 'deflate';
}

export interface WorkspaceArchiveExportResult {
  schemaVersion: typeof WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION;
  operation: 'export';
  status: 'passed';
  archivePath: string;
  manifest: WorkspaceArchiveManifest;
  bytesWritten: number;
}

export type WorkspaceArchiveVerificationStatus = 'passed' | 'warning' | 'failed';

export interface WorkspaceArchiveVerificationResult {
  schemaVersion: typeof WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION;
  operation: 'verify';
  archivePath: string;
  manifest: WorkspaceArchiveManifest;
  status: WorkspaceArchiveVerificationStatus;
  fileCount: number;
  totalBytes: number;
  verifiedFiles: number;
  missingChecksumFiles: string[];
  missingArchiveEntries: string[];
  extraArchiveEntries: string[];
  mismatches: Array<{
    path: string;
    expected: { size?: number; sha256?: string };
    actual: { size: number; sha256: string };
  }>;
}

export interface WorkspaceArchiveInspectResult {
  schemaVersion: typeof WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION;
  operation: 'inspect';
  status: 'passed';
  archivePath: string;
  manifest: WorkspaceArchiveManifest;
  fileCount: number;
  totalBytes: number;
  entries: Array<{ path: string; size: number; hasChecksum: boolean }>;
}

export interface WorkspaceArchiveDoctorResult {
  schemaVersion: typeof WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION;
  operation: 'doctor';
  archivePath: string;
  status: WorkspaceArchiveVerificationStatus;
  workspaceName: string;
  fileCount: number;
  totalBytes: number;
  checks: Array<{ id: string; status: WorkspaceArchiveVerificationStatus; message: string }>;
  recommendedActions: string[];
}

export interface WorkspaceArchiveHydrateOptions {
  archivePathOrUrl: string;
  outputPath?: string;
  force?: boolean;
  dryRun?: boolean;
  strict?: boolean;
  safety?: WorkspaceArchiveSafetyOptions;
}

export interface WorkspaceArchiveSafetyOptions {
  /** Maximum downloaded bytes for URL inputs. Omit to use the secure default. */
  maxDownloadBytes?: number;
  /** Maximum total uncompressed payload bytes. Omit to use the secure default. */
  maxExpandedBytes?: number;
  /** Maximum time for a remote download. Set to 0 to disable the timeout. */
  downloadTimeoutMs?: number;
  /** Permit loopback/private/link-local archive URLs. Disabled by default. */
  allowPrivateNetwork?: boolean;
}

export interface WorkspaceArchiveHydrateResult {
  schemaVersion: typeof WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION;
  operation: 'hydrate';
  status: 'passed';
  archivePath: string;
  outputPath: string;
  dryRun: boolean;
  manifest: WorkspaceArchiveManifest | null;
  files: Array<{ path: string; size: number }>;
}

type ArchiveEntry = {
  name: string;
  size: number;
  compressedSize: number;
  crc32: number;
  entry: yauzl.Entry;
};

type LoadedWorkspaceArchive = {
  archivePath: string;
  entries: ArchiveEntry[];
  manifest: WorkspaceArchiveManifest;
  zipFile: yauzl.ZipFile;
  cleanup?: string;
};

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_ENTRIES = 200_000;
const DEFAULT_MAX_ENTRY_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 1_000;
const MAX_ARCHIVE_REDIRECTS = 5;
const MAX_MANIFEST_BYTES_IN_MEMORY = 64 * 1024 * 1024;

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    return (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      octets[0] >= 224
    );
  }
  if (net.isIPv6(normalized)) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

export async function assertSafeRemoteArchiveUrl(
  rawUrl: string,
  allowPrivateNetwork: boolean
): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Workspace archive URL protocol is not supported: ${url.protocol}`);
  }
  if (url.protocol !== 'https:' && !allowPrivateNetwork) {
    throw new Error(
      'Remote workspace archives require HTTPS unless private-network access is explicitly enabled.'
    );
  }
  if (url.username || url.password) {
    throw new Error('Workspace archive URL must not contain embedded credentials.');
  }
  if (allowPrivateNetwork) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Workspace archive URL resolves to a private or local network address.');
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Workspace archive URL resolves to a private or local network address.');
  }
  return url;
}

async function fetchRemoteArchive(
  input: string,
  signal: AbortSignal,
  allowPrivateNetwork: boolean
): Promise<Response> {
  let current = await assertSafeRemoteArchiveUrl(input, allowPrivateNetwork);
  for (let redirects = 0; redirects <= MAX_ARCHIVE_REDIRECTS; redirects += 1) {
    const response = await fetch(current, { signal, redirect: 'manual', credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Workspace archive redirect is missing a Location header.');
    if (redirects === MAX_ARCHIVE_REDIRECTS) {
      throw new Error(`Workspace archive download exceeded ${MAX_ARCHIVE_REDIRECTS} redirects.`);
    }
    current = await assertSafeRemoteArchiveUrl(
      new URL(location, current).href,
      allowPrivateNetwork
    );
  }
  throw new Error('Workspace archive redirect policy failed.');
}

const EXCLUDED_SEGMENTS = new Set([
  '__pycache__',
  '.venv',
  'venv',
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'htmlcov',
  '.next',
  '.turbo',
  '.cache',
]);

const EXCLUDED_BASENAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.coverage',
  'npm-debug.log',
  'yarn-error.log',
  'pnpm-debug.log',
  // Machine-local bindings and derived registries contain absolute paths and
  // must be rebuilt on the destination machine.
  'workspace-link.local.json',
  'imported-projects.json',
  'workspace-registry.v1.json',
]);

const SECRET_BASENAME_PATTERNS = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$).+/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
];

function toArchivePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

export function sanitizeWorkspaceArchiveName(rawName: string): string {
  const stripped = rawName
    .trim()
    .replace(/\.workspai-archive\.zip$/i, '')
    .replace(/\.rapidkit-archive\.zip$/i, '')
    .replace(/\.zip$/i, '')
    .trim();
  const normalized = stripped
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
  return normalized || 'imported-workspace';
}

export function isSafeArchiveEntryName(entryName: string): boolean {
  const normalized = toArchivePath(entryName).trim();
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('~')) {
    return false;
  }
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.includes('\0')) {
    return false;
  }
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 && !segments.some((segment) => segment === '..' || segment === '.');
}

function assertSafeEntryName(entryName: string): void {
  if (!isSafeArchiveEntryName(entryName)) {
    throw new Error(`Archive contains an unsafe path: ${entryName}`);
  }
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === '' ||
    (Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

export function shouldExcludeWorkspaceArchivePath(
  relativePath: string,
  options?: { includeEnv?: boolean }
): boolean {
  const normalized = toArchivePath(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  if (
    (segments[0] === '.workspai' || segments[0] === '.rapidkit') &&
    ['cache', 'reports'].includes(segments[1] || '')
  ) {
    return true;
  }
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return true;
  }

  const basename = segments[segments.length - 1] || '';
  if (
    normalized === '.workspai/workspace.contract.json' ||
    normalized === '.rapidkit/workspace.contract.json'
  ) {
    return true;
  }
  if (EXCLUDED_BASENAMES.has(basename)) {
    return true;
  }
  if (/\.(?:workspai|rapidkit)-archive\.zip$/i.test(basename)) {
    return true;
  }
  if (!options?.includeEnv && SECRET_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) {
    return true;
  }

  return basename.endsWith('.pyc') || basename.endsWith('.log');
}

async function readWorkspaceContractForArchive(
  workspacePath: string
): Promise<WorkspaceContract | null> {
  for (const contractPath of [
    path.join(workspacePath, '.workspai', 'workspace.contract.json'),
    path.join(workspacePath, '.rapidkit', 'workspace.contract.json'),
  ]) {
    if (!(await fsExtra.pathExists(contractPath))) continue;
    try {
      return (await fsExtra.readJson(contractPath)) as WorkspaceContract;
    } catch (error) {
      throw new Error(
        `Workspace contract could not be inspected safely for archive portability: ${contractPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return null;
}

function collectExternalWorkspaceProjects(
  contract: WorkspaceContract | null
): NonNullable<WorkspaceArchiveManifest['externalProjects']> {
  return (contract?.projects ?? [])
    .filter(
      (project) =>
        typeof project.externalPath === 'string' ||
        (typeof project.relativePath === 'string' && project.relativePath.startsWith('external/'))
    )
    .map((project) => ({
      name: project.slug || project.relativePath || 'external-project',
      relationship: ['adopted', 'linked', 'imported', 'managed', 'restored'].includes(
        String(project.relationship)
      )
        ? (project.relationship as 'adopted' | 'linked' | 'imported' | 'managed' | 'restored')
        : 'adopted',
      included: false as const,
      requiredAction: 'relink' as const,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildPortableWorkspaceContract(
  contract: WorkspaceContract | null
): WorkspaceContract | undefined {
  if (!contract) return undefined;
  return {
    ...contract,
    workspace: { ...contract.workspace },
    projects: contract.projects
      .filter(
        (project) =>
          typeof project.externalPath !== 'string' && !project.relativePath.startsWith('external/')
      )
      .map(({ externalPath: _externalPath, ...project }) => ({
        ...project,
        modules: [...project.modules],
        ports: project.ports.map((port) => ({ ...port })),
        contracts: {
          owns: [...project.contracts.owns],
          apis: project.contracts.apis.map((api) => ({ ...api })),
          publishes: [...project.contracts.publishes],
          consumes: [...project.contracts.consumes],
          dependsOn: [...project.contracts.dependsOn],
          env: [...project.contracts.env],
        },
      })),
  };
}

async function* walkWorkspaceFiles(
  workspacePath: string,
  currentPath: string,
  options?: { includeEnv?: boolean }
): AsyncGenerator<{ relativePath: string; fullPath: string }> {
  const entries = (await fsExtra.readdir(currentPath, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = toArchivePath(path.relative(workspacePath, fullPath));
    if (!relativePath || shouldExcludeWorkspaceArchivePath(relativePath, options)) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkWorkspaceFiles(workspacePath, fullPath, options);
      continue;
    }
    if (entry.isFile()) {
      yield { relativePath, fullPath };
    }
  }
}

async function readWorkspaceName(workspacePath: string): Promise<string> {
  for (const workspaceJsonPath of workspaceMetadataCandidates(workspacePath, 'workspace.json')) {
    try {
      const payload = (await fsExtra.readJson(workspaceJsonPath)) as Record<string, unknown>;
      if (typeof payload.workspace_name === 'string' && payload.workspace_name.trim()) {
        return payload.workspace_name.trim();
      }
      if (typeof payload.name === 'string' && payload.name.trim()) {
        return payload.name.trim();
      }
    } catch {
      // try the next metadata generation
    }
  }
  return path.basename(path.resolve(workspacePath));
}

type ExportCandidate = {
  relativePath: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
  sha256: string;
};

type ManifestFileEntry = WorkspaceArchiveManifest['files'][number];
type ManifestSpoolEntry = ManifestFileEntry & { mtimeMs: number };
type WorkspaceArchiveManifestBase = Omit<WorkspaceArchiveManifest, 'files'>;

async function hashWorkspaceFile(candidate: {
  relativePath: string;
  fullPath: string;
}): Promise<ExportCandidate> {
  const before = await fsExtra.stat(candidate.fullPath);
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(candidate.fullPath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  const after = await fsExtra.stat(candidate.fullPath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || size !== after.size) {
    throw new Error(`Workspace file changed while preparing archive: ${candidate.relativePath}`);
  }
  return {
    ...candidate,
    size,
    mtimeMs: after.mtimeMs,
    sha256: hash.digest('hex'),
  };
}

async function writeLine(
  stream: ReturnType<typeof createWriteStream>,
  line: string
): Promise<void> {
  if (!stream.write(line)) {
    await once(stream, 'drain');
  }
}

async function closeWriteStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

async function* readManifestSpool(spoolPath: string): AsyncGenerator<ManifestSpoolEntry> {
  const lines = readline.createInterface({
    input: createReadStream(spoolPath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed) as ManifestSpoolEntry;
  }
}

async function writeWorkspaceArchiveManifestFile(input: {
  manifestBase: WorkspaceArchiveManifestBase;
  spoolPath: string;
  manifestPath: string;
}): Promise<void> {
  const stream = createWriteStream(input.manifestPath, { flags: 'wx' });
  try {
    await writeLine(stream, '{\n');
    for (const [key, value] of Object.entries(input.manifestBase)) {
      await writeLine(stream, `  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2)},\n`);
    }
    await writeLine(stream, '  "files": [\n');
    let first = true;
    for await (const entry of readManifestSpool(input.spoolPath)) {
      const { mtimeMs: _mtimeMs, ...file } = entry;
      await writeLine(stream, `${first ? '' : ',\n'}    ${JSON.stringify(file)}`);
      first = false;
    }
    await writeLine(stream, '\n  ]\n}\n');
    await closeWriteStream(stream);
  } catch (error) {
    stream.destroy();
    await fsExtra.remove(input.manifestPath).catch(() => undefined);
    throw error;
  }
}

async function loadManifestFromSpool(
  manifestBase: WorkspaceArchiveManifestBase,
  spoolPath: string
): Promise<WorkspaceArchiveManifest> {
  const files: WorkspaceArchiveManifest['files'] = [];
  for await (const entry of readManifestSpool(spoolPath)) {
    const { mtimeMs: _mtimeMs, ...file } = entry;
    files.push(file);
  }
  return { ...manifestBase, files };
}

async function replaceFileAtomically(temporaryPath: string, targetPath: string): Promise<void> {
  try {
    await fsExtra.rename(temporaryPath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await fsExtra.move(temporaryPath, targetPath, { overwrite: true });
  }
}

export async function exportWorkspaceArchive(
  options: WorkspaceArchiveExportOptions
): Promise<WorkspaceArchiveExportResult> {
  const workspacePath = path.resolve(options.workspacePath);
  if (!hasWorkspaceRootMarkers(workspacePath)) {
    throw new Error(
      'Workspace export requires a Workspai workspace root with .workspai-workspace or a legacy .rapidkit-workspace marker.'
    );
  }

  const workspaceName = await readWorkspaceName(workspacePath);
  const workspaceContract = await readWorkspaceContractForArchive(workspacePath);
  const externalProjects = collectExternalWorkspaceProjects(workspaceContract);
  const portableContract = buildPortableWorkspaceContract(workspaceContract);
  const archivePath = path.resolve(
    options.outputPath || `${sanitizeWorkspaceArchiveName(workspaceName)}.workspai-archive.zip`
  );
  const manifestBase: WorkspaceArchiveManifestBase = {
    schemaVersion: WORKSPACE_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    version: 1,
    kind: WORKSPACE_ARCHIVE_KIND,
    workspaceName,
    exportedAt: (options.now ?? new Date()).toISOString(),
    exportedBy: 'workspai',
    archiveFormat: options.compression === 'deflate' ? 'zip-deflate' : 'zip-store',
    containerFormat: 'zip64',
    compression: options.compression === 'deflate' ? 'deflate' : 'store',
    streaming: true,
    security: {
      envFilesIncluded: options.includeEnv === true,
      excludedByDefault: [
        '.git',
        'node_modules',
        '.venv',
        'dist',
        'build',
        'target',
        '.env',
        '*.pem',
        '*.key',
        '*.log',
      ],
    },
    ...(externalProjects.length > 0 ? { externalProjects } : {}),
    ...(portableContract ? { portableContract } : {}),
  };

  const normalizedArchivePath = path.resolve(archivePath);
  await fsExtra.ensureDir(path.dirname(archivePath));
  const temporaryPath = `${archivePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const spoolDir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-archive-export-'));
  const spoolPath = path.join(spoolDir, 'manifest-files.jsonl');
  const manifestPath = path.join(spoolDir, 'archive-manifest.json');
  const zipFile = new yazl.ZipFile();
  const timestamp = options.now ?? new Date();
  const compress = options.compression === 'deflate';
  try {
    const spoolStream = createWriteStream(spoolPath, { flags: 'wx' });
    try {
      for await (const candidate of walkWorkspaceFiles(workspacePath, workspacePath, {
        includeEnv: options.includeEnv === true,
      })) {
        if (path.resolve(candidate.fullPath) === normalizedArchivePath) continue;
        const hashed = await hashWorkspaceFile(candidate);
        const spoolEntry: ManifestSpoolEntry = {
          path: hashed.relativePath,
          size: hashed.size,
          sha256: hashed.sha256,
          mtimeMs: hashed.mtimeMs,
        };
        await writeLine(spoolStream, `${JSON.stringify(spoolEntry)}\n`);
      }
      await closeWriteStream(spoolStream);
    } catch (error) {
      spoolStream.destroy();
      throw error;
    }

    await writeWorkspaceArchiveManifestFile({
      manifestBase,
      spoolPath,
      manifestPath,
    });

    for await (const file of readManifestSpool(spoolPath)) {
      const fullPath = path.join(workspacePath, ...file.path.split('/'));
      zipFile.addFile(fullPath, file.path, {
        compress,
        forceZip64Format: file.size >= 0xffffffff,
        mtime: timestamp,
      });
    }
    zipFile.addFile(manifestPath, WORKSPACE_ARCHIVE_MANIFEST_PATH, {
      compress,
      mtime: timestamp,
    });
    zipFile.end({ forceZip64Format: true, comment: '' });
    await pipeline(
      zipFile.outputStream as Readable,
      createWriteStream(temporaryPath, { flags: 'wx' })
    );

    for await (const file of readManifestSpool(spoolPath)) {
      const fullPath = path.join(workspacePath, ...file.path.split('/'));
      const current = await fsExtra.stat(fullPath);
      if (current.size !== file.size || current.mtimeMs !== file.mtimeMs) {
        throw new Error(`Workspace file changed while writing archive: ${file.path}`);
      }
    }

    const archiveStat = await fsExtra.stat(temporaryPath);
    await replaceFileAtomically(temporaryPath, archivePath);
    const manifest = await loadManifestFromSpool(manifestBase, spoolPath);
    return validateArchiveOperationResult({
      schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
      operation: 'export',
      status: 'passed',
      archivePath,
      manifest,
      bytesWritten: archiveStat.size,
    });
  } finally {
    await fsExtra.remove(spoolDir).catch(() => undefined);
    await fsExtra.remove(temporaryPath).catch(() => undefined);
  }
}

async function resolveArchivePath(
  input: string,
  safety: WorkspaceArchiveSafetyOptions = {}
): Promise<{ archivePath: string; cleanup?: string }> {
  if (/^https?:\/\//i.test(input)) {
    const tempDir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-workspace-archive-'));
    const archivePath = path.join(tempDir, 'workspace.workspai-archive.zip');
    const controller = new AbortController();
    const timeoutMs = safety.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => controller.abort(new Error('Download timed out')), timeoutMs)
        : null;
    try {
      const response = await fetchRemoteArchive(
        input,
        controller.signal,
        safety.allowPrivateNetwork === true
      );
      if (!response.ok) {
        throw new Error(`Failed to download workspace archive: HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Failed to download workspace archive: response body is empty.');
      }
      const maxDownloadBytes = safety.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxDownloadBytes) {
        throw new Error(
          `Workspace archive download exceeds configured limit (${declaredLength} > ${maxDownloadBytes} bytes).`
        );
      }
      let downloadedBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxDownloadBytes) {
            callback(
              new Error(
                `Workspace archive download exceeds configured limit (${maxDownloadBytes} bytes).`
              )
            );
            return;
          }
          callback(null, chunk);
        },
      });
      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      await pipeline(source, meter, createWriteStream(archivePath, { flags: 'wx' }));
      return { archivePath, cleanup: tempDir };
    } catch (error) {
      await fsExtra.remove(tempDir).catch(() => undefined);
      if (controller.signal.aborted) {
        throw new Error(`Workspace archive download timed out after ${timeoutMs}ms.`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return { archivePath: path.resolve(input) };
}

function openZipFile(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error || !zipFile) reject(error ?? new Error('Failed to open workspace archive.'));
        else resolve(zipFile);
      }
    );
  });
}

function listZipEntries(zipFile: yauzl.ZipFile): Promise<ArchiveEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ArchiveEntry[] = [];
    const onError = (error: Error) => reject(error);
    zipFile.once('error', onError);
    zipFile.on('entry', (entry: yauzl.Entry) => {
      try {
        assertSafeEntryName(entry.fileName);
        if (entry.isEncrypted()) {
          throw new Error(
            `Encrypted workspace archive entries are not supported: ${entry.fileName}`
          );
        }
        if (!entry.fileName.endsWith('/')) {
          entries.push({
            name: entry.fileName,
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            crc32: entry.crc32,
            entry,
          });
        }
        zipFile.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zipFile.once('end', () => {
      zipFile.removeListener('error', onError);
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Failed to read ${entry.fileName}.`));
      else resolve(stream);
    });
  });
}

async function readEntryBuffer(
  zipFile: yauzl.ZipFile,
  entry: ArchiveEntry,
  maxBytes = MAX_MANIFEST_BYTES_IN_MEMORY
): Promise<Buffer> {
  if (entry.size > maxBytes) {
    throw new Error(`Workspace archive manifest exceeds ${maxBytes} bytes.`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = await openEntryStream(zipFile, entry.entry);
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`Workspace archive manifest exceeds ${maxBytes} bytes.`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function parseManifest(data: Buffer): WorkspaceArchiveManifest {
  const parsed = JSON.parse(data.toString('utf-8')) as WorkspaceArchiveManifest;
  assertJsonSchemaContract(
    parsed,
    WORKSPACE_ARCHIVE_MANIFEST_CONTRACT_PATH,
    'Workspace archive manifest'
  );
  const paths = new Set<string>();
  for (const file of parsed.files) {
    if (!isSafeArchiveEntryName(file.path) || toArchivePath(file.path) !== file.path) {
      throw new Error(`Workspace archive manifest contains an unsafe path: ${file.path}`);
    }
    if (
      file.path === WORKSPACE_ARCHIVE_MANIFEST_PATH ||
      file.path === LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH
    ) {
      throw new Error(`Workspace archive manifest cannot inventory itself: ${file.path}`);
    }
    if (paths.has(file.path)) {
      throw new Error(`Workspace archive manifest contains duplicate path: ${file.path}`);
    }
    paths.add(file.path);
  }
  return parsed;
}

function validateArchiveOperationResult<T>(result: T): T {
  assertJsonSchemaContract(
    result,
    WORKSPACE_ARCHIVE_OPERATION_RESULT_CONTRACT_PATH,
    'Workspace archive operation result'
  );
  return result;
}

function canonicalHydrateEntryName(entryName: string): string {
  return toWorkspaiArtifactPath(toArchivePath(entryName));
}

function getHydratableArchiveEntries(
  entries: ArchiveEntry[]
): Array<ArchiveEntry & { sourceName: string; targetName: string }> {
  const byTarget = new Map<string, ArchiveEntry & { sourceName: string; targetName: string }>();

  for (const entry of entries) {
    if (
      entry.name === WORKSPACE_ARCHIVE_MANIFEST_PATH ||
      entry.name === LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH
    ) {
      continue;
    }

    const targetName = canonicalHydrateEntryName(entry.name);
    const existing = byTarget.get(targetName);
    if (!existing) {
      byTarget.set(targetName, {
        ...entry,
        sourceName: entry.name,
        targetName,
      });
      continue;
    }

    const currentIsCanonical = entry.name === targetName;
    const existingIsCanonical = existing.sourceName === existing.targetName;
    if (currentIsCanonical && !existingIsCanonical) {
      byTarget.set(targetName, {
        ...entry,
        sourceName: entry.name,
        targetName,
      });
      continue;
    }
    if (existing.size === entry.size && existing.crc32 === entry.crc32) {
      continue;
    }
    if (existingIsCanonical) {
      continue;
    }

    throw new Error(
      `Workspace archive contains conflicting entries for ${targetName}: ${existing.sourceName}, ${entry.name}`
    );
  }

  return [...byTarget.values()].sort((a, b) => a.targetName.localeCompare(b.targetName));
}

async function loadWorkspaceArchive(
  input: string,
  safety: WorkspaceArchiveSafetyOptions = {}
): Promise<LoadedWorkspaceArchive> {
  const resolved = await resolveArchivePath(input, safety);
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await openZipFile(resolved.archivePath);
    const entries = await listZipEntries(zipFile);
    if (entries.length > DEFAULT_MAX_ARCHIVE_ENTRIES) {
      throw new Error(
        `Workspace archive contains too many entries (${entries.length} > ${DEFAULT_MAX_ARCHIVE_ENTRIES}).`
      );
    }
    for (const entry of entries) {
      if (entry.size > DEFAULT_MAX_ENTRY_BYTES) {
        throw new Error(`Workspace archive entry is too large: ${entry.name}`);
      }
      const ratio = entry.size / Math.max(1, entry.compressedSize);
      if (ratio > DEFAULT_MAX_COMPRESSION_RATIO) {
        throw new Error(`Workspace archive entry has an unsafe compression ratio: ${entry.name}`);
      }
    }
    const totalExpandedBytes = entries.reduce((total, entry) => total + entry.size, 0);
    const maxExpandedBytes = safety.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;
    if (totalExpandedBytes > maxExpandedBytes) {
      throw new Error(
        `Workspace archive payload exceeds configured limit (${totalExpandedBytes} > ${maxExpandedBytes} bytes).`
      );
    }
    const manifestEntry = entries.find(
      (entry) =>
        entry.name === WORKSPACE_ARCHIVE_MANIFEST_PATH ||
        entry.name === LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH
    );
    if (!manifestEntry) {
      throw new Error(
        `Workspace archive is missing ${workspaceMetadataPath('', 'archive-manifest.json').replace(/^\//, '')}.`
      );
    }
    const manifest = parseManifest(await readEntryBuffer(zipFile, manifestEntry));
    return {
      archivePath: resolved.archivePath,
      entries,
      manifest,
      zipFile,
      cleanup: resolved.cleanup,
    };
  } catch (error) {
    zipFile?.close();
    if (resolved.cleanup) {
      await fsExtra.remove(resolved.cleanup).catch(() => undefined);
    }
    throw error;
  }
}

async function cleanupLoadedArchive(loaded: {
  zipFile?: yauzl.ZipFile;
  cleanup?: string;
}): Promise<void> {
  loaded.zipFile?.close();
  if (loaded.cleanup) {
    await fsExtra.remove(loaded.cleanup).catch(() => undefined);
  }
}

export async function inspectWorkspaceArchive(options: {
  archivePathOrUrl: string;
  safety?: WorkspaceArchiveSafetyOptions;
}): Promise<WorkspaceArchiveInspectResult> {
  const loaded = await loadWorkspaceArchive(options.archivePathOrUrl, options.safety);
  try {
    const entriesByName = new Map(
      loaded.entries
        .filter(
          (entry) =>
            entry.name !== WORKSPACE_ARCHIVE_MANIFEST_PATH &&
            entry.name !== LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH
        )
        .map((entry) => [entry.name, entry])
    );
    const entries = loaded.manifest.files.map((file) => ({
      path: file.path,
      size: entriesByName.get(file.path)?.size ?? file.size,
      hasChecksum: typeof file.sha256 === 'string' && file.sha256.length > 0,
    }));

    return validateArchiveOperationResult({
      schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
      operation: 'inspect',
      status: 'passed',
      archivePath: loaded.archivePath,
      manifest: loaded.manifest,
      fileCount: entries.length,
      totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
      entries,
    });
  } finally {
    await cleanupLoadedArchive(loaded);
  }
}

export async function verifyWorkspaceArchive(options: {
  archivePathOrUrl: string;
  requireChecksums?: boolean;
  safety?: WorkspaceArchiveSafetyOptions;
}): Promise<WorkspaceArchiveVerificationResult> {
  const loaded = await loadWorkspaceArchive(options.archivePathOrUrl, options.safety);
  try {
    const entriesByName = new Map(
      loaded.entries
        .filter(
          (entry) =>
            entry.name !== WORKSPACE_ARCHIVE_MANIFEST_PATH &&
            entry.name !== LEGACY_WORKSPACE_ARCHIVE_MANIFEST_PATH
        )
        .map((entry) => [entry.name, entry])
    );
    const manifestPaths = new Set(loaded.manifest.files.map((file) => file.path));
    const extraArchiveEntries = [...entriesByName.keys()]
      .filter((entryName) => !manifestPaths.has(entryName))
      .sort();
    const missingArchiveEntries: string[] = [];
    const missingChecksumFiles: string[] = [];
    const mismatches: WorkspaceArchiveVerificationResult['mismatches'] = [];
    let verifiedFiles = 0;

    for (const file of loaded.manifest.files) {
      assertSafeEntryName(file.path);
      const entry = entriesByName.get(file.path);
      if (!entry) {
        missingArchiveEntries.push(file.path);
        continue;
      }

      const hash = crypto.createHash('sha256');
      let actualSize = 0;
      const stream = await openEntryStream(loaded.zipFile, entry.entry);
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        actualSize += bytes.length;
        hash.update(bytes);
      }
      const actual = { size: actualSize, sha256: hash.digest('hex') };
      if (actualSize !== entry.size || actualSize !== file.size) {
        mismatches.push({
          path: file.path,
          expected: { size: file.size, sha256: file.sha256 },
          actual,
        });
        continue;
      }
      if (!file.sha256) {
        missingChecksumFiles.push(file.path);
        continue;
      }
      if (actual.sha256 !== file.sha256) {
        mismatches.push({
          path: file.path,
          expected: { size: file.size, sha256: file.sha256 },
          actual,
        });
        continue;
      }
      verifiedFiles += 1;
    }

    const checksumRequiredFailure =
      options.requireChecksums === true && missingChecksumFiles.length > 0;
    const failed =
      missingArchiveEntries.length > 0 ||
      mismatches.length > 0 ||
      checksumRequiredFailure ||
      extraArchiveEntries.length > 0;
    const warning = missingChecksumFiles.length > 0;

    return validateArchiveOperationResult({
      schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
      operation: 'verify',
      archivePath: loaded.archivePath,
      manifest: loaded.manifest,
      status: failed ? 'failed' : warning ? 'warning' : 'passed',
      fileCount: loaded.manifest.files.length,
      totalBytes: loaded.manifest.files.reduce((total, file) => total + file.size, 0),
      verifiedFiles,
      missingChecksumFiles,
      missingArchiveEntries,
      extraArchiveEntries,
      mismatches,
    });
  } finally {
    await cleanupLoadedArchive(loaded);
  }
}

export async function doctorWorkspaceArchive(options: {
  archivePathOrUrl: string;
  strict?: boolean;
  safety?: WorkspaceArchiveSafetyOptions;
}): Promise<WorkspaceArchiveDoctorResult> {
  const resolved = await resolveArchivePath(options.archivePathOrUrl, options.safety);
  try {
    return await doctorResolvedWorkspaceArchive({
      archivePath: resolved.archivePath,
      strict: options.strict,
    });
  } finally {
    if (resolved.cleanup) {
      await fsExtra.remove(resolved.cleanup).catch(() => undefined);
    }
  }
}

async function doctorResolvedWorkspaceArchive(options: {
  archivePath: string;
  strict?: boolean;
}): Promise<WorkspaceArchiveDoctorResult> {
  const inspected = await inspectWorkspaceArchive({ archivePathOrUrl: options.archivePath });
  const verification = await verifyWorkspaceArchive({
    archivePathOrUrl: options.archivePath,
    requireChecksums: options.strict === true,
  });
  const checks: WorkspaceArchiveDoctorResult['checks'] = [];
  const recommendedActions: string[] = [];

  checks.push({
    id: 'manifest-present',
    status: 'passed',
    message: `Archive manifest found for workspace "${inspected.manifest.workspaceName}".`,
  });
  checks.push({
    id: 'integrity',
    status: verification.status,
    message:
      verification.status === 'passed'
        ? `Verified ${verification.verifiedFiles}/${verification.fileCount} files.`
        : 'Archive integrity verification did not fully pass.',
  });

  const envIncluded = inspected.manifest.security?.envFilesIncluded === true;
  checks.push({
    id: 'secrets-policy',
    status: envIncluded ? 'warning' : 'passed',
    message: envIncluded
      ? 'Archive manifest says environment/private files were intentionally included.'
      : 'Archive manifest excludes environment/private files by default.',
  });
  if (envIncluded) {
    recommendedActions.push('Share this archive only through trusted internal channels.');
  }

  if (verification.missingChecksumFiles.length > 0) {
    recommendedActions.push('Re-export the archive with the latest RapidKit/Workspai tooling.');
  }
  if (verification.mismatches.length > 0) {
    recommendedActions.push('Reject this archive and request a fresh export from the owner.');
  }
  if (
    verification.extraArchiveEntries.length > 0 ||
    verification.missingArchiveEntries.length > 0
  ) {
    recommendedActions.push('Regenerate the archive so ZIP entries and manifest entries match.');
  }
  if (options.strict === true && verification.status !== 'passed') {
    recommendedActions.push('Do not hydrate this archive in strict or production workflows.');
  }

  const failed = checks.some((check) => check.status === 'failed');
  const warning = checks.some((check) => check.status === 'warning');
  return validateArchiveOperationResult({
    schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
    operation: 'doctor',
    archivePath: inspected.archivePath,
    status: failed ? 'failed' : warning ? 'warning' : 'passed',
    workspaceName: inspected.manifest.workspaceName,
    fileCount: inspected.fileCount,
    totalBytes: inspected.totalBytes,
    checks,
    recommendedActions,
  });
}

async function validateHydrateOutputPath(outputPath: string, force: boolean): Promise<boolean> {
  const stat = await fsExtra.lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    throw new Error(`Output directory must not be a symbolic link: ${outputPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Output path is not a directory: ${outputPath}`);
  }
  const entries = await fsExtra.readdir(outputPath);
  if (entries.length > 0 && !force) {
    throw new Error(`Output directory is not empty: ${outputPath}. Use --force to overwrite.`);
  }
  return true;
}

export async function hydrateWorkspaceArchive(
  options: WorkspaceArchiveHydrateOptions
): Promise<WorkspaceArchiveHydrateResult> {
  const loaded = await loadWorkspaceArchive(options.archivePathOrUrl, options.safety);
  try {
    const verification = await verifyWorkspaceArchive({
      archivePathOrUrl: loaded.archivePath,
      requireChecksums: options.strict === true,
    });
    if (verification.status === 'failed') {
      const details = [
        verification.missingArchiveEntries.length
          ? `missing entries: ${verification.missingArchiveEntries.join(', ')}`
          : '',
        verification.extraArchiveEntries.length
          ? `unexpected entries: ${verification.extraArchiveEntries.join(', ')}`
          : '',
        verification.mismatches.length
          ? `checksum/size mismatches: ${verification.mismatches
              .map((mismatch) => mismatch.path)
              .join(', ')}`
          : '',
        verification.missingChecksumFiles.length && options.strict === true
          ? `missing checksums: ${verification.missingChecksumFiles.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('; ');
      throw new Error(`Workspace archive verification failed${details ? ` (${details})` : ''}.`);
    }
    if (verification.status === 'warning' && options.strict === true) {
      throw new Error(
        `Workspace archive verification requires checksums for every file: ${verification.missingChecksumFiles.join(
          ', '
        )}`
      );
    }

    const entries = getHydratableArchiveEntries(loaded.entries);
    const manifest = loaded.manifest;
    const outputPath = path.resolve(
      options.outputPath ||
        sanitizeWorkspaceArchiveName(manifest.workspaceName || 'imported-workspace')
    );
    const outputExisted = await validateHydrateOutputPath(outputPath, options.force === true);

    if (!options.dryRun) {
      const parentPath = path.dirname(outputPath);
      const operationId = `${process.pid}-${crypto.randomUUID()}`;
      const stagingPath = path.join(
        parentPath,
        `.${path.basename(outputPath)}.hydrate-${operationId}.tmp`
      );
      const backupPath = path.join(
        parentPath,
        `.${path.basename(outputPath)}.hydrate-${operationId}.backup`
      );
      let outputMovedToBackup = false;
      let committed = false;

      await fsExtra.ensureDir(parentPath);
      try {
        await fsExtra.ensureDir(stagingPath);
        for (const entry of entries) {
          const targetPath = path.resolve(stagingPath, entry.targetName);
          if (!isPathInsideDirectory(targetPath, stagingPath)) {
            throw new Error(`Archive entry escapes output directory: ${entry.targetName}`);
          }
          await fsExtra.ensureDir(path.dirname(targetPath));
          const stream = await openEntryStream(loaded.zipFile, entry.entry);
          await pipeline(stream, createWriteStream(targetPath, { flags: 'wx' }));
        }

        if (outputExisted) {
          await fsExtra.rename(outputPath, backupPath);
          outputMovedToBackup = true;
        }
        await fsExtra.rename(stagingPath, outputPath);
        committed = true;
        if (outputMovedToBackup) {
          await fsExtra.remove(backupPath).catch(() => undefined);
        }
      } catch (error) {
        if (outputMovedToBackup && !(await fsExtra.pathExists(outputPath))) {
          await fsExtra.rename(backupPath, outputPath).catch(() => undefined);
        }
        throw error;
      } finally {
        await fsExtra.remove(stagingPath).catch(() => undefined);
        if (committed) {
          await fsExtra.remove(backupPath).catch(() => undefined);
        }
      }
    }

    return validateArchiveOperationResult({
      schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
      operation: 'hydrate',
      status: 'passed',
      archivePath: loaded.archivePath,
      outputPath,
      dryRun: options.dryRun === true,
      manifest,
      files: entries.map((entry) => ({ path: entry.targetName, size: entry.size })),
    });
  } finally {
    await cleanupLoadedArchive(loaded);
  }
}
