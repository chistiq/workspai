import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hasRootLifecycleManifest } from './polyglot-lifecycle-plan.js';
import { findContainingGitRoot } from './utils/git-worktree.js';
import { taskContextRetry } from './agent-task-recovery.js';
import type { AgentTaskRecovery, AgentTaskRequest } from './agent-task-recovery.js';
import {
  AGENT_JSON_CONSUMPTION_GUIDANCE,
  AGENT_CONTINUATION_GUIDANCE,
  AGENT_VERIFICATION_GUIDANCE,
} from './agent-output-guidance.js';

import { buildAgentBootstrapView, MAX_AGENT_BOOTSTRAP_BYTES } from './agent-bootstrap-view.js';
import {
  buildProjectLifecycleContext,
  MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES,
} from './project-lifecycle-context.js';
import {
  buildAgentBootstrapReceipt,
  PROJECT_AGENT_ENTRY_RELATIVE_PATH,
} from './project-agent-entry.js';
import {
  ProjectWorkspaceResolutionError,
  resolveProjectWorkspaceSync,
} from './project-workspace-link.js';
import type {
  ProjectWorkspaceResolutionErrorCode,
  ProjectWorkspaceResolutionSource,
} from './project-workspace-link.js';
import { resolveManagedDefaultImportWorkspacePath } from './utils/workspace-paths.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';
import type { WorkspaceKnowledgeGraphSnapshotResult } from './workspace-knowledge-graph-snapshot.js';
import type { WorkspaceGraphInputValidation } from './workspace-knowledge-graph.js';
import {
  buildWorkspaceGraphSearchView,
  MAX_GRAPH_SEARCH_BYTES,
} from './workspace-graph-search-view.js';
import type {
  WorkspaceGraphSearchBudgetFailure,
  WorkspaceGraphSearchView,
} from './workspace-graph-search-view.js';
import type { AgentBootstrapBudgetFailure, AgentBootstrapView } from './agent-bootstrap-view.js';
import type {
  ProjectLifecycleContext,
  ProjectLifecycleContextFailure,
} from './project-lifecycle-context.js';
import { buildTaskOperationalSkill } from './workspace-operational-skills.js';

export const AGENT_TASK_CONTEXT_SCHEMA_VERSION = 'workspai.agent-task-context.v1' as const;
export const DEFAULT_AGENT_TASK_CONTEXT_MAX_BYTES = 32 * 1024;
export const MAX_AGENT_TASK_CONTEXT_MAX_BYTES = 128 * 1024;
const MAX_TASK_BYTES = 4 * 1024;

type ContextUnavailable = {
  status: 'unavailable';
  reason: string;
  nextAction: string;
  inputValidation?: WorkspaceGraphInputValidation;
};

export type AgentTaskWorkspaceResolution =
  | {
      status: 'resolved';
      source: Exclude<ProjectWorkspaceResolutionSource, 'explicit'>;
      managedDefault: boolean;
    }
  | { status: 'unmanaged'; source: 'none'; managedDefault: false }
  | {
      status: 'blocked';
      source: 'none';
      managedDefault: false;
      reason:
        | Exclude<ProjectWorkspaceResolutionErrorCode, 'project.workspace.unlinked'>
        | 'resolution-failed';
    };

export type AgentTaskContext = {
  schemaVersion: typeof AGENT_TASK_CONTEXT_SCHEMA_VERSION;
  status: 'ready' | 'partial';
  task: { text: string; use: 'retrieval-query'; authority: 'user-request' };
  scope: {
    project: string;
    projectPath: string;
    workspace: string | null;
    binding: 'canonical-project-member' | 'not-workspai-managed' | 'resolution-blocked';
    workspaceResolution: AgentTaskWorkspaceResolution;
  };
  selection: {
    source: 'explicit-project' | 'working-directory';
    verifiedBy: 'canonical-membership' | 'root-evidence' | 'explicit-directory';
  };
  grounding: AgentBootstrapView | AgentBootstrapBudgetFailure | ContextUnavailable;
  graph: WorkspaceGraphSearchView | WorkspaceGraphSearchBudgetFailure | ContextUnavailable;
  lifecycle: ProjectLifecycleContext | ProjectLifecycleContextFailure;
  skill: ReturnType<typeof buildTaskOperationalSkill>;
  execution: {
    cwdBase: 'canonical-project-root';
    sourceReadsChangeCwd: false;
    workspaceLocator: {
      prefix: 'workspace:';
      base: 'canonical-workspace-root';
      resolveCommand: 'workspai project workspace status --json';
      resolveCommandCwd: '.';
      pathField: 'workspacePath';
    } | null;
  };
  delivery?: {
    status: 'prepared';
    hostLoading: 'not-observed';
    modelCompliance: 'not-observed';
  };
  operatingRules: string[];
  nextActions: string[];
  budget: { maxBytes: number; usedBytes: number; accounting: 'utf8-json-with-newline' };
  integrity: { algorithm: 'sha256'; payloadHash: string };
};

