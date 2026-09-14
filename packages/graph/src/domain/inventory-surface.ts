import {
  GRAPH_INVENTORY_POLICY_MATERIAL_BUDGET_KEYS,
  GRAPH_INVENTORY_SURFACE_CONTRACT,
  GRAPH_INVENTORY_SURFACE_LAW,
  type GraphInventorySurfaceClass,
  type GraphInventoryWalkBudgets,
  type GraphInventoryWalkSkipEvidenceKind,
  type GraphOmittedSubtree,
} from '../contracts/inventory-surface.js';

const VCS_DIRECTORIES = new Set<string>(GRAPH_INVENTORY_SURFACE_LAW.vcsMetadataDirectoryMarkers);
const DEPENDENCY_STORES = new Set<string>(
  GRAPH_INVENTORY_SURFACE_LAW.dependencyStoreDirectoryMarkers
);
const ENVIRONMENT_STORES = new Set<string>(
  GRAPH_INVENTORY_SURFACE_LAW.environmentStoreDirectoryMarkers
);
const AMBIGUOUS_OUTPUT = new Set<string>(GRAPH_INVENTORY_SURFACE_LAW.ambiguousOutputDirectoryNames);
const AMBIGUOUS_VENDOR = new Set<string>(GRAPH_INVENTORY_SURFACE_LAW.ambiguousVendorDirectoryNames);

