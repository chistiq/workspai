import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentTaskContext, AgentTaskContextSelectionRequired } from './agent-task-context.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { scopedProjectPath } from './utils/scoped-project-path.js';
import { projectRouteRelationHint } from './workspace-knowledge-graph-query.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';

export const AGENT_TASK_ROUTE_SCHEMA_VERSION = 'workspai.agent-task-route.v1' as const;
export const AGENT_TASK_ROUTE_CONTRACT =
  'contracts/workspace-intelligence/agent-task-route.v1.json';
export const DEFAULT_AGENT_TASK_ROUTE_MAX_BYTES = 8192;
const MAX_ACTIONS = 3;
const MAX_FILES = 3;

type Evidence = Pick<AgentTaskContext, 'scope' | 'selection' | 'grounding' | 'graph' | 'lifecycle'>;
type LifecycleUnit = Extract<Evidence['lifecycle'], { units: unknown }>['units'][number];
type Locator = {
  path: string;
  line?: number;
  evidenceId?: string;
  relation?: { id: string; kind: 'imports' | 'calls' | 'tests' };
};
type Recovery = Pick<
  AgentTaskContextSelectionRequired['recovery'][number],
  'kind' | 'requiredOption' | 'message'
>;

const capability = {
  inspect: { id: 'source.inspect', scope: 'project', effect: 'read' },
  search: { id: 'source.search', scope: 'project', effect: 'read' },
  access: { id: 'graph.access', scope: 'project', effect: 'read' },
  test: { id: 'lifecycle.test', scope: 'project', effect: 'execute-project-check' },
  select: { id: 'lifecycle.select', scope: 'project', effect: 'read' },
  review: { id: 'lifecycle.review', scope: 'project', effect: 'read' },
} as const;

type Action =
  | (typeof capability.inspect & { files: Locator[] })
  | (typeof capability.search & { cwd: '.' })
  | (typeof capability.access & {
      when: 'graph-needed';
      approval: 'host-read' | 'canonical-workspace-selection';
      retry: 'same-command' | 'approved-workspace';
      options?: ['--workspace-default', '--workspace'] | ['--workspace'];
    })
  | (typeof capability.test & {
      when: 'after-source-change';
      cwd: string;
      manifest: string;
      command: string;
      argvSequence?: { executable: string; args: string[] }[];
      preflight: 'executable-and-inputs' | 'executable';
      confidence: 'high' | 'medium';
      provenance: 'manifest-derived';
      selectedBy: 'exact-manifest' | 'source-runtime' | 'single-unit';
      sourceManifest?: string;
      setup?: { executable: string; args: string[] };
      runner: 'inspect-once';
      focus?: string;
      workspaceOwner?: { root: string; manifest: string };
    })
  | (typeof capability.select & {
      when: 'source-path-known';
      cwd: '.';
      executable: 'workspai';
      args: string[];
    })
  | (typeof capability.review & {
      when: 'after-source-change';
      reason: 'no-suggested-test';
      manifest?: string;
    });

type RouteBudget = { maxBytes: number; usedBytes: number; accounting: 'utf8-json-with-newline' };
type Route = {
  schemaVersion: typeof AGENT_TASK_ROUTE_SCHEMA_VERSION;
  status: 'ready' | 'partial';
  scope: Evidence['scope'];
  selection: Evidence['selection'];
  cwdBase: 'canonical-project-root';
  execution: { projectRoot: { anchor: 'request-project-root'; relativePath: string } };
  host: { availability: 'not-observed'; permission: 'not-observed'; execution: 'not-observed' };
  grounding: {
    status: Evidence['grounding']['status'];
    sourceMutation: 'governed-cli-transaction-only' | 'risk-and-project-policy-based' | 'unknown';
    findings: string[];
    goalEvidence?: string[];
  };
  graph: {
    status: 'candidates' | 'no-matches' | 'unavailable' | 'insufficient-budget';
    reason?: string;
    evidence?: { executable: 'workspai'; args: string[]; cwd: '.' };
  };
  actions: Action[];
  budget: RouteBudget;
  integrity: { algorithm: 'sha256'; payloadHash: string };
};

