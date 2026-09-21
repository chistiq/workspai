import { describe, expect, it } from 'vitest';

import { GRAPH_FACT_BATCH_CONTRACT } from '../../src/contracts/index.js';
import {
  GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES,
  GRAPH_CONTENT_ADDRESSED_FACTS_MAX_ENTRY_BYTES,
  GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA,
  consumeContentAddressedFactCacheStats,
  contentAddressedCompute,
  contentAddressedFactCacheStats,
  contentAddressedFactKey,
  contentAddressedGet,
  createContentAddressedFactSession,
  disposeContentAddressedFactSession,
  runWithContentAddressedFactSession,
} from '../../src/providers/content-addressed-facts.js';

function inSession<T>(fn: () => T): T {
  const session = createContentAddressedFactSession();
  try {
    return runWithContentAddressedFactSession(session, fn);
  } finally {
    disposeContentAddressedFactSession(session);
  }
}

describe('content-addressed fact memo', () => {
  it('does not fall back to a process-global cache outside a session', () => {
    const key = contentAddressedFactKey({
      extractorId: 'test.unbound',
      extractorVersion: 'v1',
      contentDigest: `unbound-${String(Date.now())}`,
    });
    const session = createContentAddressedFactSession();
    runWithContentAddressedFactSession(session, () => {
      contentAddressedCompute(key, () => ({ owner: 'session' }));
    });
    let computed = 0;
    const unbound = contentAddressedCompute(key, () => {
      computed += 1;
      return { owner: 'unbound' };
    });
    expect(computed).toBe(1);
    expect(unbound).toEqual({ owner: 'unbound' });
    expect(runWithContentAddressedFactSession(session, () => contentAddressedGet(key))).toEqual({
      owner: 'session',
    });
    disposeContentAddressedFactSession(session);
  });

  it('isolates nested sessions from the parent memo', () => {
    const key = contentAddressedFactKey({
      extractorId: 'test.nested-session',
      extractorVersion: 'v1',
      contentDigest: `nested-session-${String(Date.now())}`,
    });
    const parent = createContentAddressedFactSession();
    const child = createContentAddressedFactSession();
    runWithContentAddressedFactSession(parent, () => {
      contentAddressedCompute(key, () => ({ owner: 'parent' }));
      runWithContentAddressedFactSession(child, () => {
        expect(contentAddressedGet(key)).toBeUndefined();
        contentAddressedCompute(key, () => ({ owner: 'child' }));
      });
      expect(contentAddressedGet(key)).toEqual({ owner: 'parent' });
    });
    disposeContentAddressedFactSession(parent);
    disposeContentAddressedFactSession(child);
  });

  it('does not retain a value when compute throws or is cancelled', () => {
    inSession(() => {
      const key = contentAddressedFactKey({
        extractorId: 'test.cancel',
        extractorVersion: 'v1',
        contentDigest: `cancel-${String(Date.now())}`,
      });
      const controller = new AbortController();
      expect(() =>
        contentAddressedCompute(key, () => {
          controller.abort();
          throw new Error('cancelled during cache population');
        })
      ).toThrow('cancelled during cache population');
      expect(contentAddressedGet(key)).toBeUndefined();
      expect(() =>
        contentAddressedCompute(key, () => {
          throw new Error('extract failed');
        })
      ).toThrow('extract failed');
      expect(contentAddressedGet(key)).toBeUndefined();
    });
  });

  it('throws when a disposed session is reused', () => {
    const session = createContentAddressedFactSession();
    const key = contentAddressedFactKey({
      extractorId: 'test.dispose-reuse',
      extractorVersion: 'v1',
      contentDigest: `dispose-${String(Date.now())}`,
    });
    runWithContentAddressedFactSession(session, () => {
      contentAddressedCompute(key, () => ({ ok: true }));
    });
    disposeContentAddressedFactSession(session);
    expect(() =>
      runWithContentAddressedFactSession(session, () => contentAddressedGet(key))
    ).toThrow(/disposed/u);
  });

  it('does not reuse across fact schema versions', () => {
    inSession(() => {
      let computed = 0;
      const digest = `schema-${String(Date.now())}`;
      contentAddressedCompute(
        contentAddressedFactKey({
          extractorId: 'test.schema',
          extractorVersion: 'v1',
          contentDigest: digest,
          factSchemaVersion: 'schema-a',
        }),
        () => {
          computed += 1;
          return { value: 1 };
        }
      );
      contentAddressedCompute(
        contentAddressedFactKey({
          extractorId: 'test.schema',
          extractorVersion: 'v1',
          contentDigest: digest,
          factSchemaVersion: 'schema-b',
        }),
        () => {
          computed += 1;
          return { value: 2 };
        }
      );
      expect(computed).toBe(2);
    });
  });

  it('returns detached snapshots rather than the created object', () => {
    inSession(() => {
      const key = contentAddressedFactKey({
        extractorId: 'test.extractor',
        extractorVersion: 'v1',
        contentDigest: `detach-${String(Date.now())}`,
        configuration: '.ts',
      });
      expect(key.startsWith(GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA)).toBe(true);
      expect(key).toContain(GRAPH_FACT_BATCH_CONTRACT.version);
      const created = { value: 1, nested: { n: 2 }, items: [3] };
      const first = contentAddressedCompute(key, () => created);
      const second = contentAddressedCompute(key, () => ({
        value: 9,
        nested: { n: 9 },
        items: [9],
      }));
      expect(first).toEqual(created);
      expect(first).not.toBe(created);
      expect(second).not.toBe(first);
      expect(second).toEqual({ value: 1, nested: { n: 2 }, items: [3] });
    });
  });

  it('isolates nested object and array mutation of cache hits', () => {
    inSession(() => {
      const key = contentAddressedFactKey({
        extractorId: 'test.nested',
        extractorVersion: 'v1',
        contentDigest: `nested-${String(Date.now())}`,
      });
      const created = contentAddressedCompute(key, () => ({ nested: { n: 1 }, items: ['a'] }));
      created.nested.n = 9;
      created.items.push('b');
      const peeked = contentAddressedGet<typeof created>(key);
      expect(peeked).toEqual({ nested: { n: 1 }, items: ['a'] });
      expect(peeked).not.toBe(created);
      if (peeked) peeked.items.push('c');
      expect(contentAddressedGet(key)).toEqual({ nested: { n: 1 }, items: ['a'] });
    });
  });

  it('does not reuse entries across extractor versions or configuration', () => {
    inSession(() => {
      let computed = 0;
      const digest = `version-${String(Date.now())}`;
      contentAddressedCompute(
        contentAddressedFactKey({
          extractorId: 'test.extractor',
          extractorVersion: 'v1',
          contentDigest: digest,
          configuration: '.ts',
        }),
        () => {
          computed += 1;
          return { value: 1 };
        }
      );
      contentAddressedCompute(
        contentAddressedFactKey({
          extractorId: 'test.extractor',
          extractorVersion: 'v2',
          contentDigest: digest,
          configuration: '.ts',
        }),
        () => {
          computed += 1;
          return { value: 2 };
        }
      );
      contentAddressedCompute(
        contentAddressedFactKey({
          extractorId: 'test.extractor',
          extractorVersion: 'v1',
          contentDigest: digest,
          configuration: '.js',
        }),
        () => {
          computed += 1;
          return { value: 3 };
        }
      );
      expect(computed).toBe(3);
    });
  });

  it('does not cache failed computations', () => {
    inSession(() => {
      const key = contentAddressedFactKey({
        extractorId: 'test.fail',
        extractorVersion: 'v1',
        contentDigest: `fail-${String(Date.now())}`,
      });
      expect(() =>
        contentAddressedCompute(key, () => {
          throw new Error('compute failed');
        })
      ).toThrow('compute failed');
      let computed = 0;
      const recovered = contentAddressedCompute(key, () => {
        computed += 1;
        return { ok: true };
      });
      expect(computed).toBe(1);
      expect(recovered).toEqual({ ok: true });
    });
  });

  it('rejects oversized entries without poisoning later lookups', () => {
    inSession(() => {
      consumeContentAddressedFactCacheStats();
      const key = contentAddressedFactKey({
        extractorId: 'test.oversize',
        extractorVersion: 'v1',
        contentDigest: `oversize-${String(Date.now())}`,
      });
      const huge = 'x'.repeat(GRAPH_CONTENT_ADDRESSED_FACTS_MAX_ENTRY_BYTES / 2 + 8);
      const first = contentAddressedCompute(key, () => huge);
      expect(first.length).toBe(huge.length);
      expect(contentAddressedFactCacheStats().rejected).toBeGreaterThanOrEqual(1);
      let computed = 0;
      contentAddressedCompute(key, () => {
        computed += 1;
        return 'small';
      });
      expect(computed).toBe(1);
    });
  });

  it('evicts by byte budget rather than retaining unbounded source strings', () => {
    const session = createContentAddressedFactSession();
    runWithContentAddressedFactSession(session, () => {
      const payload = 'n'.repeat(256 * 1024);
      for (let index = 0; index < 200; index += 1) {
        contentAddressedCompute(
          contentAddressedFactKey({
            extractorId: 'test.bytes',
            extractorVersion: 'v1',
            contentDigest: `bytes-${String(index)}`,
          }),
          () => payload
        );
      }
      const stats = contentAddressedFactCacheStats();
      expect(stats.bytes).toBeLessThanOrEqual(GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES);
      expect(stats.evictions).toBeGreaterThan(0);
    });
    disposeContentAddressedFactSession(session);
  });

  it('isolates concurrent sessions and disposes workspace data', async () => {
    const sessionA = createContentAddressedFactSession();
    const sessionB = createContentAddressedFactSession();
    const key = contentAddressedFactKey({
      extractorId: 'test.session',
      extractorVersion: 'v1',
      contentDigest: 'same-digest',
    });
    await Promise.all([
      Promise.resolve().then(() =>
        runWithContentAddressedFactSession(sessionA, () => {
          contentAddressedCompute(key, () => ({ owner: 'a' }));
        })
      ),
      Promise.resolve().then(() =>
        runWithContentAddressedFactSession(sessionB, () => {
          contentAddressedCompute(key, () => ({ owner: 'b' }));
        })
      ),
    ]);
    expect(runWithContentAddressedFactSession(sessionA, () => contentAddressedGet(key))).toEqual({
      owner: 'a',
    });
    expect(runWithContentAddressedFactSession(sessionB, () => contentAddressedGet(key))).toEqual({
      owner: 'b',
    });
    disposeContentAddressedFactSession(sessionA);
    expect(() =>
      runWithContentAddressedFactSession(sessionA, () => contentAddressedGet(key))
    ).toThrow(/disposed/u);
    expect(runWithContentAddressedFactSession(sessionB, () => contentAddressedGet(key))).toEqual({
      owner: 'b',
    });
    disposeContentAddressedFactSession(sessionB);
  });

  it('coalesces concurrent compute of the same key inside one session', async () => {
    const session = createContentAddressedFactSession();
    const key = contentAddressedFactKey({
      extractorId: 'test.concurrent',
      extractorVersion: 'v1',
      contentDigest: `concurrent-${String(Date.now())}`,
    });
    let computed = 0;
    await runWithContentAddressedFactSession(session, async () => {
      await Promise.all([
        Promise.resolve().then(() =>
          contentAddressedCompute(key, () => {
            computed += 1;
            return { n: computed };
          })
        ),
        Promise.resolve().then(() =>
          contentAddressedCompute(key, () => {
            computed += 1;
            return { n: computed };
          })
        ),
      ]);
      expect(computed).toBe(1);
      expect(contentAddressedGet(key)).toEqual({ n: 1 });
    });
    disposeContentAddressedFactSession(session);
  });

  it('returns immutable string snapshots without copying', () => {
    inSession(() => {
      const key = contentAddressedFactKey({
        extractorId: 'test.string',
        extractorVersion: 'v1',
        contentDigest: `string-${String(Date.now())}`,
        configuration: 'text',
      });
      const created = 'immutable-source-view';
      const first = contentAddressedCompute(key, () => created);
      const second = contentAddressedGet<string>(key);
      expect(first).toBe(created);
      expect(second).toBe(created);
    });
  });
});
