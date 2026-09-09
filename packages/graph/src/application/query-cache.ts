import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import { validateGraphQueryCacheEntry, validateGraphQueryCacheKey } from '../conformance/graph.js';
import {
  GRAPH_QUERY_CACHE_REUSE_CONTRACT,
  type GraphQueryCacheEntry,
  type GraphQueryCacheKey,
  type GraphQueryCacheReuseDecision,
} from '../contracts/index.js';

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
