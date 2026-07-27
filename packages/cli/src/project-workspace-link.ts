import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fsExtra from 'fs-extra';

import { getWorkspaceRegistryFileCandidates } from './utils/platform-capabilities.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { normalizeRegistryPath } from './utils/registry-path.js';
import {
  PROJECT_WORKSPACE_LINK_FILE,
  PROJECT_WORKSPACE_LINK_RELATIVE_PATH,
  WORKSPAI_METADATA_DIR,
  hasWorkspaceRootMarkers,
  projectMetadataCandidates,
  projectMetadataPath,
} from './utils/workspace-paths.js';

export const PROJECT_WORKSPACE_LINK_SCHEMA_VERSION = 'project-workspace-link.v1';
export const PROJECT_WORKSPACE_LINK_KIND = 'workspai.project-workspace-link';

export type ProjectWorkspaceRelationship =
  'managed' | 'adopted' | 'imported' | 'linked' | 'restored';

export type ProjectWorkspaceResolutionSource = 'explicit' | 'parent' | 'local-link' | 'registry';

export interface ProjectWorkspaceLink {
  schemaVersion: typeof PROJECT_WORKSPACE_LINK_SCHEMA_VERSION;
  kind: typeof PROJECT_WORKSPACE_LINK_KIND;
  generatedAt: string;
  state: 'active';
  workspace: {
    name: string;
    root: string;
    marker: '.workspai-workspace' | '.workspai/workspace.json';
    contract: '.workspai/workspace.contract.json';
  };
  project: {
    name: string;
    relativePath: string;
    relationship: ProjectWorkspaceRelationship;
  };
  integrity: {
    algorithm: 'sha256';
    binding: string;
  };
}

export interface ResolvedProjectWorkspace {
  workspacePath: string;
  projectPath: string | null;
  source: ProjectWorkspaceResolutionSource;
  linkPath: string | null;
  recovered: boolean;
}

export type ProjectWorkspaceResolutionErrorCode =
  | 'project.workspace.explicit-invalid'
  | 'project.workspace.membership-missing'
  | 'project.workspace.link-invalid'
  | 'project.workspace.link-stale'
  | 'project.workspace.ambiguous'
  | 'project.workspace.unlinked';

export class ProjectWorkspaceResolutionError extends Error {
  constructor(
    public readonly code: ProjectWorkspaceResolutionErrorCode,
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ProjectWorkspaceResolutionError';
  }
}

interface RegistryProject {
  name?: unknown;
  path?: unknown;
}

interface RegistryWorkspace {
  name?: unknown;
  path?: unknown;
  projects?: unknown;
}

interface RegistryPayload {
  workspaces?: unknown;
}

interface ResolveProjectWorkspaceOptions {
  startPath: string;
  explicitWorkspacePath?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  strict?: boolean;
  requireProjectMembership?: boolean;
}

function markerFor(workspacePath: string): ProjectWorkspaceLink['workspace']['marker'] {
  return fs.existsSync(path.join(workspacePath, '.workspai-workspace'))
    ? '.workspai-workspace'
    : '.workspai/workspace.json';
}

function bindingFor(input: {
  workspaceName: string;
  workspacePath: string;
  projectName: string;
  projectPath: string;
  relativePath: string;
  relationship: ProjectWorkspaceRelationship;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      [
        input.workspaceName,
        normalizeRegistryPath(input.workspacePath),
        input.projectName,
        normalizeRegistryPath(input.projectPath),
        input.relativePath.replace(/\\/g, '/'),
        input.relationship,
      ].join('\0')
    )
    .digest('hex');
}

