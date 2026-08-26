import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  WorkspaceActivityOrigin,
  WorkspaceActivityScope,
  WorkspaceActivityScopeKind,
} from './activity-contract.js';
import {
  hasWorkspaceRootMarkers,
  PROJECT_WORKSPACE_LINK_FILE,
  projectMetadataCandidates,
} from '../utils/workspace-paths.js';

const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  '*.sln',
] as const;

export type ResolvedActivityScope = {
  scope: WorkspaceActivityScope;
  /** Semantic authority root (workspace when linked/adopted). */
  rootPath: string;
  /** Stable physical observation root used for local locators and channel continuity. */
  observationRootPath: string;
  statePath: string;
  mirrorStatePaths: string[];
};

function exists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function containsMarker(candidate: string, markers: readonly string[]): boolean {
  return markers.some((marker) => {
    if (marker === '*.sln') {
      try {
        return fs.readdirSync(candidate).some((entry) => entry.toLowerCase().endsWith('.sln'));
      } catch {
        return false;
      }
    }
    return exists(path.join(candidate, marker));
  });
}

function findAncestor(
  startPath: string,
  predicate: (candidate: string) => boolean,
  boundaryPath?: string
): string | null {
  let current = path.resolve(startPath);
  const boundary = boundaryPath ? path.resolve(boundaryPath) : null;
  while (true) {
    if (predicate(current)) return current;
    if (boundary && current === boundary) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function linkedWorkspaceRoot(projectRoot: string): string | null {
  for (const linkPath of projectMetadataCandidates(projectRoot, PROJECT_WORKSPACE_LINK_FILE)) {
    if (!exists(linkPath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(linkPath, 'utf8')) as {
        workspace?: { root?: unknown };
      };
      const root = typeof payload.workspace?.root === 'string' ? payload.workspace.root : null;
      if (root && hasWorkspaceRootMarkers(path.resolve(root))) return path.resolve(root);
    } catch {
      // A malformed machine-local link must not stop the observed command.
    }
  }
  return null;
}

export function resolveActivityStateHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WORKSPAI_ACTIVITY_STATE_DIR) return path.resolve(env.WORKSPAI_ACTIVITY_STATE_DIR);
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA || os.homedir(), 'Workspai', 'activity');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Workspai', 'activity');
  }
  return path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'workspai',
    'activity'
  );
}

function stableLocalScopeId(kind: WorkspaceActivityScopeKind, rootPath: string): string {
  let canonical = path.resolve(rootPath);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // Missing/inaccessible paths are represented by their normalized requested path.
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  return `${kind}-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
}

function stableChannelId(rootPath: string): string {
  let canonical = path.resolve(rootPath);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // Preserve the normalized requested path when realpath is unavailable.
  }
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  return `local-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
}

export function resolveActivityScope(
  startPath: string = process.cwd(),
  options: { env?: NodeJS.ProcessEnv } = {}
): ResolvedActivityScope {
  const requested = path.resolve(startPath);
  const workspaceRoot = findAncestor(requested, hasWorkspaceRootMarkers);
  const projectRoot = findAncestor(
    requested,
    (candidate) =>
      exists(path.join(candidate, '.git')) || containsMarker(candidate, PROJECT_MARKERS),
    workspaceRoot ?? undefined
  );
  const linkedWorkspace = projectRoot ? linkedWorkspaceRoot(projectRoot) : null;
  const rootPath = workspaceRoot ?? linkedWorkspace ?? projectRoot ?? requested;
  const observationRootPath = projectRoot ?? workspaceRoot ?? requested;
  const kind: WorkspaceActivityScopeKind =
    workspaceRoot || linkedWorkspace
      ? 'workspace'
      : projectRoot && projectMetadataCandidates(projectRoot, 'project.json').some(exists)
        ? 'project'
        : 'ephemeral-project';
  const id = stableLocalScopeId(kind, rootPath);
  const stateHome = resolveActivityStateHome(options.env);
  const statePath = path.join(stateHome, stableChannelId(observationRootPath));
  const workspaceStatePath = path.join(stateHome, stableChannelId(rootPath));

  return {
    rootPath,
    observationRootPath,
    statePath,
    mirrorStatePaths: workspaceStatePath === statePath ? [] : [workspaceStatePath],
    scope: {
      kind,
      id,
      label: path.basename(rootPath) || 'project',
      portable: false,
    },
  };
}

export function resolveActivityOrigin(
  resolvedScope: ResolvedActivityScope
): WorkspaceActivityOrigin {
  const workspaceRoot = path.resolve(resolvedScope.rootPath);
  const observationRoot = path.resolve(resolvedScope.observationRootPath);
  return {
    id: stableLocalScopeId('project', observationRoot),
    kind: observationRoot === workspaceRoot ? 'workspace-root' : 'project',
    label: path.basename(observationRoot) || resolvedScope.scope.label,
  };
}

export function toActivityLocator(rootPath: string, targetPath: string): string {
  const absolute = path.resolve(targetPath);
  const relative = path.relative(path.resolve(rootPath), absolute);
  if (relative === '') return '.';
  if (!relative.startsWith('..') && !path.isAbsolute(relative))
    return relative.replaceAll('\\', '/');
  return `<external>/${path.basename(absolute)}`;
}
