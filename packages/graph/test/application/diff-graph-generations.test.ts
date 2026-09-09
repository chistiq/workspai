import { describe, expect, it } from 'vitest';

import { diffGraphGenerations } from '../../src/application/diff-graph-generations.js';
import {
  summarizeDeltaProcessingLedger,
  summarizeInputProcessingLedger,
} from '../../src/application/summarize-input-processing-ledger.js';
import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  type GraphCanonicalGraph,
} from '../../src/contracts/index.js';

const digest = { algorithm: 'sha256' as const, value: 'b'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };

function graph(
  id: string,
  nodes: string[],
  edgeState: 'accepted' | 'disputed' = 'accepted'
): GraphCanonicalGraph {
  return {
    contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
    graphVersion: '0.1.0-candidate',
    generation: {
      reference: { id, generatedAt: '2026-09-09T20:00:00.000Z', contentDigest: digest },
      graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
      architectureEpoch: 'wis-graph-1',
      ontologySetDigest: digest,
      proofPolicySetDigest: digest,
      inputsDigest: digest,
      factSetDigest: digest,
      providerSetDigest: digest,
      compositionPolicyDigest: digest,
    },
    ontology: [],
    nodes: nodes.map((nodeId) => ({
      id: nodeId,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope,
    })),
    edges:
      nodes.length > 1
        ? [
            {
              id: 'edge:imports:1',
              relation: 'imports',
              semantics: 'structural',
              from: nodes[0]!,
              to: nodes[1]!,
              state: edgeState,
              facts: ['fact:1'],
              derivations: ['extracted'],
              proof: {
                policy: { id: 'workspai.graph.proof.structural', version: '1' },
                state: edgeState === 'accepted' ? 'supported' : 'disputed',
                authorities: ['observed'],
                evidence: [],
                corroborationGroups: [],
                counterEvidence: [],
                missingRequirements: [],
                evaluatedAt: '2026-09-09T20:00:00.000Z',
                inputDigest: digest,
                explanationCode: 'STRUCTURAL_IMPORT',
              },
              freshness: { status: 'current' },
              confidence: 1,
              explanation: { code: 'ACCEPTED', drivers: ['observed-import'] },
            },
          ]
        : [],
    assertions: [],
    disputes: [],
    unresolved: [],
    diagnostics: [],
  };
}

describe('diffGraphGenerations', () => {
  it('reports added and removed identities without ledger claims', () => {
    const diff = diffGraphGenerations({
      from: graph('generation:1', ['entity:a', 'entity:b']),
      to: graph('generation:2', ['entity:b', 'entity:c']),
    });
    expect(diff.addedNodes).toEqual(['entity:c']);
    expect(diff.removedNodes).toEqual(['entity:a']);
    expect(diff.limitations.some((entry) => entry.includes('not an event ledger'))).toBe(true);
  });

  it('detects changed edge proof state', () => {
    const diff = diffGraphGenerations({
      from: graph('generation:1', ['entity:a', 'entity:b'], 'accepted'),
      to: graph('generation:2', ['entity:a', 'entity:b'], 'disputed'),
    });
    expect(diff.changedEdges).toEqual(['edge:imports:1']);
  });

  it('warns when both graphs share one generation identity', () => {
    const source = graph('generation:1', ['entity:a']);
    const diff = diffGraphGenerations({ from: source, to: source });
    expect(diff.diagnostics[0]?.code).toBe('GRAPH_GENERATION_DIFF_SAME_IDENTITY');
  });
});

describe('summarizeInputProcessingLedger', () => {
  it('counts every processing outcome without fabricating facts', () => {
    const ledger = summarizeInputProcessingLedger([
      {
        input: { locator: 'src/index.ts', digest },
        provider: { id: 'workspai.graph.provider.fixture', version: '1' },
        stage: { id: 'stage', version: '1' },
        outcome: 'processed',
        diagnostics: [],
      },
      {
        input: { locator: 'src/skip.ts', digest },
        provider: { id: 'workspai.graph.provider.fixture', version: '1' },
        stage: { id: 'stage', version: '1' },
        outcome: 'unchanged',
        diagnostics: [],
      },
    ]);
    expect(ledger.processed).toBe(1);
    expect(ledger.unchanged).toBe(1);
    expect(ledger.failed).toBe(0);
  });

  it('summarizes delta execution processing records', () => {
    const ledger = summarizeDeltaProcessingLedger({
      detected: 1,
      scanned: 1,
      parsed: 1,
      recomputed: 0,
      skippedByDigest: 1,
      unsupported: 0,
      failed: 0,
      truncation: [],
      processing: [
        {
          input: { locator: 'src/skip.ts', digest },
          provider: { id: 'workspai.graph.provider.fixture', version: '1' },
          stage: { id: 'stage', version: '1' },
          outcome: 'unchanged',
          diagnostics: [],
        },
      ],
    });
    expect(ledger.unchanged).toBe(1);
  });
});
