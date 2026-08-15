import { describe, expect, it } from 'vitest';

import {
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  defineGraphProviderManifest,
} from '../../src/providers/index.js';

describe('provider manifest contract scaffold', () => {
  it('requires explicit claims, permissions, determinism and limits', () => {
    const manifest = defineGraphProviderManifest({
      contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
      id: 'fixture.typescript',
      version: '0.0.1',
      displayName: 'Fixture TypeScript provider',
      determinism: 'deterministic',
      capabilities: {
        entityKinds: ['file'],
        relationKinds: ['imports'],
        relationSemantics: ['structural'],
        factFamilies: ['source.import'],
        allowedClaims: ['declared-import'],
      },
      permissions: {
        filesystem: 'read',
        network: 'deny',
        process: 'deny',
        credentials: 'deny',
      },
      limits: { maxDurationMs: 1_000, maxFacts: 10_000 },
    });

    expect(manifest.capabilities.allowedClaims).toEqual(['declared-import']);
    expect(manifest.permissions.process).toBe('deny');
    expect(Object.isFrozen(manifest)).toBe(true);
  });
});
