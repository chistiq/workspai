import type {
  GraphContentStateManifest,
  GraphDiagnostic,
  GraphInputProcessingRecord,
  GraphProviderInput,
  GraphQueryCacheInvalidation,
} from '../contracts/index.js';
import type { GraphChangeJournalInspection, GraphFileInventoryResult } from '../ports/index.js';

import { recordGraphPhase } from './phase-metrics.js';
import { assessIncrementalBuildEquivalence } from './assess-incremental-build-equivalence.js';
import { buildContentStateManifest } from './build-content-state-manifest.js';
import { buildRepoGraph } from './build-repo-graph.js';
import { buildShardDependenciesFromSources } from './build-shard-dependencies.js';
import { collectGraphSemanticDependencies } from './collect-semantic-dependencies.js';
import { contentStateLeavesFromProviderInputs } from './content-state-manifest-types.js';
import { summarizeCanonicalGraphDelta } from './diff-graph-generations.js';
import { freezeGitWorktreeBaseline } from './git-worktree-baseline.js';
import type {
  GraphIncrementalRepoBuildRequest,
  GraphIncrementalRepoBuildResult,
} from './incremental-repo-build-types.js';
import {
  clampIncrementalSnapshotAttempts,
  compareIncrementalSnapshots,
  contentInventoryIdentityBytes,
  freezeIncrementalSnapshot,
  gitSnapshotFromJournal,
  membershipSnapshotFromLocators,
  snapshotGitBaseline,
  snapshotUnstableDiagnostic,
} from './incremental-snapshot.js';
import {
  admittedInventoryMembershipSnapshot,
  applyInventoryMembership,
  freezeInventoryMembership,
  inventoryMembershipIsComplete,
} from './inventory-membership.js';
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

function executedAsFullDiagnostic(): GraphDiagnostic {
  return Object.freeze({
    code: 'GRAPH_INCREMENTAL_EXECUTED_AS_FULL',
    severity: 'info',
    path: '/incremental/execution',
    message:
      'Incremental rebuild could not reuse prior file digests and executed the full package path.',
  });
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
      omittedBytes: 0,
    }),
  });
}

function fileLocatorsFromManifest(manifest: GraphContentStateManifest): readonly string[] {
  return Object.freeze(
    manifest.nodes.filter((node) => node.kind === 'file').map((node) => node.locator)
  );
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

function failedInventory(cancelled: boolean): GraphFileInventoryResult {
  return {
    status: cancelled ? ('cancelled' as const) : ('failed' as const),
    inputs: [],
    diagnostics: [
      {
        code: cancelled ? 'GRAPH_FILE_INVENTORY_CANCELLED' : 'GRAPH_FILE_INVENTORY_FAILED',
        severity: cancelled ? ('info' as const) : ('error' as const),
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

async function inspectChangeJournal(
  request: GraphIncrementalRepoBuildRequest
): Promise<GraphChangeJournalInspection> {
  if (!request.ports.changeJournal) return absentChangeJournal();
  try {
    return await request.ports.changeJournal.inspect({
      root: request.root,
      signal: request.ports.signal,
      inventoryLocators: fileLocatorsFromManifest(request.baseManifest),
      ...(request.baseGitBaseline ? { base: request.baseGitBaseline } : {}),
    });
  } catch {
    return untrustedChangeJournal(
      'change-journal',
      'Change journal inspection failed and cannot authorize skip-reread.'
    );
  }
}

/**
 * Executes skip-reread inventory, selective provider recomputation, reuse of
 * admitted prior sources, and full-build digest equivalence of the same tree.
 * Git and filesystem membership are observed before and after construction;
 * trusted reuse is stamped only when those receipts match.
 */
export async function buildIncrementalRepoGraph(
  request: GraphIncrementalRepoBuildRequest
): Promise<GraphIncrementalRepoBuildResult> {
  const stamps = await collectGraphSemanticDependencies({
    ontology: request.ontology,
    compositionPolicy: request.policy.composition,
    redactionProfile: request.policy.redactionProfile,
    providerManifests: request.providers.map((provider) => provider.manifest),
    digest: request.ports.digest,
  });
  const registered = request.providers.map((provider) => provider.manifest.id);
  const generatedAt = request.ports.clock.now().toISOString();
  const knownLocators = fileLocatorsFromManifest(request.baseManifest);
  const maxAttempts = clampIncrementalSnapshotAttempts(request.snapshotAttempts);
  const probe = request.ports.snapshotProbe;
  const inventoryBounds = {
    root: request.root,
    maxFiles: request.policy.limits.maxFiles,
    maxTotalBytes: request.policy.limits.maxTotalBytes,
    maxFileBytes: request.policy.limits.maxFileBytes,
    maxDepth: request.policy.limits.maxDepth,
    maxDirectoryEntries: request.policy.limits.maxDirectoryEntries,
    excludedDirectories: request.policy.excludedDirectories,
    sensitiveFiles: request.policy.sensitiveFiles,
    signal: request.ports.signal,
  };

  let journal = absentChangeJournal();
  let inventoryReread = planInventoryReread({
    priorManifest: request.baseManifest,
    journal,
    scanProfileDigestValue: request.scanProfileDigest.value,
  });
  let executeAsFull = true;
  let inventory: GraphFileInventoryResult | undefined;
  let admittedInputs: readonly GraphProviderInput[] = Object.freeze([]);
  let toRecompute: readonly string[] = Object.freeze([]);
  let build: GraphRepoBuildResult | undefined;
  let snapshotConsistency: 'matched' | 'unstable' = 'unstable';
  let stampedGitBaseline: GraphIncrementalRepoBuildResult['gitBaseline'];
  let gitObservationMs = 0;
  let snapshotMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const gitStartedAt = performance.now();
    journal = await inspectChangeJournal(request);
    gitObservationMs += Math.max(0, Math.round(performance.now() - gitStartedAt));
    recordGraphPhase('gitObservation', {
      wallMs: Math.max(0, performance.now() - gitStartedAt),
      invocations: 1,
    });
    await probe?.afterPreObserve?.();
    inventoryReread = planInventoryReread({
      priorManifest: request.baseManifest,
      journal,
      scanProfileDigestValue: request.scanProfileDigest.value,
    });
    executeAsFull = inventoryReread.reusedLocators.length === 0;
    inventory = undefined;
    admittedInputs = Object.freeze([]);
    toRecompute = Object.freeze([]);
    build = undefined;

    if (!executeAsFull) {
      try {
        inventory = await request.ports.fileSource.inventory({
          ...inventoryBounds,
          onlyLocators: inventoryReread.rereadLocators,
          knownLocators,
        });
      } catch {
        inventory = failedInventory(
          request.ports.signal?.aborted === true || request.ports.cancellation.aborted
        );
      }
      await probe?.afterInventory?.();
      const inventoryFailed = inventory.status === 'failed' || inventory.status === 'cancelled';
      if (inventoryFailed) {
        build = failedBuild(inventory.status === 'cancelled' ? 'cancelled' : 'failed', [
          ...inventoryReread.diagnostics,
          ...inventory.diagnostics,
        ]);
        admittedInputs = [];
        toRecompute = Object.freeze([]);
      } else if (!inventoryMembershipIsComplete(inventory)) {
        executeAsFull = true;
      } else {
        inventoryReread = applyInventoryMembership(
          inventoryReread,
          inventory.membershipLocators ?? []
        );
        admittedInputs = mergeIncrementalInventory({
          priorManifest: request.baseManifest,
          reread: inventoryReread,
          inventoried: inventory.inputs,
        });

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
        const inventoryMembershipChanged = planned.comparison.changedInputs.some((change) =>
          ['added', 'deleted', 'rename-candidate'].includes(change.kind)
        );
        toRecompute = inventoryMembershipChanged
          ? Object.freeze([...registered].sort((left, right) => left.localeCompare(right)))
          : providersToExecute(
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

        const planningFailed = planned.status === 'failed';
        build = planningFailed
          ? failedBuild('failed', [
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
              ...(reusedSources.length === request.baseSources.length &&
              request.baseGraph &&
              request.baseCompositionReceipt
                ? {
                    reuseCanonicalBuild: {
                      graph: request.baseGraph,
                      receipt: request.baseCompositionReceipt,
                      ...(request.baseQuality ? { quality: request.baseQuality } : {}),
                    },
                  }
                : {}),
            });
      }
    }

    if (executeAsFull && !build) {
      build = await buildRepoGraph({
        root: request.root,
        scope: request.scope,
        ontology: request.ontology,
        providers: request.providers,
        policy: request.policy,
        ports: request.ports,
      });
      admittedInputs = build.admittedInputs ?? [];
      inventory = {
        status:
          build.status === 'cancelled'
            ? ('cancelled' as const)
            : build.status === 'failed'
              ? ('failed' as const)
              : ('complete' as const),
        inputs: admittedInputs,
        diagnostics: Object.freeze([executedAsFullDiagnostic()]),
        omittedFiles: build.metrics.omittedFiles,
        omittedBytes: build.metrics.omittedBytes,
        unknownZones: [],
        unsupportedZones: [],
        membershipLocators: build.inventoryMembership?.locators,
      };
      toRecompute = Object.freeze([...registered].sort((left, right) => left.localeCompare(right)));
    }

    await probe?.afterBuild?.();
    if (!build || !inventory) {
      continue;
    }

    const membershipLocators =
      executeAsFull && build.inventoryMembership
        ? build.inventoryMembership.locators
        : (inventory.membershipLocators ?? []);
    const membershipComplete =
      executeAsFull && build.inventoryMembership
        ? build.inventoryMembership.complete === true
        : inventoryMembershipIsComplete(inventory);
    const snapshotStartedAt = performance.now();
    const postJournal = await inspectChangeJournal(request);
    let postMembershipComplete = false;
    let postMembershipLocators: readonly string[] = [];
    try {
      const confirmation = await request.ports.fileSource.inventory({
        ...inventoryBounds,
        onlyLocators: [],
        knownLocators: membershipLocators.length > 0 ? membershipLocators : knownLocators,
        membershipProbe: true,
      });
      postMembershipLocators = confirmation.membershipLocators ?? [];
      postMembershipComplete = inventoryMembershipIsComplete(confirmation);
    } catch {
      postMembershipComplete = false;
    }

    const comparison = compareIncrementalSnapshots(
      freezeIncrementalSnapshot({
        git: gitSnapshotFromJournal(journal),
        membership: membershipSnapshotFromLocators(membershipLocators, membershipComplete),
      }),
      freezeIncrementalSnapshot({
        git: gitSnapshotFromJournal(postJournal),
        membership: membershipSnapshotFromLocators(postMembershipLocators, postMembershipComplete),
      })
    );
    snapshotMs += Math.max(0, Math.round(performance.now() - snapshotStartedAt));
    if (comparison.consistent) {
      snapshotConsistency = 'matched';
      const identityBytes = contentInventoryIdentityBytes(admittedInputs);
      const inventoryDigest = request.ports.digest.digestSync
        ? request.ports.digest.digestSync(identityBytes)
        : await request.ports.digest.digest(identityBytes);
      const baseline = snapshotGitBaseline(
        journal,
        request.scanProfileDigest.value,
        inventoryDigest
      );
      stampedGitBaseline = baseline ? freezeGitWorktreeBaseline(baseline) : undefined;
      break;
    }

    if (
      attempt === maxAttempts &&
      !executeAsFull &&
      build.status !== 'failed' &&
      build.status !== 'cancelled'
    ) {
      executeAsFull = true;
      build = await buildRepoGraph({
        root: request.root,
        scope: request.scope,
        ontology: request.ontology,
        providers: request.providers,
        policy: request.policy,
        ports: request.ports,
      });
      admittedInputs = build.admittedInputs ?? [];
      inventory = {
        status:
          build.status === 'cancelled'
            ? ('cancelled' as const)
            : build.status === 'failed'
              ? ('failed' as const)
              : ('complete' as const),
        inputs: admittedInputs,
        diagnostics: Object.freeze([executedAsFullDiagnostic(), snapshotUnstableDiagnostic()]),
        omittedFiles: build.metrics.omittedFiles,
        omittedBytes: build.metrics.omittedBytes,
        unknownZones: [],
        unsupportedZones: [],
        membershipLocators: build.inventoryMembership?.locators,
      };
      toRecompute = Object.freeze([...registered].sort((left, right) => left.localeCompare(right)));
    }
  }

  if (!build || !inventory || !admittedInputs || !toRecompute) {
    throw new Error('Incremental rebuild did not produce an inventory.');
  }

  const executionPath = executeAsFull ? ('full' as const) : ('skip-reread' as const);
  const membership =
    snapshotConsistency === 'matched'
      ? admittedInventoryMembershipSnapshot(
          executeAsFull
            ? build.inventoryMembership
            : freezeInventoryMembership(inventory.membershipLocators, {
                complete: inventoryMembershipIsComplete(inventory),
              })
        )
      : undefined;

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
  const inventoryFailed = inventory.status === 'failed' || inventory.status === 'cancelled';
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
  const snapshotDiagnostics =
    snapshotConsistency === 'unstable' ? [snapshotUnstableDiagnostic()] : [];
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
      ...snapshotDiagnostics,
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
    ...snapshotDiagnostics,
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
    metrics: Object.freeze({
      ...build.metrics,
      gitObservationMs,
      snapshotMs,
    }),
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
    executionPath,
    snapshotConsistency,
    ...(stampedGitBaseline ? { gitBaseline: stampedGitBaseline } : { gitBaseline: undefined }),
    ...(membership ? { inventoryMembership: membership } : { inventoryMembership: undefined }),
    ...(queryCacheInvalidations ? { queryCacheInvalidations } : {}),
  });
}
