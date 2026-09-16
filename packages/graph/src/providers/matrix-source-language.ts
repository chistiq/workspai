import {
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE,
  type GraphStructuralLanguage,
} from '../contracts/structural-extractor-profile.js';
import { extensionOf } from './observed-edge-fact.js';

export interface MatrixDeclaration {
  readonly name: string;
  readonly detail: 'function' | 'type' | 'value' | 'method';
  readonly line: number;
}

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, GraphStructuralLanguage>> = Object.freeze(
  Object.fromEntries(
    GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.flatMap((profile) =>
      profile.extensions.map((extension) => [extension, profile.language] as const)
    )
  )
);

export const MATRIX_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.flatMap((profile) => [
    ...profile.extensions,
  ])
);

const HASH_COMMENT_LANGUAGES = new Set<GraphStructuralLanguage>(['python', 'ruby', 'elixir']);
const CONTROL_START =
  /^(?:if|else|for|while|switch|return|throw|catch|sizeof|alignof|offsetof|delete|new|case|goto|using|typedef|static_assert|assert|elif|unless|until|when|rescue|ensure)\b/u;
const TYPED_FUNCTION =
  /^\s*(?:template\s*<[^;{}]*>\s*)?(?:[\w:@*&<>,.\[\]?]+\s+){1,8}([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(/u;
const KEYWORD_DECLARATIONS: readonly {
  readonly pattern: RegExp;
  readonly detail: MatrixDeclaration['detail'];
}[] = [
  {
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u,
    detail: 'function',
  },
  {
    pattern:
      /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/u,
    detail: 'type',
  },
  {
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u,
    detail: 'value',
  },
  { pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*[!?]?)/u, detail: 'function' },
  { pattern: /^\s*defmodule\s+([A-Z][\w.]*)/u, detail: 'type' },
  { pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/u, detail: 'function' },
  {
    pattern: /^\s*(?:(?:public|private|internal|protected|open|override)\s+)*fun\s+([A-Za-z_]\w*)/u,
    detail: 'function',
  },
  {
    pattern: /^\s*(?:(?:public|private|internal|open|override)\s+)*func\s+([A-Za-z_]\w*)/u,
    detail: 'function',
  },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/u, detail: 'function' },
  {
    pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|trait|enum|type)\s+([A-Za-z_]\w*)/u,
    detail: 'type',
  },
  {
    pattern:
      /^\s*(?:(?:public|private|protected|internal|abstract|final|open|data|sealed|value)\s+)*(?:class|interface|record|enum|object|struct|protocol|actor|mixin|module)\s+([A-Za-z_]\w*)/u,
    detail: 'type',
  },
  { pattern: /^\s*@(?:interface|implementation|protocol)\s+([A-Za-z_]\w*)/u, detail: 'type' },
  { pattern: /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/u, detail: 'method' },
  {
    pattern: /^\s*(?:public\s+|private\s+|protected\s+)?function\s+([A-Za-z_]\w*)/u,
    detail: 'function',
  },
];

export function matrixLanguageFor(locator: string): GraphStructuralLanguage | null {
  return EXTENSION_TO_LANGUAGE[extensionOf(locator)] ?? null;
}

export function matrixExtensionsFor(language: GraphStructuralLanguage | null): readonly string[] {
  if (!language) return [...MATRIX_SOURCE_EXTENSIONS];
  return (
    GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.find(
      (profile) => profile.language === language
    )?.extensions ?? []
  );
}

export function stripMatrixSourceComments(
  source: string,
  language: GraphStructuralLanguage | null
): string {
  const hashComments = language !== null && HASH_COMMENT_LANGUAGES.has(language);
  const withoutBlocks = hashComments ? source : source.replace(/\/\*[\s\S]*?\*\//gu, '');
  return withoutBlocks
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trimStart();
      if (hashComments && trimmed.startsWith('#')) return '';
      if (!hashComments && trimmed.startsWith('//')) return '';
      return line;
    })
    .join('\n');
}

export function extractMatrixDeclarations(
  source: string,
  language: GraphStructuralLanguage | null
): MatrixDeclaration[] {
  const findings: MatrixDeclaration[] = [];
  const lines = stripMatrixSourceComments(source, language).split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const keyword = matchKeywordDeclaration(line);
    if (keyword) {
      findings.push({ ...keyword, line: index + 1 });
      continue;
    }
    const typed = matchTypedFunction(line);
    if (typed) findings.push({ ...typed, line: index + 1 });
  }
  return findings;
}

