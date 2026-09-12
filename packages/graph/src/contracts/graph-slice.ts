import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type { GraphEntityReference, GraphScope, GraphUnknownZone } from './foundation.js';
import type { GraphEdge, GraphGenerationRef, GraphQueryBudget } from './graph.js';
import type { GraphPath, GraphQueryQuality } from './query.js';

export const GRAPH_SLICE_REQUEST_CONTRACT = defineWisContract({
  id: 'workspai.graph.slice-request',
  version: '0.1.0-candidate',
});

export const GRAPH_SLICE_RESULT_CONTRACT = defineWisContract({
  id: 'workspai.graph.slice-result',
  version: '0.1.0-candidate',
});

export type GraphSliceIntent = 'understand' | 'impact' | 'review' | 'repair' | 'release';

export interface GraphSliceBudget extends GraphQueryBudget {
  readonly maxPaths?: number;
  readonly tokenEstimate?: number;
  readonly maxContentBytes?: number;
}

export interface GraphSliceRequest {
  readonly contract: typeof GRAPH_SLICE_REQUEST_CONTRACT;
  readonly intent: GraphSliceIntent;
  readonly subjects: readonly string[];
  readonly scope?: GraphScope;
  readonly budget?: Partial<GraphSliceBudget>;
  readonly includeEvidence: boolean;
  readonly redactionPolicy: string;
}

export interface GraphSliceSelectionExplanation {
  readonly intent: GraphSliceIntent;
  readonly seedSubjects: readonly string[];
  readonly excludedSubjects: readonly string[];
  readonly selectionOrder: readonly ('subjects' | 'neighbors' | 'paths' | 'evidence')[];
}

export interface GraphSliceResult {
  readonly contract: typeof GRAPH_SLICE_RESULT_CONTRACT;
  readonly profile: WisContractReference;
  readonly sourceGeneration: GraphGenerationRef;
  readonly request: Pick<
    GraphSliceRequest,
    'intent' | 'subjects' | 'scope' | 'includeEvidence' | 'redactionPolicy'
  >;
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly paths: readonly GraphPath[];
  readonly evidence: readonly WisEvidenceReference[];
  readonly unknownBoundaries: readonly GraphUnknownZone[];
  readonly proofSummary: GraphQueryQuality['proofStates'];
  readonly quality: GraphQueryQuality;
  readonly explanation: GraphSliceSelectionExplanation;
  readonly cost: {
    readonly scannedNodes: number;
    readonly scannedEdges: number;
    readonly returnedNodes: number;
    readonly returnedEdges: number;
    readonly returnedPaths: number;
    readonly returnedEvidence: number;
    readonly contentBytes: number;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reasons: readonly (
      'nodes' | 'edges' | 'paths' | 'evidence' | 'depth' | 'content-bytes'
    )[];
  };
}

export type GraphSliceExecution =
  | { readonly accepted: true; readonly value: GraphSliceResult; readonly issues: readonly [] }
  | {
      readonly accepted: false;
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };
