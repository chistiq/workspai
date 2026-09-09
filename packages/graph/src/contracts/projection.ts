import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';
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
