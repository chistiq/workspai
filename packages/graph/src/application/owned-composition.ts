import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { WisDigestReference } from '@workspai/shared/contracts';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  type GraphEdge,
  type GraphEntityAlias,
  type GraphEntityReference,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import { compactFactSupported, encodeCompactFactBatch } from './compact-fact-ir.js';
import type {
  GraphCompositionDecision,
  GraphCompositionRequest,
  NativeGraphProofCounts,
  NativeGraphSnapshot,
} from './composition-types.js';
import { GRAPH_COMPOSITION_ORDERING_RULES } from './composition-types.js';
import type { GraphCancellationPort } from '../ports/index.js';
import {
  closeNativeSnapshot,
  openNativeSnapshot,
  publishNativeSnapshot,
  snapshotBytesForDecode,
  snapshotFormat,
} from './native-snapshot-store.js';

const CANONICAL_DIGEST = 'workspai.graph.canonical-json.v1';
const KIND_HEADER = 1;
const KIND_COMPACT = 2;
const KIND_CANONICAL = 3;
const KIND_VALID_UNTIL = 4;
const KIND_FINISH = 5;
const RESPONSE_BYTES = 248;
const NONE = 0xffffffff;
/** One admitted shard is in flight. The next shard waits for its acceptance ACK. */
const MAX_IN_FLIGHT_SHARD_BYTES = 8 * 1024 * 1024;

export function encodeCompositionFrame(kind: number, payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(5 + payload.byteLength);
  frame.writeUInt32LE(1 + payload.byteLength, 0);
  frame[4] = kind;
  payload.copy(frame, 5);
  return frame;
}

export function composeBinaryFileName(platform: string, arch: string): string | undefined {
  const archName = arch === 'x64' || arch === 'arm64' ? arch : undefined;
  if (!archName) return undefined;
  if (platform === 'linux') return `graph-compose-graph-linux-${archName}`;
  if (platform === 'darwin') return `graph-compose-graph-darwin-${archName}`;
  if (platform === 'win32') return `graph-compose-graph-win32-${archName}.exe`;
  return undefined;
}

