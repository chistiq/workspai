/* Generated from schemas/src/wis-core-result-envelope.v0.2.0-draft.schema.json. Do not edit. */

/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "NonEmptyIdentifier".
 */
export type NonEmptyIdentifier = string;
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ScopeReference".
 */
export type WisScopeReference =
  | WisProjectScopeReference
  | WisWorkspaceScopeReference
  | WisSelectionScopeReference
  | WisOrganizationScopeReference;
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string;
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "PortableRelativeLocator".
 */
export type PortableRelativeLocator = string;

/**
 * SH2 candidate binding for the review-pending WIS Core result envelope.
 */
export interface WisCoreResultEnvelope {
  specVersion: NonEmptyIdentifier;
  coreVersion: '0.2.0-draft';
  schemaId: NonEmptyIdentifier;
  profile: WisProfileReference;
  artifactId?: NonEmptyIdentifier;
  producer: WisProducerReference;
  operation: NonEmptyIdentifier;
  operationOutcome: 'succeeded' | 'failed' | 'cancelled';
  scope: WisScopeReference;
  generation: WisGenerationReference;
  status: 'pass' | 'attention' | 'blocked' | 'partial' | 'failed';
  payload?: unknown;
  /**
   * @maxItems 10000
   */
  evidence: WisEvidenceReference[];
  freshness: WisFreshnessSummary;
  /**
   * @maxItems 1000
   */
  unknowns: WisUnknownRecord[];
  /**
   * @maxItems 1000
   */
  omissions: WisOmission[];
  /**
   * @maxItems 1000
   */
  diagnostics: WisDiagnostic[];
  compatibility: WisCompatibilitySummary;
  extensions?: WisExtensions;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ProfileReference".
 */
export interface WisProfileReference {
  id: NonEmptyIdentifier;
  version: NonEmptyIdentifier;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ProducerReference".
 */
export interface WisProducerReference {
  id: NonEmptyIdentifier;
  version: NonEmptyIdentifier;
  /**
   * @maxItems 128
   */
  extensions?: NonEmptyIdentifier[];
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ProjectScope".
 */
export interface WisProjectScopeReference {
  kind: 'project';
  workspaceId?: NonEmptyIdentifier;
  /**
   * @minItems 1
   * @maxItems 10000
   */
  projectIds: [NonEmptyIdentifier, ...NonEmptyIdentifier[]];
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "WorkspaceScope".
 */
export interface WisWorkspaceScopeReference {
  kind: 'workspace';
  workspaceId: NonEmptyIdentifier;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "SelectionScope".
 */
export interface WisSelectionScopeReference {
  kind: 'selection';
  workspaceId?: NonEmptyIdentifier;
  /**
   * @minItems 1
   * @maxItems 10000
   */
  projectIds?: [NonEmptyIdentifier, ...NonEmptyIdentifier[]];
  /**
   * @minItems 1
   * @maxItems 10000
   */
  entityIds?: [NonEmptyIdentifier, ...NonEmptyIdentifier[]];
  selector?: string;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "OrganizationScope".
 */
export interface WisOrganizationScopeReference {
  kind: 'organization';
  organizationId: NonEmptyIdentifier;
  workspaceId?: NonEmptyIdentifier;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "GenerationReference".
 */
export interface WisGenerationReference {
  id: NonEmptyIdentifier;
  generatedAt: Timestamp;
  /**
   * @maxItems 10000
   */
  parents?: NonEmptyIdentifier[];
  contentDigest?: WisDigestReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "DigestReference".
 */
export interface WisDigestReference {
  algorithm: NonEmptyIdentifier;
  value: string;
  canonicalization?: NonEmptyIdentifier;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "EvidenceReference".
 */
export interface WisEvidenceReference {
  id: NonEmptyIdentifier;
  sourceKind: NonEmptyIdentifier;
  artifact?: WisArtifactReference;
  relativeLocator?: PortableRelativeLocator;
  digest?: WisDigestReference;
  producer?: WisProducerReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ArtifactReference".
 */
export interface WisArtifactReference {
  id: NonEmptyIdentifier;
  generationId: NonEmptyIdentifier;
  schemaId?: NonEmptyIdentifier;
  mediaType?: string;
  relativeLocator?: PortableRelativeLocator;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "FreshnessSummary".
 */
export interface WisFreshnessSummary {
  status: 'current' | 'stale' | 'unknown';
  evaluatedAt?: Timestamp;
  /**
   * @maxItems 10000
   */
  inputGenerations?: NonEmptyIdentifier[];
  /**
   * @maxItems 1000
   */
  invalidationCauses?: NonEmptyIdentifier[];
  renewal?: WisRenewalReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "RenewalReference".
 */
export interface WisRenewalReference {
  operation: NonEmptyIdentifier;
  scope?: WisScopeReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "UnknownRecord".
 */
export interface WisUnknownRecord {
  code: NonEmptyIdentifier;
  subject: NonEmptyIdentifier;
  reason: string;
  affectsStatus: boolean;
  scope?: WisScopeReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "OmissionRecord".
 */
export interface WisOmission {
  code: NonEmptyIdentifier;
  reason: string;
  affectsStatus: boolean;
  recoverable: boolean;
  scope?: WisScopeReference;
  renewal?: WisRenewalReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "Diagnostic".
 */
export interface WisDiagnostic {
  code: NonEmptyIdentifier;
  severity: 'info' | 'warning' | 'error';
  message: string;
  affectsStatus: boolean;
  scope?: WisScopeReference;
  entityId?: NonEmptyIdentifier;
  /**
   * @maxItems 100
   */
  causes?: NonEmptyIdentifier[];
  /**
   * @maxItems 1000
   */
  evidence?: WisEvidenceReference[];
  renewal?: WisRenewalReference;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "CompatibilitySummary".
 */
export interface WisCompatibilitySummary {
  status: 'compatible' | 'conditionally-compatible' | 'incompatible';
  baseline?: WisContractReference;
  /**
   * @maxItems 1000
   */
  unsupportedCapabilities?: NonEmptyIdentifier[];
  /**
   * @maxItems 1000
   */
  losses?: NonEmptyIdentifier[];
  /**
   * @maxItems 1000
   */
  migrations?: NonEmptyIdentifier[];
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "ContractReference".
 */
export interface WisContractReference {
  id: NonEmptyIdentifier;
  version: NonEmptyIdentifier;
  profile?: NonEmptyIdentifier;
}
/**
 * This interface was referenced by `WisCoreResultEnvelope`'s JSON-Schema
 * via the `definition` "Extensions".
 */
export interface WisExtensions {
  [k: string]: unknown;
}
