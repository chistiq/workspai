import type { WisCoreResultEnvelope } from '../generated/wis-core-result-envelope.js';

export type WisValidationPhase = 'resource' | 'structural' | 'semantic' | 'compatibility';

export interface WisValidationDiagnostic {
  readonly code: string;
  readonly phase: WisValidationPhase;
  readonly path: string;
  readonly message: string;
  readonly keyword?: string;
}

export interface WisValidationLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringLength: number;
  readonly maxTotalStringLength: number;
  readonly maxDiagnostics: number;
}

export interface WisValidationPolicy {
  /**
   * Organization scope is disabled by default. A host must explicitly admit
   * the exact WIS profile IDs that are authorized to carry organization scope.
   */
  readonly organizationScopeProfiles?: readonly string[];
}

/** Minimal browser-neutral cancellation shape accepted by the synchronous validator. */
export interface WisValidationCancellationSignal {
  readonly aborted: boolean;
}

export interface WisValidationOptions {
  readonly limits?: Partial<WisValidationLimits>;
  readonly policy?: WisValidationPolicy;
  readonly signal?: WisValidationCancellationSignal;
}

export type WisValidationResult =
  | {
      readonly valid: true;
      readonly value: WisCoreResultEnvelope;
      readonly diagnostics: readonly [];
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly WisValidationDiagnostic[];
      readonly truncatedDiagnostics: number;
    };

export const DEFAULT_WIS_VALIDATION_LIMITS: WisValidationLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxStringLength: 1_048_576,
  maxTotalStringLength: 4_194_304,
  maxDiagnostics: 100,
});
