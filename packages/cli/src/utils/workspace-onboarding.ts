import path from 'path';
import fsExtra from 'fs-extra';

import chalk from 'chalk';

export interface FinalizeWorkspaceOnboardingOptions {
  workspaceName?: string;
  silent?: boolean;
}

export interface WorkspaceConsumerArtifactSyncResult {
  workspacePath: string;
  projectCount: number;
  baselineCreated: boolean;
  writtenFiles: string[];
  warnings: string[];
}

/**
 * Refresh the deterministic projections consumed by humans, IDEs, CI, MCP,
 * and coding agents after a workspace/project lifecycle mutation.
 *
 * This is intentionally smaller than the governed intelligence run: lifecycle
 * sync must not execute Doctor, Analyze, Readiness, or release gates. It keeps
 * the canonical model/graph and consumer entrypoints current; explicit checks
 * remain owned by their commands.
 */
export async function syncWorkspaceConsumerArtifacts(
  workspacePath: string,
  options: {
    silent?: boolean;
    projectGrounding?: 'managed' | 'local' | 'off';
  } = {}
): Promise<WorkspaceConsumerArtifactSyncResult> {
  const resolvedPath = path.resolve(workspacePath);
  const {
    WORKSPACE_CONTRACT_PATH,
    syncWorkspaceContract,
    verifyWorkspaceContract,
    writeWorkspaceContractVerifyEvidence,
  } = await import('./workspace-contract.js');
  const contractSync = await syncWorkspaceContract({
    workspacePath: resolvedPath,
    strict: true,
  });

  const { syncWorkspaceReadme, WORKSPACE_README_PATH } = await import('./workspace-readme.js');
  const readmePath = await syncWorkspaceReadme({
    workspacePath: resolvedPath,
    workspaceName: contractSync.contract.workspace.name,
    profile: contractSync.contract.workspace.profile ?? 'minimal',
    projectCount: contractSync.contract.projects.length,
  });

  const { buildWorkspaceModel, writeWorkspaceModel } = await import('../workspace-model.js');
  const model = await buildWorkspaceModel({
    workspacePath: resolvedPath,
    includeEvidence: true,
  });
  const modelPath = await writeWorkspaceModel(model, resolvedPath);

  const {
    buildWorkspaceImpact,
    buildWorkspaceModelSnapshot,
    diffWorkspaceModel,
    writeWorkspaceImpact,
    writeWorkspaceModelDiff,
    writeWorkspaceModelSnapshot,
  } = await import('../workspace-intelligence.js');
  const { WORKSPACE_INTELLIGENCE_ARTIFACTS } =
    await import('../contracts/workspace-intelligence-runtime-registry.js');
  const snapshotPath = path.join(resolvedPath, WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot);
  let baselineCreated = false;
  if (!(await fsExtra.pathExists(snapshotPath))) {
    const snapshot = await buildWorkspaceModelSnapshot({
      workspacePath: resolvedPath,
      model,
    });
    await writeWorkspaceModelSnapshot(snapshot, resolvedPath);
    baselineCreated = true;
  }

  const diff = await diffWorkspaceModel({
    workspacePath: resolvedPath,
    fromPath: WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot,
    model,
  });
  const diffPath = await writeWorkspaceModelDiff(diff, resolvedPath);
  const impact = await buildWorkspaceImpact({
    workspacePath: resolvedPath,
    fromPath: WORKSPACE_INTELLIGENCE_ARTIFACTS.diff,
  });
  const impactPath = await writeWorkspaceImpact(impact, resolvedPath);

  const verification = await verifyWorkspaceContract({
    workspacePath: resolvedPath,
    strict: true,
  });
  const contractVerifyPath = await writeWorkspaceContractVerifyEvidence({
    workspacePath: resolvedPath,
    result: verification,
  });

  const { syncWorkspaceAgentGrounding } = await import('../workspace-agent-sync.js');
  const agentSync = await syncWorkspaceAgentGrounding({
    workspacePath: resolvedPath,
    model,
    write: true,
    refreshContext: true,
    strict: false,
    preset: 'enterprise',
    targets: ['all'],
    projectGrounding: options.projectGrounding ?? 'managed',
  });

  const writtenFiles = [
    WORKSPACE_CONTRACT_PATH,
    (await import('./workspace-registry-summary.js')).WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH,
    path.relative(resolvedPath, readmePath).split(path.sep).join('/') || WORKSPACE_README_PATH,
    path.relative(resolvedPath, modelPath).split(path.sep).join('/'),
    WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
    ...(baselineCreated ? [WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot] : []),
    path.relative(resolvedPath, diffPath).split(path.sep).join('/'),
    path.relative(resolvedPath, impactPath).split(path.sep).join('/'),
    path.relative(resolvedPath, contractVerifyPath).split(path.sep).join('/'),
    ...agentSync.writtenFiles,
  ].filter((value, index, values) => values.indexOf(value) === index);

  if (!options.silent) {
    console.log(
      chalk.gray(
        `✓ Workspace Intelligence synced · ${model.summary.projectCount} project(s) · model + graph + agent grounding`
      )
    );
  }

  return {
    workspacePath: resolvedPath,
    projectCount: model.summary.projectCount,
    baselineCreated,
    writtenFiles,
    warnings:
      agentSync.projectLenses?.skipped.map((project) => `${project.name}: ${project.reason}`) ?? [],
  };
}

/**
 * Connect a newly created workspace to the intelligence layer:
 * global discovery registry plus canonical consumer projections.
 */
export async function finalizeWorkspaceOnboarding(
  workspacePath: string,
  options: FinalizeWorkspaceOnboardingOptions = {}
): Promise<WorkspaceConsumerArtifactSyncResult> {
  const resolvedPath = path.resolve(workspacePath);
  const workspaceName = options.workspaceName ?? path.basename(resolvedPath);

  const { registerWorkspaceStrict } = await import('../workspace.js');
  await registerWorkspaceStrict(resolvedPath, workspaceName);

  return syncWorkspaceConsumerArtifacts(resolvedPath, { silent: options.silent });
}
