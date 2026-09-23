import { describe, expect, it } from 'vitest';

import { consumePartitions, pullFactPartitions } from '../../src/application/partition-producer.js';
import type { GraphWorkspaceFact } from '../../src/contracts/index.js';

function fact(index: number): GraphWorkspaceFact {
  return {
    factId: `fact:${index}`,
    factType: 'source.import',
    subject: {
      id: `file:${index}`,
      identityScheme: 'workspai',
      kind: 'file',
      scope: { kind: 'project', projectIds: ['app'] },
    },
    predicate: 'imports',
    object: {
      id: `module:${index}`,
      identityScheme: 'workspai',
      kind: 'module',
      scope: { kind: 'project', projectIds: ['app'] },
    },
    scope: { kind: 'project', projectIds: ['app'] },
    evidence: [
      {
        id: `evidence:${index}`,
        sourceKind: 'source-file',
        relativeLocator: `src/${index}.ts`,
        digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
      },
    ],
    provenance: { id: 'provider', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change'] },
    observedAt: '2026-09-08T12:00:00.000Z',
    inputDigest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
    unknownZones: [],
    extensions: { payload: 'x'.repeat(512) },
  } as unknown as GraphWorkspaceFact;
}

describe('bounded partition producer', () => {
  it('retains one configured shard while streaming a large fact volume', async () => {
    const total = 4_000;
    async function* facts(): AsyncGenerator<GraphWorkspaceFact> {
      for (let index = 0; index < total; index += 1) yield fact(index);
    }
    let seen = 0;
    let peakFacts = 0;
    let peakBytes = 0;
    await consumePartitions(
      pullFactPartitions(
        facts(),
        {
          partitionId: 'synthetic',
          providerId: 'provider',
          sourceIdentity: 'synthetic',
          sourceDigest: 'ab'.repeat(32),
          streaming: 'bounded',
        },
        { maxFacts: 4, maxBytes: 64 * 1024 }
      ),
      { maxFacts: 4, maxBytes: 64 * 1024, maxInFlight: 1 },
      async (partition) => {
        seen += partition.facts.length;
        peakFacts = Math.max(peakFacts, partition.facts.length);
        peakBytes = Math.max(peakBytes, partition.metadata.encodedBytes);
        expect(partition.metadata.streaming).toBe('bounded');
      }
    );
    expect(seen).toBe(total);
    expect(peakFacts).toBeLessThanOrEqual(4);
    expect(peakBytes).toBeLessThanOrEqual(64 * 1024);
  });
});
