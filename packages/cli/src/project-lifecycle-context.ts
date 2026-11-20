import fs from 'node:fs';
import path from 'path';

import { buildPolyglotLifecyclePlan, type PolyglotRuntimeUnit } from './polyglot-lifecycle-plan.js';
import { scopedProjectPath } from './utils/scoped-project-path.js';
import { createUvVerificationResolver } from './project-uv-verification.js';
import { detectNodePackageManager } from './utils/node-package-manager.js';

export const PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION =
  'workspai.project-lifecycle-context.v1' as const;
export const DEFAULT_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES = 8 * 1024;
export const MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES = 64 * 1024;

type LifecycleUnit = Pick<
  PolyglotRuntimeUnit,
  'id' | 'runtime' | 'ecosystem' | 'role' | 'root' | 'manifest'
> & {
  provenance: 'manifest-derived';
  stages: Array<
    PolyglotRuntimeUnit['stages'][number] & {
      cwd: string;
      ownerManifest?: string;
      setup?: { executable: string; args: string[] };
      focus?: string;
    }
  >;
  workspaceOwner?: PolyglotRuntimeUnit['workspaceOwner'];
};

export type ProjectLifecycleContext = {
  schemaVersion: typeof PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION;
  status: 'ready' | 'no-lifecycle-units';
  project: '.';
  selection: { path: string | null; mode: 'all-units' | 'closest-unit' };
  units: LifecycleUnit[];
  omittedUnits: 0;
  budget: { maxBytes: number; usedBytes: number; accounting: 'utf8-json-with-newline' };
};

export type ProjectLifecycleContextFailure = {
  schemaVersion: typeof PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION;
  status: 'insufficient-budget' | 'path-not-mapped';
  project: '.';
  selection: { path: string | null; mode: 'all-units' | 'closest-unit' };
  budget?: { maxBytes: number; requiredBytes: number; accounting: 'utf8-json-with-newline' };
  message: string;
  nextActions: string[];
};

export function projectLifecycleContextByteBudget(value?: string | number): number {
  if (value === undefined) return DEFAULT_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES;
  if (typeof value === 'string' && !/^\d+$/u.test(value)) {
    throw new Error('--max-bytes must be an integer.');
  }
  const bytes = Number(value);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1024 ||
    bytes > MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES
  ) {
    throw new Error(
      `--max-bytes must be between 1024 and ${MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES}.`
    );
  }
  return bytes;
}

function normalizeRelativeSelection(value?: string): string | null {
  if (value === undefined) return null;
  if (!value.trim() || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value)) {
    throw new Error('--path must be a non-empty project-relative path.');
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error('--path must not escape the project or contain empty path segments.');
  }
  return segments.filter((segment) => segment !== '.').join('/') || '.';
}

function selectUnits(
  units: PolyglotRuntimeUnit[],
  selectedPath: string | null
): PolyglotRuntimeUnit[] {
  if (selectedPath === null) return units;
  const candidates = units.filter((unit) => {
    const root = unit.root === '.' ? '' : unit.root;
    return (
      selectedPath === unit.manifest ||
      selectedPath === unit.root ||
      root === '' ||
      selectedPath.startsWith(`${root}/`)
    );
  });
  if (candidates.length === 0) return [];
  const closestRootLength = Math.max(...candidates.map((unit) => unit.root.length));
  return candidates.filter((unit) => unit.root.length === closestRootLength);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8');
}

