import path from 'path';

import fsExtra from 'fs-extra';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';

import {
  upsertImportedProjectsRegistry,
  type ImportedProjectRegistryEntry,
} from './imported-projects-registry.js';
import { buildImportReadinessReport } from './utils/import-readiness.js';
import { resolveImportModuleSupport } from './utils/import-module-support.js';
import {
  categorizeWorkspaceProjectKind,
  inferWorkspaceProjectKind,
  type WorkspaceProjectKind,
} from './utils/project-kind.js';
import { resolveWorkspaceProjectPaths } from './utils/workspace-project-paths.js';
import { assertSafeProjectMetadataDirectories } from './utils/project-metadata-path-safety.js';
import {
  detectBackendFrameworkFromProject,
  type BackendConfidence,
  type BackendImportStack,
  type BackendRuntimeFamily,
  type BackendSupportTier,
} from './utils/backend-framework-contract.js';
import {
  hasWorkspaceRootMarkers,
  PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
  PROJECT_GROUNDING_RELATIVE_PATH,
  PROJECT_WORKSPACE_LINK_RELATIVE_PATH,
  projectMetadataCandidates,
  projectMetadataPath,
  workspaceMetadataPath,
} from './utils/workspace-paths.js';
import {
  syncProjectIntelligenceLens,
  type ProjectGroundingMode,
} from './project-intelligence-lens.js';
import {
  collectWorkspaceProfileRuntimes,
  readWorkspaceManifestProfile,
  readWorkspaceProfilePolicyMode,
  resolveWorkspaceProfileCompatibility,
  resolveWorkspaceProfileProjectCompatibility,
  type WorkspaceProfileCompatibilityResult,
  type WorkspaceProfilePolicyMode,
} from './workspace-profile-compatibility.js';
import { buildIngestionPlan, type IngestionPlan } from './contracts/ingestion-contract.js';

export interface AdoptProjectOptions {
  workspacePath: string;
  source: string;
  name?: string;
  dryRun?: boolean;
  enableModules?: boolean;
  profilePolicyMode?: WorkspaceProfilePolicyMode;
  now?: Date;
  rollbackSnapshot?: AdoptProjectRollbackSnapshot;
  projectGrounding?: ProjectGroundingMode;
}

interface AdoptProjectFilePreimage {
  path: string;
  contents: Buffer | null;
}

export interface AdoptProjectRollbackSnapshot {
  workspacePath: string;
  projectPath: string;
  files: AdoptProjectFilePreimage[];
}

export interface AdoptProjectResult {
  ingestionPlan: IngestionPlan;
  name: string;
  path: string;
  relativePath: string;
  contractRelativePath: string;
  isExternal: boolean;
  relationship: 'adopted';
  stack: BackendImportStack;
  runtime: BackendRuntimeFamily;
  framework: string;
  frameworkDisplayName: string;
  supportTier: BackendSupportTier;
  moduleSupport: boolean;
  confidence: BackendConfidence;
  projectJsonPath: string;
  adoptJsonPath: string;
  adoptReadinessPath: string;
  profileCompatibility: WorkspaceProfileCompatibilityResult;
  wroteFiles: boolean;
}

function normalizeProjectName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
}

