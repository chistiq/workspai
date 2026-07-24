import crypto from 'node:crypto';
import path from 'node:path';

import type {
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProviderRun,
} from './contracts/workspace-knowledge-graph-contract.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';
import type { WorkspaceModel } from './workspace-model.js';

export const WORKSPACE_GRAPH_STREAM_SCHEMA_VERSION = 'workspace-graph-stream.v1' as const;

type GraphRecord = { id: string } & Record<string, unknown>;

export type WorkspaceGraphStreamEvent = {
  schemaVersion: typeof WORKSPACE_GRAPH_STREAM_SCHEMA_VERSION;
  type:
    | 'graph.snapshot'
    | 'graph.delta'
    | 'graph.provider-progress'
    | 'graph.quality-changed'
    | 'graph.proof-invalidated'
    | 'graph.resync-required'
    | 'graph.paused'
    | 'graph.complete'
    | 'graph.heartbeat'
    | 'graph.error';
  workspaceId: string;
  sessionId: string;
  generation: number;
  baseRevision?: number;
  baseModelHash?: string;
  baseGraphHash?: string;
  revision: number;
  modelHash: string;
  graphHash: string;
  generatedAt: string;
  causationId: string;
  correlationId: string;
  payload: Record<string, unknown>;
};

function stableGraphHash(graph: WorkspaceKnowledgeGraph): string {
  return hashCanonicalJson({
    ...graph,
    generatedAt: '<ignored>',
    proofs: graph.proofs.map((proof) => ({ ...proof, observedAt: '<ignored>' })),
  });
}

function comparableRecord(record: GraphRecord): unknown {
  if ('observedAt' in record) {
    return { ...record, observedAt: '<ignored>' };
  }
  return record;
}

function collectionDelta<T extends GraphRecord>(previous: T[], next: T[]) {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  const after = new Map(next.map((entry) => [entry.id, entry]));
  const added = next.filter((entry) => !before.has(entry.id));
  const updated = next.filter((entry) => {
    const prior = before.get(entry.id);
    return prior
      ? hashCanonicalJson(comparableRecord(prior)) !== hashCanonicalJson(comparableRecord(entry))
      : false;
  });
  const removed = previous.filter((entry) => !after.has(entry.id)).map((entry) => entry.id);
  return { added, updated, removed };
}

function providersDelta(
  previous: WorkspaceKnowledgeProviderRun[],
  next: WorkspaceKnowledgeProviderRun[]
): WorkspaceKnowledgeProviderRun[] {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  return next.filter((entry) => {
    const prior = before.get(entry.id);
    return !prior || hashCanonicalJson(prior) !== hashCanonicalJson(entry);
  });
}

function validated(event: WorkspaceGraphStreamEvent): WorkspaceGraphStreamEvent {
  assertJsonSchemaContract(
    event,
    'contracts/workspace-intelligence/workspace-graph-stream.v1.json',
    'Workspace graph stream event'
  );
  return event;
}

export type WorkspaceGraphStreamPublisherOptions = {
  workspacePath: string;
  sessionId?: string;
  now?: () => Date;
  correlationId?: () => string;
};

export class WorkspaceGraphStreamPublisher {
  private previous: WorkspaceKnowledgeGraph | null = null;
  private revision = 0;
  private generation = 0;
  private readonly workspaceId: string;
  private readonly sessionId: string;
  private readonly now: () => Date;
  private readonly nextCorrelationId: () => string;

  constructor(options: WorkspaceGraphStreamPublisherOptions) {
    this.workspaceId = `workspace:${crypto.createHash('sha256').update(path.resolve(options.workspacePath)).digest('hex')}`;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.now = options.now ?? (() => new Date());
    this.nextCorrelationId = options.correlationId ?? (() => crypto.randomUUID());
  }

  publish(model: WorkspaceModel, graph: WorkspaceKnowledgeGraph): WorkspaceGraphStreamEvent {
    const generatedAt = this.now().toISOString();
    const modelHash = hashWorkspaceModel(model);
    const graphHash = stableGraphHash(graph);
    const correlationId = this.nextCorrelationId();
    const common = {
      schemaVersion: WORKSPACE_GRAPH_STREAM_SCHEMA_VERSION,
      workspaceId: this.workspaceId,
      sessionId: this.sessionId,
      generation: this.generation,
      modelHash,
      graphHash,
      generatedAt,
      causationId: correlationId,
      correlationId,
    } as const;

    if (!this.previous) {
      const event = validated({
        ...common,
        type: 'graph.snapshot',
        revision: this.revision,
        payload: { graph, reason: 'initial' },
      });
      this.previous = graph;
      return event;
    }

    const previous = this.previous;
    const previousRevision = this.revision;
    const previousModelHash = previous.source.hash;
    const previousGraphHash = stableGraphHash(previous);
    this.revision += 1;
    this.generation += 1;
    const entities = collectionDelta(previous.entities, graph.entities);
    const relations = collectionDelta(previous.relations, graph.relations);
    const proofs = collectionDelta(previous.proofs, graph.proofs);
    const qualityChanged = hashCanonicalJson(previous.quality) !== hashCanonicalJson(graph.quality);
    const event = validated({
      ...common,
      generation: this.generation,
      type: 'graph.delta',
      baseRevision: previousRevision,
      baseModelHash: previousModelHash,
      baseGraphHash: previousGraphHash,
      revision: this.revision,
      payload: {
        entitiesAdded: entities.added,
        entitiesUpdated: entities.updated,
        entitiesRemoved: entities.removed,
        relationsAdded: relations.added,
        relationsUpdated: relations.updated,
        relationsRemoved: relations.removed,
        proofsAdded: proofs.added,
        proofsUpdated: proofs.updated,
        proofsRemoved: proofs.removed,
        providersUpdated: providersDelta(previous.providers, graph.providers),
        quality: qualityChanged ? graph.quality : null,
        diagnostics: graph.diagnostics,
      },
    });
    this.previous = graph;
    return event;
  }
}
