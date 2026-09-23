import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

const MAGIC = Buffer.from('RJNL');
const VERSION = 1;
const HEADER_BYTES = 4 + 4 + 16;

export interface ReplayJournalRecord {
  readonly sequence: number;
  readonly kind: number;
  readonly payloadBytes: number;
  readonly payloadDigest: string;
  readonly chainDigest: string;
}

export interface ReplayFrame {
  readonly sequence: number;
  readonly kind: number;
  readonly payload: Buffer;
  readonly payloadDigest: string;
  readonly chainDigest: string;
}

/**
 * Child-process replay log for one composition directory.
 *
 * The journal keeps the chain digest and the last record's metadata. It does
 * not retain payloads. A new process can reopen the directory only when the
 * recorded owner is no longer the live writer. This is not a substitute for
 * an affected-set composer.
 */
export class ReplayJournal {
  readonly path: string;
  private fd: number;
  private sequence = 0;
  private chain: Buffer = Buffer.alloc(32);
  private finished = false;
  private last: ReplayJournalRecord | undefined;

  private constructor(
    directory: string,
    readonly sessionId: string,
    fd: number,
    sequence: number,
    chain: Buffer,
    last: ReplayJournalRecord | undefined
  ) {
    this.path = join(directory, 'journal.rjnl');
    this.fd = fd;
    this.sequence = sequence;
    this.chain = chain;
    this.last = last;
  }

  static create(directory: string, sessionId = randomBytes(16).toString('hex')): ReplayJournal {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'journal.rjnl');
    const fd = openSync(path, 'w', 0o600);
    const journal = new ReplayJournal(directory, sessionId, fd, 0, Buffer.alloc(32), undefined);
    writeAll(fd, Buffer.concat([MAGIC, u32(VERSION), Buffer.from(sessionId, 'hex')]));
    fsyncSync(fd);
    return journal;
  }

  static reopen(directory: string): ReplayJournal {
    const path = join(directory, 'journal.rjnl');
    const fd = openSync(path, 'r+');
    const scanned = scanJournal(fd);
    if (scanned.finished) throw new Error('journal-finished');
    return new ReplayJournal(
      directory,
      scanned.sessionId,
      fd,
      scanned.sequence,
      scanned.chain,
      scanned.last
    );
  }

  get retainedPayloadBytes(): number {
    return 0;
  }

  get lastRecord(): ReplayJournalRecord | undefined {
    return this.last;
  }

  append(kind: number, payload: Buffer): ReplayJournalRecord {
    if (this.finished) throw new Error('journal-finished');
    const payloadDigest = createHash('sha256').update(payload).digest();
    const sequence = this.sequence;
    this.sequence += 1;
    const prefix = Buffer.concat([
      u32(sequence),
      u32(kind),
      u32(payload.byteLength),
      payload,
      payloadDigest,
    ]);
    const chainDigest = createHash('sha256').update(this.chain).update(prefix).digest();
    writeAll(this.fd, Buffer.concat([prefix, chainDigest]));
    fsyncSync(this.fd);
    this.chain = chainDigest;
    const record = {
      sequence,
      kind,
      payloadBytes: payload.byteLength,
      payloadDigest: payloadDigest.toString('hex'),
      chainDigest: chainDigest.toString('hex'),
    };
    this.last = record;
    return record;
  }

  finish(): void {
    if (this.finished) return;
    this.append(255, Buffer.alloc(0));
    this.finished = true;
    fsyncSync(this.fd);
  }

  close(): void {
    closeSync(this.fd);
  }
}

export async function replayJournalRecords(
  path: string,
  expectedSession: string | undefined,
  options: { readonly requireFinish?: boolean },
  visit: (record: ReplayFrame) => Promise<void>
): Promise<void> {
  const fd = openSync(path, 'r');
  try {
    const header = readExact(fd, HEADER_BYTES);
    if (header.subarray(0, 4).toString('ascii') !== 'RJNL') throw new Error('journal-magic');
    if (header.readUInt32LE(4) !== VERSION) throw new Error('journal-version');
    const session = header.subarray(8, 24).toString('hex');
    if (expectedSession && session !== expectedSession) throw new Error('journal-session');
    let chain: Buffer = Buffer.alloc(32);
    let expectedSequence = 0;
    let lastKind = -1;
    for (;;) {
      const head = readUpTo(fd, 12);
      if (head.byteLength === 0) break;
      if (head.byteLength < 12) throw new Error('journal-truncated');
      const sequence = head.readUInt32LE(0);
      const kind = head.readUInt32LE(4);
      const length = head.readUInt32LE(8);
      if (sequence !== expectedSequence) throw new Error('journal-sequence');
      const payload = readExact(fd, length);
      const payloadDigest = readExact(fd, 32);
      const chainDigest = readExact(fd, 32);
      const actualPayload = createHash('sha256').update(payload).digest();
      if (!actualPayload.equals(payloadDigest)) throw new Error('journal-digest');
      const prefix = Buffer.concat([head, payload, payloadDigest]);
      const actualChain = createHash('sha256').update(chain).update(prefix).digest();
      if (!actualChain.equals(chainDigest)) throw new Error('journal-chain');
      chain = chainDigest;
      expectedSequence += 1;
      lastKind = kind;
      await visit({
        sequence,
        kind,
        payload,
        payloadDigest: payloadDigest.toString('hex'),
        chainDigest: chainDigest.toString('hex'),
      });
    }
    if (options.requireFinish !== false && lastKind !== 255) throw new Error('journal-unfinished');
  } finally {
    closeSync(fd);
  }
}

