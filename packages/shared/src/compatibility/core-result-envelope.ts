import type { WisCoreResultEnvelope } from '../generated/wis-core-result-envelope.js';
import type { WisCoreResultEnvelopeV01 } from '../generated/wis-core-result-envelope-v0-1-draft.js';
import { validateWisCoreResultEnvelopeV01Structure } from '../generated/wis-core-result-envelope-v0-1-draft.validator.js';
import { inspectJsonResourceLimits } from '../validation/resource-guard.js';
import { resolveWisValidationLimits } from '../validation/limits.js';
import {
  validateWisCoreResultEnvelope,
  type WisValidationDiagnostic,
  type WisValidationOptions,
} from '../validation/index.js';

export const WIS_CURRENT_CORE_VERSION = '0.2.0-draft' as const;
export const WIS_SUPPORTED_PREVIOUS_CORE_VERSIONS = ['0.1.0-draft'] as const;
export const WIS_CURRENT_CORE_RESULT_ENVELOPE_ID =
  'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft' as const;
export const WIS_PREVIOUS_CORE_RESULT_ENVELOPE_ID =
  'https://schemas.workspai.dev/wis/core/result-envelope/0.1.0-draft' as const;

const OUTCOME_SPLIT_MIGRATION = 'wis.core.result-envelope.0.1-to-0.2.outcome-split';
const CANCELLED_OUTCOME_LOSS = 'wis.core.operation-outcome.cancelled-not-representable';

export type WisCoreCompatibilityStatus = 'exact' | 'migrated' | 'unsupported' | 'invalid';

