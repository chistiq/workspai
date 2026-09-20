import {
  abortProofCarryingChange,
  authorizeProofCarryingChange,
  beginProofCarryingChange,
} from '../proof-carrying-change.js';
import { planGoalPack } from '../goal-pack.js';
import { transitionGoalLifecycle } from '../goal-lifecycle.js';
import { applyAgentFrameworkChange, prepareAgentFrameworkChange } from './lifecycle.js';
import { createBuiltinAgentFrameworkRegistry } from './builtins.js';
import { normalizedAgentInstanceName } from './adapter.js';
import { resolveAgentFrameworkSelection, type AgentFrameworkUserRuntime } from './selection.js';

export {
  AGENT_FRAMEWORK_USER_RUNTIMES,
  listRegisteredAgentFrameworkCombinations,
  parseAgentFrameworkRuntime,
  resolveAgentFrameworkSelection,
} from './selection.js';
export type { AgentFrameworkUserRuntime, ResolvedAgentFrameworkSelection } from './selection.js';

export type PreparedAgentFrameworkAttachment = {
  schemaVersion: 'workspai.agent-framework-attachment.v1';
  operation: 'plan';
  mode: 'scaffold' | 'attach';
  status: 'planned' | 'blocked' | 'no-op';
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
  frameworkId: string;
  adapterId: string;
  frameworkVersion: string;
  instanceName: string;
  goalId: string;
  changeId: string;
  planArtifact: string | null;
  files: Array<{ path: string; sha256: string; overwrite: string }>;
  requiredEnvironment: string[];
  permissions: string[];
  blockers: string[];
  nextActions: string[];
};

export type AppliedAgentFrameworkAttachment = Omit<
  PreparedAgentFrameworkAttachment,
  'operation' | 'status' | 'nextActions'
> & {
  operation: 'scaffold' | 'attach';
  status: 'applied';
  ownershipReceipt: string;
  nextActions: string[];
};

function releaseRegistry() {
  return createBuiltinAgentFrameworkRegistry({}, { trustReviewedReleaseAdmissions: true });
}

function requireAdmittedSelection(input: {
  runtime: AgentFrameworkUserRuntime;
  framework?: string;
}) {
  const registry = releaseRegistry();
  const selection = resolveAgentFrameworkSelection({
    registry,
    runtime: input.runtime,
    framework: input.framework,
  });
  if (!selection.admitted) {
    throw new Error(
      `Agent framework adapter ${selection.adapterId} is not release-admitted. ${selection.blockers.join(' ')}`.trim()
    );
  }
  return { registry, selection };
}

function applyCommand(input: {
  project: string;
  runtime: string;
  frameworkId: string;
  changeId: string;
}): string {
  return `workspai agent framework apply --project ${JSON.stringify(input.project)} --framework ${input.frameworkId} --runtime ${input.runtime} --change ${input.changeId}`;
}

