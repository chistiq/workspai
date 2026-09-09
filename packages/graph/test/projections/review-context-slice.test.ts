import { describe, expect, it } from 'vitest';

import type { GraphEntityReference, GraphQueryResult } from '../../src/contracts/index.js';
import { GRAPH_IDENTITY_SCHEME } from '../../src/contracts/index.js';
import { buildReviewContextSlice } from '../../src/projections/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const generation = {
  id: 'generation:review-context',
  generatedAt: '2026-09-09T00:00:00.000Z',
  contentDigest: digest,
};
const scope = { kind: 'project' as const, projectIds: ['project:review'] as [string] };

function entity(id: string): GraphEntityReference {
  return { id, kind: 'file', scope, identityScheme: GRAPH_IDENTITY_SCHEME };
}

function queryResult(): GraphQueryResult<unknown> {
  return {
    generation,
    queryDigest: digest,
    result: [entity('file:z'), entity('file:a')],
    paths: [],
    evidence: [
      {
        id: 'evidence:z',
        sourceKind: 'source-file',
        relativeLocator: 'src/z.ts',
        digest,
      },
      {
        id: 'evidence:a',
        sourceKind: 'source-file',
        relativeLocator: 'src/a.ts',
        digest,
      },
    ],
    disputes: [
      { id: 'dispute:z', factIds: ['fact:z'] },
      { id: 'dispute:a', factIds: ['fact:a'] },
    ],
    unknownBoundaries: [
      { code: 'graph.z', scope: 'z', reason: 'Fixture.' },
      { code: 'graph.a', scope: 'a', reason: 'Fixture.' },
    ],
    cost: { visitedNodes: 2, visitedEdges: 0, returnedPaths: 0, returnedEvidence: 2 },
    quality: {
      proofStates: {} as GraphQueryResult['quality']['proofStates'],
      bindingCompleteness: [],
    },
    analysis: {
      profile: { id: 'workspai.graph.analysis.fixture', version: '1' },
      algorithm: { id: 'workspai.graph.algorithm.fixture', version: '1' },
      sourceGeneration: generation,
      proofThreshold: 'supported',
      capability: 'assessed',
      circularity: 'none',
      accuracyClaim: 'none',
      drivers: [],
      limitations: [],
      validationEvidence: [],
    },
  } as unknown as GraphQueryResult<unknown>;
}

describe('G4 bounded review context slice', () => {
  it('retains source identities and sorts model-facing collections deterministically', () => {
    const first = buildReviewContextSlice(queryResult());
    const second = buildReviewContextSlice(queryResult());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      accepted: true,
      value: {
        sourceGeneration: generation,
        sourceQueryDigest: digest,
        entities: [{ id: 'file:a' }, { id: 'file:z' }],
        evidence: [{ id: 'evidence:a' }, { id: 'evidence:z' }],
        disputes: [{ id: 'dispute:a' }, { id: 'dispute:z' }],
        unknownBoundaries: [{ code: 'graph.a' }, { code: 'graph.z' }],
        truncation: { truncated: false, reasons: [] },
      },
    });
  });

  it('reports item and canonical byte truncation without losing source accounting', () => {
    const itemBounded = buildReviewContextSlice(queryResult(), {
      maxEntities: 1,
      maxEvidence: 1,
      maxDisputes: 1,
      maxUnknownZones: 1,
    });
    expect(itemBounded).toMatchObject({
      accepted: true,
      value: {
        cost: { candidateItems: 8, returnedItems: 4 },
        truncation: {
          truncated: true,
          reasons: expect.arrayContaining(['entities', 'evidence', 'disputes', 'unknown-zones']),
        },
      },
    });

    const byteBounded = buildReviewContextSlice(queryResult(), { maxContentBytes: 1 });
    expect(byteBounded).toMatchObject({
      accepted: true,
      value: {
        cost: { candidateItems: 8, returnedItems: 0, contentBytes: 0 },
        truncation: { truncated: true, reasons: expect.arrayContaining(['content-bytes']) },
      },
    });
  });

  it('rejects unsafe budgets before producing a slice', () => {
    expect(buildReviewContextSlice(queryResult(), { maxPaths: 0 })).toMatchObject({
      accepted: false,
      issues: [{ code: 'GRAPH_REVIEW_CONTEXT_SLICE_BUDGET_INVALID', path: '/budget' }],
    });
    expect(
      buildReviewContextSlice(queryResult(), { maxContentBytes: 10 * 1024 * 1024 + 1 })
    ).toMatchObject({
      accepted: false,
    });
  });
});
