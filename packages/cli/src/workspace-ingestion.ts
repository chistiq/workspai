import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  buildIngestionPlan,
  INGESTION_RESULT_CONTRACT_PATH,
  INGESTION_RESULT_SCHEMA_VERSION,
  type IngestionPlan,
  type IngestionResult,
} from './contracts/ingestion-contract.js';
import {
  captureWorkspaceRegistrationStrict,
  registerWorkspaceStrict,
  restoreWorkspaceRegistrationStrict,
  syncWorkspaceProjects,
  unregisterWorkspaceStrict,
} from './workspace.js';
import { hydrateWorkspaceArchive } from './utils/workspace-archive.js';
import { syncWorkspaceConsumerArtifacts } from './utils/workspace-onboarding.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { hasWorkspaceRootMarkers, PROJECT_WORKSPACE_LINK_FILE } from './utils/workspace-paths.js';

export interface ConnectWorkspaceOptions {
  workspacePath: string;
  dryRun?: boolean;
  projectGrounding?: 'managed' | 'local' | 'off';
}

export interface ImportWorkspaceArchiveOptions {
  archivePathOrUrl: string;
  outputPath?: string;
  dryRun?: boolean;
  strict?: boolean;
  projectGrounding?: 'managed' | 'local' | 'off';
  safety?: {
    maxDownloadBytes?: number;
    maxExpandedBytes?: number;
    downloadTimeoutMs?: number;
    allowPrivateNetwork?: boolean;
  };
}

async function assertSafeExistingWorkspaceRoot(workspacePath: string): Promise<void> {
  const root = await fsExtra.lstat(workspacePath).catch(() => null);
  if (!root || !root.isDirectory() || root.isSymbolicLink()) {
    throw new Error(
      `Workspace path must be a real directory, not a symbolic link: ${workspacePath}`
    );
  }
  for (const metadataDirectory of ['.workspai', '.rapidkit']) {
    const metadataPath = path.join(workspacePath, metadataDirectory);
    const metadata = await fsExtra.lstat(metadataPath).catch(() => null);
    if (metadata?.isSymbolicLink()) {
      throw new Error(`Workspace metadata directory must not be a symlink: ${metadataPath}`);
    }
    if (metadata && !metadata.isDirectory()) {
      throw new Error(`Workspace metadata path must be a directory: ${metadataPath}`);
    }
  }
}

async function removeMachineLocalProjectLinks(workspacePath: string): Promise<string[]> {
  const removed: string[] = [];
  const queue = [workspacePath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await fsExtra.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', '.venv', 'dist', 'build', 'target'].includes(entry.name)) {
          continue;
        }
        queue.push(candidate);
        continue;
      }
      if (entry.isFile() && entry.name === PROJECT_WORKSPACE_LINK_FILE) {
        await fsExtra.remove(candidate);
        removed.push(path.relative(workspacePath, candidate).replace(/\\/g, '/'));
      }
    }
  }
  return removed.sort();
}

async function reconcileConnectedWorkspace(
  workspacePath: string,
  mode: 'managed' | 'local' | 'off'
): Promise<{ writtenFiles: string[]; warnings: string[] }> {
  await registerWorkspaceStrict(workspacePath, path.basename(workspacePath));
  const syncResult = await syncWorkspaceProjects(workspacePath, true);
  if (!syncResult.workspaceFound) {
    throw new Error(`Workspace registry reconciliation failed: ${workspacePath}`);
  }
  const consumers = await syncWorkspaceConsumerArtifacts(workspacePath, {
    silent: true,
    projectGrounding: mode,
  });
  return {
    writtenFiles: consumers.writtenFiles,
    warnings: consumers.warnings,
  };
}

export async function connectWorkspace(options: ConnectWorkspaceOptions): Promise<IngestionResult> {
  const workspacePath = path.resolve(options.workspacePath);
  await assertSafeExistingWorkspaceRoot(workspacePath);
  const plan = buildIngestionPlan({
    action: 'connect-workspace',
    resourceKind: 'workspace',
    sourceKind: 'local-folder',
    mode: 'link',
    ownership: 'external',
    registration: 'workspace',
    source: workspacePath,
    destination: workspacePath,
    projectGrounding: options.projectGrounding ?? 'managed',
  });
  if (!hasWorkspaceRootMarkers(workspacePath)) {
    throw new Error(`Workspace path is not a valid Workspai workspace: ${workspacePath}`);
  }
  if (options.dryRun) {
    return ingestionResult(plan, {
      status: 'preview',
      workspacePath,
      registered: false,
      verified: true,
    });
  }
  const registrationSnapshot = await captureWorkspaceRegistrationStrict(workspacePath);
  try {
    const reconciled = await reconcileConnectedWorkspace(
      workspacePath,
      options.projectGrounding ?? 'managed'
    );
    return ingestionResult(plan, {
      workspacePath,
      writtenFiles: reconciled.writtenFiles,
      warnings: reconciled.warnings,
      registered: true,
      verified: true,
    });
  } catch (error) {
    await restoreWorkspaceRegistrationStrict(workspacePath, registrationSnapshot).catch(
      () => undefined
    );
    throw error;
  }
}

