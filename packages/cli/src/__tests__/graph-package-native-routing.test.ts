import { describe, expect, it } from 'vitest';

import type { GraphNativePort, GraphNativeTraversalRequest } from '@workspai/graph';
import { referenceGraphNativeTraversal } from '@workspai/graph/adapters/node';

import type { WorkspaceKnowledgeGraph } from '../contracts/workspace-knowledge-graph-contract.js';
import {
  GRAPH_NATIVE_HOST_DYNAMIC_DOWNLOAD,
  GRAPH_NATIVE_HOST_SEMANTIC_AUTHORITY,
  GRAPH_NATIVE_HOST_USER_SELECTABLE,
  encodeWorkspaceGraphNativeRequest,
  routeHostGraphReachability,
} from '../graph-package-native-routing.js';

function graph(): WorkspaceKnowledgeGraph {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    generatedAt: '2026-09-15T00:00:00.000Z',
    workspace: { name: 'fixture' },
    source: {
      kind: 'workspace-model',
      artifact: '.workspai/reports/workspace-model.json',
      hashAlgorithm: 'sha256',
      hash: 'a'.repeat(64),
    },
    projectTopology: {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: '2026-09-15T00:00:00.000Z',
      nodes: [{ id: 'fixture', path: '.' }],
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
    },
    entities: [
      {
        id: 'n-file',
        kind: 'file',
        label: 'file:src/index.ts',
        projectId: 'fixture',
        identity: { key: 'file:src/index.ts', scope: 'project', aliases: [], fingerprint: 'f' },
        attributes: {},
        proofIds: ['proof-1'],
      },
      {
        id: 'n-project',
        kind: 'project',
        label: 'entity:workspai:project:fixture',
        projectId: 'fixture',
        identity: { key: 'project:fixture', scope: 'project', aliases: [], fingerprint: 'p' },
        attributes: {},
        proofIds: ['proof-1'],
      },
    ],
    relations: [
      {
        id: 'e-contains',
        from: 'n-project',
        to: 'n-file',
        kind: 'contains',
        derivation: 'extracted',
        trust: 'observed',
        confidence: 'medium',
        proofIds: ['proof-1'],
      },
    ],
    proofs: [],
    providers: [],
    quality: {
      entityCount: 2,
      relationCount: 1,
      proofCount: 1,
      entityProofCoverageRatio: 1,
      relationProofCoverageRatio: 1,
      providerSuccessRatio: 1,
      conflictCount: 0,
      unknownCount: 0,
      portable: true,
      secretValuesEmitted: false,
    },
    diagnostics: [],
  };
}

function port(
  nodes: readonly number[],
  status: 'complete' | 'failed' = 'complete'
): GraphNativePort {
  return {
    descriptor: {
      engine: 'rust-wasm',
      abiVersion: 1,
      artifact: 'product-bundled',
      semanticAuthority: 'typescript',
      dynamicDownload: 'prohibited',
      userToolchain: 'not-required',
      maxNodes: 1_000_000,
      maxEdges: 5_000_000,
      maxMemoryBytes: 268_435_456,
    },
    artifactDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    traverseReachable: (request: GraphNativeTraversalRequest) => ({
      status,
      nodes,
      diagnostics:
        status === 'complete'
          ? []
          : [
              {
                code: 'GRAPH_NATIVE_ENGINE_TRAPPED',
                severity: 'error',
                path: '/native/traversal',
                message: 'forced failure',
              },
            ],
      metrics: { durationMs: 0, inputEdges: request.edges.length, outputNodes: nodes.length },
    }),
  };
}

describe('package Graph native host routing', () => {
  it('keeps TypeScript as the semantic authority and forbids user engine choice', () => {
    expect(GRAPH_NATIVE_HOST_USER_SELECTABLE).toBe(false);
    expect(GRAPH_NATIVE_HOST_SEMANTIC_AUTHORITY).toBe('typescript');
    expect(GRAPH_NATIVE_HOST_DYNAMIC_DOWNLOAD).toBe('prohibited');
  });

  it('routes reachability through WASM only when integer identity matches TypeScript', () => {
    const encoded = encodeWorkspaceGraphNativeRequest(graph(), 'n-project');
    expect(encoded).toBeDefined();
    const reference = referenceGraphNativeTraversal(encoded!.request);
    expect(
      routeHostGraphReachability({ graph: graph(), startEntityId: 'n-project' })
    ).toMatchObject({
      engine: 'typescript',
      reason: 'native-unavailable',
      entityIds: ['n-project', 'n-file'],
      userSelectable: false,
      semanticAuthority: 'typescript',
    });
    expect(
      routeHostGraphReachability({
        graph: graph(),
        startEntityId: 'n-project',
        native: port([0], 'failed'),
      })
    ).toMatchObject({ engine: 'typescript', reason: 'native-failed' });
    expect(
      routeHostGraphReachability({
        graph: graph(),
        startEntityId: 'n-project',
        native: port([0, 1]),
      })
    ).toMatchObject({ engine: 'typescript', reason: 'native-mismatch' });
    expect(
      routeHostGraphReachability({
        graph: graph(),
        startEntityId: 'n-project',
        native: port(reference),
      })
    ).toMatchObject({
      engine: 'rust-wasm',
      reason: 'parity-qualified',
      entityIds: ['n-project', 'n-file'],
      userSelectable: false,
    });
  });
});