function isSameDirectory(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

async function readExistingProjectJson(
  projectPath: string
): Promise<Record<string, unknown> | null> {
  await assertSafeProjectMetadataDirectories(projectPath);
  for (const projectJsonPath of projectMetadataCandidates(projectPath, 'project.json')) {
    if (!(await fsExtra.pathExists(projectJsonPath))) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse((await fsExtra.readFile(projectJsonPath)).toString('utf8'));
    } catch (error) {
      throw new Error(
        `Authoritative project metadata is malformed: ${projectJsonPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `Authoritative project metadata is malformed: ${projectJsonPath}: expected a JSON object`
      );
    }
    return parsed as Record<string, unknown>;
  }
  return null;
}

export async function captureAdoptProjectRollbackSnapshot(
  workspacePath: string,
  projectPath: string
): Promise<AdoptProjectRollbackSnapshot> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedProjectPath = path.resolve(projectPath);
  await assertSafeProjectMetadataDirectories(resolvedProjectPath);
  const filePaths = [
    projectMetadataPath(resolvedProjectPath, 'project.json'),
    projectMetadataPath(resolvedProjectPath, 'adopt.json'),
    projectMetadataPath(resolvedProjectPath, 'adopt-readiness.json'),
    path.join(resolvedProjectPath, PROJECT_WORKSPACE_LINK_RELATIVE_PATH),
    path.join(resolvedProjectPath, PROJECT_GROUNDING_RELATIVE_PATH),
    path.join(resolvedProjectPath, PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH),
    path.join(resolvedProjectPath, 'AGENTS.md'),
    path.join(resolvedProjectPath, '.gitignore'),
    workspaceMetadataPath(resolvedWorkspacePath, 'imported-projects.json'),
  ];

  return {
    workspacePath: resolvedWorkspacePath,
    projectPath: resolvedProjectPath,
    files: await Promise.all(
      filePaths.map(async (filePath) => ({
        path: filePath,
        contents: (await fsExtra.pathExists(filePath)) ? await fsExtra.readFile(filePath) : null,
      }))
    ),
  };
}

function assertMatchingRollbackSnapshot(
  snapshot: AdoptProjectRollbackSnapshot,
  workspacePath: string,
  projectPath: string
): void {
  const expectedPaths = [
    projectMetadataPath(projectPath, 'project.json'),
    projectMetadataPath(projectPath, 'adopt.json'),
    projectMetadataPath(projectPath, 'adopt-readiness.json'),
    path.join(projectPath, PROJECT_WORKSPACE_LINK_RELATIVE_PATH),
    path.join(projectPath, PROJECT_GROUNDING_RELATIVE_PATH),
    path.join(projectPath, PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH),
    path.join(projectPath, 'AGENTS.md'),
    path.join(projectPath, '.gitignore'),
    workspaceMetadataPath(workspacePath, 'imported-projects.json'),
  ].map((filePath) => path.resolve(filePath));
  if (
    snapshot.workspacePath !== path.resolve(workspacePath) ||
    snapshot.projectPath !== path.resolve(projectPath) ||
    snapshot.files.length !== expectedPaths.length ||
    snapshot.files.some((file, index) => path.resolve(file.path) !== expectedPaths[index])
  ) {
    throw new Error('Adopt rollback snapshot does not match the workspace and project paths.');
  }
}

function buildAdoptedProjectJson(input: {
  projectName: string;
  relativePath: string;
  contractRelativePath: string;
  isExternal: boolean;
  discoveredRelativePath: string;
  detection: ReturnType<typeof detectBackendFrameworkFromProject>;
  existingProjectJson: Record<string, unknown> | null;
  projectKind: WorkspaceProjectKind;
  moduleSupport: boolean;
  adoptedAt: string;
}): Record<string, unknown> {
  const existingModules = Array.isArray(input.existingProjectJson?.modules)
    ? input.existingProjectJson.modules
    : [];
  const existingContracts =
    input.existingProjectJson?.contracts &&
    typeof input.existingProjectJson.contracts === 'object' &&
    !Array.isArray(input.existingProjectJson.contracts)
      ? input.existingProjectJson.contracts
      : {
          owns: [],
          apis: [],
          publishes: [],
          consumes: [],
          dependsOn: [],
          env: [],
        };

  return {
    ...(input.existingProjectJson || {}),
    schema_version:
      typeof input.existingProjectJson?.schema_version === 'string'
        ? input.existingProjectJson.schema_version
        : '1.0',
    name:
      typeof input.existingProjectJson?.name === 'string'
        ? input.existingProjectJson.name
        : input.projectName,
    slug:
      typeof input.existingProjectJson?.slug === 'string'
        ? input.existingProjectJson.slug
        : input.projectName,
    kind: input.projectKind,
    category: categorizeWorkspaceProjectKind(input.projectKind),
    project_type: categorizeWorkspaceProjectKind(input.projectKind),
    runtime: input.detection.runtime,
    framework: input.detection.key,
    kit:
      typeof input.existingProjectJson?.kit === 'string'
        ? input.existingProjectJson.kit
        : `adopted.${input.detection.key}`,
    kit_name:
      typeof input.existingProjectJson?.kit_name === 'string'
        ? input.existingProjectJson.kit_name
        : `adopted.${input.detection.key}`,
    engine:
      typeof input.existingProjectJson?.engine === 'string'
        ? input.existingProjectJson.engine
        : 'npm',
    module_support: input.moduleSupport,
    modules: existingModules,
    contracts: existingContracts,
    adoption: {
      managed_by: 'workspai',
      mode: 'linked',
      adopted_at: input.adoptedAt,
      relative_path: input.contractRelativePath,
      ...(!input.isExternal ? { discovered_relative_path: input.discoveredRelativePath } : {}),
      is_external: input.isExternal,
      detection: {
        framework: input.detection.key,
        runtime: input.detection.runtime,
        confidence: input.detection.confidence,
        support_tier: input.detection.supportTier,
        source: input.detection.source,
      },
    },
  };
}

export async function cleanupAdoptedProjectImport(
  workspacePath: string,
  projectPath: string,
  snapshot: AdoptProjectRollbackSnapshot
): Promise<void> {
  await assertSafeProjectMetadataDirectories(projectPath);
  assertMatchingRollbackSnapshot(snapshot, workspacePath, projectPath);
  const failures: unknown[] = [];
  for (const file of snapshot.files) {
    try {
      if (file.contents === null) {
        await fsExtra.remove(file.path);
      } else {
        await fsExtra.ensureDir(path.dirname(file.path));
        await fsExtra.writeFile(file.path, file.contents);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to restore adopt rollback snapshot.');
  }
}

export async function adoptProjectIntoWorkspace(
  options: AdoptProjectOptions
): Promise<AdoptProjectResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const projectPath = path.resolve(options.source);
  const projectStats = await fsExtra.stat(projectPath).catch(() => null);
  if (!projectStats || !projectStats.isDirectory()) {
    throw new Error('Adopt source is not a directory.');
  }
  await assertSafeProjectMetadataDirectories(projectPath);
  if (isSameDirectory(workspacePath, projectPath)) {
    throw new Error('Adopt source cannot be the workspace root itself.');
  }
  if (hasWorkspaceRootMarkers(projectPath)) {
    throw new Error(
      'This path is a Workspai workspace. Use `workspai workspace connect <path>` instead.'
    );
  }
  const rollbackSnapshot =
    options.rollbackSnapshot ??
    (await captureAdoptProjectRollbackSnapshot(workspacePath, projectPath));
  assertMatchingRollbackSnapshot(rollbackSnapshot, workspacePath, projectPath);

  const existingProjectJson = await readExistingProjectJson(projectPath);
  const detection = detectBackendFrameworkFromProject(projectPath, existingProjectJson);
  const projectKind = await inferWorkspaceProjectKind(projectPath, existingProjectJson);
  const projectName =
    normalizeProjectName(
      options.name ||
        (typeof existingProjectJson?.name === 'string' ? existingProjectJson.name : '') ||
        path.basename(projectPath)
    ) || 'adopted-project';
  const paths = resolveWorkspaceProjectPaths({
    workspacePath,
    projectPath,
    projectName,
  });
  const adoptedAt = (options.now ?? new Date()).toISOString();
  const projectJsonPath = projectMetadataPath(projectPath, 'project.json');
  const adoptJsonPath = projectMetadataPath(projectPath, 'adopt.json');
  const adoptReadinessPath = projectMetadataPath(projectPath, 'adopt-readiness.json');
  const moduleSupport = resolveImportModuleSupport({
    existingProjectJson,
    detection,
    enableModules: options.enableModules,
  });
  const [workspaceProfile, profilePolicyMode] = await Promise.all([
    readWorkspaceManifestProfile(workspacePath),
    options.profilePolicyMode
      ? Promise.resolve(options.profilePolicyMode)
      : readWorkspaceProfilePolicyMode(workspacePath),
  ]);
  const projectProfileCompatibility = resolveWorkspaceProfileProjectCompatibility({
    profile: workspaceProfile,
    runtime: detection.runtime,
    subjectLabel: projectName,
    mode: profilePolicyMode,
  });
  const workspaceProfileCompatibility = resolveWorkspaceProfileCompatibility({
    profile: workspaceProfile,
    runtimes: await collectWorkspaceProfileRuntimes(workspacePath, {
      additionalRuntimes: [detection.runtime],
    }),
    mode: profilePolicyMode,
  });
  const profileCompatibility = projectProfileCompatibility.ok
    ? workspaceProfileCompatibility
    : projectProfileCompatibility;
  if (!profileCompatibility.ok && profilePolicyMode === 'strict') {
    throw new Error(profileCompatibility.message);
  }
  const projectJson = buildAdoptedProjectJson({
    projectName,
    relativePath: paths.relativePath,
    contractRelativePath: paths.contractRelativePath,
    isExternal: paths.isExternal,
    discoveredRelativePath: paths.relativePath,
    detection,
    existingProjectJson,
    projectKind,
    moduleSupport,
    adoptedAt,
  });
  const adoptPayload = {
    schema_version: '1.0',
    kind: 'workspai.adopted_project',
    adopted_at: adoptedAt,
    managed_by: 'workspai',
    mode: 'linked',
    workspace: {
      name: path.basename(workspacePath),
      contract: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract,
    },
    project: {
      name: projectName,
      relative_path: paths.contractRelativePath,
      ...(!paths.isExternal ? { discovered_relative_path: paths.relativePath } : {}),
      is_external: paths.isExternal,
      kind: projectKind,
      category: categorizeWorkspaceProjectKind(projectKind),
      module_support: moduleSupport,
    },
    detection: {
      framework: detection.key,
      framework_display_name: detection.displayName,
      runtime: detection.runtime,
      kind: projectKind,
      category: categorizeWorkspaceProjectKind(projectKind),
      confidence: detection.confidence,
      support_tier: detection.supportTier,
      import_stack: detection.importStack,
      source: detection.source,
    },
    policy: {
      moved_source: false,
      copied_source: false,
      module_mutation_enabled: moduleSupport,
      workspace_contract: 'linked-project',
      profile_compatibility: {
        ok: profileCompatibility.ok,
        profile: profileCompatibility.profile,
        runtimes: profileCompatibility.runtimes,
        message: profileCompatibility.message,
        recommended_profile: profileCompatibility.recommendedProfile,
        recommended_command: profileCompatibility.recommendedCommand,
      },
    },
  };
  const readinessPayload = buildImportReadinessReport({
    projectName,
    relativePath: paths.contractRelativePath,
    projectKind,
    source: 'adopted-local',
    detection,
    moduleSupport,
    projectPath,
    generatedAt: new Date(adoptedAt),
  });

  if (options.dryRun !== true) {
    try {
      await assertSafeProjectMetadataDirectories(projectPath);
      await fsExtra.ensureDir(path.dirname(projectJsonPath));
      await fsExtra.writeJson(projectJsonPath, projectJson, { spaces: 2 });
      await fsExtra.writeJson(adoptJsonPath, adoptPayload, { spaces: 2 });
      await fsExtra.writeJson(adoptReadinessPath, readinessPayload, { spaces: 2 });

      const entry: ImportedProjectRegistryEntry = {
        name: projectName,
        path: projectPath,
        relativePath: paths.contractRelativePath,
        relationship: 'adopted',
        stack: detection.importStack,
        runtime: detection.runtime,
        framework: detection.key,
        frameworkDisplayName: detection.displayName,
        supportTier: detection.supportTier,
        moduleSupport,
        confidence: detection.confidence,
        source: 'adopted-local',
        importedAt: adoptedAt,
      };
      await upsertImportedProjectsRegistry(workspacePath, [entry]);
      const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
      await syncWorkspaceContract({ workspacePath, strict: true });
      await syncProjectIntelligenceLens({
        workspacePath,
        projectPath,
        projectName,
        relationship: 'adopted',
        mode: options.projectGrounding ?? 'managed',
        now: new Date(adoptedAt),
      });
    } catch (error) {
      try {
        await cleanupAdoptedProjectImport(workspacePath, projectPath, rollbackSnapshot);
        const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
        await syncWorkspaceContract({ workspacePath, strict: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Adopt failed and rollback was incomplete: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      throw error;
    }
  }

  return {
    ingestionPlan: buildIngestionPlan({
      action: 'adopt-project',
      resourceKind: 'project',
      sourceKind: 'local-folder',
      mode: 'link',
      ownership: 'external',
      registration: 'project',
      source: projectPath,
      targetWorkspace: workspacePath,
      destination: projectPath,
      projectGrounding: options.projectGrounding ?? 'managed',
    }),
    name: projectName,
    path: projectPath,
    relativePath: paths.relativePath,
    contractRelativePath: paths.contractRelativePath,
    isExternal: paths.isExternal,
    relationship: 'adopted',
    stack: detection.importStack,
    runtime: detection.runtime,
    framework: detection.key,
    frameworkDisplayName: detection.displayName,
    supportTier: detection.supportTier,
    moduleSupport,
    confidence: detection.confidence,
    projectJsonPath,
    adoptJsonPath,
    adoptReadinessPath,
    profileCompatibility,
    wroteFiles: options.dryRun !== true,
  };
}
