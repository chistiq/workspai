import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphEdge,
  GraphEntityReference,
  GraphProofState,
  GraphQualityReport,
} from '../contracts/index.js';
import {
  GRAPH_PROJECTION_RESULT_CONTRACT,
  type GraphProjectionBudget,
  type GraphProjectionExecution,
  type GraphProjectionOmittedFamilies,
  type GraphProjectionProfile,
  type GraphProjectionRequest,
} from '../contracts/projection.js';
import {
  admittedRedactionPolicy,
  createGraphScopePredicate,
  redactGraphEdge,
  redactGraphEvidence,
} from './projection-policy.js';

const DEFAULT_BUDGET: GraphProjectionBudget = Object.freeze({
  maxNodes: 5_000,
  maxEdges: 10_000,
  maxEvidence: 5_000,
});
const MAX_BUDGET: GraphProjectionBudget = Object.freeze({
  maxNodes: 100_000,
  maxEdges: 500_000,
  maxEvidence: 100_000,
});

const PROOF_RANK: Readonly<Record<GraphProofState, number>> = Object.freeze({
  unresolved: 0,
  insufficient: 1,
  disputed: 2,
  supported: 3,
  corroborated: 4,
  verified: 5,
});

function profileRef(profile: GraphProjectionProfile): WisContractReference {
  return Object.freeze({ id: profile.id, version: profile.version });
}

function validBudget(budget: GraphProjectionBudget): boolean {
  return (Object.keys(MAX_BUDGET) as (keyof GraphProjectionBudget)[]).every(
    (key) => Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= MAX_BUDGET[key]
  );
}

function evidenceKey(evidence: WisEvidenceReference): string {
  return `${evidence.id}\0${evidence.sourceKind}\0${evidence.relativeLocator}\0${evidence.digest?.algorithm ?? ''}\0${evidence.digest?.value ?? ''}`;
}

function meetsProof(minimum: GraphProofState | undefined, actual: GraphProofState): boolean {
  if (!minimum) return true;
  return PROOF_RANK[actual] >= PROOF_RANK[minimum];
}

function omittedFamilies(
  graph: GraphCanonicalGraph,
  profile: GraphProjectionProfile
): GraphProjectionOmittedFamilies {
  const entityKinds = new Set<string>();
  const relationSemantics = new Set<string>();
  const relations = new Set<string>();
  const allowedEntityKinds = new Set(profile.includeEntityKinds);
  const allowedSemantics = new Set(profile.includeRelationSemantics);
  const allowedRelations = profile.includeRelations ? new Set(profile.includeRelations) : undefined;
  for (const node of graph.nodes) {
    if (allowedEntityKinds.size > 0 && !allowedEntityKinds.has(node.kind)) {
      entityKinds.add(node.kind);
    }
  }
  for (const edge of graph.edges) {
    if (!allowedSemantics.has(edge.semantics)) relationSemantics.add(edge.semantics);
    if (allowedRelations && !allowedRelations.has(edge.relation)) relations.add(edge.relation);
  }
  return Object.freeze({
    entityKinds: Object.freeze([...entityKinds].sort((left, right) => left.localeCompare(right))),
    relationSemantics: Object.freeze(
      [...relationSemantics].sort((left, right) =>
        left.localeCompare(right)
      ) as GraphProjectionProfile['includeRelationSemantics']
    ),
    relations: Object.freeze([...relations].sort((left, right) => left.localeCompare(right))),
  });
}

function edgeMatchesProfile(
  edge: GraphEdge,
  profile: GraphProjectionProfile,
  nodesById: ReadonlyMap<string, GraphEntityReference>,
  withinScope: (entity: GraphEntityReference) => boolean
): boolean {
  if (!profile.includeRelationSemantics.includes(edge.semantics)) return false;
  if (profile.includeRelations && !profile.includeRelations.includes(edge.relation)) return false;
  if (!meetsProof(profile.minimumProof, edge.proof.state)) return false;
  if (profile.id === 'workspai.graph.projection.evidence' && edge.proof.evidence.length === 0) {
    return false;
  }
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) return false;
  if (!withinScope(from) || !withinScope(to)) return false;
  if (profile.includeEntityKinds.length === 0) return true;
  return (
    profile.includeEntityKinds.includes(from.kind) && profile.includeEntityKinds.includes(to.kind)
  );
}

