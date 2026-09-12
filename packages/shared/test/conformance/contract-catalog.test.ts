import { describe, expect, it } from 'vitest';

import {
  WIS_GENERATED_CONTRACT_REGISTRY,
  getWisGeneratedContract,
} from '../../src/registry/index.js';
import {
  validateWisContractCatalogStructure,
  validateWisGeneratedContractStructure,
} from '../../src/validation/index.js';

describe('@workspai/shared multi-contract catalog', () => {
  it('validates its own generated digest-bound catalog', () => {
    expect(validateWisContractCatalogStructure(WIS_GENERATED_CONTRACT_REGISTRY)).toBe(true);
    expect(validateWisContractCatalogStructure.errors).toBeNull();
    expect(WIS_GENERATED_CONTRACT_REGISTRY).toMatchObject({
      schemaVersion: 'workspai-shared-generated-registry.v2',
      portfolioDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(WIS_GENERATED_CONTRACT_REGISTRY.contracts.map((entry) => entry.key)).toEqual([
      'contract-catalog',
      'core-result-envelope',
      'core-result-envelope-v0-1',
    ]);
    expect(Object.isFrozen(WIS_GENERATED_CONTRACT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(WIS_GENERATED_CONTRACT_REGISTRY.contracts)).toBe(true);
    expect(Object.isFrozen(WIS_GENERATED_CONTRACT_REGISTRY.contracts[0])).toBe(true);
  });

  it('rejects a catalog whose digest or contract metadata is incomplete', () => {
    const invalid = structuredClone(WIS_GENERATED_CONTRACT_REGISTRY) as unknown as {
      portfolioDigest: string;
      contracts: Array<{ validatorExport?: string }>;
    };
    invalid.portfolioDigest = 'sha256:not-a-digest';
    delete invalid.contracts[0]?.validatorExport;

    expect(validateWisContractCatalogStructure(invalid)).toBe(false);
    expect(validateWisContractCatalogStructure.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: expect.any(String) })])
    );
  });

  it('resolves and validates contracts by stable ID or key without deep imports', () => {
    expect(getWisGeneratedContract('contract-catalog')?.id).toBe(
      'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft'
    );
    expect(
      validateWisGeneratedContractStructure(
        'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft',
        WIS_GENERATED_CONTRACT_REGISTRY
      )
    ).toMatchObject({ valid: true });
    expect(validateWisGeneratedContractStructure('missing-contract', {})).toEqual({
      valid: false,
      errors: [{ code: 'WIS_CONTRACT_NOT_FOUND', contract: 'missing-contract' }],
    });
  });

  it('applies resource limits and cancellation before generic generated validation', () => {
    expect(
      validateWisGeneratedContractStructure('contract-catalog', WIS_GENERATED_CONTRACT_REGISTRY, {
        signal: { aborted: true },
      })
    ).toMatchObject({
      valid: false,
      contract: { key: 'contract-catalog' },
      errors: [expect.objectContaining({ code: 'WIS_RESOURCE_CANCELLED' })],
    });

    expect(
      validateWisGeneratedContractStructure(
        'contract-catalog',
        { nested: { too: 'deep' } },
        {
          limits: { maxDepth: 1 },
        }
      )
    ).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'WIS_RESOURCE_DEPTH_LIMIT' })],
    });
  });
});
