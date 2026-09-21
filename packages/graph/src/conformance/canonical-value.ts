import type { GraphValidationResult } from '../contracts/index.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_CANONICAL_DEPTH = 256;
const MAX_CANONICAL_VALUES = 1_000_000;
const utf8 = new TextEncoder();

function canonicalPath(parts: readonly string[]): string {
  return parts.length === 0 ? '' : `/${parts.join('/')}`;
}

function normalize(
  value: unknown,
  path: string,
  active: Set<object>,
  state: { count: number },
  depth: number,
  maxValues: number
): unknown {
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
    const result: Record<string, unknown> = {};
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

function canonicalizationFailure(error: unknown): GraphValidationResult<never>['issues'] {
  const message = error instanceof Error ? error.message : 'Canonicalization failed.';
  const separator = message.indexOf(':');
  return [
    {
      code: 'GRAPH_CANONICALIZATION_REJECTED',
      path: separator >= 0 ? message.slice(0, separator) : '',
      message,
    },
  ];
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
    return { accepted: false, issues: canonicalizationFailure(error) };
  }
}

export interface CanonicalGraphByteSink {
  write(chunk: Uint8Array): void;
}

export interface StreamCanonicalGraphValueOptions {
  readonly maxValues?: number;
  readonly maxBytes?: number;
  readonly throwIfAborted?: () => void;
  readonly yieldEvery?: number;
  readonly yield?: () => void | Promise<void>;
}

const STREAM_FLUSH_CHARS = 16_384;

/**
 * Emits the same UTF-8 bytes as `canonicalizeGraphValue` without retaining the
 * complete canonical JSON string. Worker transport budgets must not be passed
 * as maxBytes: that cap is only for callers that intentionally bound a payload.
 *
 * The walk is synchronous so large fact sets do not pay a Promise per JSON
 * node. Optional `yield` runs once after the complete walk.
 */
export async function streamCanonicalGraphValue(
  input: unknown,
  sink: CanonicalGraphByteSink,
  options: StreamCanonicalGraphValueOptions = {}
): Promise<GraphValidationResult<{ readonly bytes: number }>> {
  try {
    const maxValues = options.maxValues ?? MAX_CANONICAL_VALUES;
    if (!Number.isSafeInteger(maxValues) || maxValues <= 0) {
      throw new Error('/maxValues: value budget must be a positive safe integer');
    }
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0)
    ) {
      throw new Error('/maxBytes: byte budget must be a positive safe integer');
    }
    const state = { count: 0, bytes: 0, visits: 0, path: '' };
    const pending: string[] = [];
    let pendingChars = 0;
    const flush = (): void => {
      if (pending.length === 0) return;
      const text = pending.length === 1 ? pending[0] : pending.join('');
      pending.length = 0;
      pendingChars = 0;
      if (text === undefined || text.length === 0) return;
      const bytes = utf8.encode(text);
      if (options.maxBytes !== undefined && state.bytes + bytes.byteLength > options.maxBytes) {
        throw new Error(`${state.path}: byte budget exceeded`);
      }
      state.bytes += bytes.byteLength;
      sink.write(bytes);
    };
    const emit = (text: string): void => {
      pending.push(text);
      pendingChars += text.length;
      if (pendingChars >= STREAM_FLUSH_CHARS) flush();
    };
    streamNormalized(input, [], new Set(), state, 0, maxValues, emit, options);
    flush();
    if (options.yield) await options.yield();
    return { accepted: true, value: { bytes: state.bytes }, issues: [] };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { accepted: false, issues: canonicalizationFailure(error) };
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

export function cloneCanonicalGraphValue<T>(
  input: T,
  options: { readonly maxValues?: number } = {}
): GraphValidationResult<T> {
  const canonical = canonicalizeGraphValue(input, options);
  if (!canonical.accepted) return canonical as GraphValidationResult<T>;
  try {
    return {
      accepted: true,
      value: JSON.parse(canonical.value) as T,
      issues: [],
    };
  } catch (error) {
    return { accepted: false, issues: canonicalizationFailure(error) };
  }
}

function streamNormalized(
  value: unknown,
  path: string[],
  active: Set<object>,
  state: { count: number; bytes: number; visits: number; path: string },
  depth: number,
  maxValues: number,
  emit: (text: string) => void,
  options: StreamCanonicalGraphValueOptions
): void {
  state.count += 1;
  state.visits += 1;
  if (state.visits === 1 || (state.visits & 4095) === 0) {
    options.throwIfAborted?.();
    state.path = canonicalPath(path);
  }
  if (state.count > maxValues) throw new Error(`${canonicalPath(path)}: value budget exceeded`);
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new Error(`${canonicalPath(path)}: nesting budget exceeded`);
  }

  if (value === null) {
    emit('null');
    return;
  }
  if (typeof value === 'boolean') {
    emit(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'string') {
    emit(JSON.stringify(value));
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${canonicalPath(path)}: non-finite number`);
    emit(JSON.stringify(Object.is(value, -0) ? 0 : value));
    return;
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new Error(`${canonicalPath(path)}: cyclic value`);
    active.add(value);
    emit('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) emit(',');
      path.push(String(index));
      streamNormalized(value[index], path, active, state, depth + 1, maxValues, emit, options);
      path.pop();
    }
    emit(']');
    active.delete(value);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (active.has(value)) throw new Error(`${canonicalPath(path)}: cyclic value`);
    active.add(value);
    const keys = Object.keys(value).sort();
    emit('{');
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) continue;
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`${canonicalPath(path)}/${key}: forbidden key`);
      const item = (value as Record<string, unknown>)[key];
      if (
        item === undefined ||
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        typeof item === 'bigint'
      ) {
        throw new Error(`${canonicalPath(path)}/${key}: non-JSON value`);
      }
      if (index > 0) emit(',');
      emit(JSON.stringify(key));
      emit(':');
      path.push(key);
      streamNormalized(item, path, active, state, depth + 1, maxValues, emit, options);
      path.pop();
    }
    emit('}');
    active.delete(value);
    return;
  }
  throw new Error(`${canonicalPath(path)}: non-JSON value`);
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
