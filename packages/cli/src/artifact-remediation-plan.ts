import path from 'path';
import { existsSync } from 'fs';
import fsExtra from 'fs-extra';

import { ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION } from './contracts/artifact-remediation-plan-contract.js';
import {
  resolveLegacyWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import type {
  DoctorDependencyRepairTransaction,
  DoctorRepairStrategyStage,
} from './utils/doctor-repair-capabilities.js';

export type ArtifactRemediationRisk = 'safe' | 'guarded' | 'invasive';
export type ArtifactRemediationMode =
  'edit-file' | 'run-command' | 'refresh-evidence' | 'verify-before-fix' | 'manual-guidance';

export type ArtifactRemediationOperation =
  | {
      type: 'file-create';
      path: string;
      content: string;
      overwrite: false;
    }
  | {
      type: 'run-command';
      command: string;
      cwd: 'workspace' | 'project';
    };

export type ArtifactRemediationAction = {
  id: string;
  artifactKind: string;
  cardId: string;
  title: string;
  order: number;
  phase: string;
  scope: 'workspace' | 'project';
  projectName?: string;
  projectPath?: string;
  sourceStepId?: string;
  dependsOn?: string[];
  strategy?: DoctorRepairStrategyStage[];
  transaction?: DoctorDependencyRepairTransaction;
  status: 'ready' | 'review-required' | 'blocked' | 'guidance-only';
  mode: ArtifactRemediationMode;
  risk: ArtifactRemediationRisk;
  requiresApproval: boolean;
  blocker: string;
  summary: string;
  command?: string;
  verifyCommand: string;
  cwd: 'workspace' | 'project';
  files: string[];
  operation?: ArtifactRemediationOperation;
  rollback: {
    available: boolean;
    strategy: 'idempotent' | 'manual' | 'none';
  };
  notes: string[];
};

export type ArtifactRemediationPlan = {
  schemaVersion: typeof ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION;
  generatedAt: string;
  workspace: {
    name: string;
    path?: string;
  };
  source: {
    command: 'workspace remediation-plan';
    reportsDir: string;
    includeAbsolutePaths: boolean;
    ciMode: boolean;
  };
  summary: {
    artifactsScanned: number;
    cardsCovered: number;
    totalActions: number;
    executableActions: number;
    risk: Record<ArtifactRemediationRisk, number>;
  };
  actions: ArtifactRemediationAction[];
};

type ReportRecord = Record<string, unknown>;

type CandidateReport = {
  artifactKind: string;
  cardId: string;
  fileName: string;
  absolutePath: string;
  payload: ReportRecord;
};

const REPORT_CANDIDATES: Array<{
  artifactKind: string;
  cardId: string;
  fileNames: string[];
}> = [
  {
    artifactKind: 'bootstrap-compliance',
    cardId: 'bootstrap',
    fileNames: ['bootstrap-compliance.latest.json'],
  },
  {
    artifactKind: 'doctor-workspace',
    cardId: 'doctor',
    fileNames: ['doctor-remediation-plan-last-run.json'],
  },
  {
    artifactKind: 'analyze',
    cardId: 'analyze',
    fileNames: ['analyze-last-run.json'],
  },
  {
    artifactKind: 'readiness',
    cardId: 'readiness',
    fileNames: ['release-readiness-last-run.json'],
  },
  {
    artifactKind: 'pipeline',
    cardId: 'pipeline',
    fileNames: ['pipeline-last-run.json'],
  },
  {
    artifactKind: 'workspace-run',
    cardId: 'workspaceRun',
    fileNames: ['workspace-run-last.json'],
  },
  {
    artifactKind: 'workspace-verify',
    cardId: 'workspaceVerify',
    fileNames: ['workspace-verify-last-run.json'],
  },
];

function asRecord(value: unknown): ReportRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ReportRecord)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function relativeOrAbsolute(
  workspacePath: string,
  filePath: string,
  includeAbsolutePaths: boolean
): string {
  return includeAbsolutePaths ? filePath : path.relative(workspacePath, filePath);
}

