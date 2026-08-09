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
  DoctorRepairOperation,
  DoctorRepairStrategyStage,
} from './utils/doctor-repair-capabilities.js';
import { buildDoctorInternalRepairCommand } from './utils/doctor-repair-capabilities.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';

export type ArtifactRemediationRisk = 'safe' | 'guarded' | 'invasive';
export type ArtifactRemediationMode =
  'edit-file' | 'run-command' | 'refresh-evidence' | 'verify-before-fix' | 'manual-guidance';

export type ArtifactRemediationOperation =
  | DoctorRepairOperation
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
  findingId: string;
  findingStatus: 'blocking' | 'advisory' | 'informational' | 'unknown';
  causalKey: string;
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
  invocation?: {
    cwd: string;
    executable: string;
    args: string[];
  };
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
    fileNames: ['doctor-remediation-plan-last-run.json', 'doctor-last-run.json'],
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

function doctorActionAuthority(action: ArtifactRemediationAction): number {
  return (
    (action.notes.includes('Doctor finding status: blocking') ? 16 : 0) +
    (action.transaction ? 8 : 0) +
    (action.operation ? 4 : 0) +
    (action.invocation ? 2 : 0) +
    (action.strategy?.length ? 1 : 0)
  );
}

function mergeDuplicateDoctorAction(input: {
  existing: ArtifactRemediationAction;
  incoming: ArtifactRemediationAction;
}): ArtifactRemediationAction {
  const incomingWins =
    doctorActionAuthority(input.incoming) > doctorActionAuthority(input.existing);
  const primary = structuredClone(incomingWins ? input.incoming : input.existing);
  const secondary = incomingWins ? input.existing : input.incoming;
  const secondaryCapability = secondary.sourceStepId;

  primary.order = input.existing.order;
  primary.files = uniqueStrings([...primary.files, ...secondary.files]);
  primary.notes = uniqueStrings([
    ...primary.notes,
    ...secondary.notes.filter(
      (note) =>
        !note.startsWith('Source Doctor capability:') && !note.startsWith('Doctor finding status:')
    ),
    ...(secondaryCapability ? [`Also satisfies Doctor capability: ${secondaryCapability}`] : []),
  ]);
  return primary;
}

