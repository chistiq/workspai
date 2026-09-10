import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';

import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import { validateGraphBindingProfile, validateGraphQuery } from '../conformance/query.js';
import {
  GRAPH_EXECUTABLE_QUERY_STRATEGIES,
  GRAPH_QUERY_CONTRACT,
  GRAPH_QUERY_RESULT_CONTRACT,
  GRAPH_RETRIEVAL_PLAN_CONTRACT,
  type GraphBindingProfile,
  type GraphCanonicalGraph,
  type GraphDiagnostic,
  type GraphEdge,
  type GraphEntityReference,
  type GraphExecutableQueryStrategy,
  type GraphNormalizedQuery,
  type GraphOperationalRiskResult,
  type GraphPath,
  type GraphProofState,
  type GraphQuery,
  type GraphQueryBudget,
  type GraphQueryExecutionResult,
  type GraphQueryKind,
  type GraphQueryResult,
  type GraphRetrievalCandidate,
} from '../contracts/index.js';
import type { GraphDigestPort } from '../ports/index.js';
import {
  lookupGraphQueryCache,
  publishGraphQueryCache,
  type GraphQueryCacheLookup,
  type GraphQueryCacheRequest,
} from './query-cache.js';

export interface GraphQueryOptions {
  readonly bindingProfiles?: readonly GraphBindingProfile[];
  readonly cache?: GraphQueryCacheRequest;
}

const DEFAULT_BUDGET: GraphQueryBudget = Object.freeze({
  maxDepth: 4,
  maxNodes: 500,
  maxEdges: 1_000,
  maxEvidence: 200,
});
const MAX_BUDGET: GraphQueryBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxEdges: 500_000,
  maxEvidence: 100_000,
});
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1_000;
const MAX_PENDING_PATHS = 50_000;
const QUERY_PROFILE: WisContractReference = Object.freeze({
  id: 'workspai.graph.query.standard',
  version: '0.1.0-candidate',
});
const UTILITY_PROFILE: WisContractReference = Object.freeze({
  id: 'workspai.graph.retrieval-utility.declared-baseline',
  version: '0.1.0-candidate',
});

const PROOF_RANK: Readonly<Record<GraphProofState, number>> = Object.freeze({
  unresolved: 0,
  insufficient: 0,
  disputed: 0,
  supported: 1,
  corroborated: 2,
  verified: 3,
});

const DEFAULT_RELATIONS: Readonly<Record<GraphQueryKind, readonly string[]>> = Object.freeze({
  dependencies: Object.freeze(['depends-on', 'imports', 'requires']),
  owners: Object.freeze(['owned-by', 'reviewed-by']),
  impact: Object.freeze([
    'calls',
    'consumes',
    'depends-on',
    'imports',
    'invalidates',
    'produces',
    'requires',
    'routes-to',
  ]),
  'entry-points': Object.freeze([]),
  related: Object.freeze([]),
  cycles: Object.freeze(['calls', 'depends-on', 'imports', 'requires']),
  evidence: Object.freeze([]),
  path: Object.freeze([]),
  bindings: Object.freeze([]),
  'operational-risk': Object.freeze([
    'blocks',
    'calls',
    'depends-on',
    'invalidates',
    'requires',
    'routes-to',
  ]),
  'contract-topology': Object.freeze([
    'declares',
    'depends-on',
    'exposes',
    'implements',
    'requires',
    'verified-by',
  ]),
  'architecture-conformance': Object.freeze([
    'blocks',
    'constrained-by',
    'contains',
    'depends-on',
    'imports',
    'requires',
  ]),
});

function failure(
  code: 'invalid-query' | 'resource-limit' | 'unsupported',
  issueCode: string,
  path: string,
  message: string
): GraphQueryExecutionResult<never> {
  return { accepted: false, code, issues: [{ code: issueCode, path, message }] };
}

function canonical(value: unknown): string {
  const normalized = canonicalizeGraphValue(value);
  if (!normalized.accepted) throw new Error('Query value is not canonically serializable.');
  return normalized.value;
}

