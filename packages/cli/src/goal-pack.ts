import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
  GOAL_INDEX_PATH,
  GOAL_INDEX_SCHEMA_VERSION,
  GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  GOAL_PACK_LAST_RUN_PATH,
  GOAL_PACK_SCHEMA_VERSION,
  GOAL_PLAN_RESULT_SCHEMA_VERSION,
  type GoalAgentHandoff,
  type GoalIndex,
  type GoalPack,
  assertGoalIndexSemantics,
} from './goals/goal-pack-contract.js';
import { buildGoalPack } from './goals/goal-pack-kernel.js';
import { compileGoalIntent, retrievalQueriesForGoal } from './goals/intent-compiler.js';
import { inspectProjectTestCoverageCapability } from './project-test-coverage.js';
import type { ProjectCoverageRuntime } from './project-test-coverage.js';
import { resolveProjectWorkspaceSync } from './project-workspace-link.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  withWorkspaceArtifactLock,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import { runWorkspaceIntelligenceChain } from './workspace-intelligence-runner.js';
import { assertWorkspaceKnowledgeGraphSourceBinding } from './workspace-knowledge-graph.js';
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';
import type { WorkspaceModel, WorkspaceModelProject } from './workspace-model.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';

const GOAL_PACK_CONTRACT_PATH = 'contracts/workspace-intelligence/goal-pack.v1.json' as const;
const GOAL_AGENT_HANDOFF_CONTRACT_PATH =
  'contracts/workspace-intelligence/goal-agent-handoff.v1.json' as const;
const GOAL_PLAN_RESULT_CONTRACT_PATH =
  'contracts/workspace-intelligence/goal-plan-result.v1.json' as const;
const GOAL_INDEX_CONTRACT_PATH = 'contracts/workspace-intelligence/goal-index.v1.json' as const;
export type PlanGoalPackOptions = {
  startPath: string;
  intent: string;
  workspacePath?: string;
  scope?: string;
  consumer?: 'generic' | 'claude' | 'codex';
  maxAttempts?: number;
  refresh?: boolean;
  dryRun?: boolean;
};

export type PlanGoalPackResult = {
  schemaVersion: typeof GOAL_PLAN_RESULT_SCHEMA_VERSION;
  result: 'planned' | 'needs-confirmation' | 'needs-evidence';
  resolution: {
    source: 'explicit' | 'parent' | 'local-link' | 'registry';
    invocationScope: 'workspace' | 'project';
  };
  goalPack: GoalPack;
  agentHandoff: GoalAgentHandoff;
  writtenArtifacts: string[];
  dryRun: boolean;
  resumed: boolean;
};

function normalizePortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function projectAbsolutePath(workspacePath: string, project: WorkspaceModelProject): string {
  return path.resolve(project.absolutePath ?? path.join(workspacePath, project.path));
}

