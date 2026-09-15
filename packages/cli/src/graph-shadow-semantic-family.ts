import {
  GRAPH_COMPARABLE_SURFACE,
  GRAPH_UNKNOWN_CAUSE,
  type GraphUnknownCause,
} from './graph-package-runtime.js';

import { unknownCauseFromComparisonKey } from './graph-shadow-unknown-contract.js';

export const GRAPH_SHADOW_SEMANTIC_FAMILIES = Object.freeze([
  'node',
  'relation',
  'proof',
  'generated-artifact',
  'unknown-zone',
  'omitted-subtree',
  'diagnostic',
  'identity',
  'completeness',
  'binding',
] as const);

export type GraphShadowSemanticFamily = (typeof GRAPH_SHADOW_SEMANTIC_FAMILIES)[number];

type ShadowDifferenceLike = {
  readonly code: string;
  readonly key?: string;
  readonly legacy?: unknown;
  readonly package?: unknown;
};

function setCount(value: unknown): number {
  if (value && typeof value === 'object' && 'count' in value) {
    const count = (value as { count: unknown }).count;
    return typeof count === 'number' ? count : 0;
  }
  return 0;
}

/**
 * General semantic-parity families. Codes are classified by contract prefix,
 * not by repository name or layout.
 */
export function classifyGraphShadowSemanticFamily(code: string): GraphShadowSemanticFamily {
  if (code === 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL') return 'generated-artifact';
  if (code.startsWith('GRAPH_SHADOW_OMITTED_SUBTREE_')) return 'omitted-subtree';
  if (code.startsWith('GRAPH_SHADOW_NODE_')) return 'node';
  if (code.startsWith('GRAPH_SHADOW_RELATION_')) return 'relation';
  if (code.startsWith('GRAPH_SHADOW_PROOF_')) return 'proof';
  if (code.startsWith('GRAPH_SHADOW_UNKNOWN_')) return 'unknown-zone';
  if (code.startsWith('GRAPH_SHADOW_DIAGNOSTIC_')) return 'diagnostic';
  if (code.startsWith('GRAPH_SHADOW_UNSAFE_') || code.startsWith('GRAPH_SHADOW_IDENTITY_')) {
    return 'identity';
  }
  if (code.startsWith('GRAPH_SHADOW_COMPLETENESS_')) return 'completeness';
  return 'binding';
}

export function summarizeGraphShadowSemanticFamilies(
  differences: readonly { readonly code: string }[]
): Readonly<Record<GraphShadowSemanticFamily, number>> {
  const counts = Object.fromEntries(
    GRAPH_SHADOW_SEMANTIC_FAMILIES.map((family) => [family, 0])
  ) as Record<GraphShadowSemanticFamily, number>;
  for (const difference of differences) {
    counts[classifyGraphShadowSemanticFamily(difference.code)] += 1;
  }
  return Object.freeze(counts);
}

/**
 * Item counts by general unknown cause. Grouping leftovers for summary must
 * not change leftover identity, severity, or regression count. Disposition
 * bounded-unknown is observability only; unclassified and
 * unmapped-legacy-coverage remain admission-blocking.
 */
export function summarizeGraphShadowUnknownCauses(
  differences: readonly ShadowDifferenceLike[]
): Readonly<Record<GraphUnknownCause, number>> {
  const counts = Object.fromEntries(
    GRAPH_UNKNOWN_CAUSE.causes.map((cause) => [cause, 0])
  ) as Record<GraphUnknownCause, number>;
  for (const difference of differences) {
    if (difference.code === 'GRAPH_SHADOW_UNKNOWN_FAMILY_UNMAPPED') {
      counts['unmapped-legacy-coverage'] +=
        setCount(difference.legacy) + setCount(difference.package);
      continue;
    }
    if (!difference.code.startsWith('GRAPH_SHADOW_UNKNOWN_')) continue;
    counts[unknownCauseFromComparisonKey(difference.key ?? '')] +=
      setCount(difference.legacy) + setCount(difference.package);
  }
  return Object.freeze(counts);
}

export type GraphShadowStructuralDeltaSummary = {
  readonly inCorpus: number;
  readonly outsideCorpus: number;
  readonly rawCount: number;
  readonly semanticKindCount: number;
  readonly differenceEntries: number;
  readonly kinds: readonly {
    readonly kind: string;
    readonly membership: 'in-corpus' | 'outside-corpus';
    readonly count: number;
  }[];
};

function summarizeStructural(
  differences: readonly ShadowDifferenceLike[],
  prefix: 'GRAPH_SHADOW_NODE_' | 'GRAPH_SHADOW_RELATION_'
): GraphShadowStructuralDeltaSummary {
  const classify =
    prefix === 'GRAPH_SHADOW_NODE_'
      ? GRAPH_COMPARABLE_SURFACE.classifyKind
      : GRAPH_COMPARABLE_SURFACE.classifyRelation;
  const grouped = new Map<string, { membership: 'in-corpus' | 'outside-corpus'; count: number }>();
  let differenceEntries = 0;
  for (const difference of differences) {
    if (!difference.code.startsWith(prefix) || !difference.key) continue;
    differenceEntries += 1;
    const classified = classify(difference.key);
    const current = grouped.get(classified.kind) ?? {
      membership: classified.membership,
      count: 0,
    };
    current.count += setCount(difference.legacy) + setCount(difference.package);
    grouped.set(classified.kind, current);
  }
  const kinds = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, value]) =>
      Object.freeze({
        kind,
        membership: value.membership,
        count: value.count,
      })
    );
  const inCorpus = kinds
    .filter((item) => item.membership === 'in-corpus')
    .reduce((sum, item) => sum + item.count, 0);
  const outsideCorpus = kinds
    .filter((item) => item.membership === 'outside-corpus')
    .reduce((sum, item) => sum + item.count, 0);
  return Object.freeze({
    inCorpus,
    outsideCorpus,
    rawCount: inCorpus + outsideCorpus,
    semanticKindCount: kinds.length,
    differenceEntries,
    kinds: Object.freeze(kinds),
  });
}

/**
 * Node and relation leftovers classified against the shared comparable-surface
 * corpus so the difference is semantic membership, not a raw node count.
 */
export function summarizeGraphShadowStructuralDeltas(
  differences: readonly ShadowDifferenceLike[]
): {
  readonly node: GraphShadowStructuralDeltaSummary;
  readonly relation: GraphShadowStructuralDeltaSummary;
} {
  return Object.freeze({
    node: summarizeStructural(differences, 'GRAPH_SHADOW_NODE_'),
    relation: summarizeStructural(differences, 'GRAPH_SHADOW_RELATION_'),
  });
}
