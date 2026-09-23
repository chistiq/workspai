import type {
  WisDigestReference,
  WisEvidenceReference,
  WisScopeReference,
} from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_ENTITY_IDENTITY_CONTRACT = defineWisContract({
  id: 'workspai.graph.entity-identity',
  version: '0.1.0-candidate',
});

export const GRAPH_LOCATOR_IDENTITY_CONTRACT = defineWisContract({
  id: 'workspai.graph.locator-identity',
  version: '1',
});

export const GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES = Object.freeze([
  'encoded',
  'targets',
] as const);

export const MAX_GRAPH_URI_DECODE_ROUNDS = 8;

export const GRAPH_RELATIVE_LOCATOR_CLASSES = Object.freeze([
  'portable',
  'opaque',
  'unsafe',
] as const);

export const GRAPH_LOCATOR_IDENTITY_LAW = Object.freeze({
  contract: GRAPH_LOCATOR_IDENTITY_CONTRACT,
  opaqueDeclaredPrefixes: GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES,
  maxUriDecodeRounds: MAX_GRAPH_URI_DECODE_ROUNDS,
  classes: GRAPH_RELATIVE_LOCATOR_CLASSES,
});

export type GraphOpaqueDeclaredLocatorPrefix =
  (typeof GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES)[number];
export type GraphRelativeLocatorClass = (typeof GRAPH_RELATIVE_LOCATOR_CLASSES)[number];

export const GRAPH_FACT_BATCH_CONTRACT = defineWisContract({
  id: 'workspai.graph.fact-batch',
  version: '0.1.0-candidate',
});

export const GRAPH_IDENTITY_SCHEME = Object.freeze({
  id: 'workspai.graph.portable-entity',
  version: '1',
});

export const GRAPH_CLAIM_DERIVATIONS = Object.freeze([
  'observed',
  'extracted',
  'declared',
  'computed',
  'inferred',
  'generated',
  'imported',
] as const);

export const GRAPH_CLAIM_AUTHORITIES = Object.freeze([
  'declared',
  'observed',
  'verified',
  'inferred',
] as const);

export type GraphClaimDerivation = (typeof GRAPH_CLAIM_DERIVATIONS)[number];
export type GraphClaimAuthority = (typeof GRAPH_CLAIM_AUTHORITIES)[number];
export type GraphScope = WisScopeReference;

export interface GraphEntityAlias {
  readonly id: string;
  readonly reason: 'rename' | 'move' | 'canonicalization' | 'provider-alias';
}

export interface GraphEntityReference {
  readonly id: string;
  readonly identityScheme: typeof GRAPH_IDENTITY_SCHEME;
  readonly kind: string;
  readonly scope: GraphScope;
  readonly aliases?: readonly GraphEntityAlias[];
}

export interface GraphEntityIdentityInput {
  readonly namespace: string;
  readonly kind: string;
  readonly relativeLocator: string;
  readonly caseSensitivity: 'sensitive' | 'insensitive';
  readonly scope: GraphScope;
}

export interface GraphEntityIdentityNormalization {
  readonly reference: GraphEntityReference;
  readonly normalizedLocator: string;
}

export interface GraphLiteralValue {
  readonly kind: 'string' | 'number' | 'boolean' | 'null';
  readonly value: string | number | boolean | null;
}

export interface GraphProviderIdentity {
  readonly id: string;
  readonly version: string;
}

export interface GraphFactFreshness {
  readonly status: 'current' | 'stale' | 'unknown';
  readonly validUntil?: string;
  readonly renewal?: string;
}

export interface GraphTruthLifecycle {
  readonly invalidatedBy: readonly ('input-change' | 'deletion' | 'expiry' | 'provider-change')[];
}

export type GraphUnknownCompleteness =
  'complete' | 'bounded' | 'partial' | 'unsupported' | 'failed';

export type GraphUnknownBound =
  'policy-bounded' | 'unsupported' | 'partial' | 'failed' | 'resource-limited';

export type GraphUnknownAdmissionImpact = 'blocking';