function isExecutableQueryStrategy(strategy: string): strategy is GraphExecutableQueryStrategy {
  return (GRAPH_EXECUTABLE_QUERY_STRATEGIES as readonly string[]).includes(strategy);
}

function selectedStrategy(query: GraphQuery): GraphExecutableQueryStrategy {
  if (query.strategy && isExecutableQueryStrategy(query.strategy)) return query.strategy;
  if (['evidence', 'owners', 'entry-points'].includes(query.kind)) return 'direct';
  if (['operational-risk', 'bindings', 'architecture-conformance'].includes(query.kind))
    return 'hybrid';
  return 'graph';
}

export function normalizeGraphQuery(query: GraphQuery): GraphNormalizedQuery {
  const strategy = selectedStrategy(query);
  const requestedDepth = query.budget?.maxDepth ?? DEFAULT_BUDGET.maxDepth;
  const budget: GraphQueryBudget = {
    maxDepth: strategy === 'direct' ? 1 : requestedDepth,
    maxNodes: query.budget?.maxNodes ?? DEFAULT_BUDGET.maxNodes,
    maxEdges: query.budget?.maxEdges ?? DEFAULT_BUDGET.maxEdges,
    maxEvidence: query.budget?.maxEvidence ?? DEFAULT_BUDGET.maxEvidence,
  };
  return Object.freeze({
    ...query,
    direction: query.direction ?? (query.kind === 'impact' ? 'incoming' : 'outgoing'),
    relations: Object.freeze(
      [...new Set(query.relations ?? DEFAULT_RELATIONS[query.kind])].sort((a, b) =>
        a.localeCompare(b)
      )
    ),
    minimumProof: query.minimumProof ?? 'supported',
    includeDisputed: query.includeDisputed ?? false,
    strategy,
    budget: Object.freeze(budget),
    page: Object.freeze({
      ...(query.page?.cursor ? { cursor: query.page.cursor } : {}),
      size: query.page?.size ?? DEFAULT_PAGE_SIZE,
    }),
  });
}

function validateNormalizedQuery(
  query: GraphNormalizedQuery
): GraphQueryExecutionResult<never> | null {
  if (
    query.contract.id !== GRAPH_QUERY_CONTRACT.id ||
    query.contract.version !== GRAPH_QUERY_CONTRACT.version
  )
    return failure(
      'invalid-query',
      'GRAPH_QUERY_CONTRACT_UNSUPPORTED',
      '/contract',
      'Query contract is unsupported.'
    );
  if (
    !query.subject &&
    !['entry-points', 'cycles', 'contract-topology', 'architecture-conformance'].includes(
      query.kind
    )
  )
    return failure(
      'invalid-query',
      'GRAPH_QUERY_SUBJECT_REQUIRED',
      '/subject',
      'This query kind requires a subject.'
    );
  if (query.kind === 'path' && !query.target)
    return failure(
      'invalid-query',
      'GRAPH_QUERY_TARGET_REQUIRED',
      '/target',
      'Path queries require a target.'
    );
  for (const [key, maximum] of Object.entries(MAX_BUDGET) as [keyof GraphQueryBudget, number][]) {
    const value = query.budget[key];
    if (!Number.isInteger(value) || value < 1 || value > maximum)
      return failure(
        'resource-limit',
        'GRAPH_QUERY_BUDGET_INVALID',
        `/budget/${key}`,
        `Query ${key} exceeds its fixed safety bound.`
      );
  }
  if (!Number.isInteger(query.page.size) || query.page.size < 1 || query.page.size > MAX_PAGE_SIZE)
    return failure(
      'resource-limit',
      'GRAPH_QUERY_PAGE_SIZE_INVALID',
      '/page/size',
      'Page size exceeds its fixed safety bound.'
    );
  if (query.page.cursor !== undefined && !/^offset:\d+$/u.test(query.page.cursor))
    return failure(
      'invalid-query',
      'GRAPH_QUERY_CURSOR_INVALID',
      '/page/cursor',
      'Cursor is not a canonical Graph offset cursor.'
    );
  return null;
}

function edgeAllowed(edge: GraphEdge, query: GraphNormalizedQuery): boolean {
  if (edge.state === 'rejected' || edge.state === 'unresolved') return false;
  if (edge.state === 'disputed' || edge.proof.state === 'disputed') {
    if (!query.includeDisputed) return false;
  } else if (PROOF_RANK[edge.proof.state] < PROOF_RANK[query.minimumProof]) return false;
  return query.relations.length === 0 || query.relations.includes(edge.relation);
}

function stricterProof(left: GraphProofState, right: GraphProofState): GraphProofState {
  return PROOF_RANK[left] >= PROOF_RANK[right] ? left : right;
}

function validateCanonicalGraphForQuery(
  graph: GraphCanonicalGraph
): GraphQueryExecutionResult<never> | null {
  const nodeIds = new Set<string>();
  for (const [index, node] of graph.nodes.entries()) {
    if (nodeIds.has(node.id))
      return failure(
        'invalid-query',
        'GRAPH_QUERY_GRAPH_NODE_DUPLICATE',
        `/graph/nodes/${index}/id`,
        'The selected generation contains a duplicate node identity.'
      );
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id))
      return failure(
        'invalid-query',
        'GRAPH_QUERY_GRAPH_EDGE_DUPLICATE',
        `/graph/edges/${index}/id`,
        'The selected generation contains a duplicate edge identity.'
      );
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      return failure(
        'invalid-query',
        'GRAPH_QUERY_GRAPH_EDGE_UNRESOLVED',
        `/graph/edges/${index}`,
        'The selected generation contains an edge with an unresolved endpoint.'
      );
  }
  return null;
}

function nextEntity(
  edge: GraphEdge,
  current: string,
  direction: GraphNormalizedQuery['direction']
): string | undefined {
  if (direction !== 'incoming' && edge.from === current) return edge.to;
  if (direction !== 'outgoing' && edge.to === current) return edge.from;
  return undefined;
}

function semanticsOf(hops: readonly GraphEdge[]): GraphPath['semantics'] {
  const semantics = new Set(hops.map((edge) => edge.semantics));
  return semantics.size === 1 ? (hops[0]?.semantics ?? 'mixed') : 'mixed';
}

function proofSummary(hops: readonly GraphEdge[]): GraphPath['proofSummary'] {
  const summary: Record<GraphProofState, number> = {
    supported: 0,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  };
  for (const edge of hops) summary[edge.proof.state] += 1;
  return summary;
}

function toPath(
  graph: GraphCanonicalGraph,
  nodeById: ReadonlyMap<string, GraphEntityReference>,
  nodeIds: readonly string[],
  edges: readonly GraphEdge[]
): GraphPath {
  return {
    pathId: `path:${nodeIds.join('>')}:${edges.map((edge) => edge.id).join('>')}`,
    nodes: nodeIds
      .map((id) => nodeById.get(id))
      .filter((value): value is GraphEntityReference => Boolean(value)),
    hops: edges.map((edge, index) => ({
      edgeId: edge.id,
      from: nodeById.get(nodeIds[index] ?? edge.from) as GraphEntityReference,
      to: nodeById.get(nodeIds[index + 1] ?? edge.to) as GraphEntityReference,
      relation: edge.relation,
      semantics: edge.semantics,
      traversal: edge.from === nodeIds[index] ? 'outgoing' : 'incoming',
      decision: edge.state,
      derivations: edge.derivations,
      proof: edge.proof,
      evidence: edge.proof.evidence,
      freshness: edge.freshness,
      confidence: edge.confidence,
    })),
    sourceGeneration: graph.generation.reference,
    semantics: semanticsOf(edges),
    proofSummary: proofSummary(edges),
    unknownBoundaries: [],
  };
}

