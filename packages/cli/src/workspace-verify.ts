import path from 'path';

import fsExtra from 'fs-extra';

import { attachRunCorrelation } from './observability/run-correlation.js';
import {
  buildWorkspaceImpact,
  hashWorkspaceModel,
  WORKSPACE_IMPACT_REPORT_PATH,
  WORKSPACE_IMPACT_SCHEMA_VERSION,
  WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
  workspaceVerificationPlan,
  type WorkspaceImpact,
  type WorkspaceImpactCommand,
  type WorkspaceImpactRisk,
} from './workspace-intelligence.js';
import { resolveWorkspaceRunStageReport } from './utils/workspace-run-evidence.js';
import type { WorkspaceRunStage } from './workspace-run.js';
import {
  buildWorkspaceModel,
  workspaceModelProjectTopology,
  type BuildWorkspaceModelOptions,
  type WorkspaceModel,
} from './workspace-model.js';
import {
  checkGraphIntegrity,
  summarizeGraphIntegrity,
  type WorkspaceGraphIntegrity,
} from './workspace-graph-integrity.js';
import { buildResolutionHintForBlocker } from './workspace-blocker-resolution-hints.js';
import { softenEmptyWorkspaceVerifyVerdict } from './workspace-scaffold.js';
import type { BlockerResolution } from './contracts/blocker-resolution-contract.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import {
  compareFreshness,
  computeProjectFreshnessHashes,
  freshnessHashRecord,
  type FreshnessComparison,
} from './workspace-graph-freshness.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { collectGitWorkingTreeObservation } from './workspace-git-observation.js';
import { assessCanonicalDoctorEvidence } from './utils/doctor-diagnosis-consumer.js';
import {
  assertDoctorEvidenceSemanticInvariants,
  isDoctorEvidencePayloadCompatible,
} from './utils/doctor-evidence-contract.js';

export const WORKSPACE_VERIFY_SCHEMA_VERSION = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.verify;
export const WORKSPACE_VERIFY_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.verify;

export type WorkspaceVerifyStepStatus = 'pass' | 'warn' | 'fail' | 'missing' | 'skipped';

export type WorkspaceVerifyStep = {
  id: string;
  label: string;
  scope: 'workspace' | 'project';
  project?: string;
  command: WorkspaceImpactCommand;
  status: WorkspaceVerifyStepStatus;
  required: boolean;
  evidencePath?: string;
  message: string;
};

export type WorkspaceVerifyVerdict = 'ready' | 'needs-attention' | 'blocked';

export type WorkspaceVerify = {
  schemaVersion: typeof WORKSPACE_VERIFY_SCHEMA_VERSION;
  generatedAt: string;
  workspacePath: string;
  mode: 'evidence';
  fromImpactRef?: string;
  scope?: string;
  impact: {
    changed: boolean;
    risk: WorkspaceImpactRisk;
    affectedProjects: number;
    recommendedCommands: number;
  };
  summary: {
    verdict: WorkspaceVerifyVerdict;
    exitCode: 0 | 1 | 2;
    stepsPassed: number;
    stepsWarn: number;
    stepsFailed: number;
    stepsMissing: number;
    stepsSkipped: number;
  };
  steps: WorkspaceVerifyStep[];
  missingEvidence: string[];
  blockingReasons: string[];
  /** Machine-readable fix/run hints for each blocking reason (Phase 3.A). */
  resolutionHints?: BlockerResolution[];
  verificationPlan: WorkspaceImpactCommand[];
  /**
   * Graph-aware coverage of the entire affected subgraph (1.11): the verdict
   * gates the changed projects **and** their transitive dependents, not just the
   * directly-changed node. `uncovered` dependents (failed/missing-required
   * evidence) become blocking reasons; `unverifiable` projects have no applicable
   * verification command and are informational only.
   */
  affectedSubgraph: WorkspaceVerifyAffectedSubgraph;
  /**
   * Structural integrity of the dependency graph (1.13). Cycles and dangling
   * edges are blocking; orphans are informational.
   */
  graphIntegrity: WorkspaceGraphIntegrity;
  /**
   * Graph-aware transitive freshness (1.18): an explicit fresh|stale|unknown
   * verdict vs the previously verified state, using content hashes chained
   * through the dependency graph.
   */
  freshness: WorkspaceVerifyFreshness;
  /**
   * Structured policy/contract violations (1.20) so consumers can render them as
   * blockers directly instead of inferring them from the exit code. In `enforce`
   * policy mode error-severity violations block; in `warn` mode they escalate to
   * needs-attention.
   */
  policyMode: string;
  policyViolations: WorkspacePolicyViolation[];
};

export type WorkspacePolicyViolation = {
  source: 'model' | 'contract';
  severity: 'error' | 'warning';
  code: string;
  message: string;
  target?: string;
};

export type WorkspaceVerifyFreshness = {
  verdict: FreshnessComparison['verdict'];
  baseline: FreshnessComparison['baseline'];
  changed: string[];
  added: string[];
  removed: string[];
  projectHashes: Record<string, string>;
};

export type WorkspaceVerifyAffectedSubgraph = {
  totalProjects: number;
  directlyChanged: string[];
  transitiveDependents: string[];
  covered: string[];
  uncovered: string[];
  unverifiable: string[];
};

export type BuildWorkspaceVerifyOptions = Pick<
  BuildWorkspaceModelOptions,
  'workspacePath' | 'includeAbsolutePaths' | 'includeEvidence' | 'observableScanDepth' | 'now'
> & {
  fromImpactPath?: string;
  scope?: string;
};

function resolveWorkspaceRelativePath(workspacePath: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
}

