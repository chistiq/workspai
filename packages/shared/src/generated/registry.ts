/* Generated from schemas/generation-manifest.v2.json. Do not edit. */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const WIS_GENERATED_CONTRACT_REGISTRY = deepFreeze({
  schemaVersion: 'workspai-shared-generated-registry.v2',
  status: 'candidate',
  portfolioDigest: 'sha256:15e091961df7e19218960a21f7ef01989663333f09de97d85b554753f9a76306',
  contracts: [
    {
      key: 'contract-catalog',
      id: 'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft',
      title: 'WisContractCatalog',
      version: '0.1.0-draft',
      dialect: 'https://json-schema.org/draft/2020-12/schema',
      source: 'schemas/src/wis-contract-catalog.v0.1.0-draft.schema.json',
      digest: 'sha256:0e821f6cc6ecb78fba84c888f5912d030e377d04a6956f5270a329affc3b9cf4',
      typeExport: 'WisContractCatalog',
      validatorExport: 'validateWisContractCatalogStructure',
      dependencies: [],
    },
    {
      key: 'core-result-envelope',
      id: 'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft',
      title: 'WisCoreResultEnvelope',
      version: '0.2.0-draft',
      dialect: 'https://json-schema.org/draft/2020-12/schema',
      source: 'schemas/src/wis-core-result-envelope.v0.2.0-draft.schema.json',
      digest: 'sha256:e1d46c17b7f9a1cabab66c3392ce6c6b4a6b69278026f0d743c7680fc42ebeaa',
      typeExport: 'WisCoreResultEnvelope',
      validatorExport: 'validateWisCoreResultEnvelopeStructure',
      dependencies: [],
    },
    {
      key: 'core-result-envelope-v0-1',
      id: 'https://schemas.workspai.dev/wis/core/result-envelope/0.1.0-draft',
      title: 'WisCoreResultEnvelopeV01',
      version: '0.1.0-draft',
      dialect: 'https://json-schema.org/draft/2020-12/schema',
      source: 'schemas/compatibility/wis-core-result-envelope.v0.1.0-draft.schema.json',
      digest: 'sha256:37348ddc103b283ca545e3cc89020b1f254b2bece1834b0822a0a5b7eb607aa9',
      typeExport: 'WisCoreResultEnvelopeV01',
      validatorExport: 'validateWisCoreResultEnvelopeV01Structure',
      dependencies: ['https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft'],
    },
  ],
} as const);