interface TraversalOutput {
  readonly paths: readonly GraphPath[];
  readonly visitedNodes: number;
  readonly visitedEdges: number;
  readonly truncationReasons: Set<'depth' | 'nodes' | 'edges'>;
}

function traverse(
  graph: GraphCanonicalGraph,
  query: GraphNormalizedQuery,
  nodeById: ReadonlyMap<string, GraphEntityReference>,
  edges: readonly GraphEdge[]
): TraversalOutput {
  const starts = query.subject
    ? [query.subject]
    : [...nodeById.keys()].sort((a, b) => a.localeCompare(b));
  const queue = starts.map((id) => ({ nodeIds: [id], edges: [] as GraphEdge[] }));
  const paths: GraphPath[] = [];
  const seenStates = new Set<string>();
  const visitedNodes = new Set(starts);
  let visitedEdges = 0;
  const truncationReasons = new Set<'depth' | 'nodes' | 'edges'>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nodeId = current.nodeIds.at(-1) as string;
    if (current.edges.length >= query.budget.maxDepth) {
      truncationReasons.add('depth');
      continue;
    }
    for (const edge of edges) {
      const next = nextEntity(edge, nodeId, query.direction);
      if (!next) continue;
      visitedEdges += 1;
      if (visitedEdges > query.budget.maxEdges) {
        truncationReasons.add('edges');
        return {
          paths,
          visitedNodes: visitedNodes.size,
          visitedEdges: query.budget.maxEdges,
          truncationReasons,
        };
      }
      const nextNodeIds = [...current.nodeIds, next];
      const nextEdges = [...current.edges, edge];
      const isCycle = current.nodeIds.includes(next);
      const targetReached = query.target === undefined || next === query.target;
      if ((query.kind === 'cycles' && isCycle) || (query.kind !== 'cycles' && targetReached))
        paths.push(toPath(graph, nodeById, nextNodeIds, nextEdges));
      if (query.target && next === query.target) continue;
      if (isCycle) continue;
      const state = `${next}|${nextEdges.length}|${nextEdges.map((item) => item.id).join('>')}`;
      if (seenStates.has(state)) continue;
      seenStates.add(state);
      visitedNodes.add(next);
      if (visitedNodes.size > query.budget.maxNodes) {
        truncationReasons.add('nodes');
        return { paths, visitedNodes: query.budget.maxNodes, visitedEdges, truncationReasons };
      }
      if (queue.length >= MAX_PENDING_PATHS) {
        truncationReasons.add('edges');
        return { paths, visitedNodes: visitedNodes.size, visitedEdges, truncationReasons };
      }
      queue.push({ nodeIds: nextNodeIds, edges: nextEdges });
    }
  }
  return { paths, visitedNodes: visitedNodes.size, visitedEdges, truncationReasons };
}

function bindingPaths(paths: readonly GraphPath[], profile?: GraphBindingProfile): GraphPath[] {
  if (!profile) return [...paths];
  return paths.filter((path) => {
    if (!profile.sourceKinds.includes(path.nodes[0]?.kind ?? '')) return false;
    if (path.hops.length !== profile.steps.length) return false;
    return profile.steps.every((step, index) => {
      const hop = path.hops[index];
      const target = path.nodes[index + 1];
      return Boolean(
        hop &&
        step.relations.includes(hop.relation) &&
        (step.direction === 'both' || step.direction === hop.traversal) &&
        step.semantics.includes(hop.semantics) &&
        (!step.targetKinds || step.targetKinds.includes(target?.kind ?? ''))
      );
    });
  });
}

function retrievalCandidates(
  query: GraphNormalizedQuery,
  edgeCount: number
): readonly GraphRetrievalCandidate[] {
  return GRAPH_EXECUTABLE_QUERY_STRATEGIES.map((strategy) => {
    const eligible = strategy !== 'direct' || query.budget.maxDepth === 1 || !query.target;
    return {
      strategy,
      eligible,
      estimatedEdgeVisits:
        strategy === 'direct'
          ? Math.min(edgeCount, query.budget.maxEdges)
          : Math.min(edgeCount * Math.min(query.budget.maxDepth, 4), query.budget.maxEdges),
      sufficiency: eligible
        ? query.target && strategy === 'direct'
          ? 'unknown'
          : 'sufficient'
        : 'insufficient',
      reasons: eligible ? [] : ['multi-hop-target-requires-graph'],
    };
  });
}

