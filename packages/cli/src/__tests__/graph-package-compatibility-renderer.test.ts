import { describe, expect, it } from 'vitest';

import { renderCanonicalGraphAsWorkspaceKnowledgeGraph } from '../graph-package-compatibility-renderer.js';
import type { PackageGraphShadowInput } from '../graph-shadow-parity.js';

function topology(projectId: string) {
  return {
    schemaVersion: 'workspace-dependency-graph.v1' as const,
    generatedAt: '2026-09-12T00:00:00.000Z',
    nodes: [{ id: projectId, path: '.' }],
    edges: [],
    stats: {
      nodeCount: 1,
      edgeCount: 0,
      inferredEdges: 0,
      contractEdges: 0,
      manualEdges: 0,
      authoritativeEdges: 0,
      lowConfidenceEdges: 0,
      orphanCount: 1,
      connectedNodeCount: 0,
      density: 0,
      edgeCoverageRatio: 0,
      evidenceCoverageRatio: 0,
      hotspotCount: 0,
      hasCycle: false,
    },
  };
}

function packageInput(overrides?: {
  readonly proofState?: string;
  readonly omitProofState?: boolean;
  readonly authorities?: readonly string[];
  readonly locator?: string | null;
  readonly digest?: string;
  readonly extraEdge?: boolean;
  readonly omitProof?: boolean;
}): PackageGraphShadowInput {
  const evidence =
    overrides?.locator === null || overrides?.omitProof
      ? []
      : [
          {
            relativeLocator: overrides?.locator ?? 'src/index.ts',
            digest: { value: overrides?.digest ?? 'd'.repeat(64) },
          },
        ];
  const proof = overrides?.omitProof
    ? { evidence: [] as { relativeLocator?: string; digest?: { value: string } }[] }
    : {
        ...(overrides?.omitProofState ? {} : { state: overrides?.proofState ?? 'supported' }),
        authorities: [...(overrides?.authorities ?? ['observed'])],
        inputDigest: { algorithm: 'sha256', value: overrides?.digest ?? 'd'.repeat(64) },
        evidence,
      };
  return {
    graph: {
      contract: { id: 'workspai.graph.canonical-graph', version: '0.1.0-candidate' },
      generation: {
        inputsDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
        providerSetDigest: { algorithm: 'sha256', value: 'b'.repeat(64) },
        compositionPolicyDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
      },
      nodes: [
        { id: 'n-project', kind: 'project' },
        { id: 'n-file', kind: 'file' },
      ],
      edges: [
        {
          id: 'e-contains',
          from: 'n-project',
          to: 'n-file',
          relation: 'contains',
          proof,
        },
        ...(overrides?.extraEdge
          ? [
              {
                id: 'e-duplicate',
                from: 'n-project',
                to: 'n-file',
                relation: 'contains',
                proof: {
                  state: 'verified',
                  authorities: ['verified'],
                  inputDigest: { algorithm: 'sha256', value: 'e'.repeat(64) },
                  evidence: [
                    {
                      relativeLocator: 'src/other.ts',
                      digest: { value: 'e'.repeat(64) },
                    },
                  ],
                },
              },
            ]
          : []),
      ],
      unresolved: [],
      diagnostics: [],
    },
    quality: { unknownZones: [], unsupportedZones: [], coverage: [] },
    identityRenderings: {
      'n-project': 'entity:workspai:project:fixture',
      'n-file': 'entity:workspai:file:src%2Findex.ts',
    },
  };
}

function render(input: PackageGraphShadowInput) {
  return renderCanonicalGraphAsWorkspaceKnowledgeGraph({
    projectId: 'fixture',
    workspaceName: 'fixture',
    generatedAt: '2026-09-12T00:00:00.000Z',
    package: input,
    projectTopology: topology('fixture'),
    sourceBinding: { status: 'unbound', modelHash: 'a'.repeat(64) },
  });
}

describe('package Graph compatibility renderer proof honesty', () => {
  it('projects existing package proof without fabricating, upgrading, or deleting it', () => {
    const graph = render(packageInput());
    expect(graph.proofs).toHaveLength(1);
    expect(graph.proofs[0]?.artifact).toBe('src/index.ts');
    expect(graph.proofs[0]?.contentHash).toBe('d'.repeat(64));
    expect(graph.proofs[0]?.confidence).toBe('medium');
    expect(graph.proofs[0]?.trust).toBe('observed');
    expect(graph.proofs[0]?.detail).toBe('packageProofState=supported');
    expect(graph.relations[0]?.proofIds).toEqual([graph.proofs[0]?.id]);
  });

  it('does not upgrade supported or missing proof to verified or authoritative', () => {
    const supported = render(packageInput({ proofState: 'supported' }));
    expect(supported.proofs[0]?.trust).not.toBe('authoritative');
    expect(supported.proofs[0]?.confidence).not.toBe('high');
    const missing = render(packageInput({ omitProofState: true }));
    expect(missing.proofs[0]?.trust).toBe('ambiguous');
    expect(missing.proofs[0]?.confidence).toBe('low');
    expect(missing.proofs[0]?.trust).not.toBe('authoritative');
  });

  it('does not invent a proof when the package edge has none', () => {
    const graph = render(packageInput({ omitProof: true }));
    expect(graph.proofs).toEqual([]);
    expect(graph.relations[0]?.proofIds).toEqual([]);
    expect(graph.diagnostics.map((item) => item.code)).not.toContain(
      'GRAPH_COMPAT_PROOF_WITHOUT_LOCATOR'
    );
  });

  it('does not silently drop a digest-only proof by inventing a locator', () => {
    const graph = render(packageInput({ locator: null, digest: 'f'.repeat(64) }));
    expect(graph.proofs).toEqual([]);
    expect(graph.diagnostics.map((item) => item.code)).toContain(
      'GRAPH_COMPAT_PROOF_WITHOUT_LOCATOR'
    );
  });

  it('keeps a second package proof instead of collapsing or deleting it', () => {
    const graph = render(packageInput({ extraEdge: true }));
    expect(graph.proofs.map((proof) => proof.artifact).sort()).toEqual([
      'src/index.ts',
      'src/other.ts',
    ]);
    expect(graph.proofs.some((proof) => proof.contentHash === 'e'.repeat(64))).toBe(true);
    expect(graph.proofs.find((proof) => proof.artifact === 'src/other.ts')?.trust).toBe(
      'authoritative'
    );
  });
});
