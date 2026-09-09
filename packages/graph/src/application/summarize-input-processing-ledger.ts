import type {
  GraphDeltaExecutionAccounting,
  GraphInputProcessingOutcome,
  GraphInputProcessingRecord,
} from '../contracts/index.js';

export type GraphInputProcessingLedger = Readonly<Record<GraphInputProcessingOutcome, number>>;

const EMPTY_LEDGER: GraphInputProcessingLedger = Object.freeze({
  processed: 0,
  unchanged: 0,
  excluded: 0,
  unsupported: 0,
  omitted: 0,
  failed: 0,
  deleted: 0,
});

/**
 * Summarizes per-provider/per-stage processing records without inferring
 * canonical fact identifiers.
 */
export function summarizeInputProcessingLedger(
  records: readonly GraphInputProcessingRecord[]
): GraphInputProcessingLedger {
  const counts: Record<GraphInputProcessingOutcome, number> = { ...EMPTY_LEDGER };
  for (const record of records) {
    counts[record.outcome] += 1;
  }
  return Object.freeze(counts);
}

export function summarizeDeltaProcessingLedger(
  execution: GraphDeltaExecutionAccounting
): GraphInputProcessingLedger {
  return summarizeInputProcessingLedger(execution.processing);
}