function relativeOrAbsolute(
  workspacePath: string,
  filePath: string,
  includeAbsolutePaths: boolean
): string {
  return includeAbsolutePaths
    ? filePath
    : path.relative(workspacePath, filePath).split(path.sep).join('/');
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
      schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.compatibilityMatrix.schemaVersion,
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
  invocation?: {
    cwd: string;
    executable: string;
    args: string[];
  };
  verifyCommand: string;
  files?: string[];
  operation?: ArtifactRemediationOperation;
  notes?: string[];
  scope?: ArtifactRemediationAction['scope'];
  projectName?: string;
  projectPath?: string;
  sourceStepId?: string;
  findingId?: string;
  findingStatus?: ArtifactRemediationAction['findingStatus'];
  dependsOn?: string[];
  strategy?: DoctorRepairStrategyStage[];
  transaction?: DoctorDependencyRepairTransaction;
  cwd?: ArtifactRemediationAction['cwd'];
  rollback?: ArtifactRemediationAction['rollback'];
}): ArtifactRemediationAction {
  const findingId = input.findingId?.trim() || input.sourceStepId?.trim() || input.id;
  const findingStatus = input.findingStatus ?? 'blocking';
  const causalKey = [input.cardId, input.projectName ?? input.scope ?? 'workspace', findingId]
    .map((value) => String(value).trim().toLowerCase())
    .join(':');
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
    findingId,
    findingStatus,
    causalKey,
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
    ...(input.invocation ? { invocation: structuredClone(input.invocation) } : {}),
    verifyCommand: input.verifyCommand,
    cwd: input.cwd ?? 'workspace',
    files: input.files ?? [],
    ...(input.operation ? { operation: input.operation } : {}),
    rollback:
      input.rollback ??
      (input.operation
        ? { available: true, strategy: 'idempotent' }
        : { available: false, strategy: 'none' }),
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
    const command = portableCommandFromCapability({
      capability: { ...step, command: originalCommand },
      absoluteProjectPath,
      includeAbsolutePaths: input.includeAbsolutePaths,
    });
    const invocation = portableInvocationFromCapability({
      capability: step,
      absoluteProjectPath,
      includeAbsolutePaths: input.includeAbsolutePaths,
    });
    const operation = portableDoctorOperation({
      operation: step.operation,
      absoluteProjectPath,
    });
    const findingStatus =
      step.findingStatus === 'blocking' ||
      step.findingStatus === 'advisory' ||
      step.findingStatus === 'informational'
        ? step.findingStatus
        : 'unknown';
    const findingId =
      typeof step.issueId === 'string' && step.issueId.trim() ? step.issueId.trim() : id;
    const executable = step.executableInCurrentEnvironment === true && Boolean(command);
    const strategy = portableDoctorStrategy({
      strategy: step.strategy,
      includeAbsolutePaths: input.includeAbsolutePaths,
    });
    const transactionRecord = asRecord(step.transaction);
    const transaction =
      transactionRecord?.schemaVersion === 'workspai.doctor-dependency-repair-transaction.v1'
        ? (structuredClone(transactionRecord) as unknown as DoctorDependencyRepairTransaction)
        : undefined;
    if (transaction) {
      transaction.projectPath = projectPath;
    }
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
        ...(executable && command ? { command } : {}),
        ...(executable && invocation ? { invocation } : {}),
        ...(operation ? { operation } : {}),
        verifyCommand:
          typeof step.verifyCommand === 'string' && step.verifyCommand.trim()
            ? step.verifyCommand.trim()
            : 'npx workspai doctor project --json',
        files: asStringArray(step.files).map((filePath) => {
          const absoluteFilePath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(absoluteProjectPath, filePath);
          return relativeOrAbsolute(
            input.workspacePath,
            absoluteFilePath,
            input.includeAbsolutePaths
          );
        }),
        notes: [
          `Source Doctor step: ${id}`,
          `Doctor finding id: ${findingId}`,
          `Doctor finding status: ${findingStatus}`,
          ...(typeof studioStatus?.reason === 'string' ? [studioStatus.reason] : []),
        ],
        scope: 'project',
        projectName,
        projectPath,
        sourceStepId: id,
        findingId,
        findingStatus,
        dependsOn: asStringArray(step.dependsOn).map((dependency) => `doctor.${dependency}`),
        strategy,
        transaction,
        cwd: 'project',
        ...(asRecord(step.rollback)?.available === true
          ? { rollback: { available: true, strategy: 'manual' as const } }
          : {}),
      }),
    ];
  });
}

function portableCommandFromCapability(input: {
  capability: ReportRecord;
  absoluteProjectPath: string;
  includeAbsolutePaths: boolean;
}): string | undefined {
  const original =
    typeof input.capability.command === 'string' ? input.capability.command.trim() : '';
  if (input.includeAbsolutePaths && original) return original;

  const operation = portableDoctorOperation({
    operation: input.capability.operation,
    absoluteProjectPath: input.absoluteProjectPath,
  });
  if (operation) {
    return buildDoctorInternalRepairCommand(operation);
  }

  const invocation = asRecord(input.capability.invocation);
  const executable = typeof invocation?.executable === 'string' ? invocation.executable.trim() : '';
  const args = asStringArray(invocation?.args);
  if (executable) {
    return [executable, ...args]
      .map((part) => (/^[a-zA-Z0-9_./:@=+-]+$/.test(part) ? part : JSON.stringify(part)))
      .join(' ');
  }

  if (!original) return undefined;

  const escapedProjectPath = input.absoluteProjectPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return original
    .replace(new RegExp(`^cd\\s+["']?${escapedProjectPath}["']?\\s*&&\\s*`, 'i'), '')
    .replaceAll(input.absoluteProjectPath, '.');
}

