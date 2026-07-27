import path from 'path';
import fsExtra from 'fs-extra';
import { runAnalyze } from './analyze.js';
import { runDoctor } from './doctor.js';
import { evaluateReleaseReadiness } from './readiness.js';
import { syncWorkspaceProjects } from './workspace.js';
import {
  buildWorkspaceModel,
  createWorkspaceModelBuildProvenance,
  writeWorkspaceModel,
} from './workspace-model.js';
import {
  buildWorkspaceImpact,
  buildWorkspaceModelSnapshot,
  diffWorkspaceModel,
  migrateLegacyWorkspaceModelSnapshot,
  writeWorkspaceImpact,
  writeWorkspaceModelDiff,
  writeWorkspaceModelSnapshot,
  type WorkspaceModelSnapshot,
} from './workspace-intelligence.js';
import {
  buildWorkspaceVerify,
  evaluateWorkspaceVerifyGate,
  writeWorkspaceVerify,
} from './workspace-verify.js';
import { buildWorkspaceAgentContext, writeWorkspaceAgentContext } from './workspace-context.js';
import { syncWorkspaceAgentGrounding } from './workspace-agent-sync.js';
import { buildWorkspaceExplain, writeWorkspaceExplainReport } from './workspace-explain.js';
import {
  syncWorkspaceContract,
  verifyWorkspaceContract,
  writeWorkspaceContractVerifyEvidence,
} from './utils/workspace-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS as A,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_PREFLIGHT_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  type WorkspaceIntelligencePreflightId,
  type WorkspaceIntelligenceStepId,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION } from './contracts/workspace-intelligence-chain-contract.js';
import {
  assertWorkspaceIntelligenceRunSemantics,
  type WorkspaceIntelligenceRunPreflight,
  type WorkspaceIntelligenceRunReport,
  type WorkspaceIntelligenceRunStage,
} from './contracts/workspace-intelligence-run-contract.js';
import { historyEntryFromVerify, recordWorkspaceHistory } from './workspace-history.js';
import { writeWorkspaceArtifactJson } from './utils/artifact-path-compat.js';

export type { WorkspaceIntelligenceRunReport } from './contracts/workspace-intelligence-run-contract.js';

export const WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH = A.intelligenceRun;
export const WORKSPACE_INTELLIGENCE_RUN_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.intelligenceRun;
const REPORT_PATH = WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH;

