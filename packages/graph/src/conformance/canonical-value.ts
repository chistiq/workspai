import type { GraphValidationIssue, GraphValidationResult } from '../contracts/index.js';

type CanonicalJson =
  null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CANONICAL_DEPTH = 256;
const MAX_CANONICAL_VALUES = 1_000_000;
const utf8 = new TextEncoder();

function normalize(
  value: unknown,
  path: string,
  active: Set<object>,
  state: { count: number },
  depth: number,
  maxValues: number
): CanonicalJson {
  state.count += 1;
  if (state.count > maxValues) throw new Error(`${path}: value budget exceeded`);
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
      normalize(item, `${path}/${index}`, active, state, depth + 1, maxValues)
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
      result[key] = normalize(item, `${path}/${key}`, active, state, depth + 1, maxValues);
    }
    active.delete(value);
    return result;
  }
  throw new Error(`${path}: non-JSON value`);
}

export function canonicalizeGraphValue(
  input: unknown,
  options: { readonly maxValues?: number } = {}
): GraphValidationResult<string> {
  try {
    const maxValues = options.maxValues ?? MAX_CANONICAL_VALUES;
    if (!Number.isSafeInteger(maxValues) || maxValues <= 0) {
      throw new Error('/maxValues: value budget must be a positive safe integer');
    }
    return {
      accepted: true,
      value: JSON.stringify(normalize(input, '', new Set(), { count: 0 }, 0, maxValues)),
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

function addMeasuredBytes(
  state: { bytes: number },
  bytes: number,
  maximum: number,
  path: string
): void {
  state.bytes += bytes;
  if (state.bytes > maximum) throw new Error(`${path}: byte budget exceeded`);
}

function measure(
  value: unknown,
  path: string,
  active: Set<object>,
  state: { bytes: number },
  depth: number,
  maximum: number
): void {
  if (depth > MAX_CANONICAL_DEPTH) throw new Error(`${path}: nesting budget exceeded`);
  if (value === null) return addMeasuredBytes(state, 4, maximum, path);
  if (typeof value === 'boolean') return addMeasuredBytes(state, value ? 4 : 5, maximum, path);
  if (typeof value === 'string')
    return addMeasuredBytes(state, utf8.encode(JSON.stringify(value)).byteLength, maximum, path);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number`);
    return addMeasuredBytes(
      state,
      utf8.encode(JSON.stringify(Object.is(value, -0) ? 0 : value)).byteLength,
      maximum,
      path
    );
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new Error(`${path}: cyclic value`);
    active.add(value);
    addMeasuredBytes(state, 2 + Math.max(0, value.length - 1), maximum, path);
    for (const [index, item] of value.entries())
      measure(item, `${path}/${index}`, active, state, depth + 1, maximum);
    active.delete(value);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (active.has(value)) throw new Error(`${path}: cyclic value`);
    active.add(value);
    const keys = Object.keys(value).sort();
    addMeasuredBytes(state, 2 + Math.max(0, keys.length - 1), maximum, path);
    for (const key of keys) {
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
      addMeasuredBytes(state, utf8.encode(JSON.stringify(key)).byteLength + 1, maximum, path);
      measure(item, `${path}/${key}`, active, state, depth + 1, maximum);
    }
    active.delete(value);
    return;
  }
  throw new Error(`${path}: non-JSON value`);
}

/** Measures canonical JSON bytes without materializing another large serialized graph. */
export function measureCanonicalGraphValueBytes(
  input: unknown,
  maxBytes: number
): GraphValidationResult<number> {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('/maxBytes: byte budget must be a positive safe integer');
    }
    const state = { bytes: 0 };
    measure(input, '', new Set(), state, 0, maxBytes);
    return { accepted: true, value: state.bytes, issues: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Canonical size measurement failed.';
    const separator = message.indexOf(':');
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_CANONICALIZATION_REJECTED',
          path: separator >= 0 ? message.slice(0, separator) : '',
          message,
        },
      ],
    };
  }
}
