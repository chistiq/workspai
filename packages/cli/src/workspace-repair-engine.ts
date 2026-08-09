import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import fsExtra from 'fs-extra';

import {
  buildArtifactRemediationPlan,
  type ArtifactRemediationAction,
  type ArtifactRemediationPlan,
} from './artifact-remediation-plan.js';
import {
  WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH,
  WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
  WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
  type WorkspaceRepairInvocation,
  type WorkspaceRepairDecision,
  type WorkspaceRepairDecisionCause,
  type WorkspaceRepairRisk,
  type WorkspaceRepairStage,
  type WorkspaceRepairTransaction,
} from './contracts/workspace-repair-transaction-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import {
  WORKSPACE_REPAIR_PROPOSAL_CONTRACT_PATH,
  WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
  type WorkspaceRepairProposal,
  type WorkspaceRepairProposalChange,
  type WorkspaceRepairProposalValidation,
} from './contracts/workspace-repair-proposal-contract.js';
import {
  WORKSPACE_REPAIR_ADAPTER_CAPABILITIES,
  buildWorkspaceRepairCapabilitiesContract,
  type WorkspaceRepairAdapterId,
} from './contracts/workspace-repair-capabilities-contract.js';
import { STUDIO_CARD_REPAIR_CAPABILITIES } from './contracts/studio-card-repair-capabilities-contract.js';
import {
  applyEnvKeyAddFix,
  applyFileAppendFix,
  applyFileCopyFix,
  applyFileCreateFix,
  applyJsonEditFix,
  applyMakefileTargetFix,
  applyPackageScriptFix,
  parseInternalRepairCommand,
} from './doctor.js';
import { runWorkspaceIntelligenceChain } from './workspace-intelligence-runner.js';
import { resolveWorkspaceProjectLensTargets } from './project-intelligence-lens.js';
import type { DoctorRepairOperation } from './utils/doctor-repair-capabilities.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

const REPAIR_ROOT = '.workspai/repair';
const TRANSACTION_FILE = 'transaction.json';
const SOURCE_PLAN_FILE = 'source-plan.json';
const CHECKPOINT_DIR = 'checkpoint';
const LOCK_FILE = 'engine.lock';
const MAX_CHECKPOINT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CHECKPOINT_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_PROPOSAL_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const LOCK_STALE_MS = 15 * 60 * 1000;

const PROJECT_MANIFESTS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'deno.json',
  'deno.jsonc',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'deps.edn',
  'project.clj',
  'build.sbt',
]);

const DEPENDENCY_SURFACES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'uv.lock',
  'poetry.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'composer.json',
  'composer.lock',
  'Gemfile',
  'Gemfile.lock',
  'mix.exs',
  'mix.lock',
  'deno.json',
  'deno.jsonc',
  'deno.lock',
  'Directory.Packages.props',
  'packages.lock.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.lockfile',
  'deps.edn',
  'project.clj',
  'build.sbt',
]);

const RISK_ORDER: Record<WorkspaceRepairRisk, number> = {
  safe: 0,
  guarded: 1,
  invasive: 2,
};

const ALLOWED_EXECUTABLES = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'pytest',
  'pip-audit',
  'govulncheck',
  'go',
  'cargo',
  'composer',
  'bundle',
  'bundle-audit',
  'dotnet',
  'mvn',
  'mvnw',
  'gradle',
  'gradlew',
  'mix',
  'clojure',
  'lein',
  'sbt',
  'make',
]);

type RepairEngineDependencies = {
  now?: () => Date;
  runInvocation?: typeof runInvocation;
  toolAvailable?: (executable: string, cwd: string) => Promise<boolean>;
  verify?: (workspacePath: string) => Promise<{
    status: string;
    exitCode: number;
    artifactPath: string;
  }>;
  targetVerify?: (input: {
    workspacePath: string;
    transaction: WorkspaceRepairTransaction;
  }) => Promise<{
    status: 'passed' | 'failed' | 'unknown';
    remainingActionIds: string[];
  }>;
  runTargetProducer?: (input: {
    workspacePath: string;
    transaction: WorkspaceRepairTransaction;
  }) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
};

type DependencyStagePlan = {
  stages: WorkspaceRepairStage[];
  checkpointFiles: string[];
  blockers: string[];
  adapters: WorkspaceRepairAdapterEvaluation[];
};

export type WorkspaceRepairAdapterEvaluation = {
  adapterId: WorkspaceRepairAdapterId | 'unsupported';
  ecosystem: string;
  projectPath: string;
  manifests: string[];
  support: 'full' | 'conditional' | 'unsupported';
  status: 'ready' | 'partial' | 'unsupported';
  requiredExecutables: string[];
  missingExecutables: string[];
  message: string;
};

type PersistedRepairSource = ArtifactRemediationPlan | WorkspaceRepairProposal;

type RuntimeRepairAction =
  | { kind: 'canonical'; action: ArtifactRemediationAction }
  | { kind: 'proposal'; change: WorkspaceRepairProposalChange };

function decisionCauseKey(cause: WorkspaceRepairDecisionCause): string {
  return [
    cause.kind,
    cause.id,
    cause.projectPath ?? '',
    cause.adapterId ?? '',
    cause.executable ?? '',
  ].join('\0');
}

function runtimeRepairDecision(
  reason: string,
  options: WorkspaceRepairDecision[],
  cause: Omit<WorkspaceRepairDecisionCause, 'id' | 'message'> &
    Partial<Pick<WorkspaceRepairDecisionCause, 'id' | 'message'>> = {
    kind: 'failed-precondition',
  }
): NonNullable<WorkspaceRepairTransaction['decision']> {
  return {
    reason,
    options,
    causes: [
      {
        ...cause,
        id: cause.id ?? `runtime:${sha256(reason).slice(0, 16)}`,
        message: cause.message ?? reason,
      },
    ],
  };
}

function repairDecisionCauses(input: {
  actions?: ArtifactRemediationAction[];
  adapters: WorkspaceRepairAdapterEvaluation[];
  preconditions: WorkspaceRepairTransaction['preconditions'];
  stages: WorkspaceRepairStage[];
  decisionOptions: ReadonlySet<WorkspaceRepairDecision>;
  maxRisk: WorkspaceRepairRisk;
  fallbackReasons: string[];
}): WorkspaceRepairDecisionCause[] {
  const causes = new Map<string, WorkspaceRepairDecisionCause>();
  const add = (cause: WorkspaceRepairDecisionCause) => causes.set(decisionCauseKey(cause), cause);

  for (const adapter of input.adapters) {
    if (adapter.support === 'unsupported' || adapter.status === 'unsupported') {
      add({
        kind: 'unsupported-adapter',
        id: `adapter:${adapter.projectPath}:${adapter.adapterId}`,
        message: adapter.message,
        projectPath: adapter.projectPath,
        adapterId: adapter.adapterId,
      });
    }
    for (const executable of adapter.missingExecutables) {
      add({
        kind: 'missing-executable',
        id: `tool:${adapter.projectPath}:${adapter.adapterId}:${executable}`,
        message: `Required repair executable is unavailable: ${executable} (${adapter.projectPath}).`,
        projectPath: adapter.projectPath,
        adapterId: adapter.adapterId,
        executable,
      });
    }
  }

  for (const action of input.actions ?? []) {
    const operation = operationForAction(action);
    if (
      action.status === 'blocked' ||
      action.status === 'guidance-only' ||
      (!operation && !action.invocation)
    ) {
      add({
        kind: 'source-repair-required',
        id: `action:${action.id}`,
        message: action.blocker || `${action.id} requires a bounded source repair proposal.`,
        ...(action.projectPath ? { projectPath: action.projectPath } : {}),
      });
    }
    if (RISK_ORDER[action.risk] > RISK_ORDER[input.maxRisk]) {
      add({
        kind: 'risk-approval',
        id: `risk:${action.id}`,
        message: `${action.id} exceeds the approved ${input.maxRisk} risk ceiling.`,
        ...(action.projectPath ? { projectPath: action.projectPath } : {}),
      });
    }
  }

  for (const precondition of input.preconditions.filter((entry) => entry.status === 'failed')) {
    if (precondition.id === 'structured-execution') {
      add({
        kind: 'source-repair-required',
        id: `precondition:${precondition.id}`,
        message: precondition.message,
      });
      continue;
    }
    if (precondition.id.startsWith('tool:')) {
      const stage = input.stages.find(
        (candidate) =>
          candidate.invocation &&
          `tool:${candidate.invocation.cwd}:${candidate.invocation.executable}` === precondition.id
      );
      if (stage?.invocation) {
        add({
          kind: 'missing-executable',
          id: precondition.id,
          message: precondition.message,
          projectPath: stage.invocation.cwd,
          executable: stage.invocation.executable,
        });
        continue;
      }
    }
    add({
      kind: 'failed-precondition',
      id: `precondition:${precondition.id}`,
      message: precondition.message,
    });
  }

  if (input.decisionOptions.has('allow-force')) {
    add({
      kind: 'policy-exception',
      id: 'policy:allow-force',
      message: 'The proposed repair requires an explicit force-install policy exception.',
    });
  }
  if (input.decisionOptions.has('allow-breaking')) {
    add({
      kind: 'policy-exception',
      id: 'policy:allow-breaking',
      message: 'The proposed repair requires an explicit breaking-change policy exception.',
    });
  }

  if (causes.size === 0) {
    const message = input.fallbackReasons.find((reason) => reason.trim().length > 0);
    if (message) {
      add({
        kind: 'failed-precondition',
        id: `decision:${sha256(message).slice(0, 16)}`,
        message,
      });
    }
  }
  return [...causes.values()];
}

function iso(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      // Match JSON object semantics exactly. Optional in-memory properties
      // must not change the approval hash after the plan is persisted.
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  // JSON arrays serialize missing/undefined slots as null. A repair source is
  // always an object, but keeping the canonicalizer total avoids ambiguous
  // integrity hashes for nested optional arrays.
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

const CAUSAL_ACTION_INTEGRITY_PREFIX = 'causal-action-integrity:';

function causalActionFingerprint(actions: ArtifactRemediationAction[]): string {
  return sha256(
    stableJson(
      [...actions]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((action) => ({
          id: action.id,
          artifactKind: action.artifactKind,
          cardId: action.cardId,
          title: action.title,
          phase: action.phase,
          scope: action.scope,
          projectName: action.projectName,
          projectPath: action.projectPath,
          sourceStepId: action.sourceStepId,
          findingId: action.findingId,
          findingStatus: action.findingStatus,
          causalKey: action.causalKey,
          dependsOn: action.dependsOn,
          strategy: action.strategy,
          transaction: action.transaction,
          status: action.status,
          mode: action.mode,
          risk: action.risk,
          requiresApproval: action.requiresApproval,
          blocker: action.blocker,
          summary: action.summary,
          command: action.command,
          invocation: action.invocation,
          verifyCommand: action.verifyCommand,
          cwd: action.cwd,
          files: action.files,
          operation: action.operation,
          rollback: action.rollback,
          notes: action.notes,
        }))
    )
  );
}

function causalActionIntegrityPrecondition(
  actions: ArtifactRemediationAction[]
): WorkspaceRepairTransaction['preconditions'][number] | undefined {
  if (actions.length === 0) return undefined;
  const fingerprint = causalActionFingerprint(actions);
  return {
    id: `${CAUSAL_ACTION_INTEGRITY_PREFIX}${fingerprint}`,
    status: 'passed',
    message: `${actions.length} causal action(s) are semantically pinned to this approval (${fingerprint.slice(0, 12)}).`,
  };
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function insideResolvedBoundary(root: string, candidate: string): Promise<boolean> {
  const resolvedRoot = await fsExtra.realpath(root).catch(() => path.resolve(root));
  let cursor = path.resolve(candidate);
  while (!(await fsExtra.pathExists(cursor))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  const resolvedCandidate = await fsExtra.realpath(cursor).catch(() => path.resolve(cursor));
  return inside(resolvedRoot, resolvedCandidate);
}

function portable(workspacePath: string, candidate: string): string {
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspacePath, candidate);
  if (!inside(workspacePath, absolute)) {
    throw new Error(`Repair path escapes workspace boundary: ${candidate}`);
  }
  return path.relative(workspacePath, absolute).split(path.sep).join('/') || '.';
}

function transactionDir(workspacePath: string, transactionId: string): string {
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(transactionId)) {
    throw new Error('Invalid repair transaction id.');
  }
  return path.join(workspacePath, REPAIR_ROOT, 'transactions', transactionId);
}

function transactionPath(workspacePath: string, transactionId: string): string {
  return path.join(transactionDir(workspacePath, transactionId), TRANSACTION_FILE);
}

function sourcePlanPath(workspacePath: string, transactionId: string): string {
  return path.join(transactionDir(workspacePath, transactionId), SOURCE_PLAN_FILE);
}

async function atomicJson(filePath: string, payload: unknown): Promise<void> {
  await fsExtra.ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fsExtra.writeJson(temporary, payload, { spaces: 2 });
  await fsExtra.move(temporary, filePath, { overwrite: true });
}

function event(
  transaction: WorkspaceRepairTransaction,
  type: WorkspaceRepairTransaction['events'][number]['type'],
  message: string,
  options: { stageId?: string; status?: string; now?: () => Date } = {}
): void {
  transaction.events.push({
    sequence: transaction.events.length + 1,
    at: iso(options.now),
    type,
    ...(options.stageId ? { stageId: options.stageId } : {}),
    ...(options.status ? { status: options.status } : {}),
    message,
  });
}

async function saveTransaction(
  workspacePath: string,
  transaction: WorkspaceRepairTransaction,
  now?: () => Date
): Promise<void> {
  transaction.revision += 1;
  transaction.updatedAt = iso(now);
  assertJsonSchemaContract(
    transaction,
    WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
    'Workspace repair transaction'
  );
  await atomicJson(transactionPath(workspacePath, transaction.transactionId), transaction);
  await atomicJson(path.join(workspacePath, WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH), transaction);
}

export async function readWorkspaceRepairTransaction(input: {
  workspacePath: string;
  transactionId: string;
}): Promise<WorkspaceRepairTransaction> {
  const payload = (await fsExtra.readJson(
    transactionPath(input.workspacePath, input.transactionId)
  )) as WorkspaceRepairTransaction;
  if (payload.schemaVersion !== WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION) {
    throw new Error(`Unsupported repair transaction schema: ${payload.schemaVersion}`);
  }
  assertJsonSchemaContract(
    payload,
    WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
    'Workspace repair transaction'
  );
  return payload;
}

async function readSourcePlan(
  workspacePath: string,
  transactionId: string
): Promise<PersistedRepairSource> {
  return (await fsExtra.readJson(
    sourcePlanPath(workspacePath, transactionId)
  )) as PersistedRepairSource;
}

function isWorkspaceRepairProposal(
  source: PersistedRepairSource
): source is WorkspaceRepairProposal {
  return source.schemaVersion === WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION;
}

function actionProjectRoot(workspacePath: string, action: ArtifactRemediationAction): string {
  const candidate = action.scope === 'project' && action.projectPath ? action.projectPath : '.';
  const absolute = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspacePath, candidate);
  if (!inside(workspacePath, absolute)) {
    throw new Error(`Repair project scope escapes workspace: ${candidate}`);
  }
  return absolute;
}

function invocation(input: {
  workspacePath: string;
  projectPath: string;
  executable: string;
  args: string[];
  purpose: WorkspaceRepairInvocation['purpose'];
  timeoutMs?: number;
}): WorkspaceRepairInvocation {
  return {
    cwd: portable(input.workspacePath, input.projectPath),
    executable: input.executable,
    args: [...input.args],
    purpose: input.purpose,
    timeoutMs: input.timeoutMs ?? 600_000,
  };
}

async function text(filePath: string): Promise<string> {
  return fsExtra.readFile(filePath, 'utf8').catch(() => '');
}

async function json(filePath: string): Promise<Record<string, unknown>> {
  return fsExtra.readJson(filePath).catch(() => ({}));
}

function scriptInvocation(input: {
  workspacePath: string;
  projectPath: string;
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  script: string;
  purpose: 'test' | 'build';
}): WorkspaceRepairInvocation {
  const args = input.manager === 'yarn' ? [input.script] : ['run', input.script];
  return invocation({ ...input, executable: input.manager, args, purpose: input.purpose });
}

function pathExecutableCandidates(executable: string): string[] {
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((entry) => entry.toLowerCase())
      : [''];
  const hasExtension = path.extname(executable).length > 0;
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      hasExtension
        ? [path.join(directory, executable)]
        : extensions.map((extension) => path.join(directory, `${executable}${extension}`))
    );
}

function isRunnableFile(stat: Stats | undefined): boolean {
  if (!stat?.isFile()) return false;
  // Windows determines executability from PATHEXT. POSIX wrappers and local
  // tools must carry at least one execute bit; merely existing is not enough
  // to satisfy a repair precondition.
  return process.platform === 'win32' || (stat.mode & 0o111) !== 0;
}

async function invocationToolAvailable(input: {
  workspacePath: string;
  invocation: WorkspaceRepairInvocation;
  toolAvailable?: RepairEngineDependencies['toolAvailable'];
}): Promise<boolean> {
  const cwd = path.resolve(input.workspacePath, input.invocation.cwd);
  if (input.toolAvailable) {
    return input.toolAvailable(input.invocation.executable, cwd);
  }
  const executable = input.invocation.executable;
  if (path.isAbsolute(executable) || /^\.{1,2}[\\/]/.test(executable)) {
    const candidate = path.isAbsolute(executable) ? executable : path.resolve(cwd, executable);
    const stat = await fsExtra.stat(candidate).catch(() => undefined);
    return isRunnableFile(stat);
  }
  for (const candidate of pathExecutableCandidates(executable)) {
    const stat = await fsExtra.stat(candidate).catch(() => undefined);
    if (isRunnableFile(stat)) return true;
  }
  return false;
}

async function toolPreconditions(input: {
  workspacePath: string;
  stages: WorkspaceRepairStage[];
  toolAvailable?: RepairEngineDependencies['toolAvailable'];
}): Promise<WorkspaceRepairTransaction['preconditions']> {
  const deferredExecutables = new Set<string>();
  for (const stage of input.stages) {
    if (stage.kind !== 'repair' || !stage.invocation) continue;
    const name = executableName(stage.invocation.executable);
    if (
      !['python', 'python3', 'py'].includes(name) ||
      !stage.invocation.args.includes('venv') ||
      !stage.invocation.args.includes('.venv')
    ) {
      continue;
    }
    deferredExecutables.add(
      path.normalize(
        path.join(
          path.resolve(input.workspacePath, stage.invocation.cwd),
          '.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
        )
      )
    );
  }
  const invocations = input.stages
    .filter((stage) => stage.required && stage.status !== 'skipped' && stage.invocation)
    .map((stage) => stage.invocation as WorkspaceRepairInvocation);
  const unique = new Map<string, WorkspaceRepairInvocation>();
  for (const invocation of invocations) {
    unique.set(`${invocation.cwd}\0${invocation.executable}`, invocation);
  }
  const result: WorkspaceRepairTransaction['preconditions'] = [];
  for (const invocation of unique.values()) {
    const executablePath = path.isAbsolute(invocation.executable)
      ? path.normalize(invocation.executable)
      : path.normalize(path.resolve(input.workspacePath, invocation.cwd, invocation.executable));
    if (deferredExecutables.has(executablePath)) {
      result.push({
        id: `tool:${invocation.cwd}:${invocation.executable}`,
        status: 'passed',
        message: `Repair stage will create the isolated executable before use: ${invocation.executable} (${invocation.cwd}).`,
      });
      continue;
    }
    const available = await invocationToolAvailable({
      workspacePath: input.workspacePath,
      invocation,
      toolAvailable: input.toolAvailable,
    });
    result.push({
      id: `tool:${invocation.cwd}:${invocation.executable}`,
      status: available ? 'passed' : 'failed',
      message: available
        ? `Required repair executable is available: ${invocation.executable} (${invocation.cwd}).`
        : `Required repair executable is unavailable: ${invocation.executable} (${invocation.cwd}). Install or configure it, then create a fresh plan.`,
    });
  }
  return result;
}

function skippedStage(
  id: string,
  kind: WorkspaceRepairStage['kind'],
  summary: string
): WorkspaceRepairStage {
  return { id, kind, status: 'skipped', required: false, risk: 'safe', summary };
}

function pendingStage(input: {
  id: string;
  kind: WorkspaceRepairStage['kind'];
  risk?: WorkspaceRepairRisk;
  summary: string;
  invocation?: WorkspaceRepairInvocation;
  required?: boolean;
}): WorkspaceRepairStage {
  return {
    id: input.id,
    kind: input.kind,
    status: input.invocation ? 'pending' : input.required === false ? 'skipped' : 'blocked',
    required: input.required ?? true,
    risk: input.risk ?? 'safe',
    summary: input.summary,
    ...(input.invocation ? { invocation: input.invocation } : {}),
  };
}

function strategyAuditInvocation(
  workspacePath: string,
  projectPath: string,
  action: ArtifactRemediationAction
): WorkspaceRepairInvocation | undefined {
  const candidate = action.strategy?.find(
    (stage) => stage.kind === 'verify' && stage.invocation
  )?.invocation;
  if (!candidate) return undefined;
  return invocation({
    workspacePath,
    projectPath,
    executable: candidate.executable,
    args: candidate.args,
    purpose: 'audit',
  });
}

async function dependencyStagePlanForAdapter(input: {
  workspacePath: string;
  action: ArtifactRemediationAction;
  adapterId: WorkspaceRepairAdapterId;
}): Promise<DependencyStagePlan> {
  const projectPath = actionProjectRoot(input.workspacePath, input.action);
  const relativeProject = portable(input.workspacePath, projectPath);
  const exists = async (name: string) => fsExtra.pathExists(path.join(projectPath, name));
  const checkpointFiles = new Set<string>();
  const stages: WorkspaceRepairStage[] = [];
  const blockers: string[] = [];
  const stageId = (kind: string) => `${relativeProject}:${input.adapterId}:${kind}`;
  const addFiles = (names: string[]) =>
    names.forEach((name) =>
      checkpointFiles.add(portable(input.workspacePath, path.join(projectPath, name)))
    );
  const add = (stage: WorkspaceRepairStage) => {
    stages.push(stage);
    if (stage.required && stage.status === 'blocked') blockers.push(stage.summary);
  };
  const audit = strategyAuditInvocation(input.workspacePath, projectPath, input.action);

  const finalize = (): DependencyStagePlan => {
    const capability = WORKSPACE_REPAIR_ADAPTER_CAPABILITIES.find(
      (candidate) => candidate.id === input.adapterId
    );
    if (!capability) throw new Error(`Unknown workspace repair adapter: ${input.adapterId}`);
    return {
      stages,
      checkpointFiles: [...checkpointFiles],
      blockers,
      adapters: [
        {
          adapterId: capability.id,
          ecosystem: capability.ecosystem,
          projectPath: relativeProject,
          manifests: capability.manifests,
          support: capability.support,
          status: blockers.length > 0 ? 'partial' : 'ready',
          requiredExecutables: [
            ...new Set(
              stages
                .filter((stage) => stage.required && stage.invocation)
                .map((stage) => (stage.invocation as WorkspaceRepairInvocation).executable)
            ),
          ],
          missingExecutables: [],
          message:
            blockers.length > 0
              ? [...new Set(blockers)].join(' ')
              : `${capability.ecosystem} repair stages are deterministically planned.`,
        },
      ],
    };
  };

  if (input.adapterId === 'node' && (await exists('package.json'))) {
    const manifest = await json(path.join(projectPath, 'package.json'));
    const scripts =
      manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
        ? (manifest.scripts as Record<string, unknown>)
        : {};
    const manager: 'npm' | 'pnpm' | 'yarn' | 'bun' =
      (await exists('bun.lock')) || (await exists('bun.lockb'))
        ? 'bun'
        : (await exists('pnpm-lock.yaml'))
          ? 'pnpm'
          : (await exists('yarn.lock'))
            ? 'yarn'
            : 'npm';
    const lock =
      manager === 'bun'
        ? (await exists('bun.lock'))
          ? 'bun.lock'
          : 'bun.lockb'
        : manager === 'pnpm'
          ? 'pnpm-lock.yaml'
          : manager === 'yarn'
            ? 'yarn.lock'
            : (await exists('npm-shrinkwrap.json'))
              ? 'npm-shrinkwrap.json'
              : 'package-lock.json';
    addFiles(['package.json', lock]);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: `Reconcile ${manager} manifest, lockfile, and installed tree.`,
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: manager,
          args: ['install'],
          purpose: 'reconcile',
        }),
      })
    );
    const fallbackAudit =
      manager === 'npm'
        ? invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: 'npm',
            args: ['audit', '--audit-level=moderate', '--json'],
            purpose: 'audit',
          })
        : manager === 'pnpm'
          ? invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: 'pnpm',
              args: ['audit', '--audit-level=moderate', '--json'],
              purpose: 'audit',
            })
          : manager === 'yarn'
            ? invocation({
                workspacePath: input.workspacePath,
                projectPath,
                executable: 'yarn',
                args: ['npm', 'audit', '--json', '--severity', 'moderate'],
                purpose: 'audit',
              })
            : invocation({
                workspacePath: input.workspacePath,
                projectPath,
                executable: 'bun',
                args: ['audit', '--json'],
                purpose: 'audit',
              });
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Prove the dependency advisory graph is clean.',
        invocation: audit ?? fallbackAudit,
      })
    );
    add(
      typeof scripts.test === 'string' && scripts.test.trim()
        ? pendingStage({
            id: stageId('test'),
            kind: 'test',
            summary: 'Run the declared project test contract.',
            invocation: scriptInvocation({
              workspacePath: input.workspacePath,
              projectPath,
              manager,
              script: 'test',
              purpose: 'test',
            }),
          })
        : skippedStage(stageId('test'), 'test', 'No test script is declared.')
    );
    add(
      typeof scripts.build === 'string' && scripts.build.trim()
        ? pendingStage({
            id: stageId('build'),
            kind: 'build',
            summary: 'Run the declared project build contract.',
            invocation: scriptInvocation({
              workspacePath: input.workspacePath,
              projectPath,
              manager,
              script: 'build',
              purpose: 'build',
            }),
          })
        : skippedStage(stageId('build'), 'build', 'No build script is declared.')
    );
    return finalize();
  }

  if (
    input.adapterId === 'python' &&
    ((await exists('pyproject.toml')) || (await exists('requirements.txt')))
  ) {
    addFiles(['pyproject.toml', 'requirements.txt', 'uv.lock', 'poetry.lock']);
    const declaredEcosystem = input.action.transaction?.ecosystem.toLowerCase();
    const repairExecutable = path
      .basename(input.action.invocation?.executable ?? '')
      .toLowerCase()
      .replace(/\.(?:cmd|bat|exe)$/i, '');
    const usesUv =
      repairExecutable === 'uv' || declaredEcosystem === 'uv' || (await exists('uv.lock'));
    const usesPoetry =
      !usesUv &&
      (repairExecutable === 'poetry' ||
        declaredEcosystem === 'poetry' ||
        (await exists('poetry.lock')));
    const createsManagedVenv =
      !usesUv &&
      !usesPoetry &&
      ['python', 'python3', 'py'].includes(repairExecutable) &&
      (input.action.invocation?.args ?? []).some((arg) => arg === 'venv') &&
      (input.action.invocation?.args ?? []).some((arg) => arg === '.venv');
    let python = process.platform === 'win32' ? 'python' : 'python3';
    const venvPython = path.join(
      projectPath,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
    if ((await fsExtra.pathExists(venvPython)) || createsManagedVenv) python = venvPython;
    const reconcile = usesUv
      ? invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'uv',
          args: ['sync'],
          purpose: 'reconcile',
        })
      : usesPoetry
        ? invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: 'poetry',
            args: ['install', '--no-interaction'],
            purpose: 'reconcile',
          })
        : (await exists('requirements.txt')) && inside(input.workspacePath, python)
          ? invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: python,
              args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
              purpose: 'reconcile',
            })
          : (await exists('pyproject.toml')) && inside(input.workspacePath, python)
            ? invocation({
                workspacePath: input.workspacePath,
                projectPath,
                executable: python,
                args: ['-m', 'pip', 'install', '-e', '.'],
                purpose: 'reconcile',
              })
            : undefined;
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: 'Reconcile the isolated Python dependency environment.',
        invocation: reconcile,
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Prove the Python advisory graph is clean.',
        invocation: audit,
      })
    );
    const pyproject = await text(path.join(projectPath, 'pyproject.toml'));
    const hasTests = (await exists('tests')) || /\[tool\.pytest/i.test(pyproject);
    const pythonTestInvocation = usesPoetry
      ? invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'poetry',
          args: ['run', 'python', '-m', 'pytest'],
          purpose: 'test',
        })
      : usesUv
        ? invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: 'uv',
            args: ['run', 'python', '-m', 'pytest'],
            purpose: 'test',
          })
        : invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: python,
            args: ['-m', 'pytest'],
            purpose: 'test',
          });
    const pythonBuildInvocation = usesPoetry
      ? invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'poetry',
          args: ['build'],
          purpose: 'build',
        })
      : usesUv
        ? invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: 'uv',
            args: ['build'],
            purpose: 'build',
          })
        : invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: python,
            args: ['-m', 'build'],
            purpose: 'build',
          });
    add(
      hasTests
        ? pendingStage({
            id: stageId('test'),
            kind: 'test',
            summary: 'Run the Python test contract.',
            invocation: pythonTestInvocation,
          })
        : skippedStage(stageId('test'), 'test', 'No Python test surface is declared.')
    );
    add(
      /\[build-system\]/i.test(pyproject)
        ? pendingStage({
            id: stageId('build'),
            kind: 'build',
            summary: 'Build the declared Python package.',
            invocation: pythonBuildInvocation,
          })
        : skippedStage(stageId('build'), 'build', 'No Python build contract is declared.')
    );
    return finalize();
  }

  const runtimePlans: Array<{
    adapterId: WorkspaceRepairAdapterId;
    manifest: string;
    alternateManifest?: string;
    files: string[];
    reconcile: [string, string[]];
    audit?: [string, string[]];
    test: [string, string[]];
    build: [string, string[]];
  }> = [
    {
      adapterId: 'go',
      manifest: 'go.mod',
      files: ['go.mod', 'go.sum'],
      reconcile: ['go', ['mod', 'tidy']],
      audit: ['govulncheck', ['-json', './...']],
      test: ['go', ['test', './...']],
      build: ['go', ['build', './...']],
    },
    {
      adapterId: 'rust',
      manifest: 'Cargo.toml',
      files: ['Cargo.toml', 'Cargo.lock'],
      reconcile: ['cargo', ['check']],
      audit: ['cargo', ['audit', '--json']],
      test: ['cargo', ['test']],
      build: ['cargo', ['build']],
    },
    {
      adapterId: 'php-composer',
      manifest: 'composer.json',
      files: ['composer.json', 'composer.lock'],
      reconcile: ['composer', ['install', '--no-interaction']],
      audit: ['composer', ['audit', '--format=json']],
      test: ['composer', ['run-script', 'test']],
      build: ['composer', ['run-script', 'build']],
    },
    {
      adapterId: 'ruby-bundler',
      manifest: 'Gemfile',
      files: ['Gemfile', 'Gemfile.lock'],
      reconcile: ['bundle', ['install']],
      audit: ['bundle-audit', ['check', '--format', 'json']],
      test: ['bundle', ['exec', 'rake', 'test']],
      build: ['bundle', ['exec', 'rake', 'build']],
    },
    {
      adapterId: 'elixir-mix',
      manifest: 'mix.exs',
      files: ['mix.exs', 'mix.lock'],
      reconcile: ['mix', ['deps.get']],
      audit: ['mix', ['hex.audit']],
      test: ['mix', ['test']],
      build: ['mix', ['compile', '--warnings-as-errors']],
    },
    {
      adapterId: 'deno',
      manifest: 'deno.json',
      alternateManifest: 'deno.jsonc',
      files: ['deno.json', 'deno.lock'],
      reconcile: ['deno', ['install']],
      audit: ['deno', ['audit']],
      test: ['deno', ['task', 'test']],
      build: ['deno', ['task', 'build']],
    },
  ];
  for (const candidate of runtimePlans) {
    if (candidate.adapterId !== input.adapterId) continue;
    const selectedManifest = (await exists(candidate.manifest))
      ? candidate.manifest
      : candidate.alternateManifest && (await exists(candidate.alternateManifest))
        ? candidate.alternateManifest
        : undefined;
    if (!selectedManifest) continue;
    addFiles(candidate.files);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: `Reconcile ${selectedManifest} and its lock/baseline.`,
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: candidate.reconcile[0],
          args: candidate.reconcile[1],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Run the runtime-native dependency audit.',
        invocation:
          audit ??
          (candidate.audit
            ? invocation({
                workspacePath: input.workspacePath,
                projectPath,
                executable: candidate.audit[0],
                args: candidate.audit[1],
                purpose: 'audit',
              })
            : undefined),
      })
    );
    const manifestText = await text(path.join(projectPath, selectedManifest));
    const testDeclared =
      candidate.manifest === 'composer.json' || candidate.adapterId === 'deno'
        ? /["']test["']\s*:/.test(manifestText)
        : candidate.manifest === 'Gemfile'
          ? await exists('Rakefile')
          : true;
    const buildDeclared =
      candidate.manifest === 'composer.json' || candidate.manifest === 'deno.json'
        ? /["']build["']\s*:/.test(manifestText)
        : candidate.manifest === 'Gemfile'
          ? (await fsExtra.readdir(projectPath)).some((file) => file.endsWith('.gemspec'))
          : true;
    add(
      testDeclared
        ? pendingStage({
            id: stageId('test'),
            kind: 'test',
            summary: 'Run the runtime-native test contract.',
            invocation: invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: candidate.test[0],
              args: candidate.test[1],
              purpose: 'test',
            }),
          })
        : skippedStage(stageId('test'), 'test', 'No test contract is declared.')
    );
    add(
      buildDeclared
        ? pendingStage({
            id: stageId('build'),
            kind: 'build',
            summary: 'Run the runtime-native build contract.',
            invocation: invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: candidate.build[0],
              args: candidate.build[1],
              purpose: 'build',
            }),
          })
        : skippedStage(stageId('build'), 'build', 'No build contract is declared.')
    );
    return finalize();
  }

  const top = await fsExtra.readdir(projectPath).catch(() => [] as string[]);
  if (
    input.adapterId === 'dotnet' &&
    top.some((file) => /\.(?:cs|fs|vb)proj$|\.sln$/i.test(file))
  ) {
    addFiles([
      'Directory.Packages.props',
      'packages.lock.json',
      ...top.filter((file) => /\.(?:cs|fs|vb)proj$|\.sln$/i.test(file)),
    ]);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: 'Restore the NuGet dependency graph.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'dotnet',
          args: ['restore'],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Prove the NuGet advisory graph is clean.',
        invocation:
          audit ??
          invocation({
            workspacePath: input.workspacePath,
            projectPath,
            executable: 'dotnet',
            args: ['package', 'list', '--vulnerable', '--include-transitive', '--format', 'json'],
            purpose: 'audit',
          }),
      })
    );
    add(
      pendingStage({
        id: stageId('test'),
        kind: 'test',
        summary: 'Run .NET tests.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'dotnet',
          args: ['test', '--no-restore'],
          purpose: 'test',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('build'),
        kind: 'build',
        summary: 'Build the .NET project.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'dotnet',
          args: ['build', '--no-restore'],
          purpose: 'build',
        }),
      })
    );
    return finalize();
  }

  const wrapper = (await exists('mvnw'))
    ? './mvnw'
    : (await exists('mvnw.cmd'))
      ? '.\\mvnw.cmd'
      : 'mvn';
  if (input.adapterId === 'jvm-maven' && (await exists('pom.xml'))) {
    addFiles(['pom.xml']);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: 'Resolve the Maven dependency graph.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: wrapper,
          args: ['dependency:resolve'],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Run the declared JVM dependency audit.',
        invocation: audit,
      })
    );
    add(
      pendingStage({
        id: stageId('test'),
        kind: 'test',
        summary: 'Run Maven tests.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: wrapper,
          args: ['test'],
          purpose: 'test',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('build'),
        kind: 'build',
        summary: 'Build the Maven artifact.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: wrapper,
          args: ['package', '-DskipTests'],
          purpose: 'build',
        }),
      })
    );
    return finalize();
  }
  const gradleManifest = (await exists('build.gradle.kts'))
    ? 'build.gradle.kts'
    : (await exists('build.gradle'))
      ? 'build.gradle'
      : undefined;
  if (input.adapterId === 'jvm-gradle' && gradleManifest) {
    const gradle = (await exists('gradlew'))
      ? './gradlew'
      : (await exists('gradlew.bat'))
        ? '.\\gradlew.bat'
        : 'gradle';
    addFiles([gradleManifest, 'gradle.lockfile', 'gradle/libs.versions.toml']);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: 'Resolve the Gradle dependency graph.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: gradle,
          args: ['dependencies'],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Run the declared JVM dependency audit.',
        invocation: audit,
      })
    );
    add(
      pendingStage({
        id: stageId('test'),
        kind: 'test',
        summary: 'Run Gradle tests.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: gradle,
          args: ['test'],
          purpose: 'test',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('build'),
        kind: 'build',
        summary: 'Build the Gradle project.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: gradle,
          args: ['build', '-x', 'test'],
          purpose: 'build',
        }),
      })
    );
    return finalize();
  }

  const clojureManifest = (await exists('deps.edn'))
    ? 'deps.edn'
    : (await exists('project.clj'))
      ? 'project.clj'
      : undefined;
  if (input.adapterId === 'clojure' && clojureManifest) {
    const depsEdn = clojureManifest === 'deps.edn';
    const manifestText = await text(path.join(projectPath, clojureManifest));
    const clojureTool = depsEdn ? 'clojure' : 'lein';
    addFiles([clojureManifest]);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: `Resolve the ${clojureManifest} dependency graph.`,
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: clojureTool,
          args: depsEdn ? ['-P'] : ['deps'],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Run the declared Clojure dependency audit.',
        invocation: audit,
      })
    );
    const hasTestAlias = !depsEdn || /:test\b/.test(manifestText);
    add(
      hasTestAlias
        ? pendingStage({
            id: stageId('test'),
            kind: 'test',
            summary: 'Run the declared Clojure test contract.',
            invocation: invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: clojureTool,
              args: depsEdn ? ['-M:test'] : ['test'],
              purpose: 'test',
            }),
          })
        : skippedStage(stageId('test'), 'test', 'No Clojure :test alias is declared.')
    );
    // tools.build aliases are intentionally not guessed: their functions and
    // arguments are project-defined. Leiningen has a stable packaging task.
    add(
      depsEdn
        ? skippedStage(
            stageId('build'),
            'build',
            'No portable Clojure CLI build entrypoint is declared.'
          )
        : pendingStage({
            id: stageId('build'),
            kind: 'build',
            summary: 'Build the Leiningen project artifact.',
            invocation: invocation({
              workspacePath: input.workspacePath,
              projectPath,
              executable: 'lein',
              args: ['uberjar'],
              purpose: 'build',
            }),
          })
    );
    return finalize();
  }

  if (input.adapterId === 'scala-sbt' && (await exists('build.sbt'))) {
    addFiles(['build.sbt']);
    add(
      pendingStage({
        id: stageId('reconcile'),
        kind: 'reconcile',
        risk: 'guarded',
        summary: 'Resolve and compile the sbt dependency graph.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'sbt',
          args: ['compile'],
          purpose: 'reconcile',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('audit'),
        kind: 'audit',
        summary: 'Run the declared Scala dependency audit.',
        invocation: audit,
      })
    );
    add(
      pendingStage({
        id: stageId('test'),
        kind: 'test',
        summary: 'Run sbt tests.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'sbt',
          args: ['test'],
          purpose: 'test',
        }),
      })
    );
    add(
      pendingStage({
        id: stageId('build'),
        kind: 'build',
        summary: 'Build the sbt project artifact.',
        invocation: invocation({
          workspacePath: input.workspacePath,
          projectPath,
          executable: 'sbt',
          args: ['package'],
          purpose: 'build',
        }),
      })
    );
    return finalize();
  }

  blockers.push(
    `The ${input.adapterId} repair adapter no longer matches the source at ${relativeProject}; refresh evidence and create a fresh plan.`
  );
  add(
    pendingStage({
      id: stageId('reconcile'),
      kind: 'reconcile',
      required: true,
      summary: blockers[0],
    })
  );
  return finalize();
}

