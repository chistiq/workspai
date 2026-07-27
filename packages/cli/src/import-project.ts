import path from 'path';

import { execa } from 'execa';
import fsExtra from 'fs-extra';
import { buildImportReadinessReport } from './utils/import-readiness.js';

import {
  detectBackendFrameworkFromProject,
  type BackendConfidence,
  type BackendFrameworkDetection,
  type BackendImportStack,
  type BackendRuntimeFamily,
  type BackendSupportTier,
} from './utils/backend-framework-contract.js';
import { resolveImportModuleSupport } from './utils/import-module-support.js';
import { inferWorkspaceProjectKind, type WorkspaceProjectKind } from './utils/project-kind.js';
import { resolveWorkspaceProjectPaths } from './utils/workspace-project-paths.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import {
  assertSafeProjectMetadataDirectories,
  isProjectMetadataSymlink,
} from './utils/project-metadata-path-safety.js';
import {
  removeImportedProjectsRegistryEntries,
  upsertImportedProjectsRegistry,
  type ImportedProjectRegistryEntry,
} from './imported-projects-registry.js';
import {
  hasWorkspaceRootMarkers,
  projectMetadataCandidates,
  projectMetadataPath,
} from './utils/workspace-paths.js';
import {
  collectWorkspaceProfileRuntimes,
  readWorkspaceManifestProfile,
  readWorkspaceProfilePolicyMode,
  resolveWorkspaceProfileCompatibility,
  resolveWorkspaceProfileProjectCompatibility,
  type WorkspaceProfileCompatibilityResult,
  type WorkspaceProfilePolicyMode,
} from './workspace-profile-compatibility.js';
import {
  syncProjectIntelligenceLens,
  type ProjectGroundingMode,
} from './project-intelligence-lens.js';

export type ImportSourceType = 'local-folder' | 'git-url';

export interface ImportProjectIntoWorkspaceOptions {
  workspacePath: string;
  source: string;
  name?: string;
  sourceType?: ImportSourceType;
  enableModules?: boolean;
  profilePolicyMode?: WorkspaceProfilePolicyMode;
  projectGrounding?: ProjectGroundingMode;
}

export interface ImportedProjectResult {
  name: string;
  path: string;
  relativePath: string;
  stack: BackendImportStack;
  runtime: BackendRuntimeFamily;
  framework: string;
  frameworkDisplayName: string;
  supportTier: BackendSupportTier;
  moduleSupport: boolean;
  confidence: BackendConfidence;
  source: ImportSourceType;
  projectJsonPath: string;
  importJsonPath: string;
  importReadinessPath: string;
  profileCompatibility: WorkspaceProfileCompatibilityResult;
}

function normalizeProjectName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
}

function deriveProjectNameFromGitUrl(gitUrl: string): string {
  const trimmed = gitUrl.trim();
  if (!trimmed) {
    return 'imported-project';
  }

  const slashBased = trimmed.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  const lastSlashSegment = slashBased[slashBased.length - 1] || trimmed;

  const colonSegments = lastSlashSegment.split(':');
  const candidate = (colonSegments[colonSegments.length - 1] || lastSlashSegment).replace(
    /\.git$/i,
    ''
  );

  const normalized = normalizeProjectName(candidate);
  return normalized || 'imported-project';
}

export function isGitUrl(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.includes('://') || trimmed.startsWith('git@');
}

export function detectImportSourceType(input: string): ImportSourceType {
  return isGitUrl(input) ? 'git-url' : 'local-folder';
}

async function resolveDestinationProjectPath(
  workspacePath: string,
  suggestedName: string
): Promise<string> {
  const baseName = normalizeProjectName(suggestedName) || 'imported-project';

  let attempt = 0;
  for (;;) {
    const candidateName =
      attempt === 0
        ? baseName
        : attempt === 1
          ? `${baseName}-imported`
          : `${baseName}-imported-${attempt}`;
    const candidatePath = path.join(workspacePath, candidateName);

    if (!(await fsExtra.pathExists(candidatePath))) {
      return candidatePath;
    }

    attempt += 1;
  }
}

