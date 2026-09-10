import type { WisDigestReference, WisEvidenceReference } from '@workspai/shared/contracts';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_QUALITY_CONTRACT,
  type GraphDiagnostic,
  type GraphEdge,
  type GraphEntityAlias,
  type GraphEntityReference,
  type GraphFactFreshness,
  type GraphGeneration,
  type GraphOntologyRelationDefinition,
  type GraphProofState,
  type GraphQualityReport,
  type GraphQualityVerdict,
  type GraphValidationIssue,
  type GraphValidationResult,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import { admitGraphProviderOutput } from '../conformance/foundation.js';
import {
  validateCanonicalGraph,
  validateGraphOntologyProfile,
  validateGraphQualityReport,
} from '../conformance/graph.js';
import { assessGraphEvidenceIndependence } from '../conformance/lineage.js';
import type { GraphExecutionPorts } from '../ports/index.js';
import { digestCanonicalGraphInput } from './digest-canonical-graph-input.js';
import type {
  GraphCompositionDecision,
  GraphCompositionOutput,
  GraphCompositionRequest,
  GraphCompositionResult,
  GraphCompositionSource,
  GraphReferenceCompositionTaskOutput,
} from './composition-types.js';

interface FactRecord {
  readonly fact: GraphWorkspaceFact;
}

interface EdgeCandidate {
  readonly key: string;
  readonly relation: GraphOntologyRelationDefinition;
  readonly from: GraphEntityReference;
  readonly to: GraphEntityReference;
  readonly facts: readonly FactRecord[];
}

type PreparedComposition = GraphReferenceCompositionTaskOutput;

const encoder = new TextEncoder();
const MAX_COMPOSITION_SOURCES = 10_000;
const MAX_COMPOSITION_FACTS = 10_000_000;
const MAX_COMPOSITION_EDGES = 50_000_000;
const MAX_WORKER_TIMEOUT_MS = 3_600_000;
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024 * 1024;

export const GRAPH_REFERENCE_COMPOSITION_TASK = Object.freeze({
  id: 'workspai.graph.reference-composition',
  version: '0.1.0-candidate',
});

function issue(code: string, path: string, message: string): GraphValidationIssue {
  return { code, path, message };
}

function canonical(input: unknown): string {
  const result = canonicalizeGraphValue(input);
  if (!result.accepted) throw new Error(result.issues[0]?.message ?? 'Canonicalization failed.');
  return result.value;
}

async function digest(input: unknown, ports: GraphExecutionPorts): Promise<WisDigestReference> {
  return digestCanonicalGraphInput(input, ports.digest);
}

function scopeKey(entity: GraphEntityReference): string {
  return canonical(entity.scope);
}

function entitySignature(entity: GraphEntityReference): string {
  return `${entity.id}\u0000${entity.kind}\u0000${scopeKey(entity)}`;
}

function sortUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function sortCanonical<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => canonical(left).localeCompare(canonical(right)));
}

function uniqueCanonical<T>(values: readonly T[]): T[] {
  return [...new Map(sortCanonical(values).map((value) => [canonical(value), value])).values()];
}

function deepFreeze<T>(input: T): Readonly<T> {
  const pending: object[] = [];
  const visited = new Set<object>();
  if (typeof input === 'object' && input !== null) pending.push(input);
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || visited.has(value)) continue;
    visited.add(value);
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
    Object.freeze(value);
  }
  return input;
}

function immutableCopy<T>(input: T): Readonly<T> {
  return deepFreeze(JSON.parse(canonical(input)) as T);
}

function aggregateCoverage(
  sources: readonly GraphCompositionSource[]
): readonly { dimension: string; observed: number; expected?: number }[] {
  const dimensions = new Map<
    string,
    { observed: number; expected: number; hasUnknownExpected: boolean }
  >();
  for (const entry of sources.flatMap((source) => source.batch.coverage)) {
    const aggregate = dimensions.get(entry.dimension) ?? {
      observed: 0,
      expected: 0,
      hasUnknownExpected: false,
    };
    aggregate.observed += entry.observed;
    if (entry.expected === undefined) aggregate.hasUnknownExpected = true;
    else aggregate.expected += entry.expected;
    dimensions.set(entry.dimension, aggregate);
  }
  return Object.freeze(
    [...dimensions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dimension, aggregate]) => ({
        dimension,
        observed: aggregate.observed,
        ...(!aggregate.hasUnknownExpected ? { expected: aggregate.expected } : {}),
      }))
  );
}

function semanticFact(fact: GraphWorkspaceFact): unknown {
  return {
    factId: fact.factId,
    factType: fact.factType,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    scope: fact.scope,
    evidence: fact.evidence,
    provenance: fact.provenance,
    derivation: fact.derivation,
    authority: fact.authority,
    confidence: fact.confidence,
    freshness: {
      status: fact.freshness.status,
      ...(fact.freshness.renewal ? { renewal: fact.freshness.renewal } : {}),
    },
    truthLifecycle: fact.truthLifecycle,
    inputDigest: fact.inputDigest,
    unknownZones: fact.unknownZones,
    ...(fact.extensions ? { extensions: fact.extensions } : {}),
  };
}

