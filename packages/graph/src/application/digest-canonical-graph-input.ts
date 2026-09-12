import type { WisDigestReference } from '@workspai/shared/contracts';

import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import type { GraphDigestPort } from '../ports/index.js';

const encoder = new TextEncoder();

/**
 * Digests canonical JSON through the injected SHA-256 port. Same material as
 * composition generation semantic digests, without extra digest fields that
 * content-state shard records cannot carry.
 */
export async function digestCanonicalGraphInput(
  input: unknown,
  digest: GraphDigestPort,
  options: { readonly maxBytes?: number } = {}
): Promise<WisDigestReference> {
  if (digest.algorithm !== 'sha256') {
    throw new Error('Graph digest port must implement SHA-256.');
  }
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
    throw new Error('Graph digest byte budget must be a positive safe integer.');
  }
  const canonical = canonicalizeGraphValue(input, {
    ...(maxBytes === undefined ? {} : { maxValues: maxBytes }),
  });
  if (!canonical.accepted) {
    throw new Error(canonical.issues[0]?.message ?? 'Canonicalization failed.');
  }
  const bytes = encoder.encode(canonical.value);
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw new Error('Graph digest input exceeded its byte budget.');
  }
  const value = await digest.digest(bytes);
  if (!/^[a-f0-9]{32,256}$/u.test(value)) {
    throw new Error('Graph digest port returned a non-canonical lowercase hexadecimal digest.');
  }
  return Object.freeze({
    algorithm: 'sha256',
    value,
    canonicalization: 'workspai.graph.canonical-json.v1',
  });
}

/** Drops non-schema digest fields so shard records stay content-state valid. */
export function shardDigest(reference: WisDigestReference): WisDigestReference {
  return Object.freeze({
    algorithm: reference.algorithm,
    value: reference.value,
  });
}

export function mergeShardDigests(
  ...groups: readonly (readonly WisDigestReference[])[]
): readonly WisDigestReference[] {
  const seen = new Set<string>();
  const merged: WisDigestReference[] = [];
  for (const group of groups) {
    for (const digest of group) {
      const key = `${digest.algorithm}:${digest.value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(shardDigest(digest));
    }
  }
  return Object.freeze(
    merged.sort(
      (left, right) =>
        left.algorithm.localeCompare(right.algorithm) || left.value.localeCompare(right.value)
    )
  );
}
