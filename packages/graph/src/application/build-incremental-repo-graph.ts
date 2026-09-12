import type {
  GraphDiagnostic,
  GraphInputProcessingRecord,
  GraphQueryCacheInvalidation,
} from '../contracts/index.js';

import { assessIncrementalBuildEquivalence } from './assess-incremental-build-equivalence.js';
import { buildContentStateManifest } from './build-content-state-manifest.js';
import { buildRepoGraph } from './build-repo-graph.js';
import { buildShardDependenciesFromSources } from './build-shard-dependencies.js';
import { collectGraphSemanticDependencies } from './collect-semantic-dependencies.js';
import { contentStateLeavesFromProviderInputs } from './content-state-manifest-types.js';
import { summarizeCanonicalGraphDelta } from './diff-graph-generations.js';
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
import { planQueryCacheInvalidation } from './plan-query-cache-invalidation.js';
import {
  addedInputLocators,
  providersRequiredForAddedInputs,
} from './providers-required-for-added-inputs.js';
import { applyQueryCacheInvalidations } from './query-cache.js';
import type { GraphRepoBuildResult } from './repo-build-types.js';
import { overlayExecutedIncrementalAccounting } from './summarize-incremental-accounting.js';

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

  const stamps = await collectGraphSemanticDependencies({
    ontology: request.ontology,
    compositionPolicy: request.policy.composition,
    redactionProfile: request.policy.redactionProfile,
    providerManifests: request.providers.map((provider) => provider.manifest),
    digest: request.ports.digest,
  });
  const registered = request.providers.map((provider) => provider.manifest.id);

  const generatedAt = request.ports.clock.now().toISOString();
  const projectedManifest = buildContentStateManifest({
    scope: request.scope,
    generatedAt,
    scanProfileDigest: request.scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(admittedInputs, request.scanProfileDigest),
    shardDependencies: projectShardDependencies(request.baseManifest, admittedInputs, {
      stamps,
      registeredProviderIds: registered,
    }),
  });

  const planned = planIncrementalGraphBuild({
    baseGeneration: request.baseGeneration,
    targetGeneration: request.targetGeneration,
    baseManifest: request.baseManifest,
    targetManifest: projectedManifest,
    requiredSemanticDependencies: stamps.required,
    semanticStamps: stamps,
  });

  const reusable = new Set(request.baseSources.map((source) => source.manifest.id));
  const addedRequired = await providersRequiredForAddedInputs({
    providers: request.providers,
    addedLocators: addedInputLocators(planned.comparison.changedInputs),
    scopeKind: request.scope.kind === 'workspace' ? 'workspace' : 'project',
    networkAllowed: request.policy.network === 'allow',
  });
  const toRecompute = providersToExecute(
    registered,
    [
      ...planned.providersToRecompute,
      ...addedRequired,
      ...(planned.status === 'partial' ? registered : []),
    ],
    request.providersToRecompute,
    reusable
  );
  const reusedSources = Object.freeze(
    request.baseSources.filter((source) => !toRecompute.includes(source.manifest.id))
  );

  const inventoryFailed = inventory.status === 'failed' || inventory.status === 'cancelled';
  const planningFailed = planned.status === 'failed';
  const build =
    inventoryFailed || planningFailed
      ? failedBuild(inventory.status === 'cancelled' ? 'cancelled' : 'failed', [
          ...inventoryReread.diagnostics,
          ...inventory.diagnostics,
          ...planned.diagnostics,
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
  const shardDependencies = buildShardDependenciesFromSources(compositionSources, stamps);
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
    requiredSemanticDependencies: stamps.required,
    semanticStamps: stamps,
  });

  const equivalence = assessIncrementalBuildEquivalence({
    referenceDigest: request.referenceGenerationDigest,
    candidateDigest: build.graph?.generation.reference.contentDigest,
  });

  const processing = collectProcessingRecords(compositionSources);
  const thisRunProcessing = Object.freeze(
    compositionSources
      .filter((source) => toRecompute.includes(source.manifest.id))
      .flatMap((source) => [...source.batch.processing])
  );
  const reusedInputs = admittedInputs.filter(
    (input) => inventoryReread.decisions[input.locator] === 'reuse-prior-digest'
  );
  const executed = overlayExecutedIncrementalAccounting({
    planned: plan.delta.execution,
    accounting: plan.accounting,
    hashedInputs: inventory.inputs,
    reusedInputs,
    reread: inventoryReread,
    thisRunProcessing,
    providersExecuted: inventoryFailed ? 0 : toRecompute.length,
    unsupportedZones: inventory.unsupportedZones.length + build.quality.unsupportedZones.length,
    failed: build.status === 'failed' || build.status === 'cancelled',
  });
  const generationDelta =
    request.baseGraph && build.graph
      ? summarizeCanonicalGraphDelta(request.baseGraph, build.graph)
      : { graph: plan.delta.graph, facts: plan.delta.facts };
  const delta = Object.freeze({
    ...plan.delta,
    graph: generationDelta.graph,
    facts: generationDelta.facts,
    affectedProviders: toRecompute,
    execution: executed.execution,
    equivalence: equivalence.equivalence,
  });
  const queryCacheDiagnostics: GraphDiagnostic[] = [];
  let queryCacheInvalidations: readonly GraphQueryCacheInvalidation[] | undefined;
  if (request.queryCache) {
    queryCacheInvalidations = planQueryCacheInvalidation({
      entries: request.queryCache.entries,
      delta,
      currentOntologyDigest: build.graph?.generation.ontologySetDigest,
      currentProofPolicyDigest: build.graph?.generation.proofPolicySetDigest,
      currentRedactionDigest: request.queryCache.policy?.redactionPolicyDigest,
      currentAuthorizationDigest: request.queryCache.policy?.authorizationDigest,
      currentProfileDigest: request.queryCache.policy?.profileDigest,
      currentScope: request.queryCache.policy?.scope ?? request.scope,
    });
    try {
      await applyQueryCacheInvalidations({
        store: request.queryCache.store,
        invalidations: queryCacheInvalidations,
      });
    } catch {
      queryCacheDiagnostics.push(
        Object.freeze({
          code: 'GRAPH_QUERY_CACHE_INVALIDATION_FAILED',
          severity: 'warning' as const,
          path: '/queryCache',
          message:
            'Query-cache invalidation failed; live query execution remains the correctness path.',
        })
      );
    }
  }
  const enrichedPlan = Object.freeze({
    ...plan,
    providersToRecompute: toRecompute,
    delta,
    accounting: executed.accounting,
    diagnostics: Object.freeze([
      ...inventoryReread.diagnostics,
      ...inventory.diagnostics,
      ...plan.diagnostics,
      ...equivalence.diagnostics,
      ...build.diagnostics,
      ...queryCacheDiagnostics,
    ]),
  });

  const equivalenceBlocked = equivalence.equivalence === 'blocked';
  const incrementalPartial = plan.status === 'partial';
  const incrementalFailed = plan.status === 'failed';
  const finalStatus =
    equivalenceBlocked || incrementalFailed
      ? ('failed' as const)
      : incrementalPartial
        ? ('partial' as const)
        : build.status;
  const finalDiagnostics = Object.freeze([
    ...build.diagnostics,
    ...equivalence.diagnostics,
    ...queryCacheDiagnostics,
  ]);
  const graphQuality = build.quality.graph
    ? Object.freeze({
        ...build.quality.graph,
        integrity:
          equivalenceBlocked || incrementalFailed
            ? ('blocked' as const)
            : incrementalPartial && build.quality.graph.integrity === 'pass'
              ? ('attention' as const)
              : build.quality.graph.integrity,
        incrementalEquivalence: equivalence.equivalence,
        releaseClaims:
          equivalenceBlocked || incrementalPartial || incrementalFailed
            ? Object.freeze(
                build.quality.graph.releaseClaims.filter(
                  (claim) => claim !== 'publishable' && claim !== 'release-ready'
                )
              )
            : build.quality.graph.releaseClaims,
      })
    : undefined;

  return Object.freeze({
    ...build,
    status: finalStatus,
    diagnostics: finalDiagnostics,
    quality: Object.freeze({
      ...build.quality,
      ...(graphQuality ? { graph: graphQuality } : {}),
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
    ...(queryCacheInvalidations ? { queryCacheInvalidations } : {}),
  });
}
