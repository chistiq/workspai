import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphWorkspaceFact } from '../contracts/index.js';
import { compactFactSupported, encodeCompactFactBatch } from './compact-fact-ir.js';

const CANONICAL_DIGEST = 'workspai.graph.canonical-json.v1';
const KIND_CANONICAL = 1;
const KIND_COMPACT = 2;
const KIND_FINISH = 3;
const COMPLETE_PAYLOAD = 4 + 4 + 64 + 8 + 8 + 8;

export interface OwnedFactSetComplete {
  readonly status: 'complete';
  readonly digest: WisDigestReference;
  readonly facts: number;
  readonly canonicalBytes: number;
  readonly rustRssBytes: number;
  readonly boundaryBytes: number;
}

export interface OwnedFactSetFallback {
  readonly status: 'fallback';
  readonly reason: string;
  readonly boundaryBytes: number;
}

const PROBE_KEYS = Object.freeze([
  '{"id":"B"}',
  '{"id":"a"}',
  '{"id":"A"}',
  'File.ts',
  'file.ts',
  'a-b',
  'ab',
  'foo bar',
  'foobar',
]);

function sessionBinary(): string | undefined {
  const override = process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
  if (override && existsSync(override)) return override;
  const candidates = [
    fileURLToPath(new URL('../../dist/native/graph-compose-session', import.meta.url)),
    fileURLToPath(new URL('../../../../target/release/graph-compose-session', import.meta.url)),
    fileURLToPath(
      new URL(
        '../../../../crates/graph-engine/target/release/graph-compose-session',
        import.meta.url
      )
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function digestReference(value: string): WisDigestReference {
  return Object.freeze({
    algorithm: 'sha256',
    value,
    canonicalization: CANONICAL_DIGEST,
  });
}

export function digestLocaleCanonicalKeys(keys: readonly string[]): string {
  const ranked = keys
    .map((key, index) => ({ key, index }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);
  const hash = createHash('sha256');
  hash.update('[');
  for (let index = 0; index < ranked.length; index += 1) {
    if (index > 0) hash.update(',');
    hash.update(ranked[index]?.key ?? '');
  }
  hash.update(']');
  return hash.digest('hex');
}

function canonicalFrame(entries: readonly { index: number; key: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const text = Buffer.from(entry.key);
    const header = Buffer.allocUnsafe(8);
    header.writeUInt32LE(entry.index, 0);
    header.writeUInt32LE(text.byteLength, 4);
    parts.push(header, text);
  }
  return Buffer.concat(parts);
}

interface SessionResponse {
  readonly status: number;
  readonly code: number;
  readonly digest: string;
  readonly facts: number;
  readonly canonicalBytes: number;
  readonly rustRssBytes: number;
}

function openSession(timeoutMs: number): {
  write(kind: number, payload: Buffer): Promise<void>;
  finish(): Promise<SessionResponse>;
  cancel(): void;
  boundaryBytes(): number;
} {
  const binary = sessionBinary();
  if (!binary) throw new Error('binary-missing');
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const stdout: Buffer[] = [];
  let boundaryBytes = 0;
  let settled = false;
  let resolveWait: (value: SessionResponse) => void = () => undefined;
  let rejectWait: (error: Error) => void = () => undefined;
  const ready = new Promise<SessionResponse>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectWait(error);
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    fail(new Error('timeout'));
  }, timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.on('error', (error) => fail(error));
  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code !== 0) {
      rejectWait(new Error(`exit-${code ?? 'signal'}`));
      return;
    }
    const body = Buffer.concat(stdout);
    if (body.byteLength < 4 + COMPLETE_PAYLOAD) {
      rejectWait(new Error('short-response'));
      return;
    }
    const length = body.readUInt32LE(0);
    if (length !== COMPLETE_PAYLOAD || body.byteLength < 4 + length) {
      rejectWait(new Error('corrupt-frame'));
      return;
    }
    const view = body.subarray(4, 4 + length);
    resolveWait({
      status: view.readUInt32LE(0),
      code: view.readUInt32LE(4),
      digest: view.subarray(8, 72).toString('ascii'),
      facts: Number(view.readBigUInt64LE(72)),
      canonicalBytes: Number(view.readBigUInt64LE(80)),
      rustRssBytes: Number(view.readBigUInt64LE(88)),
    });
  });
  const write = (kind: number, payload: Buffer): Promise<void> => {
    const frame = Buffer.allocUnsafe(5 + payload.byteLength);
    frame.writeUInt32LE(1 + payload.byteLength, 0);
    frame[4] = kind;
    payload.copy(frame, 5);
    boundaryBytes += frame.byteLength;
    const stdin = child.stdin;
    if (stdin.write(frame)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        stdin.off('drain', onDrain);
        reject(error);
      };
      const onDrain = (): void => {
        stdin.off('error', onError);
        resolve();
      };
      stdin.once('error', onError);
      stdin.once('drain', onDrain);
    });
  };
  const finish = (): Promise<SessionResponse> => {
    child.stdin.end();
    return ready;
  };
  return {
    write,
    finish,
    cancel: () => child.kill('SIGKILL'),
    boundaryBytes: () => boundaryBytes,
  };
}

