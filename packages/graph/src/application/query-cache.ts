import type { WisContractReference, WisDigestReference } from '@workspai/shared/contracts';

import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import { validateGraphQueryCacheEntry, validateGraphQueryCacheKey } from '../conformance/graph.js';
import { validateGraphQueryResult } from '../conformance/query.js';
import {
  GRAPH_QUERY_CACHE_CONTRACT,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  GRAPH_QUERY_CACHE_REUSE_CONTRACT,
  GRAPH_QUERY_RESULT_CONTRACT,
  type GraphCanonicalGraph,
  type GraphQuery,
  type GraphQueryBudget,
  type GraphQueryCacheEntry,
  type GraphQueryCacheInvalidation,
  type GraphQueryCacheKey,
  type GraphQueryCacheObservation,
  type GraphQueryCacheReuseDecision,
  type GraphQueryResult,
  type GraphScope,
} from '../contracts/index.js';
import type { GraphDigestPort, GraphQueryCacheStorePort } from '../ports/index.js';

/** Must match the profile identity `queryGraph` stamps on retrieval plans. */
const DEFAULT_QUERY_PROFILE: WisContractReference = Object.freeze({
  id: 'workspai.graph.query.standard',
  version: '0.1.0-candidate',
});

export interface GraphQueryCachePolicy {
  readonly redactionPolicyDigest: WisDigestReference;
  readonly authorizationDigest: WisDigestReference;
  readonly scope?: GraphScope;
  readonly overlayDigest?: WisDigestReference;
  readonly profileDigest?: WisDigestReference;
  readonly plannerProfileDigest?: WisDigestReference;
  readonly resultProfileDigest?: WisDigestReference;
  readonly projectionDigests?: readonly WisDigestReference[];
  readonly indexDigests?: readonly WisDigestReference[];
  readonly requiredExtensions?: readonly WisContractReference[];
}

export interface GraphQueryCacheRequest {
  readonly store: GraphQueryCacheStorePort;
  readonly mode?: 'read-only' | 'read-write';
  readonly policy: GraphQueryCachePolicy;
}

export interface GraphQueryCacheKeyRequest {
  readonly graph: GraphCanonicalGraph;
  readonly query: GraphQuery;
  readonly digest: GraphDigestPort;
  readonly policy: GraphQueryCachePolicy;
  readonly profiles?: readonly WisContractReference[];
  readonly indexes?: readonly WisDigestReference[];
}

export type GraphQueryCacheLookup =
  | {
      readonly status: 'hit';
      readonly observation: GraphQueryCacheObservation;
      readonly result: GraphQueryResult<unknown>;
    }
  | {
      readonly status: 'proceed';
      readonly observation: GraphQueryCacheObservation;
      readonly key?: GraphQueryCacheKey;
      readonly keyDigest?: WisDigestReference;
    };

export function evaluateGraphQueryCacheReuse(
  requested: GraphQueryCacheKey,
  candidate: GraphQueryCacheEntry
): GraphQueryCacheReuseDecision {
  const requestedAdmission = validateGraphQueryCacheKey(requested);
  if (!requestedAdmission.accepted)
    return {
      contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
      reusable: false,
      status: 'incompatible',
      reasons: requestedAdmission.issues.map((item) => item.code).sort(),
    };
  const candidateAdmission = validateGraphQueryCacheEntry(candidate);
  if (!candidateAdmission.accepted)
    return {
      contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
      reusable: false,
      status: 'corrupt',
      reasons: candidateAdmission.issues.map((item) => item.code).sort(),
    };
  if (candidate.freshness.status !== 'current')
    return {
      contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
      reusable: false,
      status: 'stale',
      reasons: ['GRAPH_QUERY_CACHE_ENTRY_NOT_CURRENT'],
    };
  const expected = canonicalizeGraphValue(requested);
  const actual = canonicalizeGraphValue(candidate.key);
  if (!expected.accepted || !actual.accepted)
    return {
      contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
      reusable: false,
      status: 'corrupt',
      reasons: ['GRAPH_QUERY_CACHE_KEY_NOT_CANONICAL'],
    };
  if (expected.value !== actual.value) {
    const authorizationChanged =
      requested.authorizationDigest.value !== candidate.key.authorizationDigest.value ||
      requested.redactionPolicyDigest.value !== candidate.key.redactionPolicyDigest.value;
    return {
      contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
      reusable: false,
      status: authorizationChanged ? 'denied' : 'incompatible',
      reasons: [
        authorizationChanged
          ? 'GRAPH_QUERY_CACHE_AUTHORIZATION_CHANGED'
          : 'GRAPH_QUERY_CACHE_SEMANTIC_DEPENDENCY_CHANGED',
      ],
    };
  }
  return {
    contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
    reusable: true,
    status: 'exact',
    entryDigest: candidate.keyDigest,
  };
}