async function detectWorkspaceRepairAdapterIds(
  projectPath: string
): Promise<WorkspaceRepairAdapterId[]> {
  const exists = (name: string) => fsExtra.pathExists(path.join(projectPath, name));
  const entries = await fsExtra.readdir(projectPath).catch(() => [] as string[]);
  const detected: WorkspaceRepairAdapterId[] = [];
  if (await exists('package.json')) detected.push('node');
  if ((await exists('pyproject.toml')) || (await exists('requirements.txt')))
    detected.push('python');
  if (await exists('go.mod')) detected.push('go');
  if (await exists('Cargo.toml')) detected.push('rust');
  if (await exists('composer.json')) detected.push('php-composer');
  if (await exists('Gemfile')) detected.push('ruby-bundler');
  if (await exists('mix.exs')) detected.push('elixir-mix');
  if ((await exists('deno.json')) || (await exists('deno.jsonc'))) detected.push('deno');
  if (entries.some((file) => /\.(?:cs|fs|vb)proj$|\.sln$/i.test(file))) detected.push('dotnet');
  if (await exists('pom.xml')) detected.push('jvm-maven');
  if ((await exists('build.gradle.kts')) || (await exists('build.gradle')))
    detected.push('jvm-gradle');
  if ((await exists('deps.edn')) || (await exists('project.clj'))) detected.push('clojure');
  if (await exists('build.sbt')) detected.push('scala-sbt');
  const order = new Map(
    WORKSPACE_REPAIR_ADAPTER_CAPABILITIES.map((capability, index) => [capability.id, index])
  );
  return [...new Set(detected)].sort(
    (left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999)
  );
}

function adapterIdForEcosystem(
  ecosystem: string | undefined
): WorkspaceRepairAdapterId | undefined {
  const normalized = ecosystem?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['npm', 'pnpm', 'yarn', 'bun', 'node', 'javascript', 'typescript'].includes(normalized))
    return 'node';
  if (['python', 'pip', 'poetry', 'uv'].includes(normalized)) return 'python';
  if (['go', 'gomod', 'go-modules'].includes(normalized)) return 'go';
  if (['rust', 'cargo'].includes(normalized)) return 'rust';
  if (['php', 'composer'].includes(normalized)) return 'php-composer';
  if (['ruby', 'bundler', 'bundle'].includes(normalized)) return 'ruby-bundler';
  if (['elixir', 'mix'].includes(normalized)) return 'elixir-mix';
  if (normalized === 'deno') return 'deno';
  if (['dotnet', '.net', 'nuget'].includes(normalized)) return 'dotnet';
  if (['maven', 'jvm-maven'].includes(normalized)) return 'jvm-maven';
  if (['gradle', 'jvm-gradle'].includes(normalized)) return 'jvm-gradle';
  if (['clojure', 'lein', 'leiningen'].includes(normalized)) return 'clojure';
  if (['scala', 'sbt', 'scala-sbt'].includes(normalized)) return 'scala-sbt';
  return undefined;
}