function acceptResponse(
  response: SessionResponse,
  boundaryBytes: number
): OwnedFactSetComplete | OwnedFactSetFallback {
  if (response.status !== 0 || !/^[a-f0-9]{64}$/u.test(response.digest)) {
    return { status: 'fallback', reason: `rejected-${response.code}`, boundaryBytes };
  }
  return {
    status: 'complete',
    digest: digestReference(response.digest),
    facts: response.facts,
    canonicalBytes: response.canonicalBytes,
    rustRssBytes: response.rustRssBytes,
    boundaryBytes,
  };
}

async function probeCollation(binaryTimeoutMs: number): Promise<OwnedFactSetFallback | undefined> {
  try {
    const session = openSession(binaryTimeoutMs);
    await session.write(
      KIND_CANONICAL,
      canonicalFrame(PROBE_KEYS.map((key, index) => ({ index, key })))
    );
    await session.write(KIND_FINISH, Buffer.alloc(0));
    const result = acceptResponse(await session.finish(), session.boundaryBytes());
    if (result.status !== 'complete') return result;
    if (result.digest.value !== digestLocaleCanonicalKeys(PROBE_KEYS)) {
      return {
        status: 'fallback',
        reason: 'collation-probe',
        boundaryBytes: session.boundaryBytes(),
      };
    }
    return undefined;
  } catch (error) {
    return {
      status: 'fallback',
      reason: error instanceof Error ? error.message : 'process-failed',
      boundaryBytes: 0,
    };
  }
}

/**
 * Hash the fact set in the native session. Canonical strings for supported
 * facts are rendered in Rust and are not returned. Unsupported facts are sent
 * as already-canonical strings so they are not dropped.
 */
export async function digestOwnedFactSet(
  facts: readonly GraphWorkspaceFact[],
  canonical: (fact: GraphWorkspaceFact) => string
): Promise<OwnedFactSetComplete | OwnedFactSetFallback> {
  const binary = sessionBinary();
  if (!binary) return { status: 'fallback', reason: 'binary-missing', boundaryBytes: 0 };
  const probe = await probeCollation(10_000);
  if (probe) return probe;
  let session: ReturnType<typeof openSession>;
  try {
    session = openSession(120_000);
  } catch (error) {
    return {
      status: 'fallback',
      reason: error instanceof Error ? error.message : 'process-failed',
      boundaryBytes: 0,
    };
  }
  try {
    let index = 0;
    while (index < facts.length) {
      if (!compactFactSupported(facts[index]!)) {
        await session.write(
          KIND_CANONICAL,
          canonicalFrame([{ index, key: canonical(facts[index]!) }])
        );
        index += 1;
        continue;
      }
      const start = index;
      const batch: GraphWorkspaceFact[] = [];
      while (index < facts.length && batch.length < 8192 && compactFactSupported(facts[index]!)) {
        batch.push(facts[index]!);
        index += 1;
      }
      const encoded = encodeCompactFactBatch(batch);
      if (!encoded) {
        session.cancel();
        return {
          status: 'fallback',
          reason: 'encode-rejected',
          boundaryBytes: session.boundaryBytes(),
        };
      }
      const payload = Buffer.allocUnsafe(4 + encoded.bytes.byteLength);
      payload.writeUInt32LE(start, 0);
      Buffer.from(encoded.bytes.buffer, encoded.bytes.byteOffset, encoded.bytes.byteLength).copy(
        payload,
        4
      );
      await session.write(KIND_COMPACT, payload);
    }
    await session.write(KIND_FINISH, Buffer.alloc(0));
    const result = acceptResponse(await session.finish(), session.boundaryBytes());
    if (result.status === 'complete' && result.facts !== facts.length) {
      return { status: 'fallback', reason: 'fact-count', boundaryBytes: result.boundaryBytes };
    }
    return result;
  } catch (error) {
    session.cancel();
    return {
      status: 'fallback',
      reason: error instanceof Error ? error.message : 'process-failed',
      boundaryBytes: session.boundaryBytes(),
    };
  }
}
