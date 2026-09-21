import type { GraphStructuralLanguage } from '../contracts/structural-extractor-profile.js';
import { contentAddressedCompute, contentAddressedFactKey } from './content-addressed-facts.js';

export const MATRIX_SOURCE_MASK_VERSION = 'workspai.graph.matrix-source-mask.v1';

/**
 * Blanks comments and string literals while preserving physical lines and
 * UTF-16 indices. Template and f-string interpolations stay in the code
 * channel so real calls remain visible. This is a shared lexical pass, not a
 * syntax tree. Regex literals are recognized only for JavaScript/TypeScript.
 */
export function maskMatrixSourceLiterals(
  source: string,
  language: GraphStructuralLanguage | null
): string {
  if (language === 'python') return maskPython(source);
  if (language === 'ruby' || language === 'elixir') return maskQuoted(source, 'hash');
  if (language === 'go') return maskQuoted(source, 'go');
  if (language === 'node' || language === null) return maskQuoted(source, 'js');
  return maskQuoted(source, 'clike');
}

/**
 * Content-addressed code view. Strings are immutable, so cache hits return the
 * stored snapshot without copying. The mask algorithm version is part of the key.
 */
export function maskMatrixSourceLiteralsCached(
  source: string,
  language: GraphStructuralLanguage | null,
  contentDigest: string
): string {
  if (!/^[a-f0-9]{64}$/u.test(contentDigest)) {
    return maskMatrixSourceLiterals(source, language);
  }
  return contentAddressedCompute(
    contentAddressedFactKey({
      extractorId: 'workspai.graph.matrix-source-mask',
      extractorVersion: MATRIX_SOURCE_MASK_VERSION,
      contentDigest,
      configuration: language ?? 'unknown',
    }),
    () => maskMatrixSourceLiterals(source, language)
  );
}

export function isMatrixCodeChannelIndex(
  source: string,
  language: GraphStructuralLanguage | null,
  index: number
): boolean {
  if (index < 0 || index >= source.length) return false;
  const masked = maskMatrixSourceLiterals(source, language);
  return source[index] === masked[index];
}

export function matchAllInMatrixCodeChannel(
  source: string,
  language: GraphStructuralLanguage | null,
  pattern: RegExp
): RegExpMatchArray[] {
  return matchAllInMatrixCodeView(source, maskMatrixSourceLiterals(source, language), pattern);
}

export function matchAllInMatrixCodeView(
  source: string,
  masked: string,
  pattern: RegExp
): RegExpMatchArray[] {
  if (masked.length !== source.length) {
    throw new Error('Matrix code view must preserve source UTF-16 length.');
  }
  const matches: RegExpMatchArray[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const offset = match[0].search(/\S/u);
    const index = start + (offset >= 0 ? offset : 0);
    if (index < source.length && source[index] === masked[index]) matches.push(match);
  }
  return matches;
}

type QuoteMode = 'js' | 'go' | 'clike' | 'hash';

function maskQuoted(source: string, mode: QuoteMode): string {
  const n = source.length;
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const current = source[index];
      if (current !== '\n' && current !== '\r') out[index] = ' ';
    }
  };

  const maskLineComment = (): void => {
    const start = i;
    while (i < n && source[i] !== '\n' && source[i] !== '\r') i += 1;
    blank(start, i);
  };

  const maskBlockComment = (): void => {
    const start = i;
    i += 2;
    while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
    if (i < n) i += 2;
    blank(start, i);
  };

  const maskSimpleString = (quote: string, raw: boolean): void => {
    const start = i;
    i += 1;
    while (i < n) {
      const current = source[i];
      if (!raw && current === '\\') {
        i += 2;
        continue;
      }
      if (current === quote) {
        i += 1;
        break;
      }
      if (quote !== '`' && (current === '\n' || current === '\r')) break;
      i += 1;
    }
    blank(start, i);
  };

  const maskRegex = (): void => {
    const start = i;
    i += 1;
    let inClass = false;
    while (i < n) {
      const current = source[i];
      if (current === '\\') {
        i += 2;
        continue;
      }
      if (current === '[' && !inClass) {
        inClass = true;
        i += 1;
        continue;
      }
      if (current === ']' && inClass) {
        inClass = false;
        i += 1;
        continue;
      }
      if ((current === '\n' || current === '\r') && !inClass) break;
      if (current === '/' && !inClass) {
        i += 1;
        while (i < n && /[A-Za-z]/u.test(source[i] ?? '')) i += 1;
        break;
      }
      i += 1;
    }
    blank(start, i);
  };

  const maskTemplate = (): void => {
    out[i] = ' ';
    i += 1;
    while (i < n) {
      const current = source[i];
      if (current === '\\') {
        out[i] = ' ';
        i += 1;
        if (i < n && source[i] !== '\n' && source[i] !== '\r') out[i] = ' ';
        i += 1;
        continue;
      }
      if (current === '`') {
        out[i] = ' ';
        i += 1;
        return;
      }
      if (current === '$' && source[i + 1] === '{') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        scanCode('}');
        continue;
      }
      if (current !== '\n' && current !== '\r') out[i] = ' ';
      i += 1;
    }
  };

  const scanCode = (until?: '}'): void => {
    let depth = 0;
    while (i < n) {
      const current = source[i] ?? '';
      if (until && current === '}' && depth === 0) {
        out[i] = ' ';
        i += 1;
        return;
      }
      if (until && current === '{') depth += 1;
      else if (until && current === '}' && depth > 0) depth -= 1;
      if (current === '/' && source[i + 1] === '/' && mode !== 'hash') {
        maskLineComment();
        continue;
      }
      if (current === '#' && mode === 'hash') {
        maskLineComment();
        continue;
      }
      if (current === '/' && source[i + 1] === '*' && mode !== 'hash') {
        maskBlockComment();
        continue;
      }
      if (
        current === '/' &&
        mode === 'js' &&
        source[i + 1] !== '/' &&
        source[i + 1] !== '*' &&
        canBeginJsRegex(source, i)
      ) {
        maskRegex();
        continue;
      }
      if (current === "'" || current === '"') {
        maskSimpleString(current, false);
        continue;
      }
      if (current === '`' && mode === 'js') {
        maskTemplate();
        continue;
      }
      if (current === '`' && mode === 'go') {
        maskSimpleString('`', true);
        continue;
      }
      i += 1;
    }
  };

  scanCode();
  return out.join('');
}