export async function runWorkspaceIntelligenceChain(input: {
  workspacePath: string;
  strict?: boolean;
  agent?: string;
}): Promise<WorkspaceIntelligenceRunReport> {
  const workspacePath = path.resolve(input.workspacePath);
  const preflight: WorkspaceIntelligenceRunPreflight[] = [];
  const stages: WorkspaceIntelligenceRunStage[] = [];
  let hardFailure = false;
  const preflightStep = async (
    id: WorkspaceIntelligencePreflightId,
    operation: () => Promise<{
      result: WorkspaceIntelligenceRunPreflight['result'];
      message: string;
    }>
  ): Promise<void> => {
    const artifacts = [...WORKSPACE_INTELLIGENCE_PREFLIGHT_ARTIFACTS[id]];
    if (hardFailure) {
      preflight.push({
        id,
        status: 'skipped',
        result: 'skipped',
        durationMs: 0,
        artifacts,
        message: 'skipped because a required upstream operation failed',
      });
      return;
    }
    const started = Date.now();
    try {
      const result = await operation();
      preflight.push({
        id,
        status: 'passed',
        result: result.result,
        durationMs: Date.now() - started,
        artifacts,
        message: result.message,
      });
    } catch (error) {
      hardFailure = true;
      preflight.push({
        id,
        status: 'failed',
        result: 'failed',
        durationMs: Date.now() - started,
        artifacts,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const stage = async (
    id: WorkspaceIntelligenceStepId,
    operation: () => Promise<{ exitCode?: number; blocked?: boolean; message: string }>
  ): Promise<void> => {
    const artifacts = [...WORKSPACE_INTELLIGENCE_RUNTIME_STEPS[id].produces];
    if (hardFailure) {
      stages.push({
        id,
        status: 'skipped',
        durationMs: 0,
        artifacts,
        exitCode: 0,
        message: 'skipped because a required upstream stage failed',
      });
      return;
    }
    const started = Date.now();
    try {
      const result = await operation();
      const exitCode = result.exitCode ?? 0;
      stages.push({
        id,
        status: result.blocked || exitCode !== 0 ? 'blocked' : 'passed',
        durationMs: Date.now() - started,
        artifacts,
        exitCode,
        message: result.message,
      });
    } catch (error) {
      hardFailure = true;
      stages.push({
        id,
        status: 'failed',
        durationMs: Date.now() - started,
        artifacts,
        exitCode: 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await preflightStep('sync', async () => {
    const registry = await syncWorkspaceProjects(workspacePath, true);
    const contract = await syncWorkspaceContract({ workspacePath });
    return {
      result: 'synchronized',
      message: `registry ${registry.added.length} added/${registry.skipped} existing; contract ${contract.contract.projects.length} projects`,
    };
  });

  let model: Awaited<ReturnType<typeof buildWorkspaceModel>> | undefined;
  const requireModel = () => {
    if (!model) throw new Error('canonical workspace model is unavailable');
    return model;
  };
  await stage('model', async () => {
    model = {
      ...(await buildWorkspaceModel({ workspacePath, includeEvidence: true })),
      build: createWorkspaceModelBuildProvenance({
        mode: 'full',
        engineStatus: 'disabled',
      }),
    };
    await writeWorkspaceModel(model, workspacePath);
    return { message: `${model.summary.projectCount} projects modeled` };
  });

  const snapshotPath = path.join(workspacePath, A.snapshot);
  let baselineCreated = false;
  await preflightStep('baseline', async () => {
    if (!(await fsExtra.pathExists(snapshotPath))) {
      const snapshot = await buildWorkspaceModelSnapshot({ workspacePath, model: requireModel() });
      await writeWorkspaceModelSnapshot(snapshot, workspacePath);
      baselineCreated = true;
      return { result: 'created', message: 'initial structural baseline created' };
    }
    const existing = (await fsExtra.readJson(snapshotPath)) as WorkspaceModelSnapshot;
    const migrated = migrateLegacyWorkspaceModelSnapshot(existing);
    if (migrated) {
      await writeWorkspaceModelSnapshot(migrated, workspacePath);
      return {
        result: 'reused',
        message: 'legacy structural baseline migrated and reused',
      };
    }
    return { result: 'reused', message: 'existing structural baseline reused' };
  });

  await stage('diff', async () => {
    const diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: A.snapshot,
      model: requireModel(),
    });
    await writeWorkspaceModelDiff(diff, workspacePath);
    return {
      message: diff.summary.changed ? 'workspace changes detected' : 'no workspace changes',
    };
  });

  await stage('impact', async () => {
    const impact = await buildWorkspaceImpact({ workspacePath, fromPath: A.diff });
    await writeWorkspaceImpact(impact, workspacePath);
    return { message: `${impact.summary.risk} risk; ${impact.summary.affectedProjects} affected` };
  });

  await stage('doctor-evidence', async () => {
    const exitCode = await runDoctor({ workspace: workspacePath, json: true, quiet: true });
    return { exitCode, blocked: exitCode !== 0, message: `doctor exit ${exitCode}` };
  });

  await stage('contract-evidence', async () => {
    const result = await verifyWorkspaceContract({ workspacePath, strict: true });
    await writeWorkspaceContractVerifyEvidence({ workspacePath, result });
    return {
      exitCode: result.status === 'passed' ? 0 : 1,
      blocked: result.status !== 'passed',
      message: `contract ${result.status}`,
    };
  });

  await stage('analyze-evidence', async () => {
    const result = await runAnalyze({ workspacePath, json: true, strict: false });
    return {
      blocked:
        result.summary.verdict === 'blocked' ||
        (input.strict === true && result.summary.verdict === 'needs-attention'),
      exitCode:
        result.summary.verdict === 'blocked' ||
        (input.strict === true && result.summary.verdict === 'needs-attention')
          ? 1
          : 0,
      message: `analyze ${result.summary.verdict} (${result.summary.score}/100)`,
    };
  });

  await stage('readiness-evidence', async () => {
    const result = await evaluateReleaseReadiness({
      startPath: workspacePath,
      writeReport: true,
      skipVerify: true,
    });
    return {
      blocked:
        result.overallStatus === 'fail' ||
        (input.strict === true && result.overallStatus === 'warn'),
      exitCode:
        result.overallStatus === 'fail' ||
        (input.strict === true && result.overallStatus === 'warn')
          ? 1
          : 0,
      message: `pre-verify readiness ${result.overallStatus}`,
    };
  });

  await stage('verify', async () => {
    const verify = await buildWorkspaceVerify({ workspacePath, fromImpactPath: A.impact });
    await writeWorkspaceVerify(verify, workspacePath);
    const gate = evaluateWorkspaceVerifyGate(verify, { strict: input.strict === true });
    await recordWorkspaceHistory(workspacePath, historyEntryFromVerify(verify, gate.passed));
    return {
      blocked: !gate.passed,
      exitCode: gate.exitCode,
      message: `${verify.summary.verdict}; gate ${gate.passed ? 'passed' : 'blocked'}`,
    };
  });

  await stage('context', async () => {
    const context = await buildWorkspaceAgentContext({
      workspacePath,
      model: requireModel(),
      agent: input.agent ?? 'generic',
      includeEvidence: true,
    });
    await writeWorkspaceAgentContext(context, workspacePath);
    return { message: `context grounded for ${context.agent}` };
  });

  await stage('agent-sync', async () => {
    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      agent: input.agent ?? 'generic',
      write: true,
      refreshContext: false,
      strict: false,
      preset: 'enterprise',
    });
    return { message: `${result.writtenFiles.length} grounding files written` };
  });

  await stage('explain', async () => {
    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
    });
    await writeWorkspaceExplainReport(report, workspacePath);
    return { message: report.summary };
  });

  const hasBlocked = stages.some((item) => item.status === 'blocked');
  const status = hardFailure ? 'failed' : hasBlocked ? 'blocked' : 'passed';
  const exitCode: 0 | 1 | 2 = hardFailure ? 1 : status === 'blocked' ? 2 : 0;
  const report: WorkspaceIntelligenceRunReport = {
    schemaVersion: WORKSPACE_INTELLIGENCE_RUN_SCHEMA_VERSION,
    chainSchemaVersion: WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workspacePath,
    baselineCreated,
    preflight,
    status,
    exitCode,
    stages,
    artifactPath: REPORT_PATH,
  };
  assertWorkspaceIntelligenceRunSemantics(report);
  await writeWorkspaceArtifactJson(workspacePath, REPORT_PATH, report);
  return report;
}
