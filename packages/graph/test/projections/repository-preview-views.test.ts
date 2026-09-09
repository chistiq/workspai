import { describe, expect, it } from 'vitest';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_QUALITY_CONTRACT,
  type GraphCanonicalGraph,
  type GraphEdge,
  type GraphEntityReference,
  type GraphQualityReport,
} from '../../src/contracts/index.js';
import { projectRepositoryPreview } from '../../src/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:preview'] as [string] };
const generation = {
  id: 'generation:preview',
  generatedAt: '2026-09-09T00:00:00.000Z',
  contentDigest: digest,
};

function node(id: string, kind: string): GraphEntityReference {
  return { id, kind, scope, identityScheme: GRAPH_IDENTITY_SCHEME };
}

function edge(id: string, from: string, to: string, semantics: GraphEdge['semantics']): GraphEdge {
  return {
    id,
    from,
    to,
    relation: semantics === 'structural' ? 'contains' : 'configured-by',
    semantics,
    state: 'accepted',
    facts: [`fact:${id}`],
    derivations: ['extracted'],
    proof: {
      policy: { id: 'workspai.graph.proof.standard', version: '1' },
      state: 'supported',
      evidence: [
        {
          id: `evidence:${id}`,
          sourceKind: 'source-file',
          relativeLocator: `src/${id}.ts`,
          digest,
        },
      ],
      authorities: ['observed'],
      corroborationGroups: [],
      counterEvidence: [],
      missingRequirements: [],
      evaluatedAt: generation.generatedAt,
      inputDigest: digest,
      explanationCode: 'GRAPH_EDGE_SUPPORTED',
    },
    freshness: { status: 'current' },
    confidence: 1,
    explanation: { code: 'GRAPH_EDGE_SUPPORTED', drivers: ['fixture'] },
  };
}

const graph: GraphCanonicalGraph = {
  contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
  graphVersion: '0.1.0-candidate',
  generation: {
    reference: generation,
    graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
    architectureEpoch: 'wis-graph-1',
    ontologySetDigest: digest,
    proofPolicySetDigest: digest,
    inputsDigest: digest,
    factSetDigest: digest,
    providerSetDigest: digest,
    compositionPolicyDigest: digest,
  },
  ontology: [{ id: 'workspai.graph.ontology.core', version: '0.1.0-candidate' }],
  nodes: [
    node('repository:root', 'repository'),
    node('file:index', 'file'),
    node('runtime:node', 'runtime'),
  ],
  edges: [
    edge('edge:source', 'repository:root', 'file:index', 'structural'),
    edge('edge:runtime', 'runtime:node', 'file:index', 'declarative'),
  ],
  assertions: [],
  disputes: [],
  unresolved: [{ id: 'unresolved:fixture', candidates: ['file:a', 'file:b'] }],
  diagnostics: [],
};

const quality: GraphQualityReport = {
  contract: GRAPH_QUALITY_CONTRACT,
  generation,
  integrity: 'pass',
  determinism: 'pass',
  incrementalEquivalence: 'not-assessed',
  coverage: [],
  proofStates: {
    supported: 2,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  },
  unknownZones: [{ code: 'graph.fixture-unknown', scope: 'fixture', reason: 'Fixture.' }],
  unsupportedZones: [],
  staleZones: [],
  conflicts: [],
  orphans: [],
  providerFailures: [],
  releaseClaims: [],
};

describe('G4 fixed repository preview views', () => {
  it('preserves canonical identities, generation and proof without creating new truth', () => {
    const source = projectRepositoryPreview(graph, quality, 'source');
    expect(source.accepted).toBe(true);
    if (!source.accepted) return;

    expect(source.value.sourceGeneration).toBe(graph.generation.reference);
    expect(source.value.nodes.map((item) => item.id)).toEqual(['file:index', 'repository:root']);
    expect(source.value.edges).toEqual([graph.edges[0]]);
    expect(source.value.evidence).toEqual(graph.edges[0]?.proof.evidence);
    expect(source.value.unknownZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'graph.fixture-unknown' }),
        expect.objectContaining({ code: 'graph.repository-preview-source-unresolved' }),
      ])
    );
  });

  it('separates structural and evidence views deterministically', () => {
    const structural = projectRepositoryPreview(graph, quality, 'structural');
    const evidence = projectRepositoryPreview(graph, quality, 'evidence');
    expect(structural.accepted && structural.value.edges.map((item) => item.id)).toEqual([
      'edge:source',
    ]);
    expect(evidence.accepted && evidence.value.edges.map((item) => item.id)).toEqual([
      'edge:runtime',
      'edge:source',
    ]);
  });

  it('reports bounded truncation and rejects unsafe budgets', () => {
    const bounded = projectRepositoryPreview(graph, quality, 'evidence', {
      maxNodes: 2,
      maxEdges: 1,
      maxEvidence: 1,
    });
    expect(bounded).toMatchObject({
      accepted: true,
      value: {
        truncation: { truncated: true, reasons: expect.arrayContaining(['nodes', 'edges']) },
      },
    });
    expect(projectRepositoryPreview(graph, quality, 'source', { maxNodes: 0 })).toMatchObject({
      accepted: false,
      issues: [{ code: 'GRAPH_REPOSITORY_PREVIEW_VIEW_BUDGET_INVALID' }],
    });
  });
});
