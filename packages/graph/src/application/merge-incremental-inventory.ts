import type {
  GraphContentStateLeaf,
  GraphContentStateManifest,
  GraphProviderInput,
  GraphShardDependency,
} from '../contracts/index.js';
import { graphInputMediaType } from '../domain/input-media-type.js';
import { shardMembershipLocator } from '../domain/shard-membership.js';

import {
  type GraphIncrementalSemanticStamps,
  semanticDependenciesForShard,
} from './collect-semantic-dependencies.js';
import { mergeShardDigests } from './digest-canonical-graph-input.js';
import type { GraphInventoryRereadPlan } from './plan-inventory-reread.js';

function priorLeaves(manifest: GraphContentStateManifest): Map<string, GraphContentStateLeaf> {
  const files = new Map<string, GraphContentStateLeaf>();
  for (const node of manifest.nodes) {
    if (node.kind === 'file') {
      files.set(node.locator, node);
    }
  }
  return files;
}

export function providerInputFromContentLeaf(leaf: GraphContentStateLeaf): GraphProviderInput {
  return Object.freeze({
    locator: leaf.locator,
    mediaType: graphInputMediaType(leaf.locator),
    byteLength: leaf.observations?.sizeBytes ?? 0,
    digest: leaf.contentDigest,
  });
}

/**
 * Merges trusted prior leaves with freshly hashed reread inputs. Deleted
 * locators stay omitted even if the host still lists them.
 */
export function mergeIncrementalInventory(request: {
  readonly priorManifest: GraphContentStateManifest;
  readonly reread: GraphInventoryRereadPlan;
  readonly inventoried: readonly GraphProviderInput[];
}): readonly GraphProviderInput[] {
  const prior = priorLeaves(request.priorManifest);
  const inventoried = new Map(request.inventoried.map((input) => [input.locator, input]));
  const merged = new Map<string, GraphProviderInput>();

  for (const locator of [...prior.keys()].sort()) {
    const decision = request.reread.decisions[locator];
    if (decision === 'deleted') {
      continue;
    }
    if (decision === 'reuse-prior-digest') {
      const leaf = prior.get(locator);
      if (!leaf) {
        continue;
      }
      if (leaf.observations?.sizeBytes === undefined) {
        const fresh = inventoried.get(locator);
        if (fresh) {
          merged.set(locator, fresh);
        }
        continue;
      }
      merged.set(locator, providerInputFromContentLeaf(leaf));
      continue;
    }
    const fresh = inventoried.get(locator);
    if (fresh) {
      merged.set(locator, fresh);
    }
  }

  for (const input of request.inventoried) {
    if (request.reread.decisions[input.locator] === 'deleted') {
      continue;
    }
    if (!merged.has(input.locator)) {
      merged.set(input.locator, input);
    }
  }

  return Object.freeze(
    [...merged.values()].sort((left, right) => left.locator.localeCompare(right.locator))
  );
}

export function projectShardDependencies(
  base: GraphContentStateManifest,
  inputs: readonly GraphProviderInput[],
  options?: {
    readonly stamps?: GraphIncrementalSemanticStamps;
    readonly registeredProviderIds?: readonly string[];
  }
): readonly GraphShardDependency[] {
  const locators = new Set(inputs.map((input) => input.locator));
  const digestByLocator = new Map(inputs.map((input) => [input.locator, input.digest]));
  const registered = options?.registeredProviderIds
    ? new Set(options.registeredProviderIds)
    : undefined;
  const projected: GraphShardDependency[] = [];
  for (const shard of base.shardDependencies) {
    if (registered && shard.providerStages.some((providerId) => !registered.has(providerId))) {
      continue;
    }
    const locator = shardMembershipLocator(shard.shardId, locators);
    if (!locator) {
      continue;
    }
    const digest = digestByLocator.get(locator);
    if (!digest) {
      continue;
    }
    const stamped = options?.stamps
      ? semanticDependenciesForShard(options.stamps, shard.providerStages)
      : [];
    projected.push(
      Object.freeze({
        ...shard,
        contentDigest: digest,
        semanticDependencies: mergeShardDigests(shard.semanticDependencies, stamped),
      })
    );
  }
  return Object.freeze(projected);
}
