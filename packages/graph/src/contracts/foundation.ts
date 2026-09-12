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

export interface GraphUnknownZone {
  readonly code: string;
  readonly scope: string;
  readonly reason: string;
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

export interface GraphUnsupportedZone {
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
