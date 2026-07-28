import type {
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeEntityKind,
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProof,
  WorkspaceKnowledgeRelation,
} from './contracts/workspace-knowledge-graph-contract.js';

export const WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION = 'workspace-knowledge-search.v1' as const;

export type WorkspaceKnowledgeResolvedTarget =
  | { found: true; targetType: 'entity'; entity: WorkspaceKnowledgeEntity }
  | { found: true; targetType: 'relation'; relation: WorkspaceKnowledgeRelation }
  | { found: false; query: string; candidates: string[] };

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

type WorkspaceKnowledgeQueryIndex = {
  entitiesById: Map<string, WorkspaceKnowledgeEntity>;
  relationsById: Map<string, WorkspaceKnowledgeRelation>;
  entitiesByAlias: Map<string, WorkspaceKnowledgeEntity[]>;
  proofsById: Map<string, WorkspaceKnowledgeProof>;
  adjacency: Map<string, WorkspaceKnowledgePathHop[]>;
};

/** Query indexes are scoped to an immutable graph object and discarded automatically. */
const QUERY_INDEX_CACHE = new WeakMap<WorkspaceKnowledgeGraph, WorkspaceKnowledgeQueryIndex>();

function queryIndex(graph: WorkspaceKnowledgeGraph): WorkspaceKnowledgeQueryIndex {
  const cached = QUERY_INDEX_CACHE.get(graph);
  if (cached) return cached;
  const relationsById = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const entitiesById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const proofsById = new Map(graph.proofs.map((proof) => [proof.id, proof]));
  const entitiesByAlias = new Map<string, WorkspaceKnowledgeEntity[]>();
  const adjacency = new Map<string, WorkspaceKnowledgePathHop[]>();
  const appendHop = (id: string, hop: WorkspaceKnowledgePathHop): void => {
    const list = adjacency.get(id) ?? [];
    list.push(hop);
    adjacency.set(id, list);
  };
  for (const entity of graph.entities) {
    const aliases = [
      entity.id,
      entity.label,
      entity.identity.key,
      ...(entity.kind === 'project' && entity.projectId ? [entity.projectId] : []),
      ...entity.identity.aliases,
    ];
    for (const alias of new Set(aliases.map(normalized))) {
      const matches = entitiesByAlias.get(alias) ?? [];
      matches.push(entity);
      entitiesByAlias.set(alias, matches);
    }
  }
  for (const relation of graph.relations) {
    appendHop(relation.from, {
      from: relation.from,
      to: relation.to,
      relationId: relation.id,
      kind: relation.kind,
      direction: 'forward',
      proofIds: relation.proofIds,
    });
    appendHop(relation.to, {
      from: relation.to,
      to: relation.from,
      relationId: relation.id,
      kind: relation.kind,
      direction: 'reverse',
      proofIds: relation.proofIds,
    });
  }
  for (const matches of entitiesByAlias.values()) matches.sort((a, b) => a.id.localeCompare(b.id));
  for (const hops of adjacency.values()) {
    hops.sort((a, b) => a.to.localeCompare(b.to) || a.relationId.localeCompare(b.relationId));
  }
  const index = { entitiesById, relationsById, entitiesByAlias, proofsById, adjacency };
  QUERY_INDEX_CACHE.set(graph, index);
  return index;
}

export function resolveKnowledgeTarget(
  graph: WorkspaceKnowledgeGraph,
  query: string
): WorkspaceKnowledgeResolvedTarget {
  const index = queryIndex(graph);
  const exactRelation = index.relationsById.get(query);
  if (exactRelation) return { found: true, targetType: 'relation', relation: exactRelation };
  const needle = normalized(query);
  const matches = index.entitiesByAlias.get(needle) ?? [];
  if (matches.length === 1) return { found: true, targetType: 'entity', entity: matches[0] };
  return {
    found: false,
    query,
    candidates: matches.map((entity) => entity.id).sort(),
  };
}

export type WorkspaceKnowledgeEvidenceQuery = {
  query: string;
  found: boolean;
  target: WorkspaceKnowledgeEntity | WorkspaceKnowledgeRelation | null;
  proofs: WorkspaceKnowledgeProof[];
  candidates: string[];
};

