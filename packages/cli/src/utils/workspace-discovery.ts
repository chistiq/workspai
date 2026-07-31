import { promises as fs } from 'fs';
import path from 'path';
import {
  LEGACY_RAPIDKIT_METADATA_DIR,
  WORKSPAI_METADATA_DIR,
  hasWorkspaceRootMarkers,
  projectMetadataCandidates,
} from './workspace-paths.js';
import { isPythonVirtualEnvironmentDirectory } from './workspace-scan-policy.js';

export interface WorkspaceDiscoveryOptions {
  skipDirs?: Set<string>;
  includeHiddenDirs?: boolean;
  descendIntoMatchedProjects?: boolean;
  isProjectDir?: (dirPath: string, rootPath: string) => Promise<boolean>;
}

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  'htmlcov',
  '.workspai',
  '.rapidkit',
  '.venv',
]);

function shouldSkipDirectory(dirName: string, skipDirs: Set<string>): boolean {
  if (skipDirs.has(dirName) || isPythonVirtualEnvironmentDirectory(dirName)) {
    return true;
  }

  const lowerName = dirName.toLowerCase();
  if (lowerName === 'dist' || lowerName.startsWith('dist-') || lowerName.startsWith('dist_')) {
    return true;
  }

  if (lowerName === 'build' || lowerName.startsWith('build-') || lowerName.startsWith('build_')) {
    return true;
  }

  return false;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function defaultIsProjectDir(dirPath: string): Promise<boolean> {
  for (const candidate of projectMetadataCandidates(dirPath, 'context.json')) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  for (const candidate of projectMetadataCandidates(dirPath, 'project.json')) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

export async function discoverWorkspaceProjects(
  workspacePath: string,
  options?: WorkspaceDiscoveryOptions
): Promise<string[]> {
  const discovered: string[] = [];
  const queue = [path.resolve(workspacePath)];
  const visited = new Set<string>();
  const skipDirs = options?.skipDirs ?? DEFAULT_SKIP_DIRS;
  const includeHiddenDirs = options?.includeHiddenDirs === true;
  const descendIntoMatched = options?.descendIntoMatchedProjects !== false;
  const isProjectDir = options?.isProjectDir ?? defaultIsProjectDir;
  const rootPath = path.resolve(workspacePath);

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath || visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    if (currentPath !== rootPath && hasWorkspaceRootMarkers(currentPath)) {
      continue;
    }

    if (await isProjectDir(currentPath, rootPath)) {
      discovered.push(currentPath);
      if (!descendIntoMatched) {
        continue;
      }
    }

    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!includeHiddenDirs && entry.name.startsWith('.')) {
        continue;
      }
      if (shouldSkipDirectory(entry.name, skipDirs)) {
        continue;
      }
      if (entry.name === WORKSPAI_METADATA_DIR || entry.name === LEGACY_RAPIDKIT_METADATA_DIR) {
        continue;
      }
      queue.push(path.join(currentPath, entry.name));
    }
  }

  return discovered.sort((a, b) => a.localeCompare(b));
}
