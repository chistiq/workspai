/**
 * Bounded ECMAScript tokenizer and call-chain scan. This is syntax-aware for
 * comments, strings, template literals, and member/call chains. It is not a
 * full JS parser: unsupported forms stay unconsumed rather than guessed.
 */
export const ECMASCRIPT_SYNTAX_VERSION = 'workspai.graph.ecmascript-syntax.v1' as const;

export interface EcmascriptToken {
  readonly kind: 'ident' | 'string' | 'punct' | 'number';
  readonly value: string;
  readonly index: number;
}

export type EcmascriptCallChainStep =
  | { readonly kind: 'member'; readonly name: string }
  | { readonly kind: 'call'; readonly openParen: number };

export interface EcmascriptCallChain {
  readonly root: string;
  readonly usedNew: boolean;
  readonly requireSpecifier: string | undefined;
  readonly steps: readonly EcmascriptCallChainStep[];
}

const REGEX_PREFIX_PUNCT = new Set([
  '(',
  ',',
  '=',
  ':',
  ';',
  '!',
  '&',
  '|',
  '?',
  '{',
  '[',
  '}',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
]);

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/u.test(char);
}

function isIdentContinue(char: string): boolean {
  return /[A-Za-z0-9_$]/u.test(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function skipLineComment(source: string, index: number): number {
  let cursor = index + 2;
  while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
  return cursor;
}

function skipBlockComment(source: string, index: number): number {
  let cursor = index + 2;
  while (cursor < source.length) {
    if (source[cursor] === '*' && source[cursor + 1] === '/') return cursor + 2;
    cursor += 1;
  }
  return source.length;
}

function readString(source: string, index: number, quote: string): { value: string; end: number } {
  let cursor = index + 1;
  let escaped = false;
  if (quote === '`') {
    let templateDepth = 0;
    while (cursor < source.length) {
      const char = source[cursor] ?? '';
      if (escaped) {
        escaped = false;
        cursor += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        cursor += 1;
        continue;
      }
      if (char === '`' && templateDepth === 0) {
        return { value: source.slice(index, cursor + 1), end: cursor + 1 };
      }
      if (char === '$' && source[cursor + 1] === '{') {
        templateDepth += 1;
        cursor += 2;
        continue;
      }
      if (char === '{' && templateDepth > 0) {
        templateDepth += 1;
        cursor += 1;
        continue;
      }
      if (char === '}' && templateDepth > 0) {
        templateDepth -= 1;
        cursor += 1;
        continue;
      }
      cursor += 1;
    }
    return { value: source.slice(index), end: source.length };
  }
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (char === quote) return { value: source.slice(index, cursor + 1), end: cursor + 1 };
    if (char === '\n') break;
    cursor += 1;
  }
  return { value: source.slice(index, cursor), end: cursor };
}

function readRegex(source: string, index: number): number {
  let cursor = index + 1;
  let escaped = false;
  let characterClass = false;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (char === '[' && !characterClass) {
      characterClass = true;
      cursor += 1;
      continue;
    }
    if (char === ']' && characterClass) {
      characterClass = false;
      cursor += 1;
      continue;
    }
    if (char === '/' && !characterClass) {
      cursor += 1;
      while (cursor < source.length && /[a-z]/iu.test(source[cursor] ?? '')) cursor += 1;
      return cursor;
    }
    if (char === '\n') return cursor;
    cursor += 1;
  }
  return cursor;
}

function canStartRegex(previous: EcmascriptToken | undefined): boolean {
  if (!previous) return true;
  if (previous.kind === 'punct') return REGEX_PREFIX_PUNCT.has(previous.value);
  return false;
}

export function tokenizeEcmascript(source: string): readonly EcmascriptToken[] {
  const tokens: EcmascriptToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === '\u000b' ||
      char === '\u000c'
    ) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }
    if (char === '/' && canStartRegex(tokens.at(-1))) {
      index = readRegex(source, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const read = readString(source, index, char);
      tokens.push({ kind: 'string', value: read.value, index });
      index = read.end;
      continue;
    }
    if (isIdentStart(char)) {
      let cursor = index + 1;
      while (cursor < source.length && isIdentContinue(source[cursor] ?? '')) cursor += 1;
      tokens.push({ kind: 'ident', value: source.slice(index, cursor), index });
      index = cursor;
      continue;
    }
    if (isDigit(char)) {
      let cursor = index + 1;
      while (cursor < source.length && isDigit(source[cursor] ?? '')) cursor += 1;
      tokens.push({ kind: 'number', value: source.slice(index, cursor), index });
      index = cursor;
      continue;
    }
    tokens.push({ kind: 'punct', value: char, index });
    index += 1;
  }
  return tokens;
}

function skipBalanced(
  tokens: readonly EcmascriptToken[],
  start: number,
  open: string,
  close: string
): number | undefined {
  if (tokens[start]?.kind !== 'punct' || tokens[start]?.value !== open) return undefined;
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'punct') continue;
    if (token.value === open) depth += 1;
    else if (token.value === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

function literalSpecifier(token: EcmascriptToken | undefined): string | undefined {
  if (token?.kind !== 'string' || token.value.length < 2) return undefined;
  const quote = token.value[0];
  if (quote !== "'" && quote !== '"') return undefined;
  if (token.value[token.value.length - 1] !== quote) return undefined;
  const inner = token.value.slice(1, -1);
  if (inner.includes('\\') || inner.includes('\0') || inner.includes('${')) return undefined;
  return inner;
}

export function scanEcmascriptCallChains(source: string): readonly EcmascriptCallChain[] {
  const tokens = tokenizeEcmascript(source);
  const chains: EcmascriptCallChain[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token?.kind !== 'ident') {
      index += 1;
      continue;
    }
    const previous = tokens[index - 1];
    if (previous?.kind === 'punct' && previous.value === '.') {
      index += 1;
      continue;
    }
    const usedNew = previous?.kind === 'ident' && previous.value === 'new';
    const root = token.value;
    const steps: EcmascriptCallChainStep[] = [];
    let requireSpecifier: string | undefined;
    let cursor = index + 1;
    if (root === 'require' && tokens[cursor]?.kind === 'punct' && tokens[cursor]?.value === '(') {
      requireSpecifier = literalSpecifier(tokens[cursor + 1]);
    }
    while (cursor < tokens.length) {
      const current = tokens[cursor];
      if (current?.kind === 'punct' && current.value === '(') {
        const next = skipBalanced(tokens, cursor, '(', ')');
        if (next === undefined) break;
        steps.push({ kind: 'call', openParen: current.index });
        cursor = next;
        continue;
      }
      if (current?.kind === 'punct' && current.value === '.') {
        const member = tokens[cursor + 1];
        if (member?.kind !== 'ident') break;
        steps.push({ kind: 'member', name: member.value });
        cursor += 2;
        continue;
      }
      break;
    }
    if (steps.length > 0) {
      chains.push({
        root,
        usedNew,
        requireSpecifier,
        steps: Object.freeze(steps),
      });
    }
    index = Math.max(index + 1, cursor);
  }
  return chains;
}