export interface OwnedCompositionComplete {
  readonly status: 'complete';
  readonly factDigest: WisDigestReference;
  readonly contentDigest: WisDigestReference;
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly decisions: readonly GraphCompositionDecision[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
  readonly snapshot?: NativeGraphSnapshot;
  readonly proofStates: NativeGraphProofCounts;
  readonly orphanCount: number;
  readonly orphans: readonly GraphEntityReference[];
  readonly decisionsAccepted: number;
  readonly decisionsRejected: number;
  readonly decisionsDisputed: number;
  readonly decisionsUnresolved: number;
  readonly staleFactCount: number;
  readonly packedDigest: string;
  readonly materialized: boolean;
  readonly rustFacts: number;
  readonly typescriptFacts: number;
  readonly boundaryBytes: number;
  readonly rustRssBytes: number;
  readonly rssKnown: boolean;
  readonly simultaneousRssKnown: boolean;
  readonly simultaneousRssBytes: number;
  readonly spillBytes: number;
  readonly retainedCanonicalBytes: number;
  readonly canonicalBytes: number;
  readonly packedBytes: number;
  readonly ingestMs: number;
  readonly digestMs: number;
  readonly edgeMs: number;
  readonly publishMs: number;
  readonly semantic: OwnedSemanticDigests;
  readonly evaluatedAt: string;
  /**
   * Partition metadata acknowledged by the resident session. Present only when
   * the receipt can be built without walking fact arrays again.
   */
  readonly partitionMetadata?: readonly {
    readonly partitionId: string;
    readonly providerId: string;
    readonly sourceIdentity: string;
    readonly sourceDigest: string;
    readonly metadata: string;
  }[];
}

export interface OwnedSemanticDigests {
  readonly ontology: WisDigestReference;
  readonly proofPolicies: WisDigestReference;
  readonly inputs: WisDigestReference;
  readonly providers: WisDigestReference;
  readonly compositionPolicy: WisDigestReference;
  readonly extractors: WisDigestReference;
  readonly redaction: WisDigestReference;
  readonly scope: WisDigestReference;
  readonly coverage: WisDigestReference;
  readonly unknownZones: WisDigestReference;
  readonly unsupportedZones: WisDigestReference;
  readonly ordering: WisDigestReference;
}

export interface OwnedCompositionFallback {
  readonly status: 'fallback';
  readonly reason: string;
  readonly boundaryBytes: number;
  readonly rustFacts: number;
  readonly typescriptFacts: number;
}

export function materializeNativeGraphSnapshot(snapshot: NativeGraphSnapshot): {
  readonly nodes: readonly GraphEntityReference[];
  readonly edges: readonly GraphEdge[];
  readonly decisions: readonly GraphCompositionDecision[];
  readonly unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
} {
  const opened = openNativeSnapshot(snapshot.snapshotId);
  try {
    if (
      opened.manifest.factDigest !== snapshot.factDigest.value ||
      opened.manifest.contentDigest !== snapshot.contentDigest.value ||
      opened.manifest.nodeCount !== snapshot.nodeCount ||
      opened.manifest.edgeCount !== snapshot.edgeCount ||
      opened.manifest.factCount !== snapshot.factCount
    ) {
      throw new Error('snapshot-mismatch');
    }
    const decoded = decodePacked(snapshotBytesForDecode(opened.packed), snapshot.evaluatedAt);
    if (
      decoded.nodes.length !== snapshot.nodeCount ||
      decoded.edges.length !== snapshot.edgeCount
    ) {
      throw new Error('packed-count');
    }
    return decoded;
  } finally {
    opened.release();
  }
}

export function closeNativeGraphSnapshot(snapshotId: string): void {
  closeNativeSnapshot(snapshotId);
}

export function parseQuality(frame: Buffer): {
  readonly proofStates: NativeGraphProofCounts;
  readonly decisionsAccepted: number;
  readonly decisionsRejected: number;
  readonly decisionsDisputed: number;
  readonly decisionsUnresolved: number;
  readonly orphanCount: number;
  readonly orphans: readonly GraphEntityReference[];
  readonly staleFactCount: number;
  readonly packedDigest: string;
} {
  if (frame.byteLength < 124 || frame.subarray(0, 4).toString('ascii') !== 'WQRY') {
    throw new Error('quality-frame');
  }
  let at = 4;
  const read = (): number => {
    const value = frame.readUInt32LE(at);
    at += 4;
    return value;
  };
  const proofStates = Object.freeze({
    supported: read(),
    corroborated: read(),
    verified: read(),
    disputed: read(),
    insufficient: read(),
    unresolved: read(),
  });
  const decisionsAccepted = read();
  const decisionsRejected = read();
  const decisionsDisputed = read();
  const decisionsUnresolved = read();
  const orphanCount = read();
  const staleFactCount = read();
  const packedDigest = frame.subarray(at, at + 64).toString('ascii');
  at += 64;
  if (!/^[a-f0-9]{64}$/u.test(packedDigest)) throw new Error('packed-digest');
  const orphanTruncated = read();
  const recordBytes = read();
  if (orphanTruncated !== 0) throw new Error('orphans-truncated');
  if (at + recordBytes !== frame.byteLength) throw new Error('quality-frame');
  const orphans: GraphEntityReference[] = [];
  const readText = (): string => {
    const length = read();
    const value = frame.subarray(at, at + length).toString('utf8');
    at += length;
    return value;
  };
  while (orphans.length < orphanCount) {
    const id = readText();
    const kind = readText();
    const scheme = JSON.parse(readText()) as GraphEntityReference['identityScheme'];
    const scope = JSON.parse(readText()) as GraphEntityReference['scope'];
    const aliasCount = read();
    const aliases: GraphEntityAlias[] = [];
    for (let index = 0; index < aliasCount; index += 1) {
      aliases.push({ id: readText(), reason: readAliasReason(readText()) });
    }
    orphans.push({
      id,
      identityScheme: scheme,
      kind,
      scope,
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  if (at !== frame.byteLength || orphans.length !== orphanCount) throw new Error('quality-frame');
  return {
    proofStates,
    decisionsAccepted,
    decisionsRejected,
    decisionsDisputed,
    decisionsUnresolved,
    orphanCount,
    orphans,
    staleFactCount,
    packedDigest,
  };
}

export function digestReference(value: string): WisDigestReference {
  return Object.freeze({
    algorithm: 'sha256',
    value,
    canonicalization: CANONICAL_DIGEST,
  });
}

function digestCanonical(value: unknown): string {
  const canonical = canonicalizeGraphValue(value);
  if (!canonical.accepted) {
    throw new Error(canonical.issues[0]?.message ?? 'Canonicalization failed.');
  }
  return createHash('sha256').update(canonical.value).digest('hex');
}

function digestSorted(values: readonly unknown[]): string {
  const ranked = values.map((value, index) => {
    const canonical = canonicalizeGraphValue(value);
    if (!canonical.accepted) {
      throw new Error(canonical.issues[0]?.message ?? 'Canonicalization failed.');
    }
    return { key: canonical.value, index };
  });
  ranked.sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);
  const hash = createHash('sha256');
  hash.update('[');
  for (let index = 0; index < ranked.length; index += 1) {
    if (index > 0) hash.update(',');
    hash.update(ranked[index]?.key ?? '');
  }
  hash.update(']');
  return hash.digest('hex');
}

export function semanticDigests(request: GraphCompositionRequest): OwnedSemanticDigests {
  const sources = request.sources;
  return {
    ontology: digestReference(digestCanonical(request.ontology)),
    proofPolicies: digestReference(
      digestCanonical(request.ontology.relations.map((relation) => relation.proofPolicy))
    ),
    inputs: digestReference(digestSorted(sources.flatMap((source) => source.batch.inputs))),
    providers: digestReference(digestSorted(sources.map((source) => source.manifest))),
    compositionPolicy: digestReference(digestCanonical(request.policy)),
    extractors: digestReference(
      digestSorted(
        sources.map((source) => ({
          id: source.manifest.id,
          version: source.manifest.version,
          contractVersions: source.manifest.contractVersions,
        }))
      )
    ),
    redaction: digestReference(digestSorted(sources.map((source) => source.batch.redaction))),
    scope: digestReference(digestSorted(sources.map((source) => source.batch.scope))),
    coverage: digestReference(digestSorted(sources.flatMap((source) => source.batch.coverage))),
    unknownZones: digestReference(
      digestSorted(sources.flatMap((source) => source.batch.unknownZones))
    ),
    unsupportedZones: digestReference(
      digestSorted(sources.flatMap((source) => source.batch.unsupportedZones))
    ),
    ordering: digestReference(digestCanonical(GRAPH_COMPOSITION_ORDERING_RULES)),
  };
}

export function resolveComposeBinary():
  { readonly path: string; readonly packaging: string } | undefined {
  const override = process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
  if (override) {
    if (!existsSync(override)) return undefined;
    return { path: override, packaging: 'override' };
  }
  const packagedName = composeBinaryFileName(process.platform, process.arch);
  const packaged = packagedName
    ? fileURLToPath(new URL(`../../dist/native/${packagedName}`, import.meta.url))
    : undefined;
  const generic = fileURLToPath(new URL('../../dist/native/graph-compose-graph', import.meta.url));
  const development = fileURLToPath(
    new URL('../../../../target/release/graph-compose-graph', import.meta.url)
  );
  if (packaged && existsSync(packaged)) return { path: packaged, packaging: 'packaged' };
  if (existsSync(generic)) return { path: generic, packaging: 'packaged' };
  if (existsSync(development)) return { path: development, packaging: 'development' };
  return undefined;
}

/**
 * Packaged binaries fail closed without a matching sibling `.sha256`.
 * Development and explicit override builds may run without one; a present
 * digest is still checked.
 */
export function verifyComposeBinary(path: string, packaging: string): string | undefined {
  if (process.platform !== 'win32') {
    const mode = statSync(path).mode;
    if ((mode & 0o111) === 0) return 'binary-permission';
  }
  const digestPath = `${path}.sha256`;
  if (!existsSync(digestPath)) {
    return packaging === 'packaged' ? 'binary-digest-missing' : undefined;
  }
  const expected = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] ?? '';
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (expected !== actual) return 'binary-digest';
  return undefined;
}

function vmField(pid: number, name: string): number | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const text = readFileSync(`/proc/${pid}/status`, 'utf8');
    const line = text.split('\n').find((entry) => entry.startsWith(`${name}:`));
    const kb = Number(line?.split(/\s+/)[1]);
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  } catch {
    return undefined;
  }
}