function normalizeSegment(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Portable directory-entry order. `localeCompare` is ICU-dependent and must
 * not decide which entries survive truncation on Linux, macOS, or Windows.
 */
export function comparePortableInventoryNames(left: string, right: string): number {
  const normalizedLeft = left.normalize('NFC');
  const normalizedRight = right.normalize('NFC');
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

/**
 * Classifies a single path segment. Ambiguous output and vendor names stay
 * source. Only VCS metadata and high-confidence dependency/environment stores
 * are non-source without host evidence.
 */
export function classifyInventoryDirectoryName(name: string): GraphInventorySurfaceClass {
  const normalized = normalizeSegment(name);
  if (VCS_DIRECTORIES.has(normalized)) return 'vcs-metadata';
  if (DEPENDENCY_STORES.has(normalized) || ENVIRONMENT_STORES.has(normalized)) return 'vendored';
  if (AMBIGUOUS_OUTPUT.has(normalized) || AMBIGUOUS_VENDOR.has(normalized)) {
    return GRAPH_INVENTORY_SURFACE_LAW.ambiguousDirectoryDefault;
  }
  if (normalized.startsWith('.')) return GRAPH_INVENTORY_SURFACE_LAW.hiddenDirectoryDefault;
  return 'source';
}

export type GraphInventoryWalkSkip = {
  readonly class: GraphInventorySurfaceClass;
  readonly evidenceKind: GraphInventoryWalkSkipEvidenceKind;
  readonly code: string;
};

/**
 * Universal walk-skip decision for a directory basename. Host exclusions of
 * any other name are policy-excluded, not generated.
 */
export function classifyInventoryWalkSkip(name: string): GraphInventoryWalkSkip | undefined {
  const normalized = normalizeSegment(name);
  if (VCS_DIRECTORIES.has(normalized)) {
    return {
      class: 'vcs-metadata',
      evidenceKind: 'universal-vcs-metadata',
      code: 'graph.repository-ignored-directory',
    };
  }
  if (DEPENDENCY_STORES.has(normalized)) {
    return {
      class: 'vendored',
      evidenceKind: 'universal-dependency-store',
      code: 'graph.repository-vendored-directory',
    };
  }
  if (ENVIRONMENT_STORES.has(normalized)) {
    return {
      class: 'vendored',
      evidenceKind: 'universal-environment-store',
      code: 'graph.repository-vendored-directory',
    };
  }
  return undefined;
}

export function inventorySurfaceOmissionCode(name: string): string {
  return (
    classifyInventoryWalkSkip(name)?.code ??
    (classifyInventoryDirectoryName(name) === 'repository-configuration'
      ? 'graph.repository-configuration-directory'
      : 'graph.repository-policy-directory')
  );
}

export function inventorySurfaceExcludedDirectoryNames(): readonly string[] {
  return Object.freeze(
    [
      ...GRAPH_INVENTORY_SURFACE_LAW.vcsMetadataDirectoryMarkers,
      ...GRAPH_INVENTORY_SURFACE_LAW.dependencyStoreDirectoryMarkers,
      ...GRAPH_INVENTORY_SURFACE_LAW.environmentStoreDirectoryMarkers,
    ].sort(comparePortableInventoryNames)
  );
}

export function isPolicyExcludedFileName(name: string): boolean {
  const normalized = normalizeSegment(name);
  if (normalized === '.env' || normalized.startsWith('.env.')) return true;
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials.json'].includes(normalized)) {
    return true;
  }
  return ['.key', '.pem', '.p12', '.pfx'].some((extension) => normalized.endsWith(extension));
}

function normalizeRelativeLocator(locator: string): string {
  return locator
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/')
    .replace(/\/+$/u, '');
}

export type GraphInventorySurfaceClassification = {
  readonly class: GraphInventorySurfaceClass;
  readonly segment?: string;
};

/**
 * Classifies a portable relative locator. Ambiguous directory names never
 * become generated. High-confidence stores and VCS metadata still win over
 * hidden-directory defaults.
 */
export function classifyInventorySurfaceLocator(
  locator: string
): GraphInventorySurfaceClassification {
  const normalized = normalizeRelativeLocator(locator);
  if (!normalized || normalized === '.') return { class: 'source' };
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
  const basename = segments.at(-1) ?? '';
  if (basename && isPolicyExcludedFileName(basename)) {
    return { class: 'policy-excluded', segment: basename };
  }
  for (const segment of segments) {
    const classified = classifyInventoryDirectoryName(segment);
    if (classified === 'vendored' || classified === 'vcs-metadata' || classified === 'ignored') {
      return { class: classified, segment };
    }
  }
  for (const segment of segments) {
    if (classifyInventoryDirectoryName(segment) === 'repository-configuration') {
      return { class: 'repository-configuration', segment };
    }
  }
  return { class: 'source' };
}

export function inventorySurfacePolicyMaterial(input: {
  readonly excludedDirectories: readonly string[];
  readonly evidenceKind: GraphInventoryWalkSkipEvidenceKind;
  readonly budgets: GraphInventoryWalkBudgets;
  readonly sensitiveFiles: 'omit-known';
}): string {
  const excluded = [...input.excludedDirectories]
    .map((name) => name.normalize('NFC'))
    .sort(comparePortableInventoryNames);
  const budgetLines = GRAPH_INVENTORY_POLICY_MATERIAL_BUDGET_KEYS.map(
    (key) => `${key}=${String(input.budgets[key])}`
  );
  return [
    GRAPH_INVENTORY_SURFACE_CONTRACT.id,
    GRAPH_INVENTORY_SURFACE_CONTRACT.version,
    GRAPH_INVENTORY_SURFACE_LAW.policyMaterialKind,
    input.evidenceKind,
    ...budgetLines,
    `sensitiveFiles=${input.sensitiveFiles}`,
    excluded.join('\n'),
  ].join('\0');
}

export type GraphInventoryFileAccounting = 'enumerated' | 'unknown-subtrees';
export type GraphInventoryByteAccounting = 'measured' | 'unknown-subtrees';

export function inventoryOmissionAccounting(omittedSubtrees: readonly GraphOmittedSubtree[]): {
  readonly omittedFileAccounting: GraphInventoryFileAccounting;
  readonly omittedByteAccounting: GraphInventoryByteAccounting;
} {
  const unknownCount = omittedSubtrees.some((subtree) => subtree.count === 'not-enumerated');
  const unknownBytes = omittedSubtrees.some((subtree) => subtree.bytes === 'not-measured');
  return {
    omittedFileAccounting: unknownCount ? 'unknown-subtrees' : 'enumerated',
    omittedByteAccounting: unknownBytes ? 'unknown-subtrees' : 'measured',
  };
}

export function omittedSubtreeComparisonToken(subtree: {
  readonly class: string;
  readonly locator: string;
}): string {
  return `${subtree.locator}\0${subtree.class}`;
}

const BOUNDED_COMPLETE_SURFACE = new Set<GraphInventorySurfaceClass>([
  'vendored',
  'ignored',
  'vcs-metadata',
  'policy-excluded',
  'generated',
  'declared-generated',
  'observed-generated',
  'unsupported',
]);

export function omittedSubtreesPreventCompleteness(
  omittedSubtrees: readonly GraphOmittedSubtree[]
): boolean {
  return omittedSubtrees.some((subtree) => !BOUNDED_COMPLETE_SURFACE.has(subtree.class));
}
