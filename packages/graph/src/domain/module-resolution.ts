/**
 * Conservative module locator resolution. Package specifiers never bind to a
 * same-named file. Relative specifiers bind only when an inventoried locator
 * proves the target. Ambiguous or missing targets stay unresolved.
 */
export type GraphModuleSpecifierClass = 'relative' | 'package' | 'unsupported';

const ECMASCRIPT_SOURCE_EXTENSIONS = Object.freeze([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

const TYPESCRIPT_RUNTIME_REWRITES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '.js': Object.freeze(['.ts', '.tsx']),
  '.jsx': Object.freeze(['.tsx']),
  '.mjs': Object.freeze(['.mts']),
  '.cjs': Object.freeze(['.cts']),
});

export function classifyModuleSpecifier(specifier: string): GraphModuleSpecifierClass {
  if (!specifier || specifier.includes('\0') || specifier.includes('\\')) return 'unsupported';
  if (specifier.startsWith('/')) return 'unsupported';
  if (specifier.startsWith('.')) return 'relative';
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return 'package';
  return 'package';
}

export function directoryOfLocator(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? '' : locator.slice(0, separator);
}

/**
 * Path arithmetic for a locator already classified as a filesystem-relative
 * path. Same-directory names such as `health.h` are valid here. Repository
 * escape via `..` is refused. This does not decide package vs file.
 */
export function joinPortableLocatorPath(
  baseDirectory: string,
  relativePath: string
): string | null {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!normalizedPath || normalizedPath.includes('\0')) return null;
  const normalized: string[] = [];
  for (const segment of [
    ...(baseDirectory ? baseDirectory.split('/') : []),
    ...normalizedPath.split('/'),
  ]) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else normalized.push(segment);
  }
  return normalized.join('/') || null;
}

export function resolveRelativePortableLocator(
  baseDirectory: string,
  specifier: string
): string | null {
  if (classifyModuleSpecifier(specifier) !== 'relative') return null;
  return joinPortableLocatorPath(baseDirectory, specifier);
}

export function extensionOfLocator(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

export function resolveEcmaScriptModuleLocator(input: {
  readonly fromLocator: string;
  readonly specifier: string;
  readonly available: ReadonlySet<string>;
}): string | null {
  if (classifyModuleSpecifier(input.specifier) !== 'relative') return null;
  const candidate = resolveRelativePortableLocator(
    directoryOfLocator(input.fromLocator),
    input.specifier
  );
  if (!candidate) return null;
  if (input.available.has(candidate)) return candidate;
  const runtimeExtension = extensionOfLocator(candidate);
  const rewrites = TYPESCRIPT_RUNTIME_REWRITES[runtimeExtension] ?? [];
  if (rewrites.length > 0) {
    const stem = candidate.slice(0, -runtimeExtension.length);
    for (const rewrite of rewrites) {
      const typescriptSource = `${stem}${rewrite}`;
      if (input.available.has(typescriptSource)) return typescriptSource;
    }
  }
  for (const extension of ['', ...ECMASCRIPT_SOURCE_EXTENSIONS]) {
    const direct = `${candidate}${extension}`;
    if (input.available.has(direct)) return direct;
  }
  for (const extension of ECMASCRIPT_SOURCE_EXTENSIONS) {
    const indexed = `${candidate}/index${extension}`;
    if (input.available.has(indexed)) return indexed;
  }
  return null;
}
