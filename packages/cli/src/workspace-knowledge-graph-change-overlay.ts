import { createHash } from 'crypto';

import type {
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProof,
  WorkspaceKnowledgeRelation,
} from './contracts/workspace-knowledge-graph-contract.js';
import {
  WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION,
  type WorkspaceKnowledgeGraphChange,
  type WorkspaceKnowledgeGraphChangeOverlay,
} from './contracts/workspace-knowledge-graph-change-overlay-contract.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(graph: WorkspaceKnowledgeGraph): string {
  return createHash('sha256')
    .update(
      canonical({
        entities: graph.entities,
        relations: graph.relations,
        proofs: graph.proofs.map(
          ({ observedAt: _observedAt, freshness: _freshness, ...proof }) => proof
        ),
      })
    )
    .digest('hex');
}

function changedFields(before: object, after: object): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        canonical((before as Record<string, unknown>)[key]) !==
        canonical((after as Record<string, unknown>)[key])
    )
    .sort();
}

function compareById<T extends { id: string }>(
  base: readonly T[],
  head: readonly T[]
): { added: T[]; removed: T[]; changed: WorkspaceKnowledgeGraphChange<T>[] } {
  const beforeById = new Map(base.map((item) => [item.id, item]));
  const afterById = new Map(head.map((item) => [item.id, item]));
  const added = head.filter((item) => !beforeById.has(item.id));
  const removed = base.filter((item) => !afterById.has(item.id));
  const changed: WorkspaceKnowledgeGraphChange<T>[] = [];
  for (const [id, before] of beforeById) {
    const after = afterById.get(id);
    if (!after) continue;
    const fields = changedFields(before, after);
    if (fields.length > 0) changed.push({ id, before, after, changedFields: fields });
  }
  return {
    added: [...added].sort((a, b) => a.id.localeCompare(b.id)),
    removed: [...removed].sort((a, b) => a.id.localeCompare(b.id)),
    changed: changed.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function stableProof(proof: WorkspaceKnowledgeProof): WorkspaceKnowledgeProof {
  return { ...proof, observedAt: '1970-01-01T00:00:00.000Z', freshness: 'fresh' };
}

function compareProofs(
  base: readonly WorkspaceKnowledgeProof[],
  head: readonly WorkspaceKnowledgeProof[]
): {
  added: WorkspaceKnowledgeProof[];
  removed: WorkspaceKnowledgeProof[];
  changed: WorkspaceKnowledgeGraphChange<WorkspaceKnowledgeProof>[];
} {
  const compared = compareById(base.map(stableProof), head.map(stableProof));
  const beforeById = new Map(base.map((proof) => [proof.id, proof]));
  const afterById = new Map(head.map((proof) => [proof.id, proof]));
  return {
    added: compared.added.map((proof) => afterById.get(proof.id) ?? proof),
    removed: compared.removed.map((proof) => beforeById.get(proof.id) ?? proof),
    changed: compared.changed.map((change) => ({
      id: change.id,
      before: beforeById.get(change.id),
      after: afterById.get(change.id),
      changedFields: change.changedFields,
    })),
  };
}

function proofArtifacts(graph: WorkspaceKnowledgeGraph, proofIds: Iterable<string>): string[] {
  const ids = new Set(proofIds);
  return graph.proofs.filter((proof) => ids.has(proof.id)).map((proof) => proof.artifact);
}

export function buildWorkspaceKnowledgeGraphChangeOverlay(
  base: WorkspaceKnowledgeGraph,
  head: WorkspaceKnowledgeGraph,
  now = new Date()
): WorkspaceKnowledgeGraphChangeOverlay {
  const entities = compareById<WorkspaceKnowledgeEntity>(base.entities, head.entities);
  const relations = compareById<WorkspaceKnowledgeRelation>(base.relations, head.relations);
  const proofs = compareProofs(base.proofs, head.proofs);
  const directlyChanged = new Set([
    ...entities.added.map((entity) => entity.id),
    ...entities.removed.map((entity) => entity.id),
    ...entities.changed.map((entity) => entity.id),
  ]);
  const changedRelations = [
    ...relations.added,
    ...relations.removed,
    ...relations.changed.flatMap((change) => [change.before, change.after].filter(Boolean)),
  ] as WorkspaceKnowledgeRelation[];
  for (const relation of changedRelations) {
    directlyChanged.add(relation.from);
    directlyChanged.add(relation.to);
  }

  // One-hop expansion makes the overlay immediately useful for review while remaining bounded.
  const impacted = new Set(directlyChanged);
  for (const relation of [...base.relations, ...head.relations]) {
    if (directlyChanged.has(relation.from) || directlyChanged.has(relation.to)) {
      impacted.add(relation.from);
      impacted.add(relation.to);
    }
  }

  const changedProofIds = new Set<string>([
    ...proofs.added.map((proof) => proof.id),
    ...proofs.removed.map((proof) => proof.id),
    ...proofs.changed.map((proof) => proof.id),
  ]);
  // `changedArtifacts` represents source evidence whose bytes were actually
  // added, removed, or changed. Do not expand it through every proof attached
  // to a changed entity/relation: shared dependency entities accumulate proofs
  // from many unchanged manifests, and one new manifest would otherwise make
  // all of those authored files look mutated to PCC and repair consumers.
  // Entity and relation impact remains available through their own deltas and
  // `impactedEntityIds`; artifact mutation follows proof deltas only.
  const changedArtifacts = [
    ...new Set([
      ...proofArtifacts(base, changedProofIds),
      ...proofArtifacts(head, changedProofIds),
      ...proofs.added.map((proof) => proof.artifact),
      ...proofs.removed.map((proof) => proof.artifact),
      ...proofs.changed.flatMap((proof) => [proof.before?.artifact, proof.after?.artifact]),
    ]),
  ]
    .filter((artifact): artifact is string => Boolean(artifact))
    .sort();
  const destructive = entities.removed.length + relations.removed.length + proofs.removed.length;
  const total =
    destructive +
    entities.added.length +
    entities.changed.length +
    relations.added.length +
    relations.changed.length +
    proofs.added.length +
    proofs.removed.length +
    proofs.changed.length;
  const risk =
    total === 0
      ? 'none'
      : destructive > 0 || impacted.size >= 10
        ? 'high'
        : impacted.size >= 5 || total >= 5
          ? 'medium'
          : 'low';

  return {
    schemaVersion: WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    workspace: head.workspace,
    base: {
      schemaVersion: base.schemaVersion,
      generatedAt: base.generatedAt,
      fingerprint: fingerprint(base),
    },
    head: {
      schemaVersion: head.schemaVersion,
      generatedAt: head.generatedAt,
      fingerprint: fingerprint(head),
    },
    entities,
    relations,
    proofs,
    impactedEntityIds: [...impacted].sort(),
    changedArtifacts,
    summary: {
      entityAdds: entities.added.length,
      entityRemovals: entities.removed.length,
      entityChanges: entities.changed.length,
      relationAdds: relations.added.length,
      relationRemovals: relations.removed.length,
      relationChanges: relations.changed.length,
      proofAdds: proofs.added.length,
      proofRemovals: proofs.removed.length,
      proofChanges: proofs.changed.length,
      impactedEntities: impacted.size,
      changedArtifacts: changedArtifacts.length,
      risk,
    },
  };
}
