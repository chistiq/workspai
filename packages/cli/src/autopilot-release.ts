import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execa } from 'execa';
import { runWorkspaceStage, type WorkspaceRunReport } from './workspace-run.js';
import { findWorkspaceRootUp } from './utils/workspace-root.js';
import {
  publishWorkspaceRunStageReport,
  WORKSPACE_RUN_LAST_REPORT_FILENAME,
} from './utils/workspace-run-evidence.js';
import {
  firstExistingWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';

export type AutopilotReleaseMode = 'audit' | 'safe-fix' | 'enforce';
export type AutopilotStageStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface AutopilotReleaseOptions {
  workspacePath: string;
  mode: AutopilotReleaseMode;
  since?: string;
  parallel?: boolean;
  maxWorkers?: number;
  json?: boolean;
  output?: string;
  skipPipelineStages?: boolean;
}

export interface AutopilotStageResult {
  name:
    | 'doctor-workspace'
    | 'analyze'
    | 'readiness'
    | 'remediation-plan'
    | 'remediation-apply'
    | 'workspace-run-test-build';
  status: AutopilotStageStatus;
  durationMs: number;
  summary: string;
}

export interface AutopilotReleaseReport {
  schemaVersion: (typeof WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS)['autopilotReleaseLastRun']['schemaVersion'];
  generatedAt: string;
  workspacePath: string;
  mode: AutopilotReleaseMode;
  summary: {
    releaseScore: number;
    verdict: 'approved' | 'blocked' | 'partial';
    blockers: number;
    warnings: number;
    safeFixesApplied: number;
    manualActions: number;
    exitCode: 0 | 1 | 2 | 3;
  };
  stages: AutopilotStageResult[];
  blockingReasons: string[];
  warningReasons: string[];
  nextActions: string[];
  artifacts: {
    reportPath: string;
    /** Stable alias for dashboards and `--output` defaults (same payload as reportPath). */
    aliasEvidencePath: string;
    analyzeEvidencePath?: string;
    readinessEvidencePath?: string;
    /** Canonical multi-stage workspace run evidence (test + build stages). */
    workspaceRunEvidencePath?: string;
    workspaceRunTestPath?: string;
    workspaceRunBuildPath?: string;
  };
  enterpriseControls?: {
    jsonReady: boolean;
    evidencePath: string;
    aliasEvidencePath: string;
  };
}

export const AUTOPILOT_RELEASE_LAST_RUN_FILENAME = 'autopilot-release-last-run.json';
export const AUTOPILOT_RELEASE_ALIAS_FILENAME = 'autopilot-release.json';

interface CommandRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  crashed: boolean;
}

function parseJsonOutput<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function resolveWorkspacePath(candidatePath: string): string {
  const absolute = path.resolve(candidatePath);
  const scoped = findWorkspaceRootUp(absolute);
  if (!scoped) {
    throw new Error('No Workspai workspace found in current directory or parents');
  }
  return scoped;
}

async function runRapidkitSelfCommand(args: string[], cwd: string): Promise<CommandRunResult> {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'RapidKit entrypoint is unavailable for autopilot execution.',
      crashed: true,
    };
  }

  try {
    const result = await execa(process.execPath, [entrypoint, ...args], {
      cwd,
      reject: false,
      env: {
        ...process.env,
        RAPIDKIT_AUTOPILOT_CHILD: '1',
      },
    });

    return {
      exitCode: Number(result.exitCode ?? 1),
      stdout: result.stdout,
      stderr: result.stderr,
      crashed: false,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      crashed: true,
    };
  }
}

function stageStatusFromReadiness(readinessStatus: string): AutopilotStageStatus {
  const normalized = readinessStatus.toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (normalized === 'warn') return 'warn';
  if (normalized === 'fail') return 'fail';
  return 'warn';
}

