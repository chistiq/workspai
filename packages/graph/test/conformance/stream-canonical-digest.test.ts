import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { digestCanonicalGraphInput } from '../../src/application/digest-canonical-graph-input.js';
import {
  canonicalizeGraphValue,
  cloneCanonicalGraphValue,
  digestCanonicalGraphValue,
  streamCanonicalGraphValue,
} from '../../src/conformance/canonical-json.js';
import type { GraphDigestPort } from '../../src/ports/index.js';

function nodeDigestPort(): GraphDigestPort {
  return {
    algorithm: 'sha256',
    digest: async (input) => createHash('sha256').update(input).digest('hex'),
    digestSync: (input) => createHash('sha256').update(input).digest('hex'),
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

  it('matches whole-object canonical JSON when assembling interned nested fragments', () => {
    const shared = Object.freeze({
      id: 'entity:workspai:file:sha256:ab',
      identityScheme: 'workspai.graph.entity-identity',
      kind: 'file',
      scope: { kind: 'project', projectIds: ['demo'] },
    });
    const projected: Record<string, unknown> = {
      authority: 'observed',
      confidence: 0.7,
      derivation: 'extracted',
      evidence: [{ id: 'evidence:1' }],
      factId: 'fact:1',
      factType: 'source.declaration',
      freshness: { status: 'current' },
      inputDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
      object: shared,
      predicate: 'defines',
      provenance: { sourceKind: 'source-file' },
      scope: shared.scope,
      subject: shared,
      truthLifecycle: 'current',
      unknownZones: [],
    };
    const interned = `{${Object.keys(projected)
      .sort()
      .map((key) => {
        const nested = canonicalizeGraphValue(projected[key]);
        if (!nested.accepted) throw new Error('nested canonicalization failed');
        return `${JSON.stringify(key)}:${nested.value}`;
      })
      .join(',')}}`;
    const whole = canonicalizeGraphValue(projected);
    expect(whole.accepted).toBe(true);
    if (!whole.accepted) return;
    expect(interned).toBe(whole.value);
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

  it('flushes buffered canonical chunks without changing bytes or digest', async () => {
    const input = Array.from({ length: 2_000 }, (_, index) => ({
      id: `row-${index}`,
      payload: 'canonical-flush'.repeat(8),
    }));
    const canonical = canonicalizeGraphValue(input);
    expect(canonical.accepted).toBe(true);
    if (!canonical.accepted) return;
    expect(new TextEncoder().encode(canonical.value).byteLength).toBeGreaterThan(16_384);
    const streamed = await streamedBytes(input);
    expect(new TextDecoder().decode(streamed)).toBe(canonical.value);
    const hashed = await digestCanonicalGraphInput(input, nodeDigestPort());
    expect(hashed.value).toBe(createHash('sha256').update(canonical.value, 'utf8').digest('hex'));
  });

  it('matches digestSync against the streaming SHA-256 port', async () => {
    const port = nodeDigestPort();
    const input = { z: 1, a: [null, true, false, 'value', 1.5] };
    const streamed = await digestCanonicalGraphInput(input, port);
    const canonical = canonicalizeGraphValue(input);
    expect(canonical.accepted).toBe(true);
    if (!canonical.accepted) return;
    expect(port.digestSync?.(new TextEncoder().encode(canonical.value))).toBe(streamed.value);
  });

  it('re-walks a mutated object instead of returning a stale snapshot', async () => {
    const live: { value: number; cycle?: object } = { value: 1 };
    expect(canonicalizeGraphValue(live)).toEqual({
      accepted: true,
      value: '{"value":1}',
      issues: [],
    });
    live.value = 2;
    expect(canonicalizeGraphValue(live)).toEqual({
      accepted: true,
      value: '{"value":2}',
      issues: [],
    });
    expect(new TextDecoder().decode(await streamedBytes(live))).toBe('{"value":2}');
    live.cycle = live;
    expect(canonicalizeGraphValue(live).accepted).toBe(false);
    const streamed = await streamCanonicalGraphValue(live, { write: () => undefined });
    expect(streamed.accepted).toBe(false);
  });

  it('applies nesting budgets at the use site, including previously walked subtrees', async () => {
    const nest = (depth: number, leaf: unknown = { value: 1 }): unknown => {
      let current = leaf;
      for (let index = 0; index < depth; index += 1) current = { child: current };
      return current;
    };
    const inner = nest(200);
    expect(canonicalizeGraphValue(inner).accepted).toBe(true);
    const wrapped = nest(100, inner);
    expect(canonicalizeGraphValue(wrapped).accepted).toBe(false);
    expect((await streamCanonicalGraphValue(wrapped, { write: () => undefined })).accepted).toBe(
      false
    );
    expect(canonicalizeGraphValue(nest(300)).accepted).toBe(false);
  });

  it('keeps a detached clone from mutating the source snapshot', () => {
    const nested = { y: 2, x: 3 };
    const fixture = { a: nested, b: nested, z: 1 };
    const first = canonicalizeGraphValue(fixture);
    expect(first.accepted).toBe(true);
    const cloned = cloneCanonicalGraphValue(fixture);
    expect(cloned.accepted).toBe(true);
    if (cloned.accepted) {
      const record = cloned.value as { a: { x: number } };
      record.a.x = 99;
    }
    expect(canonicalizeGraphValue(fixture)).toEqual(first);
  });
});