async function readImpactFromPath(filePath: string): Promise<WorkspaceImpact> {
  const payload = (await fsExtra.readJson(filePath)) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Workspace impact input is not a JSON object: ${filePath}`);
  }
  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== WORKSPACE_IMPACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported workspace impact schema: ${String(record.schemaVersion)}`);
  }
  assertJsonSchemaContract(
    payload,
    'contracts/workspace-intelligence/workspace-impact.v1.json',
    `Workspace impact ${filePath}`
  );
  const impact = record as WorkspaceImpact;
  assertJsonSchemaContract(
    impact.diff,
    'contracts/workspace-intelligence/workspace-model-diff.v1.json',
    `Embedded workspace diff in ${filePath}`
  );
  const semanticErrors: string[] = [];
  if (impact.summary.affectedProjects !== impact.affectedProjects.length) {
    semanticErrors.push('summary.affectedProjects does not match affectedProjects.length');
  }
  if (impact.summary.workspaceItems !== impact.workspaceImpact.length) {
    semanticErrors.push('summary.workspaceItems does not match workspaceImpact.length');
  }
  if (impact.summary.recommendedCommands !== impact.verificationPlan.length) {
    semanticErrors.push('summary.recommendedCommands does not match verificationPlan.length');
  }
  if (impact.summary.blastRadius.directlyAffected !== impact.affectedProjects.length) {
    semanticErrors.push('blastRadius.directlyAffected does not match affectedProjects.length');
  }
  if (impact.summary.blastRadius.transitivelyAffected !== impact.transitiveImpact.length) {
    semanticErrors.push('blastRadius.transitivelyAffected does not match transitiveImpact.length');
  }
  const maxDistance = impact.transitiveImpact.reduce(
    (maximum, item) => Math.max(maximum, item.distance ?? 0),
    0
  );
  if (impact.summary.blastRadius.maxDistance !== maxDistance) {
    semanticErrors.push('blastRadius.maxDistance does not match transitive impact distances');
  }
  const graphEdges = workspaceModelProjectTopology(impact.diff.currentModel)?.edges.length ?? 0;
  if (impact.summary.blastRadius.graphEdges !== graphEdges) {
    semanticErrors.push('blastRadius.graphEdges does not match the embedded model graph');
  }
  if (impact.summary.changed !== impact.diff.summary.changed) {
    semanticErrors.push('summary.changed does not match embedded diff summary');
  }
  if (impact.fromRef !== impact.diff.fromRef) {
    semanticErrors.push('fromRef does not match embedded diff fromRef');
  }
  if (impact.workspace.name !== impact.diff.currentModel.workspace.name) {
    semanticErrors.push('workspace.name does not match the embedded model');
  }
  if (impact.diff.toHash !== hashWorkspaceModel(impact.diff.currentModel)) {
    semanticErrors.push('embedded diff current-model hash does not match toHash');
  }
  if (semanticErrors.length > 0) {
    throw new Error(
      `Workspace impact semantic integrity failed: ${semanticErrors.join('; ')} (${filePath})`
    );
  }
  return impact;
}

function dedupeCommands(commands: WorkspaceImpactCommand[]): WorkspaceImpactCommand[] {
  const seen = new Set<string>();
  const output: WorkspaceImpactCommand[] = [];
  for (const command of commands) {
    const key = `${command.scope}:${command.project ?? ''}:${command.display}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(command);
  }
  return output;
}

function scopeMatchesCommand(scope: string | undefined, command: WorkspaceImpactCommand): boolean {
  if (!scope || scope === 'workspace') {
    return true;
  }
  const normalized = (scope.startsWith('project:') ? scope.slice('project:'.length) : scope)
    .trim()
    .toLowerCase();
  if (command.scope === 'workspace') {
    return true;
  }
  return (command.project ?? '').trim().toLowerCase() === normalized;
}

function evidencePathForCommand(
  command: WorkspaceImpactCommand,
  workspacePath: string
): string | undefined {
  if (command.id === 'workspace.doctor') {
    return path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor);
  }
  if (command.id === 'workspace.contract.verify') {
    return path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify);
  }
  if (command.id === 'workspace.readiness') {
    return path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness);
  }
  if (command.id === 'workspace.analyze') {
    return path.join(workspacePath, '.workspai', 'reports', 'analyze-last-run.json');
  }
  if (command.id === 'workspace.pipeline') {
    return path.join(workspacePath, '.workspai', 'reports', 'pipeline-last-run.json');
  }
  if (command.id === 'workspace.doctor-fix') {
    return path.join(workspacePath, '.workspai', 'reports', 'doctor-fix-result-last-run.json');
  }
  if (command.id.startsWith('project.') && command.id.includes('.')) {
    return path.join(workspacePath, '.workspai', 'reports', 'workspace-run-last.json');
  }
  return undefined;
}

type EvidenceEvaluation = {
  status: WorkspaceVerifyStepStatus;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function evaluateDoctorEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  if (!isDoctorEvidencePayloadCompatible(payload, 'workspace')) {
    return { status: 'fail', message: 'Doctor evidence contract is missing or unsupported.' };
  }
  try {
    assertDoctorEvidenceSemanticInvariants(payload);
  } catch (error) {
    return {
      status: 'fail',
      message: `Doctor evidence semantic validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const assessment = assessCanonicalDoctorEvidence(payload);
  if (assessment.hasSystemErrors || assessment.blockingFindings > 0) {
    return {
      status: 'fail',
      message: `Doctor evidence reports ${assessment.blockingFindings} canonical blocking finding(s).`,
    };
  }

  const trustWarnings =
    assessment.advisoryFindings +
    assessment.unknownFindings +
    assessment.contradictionCount +
    assessment.missingDiagnosisProjects;
  if (
    trustWarnings > 0 ||
    assessment.staleEvidence ||
    assessment.unknownFreshness ||
    assessment.minimumDiagnosisCompleteness < 100
  ) {
    return {
      status: 'warn',
      message: `Doctor evidence needs attention (${assessment.advisoryFindings} advisory, ${assessment.unknownFindings} unknown, ${assessment.contradictionCount} contradictory; ${assessment.minimumDiagnosisCompleteness}% complete).`,
    };
  }
  return { status: 'pass', message: 'Canonical Doctor evidence is complete, fresh, and healthy.' };
}

function evaluateReadinessEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  const overallStatus =
    typeof payload.overallStatus === 'string' ? payload.overallStatus : 'unknown';
  if (overallStatus === 'fail') {
    return { status: 'fail', message: 'Release readiness evidence reports blocking failures.' };
  }
  if (overallStatus === 'warn') {
    return { status: 'warn', message: 'Release readiness evidence reports warnings.' };
  }
  if (overallStatus === 'pass') {
    return { status: 'pass', message: 'Release readiness evidence passed.' };
  }
  return { status: 'warn', message: `Release readiness evidence status is ${overallStatus}.` };
}

function evaluateContractVerifyEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  const status = typeof payload.status === 'string' ? payload.status : 'unknown';
  if (status === 'failed' || status === 'fail') {
    return { status: 'fail', message: 'Workspace contract verify evidence failed.' };
  }
  if (status === 'passed' || status === 'pass') {
    return { status: 'pass', message: 'Workspace contract verify evidence passed.' };
  }
  return { status: 'warn', message: `Workspace contract verify evidence status is ${status}.` };
}

function evaluateAnalyzeEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  const summary = asRecord(payload.summary);
  const verdict = typeof summary?.verdict === 'string' ? summary.verdict : undefined;
  if (verdict === 'blocked') {
    return { status: 'fail', message: 'Analyze evidence reports blocking findings.' };
  }
  if (verdict === 'needs-attention') {
    return { status: 'warn', message: 'Analyze evidence reports warnings.' };
  }
  return { status: 'pass', message: 'Analyze evidence is ready.' };
}

function evaluateDoctorFixEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  const fixResult =
    payload.schemaVersion ===
    WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorFixResult.schemaVersion
      ? payload
      : payload.fixResult;
  if (!fixResult || typeof fixResult !== 'object' || Array.isArray(fixResult)) {
    return {
      status: 'skipped',
      message: 'Doctor fix result not present; run doctor workspace --fix --json to record fixes.',
    };
  }
  const record = fixResult as Record<string, unknown>;
  const remaining = Array.isArray(record.remainingBlockers) ? record.remainingBlockers : [];
  if (remaining.length > 0) {
    return {
      status: 'fail',
      message: `Doctor fix result reports ${remaining.length} remaining blocker(s).`,
    };
  }
  const applied = Array.isArray(record.appliedFixes) ? record.appliedFixes : [];
  if (applied.length === 0) {
    return { status: 'pass', message: 'Doctor fix result recorded with no remaining blockers.' };
  }
  return {
    status: 'pass',
    message: `Doctor fix result recorded ${applied.length} applied fix(es) with no remaining blockers.`,
  };
}

async function currentDoctorRemediationPlanHasNoPendingSteps(
  workspacePath: string,
  fixGeneratedAt: string | undefined
): Promise<boolean> {
  const planPath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.doctorRemediationPlan
  );
  if (!planPath) {
    return false;
  }
  try {
    const plan = asRecord(await fsExtra.readJson(planPath));
    if (!plan) {
      return false;
    }
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (steps.length > 0) {
      return false;
    }
    const planGeneratedAt = typeof plan.generatedAt === 'string' ? plan.generatedAt : undefined;
    if (!planGeneratedAt || !fixGeneratedAt) {
      return true;
    }
    const planTime = Date.parse(planGeneratedAt);
    const fixTime = Date.parse(fixGeneratedAt);
    if (!Number.isFinite(planTime) || !Number.isFinite(fixTime)) {
      return true;
    }
    return planTime >= fixTime;
  } catch {
    return false;
  }
}

function resolveWorkspaceRunStageFromCommand(
  command: WorkspaceImpactCommand
): WorkspaceRunStage | null {
  if (command.id.endsWith('.init')) return 'init';
  if (command.id.endsWith('.test')) return 'test';
  if (command.id.endsWith('.build')) return 'build';
  if (command.id.endsWith('.start')) return 'start';
  return null;
}

function evaluatePipelineEvidence(payload: Record<string, unknown>): EvidenceEvaluation {
  const summary = asRecord(payload.summary);
  const verdict = typeof summary?.verdict === 'string' ? summary.verdict : undefined;
  if (verdict === 'blocked') {
    return { status: 'fail', message: 'Pipeline evidence is blocked.' };
  }
  if (verdict === 'needs-attention') {
    return { status: 'warn', message: 'Pipeline evidence needs attention.' };
  }
  if (verdict === 'ready') {
    return { status: 'pass', message: 'Pipeline evidence is ready.' };
  }
  return { status: 'warn', message: 'Pipeline evidence status is unknown.' };
}