type Refusal = {
  schemaVersion: typeof AGENT_TASK_ROUTE_SCHEMA_VERSION;
  status: 'project-selection-required' | 'insufficient-budget';
  reason: string;
  recovery: Recovery[];
  budget: RouteBudget & { requiredBytes?: number };
};

export type AgentTaskRouteResult = Route | Refusal;

function bytes(value: object): number {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8');
}

function settleBudget(value: AgentTaskRouteResult): void {
  while (value.budget.usedBytes !== bytes(value)) value.budget.usedBytes = bytes(value);
}

export function buildRouteRefusal(input: {
  status: Refusal['status'];
  reason: string;
  recovery: Recovery[];
  maxBytes: number;
  requiredBytes?: number;
}): Refusal {
  const refusal: Refusal = {
    schemaVersion: AGENT_TASK_ROUTE_SCHEMA_VERSION,
    status: input.status,
    reason: input.reason,
    recovery: input.recovery.map(({ kind, requiredOption, message }) => ({
      kind,
      ...(requiredOption ? { requiredOption } : {}),
      message,
    })),
    budget: {
      maxBytes: input.maxBytes,
      usedBytes: 0,
      accounting: 'utf8-json-with-newline',
      ...(input.requiredBytes === undefined ? {} : { requiredBytes: input.requiredBytes }),
    },
  };
  settleBudget(refusal);
  assertJsonSchemaContract(refusal, AGENT_TASK_ROUTE_CONTRACT, 'Agent task route refusal');
  return refusal;
}