function findParentWorkspace(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (hasWorkspaceRootMarkers(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findProjectRootUp(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (
      [
        ...projectMetadataCandidates(current, 'project.json'),
        ...projectMetadataCandidates(current, 'context.json'),
      ].some((candidate) => fs.existsSync(candidate))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJsonSync(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function parseProjectWorkspaceLink(filePath: string): ProjectWorkspaceLink {
  const payload = readJsonSync(filePath);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProjectWorkspaceResolutionError(
      'project.workspace.link-invalid',
      `Project workspace link is not a JSON object: ${filePath}`,
      { linkPath: filePath }
    );
  }
  const value = payload as Partial<ProjectWorkspaceLink>;
  if (
    value.schemaVersion !== PROJECT_WORKSPACE_LINK_SCHEMA_VERSION ||
    value.kind !== PROJECT_WORKSPACE_LINK_KIND ||
    value.state !== 'active' ||
    !value.workspace ||
    typeof value.workspace.name !== 'string' ||
    value.workspace.name.trim().length === 0 ||
    typeof value.workspace.root !== 'string' ||
    !path.isAbsolute(value.workspace.root) ||
    !['.workspai-workspace', '.workspai/workspace.json'].includes(value.workspace.marker ?? '') ||
    value.workspace.contract !== '.workspai/workspace.contract.json' ||
    !value.project ||
    typeof value.project.name !== 'string' ||
    value.project.name.trim().length === 0 ||
    typeof value.project.relativePath !== 'string' ||
    path.isAbsolute(value.project.relativePath) ||
    value.project.relativePath.split(/[\\/]/).includes('..') ||
    !['managed', 'adopted', 'imported', 'linked', 'restored'].includes(
      value.project.relationship ?? ''
    ) ||
    !value.integrity ||
    value.integrity.algorithm !== 'sha256' ||
    typeof value.integrity.binding !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.integrity.binding)
  ) {
    throw new ProjectWorkspaceResolutionError(
      'project.workspace.link-invalid',
      `Project workspace link does not satisfy ${PROJECT_WORKSPACE_LINK_SCHEMA_VERSION}: ${filePath}`,
      { linkPath: filePath }
    );
  }
  try {
    assertJsonSchemaContract(
      payload,
      'contracts/project-workspace-link.v1.json',
      'Project workspace link'
    );
  } catch (error) {
    throw new ProjectWorkspaceResolutionError(
      'project.workspace.link-invalid',
      `Project workspace link does not satisfy ${PROJECT_WORKSPACE_LINK_SCHEMA_VERSION}: ${filePath}`,
      {
        linkPath: filePath,
        validationError: error instanceof Error ? error.message : String(error),
      }
    );
  }
  return value as ProjectWorkspaceLink;
}

function projectBelongsToContract(workspacePath: string, projectPath: string): boolean | null {
  const contractPath = path.join(workspacePath, '.workspai', 'workspace.contract.json');
  if (!fs.existsSync(contractPath)) return null;
  try {
    const payload = readJsonSync(contractPath) as {
      projects?: Array<{ relativePath?: unknown; externalPath?: unknown }>;
    };
    if (!Array.isArray(payload.projects)) return false;
    const normalizedProject = normalizeRegistryPath(projectPath);
    return payload.projects.some((project) => {
      if (typeof project.externalPath === 'string') {
        return normalizeRegistryPath(project.externalPath) === normalizedProject;
      }
      if (
        typeof project.relativePath !== 'string' ||
        project.relativePath.startsWith('external/')
      ) {
        return false;
      }
      return (
        normalizeRegistryPath(path.resolve(workspacePath, project.relativePath)) ===
        normalizedProject
      );
    });
  } catch {
    return false;
  }
}

function registryWorkspaceCandidates(
  projectPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Array<{ name: string; path: string }> {
  const project = normalizeRegistryPath(projectPath);
  const candidates = new Map<string, { name: string; path: string }>();
  for (const registryFile of getWorkspaceRegistryFileCandidates(env, platform)) {
    if (!fs.existsSync(registryFile)) continue;
    let payload: RegistryPayload;
    try {
      payload = readJsonSync(registryFile) as RegistryPayload;
    } catch {
      continue;
    }
    if (!Array.isArray(payload.workspaces)) continue;
    for (const rawWorkspace of payload.workspaces as RegistryWorkspace[]) {
      if (
        !rawWorkspace ||
        typeof rawWorkspace.name !== 'string' ||
        typeof rawWorkspace.path !== 'string' ||
        !Array.isArray(rawWorkspace.projects)
      ) {
        continue;
      }
      const matches = (rawWorkspace.projects as RegistryProject[]).some(
        (rawProject) =>
          rawProject &&
          typeof rawProject.path === 'string' &&
          normalizeRegistryPath(rawProject.path) === project
      );
      if (!matches) continue;
      const workspacePath = normalizeRegistryPath(rawWorkspace.path);
      if (!hasWorkspaceRootMarkers(workspacePath)) continue;
      const contractMembership = projectBelongsToContract(workspacePath, projectPath);
      if (contractMembership !== true) continue;
      candidates.set(workspacePath, { name: rawWorkspace.name, path: workspacePath });
    }
  }
  return [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function strictOrNull(
  strict: boolean,
  error: ProjectWorkspaceResolutionError
): ResolvedProjectWorkspace | null {
  if (strict) throw error;
  return null;
}

/**
 * Resolve the canonical workspace for a command launched from a project.
 *
 * Precedence is deliberately stable:
 * explicit --workspace > parent workspace > machine-local project link >
 * reverse registry lookup. Ambiguity and stale links never silently select a
 * workspace in strict mode.
 */
export function resolveProjectWorkspaceSync(
  options: ResolveProjectWorkspaceOptions
): ResolvedProjectWorkspace | null {
  const strict = options.strict === true;
  const startPath = path.resolve(options.startPath);
  const explicit = options.explicitWorkspacePath
    ? path.resolve(options.explicitWorkspacePath)
    : null;
  const projectPath = findProjectRootUp(startPath);

  if (explicit) {
    if (!hasWorkspaceRootMarkers(explicit)) {
      return strictOrNull(
        strict,
        new ProjectWorkspaceResolutionError(
          'project.workspace.explicit-invalid',
          `Explicit workspace path is not a Workspai workspace: ${explicit}`,
          { workspacePath: explicit, projectPath }
        )
      );
    }
    if (
      options.requireProjectMembership === true &&
      projectPath &&
      projectBelongsToContract(explicit, projectPath) !== true
    ) {
      return strictOrNull(
        strict,
        new ProjectWorkspaceResolutionError(
          'project.workspace.membership-missing',
          `Project is not registered in the explicit workspace contract: ${explicit}`,
          { workspacePath: explicit, projectPath }
        )
      );
    }
    return {
      workspacePath: explicit,
      projectPath,
      source: 'explicit',
      linkPath: projectPath ? projectMetadataPath(projectPath, PROJECT_WORKSPACE_LINK_FILE) : null,
      recovered: false,
    };
  }

  const parentWorkspace = findParentWorkspace(startPath);
  if (parentWorkspace) {
    if (
      options.requireProjectMembership === true &&
      projectPath &&
      projectBelongsToContract(parentWorkspace, projectPath) !== true
    ) {
      return strictOrNull(
        strict,
        new ProjectWorkspaceResolutionError(
          'project.workspace.membership-missing',
          `Project is not registered in its parent workspace contract: ${parentWorkspace}`,
          { workspacePath: parentWorkspace, projectPath }
        )
      );
    }
    return {
      workspacePath: parentWorkspace,
      projectPath,
      source: 'parent',
      linkPath: projectPath ? projectMetadataPath(projectPath, PROJECT_WORKSPACE_LINK_FILE) : null,
      recovered: false,
    };
  }

  if (!projectPath) {
    return strictOrNull(
      strict,
      new ProjectWorkspaceResolutionError(
        'project.workspace.unlinked',
        'No Workspai project or workspace could be resolved from the current directory.',
        { startPath }
      )
    );
  }

  const linkPath = projectMetadataPath(projectPath, PROJECT_WORKSPACE_LINK_FILE);
  let staleLink: ProjectWorkspaceLink | null = null;
  if (fs.existsSync(linkPath)) {
    let link: ProjectWorkspaceLink;
    try {
      link = parseProjectWorkspaceLink(linkPath);
    } catch (error) {
      if (strict) throw error;
      return null;
    }
    const expectedBinding = bindingFor({
      workspaceName: link.workspace.name,
      workspacePath: link.workspace.root,
      projectName: link.project.name,
      projectPath,
      relativePath: link.project.relativePath,
      relationship: link.project.relationship,
    });
    const membership = projectBelongsToContract(link.workspace.root, projectPath);
    if (
      link.integrity.binding === expectedBinding &&
      hasWorkspaceRootMarkers(link.workspace.root) &&
      fs.existsSync(path.join(link.workspace.root, link.workspace.marker)) &&
      membership === true
    ) {
      return {
        workspacePath: path.resolve(link.workspace.root),
        projectPath,
        source: 'local-link',
        linkPath,
        recovered: false,
      };
    }
    staleLink = link;
  }

  const registryCandidates = registryWorkspaceCandidates(
    projectPath,
    options.env ?? process.env,
    options.platform ?? process.platform
  );
  if (registryCandidates.length > 1) {
    return strictOrNull(
      strict,
      new ProjectWorkspaceResolutionError(
        'project.workspace.ambiguous',
        `Project is registered in more than one valid workspace: ${registryCandidates
          .map((candidate) => candidate.name)
          .join(', ')}. Pass --workspace <path> or run project workspace relink.`,
        { projectPath, candidates: registryCandidates }
      )
    );
  }
  if (registryCandidates.length === 1) {
    return {
      workspacePath: registryCandidates[0].path,
      projectPath,
      source: 'registry',
      linkPath,
      recovered: staleLink !== null,
    };
  }

  if (staleLink) {
    return strictOrNull(
      strict,
      new ProjectWorkspaceResolutionError(
        'project.workspace.link-stale',
        `Project workspace link is stale and no valid registry relocation was found: ${staleLink.workspace.root}`,
        { projectPath, linkPath, linkedWorkspacePath: staleLink.workspace.root }
      )
    );
  }

  return strictOrNull(
    strict,
    new ProjectWorkspaceResolutionError(
      'project.workspace.unlinked',
      'This Workspai project is not linked to a valid workspace. Run `npx workspai adopt .` or `npx workspai project workspace relink --workspace <path>`.',
      { projectPath, linkPath }
    )
  );
}

async function writeAtomicJson(filePath: string, payload: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await fsp.rename(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fsExtra.move(temporaryPath, filePath, { overwrite: true });
    }
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function ensureProjectWorkspaceLinkIgnored(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const existing = await fsp.readFile(gitignorePath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  const normalizedLines = existing.split(/\r?\n/).map((line) => line.trim());
  if (normalizedLines.includes(PROJECT_WORKSPACE_LINK_RELATIVE_PATH)) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# Workspai machine-local workspace binding\n${PROJECT_WORKSPACE_LINK_RELATIVE_PATH}\n`;
  await fsp.writeFile(gitignorePath, `${existing}${block}`, 'utf8');
}

export async function writeProjectWorkspaceLink(input: {
  workspacePath: string;
  projectPath: string;
  projectName: string;
  relationship: ProjectWorkspaceRelationship;
  workspaceName?: string;
  relativePath?: string;
  now?: Date;
}): Promise<{ linkPath: string; link: ProjectWorkspaceLink }> {
  const workspacePath = path.resolve(input.workspacePath);
  const projectPath = path.resolve(input.projectPath);
  if (!hasWorkspaceRootMarkers(workspacePath)) {
    throw new ProjectWorkspaceResolutionError(
      'project.workspace.explicit-invalid',
      `Cannot link project to an invalid Workspai workspace: ${workspacePath}`,
      { workspacePath, projectPath }
    );
  }
  const contractPath = path.join(workspacePath, '.workspai', 'workspace.contract.json');
  let workspaceName = input.workspaceName ?? path.basename(workspacePath);
  let relativePath = input.relativePath;
  if (fs.existsSync(contractPath)) {
    const contract = readJsonSync(contractPath) as {
      workspace?: { name?: unknown };
      projects?: Array<{
        slug?: unknown;
        relativePath?: unknown;
        externalPath?: unknown;
      }>;
    };
    if (typeof contract.workspace?.name === 'string') workspaceName = contract.workspace.name;
    const normalizedProject = normalizeRegistryPath(projectPath);
    const match = contract.projects?.find((project) => {
      if (typeof project.externalPath === 'string') {
        return normalizeRegistryPath(project.externalPath) === normalizedProject;
      }
      return (
        typeof project.relativePath === 'string' &&
        !project.relativePath.startsWith('external/') &&
        normalizeRegistryPath(path.resolve(workspacePath, project.relativePath)) ===
          normalizedProject
      );
    });
    if (match && typeof match.relativePath === 'string') relativePath = match.relativePath;
  }
  relativePath ??= path.relative(workspacePath, projectPath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) {
    relativePath = `external/${input.projectName}`;
  }
  if (projectBelongsToContract(workspacePath, projectPath) !== true) {
    throw new ProjectWorkspaceResolutionError(
      'project.workspace.membership-missing',
      `Project is not registered in the canonical workspace contract: ${input.projectName}`,
      { workspacePath, projectPath, projectName: input.projectName }
    );
  }
  const link: ProjectWorkspaceLink = {
    schemaVersion: PROJECT_WORKSPACE_LINK_SCHEMA_VERSION,
    kind: PROJECT_WORKSPACE_LINK_KIND,
    generatedAt: (input.now ?? new Date()).toISOString(),
    state: 'active',
    workspace: {
      name: workspaceName,
      root: workspacePath,
      marker: markerFor(workspacePath),
      contract: '.workspai/workspace.contract.json',
    },
    project: {
      name: input.projectName,
      relativePath,
      relationship: input.relationship,
    },
    integrity: {
      algorithm: 'sha256',
      binding: bindingFor({
        workspaceName,
        workspacePath,
        projectName: input.projectName,
        projectPath,
        relativePath,
        relationship: input.relationship,
      }),
    },
  };
  assertJsonSchemaContract(
    link,
    'contracts/project-workspace-link.v1.json',
    'Project workspace link'
  );
  const linkPath = path.join(projectPath, WORKSPAI_METADATA_DIR, PROJECT_WORKSPACE_LINK_FILE);
  await ensureProjectWorkspaceLinkIgnored(projectPath);
  await writeAtomicJson(linkPath, link);
  return { linkPath, link };
}

export async function repairProjectWorkspaceLink(
  resolution: ResolvedProjectWorkspace,
  relationship: ProjectWorkspaceRelationship = 'linked'
): Promise<{ linkPath: string; link: ProjectWorkspaceLink } | null> {
  if (!resolution.projectPath) return null;
  const projectJsonPath = projectMetadataCandidates(resolution.projectPath, 'project.json').find(
    (candidate) => fs.existsSync(candidate)
  );
  let projectName = path.basename(resolution.projectPath);
  if (projectJsonPath) {
    try {
      const projectJson = readJsonSync(projectJsonPath) as { name?: unknown; slug?: unknown };
      if (typeof projectJson.name === 'string') projectName = projectJson.name;
      else if (typeof projectJson.slug === 'string') projectName = projectJson.slug;
    } catch {
      // Link repair remains possible when non-essential display metadata is malformed.
    }
  }
  return writeProjectWorkspaceLink({
    workspacePath: resolution.workspacePath,
    projectPath: resolution.projectPath,
    projectName,
    relationship,
  });
}
