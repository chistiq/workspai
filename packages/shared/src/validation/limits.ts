import {
  DEFAULT_WIS_VALIDATION_LIMITS,
  type WisValidationLimits,
  type WisValidationOptions,
} from './types.js';

export const MAX_WIS_VALIDATION_LIMITS: WisValidationLimits = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxStringLength: 16 * 1024 * 1024,
  maxTotalStringLength: 16 * 1024 * 1024,
  maxDiagnostics: 1_000,
});

export function resolveWisValidationLimits(options?: WisValidationOptions): WisValidationLimits {
  const limits = { ...DEFAULT_WIS_VALIDATION_LIMITS, ...options?.limits };
  for (const [name, value] of Object.entries(limits) as Array<
    [keyof WisValidationLimits, number]
  >) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
    if (value > MAX_WIS_VALIDATION_LIMITS[name]) {
      throw new RangeError(`${name} exceeds the hard safety ceiling`);
    }
  }
  return limits;
}