export type WisCoreCompatibilityResult =
  | {
      readonly compatible: true;
      readonly status: 'exact' | 'migrated';
      readonly sourceVersion: typeof WIS_CURRENT_CORE_VERSION | '0.1.0-draft';
      readonly targetVersion: typeof WIS_CURRENT_CORE_VERSION;
      readonly value: WisCoreResultEnvelope;
      readonly migrations: readonly string[];
      readonly losses: readonly string[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly compatible: false;
      readonly status: 'unsupported' | 'invalid';
      readonly sourceVersion?: string;
      readonly targetVersion: typeof WIS_CURRENT_CORE_VERSION;
      readonly diagnostics: readonly WisValidationDiagnostic[];
    };

function compatibilityDiagnostic(
  code: string,
  path: string,
  message: string,
  keyword?: string
): WisValidationDiagnostic {
  return { code, phase: 'compatibility', path, message, ...(keyword ? { keyword } : {}) };
}

function previousStructuralDiagnostics(maxDiagnostics: number): readonly WisValidationDiagnostic[] {
  return (validateWisCoreResultEnvelopeV01Structure.errors ?? [])
    .slice(0, maxDiagnostics)
    .map((error) => {
      const keyword = typeof error.keyword === 'string' ? error.keyword : 'invalid';
      return compatibilityDiagnostic(
        `WIS_COMPATIBILITY_PREVIOUS_${keyword.replaceAll(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`,
        typeof error.instancePath === 'string' ? error.instancePath : '',
        typeof error.message === 'string'
          ? error.message
          : 'Previous-version structural validation failed.',
        keyword
      );
    });
}

function migratePrevious(value: WisCoreResultEnvelopeV01): WisCoreResultEnvelope {
  const { outcome, ...portableFields } = structuredClone(value);
  return {
    ...portableFields,
    coreVersion: WIS_CURRENT_CORE_VERSION,
    schemaId: WIS_CURRENT_CORE_RESULT_ENVELOPE_ID,
    operationOutcome: outcome === 'failed' ? 'failed' : 'succeeded',
    status: outcome,
    compatibility: {
      status: 'conditionally-compatible',
      baseline: {
        id: WIS_PREVIOUS_CORE_RESULT_ENVELOPE_ID,
        version: '0.1.0-draft',
      },
      migrations: [OUTCOME_SPLIT_MIGRATION],
      losses: [CANCELLED_OUTCOME_LOSS],
    },
  };
}

export function negotiateWisCoreResultEnvelope(
  input: unknown,
  options?: WisValidationOptions
): WisCoreCompatibilityResult {
  const limits = resolveWisValidationLimits(options);
  const resourceDiagnostics = inspectJsonResourceLimits(input, limits, options?.signal);
  if (resourceDiagnostics.length > 0) {
    return {
      compatible: false,
      status: 'invalid',
      targetVersion: WIS_CURRENT_CORE_VERSION,
      diagnostics: resourceDiagnostics.slice(0, limits.maxDiagnostics),
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      compatible: false,
      status: 'invalid',
      targetVersion: WIS_CURRENT_CORE_VERSION,
      diagnostics: [
        compatibilityDiagnostic(
          'WIS_COMPATIBILITY_INVALID_ENVELOPE',
          '',
          'A WIS Core result envelope must be a JSON object.'
        ),
      ],
    };
  }

  const sourceVersion = (input as Record<string, unknown>).coreVersion;
  if (sourceVersion === WIS_CURRENT_CORE_VERSION) {
    const current = validateWisCoreResultEnvelope(input, options);
    if (!current.valid) {
      return {
        compatible: false,
        status: 'invalid',
        sourceVersion,
        targetVersion: WIS_CURRENT_CORE_VERSION,
        diagnostics: current.diagnostics,
      };
    }
    return {
      compatible: true,
      status: 'exact',
      sourceVersion,
      targetVersion: WIS_CURRENT_CORE_VERSION,
      value: current.value,
      migrations: [],
      losses: [],
      diagnostics: [],
    };
  }

  if (sourceVersion === '0.1.0-draft') {
    if (!validateWisCoreResultEnvelopeV01Structure(input)) {
      return {
        compatible: false,
        status: 'invalid',
        sourceVersion,
        targetVersion: WIS_CURRENT_CORE_VERSION,
        diagnostics: previousStructuralDiagnostics(limits.maxDiagnostics),
      };
    }
    const migrated = migratePrevious(input as WisCoreResultEnvelopeV01);
    const current = validateWisCoreResultEnvelope(migrated, options);
    if (!current.valid) {
      return {
        compatible: false,
        status: 'invalid',
        sourceVersion,
        targetVersion: WIS_CURRENT_CORE_VERSION,
        diagnostics: current.diagnostics,
      };
    }
    return {
      compatible: true,
      status: 'migrated',
      sourceVersion,
      targetVersion: WIS_CURRENT_CORE_VERSION,
      value: current.value,
      migrations: [OUTCOME_SPLIT_MIGRATION],
      losses: [CANCELLED_OUTCOME_LOSS],
      diagnostics: [],
    };
  }

  if (typeof sourceVersion === 'string' && sourceVersion.length > 512) {
    return {
      compatible: false,
      status: 'invalid',
      targetVersion: WIS_CURRENT_CORE_VERSION,
      diagnostics: [
        compatibilityDiagnostic(
          'WIS_COMPATIBILITY_INVALID_CORE_VERSION',
          '/coreVersion',
          'coreVersion exceeds the portable identifier limit.'
        ),
      ],
    };
  }

  if (typeof sourceVersion === 'string' && sourceVersion.length > 0) {
    return {
      compatible: false,
      status: 'unsupported',
      sourceVersion,
      targetVersion: WIS_CURRENT_CORE_VERSION,
      diagnostics: [
        compatibilityDiagnostic(
          'WIS_COMPATIBILITY_UNSUPPORTED_CORE_VERSION',
          '/coreVersion',
          'The declared Core version is not supported by this compatibility boundary.'
        ),
      ],
    };
  }

  return {
    compatible: false,
    status: 'invalid',
    targetVersion: WIS_CURRENT_CORE_VERSION,
    diagnostics: [
      compatibilityDiagnostic(
        'WIS_COMPATIBILITY_MISSING_CORE_VERSION',
        '/coreVersion',
        'A non-empty coreVersion is required for compatibility negotiation.'
      ),
    ],
  };
}
