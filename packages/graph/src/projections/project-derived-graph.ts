import type { WisContractReference, WisOmission } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphEdge,
  GraphEntityReference,
  GraphProofState,
  GraphQualityReport,
  GraphScope,
} from '../contracts/index.js';
import {
  GRAPH_DERIVED_PROJECTION_RESULT_CONTRACT,
  type GraphDerivedArchitectureHotspot,
  type GraphDerivedArchitectureMetrics,
  type GraphDerivedCommunityGroup,
  type GraphDerivedFlowRank,
  type GraphDerivedProjectionBudget,
  type GraphDerivedProjectionDescriptor,
  type GraphDerivedProjectionExecution,
  type GraphDerivedProjectionKind,
  type GraphDerivedProjectionProfile,
  type GraphDerivedProjectionRequest,
  type GraphDerivedProjectionResult,
  type GraphDerivedReviewRiskFinding,
} from '../contracts/projection.js';

const DEFAULT_BUDGET: GraphDerivedProjectionBudget = Object.freeze({ maxItems: 500 });
const MAX_BUDGET = 5_000;

const PROOF_RANK: Readonly<Record<GraphProofState, number>> = Object.freeze({
  unresolved: 0,
  insufficient: 1,
  disputed: 2,
  supported: 3,
  corroborated: 4,
  verified: 5,
});

const COMMUNITY_ENTITY_KINDS = new Set(['file', 'module', 'package', 'symbol']);
const COMMUNITY_RELATIONS = new Set(['contains', 'imports', 'depends-on']);
const FLOW_ENTITY_KINDS = new Set(['endpoint', 'service', 'symbol', 'workflow', 'command']);
const FLOW_RELATIONS = new Set(['routes-to', 'imports', 'depends-on', 'contains']);
const REVIEW_ENTITY_KINDS = new Set(['file', 'symbol', 'module', 'package']);

function profileRef(profile: GraphDerivedProjectionProfile): WisContractReference {
  return Object.freeze({ id: profile.id, version: profile.version });
}

function validBudget(budget: GraphDerivedProjectionBudget): boolean {
  return (
    Number.isSafeInteger(budget.maxItems) && budget.maxItems > 0 && budget.maxItems <= MAX_BUDGET
  );
}

function meetsProof(minimum: GraphProofState, actual: GraphProofState): boolean {
  return PROOF_RANK[actual] >= PROOF_RANK[minimum];
}

function scopeMatches(entity: GraphEntityReference, scope?: GraphScope): boolean {
  if (!scope) return true;
  if (scope.kind === 'workspace') {
    return entity.scope.kind === 'workspace' && entity.scope.workspaceId === scope.workspaceId;
  }
  if (scope.kind === 'project') {
    return (
      entity.scope.kind === 'project' && scope.projectIds.includes(entity.scope.projectIds[0] ?? '')
    );
  }
  return entity.scope.kind === scope.kind;
}

function scopedNodes(graph: GraphCanonicalGraph, scope?: GraphScope): GraphEntityReference[] {
  return graph.nodes.filter((node) => scopeMatches(node, scope));
}

function scopedEdges(
  graph: GraphCanonicalGraph,
  nodesById: ReadonlyMap<string, GraphEntityReference>,
  scope: GraphScope | undefined,
  profile: GraphDerivedProjectionProfile,
  allowedRelations?: ReadonlySet<string>,
  allowedKinds?: ReadonlySet<string>
): GraphEdge[] {
  return graph.edges.filter((edge) => {
    if (!meetsProof(profile.proofThreshold, edge.proof.state)) return false;
    if (allowedRelations && !allowedRelations.has(edge.relation)) return false;
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) return false;
    if (!scopeMatches(from, scope) || !scopeMatches(to, scope)) return false;
    if (allowedKinds && (!allowedKinds.has(from.kind) || !allowedKinds.has(to.kind))) return false;
    return true;
  });
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(value: string): string {
    if (!this.parent.has(value)) this.parent.set(value, value);
    let root = this.parent.get(value)!;
    while (root !== this.parent.get(root)) root = this.parent.get(root)!;
    let current = value;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(left: string, right: string): void {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);
    if (rootLeft !== rootRight) this.parent.set(rootLeft, rootRight);
  }
}

