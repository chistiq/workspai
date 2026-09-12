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
import {
  GRAPH_DERIVED_PROJECTION_PROFILES,
  GRAPH_DERIVED_PROJECTIONS_AVAILABLE,
  projectDerivedGraph,
} from '../../src/projections/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:derived'] as [string] };
const generation = {
  id: 'generation:derived',
  generatedAt: '2026-09-09T00:00:00.000Z',
  contentDigest: digest,
};

function node(id: string, kind: string): GraphEntityReference {
  return { id, kind, scope, identityScheme: GRAPH_IDENTITY_SCHEME };
}

function edge(
  id: string,
  from: string,
  to: string,
  relation: string,
  semantics: GraphEdge['semantics'],
  proofState: GraphEdge['proof']['state'] = 'supported'
): GraphEdge {
  return {
    id,
    from,
    to,
    relation,
    semantics,
    state: 'accepted',
    facts: [`fact:${id}`],
    derivations: ['extracted'],
    proof: {
      policy: { id: 'workspai.graph.proof.standard', version: '1' },
      state: proofState,
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
    node('file:a', 'file'),
    node('file:b', 'file'),
    node('file:c', 'file'),
    node('service:api', 'service'),
    node('endpoint:login', 'endpoint'),
    node('symbol:handler', 'symbol'),
  ],
  edges: [
    edge('edge:contains-ab', 'file:a', 'file:b', 'contains', 'structural'),
    edge('edge:contains-bc', 'file:b', 'file:c', 'contains', 'structural'),
    edge('edge:routes', 'endpoint:login', 'service:api', 'routes-to', 'behavioral'),
    edge('edge:imports', 'symbol:handler', 'file:a', 'imports', 'structural'),
    edge('edge:weak', 'file:c', 'file:a', 'depends-on', 'structural', 'disputed'),
  ],
  assertions: [],
  disputes: [],
  unresolved: [],
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
    supported: 4,
    corroborated: 0,
    verified: 0,
    disputed: 1,
    insufficient: 0,
    unresolved: 0,
  },
  unknownZones: [{ code: 'graph.unknown', scope: 'file:c', reason: 'fixture unknown' }],
  unsupportedZones: [],
  staleZones: [],
  conflicts: [],
  orphans: [],
  providerFailures: [],
  releaseClaims: [],
};

describe('projectDerivedGraph', () => {
  it('advertises derived projection profiles as a G5 capability', () => {
    expect(GRAPH_DERIVED_PROJECTIONS_AVAILABLE).toBe(true);
  });

  it('preserves source generation and descriptor metadata across derived profiles', () => {
    for (const profile of Object.values(GRAPH_DERIVED_PROJECTION_PROFILES)) {
      const derived = projectDerivedGraph(graph, quality, { profile, budget: { maxItems: 10 } });
      expect(derived.accepted, profile.id).toBe(true);
      if (!derived.accepted) continue;
      expect(derived.value.descriptor.sourceGeneration).toEqual(generation);
      expect(derived.value.descriptor.algorithm.seed).toBe(profile.algorithm.seed);
      expect(derived.value.descriptor.limitations.length).toBeGreaterThan(0);
      expect(derived.value.contract.id).toBe('workspai.graph.derived-projection-result');
    }
  });

  it('discovers connected file communities without creating canonical edges', () => {
    const derived = projectDerivedGraph(graph, quality, {
      profile: GRAPH_DERIVED_PROJECTION_PROFILES.community,
      budget: { maxItems: 10 },
    });
    expect(derived.accepted).toBe(true);
    if (!derived.accepted) return;
    expect(derived.value.communities?.some((group) => group.members.includes('file:a'))).toBe(true);
    expect(graph.edges).toHaveLength(5);
  });

  it('ranks flow entry points deterministically', () => {
    const derived = projectDerivedGraph(graph, quality, {
      profile: GRAPH_DERIVED_PROJECTION_PROFILES.flow,
      budget: { maxItems: 10 },
    });
    expect(derived.accepted).toBe(true);
    if (!derived.accepted) return;
    expect(derived.value.flowRanks?.[0]?.entityId).toBe('endpoint:login');
    expect(derived.value.flowRanks?.[0]?.rank).toBe(1);
  });

  it('returns advisory review-risk findings with explicit limitations', () => {
    const derived = projectDerivedGraph(graph, quality, {
      profile: GRAPH_DERIVED_PROJECTION_PROFILES.reviewRisk,
      budget: { maxItems: 10 },
    });
    expect(derived.accepted).toBe(true);
    if (!derived.accepted) return;
    expect(derived.value.reviewFindings?.length).toBeGreaterThan(0);
    expect(derived.value.descriptor.limitations.join(' ')).toContain('merge-conflict');
    expect(derived.value.descriptor.omissions.length).toBeGreaterThan(0);
  });

  it('summarizes architecture metrics and hotspots', () => {
    const derived = projectDerivedGraph(graph, quality, {
      profile: GRAPH_DERIVED_PROJECTION_PROFILES.architectureSummary,
      budget: { maxItems: 3 },
    });
    expect(derived.accepted).toBe(true);
    if (!derived.accepted) return;
    expect(derived.value.architecture?.metrics.nodeCount).toBe(6);
    expect(derived.value.architecture?.hotspots.length).toBeLessThanOrEqual(3);
  });

  it('rejects invalid derived budgets', () => {
    const derived = projectDerivedGraph(graph, quality, {
      profile: GRAPH_DERIVED_PROJECTION_PROFILES.community,
      budget: { maxItems: 0 },
    });
    expect(derived.accepted).toBe(false);
    expect(derived.issues[0]?.code).toBe('GRAPH_DERIVED_PROJECTION_BUDGET_INVALID');
  });
});
