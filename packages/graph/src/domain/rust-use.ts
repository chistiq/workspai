export interface RustUseImport {
  readonly path: string;
  readonly line: number;
}

/**
 * Rust `use` trees name every imported path. `use foo::{A, B}` is `foo::A` and
 * `foo::B`, not the truncated prefix `foo::` and not one opaque brace string.
 */
export function collectRustUseImports(source: string): readonly RustUseImport[] {
  const masked = maskRustComments(source);
  const statement = /(?:^|\n)([ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?use[ \t]+)/gu;
  const seen = new Set<string>();
  const imports: RustUseImport[] = [];
  let match: RegExpExecArray | null;
  while ((match = statement.exec(masked))) {
    const start = match.index + match[0].length;
    const end = masked.indexOf(';', start);
    if (end < 0) break;
    const line = masked.slice(0, match.index + 1).split('\n').length;
    for (const path of expandRustUseTree(masked.slice(start, end))) {
      if (seen.has(path)) continue;
      seen.add(path);
      imports.push({ path, line });
    }
    statement.lastIndex = end + 1;
  }
  return imports;
}

export function expandRustUseTree(body: string): readonly string[] {
  const parsed = flattenRustUse(body.trim());
  if (!parsed || parsed.length === 0) {
    const collapsed = body.replace(/\s+/gu, ' ').trim();
    return collapsed ? [collapsed] : [];
  }
  return parsed;
}

function maskRustComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//gu, (block) =>
    block.replace(/[^\n]/gu, ' ')
  );
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      return comment < 0 ? line : line.slice(0, comment);
    })
    .join('\n');
}

function flattenRustUse(body: string): readonly string[] | undefined {
  const parts = splitTopLevelCommas(body);
  if (!parts) return undefined;
  const paths: string[] = [];
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const expanded = flattenRustUseOne(piece);
    if (!expanded) return undefined;
    paths.push(...expanded);
  }
  return paths;
}

function flattenRustUseOne(body: string): readonly string[] | undefined {
  const brace = body.indexOf('{');
  if (brace < 0) {
    const leaf = rustUseLeaf(body);
    return leaf ? [leaf] : undefined;
  }
  const close = matchingBrace(body, brace);
  if (close < 0 || body.slice(close + 1).trim()) return undefined;
  const head = body.slice(0, brace).trim().replace(/::$/u, '').trim();
  if (head && !isRustPath(head)) return undefined;
  const inner = flattenRustUse(body.slice(brace + 1, close));
  if (!inner) return undefined;
  return inner.flatMap((child) => {
    if (child === 'self') return head ? [head] : [];
    if (child === '*') return head ? [`${head}::*`] : [];
    return [head ? `${head}::${child}` : child];
  });
}

function rustUseLeaf(body: string): string | undefined {
  const withoutAlias = body.split(/\s+as\s+/u)[0]?.trim() ?? '';
  if (withoutAlias === 'self' || withoutAlias === '*') return withoutAlias;
  return isRustPath(withoutAlias) ? withoutAlias : undefined;
}

function isRustPath(value: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*|r#[A-Za-z_][A-Za-z0-9_]*)(?:::(?:[A-Za-z_][A-Za-z0-9_]*|r#[A-Za-z_][A-Za-z0-9_]*|\*))*$/u.test(
    value
  );
}

function splitTopLevelCommas(body: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(body.slice(start));
  return parts;
}

function matchingBrace(body: string, open: number): number {
  let depth = 0;
  for (let index = open; index < body.length; index += 1) {
    const char = body[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