/**
 * Parses a small fixture buffer. Recovery uses replayJournalRecords so a
 * composition journal is not loaded into one array.
 */
export function readReplayJournal(
  file: Buffer,
  expectedSession?: string,
  options?: { readonly requireFinish?: boolean }
): readonly ReplayFrame[] {
  let at = 0;
  if (file.subarray(0, 4).toString('ascii') !== 'RJNL') throw new Error('journal-magic');
  at = 4;
  if (file.readUInt32LE(at) !== VERSION) throw new Error('journal-version');
  at += 4;
  const session = file.subarray(at, at + 16).toString('hex');
  at += 16;
  if (expectedSession && session !== expectedSession) throw new Error('journal-session');
  let chain: Buffer = Buffer.alloc(32);
  let expectedSequence = 0;
  const records: ReplayFrame[] = [];
  while (at < file.byteLength) {
    if (file.byteLength - at < 12 + 32 + 32) throw new Error('journal-truncated');
    const sequence = file.readUInt32LE(at);
    const kind = file.readUInt32LE(at + 4);
    const length = file.readUInt32LE(at + 8);
    if (sequence !== expectedSequence) throw new Error('journal-sequence');
    if (at + 12 + length + 64 > file.byteLength) throw new Error('journal-truncated');
    const payload = Buffer.from(file.subarray(at + 12, at + 12 + length));
    const payloadDigest = Buffer.from(file.subarray(at + 12 + length, at + 12 + length + 32));
    const chainDigest = Buffer.from(file.subarray(at + 12 + length + 32, at + 12 + length + 64));
    const actualPayload = createHash('sha256').update(payload).digest();
    if (!actualPayload.equals(payloadDigest)) throw new Error('journal-digest');
    const prefix = Buffer.concat([file.subarray(at, at + 12), payload, payloadDigest]);
    const actualChain = createHash('sha256').update(chain).update(prefix).digest();
    if (!actualChain.equals(chainDigest)) throw new Error('journal-chain');
    chain = chainDigest;
    expectedSequence += 1;
    at += 12 + length + 64;
    records.push({
      sequence,
      kind,
      payload,
      payloadDigest: payloadDigest.toString('hex'),
      chainDigest: chainDigest.toString('hex'),
    });
  }
  if (options?.requireFinish !== false && records.at(-1)?.kind !== 255) {
    throw new Error('journal-unfinished');
  }
  return records;
}

function scanJournal(fd: number): {
  sessionId: string;
  sequence: number;
  chain: Buffer;
  finished: boolean;
  last: ReplayJournalRecord | undefined;
} {
  const header = readExact(fd, HEADER_BYTES);
  if (header.subarray(0, 4).toString('ascii') !== 'RJNL') throw new Error('journal-magic');
  if (header.readUInt32LE(4) !== VERSION) throw new Error('journal-version');
  const sessionId = header.subarray(8, 24).toString('hex');
  let chain: Buffer = Buffer.alloc(32);
  let sequence = 0;
  let finished = false;
  let last: ReplayJournalRecord | undefined;
  for (;;) {
    const head = readUpTo(fd, 12);
    if (head.byteLength === 0) break;
    if (head.byteLength < 12) throw new Error('journal-truncated');
    const recordSequence = head.readUInt32LE(0);
    const kind = head.readUInt32LE(4);
    const length = head.readUInt32LE(8);
    if (recordSequence !== sequence) throw new Error('journal-sequence');
    const payload = readExact(fd, length);
    const payloadDigest = readExact(fd, 32);
    const chainDigest = readExact(fd, 32);
    const actualPayload = createHash('sha256').update(payload).digest();
    if (!actualPayload.equals(payloadDigest)) throw new Error('journal-digest');
    const actualChain = createHash('sha256')
      .update(chain)
      .update(Buffer.concat([head, payload, payloadDigest]))
      .digest();
    if (!actualChain.equals(chainDigest)) throw new Error('journal-chain');
    chain = chainDigest;
    sequence += 1;
    finished = kind === 255;
    last = {
      sequence: recordSequence,
      kind,
      payloadBytes: length,
      payloadDigest: payloadDigest.toString('hex'),
      chainDigest: chainDigest.toString('hex'),
    };
  }
  return { sessionId, sequence, chain, finished, last };
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const wrote = writeSync(fd, buffer, offset, buffer.byteLength - offset);
    if (wrote <= 0) throw new Error('journal-write');
    offset += wrote;
  }
}

function readExact(fd: number, length: number): Buffer {
  const buffer = readUpTo(fd, length);
  if (buffer.byteLength !== length) throw new Error('journal-truncated');
  return buffer;
}

function readUpTo(fd: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, null);
    if (read === 0) return buffer.subarray(0, offset);
    offset += read;
  }
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

export function journalFileExists(directory: string): boolean {
  return existsSync(join(directory, 'journal.rjnl'));
}

export function readJournalBytes(path: string): Buffer {
  return readFileSync(path);
}
