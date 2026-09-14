import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  GRAPH_SHADOW_MAPPING_VERSION,
  createGraphShadowBoundedSetDigest,
  createGraphShadowResourceBudgetDigest,
  graphShadowApprovalLookupKey,
  runGraphShadowComparison,
  type LegacyGraphShadowInput,
  type PackageGraphShadowInput,
} from '../graph-shadow-parity.js';

const digest = `sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  it('passes the versioned semantic parity corpus without count-only shortcuts', async () => {
    interface CorpusCase {
      id: string;
      legacySecondKind?: string;
      packageSecondKind?: string;
      packageSecondIdentity?: string;
      legacyRelation?: string;
      packageRelation?: string;
      packageProofLocator?: string;
      packageUnknownCodes?: string[];
      packageCoverageStatus?: string;
      packageDiagnosticCodes?: string[];
      packageExtraNode?: boolean;
      approvedDifferences?: Record<
        string,
        'truth-depth-improvement' | 'intentional-contract-change' | 'legacy-false-claim'
      >;
      expectedStatus: 'equivalent' | 'different' | 'incomparable';
      expectedDifferenceCodes: string[];
    }
    const corpus = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'test-data/graph-shadow/semantic-parity-corpus.v1.json'),
        'utf8'
      )
    ) as {
      schemaVersion: string;
      profile: string;
      cases: CorpusCase[];
    };
    expect(corpus.schemaVersion).toBe('workspai.graph-shadow-semantic-corpus.v1');
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(corpus.cases.length);

    for (const item of corpus.cases) {
      const legacyCandidate = legacy();
      const packageCandidate = packageGraph();
      legacyCandidate.entities[1]!.kind = item.legacySecondKind ?? 'test';
      legacyCandidate.relations[0]!.kind = item.legacyRelation ?? 'depends-on';
      packageCandidate.graph.nodes[1]!.kind = item.packageSecondKind ?? 'test';
      packageCandidate.graph.nodes[1]!.id = item.packageSecondIdentity ?? 'test:app';
      packageCandidate.graph.edges[0]!.to = packageCandidate.graph.nodes[1]!.id;
      packageCandidate.graph.edges[0]!.relation = item.packageRelation ?? 'depends-on';
      packageCandidate.evidenceLocators = [item.packageProofLocator ?? 'tests/app.test.ts'];
      packageCandidate.quality.unknownZones = (item.packageUnknownCodes ?? []).map((code) => ({
        code,
      }));
      packageCandidate.quality.coverage = [
        { dimension: 'semantic-depth', status: item.packageCoverageStatus ?? 'pass' },
      ];
      packageCandidate.graph.diagnostics = (item.packageDiagnosticCodes ?? []).map((code) => ({
        code,
      }));
      if (item.packageExtraNode) {
        packageCandidate.graph.nodes = [
          ...packageCandidate.graph.nodes,
          { id: 'module:deeper', kind: 'module' },
        ];
      }

      const result = await runGraphShadowComparison({
        profile: corpus.profile,
        binding,
        limits: GRAPH_SHADOW_DEFAULT_LIMITS,
        ...(item.approvedDifferences
          ? {
              policy: {
                mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
                approvedDifferences: Object.fromEntries(
                  Object.entries(item.approvedDifferences).map(([code, classification]) => {
                    if (code.includes('::')) return [code, classification];
                    const setDigest = createGraphShadowBoundedSetDigest(['module:deeper\0module']);
                    return [
                      graphShadowApprovalLookupKey(
                        GRAPH_SHADOW_MAPPING_VERSION,
                        code,
                        'module',
                        setDigest
                      ),
                      classification,
                    ];
                  })
                ),
              },
            }
          : {}),
        legacy: async () => legacyCandidate,
        package: async () => packageCandidate,
      });

      expect(result.status, item.id).toBe(item.expectedStatus);
      expect(result.differences.map((difference) => difference.code).sort(), item.id).toEqual(
        [...item.expectedDifferenceCodes].sort()
      );
      expect(result.receipt).toMatchObject({
        authority: 'released-cli',
        packageWrites: 'prohibited',
        fallback: 'prohibited',
      });
    }
  });

  it('projects duplicated project prefixes onto matching package file identities', async () => {
    const legacyCandidate = legacy();
    legacyCandidate.entities = [
      {
        id: 'legacy:file',
        kind: 'file',
        identity: { key: 'file:app:app/tests/app.test.ts' },
        proofIds: ['p1'],
      },
    ];
    legacyCandidate.relations = [];
    const candidate = packageGraph();
    candidate.graph.nodes = [{ id: 'entity:workspai:file:sha256:file', kind: 'file' }];
    candidate.graph.edges = [];
    candidate.identityRenderings = {
      'entity:workspai:file:sha256:file': 'entity:workspai:file:tests%2Fapp.test.ts',
    };
    const result = await runGraphShadowComparison({
      profile: 'g8-prefix-projection',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacyCandidate,
      package: async () => candidate,
    });
    expect(result.differences.filter((item) => item.area === 'node')).toEqual([]);
  });

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
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'GRAPH_SHADOW_RELATION_LEGACY_ONLY',
          key: 'owned-by',
          classification: 'regression',
        }),
        expect.objectContaining({
          code: 'GRAPH_SHADOW_RELATION_PACKAGE_ONLY',
          key: 'depends-on',
          classification: 'regression',
        }),
      ])
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
      (item) => item.code === 'GRAPH_SHADOW_NODE_LEGACY_ONLY' && item.key === 'file'
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
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        approvedDifferences: {
          [graphShadowApprovalLookupKey(
            GRAPH_SHADOW_MAPPING_VERSION,
            'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
            'module',
            createGraphShadowBoundedSetDigest(['module:deeper\0module'])
          )]: 'truth-depth-improvement',
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

  it('rejects code-only and code-plus-key approval fallbacks before either Graph path executes', async () => {
    const legacyExecution = vi.fn(async () => legacy());
    const packageExecution = vi.fn(async () => packageGraph());
    const codeOnly = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      policy: {
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        approvedDifferences: { GRAPH_SHADOW_NODE_PACKAGE_ONLY: 'truth-depth-improvement' },
      },
      legacy: legacyExecution,
      package: packageExecution,
    });
    expect(codeOnly.status).toBe('failed');
    expect(codeOnly.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_POLICY_INVALID' })
    );
    expect(legacyExecution).not.toHaveBeenCalled();

    const codeAndKey = await runGraphShadowComparison({
      profile: 'g8-fixture',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      policy: {
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        approvedDifferences: {
          'GRAPH_SHADOW_NODE_PACKAGE_ONLY::module': 'truth-depth-improvement',
        },
      },
      legacy: legacyExecution,
      package: packageExecution,
    });
    expect(codeAndKey.status).toBe('failed');
    expect(codeAndKey.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_POLICY_INVALID' })
    );
  });

  it('fails closed when encoded identity locators would otherwise compare equal', async () => {
    const legacyCandidate = legacy();
    legacyCandidate.entities = [
      {
        id: 'legacy:file',
        kind: 'file',
        identity: { key: 'file:app:%2e%2e%2fsecret.ts' },
        proofIds: [],
      },
    ];
    legacyCandidate.relations = [];
    legacyCandidate.proofs = [];
    const candidate = packageGraph();
    candidate.graph.nodes = [{ id: 'entity:workspai:file:sha256:file', kind: 'file' }];
    candidate.graph.edges = [];
    candidate.identityRenderings = {
      'entity:workspai:file:sha256:file': 'entity:workspai:file:%2e%2e%2fsecret.ts',
    };
    const result = await runGraphShadowComparison({
      profile: 'g8-encoded-identity',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacyCandidate,
      package: async () => candidate,
    });
    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({
        code: 'GRAPH_SHADOW_UNSAFE_IDENTITY',
        key: 'locator',
        package: expect.objectContaining({ count: 1, truncated: false }),
        legacy: expect.objectContaining({ count: 1, truncated: false }),
      })
    );
    expect(result.differences.some((item) => item.classification !== 'regression')).toBe(false);
  });

  it('fails closed when deeply encoded identity locators would otherwise remain comparable', async () => {
    let encoded = '../secret.ts';
    for (let layer = 0; layer < 25; layer += 1) encoded = encodeURIComponent(encoded);
    const legacyCandidate = legacy();
    legacyCandidate.entities = [
      {
        id: 'legacy:file',
        kind: 'file',
        identity: { key: `file:app:${encoded}` },
        proofIds: [],
      },
    ];
    legacyCandidate.relations = [];
    legacyCandidate.proofs = [];
    const candidate = packageGraph();
    candidate.graph.nodes = [{ id: 'entity:workspai:file:sha256:file', kind: 'file' }];
    candidate.graph.edges = [];
    candidate.identityRenderings = {
      'entity:workspai:file:sha256:file': `entity:workspai:file:${encoded}`,
    };
    const result = await runGraphShadowComparison({
      profile: 'g8-deep-encoded-identity',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacyCandidate,
      package: async () => candidate,
    });
    expect(result.status).toBe('failed');
    expect(result.differences).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_SHADOW_UNSAFE_IDENTITY' })
    );
    expect(result.differences.some((item) => item.classification !== 'regression')).toBe(false);
  });

  it('reports generated-artifact proofs directionally with independent digests', async () => {
    const legacyCandidate = legacy();
    legacyCandidate.proofs = [{ id: 'p1', artifact: 'node_modules/legacy-graph.json' }];
    const candidate = packageGraph();
    candidate.evidenceLocators = ['node_modules/package-graph.json'];
    const result = await runGraphShadowComparison({
      profile: 'g8-generated-control-direction',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacyCandidate,
      package: async () => candidate,
    });
    const generated = result.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL'
    );
    expect(generated).toHaveLength(2);
    const legacyOnly = generated.find((item) => item.key === 'generatedLegacyControl');
    const packageOnly = generated.find((item) => item.key === 'generatedPackageControl');
    expect(legacyOnly?.legacy?.sample).toEqual(['node_modules/legacy-graph.json']);
    expect(legacyOnly?.package?.count).toBe(0);
    expect(packageOnly?.package?.sample).toEqual(['node_modules/package-graph.json']);
    expect(packageOnly?.legacy?.count).toBe(0);
    expect(legacyOnly?.legacy?.digest).not.toBe(packageOnly?.package?.digest);
    expect(packageOnly?.legacy?.sample ?? []).not.toContain('node_modules/package-graph.json');
  });

  it('does not attribute package generated workspace-control proofs to the legacy summary', async () => {
    const candidate = packageGraph();
    candidate.evidenceLocators = ['node_modules/graph.json', 'tests/app.test.ts'];
    const result = await runGraphShadowComparison({
      profile: 'g8-package-generated-control',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });
    const generated = result.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL'
    );
    expect(generated).toEqual([
      expect.objectContaining({
        key: 'generatedPackageControl',
        package: expect.objectContaining({
          sample: ['node_modules/graph.json'],
        }),
        legacy: expect.objectContaining({ count: 0 }),
      }),
    ]);
    expect(generated[0]?.legacy?.sample ?? []).not.toContain('node_modules/graph.json');
  });

  it('fails closed when encoded proof locators bypass the raw-path check', async () => {
    const candidate = packageGraph();
    candidate.evidenceLocators = ['%2e%2e%2fsecret.ts'];
    const result = await runGraphShadowComparison({
      profile: 'g8-encoded-proof',
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

  it('keeps each unknown leftover as its own regression and does not group by cause', async () => {
    const candidate = packageGraph();
    candidate.quality.unknownZones = [
      { code: 'graph.source-call-ambiguous', scope: 'src/a.ts' },
      { code: 'graph.source-call-ambiguous', scope: 'src/b.ts' },
      { code: 'graph.ecmascript-local-import-unresolved', scope: 'src/c.ts' },
      { code: 'graph.source-language-unsupported', scope: 'app.dart' },
      { code: 'graph.novel-future-code', scope: 'src/d.ts' },
    ];
    const result = await runGraphShadowComparison({
      profile: 'g8-unknown-cause-grouping',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });
    expect(result.status).toBe('different');
    const packageUnknown = result.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY'
    );
    expect(packageUnknown).toHaveLength(5);
    expect(packageUnknown.every((item) => item.classification === 'regression')).toBe(true);
    expect(result.metrics.regressions).toBeGreaterThanOrEqual(5);
    expect(packageUnknown.map((item) => item.key).sort()).toEqual([
      'package-unknown-zone::graph.ecmascript-local-import-unresolved@src/c.ts',
      'package-unknown-zone::graph.novel-future-code@src/d.ts',
      'package-unknown-zone::graph.source-call-ambiguous@src/a.ts',
      'package-unknown-zone::graph.source-call-ambiguous@src/b.ts',
      'package-unknown-zone::graph.source-language-unsupported@app.dart',
    ]);
    expect(
      packageUnknown.every((item) => {
        const summary = item.package as { count: number; truncated: boolean; digest: string };
        return summary.count === 1 && summary.truncated === false && summary.digest.length > 0;
      })
    ).toBe(true);
    expect(
      new Set(packageUnknown.map((item) => (item.package as { digest: string }).digest)).size
    ).toBe(5);
  });

  it('treats generated and vendored proof locators as generated-artifact without a product-directory special case', async () => {
    const candidate = packageGraph();
    candidate.evidenceLocators = ['node_modules/left-pad/index.js', 'tests/app.test.ts'];
    const result = await runGraphShadowComparison({
      profile: 'g8-generated-output-policy',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });
    const generated = result.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL'
    );
    expect(generated).toEqual([
      expect.objectContaining({
        key: 'generatedPackageControl',
        package: expect.objectContaining({ sample: ['node_modules/left-pad/index.js'] }),
      }),
    ]);
  });

  it('compares omitted subtrees by class and locator instead of treating unmeasured skips as zero', async () => {
    const candidate = packageGraph();
    candidate.quality = {
      ...candidate.quality,
      omittedSubtrees: [
        {
          locator: 'node_modules',
          class: 'vendored',
          count: 'not-enumerated',
          bytes: 'not-measured',
          policyDigest: digest,
        },
      ],
    };
    const result = await runGraphShadowComparison({
      profile: 'g8-omitted-subtree-accounting',
      binding,
      limits: GRAPH_SHADOW_DEFAULT_LIMITS,
      legacy: async () => legacy(),
      package: async () => candidate,
    });
    const omitted = result.differences.filter(
      (item) => item.code === 'GRAPH_SHADOW_OMITTED_SUBTREE_PACKAGE_ONLY'
    );
    expect(omitted).toEqual([
      expect.objectContaining({
        key: 'vendored',
        package: expect.objectContaining({ sample: ['node_modules\0vendored'] }),
      }),
    ]);
    expect(
      result.differences.some((item) => item.code === 'GRAPH_SHADOW_OMITTED_SUBTREE_LEGACY_ONLY')
    ).toBe(false);
  });
});