/** Validate a live locator at the point it would become an action. */
function projectFile(root: string, relative: string): boolean {
  try {
    const file = scopedProjectPath(root, relative);
    return file !== undefined && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const fileEvidenceKinds = new Set([
  'file',
  'symbol',
  'test-suite',
  'endpoint',
  'schema',
  'document',
]);

function discovery(
  input: Evidence & {
    root: string;
    artifactPrefix?: string;
    selectedPath?: string;
    validatedGraph?: WorkspaceKnowledgeGraph;
  }
) {
  const files = new Map<string, Locator>();
  const seeds: Array<{ id: string; artifact: string }> = [];
  if (input.selectedPath && projectFile(input.root, input.selectedPath)) {
    files.set(input.selectedPath, { path: input.selectedPath });
  }
  const { graph } = input;
  if (
    graph.status === 'results' &&
    graph.scope.project === input.scope.project &&
    graph.scope.workspace === input.scope.workspace &&
    graph.validation.liveInputsValidated &&
    input.artifactPrefix
  ) {
    const prefix = `${input.artifactPrefix}/`;
    const proofs = new Map(graph.proofs.map((proof) => [proof.id, proof]));
    for (const match of graph.matches) {
      if (files.size >= MAX_FILES) break;
      if (
        match.project !== input.scope.project ||
        !fileEvidenceKinds.has(match.kind) ||
        !match.proofId
      )
        continue;
      const proof = proofs.get(match.proofId);
      if (!proof || proof.freshness !== 'fresh' || !proof.artifact.startsWith(prefix)) continue;
      const relative = proof.artifact.slice(prefix.length);
      if (files.get(relative)?.evidenceId || !projectFile(input.root, relative)) continue;
      if (match.reason.basis === 'lexical') seeds.push({ id: match.id, artifact: proof.artifact });
      files.set(relative, {
        path: relative,
        ...(proof.line && proof.line > 0 ? { line: proof.line } : {}),
        evidenceId: match.id,
      });
    }
    if (input.validatedGraph) {
      const hint = projectRouteRelationHint(input.validatedGraph, input.scope.project, seeds);
      if (hint?.proof.artifact.startsWith(prefix)) {
        const relative = hint.proof.artifact.slice(prefix.length);
        if (!files.has(relative) && projectFile(input.root, relative)) {
          const ranked = [...files.values()];
          ranked.splice(1, 0, {
            path: relative,
            ...(hint.proof.line ? { line: hint.proof.line } : {}),
            evidenceId: hint.entityId,
            relation: { id: hint.relationId, kind: hint.kind },
          });
          return { ...capability.inspect, files: ranked.slice(0, MAX_FILES) };
        }
      }
    }
  }
  const action: Action = files.size
    ? { ...capability.inspect, files: [...files.values()] }
    : { ...capability.search, cwd: '.' };
  return action;
}

function graphAccess(graph: Evidence['graph']): Action | undefined {
  if (graph.status !== 'unavailable' || !graph.userAction) return undefined;
  if (graph.userAction.kind === 'request-filesystem-read') {
    return {
      ...capability.access,
      when: 'graph-needed',
      approval: 'host-read',
      retry: 'same-command',
    };
  }
  return {
    ...capability.access,
    when: 'graph-needed',
    approval: 'canonical-workspace-selection',
    retry: 'approved-workspace',
    options:
      graph.userAction.status === 'workspace-choice-unverified'
        ? ['--workspace']
        : ['--workspace-default', '--workspace'],
  };
}

const sourceRuntimes: ReadonlyArray<{
  extensions: RegExp;
  runtimes: LifecycleUnit['runtime'][];
}> = [
  { extensions: /^\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/u, runtimes: ['node', 'bun', 'deno'] },
  { extensions: /^\.pyi?$/u, runtimes: ['python'] },
  { extensions: /^\.go$/u, runtimes: ['go'] },
  { extensions: /^\.rs$/u, runtimes: ['rust'] },
  { extensions: /^\.java$/u, runtimes: ['java'] },
  { extensions: /^\.kts?$/u, runtimes: ['kotlin', 'java'] },
  { extensions: /^\.scala$/u, runtimes: ['scala', 'java'] },
  { extensions: /^\.clj[cs]?$/u, runtimes: ['clojure'] },
  { extensions: /^\.(?:cs|fs|vb)$/u, runtimes: ['dotnet'] },
  { extensions: /^\.php$/u, runtimes: ['php'] },
  { extensions: /^\.rb$/u, runtimes: ['ruby'] },
  { extensions: /^\.exs?$/u, runtimes: ['elixir'] },
  { extensions: /^\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/u, runtimes: ['c', 'cpp'] },
];

function selectLifecycleUnit(units: LifecycleUnit[], selectedPath?: string) {
  const manifest = units.filter((unit) => unit.manifest === selectedPath);
  if (manifest.length === 1) return { unit: manifest[0], selectedBy: 'exact-manifest' as const };
  const extension = path.posix.extname(selectedPath ?? '').toLowerCase();
  const family = sourceRuntimes.find(({ extensions }) => extensions.test(extension));
  if (family) {
    const compatible = units.filter((unit) => family.runtimes.includes(unit.runtime));
    if (compatible.length === 1)
      return { unit: compatible[0], selectedBy: 'source-runtime' as const };
    return undefined;
  }
  return units.length === 1 ? { unit: units[0], selectedBy: 'single-unit' as const } : undefined;
}

function verification(input: Evidence & { root: string; selectedPath?: string }): Action {
  const { lifecycle } = input;
  const selected =
    lifecycle.status === 'ready'
      ? selectLifecycleUnit(lifecycle.units, input.selectedPath)
      : undefined;
  const unit = selected?.unit;
  const stage = unit?.stages.find((candidate) => candidate.stage === 'test');
  const owner = unit?.workspaceOwner;
  if (
    selected &&
    unit &&
    stage &&
    scopedProjectPath(input.root, stage.cwd) &&
    (!stage.ownerManifest || projectFile(input.root, stage.ownerManifest)) &&
    projectFile(input.root, unit.manifest) &&
    (!owner || projectFile(input.root, owner.manifest))
  ) {
    const { command, argvSequence, cwd, preflight, confidence } = stage;
    return {
      ...capability.test,
      when: 'after-source-change',
      cwd,
      manifest: stage.ownerManifest ?? unit.manifest,
      ...(stage.ownerManifest && stage.ownerManifest !== unit.manifest
        ? { sourceManifest: unit.manifest }
        : {}),
      ...(stage.setup ? { setup: stage.setup } : {}),
      ...(stage.focus ? { focus: stage.focus } : {}),
      runner: 'inspect-once',
      command,
      ...(argvSequence ? { argvSequence } : {}),
      preflight,
      confidence,
      provenance: unit.provenance,
      selectedBy: selected.selectedBy,
      ...(owner ? { workspaceOwner: { root: owner.root, manifest: owner.manifest } } : {}),
    };
  }
  if (
    input.selectedPath ||
    lifecycle.status === 'no-lifecycle-units' ||
    (lifecycle.status === 'ready' && lifecycle.units.length === 1)
  ) {
    return {
      ...capability.review,
      when: 'after-source-change',
      reason: 'no-suggested-test',
      ...(unit && projectFile(input.root, unit.manifest) ? { manifest: unit.manifest } : {}),
    };
  }
  return {
    ...capability.select,
    when: 'source-path-known',
    cwd: '.',
    executable: 'workspai',
    args: [
      'project',
      'lifecycle',
      'plan',
      '--project',
      '<verified-source-root>',
      '--path',
      '<verified-source-path>',
      '--strict',
      '--json',
    ],
  };
}

/** Project facts drive the route. Task text never supplies permissions or shell syntax. */
export function buildAgentTaskRoute(
  input: Evidence & {
    root: string;
    selectedPath?: string;
    artifactPrefix?: string;
    rootRelativeToRequest: string;
    validatedGraph?: WorkspaceKnowledgeGraph;
    workspaceChoice?: 'explicit' | 'managed-default';
    status: Route['status'];
    maxBytes: number;
  }
): AgentTaskRouteResult {
  const { graph, grounding, scope, selection, maxBytes } = input;
  const first = discovery(input);
  const access = graphAccess(graph);
  const actions = [first, verification(input), ...(access ? [access] : [])].slice(0, MAX_ACTIONS);
  const hasGrounding = 'checks' in grounding;
  const applicableGoal =
    hasGrounding && grounding.activeGoal.present && grounding.activeGoal.appliesToProject
      ? [grounding.activeGoal.goalPack, grounding.activeGoal.agentHandoff].filter(
          (value): value is string => Boolean(value)
        )
      : [];
  const route: Route = {
    schemaVersion: AGENT_TASK_ROUTE_SCHEMA_VERSION,
    status: input.status,
    scope,
    selection,
    cwdBase: 'canonical-project-root',
    execution: {
      projectRoot: { anchor: 'request-project-root', relativePath: input.rootRelativeToRequest },
    },
    host: { availability: 'not-observed', permission: 'not-observed', execution: 'not-observed' },
    grounding: {
      status: grounding.status,
      sourceMutation: hasGrounding ? grounding.claims.sourceMutation : 'unknown',
      findings: hasGrounding
        ? [...new Set(grounding.checks.findings.map((finding) => finding.id))]
        : [],
      ...(applicableGoal.length ? { goalEvidence: applicableGoal } : {}),
    },
    graph: {
      status: graph.status === 'results' ? graph.retrieval.status : graph.status,
      ...(graph.status === 'unavailable' ? { reason: graph.reason } : {}),
      ...(graph.status === 'results' &&
      first.id === 'source.inspect' &&
      first.files.some((file) => file.evidenceId)
        ? {
            evidence: {
              executable: 'workspai',
              cwd: '.',
              args: [
                ...graph.expand.argv,
                ...(input.workspaceChoice ? ['--workspace', '<approved-workspace-root>'] : []),
              ],
            },
          }
        : {}),
    },
    actions,
    budget: { maxBytes, usedBytes: 0, accounting: 'utf8-json-with-newline' },
    integrity: { algorithm: 'sha256', payloadHash: '0'.repeat(64) },
  };
  settleBudget(route);
  if (route.budget.usedBytes > maxBytes) {
    const retry = { ...route, budget: { ...route.budget } };
    do {
      retry.budget.maxBytes = retry.budget.usedBytes;
      settleBudget(retry);
    } while (retry.budget.usedBytes > retry.budget.maxBytes);
    return buildRouteRefusal({
      status: 'insufficient-budget',
      reason: 'route-exceeds-budget',
      recovery: [
        {
          kind: 'retry',
          message:
            'Retry once with the same task, project, workspace choice and --view route, using budget.requiredBytes.',
        },
        {
          kind: 'native',
          message:
            'Use scoped native source and verification tools if the route remains unavailable.',
        },
      ],
      maxBytes,
      requiredBytes: retry.budget.maxBytes,
    });
  }
  const { integrity: _integrity, ...unsigned } = route;
  route.integrity.payloadHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  assertJsonSchemaContract(route, AGENT_TASK_ROUTE_CONTRACT, 'Agent task route');
  return route;
}