function normalizeBootstrapCommand(command?: string): string {
  const base = command?.trim() || 'npx workspai bootstrap';
  if (!/(?:^|\s)--ci(?:\s|$)/.test(base) && /(?:^|\s)--json(?:\s|$)/.test(base)) {
    return base
      .replace(/(?:^|\s)--json(?:\s|$)/, (match) => {
        const prefix = match.startsWith(' ') ? ' ' : '';
        const suffix = match.endsWith(' ') ? ' ' : '';
        return `${prefix}--ci --json${suffix}`;
      })
      .trim();
  }
  const withCi = /(?:^|\s)--ci(?:\s|$)/.test(base) ? base : `${base} --ci`;
  return /(?:^|\s)--json(?:\s|$)/.test(withCi) ? withCi : `${withCi} --json`;
}

function buildCompatibilityMatrixContent(generatedAt: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: 'rapidkit.compatibility-matrix.v1',
      generatedAt,
      source: 'workspai workspace remediation-plan',
      runtimes: {},
      notes: [
        'Minimal enterprise baseline. Add runtime and toolchain entries as governance matures.',
      ],
    },
    null,
    2
  )}\n`;
}

function buildMirrorConfigContent(generatedAt: string): string {
  return `${JSON.stringify(
    {
      schema_version: '1.0',
      enabled: false,
      strategy: 'on-demand',
      artifacts: [],
      created_at: generatedAt,
      note: 'Minimal enterprise baseline. Set enabled: true and add artifact entries to activate mirroring.',
    },
    null,
    2
  )}\n`;
}

function blockerListForReport(report: CandidateReport): string[] {
  const payload = report.payload;
  const directBlockers = asStringArray(payload.blockers);
  const blockingReasons = asStringArray(payload.blockingReasons);
  const failures = asStringArray(payload.failures);
  const reasons = asStringArray(payload.reasons);
  const violations = asStringArray(payload.policyViolations);
  const summary = asRecord(payload.summary);
  const summaryBlockers = asStringArray(summary?.blockers);

  if (report.artifactKind === 'analyze') {
    const findings = Array.isArray(payload.findings) ? payload.findings : [];
    const findingMessages = findings
      .map((entry) => asRecord(entry))
      .filter((entry): entry is ReportRecord => Boolean(entry))
      .map((entry) => String(entry.message ?? entry.title ?? entry.id ?? '').trim())
      .filter(Boolean);
    return uniqueStrings([...directBlockers, ...findingMessages, ...blockingReasons]);
  }

  if (report.artifactKind === 'workspace-run') {
    const stages = asRecord(payload.stages);
    const stageFailures = Object.entries(stages ?? {}).flatMap(([stage, stageValue]) => {
      const stageRecord = asRecord(stageValue);
      const projects = Array.isArray(stageRecord?.projects) ? stageRecord.projects : [];
      return projects
        .map((entry) => asRecord(entry))
        .filter((entry): entry is ReportRecord => Boolean(entry))
        .filter((entry) => entry.status === 'failed' || entry.ok === false)
        .map((entry) => `${stage}: ${String(entry.project ?? entry.name ?? 'project')} failed`);
    });
    return uniqueStrings([...directBlockers, ...stageFailures, ...blockingReasons]);
  }

  return uniqueStrings([
    ...directBlockers,
    ...blockingReasons,
    ...failures,
    ...reasons,
    ...violations,
    ...summaryBlockers,
  ]);
}

function actionBase(input: {
  id: string;
  artifactKind: string;
  cardId: string;
  title: string;
  order: number;
  phase: string;
  blocker: string;
  summary: string;
  mode: ArtifactRemediationMode;
  risk: ArtifactRemediationRisk;
  status?: ArtifactRemediationAction['status'];
  command?: string;
  verifyCommand: string;
  files?: string[];
  operation?: ArtifactRemediationOperation;
  notes?: string[];
  scope?: ArtifactRemediationAction['scope'];
  projectName?: string;
  projectPath?: string;
  sourceStepId?: string;
  dependsOn?: string[];
  strategy?: DoctorRepairStrategyStage[];
  transaction?: DoctorDependencyRepairTransaction;
  cwd?: ArtifactRemediationAction['cwd'];
}): ArtifactRemediationAction {
  return {
    id: input.id,
    artifactKind: input.artifactKind,
    cardId: input.cardId,
    title: input.title,
    order: input.order,
    phase: input.phase,
    scope: input.scope ?? 'workspace',
    ...(input.projectName ? { projectName: input.projectName } : {}),
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.sourceStepId ? { sourceStepId: input.sourceStepId } : {}),
    ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
    ...(input.strategy ? { strategy: structuredClone(input.strategy) } : {}),
    ...(input.transaction ? { transaction: structuredClone(input.transaction) } : {}),
    status: input.status ?? 'ready',
    mode: input.mode,
    risk: input.risk,
    requiresApproval: true,
    blocker: input.blocker,
    summary: input.summary,
    ...(input.command ? { command: input.command } : {}),
    verifyCommand: input.verifyCommand,
    cwd: input.cwd ?? 'workspace',
    files: input.files ?? [],
    ...(input.operation ? { operation: input.operation } : {}),
    rollback: {
      available: Boolean(input.operation),
      strategy: input.operation ? 'idempotent' : 'none',
    },
    notes: input.notes ?? [],
  };
}

function doctorPlanActions(input: {
  report: CandidateReport;
  workspacePath: string;
  includeAbsolutePaths: boolean;
  startOrder: number;
}): ArtifactRemediationAction[] {
  const steps = Array.isArray(input.report.payload.steps) ? input.report.payload.steps : [];
  return steps.flatMap((rawStep, index) => {
    const step = asRecord(rawStep);
    const id = typeof step?.id === 'string' ? step.id.trim() : '';
    const projectName = typeof step?.projectName === 'string' ? step.projectName.trim() : '';
    const absoluteProjectPath =
      typeof step?.projectPath === 'string' ? step.projectPath.trim() : '';
    const originalCommand =
      typeof step?.originalCommand === 'string' ? step.originalCommand.trim() : '';
    if (!step || !id || !projectName || !absoluteProjectPath) {
      return [];
    }
    const studioStatus = asRecord(step.studioStatus);
    const studioState =
      studioStatus?.state === 'ready' ||
      studioStatus?.state === 'review-required' ||
      studioStatus?.state === 'blocked' ||
      studioStatus?.state === 'guidance-only'
        ? studioStatus.state
        : 'guidance-only';
    const risk =
      step.risk === 'safe' || step.risk === 'guarded' || step.risk === 'invasive'
        ? step.risk
        : 'guarded';
    const preview = asRecord(step.preview);
    const projectPath = relativeOrAbsolute(
      input.workspacePath,
      absoluteProjectPath,
      input.includeAbsolutePaths
    );
    const executable = step.executableInCurrentEnvironment === true && originalCommand.length > 0;
    const strategy = Array.isArray(step.strategy)
      ? (structuredClone(step.strategy) as DoctorRepairStrategyStage[])
      : undefined;
    const transactionRecord = asRecord(step.transaction);
    const transaction =
      transactionRecord?.schemaVersion === 'workspai.doctor-dependency-repair-transaction.v1'
        ? (structuredClone(transactionRecord) as unknown as DoctorDependencyRepairTransaction)
        : undefined;
    return [
      actionBase({
        id: `doctor.${id}`,
        artifactKind: input.report.artifactKind,
        cardId: input.report.cardId,
        title:
          typeof preview?.title === 'string' && preview.title.trim()
            ? preview.title.trim()
            : `Repair ${projectName}`,
        order: input.startOrder + index,
        phase: typeof step.phase === 'string' ? step.phase : 'doctor-remediation',
        blocker:
          typeof preview?.summary === 'string' && preview.summary.trim()
            ? preview.summary.trim()
            : `Doctor remediation is pending for ${projectName}.`,
        summary:
          typeof preview?.summary === 'string' && preview.summary.trim()
            ? preview.summary.trim()
            : `Execute the CLI-authored Doctor step for ${projectName}.`,
        mode: executable ? 'run-command' : 'manual-guidance',
        risk,
        status: studioState,
        ...(executable ? { command: originalCommand } : {}),
        verifyCommand:
          typeof step.verifyCommand === 'string' && step.verifyCommand.trim()
            ? step.verifyCommand.trim()
            : 'npx workspai doctor project --json',
        files: asStringArray(step.files),
        notes: [
          `Source Doctor step: ${id}`,
          ...(typeof studioStatus?.reason === 'string' ? [studioStatus.reason] : []),
        ],
        scope: 'project',
        projectName,
        projectPath,
        sourceStepId: id,
        dependsOn: asStringArray(step.dependsOn).map((dependency) => `doctor.${dependency}`),
        strategy,
        transaction,
        cwd: 'project',
      }),
    ];
  });
}

function bootstrapActions(input: {
  blockers: string[];
  generatedAt: string;
}): ArtifactRemediationAction[] {
  const actions: ArtifactRemediationAction[] = [];
  const verifyCommand = normalizeBootstrapCommand('npx workspai bootstrap --json');
  for (const blocker of input.blockers) {
    if (blocker.includes('profile.enterprise.ci')) {
      actions.push(
        actionBase({
          id: 'bootstrap.enterprise-ci',
          artifactKind: 'bootstrap-compliance',
          cardId: 'bootstrap',
          title: 'Run bootstrap in deterministic CI mode',
          order: 10,
          phase: 'bootstrap-preflight',
          blocker,
          summary: 'Enterprise bootstrap compliance requires --ci for deterministic execution.',
          mode: 'run-command',
          risk: 'safe',
          command: verifyCommand,
          verifyCommand,
        })
      );
    }
    if (blocker.includes('profile.enterprise.compatibility-matrix')) {
      actions.push(
        actionBase({
          id: 'bootstrap.compatibility-matrix',
          artifactKind: 'bootstrap-compliance',
          cardId: 'bootstrap',
          title: 'Create enterprise compatibility matrix baseline',
          order: 20,
          phase: 'bootstrap-config',
          blocker,
          summary:
            'Create the missing compatibility matrix baseline without overwriting user data.',
          mode: 'edit-file',
          risk: 'safe',
          verifyCommand,
          files: ['.workspai/compatibility-matrix.json'],
          operation: {
            type: 'file-create',
            path: '.workspai/compatibility-matrix.json',
            content: buildCompatibilityMatrixContent(input.generatedAt),
            overwrite: false,
          },
        })
      );
    }
    if (blocker.includes('profile.enterprise.mirror-config')) {
      actions.push(
        actionBase({
          id: 'bootstrap.mirror-config',
          artifactKind: 'bootstrap-compliance',
          cardId: 'bootstrap',
          title: 'Create enterprise mirror config baseline',
          order: 30,
          phase: 'bootstrap-config',
          blocker,
          summary: 'Create the missing mirror configuration baseline without enabling mirroring.',
          mode: 'edit-file',
          risk: 'safe',
          verifyCommand,
          files: ['.workspai/mirror-config.json'],
          operation: {
            type: 'file-create',
            path: '.workspai/mirror-config.json',
            content: buildMirrorConfigContent(input.generatedAt),
            overwrite: false,
          },
        })
      );
    }
  }
  return actions;
}

function genericActionForReport(input: {
  report: CandidateReport;
  blocker: string;
  order: number;
  ciMode: boolean;
}): ArtifactRemediationAction {
  if (
    input.report.artifactKind === 'readiness' &&
    /dependenc(?:y|ies).*vulnerabil|vulnerabil.*dependenc(?:y|ies)|security audit/i.test(
      input.blocker
    )
  ) {
    return actionBase({
      id: `${input.report.cardId}.doctor-owner.${input.order}`,
      artifactKind: input.report.artifactKind,
      cardId: input.report.cardId,
      title: 'Resolve dependency vulnerability through Doctor',
      order: input.order,
      phase: 'dependency-remediation',
      blocker: input.blocker,
      summary:
        'Release Readiness is the aggregate gate; use the project-scoped Doctor remediation capability that owns this dependency failure.',
      mode: 'verify-before-fix',
      risk: 'guarded',
      status: 'review-required',
      command: 'npx workspai doctor workspace --plan --json',
      verifyCommand: input.ciMode
        ? 'npx workspai readiness --strict --json'
        : 'npx workspai readiness --json',
      notes: [
        'Read doctor-remediation-plan-last-run.json and execute the matching surface-security-hygiene capability before rerunning Readiness.',
        'Do not treat a Readiness refresh as remediation for a source dependency vulnerability.',
      ],
    });
  }
  const byKind: Record<string, { title: string; phase: string; command: string; verify: string }> =
    {
      analyze: {
        title: 'Refresh analyze evidence',
        phase: 'analysis',
        command: 'npx workspai analyze --strict --json',
        verify: 'npx workspai analyze --strict --json',
      },
      readiness: {
        title: 'Refresh release readiness',
        phase: 'release-readiness',
        command: input.ciMode
          ? 'npx workspai readiness --strict --json'
          : 'npx workspai readiness --json',
        verify: input.ciMode
          ? 'npx workspai readiness --strict --json'
          : 'npx workspai readiness --json',
      },
      pipeline: {
        title: 'Rerun governance pipeline',
        phase: 'governance-pipeline',
        command: 'npx workspai pipeline --json --strict',
        verify: 'npx workspai pipeline --json --strict',
      },
      'workspace-run': {
        title: 'Rerun failed workspace stage',
        phase: 'fleet-run',
        command: input.ciMode
          ? 'npx workspai workspace run test --strict --json'
          : 'npx workspai workspace run test --json',
        verify: input.ciMode
          ? 'npx workspai workspace run test --strict --json'
          : 'npx workspai workspace run test --json',
      },
      'workspace-verify': {
        title: 'Refresh workspace verify gate',
        phase: 'verification',
        command: input.ciMode
          ? 'npx workspai workspace verify --strict --json'
          : 'npx workspai workspace verify --json',
        verify: input.ciMode
          ? 'npx workspai workspace verify --strict --json'
          : 'npx workspai workspace verify --json',
      },
      'doctor-workspace': {
        title: 'Use Doctor remediation plan',
        phase: 'doctor-remediation',
        command: 'npx workspai doctor workspace --plan --json',
        verify: 'npx workspai doctor workspace --json',
      },
    };
  const command = byKind[input.report.artifactKind] ?? {
    title: 'Refresh artifact evidence',
    phase: 'evidence-refresh',
    command: 'npx workspai pipeline --json --strict',
    verify: 'npx workspai pipeline --json --strict',
  };
  return actionBase({
    id: `${input.report.cardId}.refresh.${input.order}`,
    artifactKind: input.report.artifactKind,
    cardId: input.report.cardId,
    title: command.title,
    order: input.order,
    phase: command.phase,
    blocker: input.blocker,
    summary:
      'No deterministic file operation is available for this artifact yet; refresh the evidence and continue with the card-specific plan.',
    mode: input.report.artifactKind === 'doctor-workspace' ? 'verify-before-fix' : 'run-command',
    risk: 'guarded',
    status: input.report.artifactKind === 'doctor-workspace' ? 'review-required' : 'ready',
    command: command.command,
    verifyCommand: command.verify,
    notes:
      input.report.artifactKind === 'doctor-workspace'
        ? ['Read doctor-remediation-plan-last-run.json for ordered file-level steps.']
        : [],
  });
}

async function readCandidateReports(workspacePath: string): Promise<CandidateReport[]> {
  const reportsDirs = [
    resolveWorkspaceArtifactPath(workspacePath, '.workspai/reports'),
    resolveLegacyWorkspaceArtifactPath(workspacePath, '.workspai/reports'),
  ];
  const reports: CandidateReport[] = [];
  const seen = new Set<string>();
  for (const candidate of REPORT_CANDIDATES) {
    for (const fileName of candidate.fileNames) {
      const absolutePath = (
        await Promise.all(reportsDirs.map((reportsDir) => path.join(reportsDir, fileName)))
      ).find((reportPath) => existsSync(reportPath));
      if (!absolutePath || seen.has(`${candidate.artifactKind}:${fileName}`)) {
        continue;
      }
      seen.add(`${candidate.artifactKind}:${fileName}`);
      try {
        const payload = (await fsExtra.readJSON(absolutePath)) as unknown;
        const record = asRecord(payload);
        if (!record) {
          continue;
        }
        reports.push({
          artifactKind: candidate.artifactKind,
          cardId: candidate.cardId,
          fileName,
          absolutePath,
          payload: record,
        });
      } catch {
        reports.push({
          artifactKind: candidate.artifactKind,
          cardId: candidate.cardId,
          fileName,
          absolutePath,
          payload: {
            blockers: [`${candidate.artifactKind}: report exists but could not be parsed.`],
          },
        });
      }
    }
  }
  return reports;
}

export async function buildArtifactRemediationPlan(input: {
  workspacePath: string;
  includeAbsolutePaths?: boolean;
  ciMode?: boolean;
}): Promise<ArtifactRemediationPlan> {
  const workspacePath = path.resolve(input.workspacePath);
  const includeAbsolutePaths = input.includeAbsolutePaths === true;
  const ciMode = input.ciMode === true;
  const generatedAt = new Date().toISOString();
  const reportsDir = resolveWorkspaceArtifactPath(workspacePath, '.workspai/reports');
  const reports = await readCandidateReports(workspacePath);
  const actions: ArtifactRemediationAction[] = [];
  let order = 1;

  for (const report of reports) {
    if (report.artifactKind === 'doctor-workspace') {
      const doctorActions = doctorPlanActions({
        report,
        workspacePath,
        includeAbsolutePaths,
        startOrder: order,
      });
      actions.push(...doctorActions);
      order += doctorActions.length;
      continue;
    }
    const blockers = blockerListForReport(report);
    if (blockers.length === 0) {
      continue;
    }
    if (report.artifactKind === 'bootstrap-compliance') {
      actions.push(...bootstrapActions({ blockers, generatedAt }));
      order = actions.length + 1;
      continue;
    }
    for (const blocker of blockers.slice(0, 8)) {
      actions.push(genericActionForReport({ report, blocker, order, ciMode }));
      order += 1;
    }
  }

  const risk: Record<ArtifactRemediationRisk, number> = {
    safe: actions.filter((action) => action.risk === 'safe').length,
    guarded: actions.filter((action) => action.risk === 'guarded').length,
    invasive: actions.filter((action) => action.risk === 'invasive').length,
  };
  return {
    schemaVersion: ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION,
    generatedAt,
    workspace: {
      name: path.basename(workspacePath),
      ...(includeAbsolutePaths ? { path: workspacePath } : {}),
    },
    source: {
      command: 'workspace remediation-plan',
      reportsDir: relativeOrAbsolute(workspacePath, reportsDir, includeAbsolutePaths),
      includeAbsolutePaths,
      ciMode,
    },
    summary: {
      artifactsScanned: reports.length,
      cardsCovered: uniqueStrings(actions.map((action) => action.cardId)).length,
      totalActions: actions.length,
      executableActions: actions.filter((action) => action.status === 'ready').length,
      risk,
    },
    actions,
  };
}

export async function writeArtifactRemediationPlan(
  plan: ArtifactRemediationPlan,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    '.workspai/reports/artifact-remediation-plan-last-run.json',
    plan
  );
}
