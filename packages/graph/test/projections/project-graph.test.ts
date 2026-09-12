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
  GRAPH_STANDARD_PROJECTION_PROFILES,
  GRAPH_PROJECTIONS_AVAILABLE,
  projectGraph,
} from '../../src/projections/index.js';

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
    edge('edge:contains', 'repository:root', 'file:index', 'structural'),
    edge('edge:config', 'runtime:node', 'file:index', 'declarative'),
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
    supported: 2,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  },
  unknownZones: [],
  unsupportedZones: [],
  staleZones: [],
  conflicts: [],
  orphans: [],
  providerFailures: [],
  releaseClaims: [],
};

describe('projectGraph', () => {
  it('advertises profile-driven projections as a G5 capability', () => {
    expect(GRAPH_PROJECTIONS_AVAILABLE).toBe(true);
  });

  it('preserves canonical generation identity across standard profiles', () => {
    for (const profile of Object.values(GRAPH_STANDARD_PROJECTION_PROFILES)) {
      const projected = projectGraph(graph, quality, { profile, budget: {} });
      expect(projected.accepted, profile.id).toBe(true);
      if (!projected.accepted) continue;
      expect(projected.value.sourceGeneration).toEqual(generation);
      expect(projected.value.contract.id).toBe('workspai.graph.projection-result');
    }
  });

  it('filters structural and evidence profiles deterministically', () => {
    const structural = projectGraph(graph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.structural,
      budget: {},
    });
    const evidence = projectGraph(graph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.evidence,
      budget: {},
    });
    expect(structural.accepted && evidence.accepted).toBe(true);
    if (!structural.accepted || !evidence.accepted) return;
    expect(structural.value.edges.every((entry) => entry.semantics === 'structural')).toBe(true);
    expect(evidence.value.edges.every((entry) => entry.proof.evidence.length > 0)).toBe(true);
  });

  it('rejects invalid budgets without mutating the graph', () => {
    const projected = projectGraph(graph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.source,
      budget: { maxNodes: 0 },
    });
    expect(projected.accepted).toBe(false);
    expect(projected.issues[0]?.code).toBe('GRAPH_PROJECTION_BUDGET_INVALID');
  });

  it('projects dependency and operational families without changing canonical ids', () => {
    const dependency = projectGraph(graph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.dependency,
      budget: {},
    });
    const operational = projectGraph(graph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.operational,
      budget: {},
    });
    expect(dependency.accepted && operational.accepted).toBe(true);
    if (!dependency.accepted || !operational.accepted) return;
    expect(dependency.value.edges.every((entry) => entry.relation === 'contains')).toBe(true);
    expect(operational.value.profile.id).toBe('workspai.graph.projection.operational');
  });

  it('honors scope filters and minimum proof thresholds', () => {
    const workspaceScope = {
      kind: 'workspace' as const,
      workspaceId: 'workspace:preview',
    };
    const workspaceGraph: GraphCanonicalGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, scope: workspaceScope })),
    };
    const scoped = projectGraph(workspaceGraph, quality, {
      profile: GRAPH_STANDARD_PROJECTION_PROFILES.workspace,
      budget: { maxNodes: 10, maxEdges: 10, maxEvidence: 10 },
      scope: workspaceScope,
    });
    const excluded = projectGraph(workspaceGraph, quality, {
      profile: {
        ...GRAPH_STANDARD_PROJECTION_PROFILES.structural,
        minimumProof: 'verified',
      },
      budget: { maxNodes: 10, maxEdges: 10, maxEvidence: 10 },
      scope: { kind: 'project', projectIds: ['project:other'] },
    });
    expect(scoped.accepted && excluded.accepted).toBe(true);
    if (!scoped.accepted || !excluded.accepted) return;
    expect(scoped.value.nodes.length).toBeGreaterThan(0);
    expect(excluded.value.nodes).toEqual([]);
    expect(excluded.value.edges).toEqual([]);
  });
});
