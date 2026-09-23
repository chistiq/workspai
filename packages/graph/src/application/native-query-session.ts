import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';

import type { NativeGraphSnapshot } from './composition-types.js';
import { nativeSnapshotPackedPath, retainNativeSnapshot } from './native-snapshot-store.js';
import { resolveComposeBinary } from './owned-composition.js';

const HOST_QUERY_TIMEOUT_MS = 30_000;
const KIND_OPEN = 1;
const KIND_QUERY = 2;
const KIND_CLOSE = 3;
const QUERY_KIND = {
  nodes: 1,
  edges: 2,
  dependencies: 3,
  proofs: 4,
  unresolved: 5,
  decisions: 6,
  traverse: 7,
  export: 8,
  orphans: 9,
} as const;

export type NativeQueryName = keyof typeof QUERY_KIND;

export interface NativeQueryPage {
  readonly records: readonly unknown[];
  readonly cursor: string;
  readonly exhausted: boolean;
}

class FrameReader {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private ended = false;
  private failed: Error | undefined;
  private waiters: {
    bytes: number;
    resolve: (value: Buffer) => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(stream: NodeJS.ReadableStream) {
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.pending.push(buffer);
      this.pendingBytes += buffer.byteLength;
      this.drain();
    });
    stream.on('end', () => {
      this.ended = true;
      this.drain();
    });
    stream.on('error', (error: Error) => {
      this.failed = error;
      this.drain();
    });
  }

  read(bytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ bytes, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0]!;
      if (this.failed) {
        this.waiters.shift();
        waiter.reject(this.failed);
        continue;
      }
      if (this.pendingBytes < waiter.bytes) {
        if (this.ended) {
          this.waiters.shift();
          waiter.reject(new Error('unexpected-eof'));
        }
        return;
      }
      this.waiters.shift();
      const out = Buffer.allocUnsafe(waiter.bytes);
      let filled = 0;
      while (filled < waiter.bytes) {
        const next = this.pending[0];
        if (!next) break;
        const take = Math.min(next.byteLength, waiter.bytes - filled);
        next.copy(out, filled, 0, take);
        filled += take;
        if (take === next.byteLength) this.pending.shift();
        else this.pending[0] = next.subarray(take);
      }
      this.pendingBytes -= waiter.bytes;
      waiter.resolve(out);
    }
  }
}

async function readFrame(reader: FrameReader): Promise<Buffer> {
  const prefix = await reader.read(4);
  const length = prefix.readUInt32LE(0);
  if (length <= 0 || length > 16 * 1024 * 1024) throw new Error('frame-length');
  return reader.read(length);
}

function frame(kind: number, payload: Buffer): Buffer {
  const out = Buffer.allocUnsafe(5 + payload.byteLength);
  out.writeUInt32LE(1 + payload.byteLength, 0);
  out[4] = kind;
  payload.copy(out, 5);
  return out;
}

function text(value: string): Buffer {
  const body = Buffer.from(value);
  const out = Buffer.allocUnsafe(4 + body.byteLength);
  out.writeUInt32LE(body.byteLength, 0);
  body.copy(out, 4);
  return out;
}

const QUERY_ERRORS: Record<number, string> = {
  1: 'query-io',
  2: 'query-protocol',
  3: 'query-unsupported',
  4: 'query-cursor',
  5: 'query-snapshot-mismatch',
  6: 'query-stale',
  7: 'query-response-limit',
  8: 'query-not-open',
  9: 'query-closed',
  10: 'query-cancelled',
};

/**
 * Persistent native query session. Node receives one bounded page at a time.
 */
