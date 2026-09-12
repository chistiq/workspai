import type {
  WisContractReference,
  WisDigestReference,
  WisEvidenceReference,
  WisFreshnessSummary,
  WisGenerationReference,
} from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type {
  GraphClaimAuthority,
  GraphClaimDerivation,
  GraphDiagnostic,
  GraphEntityReference,
  GraphFactFreshness,
  GraphScope,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from './foundation.js';
import type { GraphRelationSemantics } from './provider.js';

export const GRAPH_ONTOLOGY_PROFILE_CONTRACT = defineWisContract({
  id: 'workspai.graph.ontology-profile',
  version: '0.1.0-candidate',
});
export const GRAPH_CANONICAL_GRAPH_CONTRACT = defineWisContract({
  id: 'workspai.graph.canonical-graph',
  version: '0.1.0-candidate',
});
export const GRAPH_QUALITY_CONTRACT = defineWisContract({
  id: 'workspai.graph.quality',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_CACHE_CONTRACT = defineWisContract({
  id: 'workspai.graph.query-cache',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_CACHE_ENTRY_CONTRACT = defineWisContract({
  id: 'workspai.graph.query-cache-entry',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_CACHE_REUSE_CONTRACT = defineWisContract({
  id: 'workspai.graph.query-cache-reuse',
  version: '0.1.0-candidate',
});
export const GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT = defineWisContract({
  id: 'workspai.graph.query-cache-invalidation',
  version: '0.1.0-candidate',
});
export const GRAPH_NARY_ASSERTION_CONTRACT = defineWisContract({
  id: 'workspai.graph.nary-assertion',
  version: '0.1.0-candidate',
});

export type GraphProofState =
  'supported' | 'corroborated' | 'verified' | 'disputed' | 'insufficient' | 'unresolved';
export type GraphResolutionState = 'accepted' | 'disputed' | 'rejected' | 'unresolved';

export interface GraphOntologyEntityDefinition {
  readonly kind: string;
  readonly family: string;
  readonly extensionNamespace?: string;
}

export interface GraphOntologyRelationDefinition {
  readonly kind: string;
  readonly semantics: GraphRelationSemantics;
  readonly subjectFamilies: readonly string[];
  readonly objectFamilies: readonly string[];
  readonly inverse?: string;
  readonly symmetric: boolean;
  readonly transitive: boolean;
  readonly allowedAuthorities: readonly GraphClaimAuthority[];
  readonly proofPolicy: WisContractReference;
  readonly extensionNamespace?: string;
}

export interface GraphOntologyProfile {
  readonly contract: typeof GRAPH_ONTOLOGY_PROFILE_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly extends?: readonly WisContractReference[];
  readonly entities: readonly GraphOntologyEntityDefinition[];
  readonly relations: readonly GraphOntologyRelationDefinition[];
}

export interface GraphGenerationRef extends WisGenerationReference {
  readonly contentDigest: WisDigestReference;
}

export interface GraphGeneration {
  readonly reference: GraphGenerationRef;
  readonly graphSchema: WisContractReference;
  readonly architectureEpoch: string;
  readonly ontologySetDigest: WisDigestReference;
  readonly proofPolicySetDigest: WisDigestReference;
  readonly inputsDigest: WisDigestReference;
  readonly factSetDigest: WisDigestReference;
  readonly providerSetDigest: WisDigestReference;
  readonly compositionPolicyDigest: WisDigestReference;
}

export interface GraphPublicationManifest {
  readonly generation: GraphGeneration;
  readonly artifactDigest: WisDigestReference;
  readonly qualityDigest: WisDigestReference;
  readonly publication: 'staged' | 'committed';
  readonly previousGeneration?: GraphGenerationRef;
}

export interface GraphModelGenerationBinding {
  readonly graphGeneration: GraphGenerationRef;
  readonly modelGeneration: GraphGenerationRef;
  readonly architectureEpoch: string;
}

export interface GraphEvidenceGroup {
  readonly root: string;
  readonly evidence: readonly WisEvidenceReference[];
}

export interface GraphEdgeProof {
  readonly policy: WisContractReference;
  readonly state: GraphProofState;
  readonly evidence: readonly WisEvidenceReference[];
  readonly authorities: readonly GraphClaimAuthority[];
  readonly corroborationGroups: readonly GraphEvidenceGroup[];
  readonly counterEvidence: readonly WisEvidenceReference[];
  readonly missingRequirements: readonly string[];
  readonly evaluatedAt: string;
  readonly inputDigest: WisDigestReference;
  readonly explanationCode: string;
}

export interface GraphEdge {
  readonly id: string;
  readonly relation: string;
  readonly semantics: GraphRelationSemantics;
  readonly from: string;
  readonly to: string;
  readonly state: GraphResolutionState;
  readonly facts: readonly string[];
  readonly derivations: readonly GraphClaimDerivation[];
  readonly proof: GraphEdgeProof;
  readonly freshness: GraphFactFreshness;
  readonly confidence: number;
  readonly explanation: { readonly code: string; readonly drivers: readonly string[] };
}

export interface GraphNaryParticipant {
  readonly role: string;
  readonly entity: GraphEntityReference;
  readonly ordinal?: number;
}

export interface GraphNaryRelationAssertion {
  readonly contract: typeof GRAPH_NARY_ASSERTION_CONTRACT;
  readonly id: string;
  readonly relation: string;
  readonly profile: WisContractReference;
  readonly participants: readonly GraphNaryParticipant[];
  readonly facts: readonly string[];
  readonly derivation: GraphClaimDerivation;
  readonly state: GraphResolutionState;
  readonly proof: GraphEdgeProof;
  readonly freshness: GraphFactFreshness;
  readonly confidence: number;
}

export interface GraphCanonicalGraph {
  readonly contract: typeof GRAPH_CANONICAL_GRAPH_CONTRACT;
  readonly graphVersion: string;
  readonly generation: GraphGeneration;
  readonly ontology: readonly WisContractReference[];
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly assertions: readonly GraphNaryRelationAssertion[];
  readonly disputes: readonly { readonly id: string; readonly factIds: readonly string[] }[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

export type GraphQualityVerdict = 'pass' | 'attention' | 'blocked' | 'not-assessed';
export interface GraphQualityReport {
  readonly contract: typeof GRAPH_QUALITY_CONTRACT;
  readonly generation: GraphGenerationRef;
  readonly integrity: GraphQualityVerdict;
  readonly determinism: GraphQualityVerdict;
  readonly incrementalEquivalence: GraphQualityVerdict;
  readonly coverage: readonly {
    readonly dimension: string;
    readonly ratio?: number;
    readonly status: GraphQualityVerdict;
  }[];
  readonly proofStates: Readonly<Record<GraphProofState, number>>;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly staleZones: readonly { readonly scope: string; readonly reason: string }[];
  readonly conflicts: readonly { readonly id: string; readonly factIds: readonly string[] }[];
  readonly orphans: readonly GraphEntityReference[];
  readonly providerFailures: readonly { readonly providerId: string; readonly code: string }[];
  readonly releaseClaims: readonly string[];
}

export interface GraphQueryBudget {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}

export interface GraphQueryCacheKey {
  readonly contract: typeof GRAPH_QUERY_CACHE_CONTRACT;
  readonly graphGeneration: GraphGenerationRef;
  readonly queryDigest: WisDigestReference;
  readonly ontologyDigest: WisDigestReference;
  readonly proofPolicyDigest: WisDigestReference;
  readonly profileDigest: WisDigestReference;
  readonly plannerProfileDigest: WisDigestReference;
  readonly resultProfileDigest: WisDigestReference;
  readonly projectionDigests: readonly WisDigestReference[];
  readonly indexDigests: readonly WisDigestReference[];
  readonly requiredExtensions: readonly WisContractReference[];
  readonly overlayDigest?: WisDigestReference;
  readonly scope: GraphScope;
  readonly redactionPolicyDigest: WisDigestReference;
  readonly authorizationDigest: WisDigestReference;
  readonly budget: GraphQueryBudget;
  readonly page?: { readonly cursor: string; readonly size: number };
}

export type GraphQueryCacheObservationStatus =
  'hit' | 'miss' | 'stale' | 'denied' | 'incompatible' | 'corrupt' | 'unavailable';

/** Host-store observation. Never changes the semantic GraphQueryResult payload. */
export interface GraphQueryCacheObservation {
  readonly status: GraphQueryCacheObservationStatus;
  readonly keyDigest?: WisDigestReference;
  readonly reasons?: readonly string[];
}

export interface GraphQueryCacheEntry<T = unknown> {
  readonly contract: typeof GRAPH_QUERY_CACHE_ENTRY_CONTRACT;
  readonly keyDigest: WisDigestReference;
  readonly key: GraphQueryCacheKey;
  readonly result: T;
  readonly resultDigest: WisDigestReference;
  readonly freshness: WisFreshnessSummary;
}

export type GraphQueryCacheReuseDecision =
  | {
      readonly contract: typeof GRAPH_QUERY_CACHE_REUSE_CONTRACT;
      readonly reusable: true;
      readonly status: 'exact';
      readonly entryDigest: WisDigestReference;
    }
  | {
      readonly contract: typeof GRAPH_QUERY_CACHE_REUSE_CONTRACT;
      readonly reusable: false;
      readonly status: 'miss' | 'stale' | 'denied' | 'incompatible' | 'corrupt';
      readonly reasons: readonly string[];
    };

export interface GraphQueryCacheInvalidation {
  readonly contract: typeof GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT;
  readonly keyDigests: readonly WisDigestReference[];
  readonly reason:
    | 'generation'
    | 'ontology'
    | 'proof-policy'
    | 'profile'
    | 'scope'
    | 'redaction'
    | 'authorization'
    | 'corruption';
}