function operationalRisk(path: GraphPath): GraphOperationalRiskResult {
  const subject = path.nodes[0] as GraphEntityReference;
  const mixed = path.semantics === 'mixed';
  const disputed = path.hops.filter((hop) => hop.decision === 'disputed').length;
  const score = mixed ? null : Math.min(100, path.hops.length * 15 + disputed * 25);
  return {
    subject,
    score,
    classification:
      score === null
        ? 'unassessed'
        : score >= 75
          ? 'critical'
          : score >= 50
            ? 'high'
            : score >= 25
              ? 'moderate'
              : 'low',
    consequenceSemantics: mixed
      ? 'indeterminate'
      : path.semantics === 'structural' || path.semantics === 'behavioral'
        ? path.semantics
        : 'indeterminate',
    drivers: path.hops.map((hop) => `${hop.relation}:${hop.to.id}`),
    limitations: mixed
      ? ['Mixed relation semantics cannot establish a structural or behavioral consequence.']
      : [],
  };
}

export async function queryGraph(
  graph: GraphCanonicalGraph,
  input: GraphQuery,
  digest: GraphDigestPort,
  options: GraphQueryOptions = {}
): Promise<
  GraphQueryExecutionResult<readonly GraphEntityReference[] | readonly GraphOperationalRiskResult[]>