function communityGroups(
  nodes: readonly GraphEntityReference[],
  edges: readonly GraphEdge[],
  maxItems: number
): { readonly groups: readonly GraphDerivedCommunityGroup[]; readonly total: number } {
  const members = nodes.filter((node) => COMMUNITY_ENTITY_KINDS.has(node.kind));
  const memberIds = new Set(members.map((node) => node.id));
  const unionFind = new UnionFind();
  for (const node of members) unionFind.find(node.id);
  for (const edge of edges) {
    if (!memberIds.has(edge.from) || !memberIds.has(edge.to)) continue;
    unionFind.union(edge.from, edge.to);
  }
  const grouped = new Map<string, string[]>();
  for (const node of members) {
    const root = unionFind.find(node.id);
    const bucket = grouped.get(root) ?? [];
    bucket.push(node.id);
    grouped.set(root, bucket);
  }
  const all = [...grouped.entries()]
    .map(([root, ids]) => {
      const sorted = [...ids].sort((left, right) => left.localeCompare(right));
      const internalEdges = edges.filter(
        (edge) => sorted.includes(edge.from) && sorted.includes(edge.to)
      ).length;
      const possible = sorted.length <= 1 ? 1 : sorted.length * (sorted.length - 1);
      return Object.freeze({
        id: `community:${root}`,
        members: Object.freeze(sorted),
        cohesion: possible === 0 ? 0 : internalEdges / possible,
      });
    })
    .sort((left, right) =>
      right.members.length === left.members.length
        ? left.id.localeCompare(right.id)
        : right.members.length - left.members.length
    );
  return Object.freeze({
    groups: Object.freeze(all.slice(0, maxItems)),
    total: all.length,
  });
}

function flowRanks(
  nodes: readonly GraphEntityReference[],
  edges: readonly GraphEdge[],
  maxItems: number
): { readonly ranks: readonly GraphDerivedFlowRank[]; readonly total: number } {
  const flowNodes = nodes.filter((node) => FLOW_ENTITY_KINDS.has(node.kind));
  const flowIds = new Set(flowNodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, Set<string>>();
  for (const id of flowIds) {
    incoming.set(id, 0);
    outgoing.set(id, new Set());
  }
  for (const edge of edges) {
    if (!flowIds.has(edge.from) || !flowIds.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.add(edge.to);
  }
  const all = flowNodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => {
      const visited = new Set<string>();
      const queue = [node.id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of outgoing.get(current) ?? []) queue.push(next);
      }
      const reach = visited.size - 1;
      const downstream = outgoing.get(node.id)?.size ?? 0;
      return Object.freeze({
        entityId: node.id,
        rank: 0,
        score: reach + downstream,
        drivers: Object.freeze([`downstream-reach:${reach}`, `immediate-outgoing:${downstream}`]),
      });
    })
    .sort((left, right) =>
      right.score === left.score
        ? left.entityId.localeCompare(right.entityId)
        : right.score - left.score
    );
  const ranks = all
    .slice(0, maxItems)
    .map((entry, index) => Object.freeze({ ...entry, rank: index + 1 }));
  return Object.freeze({ ranks: Object.freeze(ranks), total: all.length });
}

function reviewFindings(
  nodes: readonly GraphEntityReference[],
  edges: readonly GraphEdge[],
  maxItems: number
): { readonly findings: readonly GraphDerivedReviewRiskFinding[]; readonly total: number } {
  const reviewNodes = nodes.filter((node) => REVIEW_ENTITY_KINDS.has(node.kind));
  const reviewIds = new Set(reviewNodes.map((node) => node.id));
  const degree = new Map<string, number>();
  const weakProof = new Map<string, number>();
  for (const id of reviewIds) {
    degree.set(id, 0);
    weakProof.set(id, 0);
  }
  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!reviewIds.has(endpoint)) continue;
      degree.set(endpoint, (degree.get(endpoint) ?? 0) + 1);
      if (edge.proof.state === 'disputed' || edge.proof.state === 'insufficient') {
        weakProof.set(endpoint, (weakProof.get(endpoint) ?? 0) + 1);
      }
    }
  }
  const maxDegree = Math.max(1, ...degree.values());
  const all = reviewNodes
    .map((node) => {
      const coupling = (degree.get(node.id) ?? 0) / maxDegree;
      const proofPenalty = (weakProof.get(node.id) ?? 0) * 0.25;
      const score = Math.min(1, coupling + proofPenalty);
      const classification =
        score >= 0.75 ? 'high' : score >= 0.5 ? 'moderate' : score >= 0.25 ? 'advisory' : 'low';
      return Object.freeze({
        entityId: node.id,
        score,
        classification,
        drivers: Object.freeze([
          `structural-coupling:${(degree.get(node.id) ?? 0).toFixed(0)}`,
          `weak-proof-edges:${(weakProof.get(node.id) ?? 0).toFixed(0)}`,
        ]),
      });
    })
    .sort((left, right) =>
      right.score === left.score
        ? left.entityId.localeCompare(right.entityId)
        : right.score - left.score
    );
  return Object.freeze({
    findings: Object.freeze(all.slice(0, maxItems)),
    total: all.length,
  });
}

