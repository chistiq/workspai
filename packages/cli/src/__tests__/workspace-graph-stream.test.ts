import { describe, expect, it } from 'vitest';

import type { WorkspaceKnowledgeGraph } from '../contracts/workspace-knowledge-graph-contract.js';
import { WorkspaceGraphStreamPublisher } from '../workspace-graph-stream.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';
import type { WorkspaceModel } from '../workspace-model.js';

function model(projectNames: string[]): WorkspaceModel {
  return {
    generatedAt: '2026-07-22T00:00:00.000Z',
    workspace: { name: 'fixture' },
    projects: projectNames.map((name) => ({
      name,
      path: name,
      runtime: 'node',
      framework: 'unknown',
    })),
    graph: {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: '2026-07-22T00:00:00.000Z',
      nodes: projectNames.map((name) => ({ id: name, path: name })),
      edges: [],
      stats: {
        nodeCount: projectNames.length,
        edgeCount: 0,
        inferredEdges: 0,
        contractEdges: 0,
        manualEdges: 0,
        authoritativeEdges: 0,
        lowConfidenceEdges: 0,
        orphanCount: projectNames.length,
        connectedNodeCount: 0,
        density: 0,
        edgeCoverageRatio: projectNames.length ? 0 : 1,
        evidenceCoverageRatio: projectNames.length ? 0 : 1,
        hotspotCount: 0,
        hasCycle: false,
      },
    },
  } as unknown as WorkspaceModel;
}

function graph(currentModel: WorkspaceModel, ids: string[]): WorkspaceKnowledgeGraph {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    generatedAt: currentModel.generatedAt,
    source: {
      kind: 'workspace-model',
      artifact: '.workspai/reports/workspace-model.json',
      hashAlgorithm: 'sha256',
      hash: hashWorkspaceModel(currentModel),
    },
    workspace: { name: 'fixture' },
    projectTopology: currentModel.graph!,
    entities: ids.map((id) => ({
      id,
      kind: 'project',
      label: id,
      identity: { key: id, scope: 'project', aliases: [], fingerprint: 'a'.repeat(64) },
      attributes: {},
      proofIds: [],
    })),
    relations: [],
    proofs: [],
    providers: [],
    quality: {
      entityCount: ids.length,
      relationCount: 0,
      proofCount: 0,
      entityProofCoverageRatio: ids.length ? 0 : 1,
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

describe('WorkspaceGraphStreamPublisher', () => {
  it('publishes a snapshot followed by a hash-linked bounded delta', () => {
    let correlation = 0;
    const publisher = new WorkspaceGraphStreamPublisher({
      workspacePath: '/workspace',
      sessionId: 'session-1',
      now: () => new Date('2026-07-22T00:00:00.000Z'),
      correlationId: () => `correlation-${correlation++}`,
    });
    const beforeModel = model(['api']);
    const before = publisher.publish(beforeModel, graph(beforeModel, ['project:api']));
    expect(before).toMatchObject({
      type: 'graph.snapshot',
      generation: 0,
      revision: 0,
      sessionId: 'session-1',
    });

    const afterModel = model(['api', 'web']);
    const after = publisher.publish(afterModel, graph(afterModel, ['project:api', 'project:web']));
    expect(after).toMatchObject({
      type: 'graph.delta',
      generation: 1,
      baseRevision: 0,
      revision: 1,
      baseModelHash: before.modelHash,
      baseGraphHash: before.graphHash,
    });
    expect(after.payload.entitiesAdded).toEqual([expect.objectContaining({ id: 'project:web' })]);
    expect(after.payload.entitiesUpdated).toEqual([]);
  });

  it('does not turn observation timestamps into proof updates', () => {
    const publisher = new WorkspaceGraphStreamPublisher({
      workspacePath: '/workspace',
      sessionId: 'session-1',
    });
    const currentModel = model([]);
    const first = graph(currentModel, []);
    first.proofs = [
      {
        id: 'proof:one',
        provider: 'fixture',
        artifact: 'package.json',
        observedAt: '2026-07-22T00:00:00.000Z',
        derivation: 'extracted',
        trust: 'authoritative',
        confidence: 'high',
        freshness: 'fresh',
      },
    ];
    first.quality.proofCount = 1;
    publisher.publish(currentModel, first);
    const second = structuredClone(first);
    second.proofs[0].observedAt = '2026-07-22T00:01:00.000Z';
    const delta = publisher.publish(currentModel, second);
    expect(delta.payload.proofsUpdated).toEqual([]);
  });
});