function portableInvocationFromCapability(input: {
  capability: ReportRecord;
  absoluteProjectPath: string;
  includeAbsolutePaths: boolean;
}): ArtifactRemediationAction['invocation'] | undefined {
  const invocation = asRecord(input.capability.invocation);
  const executable = typeof invocation?.executable === 'string' ? invocation.executable.trim() : '';
  const args = asStringArray(invocation?.args);
  if (
    !executable ||
    args.length !== (Array.isArray(invocation?.args) ? invocation.args.length : 0)
  ) {
    return undefined;
  }
  return {
    cwd: input.includeAbsolutePaths ? input.absoluteProjectPath : '.',
    executable,
    args,
  };
}

function portableDoctorOperation(input: {
  operation: unknown;
  absoluteProjectPath: string;
}): DoctorRepairOperation | undefined {
  const operation = asRecord(input.operation);
  if (!operation || typeof operation.type !== 'string') return undefined;

  const portable = structuredClone(operation);
  for (const key of ['path', 'sourcePath'] as const) {
    const value = portable[key];
    if (typeof value !== 'string') continue;
    const relativePath = path.isAbsolute(value)
      ? path.relative(input.absoluteProjectPath, value)
      : value;
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return undefined;
    }
    portable[key] = relativePath.split(path.sep).join('/');
  }
  return portable as unknown as DoctorRepairOperation;
}

function portableDoctorStrategy(input: {
  strategy: unknown;
  includeAbsolutePaths: boolean;
}): DoctorRepairStrategyStage[] | undefined {
  if (!Array.isArray(input.strategy)) return undefined;
  const strategy = structuredClone(input.strategy) as DoctorRepairStrategyStage[];
  if (!input.includeAbsolutePaths) {
    for (const stage of strategy) {
      if (stage.invocation) stage.invocation.cwd = '.';
    }
  }
  return strategy;
}

