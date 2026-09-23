import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import {
  type GraphEntityReference,
  type GraphLiteralValue,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

/**
 * Binary layout `workspai.graph-compact-fact.v1` (`WGF1`).
 * Rust emits each fact's semantic JSON. Fact order is the input order.
 * Digest ordering stays in TypeScript because it is `localeCompare`.
 */
export const COMPACT_FACT_MAGIC = 'WGF1';
export const COMPACT_FACT_VERSION = 1;
export const COMPACT_FACT_BATCH_LIMIT = 8_192;

const FLAG_EXTENSIONS = 1;
const FLAG_LITERAL_OBJECT = 2;
const FLAG_FRESHNESS_RENEWAL = 4;

export interface CompactFactBatch {
  readonly bytes: Uint8Array;
  readonly count: number;
}

class ByteWriter {
  private buffer = new Uint8Array(64 * 1024);
  private view = new DataView(this.buffer.buffer);
  private offset = 0;

  private ensure(extra: number): void {
    if (this.offset + extra <= this.buffer.byteLength) return;
    const next = new Uint8Array(Math.max(this.buffer.byteLength * 2, this.offset + extra));
    next.set(this.buffer.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  bytes(value: Uint8Array): void {
    this.ensure(value.byteLength);
    this.buffer.set(value, this.offset);
    this.offset += value.byteLength;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

class StringTable {
  private readonly ids = new Map<string, number>();
  readonly values: string[] = [''];

  id(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(value);
    this.ids.set(value, id);
    return id;
  }
}

function fragment(value: object, cache: WeakMap<object, string>): string | undefined {
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const canonical = canonicalizeGraphValue(value);
  if (!canonical.accepted) return undefined;
  cache.set(value, canonical.value);
  return canonical.value;
}

function isEntity(value: GraphWorkspaceFact['object']): value is GraphEntityReference {
  return Boolean(value) && typeof value === 'object' && 'identityScheme' in value;
}

function supportedEntity(entity: GraphEntityReference): boolean {
  if (entity.aliases && entity.aliases.length > 0) return false;
  return (
    Object.keys(entity).length === 4 &&
    typeof entity.id === 'string' &&
    typeof entity.kind === 'string'
  );
}

function extensionEntries(
  value: NonNullable<GraphWorkspaceFact['extensions']>
): [string, string][] | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 16) return undefined;
  if (!entries.every((entry) => typeof entry[1] === 'string')) return undefined;
  return entries as [string, string][];
}

function supportedEvidence(fact: GraphWorkspaceFact): boolean {
  if (fact.evidence.length > 64) return false;
  return fact.evidence.every((item) => {
    const keys = Object.keys(item).sort().join(',');
    if (keys !== 'digest,id,relativeLocator,sourceKind') return false;
    if (
      typeof item.id !== 'string' ||
      typeof item.relativeLocator !== 'string' ||
      typeof item.sourceKind !== 'string'
    ) {
      return false;
    }
    const digest = item.digest;
    if (!digest || typeof digest.algorithm !== 'string' || typeof digest.value !== 'string')
      return false;
    const digestKeys = Object.keys(digest).sort().join(',');
    return digestKeys === 'algorithm,value' || digestKeys === 'algorithm,canonicalization,value';
  });
}

export function compactFactRejectReason(fact: GraphWorkspaceFact): string | undefined {
  if (fact.unknownZones.length > 0) return 'unknown-zones';
  if (!supportedEntity(fact.subject)) return 'subject';
  if (isEntity(fact.object)) {
    if (!supportedEntity(fact.object)) return 'object-entity';
  } else if (!supportedLiteral(fact.object)) return 'literal';
  if (!supportedEvidence(fact)) return 'evidence';
  if (fact.truthLifecycle.invalidatedBy.length > 8) return 'lifecycle';
  if (fact.extensions && !extensionEntries(fact.extensions)) return 'extensions';
  const freshnessKeys = Object.keys(fact.freshness).filter((key) => key !== 'validUntil');
  if (fact.freshness.renewal !== undefined && !freshnessKeys.includes('renewal'))
    return 'freshness';
  if (fact.freshness.renewal === undefined && freshnessKeys.join(',') !== 'status')
    return 'freshness';
  if (Object.keys(fact.provenance).length !== 2) return 'provenance';
  return undefined;
}

export function compactFactSupported(fact: GraphWorkspaceFact): boolean {
  return compactFactRejectReason(fact) === undefined;
}

function supportedLiteral(value: GraphLiteralValue): boolean {
  return (
    (value.kind === 'string' && typeof value.value === 'string') ||
    (value.kind === 'number' && typeof value.value === 'number' && Number.isFinite(value.value)) ||
    (value.kind === 'boolean' && typeof value.value === 'boolean') ||
    (value.kind === 'null' && value.value === null)
  );
}

/**
 * Encodes a homogeneous supported batch. Returns undefined when any fact is
 * outside the v1 shape so the caller keeps the TypeScript canonical string.
 */
export function encodeCompactFactBatch(
  facts: readonly GraphWorkspaceFact[]
): CompactFactBatch | undefined {
  if (facts.length === 0 || facts.length > COMPACT_FACT_BATCH_LIMIT) return undefined;
  if (!facts.every(compactFactSupported)) return undefined;
  const table = new StringTable();
  const fragments = new WeakMap<object, string>();
  const encoder = new TextEncoder();
  const planned: {
    flags: number;
    words: number[];
  }[] = [];

  for (const fact of facts) {
    const words: number[] = [];
    const local = {
      u32(value: number) {
        words.push(value);
      },
    };
    let flags = 0;
    const authority = table.id(fact.authority);
    const confidence = table.id(JSON.stringify(fact.confidence));
    const derivation = table.id(fact.derivation);
    const evidence: number[] = [fact.evidence.length];
    for (const item of fact.evidence) {
      const digest = item.digest;
      if (!digest) return undefined;
      let digestFlags = 0;
      const parts = [table.id(digest.algorithm)];
      if (digest.canonicalization !== undefined) {
        digestFlags = 1;
        parts.push(table.id(digest.canonicalization));
      }
      parts.push(
        table.id(digest.value),
        table.id(item.id),
        table.id(item.relativeLocator ?? ''),
        table.id(item.sourceKind)
      );
      evidence.push(digestFlags, ...parts);
    }
    const extensions = fact.extensions ? extensionEntries(fact.extensions) : undefined;
    const extensionWords: number[] = [];
    if (fact.extensions) {
      if (!extensions) return undefined;
      flags |= FLAG_EXTENSIONS;
      extensionWords.push(extensions.length);
      for (const [key, value] of extensions) {
        extensionWords.push(table.id(key), table.id(value));
      }
    }
    const inputDigest = fragment(fact.inputDigest, fragments);
    const scope = fragment(fact.scope, fragments);
    if (!inputDigest || !scope) return undefined;
    if (fact.freshness.renewal !== undefined) flags |= FLAG_FRESHNESS_RENEWAL;
    const objectIsLiteral = !isEntity(fact.object);
    if (objectIsLiteral) flags |= FLAG_LITERAL_OBJECT;

    local.u32(authority);
    local.u32(confidence);
    local.u32(derivation);
    for (const word of evidence) local.u32(word);
    for (const word of extensionWords) local.u32(word);
    local.u32(table.id(fact.factId));
    local.u32(table.id(fact.factType));
    local.u32(table.id(fact.freshness.status));
    if (fact.freshness.renewal !== undefined) local.u32(table.id(fact.freshness.renewal));
    local.u32(table.id(inputDigest));
    if (objectIsLiteral) {
      const literal = fact.object as GraphLiteralValue;
      local.u32(table.id(literal.kind));
      local.u32(table.id(JSON.stringify(literal.value)));
    } else if (!writeEntityWords(local, table, fragments, fact.object as GraphEntityReference)) {
      return undefined;
    }
    local.u32(table.id(fact.predicate));
    local.u32(table.id(fact.provenance.id));
    local.u32(table.id(fact.provenance.version));
    local.u32(table.id(scope));
    if (!writeEntityWords(local, table, fragments, fact.subject)) return undefined;
    local.u32(fact.truthLifecycle.invalidatedBy.length);
    for (const cause of fact.truthLifecycle.invalidatedBy) local.u32(table.id(cause));
    planned.push({ flags, words });
  }

  const writer = new ByteWriter();
  writer.bytes(encoder.encode(COMPACT_FACT_MAGIC));
  writer.u32(COMPACT_FACT_VERSION);
  writer.u32(facts.length);
  writer.u32(table.values.length);
  for (const value of table.values) {
    const encoded = encoder.encode(value);
    writer.u32(encoded.byteLength);
    writer.bytes(encoded);
  }
  for (const fact of planned) {
    writer.u32(fact.flags);
    for (const word of fact.words) writer.u32(word);
  }
  return { bytes: writer.finish(), count: facts.length };
}

function writeEntityWords(
  writer: { u32(value: number): void },
  table: StringTable,
  fragments: WeakMap<object, string>,
  entity: GraphEntityReference
): boolean {
  const scheme = fragment(entity.identityScheme, fragments);
  const scope = fragment(entity.scope, fragments);
  if (!scheme || !scope) return false;
  writer.u32(table.id(entity.id));
  writer.u32(table.id(scheme));
  writer.u32(table.id(entity.kind));
  writer.u32(table.id(scope));
  return true;
}

export function canonicalFactKeysFromNative(
  facts: readonly GraphWorkspaceFact[],
  canonicalizeNative: (bytes: Uint8Array) => readonly string[] | undefined,
  reference: (fact: GraphWorkspaceFact) => string
): readonly string[] {
  const keys: string[] = new Array(facts.length);
  let index = 0;
  while (index < facts.length) {
    if (!compactFactSupported(facts[index]!)) {
      keys[index] = reference(facts[index]!);
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < facts.length &&
      index - start < COMPACT_FACT_BATCH_LIMIT &&
      compactFactSupported(facts[index]!)
    ) {
      index += 1;
    }
    const batch = facts.slice(start, index);
    const encoded = encodeCompactFactBatch(batch);
    const canonical = encoded ? canonicalizeNative(encoded.bytes) : undefined;
    if (!canonical || canonical.length !== batch.length) {
      for (let offset = 0; offset < batch.length; offset += 1) {
        keys[start + offset] = reference(batch[offset]!);
      }
      continue;
    }
    for (let offset = 0; offset < canonical.length; offset += 1) {
      keys[start + offset] = canonical[offset] ?? reference(batch[offset]!);
    }
  }
  return keys;
}
