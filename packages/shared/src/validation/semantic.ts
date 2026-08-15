import type {
  WisCoreResultEnvelope,
  WisEvidenceReference,
} from '../generated/wis-core-result-envelope.js';
import type { WisValidationDiagnostic } from './types.js';
import type { WisValidationPolicy } from './types.js';

function semanticDiagnostic(code: string, path: string, message: string): WisValidationDiagnostic {
  return { code, phase: 'semantic', path, message };
}

function isValidUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(value);
  if (!match) return false;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return false;
  return (
    instant.getUTCFullYear() === Number(match[1]) &&
    instant.getUTCMonth() + 1 === Number(match[2]) &&
    instant.getUTCDate() === Number(match[3]) &&
    instant.getUTCHours() === Number(match[4]) &&
    instant.getUTCMinutes() === Number(match[5]) &&
    instant.getUTCSeconds() === Number(match[6])
  );
}

function isPortableRelativeLocator(value: string): boolean {
  if (/[%](?:2e|2f|5c)/iu.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false;
  if (/[\u0000-\u001F\u007F]/u.test(value) || value.includes('\\')) return false;
  if (value.startsWith('/') || value.startsWith('//')) return false;
  if (/^[A-Za-z]:[\\/]/u.test(value)) return false;
  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function validateEvidenceLocator(
  evidence: WisEvidenceReference,
  path: string,
  emit: (diagnostic: WisValidationDiagnostic) => void
): void {
  if (evidence.relativeLocator && !isPortableRelativeLocator(evidence.relativeLocator)) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_NON_PORTABLE_LOCATOR',
        `${path}/relativeLocator`,
        'Portable evidence locators must be normalized relative paths.'
      )
    );
  }
  if (
    evidence.artifact?.relativeLocator &&
    !isPortableRelativeLocator(evidence.artifact.relativeLocator)
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_NON_PORTABLE_LOCATOR',
        `${path}/artifact/relativeLocator`,
        'Portable artifact locators must be normalized relative paths.'
      )
    );
  }
}

export function validateWisCoreSemantics(
  value: WisCoreResultEnvelope,
  maxDiagnostics = 100,
  policy?: WisValidationPolicy
): WisValidationDiagnostic[] {
  const diagnostics: WisValidationDiagnostic[] = [];
  const emit = (diagnostic: WisValidationDiagnostic): void => {
    if (diagnostics.length <= maxDiagnostics) diagnostics.push(diagnostic);
  };

  if (value.generation.id === 'latest') {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_LATEST_IS_NOT_GENERATION',
        '/generation/id',
        'The discovery alias latest cannot be persisted as generation identity.'
      )
    );
  }
  if (value.generation.parents?.includes(value.generation.id)) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_SELF_PARENT_GENERATION',
        '/generation/parents',
        'A generation cannot name itself as a parent.'
      )
    );
  }
  if (!isValidUtcTimestamp(value.generation.generatedAt)) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_INVALID_GENERATION_TIME',
        '/generation/generatedAt',
        'Generation time must be a valid RFC 3339 UTC timestamp.'
      )
    );
  }
  if (value.freshness.evaluatedAt && !isValidUtcTimestamp(value.freshness.evaluatedAt)) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_INVALID_FRESHNESS_TIME',
        '/freshness/evaluatedAt',
        'Freshness evaluation time must be a valid RFC 3339 UTC timestamp.'
      )
    );
  }
  if (value.operationOutcome === 'failed' && value.status !== 'failed') {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_FAILED_OPERATION_VERDICT',
        '/status',
        'A failed producer operation cannot report a non-failed result status.'
      )
    );
  }
  if (value.status === 'failed' && value.operationOutcome !== 'failed') {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_FAILED_RESULT_OUTCOME',
        '/operationOutcome',
        'A failed result must identify a failed producer operation.'
      )
    );
  }
  if (
    value.operationOutcome === 'cancelled' &&
    value.status !== 'partial' &&
    value.status !== 'failed'
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_CANCELLED_OPERATION_VERDICT',
        '/status',
        'A cancelled operation may preserve only an explicitly partial or failed result.'
      )
    );
  }
  if (
    value.scope.kind === 'selection' &&
    !value.scope.selector &&
    !value.scope.projectIds?.length &&
    !value.scope.entityIds?.length
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_EMPTY_SELECTION',
        '/scope',
        'Selection scope must declare a selector, project ID or entity ID.'
      )
    );
  }
  if (
    value.scope.kind === 'organization' &&
    !policy?.organizationScopeProfiles?.includes(value.profile.id)
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_ORGANIZATION_SCOPE_NOT_ADMITTED',
        '/scope',
        'Organization scope requires explicit admission for the exact WIS profile.'
      )
    );
  }
  if (value.status === 'partial' && value.omissions.length === 0) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_PARTIAL_WITHOUT_OMISSION',
        '/omissions',
        'Partial results must explain at least one omission.'
      )
    );
  }
  if (value.status === 'pass') {
    const statusAffecting = [
      ...value.diagnostics.map((entry) => entry.affectsStatus),
      ...value.unknowns.map((entry) => entry.affectsStatus),
      ...value.omissions.map((entry) => entry.affectsStatus),
    ].some(Boolean);
    if (statusAffecting) {
      emit(
        semanticDiagnostic(
          'WIS_SEMANTIC_FALSE_PASS',
          '/status',
          'Pass cannot contain an unresolved status-affecting record.'
        )
      );
    }
  }
  if (
    value.freshness.status === 'stale' &&
    (value.freshness.invalidationCauses?.length ?? 0) === 0
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_STALE_WITHOUT_CAUSE',
        '/freshness/invalidationCauses',
        'Stale freshness must identify an invalidation cause.'
      )
    );
  }
  if (
    value.compatibility.status !== 'compatible' &&
    (value.compatibility.unsupportedCapabilities?.length ?? 0) === 0 &&
    (value.compatibility.losses?.length ?? 0) === 0 &&
    (value.compatibility.migrations?.length ?? 0) === 0
  ) {
    emit(
      semanticDiagnostic(
        'WIS_SEMANTIC_COMPATIBILITY_WITHOUT_REASON',
        '/compatibility',
        'Conditional or incompatible results must declare capability, loss or migration reasons.'
      )
    );
  }

  for (const [index, evidence] of value.evidence.entries()) {
    validateEvidenceLocator(evidence, `/evidence/${index}`, emit);
    if (diagnostics.length > maxDiagnostics) break;
  }
  for (const [diagnosticIndex, entry] of value.diagnostics.entries()) {
    for (const [evidenceIndex, evidence] of (entry.evidence ?? []).entries()) {
      validateEvidenceLocator(
        evidence,
        `/diagnostics/${diagnosticIndex}/evidence/${evidenceIndex}`,
        emit
      );
      if (diagnostics.length > maxDiagnostics) break;
    }
    if (diagnostics.length > maxDiagnostics) break;
  }

  return diagnostics;
}
