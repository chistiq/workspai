import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { digestCanonicalGraphInput } from '../../src/application/digest-canonical-graph-input.js';
import {
  canonicalizeGraphValue,
  digestCanonicalGraphValue,
  streamCanonicalGraphValue,
} from '../../src/conformance/canonical-json.js';
import type { GraphDigestPort } from '../../src/ports/index.js';

function nodeDigestPort(): GraphDigestPort {
  return {
    algorithm: 'sha256',
    digest: async (input) => createHash('sha256').update(input).digest('hex'),
    createStreamingDigest: () => {
      const hash = createHash('sha256');
      return {
        update: (chunk: Uint8Array) => {
          hash.update(chunk);
        },
        digest: async () => hash.digest('hex'),
      };
    },
  };
}

async function streamedBytes(input: unknown): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const result = await streamCanonicalGraphValue(input, {
    write: (chunk) => {
      chunks.push(chunk);
      size += chunk.byteLength;
    },
  });
  expect(result.accepted).toBe(true);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

describe('streaming canonical digest', () => {
  it('emits the same UTF-8 bytes as canonicalizeGraphValue', async () => {
    const fixtures: unknown[] = [
      null,
      true,
      false,
      0,
      -0,
      1.5,
      '',
      'plain',
      { z: 1, a: { y: 2, x: 3 } },
      [null, true, false, 'value', 1.5],
      { 'caf\u00e9': '\u65E5\u672C\u8A9E\n\t"\\', path: 'src/Caf\u00e9.ts' },
    ];
    for (const fixture of fixtures) {
      const canonical = canonicalizeGraphValue(fixture);
      expect(canonical.accepted).toBe(true);
      if (!canonical.accepted) continue;
      const streamed = await streamedBytes(fixture);
      expect(new TextDecoder().decode(streamed)).toBe(canonical.value);
      expect(streamed.byteLength).toBe(new TextEncoder().encode(canonical.value).byteLength);
    }
  });

  it('is deterministic under object key permutation', async () => {
    const left = await streamedBytes({ z: 1, a: { y: 2, x: 3 } });
    const right = await streamedBytes({ a: { x: 3, y: 2 }, z: 1 });
    expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
  });

  it('matches the previous SHA-256 digest for bounded fixtures', async () => {
    const input = { z: 1, a: [null, true, false, 'value', 1.5] };
    const previous = digestCanonicalGraphValue(input);
    expect(previous.accepted).toBe(true);
    if (!previous.accepted) return;
    const streamed = await digestCanonicalGraphInput(input, nodeDigestPort());
    expect(streamed).toEqual(previous.value);
  });

  it('matches Node streaming SHA-256 against an in-memory digest of the same bytes', async () => {
    const input = { items: ['\u03B1', 'src/foo.ts', { nested: true }] };
    const canonical = canonicalizeGraphValue(input);
    expect(canonical.accepted).toBe(true);
    if (!canonical.accepted) return;
    const fromBytes = await nodeDigestPort().digest(new TextEncoder().encode(canonical.value));
    const streamed = await digestCanonicalGraphInput(input, nodeDigestPort());
    expect(streamed.value).toBe(fromBytes);
  });

  it('digests inputs larger than the former monolithic worker byte budget without that cap', async () => {
    const input = Array.from(
      { length: 4_000 },
      (_, index) => `payload-${index}:${'x'.repeat(256)}`
    );
    const canonical = canonicalizeGraphValue(input);
    expect(canonical.accepted).toBe(true);
    if (!canonical.accepted) return;
    expect(new TextEncoder().encode(canonical.value).byteLength).toBeGreaterThan(1_000_000);
    const streamed = await digestCanonicalGraphInput(input, nodeDigestPort());
    expect(streamed.value).toBe(createHash('sha256').update(canonical.value, 'utf8').digest('hex'));
  });

  it('fails closed when an explicit payload byte budget is exceeded and never publishes a digest', async () => {
    let digestCalls = 0;
    const port: GraphDigestPort = {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => ({
        update: () => undefined,
        digest: async () => {
          digestCalls += 1;
          return 'a'.repeat(64);
        },
      }),
    };
    await expect(
      digestCanonicalGraphInput({ value: 'too-large' }, port, { maxBytes: 4 })
    ).rejects.toThrow(/byte budget exceeded/u);
    expect(digestCalls).toBe(0);
  });

  it('does not publish a digest after cancellation', async () => {
    let digestCalls = 0;
    const port: GraphDigestPort = {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => ({
        update: () => undefined,
        digest: async () => {
          digestCalls += 1;
          return 'a'.repeat(64);
        },
      }),
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      digestCanonicalGraphInput(
        Array.from({ length: 8_192 }, (_, index) => index),
        port,
        {
          cancellation: { aborted: true, throwIfAborted: () => controller.signal.throwIfAborted() },
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(digestCalls).toBe(0);
  });

  it('does not publish a digest for cyclic values', async () => {
    let digestCalls = 0;
    const port: GraphDigestPort = {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => ({
        update: () => undefined,
        digest: async () => {
          digestCalls += 1;
          return 'a'.repeat(64);
        },
      }),
    };
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(digestCanonicalGraphInput(cyclic, port)).rejects.toThrow(/cyclic value/u);
    expect(digestCalls).toBe(0);
  });

  it('keeps fallback buffering bounded and refuses large non-streaming ports', async () => {
    const port: GraphDigestPort = {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
    };
    const small = await digestCanonicalGraphInput({ ok: true }, port);
    expect(small.value).toMatch(/^[a-f0-9]{64}$/u);
    const large = Array.from({ length: 80_000 }, (_, index) => `row-${index}-${'y'.repeat(200)}`);
    await expect(digestCanonicalGraphInput(large, port)).rejects.toThrow(
      /must implement streaming SHA-256/u
    );
  });
});
