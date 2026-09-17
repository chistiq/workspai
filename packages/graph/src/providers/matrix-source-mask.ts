import type { GraphStructuralLanguage } from '../contracts/structural-extractor-profile.js';

/**
 * Blanks comments and string literals while preserving physical lines. Template
 * and f-string interpolations stay in the code channel so real calls remain
 * visible. This is a shared lexical pass, not a syntax tree.
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

type QuoteMode = 'js' | 'go' | 'clike' | 'hash';

function maskQuoted(source: string, mode: QuoteMode): string {
  const chars = [...source];
  const out = chars.slice();
  const n = chars.length;
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const current = chars[index];
      if (current !== '\n' && current !== '\r') out[index] = ' ';
    }
  };

  const maskLineComment = (): void => {
    const start = i;
    while (i < n && chars[i] !== '\n' && chars[i] !== '\r') i += 1;
    blank(start, i);
  };

  const maskBlockComment = (): void => {
    const start = i;
    i += 2;
    while (i < n && !(chars[i] === '*' && chars[i + 1] === '/')) i += 1;
    if (i < n) i += 2;
    blank(start, i);
  };

  const maskSimpleString = (quote: string, raw: boolean): void => {
    const start = i;
    i += 1;
    while (i < n) {
      const current = chars[i];
      if (!raw && current === '\\') {
        i += current !== undefined ? 2 : 1;
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

  const maskTemplate = (): void => {
    out[i] = ' ';
    i += 1;
    while (i < n) {
      const current = chars[i];
      if (current === '\\') {
        out[i] = ' ';
        i += 1;
        if (i < n && chars[i] !== '\n' && chars[i] !== '\r') out[i] = ' ';
        i += 1;
        continue;
      }
      if (current === '`') {
        out[i] = ' ';
        i += 1;
        return;
      }
      if (current === '$' && chars[i + 1] === '{') {
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
      const current = chars[i] ?? '';
      if (until && current === '}' && depth === 0) {
        out[i] = ' ';
        i += 1;
        return;
      }
      if (until && current === '{') depth += 1;
      else if (until && current === '}' && depth > 0) depth -= 1;
      if (current === '/' && chars[i + 1] === '/' && mode !== 'hash') {
        maskLineComment();
        continue;
      }
      if (current === '#' && mode === 'hash') {
        maskLineComment();
        continue;
      }
      if (current === '/' && chars[i + 1] === '*' && mode !== 'hash') {
        maskBlockComment();
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

function maskPython(source: string): string {
  const chars = [...source];
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
