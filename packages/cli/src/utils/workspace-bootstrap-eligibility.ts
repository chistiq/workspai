import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  hasWorkspaceRootMarkers,
  LEGACY_RAPIDKIT_METADATA_DIR,
  WORKSPAI_METADATA_DIR,
} from './workspace-paths.js';

export type WorkspaceBootstrapAssessment =
  | { status: 'valid-workspace' }
  | { status: 'eligible'; reason: 'empty' | 'single-project-container' }
  | { status: 'not-clean'; conflicts: string[] };

async function hasPartialWorkspaceMetadata(directoryPath: string): Promise<string | null> {
  for (const metadataDirectory of [WORKSPAI_METADATA_DIR, LEGACY_RAPIDKIT_METADATA_DIR]) {
    const metadataPath = path.join(directoryPath, metadataDirectory);
    const metadata = await fsExtra.lstat(metadataPath).catch(() => null);
    if (!metadata) continue;
    if (metadata.isSymbolicLink()) {
      return `${metadataDirectory}/ (symbolic link)`;
    }
    if (!metadata.isDirectory()) {
      return `${metadataDirectory} (not a directory)`;
    }
    if (!hasWorkspaceRootMarkers(directoryPath)) {
      return `${metadataDirectory}/ (partial workspace metadata without root marker)`;
    }
  }
  return null;
}

export async function assessWorkspaceBootstrapEligibility(
  targetPath: string,
  options: { containedProjectPath?: string } = {}
): Promise<WorkspaceBootstrapAssessment> {
  const resolvedTargetPath = path.resolve(targetPath);
  const rootStats = await fsExtra.lstat(resolvedTargetPath).catch(() => null);
  if (!rootStats) {
    return { status: 'not-clean', conflicts: ['path does not exist'] };
  }
  if (rootStats.isSymbolicLink()) {
    return { status: 'not-clean', conflicts: ['path is a symbolic link'] };
  }
  if (!rootStats.isDirectory()) {
    return { status: 'not-clean', conflicts: ['path is not a directory'] };
  }

  if (hasWorkspaceRootMarkers(resolvedTargetPath)) {
    return { status: 'valid-workspace' };
  }

  const partialMetadataConflict = await hasPartialWorkspaceMetadata(resolvedTargetPath);
  if (partialMetadataConflict) {
    return { status: 'not-clean', conflicts: [partialMetadataConflict] };
  }

  const entries = await fsExtra.readdir(resolvedTargetPath, { withFileTypes: true });
  if (entries.length === 0) {
    return { status: 'eligible', reason: 'empty' };
  }

  const containedProjectPath = options.containedProjectPath
    ? path.resolve(options.containedProjectPath)
    : null;
  const isDirectContainedProject =
    containedProjectPath !== null && path.dirname(containedProjectPath) === resolvedTargetPath;
  if (isDirectContainedProject && entries.length === 1) {
    const [entry] = entries;
    if (
      entry.name === path.basename(containedProjectPath) &&
      entry.isDirectory() &&
      !entry.isSymbolicLink()
    ) {
      return { status: 'eligible', reason: 'single-project-container' };
    }
  }

  return {
    status: 'not-clean',
    conflicts: entries.map((entry) =>
      entry.isDirectory()
        ? `${entry.name}/`
        : entry.isSymbolicLink()
          ? `${entry.name} (symbolic link)`
          : entry.name
    ),
  };
}

export function isReasonableWorkspaceParent(parentPath: string): boolean {
  const resolvedParentPath = path.resolve(parentPath);
  const filesystemRoot = path.parse(resolvedParentPath).root;
  return resolvedParentPath !== filesystemRoot;
}

export function formatWorkspaceBootstrapConflictMessage(
  targetPath: string,
  assessment: Extract<WorkspaceBootstrapAssessment, { status: 'not-clean' }>
): string {
  const preview = assessment.conflicts.slice(0, 5).join(', ');
  const suffix =
    assessment.conflicts.length > 5 ? ` (+${assessment.conflicts.length - 5} more)` : '';
  return `Workspace path is not a valid Workspai workspace and is not clean enough to bootstrap: ${targetPath}. Conflicts: ${preview}${suffix}`;
}
