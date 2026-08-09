import chalk from 'chalk';
import path from 'path';
import fsExtra from 'fs-extra';
import { runAnalyze } from './analyze.js';
import { runAutopilotRelease } from './autopilot-release.js';
import { runDoctor } from './doctor.js';
import { evaluateReleaseReadiness } from './readiness.js';
import { syncWorkspaceProjects, type SyncWorkspaceResult } from './workspace.js';
import { findWorkspaceRootUp } from './utils/workspace-root.js';
import {
  resolveGovernanceRunId,
  withGovernanceRunMetadata,
} from './utils/governance-report-metadata.js';
import {
  firstExistingWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { cliOperationError } from './contracts/cli-operation-result-contract.js';
import { listCanonicalDoctorFindings } from './utils/doctor-diagnosis-consumer.js';

export type PipelineStageStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface PipelineStageResult {
  name: 'sync' | 'doctor' | 'analyze' | 'readiness' | 'autopilot';
  status: PipelineStageStatus;
  durationMs: number;
  summary: string;
  exitCode?: number;
  evidencePath?: string;
  policyProfile?: string;
  blockers?: string[];
}

export interface PipelineReport {
  schemaVersion: (typeof WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS)['pipelineLastRun']['schemaVersion'];
  generatedAt: string;
  workspacePath: string;
  summary: {
    verdict: 'ready' | 'needs-attention' | 'blocked';
    exitCode: 0 | 1 | 2 | 3;
    stagesPassed: number;
    stagesWarn: number;
    stagesFailed: number;
  };
  stages: PipelineStageResult[];
  blockingReasons: string[];
  artifacts: {
    reportPath: string;
    analyzeEvidencePath?: string;
    readinessEvidencePath?: string;
    autopilotEvidencePath?: string;
  };
  agentGrounding?: {
    indexPath: string;
    writtenFiles: string[];
    blockers: string[];
  };
}

export interface PipelineOptions {
  workspacePath?: string;
  json?: boolean;
  strict?: boolean;
  skipVerify?: boolean;
  skipAnalyze?: boolean;
  skipAutopilot?: boolean;
  autopilotMode?: 'audit' | 'safe-fix' | 'enforce';
  writeReport?: boolean;
  /** Sync cross-tool agent grounding files after writing pipeline evidence (default: true). */
  agentSync?: boolean;
  noAgentSync?: boolean;
}

function stageFromExit(exitCode: number): PipelineStageStatus {
  if (exitCode === 0) return 'pass';
  if (exitCode === 2) return 'warn';
  return 'fail';
}

async function readDoctorStageEvidence(evidencePath: string): Promise<{
  policyProfile?: string;
  blockers: string[];
}> {
  try {
    const payload = fsExtra.readJsonSync(evidencePath) as Record<string, unknown>;
    const policy = payload.policyProfile as Record<string, unknown> | undefined;
    const blockers = listCanonicalDoctorFindings(payload)
      .filter((finding) => finding.status === 'blocking')
      .map((finding) => `${finding.projectName}: ${finding.message}`);
    return {
      policyProfile: typeof policy?.name === 'string' ? policy.name : undefined,
      blockers: [...new Set(blockers)].slice(0, 12),
    };
  } catch {
    return { blockers: [] };
  }
}

function computePipelineVerdict(
  stages: PipelineStageResult[]
): 'ready' | 'needs-attention' | 'blocked' {
  if (stages.some((stage) => stage.status === 'fail')) return 'blocked';
  if (stages.some((stage) => stage.status === 'warn')) return 'needs-attention';
  return 'ready';
}

function computePipelineExitCode(
  stages: PipelineStageResult[],
  executionError: boolean
): 0 | 1 | 2 | 3 {
  if (executionError) return 3;
  const failed = stages.some((stage) => stage.status === 'fail');
  const warned = stages.some((stage) => stage.status === 'warn');
  if (failed) return 1;
  if (warned) return 2;
  return 0;
}

/**
 * Keep advisory pipeline warnings non-blocking unless strict mode is enabled.
 * Execution failures and failed stages remain blocking in every mode.
 */
export function pipelineProcessExitCode(
  reportExitCode: PipelineReport['summary']['exitCode'],
  strict: boolean
): PipelineReport['summary']['exitCode'] {
  if (reportExitCode === 2 && !strict) return 0;
  return reportExitCode;
}

async function syncWorkspaceRegistryAndContract(
  workspacePath: string
): Promise<{ sync: SyncWorkspaceResult; contractSynced: boolean }> {
  const sync = await syncWorkspaceProjects(workspacePath, true);
  let contractSynced = false;
  try {
    const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
    await syncWorkspaceContract({ workspacePath });
    contractSynced = true;
  } catch {
    contractSynced = false;
  }
  return { sync, contractSynced };
}

export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineReport> {
  const requestedPath = path.resolve(options.workspacePath ?? process.cwd());
  const workspacePath = findWorkspaceRootUp(requestedPath);
  if (!workspacePath) {
    throw new Error('No Workspai workspace found in current directory or parents');
  }

  const stages: PipelineStageResult[] = [];
  const blockingReasons: string[] = [];
  let executionError = false;
  let analyzeEvidencePath: string | undefined;
  let readinessEvidencePath: string | undefined;
  let autopilotEvidencePath: string | undefined;

  const syncStart = Date.now();
  try {
    const { sync, contractSynced } = await syncWorkspaceRegistryAndContract(workspacePath);
    const syncStatus: PipelineStageStatus =
      sync.workspaceFound && (sync.added.length > 0 || sync.skipped >= 0)
        ? 'pass'
        : sync.workspaceFound
          ? 'pass'
          : 'warn';
    stages.push({
      name: 'sync',
      status: syncStatus,
      durationMs: Date.now() - syncStart,
      summary: sync.workspaceFound
        ? `registry sync complete (${sync.added.length} added, ${sync.skipped} existing)${contractSynced ? ', contract synced' : ''}`
        : 'workspace not registered in global registry; contract sync attempted',
    });
    if (!sync.workspaceFound) {
      blockingReasons.push(
        'workspace registry entry missing — run workspai create workspace or register manually'
      );
    }
  } catch (error) {
    executionError = true;
    stages.push({
      name: 'sync',
      status: 'fail',
      durationMs: Date.now() - syncStart,
      summary: `sync failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    blockingReasons.push('workspace sync stage failed');
  }

  const doctorStart = Date.now();
  try {
    const doctorExit = await runDoctor({
      workspace: true,
      json: true,
      quiet: true,
      strict: options.strict === true,
      ci: options.strict !== true,
    });
    const doctorStatus = stageFromExit(doctorExit);
    const doctorEvidence =
      (await firstExistingWorkspaceArtifactPath(
        workspacePath,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor
      )) ?? resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor);
    const doctorDetail = await readDoctorStageEvidence(doctorEvidence);
    stages.push({
      name: 'doctor',
      status: doctorStatus,
      durationMs: Date.now() - doctorStart,
      summary:
        doctorStatus === 'pass'
          ? 'doctor workspace passed'
          : doctorStatus === 'warn'
            ? 'doctor workspace reported warnings'
            : 'doctor workspace did not pass',
      exitCode: doctorExit,
      evidencePath: doctorEvidence,
      policyProfile: doctorDetail.policyProfile,
      blockers: doctorDetail.blockers,
    });
    if (doctorStatus === 'fail') {
      blockingReasons.push(
        ...(doctorDetail.blockers.length > 0
          ? doctorDetail.blockers.map((reason) => `doctor: ${reason}`)
          : ['doctor workspace gate failed'])
      );
    } else if (doctorStatus === 'warn') {
      blockingReasons.push('doctor workspace reported warnings');
    }
  } catch (error) {
    executionError = true;
    stages.push({
      name: 'doctor',
      status: 'fail',
      durationMs: Date.now() - doctorStart,
      summary: `doctor failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    blockingReasons.push('doctor workspace stage failed');
  }

  if (options.skipAnalyze) {
    stages.push({
      name: 'analyze',
      status: 'skipped',
      durationMs: 0,
      summary: 'analyze stage skipped',
    });
  } else {
    const analyzeStart = Date.now();
    try {
      const analyzeReport = await runAnalyze({
        workspacePath,
        json: true,
        strict: options.strict === true,
      });
      analyzeEvidencePath = path.isAbsolute(analyzeReport.enterpriseControls.evidencePath)
        ? analyzeReport.enterpriseControls.evidencePath
        : path.join(workspacePath, analyzeReport.enterpriseControls.evidencePath);
      const analyzeStatus: PipelineStageStatus =
        analyzeReport.summary.verdict === 'blocked'
          ? 'fail'
          : analyzeReport.summary.verdict === 'needs-attention'
            ? 'warn'
            : 'pass';
      stages.push({
        name: 'analyze',
        status: analyzeStatus,
        durationMs: Date.now() - analyzeStart,
        summary: `analyze verdict: ${analyzeReport.summary.verdict} (score ${analyzeReport.summary.score}/100)`,
        evidencePath: analyzeEvidencePath,
      });
      if (analyzeStatus === 'fail') {
        blockingReasons.push('analyze reported blocked verdict');
      } else if (analyzeStatus === 'warn') {
        blockingReasons.push('analyze reported needs-attention verdict');
      }
    } catch (error) {
      executionError = true;
      stages.push({
        name: 'analyze',
        status: 'fail',
        durationMs: Date.now() - analyzeStart,
        summary: `analyze failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      blockingReasons.push('analyze stage failed');
    }
  }

  const readinessStart = Date.now();
  try {
    const readiness = await evaluateReleaseReadiness({
      startPath: workspacePath,
      writeReport: true,
      skipVerify: options.skipVerify === true,
    });
    readinessEvidencePath = readiness.evidencePath;
    const readinessStatus: PipelineStageStatus =
      readiness.overallStatus === 'pass'
        ? 'pass'
        : readiness.overallStatus === 'warn'
          ? 'warn'
          : 'fail';
    stages.push({
      name: 'readiness',
      status: readinessStatus,
      durationMs: Date.now() - readinessStart,
      summary: `readiness overall: ${readiness.overallStatus}`,
      evidencePath: readiness.evidencePath,
    });
    if (readinessStatus === 'fail') {
      blockingReasons.push(...readiness.blockingReasons.map((reason) => `readiness: ${reason}`));
    } else if (readinessStatus === 'warn') {
      blockingReasons.push(
        ...readiness.gates
          .filter((gate) => gate.status === 'warn')
          .map((gate) => `readiness warn: ${gate.gate}: ${gate.summary}`)
      );
    }
  } catch (error) {
    executionError = true;
    stages.push({
      name: 'readiness',
      status: 'fail',
      durationMs: Date.now() - readinessStart,
      summary: `readiness failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    blockingReasons.push('readiness stage failed');
  }

  if (options.skipAutopilot) {
    stages.push({
      name: 'autopilot',
      status: 'skipped',
      durationMs: 0,
      summary: 'autopilot stage skipped',
    });
  } else {
    const autopilotStart = Date.now();
    const autopilotMode = options.autopilotMode ?? 'audit';
    try {
      const autopilotReport = await runAutopilotRelease({
        workspacePath,
        mode: autopilotMode,
        json: true,
        skipPipelineStages: true,
      });
      autopilotEvidencePath = autopilotReport.artifacts.reportPath;
      const autopilotStatus: PipelineStageStatus =
        autopilotReport.summary.verdict === 'approved'
          ? 'pass'
          : autopilotReport.summary.verdict === 'partial'
            ? 'warn'
            : 'fail';
      stages.push({
        name: 'autopilot',
        status: autopilotStatus,
        durationMs: Date.now() - autopilotStart,
        summary: `autopilot ${autopilotMode}: ${autopilotReport.summary.verdict}`,
        exitCode: autopilotReport.summary.exitCode,
        evidencePath: autopilotEvidencePath,
      });
      if (autopilotStatus !== 'pass') {
        blockingReasons.push(...autopilotReport.blockingReasons.slice(0, 5));
      }
    } catch (error) {
      executionError = true;
      stages.push({
        name: 'autopilot',
        status: 'fail',
        durationMs: Date.now() - autopilotStart,
        summary: `autopilot failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      blockingReasons.push('autopilot release stage failed');
    }
  }

  const verdict = computePipelineVerdict(stages);
  const exitCode = computePipelineExitCode(stages, executionError);
  const reportPath = path.join(workspacePath, WORKSPACE_SUPPLEMENTAL_ARTIFACTS.pipelineLastRun);

  const report: PipelineReport = {
    schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.pipelineLastRun.schemaVersion,
    generatedAt: new Date().toISOString(),
    workspacePath,
    summary: {
      verdict,
      exitCode,
      stagesPassed: stages.filter((stage) => stage.status === 'pass').length,
      stagesWarn: stages.filter((stage) => stage.status === 'warn').length,
      stagesFailed: stages.filter((stage) => stage.status === 'fail').length,
    },
    stages,
    blockingReasons: [...new Set(blockingReasons)],
    artifacts: {
      reportPath,
      analyzeEvidencePath,
      readinessEvidencePath,
      autopilotEvidencePath,
    },
  };

  if (options.writeReport !== false) {
    const enriched = withGovernanceRunMetadata(report as unknown as Record<string, unknown>, {
      commandId: 'workspacePipeline',
      exitCode,
      generatedAt: report.generatedAt,
      blockers: report.blockingReasons,
      runId: resolveGovernanceRunId(),
    });
    await writeWorkspaceArtifactJson(
      workspacePath,
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.pipelineLastRun,
      enriched
    );
  }

  const shouldSyncAgentGrounding =
    options.writeReport !== false &&
    options.noAgentSync !== true &&
    process.env.RAPIDKIT_NO_AGENT_SYNC !== '1' &&
    options.agentSync !== false;

  if (shouldSyncAgentGrounding) {
    try {
      const { syncWorkspaceAgentGrounding } = await import('./workspace-agent-sync.js');
      const syncResult = await syncWorkspaceAgentGrounding({
        workspacePath,
        write: true,
        refreshContext: true,
        strict: false,
      });
      report.agentGrounding = {
        indexPath: syncResult.indexPath,
        writtenFiles: syncResult.writtenFiles,
        blockers: syncResult.blockers,
      };
    } catch {
      // Agent grounding sync is best-effort; pipeline verdict remains authoritative.
    }
  }

  return report;
}

export async function runPipelineCommand(options: PipelineOptions): Promise<void> {
  let report: PipelineReport;
  try {
    report = await runPipeline(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(
        JSON.stringify(
          cliOperationError({
            operation: 'pipeline',
            code: 'pipeline.failed',
            message,
          }),
          null,
          2
        )
      );
    } else {
      console.log(chalk.red(`Pipeline failed: ${message}`));
    }
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(chalk.bold.cyan('\n🔗 Workspai Governance Pipeline\n'));
    console.log(chalk.bold(`Workspace: ${chalk.cyan(path.basename(report.workspacePath))}`));
    console.log(chalk.gray(`Path: ${report.workspacePath}`));
    console.log(
      chalk.white(
        `Verdict: ${report.summary.verdict}  Exit: ${report.summary.exitCode}  (${report.summary.stagesPassed} pass / ${report.summary.stagesWarn} warn / ${report.summary.stagesFailed} fail)`
      )
    );
    for (const stage of report.stages) {
      const marker =
        stage.status === 'pass'
          ? chalk.green('PASS')
          : stage.status === 'warn'
            ? chalk.yellow('WARN')
            : stage.status === 'skipped'
              ? chalk.gray('SKIP')
              : chalk.red('FAIL');
      console.log(` - ${stage.name}: ${marker} ${stage.summary}`);
    }
    if (report.blockingReasons.length > 0) {
      console.log(chalk.bold('\nBlocking reasons:'));
      for (const reason of report.blockingReasons.slice(0, 8)) {
        console.log(chalk.gray(`  • ${reason}`));
      }
    }
    console.log(chalk.gray(`\nEvidence: ${report.artifacts.reportPath}`));
    if (report.agentGrounding?.writtenFiles.length) {
      console.log(
        chalk.gray(
          `Agent grounding: ${report.agentGrounding.writtenFiles.length} file(s) synced (INDEX + AGENTS.md + Copilot/Cursor/Claude hooks)`
        )
      );
    }
  }

  const processExitCode = pipelineProcessExitCode(report.summary.exitCode, options.strict === true);
  if (processExitCode !== 0) {
    process.exit(processExitCode);
  }
}
