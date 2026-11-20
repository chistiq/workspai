import fs from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { isInsideProject, scopedProjectPath } from './scoped-project-path.js';

type Mapping = { prefix: string; suffix: string; wildcard: boolean; targets: string[] };

// Local compiler paths only. Package-based extends, dynamic config and external
// targets stay unresolved rather than being attributed to the selected project.
export function createProjectImportAliasResolver(root: string) {
  const project = fs.realpathSync(root);
  const cache = new Map<string, Mapping[]>();
  const toRelative = (absolute: string): string =>
    path.relative(project, absolute).split(path.sep).join('/');

  function at(directory: string): Mapping[] {
    if (!isInsideProject(project, directory)) return [];
    const cached = cache.get(directory);
    if (cached) return cached;
    const filename = ['tsconfig.json', 'jsconfig.json'].find((name) =>
      fs.existsSync(path.join(directory, name))
    );
    if (!filename) {
      const inherited = path.relative(project, directory) ? at(path.dirname(directory)) : [];
      cache.set(directory, inherited);
      return inherited;
    }
    const mappings: Mapping[] = [];
    cache.set(directory, mappings);
    try {
      const config = scopedProjectPath(project, toRelative(path.join(directory, filename)));
      if (!config || fs.statSync(config).size > 512 * 1024) return mappings;
      const errors: ParseError[] = [];
      const raw = parse(fs.readFileSync(config, 'utf8'), errors, { allowTrailingComma: true }) as {
        extends?: unknown;
        compilerOptions?: { baseUrl?: unknown; paths?: unknown };
      } | null;
      const options = raw?.compilerOptions;
      const paths = options?.paths;
      if (errors.length || !paths || typeof paths !== 'object' || Array.isArray(paths))
        return mappings;
      if (options.baseUrl !== undefined && typeof options.baseUrl !== 'string') return mappings;
      if (raw?.extends !== undefined && options.baseUrl === undefined) return mappings;
      const base = path.resolve(path.dirname(config), options.baseUrl ?? '.');
      if (!isInsideProject(project, base)) return mappings;
      const entries = Object.entries(paths);
      if (entries.length > 512) return mappings;
      for (const [key, rawTargets] of entries) {
        const [prefix, suffix = '', extra] = key.split('*');
        if (
          extra !== undefined ||
          !key ||
          key.length > 256 ||
          !Array.isArray(rawTargets) ||
          rawTargets.length > 16
        )
          continue;
        const targets = rawTargets
          .filter(
            (target): target is string =>
              typeof target === 'string' &&
              target.length <= 1024 &&
              !path.isAbsolute(target) &&
              !/[\\:\x00-\x1f]/u.test(target)
          )
          .map((target) => path.resolve(base, target));
        if (targets.length) mappings.push({ prefix, suffix, wildcard: key.includes('*'), targets });
      }
      mappings.sort(
        (a, b) => Number(a.wildcard) - Number(b.wildcard) || b.prefix.length - a.prefix.length
      );
    } catch {
      // A malformed or inaccessible compiler configuration provides no mapping.
    }
    return mappings;
  }

  return (importer: string, specifier: string): string[] => {
    if (
      !/\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/iu.test(importer) ||
      /[\\:\x00-\x1f]/u.test(specifier)
    )
      return [];
    const mapping = at(path.dirname(importer)).find(({ prefix, suffix, wildcard }) =>
      wildcard
        ? specifier.startsWith(prefix) &&
          specifier.endsWith(suffix) &&
          specifier.length >= prefix.length + suffix.length
        : specifier === prefix
    );
    if (!mapping) return [];
    const middle = specifier.slice(mapping.prefix.length, specifier.length - mapping.suffix.length);
    return mapping.targets
      .map((target) => path.resolve(target.replace('*', () => middle)))
      .filter((target) => isInsideProject(project, target));
  };
}