function isSameOrInsideDirectory(parentPath: string, childPath: string): boolean {
  const resolvedParent = path.resolve(parentPath);
  const resolvedChild = path.resolve(childPath);
  const relativePath = path.relative(resolvedParent, resolvedChild);
  return (
    relativePath === '' ||
    (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function assertImportSourceOutsideWorkspace(workspacePath: string, sourcePath: string): void {
  if (isSameOrInsideDirectory(workspacePath, sourcePath)) {
    throw new Error('Import source must be outside the current workspace root.');
  }
}

function isSensitiveEnvFile(baseName: string): boolean {
  if (!baseName.startsWith('.env')) {
    return false;
  }

  return !['.env.example', '.env.sample', '.env.template', '.env.defaults', '.env.dist'].includes(
    baseName
  );
}

async function shouldCopyProjectEntry(sourcePath: string): Promise<boolean> {
  const baseName = path.basename(sourcePath);
  if (await isProjectMetadataSymlink(sourcePath)) {
    return false;
  }
  if (
    [
      '.git',
      'node_modules',
      '.venv',
      'venv',
      '__pycache__',
      '.pytest_cache',
      '.mypy_cache',
      '.ruff_cache',
      '.next',
      '.turbo',
      '.cache',
      'dist',
      'build',
      'target',
      'bin',
      'obj',
      'vendor',
    ].includes(baseName)
  ) {
    return false;
  }

  if (isSensitiveEnvFile(baseName) || baseName.endsWith('.pem') || baseName.endsWith('.key')) {
    return false;
  }

  return true;
}

async function readExistingProjectJson(
  projectPath: string
): Promise<Record<string, unknown> | null> {
  await assertSafeProjectMetadataDirectories(projectPath);
  for (const projectJsonPath of projectMetadataCandidates(projectPath, 'project.json')) {
    if (!(await fsExtra.pathExists(projectJsonPath))) {
      continue;
    }
    try {
      return (await fsExtra.readJson(projectJsonPath)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

async function writeImportedProjectMetadata(input: {
  workspacePath: string;
  projectPath: string;
  sourceType: ImportSourceType;
  detection: BackendFrameworkDetection;
  existingProjectJson: Record<string, unknown> | null;
  projectKind: WorkspaceProjectKind;
  enableModules?: boolean;
  profileCompatibility: WorkspaceProfileCompatibilityResult;
}): Promise<{
  projectJsonPath: string;
  importJsonPath: string;
  importReadinessPath: string;
  moduleSupport: boolean;
}> {
  await assertSafeProjectMetadataDirectories(input.projectPath);
  const importedAt = new Date().toISOString();
  const projectName =
    typeof input.existingProjectJson?.name === 'string'
      ? input.existingProjectJson.name
      : path.basename(input.projectPath);
  const paths = resolveWorkspaceProjectPaths({
    workspacePath: input.workspacePath,
    projectPath: input.projectPath,
    projectName,
  });
  const relativePath = paths.contractRelativePath;
  const projectJsonPath = projectMetadataPath(input.projectPath, 'project.json');
  const importJsonPath = projectMetadataPath(input.projectPath, 'import.json');
  const importReadinessPath = projectMetadataPath(input.projectPath, 'import-readiness.json');
  const moduleSupport = resolveImportModuleSupport({
    existingProjectJson: input.existingProjectJson,
    detection: input.detection,
    enableModules: input.enableModules,
  });
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

  const payload = {
    ...(input.existingProjectJson || {}),
    schema_version:
      typeof input.existingProjectJson?.schema_version === 'string'
        ? input.existingProjectJson.schema_version
        : '1.0',
    name:
      typeof input.existingProjectJson?.name === 'string'
        ? input.existingProjectJson.name
        : path.basename(input.projectPath),
    slug:
      typeof input.existingProjectJson?.slug === 'string'
        ? input.existingProjectJson.slug
        : path.basename(input.projectPath),
    kind: input.projectKind,
    runtime: input.detection.runtime,
    framework: input.detection.key,
    kit:
      typeof input.existingProjectJson?.kit === 'string'
        ? input.existingProjectJson.kit
        : `imported.${input.detection.key}`,
    kit_name:
      typeof input.existingProjectJson?.kit_name === 'string'
        ? input.existingProjectJson.kit_name
        : `imported.${input.detection.key}`,
    engine:
      typeof input.existingProjectJson?.engine === 'string'
        ? input.existingProjectJson.engine
        : 'npm',
    module_support: moduleSupport,
    modules: existingModules,
    contracts: existingContracts,
    import: {
      managed_by: 'workspai',
      source_type: input.sourceType,
      imported_at: importedAt,
      relative_path: relativePath,
      discovered_relative_path: paths.relativePath,
      is_external: paths.isExternal,
      detection: {
        framework: input.detection.key,
        runtime: input.detection.runtime,
        confidence: input.detection.confidence,
        support_tier: input.detection.supportTier,
        source: input.detection.source,
      },
    },
  };

  const importPayload = {
    schema_version: '1.0',
    kind: 'workspai.imported_project',
    imported_at: importedAt,
    managed_by: 'workspai',
    source: {
      type: input.sourceType,
      name: path.basename(input.projectPath),
    },
    project: {
      name: payload.name,
      slug: payload.slug,
      relative_path: relativePath,
      kind: input.projectKind,
      module_support: moduleSupport,
    },
    detection: {
      framework: input.detection.key,
      framework_display_name: input.detection.displayName,
      runtime: input.detection.runtime,
      kind: input.projectKind,
      confidence: input.detection.confidence,
      support_tier: input.detection.supportTier,
      import_stack: input.detection.importStack,
      source: input.detection.source,
    },
    policy: {
      copied_secrets: false,
      copied_dependency_caches: false,
      module_mutation_enabled: moduleSupport,
      profile_compatibility: {
        ok: input.profileCompatibility.ok,
        profile: input.profileCompatibility.profile,
        runtimes: input.profileCompatibility.runtimes,
        message: input.profileCompatibility.message,
        recommended_profile: input.profileCompatibility.recommendedProfile,
        recommended_command: input.profileCompatibility.recommendedCommand,
      },
    },
  };
  const readinessPayload = buildImportReadinessReport({
    projectName: String(payload.name),
    relativePath,
    projectKind: input.projectKind,
    source: input.sourceType,
    detection: input.detection,
    moduleSupport,
    projectPath: input.projectPath,
    generatedAt: new Date(importedAt),
  });

  await fsExtra.ensureDir(path.dirname(projectJsonPath));
  await fsExtra.writeJson(projectJsonPath, payload, { spaces: 2 });
  await fsExtra.writeJson(importJsonPath, importPayload, { spaces: 2 });
  await fsExtra.writeJson(importReadinessPath, readinessPayload, { spaces: 2 });
  return { projectJsonPath, importJsonPath, importReadinessPath, moduleSupport };
}

async function writeImportedProjectRegistryEntry(
  workspacePath: string,
  importedProject: ImportedProjectResult
): Promise<void> {
  const entry: ImportedProjectRegistryEntry = {
    name: importedProject.name,
    path: importedProject.path,
    relativePath: importedProject.relativePath,
    stack: importedProject.stack,
    runtime: importedProject.runtime,
    framework: importedProject.framework,
    frameworkDisplayName: importedProject.frameworkDisplayName,
    supportTier: importedProject.supportTier,
    moduleSupport: importedProject.moduleSupport,
    confidence: importedProject.confidence,
    source: importedProject.source,
    importedAt: new Date().toISOString(),
  };

  await upsertImportedProjectsRegistry(workspacePath, [entry]);
}

async function rollbackImportedProject(destinationPath: string): Promise<void> {
  if (!(await fsExtra.pathExists(destinationPath))) {
    return;
  }

  await assertSafeProjectMetadataDirectories(destinationPath);
  await fsExtra.remove(destinationPath);
}

export async function cleanupImportedProjectImport(
  workspacePath: string,
  projectPath: string
): Promise<void> {
  await rollbackImportedProject(projectPath);
  await removeImportedProjectsRegistryEntries(workspacePath, [projectPath]);
}

export async function importProjectIntoWorkspace(
  options: ImportProjectIntoWorkspaceOptions
): Promise<ImportedProjectResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const source = options.source.trim();
  const sourceType = options.sourceType ?? detectImportSourceType(source);
  const suggestedName =
    options.name ??
    (sourceType === 'git-url' ? deriveProjectNameFromGitUrl(source) : path.basename(source));
  const destinationPath = await resolveDestinationProjectPath(workspacePath, suggestedName);
  let destinationPrepared = false;

  try {
    if (sourceType === 'local-folder') {
      const sourcePath = path.resolve(source);
      const sourceStats = await fsExtra.stat(sourcePath).catch(() => null);
      if (!sourceStats || !sourceStats.isDirectory()) {
        throw new Error('Import source is not a directory.');
      }
      await assertSafeProjectMetadataDirectories(sourcePath);
      if (hasWorkspaceRootMarkers(sourcePath)) {
        throw new Error('This is a workspace. Import it as a workspace instead.');
      }

      assertImportSourceOutsideWorkspace(workspacePath, sourcePath);
      destinationPrepared = true;
      await fsExtra.copy(sourcePath, destinationPath, {
        overwrite: false,
        errorOnExist: true,
        filter: shouldCopyProjectEntry,
      });
    } else {
      destinationPrepared = true;
      await execa('git', ['clone', '--depth', '1', '--', source, destinationPath], {
        timeout: 120000,
        env: buildCleanGitEnv(),
      });
    }

    await assertSafeProjectMetadataDirectories(destinationPath);
    const existingProjectJson = await readExistingProjectJson(destinationPath);
    const detection = detectBackendFrameworkFromProject(destinationPath, existingProjectJson);
    const projectKind = await inferWorkspaceProjectKind(destinationPath, existingProjectJson);
    const [workspaceProfile, profilePolicyMode] = await Promise.all([
      readWorkspaceManifestProfile(workspacePath),
      options.profilePolicyMode
        ? Promise.resolve(options.profilePolicyMode)
        : readWorkspaceProfilePolicyMode(workspacePath),
    ]);
    const projectProfileCompatibility = resolveWorkspaceProfileProjectCompatibility({
      profile: workspaceProfile,
      runtime: detection.runtime,
      subjectLabel: path.basename(destinationPath),
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
    const metadata = await writeImportedProjectMetadata({
      workspacePath,
      projectPath: destinationPath,
      sourceType,
      detection,
      existingProjectJson,
      projectKind,
      enableModules: options.enableModules,
      profileCompatibility,
    });
    const importedPaths = resolveWorkspaceProjectPaths({
      workspacePath,
      projectPath: destinationPath,
      projectName: path.basename(destinationPath),
    });
    const importedProject: ImportedProjectResult = {
      name: path.basename(destinationPath),
      path: destinationPath,
      relativePath: importedPaths.contractRelativePath,
      stack: detection.importStack,
      runtime: detection.runtime,
      framework: detection.key,
      frameworkDisplayName: detection.displayName,
      supportTier: detection.supportTier,
      moduleSupport: metadata.moduleSupport,
      confidence: detection.confidence,
      source: sourceType,
      projectJsonPath: metadata.projectJsonPath,
      importJsonPath: metadata.importJsonPath,
      importReadinessPath: metadata.importReadinessPath,
      profileCompatibility,
    };

    await writeImportedProjectRegistryEntry(workspacePath, importedProject);
    const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
    await syncWorkspaceContract({ workspacePath, strict: true });
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath: importedProject.path,
      projectName: importedProject.name,
      relationship: 'imported',
      mode: options.projectGrounding ?? 'managed',
    });
    return importedProject;
  } catch (error) {
    if (destinationPrepared) {
      try {
        await cleanupImportedProjectImport(workspacePath, destinationPath);
        const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
        await syncWorkspaceContract({ workspacePath, strict: true });
      } catch (cleanupError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(
          `Import failed: ${originalMessage}. Rollback also failed: ${cleanupMessage}`
        );
      }
    }

    throw error;
  }
}