function mergeEntityAliases(entities: readonly GraphEntityReference[]): {
  readonly nodes: readonly GraphEntityReference[];
  readonly invalidIds: ReadonlySet<string>;
  readonly resolvedIds: ReadonlyMap<string, string>;
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
} {
  const byId = new Map<string, GraphEntityReference[]>();
  for (const entity of entities) {
    const entries = byId.get(entity.id) ?? [];
    entries.push(entity);
    byId.set(entity.id, entries);
  }

  const invalidIds = new Set<string>();
  const unresolved: { id: string; candidates: readonly string[] }[] = [];
  const canonicalById = new Map<string, GraphEntityReference>();
  for (const id of [...byId.keys()].sort()) {
    const variants = byId.get(id) ?? [];
    const signatures = sortUnique(variants.map(entitySignature));
    if (signatures.length !== 1) {
      invalidIds.add(id);
      unresolved.push({
        id: `unresolved:identity:${id}`,
        candidates: variants.map(
          (variant, index) => `candidate:${variant.id}:${variant.kind}:${index + 1}`
        ),
      });
      continue;
    }
    const first = variants[0];
    if (!first) continue;
    const aliasReasons = new Map<string, GraphEntityAlias>();
    for (const variant of variants) {
      for (const alias of variant.aliases ?? []) {
        const previous = aliasReasons.get(alias.id);
        if (previous && previous.reason !== alias.reason) {
          invalidIds.add(id);
          unresolved.push({
            id: `unresolved:alias:${id}:${alias.id}`,
            candidates: sortUnique([previous.reason, alias.reason]),
          });
        } else aliasReasons.set(alias.id, alias);
      }
    }
    if (invalidIds.has(id)) continue;
    const aliases = [...aliasReasons.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    canonicalById.set(
      id,
      Object.freeze({
        id: first.id,
        identityScheme: first.identityScheme,
        kind: first.kind,
        scope: first.scope,
        ...(aliases.length > 0 ? { aliases: Object.freeze(aliases) } : {}),
      })
    );
  }

  const aliasOwners = new Map<string, Set<string>>();
  for (const node of canonicalById.values()) {
    for (const alias of node.aliases ?? []) {
      const owners = aliasOwners.get(alias.id) ?? new Set<string>();
      owners.add(node.id);
      aliasOwners.set(alias.id, owners);
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.size <= 1) continue;
    for (const owner of owners) invalidIds.add(owner);
    if (canonicalById.has(alias)) invalidIds.add(alias);
    unresolved.push({
      id: `unresolved:alias-owner:${alias}`,
      candidates: sortUnique([...owners]),
    });
  }

  const resolvedIds = new Map<string, string>();
  for (const start of canonicalById.keys()) {
    if (invalidIds.has(start)) continue;
    const chain: string[] = [];
    const active = new Set<string>();
    let current = start;
    let failed = false;
    while (true) {
      if (active.has(current)) {
        const cycle = [...active];
        for (const member of cycle) invalidIds.add(member);
        unresolved.push({
          id: `unresolved:alias-cycle:${sortUnique(cycle).join(':')}`,
          candidates: sortUnique(cycle),
        });
        failed = true;
        break;
      }
      active.add(current);
      chain.push(current);
      const owners = aliasOwners.get(current);
      const owner = owners?.size === 1 ? [...owners][0] : undefined;
      if (!owner || invalidIds.has(owner)) break;
      const currentEntity = canonicalById.get(current);
      const ownerEntity = canonicalById.get(owner);
      if (
        currentEntity &&
        ownerEntity &&
        (currentEntity.kind !== ownerEntity.kind ||
          scopeKey(currentEntity) !== scopeKey(ownerEntity))
      ) {
        invalidIds.add(current);
        invalidIds.add(owner);
        unresolved.push({
          id: `unresolved:alias-semantics:${current}:${owner}`,
          candidates: sortUnique([current, owner]),
        });
        failed = true;
        break;
      }
      current = owner;
    }
    if (!failed && !invalidIds.has(current)) {
      for (const member of chain) resolvedIds.set(member, current);
    }
  }

  const membersByRoot = new Map<string, string[]>();
  for (const [id, root] of resolvedIds) {
    if (invalidIds.has(id) || invalidIds.has(root)) continue;
    const members = membersByRoot.get(root) ?? [];
    members.push(id);
    membersByRoot.set(root, members);
  }
  const nodes: GraphEntityReference[] = [];
  for (const [root, members] of [...membersByRoot.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const rootEntity = canonicalById.get(root);
    if (!rootEntity) continue;
    const aliases = new Map<string, GraphEntityAlias>();
    for (const member of members) {
      const memberEntity = canonicalById.get(member);
      if (!memberEntity) continue;
      if (member !== root) aliases.set(member, { id: member, reason: 'canonicalization' });
      for (const alias of memberEntity.aliases ?? []) {
        if (alias.id !== root) aliases.set(alias.id, alias);
      }
    }
    nodes.push(
      Object.freeze({
        id: root,
        identityScheme: rootEntity.identityScheme,
        kind: rootEntity.kind,
        scope: rootEntity.scope,
        ...(aliases.size > 0
          ? {
              aliases: Object.freeze(
                [...aliases.values()].sort((left, right) => left.id.localeCompare(right.id))
              ),
            }
          : {}),
      })
    );
  }

  return {
    nodes: Object.freeze(nodes),
    invalidIds,
    resolvedIds,
    unresolved: Object.freeze(unresolved.sort((left, right) => left.id.localeCompare(right.id))),
  };
}

export function executeGraphReferenceCompositionTask(
  request: GraphCompositionRequest
): PreparedComposition {
  const relations = new Map(
    request.ontology.relations.map((relation) => [relation.kind, relation])
  );
  const entityFamilies = new Map(
    request.ontology.entities.map((entity) => [entity.kind, entity.family])
  );
  const records: FactRecord[] = [];
  for (const source of [...request.sources].sort((left, right) => {
    const leftKey = `${left.manifest.id}\u0000${left.manifest.version}\u0000${left.batch.batchId}`;
    const rightKey = `${right.manifest.id}\u0000${right.manifest.version}\u0000${right.batch.batchId}`;
    return leftKey.localeCompare(rightKey);
  })) {
    for (const fact of [...source.batch.facts].sort((left, right) =>
      left.factId.localeCompare(right.factId)
    )) {
      records.push({ fact });
    }
  }

  const entityResult = mergeEntityAliases(
    records.flatMap(({ fact }) => [
      fact.subject,
      ...('identityScheme' in fact.object ? [fact.object] : []),
    ])
  );
  const candidates = new Map<
    string,
    {
      relation: GraphOntologyRelationDefinition;
      from: GraphEntityReference;
      to: GraphEntityReference;
      facts: FactRecord[];
    }
  >();
  const decisions: GraphCompositionDecision[] = [];
  const diagnostics: GraphDiagnostic[] = [];
  const nodesById = new Map(entityResult.nodes.map((node) => [node.id, node]));

  const factIdCounts = new Map<string, number>();
  for (const { fact } of records)
    factIdCounts.set(fact.factId, (factIdCounts.get(fact.factId) ?? 0) + 1);
  const reportedDuplicateFactIds = new Set<string>();

  for (const record of records) {
    const { fact } = record;
    const baseKey = `${fact.subject.id}|${fact.predicate}|${'identityScheme' in fact.object ? fact.object.id : 'literal'}`;
    if ((factIdCounts.get(fact.factId) ?? 0) > 1) {
      if (!reportedDuplicateFactIds.has(fact.factId)) {
        reportedDuplicateFactIds.add(fact.factId);
        decisions.push({
          edgeKey: `${baseKey}|duplicate:${fact.factId}`,
          state: 'unresolved',
          includedInGraph: false,
          factIds: [fact.factId],
          explanation: {
            code: 'GRAPH_FACT_ID_COLLISION',
            drivers: ['fact identity is not globally unique across admitted batches'],
          },
        });
      }
      continue;
    }
    if (!('identityScheme' in fact.object)) {
      decisions.push({
        edgeKey: baseKey,
        state: 'rejected',
        includedInGraph: false,
        factIds: [fact.factId],
        explanation: {
          code: 'GRAPH_LITERAL_FACT_NOT_EDGE',
          drivers: ['literal facts do not materialize entity-to-entity edges'],
        },
      });
      continue;
    }
    if (
      entityResult.invalidIds.has(fact.subject.id) ||
      entityResult.invalidIds.has(fact.object.id) ||
      !entityResult.resolvedIds.has(fact.subject.id) ||
      !entityResult.resolvedIds.has(fact.object.id)
    ) {
      decisions.push({
        edgeKey: baseKey,
        state: 'unresolved',
        includedInGraph: false,
        factIds: [fact.factId],
        explanation: {
          code: 'GRAPH_EDGE_IDENTITY_UNRESOLVED',
          drivers: ['an endpoint has conflicting canonical identity claims'],
        },
      });
      continue;
    }
    const fromId = entityResult.resolvedIds.get(fact.subject.id);
    const toId = entityResult.resolvedIds.get(fact.object.id);
    const from = fromId ? nodesById.get(fromId) : undefined;
    const to = toId ? nodesById.get(toId) : undefined;
    if (!from || !to) {
      decisions.push({
        edgeKey: baseKey,
        state: 'unresolved',
        includedInGraph: false,
        factIds: [fact.factId],
        explanation: {
          code: 'GRAPH_EDGE_IDENTITY_UNRESOLVED',
          drivers: ['an endpoint did not resolve to a canonical graph node'],
        },
      });
      continue;
    }
    const canonicalEdgeKey = `${from.id}|${fact.predicate}|${to.id}`;
    const relation = relations.get(fact.predicate);
    const subjectFamily = entityFamilies.get(from.kind);
    const objectFamily = entityFamilies.get(to.kind);
    const ontologyFailures = [
      ...(!relation ? ['relation is absent from the active ontology'] : []),
      ...(relation && subjectFamily && !relation.subjectFamilies.includes(subjectFamily)
        ? ['subject family is forbidden by the active ontology']
        : []),
      ...(relation && objectFamily && !relation.objectFamilies.includes(objectFamily)
        ? ['object family is forbidden by the active ontology']
        : []),
      ...(relation && !relation.allowedAuthorities.includes(fact.authority)
        ? ['claim authority is forbidden by the active ontology']
        : []),
    ];
    if (!relation || ontologyFailures.length > 0) {
      decisions.push({
        edgeKey: canonicalEdgeKey,
        state: 'rejected',
        includedInGraph: false,
        factIds: [fact.factId],
        explanation: { code: 'GRAPH_EDGE_ONTOLOGY_REJECTED', drivers: ontologyFailures },
      });
      continue;
    }
    const existing = candidates.get(canonicalEdgeKey);
    if (existing) existing.facts.push(record);
    else candidates.set(canonicalEdgeKey, { relation, from, to, facts: [record] });
  }

  return {
    nodes: entityResult.nodes,
    candidates: Object.freeze(
      [...candidates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({ key, ...value, facts: Object.freeze(value.facts) }))
    ),
    decisions: Object.freeze(decisions),
    diagnostics: Object.freeze(diagnostics),
    unresolved: entityResult.unresolved,
  };
}

function uniqueEvidence(facts: readonly FactRecord[]): readonly WisEvidenceReference[] {
  const evidence = new Map<string, WisEvidenceReference>();
  for (const { fact } of facts) {
    for (const item of fact.evidence) {
      const key = `${item.id}\u0000${item.digest?.algorithm ?? ''}\u0000${item.digest?.value ?? ''}`;
      if (!evidence.has(key)) evidence.set(key, item);
    }
  }
  return Object.freeze(
    [...evidence.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, item]) => item)
  );
}

