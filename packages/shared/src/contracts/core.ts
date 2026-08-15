import type { WisCoreResultEnvelope } from '../generated/wis-core-result-envelope.js';
import {
  WIS_COMPATIBILITY_STATUSES,
  WIS_CORE_CONTRACT_VERSION,
  WIS_DIAGNOSTIC_SEVERITIES,
  WIS_OPERATION_OUTCOMES,
  WIS_RESULT_STATUSES,
  WIS_SCOPE_KINDS,
} from '../generated/vocabulary.js';

export type {
  WisArtifactReference,
  WisCompatibilitySummary,
  WisContractReference,
  WisDiagnostic,
  WisDigestReference,
  WisEvidenceReference,
  WisExtensions,
  WisFreshnessSummary,
  WisGenerationReference,
  WisOmission,
  WisOrganizationScopeReference,
  WisProducerReference,
  WisProfileReference,
  WisProjectScopeReference,
  WisRenewalReference,
  WisScopeReference,
  WisSelectionScopeReference,
  WisUnknownRecord,
  WisWorkspaceScopeReference,
} from '../generated/wis-core-result-envelope.js';

export {
  WIS_COMPATIBILITY_STATUSES,
  WIS_CORE_CONTRACT_VERSION,
  WIS_DIAGNOSTIC_SEVERITIES,
  WIS_OPERATION_OUTCOMES,
  WIS_RESULT_STATUSES,
  WIS_SCOPE_KINDS,
};

/**
 * Development binding for the SH1/SH2 candidate. Released WIS schemas and
 * semantic fixtures—not this convenience module—remain the contract authority.
 */

export type WisResultStatus = (typeof WIS_RESULT_STATUSES)[number];

export type WisOperationOutcome = (typeof WIS_OPERATION_OUTCOMES)[number];

export type WisDiagnosticSeverity = (typeof WIS_DIAGNOSTIC_SEVERITIES)[number];

export type WisCompatibilityStatus = (typeof WIS_COMPATIBILITY_STATUSES)[number];

export type WisFreshnessStatus = WisCoreResultEnvelope['freshness']['status'];

export type WisResultEnvelope<TPayload = unknown> = Omit<WisCoreResultEnvelope, 'payload'> & {
  readonly payload?: TPayload;
};

export function defineWisContract<
  const TContract extends import('../generated/wis-core-result-envelope.js').WisContractReference,
>(contract: TContract): Readonly<TContract> {
  return Object.freeze({ ...contract });
}
