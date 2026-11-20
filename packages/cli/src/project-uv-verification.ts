import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { PolyglotRuntimeUnit } from './polyglot-lifecycle-plan.js';
import { scopedProjectPath } from './utils/scoped-project-path.js';

type Table = Record<string, unknown>;
type UvCheck = PolyglotRuntimeUnit['stages'][number] & {
  cwd: string;
  ownerManifest: string;
  setup: { executable: string; args: string[] };
  focus?: string;
};

function table(value: unknown): Table | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Table)
    : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.length <= 128 &&
    value.every((item) => typeof item === 'string' && item.length <= 256)
    ? value
    : undefined;
}

// Only admit the portable subset used for literal segments, *, ? and **. An
// unrecognized exclusion must never turn into a positive membership claim.
function portablePatterns(values: string[]): boolean {
  return values.every((value) => {
    const pattern = value.replace(/^\.\//u, '').replace(/\/$/u, '');
    return (
      /^[\p{L}\p{N}_./?* -]+$/u.test(pattern) &&
      pattern
        .split('/')
        .every(
          (segment) =>
            segment &&
            segment !== '.' &&
            segment !== '..' &&
            (!segment.includes('**') || segment === '**')
        )
    );
  });
}

function matchesPattern(relative: string, pattern: string): boolean {
  const segments = relative.split('/');
  let positions = new Set([0]);
  for (const part of pattern.replace(/^\.\//u, '').replace(/\/$/u, '').split('/')) {
    if (part === '**') {
      if (positions.size === 0) return false;
      const first = Math.min(...positions);
      positions = new Set(Array.from({ length: segments.length - first + 1 }, (_, i) => first + i));
      continue;
    }
    // Match one segment with an iterative wildcard matcher and no regex backtracking.
    function matchSegment(segment: string): boolean {
      let row = new Set([0]);
      for (const character of part) {
        if (row.size === 0) return false;
        if (character === '*') {
          const first = Math.min(...row);
          row = new Set(Array.from({ length: segment.length - first + 1 }, (_, i) => first + i));
        } else {
          row = new Set(
            [...row]
              .filter((i) => i < segment.length && (character === '?' || character === segment[i]))
              .map((i) => i + 1)
          );
        }
      }
      return row.has(segment.length);
    }
    positions = new Set(
      [...positions]
        .filter((i) => i < segments.length && matchSegment(segments[i]))
        .map((i) => i + 1)
    );
  }
  return positions.has(segments.length);
}

const join = (root: string, filename: string): string => path.posix.join(root, filename);

export function createUvVerificationResolver(projectRoot: string) {
  const cache = new Map<string, Table | null>();
  function manifestAt(root: string): Table | null {
    if (cache.has(root)) return cache.get(root) ?? null;
    let manifest: Table | null = null;
    try {
      const file = scopedProjectPath(projectRoot, join(root, 'pyproject.toml'));
      if (file) {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.size <= 512 * 1024)
          manifest = parse(fs.readFileSync(file, 'utf8'));
      }
    } catch {
      // Invalid or inaccessible configuration supplies no ownership evidence.
    }
    cache.set(root, manifest);
    return manifest;
  }

  function hasFile(relative: string): boolean {
    try {
      const file = scopedProjectPath(projectRoot, relative);
      return Boolean(file && fs.statSync(file, { throwIfNoEntry: false })?.isFile());
    } catch {
      return false;
    }
  }

  function resolveOwner(unit: PolyglotRuntimeUnit) {
    for (let root = unit.root; ; root = path.posix.dirname(root)) {
      const manifest = manifestAt(root);
      const tool = table(manifest?.tool);
      const uv = table(tool?.uv);
      const workspace = table(uv?.workspace);
      const locked = hasFile(join(root, 'uv.lock'));
      if (manifest && (workspace || locked)) {
        if (root === unit.root) return { root, manifest, tool, workspace, locked };
        if (workspace) {
          const members = strings(workspace.members);
          const exclude = strings(workspace.exclude ?? []);
          const relative = path.posix.relative(root, unit.root);
          if (
            !members ||
            !exclude ||
            !portablePatterns([...members, ...exclude]) ||
            !members.some((pattern) => matchesPattern(relative, pattern)) ||
            exclude.some((pattern) => matchesPattern(relative, pattern))
          )
            return undefined;
          return { root, manifest, tool, workspace, locked };
        }
      }
      if (root === '.') return undefined;
    }
  }

  return (
    unit: PolyglotRuntimeUnit,
    selectedPath: string | null
  ): { test?: UvCheck } | undefined => {
    const owner = resolveOwner(unit);
    if (!owner) return undefined;
    if (!owner.locked) return {};
    const dependencies = table(owner.manifest['dependency-groups']);
    const defaultGroups = table(owner.tool?.uv)?.['default-groups'] ?? ['dev'];
    const groups =
      defaultGroups === 'all' ? Object.keys(dependencies ?? {}) : (strings(defaultGroups) ?? []);
    const requirements = groups.flatMap((group) => strings(dependencies?.[group]) ?? []);
    const has = (name: string) =>
      requirements.some((value) => value.match(/^[\w.-]+/u)?.[0]?.toLowerCase() === name);
    if (!has('pytest') && !table(owner.tool?.pytest)) return {};
    const testPath = selectedPath && path.posix.relative(owner.root, selectedPath);
    const isTestFile =
      testPath &&
      /^(?:[^/]+\/)*(?:test_[^/]+|[^/]+_test)\.py$/u.test(testPath) &&
      hasFile(selectedPath ?? '');
    const tasks = table(table(owner.tool?.poe)?.tasks);
    const task =
      has('poethepoet') &&
      ['test_unit', 'test-unit', 'unit-tests', 'test'].find((name) => {
        const definition = tasks?.[name];
        return typeof definition === 'string' && /^pytest(?:\s|$)/u.test(definition.trim());
      });
    if (!isTestFile && !task && !scopedProjectPath(projectRoot, join(owner.root, 'tests')))
      return {};
    const args = [
      'run',
      '--no-sync',
      ...(isTestFile ? ['pytest', `./${testPath}`] : task ? ['poe', task] : ['pytest']),
    ];
    // argv is authoritative. The preview is for display, never passed to a shell.
    return {
      test: {
        stage: 'test',
        command: ['uv', ...args]
          .map((token) => (/\s/u.test(token) ? JSON.stringify(token) : token))
          .join(' '),
        confidence: 'high',
        preflight: 'executable-and-inputs',
        argvSequence: [{ executable: 'uv', args }],
        cwd: owner.root,
        ownerManifest: join(owner.root, 'pyproject.toml'),
        ...(isTestFile && selectedPath ? { focus: selectedPath } : {}),
        setup: {
          executable: 'uv',
          args: ['sync', '--locked', ...(owner.workspace ? ['--all-packages'] : [])],
        },
      },
    };
  };
}