function selectProject(input: {
  workspacePath: string;
  model: WorkspaceModel;
  requested: string;
}): WorkspaceModelProject {
  const requested = input.requested.trim().replace(/^project:/, '');
  if (!requested) throw new Error('Project goal scope must name a project.');
  const requestedAbsolute = path.isAbsolute(requested) ? path.resolve(requested) : null;
  const matches = input.model.projects.filter((project) => {
    return (
      project.name === requested ||
      normalizePortablePath(project.path) === normalizePortablePath(requested) ||
      (requestedAbsolute !== null &&
        projectAbsolutePath(input.workspacePath, project) === requestedAbsolute)
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Project goal scope was not found in the canonical model: ${requested}`
        : `Project goal scope is ambiguous in the canonical model: ${requested}`
    );
  }
  return matches[0];
}

async function readCanonicalEvidence(workspacePath: string): Promise<{
  model: WorkspaceModel;
  graph: WorkspaceKnowledgeGraph;
}> {
  const snapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
  if (snapshot.status === 'miss') {
    throw new Error(
      `Canonical model and live graph evidence are required (${snapshot.reason}). Run \`workspai workspace intelligence run --for-agent generic --strict --json\` or retry with --refresh.`
    );
  }
  const { model, graph } = snapshot;
  assertJsonSchemaContract(
    model,
    'contracts/workspace-intelligence/workspace-model.v1.json',
    'Goal source model'
  );
  assertJsonSchemaContract(
    graph,
    'contracts/workspace-intelligence/workspace-knowledge-graph.v1.json',
    'Goal source graph'
  );
  assertWorkspaceKnowledgeGraphSourceBinding(graph, model);
  return { model, graph };
}

function resolveScope(input: {
  workspacePath: string;
  invocationProjectPath: string | null;
  model: WorkspaceModel;
  explicitScope?: string;
}): GoalPack['scope'] {
  if (input.explicitScope?.trim() === 'workspace') {
    return {
      kind: 'workspace',
      projects: input.model.projects.map((project) => project.name).sort(),
      selectionSource: 'explicit',
    };
  }
  if (input.explicitScope?.trim()) {
    const project = selectProject({
      workspacePath: input.workspacePath,
      model: input.model,
      requested: input.explicitScope,
    });
    return { kind: 'project', projects: [project.name], selectionSource: 'explicit' };
  }
  if (input.invocationProjectPath) {
    const normalizedInvocationPath = path.resolve(input.invocationProjectPath);
    const matches = input.model.projects.filter(
      (project) => projectAbsolutePath(input.workspacePath, project) === normalizedInvocationPath
    );
    if (matches.length !== 1) {
      throw new Error(
        'The invocation project is not represented uniquely in the canonical workspace model. Refresh intelligence or pass --scope explicitly.'
      );
    }
    return {
      kind: 'project',
      projects: [matches[0].name],
      selectionSource: 'invocation-project',
    };
  }
  return {
    kind: 'workspace',
    projects: input.model.projects.map((project) => project.name).sort(),
    selectionSource: 'workspace',
  };
}

function graphBaselineForScope(
  graph: WorkspaceKnowledgeGraph,
  scope: GoalPack['scope']
): GoalPack['baseline']['graph'] {
  if (scope.kind === 'workspace') {
    return {
      entities: graph.quality.entityCount,
      relationships: graph.quality.relationCount,
      proofs: graph.quality.proofCount,
      unresolved: graph.quality.unknownCount,
      proofCoveragePercent: Number((graph.quality.relationProofCoverageRatio * 100).toFixed(2)),
    };
  }

  const selected = new Set(scope.projects);
  const entities = graph.entities.filter(
    (entity) => entity.projectId !== undefined && selected.has(entity.projectId)
  );
  const entityIds = new Set(entities.map((entity) => entity.id));
  const relations = graph.relations.filter(
    (relation) => entityIds.has(relation.from) || entityIds.has(relation.to)
  );
  const proofIds = new Set([
    ...entities.flatMap((entity) => entity.proofIds),
    ...relations.flatMap((relation) => relation.proofIds),
  ]);
  const provenRelationships = relations.filter((relation) => relation.proofIds.length > 0).length;
  return {
    entities: entities.length,
    relationships: relations.length,
    proofs: proofIds.size,
    unresolved: relations.length - provenRelationships,
    proofCoveragePercent:
      relations.length === 0
        ? 100
        : Number(((provenRelationships / relations.length) * 100).toFixed(2)),
  };
}

async function buildGoalPreflight(input: {
  workspacePath: string;
  projects: WorkspaceModelProject[];
  graph: WorkspaceKnowledgeGraph;
  intent: ReturnType<typeof compileGoalIntent>;
}): Promise<GoalPack['preflight']> {
  const coverageRuntimes = new Set<ProjectCoverageRuntime>([
    'node',
    'bun',
    'deno',
    'python',
    'go',
    'java',
    'dotnet',
    'rust',
    'php',
    'ruby',
    'elixir',
    'clojure',
    'scala',
    'kotlin',
    'c',
    'cpp',
    'unknown',
  ]);
  const runPath = path.join(input.workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun);
  const run = (await fsExtra.readJson(runPath).catch(() => null)) as Record<string, unknown> | null;
  const stages = Array.isArray(run?.stages) ? (run.stages as Array<Record<string, unknown>>) : [];
  const blockedStages = stages
    .filter((stage) => stage.status === 'blocked' || stage.status === 'failed')
    .map((stage) => String(stage.id ?? 'unknown'))
    .sort();
  const runStatus = run?.status;
  const workspaceIntelligence = {
    status:
      runStatus === 'passed'
        ? ('passed' as const)
        : runStatus === 'blocked' || runStatus === 'failed'
          ? ('blocked' as const)
          : ('unknown' as const),
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun,
    blockedStages,
  };

  let measurement: GoalPack['preflight']['measurement'] = {
    status: 'not-applicable',
    runtime: null,
    runner: null,
    existingEvidence: [],
    prerequisites: [],
  };
  if (input.intent.category === 'test-coverage') {
    const capabilities = await Promise.all(
      input.projects.map(async (project) => ({
        project,
        capability: await inspectProjectTestCoverageCapability(
          projectAbsolutePath(input.workspacePath, project),
          coverageRuntimes.has(project.runtime as ProjectCoverageRuntime)
            ? (project.runtime as ProjectCoverageRuntime)
            : 'unknown'
        ),
      }))
    );
    const statuses = capabilities.map((item) => item.capability.status);
    measurement = {
      status: statuses.includes('unsupported')
        ? 'unsupported'
        : statuses.includes('requires-setup')
          ? 'requires-setup'
          : 'available',
      runtime:
        capabilities.length === 1
          ? capabilities[0].capability.runtime
          : [...new Set(capabilities.map((item) => item.capability.runtime))].join(','),
      runner:
        capabilities.length === 1
          ? capabilities[0].capability.runner
          : [
              ...new Set(
                capabilities.flatMap((item) =>
                  item.capability.runner ? [item.capability.runner] : []
                )
              ),
            ].join(',') || null,
      existingEvidence: capabilities
        .flatMap((item) =>
          item.capability.existingEvidence.map((evidence) => ({
            project: item.project.name,
            ...evidence,
          }))
        )
        .filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.project === item.project &&
                candidate.path === item.path &&
                candidate.sha256 === item.sha256
            ) === index
        )
        .sort((left, right) => left.path.localeCompare(right.path)),
      prerequisites: [
        ...new Set(capabilities.flatMap((item) => item.capability.prerequisites)),
      ].sort(),
    };
  }

  const queries = retrievalQueriesForGoal(input.intent);
  const projectNames = new Set(input.projects.map((project) => project.name));
  const tokens = new Set(
    queries
      .join(' ')
      .toLocaleLowerCase('en-US')
      .split(/[^a-z0-9+#.-]+/)
      .filter((token) => token.length > 2)
  );
  const anchors = input.graph.entities
    .filter(
      (entity) =>
        (!entity.projectId || projectNames.has(entity.projectId)) &&
        (entity.kind === 'test-suite' ||
          entity.kind === 'pipeline' ||
          entity.kind === 'file' ||
          [...tokens].some((token) => entity.label.toLocaleLowerCase('en-US').includes(token)))
    )
    .sort((left, right) => {
      const leftPriority = left.kind === 'test-suite' ? 0 : left.kind === 'pipeline' ? 1 : 2;
      const rightPriority = right.kind === 'test-suite' ? 0 : right.kind === 'pipeline' ? 1 : 2;
      return leftPriority - rightPriority || left.label.localeCompare(right.label);
    })
    .slice(0, 20)
    .map((entity) => ({
      entityId: entity.id,
      kind: entity.kind,
      label: entity.label,
      proofIds: entity.proofIds.slice(0, 12),
    }));
  return {
    workspaceIntelligence,
    measurement,
    retrieval: {
      status: anchors.length >= 3 ? 'grounded' : anchors.length > 0 ? 'partial' : 'empty',
      strategy: 'deterministic-category-v1',
      queries,
      anchors,
    },
  };
}

async function readGoalIndex(workspacePath: string): Promise<GoalIndex> {
  const existing = (await fsExtra
    .readJson(path.join(workspacePath, GOAL_INDEX_PATH))
    .catch(() => null)) as GoalIndex | null;
  if (!existing) {
    return {
      schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
      generatedAt: new Date(0).toISOString(),
      activeGoalId: null,
      goals: [],
    };
  }
  assertJsonSchemaContract(existing, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
  // Planning is the explicit reconciliation boundary: upsertGoalIndex retains
  // history while demoting any formerly active entry before publication.
  return existing;
}

function upsertGoalIndex(index: GoalIndex, goal: GoalPack): GoalIndex {
  const existing = index.goals.find((entry) => entry.id === goal.id);
  const entry = {
    id: goal.id,
    fingerprint: goal.fingerprint,
    objective: goal.intent.statement,
    category: goal.intent.category,
    state: goal.state,
    lifecycle: existing?.lifecycle === 'cancelled' ? ('cancelled' as const) : ('active' as const),
    scope: goal.scope,
    createdAt: existing?.createdAt ?? goal.generatedAt,
    updatedAt: goal.generatedAt,
    goalPack: goal.artifacts.goalPack,
    agentHandoff: goal.artifacts.agentHandoff,
    ...(existing?.verifiedGoalId ? { verifiedGoalId: existing.verifiedGoalId } : {}),
    ...(existing?.repairTransactionId ? { repairTransactionId: existing.repairTransactionId } : {}),
  };
  return {
    schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
    generatedAt: goal.generatedAt,
    activeGoalId: entry.lifecycle === 'cancelled' ? index.activeGoalId : goal.id,
    goals: [
      ...index.goals
        .filter((item) => item.id !== goal.id)
        .map((item) =>
          entry.lifecycle === 'active' && item.lifecycle === 'active'
            ? { ...item, lifecycle: 'planned' as const, updatedAt: goal.generatedAt }
            : item
        ),
      entry,
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function planGoalPack(options: PlanGoalPackOptions): Promise<PlanGoalPackResult> {
  const resolution = resolveProjectWorkspaceSync({
    startPath: path.resolve(options.startPath),
    explicitWorkspacePath: options.workspacePath,
    strict: true,
    requireProjectMembership: true,
  });
  if (!resolution) throw new Error('No canonical Workspai workspace could be resolved.');
  const workspacePath = path.resolve(resolution.workspacePath);
  if (options.refresh) {
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });
  }
  const { model, graph } = await readCanonicalEvidence(workspacePath);
  const scope = resolveScope({
    workspacePath,
    invocationProjectPath: resolution.projectPath,
    model,
    explicitScope: options.scope,
  });
  const selectedProjects = model.projects.filter((project) =>
    scope.projects.includes(project.name)
  );
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 25) {
    throw new Error('--max-attempts must be an integer from 1 to 25.');
  }
  const generatedAt = new Date().toISOString();
  const modelHash = hashWorkspaceModel(model);
  const intent = compileGoalIntent(options.intent);
  const preflight = await buildGoalPreflight({
    workspacePath,
    projects: selectedProjects,
    graph,
    intent,
  });
  const kernelInput = {
    generatedAt,
    intent,
    workspaceName: model.workspace.name,
    scope,
    sourceBinding: {
      model: {
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model,
        hashAlgorithm: 'sha256',
        hashSemantics: 'workspace-model-structural-v1',
        hash: modelHash,
        generatedAt: model.generatedAt,
      },
      graph: {
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
        schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph,
        hashAlgorithm: 'sha256',
        hashSemantics: 'canonical-json-v1',
        hash: hashCanonicalJson(graph),
        generatedAt: graph.generatedAt,
        modelHash: graph.source.hash,
      },
    },
    preflight,
    baseline: {
      projectCount: selectedProjects.length,
      runtimes: [
        ...new Set(selectedProjects.flatMap((project) => project.runtimeCandidates)),
      ].sort(),
      frameworks: [...new Set(selectedProjects.map((project) => project.framework))].sort(),
      graph: graphBaselineForScope(graph, scope),
    },
    maxAttempts,
    consumer: options.consumer ?? 'generic',
  } as const;
  const kernelPorts = { digestCanonical: hashCanonicalJson };
  let { goalPack, handoff } = buildGoalPack(kernelInput, kernelPorts);
  assertJsonSchemaContract(goalPack, GOAL_PACK_CONTRACT_PATH, 'Goal Pack');
  assertJsonSchemaContract(handoff, GOAL_AGENT_HANDOFF_CONTRACT_PATH, 'Goal agent handoff');

  let resumed = false;
  const resolvePublishedInstance = async (): Promise<void> => {
    const goalAbsolutePath = path.join(workspacePath, goalPack.artifacts.goalPack);
    const handoffAbsolutePath = path.join(workspacePath, goalPack.artifacts.agentHandoff);
    const [hasGoal, hasHandoff] = await Promise.all([
      fsExtra.pathExists(goalAbsolutePath),
      fsExtra.pathExists(handoffAbsolutePath),
    ]);
    if (hasGoal !== hasHandoff) {
      throw new Error(`Goal Pack instance is incomplete and cannot be resumed: ${goalPack.id}`);
    }
    if (!hasGoal) return;

    const [persistedGoal, persistedHandoff] = await Promise.all([
      fsExtra.readJson(goalAbsolutePath) as Promise<GoalPack>,
      fsExtra.readJson(handoffAbsolutePath) as Promise<GoalAgentHandoff>,
    ]);
    assertJsonSchemaContract(persistedGoal, GOAL_PACK_CONTRACT_PATH, 'Persisted Goal Pack');
    assertJsonSchemaContract(
      persistedHandoff,
      GOAL_AGENT_HANDOFF_CONTRACT_PATH,
      'Persisted goal agent handoff'
    );
    const expected = buildGoalPack(
      { ...kernelInput, generatedAt: persistedGoal.generatedAt },
      kernelPorts
    );
    if (
      persistedGoal.id !== goalPack.id ||
      persistedHandoff.goalId !== goalPack.id ||
      hashCanonicalJson(persistedGoal) !== hashCanonicalJson(expected.goalPack) ||
      hashCanonicalJson(persistedHandoff) !== hashCanonicalJson(expected.handoff)
    ) {
      throw new Error(`Goal Pack instance failed immutable integrity validation: ${goalPack.id}`);
    }
    goalPack = persistedGoal;
    handoff = persistedHandoff;
    resumed = true;
  };

  if (options.dryRun) {
    await resolvePublishedInstance();
  } else {
    const publicationLockPath = `.workspai/goals/${goalPack.id}/publication`;
    await withWorkspaceArtifactLock(workspacePath, publicationLockPath, async () => {
      // Recheck after acquiring the per-goal lock. Concurrent planners must reuse the
      // first immutable publication instead of replacing it with a newer timestamp.
      await resolvePublishedInstance();
      const index = upsertGoalIndex(await readGoalIndex(workspacePath), goalPack);
      assertJsonSchemaContract(index, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
      assertGoalIndexSemantics(index);
      await writeWorkspaceArtifactJsonSet(
        workspacePath,
        GOAL_PACK_LAST_RUN_PATH,
        resumed
          ? [
              { relativePath: GOAL_PACK_LAST_RUN_PATH, payload: goalPack },
              { relativePath: GOAL_INDEX_PATH, payload: index },
            ]
          : [
              { relativePath: goalPack.artifacts.goalPack, payload: goalPack },
              { relativePath: goalPack.artifacts.agentHandoff, payload: handoff },
              { relativePath: GOAL_PACK_LAST_RUN_PATH, payload: goalPack },
              { relativePath: GOAL_INDEX_PATH, payload: index },
            ]
      );
    });
  }

  const artifacts = [
    goalPack.artifacts.goalPack,
    goalPack.artifacts.agentHandoff,
    GOAL_PACK_LAST_RUN_PATH,
    GOAL_INDEX_PATH,
  ];

  const result: PlanGoalPackResult = {
    schemaVersion: GOAL_PLAN_RESULT_SCHEMA_VERSION,
    result:
      goalPack.state === 'needs-confirmation'
        ? 'needs-confirmation'
        : goalPack.state === 'needs-evidence'
          ? 'needs-evidence'
          : 'planned',
    resolution: {
      source: resolution.source,
      invocationScope: resolution.projectPath ? 'project' : 'workspace',
    },
    goalPack,
    agentHandoff: handoff,
    writtenArtifacts: options.dryRun
      ? []
      : resumed
        ? [GOAL_PACK_LAST_RUN_PATH, GOAL_INDEX_PATH]
        : artifacts,
    dryRun: options.dryRun === true,
    resumed,
  };
  assertJsonSchemaContract(result, GOAL_PLAN_RESULT_CONTRACT_PATH, 'Goal plan result');
  return result;
}

export {
  GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
  GOAL_PACK_LAST_RUN_PATH,
  GOAL_INDEX_PATH,
  GOAL_INDEX_SCHEMA_VERSION,
  GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  GOAL_PACK_SCHEMA_VERSION,
  GOAL_PLAN_RESULT_SCHEMA_VERSION,
};
