import { WIS_GENERATED_CONTRACT_REGISTRY } from '../generated/registry.js';

export type WisGeneratedContractDescriptor =
  (typeof WIS_GENERATED_CONTRACT_REGISTRY.contracts)[number];
export type WisGeneratedContractId = WisGeneratedContractDescriptor['id'];
export type WisGeneratedContractKey = WisGeneratedContractDescriptor['key'];

const contractsById = new Map(
  WIS_GENERATED_CONTRACT_REGISTRY.contracts.map((contract) => [contract.id, contract] as const)
);
const contractsByKey = new Map(
  WIS_GENERATED_CONTRACT_REGISTRY.contracts.map((contract) => [contract.key, contract] as const)
);

export function getWisGeneratedContract(
  identity: WisGeneratedContractId | WisGeneratedContractKey | string
): WisGeneratedContractDescriptor | undefined {
  return (
    contractsById.get(identity as WisGeneratedContractId) ??
    contractsByKey.get(identity as WisGeneratedContractKey)
  );
}