function evaluateWorkspaceRunEvidence(
  payload: Record<string, unknown>,
  command: WorkspaceImpactCommand,
  minGeneratedAt?: string
): EvidenceEvaluation {
  const stage = resolveWorkspaceRunStageFromCommand(command);
  const stageReport = resolveWorkspaceRunStageReport(payload, stage ?? undefined);
  if (!stageReport) {
    return {
      status: 'missing',
      message: 'Workspace run evidence is missing or unreadable.',
    };
  }
  const reportStage = stageReport.stage;
  if (stage && reportStage !== stage) {
    return {
      status: 'missing',
      message: `Workspace run evidence is for stage "${reportStage}", expected "${stage}".`,
    };
  }
  const projects = Array.isArray(stageReport.projects) ? stageReport.projects : [];
  const projectName = command.project?.toLowerCase();
  if (!projectName) {
    return {
      status: 'missing',
      message: 'Project-scoped workspace run evidence is missing a project identifier.',
    };
  }
  const projectRow = projects.find((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return false;
    }
    const name = typeof record.projectName === 'string' ? record.projectName.toLowerCase() : '';
    const projectPathCandidates = ['projectPath', 'relativePath', 'path']
      .map((key) => record[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.replace(/\\/g, '/').toLowerCase());
    return (
      name === projectName ||
      projectPathCandidates.some(
        (projectPath) => projectPath.endsWith(`/${projectName}`) || projectPath === projectName
      )
    );
  });
  if (projectRow) {
    const staleMessage = staleEvidenceMessage(
      stageReport.generatedAt,
      minGeneratedAt,
      `Workspace run evidence for ${command.project ?? command.id}`
    );
    if (staleMessage) {
      return { status: 'fail', message: staleMessage };
    }
    const record = asRecord(projectRow);
    const status = typeof record?.status === 'string' ? record.status : 'unknown';
    if (status === 'failed') {
      return { status: 'fail', message: `Workspace run evidence failed for ${command.project}.` };
    }
    if (status === 'passed') {
      return { status: 'pass', message: `Workspace run evidence passed for ${command.project}.` };
    }
    if (status === 'skipped') {
      return { status: 'warn', message: `Workspace run evidence skipped for ${command.project}.` };
    }
    return {
      status: 'warn',
      message: `Workspace run evidence status is ${status} for ${command.project}.`,
    };
  }
  return {
    status: 'missing',
    message: `Workspace run evidence does not include project ${command.project}.`,
  };
}

function staleEvidenceMessage(
  evidenceGeneratedAt: unknown,
  minGeneratedAt: string | undefined,
  label: string
): string | null {
  if (!minGeneratedAt) {
    return null;
  }
  if (typeof evidenceGeneratedAt !== 'string' || evidenceGeneratedAt.trim().length === 0) {
    return `${label} is stale: missing generatedAt timestamp (required after impact ${minGeneratedAt}).`;
  }
  const evidenceTime = Date.parse(evidenceGeneratedAt);
  const minTime = Date.parse(minGeneratedAt);
  if (!Number.isFinite(evidenceTime)) {
    return `${label} is stale: invalid generatedAt timestamp (required after impact ${minGeneratedAt}).`;
  }
  if (!Number.isFinite(minTime)) {
    return null;
  }
  if (evidenceTime < minTime) {
    return `${label} is stale: generated at ${evidenceGeneratedAt}, before impact ${minGeneratedAt}.`;
  }
  return null;
}

function evidenceContractForCommand(command: WorkspaceImpactCommand): string | undefined {
  if (command.id === 'workspace.doctor') {
    return WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.doctor;
  }
  if (command.id === 'workspace.readiness') {
    return WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.readiness;
  }
  if (command.id === 'workspace.contract.verify') {
    return WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.contractVerify;
  }
  if (command.id === 'workspace.analyze') {
    return WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.analyze;
  }
  if (command.id === 'workspace.pipeline') {
    return 'contracts/pipeline-last-run.v1.json';
  }
  return undefined;
}

async function evaluateCommandEvidence(
  command: WorkspaceImpactCommand,
  workspacePath: string,
  hasWorkspaceContract: boolean,
  minGeneratedAt?: string
): Promise<WorkspaceVerifyStep> {
  const evidencePath = evidencePathForCommand(command, workspacePath);
  const relativeEvidencePath = evidencePath
    ? path.relative(workspacePath, evidencePath).split(path.sep).join('/')
    : undefined;

  if (command.id === 'workspace.contract.verify' && !hasWorkspaceContract) {
    return {
      id: command.id,
      label: command.label,
      scope: command.scope,
      project: command.project,
      command,
      status: 'skipped',
      required: command.required,
      message: 'Workspace contract is not present; contract verify skipped.',
    };
  }

  const existingEvidencePath = evidencePath
    ? await firstExistingWorkspaceArtifactPath(workspacePath, relativeEvidencePath ?? '')
    : null;

  if (!evidencePath || !existingEvidencePath) {
    return {
      id: command.id,
      label: command.label,
      scope: command.scope,
      project: command.project,
      command,
      status: 'missing',
      required: command.required,
      evidencePath: relativeEvidencePath,
      message: relativeEvidencePath
        ? `Missing evidence report: ${relativeEvidencePath}`
        : 'No evidence mapping exists for this command.',
    };
  }

  let rawPayload: unknown;
  try {
    rawPayload = await fsExtra.readJson(existingEvidencePath);
  } catch (error) {
    return {
      id: command.id,
      label: command.label,
      scope: command.scope,
      project: command.project,
      command,
      status: 'fail',
      required: command.required,
      evidencePath: relativeEvidencePath,
      message: `Evidence report is unreadable JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const payload = asRecord(rawPayload);
  if (!payload) {
    return {
      id: command.id,
      label: command.label,
      scope: command.scope,
      project: command.project,
      command,
      status: 'fail',
      required: command.required,
      evidencePath: relativeEvidencePath,
      message: 'Evidence report is not a JSON object.',
    };
  }

  const evidenceContract = evidenceContractForCommand(command);
  if (evidenceContract) {
    try {
      assertJsonSchemaContract(payload, evidenceContract, `${command.label} evidence`);
    } catch (error) {
      return {
        id: command.id,
        label: command.label,
        scope: command.scope,
        project: command.project,
        command,
        status: 'fail',
        required: command.required,
        evidencePath: relativeEvidencePath,
        message: `Evidence report is invalid: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  let evaluation: EvidenceEvaluation;
  if (command.id === 'workspace.doctor') {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Doctor evidence'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = evaluateDoctorEvidence(payload);
    }
  } else if (command.id === 'workspace.readiness') {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Release readiness evidence'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = evaluateReadinessEvidence(payload);
    }
  } else if (command.id === 'workspace.contract.verify') {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Workspace contract verify evidence'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = evaluateContractVerifyEvidence(payload);
    }
  } else if (command.id === 'workspace.analyze') {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Analyze evidence'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = evaluateAnalyzeEvidence(payload);
    }
  } else if (command.id === 'workspace.pipeline') {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Pipeline evidence'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = evaluatePipelineEvidence(payload);
    }
  } else if (command.id === 'workspace.doctor-fix') {
    const fixResult =
      payload.schemaVersion ===
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorFixResult.schemaVersion
        ? payload
        : payload.fixResult;
    const fixRecord = asRecord(fixResult);
    const fixGeneratedAt =
      typeof fixRecord?.generatedAt === 'string' ? fixRecord.generatedAt : undefined;
    const staleMessage = staleEvidenceMessage(fixGeneratedAt, minGeneratedAt, 'Doctor fix result');
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else if (await currentDoctorRemediationPlanHasNoPendingSteps(workspacePath, fixGeneratedAt)) {
      evaluation = {
        status: 'skipped',
        message: 'No current doctor remediation steps are pending.',
      };
    } else {
      evaluation = evaluateDoctorFixEvidence(payload);
    }
  } else if (command.id.startsWith('project.')) {
    evaluation = evaluateWorkspaceRunEvidence(payload, command, minGeneratedAt);
  } else {
    const staleMessage = staleEvidenceMessage(
      payload.generatedAt,
      minGeneratedAt,
      'Evidence report'
    );
    if (staleMessage) {
      evaluation = { status: 'fail', message: staleMessage };
    } else {
      evaluation = { status: 'pass', message: 'Evidence report is present.' };
    }
  }

  return {
    id: command.id,
    label: command.label,
    scope: command.scope,
    project: command.project,
    command,
    status: evaluation.status,
    required: command.required,
    evidencePath: relativeEvidencePath,
    message: evaluation.message,
  };
}

