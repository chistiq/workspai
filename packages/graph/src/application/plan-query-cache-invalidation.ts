import type { WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT,
  type GraphChangeCause,
  type GraphChangeOverlay,
  type GraphDelta,
  type GraphQueryCacheEntry,
  type GraphQueryCacheInvalidation,
  type GraphScope,
} from '../contracts/index.js';

export interface GraphQueryCacheInvalidationRequest {
  readonly entries: readonly GraphQueryCacheEntry[];
  readonly currentRedactionDigest?: WisDigestReference;
  readonly currentAuthorizationDigest?: WisDigestReference;
  readonly currentOntologyDigest?: WisDigestReference;
  readonly currentProofPolicyDigest?: WisDigestReference;
  readonly currentProfileDigest?: WisDigestReference;
  readonly currentScope?: GraphScope;
  readonly delta?: GraphDelta;
  readonly overlay?: GraphChangeOverlay;
  readonly causes?: readonly GraphChangeCause[];
  readonly corruptKeyDigests?: readonly WisDigestReference[];
}

function digestKey(digest: WisDigestReference): string {
  return `${digest.algorithm}:${digest.value}`;
}

function scopesCompatible(left: GraphScope, right: GraphScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'project' && right.kind === 'project') {
    const leftIds = [...left.projectIds].sort();
    const rightIds = [...right.projectIds].sort();
    return (
      leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index])
    );
  }
  return (
    left.kind === 'workspace' &&
    right.kind === 'workspace' &&
    left.workspaceId === right.workspaceId
  );
}

function invalidation(
  reason: GraphQueryCacheInvalidation['reason'],
  keyDigests: readonly WisDigestReference[]
): GraphQueryCacheInvalidation | undefined {
  if (keyDigests.length === 0) {
    return undefined;
  }
  const unique = new Map<string, WisDigestReference>();
  for (const digest of keyDigests) {
    unique.set(digestKey(digest), digest);
  }
  return Object.freeze({
    contract: GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT,
    keyDigests: Object.freeze([...unique.values()]),
    reason,
  });
}

/**
 * Plans dependency-indexed query-cache invalidation. Historical generation keys
 * remain reusable unless policy revocation, overlay staleness or corruption
 * applies. Overlay changes map to the generation reason because overlays are
 * generation-bound and non-canonical.
 */
export function planQueryCacheInvalidation(
  request: GraphQueryCacheInvalidationRequest
): readonly GraphQueryCacheInvalidation[] {
  const byReason = new Map<GraphQueryCacheInvalidation['reason'], WisDigestReference[]>();
  const add = (reason: GraphQueryCacheInvalidation['reason'], digest: WisDigestReference) => {
    const existing = byReason.get(reason) ?? [];
    existing.push(digest);
    byReason.set(reason, existing);
  };

  const corrupt = new Set((request.corruptKeyDigests ?? []).map(digestKey));

  const overlayStale = request.overlay?.status === 'stale';
  const overlayDigest = request.overlay?.proposal.digest;

  for (const entry of request.entries) {
    if (corrupt.has(digestKey(entry.keyDigest))) {
      add('corruption', entry.keyDigest);
      continue;
    }

    if (
      request.currentAuthorizationDigest &&
      entry.key.authorizationDigest.value !== request.currentAuthorizationDigest.value
    ) {
      add('authorization', entry.keyDigest);
      continue;
    }

    if (
      request.currentRedactionDigest &&
      entry.key.redactionPolicyDigest.value !== request.currentRedactionDigest.value
    ) {
      add('redaction', entry.keyDigest);
      continue;
    }

    if (
      request.currentOntologyDigest &&
      entry.key.ontologyDigest.value !== request.currentOntologyDigest.value
    ) {
      add('ontology', entry.keyDigest);
      continue;
    }

    if (
      request.currentProofPolicyDigest &&
      entry.key.proofPolicyDigest.value !== request.currentProofPolicyDigest.value
    ) {
      add('proof-policy', entry.keyDigest);
      continue;
    }

    if (
      request.currentProfileDigest &&
      entry.key.profileDigest.value !== request.currentProfileDigest.value
    ) {
      add('profile', entry.keyDigest);
      continue;
    }

    if (request.currentScope && !scopesCompatible(entry.key.scope, request.currentScope)) {
      add('scope', entry.keyDigest);
      continue;
    }

    if (entry.key.overlayDigest) {
      if (overlayStale || (overlayDigest && entry.key.overlayDigest.value !== overlayDigest)) {
        add('generation', entry.keyDigest);
        continue;
      }
    }
  }

  return Object.freeze(
    (
      [
        'generation',
        'ontology',
        'proof-policy',
        'profile',
        'scope',
        'redaction',
        'authorization',
        'corruption',
      ] as const
    )
      .map((reason) => invalidation(reason, byReason.get(reason) ?? []))
      .filter((entry): entry is GraphQueryCacheInvalidation => entry !== undefined)
  );
}
