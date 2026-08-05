import crypto from 'node:crypto';
import path from 'path';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import { createRequire } from 'module';

import fsExtra from 'fs-extra';

import { computeInputsHash } from './contracts/freshness-metadata-contract.js';
import type { WorkspaceModel } from './workspace-model.js';
import {
  firstExistingWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';

/**
 * On-disk cache for the workspace model + graph, keyed by `inputsHash` (roadmap 1.15).
 *
 * Building the model is expensive: per-project capability/framework detection and
 * the dependency-graph code-import scan. This cache fingerprints the *structural*
 * inputs (project set, manifests, workspace files, contract, build flags, CLI
 * version) into a deterministic `inputsHash`. When the recomputed hash matches a
 * stored envelope, the cached model is returned byte-for-byte, skipping the
 * expensive rebuild.
 *
 * Scope/limitation: the fingerprint covers manifests and the project set, not the
 * full contents of every source file. Pure code-import edits that do not touch a
 * manifest are not detected by this cache — that finer-grained invalidation is the
 * job of `workspace model --incremental` (1.16). The cache is therefore opt-in.
 */

export const WORKSPACE_MODEL_CACHE_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceModelCache.schemaVersion;
export const WORKSPACE_MODEL_CACHE_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceModelCache;

/** Manifest files whose contents materially change model/graph inference. */
export const MODEL_INPUT_MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'workspai.project.json',
  '.workspai/project.json',
  '.workspai/context.json',
  'rapidkit.project.json',
  '.rapidkit/project.json',
  '.rapidkit/context.json',
] as const;

export type WorkspaceModelCacheEnvelope = {
  schemaVersion: typeof WORKSPACE_MODEL_CACHE_SCHEMA_VERSION;
  cliVersion: string;
  inputsHash: string;
  generatedAt: string;
  model: WorkspaceModel;
  /** Per-project (relative path → signature) for graph-aware incremental builds (1.16). */
  projectSignatures?: Record<string, string>;
  /** Workspace-level file signatures (contract/workspace.json/policies). */
  workspaceFileSignatures?: Record<string, string>;
};

export const MODEL_INPUT_WORKSPACE_FILES = [
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract,
  '.workspai/workspace.json',
  'workspai.workspace.json',
  '.workspai/policies.yml',
  '.workspai/policies.yaml',
  '.rapidkit/workspace.contract.json',
  '.rapidkit/workspace.json',
  'rapidkit.workspace.json',
  '.rapidkit/policies.yml',
  '.rapidkit/policies.yaml',
] as const;

/** Scannable source extensions whose changes can alter code-import edges. */
const SOURCE_FINGERPRINT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SOURCE_FINGERPRINT_SKIP_DIRS = new Set([
  '.git',
  '.workspai',
  '.rapidkit',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
]);
const SOURCE_FINGERPRINT_MAX_FILES = 1500;

export type ModelInputsSignatureInput = {
  workspacePath: string;
  cliVersion: string;
  flags: {
    includeAbsolutePaths: boolean;
    includeEvidence: boolean;
    observableScanDepth: number;
  };
  /** Absolute project root paths discovered for the model. */
  projectPaths: string[];
  workspaceJson: unknown;
  marker: unknown;
};

let cachedCliVersion: string | null = null;

export function getRapidkitCliVersion(): string {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    cachedCliVersion = pkg?.version ?? '0.0.0';
  } catch {
    cachedCliVersion = '0.0.0';
  }
  return cachedCliVersion;
}

async function fileSignature(filePath: string): Promise<string | null> {
  try {
    const content = await fsExtra.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Lightweight per-project signature: manifest content hashes plus a source
 * fingerprint (sorted relative path + size + mtime for scannable files). This
 * detects both manifest and code changes without parsing source, so the
 * incremental builder (1.16) knows exactly which projects' edges to re-infer.
 */
async function projectSignature(projectDir: string): Promise<string> {
  const manifests: Record<string, string> = {};
  for (const manifest of MODEL_INPUT_MANIFEST_FILES) {
    const signature = await fileSignature(path.join(projectDir, manifest));
    if (signature) {
      manifests[manifest] = signature;
    }
  }

  const sourceEntries: string[] = [];
  const queue: string[] = [projectDir];
  while (queue.length > 0 && sourceEntries.length < SOURCE_FINGERPRINT_MAX_FILES) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    let entries: Array<{ isDirectory: () => boolean; isFile: () => boolean; name: string }> = [];
    try {
      entries = (await fsExtra.readdir(current, { withFileTypes: true })) as typeof entries;
    } catch {
      continue;
    }
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          SOURCE_FINGERPRINT_SKIP_DIRS.has(entry.name) ||
          isPythonVirtualEnvironmentDirectory(entry.name) ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        dirs.push(path.join(current, entry.name));
      } else if (entry.isFile() && SOURCE_FINGERPRINT_EXTENSIONS.has(path.extname(entry.name))) {
        const filePath = path.join(current, entry.name);
        const stat = await fsExtra.stat(filePath).catch(() => null);
        if (stat) {
          const rel = path.relative(projectDir, filePath).split(path.sep).join('/');
          sourceEntries.push(`${rel}:${stat.size}:${Math.round(stat.mtimeMs)}`);
        }
      }
    }
    dirs.sort((a, b) => a.localeCompare(b));
    queue.push(...dirs);
  }
  sourceEntries.sort((a, b) => a.localeCompare(b));

  return computeInputsHash({ manifests, source: sourceEntries });
}