function computeVerifySummary(
  steps: WorkspaceVerifyStep[],
  graphGate: { blockingReasons: string[]; needsAttention: boolean } = {
    blockingReasons: [],
    needsAttention: false,
  }
): WorkspaceVerify['summary'] {
  const stepsPassed = steps.filter((step) => step.status === 'pass').length;
  const stepsWarn = steps.filter((step) => step.status === 'warn').length;
  const stepsFailed = steps.filter((step) => step.status === 'fail').length;
  const stepsMissing = steps.filter((step) => step.status === 'missing').length;
  const stepsSkipped = steps.filter((step) => step.status === 'skipped').length;

  const blockingReasons = steps
    .filter((step) => step.required && (step.status === 'fail' || step.status === 'missing'))
    .map((step) => `${step.id}: ${step.message}`);

  const requiredMissing = steps.filter((step) => step.required && step.status === 'missing').length;

  let verdict: WorkspaceVerifyVerdict = 'ready';
  let exitCode: 0 | 1 | 2 = 0;
  if (blockingReasons.length > 0 || graphGate.blockingReasons.length > 0) {
    verdict = 'blocked';
    exitCode = 2;
  } else if (
    stepsWarn > 0 ||
    steps.some((step) => !step.required && step.status === 'fail') ||
    requiredMissing > 0 ||
    graphGate.needsAttention
  ) {
    verdict = 'needs-attention';
    exitCode = 1;
  }

  return {
    verdict,
    exitCode,
    stepsPassed,
    stepsWarn,
    stepsFailed,
    stepsMissing,
    stepsSkipped,
  };
}

type SubgraphGateResult = {
  subgraph: WorkspaceVerifyAffectedSubgraph;
  blockingReasons: string[];
  needsAttention: boolean;
};

/**
 * Gate the whole affected subgraph (1.11). Walks the directly-changed projects
 * and their transitive dependents (from the impact report) and checks that each
 * has a passing/warning verification step. A dependent with failed or
 * missing-required evidence blocks; a dependent with missing non-required
 * evidence escalates to needs-attention; a dependent with no applicable
 * verification command is recorded as unverifiable (informational).
 */