export async function digestCanonicalGraphValue(
  digest: GraphDigestPort,
  value: unknown
): Promise<WisDigestReference> {
  const canonical = canonicalizeGraphValue(value);
  if (!canonical.accepted) throw new Error('Value is not canonically serializable.');
  return Object.freeze({
    algorithm: digest.algorithm,
    value: await digest.digest(new TextEncoder().encode(canonical.value)),
    canonicalization: 'workspai.graph.canonical-json.v1',
  });
}

/**
 * Builds the portable cache key. Pass the same normalized query `queryGraph`
 * executes so budgets, pagination and defaults match live evaluation.
 */
export async function createQueryCacheKey(
  request: GraphQueryCacheKeyRequest
): Promise<GraphQueryCacheKey> {
  const scope = resolveQueryCacheScope(request.graph, request.query, request.policy);
  if (!scope) throw new Error('GRAPH_QUERY_CACHE_SCOPE_MISSING');
  const budget = completeQueryBudget(request.query.budget);
  if (!budget) throw new Error('GRAPH_QUERY_CACHE_BUDGET_INVALID');
  const queryDigest = await digestCanonicalGraphValue(request.digest, request.query);
  const profileDigest =
    request.policy.profileDigest ??
    (await digestCanonicalGraphValue(request.digest, DEFAULT_QUERY_PROFILE));
  const plannerProfileDigest =
    request.policy.plannerProfileDigest ??
    (await digestCanonicalGraphValue(request.digest, DEFAULT_QUERY_PROFILE));
  const resultProfileDigest =
    request.policy.resultProfileDigest ??
    (await digestCanonicalGraphValue(request.digest, GRAPH_QUERY_RESULT_CONTRACT));
  const requestedPage = request.query.page;
  const page =
    requestedPage && typeof requestedPage.cursor === 'string'
      ? Object.freeze({ cursor: requestedPage.cursor, size: requestedPage.size })
      : undefined;
  const key: GraphQueryCacheKey = {
    contract: GRAPH_QUERY_CACHE_CONTRACT,
    graphGeneration: request.graph.generation.reference,
    queryDigest,
    ontologyDigest: request.graph.generation.ontologySetDigest,
    proofPolicyDigest: request.graph.generation.proofPolicySetDigest,
    profileDigest,
    plannerProfileDigest,
    resultProfileDigest,
    projectionDigests: sortDigests(request.policy.projectionDigests ?? []),
    indexDigests: sortDigests(request.indexes ?? request.policy.indexDigests ?? []),
    requiredExtensions: sortContracts([
      ...(request.policy.requiredExtensions ?? []),
      ...(request.profiles ?? []),
    ]),
    ...(request.policy.overlayDigest ? { overlayDigest: request.policy.overlayDigest } : {}),
    scope,
    redactionPolicyDigest: request.policy.redactionPolicyDigest,
    authorizationDigest: request.policy.authorizationDigest,
    budget,
    ...(page ? { page } : {}),
  };
  const admitted = validateGraphQueryCacheKey(key);
  if (!admitted.accepted) {
    throw new Error(admitted.issues[0]?.code ?? 'GRAPH_QUERY_CACHE_KEY_INVALID');
  }
  return Object.freeze(key);
}

