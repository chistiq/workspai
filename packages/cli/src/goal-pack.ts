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
  reconcileLegacyNonActionableGoalSelection,
} from './goals/goal-pack-contract.js';
import { buildGoalPack } from './goals/goal-pack-kernel.js';
import { compileGoalIntent, retrievalQueriesForGoal } from './goals/intent-compiler.js';
import { inspectProjectTestCoverageCapability } from './project-test-coverage.js';
import type { ProjectCoverageRuntime } from './project-test-coverage.js';
import { searchKnowledgeGraph } from './workspace-knowledge-graph-query.js';
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
const GOAL_COVERAGE_RUNTIMES = new Set<Exclude<ProjectCoverageRuntime, 'unknown'>>([
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
]);
export type PlanGoalPackOptions = {
  startPath: string;
  intent: string;
  workspacePath?: string;
  scope?: string;
  runtime?: Exclude<ProjectCoverageRuntime, 'unknown'>;
  consumer?: 'generic' | 'claude' | 'codex';
  maxAttempts?: number;
  refresh?: boolean;
  dryRun?: boolean;
  selectScope?: (input: GoalScopeSelectionRequest) => Promise<GoalScopeSelection>;
  selectCoverageRuntime?: (
    input: GoalCoverageRuntimeSelectionRequest
  ) => Promise<Exclude<ProjectCoverageRuntime, 'unknown'>>;
};

export type GoalScopeSelectionRequest = {
  workspaceName: string;
  projects: Array<{
    name: string;
    runtime: string;
    runtimeCandidates: string[];
    framework: string;
  }>;
};

export type GoalScopeSelection = { kind: 'workspace' } | { kind: 'projects'; projects: string[] };

export type GoalCoverageRuntimeSelectionRequest = {
  workspaceName: string;
  scope: GoalPack['scope'];
  projects: Array<{ name: string; runtime: string; runtimeCandidates: string[] }>;
  runtimes: Array<Exclude<ProjectCoverageRuntime, 'unknown'>>;
};