function vmRss(pid: number): number | undefined {
  return vmField(pid, 'VmRSS');
}

function u32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function f64(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeDoubleLE(value, 0);
  return buffer;
}

function text(value: string): Buffer {
  const body = Buffer.from(value);
  return Buffer.concat([u32(body.byteLength), body]);
}

function textList(values: readonly string[]): Buffer {
  return Buffer.concat([u32(values.length), ...values.map((value) => text(value))]);
}

export function headerPayload(
  request: GraphCompositionRequest,
  semantic: OwnedSemanticDigests,
  evaluatedAt: string,
  canonicalPath: string,
  packedPath: string
): Buffer {
  const facts = request.sources.flatMap((source) => source.batch.facts);
  let cursor = 0;
  const ranges: Buffer[] = [];
  for (const source of request.sources) {
    const start = cursor;
    cursor += source.batch.facts.length;
    ranges.push(u32(start), u32(cursor));
  }
  const parts: Buffer[] = [
    u32(2),
    u32(facts.length),
    u32(facts.length === 0 ? 0 : request.sources.length),
    ...(facts.length === 0 ? [] : ranges),
    f64(request.policy.minimumConfidence),
    Buffer.from([
      request.policy.inferredClaims === 'reject' ? 1 : 0,
      request.policy.unknownFreshness === 'reject' ? 1 : 0,
    ]),
    u32(request.policy.maxEdges),
    text(evaluatedAt),
    text(request.policy.architectureEpoch),
    text(GRAPH_CANONICAL_GRAPH_CONTRACT.version),
    text(GRAPH_CANONICAL_GRAPH_CONTRACT.id),
    text(GRAPH_CANONICAL_GRAPH_CONTRACT.version),
    text(request.ontology.id),
    text(request.ontology.version),
    text(canonicalPath),
    text(packedPath),
    u32(request.ontology.entities.length),
  ];
  for (const entity of request.ontology.entities) {
    parts.push(text(entity.kind), text(entity.family));
  }
  parts.push(u32(request.ontology.relations.length));
  for (const relation of request.ontology.relations) {
    parts.push(
      text(relation.kind),
      text(relation.semantics),
      textList(relation.subjectFamilies),
      textList(relation.objectFamilies),
      textList(relation.allowedAuthorities),
      text(relation.proofPolicy.id),
      text(relation.proofPolicy.version)
    );
  }
  parts.push(textList(request.policy.functionalRelations));
  for (const digest of [
    semantic.ontology.value,
    semantic.proofPolicies.value,
    semantic.inputs.value,
    semantic.providers.value,
    semantic.compositionPolicy.value,
  ]) {
    parts.push(Buffer.from(digest));
  }
  const lineages = request.lineages ?? [];
  parts.push(u32(lineages.length));
  for (const lineage of lineages) {
    parts.push(
      text(lineage.factId),
      text(lineage.derivation),
      textList(lineage.evidenceRoots),
      textList(lineage.parentFactIds)
    );
  }
  return Buffer.concat(parts);
}

