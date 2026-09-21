/**
 * Session-scoped memo for immutable per-file extraction. The key must include
 * the content digest, extractor/parser version, fact schema, and any
 * configuration that changes output. Membership and composition indexes stay
 * outside this cache.
 *
 * Entries are detached snapshots. Callers never receive the stored object, and
 * nested mutation of a returned value cannot affect later lookups.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { GRAPH_FACT_BATCH_CONTRACT } from '../contracts/foundation.js';
import { recordGraphRetainedBytes } from '../application/data-movement.js';

export const GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA =
  'workspai.graph.content-addressed-facts.v1' as const;
export const GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT = 4_096;
export const GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES = 32 * 1024 * 1024;
export const GRAPH_CONTENT_ADDRESSED_FACTS_MAX_ENTRY_BYTES = 4 * 1024 * 1024;

export interface ContentAddressedFactCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
  readonly bytes: number;
  readonly evictions: number;
  readonly rejected: number;
  readonly failures: number;
}

export interface ContentAddressedFactSession {
  readonly stats: () => ContentAddressedFactCacheStats;
  readonly dispose: () => void;
}

interface StoredEntry {
  readonly value: unknown;
  readonly bytes: number;
}

class ContentAddressedFactCache implements ContentAddressedFactSession {
  private readonly memo = new Map<string, StoredEntry>();
  private readonly inflight = new Map<string, unknown>();
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private rejected = 0;
  private failures = 0;
  private disposed = false;

  stats(): ContentAddressedFactCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.memo.size,
      bytes: this.totalBytes,
      evictions: this.evictions,
      rejected: this.rejected,
      failures: this.failures,
    };
  }

  consumeStats(): ContentAddressedFactCacheStats {
    const snapshot = this.stats();
    this.hits = 0;
    this.misses = 0;
    this.rejected = 0;
    this.failures = 0;
    return snapshot;
  }

  get<T>(key: string): T | undefined {
    if (this.disposed) {
      throw new Error('Content-addressed fact session was disposed.');
    }
    if (!validCacheKey(key)) return undefined;
    const hit = this.memo.get(key);
    if (hit === undefined) return undefined;
    this.memo.delete(key);
    this.memo.set(key, hit);
    this.hits += 1;
    return cloneSnapshot(hit.value) as T;
  }

  compute<T>(key: string, compute: () => T): T {
    if (this.disposed) {
      throw new Error('Content-addressed fact session was disposed.');
    }
    if (!validCacheKey(key)) {
      this.misses += 1;
      return compute();
    }
    const hit = this.memo.get(key);
    if (hit !== undefined) {
      this.memo.delete(key);
      this.memo.set(key, hit);
      this.hits += 1;
      return cloneSnapshot(hit.value) as T;
    }
    const pending = this.inflight.get(key);
    if (pending !== undefined) {
      this.hits += 1;
      return cloneSnapshot(pending) as T;
    }
    this.misses += 1;
    let value: T;
    try {
      value = compute();
    } catch (error) {
      this.failures += 1;
      throw error;
    }
    this.inflight.set(key, value);
    try {
      this.store(key, value);
    } finally {
      this.inflight.delete(key);
    }
    return cloneSnapshot<T>(value);
  }

  dispose(): void {
    this.memo.clear();
    this.inflight.clear();
    this.totalBytes = 0;
    this.disposed = true;
    recordGraphRetainedBytes('contentAddressedFacts', 0);
  }

  private store(key: string, value: unknown): void {
    let snapshot: unknown;
    try {
      snapshot = freezeSnapshot(cloneSnapshot(value));
    } catch {
      this.rejected += 1;
      return;
    }
    const bytes = estimateRetainedBytes(snapshot);
    if (bytes <= 0 || bytes > GRAPH_CONTENT_ADDRESSED_FACTS_MAX_ENTRY_BYTES) {
      this.rejected += 1;
      return;
    }
    if (bytes > GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES) {
      this.rejected += 1;
      return;
    }
    while (
      (this.memo.size >= GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT ||
        this.totalBytes + bytes > GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES) &&
      this.memo.size > 0
    ) {
      const oldest = this.memo.keys().next().value;
      if (oldest === undefined) break;
      const previous = this.memo.get(oldest);
      this.memo.delete(oldest);
      this.totalBytes -= previous?.bytes ?? 0;
      this.evictions += 1;
    }
    if (
      this.memo.size >= GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT ||
      this.totalBytes + bytes > GRAPH_CONTENT_ADDRESSED_FACTS_LIMIT_BYTES
    ) {
      this.rejected += 1;
      return;
    }
    this.memo.set(key, { value: snapshot, bytes });
    this.totalBytes += bytes;
    recordGraphRetainedBytes('contentAddressedFacts', this.totalBytes);
  }
}

const sessions = new AsyncLocalStorage<ContentAddressedFactCache>();

/**
 * Production builds must install an owned session. Outside a session, compute
 * still runs but never stores, so concurrent or sequential builds cannot share
 * mutable memo state through a process-global fallback.
 */
