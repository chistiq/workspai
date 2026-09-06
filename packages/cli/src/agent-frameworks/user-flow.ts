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

export const AGENT_FRAMEWORK_USER_RUNTIMES = ['python', 'dotnet'] as const;
export type AgentFrameworkUserRuntime = (typeof AGENT_FRAMEWORK_USER_RUNTIMES)[number];

export type PreparedAgentFrameworkAttachment = {
  schemaVersion: 'workspai.agent-framework-attachment.v1';
  operation: 'plan';
  mode: 'scaffold' | 'attach';
  status: 'planned' | 'blocked' | 'no-op';
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
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

function adapterIdFor(runtime: AgentFrameworkUserRuntime): string {
  return `microsoft-agent-framework-${runtime}`;
}

export function parseAgentFrameworkRuntime(value: string): AgentFrameworkUserRuntime {
  const normalized = value.trim().toLowerCase();
  if (!AGENT_FRAMEWORK_USER_RUNTIMES.includes(normalized as AgentFrameworkUserRuntime)) {
    throw new Error(`Unsupported agent framework runtime: ${value}. Choose python or dotnet.`);
  }
  return normalized as AgentFrameworkUserRuntime;
}

export async function prepareAgentFrameworkAttachment(input: {
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
  instanceName: string;
  goalId?: string;
  intent?: string;
  mode?: 'scaffold' | 'attach';
}): Promise<PreparedAgentFrameworkAttachment> {
  const registry = createBuiltinAgentFrameworkRegistry(
    {},
    { trustReviewedReleaseAdmissions: true }
  );
  const adapterId = adapterIdFor(input.runtime);
  const instanceName = normalizedAgentInstanceName(input.instanceName);
  const admission = registry.resolveAdapter(adapterId);
  if (admission.status !== 'admitted' || !admission.entry) {
    throw new Error(
      `Agent framework adapter ${adapterId} is not release-admitted. ${admission.blockers.join(' ')}`
    );
  }

  let goalId = input.goalId;
  const ownsGoal = !goalId;
  if (!goalId) {
    const intent =
      input.intent?.trim() ||
      `Attach a governed Microsoft Agent Framework ${input.runtime} agent named ${instanceName} to ${input.project}`;
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
      adapterId,
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
      adapterId,
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
              `workspai agent framework apply --project ${JSON.stringify(prepared.project)} --runtime ${input.runtime} --change ${prepared.changeId}`,
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
  const registry = createBuiltinAgentFrameworkRegistry(
    {},
    { trustReviewedReleaseAdmissions: true }
  );
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
      `workspai workspace intelligence run --workspace ${JSON.stringify(input.prepared.workspacePath)} --for-agent generic --strict --json`,
      `workspai change verify --workspace ${JSON.stringify(input.prepared.workspacePath)} --change ${input.prepared.changeId} --json`,
    ],
  };
}

export async function applyAgentFrameworkAttachmentByChange(input: {
  workspacePath: string;
  project: string;
  runtime: AgentFrameworkUserRuntime;
  changeId: string;
}): Promise<{
  schemaVersion: 'workspai.agent-framework-attachment.v1';
  operation: 'apply';
  status: 'applied';
  project: string;
  runtime: AgentFrameworkUserRuntime;
  adapterId: string;
  changeId: string;
  files: Array<{ path: string; artifact: string; sha256: string }>;
  ownershipReceipt: string;
  nextActions: string[];
}> {
  const registry = createBuiltinAgentFrameworkRegistry(
    {},
    { trustReviewedReleaseAdmissions: true }
  );
  const adapterId = adapterIdFor(input.runtime);
  const applied = await applyAgentFrameworkChange({
    workspacePath: input.workspacePath,
    project: input.project,
    changeId: input.changeId,
    registry,
    adapterId,
  });
  return {
    schemaVersion: 'workspai.agent-framework-attachment.v1',
    operation: 'apply',
    status: 'applied',
    project: applied.project,
    runtime: input.runtime,
    adapterId,
    changeId: applied.changeId,
    files: applied.files,
    ownershipReceipt: applied.ownershipReceipt,
    nextActions: [
      `workspai workspace intelligence run --workspace ${JSON.stringify(input.workspacePath)} --for-agent generic --strict --json`,
      `workspai change verify --workspace ${JSON.stringify(input.workspacePath)} --change ${input.changeId} --json`,
    ],
  };
}
