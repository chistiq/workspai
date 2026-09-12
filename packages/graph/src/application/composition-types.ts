import type { WisContractReference, WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphDerivationLineage,
  GraphDiagnostic,
  GraphEntityReference,
  GraphFactBatch,
  GraphOntologyRelationDefinition,
  GraphOntologyProfile,
  GraphProviderManifest,
  GraphQualityReport,
  GraphResolutionState,
  GraphValidationIssue,
  GraphWorkspaceFact,
} from '../contracts/index.js';

export interface GraphCompositionPolicy {
  readonly id: string;
  readonly version: string;
  readonly architectureEpoch: string;
  readonly minimumConfidence: number;
  readonly inferredClaims: 'reject' | 'accept-with-evidence';
  readonly unknownFreshness: 'reject' | 'accept-as-unresolved';
  readonly functionalRelations: readonly string[];
  readonly maxFacts: number;
  readonly maxEdges: number;
  readonly workerTimeoutMs: number;
  readonly maxWorkerOutputBytes: number;
}

export interface GraphCompositionSource {
  readonly manifest: GraphProviderManifest;
  readonly batch: GraphFactBatch;
}

export interface GraphCompositionRequest {
  readonly ontology: GraphOntologyProfile;
  readonly sources: readonly GraphCompositionSource[];
  readonly policy: GraphCompositionPolicy;
  readonly lineages?: readonly GraphDerivationLineage[];
  readonly previousGeneration?: { readonly id: string; readonly contentDigest: WisDigestReference };
}

export interface GraphCompositionDecision {
  readonly edgeKey: string;
  readonly state: GraphResolutionState;
  readonly includedInGraph: boolean;
  readonly factIds: readonly string[];
  readonly explanation: {
    readonly code: string;
    readonly drivers: readonly string[];
  };
}

/**
 * Portable output of the deterministic reference-composition worker task.
 * The application boundary validates this untrusted transport value against
 * the admitted FactBatch inputs before it can influence a canonical graph.
 */
export interface GraphReferenceCompositionTaskOutput {
  readonly nodes: readonly GraphEntityReference[];
  readonly candidates: readonly {
    readonly key: string;
    readonly relation: GraphOntologyRelationDefinition;
    readonly from: GraphEntityReference;
    readonly to: GraphEntityReference;
    readonly facts: readonly { readonly fact: GraphWorkspaceFact }[];
  }[];
  readonly decisions: readonly GraphCompositionDecision[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
}

export interface GraphCompositionOutput {
  readonly graph: GraphCanonicalGraph;
  readonly quality: GraphQualityReport;
  readonly decisions: readonly GraphCompositionDecision[];
  readonly semanticDigests: {
    readonly ontology: WisDigestReference;
    readonly proofPolicies: WisDigestReference;
    readonly inputs: WisDigestReference;
    readonly facts: WisDigestReference;
    readonly providers: WisDigestReference;
    readonly compositionPolicy: WisDigestReference;
  };
}

export type GraphCompositionResult =
  | {
      readonly accepted: true;
      readonly value: GraphCompositionOutput;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly code: 'invalid-input' | 'cancelled' | 'resource-limit' | 'composition-failed';
      readonly issues: readonly GraphValidationIssue[];
    };

export const GRAPH_STANDARD_COMPOSITION_POLICY: Readonly<GraphCompositionPolicy> = Object.freeze({
  id: 'workspai.graph.composition.standard',
  version: '0.1.0-candidate',
  architectureEpoch: 'wis-graph-1',
  minimumConfidence: 0.5,
  inferredClaims: 'reject',
  unknownFreshness: 'accept-as-unresolved',
  functionalRelations: Object.freeze([]),
  maxFacts: 1_000_000,
  maxEdges: 5_000_000,
  workerTimeoutMs: 30_000,
  maxWorkerOutputBytes: 256 * 1024 * 1024,
});

export const GRAPH_STANDARD_PROOF_POLICY: Readonly<WisContractReference> = Object.freeze({
  id: 'workspai.graph.proof.standard',
  version: '1',
});