class UnboundContentAddressedFactCache extends ContentAddressedFactCache {
  override get<T>(): T | undefined {
    return undefined;
  }

  override compute<T>(_key: string, compute: () => T): T {
    return compute();
  }

  override dispose(): void {
    // Unbound compute never retains entries.
  }
}

const unboundSession = new UnboundContentAddressedFactCache();

function currentSession(): ContentAddressedFactCache {
  return sessions.getStore() ?? unboundSession;
}

function validCacheKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(`${GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA}\0`);
}

function cloneSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function freezeSnapshot<T>(value: T): T {
  const pending: object[] = [];
  const visited = new Set<object>();
  if (typeof value === 'object' && value !== null) pending.push(value);
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === 'object' && item !== null) pending.push(item);
      }
    } else {
      for (const child of Object.values(current)) {
        if (typeof child === 'object' && child !== null) pending.push(child);
      }
    }
    Object.freeze(current);
  }
  return value;
}

function estimateRetainedBytes(value: unknown): number {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      bytes += current.length * 2;
      continue;
    }
    if (typeof current === 'number' || typeof current === 'boolean' || current === null) {
      bytes += 8;
      continue;
    }
    if (typeof current !== 'object' || current === null) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    bytes += 32;
    if (Array.isArray(current)) {
      bytes += current.length * 8;
      for (const item of current) pending.push(item);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      bytes += key.length * 2;
      pending.push(child);
    }
  }
  return bytes;
}

export function contentAddressedFactKey(input: {
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly contentDigest: string;
  readonly configuration?: string;
  readonly factSchemaVersion?: string;
  readonly semanticProfile?: string;
}): string {
  return [
    GRAPH_CONTENT_ADDRESSED_FACTS_SCHEMA,
    input.extractorId,
    input.extractorVersion,
    input.contentDigest,
    input.configuration ?? '',
    input.factSchemaVersion ?? GRAPH_FACT_BATCH_CONTRACT.version,
    input.semanticProfile ?? '',
  ].join('\0');
}

export function createContentAddressedFactSession(): ContentAddressedFactSession {
  return new ContentAddressedFactCache();
}

export function runWithContentAddressedFactSession<T>(
  session: ContentAddressedFactSession,
  fn: () => T
): T {
  if (!(session instanceof ContentAddressedFactCache) || session === unboundSession) {
    throw new Error('Content-addressed fact session is not owned by this cache.');
  }
  return sessions.run(session, fn);
}

export async function runWithOwnedContentAddressedFactSession<T>(
  session: ContentAddressedFactSession | undefined,
  fn: () => Promise<T> | T
): Promise<T> {
  const owned = session ?? createContentAddressedFactSession();
  const created = session === undefined;
  try {
    return await runWithContentAddressedFactSession(owned, fn);
  } finally {
    if (created) disposeContentAddressedFactSession(owned);
  }
}

export function disposeContentAddressedFactSession(session?: ContentAddressedFactSession): void {
  if (session) {
    session.dispose();
    return;
  }
  const active = sessions.getStore();
  if (!active) {
    throw new Error('No content-addressed fact session is active.');
  }
  active.dispose();
}

export function contentAddressedFactCacheStats(): ContentAddressedFactCacheStats {
  return currentSession().stats();
}

export function consumeContentAddressedFactCacheStats(): ContentAddressedFactCacheStats {
  return currentSession().consumeStats();
}

export function contentAddressedCompute<T>(key: string, compute: () => T): T {
  return currentSession().compute(key, compute);
}

export function contentAddressedGet<T>(key: string): T | undefined {
  return currentSession().get<T>(key);
}
