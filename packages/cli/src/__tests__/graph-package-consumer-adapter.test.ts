import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GRAPH_PACKAGE_COMPATIBILITY_RENDERER_VERSION,
  renderCanonicalGraphAsWorkspaceKnowledgeGraph,
} from '../graph-package-compatibility-renderer.js';
import {
  GRAPH_CONSUMER_PACKAGE_PRIMARY,
  GRAPH_CONSUMER_RUNTIME_AUTHORITY,
  GRAPH_CONSUMER_SHADOW_RECEIPT_SCHEMA_VERSION,
  GRAPH_CONSUMER_SILENT_FALLBACK,
  GRAPH_CONSUMER_SURFACE_IDS,
  buildPackageIntelligenceConsumerParity,
  graphConsumerParityStatuses,
  resolveWorkspaceKnowledgeGraphForConsumer,
} from '../graph-package-consumer-adapter.js';
import { WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION } from '../contracts/workspace-knowledge-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import {
  queryKnowledgeEntities,
  searchKnowledgeGraph,
} from '../workspace-knowledge-graph-query.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';
import type { PackageGraphShadowInput } from '../graph-shadow-parity.js';

const roots: string[] = [];
const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test-data/graph-shadow/real-workspace-fixture.v1'
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

function packageInput(): PackageGraphShadowInput {
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
        { id: 'n-command', kind: 'command' },
      ],
      edges: [
        {
          id: 'e-contains',
          from: 'n-project',
          to: 'n-file',
          relation: 'contains',
          proof: {
            state: 'supported',
            authorities: ['observed'],
            inputDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
            evidence: [{ relativeLocator: 'src/index.ts', digest: { value: 'd'.repeat(64) } }],
          },
        },
      ],
      unresolved: [],
      diagnostics: [],
    },
    quality: { unknownZones: [], unsupportedZones: [], coverage: [] },
    evidenceLocators: ['src/index.ts'],
    identityRenderings: {
      'n-project': 'entity:workspai:project:fixture',
      'n-file': 'entity:workspai:file:src%2Findex.ts',
    },
  };
}

