import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type WisContractReference,
  type WisResultEnvelope,
  type WisScopeReference,
} from '@workspai/shared/contracts';
import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';

import {
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphPackageMetadata,
} from '../../src/contracts/index.js';
import { getGraphPackageStatus } from '../../src/index.js';

describe('Shared protocol interoperability', () => {
  it('binds Graph contracts to the canonical Shared contract reference', () => {
    expectTypeOf(GRAPH_PROVIDER_MANIFEST_CONTRACT).toMatchTypeOf<WisContractReference>();
    expect(GRAPH_PROVIDER_MANIFEST_CONTRACT).toEqual({
      id: 'workspai.graph.provider-manifest',
      version: '0.1.0-draft',
    });
    expect(Object.isFrozen(GRAPH_PROVIDER_MANIFEST_CONTRACT)).toBe(true);
  });

  it('returns a Graph payload inside the canonical result envelope', () => {
    const scope: WisScopeReference = {
      kind: 'workspace',
      workspaceId: 'workspace:fixture',
    };
    const result: WisResultEnvelope<GraphPackageMetadata> = getGraphPackageStatus(scope);

    expect(result.scope).toEqual(scope);
    expect(result.schemaId).toBe('workspai.graph.package-status');
    expect(validateWisCoreResultEnvelope(result)).toMatchObject({ valid: true });
  });
});
