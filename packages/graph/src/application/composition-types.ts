import type { WisContractReference, WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  type GraphCanonicalGraph,
  type GraphDerivationLineage,
  type GraphDiagnostic,
  type GraphEntityReference,
  type GraphFactBatch,
  type GraphOntologyRelationDefinition,
  type GraphOntologyProfile,
  type GraphProviderManifest,
  type GraphQualityReport,
  type GraphResolutionState,
  type GraphValidationIssue,
  type GraphObservationOrigin,
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
  /**
   * Native transport ownership. This is deliberately outside semantic facts:
   * locator ownership and clock provenance describe extraction partitions,
   * not graph truth.
   */
  readonly partitionOwnership?: readonly GraphCompositionPartitionOwnership[];
}

export interface GraphCompositionPartitionOwnership {
  readonly locator: string;
  readonly facts: readonly {
    readonly factId: string;
    readonly observationOrigin: GraphObservationOrigin;
  }[];
}

export interface GraphCompositionRequest {
  readonly ontology: GraphOntologyProfile;
  readonly sources: readonly GraphCompositionSource[];
  readonly policy: GraphCompositionPolicy;
  readonly lineages?: readonly GraphDerivationLineage[];
  readonly previousGeneration?: { readonly id: string; readonly contentDigest: WisDigestReference };
  /**
   * Host-computed identity freeze for sharded composition. Workers must not
   * re-derive identity from a fact subset. Absent for single-shot composition.
   */
  readonly identityFreeze?: GraphCompositionIdentityFreeze;
  /**
   * Process-local repository identity for the resident session key. It is not
   * part of the published graph digest.
   */
  readonly repositoryIdentity?: string;
  /**
   * Pull-based partitions for the native session. When set, each yielded source
   * is upserted and then released before the next read. `sources` still carries
   * provider identity, inputs, coverage, and zones for the semantic header.
   * Fact arrays on those sources may be empty.
   */
  readonly streamSources?: () => AsyncIterable<GraphCompositionSource>;
}

export interface NativeGraphProofCounts {
  readonly supported: number;
  readonly corroborated: number;
  readonly verified: number;
  readonly disputed: number;
  readonly insufficient: number;
  readonly unresolved: number;
}

export interface NativeGraphSnapshot {
  readonly schema: 'workspai.graph.native-snapshot.v1';
  readonly snapshotId: string;
  readonly format: 'WGP1' | 'WGP2';
  readonly formatVersion: 1;
  readonly protocolVersion: 2;
  readonly binaryPackaging: 'packaged' | 'development' | 'override';
  readonly factDigest: WisDigestReference;
  readonly contentDigest: WisDigestReference;
  readonly packedDigest: string;
  readonly packedBytes: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly factCount: number;
  readonly unresolvedCount: number;
  readonly decisionCount: number;
  readonly orphanCount: number;
  readonly staleFactCount: number;
  readonly decisionsAccepted: number;
  readonly decisionsRejected: number;
  readonly decisionsDisputed: number;
  readonly decisionsUnresolved: number;
  readonly proofStates: NativeGraphProofCounts;
  readonly fallback: '';
  readonly lifecycle: 'published';
  readonly storage: 'content-addressed';
  readonly query: 'paged';
  readonly evaluatedAt: string;
}

