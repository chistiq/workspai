import type {
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProof,
} from './contracts/workspace-knowledge-graph-contract.js';
import {
  entityMatchesProjectScope,
  knowledgeSearchMatchTerms,
  knowledgeProofMatchesProjectScope,
  searchKnowledgeGraph,
  type WorkspaceKnowledgeSearchOptions,
} from './workspace-knowledge-graph-query.js';
import { hashCanonicalJson } from './workspace-model-hash.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

export const WORKSPACE_GRAPH_SEARCH_VIEW_SCHEMA_VERSION = 'workspace-graph-search-view.v1' as const;
export const DEFAULT_GRAPH_SEARCH_MAX_BYTES = 12 * 1024;
export const MAX_GRAPH_SEARCH_BYTES = 128 * 1024;

export function graphSearchByteBudget(value?: string | number): number {
  if (value === undefined) return DEFAULT_GRAPH_SEARCH_MAX_BYTES;
  if (typeof value === 'string' && !/^\d+$/u.test(value))
    throw new Error('--max-bytes must be an integer.');
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > MAX_GRAPH_SEARCH_BYTES) {
    throw new Error(`--max-bytes must be between 1024 and ${MAX_GRAPH_SEARCH_BYTES}.`);
  }
  return bytes;
}

/** Stable across observation timestamps; includes source content and extractor generations. */
export function workspaceKnowledgeGraphRevision(graph: WorkspaceKnowledgeGraph): string {
  return hashCanonicalJson({
    source: graph.source,
    workspace: graph.workspace,
    entities: graph.entities,
    relations: graph.relations,
    proofs: graph.proofs.map(({ observedAt: _observedAt, ...proof }) => proof),
    providers: graph.providers
      .filter((provider) => provider.id !== 'incremental-project-cache')
      .map(({ id, version }) => ({ id, version }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    quality: graph.quality,
    diagnostics: graph.diagnostics,
  });
}

type CompactProof = Omit<WorkspaceKnowledgeProof, 'detail' | 'observedAt'>;
export type WorkspaceGraphSearchView = {
  schemaVersion: typeof WORKSPACE_GRAPH_SEARCH_VIEW_SCHEMA_VERSION;
  status: 'results';
  query: string;
  scope: { workspace: string; project: string | null; kind: string | null };
  source: { graphHash: string; modelHash: string; inputsHash: string | null; generatedAt: string };
  validation: {
    liveInputsValidated: boolean;
    proofFreshness: { fresh: number; stale: number; unknown: number };
  };
  coverage: {
    completeness: WorkspaceKnowledgeGraph['quality']['completeness'] | null;
    unknownCount: number;
    failedProviders: string[];
    partialProviders: string[];
  };
  diagnostics: WorkspaceKnowledgeGraph['diagnostics'];
  diagnosticSelection?: {
    mode: 'project-and-unscoped' | 'workspace';
    omittedForeign: number;
    retainedUnscoped: number;
    aggregateScope: 'workspace';
  };
  claims: 'discovery-only; lexical matches do not establish implementation bindings, executed tests or verified completion';
  limit: number;
  totalMatches: number;
  retrieval: {
    method: 'lexical';
    status: 'candidates' | 'no-matches';
    nextAction: string;
  };
  omitted: {
    matches: number;
    additionalProofs: number;
    relations: number;
    entityDetails: 'deferred';
  };
  matches: Array<{
    id: string;
    kind: string;
    label: string;
    project?: string;
    role?: string;
    packageManifests: string[];
    reason: { basis: 'lexical' | 'scope'; terms: string[] };
    proofId: string | null;
  }>;
  proofs: CompactProof[];
  delivery?: {
    receiptId: string;
    status: 'full' | 'delta';
    reusedMatchIds: string[];
    reusedFrom: string | null;
    reason:
      | 'receipt-not-found'
      | 'expired'
      | 'source-changed'
      | 'scope-changed'
      | 'ledger-unavailable'
      | null;
  };
  expand: { argv: string[]; idPlaceholder: '<id>'; expectedGraphHash: string };
  budget: { maxBytes: number; usedBytes: number; accounting: 'utf8-json-with-newline' };
};
export type WorkspaceGraphSearchBudgetFailure = {
  schemaVersion: typeof WORKSPACE_GRAPH_SEARCH_VIEW_SCHEMA_VERSION;
  status: 'insufficient-budget';
  requestHash: string;
  graphHash: string;
  budget: { maxBytes: number; requiredBytes: number; accounting: 'utf8-json-with-newline' };
  message: string;
  nextActions: string[];
};

export function graphSearchViewBytes(
  view: WorkspaceGraphSearchView | WorkspaceGraphSearchBudgetFailure
): number {
  return Buffer.byteLength(JSON.stringify(view) + '\n', 'utf8');
}

/** Omit only diagnostics whose complete, resolved references prove foreign ownership. */
function selectDiagnostics(graph: WorkspaceKnowledgeGraph, projectId?: string) {
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const relations = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const entityScope = (id: string): 'relevant' | 'foreign' | 'unknown' => {
    const entity = entities.get(id);
    if (!entity) return 'unknown';
    if (entityMatchesProjectScope(graph, entity, projectId)) return 'relevant';
    return entity.projectId ? 'foreign' : 'unknown';
  };
  let omittedForeign = 0;
  let retainedUnscoped = 0;
  const diagnostics = graph.diagnostics.filter((diagnostic) => {
    const scopes = [
      ...(diagnostic.entityIds ?? []).map(entityScope),
      ...(diagnostic.relationIds ?? []).flatMap((id) => {
        const relation = relations.get(id);
        return relation
          ? [entityScope(relation.from), entityScope(relation.to)]
          : ['unknown' as const];
      }),
    ];
    if (!projectId) return true;
    if (scopes.length > 0 && scopes.every((scope) => scope === 'foreign')) {
      omittedForeign += 1;
      return false;
    }
    if (scopes.length === 0 || scopes.includes('unknown')) retainedUnscoped += 1;
    return true;
  });
  return {
    diagnostics,
    diagnosticSelection: {
      mode: projectId ? ('project-and-unscoped' as const) : ('workspace' as const),
      omittedForeign,
      retainedUnscoped,
      // Freshness, completeness and provider summaries are workspace aggregates.
      aggregateScope: 'workspace' as const,
    },
  };
}

/** Terminal view; no persisted evidence, execution permission or readiness is created. */
export function buildWorkspaceGraphSearchView(
  graph: WorkspaceKnowledgeGraph,
  options: Omit<WorkspaceKnowledgeSearchOptions, 'projection'> & {
    maxBytes?: number;
    liveInputsValidated?: boolean;
    delivery?: {
      receiptId: string;
      previousReceiptId?: string;
      previous?: {
        graphHash: string;
        scope: WorkspaceGraphSearchView['scope'];
        matchDigests: Record<string, string>;
        expiresAt: string;
      };
      previousUnavailable?:
        'receipt-not-found' | 'expired' | 'source-changed' | 'scope-changed' | 'ledger-unavailable';
    };
  }
): WorkspaceGraphSearchView | WorkspaceGraphSearchBudgetFailure {
  const maxBytes = graphSearchByteBudget(options.maxBytes);
  const result = searchKnowledgeGraph(graph, { ...options, projection: 'full' });
  const graphHash = workspaceKnowledgeGraphRevision(graph);
  const byProof = new Map(graph.proofs.map((proof) => [proof.id, proof]));
  const byArtifact = new Map(
    graph.entities
      .filter((entity) => entity.kind === 'file')
      .map((entity) => [String(entity.attributes.artifact), entity])
  );
  const proofs = new Map<string, CompactProof>();
  let additionalProofs = 0;
  const matches = result.entities.map((entity) => {
    const primary = entity.proofIds
      .map((id) => byProof.get(id))
      .find(
        (proof) =>
          proof !== undefined && knowledgeProofMatchesProjectScope(graph, proof, options.projectId)
      );
    if (primary) {
      const { observedAt: _observedAt, detail: _detail, ...proof } = primary;
      proofs.set(proof.id, proof);
    }
    additionalProofs += entity.proofIds.length - (primary ? 1 : 0);
    const file = primary ? byArtifact.get(primary.artifact) : undefined;
    const manifests = entity.attributes.packageManifests ?? file?.attributes.packageManifests;
    const terms = knowledgeSearchMatchTerms(entity, options.query);
    return {
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      ...(entity.projectId ? { project: entity.projectId } : {}),
      ...(typeof entity.attributes.role === 'string' ? { role: entity.attributes.role } : {}),
      packageManifests: Array.isArray(manifests)
        ? manifests.filter((value): value is string => typeof value === 'string')
        : [],
      reason: { basis: terms.length > 0 ? ('lexical' as const) : ('scope' as const), terms },
      proofId: primary?.id ?? null,
    };
  });
  const scope = {
    workspace: graph.workspace.name,
    project: options.projectId ?? null,
    kind: options.kind ?? null,
  };
  const sameScope =
    options.delivery?.previous &&
    options.delivery.previous.graphHash === graphHash &&
    hashCanonicalJson(options.delivery.previous.scope) === hashCanonicalJson(scope);
  const reusedMatchIds: string[] = [];
  const deliveredMatches = sameScope
    ? matches.filter((match) => {
        const proof = match.proofId ? proofs.get(match.proofId) : undefined;
        const digest = hashCanonicalJson({ match, proof: proof ?? null });
        if (options.delivery?.previous?.matchDigests[match.id] !== digest) return true;
        reusedMatchIds.push(match.id);
        return false;
      })
    : matches;
  const deliveredProofIds = new Set(
    deliveredMatches.flatMap((match) => (match.proofId ? [match.proofId] : []))
  );
  const proofFreshness = { fresh: 0, stale: 0, unknown: 0 };
  for (const proof of graph.proofs) proofFreshness[proof.freshness] += 1;
  const view: WorkspaceGraphSearchView = structuredClone({
    schemaVersion: WORKSPACE_GRAPH_SEARCH_VIEW_SCHEMA_VERSION,
    status: 'results',
    query: options.query,
    scope,
    source: {
      graphHash,
      modelHash: graph.source.hash,
      inputsHash: graph.source.inputs?.hash ?? null,
      generatedAt: graph.generatedAt,
    },
    validation: { liveInputsValidated: options.liveInputsValidated === true, proofFreshness },
    coverage: {
      completeness: graph.quality.completeness ?? null,
      unknownCount: graph.quality.unknownCount,
      failedProviders: graph.providers
        .filter((provider) => provider.status === 'failed')
        .map((provider) => provider.id),
      partialProviders: graph.providers
        .filter((provider) => provider.status === 'partial')
        .map((provider) => provider.id),
    },
    ...selectDiagnostics(graph, options.projectId),
    claims:
      'discovery-only; lexical matches do not establish implementation bindings, executed tests or verified completion',
    limit: result.limit,
    totalMatches: result.totalMatches,
    retrieval: {
      method: 'lexical',
      status: result.totalMatches > 0 ? 'candidates' : 'no-matches',
      nextAction:
        result.totalMatches === 0
          ? 'No match is not proof of absence. Use scoped native search or an exact identifier/path.'
          : 'Inspect cited source; expand evidence or narrow the query.',
    },
    omitted: {
      matches: result.totalMatches - matches.length,
      additionalProofs,
      relations: result.relations.length,
      entityDetails: 'deferred',
    },
    matches: deliveredMatches,
    proofs: [...proofs.values()].filter((proof) => deliveredProofIds.has(proof.id)),
    ...(options.delivery
      ? {
          delivery: {
            receiptId: options.delivery.receiptId,
            status: reusedMatchIds.length > 0 ? 'delta' : 'full',
            reusedMatchIds,
            reusedFrom:
              reusedMatchIds.length > 0 ? (options.delivery?.previousReceiptId ?? null) : null,
            reason:
              reusedMatchIds.length > 0 ? null : (options.delivery?.previousUnavailable ?? null),
          },
        }
      : {}),
    expand: {
      argv: [
        'workspace',
        'graph',
        'evidence',
        '<id>',
        '--expected-graph-hash',
        graphHash,
        ...(options.projectId ? ['--scope', `project:${options.projectId}`] : []),
        '--json',
      ],
      idPlaceholder: '<id>',
      expectedGraphHash: graphHash,
    },
    budget: { maxBytes, usedBytes: 0, accounting: 'utf8-json-with-newline' },
  });
  while (view.budget.usedBytes !== graphSearchViewBytes(view))
    view.budget.usedBytes = graphSearchViewBytes(view);
  let requiredBytes = view.budget.usedBytes;
  if (requiredBytes > maxBytes) {
    let previous: number;
    do {
      previous = requiredBytes;
      requiredBytes =
        view.budget.usedBytes + String(requiredBytes).length - String(maxBytes).length;
    } while (previous !== requiredBytes);
  }
  const response =
    requiredBytes <= maxBytes
      ? view
      : {
          schemaVersion: WORKSPACE_GRAPH_SEARCH_VIEW_SCHEMA_VERSION,
          status: 'insufficient-budget' as const,
          requestHash: hashCanonicalJson({
            query: options.query,
            projectId: options.projectId ?? null,
            kind: options.kind ?? null,
            limit: result.limit,
          }),
          graphHash,
          budget: { maxBytes, requiredBytes, accounting: 'utf8-json-with-newline' as const },
          message:
            'Selected matches, evidence and diagnostics cannot fit; no partial discovery view was emitted.',
          nextActions: [
            requiredBytes <= MAX_GRAPH_SEARCH_BYTES
              ? `Increase --max-bytes to at least ${requiredBytes}, or explicitly narrow --limit/--scope/--kind.`
              : 'Use --view full or explicitly narrow the query, --limit/--scope/--kind; required data exceeds the maximum view budget.',
          ],
        };
  assertJsonSchemaContract(
    response,
    'contracts/workspace-intelligence/workspace-graph-search-view.v1.json',
    'Graph search consumer view'
  );
  return response;
}