function evidenceGroups(
  candidate: EdgeCandidate,
  request: GraphCompositionRequest,
  roots: readonly string[]
): readonly { readonly root: string; readonly evidence: readonly WisEvidenceReference[] }[] {
  return Object.freeze(
    roots.map((root) => {
      const records = candidate.facts.filter(({ fact }) => {
        const lineage = request.lineages?.find((entry) => entry.factId === fact.factId);
        return lineage
          ? lineage.evidenceRoots.includes(root)
          : fact.evidence.some((item) => item.id === root);
      });
      return { root, evidence: uniqueEvidence(records) };
    })
  );
}

function aggregateFreshness(facts: readonly FactRecord[]): GraphFactFreshness {
  if (facts.some(({ fact }) => fact.freshness.status === 'stale')) return { status: 'stale' };
  if (facts.some(({ fact }) => fact.freshness.status === 'unknown')) return { status: 'unknown' };
  const validUntil = facts
    .map(({ fact }) => fact.freshness.validUntil)
    .filter((value): value is string => value !== undefined)
    .sort()[0];
  return { status: 'current', ...(validUntil ? { validUntil } : {}) };
}

function meanConfidence(facts: readonly FactRecord[]): number {
  if (facts.length === 0) return 0;
  const value = facts.reduce((total, { fact }) => total + fact.confidence, 0) / facts.length;
  return Number(value.toFixed(6));
}

function assessFactEligibility(
  fact: GraphWorkspaceFact,
  request: GraphCompositionRequest
):
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly state: 'rejected' | 'unresolved';
      readonly code: string;
      readonly drivers: readonly string[];
    } {
  if (fact.freshness.status === 'stale') {
    return {
      eligible: false,
      state: 'rejected',
      code: 'GRAPH_FACT_STALE',
      drivers: ['stale evidence cannot establish current graph truth'],
    };
  }
  if (fact.freshness.status === 'unknown') {
    return {
      eligible: false,
      state: request.policy.unknownFreshness === 'reject' ? 'rejected' : 'unresolved',
      code: 'GRAPH_FACT_FRESHNESS_UNKNOWN',
      drivers: ['claim freshness is unknown'],
    };
  }
  if (fact.confidence < request.policy.minimumConfidence) {
    return {
      eligible: false,
      state: 'rejected',
      code: 'GRAPH_FACT_CONFIDENCE_INSUFFICIENT',
      drivers: ['confidence is below the composition policy floor'],
    };
  }
  if (
    request.policy.inferredClaims === 'reject' &&
    (fact.authority === 'inferred' || fact.derivation === 'inferred')
  ) {
    return {
      eligible: false,
      state: 'rejected',
      code: 'GRAPH_FACT_INFERRED_NOT_AUTHORIZED',
      drivers: ['inferred claims are not authoritative under the active policy'],
    };
  }
  return { eligible: true };
}

