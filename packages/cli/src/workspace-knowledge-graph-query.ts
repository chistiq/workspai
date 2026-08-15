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
  projectId?: string;
  limit?: number;
  relationsPerEntity?: number;
  projection?: 'full' | 'agent';
};

export type WorkspaceKnowledgeSearchBudget = {
  mode: 'agent';
  limits: {
    relations: number;
    relatedEntities: number;
    proofs: number;
    proofIdsPerItem: number;
    aliasesPerEntity: number;
    attributeArrayItems: number;
    attributeStringCharacters: number;
  };
  omitted: {
    entities: number;
    relations: number;
    relatedEntities: number;
    proofs: number;
    proofReferences: number;
    aliases: number;
    attributeValues: number;
  };
};

export type WorkspaceKnowledgeSearchResult = {
  schemaVersion: typeof WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION;
  query: string;
  kind: string | null;
  projectId?: string;
  limit: number;
  totalMatches: number;
  truncated: boolean;
  entities: WorkspaceKnowledgeEntity[];
  relatedEntities: Array<Pick<WorkspaceKnowledgeEntity, 'id' | 'kind' | 'label' | 'projectId'>>;
  relations: WorkspaceKnowledgeRelation[];
  proofs: WorkspaceKnowledgeProof[];
  budget?: WorkspaceKnowledgeSearchBudget;
};

const AGENT_SEARCH_LIMITS = {
  relations: 24,
  relatedEntities: 24,
  proofs: 16,
  proofIdsPerItem: 4,
  aliasesPerEntity: 8,
  attributeArrayItems: 8,
  attributeStringCharacters: 256,
} as const;

function agentProofIds(items: Array<{ proofIds: string[] }>): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (
    let offset = 0;
    offset < AGENT_SEARCH_LIMITS.proofIdsPerItem && selected.length < AGENT_SEARCH_LIMITS.proofs;
    offset += 1
  ) {
    for (const item of items) {
      const proofId = item.proofIds[offset];
      if (!proofId || seen.has(proofId)) continue;
      seen.add(proofId);
      selected.push(proofId);
      if (selected.length >= AGENT_SEARCH_LIMITS.proofs) break;
    }
  }
  return selected;
}

function projectAgentEntity(
  entity: WorkspaceKnowledgeEntity,
  includedProofIds: ReadonlySet<string>,
  omitted: WorkspaceKnowledgeSearchBudget['omitted']
): WorkspaceKnowledgeEntity {
  const aliases = entity.identity.aliases.slice(0, AGENT_SEARCH_LIMITS.aliasesPerEntity);
  omitted.aliases += entity.identity.aliases.length - aliases.length;
  const attributes = Object.fromEntries(
    Object.entries(entity.attributes).map(([key, value]) => {
      if (Array.isArray(value)) {
        const bounded = value.slice(0, AGENT_SEARCH_LIMITS.attributeArrayItems);
        omitted.attributeValues += value.length - bounded.length;
        return [key, bounded];
      }
      if (
        typeof value === 'string' &&
        value.length > AGENT_SEARCH_LIMITS.attributeStringCharacters
      ) {
        omitted.attributeValues += 1;
        return [key, value.slice(0, AGENT_SEARCH_LIMITS.attributeStringCharacters)];
      }
      return [key, value];
    })
  ) as WorkspaceKnowledgeEntity['attributes'];
  const proofIds = entity.proofIds
    .filter((proofId) => includedProofIds.has(proofId))
    .slice(0, AGENT_SEARCH_LIMITS.proofIdsPerItem);
  omitted.proofReferences += entity.proofIds.length - proofIds.length;
  return {
    ...entity,
    identity: { ...entity.identity, aliases },
    attributes,
    proofIds,
  };
}

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
  const tokenize = (candidate: string): string[] =>
    normalized(candidate)
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 1);
  return [
    ...new Set([...tokenize(value), ...tokenize(value.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))]),
  ];
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
    // Preserve the original casing until tokenization so identifiers such as
    // CopilotClient remain searchable as both "copilot" and "client".
    labelTokens: new Set(searchTokens(entity.label)),
    identityTokens: new Set(searchTokens(entity.identity.key)),
    aliasTokens: new Set(entity.identity.aliases.flatMap(searchTokens)),
    allTokens: new Set(searchTokens(haystack)),
  };
}

function containsTokenOrPrefix(tokens: ReadonlySet<string>, term: string): boolean {
  return (
    tokens.has(term) || (term.length >= 3 && [...tokens].some((token) => token.startsWith(term)))
  );
}