export type AgentTaskContextBudgetFailure = {
  schemaVersion: typeof AGENT_TASK_CONTEXT_SCHEMA_VERSION;
  status: 'insufficient-budget';
  budget: { maxBytes: number; requiredBytes: number; accounting: 'utf8-json-with-newline' };
  message: string;
  nextActions: string[];
  recovery: AgentTaskRecovery[];
};

export type AgentTaskContextSelectionRequired = {
  schemaVersion: typeof AGENT_TASK_CONTEXT_SCHEMA_VERSION;
  status: 'project-selection-required';
  selection: {
    reason: 'unverified-working-directory' | 'path-not-found' | 'nested-project-boundary';
    source: 'explicit-project' | 'working-directory';
    path?: string;
  };
  message: string;
  nextActions: string[];
  recovery: AgentTaskRecovery[];
};

export function agentTaskContextByteBudget(value?: string | number): number {
  if (value === undefined) return DEFAULT_AGENT_TASK_CONTEXT_MAX_BYTES;
  if (typeof value === 'string' && !/^\d+$/u.test(value)) {
    throw new Error('--max-bytes must be an integer.');
  }
  const bytes = Number(value);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 8 * 1024 ||
    bytes > MAX_AGENT_TASK_CONTEXT_MAX_BYTES
  ) {
    throw new Error(`--max-bytes must be between 8192 and ${MAX_AGENT_TASK_CONTEXT_MAX_BYTES}.`);
  }
  return bytes;
}

function wireBytes(value: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function comparableLocalPath(value: string): string {
  let resolved = path.resolve(value);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // The resolved workspace is expected to exist, but retain a lexical fallback
    // so an inaccessible default path never becomes a fatal context error.
  }
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function describeWorkspaceResolution(
  resolution: ReturnType<typeof resolveProjectWorkspaceSync>,
  error: ProjectWorkspaceResolutionError | null,
  unexpectedFailure: boolean
): AgentTaskWorkspaceResolution {
  if (resolution) {
    if (resolution.source === 'explicit') {
      return {
        status: 'blocked',
        source: 'none',
        managedDefault: false,
        reason: 'resolution-failed',
      };
    }
    let managedDefault = false;
    try {
      managedDefault =
        comparableLocalPath(resolution.workspacePath) ===
        comparableLocalPath(resolveManagedDefaultImportWorkspacePath());
    } catch {
      // This is descriptive metadata only; resolution itself remains authoritative.
    }
    return { status: 'resolved', source: resolution.source, managedDefault };
  }
  if (!unexpectedFailure && error?.code === 'project.workspace.unlinked') {
    return { status: 'unmanaged', source: 'none', managedDefault: false };
  }
  return {
    status: 'blocked',
    source: 'none',
    managedDefault: false,
    reason:
      error?.code && error.code !== 'project.workspace.unlinked' ? error.code : 'resolution-failed',
  };
}

function safeFailureCategory(
  error: unknown
): 'permission-denied' | 'artifact-missing' | 'validation-failed' {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission-denied';
    if (code === 'ENOENT') return 'artifact-missing';
  }
  return 'validation-failed';
}