export class NativeGraphQuerySession {
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly frames: FrameReader,
    private readonly releaseLease: () => void,
    private closed = false
  ) {}

  static async open(snapshot: NativeGraphSnapshot): Promise<NativeGraphQuerySession> {
    if (snapshot.lifecycle !== 'published' || snapshot.query !== 'paged') {
      throw new Error('query-unsupported');
    }
    const binary = resolveComposeBinary();
    if (!binary) throw new Error('native-binary-missing');
    const releaseLease = retainNativeSnapshot(snapshot.snapshotId);
    const child = spawn(binary.path, ['query'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const frames = new FrameReader(child.stdout);
    try {
      const path = nativeSnapshotPackedPath(snapshot.snapshotId);
      const pathBytes = Buffer.from(path);
      const payload = Buffer.allocUnsafe(4 + pathBytes.byteLength);
      payload.writeUInt32LE(pathBytes.byteLength, 0);
      pathBytes.copy(payload, 4);
      await withTimeout(writeChild(child.stdin, frame(KIND_OPEN, payload)), HOST_QUERY_TIMEOUT_MS);
      const opened = await withTimeout(readFrame(frames), HOST_QUERY_TIMEOUT_MS);
      if (opened.byteLength !== 72) throw new Error('query-protocol');
      if (opened.readUInt32LE(0) !== 0) {
        throw new Error(QUERY_ERRORS[opened.readUInt32LE(4)] ?? 'query-protocol');
      }
      const digest = opened.subarray(8, 72).toString('ascii');
      if (digest !== snapshot.packedDigest || digest !== snapshot.snapshotId) {
        throw new Error('query-snapshot-mismatch');
      }
      return new NativeGraphQuerySession(child, frames, releaseLease);
    } catch (error) {
      child.kill('SIGKILL');
      await once(child, 'close').catch(() => undefined);
      releaseLease();
      throw error;
    }
  }

  async query(
    name: NativeQueryName,
    options?: {
      readonly pageSize?: number;
      readonly cursor?: string;
      readonly extra?: string;
      readonly maxBytes?: number;
      readonly deadlineMs?: number;
    }
  ): Promise<NativeQueryPage> {
    if (this.closed) throw new Error('query-closed');
    const pageSize = options?.pageSize ?? 64;
    const maxBytes = options?.maxBytes ?? 256 * 1024;
    const deadlineMs = options?.deadlineMs ?? 0;
    const payload = Buffer.concat([
      Buffer.from([QUERY_KIND[name]]),
      u32(pageSize),
      u32(maxBytes),
      u32(deadlineMs),
      text(options?.cursor ?? ''),
      text(options?.extra ?? ''),
    ]);
    try {
      await withTimeout(
        writeChild(this.child.stdin, frame(KIND_QUERY, payload)),
        HOST_QUERY_TIMEOUT_MS
      );
      return parseQueryFrame(await withTimeout(readFrame(this.frames), HOST_QUERY_TIMEOUT_MS));
    } catch (error) {
      if (error instanceof Error && error.message === 'query-timeout') this.child.kill('SIGKILL');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await withTimeout(
        writeChild(this.child.stdin, frame(KIND_CLOSE, Buffer.alloc(0))),
        HOST_QUERY_TIMEOUT_MS
      ).catch(() => undefined);
      await withTimeout(readFrame(this.frames), HOST_QUERY_TIMEOUT_MS).catch(() => undefined);
      this.child.stdin.end();
      await withTimeout(once(this.child, 'close'), HOST_QUERY_TIMEOUT_MS).catch(() => undefined);
    } finally {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill('SIGKILL');
        await once(this.child, 'close').catch(() => undefined);
      }
      this.releaseLease();
    }
  }
}

export async function drainNativeQuery(
  session: NativeGraphQuerySession,
  name: NativeQueryName
): Promise<readonly unknown[]> {
  const records: unknown[] = [];
  let cursor = '';
  for (;;) {
    const page = await session.query(name, {
      pageSize: 256,
      maxBytes: 262_144,
      ...(cursor ? { cursor } : {}),
    });
    records.push(...page.records);
    if (page.exhausted) return records;
    if (!page.cursor || page.cursor === cursor) throw new Error('query-cursor');
    cursor = page.cursor;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('query-timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function writeChild(stdin: NodeJS.WritableStream, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      stdin.off('drain', onDrain);
      reject(error);
    };
    const onDrain = (): void => {
      stdin.off('error', onError);
      resolve();
    };
    if (stdin.write(payload)) {
      resolve();
      return;
    }
    stdin.once('error', onError);
    stdin.once('drain', onDrain);
  });
}

function u32(value: number): Buffer {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function parseQueryFrame(frameBody: Buffer): NativeQueryPage {
  if (frameBody.byteLength < 16) throw new Error('query-protocol');
  const status = frameBody.readUInt32LE(0);
  const code = frameBody.readUInt32LE(4);
  if (status !== 0) throw new Error(QUERY_ERRORS[code] ?? 'query-protocol');
  const exhausted = frameBody.readUInt32LE(8) === 1;
  let at = 12;
  const cursorLength = frameBody.readUInt32LE(at);
  at += 4;
  const cursor = frameBody.subarray(at, at + cursorLength).toString('utf8');
  at += cursorLength;
  const jsonLength = frameBody.readUInt32LE(at);
  at += 4;
  const json = frameBody.subarray(at, at + jsonLength).toString('utf8');
  if (at + jsonLength !== frameBody.byteLength) throw new Error('query-protocol');
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error('query-protocol');
  return { records: parsed, cursor, exhausted };
}
