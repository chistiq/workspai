import type { GraphProviderManifest, GraphShardDependency } from '../contracts/index.js';

import {
  type GraphIncrementalSemanticStamps,
  semanticDependenciesForShard,
} from './collect-semantic-dependencies.js';
import type { GraphCompositionSource } from './composition-types.js';
import { mergeShardDigests } from './digest-canonical-graph-input.js';

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
 * Optional semantic stamps are unioned onto each shard so ontology, proof,
 * redaction, composition-policy and provider-manifest drift cannot reuse.
 */
export function buildShardDependenciesFromSources(
  sources: readonly GraphCompositionSource[],
  stamps?: GraphIncrementalSemanticStamps
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
      const processing = [
        ...(record.priorDigest ? [record.priorDigest] : []),
        ...(record.outputDigest && record.outputDigest.value !== record.input.digest.value
          ? [record.outputDigest]
          : []),
      ];
      const stamped = stamps ? semanticDependenciesForShard(stamps, [source.manifest.id]) : [];
      shards.push(
        Object.freeze({
          shardId,
          contentDigest: record.input.digest,
          semanticDependencies: mergeShardDigests(processing, stamped),
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
