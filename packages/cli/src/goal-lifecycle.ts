import { createHash } from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  GOAL_INDEX_PATH,
  GOAL_INDEX_SCHEMA_VERSION,
  GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  type GoalIndex,
  type GoalIndexEntry,
  type GoalAgentHandoff,
  type GoalLifecycleResult,
  type GoalPack,
  assertGoalIndexSemantics,
} from './goals/goal-pack-contract.js';
import { buildGoalPack } from './goals/goal-pack-kernel.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  withWorkspaceArtifactLock,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';

const GOAL_INDEX_CONTRACT_PATH = 'contracts/workspace-intelligence/goal-index.v1.json';
const GOAL_LIFECYCLE_RESULT_CONTRACT_PATH =
  'contracts/workspace-intelligence/goal-lifecycle-result.v1.json';

export function buildGoalLifecycleResult(input: Omit<GoalLifecycleResult, 'schemaVersion'>) {
  const result: GoalLifecycleResult = {
    schemaVersion: GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
    ...input,
  };
  assertJsonSchemaContract(result, GOAL_LIFECYCLE_RESULT_CONTRACT_PATH, 'Goal lifecycle result');
  return result;
}

async function readIndex(workspacePath: string): Promise<GoalIndex> {
  const indexPath = path.join(workspacePath, GOAL_INDEX_PATH);
  if (!(await fsExtra.pathExists(indexPath))) {
    return {
      schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
      generatedAt: new Date(0).toISOString(),
      activeGoalId: null,
      goals: [],
    };
  }
  const index = (await fsExtra.readJson(indexPath)) as GoalIndex;
  assertJsonSchemaContract(index, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
  assertGoalIndexSemantics(index);
  return index;
}

async function assertGoalBindings(workspacePath: string, entry: GoalIndexEntry): Promise<GoalPack> {
  const [goal, handoff] = (await Promise.all([
    fsExtra.readJson(path.join(workspacePath, entry.goalPack)),
    fsExtra.readJson(path.join(workspacePath, entry.agentHandoff)),
  ])) as [GoalPack, GoalAgentHandoff];
  assertJsonSchemaContract(
    goal,
    'contracts/workspace-intelligence/goal-pack.v1.json',
    'Indexed Goal Pack'
  );
  if (goal.id !== entry.id || goal.fingerprint !== entry.fingerprint) {
    throw new Error(`Goal index binding failed for ${entry.id}.`);
  }
  assertJsonSchemaContract(
    handoff,
    'contracts/workspace-intelligence/goal-agent-handoff.v1.json',
    'Indexed Goal agent handoff'
  );
  const evidenceByRole = new Map(handoff.evidence.map((evidence) => [evidence.role, evidence]));
  const rebuilt = buildGoalPack(
    {
      generatedAt: goal.generatedAt,
      intent: goal.intent,
      workspaceName: goal.workspace.name,
      scope: goal.scope,
      sourceBinding: goal.sourceBinding,
      baseline: goal.baseline,
      preflight: goal.preflight,
      maxAttempts: goal.policy.maxAttempts,
      consumer: handoff.consumer,
    },
    { digestCanonical: hashCanonicalJson }
  );
  if (
    handoff.goalId !== goal.id ||
    handoff.goalFingerprint !== goal.fingerprint ||
    evidenceByRole.get('goal')?.binding.value !== hashCanonicalJson(goal) ||
    evidenceByRole.get('model')?.binding.value !== goal.sourceBinding.model.hash ||
    evidenceByRole.get('graph')?.binding.value !== goal.sourceBinding.graph.hash ||
    hashCanonicalJson(handoff) !== hashCanonicalJson(rebuilt.handoff)
  ) {
    throw new Error(`Goal agent handoff integrity validation failed for ${entry.id}.`);
  }
  const snapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
  if (snapshot.status === 'miss') {
    throw new Error(
      `Goal ${entry.id} is stale because live workspace inputs changed (${snapshot.reason}). Regenerate it with --refresh.`
    );
  }
  const { model, graph } = snapshot;
  const currentModelHash = hashWorkspaceModel(model);
  const currentGraphHash = hashCanonicalJson(graph);
  const currentGraphInputHash = graph.source.inputs?.hash;
  const originalBindingMatches =
    currentModelHash === goal.sourceBinding.model.hash &&
    (goal.sourceBinding.graph.inputHash
      ? currentGraphInputHash === goal.sourceBinding.graph.inputHash
      : currentGraphHash === goal.sourceBinding.graph.hash);
  if (!originalBindingMatches) {
    const transactionIds =
      entry.repairTransactionIds ?? (entry.repairTransactionId ? [entry.repairTransactionId] : []);
    const { assertClosedGoalRepairTransactionCurrent } =
      await import('./workspace-repair-engine.js');
    let sanctioned = false;
    for (const transactionId of [...transactionIds].reverse()) {
      const binding = await assertClosedGoalRepairTransactionCurrent({
        workspacePath,
        transactionId,
        goalId: entry.id,
      }).catch(() => undefined);
      if (
        binding?.modelHash === currentModelHash &&
        binding.graphInputHash === currentGraphInputHash
      ) {
        sanctioned = true;
        break;
      }
    }
    if (!sanctioned) {
      throw new Error(
        `Goal ${entry.id} is stale because its canonical model or graph binding changed outside a closed Goal repair transaction. Regenerate it with --refresh.`
      );
    }
  }
  if (graph.source.hash !== currentModelHash) {
    throw new Error(
      `Goal ${entry.id} is stale because its current Model and Graph source bindings disagree. Regenerate it with --refresh.`
    );
  }
  const modelRecord = model as {
    projects?: Array<{ name?: string; path?: string; absolutePath?: string }>;
  };
  for (const evidence of goal.preflight.measurement.existingEvidence) {
    const project = modelRecord.projects?.find((item) => item.name === evidence.project);
    if (!project)
      throw new Error(`Goal measurement project binding is missing: ${evidence.project}`);
    const projectRoot = path.resolve(
      project.absolutePath ?? path.join(workspacePath, project.path ?? evidence.project)
    );
    const evidencePath = path.resolve(projectRoot, evidence.path);
    if (evidencePath !== projectRoot && !evidencePath.startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Goal measurement evidence escapes its project boundary: ${evidence.path}`);
    }
    const content = await fsExtra.readFile(evidencePath).catch(() => null);
    if (!content || createHash('sha256').update(content).digest('hex') !== evidence.sha256) {
      throw new Error(
        `Goal ${entry.id} is stale because measurement evidence changed: ${evidence.project}/${evidence.path}`
      );
    }
  }
  return goal;
}

export async function inspectGoalLifecycle(input: {
  workspacePath: string;
  goalId?: string;
  validateBindings?: boolean;
}): Promise<{ index: GoalIndex; active: GoalIndexEntry | null; goalPack: GoalPack | null }> {
  const workspacePath = path.resolve(input.workspacePath);
  const index = await readIndex(workspacePath);
  const id = input.goalId ?? index.activeGoalId;
  const active = id ? (index.goals.find((entry) => entry.id === id) ?? null) : null;
  if (id && !active) throw new Error(`Goal is not registered in this workspace: ${id}`);
  const goalPack =
    active && input.validateBindings !== false
      ? await assertGoalBindings(workspacePath, active)
      : null;
  return { index, active, goalPack };
}

export async function transitionGoalLifecycle(input: {
  workspacePath: string;
  goalId: string;
  action: 'activate' | 'cancel';
}): Promise<{ index: GoalIndex; goal: GoalIndexEntry }> {
  const workspacePath = path.resolve(input.workspacePath);
  return withWorkspaceArtifactLock(workspacePath, '.workspai/goals/index-lifecycle', async () => {
    const current = await readIndex(workspacePath);
    const existing = current.goals.find((entry) => entry.id === input.goalId);
    if (!existing) throw new Error(`Goal is not registered in this workspace: ${input.goalId}`);
    if (input.action === 'activate') await assertGoalBindings(workspacePath, existing);
    const now = new Date().toISOString();
    const updated: GoalIndexEntry = {
      ...existing,
      lifecycle: input.action === 'activate' ? 'active' : 'cancelled',
      updatedAt: now,
    };
    const index: GoalIndex = {
      ...current,
      generatedAt: now,
      activeGoalId:
        input.action === 'activate'
          ? input.goalId
          : current.activeGoalId === input.goalId
            ? null
            : current.activeGoalId,
      goals: current.goals.map((entry) => {
        if (entry.id === input.goalId) return updated;
        if (input.action === 'activate' && entry.lifecycle === 'active') {
          return { ...entry, lifecycle: 'planned' as const, updatedAt: now };
        }
        return entry;
      }),
    };
    assertJsonSchemaContract(index, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
    assertGoalIndexSemantics(index);
    await writeWorkspaceArtifactJsonSet(workspacePath, GOAL_INDEX_PATH, [
      { relativePath: GOAL_INDEX_PATH, payload: index },
    ]);
    return { index, goal: updated };
  });
}

async function updateLifecycleLink(input: {
  workspacePath: string;
  goalId: string;
  lifecycle: GoalIndexEntry['lifecycle'];
  verifiedGoalId?: string;
}): Promise<GoalIndexEntry> {
  return withWorkspaceArtifactLock(
    input.workspacePath,
    '.workspai/goals/index-lifecycle',
    async () => {
      const current = await readIndex(input.workspacePath);
      const existing = current.goals.find((entry) => entry.id === input.goalId);
      if (!existing) throw new Error(`Goal is not registered in this workspace: ${input.goalId}`);
      const updated: GoalIndexEntry = {
        ...existing,
        lifecycle: input.lifecycle,
        updatedAt: new Date().toISOString(),
        ...(input.verifiedGoalId ? { verifiedGoalId: input.verifiedGoalId } : {}),
      };
      const index: GoalIndex = {
        ...current,
        generatedAt: updated.updatedAt,
        activeGoalId: input.lifecycle === 'verified' ? null : input.goalId,
        goals: current.goals.map((entry) => (entry.id === input.goalId ? updated : entry)),
      };
      assertJsonSchemaContract(index, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
      assertGoalIndexSemantics(index);
      await writeWorkspaceArtifactJsonSet(input.workspacePath, GOAL_INDEX_PATH, [
        { relativePath: GOAL_INDEX_PATH, payload: index },
      ]);
      return updated;
    }
  );
}

export async function prepareGoalVerification(input: {
  workspacePath: string;
  goalId?: string;
}): Promise<{ goal: GoalIndexEntry; verifiedGoalId: string; state: string }> {
  const inspected = await inspectGoalLifecycle(input);
  if (!inspected.active || !inspected.goalPack)
    throw new Error('No active Goal Pack is available.');
  if (inspected.index.activeGoalId !== inspected.active.id) {
    throw new Error(
      `Goal ${inspected.active.id} is not active. Activate it before preparing verification.`
    );
  }
  const pack = inspected.goalPack;
  if (!pack.commands.planVerifiedGoal) {
    throw new Error(
      `Goal ${pack.id} has no deterministic verification primitive. An agent proposal and explicit review are required first.`
    );
  }
  if (pack.state !== 'ready-to-plan') {
    throw new Error(`Goal ${pack.id} cannot enter verification while its state is ${pack.state}.`);
  }
  const { planVerifiedGoal } = await import('./verified-goal.js');
  const scope =
    pack.scope.kind === 'project' && pack.scope.projects[0]
      ? `project:${pack.scope.projects[0]}`
      : undefined;
  const kind = pack.intent.category;
  if (kind !== 'release-readiness' && kind !== 'dependency-security' && kind !== 'test-coverage') {
    throw new Error(`Goal category ${kind} does not have a deterministic verification adapter.`);
  }
  const planned = await planVerifiedGoal({
    workspacePath: input.workspacePath,
    kind,
    scope,
    target: pack.intent.requestedTarget?.value,
  });
  const goal = await updateLifecycleLink({
    workspacePath: input.workspacePath,
    goalId: pack.id,
    lifecycle: 'verification-ready',
    verifiedGoalId: planned.goal.id,
  });
  return { goal, verifiedGoalId: planned.goal.id, state: planned.status.state };
}

export async function verifyGoalLifecycle(input: {
  workspacePath: string;
  goalId?: string;
  run?: boolean;
}): Promise<{ goal: GoalIndexEntry; verifiedGoalId: string; verification: unknown }> {
  const workspacePath = path.resolve(input.workspacePath);
  const selected = await inspectGoalLifecycle({
    workspacePath,
    goalId: input.goalId,
    validateBindings: false,
  });
  if (!selected.active) throw new Error('No active Goal Pack is available.');
  const selectedGoalId = selected.active.id;
  return withWorkspaceArtifactLock(
    workspacePath,
    `.workspai/goals/${selectedGoalId}/verification`,
    () =>
      verifyGoalLifecycleLocked({
        workspacePath,
        goalId: selectedGoalId,
        run: input.run,
      })
  );
}

async function verifyGoalLifecycleLocked(input: {
  workspacePath: string;
  goalId: string;
  run?: boolean;
}): Promise<{ goal: GoalIndexEntry; verifiedGoalId: string; verification: unknown }> {
  const inspected = await inspectGoalLifecycle(input);
  if (!inspected.active) throw new Error('No active Goal Pack is available.');
  if (inspected.index.activeGoalId !== inspected.active.id) {
    throw new Error(
      `Goal ${inspected.active.id} is not active. Activate it before running verification.`
    );
  }
  if (!inspected.active.verifiedGoalId) {
    throw new Error(
      `Goal ${inspected.active.id} has no linked verification contract. Run workspai goal --prepare ${inspected.active.id} --json first.`
    );
  }
  if (!inspected.goalPack) {
    throw new Error(`Goal ${inspected.active.id} has no validated immutable Goal Pack.`);
  }
  const { readVerifiedGoal, verifyVerifiedGoal } = await import('./verified-goal.js');
  const current = await readVerifiedGoal(input.workspacePath, inspected.active.verifiedGoalId);
  if (current.status.attempt >= inspected.goalPack.policy.maxAttempts) {
    throw new Error(
      `Goal ${inspected.active.id} exhausted its verification budget (${inspected.goalPack.policy.maxAttempts}). Review the latest evidence before creating or activating another Goal Pack.`
    );
  }
  const verification = await verifyVerifiedGoal({
    workspacePath: input.workspacePath,
    goalId: inspected.active.verifiedGoalId,
    run: input.run !== false,
  });
  const state = (verification as { state?: string }).state;
  const goal = await updateLifecycleLink({
    workspacePath: input.workspacePath,
    goalId: inspected.active.id,
    lifecycle:
      state === 'verified' ? 'verified' : state === 'failed' ? 'failed' : 'verification-ready',
    verifiedGoalId: inspected.active.verifiedGoalId,
  });
  return { goal, verifiedGoalId: inspected.active.verifiedGoalId, verification };
}

export async function linkGoalRepairTransaction(input: {
  workspacePath: string;
  goalId: string;
  transactionId: string;
}): Promise<GoalIndexEntry> {
  const inspected = await inspectGoalLifecycle({
    workspacePath: input.workspacePath,
    goalId: input.goalId,
  });
  if (!inspected.active || inspected.index.activeGoalId !== input.goalId) {
    throw new Error(`Repair proposal goal is not the active workspace goal: ${input.goalId}`);
  }
  if (!inspected.goalPack) {
    throw new Error(`Repair proposal Goal Pack is unavailable: ${input.goalId}`);
  }
  const maxAttempts = inspected.goalPack.policy.maxAttempts;
  return withWorkspaceArtifactLock(
    input.workspacePath,
    '.workspai/goals/index-lifecycle',
    async () => {
      const current = await readIndex(input.workspacePath);
      const existing = current.goals.find((entry) => entry.id === input.goalId);
      if (!existing) throw new Error(`Goal is not registered in this workspace: ${input.goalId}`);
      const repairTransactionIds =
        existing.repairTransactionIds ??
        (existing.repairTransactionId ? [existing.repairTransactionId] : []);
      if (
        !repairTransactionIds.includes(input.transactionId) &&
        repairTransactionIds.length >= maxAttempts
      ) {
        throw new Error(
          `Goal ${input.goalId} exhausted its repair proposal budget (${maxAttempts}). Review the latest evidence before creating another Goal Pack.`
        );
      }
      const nextRepairTransactionIds = repairTransactionIds.includes(input.transactionId)
        ? repairTransactionIds
        : [...repairTransactionIds, input.transactionId];
      const updated: GoalIndexEntry = {
        ...existing,
        repairTransactionId: input.transactionId,
        repairTransactionIds: nextRepairTransactionIds,
        updatedAt: new Date().toISOString(),
      };
      const index: GoalIndex = {
        ...current,
        generatedAt: updated.updatedAt,
        goals: current.goals.map((entry) => (entry.id === input.goalId ? updated : entry)),
      };
      assertJsonSchemaContract(index, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
      assertGoalIndexSemantics(index);
      await writeWorkspaceArtifactJsonSet(input.workspacePath, GOAL_INDEX_PATH, [
        { relativePath: GOAL_INDEX_PATH, payload: index },
      ]);
      return updated;
    }
  );
}

export { GOAL_INDEX_PATH, GOAL_INDEX_SCHEMA_VERSION };
