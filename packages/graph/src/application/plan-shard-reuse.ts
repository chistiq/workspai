import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphContentStateLeaf,
  GraphContentStateManifest,
  GraphDiagnostic,
  GraphInputChange,
  GraphShardDependency,
  GraphShardReuseDecision,
  GraphShardReusePlan,
  GraphShardReuseRejectionReason,
  GraphShardReuseRequest,
} from '../contracts/index.js';
import { shardMembershipLocator } from '../domain/shard-membership.js';

function digestEqual(left: WisDigestReference, right: WisDigestReference): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function digestKey(digest: WisDigestReference): string {
  return `${digest.algorithm}:${digest.value}`;
}

function digestSetEqual(
  left: readonly WisDigestReference[],
  right: readonly WisDigestReference[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightKeys = new Set(right.map(digestKey));
  return left.every((digest) => rightKeys.has(digestKey(digest)));
}

function changedLocators(changedInputs: readonly GraphInputChange[]): Set<string> {
  const locators = new Set<string>();
  for (const change of changedInputs) {
    locators.add(change.locator);
    if (change.renameCandidate) {
      locators.add(change.renameCandidate.priorLocator);
      locators.add(change.renameCandidate.nextLocator);
    }
  }
  return locators;
}

function indexShards(manifest: GraphContentStateManifest): Map<string, GraphShardDependency> {
  return new Map(manifest.shardDependencies.map((shard) => [shard.shardId, shard]));
}

function leafByLocator(manifest: GraphContentStateManifest): Map<string, GraphContentStateLeaf> {
  const files = new Map<string, GraphContentStateLeaf>();
  for (const node of manifest.nodes) {
    if (node.kind === 'file') {
      files.set(node.locator, node);
    }
  }
  return files;
}

function reject(
  shardId: string,
  reason: GraphShardReuseRejectionReason,
  detail?: string
): GraphShardReuseDecision {
  return Object.freeze({
    shardId,
    decision: 'reject',
    reason,
    detail,
  });
}

function collectInvalidations(shards: readonly GraphShardDependency[]): {
  providers: string[];
  projections: string[];
  queryIndexes: string[];
  graphRegions: string[];
} {
  const providers = new Set<string>();
  const projections = new Set<string>();
  const queryIndexes = new Set<string>();
  const graphRegions = new Set<string>();
  for (const shard of shards) {
    for (const provider of shard.providerStages) {
      providers.add(provider);
    }
    for (const projection of shard.projections) {
      projections.add(projection);
    }
    for (const index of shard.queryIndexes) {
      queryIndexes.add(index);
    }
    for (const region of shard.graphRegions) {
      graphRegions.add(region);
    }
  }
  return {
    providers: [...providers].sort(),
    projections: [...projections].sort(),
    queryIndexes: [...queryIndexes].sort(),
    graphRegions: [...graphRegions].sort(),
  };
}

function semanticMismatchReason(
  base: readonly WisDigestReference[],
  target: readonly WisDigestReference[],
  required: readonly WisDigestReference[] | undefined
): GraphShardReuseRejectionReason | undefined {
  if (!digestSetEqual(base, target)) {
    const baseKeys = new Set(base.map(digestKey));
    const targetKeys = new Set(target.map(digestKey));
    for (const digest of required ?? []) {
      if (!baseKeys.has(digestKey(digest)) || !targetKeys.has(digestKey(digest))) {
        return 'missing-semantic-dependency';
      }
    }
    if (target.length > base.length) {
      return 'extra-semantic-dependency';
    }
    return 'semantic-incompatible';
  }
  if (required) {
    for (const digest of required) {
      if (!base.some((entry) => digestEqual(entry, digest))) {
        return 'missing-semantic-dependency';
      }
    }
  }
  return undefined;
}

/**
 * Plans exact-digest shard reuse and downstream invalidation from content changes.
 */
export function planShardReuseAndInvalidation(
  request: GraphShardReuseRequest
): GraphShardReusePlan {
  const diagnostics: GraphDiagnostic[] = [];
  const reused: GraphShardDependency[] = [];
  const rejected: GraphShardReuseDecision[] = [];
  const invalidationSources: GraphShardDependency[] = [];

  const baseShards = indexShards(request.base);
  const targetShards = indexShards(request.target);
  const targetLeaves = leafByLocator(request.target);
  const baseLeaves = leafByLocator(request.base);
  const affectedLocators = changedLocators(request.changedInputs);
  const membershipLocators = new Set([
    ...targetLeaves.keys(),
    ...baseLeaves.keys(),
    ...affectedLocators,
  ]);
  const authorized = request.authorizedShardIds ? new Set(request.authorizedShardIds) : undefined;

  for (const [shardId, baseShard] of [...baseShards.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (authorized && !authorized.has(shardId)) {
      const decision = reject(shardId, 'unauthorized-shard');
      rejected.push(decision);
      invalidationSources.push(baseShard);
      continue;
    }

    const targetShard = targetShards.get(shardId);
    if (!targetShard) {
      rejected.push(reject(shardId, 'missing-target-shard'));
      invalidationSources.push(baseShard);
      continue;
    }

    const locator = shardMembershipLocator(shardId, membershipLocators);
    if (locator && affectedLocators.has(locator)) {
      rejected.push(reject(shardId, 'content-changed', locator));
      invalidationSources.push(baseShard);
      continue;
    }

    if (!digestEqual(baseShard.contentDigest, targetShard.contentDigest)) {
      rejected.push(reject(shardId, 'content-incompatible'));
      invalidationSources.push(baseShard);
      continue;
    }

    if (locator) {
      const member = targetLeaves.get(locator);
      if (!member || !digestEqual(member.contentDigest, targetShard.contentDigest)) {
        rejected.push(reject(shardId, 'content-incompatible', 'missing-content-membership'));
        invalidationSources.push(baseShard);
        continue;
      }
    } else {
      rejected.push(reject(shardId, 'content-incompatible', 'missing-content-membership'));
      invalidationSources.push(baseShard);
      continue;
    }

    const semanticReason = semanticMismatchReason(
      baseShard.semanticDependencies,
      targetShard.semanticDependencies,
      request.requiredSemanticDependencies
    );
    if (semanticReason) {
      rejected.push(reject(shardId, semanticReason));
      invalidationSources.push(baseShard);
      continue;
    }

    // Exact content and semantic digest equality only; similarity is not a reuse path.
    reused.push(targetShard);
  }

  for (const shardId of [...targetShards.keys()].sort()) {
    if (!baseShards.has(shardId)) {
      diagnostics.push(
        Object.freeze({
          code: 'GRAPH_INCREMENTAL_NEW_SHARD',
          severity: 'info',
          path: shardId,
          message: 'Target manifest declares a shard absent from the reuse base.',
        })
      );
    }
  }

  const invalidation = collectInvalidations(invalidationSources);
  return Object.freeze({
    reused: Object.freeze(reused),
    rejected: Object.freeze(rejected),
    invalidatedProviders: Object.freeze(invalidation.providers),
    invalidatedProjections: Object.freeze(invalidation.projections),
    invalidatedQueryIndexes: Object.freeze(invalidation.queryIndexes),
    invalidatedGraphRegions: Object.freeze(invalidation.graphRegions),
    diagnostics: Object.freeze(diagnostics),
    status: 'complete',
  });
}