export function computeAffectedSubgraphGate(
  impact: WorkspaceImpact,
  steps: WorkspaceVerifyStep[]
): SubgraphGateResult {
  const directNames = uniqueSorted(
    impact.affectedProjects
      .map((item) => item.project?.name)
      .filter((name): name is string => typeof name === 'string')
  );
  const directSet = new Set(directNames.map((name) => name.toLowerCase()));
  const transitiveNames = uniqueSorted(
    impact.transitiveImpact
      .map((item) => item.project?.name)
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => !directSet.has(name.toLowerCase()))
  );

  const projectSteps = new Map<string, WorkspaceVerifyStep[]>();
  for (const step of steps) {
    if (step.scope !== 'project' || !step.project) {
      continue;
    }
    const key = step.project.toLowerCase();
    const bucket = projectSteps.get(key) ?? [];
    bucket.push(step);
    projectSteps.set(key, bucket);
  }

  const covered: string[] = [];
  const uncovered: string[] = [];
  const unverifiable: string[] = [];
  const blockingReasons: string[] = [];
  let needsAttention = false;

  const classify = (name: string, relationship: 'directly-changed' | 'transitive dependent') => {
    const ownSteps = projectSteps.get(name.toLowerCase()) ?? [];
    if (ownSteps.length === 0) {
      unverifiable.push(name);
      return;
    }
    const failed = ownSteps.filter((step) => step.status === 'fail');
    const requiredFailed = failed.filter((step) => step.required);
    const missing = ownSteps.filter((step) => step.status === 'missing');
    const requiredMissing = missing.filter((step) => step.required);
    const hasEvidence = ownSteps.some((step) => step.status === 'pass' || step.status === 'warn');

    if (requiredFailed.length > 0) {
      uncovered.push(name);
      blockingReasons.push(
        `graph.subgraph.${name}: ${relationship} has failed verification evidence (${requiredFailed
          .map((step) => step.id)
          .join(', ')}).`
      );
      return;
    }
    if (failed.length > 0) {
      uncovered.push(name);
      needsAttention = true;
      return;
    }
    if (requiredMissing.length > 0) {
      uncovered.push(name);
      blockingReasons.push(
        `graph.subgraph.${name}: ${relationship} has missing required verification evidence (${requiredMissing
          .map((step) => step.id)
          .join(', ')}).`
      );
      return;
    }
    if (missing.length > 0) {
      uncovered.push(name);
      needsAttention = true;
      return;
    }
    if (hasEvidence) {
      covered.push(name);
      return;
    }
    unverifiable.push(name);
  };

  for (const name of directNames) {
    classify(name, 'directly-changed');
  }
  for (const name of transitiveNames) {
    classify(name, 'transitive dependent');
  }

  return {
    subgraph: {
      totalProjects: directNames.length + transitiveNames.length,
      directlyChanged: directNames,
      transitiveDependents: transitiveNames,
      covered: uniqueSorted(covered),
      uncovered: uniqueSorted(uncovered),
      unverifiable: uniqueSorted(unverifiable),
    },
    blockingReasons,
    needsAttention,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function resolveImpactForVerify(
  options: BuildWorkspaceVerifyOptions
): Promise<{ impact: WorkspaceImpact; fromImpactRef?: string; impactFromDisk: boolean }> {
  const workspacePath = path.resolve(options.workspacePath);

  if (options.fromImpactPath) {
    const impactPath = resolveWorkspaceRelativePath(workspacePath, options.fromImpactPath);
    return {
      impact: await readImpactFromPath(impactPath),
      fromImpactRef: path.relative(workspacePath, impactPath).split(path.sep).join('/'),
      impactFromDisk: true,
    };
  }

  const defaultImpactPath = path.join(workspacePath, WORKSPACE_IMPACT_REPORT_PATH);
  if (await fsExtra.pathExists(defaultImpactPath)) {
    return {
      impact: await readImpactFromPath(defaultImpactPath),
      fromImpactRef: WORKSPACE_IMPACT_REPORT_PATH,
      impactFromDisk: true,
    };
  }

  const snapshotPath = path.join(workspacePath, WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH);
  if (await fsExtra.pathExists(snapshotPath)) {
    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
      scope: options.scope,
      includeAbsolutePaths: options.includeAbsolutePaths,
      includeEvidence: options.includeEvidence,
      observableScanDepth: options.observableScanDepth,
      now: options.now,
    });
    return { impact, fromImpactRef: WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH, impactFromDisk: false };
  }

  const model = await buildWorkspaceModel({
    workspacePath,
    includeAbsolutePaths: options.includeAbsolutePaths,
    includeEvidence: options.includeEvidence,
    observableScanDepth: options.observableScanDepth,
    now: options.now,
  });

  return {
    impact: {
      schemaVersion: WORKSPACE_IMPACT_SCHEMA_VERSION,
      generatedAt: (options.now ?? new Date()).toISOString(),
      fromRef: 'baseline',
      diffRef: WORKSPACE_INTELLIGENCE_ARTIFACTS.diff,
      workspace: {
        name: model.workspace.name,
        profile: model.workspace.profile,
        type: model.workspace.type,
      },
      summary: {
        changed: false,
        risk: 'none',
        affectedProjects: 0,
        workspaceItems: 0,
        recommendedCommands: 0,
        blastRadius: {
          directlyAffected: 0,
          transitivelyAffected: 0,
          maxDistance: 0,
          graphEdges: workspaceModelProjectTopology(model)?.edges.length ?? 0,
        },
      },
      affectedProjects: [],
      transitiveImpact: [],
      criticalPathHotspots: [],
      workspaceImpact: [],
      verificationPlan: [],
      agentBrief: {
        headline: 'Baseline workspace verify run.',
        bullets: ['No impact report or snapshot was available; baseline gates were evaluated.'],
        unsafeAssumptions: ['Do not claim runtime verification passed unless evidence exists.'],
      },
      diff: {
        schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.diff,
        generatedAt: (options.now ?? new Date()).toISOString(),
        fromRef: 'baseline',
        toRef: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        fromHash: 'baseline',
        toHash: 'baseline',
        summary: {
          changed: false,
          addedProjects: 0,
          removedProjects: 0,
          changedProjects: 0,
          workspaceChanges: 0,
          validationChanges: 0,
          gitChangedFiles: 0,
        },
        git: {
          available: false,
          dirty: false,
          changedFiles: 0,
          untrackedFiles: 0,
          deletedFiles: 0,
        },
        changes: [],
        currentModel: model,
      },
    },
    impactFromDisk: false,
  };
}

function resolveEvidenceFreshnessFloor(
  impact: WorkspaceImpact,
  impactFromDisk: boolean
): string | undefined {
  if (impactFromDisk) {
    return impact.generatedAt;
  }
  // A default verify run may build an impact/diff object on the fly. That
  // generatedAt represents the verification command time, not an operator
  // supplied impact baseline. Using it as a freshness floor makes freshly
  // generated doctor/analyze/readiness evidence look stale by construction.
  // Keep strict freshness gating for persisted impact reports and --from-impact.
  return undefined;
}

