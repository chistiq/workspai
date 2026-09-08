import { createHash } from 'node:crypto';

import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphValidationIssue, GraphValidationResult } from '../contracts/index.js';

type CanonicalJson =
  null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CANONICAL_DEPTH = 256;
const MAX_CANONICAL_VALUES = 1_000_000;

function normalize(
  value: unknown,
  path: string,
  active: Set<object>,
  state: { count: number },
  depth: number
): CanonicalJson {
  state.count += 1;
  if (state.count > MAX_CANONICAL_VALUES) throw new Error(`${path}: value budget exceeded`);
  if (depth > MAX_CANONICAL_DEPTH) throw new Error(`${path}: nesting budget exceeded`);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new Error(`${path}: cyclic value`);
    active.add(value);
    const result = value.map((item, index) =>
      normalize(item, `${path}/${index}`, active, state, depth + 1)
    );
    active.delete(value);
    return result;
  }
  if (typeof value === 'object' && value !== null) {
    if (active.has(value)) throw new Error(`${path}: cyclic value`);
    active.add(value);
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}/${key}: forbidden key`);
      const item = (value as Record<string, unknown>)[key];
      if (
        item === undefined ||
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        typeof item === 'bigint'
      ) {
        throw new Error(`${path}/${key}: non-JSON value`);
      }
      result[key] = normalize(item, `${path}/${key}`, active, state, depth + 1);
    }
    active.delete(value);
    return result;
  }
  throw new Error(`${path}: non-JSON value`);
}

export function canonicalizeGraphValue(input: unknown): GraphValidationResult<string> {
  try {
    return {
      accepted: true,
      value: JSON.stringify(normalize(input, '', new Set(), { count: 0 }, 0)),
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Canonicalization failed.';
    const separator = message.indexOf(':');
    const issues: GraphValidationIssue[] = [
      {
        code: 'GRAPH_CANONICALIZATION_REJECTED',
        path: separator >= 0 ? message.slice(0, separator) : '',
        message,
      },
    ];
    return { accepted: false, issues };
  }
}

export function digestCanonicalGraphValue(
  input: unknown
): GraphValidationResult<WisDigestReference> {
  const canonical = canonicalizeGraphValue(input);
  if (!canonical.accepted) return canonical;
  return {
    accepted: true,
    value: Object.freeze({
      algorithm: 'sha256',
      value: createHash('sha256').update(canonical.value, 'utf8').digest('hex'),
      canonicalization: 'workspai.graph.canonical-json.v1',
    }),
    issues: [],
  };
}