async function dependencyStagePlan(
  input: {
    workspacePath: string;
    action: ArtifactRemediationAction;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<DependencyStagePlan> {
  const projectPath = actionProjectRoot(input.workspacePath, input.action);
  const relativeProject = portable(input.workspacePath, projectPath);
  const detectedAdapterIds = await detectWorkspaceRepairAdapterIds(projectPath);
  const declaredAdapterId = adapterIdForEcosystem(input.action.transaction?.ecosystem);
  const adapterIds = declaredAdapterId ? [declaredAdapterId] : detectedAdapterIds;
  if (declaredAdapterId && !detectedAdapterIds.includes(declaredAdapterId)) {
    const message = `Doctor declared the ${declaredAdapterId} repair adapter for ${relativeProject}, but its canonical manifest is not present. Refresh Doctor evidence before repair.`;
    return {
      stages: [
        pendingStage({
          id: `${relativeProject}:${declaredAdapterId}:reconcile`,
          kind: 'reconcile',
          required: true,
          summary: message,
        }),
      ],
      checkpointFiles: [],
      blockers: [message],
      adapters: [
        {
          adapterId: declaredAdapterId,
          ecosystem:
            WORKSPACE_REPAIR_ADAPTER_CAPABILITIES.find(
              (candidate) => candidate.id === declaredAdapterId
            )?.ecosystem ?? declaredAdapterId,
          projectPath: relativeProject,
          manifests: [],
          support: 'conditional',
          status: 'partial',
          requiredExecutables: [],
          missingExecutables: [],
          message,
        },
      ],
    };
  }
  if (adapterIds.length === 0) {
    const message = `No deterministic dependency transaction adapter exists for ${relativeProject}.`;
    return {
      stages: [
        pendingStage({
          id: `${relativeProject}:unsupported:reconcile`,
          kind: 'reconcile',
          required: true,
          summary: message,
        }),
      ],
      checkpointFiles: [],
      blockers: [message],
      adapters: [
        {
          adapterId: 'unsupported',
          ecosystem: 'Unknown',
          projectPath: relativeProject,
          manifests: [],
          support: 'unsupported',
          status: 'unsupported',
          requiredExecutables: [],
          missingExecutables: [],
          message,
        },
      ],
    };
  }

  const combined: DependencyStagePlan = {
    stages: [],
    checkpointFiles: [],
    blockers: [],
    adapters: [],
  };
  for (const adapterId of adapterIds) {
    const plan = await dependencyStagePlanForAdapter({ ...input, adapterId });
    combined.stages.push(...plan.stages);
    combined.checkpointFiles.push(...plan.checkpointFiles);
    combined.blockers.push(...plan.blockers);
    combined.adapters.push(...plan.adapters);
  }
  combined.stages = [...new Map(combined.stages.map((stage) => [stage.id, stage])).values()];
  combined.checkpointFiles = [...new Set(combined.checkpointFiles)].sort();
  combined.blockers = [...new Set(combined.blockers)];
  const deferredStageExecutables = new Set<string>();

  if (input.action.transaction?.kind === 'dependency-materialization') {
    const requiredStages = new Set(input.action.transaction.requiredStages);
    const repairExecutable = executableName(input.action.invocation?.executable ?? '');
    const repairArgs = input.action.invocation?.args ?? [];
    const createsManagedVenv =
      input.action.transaction.ecosystem === 'python' &&
      ['python', 'python3', 'py'].includes(repairExecutable) &&
      repairArgs.includes('venv') &&
      repairArgs.includes('.venv');
    if (createsManagedVenv) {
      deferredStageExecutables.add(
        path.normalize(
          path.join(
            projectPath,
            '.venv',
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
          )
        )
      );
    }
    // The action invocation is itself the governed install/restore operation.
    // Adapter stages close only the declared validation surface so the package
    // manager is never invoked twice for one materialization transaction.
    combined.stages = combined.stages.filter((stage) => {
      if (stage.kind === 'reconcile') return createsManagedVenv && requiredStages.has('reconcile');
      return requiredStages.has(stage.kind as 'test' | 'build');
    });
    combined.blockers = combined.stages
      .filter((stage) => stage.required && stage.status === 'blocked')
      .map((stage) => stage.summary);
  }

  for (const adapter of combined.adapters) {
    const adapterStages = combined.stages.filter((stage) =>
      stage.id.startsWith(`${adapter.projectPath}:${adapter.adapterId}:`)
    );
    const missing: string[] = [];
    adapter.requiredExecutables = [
      ...new Set(
        adapterStages
          .filter((stage) => stage.required && stage.invocation)
          .map((stage) => (stage.invocation as WorkspaceRepairInvocation).executable)
      ),
    ];
    for (const stage of adapterStages) {
      if (!stage.required || !stage.invocation) continue;
      const executablePath = path.isAbsolute(stage.invocation.executable)
        ? path.normalize(stage.invocation.executable)
        : path.normalize(
            path.resolve(input.workspacePath, stage.invocation.cwd, stage.invocation.executable)
          );
      if (deferredStageExecutables.has(executablePath)) continue;
      if (
        !(await invocationToolAvailable({
          workspacePath: input.workspacePath,
          invocation: stage.invocation,
          toolAvailable: dependencies.toolAvailable,
        }))
      ) {
        missing.push(stage.invocation.executable);
      }
    }
    adapter.missingExecutables = [...new Set(missing)];
    if (adapter.missingExecutables.length > 0) {
      adapter.status = 'partial';
      adapter.message = `Required executable(s) unavailable: ${adapter.missingExecutables.join(', ')}.`;
    }
  }
  // Preserve the v1 stage identity used by existing single-runtime consumers.
  // The adapter segment is introduced only when it is required to make a
  // genuinely multi-runtime project collision-free.
  if (adapterIds.length === 1) {
    const marker = `:${adapterIds[0]}:`;
    for (const stage of combined.stages) stage.id = stage.id.replace(marker, ':');
  }
  return combined;
}

export async function inspectWorkspaceRepairCapabilities(
  input: {
    workspacePath?: string;
    projectPath?: string;
    project?: string;
  } = {}
): Promise<
  ReturnType<typeof buildWorkspaceRepairCapabilitiesContract> & {
    inspection?: { projectPath: string; detectedAdapters: WorkspaceRepairAdapterId[] };
  }
> {
  const contract = buildWorkspaceRepairCapabilitiesContract();
  if (!input.workspacePath && !input.projectPath && !input.project) return contract;
  const workspacePath = path.resolve(input.workspacePath ?? process.cwd());
  let projectPath: string;
  let inspectionPath: string;

  if (input.project?.trim()) {
    const projectRef = input.project.trim();
    const targets = await resolveWorkspaceProjectLensTargets(workspacePath);
    const normalizedRef = projectRef.replace(/\\/g, '/').replace(/^\.\//, '');
    const absoluteRef = path.resolve(workspacePath, projectRef);
    const matches = targets.resolved.filter((target) => {
      const relativePath = inside(workspacePath, target.projectPath)
        ? portable(workspacePath, target.projectPath)
        : undefined;
      return (
        target.name === projectRef ||
        relativePath === normalizedRef ||
        path.resolve(target.projectPath) === absoluteRef
      );
    });
    if (matches.length === 0) {
      const unavailable = targets.skipped.find((target) => target.name === projectRef);
      if (unavailable) {
        throw new Error(
          `Registered project is unavailable for repair capability inspection: ${projectRef} (${unavailable.reason}).`
        );
      }
      throw new Error(
        `Registered project not found for repair capability inspection: ${projectRef}.`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Project reference is ambiguous for repair capability inspection: ${projectRef}.`
      );
    }
    projectPath = path.resolve(matches[0].projectPath);
    inspectionPath = matches[0].name;
  } else {
    projectPath = path.resolve(workspacePath, input.projectPath ?? '.');
    if (!inside(workspacePath, projectPath)) {
      throw new Error('Repair capability inspection project path escapes the workspace.');
    }
    inspectionPath = portable(workspacePath, projectPath);
  }
  return {
    ...contract,
    inspection: {
      projectPath: inspectionPath,
      detectedAdapters: await detectWorkspaceRepairAdapterIds(projectPath),
    },
  };
}

function operationForAction(action: ArtifactRemediationAction): DoctorRepairOperation | undefined {
  if (action.command) {
    const internal = parseInternalRepairCommand(action.command);
    if (internal) return internal;
  }
  if (action.operation?.type === 'file-create') {
    return action.operation;
  }
  return undefined;
}

async function checkpointPaths(input: {
  workspacePath: string;
  actions: ArtifactRemediationAction[];
  dependencyFiles: string[];
}): Promise<string[]> {
  const results = new Set<string>(input.dependencyFiles);
  for (const action of input.actions) {
    for (const file of action.files) results.add(portable(input.workspacePath, file));
    const operation = operationForAction(action);
    if (!operation) continue;
    const projectRoot = actionProjectRoot(input.workspacePath, action);
    const target = 'path' in operation ? operation.path : undefined;
    if (target) results.add(portable(input.workspacePath, path.resolve(projectRoot, target)));
  }
  return [...results].filter((value) => value !== '.').sort();
}

function actionInvocation(
  workspacePath: string,
  action: ArtifactRemediationAction
): WorkspaceRepairInvocation | undefined {
  if (!action.invocation) return undefined;
  const projectPath = actionProjectRoot(workspacePath, action);
  return invocation({
    workspacePath,
    projectPath,
    executable: action.invocation.executable,
    args: action.invocation.args,
    purpose: 'repair',
  });
}

function planHash(input: {
  sourceEvidenceHash: string;
  target: WorkspaceRepairTransaction['target'];
  policy: WorkspaceRepairTransaction['policy'];
  preconditions: WorkspaceRepairTransaction['preconditions'];
  adapterEvaluations?: WorkspaceRepairTransaction['adapterEvaluations'];
  stages: WorkspaceRepairStage[];
  checkpointFiles: WorkspaceRepairTransaction['checkpoint']['files'];
}): string {
  return sha256(
    stableJson({
      sourceEvidenceHash: input.sourceEvidenceHash,
      target: input.target,
      policy: input.policy,
      preconditions: input.preconditions,
      adapterEvaluations: input.adapterEvaluations ?? [],
      stages: input.stages.map((stage) => ({
        id: stage.id,
        kind: stage.kind,
        required: stage.required,
        risk: stage.risk,
        ...(stage.invocation ? { invocation: stage.invocation } : {}),
      })),
      checkpointFiles: input.checkpointFiles.map((entry) => ({
        path: entry.path,
        existed: entry.existed,
        beforeHash: entry.beforeHash,
        ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
      })),
    })
  );
}

function transactionPlanHash(transaction: WorkspaceRepairTransaction): string {
  return planHash({
    sourceEvidenceHash: transaction.integrity.sourceEvidenceHash,
    target: transaction.target,
    policy: transaction.policy,
    preconditions: transaction.preconditions,
    adapterEvaluations: transaction.adapterEvaluations,
    // Rollback attempts are runtime receipts, not part of the immutable plan
    // that the user approved.
    stages: transaction.stages.filter((stage) => stage.kind !== 'rollback'),
    checkpointFiles: transaction.checkpoint.files,
  });
}

async function inspectCheckpointFiles(
  workspacePath: string,
  files: string[]
): Promise<{
  entries: WorkspaceRepairTransaction['checkpoint']['files'];
  errors: string[];
}> {
  const entries: WorkspaceRepairTransaction['checkpoint']['files'] = [];
  const errors: string[] = [];
  let total = 0;
  for (const file of files) {
    const absolute = path.resolve(workspacePath, file);
    if (!inside(workspacePath, absolute)) {
      errors.push(`Checkpoint path escapes workspace: ${file}`);
      continue;
    }
    if (!(await insideResolvedBoundary(workspacePath, absolute))) {
      errors.push(`Checkpoint path resolves through a link outside the workspace: ${file}`);
      continue;
    }
    const stat = await fsExtra.lstat(absolute).catch(() => undefined);
    if (stat?.isSymbolicLink()) {
      errors.push(`Checkpoint refuses symbolic link mutation: ${file}`);
      continue;
    }
    if (stat && !stat.isFile()) {
      errors.push(`Checkpoint target is not a regular file: ${file}`);
      continue;
    }
    if (stat && stat.size > MAX_CHECKPOINT_FILE_BYTES) {
      errors.push(`Checkpoint file exceeds 5 MiB: ${file}`);
      continue;
    }
    total += stat?.size ?? 0;
    if (total > MAX_CHECKPOINT_TOTAL_BYTES) {
      errors.push('Checkpoint exceeds the 25 MiB transaction limit.');
      break;
    }
    const content = stat ? await fsExtra.readFile(absolute) : undefined;
    entries.push({
      path: file,
      existed: Boolean(stat),
      beforeHash: content ? sha256(content) : null,
      ...(stat ? { mode: stat.mode } : {}),
    });
  }
  return { entries, errors };
}

function isProtectedProposalPath(relativePath: string): string | undefined {
  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  const fileName = segments.at(-1) ?? normalized;
  if (normalized === '.workspai-workspace' || normalized.startsWith('.workspai/')) {
    return 'Canonical workspace state and evidence cannot be edited through a model proposal.';
  }
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    return 'Git internals cannot be edited through a model proposal.';
  }
  if (segments.includes('node_modules')) {
    return 'Installed dependency trees cannot be edited through a model proposal.';
  }
  if (/^\.env(?:\.|$)/i.test(fileName) && !/^\.env\.(?:example|sample|template)$/i.test(fileName)) {
    return 'Secret-bearing environment files cannot be edited through a model proposal.';
  }
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(fileName)) {
    return 'Private key and credential containers cannot be edited through a model proposal.';
  }
  return undefined;
}

async function workspaceDisplayName(workspacePath: string): Promise<string> {
  const marker = (await fsExtra
    .readJson(path.join(workspacePath, '.workspai-workspace'))
    .catch(() => undefined)) as { name?: unknown } | undefined;
  return typeof marker?.name === 'string' && marker.name.trim()
    ? marker.name.trim()
    : path.basename(workspacePath);
}

function hasProjectManifestName(fileName: string): boolean {
  return PROJECT_MANIFESTS.has(fileName) || /\.(?:cs|fs|vb)proj$|\.sln$/i.test(fileName);
}

async function inferProjectRoot(workspacePath: string, relativePath: string): Promise<string> {
  const target = path.resolve(workspacePath, relativePath);
  let cursor = path.dirname(target);
  while (inside(workspacePath, cursor)) {
    const entries = await fsExtra.readdir(cursor).catch(() => [] as string[]);
    if (entries.some(hasProjectManifestName)) return cursor;
    if (path.resolve(cursor) === path.resolve(workspacePath)) break;
    cursor = path.dirname(cursor);
  }
  return workspacePath;
}

function proposalTouchesDependencies(
  workspacePath: string,
  projectPath: string,
  changes: WorkspaceRepairProposalChange[]
): boolean {
  return changes.some((change) => {
    const absolute = path.resolve(workspacePath, change.path);
    if (!inside(projectPath, absolute)) return false;
    const fileName = path.basename(absolute);
    return DEPENDENCY_SURFACES.has(fileName) || /\.(?:cs|fs|vb)proj$|\.sln$/i.test(fileName);
  });
}

function syntheticProposalAction(input: {
  workspacePath: string;
  projectPath: string;
  proposal: WorkspaceRepairProposal;
}): ArtifactRemediationAction {
  const projectPath = portable(input.workspacePath, input.projectPath);
  return {
    id: `proposal:${input.proposal.cardId}:${projectPath}`,
    artifactKind: 'workspace-repair-proposal',
    cardId: input.proposal.cardId,
    findingId: input.proposal.targetActionIds?.[0] ?? input.proposal.blockerSignature ?? 'proposal',
    findingStatus: 'blocking',
    causalKey: [
      input.proposal.cardId,
      input.proposal.projectName ?? projectPath,
      input.proposal.targetActionIds?.[0] ?? input.proposal.blockerSignature ?? 'proposal',
    ]
      .map((value) => value.trim().toLowerCase())
      .join(':'),
    title: 'Validate model-proposed repair',
    order: 1,
    phase: 'source-repair',
    scope: projectPath === '.' ? 'workspace' : 'project',
    ...(input.proposal.projectName ? { projectName: input.proposal.projectName } : {}),
    ...(projectPath !== '.' ? { projectPath } : {}),
    status: 'ready',
    mode: 'edit-file',
    risk: 'guarded',
    requiresApproval: true,
    blocker: '',
    summary: input.proposal.rationale,
    verifyCommand: 'workspai workspace intelligence run --for-agent generic --strict --json',
    cwd: projectPath === '.' ? 'workspace' : 'project',
    files: input.proposal.changes.map((change) => change.path),
    rollback: { available: true, strategy: 'idempotent' },
    notes: ['Source changes are applied only by the CLI Repair Engine after hash-bound approval.'],
  };
}

function validateProposalValidationInvocation(
  validation: WorkspaceRepairProposalValidation,
  command: WorkspaceRepairInvocation
): void {
  const name = executableName(command.executable);
  const [first = '', second = ''] = command.args;
  if (command.args.some((arg) => /^(?:-e|--eval|-c|--command|-command)$/i.test(arg))) {
    throw new Error(`Validation ${validation.id} cannot execute inline program text.`);
  }
  const scriptManager = ['npm', 'pnpm', 'yarn', 'bun'].includes(name);
  const permitted =
    (scriptManager &&
      validation.kind === 'audit' &&
      command.args.some((arg) => /audit/i.test(arg))) ||
    (scriptManager &&
      ['test', 'build'].includes(validation.kind) &&
      (first === 'run' || first === validation.kind || second === validation.kind)) ||
    ['pytest', 'pip-audit', 'govulncheck', 'bundle-audit'].includes(name) ||
    (['python', 'python3', 'py'].includes(name) &&
      first === '-m' &&
      ['pytest', 'unittest', 'build', 'pip_audit'].includes(second.replaceAll('-', '_'))) ||
    (name === 'poetry' && ['run', 'check'].includes(first)) ||
    (name === 'uv' && first === 'run') ||
    (name === 'go' && ['test', 'build', 'vet'].includes(first)) ||
    (name === 'cargo' && ['test', 'build', 'check', 'audit'].includes(first)) ||
    (name === 'composer' && ['audit', 'run-script', 'validate'].includes(first)) ||
    (name === 'bundle' && first === 'exec' && second === 'rake') ||
    (name === 'dotnet' && ['test', 'build'].includes(first)) ||
    (['mvn', 'mvnw', 'gradle', 'gradlew'].includes(name) &&
      command.args.some((arg) => /^(?:test|build|check|verify|package)$/i.test(arg))) ||
    (name === 'mix' &&
      (first === 'test' ||
        first === 'compile' ||
        (first === 'hex.audit' && validation.kind === 'audit'))) ||
    (name === 'clojure' && first === '-M:test' && validation.kind === 'test') ||
    (name === 'lein' &&
      ((first === 'test' && validation.kind === 'test') ||
        (first === 'uberjar' && validation.kind === 'build'))) ||
    (name === 'sbt' &&
      ((first === 'test' && validation.kind === 'test') ||
        (first === 'package' && validation.kind === 'build'))) ||
    (name === 'deno' &&
      (first === 'test' || (first === 'task' && ['test', 'build'].includes(second))));
  if (!permitted) {
    throw new Error(
      `Validation ${validation.id} must use a runtime-native audit, test, or build command; arbitrary executables are not accepted from a model.`
    );
  }
}

async function proposalValidationPlan(input: {
  workspacePath: string;
  proposal: WorkspaceRepairProposal;
  projectRoots: string[];
  maxRisk: WorkspaceRepairRisk;
  policy: WorkspaceRepairTransaction['policy'];
  dependencies?: RepairEngineDependencies;
}): Promise<DependencyStagePlan> {
  const stages: WorkspaceRepairStage[] = [];
  const checkpointFiles = new Set<string>();
  const blockers: string[] = [];
  const adapters: WorkspaceRepairAdapterEvaluation[] = [];
  const customKeys = new Set<string>();
  const declaredProjectRoot = input.proposal.projectPath
    ? path.resolve(input.workspacePath, input.proposal.projectPath)
    : undefined;

  for (const validation of input.proposal.validation ?? []) {
    const cwd = path.resolve(input.workspacePath, validation.cwd);
    const relativeCwd = portable(input.workspacePath, cwd);
    const cwdStat = await fsExtra.lstat(cwd).catch(() => undefined);
    if (
      !cwdStat?.isDirectory() ||
      cwdStat.isSymbolicLink() ||
      !(await insideResolvedBoundary(input.workspacePath, cwd))
    ) {
      blockers.push(`Validation ${validation.id} requires a real directory inside the workspace.`);
      continue;
    }
    if (declaredProjectRoot && !inside(declaredProjectRoot, cwd)) {
      blockers.push(`Validation ${validation.id} escapes the declared project scope.`);
      continue;
    }
    if (RISK_ORDER[validation.risk] > RISK_ORDER[input.maxRisk]) {
      blockers.push(
        `Validation ${validation.id} exceeds the approved ${input.maxRisk} risk ceiling.`
      );
      continue;
    }
    const command = invocation({
      workspacePath: input.workspacePath,
      projectPath: cwd,
      executable: validation.executable,
      args: validation.args,
      purpose: validation.kind,
      timeoutMs: validation.timeoutMs,
    });
    try {
      validateInvocation(input.workspacePath, command, input.policy);
      validateProposalValidationInvocation(validation, command);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    stages.push(
      pendingStage({
        id: `validation:${validation.id}`,
        kind: validation.kind,
        risk: validation.risk,
        required: validation.required,
        summary: validation.summary,
        invocation: command,
      })
    );
    customKeys.add(`${relativeCwd}:${validation.kind}`);
  }

  for (const projectRoot of input.projectRoots) {
    const action = syntheticProposalAction({
      workspacePath: input.workspacePath,
      projectPath: projectRoot,
      proposal: input.proposal,
    });
    const inferred = await dependencyStagePlan(
      { workspacePath: input.workspacePath, action },
      input.dependencies
    );
    adapters.push(...inferred.adapters);
    const dependencyChange = proposalTouchesDependencies(
      input.workspacePath,
      projectRoot,
      input.proposal.changes
    );
    if (dependencyChange) {
      for (const file of inferred.checkpointFiles) checkpointFiles.add(file);
      blockers.push(...inferred.blockers);
    }
    const relativeRoot = portable(input.workspacePath, projectRoot);
    for (const stage of inferred.stages) {
      if (!dependencyChange && !['test', 'build'].includes(stage.kind)) continue;
      if (customKeys.has(`${relativeRoot}:${stage.kind}`)) continue;
      stages.push(stage);
    }
  }
  return {
    stages: [...new Map(stages.map((stage) => [stage.id, stage])).values()],
    checkpointFiles: [...checkpointFiles],
    blockers: [...new Set(blockers)],
    adapters: [
      ...new Map(
        adapters.map((adapter) => [`${adapter.projectPath}:${adapter.adapterId}`, adapter])
      ).values(),
    ],
  };
}

export async function planWorkspaceRepair(
  input: {
    workspacePath: string;
    cardId: string;
    actionId?: string;
    projectName?: string;
    maxRisk?: WorkspaceRepairRisk;
    allowForce?: boolean;
    allowBreaking?: boolean;
    autoRollback?: boolean;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const workspacePath = path.resolve(input.workspacePath);
  const sourcePlan = await buildArtifactRemediationPlan({
    workspacePath,
    includeAbsolutePaths: false,
    ciMode: true,
  });
  const candidatePool = sourcePlan.actions
    .filter((action) => action.cardId === input.cardId)
    .filter((action) => !input.projectName || action.projectName === input.projectName)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const candidates = input.actionId
    ? candidatePool.filter((action) => action.id === input.actionId)
    : candidatePool;
  const dependencyPool = sourcePlan.actions
    .filter(
      (action) =>
        !input.projectName || !action.projectName || action.projectName === input.projectName
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const byId = new Map(dependencyPool.map((action) => [action.id, action]));
  const withDependencies = (selected: typeof candidates): typeof candidates => {
    const selectedIds = new Set(selected.map((action) => action.id));
    const pending = [...selected];
    while (pending.length > 0) {
      const action = pending.pop();
      for (const dependencyId of action?.dependsOn ?? []) {
        const dependency = byId.get(dependencyId);
        if (!dependency || selectedIds.has(dependency.id)) continue;
        selectedIds.add(dependency.id);
        pending.push(dependency);
      }
    }
    return dependencyPool.filter((action) => selectedIds.has(action.id));
  };
  const blockingCandidates = candidates.filter(
    (action) =>
      action.findingStatus === 'blocking' ||
      action.notes.includes('Doctor finding status: blocking')
  );
  const eligibleCandidates =
    blockingCandidates.length > 0
      ? blockingCandidates
      : candidates.filter(
          (action) =>
            action.findingStatus !== 'advisory' && action.findingStatus !== 'informational'
        );
  const explicitlySelected = input.actionId
    ? candidates.filter((action) => action.id === input.actionId)
    : [];
  const firstCausalCandidate = eligibleCandidates[0];
  const causalSelection = firstCausalCandidate
    ? eligibleCandidates.filter(
        (action) =>
          action.cardId === firstCausalCandidate.cardId &&
          action.findingId === firstCausalCandidate.findingId
      )
    : [];
  // One immutable transaction owns one causal finding family. Independent
  // blockers are repaired and verified sequentially so a review-only or
  // unsupported action cannot prevent a safe action from closing first.
  const actions = withDependencies(input.actionId ? explicitlySelected : causalSelection);
  const maxRisk = input.maxRisk ?? 'guarded';
  const policy: WorkspaceRepairTransaction['policy'] = {
    maxRisk,
    allowForce: input.allowForce === true,
    allowBreaking: input.allowBreaking === true,
    autoRollback: input.autoRollback !== false,
    strictVerify: true,
  };
  const preconditions: WorkspaceRepairTransaction['preconditions'] = [
    {
      id: 'workspace-root',
      status:
        (await fsExtra.pathExists(path.join(workspacePath, '.workspai-workspace'))) ||
        (await fsExtra.pathExists(path.join(workspacePath, '.workspai')))
          ? 'passed'
          : 'failed',
      message: 'Workspace root markers must exist.',
    },
    {
      id: 'actions-selected',
      status: actions.length > 0 ? 'passed' : 'failed',
      message:
        actions.length > 0
          ? `${actions.length} governed action(s) selected.`
          : 'No governed remediation action matches this target.',
    },
  ];
  const causalIntegrity = causalActionIntegrityPrecondition(actions);
  if (causalIntegrity) preconditions.push(causalIntegrity);
  const stages: WorkspaceRepairStage[] = [];
  const dependencyFiles: string[] = [];
  const adapterEvaluations: WorkspaceRepairAdapterEvaluation[] = [];
  const decisionReasons: string[] = [];
  const decisionOptions = new Set<
    NonNullable<WorkspaceRepairTransaction['decision']>['options'][number]
  >(['manual-repair', 'cancel']);
  for (const action of actions) {
    const operation = operationForAction(action);
    const structuredInvocation = actionInvocation(workspacePath, action);
    const permittedRisk = RISK_ORDER[action.risk] <= RISK_ORDER[maxRisk];
    if (!permittedRisk) {
      decisionReasons.push(`${action.id} exceeds the approved ${maxRisk} risk ceiling.`);
      decisionOptions.add(action.risk === 'invasive' ? 'approve-invasive' : 'approve-guarded');
    }
    if (action.status === 'blocked' || action.status === 'guidance-only') {
      decisionReasons.push(`${action.id} is ${action.status}: ${action.blocker}`);
    }
    if (!operation && !structuredInvocation) {
      decisionReasons.push(`${action.id} has no typed operation or structured invocation.`);
    }
    if (structuredInvocation) {
      try {
        validateInvocation(workspacePath, structuredInvocation, policy);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        decisionReasons.push(reason);
        if (/Force-based/.test(reason)) decisionOptions.add('allow-force');
        if (/Breaking dependency/.test(reason)) decisionOptions.add('allow-breaking');
      }
    }
    stages.push({
      id: `action:${action.id}`,
      kind: 'repair',
      status: operation || structuredInvocation ? 'pending' : 'blocked',
      required: true,
      risk: action.risk,
      summary: action.summary,
      ...(structuredInvocation ? { invocation: structuredInvocation } : {}),
    });
    if (action.transaction) {
      const dependency = await dependencyStagePlan({ workspacePath, action }, dependencies);
      stages.push(...dependency.stages);
      dependencyFiles.push(...dependency.checkpointFiles);
      decisionReasons.push(...dependency.blockers);
      adapterEvaluations.push(...dependency.adapters);
    }
  }
  const uniqueStages = [...new Map(stages.map((stage) => [stage.id, stage])).values()];
  stages.splice(0, stages.length, ...uniqueStages);
  stages.unshift({
    id: 'target-precondition',
    kind: 'verify',
    status: 'pending',
    required: true,
    risk: 'safe',
    summary:
      'Refresh the exact producer and prove the approved causal target is still current before mutation.',
  });
  stages.push({
    id: 'target-producer-verify',
    kind: 'verify',
    status: 'pending',
    required: true,
    risk: 'safe',
    summary: 'Refresh the exact producer that owns the selected repair card.',
  });
  stages.push({
    id: 'canonical-verify',
    kind: 'verify',
    status: 'pending',
    required: true,
    risk: 'safe',
    summary: 'Run the complete canonical Workspace Intelligence loop in strict mode.',
  });
  preconditions.push(
    ...(await toolPreconditions({
      workspacePath,
      stages,
      toolAvailable: dependencies.toolAvailable,
    }))
  );
  const files = await checkpointPaths({ workspacePath, actions, dependencyFiles });
  const checkpointInspection = await inspectCheckpointFiles(workspacePath, files);
  preconditions.push({
    id: 'rollback-coverage',
    status:
      actions.some((action) => action.mode === 'edit-file' || action.mode === 'run-command') &&
      files.length === 0
        ? 'failed'
        : 'passed',
    message:
      files.length > 0
        ? `${files.length} bounded rollback candidate(s) identified.`
        : 'No source file mutation is declared.',
  });
  preconditions.push({
    id: 'structured-execution',
    status: stages.some((stage) => stage.required && stage.status === 'blocked')
      ? 'failed'
      : 'passed',
    message: 'Every executable stage must use a typed operation or structured invocation.',
  });
  preconditions.push({
    id: 'checkpoint-boundary',
    status: checkpointInspection.errors.length === 0 ? 'passed' : 'failed',
    message:
      checkpointInspection.errors.length === 0
        ? 'Every mutable path is bounded, regular, size-limited, and hash-pinned.'
        : checkpointInspection.errors.join(' '),
  });
  const sourceEvidenceHash = sha256(stableJson(sourcePlan));
  const actionProjectPaths = [
    ...new Set(actions.map((action) => action.projectPath).filter(Boolean)),
  ];
  const target: WorkspaceRepairTransaction['target'] = {
    cardId: input.cardId,
    // A card spanning multiple project roots is a workspace transaction even
    // when every selected action is project-scoped. Advertising it as a
    // project transaction without an exact projectName/projectPath gives
    // consumers a false scope and can cause them to route follow-up repair to
    // an arbitrary project.
    scope: input.projectName || actionProjectPaths.length === 1 ? 'project' : 'workspace',
    ...(input.projectName ? { projectName: input.projectName } : {}),
    ...(actionProjectPaths.length === 1 ? { projectPath: actionProjectPaths[0] } : {}),
    actionIds: actions.map((action) => action.id),
  };
  const createdAt = iso(dependencies.now);
  const id = `repair_${randomUUID().replaceAll('-', '')}`;
  const blocked =
    preconditions.some((entry) => entry.status === 'failed') || decisionReasons.length > 0;
  const decisionMessages = [
    ...decisionReasons,
    ...preconditions.filter((entry) => entry.status === 'failed').map((entry) => entry.message),
  ];
  const uniqueAdapterEvaluations = [
    ...new Map(
      adapterEvaluations.map((adapter) => [`${adapter.projectPath}:${adapter.adapterId}`, adapter])
    ).values(),
  ];
  const decisionCauses = repairDecisionCauses({
    actions,
    adapters: uniqueAdapterEvaluations,
    preconditions,
    stages,
    decisionOptions,
    maxRisk,
    fallbackReasons: decisionMessages,
  });
  const transaction: WorkspaceRepairTransaction = {
    schemaVersion: WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
    transactionId: id,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    workspace: { name: sourcePlan.workspace.name, rootRef: '.' },
    target,
    state: blocked ? 'decision-required' : 'awaiting-approval',
    policy,
    approval: { required: true, status: 'pending' },
    preconditions,
    adapterEvaluations: uniqueAdapterEvaluations,
    checkpoint: {
      status: files.length > 0 ? 'pending' : 'unavailable',
      files: checkpointInspection.entries,
    },
    stages,
    ...(blocked
      ? {
          decision: {
            reason: [...new Set(decisionMessages)].join(' '),
            options: [...decisionOptions],
            causes: decisionCauses,
          },
        }
      : {}),
    events: [],
    integrity: {
      sourceEvidenceHash,
      planHash: planHash({
        sourceEvidenceHash,
        target,
        policy,
        preconditions,
        adapterEvaluations: uniqueAdapterEvaluations,
        stages,
        checkpointFiles: checkpointInspection.entries,
      }),
    },
  };
  event(
    transaction,
    'planned',
    blocked
      ? 'Repair plan requires an engineering decision.'
      : 'Repair plan is ready for explicit approval.',
    { now: dependencies.now }
  );
  assertJsonSchemaContract(
    transaction,
    WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
    'Workspace repair transaction'
  );
  const directory = transactionDir(workspacePath, id);
  await fsExtra.ensureDir(directory);
  await atomicJson(sourcePlanPath(workspacePath, id), sourcePlan);
  await atomicJson(transactionPath(workspacePath, id), transaction);
  await atomicJson(path.join(workspacePath, WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH), transaction);
  return transaction;
}

export async function planWorkspaceRepairProposal(
  input: {
    workspacePath: string;
    proposal: WorkspaceRepairProposal;
    maxRisk?: WorkspaceRepairRisk;
    allowForce?: boolean;
    allowBreaking?: boolean;
    autoRollback?: boolean;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  assertJsonSchemaContract(
    input.proposal,
    WORKSPACE_REPAIR_PROPOSAL_CONTRACT_PATH,
    'Workspace repair proposal'
  );
  const workspacePath = path.resolve(input.workspacePath);
  const proposal = JSON.parse(JSON.stringify(input.proposal)) as WorkspaceRepairProposal;
  const maxRisk = input.maxRisk ?? 'guarded';
  const policy: WorkspaceRepairTransaction['policy'] = {
    maxRisk,
    allowForce: input.allowForce === true,
    allowBreaking: input.allowBreaking === true,
    autoRollback: input.autoRollback !== false,
    strictVerify: true,
  };
  const preconditions: WorkspaceRepairTransaction['preconditions'] = [];
  const decisionReasons: string[] = [];
  const decisionOptions = new Set<
    NonNullable<WorkspaceRepairTransaction['decision']>['options'][number]
  >(['manual-repair', 'cancel']);
  const workspaceMarkerExists =
    (await fsExtra.pathExists(path.join(workspacePath, '.workspai-workspace'))) ||
    (await fsExtra.pathExists(path.join(workspacePath, '.workspai')));
  preconditions.push({
    id: 'workspace-root',
    status: workspaceMarkerExists ? 'passed' : 'failed',
    message: workspaceMarkerExists
      ? 'Canonical workspace root markers exist.'
      : 'Workspace root markers must exist.',
  });

  if (proposal.projectPath) {
    proposal.projectPath = portable(workspacePath, proposal.projectPath);
    const projectRoot = path.resolve(workspacePath, proposal.projectPath);
    const stat = await fsExtra.lstat(projectRoot).catch(() => undefined);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      decisionReasons.push(
        'The declared project path must be a real directory inside the workspace.'
      );
    }
  }
  proposal.validation = proposal.validation?.map((validation) => ({
    ...validation,
    cwd: portable(workspacePath, validation.cwd),
  }));

  const ids = new Set<string>();
  const paths = new Set<string>();
  let proposalBytes = 0;
  for (const change of proposal.changes) {
    change.path = portable(workspacePath, change.path);
    if (change.path === '.')
      decisionReasons.push(`${change.id} cannot replace the workspace root.`);
    if (ids.has(change.id)) decisionReasons.push(`Duplicate proposal change id: ${change.id}.`);
    if (paths.has(change.path))
      decisionReasons.push(`Multiple proposal changes target ${change.path}.`);
    ids.add(change.id);
    paths.add(change.path);
    proposalBytes += Buffer.byteLength(change.content ?? '', 'utf8');
    if (proposalBytes > MAX_PROPOSAL_TOTAL_BYTES) {
      decisionReasons.push('The model proposal exceeds the 25 MiB source-change limit.');
    }
    const protectedReason = isProtectedProposalPath(change.path);
    if (protectedReason) decisionReasons.push(`${change.path}: ${protectedReason}`);
    if (RISK_ORDER[change.risk] > RISK_ORDER[maxRisk]) {
      decisionReasons.push(`${change.id} exceeds the approved ${maxRisk} risk ceiling.`);
      decisionOptions.add(change.risk === 'invasive' ? 'approve-invasive' : 'approve-guarded');
    }
    if (proposal.projectPath) {
      const projectRoot = path.resolve(workspacePath, proposal.projectPath);
      const target = path.resolve(workspacePath, change.path);
      if (!inside(projectRoot, target)) {
        decisionReasons.push(`${change.path} escapes the declared project scope.`);
      }
    }
  }

  const changedPaths = [...paths].sort();
  const initialInspection = await inspectCheckpointFiles(workspacePath, changedPaths);
  decisionReasons.push(...initialInspection.errors);
  const inspectedByPath = new Map(initialInspection.entries.map((entry) => [entry.path, entry]));
  for (const change of proposal.changes) {
    const observed = inspectedByPath.get(change.path);
    if (!observed || observed.beforeHash !== change.expectedBeforeHash) {
      decisionReasons.push(
        `${change.path} no longer matches the model's expected source hash; refresh context and re-propose.`
      );
      continue;
    }
    if (change.operation === 'delete' && !observed.existed) {
      decisionReasons.push(`${change.path} cannot be deleted because it does not exist.`);
    }
    if (
      change.operation === 'write' &&
      observed.beforeHash !== null &&
      sha256(change.content ?? '') === observed.beforeHash
    ) {
      decisionReasons.push(`${change.path} is a no-op and cannot prove source progress.`);
    }
  }
  preconditions.push({
    id: 'proposal-boundary',
    status: decisionReasons.length === 0 ? 'passed' : 'failed',
    message:
      decisionReasons.length === 0
        ? `${proposal.changes.length} unique, bounded, hash-pinned source change(s) validated.`
        : [...new Set(decisionReasons)].join(' '),
  });

  const projectRoots = new Set<string>();
  if (proposal.projectPath) {
    projectRoots.add(path.resolve(workspacePath, proposal.projectPath));
  } else {
    for (const change of proposal.changes) {
      projectRoots.add(await inferProjectRoot(workspacePath, change.path));
    }
  }
  const validationPlan = await proposalValidationPlan({
    workspacePath,
    proposal,
    projectRoots: [...projectRoots].sort(),
    maxRisk,
    policy,
    dependencies,
  });
  decisionReasons.push(...validationPlan.blockers);
  const validationStages = validationPlan.stages;
  const hasValidation = validationStages.some(
    (stage) => stage.status !== 'skipped' && ['audit', 'test', 'build'].includes(stage.kind)
  );
  preconditions.push({
    id: 'validation-coverage',
    status: hasValidation ? 'passed' : 'unknown',
    message: hasValidation
      ? 'Runtime-native validation is included before canonical verification.'
      : 'No runtime-native test, build, or audit command was discovered; strict canonical verification remains mandatory.',
  });

  const allCheckpointPaths = [
    ...new Set([...changedPaths, ...validationPlan.checkpointFiles]),
  ].sort();
  const checkpointInspection = await inspectCheckpointFiles(workspacePath, allCheckpointPaths);
  decisionReasons.push(...checkpointInspection.errors);
  preconditions.push({
    id: 'checkpoint-boundary',
    status: checkpointInspection.errors.length === 0 ? 'passed' : 'failed',
    message:
      checkpointInspection.errors.length === 0
        ? `${checkpointInspection.entries.length} mutable path(s) are bounded and hash-pinned for rollback.`
        : checkpointInspection.errors.join(' '),
  });

  const stages: WorkspaceRepairStage[] = [
    {
      id: 'target-precondition',
      kind: 'verify',
      status: 'pending',
      required: true,
      risk: 'safe',
      summary:
        'Refresh the exact producer and prove the approved causal target is still current before mutation.',
    },
    ...proposal.changes.map((change): WorkspaceRepairStage => ({
      id: `proposal:${change.id}`,
      kind: 'repair',
      status: RISK_ORDER[change.risk] <= RISK_ORDER[maxRisk] ? 'pending' : 'blocked',
      required: true,
      risk: change.risk,
      summary: change.summary,
      changedPaths: [change.path],
    })),
    ...validationStages,
    {
      id: 'target-producer-verify',
      kind: 'verify',
      status: 'pending',
      required: true,
      risk: 'safe',
      summary: 'Refresh the exact producer that owns the selected repair card.',
    },
    {
      id: 'canonical-verify',
      kind: 'verify',
      status: 'pending',
      required: true,
      risk: 'safe',
      summary: 'Run the complete canonical Workspace Intelligence loop in strict mode.',
    },
  ];
  preconditions.push(
    ...(await toolPreconditions({
      workspacePath,
      stages,
      toolAvailable: dependencies.toolAvailable,
    }))
  );
  const stageIds = new Set(stages.map((stage) => stage.id));
  if (stageIds.size !== stages.length)
    decisionReasons.push('Repair proposal stage ids must be unique.');
  preconditions.push({
    id: 'stage-identity',
    status: stageIds.size === stages.length ? 'passed' : 'failed',
    message:
      stageIds.size === stages.length
        ? 'Every repair and validation stage has a stable unique identity.'
        : 'Repair proposal stage ids collide.',
  });

  // The CLI, not the IDE, owns causal target selection. An IDE may bind the
  // proposal to action ids it inspected, but older consumers only provide a
  // card/project scope. Resolve that scope against the current canonical
  // remediation plan before hashing and persisting the proposal so closure is
  // proven against the finding generation that actually caused the repair.
  try {
    const currentPlan = await buildArtifactRemediationPlan({
      workspacePath,
      includeAbsolutePaths: false,
      ciMode: true,
    });
    if (!proposal.targetActionIds?.length) {
      const causalActionIds = currentPlan.actions
        .filter(
          (action) =>
            action.cardId === proposal.cardId &&
            (!proposal.projectName || action.projectName === proposal.projectName) &&
            (!proposal.projectPath || action.projectPath === proposal.projectPath)
        )
        .map((action) => action.id)
        .sort();
      if (causalActionIds.length > 0) proposal.targetActionIds = causalActionIds;
    }
    const selectedActionIds = new Set(proposal.targetActionIds ?? []);
    const selectedActions = currentPlan.actions.filter((action) =>
      selectedActionIds.has(action.id)
    );
    const causalIntegrity = causalActionIntegrityPrecondition(selectedActions);
    if (causalIntegrity) preconditions.push(causalIntegrity);
  } catch {
    // Some refresh-only cards do not expose remediation actions. Their exact
    // producer still runs and the conservative card/project fallback remains.
  }

  const sourceEvidenceHash = sha256(stableJson(proposal));
  const target: WorkspaceRepairTransaction['target'] = {
    cardId: proposal.cardId,
    scope: proposal.projectPath || proposal.projectName ? 'project' : 'workspace',
    ...(proposal.projectName ? { projectName: proposal.projectName } : {}),
    ...(proposal.projectPath ? { projectPath: proposal.projectPath } : {}),
    ...(proposal.blockerSignature ? { blockerSignature: proposal.blockerSignature } : {}),
    actionIds:
      proposal.targetActionIds && proposal.targetActionIds.length > 0
        ? [...new Set(proposal.targetActionIds)].sort()
        : proposal.changes.map((change) => `proposal:${change.id}`),
  };
  const createdAt = iso(dependencies.now);
  const transactionId = `repair_${randomUUID().replaceAll('-', '')}`;
  const failedPrecondition = preconditions.some((entry) => entry.status === 'failed');
  const blocked = failedPrecondition || decisionReasons.length > 0;
  const decisionMessages = [
    ...decisionReasons,
    ...preconditions.filter((entry) => entry.status === 'failed').map((entry) => entry.message),
  ];
  const decisionCauses = repairDecisionCauses({
    adapters: validationPlan.adapters,
    preconditions,
    stages,
    decisionOptions,
    maxRisk,
    fallbackReasons: decisionMessages,
  });
  for (const change of proposal.changes) {
    if (RISK_ORDER[change.risk] <= RISK_ORDER[maxRisk]) continue;
    decisionCauses.push({
      kind: 'risk-approval',
      id: `risk:${change.id}`,
      message: `${change.id} exceeds the approved ${maxRisk} risk ceiling.`,
      ...(proposal.projectPath ? { projectPath: proposal.projectPath } : {}),
    });
  }
  const transaction: WorkspaceRepairTransaction = {
    schemaVersion: WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
    transactionId,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    workspace: { name: await workspaceDisplayName(workspacePath), rootRef: '.' },
    target,
    state: blocked ? 'decision-required' : 'awaiting-approval',
    policy,
    approval: { required: true, status: 'pending' },
    preconditions,
    adapterEvaluations: validationPlan.adapters,
    checkpoint: { status: 'pending', files: checkpointInspection.entries },
    stages,
    ...(blocked
      ? {
          decision: {
            reason: [...new Set(decisionMessages)].join(' '),
            options: [...decisionOptions],
            causes: decisionCauses,
          },
        }
      : {}),
    events: [],
    integrity: {
      sourceEvidenceHash,
      planHash: planHash({
        sourceEvidenceHash,
        target,
        policy,
        preconditions,
        adapterEvaluations: validationPlan.adapters,
        stages,
        checkpointFiles: checkpointInspection.entries,
      }),
    },
  };
  event(
    transaction,
    'planned',
    blocked
      ? 'Model-proposed repair requires an engineering decision.'
      : 'Model-proposed source repair is bounded and ready for explicit approval.',
    { now: dependencies.now }
  );
  assertJsonSchemaContract(
    transaction,
    WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
    'Workspace repair transaction'
  );
  const directory = transactionDir(workspacePath, transactionId);
  await fsExtra.ensureDir(directory);
  await atomicJson(sourcePlanPath(workspacePath, transactionId), proposal);
  await atomicJson(transactionPath(workspacePath, transactionId), transaction);
  await atomicJson(path.join(workspacePath, WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH), transaction);
  return transaction;
}

export async function approveWorkspaceRepair(
  input: {
    workspacePath: string;
    transactionId: string;
    approvedBy?: string;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const transaction = await readWorkspaceRepairTransaction(input);
  if (transaction.state !== 'awaiting-approval') {
    throw new Error(`Repair transaction is not awaiting approval: ${transaction.state}`);
  }
  if (transactionPlanHash(transaction) !== transaction.integrity.planHash) {
    transaction.approval.status = 'expired';
    transaction.state = 'decision-required';
    transaction.decision = runtimeRepairDecision(
      'The compiled repair plan changed after planning.',
      ['cancel']
    );
    await saveTransaction(input.workspacePath, transaction, dependencies.now);
    return transaction;
  }
  const sourcePlan = await readSourcePlan(input.workspacePath, input.transactionId);
  if (sha256(stableJson(sourcePlan)) !== transaction.integrity.sourceEvidenceHash) {
    transaction.approval.status = 'expired';
    transaction.state = 'decision-required';
    transaction.decision = runtimeRepairDecision(
      'The persisted source plan changed after planning.',
      ['cancel']
    );
    await saveTransaction(input.workspacePath, transaction, dependencies.now);
    return transaction;
  }
  transaction.approval = {
    required: true,
    status: 'approved',
    approvedAt: iso(dependencies.now),
    approvedBy: input.approvedBy?.trim() || 'local-user',
    approvedPlanHash: transaction.integrity.planHash,
  };
  transaction.state = 'approved';
  event(transaction, 'approval', 'The immutable repair plan was explicitly approved.', {
    status: 'approved',
    now: dependencies.now,
  });
  await saveTransaction(input.workspacePath, transaction, dependencies.now);
  return transaction;
}

async function acquireLock(
  workspacePath: string,
  transactionId: string
): Promise<() => Promise<void>> {
  const lockPath = path.join(workspacePath, REPAIR_ROOT, LOCK_FILE);
  await fsExtra.ensureDir(path.dirname(lockPath));
  try {
    const stat = await fsExtra.stat(lockPath);
    const owner = (await fsExtra.readJson(lockPath).catch(() => ({}))) as {
      pid?: unknown;
      host?: unknown;
    };
    const ownerHost = typeof owner.host === 'string' ? owner.host : undefined;
    const ownerPid =
      typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0
        ? owner.pid
        : undefined;
    let ownerAlive = false;
    if ((!ownerHost || ownerHost === hostname()) && ownerPid) {
      try {
        process.kill(ownerPid, 0);
        ownerAlive = true;
      } catch (error) {
        ownerAlive =
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === 'EPERM';
      }
    }
    const foreignHost = Boolean(ownerHost && ownerHost !== hostname());
    if (!ownerAlive && !foreignHost && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fsExtra.remove(lockPath);
    }
  } catch {
    // Missing lock is expected.
  }
  try {
    await fsExtra.outputFile(
      lockPath,
      `${JSON.stringify({ transactionId, pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() })}\n`,
      { flag: 'wx' }
    );
  } catch {
    throw new Error('Another workspace repair transaction currently owns the engine lock.');
  }
  return async () => {
    const owner = await fsExtra.readJson(lockPath).catch(async () => {
      const raw = await fsExtra.readFile(lockPath, 'utf8').catch(() => '');
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    });
    if (owner.transactionId === transactionId) await fsExtra.remove(lockPath);
  };
}

async function assertCheckpointBaselineIsCurrent(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
}): Promise<void> {
  const current = await inspectCheckpointFiles(
    input.workspacePath,
    input.transaction.checkpoint.files.map((entry) => entry.path)
  );
  if (current.errors.length > 0) throw new Error(current.errors.join(' '));
  const currentByPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  for (const planned of input.transaction.checkpoint.files) {
    const observed = currentByPath.get(planned.path);
    if (
      !observed ||
      planned.existed !== observed.existed ||
      planned.beforeHash !== observed.beforeHash ||
      planned.mode !== observed.mode
    ) {
      throw new Error(
        `Checkpoint precondition changed after planning: ${planned.path}. Create and approve a fresh plan.`
      );
    }
  }
}

async function captureCheckpoint(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  now?: () => Date;
}): Promise<void> {
  if (input.transaction.checkpoint.status === 'captured') return;
  await assertCheckpointBaselineIsCurrent(input);
  const directory = path.join(
    transactionDir(input.workspacePath, input.transaction.transactionId),
    CHECKPOINT_DIR
  );
  await fsExtra.ensureDir(directory);
  for (let index = 0; index < input.transaction.checkpoint.files.length; index += 1) {
    const entry = input.transaction.checkpoint.files[index];
    const absolute = path.resolve(input.workspacePath, entry.path);
    const content = entry.existed ? await fsExtra.readFile(absolute) : undefined;
    if (content && sha256(content) !== entry.beforeHash) {
      throw new Error(
        `Checkpoint source changed while it was being captured: ${entry.path}. Create and approve a fresh plan.`
      );
    }
    const backupRef = `${CHECKPOINT_DIR}/${String(index).padStart(4, '0')}.bin`;
    if (content) {
      const backupPath = path.join(
        transactionDir(input.workspacePath, input.transaction.transactionId),
        backupRef
      );
      const temporary = `${backupPath}.${process.pid}.${randomUUID()}.tmp`;
      await fsExtra.writeFile(temporary, content, { flag: 'wx' });
      const persisted = await fsExtra.readFile(temporary);
      if (sha256(persisted) !== entry.beforeHash) {
        await fsExtra.remove(temporary);
        throw new Error(`Checkpoint backup verification failed for ${entry.path}.`);
      }
      await fsExtra.move(temporary, backupPath, { overwrite: true });
      entry.backupRef = backupRef;
    }
  }
  input.transaction.checkpoint.status = 'captured';
  input.transaction.checkpoint.capturedAt = iso(input.now);
  input.transaction.state = 'checkpointed';
  event(
    input.transaction,
    'checkpoint',
    `Captured ${input.transaction.checkpoint.files.length} bounded file checkpoint(s).`,
    { status: 'captured', now: input.now }
  );
}

async function refreshAfterHashes(
  workspacePath: string,
  transaction: WorkspaceRepairTransaction
): Promise<void> {
  for (const entry of transaction.checkpoint.files) {
    const absolute = path.resolve(workspacePath, entry.path);
    const content = await fsExtra.readFile(absolute).catch(() => undefined);
    entry.afterHash = content ? sha256(content) : null;
  }
}

function executableName(executable: string): string {
  return path.posix
    .basename(executable.replaceAll('\\', '/'))
    .toLowerCase()
    .replace(/\.(?:bat|cmd|exe)$/i, '');
}

function validateInvocation(
  workspacePath: string,
  invocation: WorkspaceRepairInvocation,
  policy: WorkspaceRepairTransaction['policy']
): { cwd: string; executable: string } {
  const cwd = path.resolve(workspacePath, invocation.cwd);
  if (!inside(workspacePath, cwd))
    throw new Error(`Invocation cwd escapes workspace: ${invocation.cwd}`);
  if (invocation.args.length > 100 || invocation.args.some((arg) => !arg || /[\0\r\n]/.test(arg))) {
    throw new Error('Invocation contains invalid arguments.');
  }
  const name = executableName(invocation.executable);
  const absolute = path.isAbsolute(invocation.executable);
  const local = /^\.{1,2}[\\/]/.test(invocation.executable);
  if (absolute && !inside(workspacePath, invocation.executable)) {
    throw new Error(`Invocation executable escapes workspace: ${invocation.executable}`);
  }
  if (!absolute && !local && !ALLOWED_EXECUTABLES.has(name)) {
    throw new Error(`Invocation executable is not governed: ${invocation.executable}`);
  }
  if (!policy.allowForce && invocation.args.some((arg) => /^(?:--force|-f)$/i.test(arg))) {
    throw new Error('Force-based repair requires explicit allowForce policy approval.');
  }
  if (
    !policy.allowBreaking &&
    invocation.args.some((arg) => /(?:breaking|legacy-peer-deps)/i.test(arg))
  ) {
    throw new Error('Breaking dependency repair requires explicit allowBreaking policy approval.');
  }
  if (
    ['npx', 'pnpx', 'bunx'].includes(name) &&
    !invocation.args.includes('--no-install') &&
    !invocation.args.includes('--no')
  ) {
    throw new Error(`${name} cannot fetch an unreviewed package during autonomous repair.`);
  }
  return { cwd, executable: invocation.executable };
}

async function runInvocation(input: {
  workspacePath: string;
  invocation: WorkspaceRepairInvocation;
  policy: WorkspaceRepairTransaction['policy'];
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const validated = validateInvocation(input.workspacePath, input.invocation, input.policy);
  const cwdStat = await fsExtra.lstat(validated.cwd).catch(() => undefined);
  if (
    !cwdStat?.isDirectory() ||
    cwdStat.isSymbolicLink() ||
    !(await insideResolvedBoundary(input.workspacePath, validated.cwd))
  ) {
    throw new Error(`Invocation cwd is not a real workspace directory: ${input.invocation.cwd}`);
  }
  if (path.isAbsolute(validated.executable) || /^\.{1,2}[\\/]/.test(validated.executable)) {
    const executablePath = path.isAbsolute(validated.executable)
      ? validated.executable
      : path.resolve(validated.cwd, validated.executable);
    if (!(await insideResolvedBoundary(input.workspacePath, executablePath))) {
      throw new Error(
        `Invocation executable resolves outside the workspace: ${input.invocation.executable}`
      );
    }
  }
  const protectedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|AUTH)/i.test(key)
    )
  );
  const result = await execa(validated.executable, input.invocation.args, {
    cwd: validated.cwd,
    shell: false,
    reject: false,
    timeout: input.invocation.timeoutMs,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdin: 'ignore',
    extendEnv: false,
    env: { ...protectedEnvironment, NO_COLOR: '1', CI: process.env.CI ?? '1' },
  });
  return {
    exitCode: result.exitCode ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function exactCardProducerArgs(cardId: string): string[] {
  const capability = STUDIO_CARD_REPAIR_CAPABILITIES.find((entry) => entry.cardId === cardId);
  if (!capability) {
    throw new Error(`No canonical producer is registered for repair card ${cardId}.`);
  }
  const tokens = capability.verifyCommand.trim().split(/\s+/);
  if (tokens[0] !== 'npx' || tokens[1] !== 'workspai' || tokens.length < 3) {
    throw new Error(`Repair card ${cardId} publishes an invalid canonical producer command.`);
  }
  return tokens.slice(2);
}

async function runExactCardProducer(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const capability = STUDIO_CARD_REPAIR_CAPABILITIES.find(
    (entry) => entry.cardId === input.transaction.target.cardId
  );
  if (!capability) {
    throw new Error(
      `No canonical producer is registered for repair card ${input.transaction.target.cardId}.`
    );
  }
  const entrypoint = process.argv[1]?.trim();
  if (!entrypoint || !(await fsExtra.pathExists(entrypoint))) {
    throw new Error('The running Workspai CLI entrypoint is unavailable for target verification.');
  }
  const cwd =
    capability.scope === 'project' && input.transaction.target.projectPath
      ? path.resolve(input.workspacePath, input.transaction.target.projectPath)
      : path.resolve(input.workspacePath);
  if (capability.scope === 'project' && !input.transaction.target.projectPath) {
    throw new Error(
      `Repair card ${capability.cardId} requires an explicit project path for exact producer verification.`
    );
  }
  if (!(await insideResolvedBoundary(input.workspacePath, cwd))) {
    throw new Error('The target producer working directory escapes the workspace boundary.');
  }
  const protectedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|AUTH)/i.test(key)
    )
  );
  const result = await execa(
    process.execPath,
    [entrypoint, ...exactCardProducerArgs(capability.cardId)],
    {
      cwd,
      shell: false,
      reject: false,
      timeout: 15 * 60_000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdin: 'ignore',
      extendEnv: false,
      env: { ...protectedEnvironment, NO_COLOR: '1', CI: process.env.CI ?? '1' },
    }
  );
  return {
    exitCode: result.exitCode ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function verifyRepairTarget(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  sourcePlan: PersistedRepairSource;
  dependencies: RepairEngineDependencies;
  workspaceStatus: 'passed' | 'blocked' | 'failed';
}): Promise<{
  status: 'passed' | 'failed' | 'unknown';
  remainingActionIds: string[];
}> {
  if (input.dependencies.targetVerify) {
    return input.dependencies.targetVerify({
      workspacePath: input.workspacePath,
      transaction: input.transaction,
    });
  }
  // Injected verification is used by bounded unit/host integrations. Preserve
  // its explicit result unless the caller also supplies target verification.
  if (input.dependencies.verify) {
    return {
      status: input.workspaceStatus === 'passed' ? 'passed' : 'failed',
      remainingActionIds:
        input.workspaceStatus === 'passed' ? [] : [...input.transaction.target.actionIds],
    };
  }
  if (input.workspaceStatus === 'failed') {
    return { status: 'unknown', remainingActionIds: [...input.transaction.target.actionIds] };
  }
  try {
    const refreshed = await buildArtifactRemediationPlan({
      workspacePath: input.workspacePath,
      includeAbsolutePaths: false,
      ciMode: true,
    });
    const selected = new Set(input.transaction.target.actionIds);
    const proposalHasCausalTargets =
      isWorkspaceRepairProposal(input.sourcePlan) &&
      Array.isArray(input.sourcePlan.targetActionIds) &&
      input.sourcePlan.targetActionIds.length > 0;
    const remaining = isWorkspaceRepairProposal(input.sourcePlan)
      ? refreshed.actions.filter((action) =>
          proposalHasCausalTargets
            ? selected.has(action.id)
            : action.cardId === input.transaction.target.cardId &&
              (!input.transaction.target.projectName ||
                action.projectName === input.transaction.target.projectName) &&
              (!input.transaction.target.projectPath ||
                action.projectPath === input.transaction.target.projectPath)
        )
      : refreshed.actions.filter((action) => selected.has(action.id));
    return {
      status: remaining.length === 0 ? 'passed' : 'failed',
      remainingActionIds: remaining.map((action) => action.id).sort(),
    };
  } catch {
    return { status: 'unknown', remainingActionIds: [...input.transaction.target.actionIds] };
  }
}

