/**
 * Low-overhead counters for how many times admitted material is cloned,
 * frozen, schema-walked, canonicalized, hashed, or transferred. Retained-byte
 * records are the current estimated total for a kind, not process RSS.
 * Counters never participate in graph identity. Absent a session they are no-ops.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const GRAPH_DATA_MOVEMENT_OPS = [
  'allocated',
  'cloned',
  'frozen',
  'schemaWalked',
  'canonicalized',
  'serialized',
  'sorted',
  'deduplicated',
  'hashed',
  'indexed',
  'workerTransferred',
  'nativeBoundary',
] as const;

export type GraphDataMovementOp = (typeof GRAPH_DATA_MOVEMENT_OPS)[number];

export interface GraphDataMovementSnapshot {
  readonly ops: Readonly<Record<GraphDataMovementOp, number>>;
  readonly retainedBytes: Readonly<Record<string, number>>;
}

class GraphDataMovementAccumulator {
  private readonly ops = Object.fromEntries(GRAPH_DATA_MOVEMENT_OPS.map((op) => [op, 0])) as Record<
    GraphDataMovementOp,
    number
  >;
  private readonly retainedBytes = new Map<string, number>();

  record(op: GraphDataMovementOp, count = 1): void {
    this.ops[op] += Math.max(0, count);
  }

  retain(kind: string, bytes: number): void {
    this.retainedBytes.set(kind, Math.max(0, bytes));
  }

  snapshot(): GraphDataMovementSnapshot {
    return Object.freeze({
      ops: Object.freeze({ ...this.ops }),
      retainedBytes: Object.freeze(Object.fromEntries([...this.retainedBytes.entries()].sort())),
    });
  }
}

const storage = new AsyncLocalStorage<GraphDataMovementAccumulator>();

export function createGraphDataMovementAccumulator(): GraphDataMovementAccumulator {
  return new GraphDataMovementAccumulator();
}

export function runWithGraphDataMovementSession<T>(
  fn: () => T,
  accumulator: GraphDataMovementAccumulator = createGraphDataMovementAccumulator()
): T {
  return storage.run(accumulator, fn);
}

export function recordGraphDataMovement(op: GraphDataMovementOp, count = 1): void {
  storage.getStore()?.record(op, count);
}

/** Records the current estimated retained total for `kind`, not a cumulative allocation counter. */
export function recordGraphRetainedBytes(kind: string, bytes: number): void {
  storage.getStore()?.retain(kind, bytes);
}

export function graphDataMovementSnapshot(): GraphDataMovementSnapshot | undefined {
  return storage.getStore()?.snapshot();
}