function stageStatusFromWorkspaceRun(report: WorkspaceRunReport): AutopilotStageStatus {
  if (report.summary.failed > 0) return 'fail';
  if (report.gates.results.some((gate) => gate.status === 'fail')) return 'fail';
  if (report.gates.results.some((gate) => gate.status === 'warn')) return 'warn';
  return 'pass';
}

function computeReleaseScore(stages: AutopilotStageResult[]): number {
  const scored = stages.filter((stage) => stage.status !== 'skipped');
  if (scored.length === 0) return 100;

  const total = scored.reduce((sum, stage) => {
    if (stage.status === 'pass') return sum + 1;
    if (stage.status === 'warn') return sum + 0.6;
    return sum;
  }, 0);

  return Math.round((total / scored.length) * 100);
}

function buildNextActions(report: {
  mode: AutopilotReleaseMode;
  executionError: boolean;
  blockers: string[];
  hasWarnings: boolean;
}): string[] {
  if (report.executionError) {
    return [
      'Re-run: npx workspai autopilot release --mode audit --json',
      'Inspect .workspai/reports/autopilot-release-last-run.json for execution failure details',
    ];
  }

  if (report.blockers.length > 0) {
    return [
      'Run: npx workspai doctor workspace --plan',
      'Run: npx workspai readiness --json --strict',
      'Run: npx workspai workspace run test --affected --strict',
    ];
  }

  if (report.hasWarnings && report.mode !== 'enforce') {
    return [
      'Review warning-level findings in autopilot report',
      'Optionally run: npx workspai autopilot release --mode safe-fix',
    ];
  }

  return ['Workspace is release-ready based on current autopilot policy'];
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export async function runAutopilotRelease(
  inputOptions: AutopilotReleaseOptions
): Promise<AutopilotReleaseReport> {
  const workspacePath = resolveWorkspacePath(inputOptions.workspacePath);
  const mode = inputOptions.mode;

  const stages: AutopilotStageResult[] = [];
  const blockingReasons: string[] = [];
  let readinessEvidencePath: string | undefined;
  let analyzeEvidencePath: string | undefined;
  let workspaceRunEvidencePath: string | undefined;
  let workspaceRunTestPath: string | undefined;
  let workspaceRunBuildPath: string | undefined;
  let safeFixesApplied = 0;
  let executionError = false;
  let plannedRemediationSteps = 0;
  let plannedExecutableRemediationSteps = 0;

  let doctorStageIndex = -1;
  let readinessStageIndex = -1;
  let doctorStatus: AutopilotStageStatus = 'skipped';
  let readinessStatus: AutopilotStageStatus = 'skipped';

  const doctorGateArgs =
    mode === 'enforce'
      ? (['doctor', 'workspace', '--json', '--strict'] as const)
      : (['doctor', 'workspace', '--json', '--ci'] as const);

  if (inputOptions.skipPipelineStages) {
    stages.push(
      {
        name: 'doctor-workspace',
        status: 'skipped',
        durationMs: 0,
        summary: 'doctor stage skipped (pipeline already executed)',
      },
      {
        name: 'analyze',
        status: 'skipped',
        durationMs: 0,
        summary: 'analyze stage skipped (pipeline already executed)',
      },
      {
        name: 'readiness',
        status: 'skipped',
        durationMs: 0,
        summary: 'readiness stage skipped (pipeline already executed)',
      }
    );
  } else {
    const doctorStart = Date.now();
    const doctorRun = await runRapidkitSelfCommand([...doctorGateArgs], workspacePath);
    const doctorDuration = Date.now() - doctorStart;

    doctorStatus = 'pass';
    if (doctorRun.crashed) {
      doctorStatus = 'fail';
      executionError = true;
      blockingReasons.push(
        `doctor workspace execution error: ${doctorRun.stderr || 'unknown error'}`
      );
    } else if (doctorRun.exitCode === 1) {
      doctorStatus = 'fail';
      blockingReasons.push('doctor workspace command failed or reported errors');
    } else if (doctorRun.exitCode === 2) {
      doctorStatus = 'warn';
      blockingReasons.push('doctor workspace reported warnings');
    } else if (doctorRun.exitCode !== 0) {
      doctorStatus = 'fail';
      blockingReasons.push('doctor workspace command failed');
    } else {
      const payload = parseJsonOutput<Record<string, unknown>>(doctorRun.stdout);
      const healthScore =
        payload && payload.healthScore && typeof payload.healthScore === 'object'
          ? (payload.healthScore as Record<string, unknown>)
          : {};
      const errors = Number(healthScore.errors ?? 0);
      const warnings = Number(healthScore.warnings ?? 0);

      if (Number.isFinite(errors) && errors > 0) {
        doctorStatus = 'fail';
        blockingReasons.push(`doctor workspace reports ${errors} error(s)`);
      } else if (Number.isFinite(warnings) && warnings > 0) {
        doctorStatus = 'warn';
      }
    }

    doctorStageIndex =
      stages.push({
        name: 'doctor-workspace',
        status: doctorStatus,
        durationMs: doctorDuration,
        summary:
          doctorStatus === 'pass'
            ? 'doctor workspace passed'
            : doctorStatus === 'warn'
              ? 'doctor workspace reported warnings'
              : 'doctor workspace reported errors',
      }) - 1;

    if (mode === 'enforce' && doctorStatus === 'warn') {
      blockingReasons.push('doctor workspace reported warnings under enforce mode');
    }

    const analyzeStart = Date.now();
    const analyzeRun = await runRapidkitSelfCommand(['analyze', '--json'], workspacePath);
    const analyzeDuration = Date.now() - analyzeStart;
    analyzeEvidencePath =
      (await firstExistingWorkspaceArtifactPath(
        workspacePath,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze
      )) ?? resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze);

    let analyzeStatus: AutopilotStageStatus = 'pass';
    if (analyzeRun.crashed) {
      analyzeStatus = 'fail';
      executionError = true;
      blockingReasons.push(`analyze execution error: ${analyzeRun.stderr || 'unknown error'}`);
    } else if (analyzeRun.exitCode !== 0) {
      analyzeStatus = analyzeRun.exitCode === 2 ? 'warn' : 'fail';
      blockingReasons.push(
        analyzeRun.exitCode === 2
          ? 'analyze reported needs-attention verdict'
          : 'analyze command failed or reported blocked verdict'
      );
    } else {
      const payload = parseJsonOutput<Record<string, unknown>>(analyzeRun.stdout);
      const summary =
        payload && payload.summary && typeof payload.summary === 'object'
          ? (payload.summary as Record<string, unknown>)
          : {};
      const verdict = String(summary.verdict ?? 'ready');
      if (verdict === 'blocked') {
        analyzeStatus = 'fail';
        blockingReasons.push('analyze reported blocked verdict');
      } else if (verdict === 'needs-attention') {
        analyzeStatus = 'warn';
      }
    }

    stages.push({
      name: 'analyze',
      status: analyzeStatus,
      durationMs: analyzeDuration,
      summary:
        analyzeStatus === 'pass'
          ? 'analyze passed'
          : analyzeStatus === 'warn'
            ? 'analyze reported needs-attention'
            : 'analyze reported blocked verdict',
    });

    if (mode === 'enforce' && analyzeStatus === 'warn') {
      blockingReasons.push('analyze reported warnings under enforce mode');
    }

    const readinessStart = Date.now();
    const readinessRun = await runRapidkitSelfCommand(['readiness', '--json'], workspacePath);
    const readinessDuration = Date.now() - readinessStart;

    readinessStatus = 'fail';
    if (readinessRun.crashed) {
      readinessStatus = 'fail';
      executionError = true;
      blockingReasons.push(`readiness execution error: ${readinessRun.stderr || 'unknown error'}`);
    } else if (readinessRun.exitCode !== 0) {
      readinessStatus = 'fail';
      blockingReasons.push('readiness command failed');
    } else {
      const payload = parseJsonOutput<Record<string, unknown>>(readinessRun.stdout);
      const overallStatus = String(payload?.overallStatus ?? 'fail');
      readinessStatus = stageStatusFromReadiness(overallStatus);

      if (typeof payload?.evidencePath === 'string' && payload.evidencePath.trim().length > 0) {
        readinessEvidencePath = payload.evidencePath;
      }

      if (readinessStatus === 'fail') {
        const reasons = Array.isArray(payload?.blockingReasons)
          ? payload?.blockingReasons.filter((item): item is string => typeof item === 'string')
          : [];

        if (reasons.length > 0) {
          blockingReasons.push(...reasons.map((reason) => `readiness: ${reason}`));
        } else {
          blockingReasons.push('readiness overall status is fail');
        }
      }
    }

    readinessStageIndex =
      stages.push({
        name: 'readiness',
        status: readinessStatus,
        durationMs: readinessDuration,
        summary: `readiness overall status is ${readinessStatus}`,
      }) - 1;

    if (mode === 'enforce' && readinessStatus === 'warn') {
      blockingReasons.push('readiness reported warnings under enforce mode');
    }
  }

  const planStart = Date.now();
  const planRun = await runRapidkitSelfCommand(
    ['doctor', 'workspace', '--plan', '--json'],
    workspacePath
  );
  const planDuration = Date.now() - planStart;

  let planStatus: AutopilotStageStatus = 'warn';
  if (planRun.crashed) {
    planStatus = 'fail';
    executionError = true;
    blockingReasons.push(
      `doctor remediation plan execution error: ${planRun.stderr || 'unknown error'}`
    );
  } else if (planRun.exitCode !== 0) {
    planStatus = 'fail';
    blockingReasons.push('doctor remediation plan command failed');
  } else {
    const payload = parseJsonOutput<Record<string, unknown>>(planRun.stdout);
    const remediationPlan =
      payload && payload.remediationPlan && typeof payload.remediationPlan === 'object'
        ? (payload.remediationPlan as Record<string, unknown>)
        : null;

    const totalSteps = Number(remediationPlan?.totalSteps ?? 0);
    const executableSteps = Number(remediationPlan?.executableSteps ?? 0);

    if (Number.isFinite(totalSteps) && totalSteps > 0) {
      plannedRemediationSteps = totalSteps;
    }
    if (Number.isFinite(executableSteps) && executableSteps > 0) {
      plannedExecutableRemediationSteps = executableSteps;
    }

    if (Number.isFinite(totalSteps) && totalSteps === 0) {
      planStatus = 'pass';
    } else {
      planStatus = 'warn';
    }
  }

  stages.push({
    name: 'remediation-plan',
    status: planStatus,
    durationMs: planDuration,
    summary:
      planStatus === 'pass' ? 'no remediation steps required' : 'remediation steps available',
  });

  if (mode === 'enforce' && planStatus === 'warn') {
    blockingReasons.push('remediation plan has pending steps under enforce mode');
  }

  if (mode === 'safe-fix') {
    const applyStart = Date.now();
    const applyRun = await runRapidkitSelfCommand(
      ['doctor', 'workspace', '--apply'],
      workspacePath
    );
    const applyDuration = Date.now() - applyStart;

    const applyStatus: AutopilotStageStatus =
      applyRun.crashed || applyRun.exitCode !== 0 ? 'fail' : 'pass';
    if (applyRun.crashed) {
      executionError = true;
      blockingReasons.push(
        `doctor remediation apply execution error: ${applyRun.stderr || 'unknown error'}`
      );
    } else if (applyStatus === 'fail') {
      blockingReasons.push('doctor remediation apply failed');
    } else {
      safeFixesApplied =
        plannedExecutableRemediationSteps > 0
          ? plannedExecutableRemediationSteps
          : plannedRemediationSteps > 0
            ? plannedRemediationSteps
            : 1;

      // Re-validate core gates after safe remediation apply.
      const postDoctorRun = await runRapidkitSelfCommand(
        ['doctor', 'workspace', '--json'],
        workspacePath
      );
      if (postDoctorRun.crashed) {
        doctorStatus = 'fail';
        executionError = true;
        blockingReasons.push(
          `post-apply doctor execution error: ${postDoctorRun.stderr || 'unknown error'}`
        );
      } else if (postDoctorRun.exitCode !== 0) {
        doctorStatus = 'fail';
        blockingReasons.push('post-apply doctor workspace command failed');
      } else {
        const postDoctorPayload = parseJsonOutput<Record<string, unknown>>(postDoctorRun.stdout);
        const postDoctorHealth =
          postDoctorPayload &&
          postDoctorPayload.healthScore &&
          typeof postDoctorPayload.healthScore === 'object'
            ? (postDoctorPayload.healthScore as Record<string, unknown>)
            : {};
        const postDoctorErrors = Number(postDoctorHealth.errors ?? 0);
        const postDoctorWarnings = Number(postDoctorHealth.warnings ?? 0);

        if (Number.isFinite(postDoctorErrors) && postDoctorErrors > 0) {
          doctorStatus = 'fail';
          blockingReasons.push(`post-apply doctor reports ${postDoctorErrors} error(s)`);
        } else if (Number.isFinite(postDoctorWarnings) && postDoctorWarnings > 0) {
          doctorStatus = 'warn';
        } else {
          doctorStatus = 'pass';
        }
      }
      if (doctorStageIndex >= 0) {
        stages[doctorStageIndex].status = doctorStatus;
        stages[doctorStageIndex].summary = `doctor workspace post-apply status is ${doctorStatus}`;
      }

      const postReadinessRun = await runRapidkitSelfCommand(['readiness', '--json'], workspacePath);
      if (postReadinessRun.crashed) {
        readinessStatus = 'fail';
        executionError = true;
        blockingReasons.push(
          `post-apply readiness execution error: ${postReadinessRun.stderr || 'unknown error'}`
        );
      } else if (postReadinessRun.exitCode !== 0) {
        readinessStatus = 'fail';
        blockingReasons.push('post-apply readiness command failed');
      } else {
        const postReadinessPayload = parseJsonOutput<Record<string, unknown>>(
          postReadinessRun.stdout
        );
        const postReadinessOverall = String(postReadinessPayload?.overallStatus ?? 'fail');
        readinessStatus = stageStatusFromReadiness(postReadinessOverall);

        if (
          typeof postReadinessPayload?.evidencePath === 'string' &&
          postReadinessPayload.evidencePath.trim().length > 0
        ) {
          readinessEvidencePath = postReadinessPayload.evidencePath;
        }

        if (readinessStatus === 'fail') {
          const postReadinessReasons = Array.isArray(postReadinessPayload?.blockingReasons)
            ? postReadinessPayload?.blockingReasons.filter(
                (item): item is string => typeof item === 'string'
              )
            : [];
          if (postReadinessReasons.length > 0) {
            blockingReasons.push(
              ...postReadinessReasons.map((reason) => `post-apply readiness: ${reason}`)
            );
          } else {
            blockingReasons.push('post-apply readiness overall status is fail');
          }
        }
      }
      if (readinessStageIndex >= 0) {
        stages[readinessStageIndex].status = readinessStatus;
        stages[readinessStageIndex].summary =
          `readiness post-apply overall status is ${readinessStatus}`;
      }
    }

    stages.push({
      name: 'remediation-apply',
      status: applyStatus,
      durationMs: applyDuration,
      summary:
        applyStatus === 'pass'
          ? 'safe remediation apply completed'
          : 'safe remediation apply failed',
    });
  } else {
    stages.push({
      name: 'remediation-apply',
      status: 'skipped',
      durationMs: 0,
      summary: 'remediation apply is skipped for this mode',
    });
  }

  const stageRunStart = Date.now();
  let stageRunStatus: AutopilotStageStatus = 'pass';
  let stageRunSummary = 'workspace test/build completed for selected projects';

  try {
    const testReport = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      since: inputOptions.since,
      parallel: inputOptions.parallel,
      maxWorkers: inputOptions.maxWorkers,
      strict: true,
      json: true,
      enforceGates: false,
    });
    workspaceRunEvidencePath = resolveWorkspaceArtifactPath(
      workspacePath,
      path.join('.workspai', 'reports', WORKSPACE_RUN_LAST_REPORT_FILENAME)
    );
    await publishWorkspaceRunStageReport(workspacePath, testReport);
    workspaceRunTestPath = workspaceRunEvidencePath;

    const testStatus = stageStatusFromWorkspaceRun(testReport);
    if (testStatus === 'fail') {
      stageRunStatus = 'fail';
      stageRunSummary = 'workspace test stage failed for selected projects';
      blockingReasons.push('workspace run test failed for selected projects');
    } else {
      if (testStatus === 'warn') {
        stageRunStatus = 'warn';
        stageRunSummary = 'workspace test stage completed with warnings';
        if (mode === 'enforce') {
          blockingReasons.push('workspace run test reported warnings under enforce mode');
        }
      }

      const buildReport = await runWorkspaceStage({
        workspacePath,
        stage: 'build',
        affected: true,
        since: inputOptions.since,
        parallel: inputOptions.parallel,
        maxWorkers: inputOptions.maxWorkers,
        strict: true,
        json: true,
        enforceGates: false,
      });
      await publishWorkspaceRunStageReport(workspacePath, buildReport);
      workspaceRunBuildPath = workspaceRunEvidencePath;

      const buildStatus = stageStatusFromWorkspaceRun(buildReport);
      if (buildStatus === 'fail') {
        stageRunStatus = 'fail';
        stageRunSummary = 'workspace build stage failed for selected projects';
        blockingReasons.push('workspace run build failed for selected projects');
      } else if (buildStatus === 'warn') {
        stageRunStatus = 'warn';
        stageRunSummary = 'workspace test/build completed with warnings';
        if (mode === 'enforce') {
          blockingReasons.push('workspace run test/build reported warnings under enforce mode');
        }
      }
    }
  } catch (error) {
    stageRunStatus = 'fail';
    stageRunSummary = 'workspace test/build orchestration failed';
    executionError = true;
    blockingReasons.push(
      `workspace run orchestration error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const stageRunDuration = Date.now() - stageRunStart;

  stages.push({
    name: 'workspace-run-test-build',
    status: stageRunStatus,
    durationMs: stageRunDuration,
    summary: stageRunSummary,
  });

  const warnCount = stages.filter((stage) => stage.status === 'warn').length;
  const failCount = stages.filter((stage) => stage.status === 'fail').length;

  const hasStrictBlockers =
    mode === 'enforce'
      ? stages.some((stage) => stage.status === 'warn' || stage.status === 'fail')
      : failCount > 0;

  const dedupedReasons = [...new Set(blockingReasons)];
  const blockers = executionError || hasStrictBlockers ? Math.max(1, dedupedReasons.length) : 0;
  const effectiveBlockingReasons = blockers > 0 ? dedupedReasons : [];
  const warningReasons = blockers === 0 ? dedupedReasons : [];

  const releaseScore = computeReleaseScore(stages);
  const verdict = executionError
    ? 'blocked'
    : hasStrictBlockers
      ? 'blocked'
      : warnCount > 0
        ? 'partial'
        : 'approved';

  const exitCode: 0 | 1 | 2 | 3 = executionError
    ? 3
    : hasStrictBlockers
      ? 1
      : warnCount > 0
        ? 2
        : 0;
  const nextActions = buildNextActions({
    mode,
    executionError,
    blockers: dedupedReasons,
    hasWarnings: warnCount > 0,
  });

  const reportsDir = resolveWorkspaceArtifactPath(workspacePath, '.workspai/reports');
  const reportPath = path.join(reportsDir, AUTOPILOT_RELEASE_LAST_RUN_FILENAME);
  const aliasEvidencePath = path.join(reportsDir, AUTOPILOT_RELEASE_ALIAS_FILENAME);

  const report: AutopilotReleaseReport = {
    schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.autopilotReleaseLastRun.schemaVersion,
    generatedAt: new Date().toISOString(),
    workspacePath,
    mode,
    summary: {
      releaseScore,
      verdict,
      blockers,
      warnings: warnCount,
      safeFixesApplied,
      manualActions: dedupedReasons.length,
      exitCode,
    },
    stages,
    blockingReasons: effectiveBlockingReasons,
    warningReasons,
    nextActions,
    artifacts: {
      reportPath,
      aliasEvidencePath,
      analyzeEvidencePath,
      readinessEvidencePath,
      workspaceRunEvidencePath,
      workspaceRunTestPath,
      workspaceRunBuildPath,
    },
    enterpriseControls: {
      jsonReady: true,
      evidencePath: `.workspai/reports/${AUTOPILOT_RELEASE_LAST_RUN_FILENAME}`,
      aliasEvidencePath: `.workspai/reports/${AUTOPILOT_RELEASE_ALIAS_FILENAME}`,
    },
  };

  await writeWorkspaceArtifactJson(
    workspacePath,
    `.workspai/reports/${AUTOPILOT_RELEASE_LAST_RUN_FILENAME}`,
    report
  );
  await writeWorkspaceArtifactJson(
    workspacePath,
    `.workspai/reports/${AUTOPILOT_RELEASE_ALIAS_FILENAME}`,
    report
  );
  if (inputOptions.output) {
    await writeJsonFile(path.resolve(inputOptions.output), report);
  }

  if (!inputOptions.json) {
    console.log(chalk.bold.cyan('\n🚀 Workspai Autopilot Release\n'));
    console.log(chalk.bold(`Workspace: ${chalk.cyan(path.basename(workspacePath))}`));
    console.log(chalk.gray(`Path: ${workspacePath}`));
    console.log(chalk.white(`Mode: ${mode}`));
    console.log(
      chalk.white(
        `Verdict: ${
          report.summary.verdict === 'approved'
            ? chalk.green('approved')
            : report.summary.verdict === 'partial'
              ? chalk.yellow('partial')
              : chalk.red('blocked')
        }`
      )
    );
    console.log(chalk.white(`Release score: ${report.summary.releaseScore}`));

    for (const stage of report.stages) {
      const indicator =
        stage.status === 'pass'
          ? chalk.green('PASS')
          : stage.status === 'warn'
            ? chalk.yellow('WARN')
            : stage.status === 'skipped'
              ? chalk.gray('SKIP')
              : chalk.red('FAIL');
      console.log(` - ${stage.name}: ${indicator} ${stage.summary} (${stage.durationMs}ms)`);
    }

    if (report.blockingReasons.length > 0) {
      console.log(chalk.bold.red('\nBlocking reasons:'));
      for (const reason of report.blockingReasons) {
        console.log(chalk.red(` - ${reason}`));
      }
    }

    if (report.warningReasons.length > 0) {
      console.log(chalk.bold.yellow('\nWarning reasons:'));
      for (const reason of report.warningReasons) {
        console.log(chalk.yellow(` - ${reason}`));
      }
    }

    if (report.nextActions.length > 0) {
      console.log(chalk.bold('\nNext actions:'));
      for (const action of report.nextActions) {
        console.log(chalk.gray(` - ${action}`));
      }
    }

    console.log(chalk.gray(`\nReport: ${report.artifacts.reportPath}`));
  }

  return report;
}
