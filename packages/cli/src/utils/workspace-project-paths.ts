import path from 'path';
import fsExtra from 'fs-extra';

import { workspaceMetadataCandidates } from './workspace-paths.js';

export function toPosixWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/');
}

export function normalizeWorkspaceProjectSlug(raw: string, fallback: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

export function isWorkspaceExternalProjectPath(
  workspacePath: string,
  projectPath: string
): boolean {
  const relative = toPosixWorkspacePath(path.relative(workspacePath, projectPath));
  if (!relative || relative.startsWith('..')) {
    return true;
  }
  return relative
    .split('/')
    .filter(Boolean)
    .some((segment) => segment === '..');
}

export function resolveWorkspaceProjectPaths(input: {
  workspacePath: string;
  projectPath: string;
  projectName: string;
}): {
  relativePath: string;
  contractRelativePath: string;
  isExternal: boolean;
} {
  const discoveredRelativePath = toPosixWorkspacePath(
    path.relative(input.workspacePath, input.projectPath)
  );
  const isExternal = isWorkspaceExternalProjectPath(input.workspacePath, input.projectPath);
  const slug = normalizeWorkspaceProjectSlug(input.projectName, path.basename(input.projectPath));
  const contractRelativePath = isExternal ? `external/${slug}` : discoveredRelativePath || slug;

  return {
    relativePath: discoveredRelativePath || contractRelativePath,
    contractRelativePath,
    isExternal,
  };
}

export function isPortableExternalProjectIdentity(relativePath: string): boolean {
  const normalized = toPosixWorkspacePath(relativePath).replace(/^\.\//, '');
  return normalized === 'external' || normalized.startsWith('external/');
}

export function isLeakedWorkspaceRelativePath(relativePath: string): boolean {
  const normalized = toPosixWorkspacePath(relativePath).replace(/^\.\//, '');
  return (
    path.isAbsolute(relativePath) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  );
}

export function publishableWorkspaceProjectIdentity(input: {
  workspacePath: string;
  projectPath: string;
  projectName: string;
  declaredRelativePath?: string;
}): string {
  const discovered = resolveWorkspaceProjectPaths({
    workspacePath: input.workspacePath,
    projectPath: input.projectPath,
    projectName: input.projectName,
  });
  const declared = input.declaredRelativePath?.trim();
  if (!declared || isLeakedWorkspaceRelativePath(declared)) {
    return discovered.contractRelativePath;
  }
  return toPosixWorkspacePath(declared).replace(/^\.\//, '') || discovered.contractRelativePath;
}

export function workspaceProjectScopeIdentities(input: {
  workspacePath: string;
  projectPath: string;
  declaredName?: string | null;
}): string[] {
  const basename = path.basename(input.projectPath);
  const declaredName = input.declaredName?.trim() || undefined;
  const discovered = resolveWorkspaceProjectPaths({
    workspacePath: input.workspacePath,
    projectPath: input.projectPath,
    projectName: declaredName || basename,
  });
  return uniqueNonEmpty([
    discovered.relativePath,
    discovered.contractRelativePath,
    basename,
    declaredName,
    isPortableExternalProjectIdentity(discovered.contractRelativePath)
      ? discovered.contractRelativePath.slice('external/'.length)
      : undefined,
  ]);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

type RegisteredProjectLocation = {
  relativePath?: string;
  name?: string;
  slug?: string;
  path?: string;
  externalPath?: string;
};

function readJsonObjectSync(filePath: string): Record<string, unknown> | null {
  try {
    if (!fsExtra.pathExistsSync(filePath)) {
      return null;
    }
    const raw: unknown = fsExtra.readJsonSync(filePath);
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function firstExistingMetadataFile(workspacePath: string, fileName: string): string | null {
  for (const candidate of workspaceMetadataCandidates(workspacePath, fileName)) {
    if (fsExtra.pathExistsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function collectRegisteredProjectLocations(workspacePath: string): RegisteredProjectLocation[] {
  const located: RegisteredProjectLocation[] = [];
  const contractFile = firstExistingMetadataFile(workspacePath, 'workspace.contract.json');
  const contract = contractFile ? readJsonObjectSync(contractFile) : null;
  const contractProjects = Array.isArray(contract?.projects) ? contract.projects : [];
  for (const project of contractProjects) {
    if (!project || typeof project !== 'object') continue;
    const record = project as Record<string, unknown>;
    located.push({
      relativePath: typeof record.relativePath === 'string' ? record.relativePath : undefined,
      slug: typeof record.slug === 'string' ? record.slug : undefined,
      externalPath: typeof record.externalPath === 'string' ? record.externalPath : undefined,
    });
  }
  const registryFile = firstExistingMetadataFile(workspacePath, 'imported-projects.json');
  const registry = registryFile ? readJsonObjectSync(registryFile) : null;
  const registryProjects = Array.isArray(registry?.projects) ? registry.projects : [];
  for (const project of registryProjects) {
    if (!project || typeof project !== 'object') continue;
    const record = project as Record<string, unknown>;
    located.push({
      relativePath: typeof record.relativePath === 'string' ? record.relativePath : undefined,
      name: typeof record.name === 'string' ? record.name : undefined,
      path: typeof record.path === 'string' ? record.path : undefined,
    });
  }
  return located;
}

function registeredProjectIdentityTokens(location: RegisteredProjectLocation): string[] {
  const tokens: string[] = [];
  if (location.relativePath) {
    const posix = toPosixWorkspacePath(location.relativePath);
    tokens.push(posix);
    if (isPortableExternalProjectIdentity(posix)) {
      tokens.push(posix.slice('external/'.length));
    }
    const base = posix
      .split('/')
      .filter((segment) => segment && segment !== '..')
      .pop();
    if (base) tokens.push(base);
  }
  if (location.slug) tokens.push(location.slug);
  if (location.name) tokens.push(location.name);
  return uniqueNonEmpty(tokens);
}

function identityMatchesRegisteredProject(
  location: RegisteredProjectLocation,
  identity: string
): boolean {
  const posix = toPosixWorkspacePath(identity).replace(/^\.\//, '');
  const slug = isPortableExternalProjectIdentity(posix) ? posix.slice('external/'.length) : posix;
  const tokens = new Set(registeredProjectIdentityTokens(location));
  return tokens.has(posix) || tokens.has(slug);
}

export function resolveWorkspaceProjectFilesystemPath(
  workspacePath: string,
  projectIdentityOrPath: string,
  options: { absolutePath?: string } = {}
): string {
  if (options.absolutePath?.trim()) {
    return path.isAbsolute(options.absolutePath)
      ? path.resolve(options.absolutePath)
      : path.resolve(workspacePath, options.absolutePath);
  }
  const raw = projectIdentityOrPath.trim();
  if (!raw) {
    return path.resolve(workspacePath);
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  const posix = toPosixWorkspacePath(raw);
  if (posix === '..' || posix.startsWith('../')) {
    return path.resolve(workspacePath, raw);
  }
  if (isPortableExternalProjectIdentity(posix)) {
    for (const location of collectRegisteredProjectLocations(workspacePath)) {
      if (!identityMatchesRegisteredProject(location, posix)) continue;
      const filesystemPath = location.externalPath || location.path;
      if (typeof filesystemPath === 'string' && filesystemPath.trim()) {
        return path.isAbsolute(filesystemPath)
          ? path.resolve(filesystemPath)
          : path.resolve(workspacePath, filesystemPath);
      }
    }
  }
  return path.resolve(workspacePath, raw);
}
