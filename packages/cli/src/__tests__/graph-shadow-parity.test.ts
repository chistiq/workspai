import { describe, expect, it, vi } from 'vitest';

import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowResourceBudgetDigest,
  runGraphShadowComparison,
  type LegacyGraphShadowInput,
  type PackageGraphShadowInput,
} from '../graph-shadow-parity.js';

const digest = `sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);
const binding = {
  sourceFixtureDigest: digest,
  scopeDigest: digest,
  providerProfileDigest: digest,
  graphPolicyDigest: digest,
  redactionAuthorizationDigest: digest,
  resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
  legacyCli: { version: '0.75.1', commit },
  graphPackage: { version: '0.0.0-development', commit },
};

function legacy(): LegacyGraphShadowInput {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    entities: [
      { id: 'legacy:project', kind: 'project', identity: { key: 'project:app' }, proofIds: [] },
      { id: 'legacy:test', kind: 'test-suite', identity: { key: 'test:app' }, proofIds: ['p1'] },
    ],
    relations: [
      {
        id: 'legacy:owns',
        from: 'legacy:project',
        to: 'legacy:test',
        kind: 'owns',
        proofIds: ['p1'],
      },
    ],
    proofs: [{ id: 'p1', artifact: 'tests/app.test.ts' }],
    quality: { unknownCount: 0, completeness: { status: 'complete' } },
    diagnostics: [],
  };
}

function packageGraph(): PackageGraphShadowInput {
  return {
    graph: {
      contract: { id: 'workspai.graph.canonical-graph', version: '0.1.0-candidate' },
      generation: {
        inputsDigest: { algorithm: 'sha256', value: digest.slice('sha256:'.length) },
        providerSetDigest: { algorithm: 'sha256', value: digest.slice('sha256:'.length) },
        compositionPolicyDigest: { algorithm: 'sha256', value: digest.slice('sha256:'.length) },
      },
      nodes: [
        { id: 'project:app', kind: 'project' },
        { id: 'test:app', kind: 'test' },
      ],
      edges: [
        {
          id: 'edge:owned-by',
          from: 'project:app',
          to: 'test:app',
          relation: 'owned-by',
          proof: { evidence: [{ relativeLocator: 'tests/app.test.ts' }] },
        },
      ],
      unresolved: [],
      diagnostics: [],
    },
    quality: { unknownZones: [], unsupportedZones: [], coverage: [] },
  };
}

describe('Graph package shadow parity', () => {
  it('compares explicit semantic aliases without changing released CLI authority', async () => {
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => packageGraph(),
    });

    expect(result).toMatchObject({
      status: 'equivalent',
      differences: [],
      metrics: { regressions: 0, approvedDifferences: 0 },
      receipt: {
        epoch: 'package-shadow',
        executionPath: 'compared',
        authority: 'released-cli',
        packageWrites: 'prohibited',
        fallback: 'prohibited',
      },
    });
    expect(result.receipt.comparison.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('uses package identity renderings without changing canonical node identifiers', async () => {
    const candidate = packageGraph();
    candidate.graph.nodes[0]!.id = `entity:workspai:project:sha256:${'1'.repeat(64)}`;
    candidate.graph.nodes[1]!.id = `entity:workspai:test:sha256:${'2'.repeat(64)}`;
    candidate.graph.edges[0]!.from = candidate.graph.nodes[0]!.id;
    candidate.graph.edges[0]!.to = candidate.graph.nodes[1]!.id;
    candidate.identityRenderings = {
      [candidate.graph.nodes[0]!.id]: 'project:app',
      [candidate.graph.nodes[1]!.id]: 'test:app',
    };

    const result = await runGraphShadowComparison({
      profile: 'g8-rendered-identities',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });

    expect(result.status).toBe('equivalent');
    expect(result.differences).toEqual([]);
  });

  it('blocks a semantic regression instead of comparing counts only', async () => {
    const candidate = packageGraph();
    candidate.graph.edges[0]!.relation = 'depends-on';
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });

    expect(result.status).toBe('different');
    expect(result.differences).toContainEqual(
      expect.objectContaining({
        code: 'GRAPH_SHADOW_RELATION_SET_DIFFERENT',
        classification: 'regression',
      })
    );
  });

  it('bounds difference evidence while preserving exact set digests and counts', async () => {
    const legacyCandidate: LegacyGraphShadowInput = {
      ...legacy(),
      entities: Array.from({ length: 150 }, (_, index) => ({
        id: `legacy:${index}`,
        kind: 'file',
        identity: { key: `file:${index}` },
        proofIds: [],
      })),
      relations: [],
      proofs: [],
    };
    const result = await runGraphShadowComparison({
      profile: 'g8-large-difference',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacyCandidate,
      package: async () => packageGraph(),
    });

    const difference = result.differences.find(
      (item) => item.code === 'GRAPH_SHADOW_NODE_SET_DIFFERENT'
    );
    expect(difference?.legacy).toMatchObject({
      count: 150,
      truncated: true,
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect((difference?.legacy as { sample: unknown[] }).sample).toHaveLength(100);
  });

  it('records an explicitly reviewed improvement without claiming equivalence', async () => {
    const candidate = packageGraph();
    candidate.graph.nodes.push({ id: 'module:deeper', kind: 'module' });
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      policy: {
        approvedDifferences: {
          GRAPH_SHADOW_NODE_SET_DIFFERENT: 'truth-depth-improvement',
        },
      },
      legacy: async () => legacy(),
      package: async () => candidate,
    });

    expect(result).toMatchObject({
      status: 'incomparable',
      metrics: { regressions: 0, approvedDifferences: 1 },
    });
  });

  it('fails closed before execution when any comparison binding is not exact', async () => {
    const legacyExecution = vi.fn(async () => legacy());
    const packageExecution = vi.fn(async () => packageGraph());
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding: { ...binding, scopeDigest: 'latest' },
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: legacyExecution,
      package: packageExecution,
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_BINDING_INVALID' })
    );
    expect(legacyExecution).not.toHaveBeenCalled();
    expect(packageExecution).not.toHaveBeenCalled();
  });

  it('fails closed when the executed package generation does not match its semantic binding', async () => {
    const candidate = packageGraph();
    candidate.graph.generation.providerSetDigest.value = 'c'.repeat(64);

    const result = await runGraphShadowComparison({
      profile: 'g8-semantic-binding',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({
        code: 'GRAPH_SHADOW_SEMANTIC_BINDING_MISMATCH',
        key: 'providerProfileDigest',
      })
    );
    expect(result.receipt).toMatchObject({
      authority: 'released-cli',
      fallback: 'prohibited',
      packageWrites: 'prohibited',
    });
  });

  it('does not fall back when package execution fails', async () => {
    const legacyExecution = vi.fn(async () => legacy());
    const packageExecution = vi.fn(async () => {
      throw new Error('package engine unavailable');
    });
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: legacyExecution,
      package: packageExecution,
    });

    expect(result).toMatchObject({
      status: 'failed',
      receipt: { fallback: 'prohibited', authority: 'released-cli' },
    });
    expect(legacyExecution).toHaveBeenCalledTimes(1);
    expect(packageExecution).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('package engine unavailable');
  });

  it('rejects malformed resource limits without throwing', async () => {
    const legacyExecution = vi.fn(async () => legacy());
    const packageExecution = vi.fn(async () => packageGraph());
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: null as never,
      legacy: legacyExecution,
      package: packageExecution,
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_RESOURCE_LIMIT_INVALID' })
    );
    expect(legacyExecution).not.toHaveBeenCalled();
    expect(packageExecution).not.toHaveBeenCalled();
  });

  it('rejects unversioned custom identity mappings', async () => {
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      policy: { identityMappings: { 'project:app': 'project:renamed' } },
      legacy: async () => legacy(),
      package: async () => packageGraph(),
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_MAPPING_VERSION_MISSING' })
    );
  });

  it('rejects absolute evidence locators before semantic comparison', async () => {
    const candidate = packageGraph();
    candidate.graph.edges[0]!.proof.evidence[0]!.relativeLocator = '/tmp/private.ts';
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_NON_PORTABLE_EVIDENCE' })
    );
  });

  it('binds the exact resource budget and rejects drift', async () => {
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: { ...GRAPH_SHADOW_DEFAULT_LIMITS, maxNodes: 10 },
      legacy: async () => legacy(),
      package: async () => packageGraph(),
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_RESOURCE_BINDING_MISMATCH' })
    );
  });

  it('rejects malformed artifact payloads without throwing', async () => {
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => ({ schemaVersion: 'workspace-knowledge-graph.v1' }),
      package: async () => packageGraph(),
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_ARTIFACT_CONTRACT_INVALID' })
    );
  });

  it('rejects an untrusted malformed binding without throwing or echoing it', async () => {
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding: null,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => packageGraph(),
    });

    expect(result.status).toBe('failed');
    expect(result.binding).toBeNull();
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_BINDING_INVALID' })
    );
  });

  it('rejects malformed mapping policy before either Graph path executes', async () => {
    const legacyExecution = vi.fn(async () => legacy());
    const packageExecution = vi.fn(async () => packageGraph());
    const result = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      policy: { relationMappings: { owns: 42 } },
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: legacyExecution,
      package: packageExecution,
    });

    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_POLICY_INVALID' })
    );
    expect(legacyExecution).not.toHaveBeenCalled();
    expect(packageExecution).not.toHaveBeenCalled();
  });
});
