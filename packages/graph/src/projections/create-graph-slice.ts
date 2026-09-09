import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import type {
  GraphCanonicalGraph,
  GraphEdge,
  GraphEntityReference,
  GraphProofState,
  GraphQueryQuality,
} from '../contracts/index.js';
import {
  GRAPH_SLICE_RESULT_CONTRACT,
  type GraphSliceExecution,
  type GraphSliceIntent,
  type GraphSliceRequest,
} from '../contracts/graph-slice.js';

const DEFAULT_BUDGET = Object.freeze({
  maxDepth: 4,
  maxNodes: 150,
  maxEdges: 300,
  maxPaths: 150,
  maxEvidence: 150,
  maxContentBytes: 512 * 1024,
});
const MAX_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 10_000,
  maxEdges: 50_000,
  maxPaths: 10_000,
  maxEvidence: 10_000,
  maxContentBytes: 10 * 1024 * 1024,
});

const PROFILE_BY_INTENT: Readonly<Record<GraphSliceIntent, string>> = Object.freeze({
  understand: 'workspai.graph.slice.understand.standard',
  impact: 'workspai.graph.slice.impact.standard',
  review: 'workspai.graph.slice.review.standard',
  repair: 'workspai.graph.slice.repair.standard',
  release: 'workspai.graph.slice.release.standard',
});

function validBudget(budget: GraphSliceRequest['budget']): boolean {
  if (!budget) return true;
  for (const key of Object.keys(MAX_BUDGET) as (keyof typeof MAX_BUDGET)[]) {
    const value = budget[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value <= 0 || value > MAX_BUDGET[key])
    ) {
      return false;
    }
  }
  return true;
}

function contentBytes(value: unknown): number | undefined {
  const canonical = canonicalizeGraphValue(value);
  return canonical.accepted ? new TextEncoder().encode(canonical.value).byteLength : undefined;
}

function proofSummary(edges: readonly GraphEdge[]): GraphQueryQuality['proofStates'] {
  const summary: Record<GraphProofState, number> = {
    supported: 0,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  };
  for (const edge of edges) summary[edge.proof.state] += 1;
  return Object.freeze(summary);
}

function neighborPriority(intent: GraphSliceIntent, edge: GraphEdge, seedIds: Set<string>): number {
  const touchesSeed = seedIds.has(edge.from) || seedIds.has(edge.to);
  if (!touchesSeed) return 3;
  if (intent === 'impact' && edge.semantics === 'behavioral') return 0;
  if (intent === 'repair' && edge.relation === 'blocks') return 0;
  if (intent === 'release' && ['pipeline', 'gate', 'workflow'].includes(edge.relation)) return 0;
  if (intent === 'understand' && edge.semantics === 'structural') return 0;
  return 1;
}

