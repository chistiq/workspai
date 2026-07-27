import fs from 'fs';
import { homedir } from 'os';
import path from 'path';

export const WORKSPAI_METADATA_DIR = '.workspai';
export const LEGACY_RAPIDKIT_METADATA_DIR = '.rapidkit';
export const WORKSPAI_WORKSPACE_MARKER = '.workspai-workspace';
export const LEGACY_RAPIDKIT_WORKSPACE_MARKER = '.rapidkit-workspace';
export const PROJECT_WORKSPACE_LINK_FILE = 'workspace-link.local.json';
export const PROJECT_GROUNDING_FILE = 'PROJECT-GROUNDING.md';
export const PROJECT_CONTEXT_AGENT_REPORT_FILE = 'project-context-agent.json';

export const PROJECT_WORKSPACE_LINK_RELATIVE_PATH = `${WORKSPAI_METADATA_DIR}/${PROJECT_WORKSPACE_LINK_FILE}`;
export const PROJECT_GROUNDING_RELATIVE_PATH = `${WORKSPAI_METADATA_DIR}/${PROJECT_GROUNDING_FILE}`;
export const PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH = `${WORKSPAI_METADATA_DIR}/reports/${PROJECT_CONTEXT_AGENT_REPORT_FILE}`;

export const MANAGED_DEFAULT_WORKSPACE_NAME = 'workspai';
export const MANAGED_DEFAULT_WORKSPACE_LABEL = 'Workspai';

/** @deprecated Use MANAGED_DEFAULT_WORKSPACE_NAME */
export const DEFAULT_IMPORT_WORKSPACE_NAME = MANAGED_DEFAULT_WORKSPACE_NAME;

/** @deprecated Use MANAGED_DEFAULT_WORKSPACE_LABEL */
export const DEFAULT_IMPORT_WORKSPACE_LABEL = MANAGED_DEFAULT_WORKSPACE_LABEL;

export function hasWorkspaceRootMarkers(workspacePath: string): boolean {
  return (
    fs.existsSync(path.join(workspacePath, WORKSPAI_WORKSPACE_MARKER)) ||
    fs.existsSync(path.join(workspacePath, LEGACY_RAPIDKIT_WORKSPACE_MARKER)) ||
    fs.existsSync(path.join(workspacePath, WORKSPAI_METADATA_DIR, 'workspace.json')) ||
    fs.existsSync(path.join(workspacePath, LEGACY_RAPIDKIT_METADATA_DIR, 'workspace.json'))
  );
}

/** @deprecated Use hasWorkspaceRootMarkers */
export const hasManagedDefaultWorkspaceMarkers = hasWorkspaceRootMarkers;

export function getCanonicalWorkspacesDirectory(homeDir: string = homedir()): string {
  return path.join(homeDir, '.workspai', 'workspaces');
}

export function getLegacyWorkspacesDirectory(homeDir: string = homedir()): string {
  return path.join(homeDir, 'rapidkit', 'workspaces');
}

export function getClassicWorkspacesDirectory(homeDir: string = homedir()): string {
  return path.join(homeDir, 'Workspai', 'rapidkits');
}

export function resolveCanonicalWorkspacePath(
  workspaceName: string,
  homeDir: string = homedir()
): string {
  return path.join(getCanonicalWorkspacesDirectory(homeDir), workspaceName);
}

export function getKnownWorkspaceLocationCandidates(
  workspaceName: string,
  homeDir: string = homedir()
): string[] {
  return [
    resolveCanonicalWorkspacePath(workspaceName, homeDir),
    path.join(getLegacyWorkspacesDirectory(homeDir), workspaceName),
    path.join(getClassicWorkspacesDirectory(homeDir), workspaceName),
  ];
}

export function resolveNewWorkspacePath(
  workspaceName: string,
  options: { homeDir?: string; outputDir?: string } = {}
): string {
  const homeDir = options.homeDir ?? homedir();
  if (options.outputDir) {
    return path.resolve(options.outputDir, workspaceName);
  }
  return resolveCanonicalWorkspacePath(workspaceName, homeDir);
}