async function writeFrame(stdin: Writable, kind: number, payload: Buffer): Promise<void> {
  if (payload.byteLength > MAX_IN_FLIGHT_SHARD_BYTES) throw new Error('shard-limit');
  const frame = encodeCompositionFrame(kind, payload);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      stdin.off('drain', onDrain);
      reject(error);
    };
    const onDrain = (): void => {
      stdin.off('error', onError);
      resolve();
    };
    stdin.once('error', onError);
    if (stdin.write(frame)) {
      stdin.off('error', onError);
      resolve();
      return;
    }
    stdin.once('drain', onDrain);
  });
}

async function reap(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.destroy();
  child.kill('SIGKILL');
  await Promise.race([
    once(child, 'close').then(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
}

function readAliasReason(value: string): GraphEntityAlias['reason'] {
  if (
    value === 'rename' ||
    value === 'move' ||
    value === 'canonicalization' ||
    value === 'provider-alias'
  ) {
    return value;
  }
  throw new Error('packed-alias-reason');
}

function decodePacked(
  bytes: Buffer,
  evaluatedAt: string
): {
  nodes: GraphEntityReference[];
  edges: GraphEdge[];
  decisions: GraphCompositionDecision[];
  unresolved: { id: string; candidates: string[] }[];
} {
  let at = 0;
  const readU32 = (): number => {
    const value = bytes.readUInt32LE(at);
    at += 4;
    return value;
  };
  const readString = (): string => {
    const length = readU32();
    const value = bytes.subarray(at, at + length).toString('utf8');
    at += length;
    return value;
  };
  if (bytes.subarray(0, 4).toString('ascii') !== 'WGP1') {
    throw new Error('packed-magic');
  }
  at = 4;
  if (readU32() !== 1) throw new Error('packed-version');
  const stringCount = readU32();
  const strings: string[] = [];
  for (let index = 0; index < stringCount; index += 1) strings.push(readString());
  const parsed = new Map<number, unknown>();
  const jsonAt = (id: number): unknown => {
    const cached = parsed.get(id);
    if (cached !== undefined) return cached;
    const value = JSON.parse(strings[id] ?? 'null') as unknown;
    parsed.set(id, value);
    return value;
  };
  const nodeCount = readU32();
  const nodes: GraphEntityReference[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const id = readU32();
    const kind = readU32();
    const scheme = readU32();
    const scope = readU32();
    const aliasCount = readU32();
    const aliases: GraphEntityAlias[] = [];
    for (let aliasIndex = 0; aliasIndex < aliasCount; aliasIndex += 1) {
      aliases.push({
        id: strings[readU32()] ?? '',
        reason: readAliasReason(strings[readU32()] ?? ''),
      });
    }
    nodes.push({
      id: strings[id] ?? '',
      identityScheme: jsonAt(scheme) as GraphEntityReference['identityScheme'],
      kind: strings[kind] ?? '',
      scope: jsonAt(scope) as GraphEntityReference['scope'],
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  const edgeState = ['accepted', 'disputed', 'rejected', 'unresolved'] as const;
  const proofState = [
    'supported',
    'corroborated',
    'verified',
    'disputed',
    'insufficient',
    'unresolved',
  ] as const;
  const readU32List = (): number[] => {
    const count = readU32();
    const values = [];
    for (let index = 0; index < count; index += 1) values.push(readU32());
    return values;
  };
  const readStringList = (): string[] => {
    const count = readU32();
    const values = [];
    for (let index = 0; index < count; index += 1) values.push(readString());
    return values;
  };
  const readEvidence = () => {
    const count = readU32();
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const algorithm = readU32();
      const canonicalization = readU32();
      const value = readU32();
      const id = readU32();
      const locator = readU32();
      const sourceKind = readU32();
      items.push({
        digest: {
          algorithm: strings[algorithm] ?? '',
          ...(canonicalization === NONE
            ? {}
            : { canonicalization: strings[canonicalization] ?? '' }),
          value: strings[value] ?? '',
        },
        id: strings[id] ?? '',
        relativeLocator: strings[locator] ?? '',
        sourceKind: strings[sourceKind] ?? '',
      });
    }
    return items;
  };
  const edgeCount = readU32();
  const edges: GraphEdge[] = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const id = readString();
    const relation = strings[readU32()] ?? '';
    const semantics = strings[readU32()] ?? '';
    const from = strings[readU32()] ?? '';
    const to = strings[readU32()] ?? '';
    const state = edgeState[bytes[at] ?? 255] ?? 'unresolved';
    at += 1;
    const confidence = bytes.readDoubleLE(at);
    at += 8;
    const facts = readU32List().map((fact) => strings[fact] ?? '');
    const derivations = readU32List().map((fact) => strings[fact] ?? '');
    const authorities = readU32List().map((fact) => strings[fact] ?? '');
    const proof = proofState[bytes[at] ?? 255] ?? 'unresolved';
    at += 1;
    const explanationCode = readString();
    const proofCode = readString();
    const drivers = readStringList();
    const evidence = readEvidence();
    const groupCount = readU32();
    const corroborationGroups = [];
    for (let group = 0; group < groupCount; group += 1) {
      const root = strings[readU32()] ?? '';
      corroborationGroups.push({ root, evidence: readEvidence() });
    }
    const policyId = strings[readU32()] ?? '';
    const policyVersion = strings[readU32()] ?? '';
    const inputDigest = readString();
    const freshness = strings[readU32()] ?? '';
    const validUntilId = readU32();
    const evaluatedId = readU32();
    edges.push({
      id,
      relation,
      semantics,
      from,
      to,
      state,
      facts,
      derivations,
      proof: {
        policy: { id: policyId, version: policyVersion },
        state: proof,
        evidence,
        authorities,
        corroborationGroups,
        counterEvidence: [],
        missingRequirements: [],
        evaluatedAt: strings[evaluatedId] || evaluatedAt,
        inputDigest: digestReference(inputDigest),
        explanationCode: proofCode,
      },
      freshness:
        validUntilId === NONE
          ? { status: freshness }
          : { status: freshness, validUntil: strings[validUntilId] ?? '' },
      confidence,
      explanation: { code: explanationCode, drivers },
    } as GraphEdge);
  }
  const unresolvedCount = readU32();
  const unresolved = [];
  for (let index = 0; index < unresolvedCount; index += 1) {
    unresolved.push({ id: readString(), candidates: readStringList() });
  }
  const decisionCount = readU32();
  const decisions: GraphCompositionDecision[] = [];
  for (let index = 0; index < decisionCount; index += 1) {
    const edgeKey = readString();
    const state = edgeState[bytes[at] ?? 255] ?? 'unresolved';
    at += 1;
    const included = bytes[at] === 1;
    at += 1;
    const factIds = readU32List().map((fact) => strings[fact] ?? '');
    decisions.push({
      edgeKey,
      state,
      includedInGraph: included,
      factIds,
      explanation: { code: readString(), drivers: readStringList() },
    });
  }
  return { nodes, edges, decisions, unresolved };
}

function parseResponse(body: Buffer): {
  status: number;
  code: number;
  factDigest: string;
  contentDigest: string;
  facts: number;
  nodes: number;
  edges: number;
  packedBytes: number;
  canonicalBytes: number;
  spillBytes: number;
  retainedCanonicalBytes: number;
  rustRssBytes: number;
  ingestMs: number;
  digestMs: number;
  edgeMs: number;
  publishMs: number;
  rssKnown: boolean;
  decisions: number;
  unresolved: number;
} {
  if (body.byteLength < 4 + RESPONSE_BYTES) throw new Error('short-response');
  const length = body.readUInt32LE(0);
  if (length !== RESPONSE_BYTES || body.byteLength !== 4 + RESPONSE_BYTES) {
    throw new Error(body.byteLength > 4 + RESPONSE_BYTES ? 'trailing-output' : 'corrupt-frame');
  }
  let at = 4;
  const status = body.readUInt32LE(at);
  at += 4;
  const code = body.readUInt32LE(at);
  at += 4;
  const factDigest = body.subarray(at, at + 64).toString('ascii');
  at += 64;
  const contentDigest = body.subarray(at, at + 64).toString('ascii');
  at += 64;
  const readU64 = (): number => {
    const value = Number(body.readBigUInt64LE(at));
    at += 8;
    return value;
  };
  const facts = readU64();
  const nodes = readU64();
  const edges = readU64();
  const packedBytes = readU64();
  const canonicalBytes = readU64();
  const spillBytes = readU64();
  const retainedCanonicalBytes = readU64();
  const rustRssBytes = readU64();
  const ingestMs = readU64();
  const digestMs = readU64();
  const edgeMs = readU64();
  const publishMs = readU64();
  const rssKnown = body.readUInt32LE(at) === 1;
  at += 4;
  const decisions = body.readUInt32LE(at);
  at += 4;
  const unresolved = body.readUInt32LE(at);
  return {
    status,
    code,
    factDigest,
    contentDigest,
    facts,
    nodes,
    edges,
    packedBytes,
    canonicalBytes,
    spillBytes,
    retainedCanonicalBytes,
    rustRssBytes,
    ingestMs,
    digestMs,
    edgeMs,
    publishMs,
    rssKnown,
    decisions,
    unresolved,
  };
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

async function readAck(reader: FrameReader, expectedSeq: number): Promise<void> {
  const frame = await readFrame(reader);
  if (frame.byteLength === RESPONSE_BYTES) throw new Error('response-before-ack');
  if (frame.byteLength !== 13 || frame[0] !== 0xa1) throw new Error('ack-frame');
  if (frame.readUInt32LE(1) !== expectedSeq) throw new Error('ack-seq');
  if (frame.readUInt32LE(9) !== 2) throw new Error('ack-stage');
}

export function snapshotPackaging(value: string): NativeGraphSnapshot['binaryPackaging'] {
  if (value === 'packaged' || value === 'override') return value;
  return 'development';
}

/**
 * Owns grouping, proof, digests, and publication in the native session.
 * TypeScript keeps orchestration and the final contract check.
 */
export async function composeOwnedGraph(
  request: GraphCompositionRequest,
  canonical: (fact: GraphWorkspaceFact) => string,
  evaluatedAt: string,
  cancellation: GraphCancellationPort,
  signal?: AbortSignal,
  options?: { readonly materialize?: boolean }
): Promise<OwnedCompositionComplete | OwnedCompositionFallback> {
  if (request.identityFreeze) {
    return {
      status: 'fallback',
      reason: 'identity-freeze',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: 0,
    };
  }
  if (request.policy.functionalRelations.length > 0) {
    return {
      status: 'fallback',
      reason: 'functional-relations',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: 0,
    };
  }
  const binary = resolveComposeBinary();
  if (!binary) {
    return {
      status: 'fallback',
      reason: 'binary-missing',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: 0,
    };
  }
  const binaryProblem = verifyComposeBinary(binary.path, binary.packaging);
  if (binaryProblem) {
    return {
      status: 'fallback',
      reason: binaryProblem,
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: 0,
    };
  }
  const profile = process.env.WORKSPAI_GRAPH_COMPOSE_PROFILE === '1';
  const markedAt = Date.now();
  const mark = (phase: string): void => {
    if (!profile) return;
    const memory = process.memoryUsage();
    console.error(
      JSON.stringify({
        phase,
        ms: Date.now() - markedAt,
        rss: memory.rss,
        heap: memory.heapUsed,
        external: memory.external,
      })
    );
  };
  mark('before-semantic');
  let semantic: OwnedSemanticDigests;
  try {
    semantic = semanticDigests(request);
  } catch (error) {
    return {
      status: 'fallback',
      reason: error instanceof Error ? error.message : 'semantic-digest',
      boundaryBytes: 0,
      rustFacts: 0,
      typescriptFacts: 0,
    };
  }
  mark('after-semantic');
  const directory = mkdtempSync(join(tmpdir(), 'workspai-compose-'));
  const canonicalPath = join(directory, 'content.json');
  const packedPath = join(directory, 'graph.wgp');
  const spans: { start: number; source: number }[] = [];
  let factCount = 0;
  request.sources.forEach((source, sourceIndex) => {
    spans.push({ start: factCount, source: sourceIndex });
    factCount += source.batch.facts.length;
  });
  let spanIndex = 0;
  const factAt = (index: number): GraphWorkspaceFact => {
    while (spanIndex + 1 < spans.length && spans[spanIndex + 1]!.start <= index) spanIndex += 1;
    while (spanIndex > 0 && spans[spanIndex]!.start > index) spanIndex -= 1;
    const span = spans[spanIndex];
    const fact = span ? request.sources[span.source]?.batch.facts[index - span.start] : undefined;
    if (!fact) throw new Error('fact-index');
    return fact;
  };
  const materialize = options?.materialize === true;
  const child = spawn(binary.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = new FrameReader(child.stdout);
  let boundaryBytes = 0;
  let ackSeq = 0;
  let simultaneousRssBytes = 0;
  let simultaneousNodeRss = 0;
  let simultaneousChildRss = 0;
  let simultaneousChildHwm = 0;
  let simultaneousChildComm = '';
  let simultaneousKnown = false;
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    if (Buffer.concat(stderr).byteLength < 4096) stderr.push(chunk);
  });
  let failure = '';
  const fail = (reason: string): void => {
    if (!failure) failure = reason;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  const timer = setTimeout(() => fail('timeout'), 120_000);
  const onAbort = (): void => fail('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  const poll = setInterval(() => {
    if (cancellation.aborted) fail('cancelled');
    if (child.exitCode !== null || child.signalCode !== null) return;
    const nodeRss = vmRss(process.pid);
    const childRss = child.pid ? vmRss(child.pid) : undefined;
    if (nodeRss !== undefined && childRss !== undefined) {
      simultaneousKnown = true;
      const total = nodeRss + childRss;
      if (total >= simultaneousRssBytes && child.pid) {
        simultaneousRssBytes = total;
        simultaneousNodeRss = nodeRss;
        simultaneousChildRss = childRss;
        simultaneousChildHwm = vmField(child.pid, 'VmHWM') ?? 0;
        try {
          simultaneousChildComm = readFileSync(`/proc/${child.pid}/comm`, 'utf8').trim();
        } catch {
          simultaneousChildComm = '';
        }
      }
    }
  }, 20);
  const closed = once(child, 'close');
  const fault = process.env.WORKSPAI_GRAPH_COMPOSE_FAULT ?? '';
  try {
    if (cancellation.aborted || signal?.aborted || fault === 'cancel-before-header') {
      throw new Error('cancelled');
    }
    const header = headerPayload(request, semantic, evaluatedAt, canonicalPath, packedPath);
    await writeFrame(child.stdin, KIND_HEADER, header);
    boundaryBytes += 5 + header.byteLength;
    await readAck(frames, ackSeq);
    ackSeq += 1;
    if (fault === 'cancel-after-ack') throw new Error('cancelled');
    let index = 0;
    while (index < factCount) {
      if (cancellation.aborted || signal?.aborted) throw new Error('cancelled');
      const fact = factAt(index);
      if (!compactFactSupported(fact)) {
        const key = canonical(fact);
        const payload = Buffer.concat([u32(index), text(key)]);
        await writeFrame(child.stdin, KIND_CANONICAL, payload);
        boundaryBytes += 5 + payload.byteLength;
        await readAck(frames, ackSeq);
        ackSeq += 1;
        if (fact.freshness.validUntil) {
          const until = Buffer.concat([u32(index), text(fact.freshness.validUntil)]);
          await writeFrame(child.stdin, KIND_VALID_UNTIL, until);
          boundaryBytes += 5 + until.byteLength;
          await readAck(frames, ackSeq);
          ackSeq += 1;
        }
        index += 1;
        continue;
      }
      const start = index;
      const batch: GraphWorkspaceFact[] = [];
      while (index < factCount && batch.length < 8192 && compactFactSupported(factAt(index))) {
        batch.push(factAt(index));
        index += 1;
      }
      const encoded = encodeCompactFactBatch(batch);
      if (!encoded) {
        index = start;
        const key = canonical(factAt(index));
        const payload = Buffer.concat([u32(index), text(key)]);
        await writeFrame(child.stdin, KIND_CANONICAL, payload);
        boundaryBytes += 5 + payload.byteLength;
        await readAck(frames, ackSeq);
        ackSeq += 1;
        index += 1;
        continue;
      }
      const body = Buffer.from(
        encoded.bytes.buffer,
        encoded.bytes.byteOffset,
        encoded.bytes.byteLength
      );
      const payload = Buffer.concat([u32(start), body]);
      await writeFrame(child.stdin, KIND_COMPACT, payload);
      boundaryBytes += 5 + payload.byteLength;
      await readAck(frames, ackSeq);
      ackSeq += 1;
      for (let offset = 0; offset < batch.length; offset += 1) {
        const until = batch[offset]?.freshness.validUntil;
        if (!until) continue;
        const note = Buffer.concat([u32(start + offset), text(until)]);
        await writeFrame(child.stdin, KIND_VALID_UNTIL, note);
        boundaryBytes += 5 + note.byteLength;
        await readAck(frames, ackSeq);
        ackSeq += 1;
      }
    }
    await writeFrame(child.stdin, KIND_FINISH, Buffer.alloc(0));
    boundaryBytes += 5;
    child.stdin.end();
    if (fault === 'cancel-after-finish') throw new Error('cancelled');
    mark('after-ipc');
    const responseFrame = await readFrame(frames);
    const qualityFrame = await readFrame(frames);
    const [code] = (await closed) as [number | null, NodeJS.Signals | null];
    if (failure) throw new Error(failure);
    if (code !== 0 && code !== null) throw new Error(`exit-${code}`);
    mark('after-child');
    const response = parseResponse(Buffer.concat([u32(responseFrame.byteLength), responseFrame]));
    const quality = parseQuality(qualityFrame);
    if (profile) {
      console.error(
        JSON.stringify({
          phase: 'rust-phases',
          ingestMs: response.ingestMs,
          digestMs: response.digestMs,
          edgeMs: response.edgeMs,
          publishMs: response.publishMs,
          spillBytes: response.spillBytes,
          canonicalBytes: response.canonicalBytes,
          packedBytes: response.packedBytes,
          rustRss: response.rustRssBytes,
        })
      );
    }
    if (response.status !== 0) throw new Error(`rejected-${response.code}`);
    if (
      !/^[a-f0-9]{64}$/u.test(response.factDigest) ||
      !/^[a-f0-9]{64}$/u.test(response.contentDigest)
    ) {
      throw new Error('corrupt-frame');
    }
    if (
      response.facts !== factCount ||
      response.retainedCanonicalBytes !== 0 ||
      fault === 'fact-count'
    ) {
      throw new Error(
        response.facts !== factCount || fault === 'fact-count' ? 'fact-count' : 'retained-canonical'
      );
    }
    if (fault === 'corrupt-frame') throw new Error('corrupt-frame');
    if (fault === 'packed-digest') throw new Error('packed-digest');
    if (fault === 'snapshot-rename') throw new Error('snapshot-verify');
    if (fault === 'publication') throw new Error('snapshot-mismatch');
    const published = publishNativeSnapshot(packedPath, {
      factDigest: response.factDigest,
      contentDigest: response.contentDigest,
      factCount: response.facts,
      nodeCount: response.nodes,
      edgeCount: response.edges,
      decisionCount: response.decisions,
      unresolvedCount: response.unresolved,
    });
    if (
      published.packedDigest !== quality.packedDigest ||
      published.packedBytes !== response.packedBytes
    ) {
      throw new Error('packed-digest');
    }
    let decoded: {
      nodes: readonly GraphEntityReference[];
      edges: readonly GraphEdge[];
      decisions: readonly GraphCompositionDecision[];
      unresolved: readonly { readonly id: string; readonly candidates: readonly string[] }[];
    } = { nodes: [], edges: [], decisions: [], unresolved: [] };
    if (materialize) {
      const opened = openNativeSnapshot(published.packedDigest);
      try {
        decoded = decodePacked(snapshotBytesForDecode(opened.packed), evaluatedAt);
      } finally {
        opened.release();
      }
    }
    mark('after-decode');
    if (profile) {
      console.error(
        JSON.stringify({
          phase: 'simultaneous-split',
          total: simultaneousRssBytes,
          node: simultaneousNodeRss,
          child: simultaneousChildRss,
          childPid: child.pid,
          childHwmAtPeak: simultaneousChildHwm,
          childComm: simultaneousChildComm,
        })
      );
    }
    if (
      materialize &&
      (decoded.nodes.length !== response.nodes || decoded.edges.length !== response.edges)
    ) {
      throw new Error('packed-count');
    }
    const snapshot: NativeGraphSnapshot = Object.freeze({
      schema: 'workspai.graph.native-snapshot.v1',
      snapshotId: published.packedDigest,
      format: snapshotFormat(packedPath),
      formatVersion: 1,
      protocolVersion: 2,
      binaryPackaging: snapshotPackaging(binary.packaging),
      factDigest: digestReference(response.factDigest),
      contentDigest: digestReference(response.contentDigest),
      packedDigest: published.packedDigest,
      packedBytes: published.packedBytes,
      nodeCount: response.nodes,
      edgeCount: response.edges,
      factCount: response.facts,
      unresolvedCount: response.unresolved,
      decisionCount: response.decisions,
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
      evaluatedAt,
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
      packedDigest: published.packedDigest,
      materialized: materialize,
      rustFacts: factCount,
      typescriptFacts: 0,
      boundaryBytes,
      rustRssBytes: response.rssKnown ? response.rustRssBytes : 0,
      rssKnown: response.rssKnown,
      simultaneousRssKnown: simultaneousKnown,
      simultaneousRssBytes: simultaneousKnown ? simultaneousRssBytes : 0,
      spillBytes: response.spillBytes,
      retainedCanonicalBytes: response.retainedCanonicalBytes,
      canonicalBytes: response.canonicalBytes,
      packedBytes: response.packedBytes,
      ingestMs: response.ingestMs,
      digestMs: response.digestMs,
      edgeMs: response.edgeMs,
      publishMs: response.publishMs,
      semantic,
      evaluatedAt,
    };
  } catch (error) {
    await reap(child);
    return {
      status: 'fallback',
      reason: failure || (error instanceof Error ? error.message : 'process-failed'),
      boundaryBytes,
      rustFacts: 0,
      typescriptFacts: factCount,
    };
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    signal?.removeEventListener('abort', onAbort);
    await reap(child);
    rmSync(directory, { recursive: true, force: true });
  }
}