export async function buildWorkspaceVerify(
  options: BuildWorkspaceVerifyOptions
): Promise<WorkspaceVerify> {
  const workspacePath = path.resolve(options.workspacePath);
  const { impact, fromImpactRef, impactFromDisk } = await resolveImpactForVerify(options);
  const model = impact.diff.currentModel;
  const currentModel = impactFromDisk
    ? await buildWorkspaceModel({
        workspacePath,
        includeAbsolutePaths: options.includeAbsolutePaths,
        includeEvidence: options.includeEvidence,
        observableScanDepth: options.observableScanDepth,
        now: options.now,
      })
    : model;
  const impactDriftReasons: string[] = [];
  if (impactFromDisk) {
    const derivedImpact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: impact.diff.fromRef,
      diff: impact.diff,
      scope: options.scope,
      now: options.now,
    });
    const persistedSemantics = [
      impact.affectedProjects,
      impact.transitiveImpact,
      impact.verificationPlan,
    ];
    const derivedSemantics = [
      derivedImpact.affectedProjects,
      derivedImpact.transitiveImpact,
      derivedImpact.verificationPlan,
    ];
    if (JSON.stringify(persistedSemantics) !== JSON.stringify(derivedSemantics)) {
      impactDriftReasons.push(
        'workspace.impact: Persisted impact semantics do not match the impact re-derived from the embedded diff. Regenerate diff and impact.'
      );
    }
  }
  if (impactFromDisk && hashWorkspaceModel(currentModel) !== impact.diff.toHash) {
    impactDriftReasons.push(
      'workspace.impact: Impact evidence is stale because the current workspace model no longer matches the embedded model. Regenerate diff and impact.'
    );
  }
  const impactGit = impact.diff.git;
  if (impactFromDisk && impactGit?.available) {
    const currentGit = collectGitWorkingTreeObservation(workspacePath, {
      ref: impactGit.ref,
    });
    const expectedGitChanges = impact.diff.changes
      .filter((change) => change.type.startsWith('git.'))
      .map((change) => `${change.type}:${change.target.replace(/^git:/, '')}`)
      .sort();
    const currentGitChanges = [
      ...currentGit.changedFiles.map((target) => `git.file.changed:${target}`),
      ...currentGit.untrackedFiles.map((target) => `git.untracked:${target}`),
      ...currentGit.deletedFiles.map((target) => `git.deleted:${target}`),
    ].sort();
    if (
      !currentGit.available ||
      currentGit.commit !== impactGit.commit ||
      JSON.stringify(currentGitChanges) !== JSON.stringify(expectedGitChanges)
    ) {
      impactDriftReasons.push(
        'workspace.impact: Impact evidence is stale because Git changes no longer match the diff observation. Regenerate diff and impact.'
      );
    }
  }
  const evidenceGeneratedAtFloor = resolveEvidenceFreshnessFloor(impact, impactFromDisk);
  const verificationPlan = dedupeCommands([
    ...workspaceVerificationPlan(),
    ...impact.verificationPlan,
  ]).filter((command) => scopeMatchesCommand(options.scope, command));

  const steps: WorkspaceVerifyStep[] = [];
  for (const command of verificationPlan) {
    steps.push(
      await evaluateCommandEvidence(
        command,
        workspacePath,
        model.contracts.exists === true,
        evidenceGeneratedAtFloor
      )
    );
  }

  const subgraphGate = computeAffectedSubgraphGate(impact, steps);
  const graphIntegrity = checkGraphIntegrity(
    workspaceModelProjectTopology(model) ?? { nodes: [], edges: [] }
  );

  const freshnessHashes = computeProjectFreshnessHashes(model);
  const priorVerify = await readPriorVerifyReport(workspacePath);
  const freshnessComparison = compareFreshness(
    freshnessHashes,
    priorVerify?.freshness?.projectHashes
  );
  const freshness: WorkspaceVerifyFreshness = {
    verdict: freshnessComparison.verdict,
    baseline: freshnessComparison.baseline,
    changed: freshnessComparison.changed,
    added: freshnessComparison.added,
    removed: freshnessComparison.removed,
    projectHashes: freshnessHashRecord(freshnessHashes),
  };
  const integrityReasons = summarizeGraphIntegrity(graphIntegrity);
  const policyMode = model.policies?.mode ?? 'warn';
  const policyViolations = await collectPolicyViolations(model, workspacePath);
  const policyDecision = policyGate(policyMode, policyViolations);
  const summary = computeVerifySummary(steps, {
    blockingReasons: [
      ...subgraphGate.blockingReasons,
      ...integrityReasons,
      ...policyDecision.blockingReasons,
      ...impactDriftReasons,
    ],
    needsAttention: subgraphGate.needsAttention || policyDecision.needsAttention,
  });
  const missingEvidence = steps
    .filter((step) => step.status === 'missing' && step.evidencePath)
    .map((step) => step.evidencePath as string);
  const stepBlockingReasons = steps
    .filter((step) => step.required && (step.status === 'fail' || step.status === 'missing'))
    .map((step) => `${step.id}: ${step.message}`);
  const blockingReasons = [
    ...stepBlockingReasons,
    ...subgraphGate.blockingReasons,
    ...integrityReasons,
    ...policyDecision.blockingReasons,
    ...impactDriftReasons,
  ];
  const policyErrorCount = policyViolations.filter(
    (violation) => violation.severity === 'error'
  ).length;
  const projectCount = model.summary?.projectCount ?? model.projects.length;
  const softenedSummary = softenEmptyWorkspaceVerifyVerdict({
    projectCount,
    verdict: summary.verdict,
    exitCode: summary.exitCode,
    blockingReasons,
    policyErrorCount,
  });
  summary.verdict = softenedSummary.verdict;
  summary.exitCode = softenedSummary.exitCode;
  const uniqueBlockingReasons = Array.from(
    new Set(blockingReasons.map((reason) => reason.trim()).filter(Boolean))
  ).slice(0, 12);
  const resolutionHints = uniqueBlockingReasons.map((reason, index) => {
    const sourceStep = steps.find((step) => reason.startsWith(`${step.id}:`));
    return buildResolutionHintForBlocker({
      reason,
      blockerId: `blocker-${index + 1}`,
      sourceCommand: sourceStep?.command.display,
      sourceArtifact: sourceStep?.evidencePath,
      verifyCommand:
        'npx workspai workspace verify --from-impact .workspai/reports/workspace-impact-last-run.json --json',
      verifyArtifact: WORKSPACE_VERIFY_REPORT_PATH,
    });
  });

  return {
    schemaVersion: WORKSPACE_VERIFY_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    workspacePath,
    mode: 'evidence',
    fromImpactRef,
    scope: options.scope,
    impact: {
      changed: impact.summary.changed,
      risk: impact.summary.risk,
      affectedProjects: impact.summary.affectedProjects,
      recommendedCommands: impact.summary.recommendedCommands,
    },
    summary,
    steps,
    missingEvidence,
    blockingReasons,
    ...(resolutionHints.length > 0 ? { resolutionHints } : {}),
    verificationPlan,
    affectedSubgraph: subgraphGate.subgraph,
    graphIntegrity,
    freshness,
    policyMode,
    policyViolations,
  };
}