/**
 * Builds a bounded deterministic projection that preserves canonical IDs and
 * source generation without mutating or replacing canonical graph truth.
 */
export function projectGraph(
  graph: GraphCanonicalGraph,
  quality: GraphQualityReport,
  request: GraphProjectionRequest
): GraphProjectionExecution {
  const budget = Object.freeze({ ...DEFAULT_BUDGET, ...request.budget });
  if (!validBudget(budget)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_PROJECTION_BUDGET_INVALID',
          path: '/budget',
          message: 'Projection budgets must be positive and within fixed safety ceilings.',
        },
      ],
    };
  }

  const profile = request.profile;
  if (profile.sourceGraphVersion !== graph.graphVersion) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_PROJECTION_SOURCE_VERSION_UNSUPPORTED',
          path: '/profile/sourceGraphVersion',
          message: 'Projection profile source version must match the immutable graph version.',
        },
      ],
    };
  }
  if (!admittedRedactionPolicy(profile.redactionPolicy)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_PROJECTION_REDACTION_POLICY_UNSUPPORTED',
          path: '/profile/redactionPolicy',
          message: 'Projection redaction policy is not admitted by this engine version.',
        },
      ],
    };
  }
  const redactionPolicy = profile.redactionPolicy;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const withinScope = createGraphScopePredicate(graph, request.scope);
  const candidateEdges = graph.edges
    .filter((edge) => edgeMatchesProfile(edge, profile, nodesById, withinScope))
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidateNodeIds = new Set<string>();
  for (const edge of candidateEdges) {
    candidateNodeIds.add(edge.from);
    candidateNodeIds.add(edge.to);
  }
  if (profile.includeEntityKinds.length > 0) {
    for (const node of graph.nodes) {
      if (profile.includeEntityKinds.includes(node.kind) && withinScope(node)) {
        candidateNodeIds.add(node.id);
      }
    }
  }
  const candidateNodes = graph.nodes
    .filter((node) => candidateNodeIds.has(node.id) && withinScope(node))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nodes = Object.freeze(candidateNodes.slice(0, budget.maxNodes));
  const retainedNodeIds = new Set(nodes.map((node) => node.id));
  const retainableEdges = candidateEdges.filter(
    (edge) => retainedNodeIds.has(edge.from) && retainedNodeIds.has(edge.to)
  );
  const edges = Object.freeze(
    retainableEdges
      .slice(0, budget.maxEdges)
      .map((edge) => redactGraphEdge(edge, redactionPolicy, true))
  );
  const uniqueEvidence = new Map<string, WisEvidenceReference>();
  if (
    profile.id === 'workspai.graph.projection.evidence' ||
    profile.includeRelationSemantics.length
  ) {
    for (const edge of edges) {
      for (const evidence of edge.proof.evidence) {
        const redacted = redactGraphEvidence(evidence, redactionPolicy);
        if (redacted) uniqueEvidence.set(evidenceKey(redacted), redacted);
      }
    }
  }
  const allEvidence = [...uniqueEvidence.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, evidence]) => evidence);
  const evidence = Object.freeze(allEvidence.slice(0, budget.maxEvidence));
  const reasons: ('nodes' | 'edges' | 'evidence')[] = [];
  if (candidateNodes.length > nodes.length) reasons.push('nodes');
  if (candidateEdges.length > edges.length) reasons.push('edges');
  if (allEvidence.length > evidence.length) reasons.push('evidence');
  const unresolvedZones = graph.unresolved.map((entry) => ({
    code: 'graph.projection-source-unresolved',
    scope: entry.id,
    reason: `Canonical graph retained ${entry.candidates.length} unresolved identity candidates.`,
  }));

  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_PROJECTION_RESULT_CONTRACT,
      profile: profileRef(profile),
      sourceGeneration: graph.generation.reference,
      nodes,
      edges,
      evidence,
      unknownZones: Object.freeze([...quality.unknownZones, ...unresolvedZones]),
      unsupportedZones: Object.freeze([...quality.unsupportedZones]),
      omitted: omittedFamilies(graph, profile),
      cost: Object.freeze({
        scannedNodes: graph.nodes.length,
        scannedEdges: graph.edges.length,
        returnedNodes: nodes.length,
        returnedEdges: edges.length,
        returnedEvidence: evidence.length,
      }),
      truncation: Object.freeze({ truncated: reasons.length > 0, reasons: Object.freeze(reasons) }),
    }),
    issues: [],
  };
}