describe('package Graph consumer adapter', () => {
  it('keeps released CLI authority and forbids silent fallback', () => {
    expect(GRAPH_CONSUMER_RUNTIME_AUTHORITY).toBe('official-internal-graph-capability');
    expect(GRAPH_CONSUMER_PACKAGE_PRIMARY).toBe(false);
    expect(GRAPH_CONSUMER_SILENT_FALLBACK).toBe('prohibited');
  });

  it('renders supported v1 entities and omits unmapped package kinds', () => {
    const graph = renderCanonicalGraphAsWorkspaceKnowledgeGraph({
      projectId: 'fixture',
      workspaceName: 'fixture',
      generatedAt: '2026-09-12T00:00:00.000Z',
      package: packageInput(),
      projectTopology: topology('fixture'),
      sourceBinding: { status: 'unbound', modelHash: 'a'.repeat(64) },
    });
    expect(graph.schemaVersion).toBe(WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION);
    expect(graph.entities.map((entity) => entity.kind)).toEqual(['project', 'file']);
    expect(graph.entities[1]?.identity.key).toBe('file:src/index.ts');
    expect(graph.quality.completeness.status).toBe('bounded');
    expect(graph.relations[0]?.confidence).toBe('medium');
    expect(graph.proofs[0]?.confidence).toBe('medium');
    expect(graph.proofs[0]?.contentHash).toBe('d'.repeat(64));
    expect(graph.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'GRAPH_COMPAT_UNMAPPED_KIND',
        'GRAPH_COMPAT_SOURCE_UNBOUND_TO_MODEL',
        'GRAPH_COMPAT_SOURCE_KIND_SCHEMA_CONSTRAINT',
        'GRAPH_COMPAT_PACKAGE_GENERATION_BOUND',
      ])
    );
    expect(graph.source.artifact).toBe(WORKSPACE_INTELLIGENCE_ARTIFACTS.model);
    expect(graph.providers[0]?.version).toBe(GRAPH_PACKAGE_COMPATIBILITY_RENDERER_VERSION);
  });

  it('does not invent a project topology when the host omits one', () => {
    expect(() =>
      renderCanonicalGraphAsWorkspaceKnowledgeGraph({
        projectId: 'fixture',
        workspaceName: 'fixture',
        generatedAt: '2026-09-12T00:00:00.000Z',
        package: packageInput(),
        projectTopology: { ...topology('fixture'), nodes: [] },
        sourceBinding: { status: 'unbound', modelHash: 'a'.repeat(64) },
      })
    ).toThrow('Compatibility renderer requires a host-supplied project topology.');
  });

  it('builds a typed package candidate and keeps production resolution on the legacy composer', async () => {
    const parity = await buildPackageIntelligenceConsumerParity({
      projectId: 'real-workspace-fixture',
      workspaceId: 'real-workspace-fixture',
      projectRoot: fixtureRoot,
      workspaceName: 'real-workspace-fixture',
      generatedAt: '2026-09-12T00:00:00.000Z',
      projectTopology: topology('real-workspace-fixture'),
      sourceBinding: {
        status: 'unbound',
        modelHash: hashCanonicalJson({ fixture: 'real-workspace-fixture' }),
      },
    });
    expect(parity.candidate.authority).toBe('package-shadow-candidate');
    expect(parity.candidate.packagePrimary).toBe(false);
    expect(parity.candidate.fallback).toBe('prohibited');
    expect(parity.candidate.graph.schemaVersion).toBe(WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION);
    expect(queryKnowledgeEntities(parity.candidate.graph, 'file').length).toBeGreaterThan(0);
    expect(
      searchKnowledgeGraph(parity.candidate.graph, { query: 'index', limit: 5 }).schemaVersion
    ).toBe('workspace-knowledge-search.v1');
    expect(
      parity.sourceGraph.entities.every((entity) => entity.projectId === 'real-workspace-fixture')
    ).toBe(true);
    expect(parity.sourceReference.project.name).toBe('real-workspace-fixture');
    expect(parity.queries.search.schemaVersion).toBe('workspace-knowledge-search.v1');
    expect(parity.overlay.summary.risk).toBe('none');
    expect(parity.receipt).toMatchObject({
      schemaVersion: GRAPH_CONSUMER_SHADOW_RECEIPT_SCHEMA_VERSION,
      epoch: 'package-shadow',
      authority: 'released-cli',
      packagePrimary: false,
      fallback: 'prohibited',
      packageWrites: 'prohibited',
    });
    expect(parity.receipt.consumers.map((consumer) => consumer.id)).toEqual([
      ...GRAPH_CONSUMER_SURFACE_IDS,
    ]);
    expect(
      graphConsumerParityStatuses().every(
        (consumer) => consumer.adapter === 'implemented-local-candidate'
      )
    ).toBe(true);
    expect(parity.reachability).toMatchObject({
      userSelectable: false,
      semanticAuthority: 'typescript',
      dynamicDownload: 'prohibited',
    });

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-consumer-'));
    roots.push(projectRoot);
    await writeFile(path.join(projectRoot, 'README.md'), '# fixture\n');
    const production = await resolveWorkspaceKnowledgeGraphForConsumer({
      workspacePath: projectRoot,
      workspace: { name: 'consumer-fixture' },
      projects: [{ id: 'consumer-fixture', path: '.', absolutePath: projectRoot }],
      projectTopology: topology('consumer-fixture'),
      now: new Date('2026-09-12T00:00:00.000Z'),
      source: {
        kind: 'workspace-model',
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        hashAlgorithm: 'sha256',
        hash: hashCanonicalJson({ consumer: 'legacy' }),
      },
    });
    expect(production.providers.some((provider) => provider.id === 'workspai.graph.package')).toBe(
      false
    );
  });
});