> {
  const admittedQuery = validateGraphQuery(input);
  if (!admittedQuery.accepted)
    return { accepted: false, code: 'invalid-query', issues: admittedQuery.issues };
  let effectiveQuery = normalizeGraphQuery(input);
  const invalid = validateNormalizedQuery(effectiveQuery);
  if (invalid) return invalid;
  const invalidGraph = validateCanonicalGraphForQuery(graph);
  if (invalidGraph) return invalidGraph;
  if (effectiveQuery.kind === 'bindings' && !effectiveQuery.bindingProfile)
    return failure(
      'invalid-query',
      'GRAPH_QUERY_BINDING_PROFILE_REQUIRED',
      '/bindingProfile',
      'Binding queries require an exact versioned binding profile.'
    );
  const bindingProfile = effectiveQuery.bindingProfile
    ? options.bindingProfiles?.find(
        (profile) =>
          profile.id === effectiveQuery.bindingProfile?.id &&
          profile.version === effectiveQuery.bindingProfile.version
      )
    : undefined;
  if (effectiveQuery.bindingProfile && !bindingProfile)
    return failure(
      'unsupported',
      'GRAPH_QUERY_BINDING_PROFILE_UNAVAILABLE',
      '/bindingProfile',
      'Requested binding profile is not available.'
    );
  if (bindingProfile) {
    const admittedProfile = validateGraphBindingProfile(bindingProfile);
    if (!admittedProfile.accepted)
      return { accepted: false, code: 'invalid-query', issues: admittedProfile.issues };
    effectiveQuery = Object.freeze({
      ...effectiveQuery,
      direction: 'both',
      minimumProof: stricterProof(effectiveQuery.minimumProof, bindingProfile.minimumProof),
      budget: Object.freeze({
        ...effectiveQuery.budget,
        maxDepth: Math.min(effectiveQuery.budget.maxDepth, bindingProfile.steps.length),
      }),
    });
  }
  const query = effectiveQuery;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (query.subject && !nodeById.has(query.subject))
    return failure(
      'invalid-query',
      'GRAPH_QUERY_SUBJECT_UNKNOWN',
      '/subject',
      'Query subject is not present in the selected generation.'
    );
  if (query.target && !nodeById.has(query.target))
    return failure(
      'invalid-query',
      'GRAPH_QUERY_TARGET_UNKNOWN',
      '/target',
      'Query target is not present in the selected generation.'
    );

  if (
    query.scope &&
    query.subject &&
    canonical(nodeById.get(query.subject)?.scope) !== canonical(query.scope)
  )
    return failure(
      'invalid-query',
      'GRAPH_QUERY_SUBJECT_OUTSIDE_SCOPE',
      '/subject',
      'Query subject is outside the declared scope.'
    );

  let cacheLookup: GraphQueryCacheLookup | undefined;
  if (options.cache) {
    cacheLookup = await lookupGraphQueryCache({
      graph,
      query,
      digest,
      cache: options.cache,
    });
    if (cacheLookup.status === 'hit') {
      return {
        accepted: true,
        value: cacheLookup.result as GraphQueryResult<
          readonly GraphEntityReference[] | readonly GraphOperationalRiskResult[]
        >,
        issues: [],
        cache: cacheLookup.observation,
      };
    }
  }

  const scopedNodeIds = new Set(
    graph.nodes
      .filter((node) => !query.scope || canonical(node.scope) === canonical(query.scope))
      .map((node) => node.id)
  );
  const edges = graph.edges
    .filter(
      (edge) =>
        scopedNodeIds.has(edge.from) && scopedNodeIds.has(edge.to) && edgeAllowed(edge, query)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  let traversal = traverse(graph, query, nodeById, edges);
  let paths =
    query.kind === 'bindings'
      ? bindingPaths(traversal.paths, bindingProfile)
      : [...traversal.paths];
  if (query.kind === 'entry-points') {
    const entryNodes = graph.nodes.filter(
      (node) => scopedNodeIds.has(node.id) && ['api', 'command', 'endpoint'].includes(node.kind)
    );
    paths = entryNodes.map((node) => toPath(graph, nodeById, [node.id], []));
    traversal = { ...traversal, visitedNodes: graph.nodes.length };
  }
  if (query.kind === 'contract-topology')
    paths = paths.filter((path) =>
      path.nodes.some((node) => ['api', 'contract', 'endpoint', 'schema'].includes(node.kind))
    );

  paths.sort((left, right) => left.pathId.localeCompare(right.pathId));
  const offset = Number(query.page.cursor?.slice('offset:'.length) ?? 0);
  const pagePaths = paths.slice(offset, offset + query.page.size);
  const pageTruncated = offset + query.page.size < paths.length;
  const evidenceById = new Map<string, WisEvidenceReference>();
  for (const path of pagePaths)
    for (const hop of path.hops)
      for (const evidence of hop.evidence) evidenceById.set(evidence.id, evidence);
  const allEvidence = [...evidenceById.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const evidenceTruncated = allEvidence.length > query.budget.maxEvidence;
  const evidence = allEvidence.slice(0, query.budget.maxEvidence);
  const nodeResults = [
    ...new Map(pagePaths.flatMap((path) => path.nodes).map((node) => [node.id, node])).values(),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const result = query.kind === 'operational-risk' ? pagePaths.map(operationalRisk) : nodeResults;
  const relevantFactIds = new Set(
    pagePaths.flatMap((path) =>
      path.hops.flatMap((hop) => graph.edges.find((edge) => edge.id === hop.edgeId)?.facts ?? [])
    )
  );
  const disputes = graph.disputes.filter((dispute) =>
    dispute.factIds.some((factId) => relevantFactIds.has(factId))
  );
  const unknownBoundaries = [
    ...graph.diagnostics
      .filter((item) => item.severity !== 'info')
      .map((item) => ({ code: item.code, scope: item.path, reason: item.message })),
  ];
  const relevantNodeIds = new Set(pagePaths.flatMap((path) => path.nodes.map((node) => node.id)));
  for (const unresolved of graph.unresolved)
    if (
      unresolved.candidates.some((candidate) => relevantNodeIds.has(candidate)) ||
      unresolved.candidates.includes(query.subject ?? '')
    )
      unknownBoundaries.push({
        code: 'GRAPH_QUERY_IDENTITY_UNRESOLVED',
        scope: unresolved.id,
        reason: `Identity remains unresolved across ${unresolved.candidates.length} candidates.`,
      });
  if (query.kind === 'contract-topology') {
    const linked = new Set(paths.flatMap((path) => path.nodes.map((node) => node.id)));
    for (const entity of graph.nodes)
      if (
        scopedNodeIds.has(entity.id) &&
        ['api', 'contract', 'endpoint', 'schema'].includes(entity.kind) &&
        !linked.has(entity.id)
      )
        unknownBoundaries.push({
          code: 'GRAPH_CONTRACT_BINDING_UNOBSERVED',
          scope: entity.id,
          reason: 'No proof-carrying contract topology path was observed for this entity.',
        });
  }
  const bindingCompleteness = bindingProfile
    ? (() => {
        const eligible = graph.nodes.filter(
          (node) =>
            scopedNodeIds.has(node.id) &&
            bindingProfile.sourceKinds.includes(node.kind) &&
            (!query.subject || node.id === query.subject)
        );
        const complete = new Set(
          pagePaths
            .filter((path) => path.hops.length === bindingProfile.steps.length)
            .map((path) => path.nodes[0]?.id)
            .filter((id): id is string => Boolean(id))
        );
        for (const subject of eligible)
          if (!complete.has(subject.id))
            unknownBoundaries.push({
              code: 'GRAPH_BINDING_INCOMPLETE',
              scope: subject.id,
              reason: `No complete path satisfied binding profile ${bindingProfile.id}@${bindingProfile.version}.`,
            });
        const ratio = eligible.length > 0 ? complete.size / eligible.length : undefined;
        return [
          {
            profile: { id: bindingProfile.id, version: bindingProfile.version },
            eligibleSubjects: eligible.length,
            completeSubjects: complete.size,
            ...(ratio === undefined ? {} : { ratio }),
            status:
              eligible.length === 0
                ? ('not-applicable' as const)
                : complete.size === eligible.length
                  ? ('complete' as const)
                  : complete.size === 0
                    ? ('unknown' as const)
                    : ('partial' as const),
          },
        ];
      })()
    : [];
  if (paths.length === 0)
    unknownBoundaries.push({
      code: 'GRAPH_QUERY_NO_PROVEN_PATH',
      scope: query.subject ?? 'generation',
      reason: 'No path satisfying the declared relation and proof constraints was found.',
    });
  const reasons = [
    ...traversal.truncationReasons,
    ...(evidenceTruncated ? (['evidence'] as const) : []),
    ...(pageTruncated ? (['page'] as const) : []),
  ];
  const canonicalQuery = canonical(query);
  const queryDigest = {
    algorithm: digest.algorithm,
    value: await digest.digest(new TextEncoder().encode(canonicalQuery)),
    canonicalization: 'workspai.graph.canonical-json.v1',
  } as const;
  const candidates = retrievalCandidates(query, edges.length);
  const confidence =
    pagePaths.length === 0
      ? 0
      : Math.min(
          ...pagePaths.flatMap((path) => path.hops.map((hop) => hop.confidence)).concat([1])
        );
  const stale = pagePaths.some((path) => path.hops.some((hop) => hop.freshness.status === 'stale'));
  const unknownFreshness = pagePaths.some((path) =>
    path.hops.some((hop) => hop.freshness.status === 'unknown')
  );
  const diagnostics: GraphDiagnostic[] = [];
  if (
    query.kind === 'architecture-conformance' &&
    pagePaths.some((path) => path.semantics === 'mixed')
  )
    diagnostics.push({
      code: 'GRAPH_ARCHITECTURE_MIXED_SEMANTICS_UNASSESSED',
      severity: 'warning',
      path: '/paths',
      message: 'Mixed structural and behavioral paths are unassessed for architecture conformance.',
    });
  const returnedEdges = new Map(
    pagePaths.flatMap((path) => path.hops.map((hop) => [hop.edgeId, hop] as const))
  );
  const queryProofStates: Record<GraphProofState, number> = {
    supported: 0,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  };
  for (const hop of returnedEdges.values()) queryProofStates[hop.proof.state] += 1;
  const analytical = query.kind === 'operational-risk' || query.kind === 'architecture-conformance';

  const value: GraphQueryResult<typeof result> = {
    contract: GRAPH_QUERY_RESULT_CONTRACT,
    query,
    queryDigest,
    generation: graph.generation.reference,
    result,
    paths: pagePaths,
    evidence,
    disputes,
    unknownBoundaries,
    freshness: {
      status: stale ? 'stale' : unknownFreshness ? 'unknown' : 'current',
      inputGenerations: [graph.generation.reference.id],
    },
    confidence,
    cost: {
      visitedNodes: traversal.visitedNodes,
      visitedEdges: traversal.visitedEdges,
      returnedPaths: pagePaths.length,
      returnedEvidence: evidence.length,
    },
    retrievalPlan: {
      contract: GRAPH_RETRIEVAL_PLAN_CONTRACT,
      profile: QUERY_PROFILE,
      candidates,
      selected: query.strategy,
      ...(input.strategy === 'auto' || input.strategy === undefined
        ? { fallbackReason: `deterministic-${query.kind}-preset` }
        : {}),
      budget: query.budget,
    },
    utility: {
      profile: input.utilityProfile ?? UTILITY_PROFILE,
      baseline: 'declared-path-completion',
      status: 'not-assessed',
      sufficient: pagePaths.length > 0 && !pageTruncated && !evidenceTruncated,
      drivers: pagePaths.length > 0 ? ['proof-constrained-path-returned'] : [],
      limitations: [
        'No empirical relevance claim is made until an admitted benchmark profile is supplied.',
      ],
    },
    quality: {
      proofStates: queryProofStates,
      bindingCompleteness,
    },
    analysis: {
      profile: { id: `workspai.graph.analysis.${query.kind}`, version: '0.1.0-candidate' },
      algorithm: {
        id: analytical
          ? 'workspai.graph.algorithm.bounded-proof-path-analysis'
          : 'workspai.graph.algorithm.deterministic-traversal',
        version: '0.1.0-candidate',
      },
      sourceGeneration: graph.generation.reference,
      proofThreshold: query.minimumProof,
      capability: pagePaths.length > 0 ? 'assessed' : 'unassessed',
      circularity: analytical ? 'graph-derived' : 'none',
      accuracyClaim: 'none',
      drivers: analytical ? ['canonical-proof-carrying-paths'] : ['deterministic-query-plan'],
      limitations: analytical
        ? ['Graph-derived scores are descriptive and excluded from empirical accuracy claims.']
        : [],
      validationEvidence: [],
    },
    truncation: {
      truncated: reasons.length > 0,
      reasons,
      ...(pageTruncated ? { nextCursor: `offset:${offset + query.page.size}` } : {}),
    },
    diagnostics,
  };
  const execution: GraphQueryExecutionResult<
    readonly GraphEntityReference[] | readonly GraphOperationalRiskResult[]
  > = { accepted: true, value, issues: [] };
  if (!cacheLookup || cacheLookup.status !== 'proceed') return execution;
  if (cacheLookup.key && cacheLookup.keyDigest && options.cache) {
    try {
      await publishGraphQueryCache({
        digest,
        cache: options.cache,
        key: cacheLookup.key,
        keyDigest: cacheLookup.keyDigest,
        result: value,
      });
    } catch {
      return {
        ...execution,
        cache: {
          ...cacheLookup.observation,
          reasons: Object.freeze([
            ...(cacheLookup.observation.reasons ?? []),
            'GRAPH_QUERY_CACHE_PUBLISH_UNAVAILABLE',
          ]),
        },
      };
    }
  }
  return { ...execution, cache: cacheLookup.observation };
}