export async function lookupGraphQueryCache(request: {
  readonly graph: GraphCanonicalGraph;
  readonly query: GraphQuery;
  readonly digest: GraphDigestPort;
  readonly cache: GraphQueryCacheRequest;
}): Promise<GraphQueryCacheLookup> {
  let key: GraphQueryCacheKey;
  let keyDigest: WisDigestReference;
  try {
    key = await createQueryCacheKey({
      graph: request.graph,
      query: request.query,
      digest: request.digest,
      policy: request.cache.policy,
    });
    keyDigest = await digestCanonicalGraphValue(request.digest, key);
  } catch (error) {
    return {
      status: 'proceed',
      observation: observation('unavailable', undefined, [
        error instanceof Error ? error.message : 'GRAPH_QUERY_CACHE_UNAVAILABLE',
      ]),
    };
  }
  let entry: GraphQueryCacheEntry | undefined;
  try {
    entry = await request.cache.store.get(keyDigest);
  } catch {
    return {
      status: 'proceed',
      observation: observation('unavailable', keyDigest, ['GRAPH_QUERY_CACHE_STORE_UNAVAILABLE']),
      key,
      keyDigest,
    };
  }
  if (!entry) {
    return {
      status: 'proceed',
      observation: observation('miss', keyDigest),
      key,
      keyDigest,
    };
  }
  const decision = evaluateGraphQueryCacheReuse(key, entry);
  if (!decision.reusable) {
    return {
      status: 'proceed',
      observation: observation(decision.status, keyDigest, decision.reasons),
      key,
      keyDigest,
    };
  }
  const admitted = validateGraphQueryResult(entry.result);
  if (!admitted.accepted) {
    return {
      status: 'proceed',
      observation: observation(
        'corrupt',
        keyDigest,
        admitted.issues.map((item) => item.code)
      ),
      key,
      keyDigest,
    };
  }
  return {
    status: 'hit',
    observation: observation('hit', keyDigest),
    result: admitted.value,
  };
}

export async function publishGraphQueryCache(request: {
  readonly digest: GraphDigestPort;
  readonly cache: GraphQueryCacheRequest;
  readonly key: GraphQueryCacheKey;
  readonly keyDigest: WisDigestReference;
  readonly result: GraphQueryResult<unknown>;
}): Promise<void> {
  if ((request.cache.mode ?? 'read-write') === 'read-only') return;
  const resultDigest = await digestCanonicalGraphValue(request.digest, request.result);
  const entry: GraphQueryCacheEntry = Object.freeze({
    contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
    keyDigest: request.keyDigest,
    key: request.key,
    result: request.result,
    resultDigest,
    freshness: Object.freeze({ status: 'current' as const }),
  });
  await request.cache.store.publish(entry);
}

export async function applyQueryCacheInvalidations(request: {
  readonly store: GraphQueryCacheStorePort;
  readonly invalidations: readonly GraphQueryCacheInvalidation[];
}): Promise<void> {
  const unique = new Map<string, WisDigestReference>();
  for (const item of request.invalidations) {
    for (const digest of item.keyDigests) {
      unique.set(`${digest.algorithm}:${digest.value}`, digest);
    }
  }
  if (unique.size === 0) {
    return;
  }
  await request.store.invalidate([...unique.values()]);
}

function resolveQueryCacheScope(
  graph: GraphCanonicalGraph,
  query: GraphQuery,
  policy: GraphQueryCachePolicy
): GraphScope | undefined {
  if (query.scope) return query.scope;
  if (policy.scope) return policy.scope;
  if (!query.subject) return undefined;
  return graph.nodes.find((node) => node.id === query.subject)?.scope;
}

function completeQueryBudget(budget: GraphQuery['budget']): GraphQueryBudget | undefined {
  const maxDepth = budget?.maxDepth;
  const maxNodes = budget?.maxNodes;
  const maxEdges = budget?.maxEdges;
  const maxEvidence = budget?.maxEvidence;
  if (
    !Number.isInteger(maxDepth) ||
    !Number.isInteger(maxNodes) ||
    !Number.isInteger(maxEdges) ||
    !Number.isInteger(maxEvidence) ||
    Number(maxDepth) <= 0 ||
    Number(maxNodes) <= 0 ||
    Number(maxEdges) <= 0 ||
    Number(maxEvidence) <= 0
  ) {
    return undefined;
  }
  return Object.freeze({
    maxDepth: maxDepth as number,
    maxNodes: maxNodes as number,
    maxEdges: maxEdges as number,
    maxEvidence: maxEvidence as number,
  });
}

function sortDigests(values: readonly WisDigestReference[]): readonly WisDigestReference[] {
  return Object.freeze(
    [...values].sort(
      (left, right) =>
        left.algorithm.localeCompare(right.algorithm) || left.value.localeCompare(right.value)
    )
  );
}

function sortContracts(values: readonly WisContractReference[]): readonly WisContractReference[] {
  return Object.freeze(
    [...values].sort(
      (left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)
    )
  );
}

function observation(
  status: GraphQueryCacheObservation['status'],
  keyDigest?: WisDigestReference,
  reasons?: readonly string[]
): GraphQueryCacheObservation {
  return Object.freeze({
    status,
    ...(keyDigest ? { keyDigest } : {}),
    ...(reasons && reasons.length > 0 ? { reasons: Object.freeze([...reasons]) } : {}),
  });
}