export async function computeProjectSignatures(
  workspacePath: string,
  projectPaths: string[]
): Promise<Record<string, string>> {
  const resolvedWorkspace = path.resolve(workspacePath);
  const signatures: Record<string, string> = {};
  const relPaths = [
    ...new Set(
      projectPaths.map((projectPath) =>
        path.relative(resolvedWorkspace, path.resolve(projectPath)).split(path.sep).join('/')
      )
    ),
  ].sort((a, b) => a.localeCompare(b));
  for (const rel of relPaths) {
    signatures[rel] = await projectSignature(path.join(resolvedWorkspace, rel));
  }
  return signatures;
}

export async function computeWorkspaceFileSignatures(
  workspacePath: string
): Promise<Record<string, string>> {
  const resolvedWorkspace = path.resolve(workspacePath);
  const signatures: Record<string, string> = {};
  for (const file of MODEL_INPUT_WORKSPACE_FILES) {
    const signature = await fileSignature(path.join(resolvedWorkspace, file));
    if (signature) {
      signatures[file] = signature;
    }
  }
  return signatures;
}

/**
 * Deterministic hash of the structural inputs that produce a workspace model.
 * Project paths are normalized relative to the workspace and sorted so the hash
 * is stable regardless of discovery order or absolute location.
 */
export async function computeModelInputsHash(input: ModelInputsSignatureInput): Promise<string> {
  const workspacePath = path.resolve(input.workspacePath);
  const relativeProjects = [
    ...new Set(
      input.projectPaths.map((projectPath) =>
        path.relative(workspacePath, path.resolve(projectPath)).split(path.sep).join('/')
      )
    ),
  ].sort((a, b) => a.localeCompare(b));

  const projectSignatures: Array<{ project: string; manifests: Record<string, string> }> = [];
  for (const project of relativeProjects) {
    const manifests: Record<string, string> = {};
    for (const manifest of MODEL_INPUT_MANIFEST_FILES) {
      const signature = await fileSignature(path.join(workspacePath, project, manifest));
      if (signature) {
        manifests[manifest] = signature;
      }
    }
    projectSignatures.push({ project, manifests });
  }

  const workspaceFileSignatures: Record<string, string> = {};
  for (const file of MODEL_INPUT_WORKSPACE_FILES) {
    const signature = await fileSignature(path.join(workspacePath, file));
    if (signature) {
      workspaceFileSignatures[file] = signature;
    }
  }

  return computeInputsHash({
    cacheSchema: WORKSPACE_MODEL_CACHE_SCHEMA_VERSION,
    cliVersion: input.cliVersion,
    flags: input.flags,
    workspaceJson: input.workspaceJson ?? null,
    marker: input.marker ?? null,
    projects: projectSignatures,
    workspaceFiles: workspaceFileSignatures,
  });
}

export async function readWorkspaceModelCache(
  workspacePath: string
): Promise<WorkspaceModelCacheEnvelope | null> {
  const cachePath =
    (await firstExistingWorkspaceArtifactPath(workspacePath, WORKSPACE_MODEL_CACHE_PATH)) ??
    resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_MODEL_CACHE_PATH);
  try {
    if (!(await fsExtra.pathExists(cachePath))) {
      return null;
    }
    const payload = (await fsExtra.readJson(cachePath)) as Partial<WorkspaceModelCacheEnvelope>;
    if (
      !payload ||
      payload.schemaVersion !== WORKSPACE_MODEL_CACHE_SCHEMA_VERSION ||
      typeof payload.inputsHash !== 'string' ||
      typeof payload.cliVersion !== 'string' ||
      !payload.model
    ) {
      return null;
    }
    return payload as WorkspaceModelCacheEnvelope;
  } catch {
    return null;
  }
}

export async function writeWorkspaceModelCache(
  workspacePath: string,
  envelope: Omit<WorkspaceModelCacheEnvelope, 'schemaVersion'>
): Promise<string> {
  const full: WorkspaceModelCacheEnvelope = {
    schemaVersion: WORKSPACE_MODEL_CACHE_SCHEMA_VERSION,
    ...envelope,
  };
  return writeWorkspaceArtifactJson(workspacePath, WORKSPACE_MODEL_CACHE_PATH, full);
}
