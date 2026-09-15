import { classifyInventoryWalkSkip } from './inventory-surface.js';

export const GRAPH_INVENTORY_OMISSION_CLASSES = Object.freeze([
  'policy-excluded',
  'repository-configuration',
  'ignored',
  'generated',
  'vendored',
  'unsupported',
  'inaccessible',
  'unsafe-path',
  'symlink-policy',
  'binary',
  'size-budget',
  'file-count-budget',
  'time-budget',
  'cancelled',
  'unclassified',
] as const);

export type GraphInventoryOmissionClass = (typeof GRAPH_INVENTORY_OMISSION_CLASSES)[number];

const CODE_TO_CLASS: Readonly<Record<string, GraphInventoryOmissionClass>> = Object.freeze({
  'graph.sensitive-input-omitted': 'policy-excluded',
  'graph.git-indirection-unsupported': 'policy-excluded',
  'graph.repository-symlink-unsupported': 'symlink-policy',
  'graph.repository-special-entry-unsupported': 'unsupported',
  'graph.git-head-special-entry-unsupported': 'unsupported',
  'graph.git-head-size-unsupported': 'size-budget',
  'graph.git-head-unavailable': 'inaccessible',
  'graph.git-head-budget-omitted': 'file-count-budget',
  'graph.repository-file-size-truncated': 'size-budget',
  'graph.repository-budget-truncated': 'file-count-budget',
  'graph.repository-directory-truncated': 'file-count-budget',
  'graph.repository-depth-truncated': 'file-count-budget',
  'graph.unicode-locator-collision': 'unsafe-path',
  GRAPH_FILE_LOCATOR_REJECTED: 'unsafe-path',
  GRAPH_FILE_SIZE_LIMIT_OMITTED: 'size-budget',
  GRAPH_FILE_INVENTORY_CANCELLED: 'cancelled',
  GRAPH_FILE_SPECIAL_ENTRY_OMITTED: 'unsupported',
  'graph.repository-vendored-directory': 'vendored',
  'graph.repository-generated-directory': 'generated',
  'graph.repository-ignored-directory': 'ignored',
  'graph.repository-configuration-directory': 'repository-configuration',
  'graph.repository-policy-directory': 'policy-excluded',
});

const RESOURCE_TRUNCATION = new Set<GraphInventoryOmissionClass>([
  'size-budget',
  'file-count-budget',
  'time-budget',
]);

export function classifyGraphInventoryOmission(code: string): GraphInventoryOmissionClass {
  return CODE_TO_CLASS[code] ?? 'unclassified';
}

const BOUNDED_COMPLETE = new Set<GraphInventoryOmissionClass>([
  'policy-excluded',
  'ignored',
  'generated',
  'vendored',
  'unsupported',
  'symlink-policy',
  'binary',
]);

export function inventoryOmissionIsResourceTruncation(code: string): boolean {
  return RESOURCE_TRUNCATION.has(classifyGraphInventoryOmission(code));
}

/** Policy-bounded omissions may remain complete. Resource/unsafe/unknown omissions may not. */
export function inventoryOmissionPreventsCompleteness(code: string): boolean {
  return !BOUNDED_COMPLETE.has(classifyGraphInventoryOmission(code));
}

export function inventoryCodesPreventCompleteness(codes: readonly string[]): boolean {
  return codes.some((code) => inventoryOmissionPreventsCompleteness(code));
}

export function excludedDirectoryOmissionCode(name: string): string {
  return classifyInventoryWalkSkip(name)?.code ?? 'graph.repository-policy-directory';
}

export function summarizeGraphInventoryOmissions(codes: readonly string[]): readonly {
  readonly class: GraphInventoryOmissionClass;
  readonly count: number;
  readonly codes: readonly string[];
}[] {
  const grouped = new Map<GraphInventoryOmissionClass, { count: number; codes: Set<string> }>();
  for (const code of codes) {
    const omissionClass = classifyGraphInventoryOmission(code);
    const current = grouped.get(omissionClass) ?? { count: 0, codes: new Set<string>() };
    current.count += 1;
    current.codes.add(code);
    grouped.set(omissionClass, current);
  }
  return Object.freeze(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([omissionClass, value]) =>
        Object.freeze({
          class: omissionClass,
          count: value.count,
          codes: Object.freeze([...value.codes].sort((left, right) => left.localeCompare(right))),
        })
      )
  );
}