function evaluateProof(
  candidate: EdgeCandidate,
  request: GraphCompositionRequest
): { state: GraphProofState; drivers: readonly string[]; roots: readonly string[] } {
  const freshness = aggregateFreshness(candidate.facts);
  const lineages = candidate.facts.map(
    ({ fact }) =>
      request.lineages?.find((lineage) => lineage.factId === fact.factId) ?? {
        factId: fact.factId,
        derivation: fact.derivation,
        evidenceRoots: fact.evidence.map((item) => item.id),
        parentFactIds: [],
      }
  );
  const independence = assessGraphEvidenceIndependence(lineages);
  const roots = sortUnique(lineages.flatMap((lineage) => lineage.evidenceRoots));
  if (freshness.status === 'stale')
    return { state: 'insufficient', drivers: ['all graph truth must remain current'], roots };
  if (freshness.status === 'unknown')
    return request.policy.unknownFreshness === 'reject'
      ? {
          state: 'insufficient',
          drivers: ['claim freshness is unknown and policy rejects it'],
          roots,
        }
      : { state: 'unresolved', drivers: ['claim freshness is unknown'], roots };
  if (candidate.facts.every(({ fact }) => fact.confidence < request.policy.minimumConfidence))
    return {
      state: 'insufficient',
      drivers: ['confidence is below the composition policy floor'],
      roots,
    };
  if (
    request.policy.inferredClaims === 'reject' &&
    candidate.facts.every(
      ({ fact }) => fact.authority === 'inferred' || fact.derivation === 'inferred'
    )
  )
    return {
      state: 'insufficient',
      drivers: ['inferred-only claims are not authoritative'],
      roots,
    };
  if (candidate.facts.some(({ fact }) => fact.authority === 'verified'))
    return { state: 'verified', drivers: ['current verified authority'], roots };
  const rejectedPairs = new Set(
    independence.rejectedPairs.flatMap((pair) => [
      `${pair.left}\u0000${pair.right}`,
      `${pair.right}\u0000${pair.left}`,
    ])
  );
  const hasIndependentPair = lineages.some((left, leftIndex) =>
    lineages.some(
      (right, rightIndex) =>
        rightIndex > leftIndex &&
        !rejectedPairs.has(`${left.factId}\u0000${right.factId}`) &&
        left.evidenceRoots.some((leftRoot) =>
          right.evidenceRoots.some((rightRoot) => leftRoot !== rightRoot)
        )
    )
  );
  if (roots.length >= 2 && hasIndependentPair)
    return { state: 'corroborated', drivers: ['independent evidence roots'], roots };
  return { state: 'supported', drivers: ['current evidence-backed claim'], roots };
}

function failure(
  code: 'invalid-input' | 'cancelled' | 'resource-limit' | 'composition-failed',
  issues: readonly GraphValidationIssue[]
): GraphCompositionResult {
  return { accepted: false, code, issues };
}

