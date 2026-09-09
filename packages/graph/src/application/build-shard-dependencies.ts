import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphProviderManifest, GraphShardDependency } from '../contracts/index.js';

import type { GraphCompositionSource } from './composition-types.js';

const PROVIDER_SHARD_METADATA: Readonly<
  Record<string, Pick<GraphShardDependency, 'graphRegions' | 'projections' | 'queryIndexes'>>
> = Object.freeze({
  'workspai.graph.provider.ecmascript-imports': Object.freeze({
    graphRegions: Object.freeze(['imports']),
    projections: Object.freeze(['workspai.graph.projection.dependency']),
    queryIndexes: Object.freeze(['dependency-neighbors']),
  }),
});

function metadataFor(
  manifest: GraphProviderManifest
): Pick<GraphShardDependency, 'graphRegions' | 'projections' | 'queryIndexes'> {
  const known = PROVIDER_SHARD_METADATA[manifest.id];
  if (known) {
    return known;
  }
  return Object.freeze({
    graphRegions: Object.freeze([...manifest.capabilities.factFamilies]),
    projections: Object.freeze([]),
    queryIndexes: Object.freeze([]),
  });
}

/**
 * Derives portable shard dependency records from admitted provider batches.
 */
export function buildShardDependenciesFromSources(
  sources: readonly GraphCompositionSource[]
): GraphShardDependency[] {
  const shards: GraphShardDependency[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const metadata = metadataFor(source.manifest);
    for (const record of source.batch.processing) {
      const shardId = `shard:${record.stage.id}:${record.input.locator}`;
      if (seen.has(shardId)) {
        continue;
      }
      seen.add(shardId);
      const semanticDependencies: WisDigestReference[] = [];
      if (record.priorDigest) {
        semanticDependencies.push(record.priorDigest);
      }
      if (record.outputDigest && record.outputDigest.value !== record.input.digest.value) {
        semanticDependencies.push(record.outputDigest);
      }
      shards.push(
        Object.freeze({
          shardId,
          contentDigest: record.input.digest,
          semanticDependencies: Object.freeze(semanticDependencies),
          providerStages: Object.freeze([source.manifest.id]),
          graphRegions: metadata.graphRegions,
          projections: metadata.projections,
          queryIndexes: metadata.queryIndexes,
        })
      );
    }
  }

  return shards.sort((left, right) => left.shardId.localeCompare(right.shardId));
}