export async function prepareAgentFrameworkAttachment(input: {
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
  instanceName: string;
  framework?: string;
  goalId?: string;
  intent?: string;
  mode?: 'scaffold' | 'attach';
}): Promise<PreparedAgentFrameworkAttachment> {
  const { registry, selection } = requireAdmittedSelection(input);
  const instanceName = normalizedAgentInstanceName(input.instanceName);

  let goalId = input.goalId;
  const ownsGoal = !goalId;
  if (!goalId) {
    const intent =
      input.intent?.trim() ||
      `Attach a governed ${selection.frameworkName} ${input.runtime} agent named ${instanceName} to ${input.project}`;
    const goal = await planGoalPack({
      startPath: input.workspacePath,
      workspacePath: input.workspacePath,
      intent,
      scope: `project:${input.project}`,
      consumer: 'generic',
    });
    if (goal.result !== 'planned' || goal.goalPack.state !== 'ready-to-plan') {
      throw new Error(
        `The attachment Goal is not ready (${goal.goalPack.state}). Resolve its bounded evidence or pass an existing ready Goal with --goal.`
      );
    }
    goalId = goal.goalPack.id;
  }

  const change = await beginProofCarryingChange({
    workspacePath: input.workspacePath,
    goalId,
    actorKind: 'cli',
    actorId: 'workspai-agent-framework',
  });
  try {
    const prepared = await prepareAgentFrameworkChange({
      workspacePath: input.workspacePath,
      project: input.project,
      changeId: change.changeId,
      registry,
      adapterId: selection.adapterId,
      instanceName,
      mode: input.mode ?? 'attach',
    });
    if (prepared.status !== 'planned') {
      await abortProofCarryingChange({
        workspacePath: input.workspacePath,
        changeId: change.changeId,
        reason: `Agent framework planning completed as ${prepared.status}; no mutation is authorized.`,
        actorId: 'workspai-agent-framework',
      });
      if (ownsGoal) {
        await transitionGoalLifecycle({
          workspacePath: input.workspacePath,
          goalId,
          action: 'cancel',
        });
      }
    }
    return {
      schemaVersion: 'workspai.agent-framework-attachment.v1',
      operation: 'plan',
      mode: input.mode ?? 'attach',
      status: prepared.status,
      workspacePath: input.workspacePath,
      project: prepared.project,
      runtime: input.runtime,
      frameworkId: selection.frameworkId,
      adapterId: selection.adapterId,
      frameworkVersion: prepared.plan.frameworkVersion,
      instanceName: prepared.plan.instanceName,
      goalId,
      changeId: prepared.changeId,
      planArtifact: prepared.planArtifact,
      files: prepared.plan.files,
      requiredEnvironment: prepared.plan.requiredEnvironment,
      permissions: prepared.plan.permissions,
      blockers: prepared.plan.blockers,
      nextActions:
        prepared.status === 'planned'
          ? [
              applyCommand({
                project: prepared.project,
                runtime: input.runtime,
                frameworkId: selection.frameworkId,
                changeId: prepared.changeId,
              }),
            ]
          : [],
    };
  } catch (error) {
    await abortProofCarryingChange({
      workspacePath: input.workspacePath,
      changeId: change.changeId,
      reason: `Agent framework planning failed: ${error instanceof Error ? error.message : String(error)}`,
      actorId: 'workspai-agent-framework',
    }).catch(() => undefined);
    if (ownsGoal && goalId) {
      await transitionGoalLifecycle({
        workspacePath: input.workspacePath,
        goalId,
        action: 'cancel',
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function applyPreparedAgentFrameworkAttachment(input: {
  prepared: PreparedAgentFrameworkAttachment;
  grantedBy: string;
}): Promise<AppliedAgentFrameworkAttachment> {
  if (input.prepared.status !== 'planned') {
    throw new Error(`Only a planned agent framework attachment can be applied.`);
  }
  const grantedBy = input.grantedBy.trim();
  if (!grantedBy) throw new Error('The authorization identity cannot be empty.');
  const registry = releaseRegistry();
  await authorizeProofCarryingChange({
    workspacePath: input.prepared.workspacePath,
    changeId: input.prepared.changeId,
    effectClasses: ['filesystem'],
    grantedBy,
    actorKind: 'human',
  });
  let applied;
  try {
    applied = await applyAgentFrameworkChange({
      workspacePath: input.prepared.workspacePath,
      project: input.prepared.project,
      changeId: input.prepared.changeId,
      registry,
      adapterId: input.prepared.adapterId,
    });
  } catch (error) {
    await abortProofCarryingChange({
      workspacePath: input.prepared.workspacePath,
      changeId: input.prepared.changeId,
      reason: `Agent framework apply failed: ${error instanceof Error ? error.message : String(error)}`,
      actorId: 'workspai-agent-framework',
    }).catch(() => undefined);
    throw error;
  }
  return {
    ...input.prepared,
    operation: input.prepared.mode,
    status: 'applied',
    files: applied.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      overwrite: 'applied',
    })),
    ownershipReceipt: applied.ownershipReceipt,
    nextActions: [
      `workspai workspace run init --workspace ${JSON.stringify(input.prepared.workspacePath)} --scope ${JSON.stringify(input.prepared.project)} --json`,
      `workspai workspace run test --workspace ${JSON.stringify(input.prepared.workspacePath)} --scope ${JSON.stringify(input.prepared.project)} --json`,
      `workspai workspace run build --workspace ${JSON.stringify(input.prepared.workspacePath)} --scope ${JSON.stringify(input.prepared.project)} --json`,
      `workspai change verify --workspace ${JSON.stringify(input.prepared.workspacePath)} --change ${input.prepared.changeId} --json`,
    ],
  };
}

export async function applyAgentFrameworkAttachmentByChange(input: {
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
  changeId: string;
  framework?: string;
}): Promise<{
  schemaVersion: 'workspai.agent-framework-attachment.v1';
  operation: 'apply';
  status: 'applied';
  project: string;
  runtime: AgentFrameworkUserRuntime;
  frameworkId: string;
  adapterId: string;
  changeId: string;
  files: Array<{ path: string; artifact: string; sha256: string }>;
  ownershipReceipt: string;
  nextActions: string[];
}> {
  const { registry, selection } = requireAdmittedSelection(input);
  const applied = await applyAgentFrameworkChange({
    workspacePath: input.workspacePath,
    project: input.project,
    changeId: input.changeId,
    registry,
    adapterId: selection.adapterId,
  });
  return {
    schemaVersion: 'workspai.agent-framework-attachment.v1',
    operation: 'apply',
    status: 'applied',
    project: applied.project,
    runtime: input.runtime,
    frameworkId: selection.frameworkId,
    adapterId: selection.adapterId,
    changeId: applied.changeId,
    files: applied.files,
    ownershipReceipt: applied.ownershipReceipt,
    nextActions: [
      `workspai workspace run init --workspace ${JSON.stringify(input.workspacePath)} --scope ${JSON.stringify(applied.project)} --json`,
      `workspai workspace run test --workspace ${JSON.stringify(input.workspacePath)} --scope ${JSON.stringify(applied.project)} --json`,
      `workspai workspace run build --workspace ${JSON.stringify(input.workspacePath)} --scope ${JSON.stringify(applied.project)} --json`,
      `workspai change verify --workspace ${JSON.stringify(input.workspacePath)} --change ${input.changeId} --json`,
    ],
  };
}
