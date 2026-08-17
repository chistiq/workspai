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
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';
import {
  buildWorkspaceAgentReportsIndex,
  syncWorkspaceAgentGrounding,
} from './workspace-agent-sync.js';
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
import {
  withWorkspaceArtifactLock,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import { emitWorkspacePhase } from './observability/cli-progress.js';

export type { WorkspaceIntelligenceRunReport } from './contracts/workspace-intelligence-run-contract.js';

export const WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH = A.intelligenceRun;
export const WORKSPACE_INTELLIGENCE_RUN_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.intelligenceRun;
const REPORT_PATH = WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH;

type IntelligenceMilestoneKind = 'preflight' | 'stage';
type IntelligenceMilestoneStatus = 'started' | 'passed' | 'blocked' | 'failed' | 'skipped';

function emitIntelligenceMilestone(input: {
  id: WorkspaceIntelligencePreflightId | WorkspaceIntelligenceStepId;
  kind: IntelligenceMilestoneKind;
  status: IntelligenceMilestoneStatus;
  message: string;
}): void {
  emitWorkspacePhase({
    action: 'intelligence',
    status:
      input.status === 'started'
        ? 'started'
        : input.status === 'passed'
          ? 'succeeded'
          : input.status === 'failed'
            ? 'failed'
            : 'warn',
    message: input.message,
    metadata: {
      phase: `workspace.intelligence.${input.kind}.${input.id}`,
      intelligenceMilestoneId: input.id,
      intelligenceMilestoneKind: input.kind,
      intelligenceMilestoneStatus: input.status,
    },
  });
}

export async function runWorkspaceIntelligenceChain(input: {
  workspacePath: string;
  strict?: boolean;
  agent?: string;
}): Promise<WorkspaceIntelligenceRunReport> {
  const workspacePath = path.resolve(input.workspacePath);
  return withWorkspaceArtifactLock(
    workspacePath,
    REPORT_PATH,
    () => runWorkspaceIntelligenceChainLocked({ ...input, workspacePath }),
    {
      // A full enterprise scan can legitimately take several minutes. A
      // competing writer must wait for the governed run instead of publishing
      // a newer model with no matching run receipt.
      timeoutMs: 15 * 60_000,
      staleAfterMs: 30_000,
    }
  );
}

async function runWorkspaceIntelligenceChainLocked(input: {
  workspacePath: string;
  strict?: boolean;
  agent?: string;
}): Promise<WorkspaceIntelligenceRunReport> {
  const workspacePath = input.workspacePath;
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
      emitIntelligenceMilestone({
        id,
        kind: 'preflight',
        status: 'skipped',
        message: `${id} prerequisite skipped after an upstream failure`,
      });
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
    emitIntelligenceMilestone({
      id,
      kind: 'preflight',
      status: 'started',
      message: `${id} prerequisite started`,
    });
    try {
      const result = await operation();
      emitIntelligenceMilestone({
        id,
        kind: 'preflight',
        status: 'passed',
        message: result.message,
      });
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
      const message = error instanceof Error ? error.message : String(error);
      emitIntelligenceMilestone({
        id,
        kind: 'preflight',
        status: 'failed',
        message,
      });
      preflight.push({
        id,
        status: 'failed',
        result: 'failed',
        durationMs: Date.now() - started,
        artifacts,
        message,
      });
    }
  };
  const stage = async (
    id: WorkspaceIntelligenceStepId,
    operation: () => Promise<{ exitCode?: number; blocked?: boolean; message: string }>
  ): Promise<void> => {
    const artifacts = [...WORKSPACE_INTELLIGENCE_RUNTIME_STEPS[id].produces];
    if (hardFailure) {
      emitIntelligenceMilestone({
        id,
        kind: 'stage',
        status: 'skipped',
        message: `${id} skipped after an upstream failure`,
      });
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
    emitIntelligenceMilestone({
      id,
      kind: 'stage',
      status: 'started',
      message: `${id} started`,
    });
    try {
      const result = await operation();
      const exitCode = result.exitCode ?? 0;
      const status = result.blocked || exitCode !== 0 ? 'blocked' : 'passed';
      emitIntelligenceMilestone({
        id,
        kind: 'stage',
        status,
        message: result.message,
      });
      stages.push({
        id,
        status,
        durationMs: Date.now() - started,
        artifacts,
        exitCode,
        message: result.message,
      });
    } catch (error) {
      hardFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      emitIntelligenceMilestone({
        id,
        kind: 'stage',
        status: 'failed',
        message,
      });
      stages.push({
        id,
        status: 'failed',
        durationMs: Date.now() - started,
        artifacts,
        exitCode: 1,
        message,
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
    const exitCode = await runDoctor({
      workspace: workspacePath,
      json: true,
      quiet: true,
      profile: input.strict === true ? 'enterprise-strict' : 'local',
    });
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
    const result = await runAnalyze({
      workspacePath,
      json: true,
      strict: input.strict === true,
    });
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
    let result = await syncWorkspaceAgentGrounding({
      workspacePath,
      agent: input.agent ?? 'generic',
      // The canonical chain always publishes portable discovery surfaces for
      // every supported agent host. `--for-agent` selects the shared context
      // consumer; it must not make an adopted project undiscoverable when the
      // eventual host is not known yet.
      targets: ['all'],
      write: true,
      refreshContext: false,
      strict: input.strict === true,
      preset: 'enterprise',
    });
    let reconciled = false;
    const postGroundingSnapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
    if (postGroundingSnapshot.status === 'miss') {
      if (postGroundingSnapshot.reason !== 'live-input-mismatch') {
        throw new Error(
          `Agent grounding left canonical evidence invalid (${postGroundingSnapshot.reason}).`
        );
      }
      // Managed project grounding can update tracked AGENTS.md/.gitignore
      // after the first model stage. Seal those CLI-owned writes into a fresh
      // Model/Graph pair, then republish context and grounding once. Without
      // this reconciliation the intelligence command can invalidate its own
      // output before a Goal or graph consumer gets a chance to read it.
      model = {
        ...(await buildWorkspaceModel({ workspacePath, includeEvidence: true })),
        build: createWorkspaceModelBuildProvenance({
          mode: 'full',
          engineStatus: 'disabled',
        }),
      };
      await writeWorkspaceModel(model, workspacePath);
      const reconciledContext = await buildWorkspaceAgentContext({
        workspacePath,
        model,
        agent: input.agent ?? 'generic',
        includeEvidence: true,
      });
      await writeWorkspaceAgentContext(reconciledContext, workspacePath);
      const secondPass = await syncWorkspaceAgentGrounding({
        workspacePath,
        agent: input.agent ?? 'generic',
        targets: ['all'],
        write: true,
        refreshContext: false,
        strict: input.strict === true,
        preset: 'enterprise',
      });
      result = {
        ...secondPass,
        writtenFiles: [...new Set([...result.writtenFiles, ...secondPass.writtenFiles])].sort(),
        strictViolations: [
          ...new Set([...(result.strictViolations ?? []), ...(secondPass.strictViolations ?? [])]),
        ].sort(),
      };
      const sealedSnapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
      if (sealedSnapshot.status === 'miss') {
        throw new Error(
          `Agent grounding reconciliation did not produce fresh canonical evidence (${sealedSnapshot.reason}).`
        );
      }
      reconciled = true;
    }
    const strictViolations = result.strictViolations ?? [];
    const blocked = input.strict === true && strictViolations.length > 0;
    return {
      blocked,
      exitCode: blocked ? 2 : 0,
      message: blocked
        ? `${result.writtenFiles.length} grounding files written; ${strictViolations.length} strict grounding violation(s): ${strictViolations.join('; ')}`
        : `${result.writtenFiles.length} grounding files written; portable entry surfaces prepared for all supported hosts${reconciled ? '; canonical Model/Graph freshness sealed' : ''}`,
    };
  });

  await stage('explain', async () => {
    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
    });
    await writeWorkspaceExplainReport(report, workspacePath);
    const strictBlockedStages =
      input.strict === true
        ? stages.filter((item) => item.status === 'blocked').map((item) => item.id)
        : [];
    return {
      message:
        strictBlockedStages.length > 0 && report.blocking !== true
          ? `Strict policy blocked advisory or incomplete evidence in ${strictBlockedStages.join(', ')}. ${report.summary}`
          : report.summary,
    };
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
  // Agent Sync precedes Explain in the canonical chain, so its first INDEX
  // projection cannot observe the Explain report (or this run receipt) yet.
  // Republish the index after every producer has completed so consumers never
  // receive `exists:false` for artifacts the same governed run just wrote.
  const finalAgentIndex = await buildWorkspaceAgentReportsIndex({ workspacePath });
  await writeWorkspaceArtifactJson(workspacePath, A.agentIndex, finalAgentIndex);
  return report;
}