function validateLineages(request: GraphCompositionRequest): readonly GraphValidationIssue[] {
  if (!request.lineages) return [];
  const issues: GraphValidationIssue[] = [];
  const factIds = new Set(
    request.sources.flatMap((source) => source.batch.facts.map((fact) => fact.factId))
  );
  const lineageIds = request.lineages.map((lineage) => lineage.factId);
  for (const [index, lineage] of request.lineages.entries()) {
    if (
      !factIds.has(lineage.factId) ||
      lineage.evidenceRoots.length === 0 ||
      lineage.evidenceRoots.some((root) => typeof root !== 'string' || root.length === 0) ||
      new Set(lineage.evidenceRoots).size !== lineage.evidenceRoots.length ||
      lineage.parentFactIds.some((parent) => !factIds.has(parent) || parent === lineage.factId) ||
      new Set(lineage.parentFactIds).size !== lineage.parentFactIds.length
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_LINEAGE_INVALID',
          `/lineages/${index}`,
          'Lineage must reference admitted facts with unique evidence roots and valid direct parents.'
        )
      );
    }
  }
  if (new Set(lineageIds).size !== lineageIds.length) {
    issues.push(
      issue(
        'GRAPH_COMPOSITION_LINEAGE_DUPLICATE',
        '/lineages',
        'A fact may have at most one explicit lineage record.'
      )
    );
  }
  const byId = new Map(request.lineages.map((lineage) => [lineage.factId, lineage]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (factId: string): boolean => {
    if (active.has(factId)) return true;
    if (visited.has(factId)) return false;
    active.add(factId);
    const cyclic = (byId.get(factId)?.parentFactIds ?? []).some((parent) => visit(parent));
    active.delete(factId);
    visited.add(factId);
    return cyclic;
  };
  if (lineageIds.some((factId) => visit(factId))) {
    issues.push(
      issue('GRAPH_COMPOSITION_LINEAGE_CYCLE', '/lineages', 'Lineage ancestry must be acyclic.')
    );
  }
  return issues;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function validateWorkerCompositionOutput(
  input: unknown,
  request: GraphCompositionRequest
): GraphValidationResult<GraphReferenceCompositionTaskOutput> {
  const issues: GraphValidationIssue[] = [];
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes) ||
    !Array.isArray(input.candidates) ||
    !Array.isArray(input.decisions) ||
    !Array.isArray(input.diagnostics) ||
    !Array.isArray(input.unresolved)
  ) {
    return {
      accepted: false,
      issues: [
        issue(
          'GRAPH_COMPOSITION_WORKER_OUTPUT_INVALID',
          '/workers/output',
          'Composition worker output does not implement the portable task result contract.'
        ),
      ],
    };
  }

  const inputFacts = request.sources.flatMap((source) => source.batch.facts);
  const knownFacts = new Map<string, GraphWorkspaceFact>();
  const duplicateFactIds = new Set<string>();
  for (const fact of inputFacts) {
    if (knownFacts.has(fact.factId)) duplicateFactIds.add(fact.factId);
    else knownFacts.set(fact.factId, fact);
  }
  const assignments = new Map<string, number>();
  const assign = (factId: string, path: string): void => {
    if (!knownFacts.has(factId)) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_FACT_UNKNOWN',
          path,
          'Composition worker output references a fact that was not admitted.'
        )
      );
      return;
    }
    assignments.set(factId, (assignments.get(factId) ?? 0) + 1);
  };

  const nodeOwners = new Map<string, GraphEntityReference[]>();
  for (const [index, value] of input.nodes.entries()) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_NODE_INVALID',
          `/workers/output/nodes/${index}`,
          'Composition worker returned an invalid canonical node candidate.'
        )
      );
      continue;
    }
    const node = value as unknown as GraphEntityReference;
    for (const identity of [node.id, ...(node.aliases ?? []).map((alias) => alias.id)]) {
      const owners = nodeOwners.get(identity) ?? [];
      owners.push(node);
      nodeOwners.set(identity, owners);
    }
  }

  const inputEntities = inputFacts.flatMap((fact) => [
    fact.subject,
    ...('identityScheme' in fact.object ? [fact.object] : []),
  ]);
  const inputEntityIds = new Set(
    inputEntities.flatMap((entity) => [
      entity.id,
      ...(entity.aliases ?? []).map((alias) => alias.id),
    ])
  );
  const unresolvedCandidates = new Set<string>();
  for (const [index, value] of input.unresolved.entries()) {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      !Array.isArray(value.candidates) ||
      value.candidates.some((candidate) => typeof candidate !== 'string')
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_UNRESOLVED_INVALID',
          `/workers/output/unresolved/${index}`,
          'Composition worker returned an invalid unresolved identity record.'
        )
      );
      continue;
    }
    for (const candidate of value.candidates as string[]) unresolvedCandidates.add(candidate);
  }
  for (const [index, value] of input.nodes.entries()) {
    if (isRecord(value) && typeof value.id === 'string' && !inputEntityIds.has(value.id)) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_NODE_UNKNOWN',
          `/workers/output/nodes/${index}/id`,
          'Composition worker returned a node that is not derived from admitted facts.'
        )
      );
    }
  }
  for (const [index, entity] of inputEntities.entries()) {
    const owners = nodeOwners.get(entity.id) ?? [];
    if (owners.length === 0 && unresolvedCandidates.has(entity.id)) continue;
    if (
      owners.length !== 1 ||
      owners[0]?.kind !== entity.kind ||
      canonical(owners[0]?.scope) !== canonical(entity.scope) ||
      canonical(owners[0]?.identityScheme) !== canonical(entity.identityScheme)
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_IDENTITY_INVALID',
          `/workers/output/nodes/${index}`,
          'Composition worker did not preserve the unique identity semantics of an admitted entity.'
        )
      );
    }
  }

  for (const [index, value] of input.candidates.entries()) {
    const path = `/workers/output/candidates/${index}`;
    if (
      !isRecord(value) ||
      typeof value.key !== 'string' ||
      !isRecord(value.relation) ||
      !isRecord(value.from) ||
      !isRecord(value.to) ||
      !Array.isArray(value.facts)
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_CANDIDATE_INVALID',
          path,
          'Composition worker returned an invalid edge candidate.'
        )
      );
      continue;
    }
    const candidate = value as unknown as PreparedComposition['candidates'][number];
    const expectedRelation = request.ontology.relations.find(
      (relation) => relation.kind === candidate.relation.kind
    );
    if (
      !expectedRelation ||
      canonical(expectedRelation) !== canonical(candidate.relation) ||
      candidate.key !== `${candidate.from.id}|${candidate.relation.kind}|${candidate.to.id}`
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_CANDIDATE_SEMANTICS_INVALID',
          path,
          'Composition worker changed ontology or canonical edge identity semantics.'
        )
      );
    }
    for (const [factIndex, record] of candidate.facts.entries()) {
      const factPath = `${path}/facts/${factIndex}`;
      if (!isRecord(record) || !isRecord(record.fact) || typeof record.fact.factId !== 'string') {
        issues.push(
          issue(
            'GRAPH_COMPOSITION_WORKER_FACT_INVALID',
            factPath,
            'Composition worker returned an invalid fact record.'
          )
        );
        continue;
      }
      const workerFact = record.fact as unknown as GraphWorkspaceFact;
      const admittedFact = knownFacts.get(workerFact.factId);
      assign(workerFact.factId, `${factPath}/factId`);
      if (!admittedFact || canonical(workerFact) !== canonical(admittedFact)) {
        issues.push(
          issue(
            'GRAPH_COMPOSITION_WORKER_FACT_MUTATED',
            factPath,
            'Composition worker altered an admitted fact.'
          )
        );
        continue;
      }
      if (
        !('identityScheme' in workerFact.object) ||
        candidate.relation.kind !== workerFact.predicate ||
        nodeOwners.get(workerFact.subject.id)?.length !== 1 ||
        nodeOwners.get(workerFact.subject.id)?.[0]?.id !== candidate.from.id ||
        nodeOwners.get(workerFact.object.id)?.length !== 1 ||
        nodeOwners.get(workerFact.object.id)?.[0]?.id !== candidate.to.id
      ) {
        issues.push(
          issue(
            'GRAPH_COMPOSITION_WORKER_ENDPOINT_INVALID',
            factPath,
            'Composition worker candidate endpoints do not resolve from the admitted fact.'
          )
        );
      }
    }
  }

  for (const [index, value] of input.decisions.entries()) {
    const path = `/workers/output/decisions/${index}`;
    if (
      !isRecord(value) ||
      typeof value.edgeKey !== 'string' ||
      !['accepted', 'disputed', 'rejected', 'unresolved'].includes(String(value.state)) ||
      typeof value.includedInGraph !== 'boolean' ||
      !Array.isArray(value.factIds) ||
      value.factIds.length === 0 ||
      value.factIds.some((factId) => typeof factId !== 'string')
    ) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_DECISION_INVALID',
          path,
          'Composition worker returned an invalid exclusion decision.'
        )
      );
      continue;
    }
    if (value.includedInGraph || !['rejected', 'unresolved'].includes(String(value.state))) {
      issues.push(
        issue(
          'GRAPH_COMPOSITION_WORKER_DECISION_AUTHORITY_INVALID',
          path,
          'Reference worker decisions may only exclude rejected or unresolved fact claims.'
        )
      );
    }
    for (const factId of value.factIds as string[]) assign(factId, `${path}/factIds`);
  }

  for (const factId of knownFacts.keys()) {
    const count = assignments.get(factId) ?? 0;
    if (count !== 1) {
      issues.push(
        issue(
          count === 0
            ? 'GRAPH_COMPOSITION_WORKER_FACT_OMITTED'
            : 'GRAPH_COMPOSITION_WORKER_FACT_DUPLICATED',
          '/workers/output',
          `Composition worker must account for admitted fact ${factId} exactly once.`
        )
      );
    }
    if (duplicateFactIds.has(factId)) {
      const decision = (input.decisions as unknown[]).find(
        (value) =>
          isRecord(value) &&
          Array.isArray(value.factIds) &&
          value.factIds.includes(factId) &&
          value.state === 'unresolved'
      );
      if (!decision) {
        issues.push(
          issue(
            'GRAPH_COMPOSITION_WORKER_COLLISION_NOT_UNRESOLVED',
            '/workers/output/decisions',
            `Colliding fact identity ${factId} must remain unresolved.`
          )
        );
      }
    }
  }

  return issues.length === 0
    ? { accepted: true, value: input as unknown as GraphReferenceCompositionTaskOutput, issues: [] }
    : { accepted: false, issues };
}

