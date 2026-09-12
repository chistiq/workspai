import {
  GRAPH_CHANGE_SET_CONTRACT,
  GRAPH_DELTA_CONTRACT,
  type GraphChangeCause,
  type GraphContentStateComparisonResult,
  type GraphContentStateManifest,
  type GraphDiagnostic,
  type GraphShardReuseDecision,
  type GraphShardReusePlan,
} from '../contracts/index.js';

import type { GraphIncrementalSemanticStamps } from './collect-semantic-dependencies.js';
import { compareContentStateManifests } from './compare-content-state-manifest.js';
import type {
  GraphIncrementalBuildPlan,
  GraphIncrementalBuildRequest,
} from './incremental-build-types.js';
import { planShardReuseAndInvalidation } from './plan-shard-reuse.js';
import {
  emptyIncrementalAccounting,
  summarizeIncrementalAccounting,
} from './summarize-incremental-accounting.js';

function mergeDiagnostics(
  ...groups: readonly (readonly GraphDiagnostic[])[]
): readonly GraphDiagnostic[] {
  return Object.freeze(groups.flat());
}

function mergeCauses(
  ...groups: readonly (readonly GraphChangeCause[])[]
): readonly GraphChangeCause[] {
  const seen = new Set<string>();
  const causes: GraphChangeCause[] = [];
  for (const group of groups) {
    for (const cause of group) {
      const key = `${cause.kind}:${cause.source}:${cause.detail ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      causes.push(cause);
    }
  }
  return Object.freeze(causes);
}

const CONTENT_REJECTION = new Set([
  'content-changed',
  'content-incompatible',
  'missing-target-shard',
]);
const SEMANTIC_REJECTION = new Set([
  'semantic-incompatible',
  'missing-semantic-dependency',
  'extra-semantic-dependency',
]);

function digestPresent(
  manifest: GraphContentStateManifest,
  digest: { readonly algorithm: string; readonly value: string }
): boolean {
  return manifest.shardDependencies.some((shard) =>
    shard.semanticDependencies.some(
      (entry) => entry.algorithm === digest.algorithm && entry.value === digest.value
    )
  );
}

function shardReuseCauses(
  rejected: readonly GraphShardReuseDecision[],
  baseManifest: GraphContentStateManifest,
  stamps: GraphIncrementalSemanticStamps | undefined
): readonly GraphChangeCause[] {
  if (rejected.length === 0) {
    return Object.freeze([]);
  }
  const causes: GraphChangeCause[] = [];
  if (rejected.some((entry) => entry.reason && CONTENT_REJECTION.has(entry.reason))) {
    causes.push(Object.freeze({ kind: 'content', source: 'shard-reuse-planning' }));
  }
  if (rejected.some((entry) => entry.reason === 'unauthorized-shard')) {
    causes.push(Object.freeze({ kind: 'authorization', source: 'shard-reuse-planning' }));
  }
  const semanticRejected = rejected.some(
    (entry) => entry.reason && SEMANTIC_REJECTION.has(entry.reason)
  );
  if (semanticRejected && stamps) {
    if (!digestPresent(baseManifest, stamps.ontology)) {
      causes.push(Object.freeze({ kind: 'ontology', source: 'shard-reuse-planning' }));
    }
    if (!digestPresent(baseManifest, stamps.proofPolicy)) {
      causes.push(Object.freeze({ kind: 'proof-policy', source: 'shard-reuse-planning' }));
    }
    if (!digestPresent(baseManifest, stamps.redaction)) {
      causes.push(Object.freeze({ kind: 'redaction', source: 'shard-reuse-planning' }));
    }
    if (!digestPresent(baseManifest, stamps.compositionPolicy)) {
      causes.push(
        Object.freeze({
          kind: 'schema',
          source: 'shard-reuse-planning',
          detail: 'composition-policy',
        })
      );
    }
    const providerChanged = Object.entries(stamps.providers).some(([providerId, digest]) =>
      baseManifest.shardDependencies.some(
        (shard) =>
          shard.providerStages.includes(providerId) &&
          !shard.semanticDependencies.some(
            (entry) => entry.algorithm === digest.algorithm && entry.value === digest.value
          )
      )
    );
    if (providerChanged) {
      causes.push(Object.freeze({ kind: 'provider', source: 'shard-reuse-planning' }));
    }
    if (
      !causes.some((cause) =>
        ['ontology', 'proof-policy', 'redaction', 'schema', 'provider'].includes(cause.kind)
      )
    ) {
      causes.push(Object.freeze({ kind: 'unknown', source: 'shard-reuse-planning' }));
    }
  } else if (semanticRejected) {
    causes.push(Object.freeze({ kind: 'unknown', source: 'shard-reuse-planning' }));
  }
  return Object.freeze(causes);
}

function resolveStatus(
  comparisonStatus: GraphContentStateComparisonResult['status'],
  shardStatus: GraphShardReusePlan['status']
): GraphIncrementalBuildPlan['status'] {
  if (comparisonStatus === 'failed') {
    return 'failed';
  }
  if (comparisonStatus === 'partial' || shardStatus === 'partial') {
    return 'partial';
  }
  return 'complete';
}

/**
 * Orchestrates content comparison, shard reuse planning and GraphDelta emission
 * without performing provider recomputation or mutating canonical graph truth.
 */
export function planIncrementalGraphBuild(
  request: GraphIncrementalBuildRequest
): GraphIncrementalBuildPlan {
  const comparison = compareContentStateManifests({
    base: request.baseManifest,
    target: request.targetManifest,
    budget: request.comparisonBudget,
  });

  if (comparison.status === 'failed') {
    const changeSet = Object.freeze({
      contract: GRAPH_CHANGE_SET_CONTRACT,
      id: `changeset:${request.targetGeneration}`,
      baseGeneration: request.baseGeneration,
      inputs: Object.freeze([]),
      causes: comparison.causes,
    });
    const delta = Object.freeze({
      contract: GRAPH_DELTA_CONTRACT,
      baseGeneration: request.baseGeneration,
      targetGeneration: request.targetGeneration,
      changedInputs: Object.freeze([]),
      affectedProviders: Object.freeze([]),
      facts: Object.freeze({
        added: Object.freeze([]),
        renewed: Object.freeze([]),
        removed: Object.freeze([]),
        invalidated: Object.freeze([]),
      }),
      graph: Object.freeze({
        addedNodes: Object.freeze([]),
        removedNodes: Object.freeze([]),
        changedNodes: Object.freeze([]),
        changedEdges: Object.freeze([]),
        addedAssertions: Object.freeze([]),
        removedAssertions: Object.freeze([]),
        changedAssertions: Object.freeze([]),
      }),
      affectedProjections: Object.freeze([]),
      downstreamInvalidations: Object.freeze([]),
      execution: Object.freeze({
        detected: 0,
        scanned: 0,
        parsed: 0,
        recomputed: 0,
        skippedByDigest: 0,
        unsupported: 0,
        failed: 1,
        truncation: comparison.truncation
          ? Object.freeze([comparison.truncation])
          : Object.freeze([]),
        processing: Object.freeze([]),
      }),
      equivalence: 'not-assessed' as const,
    });
    const shardReuse = Object.freeze({
      reused: Object.freeze([]),
      rejected: Object.freeze([]),
      invalidatedProviders: Object.freeze([]),
      invalidatedProjections: Object.freeze([]),
      invalidatedQueryIndexes: Object.freeze([]),
      invalidatedGraphRegions: Object.freeze([]),
      diagnostics: Object.freeze([]),
      status: 'failed' as const,
    });
    return Object.freeze({
      status: 'failed',
      changeSet,
      delta,
      comparison,
      shardReuse,
      providersToRecompute: Object.freeze([]),
      accounting: emptyIncrementalAccounting(),
      diagnostics: comparison.diagnostics,
    });
  }

  const shardReuse = planShardReuseAndInvalidation({
    base: request.baseManifest,
    target: request.targetManifest,
    changedInputs: comparison.changedInputs,
    requiredSemanticDependencies: request.requiredSemanticDependencies,
    authorizedShardIds: request.authorizedShardIds,
  });

  const providersToRecompute = Object.freeze([...shardReuse.invalidatedProviders].sort());
  const downstreamInvalidations = Object.freeze(
    shardReuse.invalidatedQueryIndexes.map((index) => `query-cache:${index}`).sort()
  );
  const changeSet = Object.freeze({
    contract: GRAPH_CHANGE_SET_CONTRACT,
    id: `changeset:${request.targetGeneration}`,
    baseGeneration: request.baseGeneration,
    inputs: comparison.changedInputs,
    causes: mergeCauses(
      comparison.causes,
      shardReuseCauses(shardReuse.rejected, request.baseManifest, request.semanticStamps)
    ),
  });
  const delta = Object.freeze({
    contract: GRAPH_DELTA_CONTRACT,
    baseGeneration: request.baseGeneration,
    targetGeneration: request.targetGeneration,
    changedInputs: comparison.changedInputs,
    affectedProviders: providersToRecompute,
    facts: Object.freeze({
      added: Object.freeze([]),
      renewed: Object.freeze([]),
      removed: Object.freeze([]),
      invalidated: Object.freeze([]),
    }),
    graph: Object.freeze({
      addedNodes: Object.freeze([]),
      removedNodes: Object.freeze([]),
      changedNodes: Object.freeze([]),
      changedEdges: Object.freeze([]),
      addedAssertions: Object.freeze([]),
      removedAssertions: Object.freeze([]),
      changedAssertions: Object.freeze([]),
    }),
    affectedProjections: Object.freeze([...shardReuse.invalidatedProjections]),
    downstreamInvalidations,
    execution: Object.freeze({
      detected: comparison.changedInputs.length,
      scanned: 0,
      parsed: 0,
      recomputed: shardReuse.rejected.length,
      skippedByDigest: shardReuse.reused.length,
      unsupported: 0,
      failed: 0,
      truncation: comparison.truncation
        ? Object.freeze([comparison.truncation])
        : Object.freeze([]),
      processing: Object.freeze([]),
    }),
    equivalence: 'not-assessed' as const,
  });

  return Object.freeze({
    status: resolveStatus(comparison.status, shardReuse.status),
    changeSet,
    delta,
    comparison,
    shardReuse,
    providersToRecompute,
    accounting: summarizeIncrementalAccounting({
      comparison,
      shardReuse,
      baseManifest: request.baseManifest,
      targetManifest: request.targetManifest,
    }),
    diagnostics: mergeDiagnostics(comparison.diagnostics, shardReuse.diagnostics),
  });
}
