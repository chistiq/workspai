import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
import { resolveProjectWorkspaceSync } from './project-workspace-link.js';
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

export type AgentTaskContext = {
  schemaVersion: typeof AGENT_TASK_CONTEXT_SCHEMA_VERSION;
  status: 'ready' | 'partial';
  task: { text: string; use: 'retrieval-query'; authority: 'user-request' };
  scope: {
    project: string;
    projectPath: string;
    workspace: string | null;
    binding: 'canonical-project-member' | 'not-workspai-managed';
  };
  grounding: AgentBootstrapView | AgentBootstrapBudgetFailure | ContextUnavailable;
  graph: WorkspaceGraphSearchView | WorkspaceGraphSearchBudgetFailure | ContextUnavailable;
  lifecycle: ProjectLifecycleContext | ProjectLifecycleContextFailure;
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

function failureBudget(
  maxBytes: number,
  requiredBytes: number,
  componentLimited = false
): AgentTaskContextBudgetFailure {
  const canIncrease = !componentLimited && requiredBytes <= MAX_AGENT_TASK_CONTEXT_MAX_BYTES;
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
        ? `Retry agent context with --max-bytes ${requiredBytes}, or narrow --limit/--path.`
        : 'Narrow --limit, select the closest package with --path, or use targeted native evidence. Increasing the packet budget alone cannot satisfy this request.',
    ],
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
  task: string;
  forAgent?: string;
  path?: string;
  limit?: number;
  maxBytes?: string | number;
}): Promise<AgentTaskContext | AgentTaskContextBudgetFailure> {
  const selectedProjectPath = path.resolve(input.projectPath);
  const task = input.task.trim();
  if (!task) throw new Error('--task must contain a non-empty request.');
  if (Buffer.byteLength(task, 'utf8') > MAX_TASK_BYTES) {
    throw new Error(`--task must not exceed ${MAX_TASK_BYTES} UTF-8 bytes.`);
  }
  if (task.includes('\u0000')) throw new Error('--task must not contain NUL characters.');
  const limit = input.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) {
    throw new Error('--limit must be an integer between 1 and 12.');
  }
  const maxBytes = agentTaskContextByteBudget(input.maxBytes);

  let grounding: AgentTaskContext['grounding'];
  let graph: AgentTaskContext['graph'];
  let projectName = path.basename(selectedProjectPath);
  let projectRelativePathForContext = '.';
  let workspaceName: string | null = null;
  let binding: AgentTaskContext['scope']['binding'] = 'not-workspai-managed';
  const nextActions: string[] = [];

  let resolution: ReturnType<typeof resolveProjectWorkspaceSync> = null;
  try {
    resolution = resolveProjectWorkspaceSync({
      startPath: selectedProjectPath,
      strict: true,
      requireProjectMembership: true,
    });
  } catch {
    // An unregistered or ambiguous target can still use native lifecycle guidance.
  }
  const projectPath = resolution?.projectPath ?? selectedProjectPath;
  const projectRelativePath = pathInsideProject(projectPath, input.path);
  if (!resolution?.projectPath) {
    grounding = {
      status: 'unavailable',
      reason: 'No canonical Workspai project membership was resolved for this directory.',
      nextAction:
        'Continue with the repository instructions, source and native checks. Workspai adoption is optional and requires the user’s choice.',
    };
    graph = {
      status: 'unavailable',
      reason: 'A project-scoped Workspai graph is unavailable without canonical membership.',
      nextAction:
        'Use native source search and project manifests; request adoption only when it would materially help and the user has not declined.',
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
            'Continue with targeted native source and test search. Refresh Workspai intelligence only if a graph claim is needed.',
        };
      }
    } catch {
      grounding = {
        status: 'unavailable',
        reason: 'Canonical project grounding could not be validated.',
        nextAction:
          'Keep the request scoped to the selected project and use native project instructions, source search and checks.',
      };
      graph = {
        status: 'unavailable',
        reason: 'Project grounding could not be validated, so project Graph results were withheld.',
        nextAction:
          'Use native project tools. Resolve the reported project binding only if Workspai evidence is needed.',
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
    },
    grounding,
    graph,
    lifecycle,
    operatingRules: [
      'This packet is read-only discovery context. It grants no file, shell, network, approval, or transaction authority.',
      AGENT_JSON_CONSUMPTION_GUIDANCE,
      AGENT_CONTINUATION_GUIDANCE,
      AGENT_VERIFICATION_GUIDANCE,
      'Treat user instructions and live source as authoritative. Graph matches are lexical discovery evidence, not proof of implementation, tests, or completion.',
      'Use only the closest relevant instructions, one applicable Skill, cited source files, and lifecycle checks. Do not scan unrelated projects or run workspace-wide readiness for a project-local task.',
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
  let componentLimited = false;
  let extra = 0;
  for (const component of [grounding, graph, lifecycle]) {
    if (component.status === 'insufficient-budget' && component.budget) {
      componentLimited = true;
      extra += Math.max(0, component.budget.requiredBytes - wireBytes(component));
    }
  }
  if (componentLimited) {
    return failureBudget(maxBytes, requiredPacketBytes(context, extra), true);
  }
  if (context.budget.usedBytes > maxBytes) {
    return failureBudget(maxBytes, requiredPacketBytes(context));
  }
  assertJsonSchemaContract(
    context,
    'contracts/workspace-intelligence/agent-task-context.v1.json',
    'Agent task context'
  );
  return context;
}
