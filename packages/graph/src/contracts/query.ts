import type {
  WisContractReference,
  WisDigestReference,
  WisEvidenceReference,
  WisFreshnessSummary,
} from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type {
  GraphClaimAuthority,
  GraphDiagnostic,
  GraphEntityReference,
  GraphFactFreshness,
  GraphScope,
  GraphUnknownZone,
} from './foundation.js';
import type {
  GraphEdge,
  GraphEdgeProof,
  GraphGenerationRef,
  GraphProofState,
  GraphQueryBudget,
  GraphQueryCacheObservation,
  GraphResolutionState,
} from './graph.js';
import type { GraphRelationSemantics } from './provider.js';

export const GRAPH_PROOF_POLICY_CONTRACT = defineWisContract({
  id: 'workspai.graph.proof-policy',
  version: '0.1.0-candidate',
});
export const GRAPH_BINDING_PROFILE_CONTRACT = defineWisContract({
  id: 'workspai.graph.binding-profile',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_CONTRACT = defineWisContract({
  id: 'workspai.graph.query',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_RESULT_CONTRACT = defineWisContract({
  id: 'workspai.graph.query-result',
  version: '0.1.0-candidate',
});
export const GRAPH_RETRIEVAL_PLAN_CONTRACT = defineWisContract({
  id: 'workspai.graph.retrieval-plan',
  version: '0.1.0-candidate',
});

export interface GraphProofPolicy {
  readonly contract: typeof GRAPH_PROOF_POLICY_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly minimumAuthority: GraphClaimAuthority;
  readonly minimumIndependentRoots: number;
  readonly verificationRequired: boolean;
  readonly allowDisputed: boolean;
  readonly allowStale: boolean;
}

export interface GraphBindingStep {
  readonly relations: readonly string[];
  readonly direction: 'outgoing' | 'incoming' | 'both';
  readonly semantics: readonly GraphRelationSemantics[];
  readonly targetKinds?: readonly string[];
}

export interface GraphBindingProfile {
  readonly contract: typeof GRAPH_BINDING_PROFILE_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly sourceKinds: readonly string[];
  readonly steps: readonly GraphBindingStep[];
  readonly minimumProof: GraphProofState;
}

export type GraphQueryKind =
  | 'dependencies'
  | 'owners'
  | 'impact'
  | 'entry-points'
  | 'related'
  | 'cycles'
  | 'evidence'
  | 'path'
  | 'bindings'
  | 'operational-risk'
  | 'contract-topology'
  | 'architecture-conformance';

export const GRAPH_QUERY_STRATEGIES = ['direct', 'graph', 'hybrid', 'auto'] as const;
export type GraphQueryStrategy = (typeof GRAPH_QUERY_STRATEGIES)[number];

export const GRAPH_EXECUTABLE_QUERY_STRATEGIES = ['direct', 'graph', 'hybrid'] as const;
export type GraphExecutableQueryStrategy = (typeof GRAPH_EXECUTABLE_QUERY_STRATEGIES)[number];

/** Approximate retrieval may plan later; it is never a query strategy or reuse authority. */
export const GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES = [
  'similarity',
  'vector',
  'knn',
  'embedding',
] as const;
export type GraphProhibitedRetrievalStrategy =
  (typeof GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES)[number];

export interface GraphQueryPage {
  readonly cursor?: string;
  readonly size: number;
}

export interface GraphQuery {
  readonly contract: typeof GRAPH_QUERY_CONTRACT;
  readonly kind: GraphQueryKind;
  readonly subject?: string;
  readonly target?: string;
  readonly scope?: GraphScope;
  readonly direction?: 'outgoing' | 'incoming' | 'both';
  readonly relations?: readonly string[];
  readonly minimumProof?: GraphProofState;
  readonly includeDisputed?: boolean;
  readonly strategy?: GraphQueryStrategy;
  readonly bindingProfile?: WisContractReference;
  readonly utilityProfile?: WisContractReference;
  readonly budget?: Partial<GraphQueryBudget>;
  readonly page?: GraphQueryPage;
}

export interface GraphNormalizedQuery extends Omit<GraphQuery, 'budget' | 'page' | 'strategy'> {
  readonly direction: 'outgoing' | 'incoming' | 'both';
  readonly relations: readonly string[];
  readonly minimumProof: GraphProofState;
  readonly includeDisputed: boolean;
  readonly strategy: Exclude<GraphQueryStrategy, 'auto'>;
  readonly budget: GraphQueryBudget;
  readonly page: GraphQueryPage;
}

export interface GraphProofPathHop {
  readonly edgeId: string;
  readonly from: GraphEntityReference;
  readonly to: GraphEntityReference;
  readonly relation: string;
  readonly semantics: GraphRelationSemantics;
  readonly traversal: 'outgoing' | 'incoming';
  readonly decision: GraphResolutionState;
  readonly derivations: GraphEdge['derivations'];
  readonly proof: GraphEdgeProof;
  readonly evidence: readonly WisEvidenceReference[];
  readonly freshness: GraphFactFreshness;
  readonly confidence: number;
}

export interface GraphPath {
  readonly pathId: string;
  readonly nodes: readonly GraphEntityReference[];
  readonly hops: readonly GraphProofPathHop[];
  readonly sourceGeneration: GraphGenerationRef;
  readonly semantics: 'structural' | 'behavioral' | 'declarative' | 'derived' | 'mixed';
  readonly proofSummary: Readonly<Record<GraphProofState, number>>;
  readonly unknownBoundaries: readonly GraphUnknownZone[];
}

export interface GraphRetrievalCandidate {
  readonly strategy: Exclude<GraphQueryStrategy, 'auto'>;
  readonly eligible: boolean;
  readonly estimatedEdgeVisits: number;
  readonly sufficiency: 'sufficient' | 'insufficient' | 'unknown';
  readonly reasons: readonly string[];
}

export interface GraphRetrievalPlan {
  readonly contract: typeof GRAPH_RETRIEVAL_PLAN_CONTRACT;
  readonly profile: WisContractReference;
  readonly candidates: readonly GraphRetrievalCandidate[];
  readonly selected: Exclude<GraphQueryStrategy, 'auto'>;
  readonly fallbackReason?: string;
  readonly budget: GraphQueryBudget;
}

export interface GraphRetrievalUtility {
  readonly profile: WisContractReference;
  readonly baseline: string;
  readonly status: 'measured' | 'not-assessed';
  readonly sufficient: boolean;
  readonly drivers: readonly string[];
  readonly limitations: readonly string[];
}

export interface GraphQueryCost {
  readonly visitedNodes: number;
  readonly visitedEdges: number;
  readonly returnedPaths: number;
  readonly returnedEvidence: number;
}

export interface GraphQueryTruncation {
  readonly truncated: boolean;
  readonly reasons: readonly ('depth' | 'nodes' | 'edges' | 'evidence' | 'page')[];
  readonly nextCursor?: string;
}

export interface GraphBindingCompleteness {
  readonly profile: WisContractReference;
  readonly eligibleSubjects: number;
  readonly completeSubjects: number;
  readonly ratio?: number;
  readonly status: 'complete' | 'partial' | 'unknown' | 'not-applicable';
}

export interface GraphQueryQuality {
  readonly proofStates: Readonly<Record<GraphProofState, number>>;
  readonly bindingCompleteness: readonly GraphBindingCompleteness[];
}

export interface GraphAnalyticalResultDescriptor {
  readonly profile: WisContractReference;
  readonly algorithm: WisContractReference & { readonly seed?: string };
  readonly sourceGeneration: GraphGenerationRef;
  readonly proofThreshold: GraphProofState;
  readonly capability: 'assessed' | 'unsupported' | 'unassessed';
  readonly circularity: 'none' | 'graph-derived';
  readonly accuracyClaim: 'none' | 'validated';
  readonly drivers: readonly string[];
  readonly limitations: readonly string[];
  readonly validationEvidence: readonly WisEvidenceReference[];
}

export interface GraphOperationalRiskResult {
  readonly subject: GraphEntityReference;
  readonly score: number | null;
  readonly classification: 'low' | 'moderate' | 'high' | 'critical' | 'unassessed';
  readonly consequenceSemantics: 'structural' | 'behavioral' | 'mixed' | 'indeterminate';
  readonly drivers: readonly string[];
  readonly limitations: readonly string[];
}

export interface GraphQueryResult<T = readonly GraphEntityReference[]> {
  readonly contract: typeof GRAPH_QUERY_RESULT_CONTRACT;
  readonly query: GraphNormalizedQuery;
  readonly queryDigest: WisDigestReference;
  readonly generation: GraphGenerationRef;
  readonly result: T;
  readonly paths: readonly GraphPath[];
  readonly evidence: readonly WisEvidenceReference[];
  readonly disputes: readonly { readonly id: string; readonly factIds: readonly string[] }[];
  readonly unknownBoundaries: readonly GraphUnknownZone[];
  readonly freshness: WisFreshnessSummary;
  readonly confidence: number;
  readonly cost: GraphQueryCost;
  readonly retrievalPlan: GraphRetrievalPlan;
  readonly utility: GraphRetrievalUtility;
  readonly quality: GraphQueryQuality;
  readonly analysis: GraphAnalyticalResultDescriptor;
  readonly truncation: GraphQueryTruncation;
  readonly diagnostics: readonly GraphDiagnostic[];
}

export type GraphQueryExecutionResult<T = readonly GraphEntityReference[]> =
  | {
      readonly accepted: true;
      readonly value: GraphQueryResult<T>;
      readonly issues: readonly [];
      readonly cache?: GraphQueryCacheObservation;
    }
  | {
      readonly accepted: false;
      readonly code: 'invalid-query' | 'resource-limit' | 'unsupported';
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };
