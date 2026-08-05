import path from 'path';
import { existsSync } from 'fs';
import fsExtra from 'fs-extra';

import {
  getWorkspaceRegistryDirectory,
  getWorkspaceRegistryFileCandidates,
} from './platform-capabilities.js';
import { normalizeRegistryPath } from './registry-path.js';
import {
  readWorkspaceContract,
  WORKSPACE_CONTRACT_PATH,
  type WorkspaceContract,
  type WorkspaceContractProject,
} from './workspace-contract.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './artifact-path-compat.js';
import { workspaceMetadataCandidates } from './workspace-paths.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

export const WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH =
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceRegistry;
export const WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceRegistry.schemaVersion;

export type WorkspaceRegistryAuthority =
  'workspace.contract.json' | 'global-registry' | 'legacy-workspace.json' | 'none';

export interface WorkspaceRegistrySummaryProject {
  slug: string;
  relativePath: string;
  framework?: string;
  kit?: string;
  source?: string;
}

export interface WorkspaceRegistrySourceSnapshot {
  exists: boolean;
  projectCount: number;
  path?: string;
}

export interface WorkspaceRegistrySummary {
  schemaVersion: typeof WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION;
  kind: 'rapidkit.workspace.registry';
  generatedAt: string;
  workspacePath: string;
  workspaceName: string;
  profile?: string;
  projectCount: number;
  authority: WorkspaceRegistryAuthority;
  contractPath: string;
  registrySummaryPath: string;
  projects: WorkspaceRegistrySummaryProject[];
  sources: {
    contract: WorkspaceRegistrySourceSnapshot;
    globalRegistry: WorkspaceRegistrySourceSnapshot;
    legacyWorkspaceJson: WorkspaceRegistrySourceSnapshot;
  };
}

interface WorkspaceRegistryEntry {
  name: string;
  path: string;
  projects?: Array<{ name: string; path: string }>;
}

interface GlobalWorkspaceRegistry {
  workspaces: WorkspaceRegistryEntry[];
}

function mapContractProject(project: WorkspaceContractProject): WorkspaceRegistrySummaryProject {
  return {
    slug: project.slug,
    relativePath: project.relativePath,
    framework: project.framework,
    kit: project.kit,
    source: project.source,
  };
}

async function readWorkspaceManifest(workspacePath: string): Promise<{
  exists: boolean;
  manifestPath?: string;
  workspaceName?: string;
  profile?: string;
  legacyProjectCount: number;
}> {
  const manifestPath = workspaceMetadataCandidates(workspacePath, 'workspace.json').find(
    (candidate) => existsSync(candidate)
  );
  if (!manifestPath) {
    return { exists: false, legacyProjectCount: 0 };
  }
  try {
    const payload = (await fsExtra.readJson(manifestPath)) as Record<string, unknown>;
    const legacyProjects = Array.isArray(payload.projects) ? payload.projects.length : 0;
    const workspaceName =
      (typeof payload.workspace_name === 'string' && payload.workspace_name.trim()) ||
      (typeof payload.name === 'string' && payload.name.trim()) ||
      path.basename(workspacePath);
    return {
      exists: true,
      manifestPath,
      workspaceName,
      profile: typeof payload.profile === 'string' ? payload.profile : undefined,
      legacyProjectCount: legacyProjects,
    };
  } catch {
    return {
      exists: true,
      manifestPath,
      legacyProjectCount: 0,
      workspaceName: path.basename(workspacePath),
    };
  }
}

async function readGlobalRegistrySnapshot(workspacePath: string): Promise<{
  exists: boolean;
  projectCount: number;
  registryPath?: string;
}> {
  const normalizedWorkspacePath = normalizeRegistryPath(workspacePath);
  for (const registryFile of getWorkspaceRegistryFileCandidates()) {
    if (!(await fsExtra.pathExists(registryFile))) {
      continue;
    }
    try {
      const parsed = (await fsExtra.readJson(registryFile)) as GlobalWorkspaceRegistry;
      const entry = (parsed.workspaces || []).find(
        (workspace) => normalizeRegistryPath(workspace.path) === normalizedWorkspacePath
      );
      if (entry) {
        return {
          exists: true,
          projectCount: Array.isArray(entry.projects) ? entry.projects.length : 0,
          registryPath: registryFile,
        };
      }
    } catch {
      continue;
    }
  }
  return {
    exists: false,
    projectCount: 0,
    registryPath: path.join(getWorkspaceRegistryDirectory(), 'workspaces.json'),
  };
}

export async function resolveWorkspaceRegisteredProjects(
  workspacePath: string,
  options?: { contract?: WorkspaceContract }
): Promise<{
  summary: Omit<WorkspaceRegistrySummary, 'generatedAt' | 'registrySummaryPath'>;
  contractExists: boolean;
}> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const contractPath = await firstExistingWorkspaceArtifactPath(
    resolvedWorkspacePath,
    WORKSPACE_CONTRACT_PATH
  );
  const manifest = await readWorkspaceManifest(resolvedWorkspacePath);
  const globalRegistry = await readGlobalRegistrySnapshot(resolvedWorkspacePath);

  const contractExists = options?.contract !== undefined || Boolean(contractPath);
  let contractProjects: WorkspaceContractProject[] = [];
  if (options?.contract) {
    contractProjects = options.contract.projects || [];
  } else if (contractExists) {
    try {
      const { contract } = await readWorkspaceContract({ workspacePath: resolvedWorkspacePath });
      contractProjects = contract.projects || [];
    } catch {
      contractProjects = [];
    }
  }

  const sources = {
    contract: {
      exists: contractExists,
      projectCount: contractProjects.length,
      path: WORKSPACE_CONTRACT_PATH,
    },
    globalRegistry: {
      exists: globalRegistry.exists,
      projectCount: globalRegistry.projectCount,
      path: globalRegistry.registryPath,
    },
    legacyWorkspaceJson: {
      exists: manifest.exists,
      projectCount: manifest.legacyProjectCount,
      path: manifest.manifestPath
        ? path.relative(resolvedWorkspacePath, manifest.manifestPath)
        : undefined,
    },
  };

  let authority: WorkspaceRegistryAuthority = 'none';
  let projects: WorkspaceRegistrySummaryProject[] = [];
  let projectCount = 0;

  if (contractExists) {
    authority = 'workspace.contract.json';
    projects = contractProjects.map(mapContractProject);
    projectCount = projects.length;
  } else if (globalRegistry.projectCount > 0) {
    authority = 'global-registry';
    projectCount = globalRegistry.projectCount;
  } else if (manifest.legacyProjectCount > 0) {
    authority = 'legacy-workspace.json';
    projectCount = manifest.legacyProjectCount;
  }

  return {
    contractExists,
    summary: {
      schemaVersion: WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION,
      kind: 'rapidkit.workspace.registry',
      workspacePath: resolvedWorkspacePath,
      workspaceName: manifest.workspaceName || path.basename(resolvedWorkspacePath),
      profile: manifest.profile,
      projectCount,
      authority,
      contractPath: WORKSPACE_CONTRACT_PATH,
      projects,
      sources,
    },
  };
}

export async function readWorkspaceRegistrySummary(
  workspacePath: string
): Promise<WorkspaceRegistrySummary | null> {
  const summaryPath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH
  );
  if (!summaryPath) {
    return null;
  }
  try {
    const payload = (await fsExtra.readJson(summaryPath)) as WorkspaceRegistrySummary;
    if (payload?.schemaVersion !== WORKSPACE_REGISTRY_SUMMARY_SCHEMA_VERSION) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function publishWorkspaceRegistrySummary(
  workspacePath: string,
  options?: { now?: Date; contract?: WorkspaceContract }
): Promise<WorkspaceRegistrySummary> {
  const summary = await buildWorkspaceRegistrySummary(workspacePath, options);
  await writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH,
    summary
  );
  return summary;
}

export async function buildWorkspaceRegistrySummary(
  workspacePath: string,
  options?: { now?: Date; contract?: WorkspaceContract }
): Promise<WorkspaceRegistrySummary> {
  const resolved = await resolveWorkspaceRegisteredProjects(workspacePath, {
    contract: options?.contract,
  });
  const summary: WorkspaceRegistrySummary = {
    ...resolved.summary,
    generatedAt: (options?.now ?? new Date()).toISOString(),
    registrySummaryPath: WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH,
  };
  return summary;
}

export function formatWorkspaceRegistrySyncSummary(
  summary: WorkspaceRegistrySummary,
  profileSuffix = ''
): string {
  if (summary.projectCount > 0) {
    if (summary.authority === 'workspace.contract.json') {
      return `${summary.projectCount} project(s) registered in workspace contract${profileSuffix}.`;
    }
    if (summary.authority === 'global-registry') {
      return `${summary.projectCount} project(s) registered in global workspace registry${profileSuffix}.`;
    }
    return `${summary.projectCount} project(s) registered in legacy workspace manifest${profileSuffix}.`;
  }
  return `Workspace state exists, but no projects are registered yet${profileSuffix}.`;
}
