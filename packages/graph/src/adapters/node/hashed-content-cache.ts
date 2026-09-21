/**
 * Process-local store of bytes already hashed during inventory. Provider reads
 * reuse an owned snapshot instead of rereading a possibly mutated file.
 * Identity remains the content digest; this is not graph authority.
 *
 * Stored buffers are copied on insert and on read so caller-owned arrays cannot
 * alias cache state. Lookups never re-hash content; they check the digest key
 * and the admitted byte length only.
 */
import {
  recordGraphDataMovement,
  recordGraphRetainedBytes,
} from '../../application/data-movement.js';

export const GRAPH_HASHED_CONTENT_CACHE_LIMIT_BYTES = 64 * 1024 * 1024;

export interface HashedContentCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly remembered: number;
  readonly evictions: number;
  readonly entries: number;
  readonly bytes: number;
}

export interface HashedContentCache {
  remember(digest: string, bytes: Uint8Array): void;
  lookup(digest: string, byteLength: number): Uint8Array | undefined;
  stats(): HashedContentCacheStats;
  dispose(): void;
}

let processHits = 0;
let processMisses = 0;
let processRemembered = 0;
let processEvictions = 0;
let processBytes = 0;
let processEntries = 0;

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function createHashedContentCache(
  limitBytes = GRAPH_HASHED_CONTENT_CACHE_LIMIT_BYTES
): HashedContentCache {
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  let hits = 0;
  let misses = 0;
  let remembered = 0;
  let evictions = 0;
  let disposed = false;

  function touch(digest: string, bytes: Uint8Array): void {
    entries.delete(digest);
    entries.set(digest, bytes);
  }

  return {
    remember(digest, bytes) {
      if (disposed || !/^[a-f0-9]{64}$/u.test(digest) || bytes.byteLength === 0) return;
      const existing = entries.get(digest);
      if (existing) {
        touch(digest, existing);
        return;
      }
      if (bytes.byteLength > limitBytes) return;
      while (totalBytes + bytes.byteLength > limitBytes && entries.size > 0) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        const previous = entries.get(oldest);
        entries.delete(oldest);
        totalBytes -= previous?.byteLength ?? 0;
        evictions += 1;
        processEvictions += 1;
      }
      recordGraphRetainedBytes('hashedContent', totalBytes);
      const stored = copyBytes(bytes);
      recordGraphDataMovement('allocated');
      entries.set(digest, stored);
      totalBytes += stored.byteLength;
      remembered += 1;
      processRemembered += 1;
      processBytes = totalBytes;
      processEntries = entries.size;
      recordGraphRetainedBytes('hashedContent', totalBytes);
    },
    lookup(digest, byteLength) {
      if (
        disposed ||
        !/^[a-f0-9]{64}$/u.test(digest) ||
        !Number.isSafeInteger(byteLength) ||
        byteLength <= 0
      ) {
        misses += 1;
        processMisses += 1;
        return undefined;
      }
      const stored = entries.get(digest);
      if (!stored || stored.byteLength !== byteLength) {
        misses += 1;
        processMisses += 1;
        return undefined;
      }
      touch(digest, stored);
      hits += 1;
      processHits += 1;
      recordGraphDataMovement('allocated');
      return copyBytes(stored);
    },
    stats() {
      return {
        hits,
        misses,
        remembered,
        evictions,
        entries: entries.size,
        bytes: totalBytes,
      };
    },
    dispose() {
      entries.clear();
      totalBytes = 0;
      disposed = true;
      recordGraphRetainedBytes('hashedContent', 0);
    },
  };
}

export function hashedContentCacheStats(): HashedContentCacheStats {
  return {
    hits: processHits,
    misses: processMisses,
    remembered: processRemembered,
    evictions: processEvictions,
    entries: processEntries,
    bytes: processBytes,
  };
}

export function consumeHashedContentCacheStats(): HashedContentCacheStats {
  const snapshot = hashedContentCacheStats();
  processHits = 0;
  processMisses = 0;
  processRemembered = 0;
  processEvictions = 0;
  return snapshot;
}