function failureBudget(
  maxBytes: number,
  requiredBytes: number,
  request: AgentTaskRequest,
  limitedComponents: string[] = []
): AgentTaskContextBudgetFailure {
  const componentLimited = limitedComponents.length > 0;
  const canIncrease = !componentLimited && requiredBytes <= MAX_AGENT_TASK_CONTEXT_MAX_BYTES;
  const recovery: AgentTaskRecovery[] = canIncrease
    ? [
        {
          kind: 'retry',
          message:
            'Retry once with the exact aggregate byte budget. Preserve project, task and host.',
          command: taskContextRetry(request, { maxBytes: requiredBytes }),
        },
      ]
    : limitedComponents.length === 1 && limitedComponents[0] === 'graph' && request.limit > 1
      ? [
          {
            kind: 'retry',
            message: 'Reduce Graph matches to one; --limit counts matches, not bytes.',
            command: taskContextRetry(request, { limit: 1 }),
          },
        ]
      : [
          ...(limitedComponents.includes('lifecycle') && request.path === undefined
            ? [
                {
                  kind: 'select-path' as const,
                  requiredOption: '--path' as const,
                  message:
                    'Select a verified project-relative source or manifest for the task. Do not guess a package or use a byte count as --limit.',
                },
              ]
            : []),
          {
            kind: 'native' as const,
            message:
              'Use targeted native evidence and disclose unavailable Workspai context. Increasing the packet budget alone cannot satisfy this request.',
          },
        ];
  const failure: AgentTaskContextBudgetFailure = {
    schemaVersion: AGENT_TASK_CONTEXT_SCHEMA_VERSION,
    status: 'insufficient-budget',
    budget: {
      maxBytes,
      requiredBytes,
      accounting: 'utf8-json-with-newline',
    },
    message: componentLimited
      ? 'A required component exceeds its maximum view budget; no partial task packet was emitted.'
      : 'The complete task context does not fit; no partial packet was emitted.',
    nextActions: [
      canIncrease
        ? `Use recovery[0].command from its declared cwd base with --max-bytes ${requiredBytes}. Do not change the project, task or host.`
        : 'Follow the structured recovery action once, or continue with targeted native evidence. --limit is a match count from 1 to 12; --max-bytes is a UTF-8 byte budget.',
    ],
    recovery,
  };
  assertJsonSchemaContract(
    failure,
    'contracts/workspace-intelligence/agent-task-context.v1.json',
    'Agent task context budget refusal'
  );
  return failure;
}

