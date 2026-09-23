import type { GraphWorkspaceFact } from '../contracts/index.js';

export interface GraphPartitionMetadata {
  readonly factCount: number;
  readonly encodedBytes: number;
  readonly unknownZones: number;
  readonly unsupportedZones: number;
  readonly streaming: false | 'bounded' | 'legacy-array';
}

export interface GraphFactPartition {
  readonly partitionId: string;
  readonly providerId: string;
  readonly sourceIdentity: string;
  readonly sourceDigest: string;
  readonly sequence: number;
  readonly facts: readonly GraphWorkspaceFact[];
  readonly metadata: GraphPartitionMetadata;
}

export interface PartitionWindowLimits {
  readonly maxFacts: number;
  readonly maxBytes: number;
  readonly maxInFlight: number;
}

export function factEncodedBytes(fact: GraphWorkspaceFact): number {
  return Buffer.byteLength(JSON.stringify(fact));
}

/**
 * Pulls facts from an async source and yields one bounded partition at a time.
 * The caller must not retain the previous partition. An array adapter is not
 * memory-bounded; use sliceFactPartitions only when the full array already exists.
 */
export async function* pullFactPartitions(
  facts: AsyncIterable<GraphWorkspaceFact>,
  identity: {
    readonly partitionId: string;
    readonly providerId: string;
    readonly sourceIdentity: string;
    readonly sourceDigest: string;
    readonly streaming: GraphPartitionMetadata['streaming'];
  },
  limits: Pick<PartitionWindowLimits, 'maxFacts' | 'maxBytes'>
): AsyncGenerator<GraphFactPartition, void, void> {
  let sequence = 0;
  let slice: GraphWorkspaceFact[] = [];
  let bytes = 0;
  const flush = (): GraphFactPartition => {
    const partition: GraphFactPartition = {
      partitionId: `${identity.partitionId}:${sequence}`,
      providerId: identity.providerId,
      sourceIdentity: identity.sourceIdentity,
      sourceDigest: identity.sourceDigest,
      sequence,
      facts: slice,
      metadata: {
        factCount: slice.length,
        encodedBytes: bytes,
        unknownZones: 0,
        unsupportedZones: 0,
        streaming: identity.streaming,
      },
    };
    sequence += 1;
    slice = [];
    bytes = 0;
    return partition;
  };
  for await (const fact of facts) {
    const estimate = factEncodedBytes(fact);
    if (
      slice.length > 0 &&
      (slice.length >= limits.maxFacts || bytes + estimate > limits.maxBytes)
    ) {
      yield flush();
    }
    if (estimate > limits.maxBytes && slice.length === 0) throw new Error('partition-limit');
    slice.push(fact);
    bytes += estimate;
  }
  if (slice.length > 0) yield flush();
}

export async function consumePartitions(
  partitions: AsyncIterable<GraphFactPartition>,
  limits: PartitionWindowLimits,
  handle: (partition: GraphFactPartition) => Promise<void>
): Promise<void> {
  const window = new PartitionWindow(limits);
  for await (const partition of partitions) {
    window.admit(partition);
    try {
      await handle(partition);
    } finally {
      window.release();
    }
  }
}

/**
 * Legacy adapter. The input array stays allocated for the whole call.
 * The streaming label is always `legacy-array`.
 */
export async function* sliceFactPartitions(
  facts: readonly GraphWorkspaceFact[],
  identity: {
    readonly partitionId: string;
    readonly providerId: string;
    readonly sourceIdentity: string;
    readonly sourceDigest: string;
    readonly streaming: GraphPartitionMetadata['streaming'];
  },
  limits: Pick<PartitionWindowLimits, 'maxFacts' | 'maxBytes'>
): AsyncGenerator<GraphFactPartition, void, void> {
  async function* existing(): AsyncGenerator<GraphWorkspaceFact, void, void> {
    for (const fact of facts) yield fact;
  }
  yield* pullFactPartitions(existing(), { ...identity, streaming: 'legacy-array' }, limits);
}

export class PartitionWindow {
  private retainedFacts = 0;
  private retainedBytes = 0;
  private readonly inflight: GraphFactPartition[] = [];

  constructor(private readonly limits: PartitionWindowLimits) {}

  admit(partition: GraphFactPartition): void {
    if (
      this.inflight.length >= this.limits.maxInFlight ||
      this.retainedFacts + partition.facts.length > this.limits.maxFacts ||
      this.retainedBytes + partition.metadata.encodedBytes > this.limits.maxBytes
    ) {
      throw new Error('partition-window');
    }
    this.inflight.push(partition);
    this.retainedFacts += partition.facts.length;
    this.retainedBytes += partition.metadata.encodedBytes;
  }

  release(): GraphFactPartition | undefined {
    const partition = this.inflight.shift();
    if (!partition) return undefined;
    this.retainedFacts -= partition.facts.length;
    this.retainedBytes -= partition.metadata.encodedBytes;
    return partition;
  }

  get retainedFactCount(): number {
    return this.retainedFacts;
  }
}
