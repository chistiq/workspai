import type { WisCoreResultEnvelope } from '../generated/wis-core-result-envelope.js';
import { validateWisCoreResultEnvelopeStructure as validateStructure } from '../generated/wis-core-result-envelope.validator.js';
import { inspectJsonResourceLimits } from './resource-guard.js';
import { validateWisCoreSemantics } from './semantic.js';
import { resolveWisValidationLimits } from './limits.js';
import {
  type WisValidationDiagnostic,
  type WisValidationOptions,
  type WisValidationResult,
} from './types.js';

export {
  DEFAULT_WIS_VALIDATION_LIMITS,
  type WisValidationDiagnostic,
  type WisValidationLimits,
  type WisValidationOptions,
  type WisValidationPhase,
  type WisValidationResult,
} from './types.js';
export { MAX_WIS_VALIDATION_LIMITS } from './limits.js';
export type { WisValidationPolicy } from './types.js';
export type { WisValidationCancellationSignal } from './types.js';
export {
  validateWisContractCatalogStructure,
  validateWisCoreResultEnvelopeStructure,
} from '../generated/validators.js';
export {
  validateWisGeneratedContractStructure,
  type WisStructuralValidationResult,
} from './generated.js';

function structuralDiagnostics(): WisValidationDiagnostic[] {
  return (validateStructure.errors ?? []).map((error) => {
    const keyword = typeof error.keyword === 'string' ? error.keyword : 'invalid';
    const instancePath = typeof error.instancePath === 'string' ? error.instancePath : '';
    const message =
      typeof error.message === 'string' ? error.message : 'Structural validation failed.';
    return {
      code: `WIS_STRUCTURAL_${keyword.replaceAll(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`,
      phase: 'structural',
      path: instancePath,
      message,
      keyword,
    };
  });
}

function invalidResult(
  diagnostics: WisValidationDiagnostic[],
  maxDiagnostics: number
): WisValidationResult {
  const visible = diagnostics.slice(0, maxDiagnostics);
  return {
    valid: false,
    diagnostics: visible,
    truncatedDiagnostics: diagnostics.length - visible.length,
  };
}

export function validateWisCoreResultEnvelope(
  input: unknown,
  options?: WisValidationOptions
): WisValidationResult {
  const limits = resolveWisValidationLimits(options);
  const resourceDiagnostics = inspectJsonResourceLimits(input, limits, options?.signal);
  if (resourceDiagnostics.length > 0) {
    return invalidResult(resourceDiagnostics, limits.maxDiagnostics);
  }

  if (!validateStructure(input)) {
    return invalidResult(structuralDiagnostics(), limits.maxDiagnostics);
  }

  const value = input as WisCoreResultEnvelope;
  const semanticDiagnostics = validateWisCoreSemantics(
    value,
    limits.maxDiagnostics,
    options?.policy
  );
  if (semanticDiagnostics.length > 0) {
    return invalidResult(semanticDiagnostics, limits.maxDiagnostics);
  }

  return { valid: true, value, diagnostics: [] };
}

export function isWisCoreResultEnvelope(input: unknown): input is WisCoreResultEnvelope {
  return validateWisCoreResultEnvelope(input).valid;
}
