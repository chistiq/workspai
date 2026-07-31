import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { existsSync } from 'fs';

import fsExtra from 'fs-extra';

import { removeImportedProjectsRegistryEntries } from './imported-projects-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { discoverWorkspaceProjects } from './utils/workspace-discovery.js';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import {
  hasWorkspaceRootMarkers,
  toWorkspaiArtifactPath,
  workspaceMetadataCandidates,
  workspaceMetadataPath,
} from './utils/workspace-paths.js';

export const WORKSPACE_SNAPSHOT_SCHEMA_V1 = 'rapidkit-workspace-snapshot-v1' as const;
export const WORKSPACE_SNAPSHOT_SCHEMA_V2 = 'rapidkit-workspace-snapshot-v2' as const;
export const WORKSPACE_SNAPSHOT_SCHEMA = WORKSPACE_SNAPSHOT_SCHEMA_V1;
export const PROJECT_ARCHIVE_SCHEMA = 'rapidkit-project-archive-v1';
const PROJECT_ARCHIVE_MANIFEST_FILE = 'workspai-archive.json';
const LEGACY_PROJECT_ARCHIVE_MANIFEST_FILE = 'rapidkit-archive.json';

export type SnapshotMode = 'metadata' | 'full' | 'project';

export interface WorkspaceSnapshotProject {
  name: string;
  relativePath: string;
}

export interface WorkspaceSnapshotManifest {
  schema: typeof WORKSPACE_SNAPSHOT_SCHEMA_V1 | typeof WORKSPACE_SNAPSHOT_SCHEMA_V2;
  name: string;
  mode: SnapshotMode;
  reason?: string;
  createdAt: string;
  workspaceName: string;
  workspacePath: string;
  copiedPaths: string[];
  projects: WorkspaceSnapshotProject[];
  recoveryScope?: {
    kind: 'project';
    projectName: string;
    relativePath: string;
  };
}

export interface CreateWorkspaceSnapshotOptions {
  workspacePath?: string;
  name?: string;
  reason?: string;
  includeProjects?: boolean;
}

export interface CreateWorkspaceSnapshotResult {
  manifest: WorkspaceSnapshotManifest;
  snapshotPath: string;
}

export interface InspectWorkspaceSnapshotOptions {
  workspacePath?: string;
  name: string;
}

export interface InspectWorkspaceSnapshotResult {
  manifest: WorkspaceSnapshotManifest;
  snapshotPath: string;
  filesRoot: string;
  estimatedFileCount: number;
  estimatedBytes: number;
}

export interface ListWorkspaceSnapshotsOptions {
  workspacePath?: string;
}

export interface RestoreWorkspaceSnapshotOptions {
  workspacePath?: string;
  name: string;
  reason?: string;
  force?: boolean;
  dryRun?: boolean;
  safetySnapshot?: boolean;
}

export interface RestoreWorkspaceSnapshotResult {
  workspacePath: string;
  snapshotPath: string;
  restoredPaths: string[];
  dryRun: boolean;
  safetySnapshotPath?: string;
}

export interface ProjectLifecycleOptions {
  workspacePath?: string;
  project: string;
  reason?: string;
  dryRun?: boolean;
}

export interface DeleteProjectOptions extends ProjectLifecycleOptions {
  permanent?: boolean;
  confirm?: string;
}

export interface RestoreArchivedProjectOptions {
  workspacePath?: string;
  archive: string;
  reason?: string;
  targetName?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface ListArchivedProjectsOptions {
  workspacePath?: string;
}

export interface ArchivedProjectEntry extends ProjectArchiveManifest {
  archivePath: string;
  manifestPath: string;
}

export interface ProjectArchiveManifest {
  schema: typeof PROJECT_ARCHIVE_SCHEMA;
  projectName: string;
  originalPath: string;
  archivedPath: string;
  reason?: string;
  archivedAt: string;
  safetySnapshotPath?: string;
}

export interface ProjectLifecycleResult {
  workspacePath: string;
  projectName: string;
  projectPath: string;
  dryRun: boolean;
  action: 'archive' | 'delete' | 'restore';
  archivePath?: string;
  manifestPath?: string;
  safetySnapshotPath?: string;
}

export interface WorkspaceAuditEvent {
  schema: 'rapidkit-workspace-audit-event-v1';
  id: string;
  timestamp: string;
  workspacePath: string;
  action:
    | 'snapshot.create'
    | 'snapshot.restore'
    | 'project.archive'
    | 'project.delete'
    | 'project.restore';
  target?: string;
  status: 'planned' | 'succeeded' | 'failed';
  reason?: string;
  details?: Record<string, unknown>;
}

interface LifecyclePolicy {
  requireReasonForDestructiveOps: boolean;
  requireSafetySnapshotForDestructiveOps: boolean;
  allowPermanentDelete: boolean;
}

const METADATA_PATHS = [
  '.workspai/workspace.json',
  '.workspai-workspace',
  'workspai.config.json',
  'workspai.config.js',
  'workspai.config.cjs',
  'workspai.config.mjs',
  '.rapidkit/workspace.json',
  '.rapidkit-workspace',
  'rapidkit.config.json',
  'rapidkit.config.js',
  'rapidkit.config.cjs',
  'rapidkit.config.mjs',
  'package.json',
];

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'dist',
  'build',
  'target',
  'coverage',
  'htmlcov',
  '.next',
]);

const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = {
  requireReasonForDestructiveOps: false,
  requireSafetySnapshotForDestructiveOps: true,
  allowPermanentDelete: true,
};

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function slugifySnapshotName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new Error('Snapshot name must contain at least one letter or number.');
  }

  return slug.slice(0, 120);
}

