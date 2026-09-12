import { describe, expect, it } from 'vitest';

import {
  GRAPH_RETRIEVAL_BENCHMARK_CLAIM,
  GRAPH_RETRIEVAL_BENCHMARK_CONTRACT,
} from '../../src/contracts/index.js';
import { scoreGraphRetrievalBenchmark } from '../../src/testing/index.js';

const corpus = {
  id: 'fixture',
  version: '1',
  groundTruthClass: 'synthetic' as const,
  accuracyClaim: 'none' as const,
  graph: { nodes: [] },
  cases: [
    {
      id: 'hit',
      family: 'dependency-traversal',
      query: { kind: 'dependencies' },
      expect: { accepted: true, truncated: false, resultIds: ['module:app', 'module:lib'] },
    },
    {
      id: 'truncated',
      family: 'truncation-preservation',
      query: { kind: 'dependencies' },
      expect: { accepted: true, truncated: true },
    },
    {
      id: 'prohibited',
      family: 'unsupported-strategy-preservation',
      query: { kind: 'dependencies', strategy: 'similarity' },
      expect: { accepted: false, issueCodes: ['GRAPH_QUERY_STRATEGY_PROHIBITED'] },
    },
  ],
};

describe('synthetic retrieval benchmark scoring', () => {
  it('scores fixture-labelled hits and keeps truncated rows out of accuracy aggregates', () => {
    const report = scoreGraphRetrievalBenchmark(corpus, [
      {
        id: 'hit',
        accepted: true,
        resultIds: ['module:app', 'module:lib'],
        pathNodeIds: ['module:app', 'module:lib'],
        truncated: false,
        selectedStrategy: 'graph',
        issueCodes: [],
        unknownCodes: [],
        elapsedMs: 1,
      },
      {
        id: 'truncated',
        accepted: true,
        resultIds: ['module:app'],
        pathNodeIds: ['module:app'],
        truncated: true,
        selectedStrategy: 'graph',
        issueCodes: [],
        unknownCodes: [],
        elapsedMs: 1,
      },
      {
        id: 'prohibited',
        accepted: false,
        resultIds: [],
        pathNodeIds: [],
        truncated: false,
        issueCodes: ['GRAPH_QUERY_STRATEGY_PROHIBITED'],
        unknownCodes: [],
        elapsedMs: 1,
      },
    ]);

    expect(report.contract).toEqual(GRAPH_RETRIEVAL_BENCHMARK_CONTRACT);
    expect(report.accuracyClaim).toBe(GRAPH_RETRIEVAL_BENCHMARK_CLAIM.accuracyClaim);
    expect(report.publicAccuracyClaimPermitted).toBe(false);
    expect(report.scoredCases).toBe(1);
    expect(report.meanPrecision).toBe(1);
    expect(report.meanRecall).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.cases.find((item) => item.id === 'truncated')?.scored).toBe(false);
  });

  it('fails when expected result identities do not match', () => {
    const report = scoreGraphRetrievalBenchmark(corpus, [
      {
        id: 'hit',
        accepted: true,
        resultIds: ['module:app'],
        pathNodeIds: ['module:app'],
        truncated: false,
        selectedStrategy: 'graph',
        issueCodes: [],
        unknownCodes: [],
        elapsedMs: 1,
      },
      {
        id: 'truncated',
        accepted: true,
        resultIds: ['module:app'],
        pathNodeIds: ['module:app'],
        truncated: true,
        selectedStrategy: 'graph',
        issueCodes: [],
        unknownCodes: [],
        elapsedMs: 1,
      },
      {
        id: 'prohibited',
        accepted: false,
        resultIds: [],
        pathNodeIds: [],
        truncated: false,
        issueCodes: ['GRAPH_QUERY_STRATEGY_PROHIBITED'],
        unknownCodes: [],
        elapsedMs: 1,
      },
    ]);
    expect(report.failures).toEqual(['hit: result-mismatch']);
    expect(report.scoredCases).toBe(0);
  });

  it('rejects a corpus that would support a public accuracy claim', () => {
    const report = scoreGraphRetrievalBenchmark(
      {
        ...corpus,
        accuracyClaim: 'none',
        groundTruthClass: 'independent' as unknown as 'synthetic',
      },
      []
    );
    expect(report.failures).toEqual(
      expect.arrayContaining(['Retrieval corpus ground truth must stay synthetic'])
    );
  });
});