export async function composeGraph(
  request: GraphCompositionRequest,
  ports: GraphExecutionPorts
): Promise<GraphCompositionResult> {
  try {
    ports.cancellation.throwIfAborted();
    const ontology = validateGraphOntologyProfile(request.ontology);
    if (!ontology.accepted) return failure('invalid-input', ontology.issues);
    if (
      typeof request.policy.id !== 'string' ||
      request.policy.id.length === 0 ||
      typeof request.policy.version !== 'string' ||
      request.policy.version.length === 0 ||
      typeof request.policy.architectureEpoch !== 'string' ||
      request.policy.architectureEpoch.length === 0 ||
      !Number.isFinite(request.policy.minimumConfidence) ||
      request.policy.minimumConfidence < 0 ||
      request.policy.minimumConfidence > 1 ||
      !Number.isInteger(request.policy.maxFacts) ||
      request.policy.maxFacts <= 0 ||
      request.policy.maxFacts > MAX_COMPOSITION_FACTS ||
      !Number.isInteger(request.policy.maxEdges) ||
      request.policy.maxEdges <= 0 ||
      request.policy.maxEdges > MAX_COMPOSITION_EDGES ||
      !Number.isInteger(request.policy.workerTimeoutMs) ||
      request.policy.workerTimeoutMs <= 0 ||
      request.policy.workerTimeoutMs > MAX_WORKER_TIMEOUT_MS ||
      !Number.isInteger(request.policy.maxWorkerOutputBytes) ||
      request.policy.maxWorkerOutputBytes <= 0 ||
      request.policy.maxWorkerOutputBytes > MAX_WORKER_OUTPUT_BYTES ||
      !['reject', 'accept-with-evidence'].includes(request.policy.inferredClaims) ||
      !['reject', 'accept-as-unresolved'].includes(request.policy.unknownFreshness) ||
      !Array.isArray(request.policy.functionalRelations) ||
      new Set(request.policy.functionalRelations).size !==
        request.policy.functionalRelations.length ||
      request.policy.functionalRelations.some(
        (relation) => !request.ontology.relations.some((candidate) => candidate.kind === relation)
      )
    ) {
      return failure('invalid-input', [
        issue(
          'GRAPH_COMPOSITION_POLICY_INVALID',
          '/policy',
          'Composition policy bounds are invalid.'
        ),
      ]);
    }

    if (!Array.isArray(request.sources) || request.sources.length > MAX_COMPOSITION_SOURCES) {
      return failure('resource-limit', [
        issue(
          'GRAPH_COMPOSITION_SOURCE_LIMIT',
          '/sources',
          'Composition sources exceed the fixed safety limit.'
        ),
      ]);
    }
    const admittedSources: GraphCompositionSource[] = [];
    const admissionIssues: GraphValidationIssue[] = [];
    for (const [index, source] of request.sources.entries()) {
      const admission = admitGraphProviderOutput(source.manifest, source.batch);
      if (admission.accepted) admittedSources.push(source);
      else
        admissionIssues.push(
          ...admission.issues.map((item) => ({ ...item, path: `/sources/${index}${item.path}` }))
        );
    }
    if (admissionIssues.length > 0) return failure('invalid-input', admissionIssues);
    const normalizedSources = sortCanonical(admittedSources);
    const sourceIdentities = normalizedSources.map(
      (source) => `${source.manifest.id}@${source.manifest.version}:${source.batch.batchId}`
    );
    if (new Set(sourceIdentities).size !== sourceIdentities.length) {
      return failure('invalid-input', [
        issue(
          'GRAPH_COMPOSITION_SOURCE_DUPLICATE',
          '/sources',
          'Provider batch identities must be globally unique within a composition.'
        ),
      ]);
    }
    const factCount = normalizedSources.reduce(
      (total, source) => total + source.batch.facts.length,
      0
    );
    if (factCount > request.policy.maxFacts) {
      return failure('resource-limit', [
        issue(
          'GRAPH_COMPOSITION_FACT_LIMIT',
          '/sources',
          'Admitted facts exceed the composition policy limit.'
        ),
      ]);
    }

    const normalizedRequest = { ...request, sources: normalizedSources };
    const lineageIssues = validateLineages(normalizedRequest);
    if (lineageIssues.length > 0) return failure('invalid-input', lineageIssues);
    const workerResult = await ports.workers.execute<GraphCompositionRequest, PreparedComposition>({
      task: GRAPH_REFERENCE_COMPOSITION_TASK,
      input: normalizedRequest,
      timeoutMs: request.policy.workerTimeoutMs,
      maxOutputBytes: request.policy.maxWorkerOutputBytes,
      ...(ports.signal ? { signal: ports.signal } : {}),
    });
    if (workerResult.status === 'cancelled') {
      return failure('cancelled', [
        issue(
          'GRAPH_COMPOSITION_CANCELLED',
          '',
          'Composition worker cancelled before publication.'
        ),
      ]);
    }
    if (workerResult.status === 'resource-limit') {
      return failure(
        'resource-limit',
        workerResult.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
          message: diagnostic.message,
        }))
      );
    }
    if (workerResult.status !== 'complete' || !workerResult.output) {
      return failure(
        'composition-failed',
        workerResult.diagnostics.length > 0
          ? workerResult.diagnostics.map((diagnostic) => ({
              code: diagnostic.code,
              path: diagnostic.path,
              message: diagnostic.message,
            }))
          : [
              issue(
                'GRAPH_COMPOSITION_WORKER_UNAVAILABLE',
                '/workers',
                `Composition worker returned ${workerResult.status}.`
              ),
            ]
      );
    }
    const workerOutputValidation = validateWorkerCompositionOutput(
      workerResult.output,
      normalizedRequest
    );
    if (!workerOutputValidation.accepted) {
      return failure('composition-failed', workerOutputValidation.issues);
    }
    const prepared = workerOutputValidation.value;
    const actualOutputBytes = encoder.encode(canonical(prepared)).byteLength;
    if (
      !Number.isFinite(workerResult.metrics.durationMs) ||
      workerResult.metrics.durationMs < 0 ||
      !Number.isInteger(workerResult.metrics.inputBytes) ||
      workerResult.metrics.inputBytes < 0 ||
      !Number.isInteger(workerResult.metrics.outputBytes) ||
      workerResult.metrics.outputBytes < 0 ||
      workerResult.metrics.outputBytes > request.policy.maxWorkerOutputBytes ||
      actualOutputBytes > request.policy.maxWorkerOutputBytes
    ) {
      return failure('resource-limit', [
        issue(
          'GRAPH_COMPOSITION_WORKER_BUDGET_INVALID',
          '/workers',
          'Composition worker metrics or actual output exceed the declared budget.'
        ),
      ]);
    }
    ports.cancellation.throwIfAborted();
    await ports.scheduler.yield();

    const decisions: GraphCompositionDecision[] = [...prepared.decisions];
    const eligibleCandidates: EdgeCandidate[] = [];
    for (const candidate of prepared.candidates) {
      const eligibleFacts: FactRecord[] = [];
      for (const record of candidate.facts) {
        const eligibility = assessFactEligibility(record.fact, normalizedRequest);
        if (eligibility.eligible) eligibleFacts.push(record);
        else {
          decisions.push({
            edgeKey: `${candidate.key}|fact:${record.fact.factId}`,
            state: eligibility.state,
            includedInGraph: false,
            factIds: [record.fact.factId],
            explanation: {
              code: eligibility.code,
              drivers: eligibility.drivers,
            },
          });
        }
      }
      if (eligibleFacts.length > 0) {
        eligibleCandidates.push({ ...candidate, facts: Object.freeze(eligibleFacts) });
      }
    }

    const semanticDigests = {
      ontology: await digest(request.ontology, ports),
      proofPolicies: await digest(
        request.ontology.relations.map((relation) => relation.proofPolicy),
        ports
      ),
      inputs: await digest(
        sortCanonical(normalizedSources.flatMap((source) => source.batch.inputs)),
        ports
      ),
      facts: await digest(
        sortCanonical(normalizedSources.flatMap((source) => source.batch.facts).map(semanticFact)),
        ports
      ),
      providers: await digest(
        sortCanonical(normalizedSources.map((source) => source.manifest)),
        ports
      ),
      compositionPolicy: await digest(request.policy, ports),
    };

    const evaluatedProofs = new Map(
      eligibleCandidates.map((candidate) => [
        candidate.key,
        evaluateProof(candidate, normalizedRequest),
      ])
    );
    const functional = new Set(request.policy.functionalRelations);
    const competing = new Map<string, EdgeCandidate[]>();
    for (const candidate of eligibleCandidates) {
      if (!functional.has(candidate.relation.kind)) continue;
      const proof = evaluatedProofs.get(candidate.key);
      if (!proof || proof.state === 'insufficient' || proof.state === 'unresolved') continue;
      const key = `${candidate.from.id}|${candidate.relation.kind}`;
      const entries = competing.get(key) ?? [];
      entries.push(candidate);
      competing.set(key, entries);
    }

    const edges: GraphEdge[] = [];
    const disputes: { id: string; factIds: readonly string[] }[] = [];
    const evaluatedAt = ports.clock.now().toISOString();
    for (const candidate of eligibleCandidates) {
      ports.cancellation.throwIfAborted();
      const proof = evaluatedProofs.get(candidate.key);
      if (!proof) throw new Error(`Proof evaluation is missing for ${candidate.key}.`);
      const competitors = competing.get(`${candidate.from.id}|${candidate.relation.kind}`) ?? [];
      const conflict = competitors.length > 1;
      const evidence = uniqueEvidence(candidate.facts);
      const factIds = sortUnique(candidate.facts.map(({ fact }) => fact.factId));
      const edgeDigest = await digest(candidate.key, ports);
      const proofInputDigest = await digest(
        candidate.facts.map(({ fact }) => ({
          factId: fact.factId,
          inputDigest: fact.inputDigest,
          evidence: fact.evidence,
        })),
        ports
      );
      const state = conflict
        ? 'disputed'
        : proof.state === 'insufficient'
          ? 'rejected'
          : proof.state === 'unresolved'
            ? 'unresolved'
            : 'accepted';
      const includedInGraph = state === 'accepted' || state === 'disputed';
      const drivers = conflict
        ? ['functional relation has multiple current targets', ...proof.drivers]
        : proof.drivers;
      decisions.push({
        edgeKey: candidate.key,
        state,
        includedInGraph,
        factIds,
        explanation: {
          code: conflict
            ? 'GRAPH_EDGE_FUNCTIONAL_CONFLICT'
            : `GRAPH_EDGE_${proof.state.toUpperCase()}`,
          drivers: Object.freeze([...drivers]),
        },
      });
      if (conflict) {
        disputes.push({
          id: `dispute:${edgeDigest.value.slice(0, 24)}`,
          factIds: sortUnique(
            competitors.flatMap((entry) => entry.facts.map(({ fact }) => fact.factId))
          ),
        });
      }
      if (!includedInGraph) continue;
      const counterEvidence = conflict
        ? uniqueEvidence(
            competitors
              .filter((entry) => entry.key !== candidate.key)
              .flatMap((entry) => entry.facts)
          )
        : [];
      edges.push({
        id: `edge:${edgeDigest.value.slice(0, 32)}`,
        relation: candidate.relation.kind,
        semantics: candidate.relation.semantics,
        from: candidate.from.id,
        to: candidate.to.id,
        state,
        facts: factIds,
        derivations: sortUnique(
          candidate.facts.map(({ fact }) => fact.derivation)
        ) as GraphEdge['derivations'],
        proof: {
          policy: candidate.relation.proofPolicy,
          state: conflict ? 'disputed' : proof.state,
          evidence,
          authorities: sortUnique(
            candidate.facts.map(({ fact }) => fact.authority)
          ) as GraphEdge['proof']['authorities'],
          corroborationGroups: evidenceGroups(candidate, normalizedRequest, proof.roots),
          counterEvidence,
          missingRequirements: proof.state === 'insufficient' ? proof.drivers : [],
          evaluatedAt,
          inputDigest: proofInputDigest,
          explanationCode: conflict
            ? 'GRAPH_EDGE_FUNCTIONAL_CONFLICT'
            : `GRAPH_EDGE_${proof.state.toUpperCase()}`,
        },
        freshness: aggregateFreshness(candidate.facts),
        confidence: meanConfidence(candidate.facts),
        explanation: {
          code: conflict ? 'GRAPH_EDGE_FUNCTIONAL_CONFLICT' : 'GRAPH_EDGE_ACCEPTED',
          drivers: Object.freeze([...drivers]),
        },
      });
      if (edges.length > request.policy.maxEdges) {
        return failure('resource-limit', [
          issue(
            'GRAPH_COMPOSITION_EDGE_LIMIT',
            '/policy/maxEdges',
            'Materialized edges exceed the composition policy limit.'
          ),
        ]);
      }
    }

    edges.sort((left, right) => left.id.localeCompare(right.id));
    decisions.sort((left, right) => left.edgeKey.localeCompare(right.edgeKey));
    const uniqueDisputes = [
      ...new Map(disputes.map((item) => [canonical(item.factIds), item])).values(),
    ].sort((left, right) => left.id.localeCompare(right.id));
    const generatedAt = evaluatedAt;
    const generationBase = {
      graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
      architectureEpoch: request.policy.architectureEpoch,
      ontologySetDigest: semanticDigests.ontology,
      proofPolicySetDigest: semanticDigests.proofPolicies,
      inputsDigest: semanticDigests.inputs,
      factSetDigest: semanticDigests.facts,
      providerSetDigest: semanticDigests.providers,
      compositionPolicyDigest: semanticDigests.compositionPolicy,
    };
    const graphPayload = {
      graphVersion: GRAPH_CANONICAL_GRAPH_CONTRACT.version,
      generation: generationBase,
      ontology: [{ id: request.ontology.id, version: request.ontology.version }],
      nodes: prepared.nodes,
      edges,
      assertions: [],
      disputes: uniqueDisputes,
      unresolved: prepared.unresolved,
      diagnostics: prepared.diagnostics,
    };
    const contentDigest = await digest(
      {
        ...graphPayload,
        edges: graphPayload.edges.map((edge) => {
          const proof = {
            policy: edge.proof.policy,
            state: edge.proof.state,
            evidence: edge.proof.evidence,
            corroborationGroups: edge.proof.corroborationGroups,
            counterEvidence: edge.proof.counterEvidence,
            missingRequirements: edge.proof.missingRequirements,
            inputDigest: edge.proof.inputDigest,
            explanationCode: edge.proof.explanationCode,
          };
          return {
            ...edge,
            proof,
            freshness: {
              status: edge.freshness.status,
              ...(edge.freshness.renewal ? { renewal: edge.freshness.renewal } : {}),
            },
          };
        }),
      },
      ports
    );
    const generation: GraphGeneration = {
      reference: {
        id: `generation:${contentDigest.value.slice(0, 32)}`,
        generatedAt,
        contentDigest,
        ...(request.previousGeneration ? { parents: [request.previousGeneration.id] } : {}),
      },
      ...generationBase,
    };
    const graphDraft = {
      contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
      ...graphPayload,
      generation,
    };

    const proofStates: Record<GraphProofState, number> = {
      supported: 0,
      corroborated: 0,
      verified: 0,
      disputed: 0,
      insufficient: 0,
      unresolved: 0,
    };
    for (const edge of edges) proofStates[edge.proof.state] += 1;
    for (const decision of decisions) {
      if (decision.includedInGraph) continue;
      if (decision.state === 'unresolved') proofStates.unresolved += 1;
      else if (decision.state === 'rejected') proofStates.insufficient += 1;
    }
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const qualityDraft: GraphQualityReport = {
      contract: GRAPH_QUALITY_CONTRACT,
      generation: generation.reference,
      integrity:
        prepared.unresolved.length > 0 ||
        uniqueDisputes.length > 0 ||
        decisions.some((decision) => decision.state !== 'accepted')
          ? 'attention'
          : 'pass',
      determinism: 'pass',
      incrementalEquivalence: 'not-assessed',
      coverage: Object.freeze(
        aggregateCoverage(normalizedSources).map((entry) => ({
          dimension: entry.dimension,
          ...(entry.expected && entry.expected > 0
            ? { ratio: Math.min(1, entry.observed / entry.expected) }
            : {}),
          status: (entry.expected === undefined || entry.observed >= entry.expected
            ? 'pass'
            : 'attention') as GraphQualityVerdict,
        }))
      ),
      proofStates,
      unknownZones: Object.freeze(
        uniqueCanonical(normalizedSources.flatMap((source) => source.batch.unknownZones))
      ),
      unsupportedZones: Object.freeze(
        uniqueCanonical(normalizedSources.flatMap((source) => source.batch.unsupportedZones))
      ),
      staleZones: Object.freeze(
        uniqueCanonical(
          normalizedSources.flatMap((source) =>
            source.batch.facts
              .filter((fact) => fact.freshness.status === 'stale')
              .map((fact) => ({ scope: fact.factId, reason: 'fact freshness is stale' }))
          )
        )
      ),
      conflicts: Object.freeze(uniqueDisputes),
      orphans: Object.freeze(prepared.nodes.filter((node) => !connected.has(node.id))),
      providerFailures: Object.freeze(
        uniqueCanonical(
          normalizedSources
            .filter((source) => source.batch.status === 'failed')
            .map((source) => ({
              providerId: source.manifest.id,
              code: 'GRAPH_PROVIDER_BATCH_FAILED',
            }))
        )
      ),
      releaseClaims: Object.freeze([]),
    };

    const graphValidation = validateCanonicalGraph(graphDraft, request.ontology);
    if (!graphValidation.accepted) return failure('composition-failed', graphValidation.issues);
    const qualityValidation = validateGraphQualityReport(qualityDraft);
    if (!qualityValidation.accepted) return failure('composition-failed', qualityValidation.issues);
    const graph = immutableCopy(graphDraft);
    const quality = immutableCopy(qualityDraft);

    return {
      accepted: true,
      value: deepFreeze({
        graph,
        quality,
        decisions: immutableCopy(decisions),
        semanticDigests: immutableCopy(semanticDigests),
      } satisfies GraphCompositionOutput),
      issues: [],
    };
  } catch (error) {
    if (ports.cancellation.aborted) {
      return failure('cancelled', [
        issue('GRAPH_COMPOSITION_CANCELLED', '', 'Composition was cancelled before publication.'),
      ]);
    }
    return failure('composition-failed', [
      issue(
        'GRAPH_COMPOSITION_FAILED',
        '',
        error instanceof Error ? error.message : 'Graph composition failed.'
      ),
    ]);
  }
}
