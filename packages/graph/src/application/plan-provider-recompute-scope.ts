export interface GraphProviderRecomputeScopeRequest {
  readonly providersToRecompute: readonly string[];
  readonly registeredProviderIds: readonly string[];
}

export interface GraphProviderRecomputeScopePlan {
  readonly toRecompute: readonly string[];
  readonly unaffected: readonly string[];
  readonly unknownRequested: readonly string[];
}

/**
 * Classifies provider identities for selective recomputation without executing
 * provider stages or mutating canonical graph truth.
 */
export function planProviderRecomputeScope(
  request: GraphProviderRecomputeScopeRequest
): GraphProviderRecomputeScopePlan {
  const registered = new Set(request.registeredProviderIds);
  const requested = new Set(request.providersToRecompute);
  const toRecompute: string[] = [];
  const unknownRequested: string[] = [];

  for (const providerId of [...requested].sort()) {
    if (registered.has(providerId)) {
      toRecompute.push(providerId);
      continue;
    }
    unknownRequested.push(providerId);
  }

  const unaffected = request.registeredProviderIds
    .filter((providerId) => !requested.has(providerId))
    .sort();

  return Object.freeze({
    toRecompute: Object.freeze(toRecompute),
    unaffected: Object.freeze(unaffected),
    unknownRequested: Object.freeze(unknownRequested),
  });
}
