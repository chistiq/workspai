import path from 'path';

import { buildPolyglotLifecyclePlan, type PolyglotRuntimeUnit } from './polyglot-lifecycle-plan.js';

export const PROJECT_LIFECYCLE_CONTEXT_SCHEMA_VERSION =
  'workspai.project-lifecycle-context.v1' as const;
export const DEFAULT_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES = 8 * 1024;
export const MAX_PROJECT_LIFECYCLE_CONTEXT_MAX_BYTES = 64 * 1024;

type LifecycleUnit = Pick<
  PolyglotRuntimeUnit,
  'id' | 'runtime' | 'ecosystem' | 'role' | 'root' | 'manifest'
> & {
  provenance: 'manifest-derived';
  stages: PolyglotRuntimeUnit['stages'];
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

export function buildProjectLifecycleContext(
  projectPath: string,
  options: { path?: string; maxBytes?: string | number } = {}
): ProjectLifecycleContext | ProjectLifecycleContextFailure {
  const selectedPath = normalizeRelativeSelection(options.path);
  const mode = selectedPath === null ? 'all-units' : 'closest-unit';
  const selection = { path: selectedPath, mode } as const;
  const maxBytes = projectLifecycleContextByteBudget(options.maxBytes);
  // Execution plans suppress members owned by a workspace runner to avoid
  // duplicate runs. A targeted read must still discover the closest package.
  const plan = buildPolyglotLifecyclePlan(projectPath, {
    includeWorkspaceMembers: selectedPath !== null,
  });
  const selected = selectUnits(plan.units, selectedPath);
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
  const units: LifecycleUnit[] = selected.map((unit) => ({
    id: unit.id,
    runtime: unit.runtime,
    ecosystem: unit.ecosystem,
    role: unit.role,
    root: unit.root,
    manifest: unit.manifest,
    provenance: 'manifest-derived',
    stages: unit.stages,
    ...(unit.workspaceOwner ? { workspaceOwner: unit.workspaceOwner } : {}),
  }));
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