/** Prefer a named authored check for an explicitly selected test file. */
function focusedNodeCheck(
  root: string,
  unit: PolyglotRuntimeUnit,
  selected: string | null
): LifecycleUnit['stages'][number] | undefined {
  if (!selected || !/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(selected)) return undefined;
  const relative = path.posix.relative(unit.root, selected);
  const manifest = scopedProjectPath(root, unit.manifest);
  const testFile = scopedProjectPath(root, selected);
  if (!manifest || !testFile) return undefined;
  try {
    if (!fs.statSync(testFile).isFile()) return undefined;
    const document = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const matches = Object.entries(document.scripts ?? {}).filter(([name, script]) => {
      if (!/^test:[A-Za-z0-9_-][A-Za-z0-9:_-]*$/u.test(name) || name.endsWith(':')) return false;
      if (typeof script !== 'string' || !/^(?:(?:node|tsx) --test|vitest run)\s+/u.test(script))
        return false;
      const target = script
        .trim()
        .replace(/^(?:(?:node|tsx) --test|vitest run)\s+/u, '')
        .replace(/^\.\//u, '');
      return target === relative && /^[\p{L}\p{N}_./-]+$/u.test(target);
    });
    if (matches.length !== 1) return undefined;
    const managerRoot = scopedProjectPath(root, unit.workspaceOwner?.root ?? unit.root);
    if (!managerRoot) return undefined;
    const executable = detectNodePackageManager(managerRoot);
    const args = ['run', matches[0][0]];
    return {
      stage: 'test',
      command: [executable, ...args].join(' '),
      confidence: 'high',
      preflight: 'executable-and-inputs',
      argvSequence: [{ executable, args }],
      cwd: unit.root,
      focus: selected,
    };
  } catch {
    return undefined;
  }
}

export function buildProjectLifecycleContext(
  projectPath: string,
  options: {
    path?: string;
    maxBytes?: string | number;
    includeWorkspaceMembers?: boolean;
    requireExistingPath?: boolean;
  } = {}
): ProjectLifecycleContext | ProjectLifecycleContextFailure {
  const selectedPath = normalizeRelativeSelection(options.path);
  const mode = selectedPath === null ? 'all-units' : 'closest-unit';
  const selection = { path: selectedPath, mode } as const;
  const maxBytes = projectLifecycleContextByteBudget(options.maxBytes);
  const verifiedPath =
    options.requireExistingPath && selectedPath !== null
      ? scopedProjectPath(projectPath, selectedPath)
      : undefined;
  if (options.requireExistingPath && !verifiedPath) {
    return {
      schemaVersion: PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION,
      status: 'path-not-mapped',
      project: '.',
      selection,
      message: 'The selected path is missing or outside the bound project.',
      nextActions: [
        'Use an absolute verified --project root and an existing path within that project.',
      ],
    };
  }
  // Execution plans suppress members owned by a workspace runner to avoid
  // duplicate runs. A targeted read must still discover the closest package.
  const plan = buildPolyglotLifecyclePlan(projectPath, {
    includeWorkspaceMembers: selectedPath !== null || options.includeWorkspaceMembers === true,
  });
  const effectivePath = verifiedPath
    ? path.relative(fs.realpathSync(projectPath), verifiedPath).split(path.sep).join('/') || '.'
    : selectedPath;
  const selected = selectUnits(plan.units, effectivePath).filter(
    (unit) =>
      !options.requireExistingPath ||
      (scopedProjectPath(projectPath, unit.manifest) &&
        (!unit.workspaceOwner || scopedProjectPath(projectPath, unit.workspaceOwner.manifest)))
  );
  if (selectedPath !== null && selected.length === 0) {
    return {
      schemaVersion: PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION,
      status: 'path-not-mapped',
      project: '.',
      selection,
      message:
        'The selected path does not map to a discovered runtime unit; no lifecycle command was inferred.',
      nextActions: [
        'Use a path inside a discovered package, select its manifest, or omit --path to inspect all discovered units.',
      ],
    };
  }
  const scoped = options.requireExistingPath || options.includeWorkspaceMembers;
  const resolveUv = scoped ? createUvVerificationResolver(projectPath) : undefined;
  const units: LifecycleUnit[] = selected.map((unit) => {
    const uv = unit.runtime === 'python' ? resolveUv?.(unit, effectivePath) : undefined;
    const focused =
      scoped && (unit.runtime === 'node' || unit.runtime === 'bun')
        ? focusedNodeCheck(projectPath, unit, effectivePath)
        : undefined;
    const scopedTest = uv?.test ?? focused;
    const stages = unit.stages
      .filter((stage) =>
        stage.stage === 'init' ? !uv : stage.stage === 'test' ? !uv && !focused : true
      )
      .map((stage) => ({ ...stage, cwd: unit.root }));
    return {
      id: unit.id,
      runtime: unit.runtime,
      ecosystem: unit.ecosystem,
      role: unit.role,
      root: unit.root,
      manifest: unit.manifest,
      provenance: 'manifest-derived',
      stages: scopedTest ? [...stages, scopedTest] : stages,
      ...(unit.workspaceOwner ? { workspaceOwner: unit.workspaceOwner } : {}),
    };
  });
  const context: ProjectLifecycleContext = {
    schemaVersion: PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION,
    status: units.length > 0 ? 'ready' : 'no-lifecycle-units',
    project: '.',
    selection,
    units,
    omittedUnits: 0,
    budget: { maxBytes, usedBytes: 0, accounting: 'utf8-json-with-newline' },
  };
  do {
    const previous = context.budget.usedBytes;
    context.budget.usedBytes = byteLength(context);
    if (context.budget.usedBytes === previous) break;
  } while (true);
  if (context.budget.usedBytes > maxBytes) {
    let requiredBytes = context.budget.usedBytes;
    while (true) {
      const previous = requiredBytes;
      requiredBytes =
        context.budget.usedBytes + String(requiredBytes).length - String(maxBytes).length;
      if (requiredBytes === previous) break;
    }
    return {
      schemaVersion: PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION,
      status: 'insufficient-budget',
      project: '.',
      selection,
      budget: { maxBytes, requiredBytes, accounting: 'utf8-json-with-newline' },
      message: 'The selected lifecycle evidence does not fit; no partial command plan was emitted.',
      nextActions: [
        requiredBytes <= MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES
          ? `Increase --max-bytes to at least ${requiredBytes}, or select a package path with --path.`
          : 'Select a package path with --path; the complete project lifecycle plan exceeds the maximum output budget.',
      ],
    };
  }
  return context;
}