export function findExistingWorkspacePath(
  workspaceName: string,
  homeDir: string = homedir()
): string | undefined {
  for (const candidate of getKnownWorkspaceLocationCandidates(workspaceName, homeDir)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveAvailableWorkspaceSlot(
  parentDirectory: string,
  baseName = 'my-workspace'
): { name: string; targetPath: string } {
  let index = 1;

  while (true) {
    const name = index === 1 ? baseName : `${baseName}-${index}`;
    const targetPath = path.join(parentDirectory, name);
    if (!fs.existsSync(targetPath)) {
      return { name, targetPath };
    }
    index += 1;
  }
}

export function getManagedDefaultWorkspaceCandidates(homeDir: string = homedir()): string[] {
  return [
    path.join(getCanonicalWorkspacesDirectory(homeDir), MANAGED_DEFAULT_WORKSPACE_NAME),
    path.join(getLegacyWorkspacesDirectory(homeDir), MANAGED_DEFAULT_WORKSPACE_NAME),
    path.join(getClassicWorkspacesDirectory(homeDir), MANAGED_DEFAULT_WORKSPACE_NAME),
  ];
}

export function resolveManagedDefaultImportWorkspacePath(homeDir: string = homedir()): string {
  for (const candidate of getManagedDefaultWorkspaceCandidates(homeDir)) {
    if (hasWorkspaceRootMarkers(candidate)) {
      return candidate;
    }
  }

  return resolveCanonicalWorkspacePath(MANAGED_DEFAULT_WORKSPACE_NAME, homeDir);
}

export function isLegacyWorkspacePath(workspacePath: string, homeDir: string = homedir()): boolean {
  const resolvedPath = path.resolve(workspacePath);
  for (const legacyParent of [
    getLegacyWorkspacesDirectory(homeDir),
    getClassicWorkspacesDirectory(homeDir),
  ]) {
    const relativePath = path.relative(legacyParent, resolvedPath);
    if (
      relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath)
    ) {
      return true;
    }
  }
  return false;
}

export function isCanonicalWorkspacePath(
  workspacePath: string,
  homeDir: string = homedir()
): boolean {
  const canonicalParent = getCanonicalWorkspacesDirectory(homeDir);
  const relativePath = path.relative(canonicalParent, path.resolve(workspacePath));
  return (
    relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
  );
}

export function workspaceMetadataPath(workspacePath: string, ...segments: string[]): string {
  return path.join(workspacePath, WORKSPAI_METADATA_DIR, ...segments);
}

export function legacyWorkspaceMetadataPath(workspacePath: string, ...segments: string[]): string {
  return path.join(workspacePath, LEGACY_RAPIDKIT_METADATA_DIR, ...segments);
}

export function workspaceMarkerPath(workspacePath: string): string {
  return path.join(workspacePath, WORKSPAI_WORKSPACE_MARKER);
}

export function legacyWorkspaceMarkerPath(workspacePath: string): string {
  return path.join(workspacePath, LEGACY_RAPIDKIT_WORKSPACE_MARKER);
}

export function workspaceMetadataCandidates(
  workspacePath: string,
  ...segments: string[]
): string[] {
  return [
    workspaceMetadataPath(workspacePath, ...segments),
    legacyWorkspaceMetadataPath(workspacePath, ...segments),
  ];
}

export function projectMetadataCandidates(projectPath: string, fileName: string): string[] {
  return [
    path.join(projectPath, WORKSPAI_METADATA_DIR, fileName),
    path.join(projectPath, LEGACY_RAPIDKIT_METADATA_DIR, fileName),
  ];
}

export function projectMetadataPath(projectPath: string, fileName: string): string {
  return path.join(projectPath, WORKSPAI_METADATA_DIR, fileName);
}

export function legacyProjectMetadataPath(projectPath: string, fileName: string): string {
  return path.join(projectPath, LEGACY_RAPIDKIT_METADATA_DIR, fileName);
}

export function toWorkspaiArtifactPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === LEGACY_RAPIDKIT_WORKSPACE_MARKER) {
    return WORKSPAI_WORKSPACE_MARKER;
  }
  return relativePath
    .split(/[\\/]/g)
    .map((segment) => (segment === LEGACY_RAPIDKIT_METADATA_DIR ? WORKSPAI_METADATA_DIR : segment))
    .join('/');
}

export function toLegacyRapidkitArtifactPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === WORKSPAI_WORKSPACE_MARKER) {
    return LEGACY_RAPIDKIT_WORKSPACE_MARKER;
  }
  return relativePath
    .split(/[\\/]/g)
    .map((segment) => (segment === WORKSPAI_METADATA_DIR ? LEGACY_RAPIDKIT_METADATA_DIR : segment))
    .join('/');
}
