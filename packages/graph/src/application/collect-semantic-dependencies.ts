import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphOntologyProfile, GraphProviderManifest } from '../contracts/index.js';
import type { GraphDigestPort } from '../ports/index.js';

import type { GraphCompositionPolicy } from './composition-types.js';
import {
  digestCanonicalGraphInput,
  mergeShardDigests,
  shardDigest,
} from './digest-canonical-graph-input.js';

export interface GraphSemanticDependencyRequest {
  readonly ontology: GraphOntologyProfile;
  readonly compositionPolicy: GraphCompositionPolicy;
  readonly redactionProfile: string;
  readonly providerManifests: readonly GraphProviderManifest[];
  readonly digest: GraphDigestPort;
}

export interface GraphIncrementalSemanticStamps {
  readonly ontology: WisDigestReference;
  readonly proofPolicy: WisDigestReference;
  readonly redaction: WisDigestReference;
  readonly compositionPolicy: WisDigestReference;
  readonly providers: Readonly<Record<string, WisDigestReference>>;
  readonly required: readonly WisDigestReference[];
}

/**
 * Collects exact semantic-dependency digests that shard reuse must carry.
 * Ontology and proof-policy material matches composition generation digests.
 */
export async function collectGraphSemanticDependencies(
  request: GraphSemanticDependencyRequest
): Promise<GraphIncrementalSemanticStamps> {
  const ontology = shardDigest(await digestCanonicalGraphInput(request.ontology, request.digest));
  const proofPolicy = shardDigest(
    await digestCanonicalGraphInput(
      request.ontology.relations.map((relation) => relation.proofPolicy),
      request.digest
    )
  );
  const redaction = shardDigest(
    await digestCanonicalGraphInput(request.redactionProfile, request.digest)
  );
  const compositionPolicy = shardDigest(
    await digestCanonicalGraphInput(request.compositionPolicy, request.digest)
  );
  const providers: Record<string, WisDigestReference> = {};
  for (const manifest of [...request.providerManifests].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    providers[manifest.id] = shardDigest(await digestCanonicalGraphInput(manifest, request.digest));
  }
  return Object.freeze({
    ontology,
    proofPolicy,
    redaction,
    compositionPolicy,
    providers: Object.freeze(providers),
    required: mergeShardDigests([ontology, proofPolicy, redaction, compositionPolicy]),
  });
}

export function semanticDependenciesForShard(
  stamps: GraphIncrementalSemanticStamps,
  providerIds: readonly string[]
): readonly WisDigestReference[] {
  const providerDigests = providerIds
    .map((providerId) => stamps.providers[providerId])
    .filter((digest): digest is WisDigestReference => Boolean(digest));
  return mergeShardDigests([
    stamps.ontology,
    stamps.proofPolicy,
    stamps.redaction,
    stamps.compositionPolicy,
    ...providerDigests,
  ]);
}
