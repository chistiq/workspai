import type {
  GraphContentStateManifest,
  GraphDeltaExecutionAccounting,
  GraphInputChange,
  GraphInputProcessingRecord,
  GraphProviderInput,
} from '../contracts/index.js';

import type { GraphIncrementalAccounting } from './incremental-build-types.js';
import type { GraphInventoryRereadPlan } from './plan-inventory-reread.js';

function fileLocators(manifest: GraphContentStateManifest): Set<string> {
  return new Set(manifest.nodes.filter((node) => node.kind === 'file').map((node) => node.locator));
}

function touchedLocators(changes: readonly GraphInputChange[]): Set<string> {
  const locators = new Set<string>();
  for (const change of changes) {
    locators.add(change.locator);
    if (change.renameCandidate) {
      locators.add(change.renameCandidate.priorLocator);
      locators.add(change.renameCandidate.nextLocator);
    }
  }
  return locators;
}

function countKind(changes: readonly GraphInputChange[], kind: GraphInputChange['kind']): number {
  return changes.filter((change) => change.kind === kind).length;
}

function sumBytes(inputs: readonly GraphProviderInput[]): number {
  return inputs.reduce((total, input) => total + input.byteLength, 0);
}

/**
 * Merkle, leaf, shard and byte accounting that GraphDelta.execution cannot carry
 * without changing the wire schema. Plan-time bytes stay zero until inventory.
 */
export function summarizeIncrementalAccounting(request: {
  readonly comparison: {
    readonly comparedBranches: number;
    readonly skippedBranches: number;
    readonly changedInputs: readonly GraphInputChange[];
  };
  readonly shardReuse: {
    readonly reused: readonly unknown[];
    readonly rejected: readonly unknown[];
  };
  readonly baseManifest: GraphContentStateManifest;
  readonly targetManifest: GraphContentStateManifest;
  readonly hashedInputs?: readonly GraphProviderInput[];
  readonly reusedInputs?: readonly GraphProviderInput[];
}): GraphIncrementalAccounting {
  const touched = touchedLocators(request.comparison.changedInputs);
  const baseFiles = fileLocators(request.baseManifest);
  const targetFiles = fileLocators(request.targetManifest);
  let unchanged = 0;
  for (const locator of baseFiles) {
    if (targetFiles.has(locator) && !touched.has(locator)) {
      unchanged += 1;
    }
  }
  return Object.freeze({
    merkle: Object.freeze({
      comparedBranches: request.comparison.comparedBranches,
      skippedBranches: request.comparison.skippedBranches,
    }),
    leaves: Object.freeze({
      added: countKind(request.comparison.changedInputs, 'added'),
      edited: countKind(request.comparison.changedInputs, 'edited'),
      deleted: countKind(request.comparison.changedInputs, 'deleted'),
      renewed: countKind(request.comparison.changedInputs, 'renewed'),
      renameCandidates: countKind(request.comparison.changedInputs, 'rename-candidate'),
      unchanged,
    }),
    shards: Object.freeze({
      reused: request.shardReuse.reused.length,
      rejected: request.shardReuse.rejected.length,
    }),
    bytes: Object.freeze({
      hashed: sumBytes(request.hashedInputs ?? []),
      reused: sumBytes(request.reusedInputs ?? []),
    }),
  });
}

export function emptyIncrementalAccounting(): GraphIncrementalAccounting {
  return Object.freeze({
    merkle: Object.freeze({ comparedBranches: 0, skippedBranches: 0 }),
    leaves: Object.freeze({
      added: 0,
      edited: 0,
      deleted: 0,
      renewed: 0,
      renameCandidates: 0,
      unchanged: 0,
    }),
    shards: Object.freeze({ reused: 0, rejected: 0 }),
    bytes: Object.freeze({ hashed: 0, reused: 0 }),
  });
}

export function overlayExecutedIncrementalAccounting(request: {
  readonly planned: GraphDeltaExecutionAccounting;
  readonly accounting: GraphIncrementalAccounting;
  readonly hashedInputs: readonly GraphProviderInput[];
  readonly reusedInputs: readonly GraphProviderInput[];
  readonly reread: GraphInventoryRereadPlan;
  readonly thisRunProcessing: readonly GraphInputProcessingRecord[];
  readonly providersExecuted: number;
  readonly unsupportedZones: number;
  readonly failed: boolean;
}): {
  readonly execution: GraphDeltaExecutionAccounting;
  readonly accounting: GraphIncrementalAccounting;
} {
  const processed = request.thisRunProcessing.filter((record) => record.outcome === 'processed');
  const unsupported = request.thisRunProcessing.filter(
    (record) => record.outcome === 'unsupported'
  );
  const failedRecords = request.thisRunProcessing.filter((record) => record.outcome === 'failed');
  return {
    execution: Object.freeze({
      detected: request.planned.detected,
      scanned: request.hashedInputs.length,
      parsed: processed.length,
      recomputed: request.providersExecuted,
      skippedByDigest: request.reread.reusedLocators.length,
      unsupported: unsupported.length + request.unsupportedZones,
      failed: failedRecords.length + (request.failed ? 1 : 0),
      truncation: request.planned.truncation,
      processing: Object.freeze([...request.thisRunProcessing]),
    }),
    accounting: Object.freeze({
      ...request.accounting,
      bytes: Object.freeze({
        hashed: sumBytes(request.hashedInputs),
        reused: sumBytes(request.reusedInputs),
      }),
    }),
  };
}