export async function importWorkspaceArchive(
  options: ImportWorkspaceArchiveOptions
): Promise<IngestionResult> {
  if (options.dryRun) {
    const preview = await hydrateWorkspaceArchive({
      archivePathOrUrl: options.archivePathOrUrl,
      outputPath: options.outputPath,
      dryRun: true,
      strict: options.strict,
      safety: options.safety,
    });
    const workspacePath = path.resolve(preview.outputPath);
    const plan = workspaceImportPlan(options, workspacePath);
    return ingestionResult(plan, {
      status: 'preview',
      workspacePath,
      registered: false,
      verified: true,
      warnings: (preview.manifest?.externalProjects ?? []).map(
        (project) => `External project "${project.name}" must be relinked after import.`
      ),
    });
  }

  const requestedOutputPath = options.outputPath ? path.resolve(options.outputPath) : undefined;
  if (requestedOutputPath && (await fsExtra.pathExists(requestedOutputPath))) {
    throw new Error(
      `Workspace import destination already exists: ${requestedOutputPath}. Choose a new --output path.`
    );
  }

  let workspacePath: string | undefined;
  try {
    const hydrated = await hydrateWorkspaceArchive({
      archivePathOrUrl: options.archivePathOrUrl,
      outputPath: requestedOutputPath,
      strict: options.strict,
      safety: options.safety,
    });
    workspacePath = path.resolve(hydrated.outputPath);
    const plan = workspaceImportPlan(options, workspacePath);
    if (!hasWorkspaceRootMarkers(workspacePath)) {
      throw new Error('Imported archive did not materialize a valid Workspai workspace.');
    }
    const removedLinks = await removeMachineLocalProjectLinks(workspacePath);
    if (hydrated.manifest?.portableContract) {
      await fsExtra.outputJson(
        path.join(workspacePath, '.workspai', 'workspace.contract.json'),
        hydrated.manifest.portableContract,
        { spaces: 2 }
      );
    }
    const reconciled = await reconcileConnectedWorkspace(
      workspacePath,
      options.projectGrounding ?? 'managed'
    );
    return ingestionResult(plan, {
      workspacePath,
      writtenFiles: [...hydrated.files.map((file) => file.path), ...reconciled.writtenFiles].filter(
        (value, index, values) => values.indexOf(value) === index
      ),
      warnings: [
        ...reconciled.warnings,
        ...(hydrated.manifest?.externalProjects ?? []).map(
          (project) => `External project "${project.name}" must be relinked after import.`
        ),
        ...(removedLinks.length > 0
          ? [`Rebuilt ${removedLinks.length} machine-local project workspace link(s).`]
          : []),
      ],
      registered: true,
      verified: true,
    });
  } catch (error) {
    if (workspacePath) {
      await unregisterWorkspaceStrict(workspacePath).catch(() => undefined);
      await fsExtra.remove(workspacePath).catch(() => undefined);
    }
    throw error;
  }
}

function workspaceImportPlan(
  options: ImportWorkspaceArchiveOptions,
  workspacePath: string
): IngestionPlan {
  return buildIngestionPlan({
    action: 'import-workspace',
    resourceKind: 'workspace',
    sourceKind: 'archive',
    mode: 'hydrate',
    ownership: 'workspace-owned',
    registration: 'workspace',
    source: options.archivePathOrUrl,
    destination: workspacePath,
    projectGrounding: options.projectGrounding ?? 'managed',
  });
}

function ingestionResult(
  plan: IngestionPlan,
  values: Partial<IngestionResult> & Pick<IngestionResult, 'registered' | 'verified'>
): IngestionResult {
  const result: IngestionResult = {
    schemaVersion: INGESTION_RESULT_SCHEMA_VERSION,
    status: 'passed',
    plan,
    writtenFiles: [],
    warnings: [],
    ...values,
  };
  assertJsonSchemaContract(result, INGESTION_RESULT_CONTRACT_PATH, 'Workspace ingestion result');
  return result;
}
