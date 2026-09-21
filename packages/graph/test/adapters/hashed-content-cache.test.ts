import { describe, expect, it } from 'vitest';

import {
  GRAPH_HASHED_CONTENT_CACHE_LIMIT_BYTES,
  createHashedContentCache,
} from '../../src/adapters/node/hashed-content-cache.js';

describe('hashed content cache ownership', () => {
  it('copies on insert so caller mutation cannot change cached bytes', () => {
    const cache = createHashedContentCache();
    const digest = 'a'.repeat(64);
    const input = Uint8Array.from([1, 2, 3]);
    cache.remember(digest, input);
    input[0] = 9;
    const hit = cache.lookup(digest, 3);
    expect(hit).toEqual(Uint8Array.from([1, 2, 3]));
    expect(hit).not.toBe(input);
  });

  it('copies on read so lookup mutation cannot change later lookups', () => {
    const cache = createHashedContentCache();
    const digest = 'b'.repeat(64);
    cache.remember(digest, Uint8Array.from([1, 2, 3]));
    const first = cache.lookup(digest, 3);
    expect(first).toBeDefined();
    first![0] = 9;
    const second = cache.lookup(digest, 3);
    expect(second).toEqual(Uint8Array.from([1, 2, 3]));
    expect(second).not.toBe(first);
  });

  it('misses when the admitted byte length does not match stored bytes', () => {
    const cache = createHashedContentCache();
    const digest = 'c'.repeat(64);
    cache.remember(digest, Uint8Array.from([1, 2, 3]));
    expect(cache.lookup(digest, 2)).toBeUndefined();
    expect(cache.stats().misses).toBeGreaterThanOrEqual(1);
  });

  it('does not replace an existing digest with later caller bytes', () => {
    const cache = createHashedContentCache();
    const digest = 'd'.repeat(64);
    cache.remember(digest, Uint8Array.from([1, 2, 3]));
    cache.remember(digest, Uint8Array.from([9, 2, 3]));
    expect(cache.lookup(digest, 3)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('stops serving entries after disposal', () => {
    const cache = createHashedContentCache();
    const digest = 'e'.repeat(64);
    cache.remember(digest, Uint8Array.from([1, 2, 3]));
    cache.dispose();
    expect(cache.lookup(digest, 3)).toBeUndefined();
  });

  it('exposes a bounded byte limit', () => {
    expect(GRAPH_HASHED_CONTENT_CACHE_LIMIT_BYTES).toBe(64 * 1024 * 1024);
  });
});