function doctorEvidenceActions(input: {
  report: CandidateReport;
  workspacePath: string;
  includeAbsolutePaths: boolean;
  startOrder: number;
}): ArtifactRemediationAction[] {
  const projects = Array.isArray(input.report.payload.projects)
    ? input.report.payload.projects
    : input.report.payload.project
      ? [input.report.payload.project]
      : [];
  const seen = new Set<string>();
  const actions: ArtifactRemediationAction[] = [];

  for (const rawProject of projects) {
    const project = asRecord(rawProject);
    if (!project) continue;
    const projectName = typeof project.name === 'string' ? project.name.trim() : '';
    const absoluteProjectPath = typeof project.path === 'string' ? project.path.trim() : '';
    if (!projectName || !absoluteProjectPath) continue;

    const capabilities = Array.isArray(project.repairCapabilities)
      ? project.repairCapabilities
      : Array.isArray(project.probes)
        ? project.probes
            .map((probe) => asRecord(probe)?.repairCapability)
            .filter((capability) => capability !== undefined)
        : [];
    const probeFindingStatus = new Map<string, 'blocking' | 'advisory'>();
    for (const rawProbe of Array.isArray(project.probes) ? project.probes : []) {
      const probe = asRecord(rawProbe);
      const capability = asRecord(probe?.repairCapability);
      const capabilityId = typeof capability?.id === 'string' ? capability.id.trim() : '';
      if (!capabilityId) continue;
      probeFindingStatus.set(capabilityId, probe?.status === 'fail' ? 'blocking' : 'advisory');
    }

    for (const rawCapability of capabilities) {
      const capability = asRecord(rawCapability);
      const capabilityId = typeof capability?.id === 'string' ? capability.id.trim() : '';
      if (!capability || !capabilityId) continue;
      const identity = `${projectName}:${capabilityId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const risk =
        capability.risk === 'safe' ||
        capability.risk === 'guarded' ||
        capability.risk === 'invasive'
          ? capability.risk
          : 'guarded';
      const command = portableCommandFromCapability({
        capability,
        absoluteProjectPath,
        includeAbsolutePaths: input.includeAbsolutePaths,
      });
      const invocation = portableInvocationFromCapability({
        capability,
        absoluteProjectPath,
        includeAbsolutePaths: input.includeAbsolutePaths,
      });
      const operation = portableDoctorOperation({
        operation: capability.operation,
        absoluteProjectPath,
      });
      const canExecute = capability.status === 'available' && Boolean(command);
      const transactionRecord = asRecord(capability.transaction);
      const transaction =
        transactionRecord?.schemaVersion === 'workspai.doctor-dependency-repair-transaction.v1'
          ? (structuredClone(transactionRecord) as unknown as DoctorDependencyRepairTransaction)
          : undefined;
      const findingStatus =
        probeFindingStatus.get(capabilityId) ?? (transaction ? 'blocking' : 'advisory');
      if (transaction) {
        transaction.projectPath = relativeOrAbsolute(
          input.workspacePath,
          absoluteProjectPath,
          input.includeAbsolutePaths
        );
      }
      const strategy = portableDoctorStrategy({
        strategy: capability.strategy,
        includeAbsolutePaths: input.includeAbsolutePaths,
      });
      const files = asStringArray(capability.files).map((filePath) =>
        relativeOrAbsolute(input.workspacePath, filePath, input.includeAbsolutePaths)
      );
      const incomingAction = actionBase({
        id: `doctor.${projectName}.${capabilityId}`,
        artifactKind: input.report.artifactKind,
        cardId: input.report.cardId,
        title:
          typeof capability.title === 'string' && capability.title.trim()
            ? capability.title.trim()
            : `Repair ${projectName}`,
        order: input.startOrder + actions.length,
        phase: transaction ? 'dependency-remediation' : 'doctor-remediation',
        blocker:
          typeof capability.reason === 'string' && capability.reason.trim()
            ? capability.reason.trim()
            : `Doctor remediation is pending for ${projectName}.`,
        summary:
          typeof capability.reason === 'string' && capability.reason.trim()
            ? capability.reason.trim()
            : `Execute the Doctor-authored repair capability for ${projectName}.`,
        mode: canExecute
          ? capability.canEditFiles === true
            ? 'edit-file'
            : 'run-command'
          : 'manual-guidance',
        risk,
        status: canExecute ? 'ready' : capability.status === 'manual' ? 'guidance-only' : 'blocked',
        ...(command ? { command } : {}),
        ...(invocation ? { invocation } : {}),
        verifyCommand:
          typeof capability.verifyCommand === 'string' && capability.verifyCommand.trim()
            ? capability.verifyCommand.trim()
            : 'npx workspai doctor project --json',
        files,
        notes: [
          `Source Doctor capability: ${capabilityId}`,
          `Doctor finding status: ${findingStatus}`,
          ...asStringArray(capability.limitations),
        ],
        scope: 'project',
        projectName,
        projectPath: relativeOrAbsolute(
          input.workspacePath,
          absoluteProjectPath,
          input.includeAbsolutePaths
        ),
        sourceStepId: capabilityId,
        findingId:
          typeof capability.issueId === 'string' && capability.issueId.trim()
            ? capability.issueId.trim()
            : capabilityId,
        findingStatus,
        strategy,
        transaction,
        cwd: 'project',
        ...(operation
          ? {
              operation,
              rollback: { available: true, strategy: 'manual' as const },
            }
          : {}),
      });
      const duplicateIndex = command
        ? actions.findIndex(
            (action) =>
              action.projectName === projectName &&
              action.command === command &&
              action.cwd === 'project'
          )
        : -1;
      if (duplicateIndex >= 0) {
        actions[duplicateIndex] = mergeDuplicateDoctorAction({
          existing: actions[duplicateIndex],
          incoming: incomingAction,
        });
        continue;
      }

      actions.push(incomingAction);
    }
  }

  return actions;
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
          files: [WORKSPACE_SUPPLEMENTAL_ARTIFACTS.compatibilityMatrix],
          operation: {
            type: 'file-create',
            path: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.compatibilityMatrix,
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

function workspaceVerifyActions(input: {
  report: CandidateReport;
  startOrder: number;
  ciMode: boolean;
}): ArtifactRemediationAction[] {
  const steps = Array.isArray(input.report.payload.steps) ? input.report.payload.steps : [];
  const actions: ArtifactRemediationAction[] = [];
  const lastProjectAction = new Map<string, string>();

  for (const rawStep of steps) {
    const step = asRecord(rawStep);
    const command = asRecord(step?.command);
    const id = typeof step?.id === 'string' ? step.id.trim() : '';
    const projectName = typeof step?.project === 'string' ? step.project.trim() : '';
    const status = typeof step?.status === 'string' ? step.status : '';
    const display = typeof command?.display === 'string' ? command.display.trim() : '';
    const required = step?.required === true;
    if (
      !id.startsWith('project.') ||
      !projectName ||
      !required ||
      (status !== 'fail' && status !== 'missing') ||
      !/^npx\s+workspai\s+workspace\s+run\s+/i.test(display)
    ) {
      continue;
    }

    const stage = id.split('.').at(-1) ?? 'stage';
    const actionId = `workspaceVerify.${id}`;
    const previousAction = lastProjectAction.get(projectName);
    const commandText = /(?:^|\s)--no-gates(?:\s|$)/.test(display)
      ? display
      : `${display} --no-gates`;
    actions.push(
      actionBase({
        id: actionId,
        artifactKind: input.report.artifactKind,
        cardId: input.report.cardId,
        title:
          typeof step.label === 'string' && step.label.trim()
            ? step.label.trim()
            : `Run ${stage} for ${projectName}`,
        order: input.startOrder + actions.length,
        phase: 'fleet-run',
        blocker:
          typeof step.message === 'string' && step.message.trim()
            ? step.message.trim()
            : `${stage} evidence is not current for ${projectName}.`,
        summary: `Produce fresh ${stage} evidence for ${projectName} without re-entering the blocked aggregate gates.`,
        mode: 'run-command',
        risk: stage === 'start' ? 'guarded' : 'safe',
        status: 'ready',
        command: commandText,
        verifyCommand: input.ciMode
          ? 'npx workspai workspace verify --strict --json'
          : 'npx workspai workspace verify --json',
        scope: 'project',
        projectName,
        projectPath: projectName,
        sourceStepId: id,
        ...(previousAction ? { dependsOn: [previousAction] } : {}),
        cwd: 'workspace',
        notes: [
          `Source Workspace Verify step: ${id}`,
          'Aggregate verification must run only after this project evidence producer completes.',
        ],
      })
    );
    lastProjectAction.set(projectName, actionId);
  }

  return actions;
}

function readinessEnvironmentActions(input: {
  report: CandidateReport;
  blockers: string[];
  startOrder: number;
  ciMode: boolean;
}): ArtifactRemediationAction[] {
  const runtimes = uniqueStrings(
    input.blockers.flatMap((blocker) => {
      const match = blocker.match(
        /(?:project runtimes?|workspace)\s*\(([^)]+)\)\s+(?:is|are) not pinned/i
      );
      return match?.[1]
        ? match[1]
            .split(',')
            .map((runtime) => runtime.trim().toLowerCase())
            .filter((runtime) => /^(python|node|go|java|dotnet|rust|php)$/.test(runtime))
        : [];
    })
  );
  const actions: ArtifactRemediationAction[] = [];

  for (const runtime of runtimes) {
    const setupId = `readiness.toolchain.${runtime}.setup`;
    const blocker =
      input.blockers.find((candidate) => candidate.toLowerCase().includes(`(${runtime})`)) ??
      `The ${runtime} runtime is not pinned in the canonical workspace toolchain.`;
    actions.push(
      actionBase({
        id: setupId,
        artifactKind: input.report.artifactKind,
        cardId: input.report.cardId,
        title: `Pin ${runtime} in the workspace toolchain`,
        order: input.startOrder + actions.length,
        phase: 'toolchain-reconciliation',
        blocker,
        summary: `Detect and persist the current ${runtime} runtime in the canonical workspace toolchain lock.`,
        mode: 'run-command',
        risk: 'safe',
        command: `npx workspai setup ${runtime} --json`,
        verifyCommand: input.ciMode
          ? 'npx workspai readiness --strict --json'
          : 'npx workspai readiness --json',
        notes: ['Run from the workspace root so the canonical toolchain.lock is updated.'],
      })
    );
    actions.push(
      actionBase({
        id: `readiness.toolchain.${runtime}.bootstrap`,
        artifactKind: input.report.artifactKind,
        cardId: input.report.cardId,
        title: `Reconcile the ${runtime} workspace foundation`,
        order: input.startOrder + actions.length,
        phase: 'toolchain-reconciliation',
        blocker: `The ${runtime} runtime pin must be reconciled with the workspace foundation.`,
        summary: 'Refresh the workspace foundation after the runtime pin is written.',
        mode: 'run-command',
        risk: 'guarded',
        command: 'npx workspai bootstrap --ci --json',
        verifyCommand: input.ciMode
          ? 'npx workspai readiness --strict --json'
          : 'npx workspai readiness --json',
        dependsOn: [setupId],
      })
    );
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
        break;
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
        break;
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
      const doctorActions = Array.isArray(report.payload.steps)
        ? doctorPlanActions({
            report,
            workspacePath,
            includeAbsolutePaths,
            startOrder: order,
          })
        : doctorEvidenceActions({
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
    if (report.artifactKind === 'workspace-verify') {
      const verifyActions = workspaceVerifyActions({
        report,
        startOrder: order,
        ciMode,
      });
      if (verifyActions.length > 0) {
        actions.push(...verifyActions);
        order += verifyActions.length;
        continue;
      }
    }
    if (report.artifactKind === 'readiness') {
      const environmentActions = readinessEnvironmentActions({
        report,
        blockers,
        startOrder: order,
        ciMode,
      });
      if (environmentActions.length > 0) {
        actions.push(...environmentActions);
        order += environmentActions.length;
        continue;
      }
    }
    const dependencyTransactionExists = actions.some(
      (action) => action.transaction?.kind === 'dependency-security'
    );
    const dependencyReadinessBlocker =
      report.artifactKind === 'readiness' &&
      blockers.some((blocker) =>
        /dependenc(?:y|ies).*vulnerabil|vulnerabil.*dependenc(?:y|ies)|security audit/i.test(
          blocker
        )
      );
    if (dependencyTransactionExists && dependencyReadinessBlocker) {
      continue;
    }

    const primaryBlocker = blockers[0];
    const action = genericActionForReport({ report, blocker: primaryBlocker, order, ciMode });
    const upstreamCardsByAggregate: Record<string, Set<string>> = {
      readiness: new Set(['bootstrap', 'doctor']),
      pipeline: new Set(['bootstrap', 'doctor', 'analyze', 'readiness']),
      workspaceVerify: new Set(['bootstrap', 'doctor', 'readiness', 'workspaceRun']),
    };
    let upstreamCards = upstreamCardsByAggregate[report.cardId];
    if (report.cardId === 'pipeline') {
      const namedOwner = ['doctor', 'analyze', 'readiness'].find((cardId) =>
        primaryBlocker.toLowerCase().includes(cardId)
      );
      if (namedOwner) {
        upstreamCards = new Set([namedOwner]);
      }
    }
    if (upstreamCards) {
      const upstreamActionIds = actions
        .filter(
          (candidate) =>
            upstreamCards.has(candidate.cardId) &&
            candidate.risk !== 'invasive' &&
            candidate.status !== 'blocked' &&
            candidate.status !== 'guidance-only'
        )
        .map((candidate) => candidate.id);
      if (upstreamActionIds.length > 0) {
        action.dependsOn = uniqueStrings([...(action.dependsOn ?? []), ...upstreamActionIds]);
        action.notes.push(
          'This aggregate gate must run after its contract-owned upstream remediation actions.'
        );
      }
    }
    if (blockers.length > 1) {
      action.notes.push(...blockers.slice(1, 8).map((blocker) => `Related blocker: ${blocker}`));
    }
    actions.push(action);
    order += 1;
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
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.artifactRemediationPlan,
    plan
  );
}