/** Include decimal-width changes in both budget fields, so one retry is sufficient. */
function requiredPacketBytes(context: AgentTaskContext, extraComponentBytes = 0): number {
  let required = wireBytes(context) + extraComponentBytes;
  while (true) {
    const measured =
      wireBytes({
        ...context,
        budget: { ...context.budget, maxBytes: required, usedBytes: required },
      }) + extraComponentBytes;
    if (measured === required) return required;
    required = measured;
  }
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function pathInsideProject(projectPath: string, selectedPath?: string): string | undefined {
  if (selectedPath === undefined) return undefined;
  if (
    !selectedPath.trim() ||
    selectedPath.includes('\u0000') ||
    path.isAbsolute(selectedPath) ||
    /^[A-Za-z]:[\\/]/u.test(selectedPath)
  ) {
    throw new Error('--path must be a non-empty project-relative path.');
  }
  const normalized = selectedPath.replaceAll('\\', '/');
  const absolute = path.resolve(projectPath, normalized);
  const relative = path.relative(projectPath, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('--path must remain inside the selected project.');
  }
  const realProjectPath = fs.realpathSync(projectPath);
  let existingAncestor = absolute;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  if (!isPathWithin(realProjectPath, fs.realpathSync(existingAncestor))) {
    throw new Error('--path must not escape the selected project through a symbolic link.');
  }
  return relative.split(path.sep).join('/') || '.';
}

/**
 * Assemble a bounded, read-only task packet from canonical Workspai identity,
 * scoped Graph evidence, and the closest manifest-derived lifecycle plan.
 * Missing Workspai metadata is disclosed and never blocks native project work.
 */
export async function buildAgentTaskContext(input: {
  projectPath: string;
  projectSelected?: boolean;
  task: string;
  forAgent?: string;
  path?: string;
  limit?: number;
  maxBytes?: string | number;
}): Promise<AgentTaskContext | AgentTaskContextBudgetFailure | AgentTaskContextSelectionRequired> {
  const selectedProjectPath = fs.realpathSync(path.resolve(input.projectPath));
  if (!fs.statSync(selectedProjectPath).isDirectory()) {
    throw new Error('--project must select an existing directory.');
  }
  const task = input.task.trim();
  if (!task) throw new Error('--task must contain a non-empty request.');
  if (Buffer.byteLength(task, 'utf8') > MAX_TASK_BYTES) {
    throw new Error(`--task must not exceed ${MAX_TASK_BYTES} UTF-8 bytes.`);
  }
  if (task.includes('\u0000')) throw new Error('--task must not contain NUL characters.');
  const limit = input.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) {
    throw new Error(
      '--limit must be an integer between 1 and 12 (Graph matches, not bytes). Use --max-bytes for the UTF-8 byte budget.'
    );
  }
  const maxBytes = agentTaskContextByteBudget(input.maxBytes);
  const selectionSource =
    input.projectSelected === false ? 'working-directory' : 'explicit-project';
  const request: AgentTaskRequest = {
    task,
    forAgent: input.forAgent ?? 'generic',
    project: '.',
    ...(input.path === undefined ? {} : { path: input.path }),
    limit,
    maxBytes,
  };
  const selectionRequired = (
    reason: AgentTaskContextSelectionRequired['selection']['reason'],
    message: string,
    recovery: AgentTaskRecovery[]
  ): AgentTaskContextSelectionRequired => {
    const failure: AgentTaskContextSelectionRequired = {
      schemaVersion: AGENT_TASK_CONTEXT_SCHEMA_VERSION,
      status: 'project-selection-required',
      selection: {
        reason,
        source: selectionSource,
        ...(input.path === undefined ? {} : { path: input.path }),
      },
      message,
      nextActions: recovery.map((action) => action.message),
      recovery,
    };
    assertJsonSchemaContract(
      failure,
      'contracts/workspace-intelligence/agent-task-context.v1.json',
      'Agent task project selection'
    );
    return failure;
  };

  let grounding: AgentTaskContext['grounding'];
  let graph: AgentTaskContext['graph'];
  let projectName = path.basename(selectedProjectPath);
  let projectRelativePathForContext = '.';
  let workspaceName: string | null = null;
  let binding: AgentTaskContext['scope']['binding'] = 'not-workspai-managed';
  const nextActions: string[] = [];

  let resolution: ReturnType<typeof resolveProjectWorkspaceSync> = null;
  let resolutionError: ProjectWorkspaceResolutionError | null = null;
  let unexpectedResolutionFailure = false;
  try {
    resolution = resolveProjectWorkspaceSync({
      startPath: selectedProjectPath,
      strict: true,
      requireProjectMembership: true,
    });
  } catch (error) {
    if (error instanceof ProjectWorkspaceResolutionError) resolutionError = error;
    else unexpectedResolutionFailure = true;
  }
  const workspaceResolution = describeWorkspaceResolution(
    resolution,
    resolutionError,
    unexpectedResolutionFailure
  );
  if (workspaceResolution.status === 'blocked') binding = 'resolution-blocked';
  const projectPath = resolution?.projectPath ?? selectedProjectPath;
  const projectRelativePath = pathInsideProject(projectPath, input.path);
  request.project =
    path.relative(selectedProjectPath, projectPath).split(path.sep).join('/') || '.';
  request.path = projectRelativePath;
  const rootManifest = hasRootLifecycleManifest(projectPath);
  const gitRoot =
    !resolution?.projectPath && !rootManifest && fs.existsSync(path.join(projectPath, '.git'))
      ? await findContainingGitRoot(projectPath)
      : null;
  const hasRootEvidence =
    !!resolution?.projectPath ||
    rootManifest ||
    (gitRoot !== null && path.relative(fs.realpathSync(gitRoot), projectPath) === '');
  if (!hasRootEvidence && input.projectSelected === false) {
    return selectionRequired(
      'unverified-working-directory',
      'The working directory has no verified project boundary. No descendant projects were scanned and no task packet was emitted.',
      [
        {
          kind: 'select-project',
          requiredOption: '--project',
          message:
            'Retry with --project set to the user-selected source root. Resolve it from the request or the instruction file location; reading a file does not select its directory. Do not adopt or scan sibling projects to guess the target.',
        },
      ]
    );
  }
  if (projectRelativePath !== undefined) {
    const target = path.resolve(projectPath, projectRelativePath);
    if (!fs.existsSync(target)) {
      return selectionRequired(
        'path-not-found',
        'The supplied --path does not exist inside the selected project. Project context was withheld instead of treating another directory as the target.',
        [
          {
            kind: 'select-project',
            requiredOption: '--project',
            message:
              'Compare the selected project with the user target. Correct --project if the terminal is elsewhere; --path is relative to that project, not the terminal.',
          },
          {
            kind: 'select-path',
            requiredOption: '--path',
            message:
              'Use a known existing project-relative source or manifest, or omit --path when planning a new file.',
          },
        ]
      );
    }
    let boundary = fs.statSync(target).isDirectory() ? target : path.dirname(target);
    while (boundary !== projectPath && isPathWithin(projectPath, boundary)) {
      if (
        fs.existsSync(path.join(boundary, '.git')) ||
        fs.existsSync(path.join(boundary, '.workspai/project.json'))
      ) {
        const nested =
          path.relative(selectedProjectPath, boundary).split(path.sep).join('/') || '.';
        const nestedPath = path.relative(boundary, target).split(path.sep).join('/') || '.';
        return selectionRequired(
          'nested-project-boundary',
          'The selected source belongs to a nested project boundary. No parent or sibling context was substituted.',
          [
            {
              kind: 'select-project',
              message:
                'Confirm that the nested project is the user target, then use this rebased command from the original request directory.',
              command: taskContextRetry(request, { project: nested, path: nestedPath }),
            },
          ]
        );
      }
      boundary = path.dirname(boundary);
    }
  }
  if (!resolution?.projectPath) {
    const blockedResolution = workspaceResolution.status === 'blocked';
    const resolutionReason =
      workspaceResolution.status === 'blocked' ? workspaceResolution.reason : undefined;
    grounding = {
      status: 'unavailable',
      reason: blockedResolution
        ? `Canonical Workspai workspace resolution is blocked (${resolutionReason}).`
        : 'No canonical Workspai project membership was resolved for this directory.',
      nextAction: blockedResolution
        ? 'Do not treat this target as unmanaged or adopt it automatically. Continue with native project evidence; resolve the workspace binding only if the task needs Workspai evidence.'
        : 'Continue with the repository instructions, source and native checks. Workspai adoption is optional and requires the user’s choice.',
    };
    graph = {
      status: 'unavailable',
      reason: blockedResolution
        ? `Project-scoped Graph evidence is withheld because workspace resolution is blocked (${resolutionReason}).`
        : 'A project-scoped Workspai graph is unavailable without canonical membership.',
      nextAction: blockedResolution
        ? 'Use native source and test search. Do not infer that source is absent or refresh a different workspace; ask the user to choose the canonical workspace only if Graph evidence is required.'
        : 'Use native source search and project manifests; request adoption only when it would materially help and the user has not declined.',
    };
  } else {
    binding = 'canonical-project-member';
    try {
      let validatedSnapshot: WorkspaceKnowledgeGraphSnapshotResult | undefined;
      const receipt = await buildAgentBootstrapReceipt({
        startPath: resolution.projectPath,
        forAgent: input.forAgent ?? 'generic',
        validateLiveInputs: true,
        onSnapshot: (snapshot) => {
          validatedSnapshot = snapshot;
        },
      });
      projectName = receipt.project.name;
      projectRelativePathForContext = receipt.project.relativePath;
      workspaceName = receipt.workspace.name;
      const completedReads = [
        PROJECT_AGENT_ENTRY_RELATIVE_PATH,
        receipt.canonicalEvidence.projectContext,
        ...receipt.requiredReadOrder.filter((entry) =>
          entry.startsWith('command:workspai workspace graph search ')
        ),
        ...receipt.nextActions
          .filter((entry) => entry.startsWith('workspai workspace graph search '))
          .map((entry) => `command:${entry}`),
      ];
      // Components share the packet budget instead of reserving fixed percentages.
      // The complete aggregate below is the only admission decision.
      grounding = buildAgentBootstrapView(receipt, {
        maxBytes: MAX_AGENT_BOOTSTRAP_BYTES,
        projectTask: true,
        completedReads: completedReads.flatMap((entry) => [entry, `${entry} --view agent`]),
      });
      const snapshot =
        validatedSnapshot ??
        (await readWorkspaceKnowledgeGraphSnapshot(resolution.workspacePath, {
          includeInputDiagnostics: true,
        }));
      if (snapshot.status === 'hit') {
        graph = buildWorkspaceGraphSearchView(snapshot.graph, {
          query: task,
          projectId: receipt.project.name,
          limit,
          maxBytes: MAX_GRAPH_SEARCH_BYTES,
          liveInputsValidated: true,
        });
      } else {
        graph = {
          status: 'unavailable',
          reason: `The canonical graph snapshot is unavailable (${snapshot.reason}).`,
          ...(snapshot.inputValidation ? { inputValidation: snapshot.inputValidation } : {}),
          nextAction:
            'Graph unavailability does not prove source absence. Continue with targeted native source and test search. Refresh canonical workspace intelligence only when the task requires Graph evidence and a workspace-wide refresh is authorized.',
        };
      }
    } catch (error) {
      const failureCategory = safeFailureCategory(error);
      grounding = {
        status: 'unavailable',
        reason: `Canonical project grounding could not be validated (${failureCategory}).`,
        nextAction:
          failureCategory === 'permission-denied'
            ? 'The canonical Workspai metadata is not readable or writable in this environment. Do not repeat a refresh without permission; continue with native project evidence and report the access block.'
            : 'Keep the request scoped to the selected project and use native project instructions, source search and checks.',
      };
      graph = {
        status: 'unavailable',
        reason: `Project grounding could not be validated (${failureCategory}), so project Graph results were withheld.`,
        nextAction:
          failureCategory === 'permission-denied'
            ? 'Treat Graph as unavailable, not as evidence that source is missing. Continue with native source and tests; request canonical-workspace access only if Graph evidence is necessary.'
            : 'Use native project tools. Resolve the reported project binding only if Workspai evidence is needed.',
      };
    }
  }
  if (grounding.status === 'unavailable') nextActions.push(grounding.nextAction);
  else if (grounding.status !== 'ready' && grounding.status !== 'insufficient-budget') {
    nextActions.push(
      'Disclose the grounding findings and continue authorized native project work. Follow grounding recovery actions only when the task needs the blocked Workspai claims.'
    );
  }
  if (graph.status === 'unavailable') nextActions.push(graph.nextAction);

  let lifecycle: ProjectLifecycleContext | ProjectLifecycleContextFailure;
  try {
    lifecycle = buildProjectLifecycleContext(projectPath, {
      ...(projectRelativePath ? { path: projectRelativePath } : {}),
      maxBytes: MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES,
    });
  } catch {
    lifecycle = {
      schemaVersion: 'workspai.project-lifecycle-context.v1',
      status: 'path-not-mapped',
      project: '.',
      selection: {
        path: projectRelativePath ?? null,
        mode: projectRelativePath ? 'closest-unit' : 'all-units',
      },
      message: 'Lifecycle planning could not be completed for the selected project path.',
      nextActions: [
        'Inspect the nearest project manifest and use its repository-authored lifecycle commands.',
      ],
    };
  }
  if ('nextActions' in lifecycle && lifecycle.status !== 'insufficient-budget') {
    nextActions.push(...lifecycle.nextActions);
  }

  const packetStatus: AgentTaskContext['status'] =
    binding === 'canonical-project-member' &&
    grounding.status === 'ready' &&
    graph.status === 'results' &&
    (lifecycle.status === 'ready' || lifecycle.status === 'no-lifecycle-units')
      ? 'ready'
      : 'partial';
  const payload: AgentTaskContext = {
    schemaVersion: AGENT_TASK_CONTEXT_SCHEMA_VERSION,
    status: packetStatus,
    task: { text: task, use: 'retrieval-query' as const, authority: 'user-request' as const },
    scope: {
      project: projectName,
      projectPath: projectRelativePathForContext,
      workspace: workspaceName,
      binding,
      workspaceResolution,
    },
    selection: {
      source: selectionSource,
      verifiedBy: resolution?.projectPath
        ? 'canonical-membership'
        : hasRootEvidence
          ? 'root-evidence'
          : 'explicit-directory',
    },
    grounding,
    graph,
    lifecycle,
    skill: buildTaskOperationalSkill(projectName, lifecycle),
    delivery: {
      status: 'prepared',
      hostLoading: 'not-observed',
      modelCompliance: 'not-observed',
    },
    execution: {
      cwdBase: 'canonical-project-root',
      sourceReadsChangeCwd: false,
      workspaceLocator:
        binding === 'canonical-project-member'
          ? {
              prefix: 'workspace:',
              base: 'canonical-workspace-root',
              resolveCommand: 'workspai project workspace status --json',
              resolveCommandCwd: '.',
              pathField: 'workspacePath',
            }
          : null,
    },
    operatingRules: [
      'This packet is read-only discovery context. It grants no file, shell, network, approval, or transaction authority.',
      'Before using this packet, compare scope.project, scope.projectPath and scope.workspace with the user-selected target. A successful command or partial status does not confirm that the requested project was selected. If they differ, retry with the verified --project; do not use this context for another project. Disclose unavailable grounding and Graph evidence in the final report.',
      'Scope is this project; use project-scoped commands unless the request or evidence requires workspace scope.',
      'workspaceResolution is authoritative: blocked is not unmanaged or consent to adopt. Resolve workspace: locators only with the declared command.',
      'Reuse Graph results/no-matches. Unavailable means missing evidence, not missing source; refresh only if needed and authorized.',
      'delivery.hostLoading/modelCompliance are not-observed; use only tools exposed by this host.',
      AGENT_JSON_CONSUMPTION_GUIDANCE,
      AGENT_CONTINUATION_GUIDANCE,
      AGENT_VERIFICATION_GUIDANCE,
      'Treat user instructions and live source as authoritative. Graph matches are lexical discovery evidence, not proof of implementation, tests, or completion.',
      'Use this packet’s project-scoped skill and lifecycle checks; do not read the workspace skill catalog for routine validation. Read repository-authored instructions and additional specialized Skills only when the task needs them. Do not scan unrelated projects or run workspace-wide readiness for a project-local task.',
      'A missing, stale, partial, or blocked Workspai view does not block native work inside the user-selected project. Disclose the limitation and continue with native evidence.',
      'Preserve the user’s requested architecture and destination. For an existing unmanaged project, offer Workspai adoption only when it adds material value; do not adopt without user authorization.',
      'Use governed Workspai transactions when required by the project’s own policy or when a change crosses workspace architecture boundaries; do not create a Goal or transaction solely to satisfy this retrieval packet.',
      'Report each requested outcome as verified, unresolved, or not applicable, and cite only checks that actually ran after the latest source change.',
    ],
    nextActions: [...new Set(nextActions)],
    budget: {
      maxBytes,
      usedBytes: 0,
      accounting: 'utf8-json-with-newline' as const,
    },
    integrity: { algorithm: 'sha256' as const, payloadHash: '0'.repeat(64) },
  };
  const context = payload;
  while (context.budget.usedBytes !== wireBytes(context)) {
    context.budget.usedBytes = wireBytes(context);
  }
  const { integrity: _integrity, ...unsigned } = context;
  context.integrity.payloadHash = sha256(JSON.stringify(unsigned));
  const limitedComponents: string[] = [];
  let extra = 0;
  for (const [name, component] of Object.entries({ grounding, graph, lifecycle })) {
    if (component.status === 'insufficient-budget' && component.budget) {
      limitedComponents.push(name);
      extra += Math.max(0, component.budget.requiredBytes - wireBytes(component));
    }
  }
  if (limitedComponents.length > 0) {
    return failureBudget(maxBytes, requiredPacketBytes(context, extra), request, limitedComponents);
  }
  if (context.budget.usedBytes > maxBytes) {
    return failureBudget(maxBytes, requiredPacketBytes(context), request);
  }
  assertJsonSchemaContract(
    context,
    'contracts/workspace-intelligence/agent-task-context.v1.json',
    'Agent task context'
  );
  return context;
}