export function extractMatrixLocalImportLocators(
  locator: string,
  source: string,
  language: GraphStructuralLanguage | null,
  available: ReadonlySet<string>
): string[] {
  const syntax = stripMatrixSourceComments(source, language);
  const specifiers = localImportSpecifiers(syntax, language);
  const resolved: string[] = [];
  for (const specifier of specifiers) {
    const match = resolveLocalSpecifier(locator, specifier, language, available);
    if (match && !resolved.includes(match)) resolved.push(match);
  }
  return resolved;
}

export function decodeMatrixSource(bytes: Uint8Array): {
  readonly text: string;
  readonly encodingFallback: boolean;
} {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encodingFallback: false,
    };
  } catch {
    return { text: new TextDecoder('latin1').decode(bytes), encodingFallback: true };
  }
}

function matchKeywordDeclaration(line: string): Omit<MatrixDeclaration, 'line'> | null {
  for (const candidate of KEYWORD_DECLARATIONS) {
    const name = lastIdentifier(candidate.pattern.exec(line)?.[1]?.trim() ?? '');
    if (name) return { name, detail: candidate.detail };
  }
  return null;
}

function matchTypedFunction(line: string): Omit<MatrixDeclaration, 'line'> | null {
  const trimmed = line.trimStart();
  if (CONTROL_START.test(trimmed)) return null;
  const name = lastIdentifier(TYPED_FUNCTION.exec(line)?.[1]?.trim() ?? '');
  if (!name || CONTROL_START.test(name)) return null;
  return { name, detail: 'function' };
}

function lastIdentifier(name: string): string {
  if (!name) return '';
  const parts = name.split('::');
  return parts[parts.length - 1] ?? '';
}

function localImportSpecifiers(source: string, language: GraphStructuralLanguage | null): string[] {
  const specifiers: string[] = [];
  if (language === 'node' || language === null) {
    for (const match of source.matchAll(
      /^\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)['"]([^'"\r\n]+)['"]/gmu
    ))
      if (match[1]?.startsWith('.')) specifiers.push(match[1]);
  }
  if (language === 'c-cpp' || language === 'objective-c-matlab') {
    for (const match of source.matchAll(/^\s*#\s*(?:include|import)\s*"([^"\r\n]+)"/gmu))
      if (match[1]) specifiers.push(match[1].trim());
  }
  if (language === 'php') {
    for (const match of source.matchAll(
      /\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?['"]([^"']+)['"]/gmu
    ))
      if (match[1]) specifiers.push(match[1]);
  }
  if (language === 'ruby') {
    for (const match of source.matchAll(/^\s*require_relative\s*(?:\(\s*)?['"]([^"']+)['"]/gmu))
      if (match[1]) specifiers.push(match[1]);
  }
  if (language === 'python') {
    for (const match of source.matchAll(/^\s*from\s+\.([A-Za-z_]\w*)\s+import\s+/gmu))
      if (match[1]) specifiers.push(`.${match[1]}`);
    for (const match of source.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/gmu))
      if (match[1]) specifiers.push(match[1]);
  }
  if (language === 'go') {
    for (const match of source.matchAll(/["`](\.[^"`]+)["`]/gu))
      if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveLocalSpecifier(
  sourceLocator: string,
  specifier: string,
  language: GraphStructuralLanguage | null,
  available: ReadonlySet<string>
): string | null {
  const base = directory(sourceLocator);
  const extensions = ['', ...matrixExtensionsFor(language)];
  if (language === 'python') {
    const modulePath = specifier.replace(/^\./u, '').replaceAll('.', '/');
    const relativeBase = specifier.startsWith('.') ? base : '';
    const candidates = [
      joinLocator(relativeBase, `${modulePath}.py`),
      joinLocator(relativeBase, `${modulePath}/__init__.py`),
    ];
    return candidates.find((candidate) => available.has(candidate)) ?? null;
  }
  const sameDirectoryLiteral =
    language === 'php' ||
    language === 'ruby' ||
    language === 'c-cpp' ||
    language === 'objective-c-matlab';
  const relative = specifier.startsWith('.') || specifier.includes('/') || specifier.includes('\\');
  if (!relative && !sameDirectoryLiteral) return null;
  const candidate = resolveRelative(base, specifier);
  if (!candidate) return null;
  for (const extension of extensions) {
    const direct = `${candidate}${extension}`;
    if (available.has(direct)) return direct;
  }
  for (const extension of matrixExtensionsFor(language)) {
    const indexed = `${candidate}/index${extension}`;
    if (available.has(indexed)) return indexed;
  }
  return null;
}

function directory(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? '' : locator.slice(0, separator);
}

function joinLocator(base: string, relative: string): string {
  return base ? `${base}/${relative}` : relative;
}

function resolveRelative(base: string, relative: string): string | null {
  const normalized: string[] = [];
  for (const segment of [...(base ? base.split('/') : []), ...relative.split(/[/\\]/u)]) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else normalized.push(segment);
  }
  return normalized.join('/');
}
