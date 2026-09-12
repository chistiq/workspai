import { WIS_GENERATED_STRUCTURAL_VALIDATORS } from '../generated/validators.js';
import {
  getWisGeneratedContract,
  type WisGeneratedContractDescriptor,
  type WisGeneratedContractId,
  type WisGeneratedContractKey,
} from '../registry/catalog.js';
import { resolveWisValidationLimits } from './limits.js';
import { inspectJsonResourceLimits } from './resource-guard.js';
import type { WisValidationOptions } from './types.js';

export type WisStructuralValidationResult =
  | {
      readonly valid: true;
      readonly contract: WisGeneratedContractDescriptor;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly contract?: WisGeneratedContractDescriptor;
      readonly errors: readonly object[];
    };

export function validateWisGeneratedContractStructure(
  identity: WisGeneratedContractId | WisGeneratedContractKey | string,
  value: unknown,
  options?: WisValidationOptions
): WisStructuralValidationResult {
  const contract = getWisGeneratedContract(identity as WisGeneratedContractId);
  if (!contract) {
    return {
      valid: false,
      errors: [{ code: 'WIS_CONTRACT_NOT_FOUND', contract: identity }],
    };
  }
  const validator = WIS_GENERATED_STRUCTURAL_VALIDATORS[contract.id];
  if (!validator) {
    return {
      valid: false,
      contract,
      errors: [{ code: 'WIS_VALIDATOR_NOT_FOUND', contract: contract.id }],
    };
  }
  const limits = resolveWisValidationLimits(options);
  const resourceDiagnostics = inspectJsonResourceLimits(value, limits, options?.signal);
  if (resourceDiagnostics.length > 0) {
    return {
      valid: false,
      contract,
      errors: resourceDiagnostics.slice(0, limits.maxDiagnostics),
    };
  }
  if (validator(value)) return { valid: true, contract, errors: [] };
  return {
    valid: false,
    contract,
    errors: (validator.errors ?? []).slice(0, limits.maxDiagnostics),
  };
}