export type PlanGoalPackResult = {
  schemaVersion: typeof GOAL_PLAN_RESULT_SCHEMA_VERSION;
  result: 'planned' | 'needs-confirmation' | 'needs-evidence' | 'blocked';
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

function parseExplicitScope(input: {
  workspacePath: string;
  model: WorkspaceModel;
  scope: string;
  selectionSource: 'explicit' | 'interactive';
}): GoalPack['scope'] {
  const normalized = input.scope.trim();
  if (normalized === 'workspace') {
    return {
      kind: 'workspace',
      projects: input.model.projects.map((project) => project.name).sort(),
      selectionSource: input.selectionSource,
      resolution: 'selected',
    };
  }
  const projectSetPrefix = normalized.startsWith('projects:')
    ? 'projects:'
    : normalized.startsWith('project:') && normalized.slice('project:'.length).includes(',')
      ? 'project:'
      : null;
  if (projectSetPrefix) {
    const requestedProjects = normalized
      .slice(projectSetPrefix.length)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (requestedProjects.length < 2) {
      throw new Error('A project-set Goal scope must name at least two projects.');
    }
    const selected = requestedProjects.map((requested) =>
      selectProject({ workspacePath: input.workspacePath, model: input.model, requested })
    );
    const names = [...new Set(selected.map((project) => project.name))].sort();
    if (names.length !== requestedProjects.length) {
      throw new Error('A project-set Goal scope must not contain duplicate projects.');
    }
    return {
      kind: 'project-set',
      projects: names,
      selectionSource: input.selectionSource,
      resolution: 'selected',
    };
  }
  if (normalized) {
    const project = selectProject({
      workspacePath: input.workspacePath,
      model: input.model,
      requested: normalized,
    });
    return {
      kind: 'project',
      projects: [project.name],
      selectionSource: input.selectionSource,
      resolution: 'selected',
    };
  }
  throw new Error('Goal scope cannot be empty.');
}

async function resolveScope(input: {
  workspacePath: string;
  invocationProjectPath: string | null;
  model: WorkspaceModel;
  explicitScope?: string;
  selectScope?: PlanGoalPackOptions['selectScope'];
}): Promise<{ scope: GoalPack['scope']; selectionRequired: boolean }> {
  if (input.explicitScope?.trim()) {
    return {
      scope: parseExplicitScope({
        workspacePath: input.workspacePath,
        model: input.model,
        scope: input.explicitScope,
        selectionSource: 'explicit',
      }),
      selectionRequired: false,
    };
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
      scope: {
        kind: 'project',
        projects: [matches[0].name],
        selectionSource: 'invocation-project',
        resolution: 'selected',
      },
      selectionRequired: false,
    };
  }
  if (input.model.projects.length === 1) {
    return {
      scope: {
        kind: 'project',
        projects: [input.model.projects[0].name],
        selectionSource: 'single-project-workspace',
        resolution: 'selected',
      },
      selectionRequired: false,
    };
  }
  if (input.selectScope) {
    const selection = await input.selectScope({
      workspaceName: input.model.workspace.name,
      projects: input.model.projects
        .map((project) => ({
          name: project.name,
          runtime: project.runtime,
          runtimeCandidates: [...project.runtimeCandidates].sort(),
          framework: project.framework,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
    const scope =
      selection.kind === 'workspace'
        ? 'workspace'
        : selection.projects.length === 1
          ? `project:${selection.projects[0]}`
          : `projects:${selection.projects.join(',')}`;
    return {
      scope: parseExplicitScope({
        workspacePath: input.workspacePath,
        model: input.model,
        scope,
        selectionSource: 'interactive',
      }),
      selectionRequired: false,
    };
  }
  return {
    scope: {
      kind: 'workspace',
      projects: input.model.projects.map((project) => project.name).sort(),
      selectionSource: 'workspace',
      resolution: 'selection-required',
    },
    selectionRequired: true,
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
  coverageRuntimeChoices: Array<Exclude<ProjectCoverageRuntime, 'unknown'>>;
}): Promise<GoalPack['preflight']> {
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
    runtimeChoices: [],
    runner: null,
    existingEvidence: [],
    prerequisites: [],
  };
  if (input.intent.category === 'test-coverage') {
    const requestedRuntime = input.intent.requestedTarget?.runtime;
    const runtimeAmbiguity = input.intent.ambiguities.some(
      (entry) =>
        entry.startsWith('Coverage scope is ambiguous') ||
        entry.startsWith('The Goal names multiple coverage runtimes') ||
        entry.startsWith(
          'The selected projects do not share a common canonical coverage runtime'
        ) ||
        entry.startsWith('The requested ')
    );
    if (runtimeAmbiguity) {
      measurement = {
        status: 'requires-setup',
        runtime: requestedRuntime ?? null,
        runtimeChoices: input.coverageRuntimeChoices,
        runner: null,
        existingEvidence: [],
        prerequisites: ['Select exactly one detected runtime or language for this coverage Goal.'],
      };
    } else {
      const projects = requestedRuntime
        ? input.projects.filter((project) => project.runtimeCandidates.includes(requestedRuntime))
        : input.projects;
      const capabilities = await Promise.all(
        projects.map(async (project) => ({
          project,
          capability: await inspectProjectTestCoverageCapability(
            projectAbsolutePath(input.workspacePath, project),
            requestedRuntime ??
              (GOAL_COVERAGE_RUNTIMES.has(
                project.runtime as Exclude<ProjectCoverageRuntime, 'unknown'>
              )
                ? (project.runtime as ProjectCoverageRuntime)
                : 'unknown')
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
        runtimeChoices: input.coverageRuntimeChoices,
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
          .sort(
            (left, right) =>
              left.project.localeCompare(right.project) || left.path.localeCompare(right.path)
          ),
        prerequisites: [
          ...new Set(capabilities.flatMap((item) => item.capability.prerequisites)),
        ].sort(),
      };
    }
  }

  const queries = retrievalQueriesForGoal(input.intent);
  const queryMatches = queries.map((query) => {
    const perProject = input.projects.map(
      (project) =>
        searchKnowledgeGraph(input.graph, {
          query,
          projectId: project.name,
          limit: 20,
          relationsPerEntity: 0,
          minimumTermMatches: 2,
        }).entities
    );
    const merged: (typeof input.graph.entities)[number][] = [];
    const seen = new Set<string>();
    for (let offset = 0; perProject.some((entities) => offset < entities.length); offset += 1) {
      for (const entities of perProject) {
        const entity = entities[offset];
        if (!entity || seen.has(entity.id)) continue;
        seen.add(entity.id);
        merged.push(entity);
      }
    }
    return merged;
  });
  const fallbackKinds: Record<typeof input.intent.category, string[]> = {
    'test-coverage': ['test-suite'],
    'dependency-security': ['package', 'module'],
    'release-readiness': ['pipeline', 'deployment', 'lifecycle-stage'],
    'defect-repair': ['test-suite', 'lifecycle-stage'],
    'feature-change': ['project', 'runtime-unit', 'api', 'package', 'module', 'test-suite'],
    refactor: ['package', 'module', 'api', 'test-suite'],
    performance: ['lifecycle-stage', 'test-suite', 'pipeline'],
    documentation: ['document', 'decision'],
    'system-understanding': ['project', 'service', 'api', 'package', 'protocol'],
  };
  const projectNames = new Set(input.projects.map((project) => project.name));
  const structuredFallback = input.graph.entities
    .filter(
      (entity) =>
        entity.proofIds.length > 0 &&
        (!entity.projectId || projectNames.has(entity.projectId)) &&
        fallbackKinds[input.intent.category].includes(entity.kind)
    )
    .sort(
      (left, right) =>
        fallbackKinds[input.intent.category].indexOf(left.kind) -
          fallbackKinds[input.intent.category].indexOf(right.kind) ||
        left.label.localeCompare(right.label)
    );
  const selected: (typeof input.graph.entities)[number][] = [];
  const selectedIds = new Set<string>();
  const append = (entity: (typeof input.graph.entities)[number] | undefined): void => {
    if (!entity || selected.length >= 20 || selectedIds.has(entity.id)) return;
    selectedIds.add(entity.id);
    selected.push(entity);
  };
  // Keep the objective dominant while reserving bounded capacity for category
  // recall. A broad category may not consume the evidence budget first.
  const objectiveSearchable =
    (input.intent.statement.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) ?? []).length >= 2;
  const primaryMatches = objectiveSearchable ? (queryMatches[0] ?? []) : [];
  for (const entity of primaryMatches.slice(0, 12)) append(entity);
  if (!objectiveSearchable) {
    for (const entity of structuredFallback) append(entity);
  }
  for (
    let offset = 0;
    selected.length < 20 && queryMatches.slice(1).some((entities) => offset < entities.length);
    offset += 1
  ) {
    for (const entities of queryMatches.slice(1)) append(entities[offset]);
  }
  if (objectiveSearchable) {
    for (const entity of structuredFallback) append(entity);
  }
  for (const entity of primaryMatches.slice(12)) append(entity);
  const anchors = selected.map((entity) => ({
    entityId: entity.id,
    kind: entity.kind,
    label: entity.label,
    proofIds: entity.proofIds.slice(0, 12),
  }));
  const objectiveAnchorCount = queryMatches[0]?.length ?? 0;
  return {
    workspaceIntelligence,
    measurement,
    retrieval: {
      status:
        objectiveSearchable && objectiveAnchorCount >= 3
          ? 'grounded'
          : anchors.length > 0
            ? 'partial'
            : 'empty',
      strategy: 'deterministic-category-v1',
      queries,
      anchors,
    },
  };
}

async function readGoalIndex(workspacePath: string): Promise<GoalIndex> {
  const indexPath = path.join(workspacePath, GOAL_INDEX_PATH);
  if (!(await fsExtra.pathExists(indexPath))) {
    return {
      schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
      generatedAt: new Date(0).toISOString(),
      activeGoalId: null,
      goals: [],
    };
  }
  const existing = (await fsExtra.readJson(indexPath)) as GoalIndex;
  assertJsonSchemaContract(existing, GOAL_INDEX_CONTRACT_PATH, 'Goal index');
  try {
    assertGoalIndexSemantics(existing);
  } catch (error) {
    const reconciled = reconcileLegacyNonActionableGoalSelection(existing);
    const isKnownLegacyPlanningDrift =
      reconciled !== null &&
      error instanceof Error &&
      error.message ===
        'Goal index is inconsistent: activeGoalId must identify the only selected actionable lifecycle entry.';
    if (!isKnownLegacyPlanningDrift || !reconciled) {
      throw error;
    }
    return reconciled;
  }
  // Planning is the explicit reconciliation boundary: upsertGoalIndex retains
  // history while demoting any formerly active entry before publication.
  return existing;
}

function upsertGoalIndex(index: GoalIndex, goal: GoalPack, updatedAt: string): GoalIndex {
  const existing = index.goals.find((entry) => entry.id === goal.id);
  const mayBecomeActive = goal.state === 'ready-to-plan';
  const entry = {
    id: goal.id,
    fingerprint: goal.fingerprint,
    objective: goal.intent.statement,
    category: goal.intent.category,
    state: goal.state,
    lifecycle:
      existing?.lifecycle === 'cancelled'
        ? ('cancelled' as const)
        : mayBecomeActive
          ? ('active' as const)
          : ('planned' as const),
    scope: goal.scope,
    createdAt: existing?.createdAt ?? goal.generatedAt,
    updatedAt,
    goalPack: goal.artifacts.goalPack,
    agentHandoff: goal.artifacts.agentHandoff,
    ...(existing?.verifiedGoalId ? { verifiedGoalId: existing.verifiedGoalId } : {}),
    ...(existing?.repairTransactionId ? { repairTransactionId: existing.repairTransactionId } : {}),
    ...(existing?.repairTransactionIds
      ? { repairTransactionIds: existing.repairTransactionIds }
      : {}),
  };
  return {
    schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
    generatedAt: updatedAt,
    activeGoalId:
      entry.lifecycle === 'active'
        ? goal.id
        : index.activeGoalId === goal.id
          ? null
          : index.activeGoalId,
    goals: [
      ...index.goals
        .filter((item) => item.id !== goal.id)
        .map((item) =>
          entry.lifecycle === 'active' && item.lifecycle === 'active'
            ? { ...item, lifecycle: 'planned' as const, updatedAt }
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
  const resolvedScope = await resolveScope({
    workspacePath,
    invocationProjectPath: resolution.projectPath,
    model,
    explicitScope: options.scope,
    selectScope: options.selectScope,
  });
  const scope = resolvedScope.scope;
  const selectedProjects = model.projects.filter((project) =>
    scope.projects.includes(project.name)
  );
  if (selectedProjects.length === 0) {
    throw new Error('A Goal Pack requires at least one registered project in its selected scope.');
  }
  const maxAttempts = options.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 25) {
    throw new Error('--max-attempts must be an integer from 1 to 25.');
  }
  const generatedAt = new Date().toISOString();
  const modelHash = hashWorkspaceModel(model);
  const coverageRuntimesByProject = selectedProjects.map((project) => ({
    name: project.name,
    runtimes: [
      ...new Set(
        project.runtimeCandidates.filter(
          (runtime): runtime is Exclude<ProjectCoverageRuntime, 'unknown'> =>
            GOAL_COVERAGE_RUNTIMES.has(runtime as Exclude<ProjectCoverageRuntime, 'unknown'>)
        )
      ),
    ].sort(),
  }));
  const detectedCoverageRuntimes = [
    ...new Set(coverageRuntimesByProject.flatMap((project) => project.runtimes)),
  ].sort();
  const canonicalCoverageRuntimes =
    coverageRuntimesByProject.length <= 1
      ? detectedCoverageRuntimes
      : coverageRuntimesByProject[0].runtimes.filter((runtime) =>
          coverageRuntimesByProject.every((project) => project.runtimes.includes(runtime))
        );
  let intent = compileGoalIntent(options.intent, {
    availableCoverageRuntimes: canonicalCoverageRuntimes,
    ...(options.runtime
      ? { selectedCoverageRuntime: options.runtime }
      : canonicalCoverageRuntimes.length === 1
        ? { selectedCoverageRuntime: canonicalCoverageRuntimes[0] }
        : {}),
  });
  if (options.runtime && !canonicalCoverageRuntimes.includes(options.runtime)) {
    const requestedRuntime = options.runtime;
    const missingProjects = coverageRuntimesByProject
      .filter((project) => !project.runtimes.includes(requestedRuntime))
      .map((project) => project.name);
    throw new Error(
      selectedProjects.length > 1 && missingProjects.length > 0
        ? `--runtime ${options.runtime} is not canonical for every project in the selected Goal scope. Missing from: ${missingProjects.join(', ')}. Split the projects into runtime-compatible Goal scopes.`
        : `--runtime ${options.runtime} is not present in the canonical Workspace Model for the selected Goal scope. Available runtimes: ${canonicalCoverageRuntimes.join(', ') || 'none'}.`
    );
  }
  if (options.runtime && intent.category !== 'test-coverage') {
    throw new Error('--runtime is valid only for a test-coverage Goal.');
  }
  if (
    options.runtime &&
    intent.requestedTarget?.runtime &&
    intent.requestedTarget.runtime !== options.runtime
  ) {
    throw new Error(
      `--runtime ${options.runtime} conflicts with the ${intent.requestedTarget.runtime} runtime named in the Goal intent.`
    );
  }
  if (
    !resolvedScope.selectionRequired &&
    intent.category === 'test-coverage' &&
    intent.requestedTarget &&
    !intent.requestedTarget.runtime &&
    canonicalCoverageRuntimes.length > 1 &&
    !options.runtime &&
    options.selectCoverageRuntime
  ) {
    const selectedRuntime = await options.selectCoverageRuntime({
      workspaceName: model.workspace.name,
      scope,
      projects: selectedProjects.map((project) => ({
        name: project.name,
        runtime: project.runtime,
        runtimeCandidates: [...project.runtimeCandidates].sort(),
      })),
      runtimes: canonicalCoverageRuntimes,
    });
    if (!canonicalCoverageRuntimes.includes(selectedRuntime)) {
      throw new Error('The selected coverage runtime is outside the canonical Goal scope.');
    }
    intent = compileGoalIntent(options.intent, {
      availableCoverageRuntimes: canonicalCoverageRuntimes,
      selectedCoverageRuntime: selectedRuntime,
    });
  }
  if (
    !resolvedScope.selectionRequired &&
    intent.category === 'test-coverage' &&
    selectedProjects.length > 1 &&
    canonicalCoverageRuntimes.length === 0
  ) {
    intent = {
      ...intent,
      ambiguities: [
        `The selected projects do not share a common canonical coverage runtime: ${coverageRuntimesByProject.map((project) => `${project.name} (${project.runtimes.join(', ') || 'none'})`).join('; ')}. Split them into runtime-compatible Goal scopes so every selected project is verified.`,
        ...intent.ambiguities,
      ],
    };
  }
  if (resolvedScope.selectionRequired) {
    intent = {
      ...intent,
      ambiguities: [
        `Goal scope is unresolved across ${scope.projects.length} registered projects: ${scope.projects.join(', ')}. Select one project, multiple projects, or the entire workspace.`,
        ...intent.ambiguities,
      ],
    };
  }
  const preflight = await buildGoalPreflight({
    workspacePath,
    projects: selectedProjects,
    graph,
    intent,
    coverageRuntimeChoices: canonicalCoverageRuntimes,
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
        ...(graph.source.inputs?.hash ? { inputHash: graph.source.inputs.hash } : {}),
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
      {
        ...kernelInput,
        generatedAt: persistedGoal.generatedAt,
        // The artifact hash is an immutable audit receipt, not Goal identity.
        // When live inputs are unchanged, an evidence-only Graph regeneration
        // must resume the original publication rather than rewrite it.
        sourceBinding: persistedGoal.sourceBinding,
      },
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
      const index = upsertGoalIndex(
        await readGoalIndex(workspacePath),
        goalPack,
        new Date().toISOString()
      );
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
        : goalPack.state === 'blocked'
          ? 'blocked'
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
