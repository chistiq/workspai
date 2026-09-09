import { describe, expect, it } from 'vitest';

import { planQueryCacheInvalidation } from '../../src/application/plan-query-cache-invalidation.js';
import {
  GRAPH_DELTA_CONTRACT,
  GRAPH_QUERY_CACHE_CONTRACT,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  type GraphQueryCacheEntry,
} from '../../src/contracts/index.js';

const digest = (value: string) =>
  Object.freeze({ algorithm: 'sha256' as const, value: value.padEnd(64, '0') });

function entry(
  patch: Partial<GraphQueryCacheEntry['key']> & { readonly keyDigest: string }
): GraphQueryCacheEntry {
  const { keyDigest, ...keyPatch } = patch;
  return {
    contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
    keyDigest: digest(keyDigest),
    key: {
      contract: GRAPH_QUERY_CACHE_CONTRACT,
      graphGeneration: {
        id: 'generation:base',
        generatedAt: '2026-09-09T20:00:00.000Z',
        contentDigest: digest('gen'),
      },
      queryDigest: digest('query'),
      ontologyDigest: digest('onto'),
      proofPolicyDigest: digest('proof'),
      profileDigest: digest('profile'),
      plannerProfileDigest: digest('planner'),
      resultProfileDigest: digest('result'),
      projectionDigests: [],
      indexDigests: [],
      requiredExtensions: [],
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      redactionPolicyDigest: digest('redact'),
      authorizationDigest: digest('auth'),
      budget: { maxDepth: 4, maxNodes: 100, maxEdges: 200, maxEvidence: 50 },
      ...keyPatch,
    },
    result: null,
    resultDigest: digest('result-body'),
    freshness: { status: 'current' },
  };
}

describe('planQueryCacheInvalidation', () => {
  it('does not drop explicit historical generation entries on a new delta', () => {
    const historical = entry({
      keyDigest: 'hist',
      graphGeneration: {
        id: 'generation:older',
        generatedAt: '2026-09-08T20:00:00.000Z',
        contentDigest: digest('old'),
      },
    });
    const planned = planQueryCacheInvalidation({
      entries: [historical],
      delta: {
        contract: GRAPH_DELTA_CONTRACT,
        baseGeneration: 'generation:base',
        targetGeneration: 'generation:target',
        changedInputs: [],
        affectedProviders: [],
        facts: { added: [], renewed: [], removed: [], invalidated: [] },
        graph: { addedNodes: [], removedNodes: [], changedEdges: [] },
        affectedProjections: [],
        downstreamInvalidations: ['query-cache:dependency-neighbors'],
        execution: {
          detected: 0,
          scanned: 0,
          parsed: 0,
          recomputed: 0,
          skippedByDigest: 0,
          unsupported: 0,
          failed: 0,
          truncation: [],
          processing: [],
        },
        equivalence: 'not-assessed',
      },
    });
    expect(planned).toEqual([]);
  });

  it('revokes historical entries when authorization policy changes', () => {
    const planned = planQueryCacheInvalidation({
      entries: [entry({ keyDigest: 'auth1' })],
      currentAuthorizationDigest: digest('new-auth'),
    });
    expect(planned).toEqual([
      expect.objectContaining({
        reason: 'authorization',
      }),
    ]);
  });

  it('invalidates overlay-bound keys when the overlay is stale', () => {
    const planned = planQueryCacheInvalidation({
      entries: [
        entry({
          keyDigest: 'overlay',
          overlayDigest: digest('old-overlay'),
        }),
      ],
      overlay: {
        contract: { id: 'workspai.graph.change-overlay', version: '0.1.0-candidate' },
        id: 'overlay:fixture',
        status: 'stale',
        proposal: { kind: 'patch', identity: 'patch:1', digest: 'f'.repeat(64) },
      } as never,
    });
    expect(planned[0]?.reason).toBe('generation');
  });

  it('classifies ontology, proof-policy, profile, scope, redaction and corruption reasons', () => {
    const indexed = entry({
      keyDigest: 'idx',
      indexDigests: [digest('index')],
    });
    const ontology = planQueryCacheInvalidation({
      entries: [entry({ keyDigest: 'onto' })],
      delta: {
        contract: GRAPH_DELTA_CONTRACT,
        baseGeneration: 'generation:base',
        targetGeneration: 'generation:target',
        changedInputs: [],
        affectedProviders: [],
        facts: { added: [], renewed: [], removed: [], invalidated: [] },
        graph: { addedNodes: [], removedNodes: [], changedEdges: [] },
        affectedProjections: [],
        downstreamInvalidations: ['query-cache:dependency-neighbors'],
        execution: {
          detected: 0,
          scanned: 0,
          parsed: 0,
          recomputed: 0,
          skippedByDigest: 0,
          unsupported: 0,
          failed: 0,
          truncation: [],
          processing: [],
        },
        equivalence: 'not-assessed',
      },
      causes: [{ kind: 'ontology', source: 'ontology-profile' }],
    });
    expect(ontology[0]?.reason).toBe('ontology');

    const proof = planQueryCacheInvalidation({
      entries: [entry({ keyDigest: 'proof' })],
      delta: ontology[0]
        ? {
            contract: GRAPH_DELTA_CONTRACT,
            baseGeneration: 'generation:base',
            targetGeneration: 'generation:target',
            changedInputs: [],
            affectedProviders: [],
            facts: { added: [], renewed: [], removed: [], invalidated: [] },
            graph: { addedNodes: [], removedNodes: [], changedEdges: [] },
            affectedProjections: [],
            downstreamInvalidations: [],
            execution: {
              detected: 0,
              scanned: 0,
              parsed: 0,
              recomputed: 0,
              skippedByDigest: 0,
              unsupported: 0,
              failed: 0,
              truncation: [],
              processing: [],
            },
            equivalence: 'not-assessed',
          }
        : undefined,
      causes: [{ kind: 'proof-policy', source: 'proof-policy' }],
    });
    expect(proof[0]?.reason).toBe('proof-policy');

    const profile = planQueryCacheInvalidation({
      entries: [indexed],
      delta: {
        contract: GRAPH_DELTA_CONTRACT,
        baseGeneration: 'generation:base',
        targetGeneration: 'generation:target',
        changedInputs: [],
        affectedProviders: [],
        facts: { added: [], renewed: [], removed: [], invalidated: [] },
        graph: { addedNodes: [], removedNodes: [], changedEdges: [] },
        affectedProjections: ['workspai.graph.projection.dependency'],
        downstreamInvalidations: ['query-cache:dependency-neighbors'],
        execution: {
          detected: 0,
          scanned: 0,
          parsed: 0,
          recomputed: 0,
          skippedByDigest: 0,
          unsupported: 0,
          failed: 0,
          truncation: [],
          processing: [],
        },
        equivalence: 'not-assessed',
      },
    });
    expect(profile[0]?.reason).toBe('profile');

    expect(
      planQueryCacheInvalidation({
        entries: [entry({ keyDigest: 'scope' })],
        currentScope: { kind: 'workspace', workspaceId: 'workspace:other' },
      })[0]?.reason
    ).toBe('scope');
    expect(
      planQueryCacheInvalidation({
        entries: [entry({ keyDigest: 'redact' })],
        currentRedactionDigest: digest('new-redact'),
      })[0]?.reason
    ).toBe('redaction');
    expect(
      planQueryCacheInvalidation({
        entries: [entry({ keyDigest: 'corr' })],
        corruptKeyDigests: [digest('corr')],
      })[0]?.reason
    ).toBe('corruption');
  });
});