export function queryKnowledgeEvidence(
  graph: WorkspaceKnowledgeGraph,
  query: string
): WorkspaceKnowledgeEvidenceQuery {
  const resolved = resolveKnowledgeTarget(graph, query);
  if (!resolved.found)
    return { query, found: false, target: null, proofs: [], candidates: resolved.candidates };
  const target = resolved.targetType === 'entity' ? resolved.entity : resolved.relation;
  const proofIds = new Set(target.proofIds);
  return {
    query,
    found: true,
    target,
    candidates: [],
    proofs: [...proofIds]
      .map((id) => queryIndex(graph).proofsById.get(id))
      .filter((proof): proof is WorkspaceKnowledgeProof => Boolean(proof))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export type WorkspaceKnowledgePathHop = {
  from: string;
  to: string;
  relationId: string;
  kind: WorkspaceKnowledgeRelation['kind'];
  direction: 'forward' | 'reverse';
  proofIds: string[];
};

export type WorkspaceKnowledgePathQuery = {
  from: string;
  to: string;
  found: boolean;
  resolvedFrom: string | null;
  resolvedTo: string | null;
  entityPath: string[];
  hops: WorkspaceKnowledgePathHop[];
  proofs: WorkspaceKnowledgeProof[];
};

export function queryKnowledgePath(
  graph: WorkspaceKnowledgeGraph,
  fromQuery: string,
  toQuery: string
): WorkspaceKnowledgePathQuery {
  const from = resolveKnowledgeTarget(graph, fromQuery);
  const to = resolveKnowledgeTarget(graph, toQuery);
  if (!from.found || from.targetType !== 'entity' || !to.found || to.targetType !== 'entity') {
    return {
      from: fromQuery,
      to: toQuery,
      found: false,
      resolvedFrom: from.found && from.targetType === 'entity' ? from.entity.id : null,
      resolvedTo: to.found && to.targetType === 'entity' ? to.entity.id : null,
      entityPath: [],
      hops: [],
      proofs: [],
    };
  }
  const index = queryIndex(graph);
  const queue = [from.entity.id];
  const previous = new Map<string, WorkspaceKnowledgePathHop>();
  const visited = new Set(queue);
  let head = 0;
  while (head < queue.length && !visited.has(to.entity.id)) {
    const current = queue[head++];
    for (const hop of index.adjacency.get(current) ?? []) {
      if (visited.has(hop.to)) continue;
      visited.add(hop.to);
      previous.set(hop.to, hop);
      queue.push(hop.to);
    }
  }
  if (!visited.has(to.entity.id)) {
    return {
      from: fromQuery,
      to: toQuery,
      found: false,
      resolvedFrom: from.entity.id,
      resolvedTo: to.entity.id,
      entityPath: [],
      hops: [],
      proofs: [],
    };
  }
  const hops: WorkspaceKnowledgePathHop[] = [];
  let current = to.entity.id;
  while (current !== from.entity.id) {
    const hop = previous.get(current);
    if (!hop) break;
    hops.push(hop);
    current = hop.from;
  }
  hops.reverse();
  const proofIds = new Set(hops.flatMap((hop) => hop.proofIds));
  return {
    from: fromQuery,
    to: toQuery,
    found: true,
    resolvedFrom: from.entity.id,
    resolvedTo: to.entity.id,
    entityPath: [from.entity.id, ...hops.map((hop) => hop.to)],
    hops,
    proofs: [...proofIds]
      .map((id) => index.proofsById.get(id))
      .filter((proof): proof is WorkspaceKnowledgeProof => Boolean(proof))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function queryKnowledgeEntities(
  graph: WorkspaceKnowledgeGraph,
  kind?: string
): WorkspaceKnowledgeEntity[] {
  return graph.entities
    .filter((entity) => !kind || entity.kind === (kind as WorkspaceKnowledgeEntityKind))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

export type WorkspaceKnowledgeSearchOptions = {
  query: string;
  kind?: string;
  limit?: number;
  relationsPerEntity?: number;
};

export type WorkspaceKnowledgeSearchResult = {
  schemaVersion: typeof WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION;
  query: string;
  kind: string | null;
  limit: number;
  totalMatches: number;
  truncated: boolean;
  entities: WorkspaceKnowledgeEntity[];
  relatedEntities: Array<Pick<WorkspaceKnowledgeEntity, 'id' | 'kind' | 'label' | 'projectId'>>;
  relations: WorkspaceKnowledgeRelation[];
  proofs: WorkspaceKnowledgeProof[];
};

function searchableEntityText(entity: WorkspaceKnowledgeEntity): string {
  const attributes = Object.values(entity.attributes).flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
  return [
    entity.id,
    entity.kind,
    entity.label,
    entity.projectId ?? '',
    entity.identity.key,
    ...entity.identity.aliases,
    ...attributes.map((value) => String(value ?? '')),
  ]
    .join(' ')
    .toLowerCase();
}

const NATURAL_LANGUAGE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'by',
  'can',
  'check',
  'could',
  'did',
  'do',
  'does',
  'find',
  'for',
  'from',
  'give',
  'had',
  'has',
  'have',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'might',
  'of',
  'on',
  'or',
  'our',
  'show',
  'should',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'tell',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

function searchTokens(value: string): string[] {
  return normalized(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 1);
}

type SearchDocument = {
  entity: WorkspaceKnowledgeEntity;
  label: string;
  identity: string;
  aliases: string[];
  haystack: string;
  labelTokens: Set<string>;
  identityTokens: Set<string>;
  aliasTokens: Set<string>;
  allTokens: Set<string>;
};

function searchDocument(entity: WorkspaceKnowledgeEntity): SearchDocument {
  const label = normalized(entity.label);
  const identity = normalized(entity.identity.key);
  const aliases = entity.identity.aliases.map(normalized);
  const haystack = searchableEntityText(entity);
  return {
    entity,
    label,
    identity,
    aliases,
    haystack,
    labelTokens: new Set(searchTokens(label)),
    identityTokens: new Set(searchTokens(identity)),
    aliasTokens: new Set(aliases.flatMap(searchTokens)),
    allTokens: new Set(searchTokens(haystack)),
  };
}

function containsTokenOrPrefix(tokens: ReadonlySet<string>, term: string): boolean {
  return (
    tokens.has(term) || (term.length >= 3 && [...tokens].some((token) => token.startsWith(term)))
  );
}

function searchScore(
  document: SearchDocument,
  query: string,
  terms: string[],
  inverseDocumentFrequency: ReadonlyMap<string, number>
): number {
  const { label, identity, aliases, haystack } = document;
  let score = 0;
  if (label === query || identity === query || aliases.includes(query)) score += 1_000;
  if (label.startsWith(query) || identity.startsWith(query)) score += 250;
  if (haystack.includes(query)) score += 100;
  let matchedTerms = 0;
  for (const term of terms) {
    const weight = inverseDocumentFrequency.get(term) ?? 1;
    const labelMatch = containsTokenOrPrefix(document.labelTokens, term);
    const identityMatch = containsTokenOrPrefix(document.identityTokens, term);
    const aliasMatch = containsTokenOrPrefix(document.aliasTokens, term);
    const anyMatch = containsTokenOrPrefix(document.allTokens, term);
    if (anyMatch) matchedTerms += 1;
    if (label === term) score += 80 * weight;
    else if (labelMatch) score += 36 * weight;
    if (identityMatch) score += 24 * weight;
    if (aliasMatch) score += 20 * weight;
    if (anyMatch) score += 10 * weight;
  }
  if (terms.length > 0) score += (matchedTerms / terms.length) * 120;
  return score;
}

/**
 * Produces a bounded, proof-carrying retrieval payload for agents and MCP
 * clients. This deliberately does not return the entire graph.
 */
export function searchKnowledgeGraph(
  graph: WorkspaceKnowledgeGraph,
  options: WorkspaceKnowledgeSearchOptions
): WorkspaceKnowledgeSearchResult {
  const query = normalized(options.query);
  const rawTerms = [...new Set(searchTokens(query))];
  const meaningfulTerms = rawTerms.filter((term) => !NATURAL_LANGUAGE_STOPWORDS.has(term));
  const terms = meaningfulTerms.length > 0 ? meaningfulTerms : rawTerms;
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 12), 100));
  const relationsPerEntity = Math.max(0, Math.min(Math.trunc(options.relationsPerEntity ?? 4), 20));
  const documents = graph.entities
    .filter((entity) => !options.kind || entity.kind === options.kind)
    .map(searchDocument);
  const inverseDocumentFrequency = new Map(
    terms.map((term) => {
      const documentFrequency = documents.filter((document) =>
        containsTokenOrPrefix(document.allTokens, term)
      ).length;
      return [term, Math.log((documents.length + 1) / (documentFrequency + 1)) + 1] as const;
    })
  );
  const ranked = documents
    .map((document) => ({
      entity: document.entity,
      score: searchScore(document, query, terms, inverseDocumentFrequency),
    }))
    .filter((entry) => query.length === 0 || entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entity.kind.localeCompare(b.entity.kind) ||
        a.entity.label.localeCompare(b.entity.label)
    );
  const entities = ranked.slice(0, limit).map((entry) => entry.entity);
  const selectedIds = new Set(entities.map((entity) => entity.id));
  const relationCounts = new Map<string, number>();
  const relations = graph.relations.filter((relation) => {
    const selected = selectedIds.has(relation.from) || selectedIds.has(relation.to);
    if (!selected) return false;
    const owner = selectedIds.has(relation.from) ? relation.from : relation.to;
    const count = relationCounts.get(owner) ?? 0;
    if (count >= relationsPerEntity) return false;
    relationCounts.set(owner, count + 1);
    return true;
  });
  const index = queryIndex(graph);
  const relatedIds = new Set(
    relations
      .flatMap((relation) => [relation.from, relation.to])
      .filter((id) => !selectedIds.has(id))
  );
  const relatedEntities = [...relatedIds]
    .map((id) => index.entitiesById.get(id))
    .filter((entity): entity is WorkspaceKnowledgeEntity => Boolean(entity))
    .map(({ id, kind, label, projectId }) => ({
      id,
      kind,
      label,
      ...(projectId ? { projectId } : {}),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  const proofIds = new Set([
    ...entities.flatMap((entity) => entity.proofIds),
    ...relations.flatMap((relation) => relation.proofIds),
  ]);
  const proofs = [...proofIds]
    .map((id) => index.proofsById.get(id))
    .filter((proof): proof is WorkspaceKnowledgeProof => Boolean(proof))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
    query: options.query,
    kind: options.kind ?? null,
    limit,
    totalMatches: ranked.length,
    truncated: ranked.length > entities.length,
    entities,
    relatedEntities,
    relations,
    proofs,
  };
}
