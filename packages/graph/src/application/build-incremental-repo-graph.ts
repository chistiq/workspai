import type { GraphDiagnostic, GraphInputProcessingRecord } from '../contracts/index.js';

import { assessIncrementalBuildEquivalence } from './assess-incremental-build-equivalence.js';
import { buildContentStateManifest } from './build-content-state-manifest.js';
import { buildRepoGraph } from './build-repo-graph.js';
import { buildShardDependenciesFromSources } from './build-shard-dependencies.js';
import { contentStateLeavesFromProviderInputs } from './content-state-manifest-types.js';
import type {
  GraphIncrementalRepoBuildRequest,
  GraphIncrementalRepoBuildResult,
} from './incremental-repo-build-types.js';
import {
  mergeIncrementalInventory,
  projectShardDependencies,
} from './merge-incremental-inventory.js';
import { absentChangeJournal, untrustedChangeJournal } from './parse-git-status-porcelain.js';
import { planIncrementalGraphBuild } from './plan-incremental-graph-build.js';
import { planInventoryReread } from './plan-inventory-reread.js';
import type { GraphRepoBuildResult } from './repo-build-types.js';

function collectProcessingRecords(
  sources: readonly { batch: { processing: readonly GraphInputProcessingRecord[] } }[]
): readonly GraphInputProcessingRecord[] {
  return Object.freeze(sources.flatMap((source) => [...source.batch.processing]));
}

function failedBuild(
  status: 'failed' | 'cancelled',
  diagnostics: readonly GraphDiagnostic[]
): GraphRepoBuildResult {
  return Object.freeze({
    status,
    quality: Object.freeze({
      unknownZones: Object.freeze([]),
      unsupportedZones: Object.freeze([]),
      providerFailures: Object.freeze([]),
    }),
    providers: Object.freeze([]),
    diagnostics,
    metrics: Object.freeze({
      inputFiles: 0,
      inputBytes: 0,
      providerFacts: 0,
      omittedFiles: 0,
    }),
  });
}

function providersToExecute(
  registered: readonly string[],
  derived: readonly string[],
  requested: readonly string[],
  reusable: ReadonlySet<string>
): readonly string[] {
  const toRecompute = new Set([...derived, ...requested]);
  for (const providerId of registered) {
    if (!reusable.has(providerId)) {
      toRecompute.add(providerId);
    }
  }
  return Object.freeze([...toRecompute].sort());
}

/**
 * Executes skip-reread inventory, selective provider recomputation, reuse of
 * admitted prior sources, and full-build digest equivalence of the same tree.
 */