const JS_REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'else',
  'do',
  'in',
  'typeof',
  'void',
  'delete',
  'new',
  'await',
  'yield',
  'instanceof',
]);

function canBeginJsRegex(source: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /[ \t\u000b\u000c]/u.test(source[cursor] ?? '')) cursor -= 1;
  if (cursor < 0) return true;
  const previous = source[cursor] ?? '';
  if ((previous === '+' || previous === '-') && cursor > 0 && source[cursor - 1] === previous) {
    return false;
  }
  if (/[)'"\]`]/u.test(previous)) return false;
  if (/[\w$]/u.test(previous)) {
    let start = cursor;
    while (start > 0 && /[\w$]/u.test(source[start - 1] ?? '')) start -= 1;
    return JS_REGEX_PREFIX_KEYWORDS.has(source.slice(start, cursor + 1));
  }
  return true;
}

function maskPython(source: string): string {
  const chars = source.split('');
  const out = chars.slice();
  const n = chars.length;
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const current = chars[index];
      if (current !== '\n' && current !== '\r') out[index] = ' ';
    }
  };

  const prefixAt = (quoteIndex: number): string => {
    let cursor = quoteIndex - 1;
    let prefix = '';
    while (cursor >= 0 && 'rRuUfFbB'.includes(chars[cursor] ?? '')) {
      prefix = `${chars[cursor] ?? ''}${prefix}`;
      cursor -= 1;
    }
    return prefix;
  };

  const maskString = (triple: boolean, quote: string, interpolating: boolean): void => {
    let start = i;
    i += triple ? 3 : 1;
    while (i < n) {
      const current = chars[i];
      if (current === '\\') {
        i += 2;
        continue;
      }
      if (triple && chars[i] === quote && chars[i + 1] === quote && chars[i + 2] === quote) {
        i += 3;
        break;
      }
      if (!triple && current === quote) {
        i += 1;
        break;
      }
      if (!triple && (current === '\n' || current === '\r')) break;
      if (interpolating && current === '{' && chars[i + 1] === '{') {
        i += 2;
        continue;
      }
      if (interpolating && current === '{') {
        blank(start, i);
        out[i] = ' ';
        i += 1;
        scanPython('}');
        start = i;
        continue;
      }
      i += 1;
    }
    blank(start, i);
  };

  const scanPython = (until?: '}'): void => {
    let depth = 0;
    while (i < n) {
      const current = chars[i] ?? '';
      if (until && current === '}' && depth === 0) {
        out[i] = ' ';
        i += 1;
        return;
      }
      if (until && current === '{') depth += 1;
      else if (until && current === '}' && depth > 0) depth -= 1;
      if (current === '#') {
        const start = i;
        while (i < n && chars[i] !== '\n' && chars[i] !== '\r') i += 1;
        blank(start, i);
        continue;
      }
      if (current === "'" || current === '"') {
        const triple = chars[i + 1] === current && chars[i + 2] === current;
        maskString(triple, current, /[fF]/u.test(prefixAt(i)));
        continue;
      }
      i += 1;
    }
  };

  scanPython();
  return out.join('');
}