async function verifyApprovedTargetIsCurrent(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  dependencies: RepairEngineDependencies;
}): Promise<{
  current: boolean;
  missingActionIds: string[];
  semanticDrift: boolean;
}> {
  // Bounded test/host integrations provide their own verification truth. The
  // production path below is deliberately CLI-owned and evidence-backed.
  if (input.dependencies.verify || input.dependencies.targetVerify) {
    return { current: true, missingActionIds: [], semanticDrift: false };
  }
  const selectedActionIds = input.transaction.target.actionIds.filter(
    (actionId) => !actionId.startsWith('proposal:')
  );
  // Refresh-only cards may have no remediation action. Their producer result,
  // immutable proposal hash, and source before-hashes remain the precondition.
  if (selectedActionIds.length === 0)
    return { current: true, missingActionIds: [], semanticDrift: false };
  const refreshed = await buildArtifactRemediationPlan({
    workspacePath: input.workspacePath,
    includeAbsolutePaths: false,
    ciMode: true,
  });
  const currentActionIds = new Set(refreshed.actions.map((action) => action.id));
  const missingActionIds = selectedActionIds.filter((actionId) => !currentActionIds.has(actionId));
  const approvedFingerprint = input.transaction.preconditions
    .map((entry) => entry.id)
    .find((id) => id.startsWith(CAUSAL_ACTION_INTEGRITY_PREFIX))
    ?.slice(CAUSAL_ACTION_INTEGRITY_PREFIX.length);
  const currentActions = refreshed.actions.filter(
    (action) => currentActionIds.has(action.id) && selectedActionIds.includes(action.id)
  );
  const semanticDrift =
    missingActionIds.length === 0 &&
    Boolean(approvedFingerprint) &&
    causalActionFingerprint(currentActions) !== approvedFingerprint;
  return {
    current: missingActionIds.length === 0 && !semanticDrift,
    missingActionIds,
    semanticDrift,
  };
}

