import { describe, expect, it } from 'vitest';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_SLICE_REQUEST_CONTRACT,
  type GraphCanonicalGraph,
  type GraphEdge,
  type GraphEntityReference,
} from '../../src/contracts/index.js';
import { createGraphSlice } from '../../src/projections/index.js';

const digest = { algorithm: 'sha256' as const, value: 'b'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:slice'] as [string] };
const generation = {
  id: 'generation:slice',
  generatedAt: '2026-09-09T00:00:00.000Z',
  contentDigest: digest,
};

function node(id: string): GraphEntityReference {
  return { id, kind: 'service', scope, identityScheme: GRAPH_IDENTITY_SCHEME };
}

function connect(from: string, to: string, semantics: GraphEdge['semantics']): GraphEdge {
  const id = `edge:${from}:${to}`;
  return {
    id,
    from,
    to,
    relation: semantics === 'behavioral' ? 'calls' : 'depends-on',
    semantics,
    state: 'accepted',
    facts: [id],
    derivations: ['observed'],
    proof: {
      policy: { id: 'workspai.graph.proof.standard', version: '1' },
      state: 'supported',
      evidence: [
        {
          id: `evidence:${id}`,
          sourceKind: 'source-file',
          relativeLocator: `src/${from}.ts`,
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
  nodes: [node('service:a'), node('service:b'), node('service:c')],
  edges: [
    connect('service:a', 'service:b', 'behavioral'),
    connect('service:b', 'service:c', 'structural'),
  ],
  assertions: [],
  disputes: [],
  unresolved: [],
  diagnostics: [],
};

describe('createGraphSlice', () => {
  it('builds a bounded impact slice with provenance and explicit exclusions', () => {
    const slice = createGraphSlice(graph, {
      contract: GRAPH_SLICE_REQUEST_CONTRACT,
      intent: 'impact',
      subjects: ['service:a', 'missing:subject'],
      budget: { maxDepth: 2, maxNodes: 10, maxEdges: 10 },
      includeEvidence: true,
      redactionPolicy: 'agent-local',
    });
    expect(slice.accepted).toBe(true);
    if (!slice.accepted) return;
    expect(slice.value.sourceGeneration).toEqual(generation);
    expect(slice.value.nodes.map((entry) => entry.id)).toContain('service:a');
    expect(slice.value.explanation.excludedSubjects).toEqual(['missing:subject']);
    expect(slice.value.evidence.length).toBeGreaterThan(0);
  });

  it('rejects empty subject lists fail-closed', () => {
    const slice = createGraphSlice(graph, {
      contract: GRAPH_SLICE_REQUEST_CONTRACT,
      intent: 'understand',
      subjects: [],
      budget: {},
      includeEvidence: false,
      redactionPolicy: 'portable-default',
    });
    expect(slice.accepted).toBe(false);
    expect(slice.issues[0]?.code).toBe('GRAPH_SLICE_SUBJECTS_REQUIRED');
  });

  it('reports truncation when budgets are exceeded', () => {
    const slice = createGraphSlice(graph, {
      contract: GRAPH_SLICE_REQUEST_CONTRACT,
      intent: 'understand',
      subjects: ['service:a'],
      budget: { maxDepth: 2, maxNodes: 1, maxEdges: 1 },
      includeEvidence: false,
      redactionPolicy: 'portable-default',
    });
    expect(slice.accepted).toBe(true);
    if (!slice.accepted) return;
    expect(slice.value.truncation.truncated).toBe(true);
  });

  it('prioritizes behavioral neighbors for impact intent', () => {
    const slice = createGraphSlice(graph, {
      contract: GRAPH_SLICE_REQUEST_CONTRACT,
      intent: 'impact',
      subjects: ['service:a'],
      budget: { maxDepth: 1, maxNodes: 3, maxEdges: 1 },
      includeEvidence: true,
      redactionPolicy: 'agent-local',
    });
    expect(slice.accepted).toBe(true);
    if (!slice.accepted) return;
    expect(slice.value.edges[0]?.semantics).toBe('behavioral');
    expect(slice.value.evidence.length).toBeGreaterThan(0);
  });

  it('rejects invalid slice budgets', () => {
    const slice = createGraphSlice(graph, {
      contract: GRAPH_SLICE_REQUEST_CONTRACT,
      intent: 'repair',
      subjects: ['service:a'],
      budget: { maxNodes: 0 },
      includeEvidence: false,
      redactionPolicy: 'portable-default',
    });
    expect(slice.accepted).toBe(false);
    expect(slice.issues[0]?.code).toBe('GRAPH_SLICE_BUDGET_INVALID');
  });
});