export async function buildIncrementalRepoGraph(
  request: GraphIncrementalRepoBuildRequest
): Promise<GraphIncrementalRepoBuildResult> {
  let journal = absentChangeJournal();
  if (request.ports.changeJournal) {
    try {
      journal = await request.ports.changeJournal.inspect({
        root: request.root,
        signal: request.ports.signal,
      });
    } catch {
      journal = untrustedChangeJournal(
        'change-journal',
        'Change journal inspection failed and cannot authorize skip-reread.'
      );
    }
  }

  const inventoryReread = planInventoryReread({
    priorManifest: request.baseManifest,
    journal,
    scanProfileDigestValue: request.scanProfileDigest.value,
  });

  const inventoryRequest = {
    root: request.root,
    maxFiles: request.policy.limits.maxFiles,
    maxTotalBytes: request.policy.limits.maxTotalBytes,
    maxFileBytes: request.policy.limits.maxFileBytes,
    maxDepth: request.policy.limits.maxDepth,
    maxDirectoryEntries: request.policy.limits.maxDirectoryEntries,
    excludedDirectories: request.policy.excludedDirectories,
    sensitiveFiles: request.policy.sensitiveFiles,
    signal: request.ports.signal,
    ...(inventoryReread.trust === 'trusted'
      ? { onlyLocators: inventoryReread.rereadLocators }
      : {}),
  };

  let inventory;
  try {
    inventory = await request.ports.fileSource.inventory(inventoryRequest);
  } catch {
    inventory = {
      status:
        request.ports.signal?.aborted || request.ports.cancellation.aborted
          ? ('cancelled' as const)
          : ('failed' as const),
      inputs: [],
      diagnostics: [
        {
          code:
            request.ports.signal?.aborted || request.ports.cancellation.aborted
              ? 'GRAPH_FILE_INVENTORY_CANCELLED'
              : 'GRAPH_FILE_INVENTORY_FAILED',
          severity:
            request.ports.signal?.aborted || request.ports.cancellation.aborted
              ? ('info' as const)
              : ('error' as const),
          path: '/inventory',
          message: 'Incremental inventory failed at the admitted host boundary.',
        },
      ],
      omittedFiles: 0,
      omittedBytes: 0,
      unknownZones: [],
      unsupportedZones: [],
    };
  }

  const admittedInputs = mergeIncrementalInventory({
    priorManifest: request.baseManifest,
    reread: inventoryReread,
    inventoried: inventory.inputs,
  });

  const generatedAt = request.ports.clock.now().toISOString();
  const projectedManifest = buildContentStateManifest({
    scope: request.scope,
    generatedAt,
    scanProfileDigest: request.scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(admittedInputs, request.scanProfileDigest),
    shardDependencies: projectShardDependencies(request.baseManifest, admittedInputs),
  });

  const planned = planIncrementalGraphBuild({
    baseGeneration: request.baseGeneration,
    targetGeneration: request.targetGeneration,
    baseManifest: request.baseManifest,
    targetManifest: projectedManifest,
  });

  const registered = request.providers.map((provider) => provider.manifest.id);
  const reusable = new Set(request.baseSources.map((source) => source.manifest.id));
  const toRecompute = providersToExecute(
    registered,
    planned.providersToRecompute,
    request.providersToRecompute,
    reusable
  );
  const reusedSources = Object.freeze(
    request.baseSources.filter((source) => !toRecompute.includes(source.manifest.id))
  );

  const inventoryFailed = inventory.status === 'failed' || inventory.status === 'cancelled';
  const build = inventoryFailed
    ? failedBuild(inventory.status === 'cancelled' ? 'cancelled' : 'failed', [
        ...inventoryReread.diagnostics,
        ...inventory.diagnostics,
      ])
    : await buildRepoGraph({
        ...request,
        admittedInputs,
        compositionReuse: Object.freeze({
          reusedSources,
          providersToRecompute: toRecompute,
        }),
      });

  const compositionSources = build.compositionSources ?? [];
  const shardDependencies = buildShardDependenciesFromSources(compositionSources);
  const targetManifest = buildContentStateManifest({
    scope: request.scope,
    generatedAt,
    scanProfileDigest: request.scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(admittedInputs, request.scanProfileDigest),
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
    affectedProviders: toRecompute,
    execution: Object.freeze({
      ...plan.delta.execution,
      processing,
    }),
    equivalence: equivalence.equivalence,
  });
  const enrichedPlan = Object.freeze({
    ...plan,
    providersToRecompute: toRecompute,
    delta,
    diagnostics: Object.freeze([
      ...inventoryReread.diagnostics,
      ...inventory.diagnostics,
      ...plan.diagnostics,
      ...equivalence.diagnostics,
      ...build.diagnostics,
    ]),
  });

  return Object.freeze({
    ...build,
    quality: Object.freeze({
      ...build.quality,
      unknownZones: Object.freeze([...inventory.unknownZones, ...build.quality.unknownZones]),
      unsupportedZones: Object.freeze([
        ...inventory.unsupportedZones,
        ...build.quality.unsupportedZones,
      ]),
    }),
    plan: enrichedPlan,
    targetManifest,
    processing,
    equivalence: equivalence.equivalence,
    inventoryReread,
  });
}
