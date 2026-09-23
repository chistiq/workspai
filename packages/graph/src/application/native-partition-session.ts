import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GraphWorkspaceFact } from '../contracts/index.js';
import type { GraphCancellationPort } from '../ports/index.js';
import { compactFactSupported, encodeCompactFactBatch } from './compact-fact-ir.js';
import type { GraphCompositionRequest, NativeGraphSnapshot } from './composition-types.js';
import {
  nativeSnapshotPackedPath,
  nativeSnapshotRoot,
  publishNativeSnapshot,
  snapshotFormat,
} from './native-snapshot-store.js';
import {
  digestReference,
  headerPayload,
  materializeNativeGraphSnapshot,
  parseQuality,
  resolveComposeBinary,
  semanticDigests,
  snapshotPackaging,
  type OwnedCompositionComplete,
  type OwnedCompositionFallback,
} from './owned-composition.js';
import { replayJournalRecords, ReplayJournal } from './replay-journal.js';

const BEGIN = 1;
const UPSERT = 2;
const REMOVE = 3;
const COMMIT = 4;
const ABORT = 5;
const FINGERPRINT = 6;
const CONTENT_CLOCK = 7;
const OBSERVATION = 8;
const ACK_TIMEOUT_MS = 60_000;
const MAX_PARTITION_BYTES = 8 * 1024 * 1024;
const MAX_RETAINED_DEAD_SESSIONS = 8;
const MAX_RESIDENT_SESSIONS = 4;
const RESIDENT_TTL_MS = 30 * 60 * 1000;
const SESSION_SCHEMA = 'workspai.graph.replay-session.v1';

export interface PartitionUpsertMetadata {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly sourceIdentity: string;
  readonly sourceDigest: string;
  readonly unknownZones: readonly unknown[];
  readonly unsupportedZones: readonly unknown[];
  readonly coverage: readonly unknown[];
  readonly staleZones: readonly { readonly scope: string; readonly reason: string }[];
  readonly batchStatus: string;
  readonly streaming: 'legacy-array' | 'bounded';
  readonly semanticDigest?: string;
}

export interface PartitionCommitStats {
  readonly recomputed: boolean;
  readonly contentEvaluatedAt: string;
  readonly reusedPartitions: number;
  readonly touchedPartitions: number;
  readonly affectedFacts: number;
  readonly parsedFacts: number;
  readonly factDigest: string;
  readonly contentDigest: string;
  readonly packedDigest: string;
  readonly snapshotId: string;
  readonly partitions: readonly {
    readonly partitionId: string;
    readonly providerId: string;
    readonly sourceIdentity: string;
    readonly sourceDigest: string;
    readonly metadata: string;
  }[];
  readonly native: {
    readonly facts: number;
    readonly nodes: number;
    readonly edges: number;
    readonly packedBytes: number;
    readonly canonicalBytes: number;
    readonly spillBytes: number;
    readonly retainedCanonicalBytes: number;
    readonly rustRssBytes: number;
    readonly rssKnown: boolean;
    readonly ingestMs: number;
    readonly digestMs: number;
    readonly edgeMs: number;
    readonly publishMs: number;
    readonly decisions: number;
    readonly unresolved: number;
    readonly quality: ReturnType<typeof parseQuality>;
  };
}

interface SessionManifest {
  readonly schema: typeof SESSION_SCHEMA;
  readonly sessionId: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly startTicks: string;
  readonly nonce: string;
  readonly status: 'open';
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
  if (length <= 0 || length > 32 * 1024 * 1024) throw new Error('frame-length');
  return reader.read(length);
}