function tail(value: string, max = 8_000): string {
  return value.length <= max ? value : `…[truncated]…\n${value.slice(-max)}`;
}

async function applyOperation(
  projectPath: string,
  operation: DoctorRepairOperation
): Promise<void> {
  if (operation.type === 'file-create') return applyFileCreateFix({ projectPath, operation });
  if (operation.type === 'file-append') return applyFileAppendFix({ projectPath, operation });
  if (operation.type === 'file-copy') return applyFileCopyFix({ projectPath, operation });
  if (operation.type === 'package-json-script')
    return applyPackageScriptFix({
      projectPath,
      scriptName: operation.scriptName,
      scriptValue: operation.scriptValue,
    });
  if (operation.type === 'json-edit') return applyJsonEditFix({ projectPath, operation });
  if (operation.type === 'env-key-add') return applyEnvKeyAddFix({ projectPath, operation });
  if (operation.type === 'makefile-target')
    return applyMakefileTargetFix({ projectPath, operation });
}

async function applyProposalChange(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  change: WorkspaceRepairProposalChange;
}): Promise<void> {
  const target = path.resolve(input.workspacePath, input.change.path);
  if (
    !inside(input.workspacePath, target) ||
    !(await insideResolvedBoundary(input.workspacePath, target))
  ) {
    throw new Error(
      `Proposal target escaped the canonical workspace boundary: ${input.change.path}`
    );
  }
  const protectedReason = isProtectedProposalPath(input.change.path);
  if (protectedReason) throw new Error(`${input.change.path}: ${protectedReason}`);
  const checkpoint = input.transaction.checkpoint.files.find(
    (entry) => entry.path === input.change.path
  );
  if (!checkpoint)
    throw new Error(`Proposal target is missing from the checkpoint: ${input.change.path}`);
  const current = await fsExtra.readFile(target).catch(() => undefined);
  const currentHash = current ? sha256(current) : null;
  if (currentHash !== checkpoint.beforeHash || currentHash !== input.change.expectedBeforeHash) {
    throw new Error(`Proposal target changed before execution: ${input.change.path}`);
  }
  const stat = await fsExtra.lstat(target).catch(() => undefined);
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) {
    throw new Error(`Proposal target must be a regular file: ${input.change.path}`);
  }
  if (input.change.operation === 'delete') {
    if (!stat) throw new Error(`Proposal delete target does not exist: ${input.change.path}`);
    await fsExtra.remove(target);
    return;
  }
  const content = input.change.content ?? '';
  if (Buffer.byteLength(content, 'utf8') > MAX_CHECKPOINT_FILE_BYTES) {
    throw new Error(`Proposal write exceeds the 5 MiB file limit: ${input.change.path}`);
  }
  await fsExtra.ensureDir(path.dirname(target));
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.repair-tmp`
  );
  await fsExtra.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await fsExtra.move(temporary, target, { overwrite: true });
  const written = await fsExtra.readFile(target);
  if (sha256(written) !== sha256(content)) {
    throw new Error(`Proposal write could not be verified: ${input.change.path}`);
  }
}

async function runStage(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  stage: WorkspaceRepairStage;
  actions: Map<string, RuntimeRepairAction>;
  dependencies: RepairEngineDependencies;
}): Promise<boolean> {
  if (input.stage.status === 'passed' || input.stage.status === 'skipped') return true;
  if (input.stage.status === 'blocked') return false;
  input.stage.status = 'running';
  input.stage.startedAt = iso(input.dependencies.now);
  event(input.transaction, 'stage', input.stage.summary, {
    stageId: input.stage.id,
    status: 'running',
    now: input.dependencies.now,
  });
  await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
  try {
    if (input.stage.id === 'target-precondition' || input.stage.id === 'target-producer-verify') {
      const boundedHostIntegration = Boolean(
        input.dependencies.verify ||
        input.dependencies.targetVerify ||
        input.dependencies.runInvocation ||
        input.dependencies.toolAvailable ||
        input.dependencies.now
      );
      const result = await (
        input.dependencies.runTargetProducer ??
        (boundedHostIntegration
          ? async () => ({ exitCode: 0, stdout: '', stderr: '' })
          : runExactCardProducer)
      )({
        workspacePath: input.workspacePath,
        transaction: input.transaction,
      });
      input.stage.exitCode = result.exitCode;
      input.stage.stdoutTail = tail(result.stdout);
      input.stage.stderrTail = tail(result.stderr);
      // Evidence producers use exit code 2 for a successfully refreshed but
      // still-blocked finding. Target closure is evaluated after the complete
      // canonical loop; only producer execution failure is fatal here.
      if (result.exitCode !== 0 && result.exitCode !== 2) {
        throw new Error(
          result.stderr ||
            result.stdout ||
            `Exact card producer exited with ${String(result.exitCode)}.`
        );
      }
      if (input.stage.id === 'target-precondition') {
        const targetState = await verifyApprovedTargetIsCurrent({
          workspacePath: input.workspacePath,
          transaction: input.transaction,
          dependencies: input.dependencies,
        });
        if (!targetState.current) {
          const detail = targetState.semanticDrift
            ? 'The selected action semantics changed after approval.'
            : `Missing action(s): ${targetState.missingActionIds.join(', ')}.`;
          throw new Error(
            `The approved causal repair target changed before mutation. ${detail} Create and approve a fresh plan.`
          );
        }
      }
    } else if (input.stage.kind === 'repair') {
      const runtimeAction = input.actions.get(input.stage.id);
      if (!runtimeAction) throw new Error(`Persisted repair action is missing: ${input.stage.id}`);
      if (runtimeAction.kind === 'proposal') {
        await applyProposalChange({
          workspacePath: input.workspacePath,
          transaction: input.transaction,
          change: runtimeAction.change,
        });
      } else {
        const operation = operationForAction(runtimeAction.action);
        if (operation) {
          await applyOperation(
            actionProjectRoot(input.workspacePath, runtimeAction.action),
            operation
          );
        } else if (input.stage.invocation) {
          const result = await (input.dependencies.runInvocation ?? runInvocation)({
            workspacePath: input.workspacePath,
            invocation: input.stage.invocation,
            policy: input.transaction.policy,
          });
          input.stage.exitCode = result.exitCode;
          input.stage.stdoutTail = tail(result.stdout);
          input.stage.stderrTail = tail(result.stderr);
          if (result.exitCode !== 0)
            throw new Error(
              result.stderr || result.stdout || `Repair command exited with ${result.exitCode}.`
            );
        } else {
          throw new Error('Repair stage has no typed operation or structured invocation.');
        }
      }
    } else if (input.stage.invocation) {
      const result = await (input.dependencies.runInvocation ?? runInvocation)({
        workspacePath: input.workspacePath,
        invocation: input.stage.invocation,
        policy: input.transaction.policy,
      });
      input.stage.exitCode = result.exitCode;
      input.stage.stdoutTail = tail(result.stdout);
      input.stage.stderrTail = tail(result.stderr);
      if (result.exitCode !== 0)
        throw new Error(
          result.stderr || result.stdout || `${input.stage.kind} exited with ${result.exitCode}.`
        );
    }
    input.stage.status = 'passed';
    input.stage.completedAt = iso(input.dependencies.now);
    input.stage.summary =
      input.stage.id === 'target-precondition'
        ? `Exact ${input.transaction.target.cardId} target revalidated before mutation.`
        : input.stage.id === 'target-producer-verify'
          ? `Exact ${input.transaction.target.cardId} producer refreshed after mutation.`
          : `${input.stage.kind} completed.`;
    await refreshAfterHashes(input.workspacePath, input.transaction);
    event(input.transaction, 'stage', input.stage.summary, {
      stageId: input.stage.id,
      status: 'passed',
      now: input.dependencies.now,
    });
    await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
    return true;
  } catch (error) {
    input.stage.status = 'failed';
    input.stage.completedAt = iso(input.dependencies.now);
    input.stage.summary = error instanceof Error ? error.message : String(error);
    await refreshAfterHashes(input.workspacePath, input.transaction);
    event(input.transaction, 'stage', input.stage.summary, {
      stageId: input.stage.id,
      status: 'failed',
      now: input.dependencies.now,
    });
    await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
    return false;
  }
}

async function rollbackInternal(input: {
  workspacePath: string;
  transaction: WorkspaceRepairTransaction;
  dependencies: RepairEngineDependencies;
}): Promise<boolean> {
  const resumingRestore =
    input.transaction.state === 'rolling-back' ||
    input.transaction.checkpoint.status === 'restored';
  input.transaction.state = 'rolling-back';
  event(
    input.transaction,
    'rollback',
    'Rollback started from the bounded transaction checkpoint.',
    { status: 'running', now: input.dependencies.now }
  );
  await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
  const refuseRollback = async (reason: string): Promise<false> => {
    input.transaction.checkpoint.status = 'conflicted';
    input.transaction.state = 'decision-required';
    input.transaction.decision = runtimeRepairDecision(reason, ['manual-repair', 'cancel']);
    event(input.transaction, 'decision', reason, {
      status: 'conflicted',
      now: input.dependencies.now,
    });
    await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
    return false;
  };
  const restorePlan: Array<{
    entry: WorkspaceRepairTransaction['checkpoint']['files'][number];
    absolute: string;
    backup?: Buffer;
  }> = [];

  // Validate every target and backup before restoring the first byte. A late
  // conflict must never leave the workspace in a partially restored state.
  for (const entry of input.transaction.checkpoint.files) {
    const absolute = path.resolve(input.workspacePath, entry.path);
    if (
      !inside(input.workspacePath, absolute) ||
      !(await insideResolvedBoundary(input.workspacePath, absolute))
    ) {
      return refuseRollback(
        `Rollback refused because ${entry.path} escaped the workspace boundary.`
      );
    }
    const stat = await fsExtra.lstat(absolute).catch(() => undefined);
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) {
      return refuseRollback(`Rollback refused because ${entry.path} is no longer a regular file.`);
    }
    const current = stat ? await fsExtra.readFile(absolute) : undefined;
    const currentHash = current ? sha256(current) : null;
    const matchesAppliedState = entry.afterHash !== undefined && currentHash === entry.afterHash;
    const matchesRestoredState = resumingRestore && currentHash === entry.beforeHash;
    if (!matchesAppliedState && !matchesRestoredState) {
      return refuseRollback(
        `Rollback refused because ${entry.path} changed outside this transaction.`
      );
    }
    if (!entry.existed) {
      restorePlan.push({ entry, absolute });
      continue;
    }
    if (!entry.backupRef) {
      return refuseRollback(
        `Rollback refused because the checkpoint backup is missing for ${entry.path}.`
      );
    }
    const backup = path.join(
      transactionDir(input.workspacePath, input.transaction.transactionId),
      entry.backupRef
    );
    const backupStat = await fsExtra.lstat(backup).catch(() => undefined);
    if (!backupStat?.isFile() || backupStat.isSymbolicLink()) {
      return refuseRollback(
        `Rollback refused because the checkpoint backup is invalid for ${entry.path}.`
      );
    }
    const backupContent = await fsExtra.readFile(backup);
    if (sha256(backupContent) !== entry.beforeHash) {
      return refuseRollback(
        `Rollback refused because the checkpoint backup hash is invalid for ${entry.path}.`
      );
    }
    restorePlan.push({ entry, absolute, backup: backupContent });
  }

  for (const item of restorePlan) {
    if (!item.entry.existed) {
      await fsExtra.remove(item.absolute);
      continue;
    }
    const backupContent = item.backup;
    if (backupContent === undefined) {
      throw new Error(`Validated checkpoint backup disappeared for ${item.entry.path}.`);
    }
    const temporary = path.join(
      path.dirname(item.absolute),
      `.${path.basename(item.absolute)}.${process.pid}.${randomUUID()}.rollback-tmp`
    );
    await fsExtra.ensureDir(path.dirname(item.absolute));
    await fsExtra.writeFile(temporary, backupContent, { flag: 'wx' });
    if (item.entry.mode !== undefined) await fsExtra.chmod(temporary, item.entry.mode);
    await fsExtra.move(temporary, item.absolute, { overwrite: true });
  }
  input.transaction.checkpoint.status = 'restored';
  input.transaction.checkpoint.restoredAt = iso(input.dependencies.now);

  const reconciliationStages = input.transaction.stages.filter(
    (stage) => stage.kind === 'reconcile' && stage.invocation
  );
  for (const sourceStage of reconciliationStages) {
    const reconciliationInvocation = sourceStage.invocation;
    if (!reconciliationInvocation) continue;
    const rollbackStageId = `rollback:${sourceStage.id}`;
    const existingRollbackStage = input.transaction.stages.find(
      (stage) => stage.id === rollbackStageId && stage.kind === 'rollback'
    );
    const rollbackStage: WorkspaceRepairStage = existingRollbackStage ?? {
      id: rollbackStageId,
      kind: 'rollback',
      status: 'pending',
      required: true,
      risk: sourceStage.risk,
      summary: 'Reconcile the installed dependency tree with the restored manifest and lockfile.',
      invocation: reconciliationInvocation,
    };
    if (!existingRollbackStage) input.transaction.stages.push(rollbackStage);
    rollbackStage.status = 'running';
    rollbackStage.startedAt = iso(input.dependencies.now);
    delete rollbackStage.completedAt;
    delete rollbackStage.exitCode;
    delete rollbackStage.stdoutTail;
    delete rollbackStage.stderrTail;
    event(input.transaction, 'rollback', rollbackStage.summary, {
      stageId: rollbackStage.id,
      status: 'running',
      now: input.dependencies.now,
    });
    await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
    let result: { exitCode: number | null; stdout: string; stderr: string };
    try {
      result = await (input.dependencies.runInvocation ?? runInvocation)({
        workspacePath: input.workspacePath,
        invocation: reconciliationInvocation,
        policy: input.transaction.policy,
      });
    } catch (error) {
      result = {
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
    rollbackStage.exitCode = result.exitCode;
    rollbackStage.stdoutTail = tail(result.stdout);
    rollbackStage.stderrTail = tail(result.stderr);
    rollbackStage.completedAt = iso(input.dependencies.now);
    if (result.exitCode !== 0) {
      rollbackStage.status = 'failed';
      rollbackStage.summary =
        result.stderr || result.stdout || `Rollback reconciliation exited with ${result.exitCode}.`;
      input.transaction.state = 'decision-required';
      input.transaction.decision = runtimeRepairDecision(
        `Source files were restored, but the installed dependency tree could not be reconciled: ${rollbackStage.summary}`,
        ['manual-repair', 'cancel']
      );
      event(input.transaction, 'decision', input.transaction.decision.reason, {
        stageId: rollbackStage.id,
        status: 'rollback-reconcile-failed',
        now: input.dependencies.now,
      });
      await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
      return false;
    }
    rollbackStage.status = 'passed';
    rollbackStage.summary = 'Installed dependency tree reconciled with the restored source state.';
    event(input.transaction, 'rollback', rollbackStage.summary, {
      stageId: rollbackStage.id,
      status: 'passed',
      now: input.dependencies.now,
    });
  }
  input.transaction.state = 'rolled-back';
  // A successful rollback is terminal. Keep the failed verification receipt,
  // but do not expose stale choices that can no longer be applied.
  delete input.transaction.decision;
  event(
    input.transaction,
    'rollback',
    'Rollback restored every bounded checkpoint file and reconciled dependency state.',
    { status: 'passed', now: input.dependencies.now }
  );
  await saveTransaction(input.workspacePath, input.transaction, input.dependencies.now);
  return true;
}

export async function executeWorkspaceRepair(
  input: {
    workspacePath: string;
    transactionId: string;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const workspacePath = path.resolve(input.workspacePath);
  const release = await acquireLock(workspacePath, input.transactionId);
  try {
    const transaction = await readWorkspaceRepairTransaction({
      workspacePath,
      transactionId: input.transactionId,
    });
    if (
      ![
        'approved',
        'checkpointed',
        'executing',
        'verifying',
        'rollback-required',
        'rolling-back',
      ].includes(transaction.state)
    ) {
      throw new Error(`Repair transaction cannot execute from state ${transaction.state}.`);
    }
    if (
      transaction.approval.status !== 'approved' ||
      transaction.approval.approvedPlanHash !== transaction.integrity.planHash
    ) {
      throw new Error('Repair approval is missing, expired, or bound to another plan revision.');
    }
    if (transactionPlanHash(transaction) !== transaction.integrity.planHash) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        'The compiled repair plan changed after approval. Create and approve a fresh transaction.',
        ['cancel']
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'integrity-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    const sourcePlan = await readSourcePlan(workspacePath, input.transactionId);
    if (sha256(stableJson(sourcePlan)) !== transaction.integrity.sourceEvidenceHash) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        'Persisted remediation evidence changed after approval. Create and approve a fresh transaction.',
        ['cancel']
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'integrity-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    const executionPreflight = await toolPreconditions({
      workspacePath,
      stages: transaction.stages,
      toolAvailable: dependencies.toolAvailable,
    });
    const missingTool = executionPreflight.find((entry) => entry.status === 'failed');
    if (missingTool) {
      const missingExecutable = transaction.stages.find(
        (stage) =>
          stage.invocation &&
          `tool:${stage.invocation.cwd}:${stage.invocation.executable}` === missingTool.id
      )?.invocation?.executable;
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        `${missingTool.message} The approved plan cannot execute against a changed toolchain.`,
        ['manual-repair', 'cancel'],
        {
          kind: 'missing-executable',
          id: missingTool.id,
          message: missingTool.message,
          ...(missingExecutable ? { executable: missingExecutable } : {}),
        }
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'tool-precondition-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    if (transaction.state === 'rollback-required' || transaction.state === 'rolling-back') {
      if (!['captured', 'restored'].includes(transaction.checkpoint.status)) {
        throw new Error('A captured checkpoint is required to resume rollback.');
      }
      await rollbackInternal({ workspacePath, transaction, dependencies });
      return transaction;
    }
    const actions = new Map<string, RuntimeRepairAction>(
      isWorkspaceRepairProposal(sourcePlan)
        ? sourcePlan.changes.map((change) => [
            `proposal:${change.id}`,
            { kind: 'proposal', change } as RuntimeRepairAction,
          ])
        : sourcePlan.actions.map((action) => [
            `action:${action.id}`,
            { kind: 'canonical', action } as RuntimeRepairAction,
          ])
    );
    try {
      await assertCheckpointBaselineIsCurrent({ workspacePath, transaction });
    } catch (error) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        error instanceof Error ? error.message : String(error),
        ['cancel']
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'source-precondition-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    const targetPreconditionStage = transaction.stages.find(
      (stage) => stage.id === 'target-precondition'
    );
    if (!targetPreconditionStage) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        'The approved plan has no exact target precondition. Create and approve a fresh transaction.',
        ['cancel']
      );
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    const targetStillCurrent = await runStage({
      workspacePath,
      transaction,
      stage: targetPreconditionStage,
      actions,
      dependencies,
    });
    if (!targetStillCurrent) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        `Target precondition failed before checkpoint: ${targetPreconditionStage.summary}`,
        ['cancel']
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'target-precondition-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    try {
      await captureCheckpoint({ workspacePath, transaction, now: dependencies.now });
    } catch (error) {
      transaction.approval.status = 'expired';
      transaction.state = 'decision-required';
      transaction.decision = runtimeRepairDecision(
        error instanceof Error ? error.message : String(error),
        ['cancel']
      );
      event(transaction, 'decision', transaction.decision.reason, {
        status: 'precondition-failed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    transaction.state = 'executing';
    await saveTransaction(workspacePath, transaction, dependencies.now);
    for (const stage of transaction.stages.filter(
      (candidate) =>
        candidate.id !== 'target-precondition' &&
        candidate.id !== 'canonical-verify' &&
        candidate.kind !== 'rollback'
    )) {
      const passed = await runStage({ workspacePath, transaction, stage, actions, dependencies });
      if (!passed && stage.required) {
        transaction.state = transaction.policy.autoRollback
          ? 'rollback-required'
          : 'decision-required';
        transaction.decision = runtimeRepairDecision(
          `Required stage ${stage.id} failed: ${stage.summary}`,
          transaction.policy.autoRollback
            ? ['rollback', 'manual-repair', 'cancel']
            : ['manual-repair', 'rollback', 'cancel']
        );
        await saveTransaction(workspacePath, transaction, dependencies.now);
        if (transaction.policy.autoRollback)
          await rollbackInternal({ workspacePath, transaction, dependencies });
        return transaction;
      }
    }
    transaction.state = 'verifying';
    const verifyStage = transaction.stages.find((stage) => stage.id === 'canonical-verify');
    if (!verifyStage) {
      transaction.state = transaction.policy.autoRollback
        ? 'rollback-required'
        : 'decision-required';
      transaction.decision = runtimeRepairDecision(
        'The approved plan has no canonical verification stage.',
        transaction.policy.autoRollback
          ? ['rollback', 'manual-repair', 'cancel']
          : ['manual-repair', 'rollback', 'cancel']
      );
      await saveTransaction(workspacePath, transaction, dependencies.now);
      if (transaction.policy.autoRollback) {
        await rollbackInternal({ workspacePath, transaction, dependencies });
      }
      return transaction;
    }
    verifyStage.status = 'running';
    verifyStage.startedAt = iso(dependencies.now);
    event(transaction, 'verification', 'Canonical Workspace Intelligence verification started.', {
      stageId: verifyStage.id,
      status: 'running',
      now: dependencies.now,
    });
    await saveTransaction(workspacePath, transaction, dependencies.now);
    let verification: { status: string; exitCode: number; artifactPath: string };
    try {
      verification = dependencies.verify
        ? await dependencies.verify(workspacePath)
        : await runWorkspaceIntelligenceChain({ workspacePath, strict: true, agent: 'generic' });
    } catch (error) {
      verification = {
        status: 'failed',
        exitCode: 1,
        artifactPath: WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun,
      };
      verifyStage.stderrTail = tail(error instanceof Error ? error.message : String(error));
    }
    const workspaceStatus: 'passed' | 'blocked' | 'failed' =
      verification.status === 'passed' && verification.exitCode === 0
        ? 'passed'
        : verification.status === 'failed' || verification.exitCode === 1
          ? 'failed'
          : 'blocked';
    const targetVerification = await verifyRepairTarget({
      workspacePath,
      transaction,
      sourcePlan,
      dependencies,
      workspaceStatus,
    });
    const passed = targetVerification.status === 'passed' && workspaceStatus !== 'failed';
    verifyStage.status = passed ? 'passed' : 'failed';
    verifyStage.completedAt = iso(dependencies.now);
    verifyStage.exitCode = verification.exitCode;
    verifyStage.summary =
      passed && workspaceStatus === 'passed'
        ? 'Selected repair target and canonical workspace verification passed.'
        : passed
          ? 'Selected repair target passed; canonical workspace verification remains blocked by other governed findings.'
          : targetVerification.status === 'unknown'
            ? 'Canonical verification could not establish the selected repair target outcome.'
            : `Selected repair target remains unresolved; canonical workspace verification is ${workspaceStatus}.`;
    transaction.verification = {
      status: passed ? 'passed' : 'failed',
      targetStatus: targetVerification.status,
      workspaceStatus,
      remainingActionIds: targetVerification.remainingActionIds,
      artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun,
      exitCode: verification.exitCode,
      summary: verifyStage.summary,
    };
    event(transaction, 'verification', verifyStage.summary, {
      stageId: verifyStage.id,
      status: verifyStage.status,
      now: dependencies.now,
    });
    if (passed) {
      transaction.state = 'closed';
      delete transaction.decision;
      event(transaction, 'closed', verifyStage.summary, {
        status: 'passed',
        now: dependencies.now,
      });
      await saveTransaction(workspacePath, transaction, dependencies.now);
      return transaction;
    }
    transaction.state = transaction.policy.autoRollback ? 'rollback-required' : 'decision-required';
    transaction.decision = runtimeRepairDecision(
      verifyStage.summary,
      transaction.policy.autoRollback
        ? ['rollback', 'manual-repair', 'cancel']
        : ['manual-repair', 'rollback', 'cancel']
    );
    await saveTransaction(workspacePath, transaction, dependencies.now);
    if (transaction.policy.autoRollback)
      await rollbackInternal({ workspacePath, transaction, dependencies });
    return transaction;
  } finally {
    await release();
  }
}

export async function rollbackWorkspaceRepair(
  input: {
    workspacePath: string;
    transactionId: string;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const workspacePath = path.resolve(input.workspacePath);
  const release = await acquireLock(workspacePath, input.transactionId);
  try {
    const transaction = await readWorkspaceRepairTransaction({
      workspacePath,
      transactionId: input.transactionId,
    });
    if (
      ![
        'checkpointed',
        'executing',
        'verifying',
        'rollback-required',
        'rolling-back',
        'decision-required',
        'failed',
      ].includes(transaction.state)
    ) {
      throw new Error(`Repair transaction cannot roll back from state ${transaction.state}.`);
    }
    if (!['captured', 'restored'].includes(transaction.checkpoint.status)) {
      throw new Error('A captured checkpoint is required for rollback.');
    }
    await rollbackInternal({ workspacePath, transaction, dependencies });
    return transaction;
  } finally {
    await release();
  }
}

export async function cancelWorkspaceRepair(
  input: {
    workspacePath: string;
    transactionId: string;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const transaction = await readWorkspaceRepairTransaction(input);
  if (['closed', 'rolled-back', 'cancelled'].includes(transaction.state)) return transaction;
  if (transaction.checkpoint.status === 'captured')
    throw new Error('Rollback a mutated transaction before cancelling it.');
  transaction.state = 'cancelled';
  transaction.approval.status =
    transaction.approval.status === 'approved' ? 'expired' : transaction.approval.status;
  event(transaction, 'cancelled', 'Repair transaction cancelled before mutation.', {
    status: 'cancelled',
    now: dependencies.now,
  });
  await saveTransaction(input.workspacePath, transaction, dependencies.now);
  return transaction;
}

export async function decideWorkspaceRepair(
  input: {
    workspacePath: string;
    transactionId: string;
    decision: WorkspaceRepairDecision;
  },
  dependencies: RepairEngineDependencies = {}
): Promise<WorkspaceRepairTransaction> {
  const workspacePath = path.resolve(input.workspacePath);
  const transaction = await readWorkspaceRepairTransaction({
    workspacePath,
    transactionId: input.transactionId,
  });
  if (transaction.state !== 'decision-required' || !transaction.decision) {
    throw new Error(`Repair transaction is not awaiting a decision: ${transaction.state}`);
  }
  if (!transaction.decision.options.includes(input.decision)) {
    throw new Error(
      `Decision ${input.decision} is not available. Allowed: ${transaction.decision.options.join(', ')}.`
    );
  }
  if (input.decision === 'rollback') {
    return rollbackWorkspaceRepair(
      { workspacePath, transactionId: input.transactionId },
      dependencies
    );
  }
  if (input.decision === 'cancel' || input.decision === 'manual-repair') {
    if (transaction.checkpoint.status === 'captured') {
      throw new Error('A mutated transaction must be rolled back before control is released.');
    }
    transaction.state = 'cancelled';
    transaction.approval.status =
      transaction.approval.status === 'approved' ? 'expired' : transaction.approval.status;
    event(
      transaction,
      'decision',
      input.decision === 'manual-repair'
        ? 'The user chose manual repair; this transaction released source ownership without mutation.'
        : 'The user cancelled the decision-required transaction.',
      { status: input.decision, now: dependencies.now }
    );
    await saveTransaction(workspacePath, transaction, dependencies.now);
    return transaction;
  }

  if (transaction.checkpoint.status === 'captured') {
    throw new Error(
      'Repair policy cannot change after a checkpoint has been captured. Roll back first.'
    );
  }
  const source = await readSourcePlan(workspacePath, input.transactionId);
  transaction.state = 'cancelled';
  transaction.approval.status =
    transaction.approval.status === 'approved' ? 'expired' : transaction.approval.status;
  event(
    transaction,
    'decision',
    `The user selected ${input.decision}; a fresh immutable plan and approval are required.`,
    { status: 'superseded', now: dependencies.now }
  );
  await saveTransaction(workspacePath, transaction, dependencies.now);

  const nextPolicy = {
    maxRisk:
      input.decision === 'approve-invasive'
        ? ('invasive' as const)
        : input.decision === 'approve-guarded' && transaction.policy.maxRisk === 'safe'
          ? ('guarded' as const)
          : transaction.policy.maxRisk,
    allowForce: transaction.policy.allowForce || input.decision === 'allow-force',
    allowBreaking: transaction.policy.allowBreaking || input.decision === 'allow-breaking',
    autoRollback: transaction.policy.autoRollback,
  };
  if (isWorkspaceRepairProposal(source)) {
    return planWorkspaceRepairProposal(
      { workspacePath, proposal: source, ...nextPolicy },
      dependencies
    );
  }
  const actionIds = transaction.target.actionIds.map((id) =>
    id.startsWith('action:') ? id.slice('action:'.length) : id
  );
  return planWorkspaceRepair(
    {
      workspacePath,
      cardId: transaction.target.cardId,
      ...(actionIds.length === 1 ? { actionId: actionIds[0] } : {}),
      projectName: transaction.target.projectName,
      ...nextPolicy,
    },
    dependencies
  );
}

export async function listWorkspaceRepairTransactions(
  workspacePath: string
): Promise<WorkspaceRepairTransaction[]> {
  const root = path.join(workspacePath, REPAIR_ROOT, 'transactions');
  const entries = await fsExtra.readdir(root).catch(() => [] as string[]);
  const transactions = await Promise.all(
    entries.map((transactionId) =>
      readWorkspaceRepairTransaction({ workspacePath, transactionId }).catch(() => undefined)
    )
  );
  return transactions
    .filter((entry): entry is WorkspaceRepairTransaction => Boolean(entry))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