function documentMatchesTerm(document: SearchDocument, term: string): boolean {
  return (
    containsTokenOrPrefix(document.labelTokens, term) ||
    containsTokenOrPrefix(document.identityTokens, term) ||
    containsTokenOrPrefix(document.aliasTokens, term) ||
    containsTokenOrPrefix(document.allTokens, term)
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
  // Exact canonical/alias resolution must remain stronger than every intent
  // boost combined; otherwise a broad entity kind can displace the entity the
  // caller named verbatim.
  if (label === query || identity === query || aliases.includes(query)) score += 10_000;
  if (label.startsWith(query) || identity.startsWith(query)) score += 250;
  if (haystack.includes(query)) score += 100;
  let matchedTerms = 0;
  for (const term of terms) {
    const weight = inverseDocumentFrequency.get(term) ?? 1;
    const labelMatch = containsTokenOrPrefix(document.labelTokens, term);
    const identityMatch = containsTokenOrPrefix(document.identityTokens, term);
    const aliasMatch = containsTokenOrPrefix(document.aliasTokens, term);
    const anyMatch = documentMatchesTerm(document, term);
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

function matchedSearchTerms(document: SearchDocument, terms: string[]): number {
  return terms.filter((term) => documentMatchesTerm(document, term)).length;
}

const LANGUAGE_QUERY_TERMS = new Map<string, string>([
  ['clojure', 'clojure'],
  ['cplusplus', 'cpp'],
  ['cpp', 'cpp'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['nodejs', 'javascript'],
  ['python', 'python'],
  ['py', 'python'],
  ['go', 'go'],
  ['golang', 'go'],
  ['csharp', 'csharp'],
  ['dotnet', 'csharp'],
  ['dart', 'dart'],
  ['elixir', 'elixir'],
  ['fsharp', 'fsharp'],
  ['java', 'java'],
  ['kotlin', 'kotlin'],
  ['lua', 'lua'],
  ['php', 'php'],
  ['ruby', 'ruby'],
  ['rust', 'rust'],
  ['scala', 'scala'],
  ['svelte', 'svelte'],
  ['swift', 'swift'],
  ['vue', 'vue'],
]);

function requestedLanguages(terms: string[]): Set<string> {
  return new Set(
    terms
      .map((term) => LANGUAGE_QUERY_TERMS.get(term))
      .filter((language): language is string => Boolean(language))
  );
}

function entityLanguage(entity: WorkspaceKnowledgeEntity): string | null {
  const language = entity.attributes.language;
  return typeof language === 'string' ? normalized(language) : null;
}

function projectOverviewScore(entity: WorkspaceKnowledgeEntity): number {
  const priorities: Partial<Record<WorkspaceKnowledgeEntityKind, number>> = {
    project: 1_000,
    service: 900,
    api: 900,
    package: 850,
    endpoint: 800,
    container: 700,
    deployment: 700,
    environment: 650,
    pipeline: 600,
    'test-suite': 550,
    owner: 500,
    decision: 450,
    document: 400,
  };
  return priorities[entity.kind] ?? 0;
}

function architectureIntentScore(
  entity: WorkspaceKnowledgeEntity,
  terms: ReadonlySet<string>
): number {
  const hasLanguageIntent = terms.has('language') || terms.has('languages');
  const hasBindingIntent =
    terms.has('binding') || terms.has('bindings') || terms.has('bridge') || terms.has('bridges');
  const hasDependencyIntent =
    terms.has('dependency') || terms.has('dependencies') || terms.has('depends');
  const hasCoreIntent = terms.has('core') || terms.has('runtime');
  const hasOwnershipIntent =
    terms.has('owner') || terms.has('owners') || terms.has('ownership') || terms.has('maintainer');
  const hasCiIntent =
    terms.has('ci') || terms.has('pipeline') || terms.has('pipelines') || terms.has('workflow');
  const hasDeploymentIntent =
    terms.has('deploy') ||
    terms.has('deployment') ||
    terms.has('infrastructure') ||
    terms.has('container');
  const hasDocumentationIntent =
    terms.has('doc') || terms.has('docs') || terms.has('document') || terms.has('documentation');
  const hasServiceIntent =
    terms.has('service') || terms.has('services') || terms.has('api') || terms.has('rpc');
  const hasSchemaIntent =
    terms.has('schema') ||
    terms.has('schemas') ||
    terms.has('message') ||
    terms.has('protobuf') ||
    terms.has('proto') ||
    terms.has('contract');
  const mechanism =
    typeof entity.attributes.mechanism === 'string' ? normalized(entity.attributes.mechanism) : '';
  const specification =
    typeof entity.attributes.specification === 'string'
      ? normalized(entity.attributes.specification)
      : '';
  const label = normalized(entity.label);
  let score = 0;
  if (hasLanguageIntent && entity.kind === 'language') {
    const fileCount =
      typeof entity.attributes.fileCount === 'number' ? entity.attributes.fileCount : 0;
    score += 900 + Math.min(fileCount, 10_000) / 10;
  }
  if (hasBindingIntent && entity.kind === 'protocol') score += 800;
  if (hasDependencyIntent && entity.kind === 'package') score += 650;
  if (hasCoreIntent && entity.kind === 'package' && /(?:^|[_-])core(?:$|[_-])/u.test(label)) {
    score += 700;
  }
  if (hasCoreIntent && entity.kind === 'protocol' && mechanism.includes('core')) score += 300;
  if (hasOwnershipIntent && entity.kind === 'owner') score += 850;
  if (hasCiIntent && entity.kind === 'pipeline') score += 800;
  if (hasDeploymentIntent && ['deployment', 'container', 'environment'].includes(entity.kind)) {
    score += 775;
  }
  if (hasDocumentationIntent && ['document', 'decision'].includes(entity.kind)) score += 725;
  if (hasServiceIntent && ['api', 'endpoint', 'service'].includes(entity.kind)) score += 700;
  if (
    hasSchemaIntent &&
    (entity.kind === 'schema' ||
      ((entity.kind === 'api' || entity.kind === 'protocol') &&
        (specification.includes('protobuf') || mechanism.includes('protobuf'))))
  ) {
    score += 750;
  }
  return score;
}

function hasBroadArchitectureIntent(terms: ReadonlySet<string>): boolean {
  const dimensions = [
    terms.has('language') || terms.has('languages'),
    terms.has('binding') || terms.has('bindings') || terms.has('bridge') || terms.has('bridges'),
    terms.has('dependency') || terms.has('dependencies') || terms.has('depends'),
    terms.has('core') || terms.has('runtime'),
    terms.has('owner') || terms.has('ownership') || terms.has('maintainer'),
    terms.has('ci') || terms.has('pipeline') || terms.has('workflow'),
    terms.has('deploy') || terms.has('deployment') || terms.has('infrastructure'),
    terms.has('doc') || terms.has('docs') || terms.has('documentation'),
    terms.has('service') || terms.has('api') || terms.has('rpc'),
    terms.has('schema') || terms.has('protobuf') || terms.has('proto') || terms.has('contract'),
  ];
  return dimensions.filter(Boolean).length >= 3;
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
  const rawTerms = [...new Set(searchTokens(options.query))];
  const scopeTerms = new Set(searchTokens(options.projectId ?? ''));
  const contentTerms = options.projectId
    ? rawTerms.filter((term) => !scopeTerms.has(term))
    : rawTerms;
  const scopeOnlyQuery = Boolean(
    options.projectId && rawTerms.length > 0 && contentTerms.length === 0
  );
  const meaningfulTerms = contentTerms.filter((term) => !NATURAL_LANGUAGE_STOPWORDS.has(term));
  const terms = meaningfulTerms.length > 0 ? meaningfulTerms : contentTerms;
  const languages = requestedLanguages(terms);
  const termSet = new Set(terms);
  const broadArchitectureIntent = hasBroadArchitectureIntent(termSet);
  const minimumTermMatches =
    terms.length <= 1 ? terms.length : Math.min(3, Math.ceil(terms.length / 3));
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 12), 100));
  const relationsPerEntity = Math.max(0, Math.min(Math.trunc(options.relationsPerEntity ?? 4), 20));
  const scopedSharedEntityIds = new Set<string>();
  if (options.projectId) {
    const projectEntityIds = new Set(
      graph.entities
        .filter(
          (entity) =>
            entity.kind === 'project' &&
            (entity.projectId === options.projectId || entity.label === options.projectId)
        )
        .map((entity) => entity.id)
    );
    for (const relation of graph.relations) {
      if (projectEntityIds.has(relation.from)) scopedSharedEntityIds.add(relation.to);
      if (projectEntityIds.has(relation.to)) scopedSharedEntityIds.add(relation.from);
    }
  }
  const documents = graph.entities
    .filter(
      (entity) =>
        (!options.kind || entity.kind === options.kind) &&
        (!options.projectId ||
          entity.projectId === options.projectId ||
          (entity.projectId === undefined && scopedSharedEntityIds.has(entity.id)))
    )
    .map(searchDocument);
  const inverseDocumentFrequency = new Map(
    terms.map((term) => {
      const documentFrequency = documents.filter((document) =>
        documentMatchesTerm(document, term)
      ).length;
      return [term, Math.log((documents.length + 1) / (documentFrequency + 1)) + 1] as const;
    })
  );
  const ranked = documents
    .map((document) => {
      const matchedTerms = matchedSearchTerms(document, terms);
      const language = entityLanguage(document.entity);
      const languageBoost = language && languages.has(language) ? 400 : 0;
      const intentScore = architectureIntentScore(document.entity, termSet);
      return {
        entity: document.entity,
        matchedTerms,
        intentScore,
        score: scopeOnlyQuery
          ? projectOverviewScore(document.entity)
          : searchScore(document, query, terms, inverseDocumentFrequency) +
            languageBoost +
            intentScore,
      };
    })
    .filter((entry) => {
      const language = entityLanguage(entry.entity);
      return (
        (languages.size === 0 || language === null || languages.has(language)) &&
        (query.length === 0 ||
          (entry.score > 0 &&
            (scopeOnlyQuery ||
              entry.matchedTerms >= minimumTermMatches ||
              (entry.intentScore > 0 && (broadArchitectureIntent || terms.length <= 2)))))
      );
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entity.kind.localeCompare(b.entity.kind) ||
        a.entity.label.localeCompare(b.entity.label)
    );
  const selectionPool = broadArchitectureIntent
    ? (() => {
        const selected: typeof ranked = [];
        const deferred: typeof ranked = [];
        const perKind = new Map<WorkspaceKnowledgeEntityKind, number>();
        const selectedLabels = new Set<string>();
        for (const entry of ranked) {
          const count = perKind.get(entry.entity.kind) ?? 0;
          const label = normalized(entry.entity.label);
          if (count < 2 && !selectedLabels.has(label)) {
            selected.push(entry);
            perKind.set(entry.entity.kind, count + 1);
            selectedLabels.add(label);
          } else {
            deferred.push(entry);
          }
        }
        return [...selected, ...deferred];
      })()
    : ranked;
  const matchedEntities = selectionPool.slice(0, limit).map((entry) => entry.entity);
  const selectedIds = new Set(matchedEntities.map((entity) => entity.id));
  const relationCounts = new Map<string, number>();
  const relationCandidates = graph.relations.filter((relation) => {
    const selected = selectedIds.has(relation.from) || selectedIds.has(relation.to);
    if (!selected) return false;
    const owner = selectedIds.has(relation.from) ? relation.from : relation.to;
    const count = relationCounts.get(owner) ?? 0;
    if (count >= relationsPerEntity) return false;
    relationCounts.set(owner, count + 1);
    return true;
  });
  const agentProjection = options.projection === 'agent';
  const relationSources = agentProjection
    ? relationCandidates.slice(0, AGENT_SEARCH_LIMITS.relations)
    : relationCandidates;
  const index = queryIndex(graph);
  const relatedIds = new Set(
    relationSources
      .flatMap((relation) => [relation.from, relation.to])
      .filter((id) => !selectedIds.has(id))
  );
  const allRelatedEntities = [...relatedIds]
    .map((id) => index.entitiesById.get(id))
    .filter((entity): entity is WorkspaceKnowledgeEntity => Boolean(entity))
    .map(({ id, kind, label, projectId }) => ({
      id,
      kind,
      label,
      ...(projectId ? { projectId } : {}),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  const relatedEntities = agentProjection
    ? allRelatedEntities.slice(0, AGENT_SEARCH_LIMITS.relatedEntities)
    : allRelatedEntities;
  const allProofIds = new Set([
    ...matchedEntities.flatMap((entity) => entity.proofIds),
    ...relationSources.flatMap((relation) => relation.proofIds),
  ]);
  const selectedAgentProofIds = agentProjection
    ? agentProofIds([...matchedEntities, ...relationSources])
    : [...allProofIds];
  const includedProofIds = new Set(selectedAgentProofIds);
  const omitted: WorkspaceKnowledgeSearchBudget['omitted'] = {
    entities: ranked.length - matchedEntities.length,
    relations: relationCandidates.length - relationSources.length,
    relatedEntities: allRelatedEntities.length - relatedEntities.length,
    proofs: allProofIds.size - includedProofIds.size,
    proofReferences: 0,
    aliases: 0,
    attributeValues: 0,
  };
  const entities = agentProjection
    ? matchedEntities.map((entity) => projectAgentEntity(entity, includedProofIds, omitted))
    : matchedEntities;
  const relations = agentProjection
    ? relationSources.map((relation) => {
        const proofIds = relation.proofIds
          .filter((proofId) => includedProofIds.has(proofId))
          .slice(0, AGENT_SEARCH_LIMITS.proofIdsPerItem);
        omitted.proofReferences += relation.proofIds.length - proofIds.length;
        return { ...relation, proofIds };
      })
    : relationSources;
  const proofs = [...includedProofIds]
    .map((id) => index.proofsById.get(id))
    .filter((proof): proof is WorkspaceKnowledgeProof => Boolean(proof))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
    query: options.query,
    kind: options.kind ?? null,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    limit,
    totalMatches: ranked.length,
    truncated:
      ranked.length > entities.length ||
      (agentProjection && Object.values(omitted).some((count) => count > 0)),
    entities,
    relatedEntities,
    relations,
    proofs,
    ...(agentProjection
      ? {
          budget: {
            mode: 'agent' as const,
            limits: { ...AGENT_SEARCH_LIMITS },
            omitted,
          },
        }
      : {}),
  };
}