export interface GraphUnknownObservationFields {
  readonly cause?: string;
  readonly stage?: string;
  readonly provider?: string;
  readonly language?: string;
  readonly completeness?: GraphUnknownCompleteness;
  readonly bound?: GraphUnknownBound;
  readonly severity?: 'info' | 'warning' | 'error';
  readonly admissionImpact?: GraphUnknownAdmissionImpact;
  readonly evidence?: readonly string[];
  readonly classificationOrigin?: 'structured-producer' | 'legacy-fallback';
}

export interface GraphUnknownZone extends GraphUnknownObservationFields {
  readonly code: string;
  readonly scope: string;
  readonly reason: string;
}

export type GraphObservationOrigin = 'source' | 'provider' | 'build-clock';

/**
 * Explicit partition ownership. Locator identity is not a content digest:
 * two files with identical bytes remain different partitions.
 * `build-clock` may be replaced by the first trusted observation for an
 * unchanged input. `source` and `provider` stay semantic even when the
 * timestamp equals the build clock.
 */
export interface GraphPartitionOwner {
  readonly locator: string;
  readonly observationOrigin: GraphObservationOrigin;
}

export interface GraphWorkspaceFact {
  readonly factId: string;
  readonly factType: string;
  readonly subject: GraphEntityReference;
  readonly predicate: string;
  readonly object: GraphEntityReference | GraphLiteralValue;
  readonly scope: GraphScope;
  readonly evidence: readonly WisEvidenceReference[];
  readonly provenance: GraphProviderIdentity;
  readonly derivation: GraphClaimDerivation;
  readonly authority: GraphClaimAuthority;
  readonly confidence: number;
  readonly freshness: GraphFactFreshness;
  readonly truthLifecycle: GraphTruthLifecycle;
  readonly observedAt: string;
  /** @deprecated Native composition promotes this provider hint to its source envelope. */
  readonly partitionOwner?: GraphPartitionOwner;
  readonly inputDigest: WisDigestReference;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface GraphDerivationLineage {
  readonly factId: string;
  readonly derivation: GraphClaimDerivation;
  readonly evidenceRoots: readonly string[];
  readonly parentFactIds: readonly string[];
}

export interface GraphEvidenceIndependence {
  readonly independent: boolean;
  readonly roots: readonly string[];
  readonly rejectedPairs: readonly {
    readonly left: string;
    readonly right: string;
    readonly reason: 'same-root' | 'ancestor' | 'generated-sibling';
  }[];
}

export interface GraphInputDigest {
  readonly locator: string;
  readonly digest: WisDigestReference;
}

export interface GraphDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly path: string;
  readonly message: string;
}

export interface GraphCoverageObservation {
  readonly dimension: string;
  readonly observed: number;
  readonly expected?: number;
}

export interface GraphUnsupportedZone extends GraphUnknownObservationFields {
  readonly code: string;
  readonly scope: string;
  readonly reason: string;
}

export interface GraphRedactionSummary {
  readonly policy: string;
  readonly redacted: number;
  readonly omitted: number;
}

export type GraphInputProcessingOutcome =
  'processed' | 'unchanged' | 'excluded' | 'unsupported' | 'omitted' | 'failed' | 'deleted';

export interface GraphInputProcessingRecord {
  readonly input: GraphInputDigest;
  readonly provider: GraphProviderIdentity;
  readonly stage: { readonly id: string; readonly version: string };
  readonly outcome: GraphInputProcessingOutcome;
  readonly priorDigest?: WisDigestReference;
  readonly outputDigest?: WisDigestReference;
  readonly diagnostics: readonly GraphDiagnostic[];
}

export interface GraphFactBatch {
  readonly contract: typeof GRAPH_FACT_BATCH_CONTRACT;
  readonly provider: GraphProviderIdentity;
  readonly batchId: string;
  readonly scope: GraphScope;
  readonly inputs: readonly GraphInputDigest[];
  readonly facts: readonly GraphWorkspaceFact[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly coverage: readonly GraphCoverageObservation[];
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly redaction: GraphRedactionSummary;
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly processing: readonly GraphInputProcessingRecord[];
}

export interface GraphValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type GraphValidationResult<T> =
  | { readonly accepted: true; readonly value: Readonly<T>; readonly issues: readonly [] }
  | { readonly accepted: false; readonly issues: readonly GraphValidationIssue[] };