async function safeReadJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await fsExtra.readJson(filePath);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parsePolicyBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', '0', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function readLifecyclePolicy(workspacePath: string): Promise<LifecyclePolicy> {
  const policyPath =
    workspaceMetadataCandidates(workspacePath, 'policies.yml').find((candidate) =>
      existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'policies.yml');
  if (!(await fsExtra.pathExists(policyPath))) {
    return { ...DEFAULT_LIFECYCLE_POLICY };
  }

  try {
    const content = await fsExtra.readFile(policyPath, 'utf-8');
    const readRule = (key: string, fallback: boolean): boolean => {
      const match = content.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]+)`, 'm'));
      return parsePolicyBoolean(match?.[1], fallback);
    };

    return {
      requireReasonForDestructiveOps: readRule(
        'require_reason_for_destructive_ops',
        DEFAULT_LIFECYCLE_POLICY.requireReasonForDestructiveOps
      ),
      requireSafetySnapshotForDestructiveOps: readRule(
        'require_safety_snapshot_for_destructive_ops',
        DEFAULT_LIFECYCLE_POLICY.requireSafetySnapshotForDestructiveOps
      ),
      allowPermanentDelete: readRule(
        'allow_permanent_delete',
        DEFAULT_LIFECYCLE_POLICY.allowPermanentDelete
      ),
    };
  } catch {
    return { ...DEFAULT_LIFECYCLE_POLICY };
  }
}

function auditLogPath(workspacePath: string): string {
  return workspaceMetadataPath(workspacePath, 'audit', 'events.jsonl');
}

async function appendAuditEvent(
  workspacePath: string,
  event: Omit<WorkspaceAuditEvent, 'schema' | 'id' | 'timestamp' | 'workspacePath'>
): Promise<WorkspaceAuditEvent> {
  const payload: WorkspaceAuditEvent = {
    schema: 'rapidkit-workspace-audit-event-v1',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    workspacePath,
    ...event,
  };

  const filePath = auditLogPath(workspacePath);
  await fsExtra.ensureDir(path.dirname(filePath));
  await fsExtra.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
  return payload;
}

async function enforceDestructivePolicy(
  workspacePath: string,
  action: WorkspaceAuditEvent['action'],
  options: { reason?: string; safetySnapshot?: boolean; permanent?: boolean }
): Promise<LifecyclePolicy> {
  const policy = await readLifecyclePolicy(workspacePath);

  if (policy.requireReasonForDestructiveOps && !options.reason?.trim()) {
    throw new Error(`${action} requires --reason by workspace policy.`);
  }

  if (policy.requireSafetySnapshotForDestructiveOps && options.safetySnapshot === false) {
    throw new Error(`${action} requires a safety snapshot by workspace policy.`);
  }

  if (options.permanent && !policy.allowPermanentDelete) {
    throw new Error('Permanent project delete is disabled by workspace policy.');
  }

  return policy;
}

export function findWorkspaceRoot(startPath = process.cwd()): string | null {
  let current = path.resolve(startPath);
  const tempRoot = path.resolve(os.tmpdir());

  while (true) {
    if (current !== tempRoot && hasWorkspaceRootMarkers(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function requireWorkspaceRoot(workspacePath?: string): string {
  const resolved = workspacePath ? path.resolve(workspacePath) : findWorkspaceRoot(process.cwd());
  if (!resolved) {
    throw new Error(
      'Not inside a Workspai workspace. Run from workspace root or pass --workspace.'
    );
  }
  if (!hasWorkspaceRootMarkers(resolved)) {
    throw new Error(`Workspace path is not a Workspai workspace: ${resolved}`);
  }
  return resolved;
}

async function getWorkspaceName(workspacePath: string): Promise<string> {
  const workspaceJson = await safeReadJson(
    workspaceMetadataCandidates(workspacePath, 'workspace.json').find((candidate) =>
      existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'workspace.json')
  );
  const rawName = workspaceJson?.workspace_name ?? workspaceJson?.name;
  return typeof rawName === 'string' && rawName.trim()
    ? rawName.trim()
    : path.basename(workspacePath);
}

function snapshotsRoot(workspacePath: string): string {
  return workspaceMetadataPath(workspacePath, 'snapshots');
}

function archiveRoot(workspacePath: string): string {
  return workspaceMetadataPath(workspacePath, 'archive', 'projects');
}

function snapshotFilesRoot(snapshotPath: string): string {
  return path.join(snapshotPath, 'files');
}

function createSnapshotStagingPath(name: string): string {
  return path.join(
    os.tmpdir(),
    `rapidkit-workspace-snapshot-${process.pid}-${name}-${crypto.randomBytes(4).toString('hex')}`
  );
}

function createWorkspaceLocalSnapshotStagingPath(workspacePath: string, name: string): string {
  return path.join(
    snapshotsRoot(workspacePath),
    `.tmp-${process.pid}-${name}-${crypto.randomBytes(4).toString('hex')}`
  );
}

function shouldCopyPath(workspacePath: string, sourcePath: string): boolean {
  const relativePath = path.relative(workspacePath, sourcePath);
  if (!relativePath) {
    return true;
  }

  const segments = relativePath.split(path.sep);
  if (
    (segments[0] === '.workspai' || segments[0] === '.rapidkit') &&
    ['snapshots', 'archive', 'audit'].includes(segments[1] || '')
  ) {
    return false;
  }

  return !segments.some(
    (segment) => EXCLUDED_DIR_NAMES.has(segment) || isPythonVirtualEnvironmentDirectory(segment)
  );
}

async function collectProjects(workspacePath: string): Promise<WorkspaceSnapshotProject[]> {
  const projects = await discoverWorkspaceProjects(workspacePath, {
    descendIntoMatchedProjects: false,
  });

  return projects.map((projectPath) => ({
    name: path.basename(projectPath),
    relativePath: path.relative(workspacePath, projectPath),
  }));
}

async function copyMetadataPaths(workspacePath: string, filesRoot: string): Promise<string[]> {
  const copiedPaths: string[] = [];
  const copiedCanonicalPaths = new Set<string>();

  for (const relativePath of METADATA_PATHS) {
    const sourcePath = path.join(workspacePath, relativePath);
    if (!(await fsExtra.pathExists(sourcePath))) {
      continue;
    }

    const canonicalRelativePath = toWorkspaiArtifactPath(relativePath);
    if (copiedCanonicalPaths.has(canonicalRelativePath)) {
      continue;
    }

    const destinationPath = path.join(filesRoot, canonicalRelativePath);
    await fsExtra.copy(sourcePath, destinationPath, {
      filter: (candidatePath) => shouldCopyPath(workspacePath, candidatePath),
    });
    copiedPaths.push(canonicalRelativePath);
    copiedCanonicalPaths.add(canonicalRelativePath);
  }

  return copiedPaths;
}

async function canonicalizeLegacyMetadataTree(rootPath: string): Promise<void> {
  const legacyPaths: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }> = [];
    try {
      entries = await fsExtra.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.rapidkit') {
          legacyPaths.push(entryPath);
        } else {
          await visit(entryPath);
        }
      } else if (entry.isFile() && entry.name === '.rapidkit-workspace') {
        legacyPaths.push(entryPath);
      }
    }
  }

  await visit(rootPath);

  legacyPaths.sort((a, b) => b.length - a.length);

  for (const legacyPath of legacyPaths) {
    const canonicalPath = path.join(
      path.dirname(legacyPath),
      path.basename(toWorkspaiArtifactPath(path.basename(legacyPath)))
    );
    await fsExtra.copy(legacyPath, canonicalPath, {
      overwrite: false,
      errorOnExist: false,
    });
    await fsExtra.remove(legacyPath);
  }
}

async function writeSnapshotManifest(
  snapshotPath: string,
  manifest: WorkspaceSnapshotManifest
): Promise<void> {
  const contractPath =
    manifest.schema === WORKSPACE_SNAPSHOT_SCHEMA_V2
      ? 'contracts/workspace-snapshot.v2.json'
      : 'contracts/workspace-snapshot.v1.json';
  assertJsonSchemaContract(manifest, contractPath, 'Workspace snapshot manifest');
  await fsExtra.writeJson(path.join(snapshotPath, 'snapshot.json'), manifest, { spaces: 2 });
}

async function readSnapshotManifest(snapshotPath: string): Promise<WorkspaceSnapshotManifest> {
  const manifestPath = path.join(snapshotPath, 'snapshot.json');
  const manifest: unknown = await fsExtra.readJson(manifestPath);
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    ![WORKSPACE_SNAPSHOT_SCHEMA_V1, WORKSPACE_SNAPSHOT_SCHEMA_V2].includes(
      (manifest as WorkspaceSnapshotManifest).schema
    )
  ) {
    throw new Error(`Invalid Workspai workspace snapshot manifest: ${manifestPath}`);
  }
  const typedManifest = manifest as WorkspaceSnapshotManifest;
  const contractPath =
    typedManifest.schema === WORKSPACE_SNAPSHOT_SCHEMA_V2
      ? 'contracts/workspace-snapshot.v2.json'
      : 'contracts/workspace-snapshot.v1.json';
  assertJsonSchemaContract(typedManifest, contractPath, 'Workspace snapshot manifest');
  if (
    typedManifest.mode === 'project' &&
    (typedManifest.schema !== WORKSPACE_SNAPSHOT_SCHEMA_V2 ||
      typedManifest.recoveryScope?.kind !== 'project' ||
      !typedManifest.recoveryScope.relativePath)
  ) {
    throw new Error(`Invalid project recovery snapshot manifest: ${manifestPath}`);
  }
  return typedManifest;
}

async function collectDirectoryStats(rootPath: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }> = [];
    try {
      entries = await fsExtra.readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      try {
        const stat = await fsExtra.stat(entryPath);
        files += 1;
        bytes += stat.size;
      } catch {
        // Ignore files that disappear while inspecting.
      }
    }
  }

  return { files, bytes };
}

export async function createWorkspaceSnapshot(
  options: CreateWorkspaceSnapshotOptions = {}
): Promise<CreateWorkspaceSnapshotResult> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const baseName = options.name ? options.name : `snapshot-${timestampForPath()}`;
  const name = slugifySnapshotName(baseName);
  const snapshotPath = path.join(snapshotsRoot(workspacePath), name);
  const stagingPath = createSnapshotStagingPath(name);

  if (await fsExtra.pathExists(snapshotPath)) {
    throw new Error(`Snapshot already exists: ${name}`);
  }

  const filesRoot = snapshotFilesRoot(stagingPath);

  try {
    await fsExtra.ensureDir(filesRoot);

    const mode: SnapshotMode = options.includeProjects ? 'full' : 'metadata';
    const copiedPaths = mode === 'full' ? ['.'] : await copyMetadataPaths(workspacePath, filesRoot);

    if (mode === 'full') {
      await fsExtra.copy(workspacePath, filesRoot, {
        filter: (candidatePath) => shouldCopyPath(workspacePath, candidatePath),
      });
      await canonicalizeLegacyMetadataTree(filesRoot);
    }

    const manifest: WorkspaceSnapshotManifest = {
      schema: WORKSPACE_SNAPSHOT_SCHEMA,
      name,
      mode,
      reason: options.reason,
      createdAt: new Date().toISOString(),
      workspaceName: await getWorkspaceName(workspacePath),
      workspacePath,
      copiedPaths,
      projects: await collectProjects(workspacePath),
    };

    await writeSnapshotManifest(stagingPath, manifest);
    await fsExtra.ensureDir(path.dirname(snapshotPath));
    await fsExtra.move(stagingPath, snapshotPath, { overwrite: false });
    await appendAuditEvent(workspacePath, {
      action: 'snapshot.create',
      target: name,
      status: 'succeeded',
      reason: options.reason,
      details: {
        mode,
        copiedPaths,
        snapshotPath,
        projectCount: manifest.projects.length,
      },
    });
    return { manifest, snapshotPath };
  } catch (error) {
    await fsExtra.remove(stagingPath);
    await appendAuditEvent(workspacePath, {
      action: 'snapshot.create',
      target: name,
      status: 'failed',
      reason: options.reason,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

async function createProjectRecoverySnapshot(options: {
  workspacePath: string;
  projectPath: string;
  namePrefix: string;
  reason: string;
  moveSource: boolean;
}): Promise<CreateWorkspaceSnapshotResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const projectPath = path.resolve(options.projectPath);
  const relativePath = path.relative(workspacePath, projectPath);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    relativePath
      .split(path.sep)
      .some((segment) => segment === '.workspai' || segment === '.rapidkit')
  ) {
    throw new Error(`Project recovery path must be a project inside the workspace: ${projectPath}`);
  }

  const projectName = path.basename(projectPath);
  const name = slugifySnapshotName(
    `${options.namePrefix}-${projectName}-${timestampForPath()}-${crypto.randomBytes(3).toString('hex')}`
  );
  const snapshotPath = path.join(snapshotsRoot(workspacePath), name);
  const stagingPath = createWorkspaceLocalSnapshotStagingPath(workspacePath, name);
  const stagedProjectPath = path.join(snapshotFilesRoot(stagingPath), relativePath);
  let sourceMoved = false;

  try {
    await fsExtra.ensureDir(path.dirname(stagedProjectPath));
    if (options.moveSource) {
      await fsExtra.move(projectPath, stagedProjectPath, { overwrite: false });
      sourceMoved = true;
    } else {
      await fsExtra.copy(projectPath, stagedProjectPath, {
        overwrite: false,
        errorOnExist: true,
        filter: (candidatePath) => shouldCopyPath(projectPath, candidatePath),
      });
    }

    const manifest: WorkspaceSnapshotManifest = {
      schema: WORKSPACE_SNAPSHOT_SCHEMA_V2,
      name,
      mode: 'project',
      reason: options.reason,
      createdAt: new Date().toISOString(),
      workspaceName: await getWorkspaceName(workspacePath),
      workspacePath,
      copiedPaths: [relativePath],
      projects: [{ name: projectName, relativePath }],
      recoveryScope: { kind: 'project', projectName, relativePath },
    };

    await writeSnapshotManifest(stagingPath, manifest);
    await fsExtra.move(stagingPath, snapshotPath, { overwrite: false });
    await appendAuditEvent(workspacePath, {
      action: 'snapshot.create',
      target: name,
      status: 'succeeded',
      reason: options.reason,
      details: { mode: 'project', copiedPaths: [relativePath], snapshotPath, projectCount: 1 },
    });
    return { manifest, snapshotPath };
  } catch (error) {
    if (sourceMoved && !(await fsExtra.pathExists(projectPath))) {
      const recoveryCandidate = (await fsExtra.pathExists(stagedProjectPath))
        ? stagedProjectPath
        : path.join(snapshotFilesRoot(snapshotPath), relativePath);
      if (await fsExtra.pathExists(recoveryCandidate)) {
        await fsExtra.ensureDir(path.dirname(projectPath));
        await fsExtra.move(recoveryCandidate, projectPath, { overwrite: false });
      }
    }
    await fsExtra.remove(stagingPath);
    await fsExtra.remove(snapshotPath);
    await appendAuditEvent(workspacePath, {
      action: 'snapshot.create',
      target: name,
      status: 'failed',
      reason: options.reason,
      details: { mode: 'project', error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

export async function inspectWorkspaceSnapshot(
  options: InspectWorkspaceSnapshotOptions
): Promise<InspectWorkspaceSnapshotResult> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const snapshotPath = path.join(snapshotsRoot(workspacePath), slugifySnapshotName(options.name));
  if (!(await fsExtra.pathExists(snapshotPath))) {
    throw new Error(`Snapshot not found: ${options.name}`);
  }

  const manifest = await readSnapshotManifest(snapshotPath);
  const filesRoot = snapshotFilesRoot(snapshotPath);
  const stats = await collectDirectoryStats(filesRoot);

  return {
    manifest,
    snapshotPath,
    filesRoot,
    estimatedFileCount: stats.files,
    estimatedBytes: stats.bytes,
  };
}

export async function listWorkspaceSnapshots(
  options: ListWorkspaceSnapshotsOptions = {}
): Promise<Array<WorkspaceSnapshotManifest & { snapshotPath: string }>> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const root = snapshotsRoot(workspacePath);
  if (!(await fsExtra.pathExists(root))) {
    return [];
  }

  const entries = await fsExtra.readdir(root, { withFileTypes: true });
  const snapshots: Array<WorkspaceSnapshotManifest & { snapshotPath: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snapshotPath = path.join(root, entry.name);
    try {
      snapshots.push({ ...(await readSnapshotManifest(snapshotPath)), snapshotPath });
    } catch {
      // Ignore unknown folders so teams can keep manual notes beside snapshots.
    }
  }

  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const OPERATIONAL_HISTORY_PATHS = [
  '.workspai/snapshots',
  '.workspai/archive',
  '.workspai/audit',
  '.rapidkit/snapshots',
  '.rapidkit/archive',
  '.rapidkit/audit',
] as const;

async function restoreFullSnapshotAtomically(input: {
  workspacePath: string;
  filesRoot: string;
  snapshotName: string;
}): Promise<string> {
  const parentPath = path.dirname(input.workspacePath);
  const workspaceBaseName = path.basename(input.workspacePath);
  const suffix = `${timestampForPath()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagingPath = path.join(parentPath, `.${workspaceBaseName}.restore-staging-${suffix}`);
  const backupPath = path.join(parentPath, `.${workspaceBaseName}.pre-restore-${suffix}`);
  const failedPath = path.join(parentPath, `.${workspaceBaseName}.restore-failed-${suffix}`);
  const movedOperationalPaths: string[] = [];
  let workspaceMoved = false;
  let replacementInstalled = false;

  try {
    await fsExtra.copy(input.filesRoot, stagingPath, {
      overwrite: false,
      errorOnExist: true,
      filter: (candidatePath) => shouldCopyPath(input.filesRoot, candidatePath),
    });
    await canonicalizeLegacyMetadataTree(stagingPath);
    await fsExtra.rename(input.workspacePath, backupPath);
    workspaceMoved = true;
    await fsExtra.rename(stagingPath, input.workspacePath);
    replacementInstalled = true;

    for (const relativePath of OPERATIONAL_HISTORY_PATHS) {
      const sourcePath = path.join(backupPath, relativePath);
      if (!(await fsExtra.pathExists(sourcePath))) continue;
      const destinationPath = path.join(input.workspacePath, relativePath);
      if (await fsExtra.pathExists(destinationPath)) {
        throw new Error(`Full restore operational path collision: ${relativePath}`);
      }
      await fsExtra.ensureDir(path.dirname(destinationPath));
      await fsExtra.rename(sourcePath, destinationPath);
      movedOperationalPaths.push(relativePath);
    }

    return backupPath;
  } catch (error) {
    for (const relativePath of [...movedOperationalPaths].reverse()) {
      const sourcePath = path.join(input.workspacePath, relativePath);
      const destinationPath = path.join(backupPath, relativePath);
      if (await fsExtra.pathExists(sourcePath)) {
        await fsExtra.ensureDir(path.dirname(destinationPath));
        await fsExtra.rename(sourcePath, destinationPath);
      }
    }
    if (replacementInstalled && (await fsExtra.pathExists(input.workspacePath))) {
      await fsExtra.rename(input.workspacePath, failedPath);
    }
    if (workspaceMoved && (await fsExtra.pathExists(backupPath))) {
      await fsExtra.rename(backupPath, input.workspacePath);
    }
    await fsExtra.remove(failedPath);
    await fsExtra.remove(stagingPath);
    throw new Error(
      `Atomic full restore failed for ${input.snapshotName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function rollbackMovedProjectSnapshot(
  snapshot: CreateWorkspaceSnapshotResult,
  workspacePath: string
): Promise<void> {
  const relativePath = snapshot.manifest.recoveryScope?.relativePath;
  if (!relativePath) return;
  const storedPath = path.join(snapshotFilesRoot(snapshot.snapshotPath), relativePath);
  const projectPath = path.join(workspacePath, relativePath);
  if ((await fsExtra.pathExists(storedPath)) && !(await fsExtra.pathExists(projectPath))) {
    await fsExtra.ensureDir(path.dirname(projectPath));
    await fsExtra.move(storedPath, projectPath, { overwrite: false });
  }
  await fsExtra.remove(snapshot.snapshotPath);
}

export async function restoreWorkspaceSnapshot(
  options: RestoreWorkspaceSnapshotOptions
): Promise<RestoreWorkspaceSnapshotResult> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const snapshotPath = path.join(snapshotsRoot(workspacePath), slugifySnapshotName(options.name));
  if (!(await fsExtra.pathExists(snapshotPath))) {
    throw new Error(`Snapshot not found: ${options.name}`);
  }

  const manifest = await readSnapshotManifest(snapshotPath);
  const filesRoot = snapshotFilesRoot(snapshotPath);
  const restoredPaths =
    manifest.mode === 'full'
      ? ['.']
      : Array.from(
          new Set(
            manifest.copiedPaths.map((relativePath) => {
              const canonicalPath = toWorkspaiArtifactPath(relativePath);
              return canonicalPath.startsWith('.workspai/') ? '.workspai' : canonicalPath;
            })
          )
        );

  if (options.dryRun) {
    await appendAuditEvent(workspacePath, {
      action: 'snapshot.restore',
      target: manifest.name,
      status: 'planned',
      reason: options.reason,
      details: { restoredPaths },
    });
    return { workspacePath, snapshotPath, restoredPaths, dryRun: true };
  }

  if (!options.force) {
    throw new Error(
      'Restore is destructive. Re-run with --force after reviewing --dry-run output.'
    );
  }

  await enforceDestructivePolicy(workspacePath, 'snapshot.restore', {
    reason: options.reason,
    safetySnapshot: options.safetySnapshot,
  });

  let safetySnapshotPath: string | undefined;
  if (manifest.mode === 'full') {
    safetySnapshotPath = await restoreFullSnapshotAtomically({
      workspacePath,
      filesRoot,
      snapshotName: manifest.name,
    });
  } else if (manifest.mode === 'project') {
    const relativePath = manifest.recoveryScope?.relativePath;
    if (!relativePath) {
      throw new Error(`Project recovery snapshot is missing recoveryScope: ${manifest.name}`);
    }
    const sourcePath = path.join(filesRoot, relativePath);
    const projectPath = path.join(workspacePath, relativePath);
    const projectExists = await fsExtra.pathExists(projectPath);
    let safetySnapshot: CreateWorkspaceSnapshotResult | undefined;
    const transientRollbackPath = path.join(
      path.dirname(projectPath),
      `.${path.basename(projectPath)}.pre-restore-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
    );
    let transientProjectMoved = false;
    if (projectExists && options.safetySnapshot !== false) {
      safetySnapshot = await createProjectRecoverySnapshot({
        workspacePath,
        projectPath,
        namePrefix: `pre-restore-${manifest.name}`,
        reason: `Automatic project recovery snapshot before restoring ${manifest.name}`,
        moveSource: true,
      });
      safetySnapshotPath = safetySnapshot.snapshotPath;
    } else if (projectExists) {
      await fsExtra.rename(projectPath, transientRollbackPath);
      transientProjectMoved = true;
    }

    const temporaryProjectPath = path.join(
      path.dirname(projectPath),
      `.${path.basename(projectPath)}.restore-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
    );
    try {
      await fsExtra.copy(sourcePath, temporaryProjectPath, {
        overwrite: false,
        errorOnExist: true,
      });
      await fsExtra.rename(temporaryProjectPath, projectPath);
      if (transientProjectMoved) {
        await fsExtra.remove(transientRollbackPath);
      }
    } catch (error) {
      await fsExtra.remove(temporaryProjectPath);
      if (transientProjectMoved && (await fsExtra.pathExists(transientRollbackPath))) {
        await fsExtra.remove(projectPath);
        await fsExtra.rename(transientRollbackPath, projectPath);
      }
      if (safetySnapshot) {
        await rollbackMovedProjectSnapshot(safetySnapshot, workspacePath);
      }
      throw error;
    }
  } else if (options.safetySnapshot !== false) {
    const safetySnapshot = await createWorkspaceSnapshot({
      workspacePath,
      name: `pre-restore-${manifest.name}-${timestampForPath()}`,
      reason: `Automatic safety snapshot before restoring ${manifest.name}`,
      includeProjects: false,
    });
    safetySnapshotPath = safetySnapshot.snapshotPath;
  }

  if (manifest.mode === 'metadata') {
    const restoredCanonicalPaths = new Set<string>();
    for (const relativePath of manifest.copiedPaths) {
      const canonicalRelativePath = toWorkspaiArtifactPath(relativePath);
      if (restoredCanonicalPaths.has(canonicalRelativePath)) {
        continue;
      }
      await fsExtra.copy(
        path.join(filesRoot, relativePath),
        path.join(workspacePath, canonicalRelativePath),
        {
          overwrite: true,
          errorOnExist: false,
        }
      );
      restoredCanonicalPaths.add(canonicalRelativePath);
    }
  }

  const result = { workspacePath, snapshotPath, restoredPaths, dryRun: false, safetySnapshotPath };

  await appendAuditEvent(workspacePath, {
    action: 'snapshot.restore',
    target: manifest.name,
    status: 'succeeded',
    reason: options.reason,
    details: {
      restoredPaths,
      safetySnapshotPath,
    },
  });

  return result;
}

function normalizeProjectRef(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error('Project name/path is required.');
  }
  return normalized;
}

async function resolveProjectPath(workspacePath: string, projectRef: string): Promise<string> {
  const normalizedRef = normalizeProjectRef(projectRef);
  const absoluteCandidate = path.isAbsolute(normalizedRef)
    ? path.resolve(normalizedRef)
    : path.resolve(workspacePath, normalizedRef);

  if (
    absoluteCandidate.startsWith(`${path.resolve(workspacePath)}${path.sep}`) &&
    (await fsExtra.pathExists(absoluteCandidate))
  ) {
    return absoluteCandidate;
  }

  const projects = await discoverWorkspaceProjects(workspacePath, {
    descendIntoMatchedProjects: false,
  });

  const matches = projects.filter((projectPath) => {
    const relativePath = path.relative(workspacePath, projectPath);
    return path.basename(projectPath) === normalizedRef || relativePath === normalizedRef;
  });

  if (matches.length === 0) {
    throw new Error(`Project not found in workspace: ${projectRef}`);
  }
  if (matches.length > 1) {
    throw new Error(`Project reference is ambiguous: ${projectRef}`);
  }
  return matches[0];
}

async function reconcileWorkspaceProjectsAfterLifecycle(workspacePath: string): Promise<void> {
  const { syncWorkspaceProjects } = await import('./workspace.js');
  await syncWorkspaceProjects(workspacePath, true);
  const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
  await syncWorkspaceContract({ workspacePath, strict: true });
  const { syncWorkspaceProjectLenses } = await import('./project-intelligence-lens.js');
  // Registry and contract reconciliation are the authoritative lifecycle
  // transaction. Project lenses are portable convenience projections and may
  // legitimately skip an unavailable external project. A skip must never turn
  // an already completed archive/delete into a reported lifecycle failure.
  await syncWorkspaceProjectLenses({ workspacePath, mode: 'managed' });
}

function archivedProjectPath(workspacePath: string, projectName: string): string {
  const fingerprint = crypto.randomBytes(4).toString('hex');
  return path.join(
    archiveRoot(workspacePath),
    `${projectName}-${timestampForPath()}-${fingerprint}`
  );
}

async function readArchiveManifest(archivePath: string): Promise<ProjectArchiveManifest> {
  const manifestPath = archiveManifestPath(archivePath);
  const manifest: unknown = await fsExtra.readJson(manifestPath);
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    (manifest as ProjectArchiveManifest).schema !== PROJECT_ARCHIVE_SCHEMA
  ) {
    throw new Error(`Invalid Workspai archive manifest: ${manifestPath}`);
  }
  assertJsonSchemaContract(
    manifest,
    'contracts/project-archive.v1.json',
    'Project archive manifest'
  );
  return manifest as ProjectArchiveManifest;
}

function archiveManifestPath(archivePath: string): string {
  return (
    [PROJECT_ARCHIVE_MANIFEST_FILE, LEGACY_PROJECT_ARCHIVE_MANIFEST_FILE]
      .map((fileName) => path.join(archivePath, fileName))
      .find((candidate) => fsExtra.existsSync(candidate)) ??
    path.join(archivePath, PROJECT_ARCHIVE_MANIFEST_FILE)
  );
}

export async function listArchivedProjects(
  options: ListArchivedProjectsOptions = {}
): Promise<ArchivedProjectEntry[]> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const root = archiveRoot(workspacePath);
  if (!(await fsExtra.pathExists(root))) {
    return [];
  }

  const entries = await fsExtra.readdir(root, { withFileTypes: true });
  const archives: ArchivedProjectEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const archivePath = path.join(root, entry.name);
    const manifestPath =
      [PROJECT_ARCHIVE_MANIFEST_FILE, LEGACY_PROJECT_ARCHIVE_MANIFEST_FILE]
        .map((fileName) => path.join(archivePath, fileName))
        .find((candidate) => fsExtra.existsSync(candidate)) ??
      path.join(archivePath, PROJECT_ARCHIVE_MANIFEST_FILE);
    try {
      archives.push({
        ...(await readArchiveManifest(archivePath)),
        archivePath,
        manifestPath,
      });
    } catch {
      // Unknown folders are ignored to keep manual archives harmless.
    }
  }

  return archives.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

async function resolveArchivePath(workspacePath: string, archiveRef: string): Promise<string> {
  const normalizedRef = normalizeProjectRef(archiveRef);
  const absoluteCandidate = path.isAbsolute(normalizedRef)
    ? path.resolve(normalizedRef)
    : path.resolve(archiveRoot(workspacePath), normalizedRef);

  if (
    absoluteCandidate.startsWith(`${path.resolve(archiveRoot(workspacePath))}${path.sep}`) &&
    ((await fsExtra.pathExists(path.join(absoluteCandidate, PROJECT_ARCHIVE_MANIFEST_FILE))) ||
      (await fsExtra.pathExists(
        path.join(absoluteCandidate, LEGACY_PROJECT_ARCHIVE_MANIFEST_FILE)
      )))
  ) {
    return absoluteCandidate;
  }

  const archives = await listArchivedProjects({ workspacePath });
  const matches = archives.filter((archive) => {
    return (
      path.basename(archive.archivePath) === normalizedRef ||
      archive.projectName === normalizedRef ||
      path.relative(archiveRoot(workspacePath), archive.archivePath) === normalizedRef
    );
  });

  if (matches.length === 0) {
    throw new Error(`Archived project not found: ${archiveRef}`);
  }
  if (matches.length > 1) {
    throw new Error(`Archive reference is ambiguous: ${archiveRef}`);
  }
  return matches[0].archivePath;
}

export async function archiveWorkspaceProject(
  options: ProjectLifecycleOptions
): Promise<ProjectLifecycleResult> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const projectPath = await resolveProjectPath(workspacePath, options.project);
  const projectName = path.basename(projectPath);
  const archivePath = archivedProjectPath(workspacePath, projectName);
  const manifestPath = path.join(archivePath, PROJECT_ARCHIVE_MANIFEST_FILE);
  const archiveStagingPath = `${archivePath}.tmp-${process.pid}`;
  const stagingManifestPath = path.join(archiveStagingPath, PROJECT_ARCHIVE_MANIFEST_FILE);

  for (const reservedManifestName of [
    PROJECT_ARCHIVE_MANIFEST_FILE,
    LEGACY_PROJECT_ARCHIVE_MANIFEST_FILE,
  ]) {
    if (await fsExtra.pathExists(path.join(projectPath, reservedManifestName))) {
      throw new Error(
        `Project contains reserved archive manifest path and cannot be archived safely: ${reservedManifestName}`
      );
    }
  }

  if (options.dryRun) {
    await appendAuditEvent(workspacePath, {
      action: 'project.archive',
      target: projectName,
      status: 'planned',
      reason: options.reason,
      details: { projectPath, archivePath },
    });
    return {
      workspacePath,
      projectName,
      projectPath,
      action: 'archive',
      archivePath,
      manifestPath,
      dryRun: true,
    };
  }

  await enforceDestructivePolicy(workspacePath, 'project.archive', {
    reason: options.reason,
    safetySnapshot: true,
  });

  const safetySnapshot = await createProjectRecoverySnapshot({
    workspacePath,
    projectPath,
    namePrefix: 'pre-archive',
    reason: options.reason || `Automatic safety snapshot before archiving ${projectName}`,
    moveSource: false,
  });

  const manifest: ProjectArchiveManifest = {
    schema: PROJECT_ARCHIVE_SCHEMA,
    projectName,
    originalPath: projectPath,
    archivedPath: archivePath,
    reason: options.reason,
    archivedAt: new Date().toISOString(),
    safetySnapshotPath: safetySnapshot.snapshotPath,
  };
  assertJsonSchemaContract(
    manifest,
    'contracts/project-archive.v1.json',
    'Project archive manifest'
  );

  let projectMoved = false;
  try {
    await fsExtra.ensureDir(path.dirname(archivePath));
    await fsExtra.move(projectPath, archiveStagingPath, { overwrite: false });
    projectMoved = true;
    await fsExtra.writeJson(stagingManifestPath, manifest, { spaces: 2 });
    await fsExtra.rename(archiveStagingPath, archivePath);
  } catch (error) {
    if (projectMoved && !(await fsExtra.pathExists(projectPath))) {
      const rollbackPath = (await fsExtra.pathExists(archiveStagingPath))
        ? archiveStagingPath
        : archivePath;
      if (await fsExtra.pathExists(rollbackPath)) {
        await fsExtra.remove(path.join(rollbackPath, PROJECT_ARCHIVE_MANIFEST_FILE));
        await fsExtra.move(rollbackPath, projectPath, { overwrite: false });
      }
    }
    await fsExtra.remove(archiveStagingPath);
    throw error;
  }
  await removeImportedProjectsRegistryEntries(workspacePath, [projectPath]);
  await reconcileWorkspaceProjectsAfterLifecycle(workspacePath);

  await appendAuditEvent(workspacePath, {
    action: 'project.archive',
    target: projectName,
    status: 'succeeded',
    reason: options.reason,
    details: {
      projectPath,
      archivePath,
      manifestPath,
      safetySnapshotPath: safetySnapshot.snapshotPath,
    },
  });

  return {
    workspacePath,
    projectName,
    projectPath,
    action: 'archive',
    archivePath,
    manifestPath,
    safetySnapshotPath: safetySnapshot.snapshotPath,
    dryRun: false,
  };
}

export async function deleteWorkspaceProject(
  options: DeleteProjectOptions
): Promise<ProjectLifecycleResult> {
  if (!options.permanent) {
    return archiveWorkspaceProject(options);
  }

  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const projectPath = await resolveProjectPath(workspacePath, options.project);
  const projectName = path.basename(projectPath);

  if (options.confirm !== projectName) {
    throw new Error(`Permanent delete requires --confirm ${projectName}`);
  }

  if (options.dryRun) {
    await appendAuditEvent(workspacePath, {
      action: 'project.delete',
      target: projectName,
      status: 'planned',
      reason: options.reason,
      details: { projectPath, permanent: true },
    });
    return {
      workspacePath,
      projectName,
      projectPath,
      action: 'delete',
      dryRun: true,
    };
  }

  await enforceDestructivePolicy(workspacePath, 'project.delete', {
    reason: options.reason,
    permanent: true,
    safetySnapshot: true,
  });

  const safetySnapshot = await createProjectRecoverySnapshot({
    workspacePath,
    projectPath,
    namePrefix: 'pre-delete',
    reason: options.reason || `Automatic safety snapshot before deleting ${projectName}`,
    moveSource: true,
  });
  await removeImportedProjectsRegistryEntries(workspacePath, [projectPath]);
  await reconcileWorkspaceProjectsAfterLifecycle(workspacePath);

  await appendAuditEvent(workspacePath, {
    action: 'project.delete',
    target: projectName,
    status: 'succeeded',
    reason: options.reason,
    details: {
      projectPath,
      permanent: true,
      safetySnapshotPath: safetySnapshot.snapshotPath,
    },
  });

  return {
    workspacePath,
    projectName,
    projectPath,
    action: 'delete',
    safetySnapshotPath: safetySnapshot.snapshotPath,
    dryRun: false,
  };
}

export async function restoreArchivedProject(
  options: RestoreArchivedProjectOptions
): Promise<ProjectLifecycleResult> {
  const workspacePath = requireWorkspaceRoot(options.workspacePath);
  const archivePath = await resolveArchivePath(workspacePath, options.archive);
  const manifest = await readArchiveManifest(archivePath);
  const projectName = options.targetName?.trim() || manifest.projectName;
  const projectPath = path.join(workspacePath, projectName);

  if (!projectPath.startsWith(`${path.resolve(workspacePath)}${path.sep}`)) {
    throw new Error(`Archive restore target escapes workspace: ${projectName}`);
  }

  if ((await fsExtra.pathExists(projectPath)) && !options.force) {
    throw new Error(
      `Project path already exists. Re-run with --force to overwrite: ${projectPath}`
    );
  }

  if (options.dryRun) {
    await appendAuditEvent(workspacePath, {
      action: 'project.restore',
      target: projectName,
      status: 'planned',
      reason: options.reason,
      details: { archivePath, projectPath },
    });
    return {
      workspacePath,
      projectName,
      projectPath,
      action: 'restore',
      archivePath,
      manifestPath: path.join(archivePath, PROJECT_ARCHIVE_MANIFEST_FILE),
      dryRun: true,
    };
  }

  await enforceDestructivePolicy(workspacePath, 'project.restore', {
    reason: options.reason,
    safetySnapshot: true,
  });

  const existingProject = await fsExtra.pathExists(projectPath);
  const safetySnapshot = existingProject
    ? await createProjectRecoverySnapshot({
        workspacePath,
        projectPath,
        namePrefix: 'pre-restore-project',
        reason: options.reason || `Automatic safety snapshot before restoring ${projectName}`,
        moveSource: true,
      })
    : await createWorkspaceSnapshot({
        workspacePath,
        name: `pre-restore-project-${projectName}-${timestampForPath()}`,
        reason: options.reason || `Automatic safety snapshot before restoring ${projectName}`,
        includeProjects: false,
      });

  const sourceManifestPath = archiveManifestPath(archivePath);
  const restoreReceiptPath = workspaceMetadataPath(
    workspacePath,
    'audit',
    'restores',
    `${path.basename(archivePath)}.json`
  );
  try {
    await fsExtra.move(archivePath, projectPath, { overwrite: false });
    await fsExtra.ensureDir(path.dirname(restoreReceiptPath));
    await fsExtra.move(
      path.join(projectPath, path.basename(sourceManifestPath)),
      restoreReceiptPath,
      { overwrite: false }
    );
  } catch (error) {
    if (await fsExtra.pathExists(projectPath)) {
      if (await fsExtra.pathExists(restoreReceiptPath)) {
        await fsExtra.move(
          restoreReceiptPath,
          path.join(projectPath, path.basename(sourceManifestPath)),
          { overwrite: false }
        );
      }
      if (!(await fsExtra.pathExists(archivePath))) {
        await fsExtra.move(projectPath, archivePath, { overwrite: false });
      }
    }
    if (existingProject) {
      await rollbackMovedProjectSnapshot(safetySnapshot, workspacePath);
    }
    throw error;
  }
  await reconcileWorkspaceProjectsAfterLifecycle(workspacePath);

  await appendAuditEvent(workspacePath, {
    action: 'project.restore',
    target: projectName,
    status: 'succeeded',
    reason: options.reason,
    details: {
      archivePath,
      projectPath,
      restoreReceiptPath,
      safetySnapshotPath: safetySnapshot.snapshotPath,
    },
  });

  return {
    workspacePath,
    projectName,
    projectPath,
    action: 'restore',
    archivePath,
    manifestPath: restoreReceiptPath,
    safetySnapshotPath: safetySnapshot.snapshotPath,
    dryRun: false,
  };
}
