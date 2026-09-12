import type {
  WisContractReference,
  WisEvidenceReference,
  WisOmission,
} from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type {
  GraphScope,
  GraphUnknownZone,
  GraphUnsupportedZone,
  GraphEntityReference,
} from './foundation.js';
import type { GraphEdge, GraphGenerationRef, GraphProofState } from './graph.js';
import type { GraphRelationSemantics } from './provider.js';

export const GRAPH_PROJECTION_PROFILE_CONTRACT = defineWisContract({
  id: 'workspai.graph.projection-profile',
  version: '0.1.0-candidate',
});

export const GRAPH_PROJECTION_RESULT_CONTRACT = defineWisContract({
  id: 'workspai.graph.projection-result',
  version: '0.1.0-candidate',
});

export interface GraphProjectionBudget {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}

/** Declares a deterministic read view over one canonical graph generation. */
export interface GraphProjectionProfile {
  readonly id: string;
  readonly version: string;
  readonly sourceGraphVersion: string;
  readonly includeEntityKinds: readonly string[];
  readonly includeRelationSemantics: readonly GraphRelationSemantics[];
  readonly includeRelations?: readonly string[];
  readonly minimumProof?: GraphProofState;
  readonly redactionPolicy: string;
}

export interface GraphProjectionRequest {
  readonly profile: GraphProjectionProfile;
  readonly budget?: Partial<GraphProjectionBudget>;
  readonly scope?: GraphScope;
}

export interface GraphProjectionOmittedFamilies {
  readonly entityKinds: readonly string[];
  readonly relationSemantics: readonly GraphRelationSemantics[];
  readonly relations: readonly string[];
}

export interface GraphProjectionResult {
  readonly contract: typeof GRAPH_PROJECTION_RESULT_CONTRACT;
  readonly profile: WisContractReference;
  readonly sourceGeneration: GraphGenerationRef;
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly WisEvidenceReference[];
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly omitted: GraphProjectionOmittedFamilies;
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

export type GraphProjectionExecution =
  | { readonly accepted: true; readonly value: GraphProjectionResult; readonly issues: readonly [] }
  | {
      readonly accepted: false;
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };

export const GRAPH_DERIVED_PROJECTION_PROFILE_CONTRACT = defineWisContract({
  id: 'workspai.graph.derived-projection-profile',
  version: '0.1.0-candidate',
});

export const GRAPH_DERIVED_PROJECTION_RESULT_CONTRACT = defineWisContract({
  id: 'workspai.graph.derived-projection-result',
  version: '0.1.0-candidate',
});

export type GraphDerivedProjectionKind =
  'community' | 'flow' | 'review-risk' | 'architecture-summary';

/** Versioned analytical profile that cannot mutate canonical graph truth. */
export interface GraphDerivedProjectionProfile {
  readonly id: string;
  readonly version: string;
  readonly kind: GraphDerivedProjectionKind;
  readonly algorithm: WisContractReference & { readonly seed: string };
  readonly proofThreshold: GraphProofState;
  readonly limitations: readonly string[];
  readonly redactionPolicy: string;
}

export interface GraphDerivedProjectionDescriptor {
  readonly profile: WisContractReference;
  readonly algorithm: WisContractReference & { readonly seed: string };
  readonly sourceGeneration: GraphGenerationRef;
  readonly proofThreshold: GraphProofState;
  readonly limitations: readonly string[];
  readonly omissions: readonly WisOmission[];
  readonly accuracyEvidence?: readonly WisEvidenceReference[];
}

export interface GraphDerivedProjectionBudget {
  readonly maxItems: number;
}

export interface GraphDerivedProjectionRequest {
  readonly profile: GraphDerivedProjectionProfile;
  readonly budget?: Partial<GraphDerivedProjectionBudget>;
  readonly scope?: GraphScope;
}

export interface GraphDerivedCommunityGroup {
  readonly id: string;
  readonly members: readonly string[];
  readonly cohesion: number;
}

export interface GraphDerivedFlowRank {
  readonly entityId: string;
  readonly rank: number;
  readonly score: number;
  readonly drivers: readonly string[];
}

export interface GraphDerivedReviewRiskFinding {
  readonly entityId: string;
  readonly score: number;
  readonly classification: 'low' | 'moderate' | 'high' | 'advisory';
  readonly drivers: readonly string[];
}

export interface GraphDerivedArchitectureMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodesByKind: Readonly<Record<string, number>>;
  readonly edgesBySemantics: Readonly<Record<string, number>>;
}

export interface GraphDerivedArchitectureHotspot {
  readonly entityId: string;
  readonly degree: number;
}

export interface GraphDerivedProjectionResult {
  readonly contract: typeof GRAPH_DERIVED_PROJECTION_RESULT_CONTRACT;
  readonly descriptor: GraphDerivedProjectionDescriptor;
  readonly kind: GraphDerivedProjectionKind;
  readonly communities?: readonly GraphDerivedCommunityGroup[];
  readonly flowRanks?: readonly GraphDerivedFlowRank[];
  readonly reviewFindings?: readonly GraphDerivedReviewRiskFinding[];
  readonly architecture?: {
    readonly metrics: GraphDerivedArchitectureMetrics;
    readonly hotspots: readonly GraphDerivedArchitectureHotspot[];
  };
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly truncation: {
    readonly truncated: boolean;
    readonly reasons: readonly 'items'[];
  };
}

export type GraphDerivedProjectionExecution =
  | {
      readonly accepted: true;
      readonly value: GraphDerivedProjectionResult;
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