async function collectPolicyViolations(
  model: WorkspaceModel,
  workspacePath: string
): Promise<WorkspacePolicyViolation[]> {
  const violations: WorkspacePolicyViolation[] = [];

  for (const issue of model.validation?.issues ?? []) {
    violations.push({
      source: 'model',
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      target: issue.target,
    });
  }

  const contractReportPath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify
  );
  try {
    if (contractReportPath && (await fsExtra.pathExists(contractReportPath))) {
      const payload = (await fsExtra.readJson(contractReportPath)) as {
        violations?: unknown;
      };
      if (Array.isArray(payload.violations)) {
        for (const entry of payload.violations) {
          if (typeof entry === 'string' && entry.trim().length > 0) {
            violations.push({
              source: 'contract',
              severity: 'error',
              code: 'contract.violation',
              message: entry,
            });
          }
        }
      }
    }
  } catch {
    // best-effort; contract evidence is optional
  }

  return violations.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return a.message.localeCompare(b.message);
  });
}

function policyGate(
  policyMode: string,
  violations: WorkspacePolicyViolation[]
): { blockingReasons: string[]; needsAttention: boolean } {
  const errors = violations.filter((violation) => violation.severity === 'error');
  if (policyMode === 'enforce' && errors.length > 0) {
    return {
      blockingReasons: errors.map((violation) => `policy.${violation.code}: ${violation.message}`),
      needsAttention: false,
    };
  }
  // In warn mode (or enforce mode with only warnings) error-severity violations
  // warrant attention; pure warnings are surfaced but do not change the verdict.
  return { blockingReasons: [], needsAttention: errors.length > 0 };
}

async function readPriorVerifyReport(workspacePath: string): Promise<WorkspaceVerify | null> {
  const reportPath = path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH);
  try {
    if (!(await fsExtra.pathExists(reportPath))) {
      return null;
    }
    const payload = (await fsExtra.readJson(reportPath)) as Partial<WorkspaceVerify>;
    return payload && payload.schemaVersion === WORKSPACE_VERIFY_SCHEMA_VERSION
      ? (payload as WorkspaceVerify)
      : null;
  } catch {
    return null;
  }
}

export async function writeWorkspaceVerify(
  verify: WorkspaceVerify,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_VERIFY_REPORT_PATH,
    attachRunCorrelation(verify)
  );
}

export type WorkspaceVerifyGateMode = 'default' | 'strict';

export type WorkspaceVerifyGateDecision = {
  /** Whether the action guarded by this gate is allowed to proceed. */
  passed: boolean;
  mode: WorkspaceVerifyGateMode;
  exitCode: 0 | 1 | 2;
  /** Deterministic, ordered reasons the gate failed (empty when passed). */
  reasons: string[];
};

/**
 * Definitive verify gate (roadmap 1.19). This is THE contract used before
 * high-risk actions: callers must treat `passed === false` as a hard stop.
 *
 * Default mode: fails only on a `blocked` verdict (exit 2).
 * Strict mode additionally fails on `needs-attention` and on a graph-aware
 * `stale` freshness verdict (exit 1) — i.e. the workspace must be in a fully
 * green, freshly-verified state. Reasons are surfaced so the extension/CI can
 * render the blocker without re-deriving it.
 */
export function evaluateWorkspaceVerifyGate(
  verify: WorkspaceVerify,
  options?: { strict?: boolean }
): WorkspaceVerifyGateDecision {
  const mode: WorkspaceVerifyGateMode = options?.strict ? 'strict' : 'default';
  const reasons: string[] = [];

  if (verify.summary.verdict === 'blocked') {
    reasons.push(...verify.blockingReasons);
    if (reasons.length === 0) {
      reasons.push('verify verdict is blocked.');
    }
    return { passed: false, mode, exitCode: 2, reasons };
  }

  if (mode === 'strict') {
    if (verify.summary.verdict !== 'ready') {
      reasons.push(`verify verdict is ${verify.summary.verdict} (strict requires ready).`);
    }
    if (verify.freshness.verdict === 'stale') {
      const detail = [...verify.freshness.changed, ...verify.freshness.added].slice(0, 5);
      reasons.push(
        `freshness is stale${detail.length > 0 ? `: ${detail.join(', ')}` : ''} (strict requires fresh).`
      );
    }
    if (reasons.length > 0) {
      return { passed: false, mode, exitCode: 1, reasons };
    }
  }

  return {
    passed: true,
    mode,
    exitCode: 0,
    reasons,
  };
}

export function workspaceVerifyExitCode(
  verify: WorkspaceVerify,
  options?: { strict?: boolean }
): number {
  // Back-compat thin wrapper over the definitive gate (1.19).
  const decision = evaluateWorkspaceVerifyGate(verify, options);
  return decision.exitCode;
}
