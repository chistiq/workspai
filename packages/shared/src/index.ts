export * from './contracts/index.js';
export * from './compatibility/index.js';
export { WIS_GENERATED_CONTRACT_REGISTRY } from './registry/index.js';
export {
  DEFAULT_WIS_VALIDATION_LIMITS,
  MAX_WIS_VALIDATION_LIMITS,
  isWisCoreResultEnvelope,
  validateWisContractCatalogStructure,
  validateWisCoreResultEnvelope,
  validateWisGeneratedContractStructure,
  type WisStructuralValidationResult,
  type WisValidationDiagnostic,
  type WisValidationCancellationSignal,
  type WisValidationLimits,
  type WisValidationOptions,
  type WisValidationPhase,
  type WisValidationPolicy,
  type WisValidationResult,
} from './validation/index.js';
export {
  getWisGeneratedContract,
  type WisGeneratedContractDescriptor,
  type WisGeneratedContractId,
  type WisGeneratedContractKey,
} from './registry/index.js';

export const WORKSPAI_SHARED_PACKAGE = Object.freeze({
  name: '@workspai/shared',
  maturity: 'protocol-foundation' as const,
  publishable: false,
});