function architectureSummary(
  nodes: readonly GraphEntityReference[],
  edges: readonly GraphEdge[],
  maxItems: number
): {
  metrics: GraphDerivedArchitectureMetrics;
  hotspots: readonly GraphDerivedArchitectureHotspot[];
  totalHotspots: number;
} {
  const nodesByKind: Record<string, number> = {};
  const edgesBySemantics: Record<string, number> = {};
  for (const node of nodes) nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
  for (const edge of edges) {
    edgesBySemantics[edge.semantics] = (edgesBySemantics[edge.semantics] ?? 0) + 1;
  }
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const ranked = [...degree.entries()].sort((left, right) =>
    right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1]
  );
  const hotspots = ranked
    .slice(0, maxItems)
    .map(([entityId, value]) => Object.freeze({ entityId, degree: value }));
  return {
    metrics: Object.freeze({
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: Object.freeze(nodesByKind),
      edgesBySemantics: Object.freeze(edgesBySemantics),
    }),
    hotspots: Object.freeze(hotspots),
    totalHotspots: ranked.length,
  };
}

function descriptor(
  profile: GraphDerivedProjectionProfile,
  graph: GraphCanonicalGraph,
  omissions: readonly WisOmission[]
): GraphDerivedProjectionDescriptor {
  return Object.freeze({
    profile: profileRef(profile),
    algorithm: profile.algorithm,
    sourceGeneration: graph.generation.reference,
    proofThreshold: profile.proofThreshold,
    limitations: profile.limitations,
    omissions: Object.freeze(omissions),
  });
}

function unsupportedKind(kind: GraphDerivedProjectionKind): GraphDerivedProjectionExecution {
  return {
    accepted: false,
    issues: [
      {
        code: 'GRAPH_DERIVED_PROJECTION_KIND_UNSUPPORTED',
        path: '/profile/kind',
        message: `Derived projection kind ${kind} is not admitted by this engine version.`,
      },
    ],
  };
}

/**
 * Computes one bounded derived projection over an immutable canonical generation.
 * Derived results never mutate or replace canonical graph truth.
 */
export function projectDerivedGraph(
  graph: GraphCanonicalGraph,
  quality: GraphQualityReport,
  request: GraphDerivedProjectionRequest
): GraphDerivedProjectionExecution {
  const budget = Object.freeze({ ...DEFAULT_BUDGET, ...request.budget });
  if (!validBudget(budget)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_DERIVED_PROJECTION_BUDGET_INVALID',
          path: '/budget',
          message: 'Derived projection budgets must be positive and within fixed safety ceilings.',
        },
      ],
    };
  }

  const profile = request.profile;
  const nodes = scopedNodes(graph, request.scope);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const omissions: WisOmission[] = [];
  let payload: Pick<
    GraphDerivedProjectionResult,
    'communities' | 'flowRanks' | 'reviewFindings' | 'architecture'
  > = {};
  let truncated = false;

  if (profile.kind === 'community') {
    const edges = scopedEdges(
      graph,
      nodesById,
      request.scope,
      profile,
      COMMUNITY_RELATIONS,
      COMMUNITY_ENTITY_KINDS
    );
    const communities = communityGroups(nodes, edges, budget.maxItems);
    truncated = communities.total > budget.maxItems;
    payload = { communities: communities.groups };
  } else if (profile.kind === 'flow') {
    const edges = scopedEdges(
      graph,
      nodesById,
      request.scope,
      profile,
      FLOW_RELATIONS,
      FLOW_ENTITY_KINDS
    );
    const ranks = flowRanks(nodes, edges, budget.maxItems);
    truncated = ranks.total > budget.maxItems;
    payload = { flowRanks: ranks.ranks };
  } else if (profile.kind === 'review-risk') {
    const edges = scopedEdges(graph, nodesById, request.scope, profile);
    const findings = reviewFindings(nodes, edges, budget.maxItems);
    truncated = findings.total > budget.maxItems;
    payload = { reviewFindings: findings.findings };
  } else if (profile.kind === 'architecture-summary') {
    const edges = scopedEdges(graph, nodesById, request.scope, profile);
    const summary = architectureSummary(nodes, edges, budget.maxItems);
    truncated = summary.totalHotspots > budget.maxItems;
    payload = {
      architecture: Object.freeze({
        metrics: summary.metrics,
        hotspots: summary.hotspots,
      }),
    };
  } else {
    return unsupportedKind(profile.kind);
  }

  if (quality.unknownZones.length > 0) {
    omissions.push({
      code: 'graph.derived-projection-unknown-zones-present',
      reason:
        'Unknown zones were present in the source generation and may reduce derived confidence.',
      affectsStatus: false,
      recoverable: true,
    });
  }

  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_DERIVED_PROJECTION_RESULT_CONTRACT,
      descriptor: descriptor(profile, graph, omissions),
      kind: profile.kind,
      ...payload,
      unknownZones: Object.freeze([...quality.unknownZones]),
      unsupportedZones: Object.freeze([...quality.unsupportedZones]),
      truncation: Object.freeze({
        truncated,
        reasons: Object.freeze(truncated ? (['items'] as const) : []),
      }),
    }),
    issues: [],
  };
}
