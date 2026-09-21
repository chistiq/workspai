/**
 * Low-overhead build-phase timings. Metrics never participate in graph identity,
 * canonical digests, or admission. Each build owns an isolated accumulator via
 * the execution context; concurrent builds cannot clear or contaminate each other.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const GRAPH_REPO_PHASE_NAMES = [
  'inventory',
  'gitObservation',
  'fileRead',
  'contentHash',
  'languageClassification',
  'parse',
  'extract',
  'moduleResolution',
  'frameworkBinding',
  'providerAdmission',
  'factCanonicalization',
  'factDeduplication',
  'composition',
  'graphIndexConstruction',
  'contentDigest',
  'nodeNativeBoundary',
] as const;

export type GraphRepoPhaseName = (typeof GRAPH_REPO_PHASE_NAMES)[number];

export interface GraphRepoPhaseTiming {
  readonly phase: GraphRepoPhaseName;
  readonly wallMs: number;
  readonly invocations: number;
  readonly files: number;
  readonly bytes: number;
  readonly facts: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

interface MutablePhaseTiming {
  wallMs: number;
  invocations: number;
  files: number;
  bytes: number;
  facts: number;
  cacheHits: number;
  cacheMisses: number;
}

export class GraphPhaseAccumulator {
  private readonly session = new Map<GraphRepoPhaseName, MutablePhaseTiming>();

  record(
    phase: GraphRepoPhaseName,
    delta: {
      readonly wallMs?: number;
      readonly invocations?: number;
      readonly files?: number;
      readonly bytes?: number;
      readonly facts?: number;
      readonly cacheHits?: number;
      readonly cacheMisses?: number;
    }
  ): void {
    const entry = this.bucket(phase);
    entry.wallMs += Math.max(0, delta.wallMs ?? 0);
    entry.invocations += Math.max(0, delta.invocations ?? 1);
    entry.files += Math.max(0, delta.files ?? 0);
    entry.bytes += Math.max(0, delta.bytes ?? 0);
    entry.facts += Math.max(0, delta.facts ?? 0);
    entry.cacheHits += Math.max(0, delta.cacheHits ?? 0);
    entry.cacheMisses += Math.max(0, delta.cacheMisses ?? 0);
  }

  timings(): readonly GraphRepoPhaseTiming[] {
    return Object.freeze(
      GRAPH_REPO_PHASE_NAMES.filter((phase) => this.session.has(phase)).map((phase) => {
        const entry = this.session.get(phase);
        return Object.freeze({
          phase,
          wallMs: Math.max(0, Math.round(entry?.wallMs ?? 0)),
          invocations: entry?.invocations ?? 0,
          files: entry?.files ?? 0,
          bytes: entry?.bytes ?? 0,
          facts: entry?.facts ?? 0,
          cacheHits: entry?.cacheHits ?? 0,
          cacheMisses: entry?.cacheMisses ?? 0,
        });
      })
    );
  }

  clear(): void {
    this.session.clear();
  }

  private bucket(phase: GraphRepoPhaseName): MutablePhaseTiming {
    const existing = this.session.get(phase);
    if (existing) return existing;
    const created: MutablePhaseTiming = {
      wallMs: 0,
      invocations: 0,
      files: 0,
      bytes: 0,
      facts: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    this.session.set(phase, created);
    return created;
  }
}

const storage = new AsyncLocalStorage<GraphPhaseAccumulator>();

export function createGraphPhaseAccumulator(): GraphPhaseAccumulator {
  return new GraphPhaseAccumulator();
}

export function runWithGraphPhaseSession<T>(
  fn: () => T,
  accumulator: GraphPhaseAccumulator = createGraphPhaseAccumulator()
): T {
  return storage.run(accumulator, fn);
}

export function beginGraphPhaseSession(): GraphPhaseAccumulator {
  const current = storage.getStore();
  if (current) {
    current.clear();
    return current;
  }
  return createGraphPhaseAccumulator();
}

export function recordGraphPhase(
  phase: GraphRepoPhaseName,
  delta: {
    readonly wallMs?: number;
    readonly invocations?: number;
    readonly files?: number;
    readonly bytes?: number;
    readonly facts?: number;
    readonly cacheHits?: number;
    readonly cacheMisses?: number;
  }
): void {
  storage.getStore()?.record(phase, delta);
}

export function graphPhaseTimings(): readonly GraphRepoPhaseTiming[] {
  return storage.getStore()?.timings() ?? Object.freeze([]);
}
