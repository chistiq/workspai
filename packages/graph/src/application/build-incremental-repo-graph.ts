import type { GraphInputProcessingRecord } from '../contracts/index.js';

import { assessIncrementalBuildEquivalence } from './assess-incremental-build-equivalence.js';
import { buildContentStateManifest } from './build-content-state-manifest.js';
import { buildRepoGraph } from './build-repo-graph.js';
import { buildShardDependenciesFromSources } from './build-shard-dependencies.js';
import { contentStateLeavesFromProviderInputs } from './content-state-manifest-types.js';
import type {
  GraphIncrementalRepoBuildRequest,
  GraphIncrementalRepoBuildResult,
} from './incremental-repo-build-types.js';
import { planIncrementalGraphBuild } from './plan-incremental-graph-build.js';

function collectProcessingRecords(
  sources: readonly { batch: { processing: readonly GraphInputProcessingRecord[] } }[]
): readonly GraphInputProcessingRecord[] {
  return Object.freeze(sources.flatMap((source) => [...source.batch.processing]));
}

/**
 * Executes selective provider recomputation, reuses admitted prior sources,
 * emits a target content-state manifest and assesses full-build equivalence.
 */
export async function buildIncrementalRepoGraph(
  request: GraphIncrementalRepoBuildRequest
): Promise<GraphIncrementalRepoBuildResult> {
  const build = await buildRepoGraph({
    ...request,
    compositionReuse: Object.freeze({
      reusedSources: request.baseSources,
      providersToRecompute: request.providersToRecompute,
    }),
  });

  const inventory = await request.ports.fileSource.inventory({
    root: request.root,
    maxFiles: request.policy.limits.maxFiles,
    maxTotalBytes: request.policy.limits.maxTotalBytes,
    maxFileBytes: request.policy.limits.maxFileBytes,
    maxDepth: request.policy.limits.maxDepth,
    maxDirectoryEntries: request.policy.limits.maxDirectoryEntries,
    excludedDirectories: request.policy.excludedDirectories,
    sensitiveFiles: request.policy.sensitiveFiles,
    signal: request.ports.signal,
  });

  const compositionSources = build.compositionSources ?? [];
  const shardDependencies = buildShardDependenciesFromSources(compositionSources);
  const targetManifest = buildContentStateManifest({
    scope: request.scope,
    generatedAt: request.ports.clock.now().toISOString(),
    scanProfileDigest: request.scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(inventory.inputs, request.scanProfileDigest),
    shardDependencies,
  });

  const plan = planIncrementalGraphBuild({
    baseGeneration: request.baseGeneration,
    targetGeneration: request.targetGeneration,
    baseManifest: request.baseManifest,
    targetManifest,
  });

  const equivalence = assessIncrementalBuildEquivalence({
    referenceDigest: request.referenceGenerationDigest,
    candidateDigest: build.graph?.generation.reference.contentDigest,
  });

  const processing = collectProcessingRecords(compositionSources);
  const delta = Object.freeze({
    ...plan.delta,
    execution: Object.freeze({
      ...plan.delta.execution,
      processing,
    }),
    equivalence: equivalence.equivalence,
  });
  const enrichedPlan = Object.freeze({
    ...plan,
    delta,
    diagnostics: Object.freeze([
      ...plan.diagnostics,
      ...equivalence.diagnostics,
      ...build.diagnostics,
    ]),
  });

  return Object.freeze({
    ...build,
    plan: enrichedPlan,
    targetManifest,
    processing,
    equivalence: equivalence.equivalence,
  });
}
