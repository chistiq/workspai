/* Generated validator barrel. Do not edit. */
import { validateWisContractCatalogStructure } from './wis-contract-catalog.validator.js';
import { validateWisCoreResultEnvelopeStructure } from './wis-core-result-envelope.validator.js';
import { validateWisCoreResultEnvelopeV01Structure } from './wis-core-result-envelope-v0-1-draft.validator.js';

export {
  validateWisContractCatalogStructure,
  validateWisCoreResultEnvelopeStructure,
  validateWisCoreResultEnvelopeV01Structure,
};

export interface WisGeneratedStructuralValidator {
  (value: unknown): boolean;
  errors?: readonly Record<string, unknown>[] | null;
}

export const WIS_GENERATED_STRUCTURAL_VALIDATORS: Readonly<
  Record<string, WisGeneratedStructuralValidator>
> = Object.freeze({
  'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft':
    validateWisContractCatalogStructure,
  'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft':
    validateWisCoreResultEnvelopeStructure,
  'https://schemas.workspai.dev/wis/core/result-envelope/0.1.0-draft':
    validateWisCoreResultEnvelopeV01Structure,
});