/** Creates a bounded portable subgraph for a consumer intent without rescanning sources. */
export function createGraphSlice(
  graph: GraphCanonicalGraph,
  request: GraphSliceRequest
): GraphSliceExecution {
  const budget = Object.freeze({ ...DEFAULT_BUDGET, ...(request.budget ?? {}) });
  if (!validBudget(request.budget)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_SLICE_BUDGET_INVALID',
          path: '/budget',
          message: 'Graph slice budgets must be positive and within fixed safety ceilings.',
        },
      ],
    };
  }
  if (request.subjects.length === 0) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_SLICE_SUBJECTS_REQUIRED',
          path: '/subjects',
          message: 'Graph slice requests require at least one subject identifier.',
        },
      ],
    };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const seedSubjects = Object.freeze(
    [...new Set(request.subjects)].sort((left, right) => left.localeCompare(right))
  );
  const seedIds = new Set(seedSubjects.filter((subject) => nodesById.has(subject)));
  const excludedSubjects = Object.freeze(seedSubjects.filter((subject) => !nodesById.has(subject)));
  const selectedNodeIds = new Set(seedIds);
  const selectedEdgeIds = new Set<string>();
  const frontier = [...seedIds];
  const truncationReasons: (
    'nodes' | 'edges' | 'paths' | 'evidence' | 'depth' | 'content-bytes'
  )[] = [];

  for (let depth = 0; depth < budget.maxDepth && frontier.length > 0; depth += 1) {
    if (selectedNodeIds.size >= budget.maxNodes) {
      truncationReasons.push('depth');
      break;
    }
    const nextFrontier: string[] = [];
    const rankedEdges = graph.edges
      .filter(
        (edge) =>
          (frontier.includes(edge.from) || frontier.includes(edge.to)) &&
          !selectedEdgeIds.has(edge.id)
      )
      .sort((left, right) => {
        const priority =
          neighborPriority(request.intent, left, seedIds) -
          neighborPriority(request.intent, right, seedIds);
        return priority !== 0 ? priority : left.id.localeCompare(right.id);
      });
    for (const edge of rankedEdges) {
      if (selectedEdgeIds.size >= budget.maxEdges) {
        truncationReasons.push('edges');
        break;
      }
      selectedEdgeIds.add(edge.id);
      for (const nodeId of [edge.from, edge.to]) {
        if (!selectedNodeIds.has(nodeId) && nodesById.has(nodeId)) {
          if (selectedNodeIds.size >= budget.maxNodes) {
            truncationReasons.push('nodes');
            break;
          }
          selectedNodeIds.add(nodeId);
          nextFrontier.push(nodeId);
        }
      }
    }
    frontier.splice(0, frontier.length, ...nextFrontier);
  }

  const nodes = Object.freeze(
    [...selectedNodeIds]
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphEntityReference => Boolean(node))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, budget.maxNodes)
  );
  const retainedNodeIds = new Set(nodes.map((node) => node.id));
  const edges = Object.freeze(
    graph.edges
      .filter(
        (edge) =>
          selectedEdgeIds.has(edge.id) &&
          retainedNodeIds.has(edge.from) &&
          retainedNodeIds.has(edge.to)
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, budget.maxEdges)
  );
  const evidence = Object.freeze(
    request.includeEvidence
      ? edges.flatMap((edge) => edge.proof.evidence).slice(0, budget.maxEvidence)
      : []
  );
  const payload = {
    nodes,
    edges,
    paths: [] as const,
    evidence,
    unknownBoundaries: graph.unresolved.map((entry) => ({
      code: 'graph.slice-unresolved-identity',
      scope: entry.id,
      reason: `Slice retained ${entry.candidates.length} unresolved identity candidates.`,
    })),
  };
  const bytes = contentBytes(payload) ?? 0;
  if (bytes > budget.maxContentBytes) truncationReasons.push('content-bytes');

  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_SLICE_RESULT_CONTRACT,
      profile: Object.freeze({
        id: PROFILE_BY_INTENT[request.intent],
        version: request.contract.version,
      }),
      sourceGeneration: graph.generation.reference,
      request: Object.freeze({
        intent: request.intent,
        subjects: seedSubjects,
        scope: request.scope,
        includeEvidence: request.includeEvidence,
        redactionPolicy: request.redactionPolicy,
      }),
      nodes,
      edges,
      paths: Object.freeze([]),
      evidence,
      unknownBoundaries: Object.freeze(payload.unknownBoundaries),
      proofSummary: proofSummary(edges),
      quality: Object.freeze({
        proofStates: proofSummary(edges),
        bindingCompleteness: Object.freeze([]),
      }),
      explanation: Object.freeze({
        intent: request.intent,
        seedSubjects,
        excludedSubjects,
        selectionOrder: Object.freeze(['subjects', 'neighbors'] as const),
      }),
      cost: Object.freeze({
        scannedNodes: graph.nodes.length,
        scannedEdges: graph.edges.length,
        returnedNodes: nodes.length,
        returnedEdges: edges.length,
        returnedPaths: 0,
        returnedEvidence: evidence.length,
        contentBytes: bytes,
      }),
      truncation: Object.freeze({
        truncated: truncationReasons.length > 0 || excludedSubjects.length > 0,
        reasons: Object.freeze(truncationReasons),
      }),
    }),
    issues: [],
  };
}
