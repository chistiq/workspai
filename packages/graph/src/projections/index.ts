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

import { projectGraph } from './project-graph.js';
import {
  GRAPH_STANDARD_PROJECTION_PROFILES,
  type GraphStandardProjectionProfileId,
} from './projection-profiles.js';

export {
  GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT,
  buildReviewContextSlice,
  type GraphReviewContextSliceBudget,
  type GraphReviewContextSliceExecution,
  type GraphReviewContextSliceResult,
} from './review-context-slice.js';
export {
  GRAPH_STANDARD_PROJECTION_PROFILES,
  type GraphStandardProjectionProfileId,
} from './projection-profiles.js';
export {
  GRAPH_DERIVED_PROJECTION_PROFILES,
  type GraphDerivedProjectionProfileId,
} from './derived-projection-profiles.js';
export { projectGraph } from './project-graph.js';
export { projectDerivedGraph } from './project-derived-graph.js';
export { createGraphSlice } from './create-graph-slice.js';

/** Profile-driven projections are available for bounded read views over canonical graphs. */
export const GRAPH_PROJECTIONS_AVAILABLE = true as const;
/** Derived analytics profiles are available without mutating canonical graph truth. */
export const GRAPH_DERIVED_PROJECTIONS_AVAILABLE = true as const;
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

function profile(view: GraphRepositoryPreviewView): WisContractReference {
  return Object.freeze({
    id: `workspai.graph.repository-preview.${view}`,
    version: GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT.version,
  });
}

const PREVIEW_PROFILE_BY_VIEW = Object.freeze({
  source: 'source',
  structural: 'structural',
  evidence: 'evidence',
} as const satisfies Record<GraphRepositoryPreviewView, GraphStandardProjectionProfileId>);

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
  const projected = projectGraph(graph, quality, {
    profile: GRAPH_STANDARD_PROJECTION_PROFILES[PREVIEW_PROFILE_BY_VIEW[view]],
    budget: requestedBudget,
  });
  if (!projected.accepted) return projected;
  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT,
      profile: profile(view),
      sourceGeneration: projected.value.sourceGeneration,
      view,
      nodes: projected.value.nodes,
      edges: projected.value.edges,
      evidence: projected.value.evidence,
      unknownZones: projected.value.unknownZones,
      unsupportedZones: projected.value.unsupportedZones,
      cost: projected.value.cost,
      truncation: projected.value.truncation,
    }),
    issues: [],
  };
}
