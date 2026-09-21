import type { WisDigestReference } from '@workspai/shared/contracts';

import { streamCanonicalGraphValue } from '../conformance/canonical-value.js';
import type { GraphCancellationPort, GraphDigestPort } from '../ports/index.js';
import { recordGraphDataMovement } from './data-movement.js';

const STREAMING_FALLBACK_BYTES = 16 * 1024 * 1024;

/**
 * Digests canonical JSON through the injected SHA-256 port. Same material as
 * composition generation semantic digests, without extra digest fields that
 * content-state shard records cannot carry.
 *
 * Large inputs are hashed incrementally. They are not capped by worker
 * transport budgets; pass maxBytes only when the caller is bounding a payload.
 */
export async function digestCanonicalGraphInput(
  input: unknown,
  digest: GraphDigestPort,
  options: {
    readonly maxBytes?: number;
    readonly maxValues?: number;
    readonly cancellation?: GraphCancellationPort;
    readonly yield?: () => void | Promise<void>;
  } = {}
): Promise<WisDigestReference> {
  if (digest.algorithm !== 'sha256') {
    throw new Error('Graph digest port must implement SHA-256.');
  }
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
    throw new Error('Graph digest byte budget must be a positive safe integer.');
  }

  const streamOptions = {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(options.maxValues === undefined ? {} : { maxValues: options.maxValues }),
    ...(options.cancellation
      ? { throwIfAborted: () => options.cancellation?.throwIfAborted() }
      : {}),
    ...(options.yield ? { yield: options.yield } : {}),
  };

  const streamer = digest.createStreamingDigest?.();
  if (streamer) {
    const streamed = await streamCanonicalGraphValue(
      input,
      { write: (chunk) => streamer.update(chunk) },
      streamOptions
    );
    if (!streamed.accepted) {
      throw new Error(streamed.issues[0]?.message ?? 'Canonicalization failed.');
    }
    recordGraphDataMovement('hashed');
    return finish(await streamer.digest());
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const streamed = await streamCanonicalGraphValue(
    input,
    {
      write: (chunk) => {
        size += chunk.byteLength;
        if (size > STREAMING_FALLBACK_BYTES) {
          throw new Error(
            'Graph digest port must implement streaming SHA-256 for large canonical inputs.'
          );
        }
        chunks.push(chunk);
      },
    },
    streamOptions
  );
  if (!streamed.accepted) {
    throw new Error(streamed.issues[0]?.message ?? 'Canonicalization failed.');
  }
  recordGraphDataMovement('hashed');
  return finish(await digest.digest(concatUtf8Chunks(chunks, size)));
}

function finish(value: string): WisDigestReference {
  if (!/^[a-f0-9]{32,256}$/u.test(value)) {
    throw new Error('Graph digest port returned a non-canonical lowercase hexadecimal digest.');
  }
  return Object.freeze({
    algorithm: 'sha256',
    value,
    canonicalization: 'workspai.graph.canonical-json.v1',
  });
}

function concatUtf8Chunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) {
    const only = chunks[0];
    if (only) return only;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Drops non-schema digest fields so shard records stay content-state valid. */
export function shardDigest(reference: WisDigestReference): WisDigestReference {
  return Object.freeze({
    algorithm: reference.algorithm,
    value: reference.value,
  });
}

export function mergeShardDigests(
  ...groups: readonly (readonly WisDigestReference[])[]
): readonly WisDigestReference[] {
  const seen = new Set<string>();
  const merged: WisDigestReference[] = [];
  for (const group of groups) {
    for (const digest of group) {
      const key = `${digest.algorithm}:${digest.value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(shardDigest(digest));
    }
  }
  return Object.freeze(
    merged.sort(
      (left, right) =>
        left.algorithm.localeCompare(right.algorithm) || left.value.localeCompare(right.value)
    )
  );
}
