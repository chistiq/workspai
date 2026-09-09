import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphEdge,
  GraphEntityReference,
  GraphGenerationRef,
  GraphQualityReport,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../contracts/index.js';

export {
  GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT,
  buildReviewContextSlice,
  type GraphReviewContextSliceBudget,
  type GraphReviewContextSliceExecution,
  type GraphReviewContextSliceResult,
} from './review-context-slice.js';

/** Generic profile-driven projections remain a G5 capability. */
export const GRAPH_PROJECTIONS_AVAILABLE = false as const;
/** G4 exposes only these fixed, non-authoritative repository preview views. */
export const GRAPH_REPOSITORY_PREVIEW_VIEWS_AVAILABLE = true as const;

export const GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT = defineWisContract({
  id: 'workspai.graph.repository-preview-view',
  version: '0.1.0-candidate',
});

export type GraphRepositoryPreviewView = 'source' | 'structural' | 'evidence';

export interface GraphRepositoryPreviewViewBudget {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}

export interface GraphRepositoryPreviewViewResult {
  readonly contract: typeof GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT;
  readonly profile: WisContractReference;
  readonly sourceGeneration: GraphGenerationRef;
  readonly view: GraphRepositoryPreviewView;
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly WisEvidenceReference[];
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly cost: {
    readonly scannedNodes: number;
    readonly scannedEdges: number;
    readonly returnedNodes: number;
    readonly returnedEdges: number;
    readonly returnedEvidence: number;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reasons: readonly ('nodes' | 'edges' | 'evidence')[];
  };
}

export type GraphRepositoryPreviewViewExecution =
  | {
      readonly accepted: true;
      readonly value: GraphRepositoryPreviewViewResult;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };

const DEFAULT_BUDGET: GraphRepositoryPreviewViewBudget = Object.freeze({
  maxNodes: 5_000,
  maxEdges: 10_000,
  maxEvidence: 5_000,
});
const MAX_BUDGET: GraphRepositoryPreviewViewBudget = Object.freeze({
  maxNodes: 100_000,
  maxEdges: 500_000,
  maxEvidence: 100_000,
});
const SOURCE_KINDS = new Set([
  'repository',
  'project',
  'module',
  'package',
  'file',
  'symbol',
  'branch',
  'revision',
]);

function profile(view: GraphRepositoryPreviewView): WisContractReference {
  return Object.freeze({
    id: `workspai.graph.repository-preview.${view}`,
    version: GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT.version,
  });
}

function evidenceKey(evidence: WisEvidenceReference): string {
  return `${evidence.id}\0${evidence.sourceKind}\0${evidence.relativeLocator}\0${evidence.digest?.algorithm ?? ''}\0${evidence.digest?.value ?? ''}`;
}

function validBudget(budget: GraphRepositoryPreviewViewBudget): boolean {
  return (Object.keys(MAX_BUDGET) as (keyof GraphRepositoryPreviewViewBudget)[]).every(
    (key) => Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= MAX_BUDGET[key]
  );
}

/**
 * Produces one bounded deterministic G4 view without changing canonical graph
 * identity, proof, state or generation authority.
 */
export function projectRepositoryPreview(
  graph: GraphCanonicalGraph,
  quality: GraphQualityReport,
  view: GraphRepositoryPreviewView,
  requestedBudget: Partial<GraphRepositoryPreviewViewBudget> = {}
): GraphRepositoryPreviewViewExecution {
  const budget = Object.freeze({ ...DEFAULT_BUDGET, ...requestedBudget });
  if (!validBudget(budget)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_REPOSITORY_PREVIEW_VIEW_BUDGET_INVALID',
          path: '/budget',
          message:
            'Repository preview view budgets must be positive and within fixed safety ceilings.',
        },
      ],
    };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const candidateEdges = graph.edges
    .filter((edge) => {
      if (view === 'structural') return edge.semantics === 'structural';
      if (view === 'evidence') return edge.proof.evidence.length > 0;
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      return Boolean(from && to && SOURCE_KINDS.has(from.kind) && SOURCE_KINDS.has(to.kind));
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidateNodeIds = new Set<string>();
  for (const edge of candidateEdges) {
    candidateNodeIds.add(edge.from);
    candidateNodeIds.add(edge.to);
  }
  if (view === 'source') {
    for (const node of graph.nodes) if (SOURCE_KINDS.has(node.kind)) candidateNodeIds.add(node.id);
  }
  const candidateNodes = graph.nodes
    .filter((node) => candidateNodeIds.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nodes = Object.freeze(candidateNodes.slice(0, budget.maxNodes));
  const retainedNodeIds = new Set(nodes.map((node) => node.id));
  const retainableEdges = candidateEdges.filter(
    (edge) => retainedNodeIds.has(edge.from) && retainedNodeIds.has(edge.to)
  );
  const edges = Object.freeze(retainableEdges.slice(0, budget.maxEdges));
  const uniqueEvidence = new Map<string, WisEvidenceReference>();
  for (const edge of edges) {
    for (const evidence of edge.proof.evidence) uniqueEvidence.set(evidenceKey(evidence), evidence);
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
    code: 'graph.repository-preview-source-unresolved',
    scope: entry.id,
    reason: `Canonical graph retained ${entry.candidates.length} unresolved identity candidates.`,
  }));

  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT,
      profile: profile(view),
      sourceGeneration: graph.generation.reference,
      view,
      nodes,
      edges,
      evidence,
      unknownZones: Object.freeze([...quality.unknownZones, ...unresolvedZones]),
      unsupportedZones: Object.freeze([...quality.unsupportedZones]),
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