export interface GraphCompositionIdentityFreeze {
  readonly nodes: readonly GraphEntityReference[];
  readonly resolvedIds: readonly (readonly [string, string])[];
  readonly invalidIds: readonly string[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
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
    readonly facts: readonly { readonly factId: string }[];
  }[];
  readonly decisions: readonly GraphCompositionDecision[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
}

export interface GraphCompositionTimings {
  readonly admitMs: number;
  readonly workerMs: number;
  readonly workerValidationMs: number;
  readonly eligibilityMs: number;
  readonly semanticDigestMs: number;
  readonly edgeProofMs: number;
  readonly contentDigestMs: number;
  readonly graphValidationMs: number;
  readonly qualityDigestMs: number;
  readonly freezeMs: number;
  readonly canonicalKeyChars: number;
  readonly canonicalCodeUnitInversions: number;
  readonly canonicalNonAsciiKeys: number;
  readonly ownedFactDigest: 'off' | 'complete' | 'fallback';
  readonly ownedCanonicalBytes: number;
  readonly ownedRustRssBytes: number;
  readonly ownedBoundaryBytes: number;
  readonly ownedFallbackReason: string;
  readonly ownedPublicationBytes: number;
  readonly ownedNodeCount: number;
  readonly ownedEdgeCount: number;
  readonly ownedRustFacts: number;
  readonly ownedTypescriptFacts: number;
  readonly ownedRssKnown: boolean;
  readonly ownedRetainedCanonicalBytes: number;
  readonly ownedSimultaneousRssBytes: number;
  readonly probes: readonly {
    readonly at: string;
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
  }[];
}

export const GRAPH_COMPOSITION_RECEIPT_SCHEMA = 'workspai.graph.composition-receipt.v1' as const;

export const GRAPH_COMPOSITION_ORDERING_RULES = Object.freeze({
  id: 'workspai.graph.composition-ordering.v1',
  nodeOrder: 'entity-id-locale',
  edgeOrder: 'canonical-edge-key',
  factDedup: 'canonical-fact-key',
  unresolvedOrder: 'id-locale',
  diagnosticOrder: 'code-path-locale',
});

export interface GraphCompositionSemanticReceipt {
  readonly schema: typeof GRAPH_COMPOSITION_RECEIPT_SCHEMA;
  readonly graphSchema: WisContractReference;
  readonly architectureEpoch: string;
  readonly ontologySetDigest: WisDigestReference;
  readonly proofPolicySetDigest: WisDigestReference;
  readonly inputsDigest: WisDigestReference;
  readonly factSetDigest: WisDigestReference;
  readonly providerSetDigest: WisDigestReference;
  readonly extractorSetDigest: WisDigestReference;
  readonly compositionPolicyDigest: WisDigestReference;
  readonly redactionPolicyDigest: WisDigestReference;
  readonly scopeDigest: WisDigestReference;
  readonly coverageDigest: WisDigestReference;
  readonly unknownZoneDigest: WisDigestReference;
  readonly unsupportedZoneDigest: WisDigestReference;
  readonly orderingRuleDigest: WisDigestReference;
  readonly orderingRuleId: typeof GRAPH_COMPOSITION_ORDERING_RULES.id;
}

export interface GraphCompositionReceipt extends GraphCompositionSemanticReceipt {
  readonly contentDigest: WisDigestReference;
  readonly qualityDigest: WisDigestReference;
}

interface GraphCompositionShared {
  readonly quality: GraphQualityReport;
  readonly semanticDigests: {
    readonly ontology: WisDigestReference;
    readonly proofPolicies: WisDigestReference;
    readonly inputs: WisDigestReference;
    readonly facts: WisDigestReference;
    readonly providers: WisDigestReference;
    readonly compositionPolicy: WisDigestReference;
  };
  readonly receipt: GraphCompositionReceipt;
}

export type GraphCompositionOutput = GraphCompositionShared &
  (
    | {
        readonly representation: 'materialized';
        readonly graph: GraphCanonicalGraph;
        readonly decisions: readonly GraphCompositionDecision[];
      }
    | {
        readonly representation: 'native-snapshot';
        readonly snapshot: NativeGraphSnapshot;
      }
  );

export function requireMaterializedDecisions(
  value: GraphCompositionOutput
): readonly GraphCompositionDecision[] {
  if (value.representation !== 'materialized') {
    throw new Error('GRAPH_NATIVE_SNAPSHOT_UNMATERIALIZED');
  }
  return value.decisions;
}

export function requireMaterializedGraph(value: GraphCompositionOutput): GraphCanonicalGraph {
  if (value.representation !== 'materialized') {
    throw new Error('GRAPH_NATIVE_SNAPSHOT_UNMATERIALIZED');
  }
  return value.graph;
}

export function isMaterializedComposition(
  value: GraphCompositionOutput
): value is GraphCompositionOutput & {
  readonly representation: 'materialized';
  readonly graph: GraphCanonicalGraph;
} {
  return value.representation === 'materialized';
}

function digestEquals(left: WisDigestReference, right: WisDigestReference): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export function compositionSemanticReceiptsEqual(
  left: GraphCompositionSemanticReceipt,
  right: GraphCompositionSemanticReceipt
): boolean {
  return (
    left.schema === right.schema &&
    left.graphSchema.id === right.graphSchema.id &&
    left.graphSchema.version === right.graphSchema.version &&
    left.architectureEpoch === right.architectureEpoch &&
    left.orderingRuleId === right.orderingRuleId &&
    digestEquals(left.ontologySetDigest, right.ontologySetDigest) &&
    digestEquals(left.proofPolicySetDigest, right.proofPolicySetDigest) &&
    digestEquals(left.inputsDigest, right.inputsDigest) &&
    digestEquals(left.factSetDigest, right.factSetDigest) &&
    digestEquals(left.providerSetDigest, right.providerSetDigest) &&
    digestEquals(left.extractorSetDigest, right.extractorSetDigest) &&
    digestEquals(left.compositionPolicyDigest, right.compositionPolicyDigest) &&
    digestEquals(left.redactionPolicyDigest, right.redactionPolicyDigest) &&
    digestEquals(left.scopeDigest, right.scopeDigest) &&
    digestEquals(left.coverageDigest, right.coverageDigest) &&
    digestEquals(left.unknownZoneDigest, right.unknownZoneDigest) &&
    digestEquals(left.unsupportedZoneDigest, right.unsupportedZoneDigest) &&
    digestEquals(left.orderingRuleDigest, right.orderingRuleDigest)
  );
}

export function compositionReceiptMatchesPublishedGraph(
  receipt: GraphCompositionReceipt,
  graph: GraphCanonicalGraph,
  quality: GraphQualityReport | undefined
): boolean {
  if (!quality) return false;
  const generation = graph.generation;
  return (
    compositionSemanticReceiptsEqual(receipt, {
      schema: GRAPH_COMPOSITION_RECEIPT_SCHEMA,
      graphSchema: generation.graphSchema,
      architectureEpoch: generation.architectureEpoch,
      ontologySetDigest: generation.ontologySetDigest,
      proofPolicySetDigest: generation.proofPolicySetDigest,
      inputsDigest: generation.inputsDigest,
      factSetDigest: generation.factSetDigest,
      providerSetDigest: generation.providerSetDigest,
      extractorSetDigest: receipt.extractorSetDigest,
      compositionPolicyDigest: generation.compositionPolicyDigest,
      redactionPolicyDigest: receipt.redactionPolicyDigest,
      scopeDigest: receipt.scopeDigest,
      coverageDigest: receipt.coverageDigest,
      unknownZoneDigest: receipt.unknownZoneDigest,
      unsupportedZoneDigest: receipt.unsupportedZoneDigest,
      orderingRuleDigest: receipt.orderingRuleDigest,
      orderingRuleId: GRAPH_COMPOSITION_ORDERING_RULES.id,
    }) &&
    receipt.orderingRuleId === GRAPH_COMPOSITION_ORDERING_RULES.id &&
    receipt.graphSchema.id === GRAPH_CANONICAL_GRAPH_CONTRACT.id &&
    receipt.graphSchema.version === GRAPH_CANONICAL_GRAPH_CONTRACT.version &&
    digestEquals(receipt.contentDigest, generation.reference.contentDigest) &&
    quality.generation.id === generation.reference.id &&
    digestEquals(quality.generation.contentDigest, generation.reference.contentDigest)
  );
}

export type GraphCompositionResult =
  | {
      readonly accepted: true;
      readonly value: GraphCompositionOutput;
      readonly issues: readonly [];
      readonly timings: GraphCompositionTimings;
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
