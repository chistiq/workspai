/* Generated from schemas/compatibility/wis-core-result-envelope.v0.1.0-draft.schema.json. Do not edit. */

export type WisScopeReference =
  | WisProjectScopeReference
  | WisWorkspaceScopeReference
  | WisSelectionScopeReference
  | WisOrganizationScopeReference;

/**
 * Frozen previous-major compatibility contract for the WIS Core result envelope.
 */
export interface WisCoreResultEnvelopeV01 {
  specVersion: string;
  coreVersion: '0.1.0-draft';
  schemaId: string;
  profile: WisProfileReference;
  artifactId?: string;
  producer: WisProducerReference;
  operation: string;
  scope: WisScopeReference;
  generation: WisGenerationReference;
  outcome: 'pass' | 'attention' | 'blocked' | 'partial' | 'failed';
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
  extensions?: WisExtensions;
}
export interface WisProfileReference {
  id: string;
  version: string;
}
export interface WisProducerReference {
  id: string;
  version: string;
  /**
   * @maxItems 128
   */
  extensions?: string[];
}
export interface WisProjectScopeReference {
  kind: 'project';
  workspaceId?: string;
  /**
   * @minItems 1
   * @maxItems 10000
   */
  projectIds: [string, ...string[]];
}
export interface WisWorkspaceScopeReference {
  kind: 'workspace';
  workspaceId: string;
}
export interface WisSelectionScopeReference {
  kind: 'selection';
  workspaceId?: string;
  /**
   * @minItems 1
   * @maxItems 10000
   */
  projectIds?: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 10000
   */
  entityIds?: [string, ...string[]];
  selector?: string;
}
export interface WisOrganizationScopeReference {
  kind: 'organization';
  organizationId: string;
  workspaceId?: string;
}
export interface WisGenerationReference {
  id: string;
  generatedAt: string;
  /**
   * @maxItems 10000
   */
  parents?: string[];
  contentDigest?: WisDigestReference;
}
export interface WisDigestReference {
  algorithm: string;
  value: string;
  canonicalization?: string;
}
export interface WisEvidenceReference {
  id: string;
  sourceKind: string;
  artifact?: WisArtifactReference;
  relativeLocator?: string;
  digest?: WisDigestReference;
  producer?: WisProducerReference;
}
export interface WisArtifactReference {
  id: string;
  generationId: string;
  schemaId?: string;
  mediaType?: string;
  relativeLocator?: string;
}
export interface WisFreshnessSummary {
  status: 'current' | 'stale' | 'unknown';
  evaluatedAt?: string;
  /**
   * @maxItems 10000
   */
  inputGenerations?: string[];
  /**
   * @maxItems 1000
   */
  invalidationCauses?: string[];
  renewal?: WisRenewalReference;
}
export interface WisRenewalReference {
  operation: string;
  scope?: WisScopeReference;
}
export interface WisUnknownRecord {
  code: string;
  subject: string;
  reason: string;
  affectsStatus: boolean;
  scope?: WisScopeReference;
}
export interface WisOmission {
  code: string;
  reason: string;
  affectsStatus: boolean;
  recoverable: boolean;
  scope?: WisScopeReference;
  renewal?: WisRenewalReference;
}
export interface WisDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  affectsStatus: boolean;
  scope?: WisScopeReference;
  entityId?: string;
  /**
   * @maxItems 100
   */
  causes?: string[];
  /**
   * @maxItems 1000
   */
  evidence?: WisEvidenceReference[];
  renewal?: WisRenewalReference;
}
export interface WisExtensions {
  [k: string]: unknown;
}