function frame(kind: number, payload: Buffer): Buffer {
  const out = Buffer.allocUnsafe(5 + payload.byteLength);
  out.writeUInt32LE(1 + payload.byteLength, 0);
  out[4] = kind;
  payload.copy(out, 5);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.allocUnsafe(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function text(value: string | Buffer): Buffer {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([u32(body.byteLength), body]);
}

function withTimeout<T>(promise: Promise<T>, code: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ACK_TIMEOUT_MS);
    promise.then(
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

export function partitionJournalRoot(): string {
  return process.env.WORKSPAI_GRAPH_JOURNAL_ROOT ?? join(tmpdir(), 'workspai-graph-journals');
}

export function encodePartitionFacts(
  facts: readonly GraphWorkspaceFact[],
  canonical: (fact: GraphWorkspaceFact) => string,
  maxBytes = Number.POSITIVE_INFINITY
): Buffer {
  const records: Buffer[] = [];
  let bytes = 4;
  for (const fact of facts) {
    const until = fact.freshness.validUntil;
    const untilFlag = Buffer.from([until ? 1 : 0]);
    const untilBody = until ? text(until) : Buffer.alloc(0);
    const encoded = compactFactSupported(fact) ? encodeCompactFactBatch([fact]) : undefined;
    const record = encoded
      ? Buffer.concat([
          Buffer.from([2]),
          text(
            Buffer.from(encoded.bytes.buffer, encoded.bytes.byteOffset, encoded.bytes.byteLength)
          ),
          untilFlag,
          untilBody,
        ])
      : Buffer.concat([Buffer.from([3]), text(canonical(fact)), untilFlag, untilBody]);
    bytes += record.byteLength;
    if (bytes > maxBytes) throw new Error('partition-limit');
    records.push(record);
  }
  return Buffer.concat([u32(records.length), ...records]);
}

function defaultMetadata(partitionId: string): PartitionUpsertMetadata {
  return {
    providerId: partitionId,
    providerVersion: '0',
    sourceIdentity: partitionId,
    sourceDigest: '',
    unknownZones: [],
    unsupportedZones: [],
    coverage: [],
    staleZones: [],
    batchStatus: 'complete',
    streaming: 'legacy-array',
  };
}

function encodeUpsert(
  partitionId: string,
  facts: readonly GraphWorkspaceFact[],
  canonical: (fact: GraphWorkspaceFact) => string,
  metadata: PartitionUpsertMetadata
): Buffer {
  const prefix = Buffer.concat([
    Buffer.from('PM2\0'),
    text(partitionId),
    text(metadata.providerId),
    text(metadata.sourceIdentity),
    text(metadata.sourceDigest),
    text(JSON.stringify(metadata)),
  ]);
  if (prefix.byteLength > MAX_PARTITION_BYTES) throw new Error('partition-limit');
  return Buffer.concat([
    prefix,
    encodePartitionFacts(facts, canonical, MAX_PARTITION_BYTES - prefix.byteLength),
  ]);
}

function processStartTicks(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = stat.lastIndexOf(')');
    if (end < 0) return undefined;
    return stat.slice(end + 2).split(' ')[19];
  } catch {
    return undefined;
  }
}

function ownerAlive(manifest: SessionManifest): boolean {
  if (!Number.isInteger(manifest.pid) || manifest.pid <= 0) return false;
  const observed = processStartTicks(manifest.pid);
  if (manifest.startTicks && observed && manifest.startTicks !== observed) return false;
  try {
    process.kill(manifest.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readManifest(directory: string): SessionManifest {
  const manifest = JSON.parse(
    readFileSync(join(directory, 'session.json'), 'utf8')
  ) as SessionManifest;
  if (manifest.schema !== SESSION_SCHEMA) throw new Error('session-manifest');
  return manifest;
}

function writeManifest(directory: string, manifest: SessionManifest): void {
  const path = join(directory, 'session.json');
  const fd = openSync(path, 'w', 0o600);
  try {
    const body = Buffer.from(`${JSON.stringify(manifest)}\n`);
    let offset = 0;
    while (offset < body.byteLength) {
      const wrote = writeSync(fd, body, offset, body.byteLength - offset);
      if (wrote <= 0) throw new Error('session-manifest-write');
      offset += wrote;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function eachSessionDirectory(root: string, visit: (directory: string) => void): void {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const directory = join(root, name);
    if (name === 'live') {
      for (const child of readdirSync(directory)) visit(join(directory, child));
      continue;
    }
    visit(directory);
  }
}

export function listRecoverableSessions(root = partitionJournalRoot()): readonly string[] {
  const found: string[] = [];
  eachSessionDirectory(root, (directory) => {
    try {
      if (!ownerAlive(readManifest(directory))) found.push(directory);
    } catch {
      return;
    }
  });
  return found;
}

/**
 * Deletes the oldest journals whose owner is gone once more than the retention
 * cap remain. A live owner and any directory in `protect` stay on disk.
 */
export function reapAbandonedJournals(
  root = partitionJournalRoot(),
  protect: ReadonlySet<string> = new Set()
): number {
  const dead: { directory: string; startedAt: number }[] = [];
  eachSessionDirectory(root, (directory) => {
    if (protect.has(directory)) return;
    try {
      const manifest = readManifest(directory);
      if (ownerAlive(manifest)) return;
      dead.push({ directory, startedAt: manifest.startedAt });
    } catch {
      return;
    }
  });
  dead.sort((left, right) => left.startedAt - right.startedAt);
  const excess = Math.max(0, dead.length - MAX_RETAINED_DEAD_SESSIONS);
  for (const item of dead.slice(0, excess)) {
    rmSync(item.directory, { recursive: true, force: true });
  }
  return excess;
}

function sessionIdFromDirectory(directory: string): string {
  const name = directory.slice(directory.lastIndexOf('/') + 1);
  const id = name.slice(0, 32);
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error('session-manifest');
  return id;
}

function writeManifestExclusive(directory: string, manifest: SessionManifest): boolean {
  const path = join(directory, 'session.json');
  const body = Buffer.from(`${JSON.stringify(manifest)}\n`);
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    let offset = 0;
    while (offset < body.byteLength) {
      const wrote = writeSync(fd, body, offset, body.byteLength - offset);
      if (wrote <= 0) throw new Error('session-manifest-write');
      offset += wrote;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return true;
}

function fsyncDirectory(directory: string): void {
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function recoverInterruptedClaim(directory: string): void {
  const path = join(directory, 'session.json');
  if (existsSync(path)) return;
  const names = readdirSync(directory);
  const retired = names.find(
    (name) => name.startsWith('session.json.') && name.endsWith('.retired')
  );
  const next = names.find((name) => name.startsWith('session.json.') && name.endsWith('.next'));
  if (!retired) return;
  renameSync(join(directory, retired), path);
  if (next) rmSync(join(directory, next), { force: true });
  fsyncDirectory(directory);
}

/**
 * One resumer wins. The next manifest is fsynced before it replaces the
 * current file. A crash before that rename restores the previous manifest.
 */
function claimManifest(directory: string): { manifest: SessionManifest; previous: string } {
  recoverInterruptedClaim(directory);
  const path = join(directory, 'session.json');
  const observed = readFileSync(path, 'utf8');
  const current = JSON.parse(observed) as SessionManifest;
  if (current.schema !== SESSION_SCHEMA) throw new Error('session-manifest');
  if (ownerAlive(current)) throw new Error('session-live');
  const next: SessionManifest = {
    schema: SESSION_SCHEMA,
    sessionId: current.sessionId,
    pid: process.pid,
    startedAt: Date.now(),
    startTicks: processStartTicks(process.pid) ?? '',
    nonce: randomBytes(16).toString('hex'),
    status: 'open',
  };
  const nextPath = `${path}.${next.nonce}.next`;
  const retired = `${path}.${next.nonce}.retired`;
  writeManifestFile(nextPath, next);
  fsyncDirectory(directory);
  try {
    renameSync(path, retired);
  } catch (error) {
    rmSync(nextPath, { force: true });
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('session-live');
    throw error;
  }
  const moved = readFileSync(retired, 'utf8');
  if (moved !== observed || ownerAlive(JSON.parse(moved) as SessionManifest)) {
    if (!existsSync(path)) renameSync(retired, path);
    else rmSync(retired, { force: true });
    rmSync(nextPath, { force: true });
    fsyncDirectory(directory);
    throw new Error('session-live');
  }
  renameSync(nextPath, path);
  fsyncDirectory(directory);
  rmSync(retired, { force: true });
  const claimed = readManifest(directory);
  if (claimed.nonce !== next.nonce || claimed.pid !== process.pid) {
    throw new Error('session-live');
  }
  return { manifest: claimed, previous: observed };
}

function restoreManifestText(path: string, body: string): void {
  const fd = openSync(path, 'w', 0o600);
  try {
    const bytes = Buffer.from(body);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const wrote = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (wrote <= 0) throw new Error('session-manifest-write');
      offset += wrote;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeManifestFile(path: string, manifest: SessionManifest): void {
  const fd = openSync(path, 'w', 0o600);
  try {
    const body = Buffer.from(`${JSON.stringify(manifest)}\n`);
    let offset = 0;
    while (offset < body.byteLength) {
      const wrote = writeSync(fd, body, offset, body.byteLength - offset);
      if (wrote <= 0) throw new Error('session-manifest-write');
      offset += wrote;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function semanticDigestFromUpsert(
  payload: Buffer
): { readonly id: string; readonly digest: string } | undefined {
  if (payload.subarray(0, 4).toString('ascii') !== 'PM2\0') return undefined;
  const id = readPrefixedStringAt(payload, 4);
  if (!id) return undefined;
  let offset = id.next;
  for (let field = 0; field < 3; field += 1) {
    const next = readPrefixedStringAt(payload, offset);
    if (!next) return undefined;
    offset = next.next;
  }
  const metadata = readPrefixedStringAt(payload, offset);
  if (!metadata) return undefined;
  const parsed = JSON.parse(metadata.value) as { readonly semanticDigest?: unknown };
  return typeof parsed.semanticDigest === 'string'
    ? { id: id.value, digest: parsed.semanticDigest }
    : undefined;
}

function readPrefixedString(buffer: Buffer): string | undefined {
  return readPrefixedStringAt(buffer, 0)?.value;
}

function readPrefixedStringAt(
  buffer: Buffer,
  offset: number
): { readonly value: string; readonly next: number } | undefined {
  if (buffer.byteLength < offset + 4) return undefined;
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  if (buffer.byteLength < start + length) return undefined;
  return { value: buffer.subarray(start, start + length).toString('utf8'), next: start + length };
}

const OBSERVATION_ORIGINS = new Set(['source', 'provider', 'build-clock', 'unset']);
const DECLARED_OBSERVATION_ORIGINS = new Set(['source', 'provider', 'build-clock']);
const BUILD_IDENTITY_SCHEMA = 'workspai.graph.compose-build.v1';
const BUILD_IDENTITY_END = '\nworkspai.graph.compose-build.end.v1';
const embeddedIdentityByDigest = new Map<string, string>();

export function nativeExecutionIdentity(): string {
  const binary = resolveComposeBinary();
  if (!binary) return 'binary-missing';
  // Hash the bytes every time identity is requested. Path, size, and mtime are
  // not content identity and can be preserved while a file is replaced.
  const binaryBytes = readFileSync(binary.path);
  const binaryDigest = createHash('sha256').update(binaryBytes).digest('hex');
  let embedded = embeddedIdentityByDigest.get(binaryDigest);
  if (!embedded) {
    embedded = 'embedded-identity-missing';
    const start = binaryBytes.indexOf(`${BUILD_IDENTITY_SCHEMA}\t`);
    const end = start < 0 ? -1 : binaryBytes.indexOf(BUILD_IDENTITY_END, start);
    if (start >= 0 && end > start) {
      const fields = binaryBytes.subarray(start, end).toString('utf8').split('\t');
      if (
        fields.length === 6 &&
        fields[0] === BUILD_IDENTITY_SCHEMA &&
        fields.every((field) => field.length > 0 && !field.includes('\0'))
      ) {
        embedded = fields.join('\n');
      }
    }
    if (embedded !== 'embedded-identity-missing') {
      embeddedIdentityByDigest.set(binaryDigest, embedded);
    }
  }
  const value = [`binary:${binaryDigest}`, `packaging:${binary.packaging}`, embedded].join('\n');
  return value;
}

export function residentSessionKey(request: GraphCompositionRequest): string {
  const hash = createHash('sha256');
  hash.update(request.policy.id);
  hash.update('\0');
  hash.update(request.policy.version);
  hash.update('\0');
  hash.update(request.ontology.id);
  hash.update('\0');
  hash.update(request.ontology.version);
  hash.update('\0');
  hash.update(request.policy.architectureEpoch);
  hash.update('\0');
  hash.update(String(request.policy.minimumConfidence));
  hash.update('\0');
  hash.update(request.policy.inferredClaims);
  hash.update('\0');
  hash.update(request.policy.unknownFreshness);
  hash.update('\0');
  hash.update(String(request.policy.maxFacts));
  hash.update('\0');
  hash.update(String(request.policy.maxEdges));
  hash.update('\0');
  hash.update(request.policy.functionalRelations.join('\0'));
  hash.update('\0');
  hash.update(request.repositoryIdentity ?? '');
  hash.update('\0');
  hash.update(partitionJournalRoot());
  hash.update('\0');
  hash.update(nativeSnapshotRoot());
  hash.update('\0');
  hash.update(nativeExecutionIdentity());
  hash.update('\0');
  for (const entity of request.ontology.entities) {
    hash.update(entity.kind);
    hash.update('\0');
    hash.update(entity.family);
    hash.update('\0');
    hash.update(entity.extensionNamespace ?? '');
    hash.update('\0');
  }
  for (const relation of request.ontology.relations) {
    hash.update(relation.kind);
    hash.update('\0');
    hash.update(relation.semantics);
    hash.update('\0');
    hash.update(relation.subjectFamilies.join('\0'));
    hash.update('\0');
    hash.update(relation.objectFamilies.join('\0'));
    hash.update('\0');
    hash.update(relation.allowedAuthorities.join('\0'));
    hash.update('\0');
    hash.update(relation.inverse ?? '');
    hash.update('\0');
    hash.update(relation.symmetric ? '1' : '0');
    hash.update('\0');
    hash.update(relation.transitive ? '1' : '0');
    hash.update('\0');
    hash.update(relation.extensionNamespace ?? '');
    hash.update('\0');
    hash.update(relation.proofPolicy.id);
    hash.update('\0');
    hash.update(relation.proofPolicy.version);
    hash.update('\0');
  }
  const providers = request.sources
    .map(
      (source) =>
        `${source.manifest.id}@${source.manifest.version}:${source.manifest.capabilities.relationKinds.join(',')}`
    )
    .sort();
  hash.update(providers.join('\0'));
  hash.update('\0');
  const scopes = request.sources.map((source) => JSON.stringify(source.batch.scope ?? null)).sort();
  hash.update(scopes.join('\0'));
  return hash.digest('hex');
}

export function aggregateInputDigest(
  inputs: readonly { readonly locator: string; readonly digest: { readonly value: string } }[]
): string {
  const hash = createHash('sha256');
  const ordered = [...inputs].sort(
    (left, right) =>
      left.locator.localeCompare(right.locator) ||
      left.digest.value.localeCompare(right.digest.value)
  );
  for (const input of ordered) {
    hash.update(input.locator);
    hash.update('\0');
    hash.update(input.digest.value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function canonicalRepositoryIdentity(scope: unknown, root: string): string {
  let path = root;
  try {
    path = realpathSync(root);
  } catch {
    path = root;
  }
  return `${JSON.stringify(scope)}\0${path}`;
}

function partitionFingerprint(
  source: GraphCompositionRequest['sources'][number],
  canonical: (fact: GraphWorkspaceFact) => string
): string {
  const hash = createHash('sha256');
  hash.update('workspai.graph.partition-fingerprint.v2');
  hash.update('\0');
  hash.update(source.manifest.id);
  hash.update('\0');
  hash.update(source.manifest.version);
  hash.update('\0');
  hash.update(source.manifest.capabilities.relationKinds.join('\0'));
  hash.update('\0');
  hash.update(aggregateInputDigest(source.batch.inputs));
  hash.update('\0');
  for (const record of source.batch.processing) {
    hash.update(record.stage.id);
    hash.update('\0');
    hash.update(record.stage.version);
    hash.update('\0');
    hash.update(record.provider.id);
    hash.update('\0');
    hash.update(record.provider.version);
    hash.update('\0');
    hash.update(record.outcome);
    hash.update('\0');
    hash.update(record.priorDigest?.value ?? '');
    hash.update('\0');
    hash.update(record.outputDigest?.value ?? '');
    hash.update('\0');
    hash.update(JSON.stringify(record.diagnostics));
    hash.update('\0');
  }
  hash.update(source.batch.status);
  hash.update('\0');
  hash.update(JSON.stringify(source.batch.coverage));
  hash.update('\0');
  hash.update(JSON.stringify(source.batch.unknownZones));
  hash.update('\0');
  hash.update(JSON.stringify(source.batch.unsupportedZones));
  hash.update('\0');
  hash.update(JSON.stringify(source.batch.redaction));
  hash.update('\0');
  hash.update(JSON.stringify(source.partitionOwnership ?? []));
  hash.update('\0');
  for (const fact of source.batch.facts) {
    hash.update(canonical(fact));
    hash.update('\0');
    hash.update(fact.observedAt);
    hash.update('\0');
    hash.update(fact.freshness.validUntil ?? '');
    hash.update('\0');
  }
  return hash.digest('hex');
}

function observationOriginFor(
  source: GraphCompositionRequest['sources'][number],
  factId: string
): string {
  for (const partition of source.partitionOwnership ?? []) {
    const fact = partition.facts.find((entry) => entry.factId === factId);
    if (fact) return fact.observationOrigin;
  }
  return 'unset';
}

function residentPartitionId(source: GraphCompositionRequest['sources'][number]): string {
  const locators = source.batch.inputs
    .map((input) => input.locator)
    .sort()
    .join('\n');
  return `${source.manifest.id}@${source.manifest.version}:${locators}`;
}

function assertPartitionBinding(
  sources: GraphCompositionRequest['sources'],
  partitions: PartitionCommitStats['partitions']
): void {
  if (partitions.length !== sources.length) throw new Error('session-meta');
  const byId = new Map(partitions.map((partition) => [partition.partitionId, partition]));
  if (byId.size !== partitions.length) throw new Error('session-meta');
  for (const source of sources) {
    const partitionId = residentPartitionId(source);
    const record = byId.get(partitionId);
    if (
      !record ||
      record.providerId !== source.manifest.id ||
      record.sourceIdentity !== partitionId ||
      record.sourceDigest !== aggregateInputDigest(source.batch.inputs)
    ) {
      throw new Error('session-meta');
    }
  }
}

interface ResidentHandle {
  readonly session: NativePartitionSession;
  usedAt: number;
}

const residentSessions = new Map<string, ResidentHandle>();
const residentLanes = new Map<string, Promise<void>>();

function enqueueResident<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = residentLanes.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  residentLanes.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export interface ResidentBuildObservation {
  readonly recomputed: boolean;
  readonly boundaryBytes: number;
  readonly encodedPartitions: number;
  readonly encodedPartitionIds: readonly string[];
  readonly packedMtimeMs: number;
  readonly packedIno: number;
  readonly snapshotMtimeMs: number;
  readonly snapshotIno: number;
  readonly affectedFacts: number;
  readonly parsedFacts: number;
}

function residentPoolKey(request: GraphCompositionRequest): string {
  return `${partitionJournalRoot()}\0${residentSessionKey(request)}`;
}

export function residentSessionIsOpen(request: GraphCompositionRequest): boolean {
  const handle = residentSessions.get(residentPoolKey(request));
  return handle !== undefined && !handle.session.isClosed();
}

export function residentSessionObservation(
  request: GraphCompositionRequest
): ResidentBuildObservation | undefined {
  return residentSessions.get(residentPoolKey(request))?.session.latestBuild();
}

export function residentBuildObservations(): readonly ResidentBuildObservation[] {
  return [...residentSessions.values()].flatMap((handle) => {
    const latest = handle.session.latestBuild();
    return latest ? [latest] : [];
  });
}

export async function disposeResidentSessions(): Promise<void> {
  const handles = [...residentSessions.values()];
  residentSessions.clear();
  residentLanes.clear();
  for (const handle of handles) await handle.session.shutdown();
}

process.on('exit', () => {
  for (const handle of residentSessions.values()) handle.session.killNow();
});

async function evictResidentSessions(keep: string): Promise<void> {
  const now = Date.now();
  for (const [key, handle] of [...residentSessions]) {
    if (key === keep) continue;
    if (handle.session.isClosed() || now - handle.usedAt > RESIDENT_TTL_MS) {
      residentSessions.delete(key);
      residentLanes.delete(key);
      await handle.session.shutdown();
    }
  }
  while (residentSessions.size >= MAX_RESIDENT_SESSIONS && !residentSessions.has(keep)) {
    const oldest = [...residentSessions.entries()].sort(
      (left, right) => left[1].usedAt - right[1].usedAt
    )[0];
    if (!oldest) return;
    residentSessions.delete(oldest[0]);
    residentLanes.delete(oldest[0]);
    await oldest[1].session.shutdown();
  }
}

/**
 * Resident partition session.
 *
 * Unchanged partitions are not sent again. A changed partition reparses only
 * its own facts and recomputes the affected closure. Payloads are not
 * kept by the journal object; restart reads one journal record at a time.
 * Same-process restart covers a dead Rust child. A new process resumes only
 * after it atomically claims the manifest. The product pool keeps one session
 * for a workspace key across builds; close still deletes a session that the
 * caller owns directly.
 */
export class NativePartitionSession {
  private seq = 0;
  private childExit: Promise<void>;
  private readonly residentDigests = new Map<string, string>();
  private readonly residentFingerprints = new Map<string, string>();
  private readonly observations = new Map<
    string,
    {
      readonly inputDigest: string;
      readonly times: ReadonlyMap<string, { readonly time: string; readonly origin: string }>;
    }
  >();
  private encodedPartitions = 0;
  private encodedIds: string[] = [];
  private contentEvaluatedAt = '';
  private latest: ResidentBuildObservation | undefined;
  private constructor(
    private child: ChildProcessWithoutNullStreams,
    private frames: FrameReader,
    readonly directory: string,
    private journal: ReplayJournal,
    private readonly packedPath: string,
    private readonly request: GraphCompositionRequest,
    private readonly evaluatedAt: string,
    private closed = false
  ) {
    this.childExit = new Promise((resolve) => {
      child.once('exit', () => resolve());
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  residentPartitionIds(): readonly string[] {
    return [...this.residentDigests.keys()];
  }

  latestBuild(): ResidentBuildObservation | undefined {
    return this.latest;
  }

  residentPackedPath(): string {
    return this.packedPath;
  }

  beginBuild(): void {
    this.encodedPartitions = 0;
    this.encodedIds = [];
  }

  noteBuild(observation: ResidentBuildObservation): void {
    this.latest = observation;
  }

  releaseOwnership(): void {
    try {
      const current = readManifest(this.directory);
      writeManifest(this.directory, {
        ...current,
        pid: 0,
        startTicks: '',
        nonce: randomBytes(16).toString('hex'),
      });
    } catch {
      return;
    }
  }

  static async open(
    request: GraphCompositionRequest,
    evaluatedAt: string,
    signal?: AbortSignal,
    directoryArgument?: string
  ): Promise<NativePartitionSession> {
    const binary = resolveComposeBinary();
    if (!binary) throw new Error('native-binary-missing');
    const explicit = directoryArgument !== undefined;
    const id = explicit
      ? sessionIdFromDirectory(directoryArgument)
      : randomBytes(16).toString('hex');
    const directory = explicit ? directoryArgument : join(partitionJournalRoot(), id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest: SessionManifest = {
      schema: SESSION_SCHEMA,
      sessionId: id,
      pid: process.pid,
      startedAt: Date.now(),
      startTicks: processStartTicks(process.pid) ?? '',
      nonce: randomBytes(16).toString('hex'),
      status: 'open',
    };
    if (explicit) {
      if (!writeManifestExclusive(directory, manifest)) throw new Error('session-live');
    } else {
      writeManifest(directory, manifest);
    }
    const journal = ReplayJournal.create(directory, id);
    const packedPath = join(directory, 'graph.wgp');
    const header = headerPayload(
      request,
      semanticDigests(request),
      evaluatedAt,
      join(directory, 'content.json'),
      packedPath
    );
    const child = spawn(binary.path, ['session'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const frames = new FrameReader(child.stdout);
    const session = new NativePartitionSession(
      child,
      frames,
      directory,
      journal,
      packedPath,
      request,
      evaluatedAt
    );
    try {
      if (signal?.aborted) throw new Error('cancelled');
      const record = journal.append(BEGIN, header);
      await session.writeFrame(BEGIN, header);
      await session.readAck(record.payloadDigest);
      return session;
    } catch (error) {
      child.kill('SIGKILL');
      await once(child, 'close').catch(() => undefined);
      try {
        journal.close();
      } catch {
        // The journal fd is already closed.
      }
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  static async resume(directory: string): Promise<NativePartitionSession> {
    const claimed = claimManifest(directory);
    const manifest = claimed.manifest;
    let child: ChildProcessWithoutNullStreams | undefined;
    let journal: ReplayJournal | undefined;
    try {
      const binary = resolveComposeBinary();
      if (!binary) throw new Error('native-binary-missing');
      journal = ReplayJournal.reopen(directory);
      if (journal.sessionId !== manifest.sessionId) throw new Error('journal-session');
      const packedPath = join(directory, 'graph.wgp');
      child = spawn(binary.path, ['session'], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stderr.resume();
      const frames = new FrameReader(child.stdout);
      const session = new NativePartitionSession(
        child,
        frames,
        directory,
        journal,
        packedPath,
        { sources: [], ontology: undefined as never, policy: undefined as never },
        ''
      );
      await replayJournalRecords(
        journal.path,
        manifest.sessionId,
        { requireFinish: false },
        async (record) => {
          if (
            record.kind === FINGERPRINT ||
            record.kind === CONTENT_CLOCK ||
            record.kind === OBSERVATION
          ) {
            session.noteReplayed(record.kind, record.payload, record.payloadDigest);
            return;
          }
          if (record.kind !== BEGIN && record.kind !== UPSERT && record.kind !== REMOVE) return;
          await session.writeFrame(record.kind, record.payload);
          await session.readAck(record.payloadDigest);
          session.noteReplayed(record.kind, record.payload, record.payloadDigest);
        }
      );
      return session;
    } catch (error) {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'close').catch(() => undefined);
      }
      try {
        journal?.close();
      } catch {
        // The journal fd is already closed.
      }
      restoreManifestText(join(directory, 'session.json'), claimed.previous);
      throw error;
    }
  }

  async upsertIfChanged(
    partitionId: string,
    source: GraphCompositionRequest['sources'][number],
    canonical: (fact: GraphWorkspaceFact) => string,
    buildClock = ''
  ): Promise<number> {
    const stable = this.applyTrustedObservation(partitionId, source, buildClock);
    const fingerprint = partitionFingerprint(stable, canonical);
    if (this.residentFingerprints.get(partitionId) === fingerprint) return 0;
    const metadata: PartitionUpsertMetadata = {
      providerId: source.manifest.id,
      providerVersion: source.manifest.version,
      sourceIdentity: partitionId,
      sourceDigest: aggregateInputDigest(stable.batch.inputs),
      unknownZones: stable.batch.unknownZones,
      unsupportedZones: stable.batch.unsupportedZones,
      coverage: stable.batch.coverage,
      staleZones: stable.batch.facts
        .filter((fact) => fact.freshness.status === 'stale')
        .map((fact) => ({ scope: fact.factId, reason: 'fact freshness is stale' })),
      batchStatus: stable.batch.status,
      streaming: 'legacy-array',
      semanticDigest: fingerprint,
    };
    const bytes = await this.upsert(partitionId, stable.batch.facts, canonical, metadata);
    this.journal.append(FINGERPRINT, Buffer.concat([text(partitionId), text(fingerprint)]));
    this.rememberObservation(partitionId, stable);
    this.residentFingerprints.set(partitionId, fingerprint);
    this.encodedPartitions += 1;
    this.encodedIds.push(partitionId);
    return bytes;
  }

  encodedPartitionCount(): number {
    return this.encodedPartitions;
  }

  encodedPartitionIds(): readonly string[] {
    return [...this.encodedIds];
  }

  async upsert(
    partitionId: string,
    facts: readonly GraphWorkspaceFact[],
    canonical: (fact: GraphWorkspaceFact) => string,
    metadata: PartitionUpsertMetadata = defaultMetadata(partitionId)
  ): Promise<number> {
    const body = encodeUpsert(partitionId, facts, canonical, metadata);
    const digest = createHash('sha256').update(body).digest('hex');
    if (this.residentDigests.get(partitionId) === digest) return 0;
    const record = this.journal.append(UPSERT, body);
    await this.writeFrame(UPSERT, body);
    await this.readAck(record.payloadDigest);
    this.residentDigests.set(partitionId, record.payloadDigest);
    return body.byteLength;
  }

  async remove(partitionId: string): Promise<void> {
    if (!this.residentDigests.has(partitionId)) return;
    const body = text(partitionId);
    const record = this.journal.append(REMOVE, body);
    await this.writeFrame(REMOVE, body);
    await this.readAck(record.payloadDigest);
    this.residentDigests.delete(partitionId);
    this.residentFingerprints.delete(partitionId);
  }

  private async stopChild(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.kill('SIGKILL');
    await once(this.child, 'close').catch(() => undefined);
    try {
      this.journal.close();
    } catch {
      return;
    }
  }

  killNow(): void {
    if (this.closed) return;
    this.child.kill('SIGKILL');
  }

  async shutdown(): Promise<void> {
    await this.stopChild();
    this.releaseOwnership();
  }

  async destroy(): Promise<void> {
    await this.stopChild();
    rmSync(this.directory, { recursive: true, force: true });
  }

  async commit(
    request: GraphCompositionRequest = this.request,
    evaluatedAt = this.evaluatedAt
  ): Promise<PartitionCommitStats> {
    const header = headerPayload(
      request,
      semanticDigests(request),
      evaluatedAt,
      join(this.directory, 'content.json'),
      this.packedPath
    );
    this.journal.append(COMMIT, header);
    await this.writeFrame(COMMIT, header);
    const response = await this.readResponseFrame();
    const quality = await this.readResponseFrame();
    const stats = await this.readResponseFrame();
    const meta = await this.readResponseFrame();
    if (response.byteLength !== 248 || response.readUInt32LE(0) !== 0) {
      throw new Error('session-commit');
    }
    if (quality.subarray(0, 4).toString('ascii') !== 'WQRY') throw new Error('session-quality');
    if (stats.subarray(0, 4).toString('ascii') !== 'WSES' || stats.byteLength !== 24) {
      throw new Error('session-stats');
    }
    const recomputed = stats.readUInt32LE(4) === 1;
    if (recomputed) {
      this.contentEvaluatedAt = evaluatedAt;
      this.journal.append(CONTENT_CLOCK, text(evaluatedAt));
    }
    const factDigest = response.subarray(8, 72).toString('ascii');
    const contentDigest = response.subarray(72, 136).toString('ascii');
    const packedDigest = quality.subarray(4 + 48, 4 + 48 + 64).toString('ascii');
    const published = publishNativeSnapshot(this.packedPath, {
      factDigest,
      contentDigest,
      factCount: Number(response.readBigUInt64LE(136)),
      nodeCount: Number(response.readBigUInt64LE(144)),
      edgeCount: Number(response.readBigUInt64LE(152)),
      decisionCount: response.readUInt32LE(236),
      unresolvedCount: response.readUInt32LE(240),
    });
    if (published.packedDigest !== packedDigest) throw new Error('packed-digest');
    const qualityParsed = parseQuality(quality);
    return {
      recomputed,
      contentEvaluatedAt: this.contentEvaluatedAt || evaluatedAt,
      reusedPartitions: stats.readUInt32LE(8),
      touchedPartitions: stats.readUInt32LE(12),
      affectedFacts: stats.readUInt32LE(16),
      parsedFacts: stats.readUInt32LE(20),
      factDigest,
      contentDigest,
      packedDigest,
      snapshotId: published.packedDigest,
      partitions: parsePartitionMeta(meta),
      native: {
        facts: responseNumber(response, 136),
        nodes: responseNumber(response, 144),
        edges: responseNumber(response, 152),
        packedBytes: responseNumber(response, 160),
        canonicalBytes: responseNumber(response, 168),
        spillBytes: responseNumber(response, 176),
        retainedCanonicalBytes: responseNumber(response, 184),
        rustRssBytes: responseNumber(response, 192),
        rssKnown: response.readUInt32LE(232) === 1,
        ingestMs: responseNumber(response, 200),
        digestMs: responseNumber(response, 208),
        edgeMs: responseNumber(response, 216),
        publishMs: responseNumber(response, 224),
        decisions: response.readUInt32LE(236),
        unresolved: response.readUInt32LE(240),
        quality: qualityParsed,
      },
    };
  }

  /**
   * Restart the Rust child from the synced journal. The Node object stays
   * alive. This does not discover a journal after the Node process itself exits.
   */
  async restartFromDurableJournal(): Promise<void> {
    this.child.kill('SIGKILL');
    await once(this.child, 'close').catch(() => undefined);
    const binary = resolveComposeBinary();
    if (!binary) throw new Error('native-binary-missing');
    this.child = spawn(binary.path, ['session'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    this.frames = new FrameReader(this.child.stdout);
    this.childExit = new Promise((resolve) => {
      this.child.once('exit', () => resolve());
    });
    this.seq = 0;
    await replayJournalRecords(
      this.journal.path,
      this.journal.sessionId,
      { requireFinish: false },
      async (record) => {
        if (
          record.kind === FINGERPRINT ||
          record.kind === CONTENT_CLOCK ||
          record.kind === OBSERVATION
        ) {
          this.noteReplayed(record.kind, record.payload, record.payloadDigest);
          return;
        }
        if (record.kind !== BEGIN && record.kind !== UPSERT && record.kind !== REMOVE) return;
        await this.writeFrame(record.kind, record.payload);
        await this.readAck(record.payloadDigest);
        this.noteReplayed(record.kind, record.payload, record.payloadDigest);
      }
    );
  }

  /**
   * Leave the journal directory in place and drop this process's child.
   * A later process may resume it when the recorded owner is not alive.
   */
  async abandon(): Promise<string> {
    const directory = this.directory;
    await this.stopChild();
    return directory;
  }

  async abort(): Promise<void> {
    const body = Buffer.alloc(0);
    const record = this.journal.append(ABORT, body);
    await this.writeFrame(ABORT, body);
    await this.readAck(record.payloadDigest);
  }

  async close(): Promise<void> {
    if (!this.closed) {
      try {
        this.journal.finish();
      } catch {
        // A restarted session may already have a finished journal.
      }
    }
    await this.destroy();
  }

  private noteReplayed(kind: number, payload: Buffer, digest: string): void {
    if (kind === UPSERT && payload.subarray(0, 4).toString('ascii') === 'PM2\0') {
      const id = readPrefixedString(payload.subarray(4));
      if (id) this.residentDigests.set(id, digest);
      const semantic = semanticDigestFromUpsert(payload);
      if (semantic?.digest) this.residentFingerprints.set(semantic.id, semantic.digest);
      return;
    }
    if (kind === FINGERPRINT) {
      const id = readPrefixedStringAt(payload, 0);
      const fingerprint = id ? readPrefixedStringAt(payload, id.next) : undefined;
      if (id && fingerprint) this.residentFingerprints.set(id.value, fingerprint.value);
      return;
    }
    if (kind === CONTENT_CLOCK) {
      const time = readPrefixedString(payload);
      if (time) this.contentEvaluatedAt = time;
      return;
    }
    if (kind === OBSERVATION) {
      const id = readPrefixedStringAt(payload, 0);
      const digest = id ? readPrefixedStringAt(payload, id.next) : undefined;
      const body = digest ? readPrefixedStringAt(payload, digest.next) : undefined;
      if (!id || !digest || !body) throw new Error('journal-corrupt');
      const parsed: unknown = JSON.parse(body.value);
      if (!Array.isArray(parsed)) throw new Error('journal-corrupt');
      const times = new Map<string, { readonly time: string; readonly origin: string }>();
      for (const entry of parsed) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 3 ||
          typeof entry[0] !== 'string' ||
          typeof entry[1] !== 'string' ||
          typeof entry[2] !== 'string' ||
          !OBSERVATION_ORIGINS.has(entry[2])
        ) {
          throw new Error('journal-corrupt');
        }
        times.set(entry[0], { time: entry[1], origin: entry[2] });
      }
      this.observations.set(id.value, { inputDigest: digest.value, times });
      return;
    }
    if (kind === REMOVE) {
      const id = readPrefixedString(payload);
      if (id) {
        this.residentDigests.delete(id);
        this.residentFingerprints.delete(id);
        this.observations.delete(id);
      }
    }
  }

  private applyTrustedObservation(
    partitionId: string,
    source: GraphCompositionRequest['sources'][number],
    buildClock: string
  ): GraphCompositionRequest['sources'][number] {
    const stored = this.observations.get(partitionId);
    const digest = aggregateInputDigest(source.batch.inputs);
    if (!stored || stored.inputDigest !== digest || buildClock.length === 0) return source;
    let rewritten = false;
    const facts = source.batch.facts.map((fact) => {
      const trusted = stored.times.get(fact.factId);
      const origin = observationOriginFor(source, fact.factId);
      if (
        !trusted ||
        trusted.origin !== 'build-clock' ||
        origin !== 'build-clock' ||
        fact.observedAt !== buildClock ||
        fact.observedAt === trusted.time
      ) {
        return fact;
      }
      rewritten = true;
      return { ...fact, observedAt: trusted.time };
    });
    if (!rewritten) return source;
    return { ...source, batch: { ...source.batch, facts } };
  }

  private rememberObservation(
    partitionId: string,
    source: GraphCompositionRequest['sources'][number]
  ): void {
    const inputDigest = aggregateInputDigest(source.batch.inputs);
    const times = new Map(
      source.batch.facts.map((fact) => [
        fact.factId,
        {
          time: fact.observedAt,
          origin: observationOriginFor(source, fact.factId),
        },
      ])
    );
    this.observations.set(partitionId, { inputDigest, times });
    this.journal.append(
      OBSERVATION,
      Buffer.concat([
        text(partitionId),
        text(inputDigest),
        text(
          JSON.stringify(
            [...times].map(([factId, observation]) => [
              factId,
              observation.time,
              observation.origin,
            ])
          )
        ),
      ])
    );
  }

  private writeFrame(kind: number, payload: Buffer): Promise<void> {
    const encoded = frame(kind, payload);
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.child.stdin.off('drain', onDrain);
        reject(error);
      };
      const onDrain = (): void => {
        this.child.stdin.off('error', onError);
        resolve();
      };
      this.child.stdin.once('error', onError);
      if (this.child.stdin.write(encoded)) {
        this.child.stdin.off('error', onError);
        resolve();
        return;
      }
      this.child.stdin.once('drain', onDrain);
    });
  }

  private readAck(payloadDigest: string): Promise<void> {
    return this.readResponseFrame().then((ack) => {
      if (ack.byteLength !== 42 || ack[0] !== 0xa3 || ack[1] !== 1) throw new Error('session-ack');
      if (ack.readUInt32LE(2) !== 2) throw new Error('session-stage');
      if (ack.readUInt32LE(6) !== this.seq) throw new Error('session-seq');
      this.seq += 1;
      if (payloadDigest) {
        const digest = ack.subarray(10, 42).toString('hex');
        if (digest !== payloadDigest) throw new Error('session-digest');
      }
    });
  }

  private readResponseFrame(): Promise<Buffer> {
    return withTimeout(
      Promise.race([
        readFrame(this.frames),
        this.childExit.then(() => {
          throw new Error('session-exit');
        }),
      ]),
      'session-timeout'
    );
  }
}

function parsePartitionMeta(frame: Buffer): PartitionCommitStats['partitions'] {
  if (frame.subarray(0, 4).toString('ascii') !== 'WMET') throw new Error('session-meta');
  let at = 4;
  const count = frame.readUInt32LE(at);
  at += 4;
  const partitions = [];
  const readText = (): string => {
    const length = frame.readUInt32LE(at);
    at += 4;
    const value = frame.subarray(at, at + length).toString('utf8');
    at += length;
    return value;
  };
  for (let index = 0; index < count; index += 1) {
    partitions.push({
      partitionId: readText(),
      providerId: readText(),
      sourceIdentity: readText(),
      sourceDigest: readText(),
      metadata: readText(),
    });
  }
  if (at !== frame.byteLength) throw new Error('session-meta');
  return partitions;
}

function responseNumber(response: Buffer, offset: number): number {
  return Number(response.readBigUInt64LE(offset));
}

async function acquireResidentSession(
  poolKey: string,
  sessionKey: string,
  request: GraphCompositionRequest,
  evaluatedAt: string,
  signal: AbortSignal | undefined
): Promise<NativePartitionSession> {
  const current = residentSessions.get(poolKey);
  if (current && !current.session.isClosed() && Date.now() - current.usedAt < RESIDENT_TTL_MS) {
    current.usedAt = Date.now();
    return current.session;
  }
  if (current) {
    residentSessions.delete(poolKey);
    await current.session.shutdown();
  }
  await evictResidentSessions(poolKey);
  const directory = join(partitionJournalRoot(), 'live', sessionKey);
  reapAbandonedJournals(partitionJournalRoot(), new Set([directory]));
  let session: NativePartitionSession;
  if (existsSync(join(directory, 'session.json'))) {
    try {
      session = await NativePartitionSession.resume(directory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'session-live') throw error;
      rmSync(directory, { recursive: true, force: true });
      session = await NativePartitionSession.open(request, evaluatedAt, signal, directory);
    }
  } else {
    session = await NativePartitionSession.open(request, evaluatedAt, signal, directory);
  }
  residentSessions.set(poolKey, { session, usedAt: Date.now() });
  return session;
}

type CompositionSource = GraphCompositionRequest['sources'][number];

function sameMembers<T>(left: readonly T[], right: readonly T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectDeclaredInputPartitions(source: CompositionSource): CompositionSource[] {
  const inputLocators = source.batch.inputs.map((input) => input.locator);
  if (
    new Set(inputLocators).size !== inputLocators.length ||
    inputLocators.some((locator) => locator.startsWith('synthetic:'))
  ) {
    throw new Error('partition-ownership');
  }
  const claimed = new Set(inputLocators);
  const emptyRedaction = {
    policy: source.batch.redaction.policy,
    redacted: 0,
    omitted: 0,
  };
  const slices: CompositionSource[] = source.batch.inputs.map((input) => ({
    ...source,
    partitionOwnership: [{ locator: input.locator, facts: [] }],
    batch: {
      ...source.batch,
      inputs: [input],
      facts: [],
      processing: source.batch.processing.filter(
        (record) => record.input.locator === input.locator
      ),
      unknownZones: source.batch.unknownZones.filter((zone) => zone.scope === input.locator),
      unsupportedZones: source.batch.unsupportedZones.filter(
        (zone) => zone.scope === input.locator
      ),
      diagnostics: [],
      coverage: [],
      redaction: emptyRedaction,
      status: 'complete',
    },
  }));
  const receiptUnknown = source.batch.unknownZones.filter((zone) => !claimed.has(zone.scope));
  const receiptUnsupported = source.batch.unsupportedZones.filter(
    (zone) => !claimed.has(zone.scope)
  );
  const receiptProcessing = source.batch.processing.filter(
    (record) => !claimed.has(record.input.locator)
  );
  const receiptDigest = createHash('sha256')
    .update(JSON.stringify(source.batch.coverage))
    .update('\0')
    .update(JSON.stringify(receiptUnknown))
    .update('\0')
    .update(JSON.stringify(receiptUnsupported))
    .update('\0')
    .update(JSON.stringify(source.batch.diagnostics))
    .update('\0')
    .update(JSON.stringify(source.batch.redaction))
    .digest('hex');
  slices.push({
    ...source,
    partitionOwnership: [],
    batch: {
      ...source.batch,
      inputs: [
        { locator: 'synthetic:receipt', digest: { algorithm: 'sha256', value: receiptDigest } },
      ],
      facts: [],
      processing: receiptProcessing,
      unknownZones: receiptUnknown,
      unsupportedZones: receiptUnsupported,
      diagnostics: source.batch.diagnostics,
      coverage: source.batch.coverage,
      redaction: source.batch.redaction,
      status: source.batch.status,
    },
  });
  assertJoinedReceipt(source, slices);
  return slices;
}

/**
 * Splits a batch only by the locator each fact declares. Identical content
 * digests stay on their own locators. Batch coverage, diagnostics, and
 * redaction stay on one receipt partition so they are not reconstructed per file.
 * A fact-free batch is split by its declared input locators.
 */
function legacyPartitionOwnership(
  source: CompositionSource
): CompositionSource['partitionOwnership'] | undefined {
  const legacyOwnerCount = source.batch.facts.filter(
    (fact) => fact.partitionOwner !== undefined
  ).length;
  if (
    !source.partitionOwnership &&
    legacyOwnerCount > 0 &&
    legacyOwnerCount !== source.batch.facts.length
  ) {
    throw new Error('partition-ownership');
  }
  return source.batch.facts.length > 0 && legacyOwnerCount === source.batch.facts.length
    ? source.batch.facts.reduce<NonNullable<CompositionSource['partitionOwnership']>>(
        (partitions, fact) => {
          const owner = fact.partitionOwner;
          if (!owner) return partitions;
          const existing = partitions.find((partition) => partition.locator === owner.locator);
          if (existing) {
            return partitions.map((partition) =>
              partition === existing
                ? {
                    ...partition,
                    facts: [
                      ...partition.facts,
                      { factId: fact.factId, observationOrigin: owner.observationOrigin },
                    ],
                  }
                : partition
            );
          }
          return [
            ...partitions,
            {
              locator: owner.locator,
              facts: [{ factId: fact.factId, observationOrigin: owner.observationOrigin }],
            },
          ];
        },
        []
      )
    : undefined;
}

/** Promote provider partition hints into the transport envelope. */
export function promoteNativePartitionEnvelope(source: CompositionSource): CompositionSource {
  const ownership = source.partitionOwnership ?? legacyPartitionOwnership(source);
  if (!ownership) return source;
  const facts = source.batch.facts.map((fact) => {
    const { partitionOwner: _providerHint, ...semanticFact } = fact;
    return semanticFact;
  });
  return { ...source, partitionOwnership: ownership, batch: { ...source.batch, facts } };
}

export function projectExplicitPartitions(input: CompositionSource): CompositionSource[] {
  const source = promoteNativePartitionEnvelope(input);
  const ownership = source.partitionOwnership;
  if (!ownership || ownership.length === 0) {
    if (source.batch.facts.length > 0 && source.batch.inputs.length > 1) {
      throw new Error('partition-ownership');
    }
    if (source.batch.facts.length > 0 || source.batch.inputs.length <= 1) return [source];
    return projectDeclaredInputPartitions(source);
  }
  const inputLocators = source.batch.inputs.map((input) => input.locator);
  if (
    new Set(inputLocators).size !== inputLocators.length ||
    inputLocators.some((locator) => locator.startsWith('synthetic:'))
  ) {
    throw new Error('partition-ownership');
  }
  const inputs = new Map(source.batch.inputs.map((input) => [input.locator, input]));
  const locators: string[] = ownership.map((partition) => partition.locator);
  if (
    new Set(locators).size !== locators.length ||
    locators.some((locator) => locator.length === 0 || locator === 'synthetic:receipt')
  ) {
    throw new Error('partition-ownership');
  }
  const factsByLocator = new Map<string, GraphWorkspaceFact[]>();
  const seenFacts = new Set<string>();
  const factsById = new Map(source.batch.facts.map((fact) => [fact.factId, fact]));
  if (factsById.size !== source.batch.facts.length) throw new Error('partition-ownership');
  for (const partition of ownership) {
    const synthetic = partition.locator.startsWith('synthetic:');
    if (!synthetic && !inputs.has(partition.locator)) throw new Error('partition-ownership');
    const group: GraphWorkspaceFact[] = [];
    for (const ownedFact of partition.facts) {
      if (
        !DECLARED_OBSERVATION_ORIGINS.has(ownedFact.observationOrigin) ||
        seenFacts.has(ownedFact.factId)
      ) {
        throw new Error('partition-ownership');
      }
      const fact = factsById.get(ownedFact.factId);
      if (!fact) throw new Error('partition-ownership');
      seenFacts.add(ownedFact.factId);
      const { partitionOwner: _legacyOwner, ...semanticFact } = fact;
      group.push(semanticFact);
    }
    factsByLocator.set(partition.locator, group);
  }
  if (seenFacts.size !== source.batch.facts.length) throw new Error('partition-ownership');
  const processingByLocator = new Map<string, CompositionSource['batch']['processing'][number][]>();
  const receiptProcessing: CompositionSource['batch']['processing'][number][] = [];
  for (const record of source.batch.processing) {
    if (factsByLocator.has(record.input.locator) || inputs.has(record.input.locator)) {
      if (!factsByLocator.has(record.input.locator) && inputs.has(record.input.locator)) {
        locators.push(record.input.locator);
        factsByLocator.set(record.input.locator, []);
      }
      const group = processingByLocator.get(record.input.locator) ?? [];
      group.push(record);
      processingByLocator.set(record.input.locator, group);
    } else {
      receiptProcessing.push(record);
    }
  }
  const fileLocators = new Set(factsByLocator.keys());
  const unknownByLocator = new Map<string, CompositionSource['batch']['unknownZones'][number][]>();
  const receiptUnknown: CompositionSource['batch']['unknownZones'][number][] = [];
  for (const zone of source.batch.unknownZones) {
    if (fileLocators.has(zone.scope)) {
      const group = unknownByLocator.get(zone.scope) ?? [];
      group.push(zone);
      unknownByLocator.set(zone.scope, group);
    } else {
      receiptUnknown.push(zone);
    }
  }
  const unsupportedByLocator = new Map<
    string,
    CompositionSource['batch']['unsupportedZones'][number][]
  >();
  const receiptUnsupported: CompositionSource['batch']['unsupportedZones'][number][] = [];
  for (const zone of source.batch.unsupportedZones) {
    if (fileLocators.has(zone.scope)) {
      const group = unsupportedByLocator.get(zone.scope) ?? [];
      group.push(zone);
      unsupportedByLocator.set(zone.scope, group);
    } else {
      receiptUnsupported.push(zone);
    }
  }
  const emptyRedaction = {
    policy: source.batch.redaction.policy,
    redacted: 0,
    omitted: 0,
  };
  const slices: CompositionSource[] = locators.map((locator) => {
    const input = inputs.get(locator);
    const facts = factsByLocator.get(locator) ?? [];
    return {
      ...source,
      partitionOwnership: [
        ownership.find((partition) => partition.locator === locator) ?? {
          locator,
          facts: [],
        },
      ],
      batch: {
        ...source.batch,
        inputs: input
          ? [input]
          : [
              {
                locator,
                digest: {
                  algorithm: 'sha256' as const,
                  value: createHash('sha256').update(`synthetic\0${locator}`).digest('hex'),
                },
              },
            ],
        facts,
        processing: processingByLocator.get(locator) ?? [],
        unknownZones: unknownByLocator.get(locator) ?? [],
        unsupportedZones: unsupportedByLocator.get(locator) ?? [],
        diagnostics: [],
        coverage: [],
        redaction: emptyRedaction,
        status: (processingByLocator.get(locator) ?? []).some((record) =>
          ['failed', 'omitted'].includes(record.outcome)
        )
          ? 'partial'
          : 'complete',
      },
    };
  });
  const receiptDigest = createHash('sha256')
    .update(JSON.stringify(source.batch.coverage))
    .update('\0')
    .update(JSON.stringify(receiptUnknown))
    .update('\0')
    .update(JSON.stringify(receiptUnsupported))
    .update('\0')
    .update(JSON.stringify(source.batch.diagnostics))
    .update('\0')
    .update(JSON.stringify(source.batch.redaction))
    .digest('hex');
  slices.push({
    ...source,
    partitionOwnership: [],
    batch: {
      ...source.batch,
      inputs: [
        {
          locator: 'synthetic:receipt',
          digest: { algorithm: 'sha256', value: receiptDigest },
        },
      ],
      facts: [],
      processing: receiptProcessing,
      unknownZones: receiptUnknown,
      unsupportedZones: receiptUnsupported,
      diagnostics: source.batch.diagnostics,
      coverage: source.batch.coverage,
      redaction: source.batch.redaction,
      status: source.batch.status,
    },
  });
  assertJoinedReceipt(source, slices);
  return slices;
}

function assertJoinedReceipt(
  source: CompositionSource,
  slices: readonly CompositionSource[]
): void {
  const facts = slices.flatMap((slice) => slice.batch.facts);
  const originalIds = source.batch.facts.map((fact) => fact.factId).sort();
  const joinedIds = facts.map((fact) => fact.factId).sort();
  if (JSON.stringify(originalIds) !== JSON.stringify(joinedIds))
    throw new Error('partition-ownership');
  const processing = [...slices]
    .flatMap((slice) => slice.batch.processing)
    .map((record) => JSON.stringify(record))
    .sort();
  const originalProcessing = source.batch.processing.map((record) => JSON.stringify(record)).sort();
  if (JSON.stringify(processing) !== JSON.stringify(originalProcessing)) {
    throw new Error('partition-ownership');
  }
  const receipt = slices.find((slice) => slice.batch.inputs[0]?.locator === 'synthetic:receipt');
  if (!receipt) throw new Error('partition-ownership');
  if (
    !sameMembers(receipt.batch.coverage, source.batch.coverage) ||
    !sameMembers(receipt.batch.diagnostics, source.batch.diagnostics) ||
    JSON.stringify(receipt.batch.redaction) !== JSON.stringify(source.batch.redaction)
  ) {
    throw new Error('partition-ownership');
  }
  const unknown = slices.flatMap((slice) => slice.batch.unknownZones);
  const unsupported = slices.flatMap((slice) => slice.batch.unsupportedZones);
  if (
    JSON.stringify([...unknown].map((zone) => JSON.stringify(zone)).sort()) !==
      JSON.stringify(source.batch.unknownZones.map((zone) => JSON.stringify(zone)).sort()) ||
    JSON.stringify([...unsupported].map((zone) => JSON.stringify(zone)).sort()) !==
      JSON.stringify(source.batch.unsupportedZones.map((zone) => JSON.stringify(zone)).sort())
  ) {
    throw new Error('partition-ownership');
  }
}

interface StreamFallbackSpill {
  readonly directory: string;
  readonly files: string[];
  complete: boolean;
}

const streamFallbackSpills = new WeakMap<GraphCompositionRequest, StreamFallbackSpill>();

function streamFallbackSpill(request: GraphCompositionRequest): StreamFallbackSpill {
  const existing = streamFallbackSpills.get(request);
  if (existing) return existing;
  const directory = mkdtempSync(join(tmpdir(), 'workspai-graph-fallback-'));
  const created = { directory, files: [], complete: false };
  streamFallbackSpills.set(request, created);
  return created;
}

function retainStreamedPartition(request: GraphCompositionRequest, source: unknown): void {
  const spill = streamFallbackSpill(request);
  const file = join(spill.directory, `${spill.files.length}.json`);
  writeFileSync(file, JSON.stringify(source), { mode: 0o600 });
  spill.files.push(file);
}

/** Drop streamed fact spill once native publication has committed. */
export function discardStreamedPartitionSpill(request: GraphCompositionRequest): void {
  const spill = streamFallbackSpills.get(request);
  if (!spill) return;
  streamFallbackSpills.delete(request);
  rmSync(spill.directory, { recursive: true, force: true });
}

/**
 * Restore streamed facts onto empty provider shells after native publication
 * does not commit. A partial stream is not replayed.
 */
export function rehydrateStreamedPartitionSpill(
  sources: GraphCompositionRequest['sources'],
  request: GraphCompositionRequest
): GraphCompositionRequest['sources'] {
  const spill = streamFallbackSpills.get(request);
  if (!spill?.complete) {
    discardStreamedPartitionSpill(request);
    return sources;
  }
  const byProvider = new Map<string, Array<GraphCompositionRequest['sources'][number]>>();
  for (const file of spill.files) {
    const source = JSON.parse(
      readFileSync(file, 'utf8')
    ) as GraphCompositionRequest['sources'][number];
    const group = byProvider.get(source.manifest.id) ?? [];
    group.push(source);
    byProvider.set(source.manifest.id, group);
  }
  discardStreamedPartitionSpill(request);
  return sources.map((source) => {
    const slices = byProvider.get(source.manifest.id);
    if (!slices || source.batch.facts.length > 0) return source;
    return {
      ...source,
      batch: {
        ...source.batch,
        facts: slices.flatMap((slice) => slice.batch.facts),
      },
    };
  });
}

/**
 * Kernel composition through a session that stays open across builds of the
 * same workspace, ontology, and policy. Unchanged partitions are not sent
 * again. A changed partition reparses only its own facts and recomputes the
 * affected closure. The caller arrays are still the provider contract.
 */
export async function composeThroughResidentSession(
  request: GraphCompositionRequest,
  canonical: (fact: GraphWorkspaceFact) => string,
  evaluatedAt: string,
  cancellation: GraphCancellationPort,
  signal?: AbortSignal,
  options?: { readonly materialize?: boolean }
): Promise<OwnedCompositionComplete | OwnedCompositionFallback> {
  const factCount = request.sources.reduce((total, source) => total + source.batch.facts.length, 0);
  if (request.identityFreeze) {
    return {
      status: 'fallback',
      reason: 'identity-freeze',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: factCount,
    };
  }
  if (request.policy.functionalRelations.length > 0) {
    return {
      status: 'fallback',
      reason: 'functional-relations',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: factCount,
    };
  }
  const sessionKey = residentSessionKey(request);
  const key = residentPoolKey(request);
  return enqueueResident(key, async () => {
    let session: NativePartitionSession | undefined;
    let boundaryBytes = 0;
    try {
      cancellation.throwIfAborted();
      if (signal?.aborted) throw new Error('cancelled');
      session = await acquireResidentSession(key, sessionKey, request, evaluatedAt, signal);
      session.beginBuild();
      const streamedIds = new Set<string>();
      if (request.streamSources) {
        for await (const source of request.streamSources()) {
          cancellation.throwIfAborted();
          if (signal?.aborted) throw new Error('cancelled');
          retainStreamedPartition(request, source);
          const streamedSlices = projectExplicitPartitions(source);
          for (const slice of streamedSlices) {
            if (
              slice.batch.facts.length === 0 &&
              slice.batch.coverage.length === 0 &&
              slice.batch.inputs[0]?.locator === 'synthetic:receipt'
            ) {
              continue;
            }
            const partitionId = residentPartitionId(slice);
            streamedIds.add(partitionId);
            boundaryBytes += await session.upsertIfChanged(
              partitionId,
              slice,
              canonical,
              evaluatedAt
            );
          }
        }
        const spill = streamFallbackSpills.get(request);
        if (spill) spill.complete = true;
      }
      const slices = (
        request.streamSources
          ? request.sources.filter((source) => source.batch.facts.length > 0)
          : request.sources
      ).flatMap((source) => projectExplicitPartitions(source));
      const partitionIds = slices.map((source) => residentPartitionId(source));
      if (new Set(partitionIds).size !== partitionIds.length)
        throw new Error('partition-ownership');
      const wanted = new Set([...partitionIds, ...streamedIds]);
      for (const id of session.residentPartitionIds()) {
        if (!wanted.has(id)) await session.remove(id);
      }
      for (const [index, source] of slices.entries()) {
        cancellation.throwIfAborted();
        if (signal?.aborted) throw new Error('cancelled');
        const partitionId = partitionIds[index] ?? residentPartitionId(source);
        boundaryBytes += await session.upsertIfChanged(partitionId, source, canonical, evaluatedAt);
      }
      const committed = await session.commit(request, evaluatedAt);
      const quality = committed.native.quality;
      const contentEvaluatedAt = committed.contentEvaluatedAt;
      const reused = !committed.recomputed;
      if (quality.orphans.length !== quality.orphanCount) throw new Error('orphans-truncated');
      const binary = resolveComposeBinary();
      const semantic = semanticDigests(request);
      const snapshot: NativeGraphSnapshot = Object.freeze({
        schema: 'workspai.graph.native-snapshot.v1',
        snapshotId: committed.snapshotId,
        format: snapshotFormat(session.residentPackedPath()),
        formatVersion: 1,
        protocolVersion: 2,
        binaryPackaging: snapshotPackaging(binary?.packaging ?? 'development'),
        factDigest: digestReference(committed.factDigest),
        contentDigest: digestReference(committed.contentDigest),
        packedDigest: committed.packedDigest,
        packedBytes: committed.native.packedBytes,
        nodeCount: committed.native.nodes,
        edgeCount: committed.native.edges,
        factCount: committed.native.facts,
        unresolvedCount: committed.native.unresolved,
        decisionCount: committed.native.decisions,
        orphanCount: quality.orphanCount,
        staleFactCount: quality.staleFactCount,
        decisionsAccepted: quality.decisionsAccepted,
        decisionsRejected: quality.decisionsRejected,
        decisionsDisputed: quality.decisionsDisputed,
        decisionsUnresolved: quality.decisionsUnresolved,
        proofStates: quality.proofStates,
        fallback: '',
        lifecycle: 'published',
        storage: 'content-addressed',
        query: 'paged',
        evaluatedAt: contentEvaluatedAt,
      });
      const decoded = options?.materialize
        ? materializeNativeGraphSnapshot(snapshot)
        : { nodes: [], edges: [], decisions: [], unresolved: [] };
      const committedIds = new Set(committed.partitions.map((partition) => partition.partitionId));
      if (committedIds.size !== wanted.size || [...wanted].some((id) => !committedIds.has(id))) {
        throw new Error('session-meta');
      }
      if (request.streamSources) {
        if (slices.length > 0) {
          assertPartitionBinding(
            slices,
            committed.partitions.filter((partition) => partitionIds.includes(partition.partitionId))
          );
        }
      } else {
        assertPartitionBinding(slices, committed.partitions);
      }
      const packedStat = statSync(session.residentPackedPath());
      const snapshotStat = statSync(nativeSnapshotPackedPath(committed.snapshotId));
      session.noteBuild({
        recomputed: committed.recomputed,
        boundaryBytes,
        encodedPartitions: session.encodedPartitionCount(),
        encodedPartitionIds: session.encodedPartitionIds(),
        packedMtimeMs: packedStat.mtimeMs,
        packedIno: packedStat.ino,
        snapshotMtimeMs: snapshotStat.mtimeMs,
        snapshotIno: snapshotStat.ino,
        affectedFacts: committed.affectedFacts,
        parsedFacts: committed.parsedFacts,
      });
      return {
        status: 'complete',
        factDigest: snapshot.factDigest,
        contentDigest: snapshot.contentDigest,
        nodes: decoded.nodes,
        edges: decoded.edges,
        decisions: decoded.decisions,
        unresolved: decoded.unresolved,
        snapshot,
        proofStates: quality.proofStates,
        orphanCount: quality.orphanCount,
        orphans: quality.orphans,
        decisionsAccepted: quality.decisionsAccepted,
        decisionsRejected: quality.decisionsRejected,
        decisionsDisputed: quality.decisionsDisputed,
        decisionsUnresolved: quality.decisionsUnresolved,
        staleFactCount: quality.staleFactCount,
        packedDigest: committed.packedDigest,
        materialized: options?.materialize === true,
        rustFacts: request.streamSources ? committed.native.facts : factCount,
        typescriptFacts: 0,
        boundaryBytes,
        rustRssBytes: reused || !committed.native.rssKnown ? 0 : committed.native.rustRssBytes,
        rssKnown: reused ? false : committed.native.rssKnown,
        simultaneousRssKnown: false,
        simultaneousRssBytes: 0,
        spillBytes: committed.native.spillBytes,
        retainedCanonicalBytes: committed.native.retainedCanonicalBytes,
        canonicalBytes: committed.native.canonicalBytes,
        packedBytes: committed.native.packedBytes,
        ingestMs: reused ? 0 : committed.native.ingestMs,
        digestMs: reused ? 0 : committed.native.digestMs,
        edgeMs: reused ? 0 : committed.native.edgeMs,
        publishMs: reused ? 0 : committed.native.publishMs,
        semantic,
        evaluatedAt: contentEvaluatedAt,
        partitionMetadata: committed.partitions,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'process-failed';
      if (session) {
        residentSessions.delete(key);
        if (reason === 'cancelled') await session.destroy().catch(() => undefined);
        else await session.shutdown().catch(() => undefined);
      }
      const spill = streamFallbackSpills.get(request);
      if (reason !== 'cancelled' && spill?.complete) {
        const replaced = rehydrateStreamedPartitionSpill(request.sources, request);
        const sources = request.sources as GraphCompositionRequest['sources'][number][];
        sources.splice(0, sources.length, ...replaced);
      } else if (request.streamSources && reason !== 'cancelled') {
        discardStreamedPartitionSpill(request);
        return {
          status: 'fallback',
          reason: 'stream-incomplete',
          boundaryBytes,
          rustFacts: 0,
          typescriptFacts: factCount,
        };
      } else {
        discardStreamedPartitionSpill(request);
      }
      return {
        status: 'fallback',
        reason,
        boundaryBytes,
        rustFacts: 0,
        typescriptFacts: factCount,
      };
    }
  });
}
