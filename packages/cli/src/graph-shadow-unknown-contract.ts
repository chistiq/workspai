import { GRAPH_UNKNOWN_CAUSE, type GraphUnknownCause } from './graph-package-runtime.js';

export const GRAPH_SHADOW_UNKNOWN_CONTRACT_VERSION =
  'workspai.graph-shadow-unknown-contract.v1' as const;

export type GraphShadowUnknownFamily =
  | 'package-unresolved'
  | 'package-unknown-zone'
  | 'package-unsupported-zone'
  | 'legacy-diagnostic-unknown'
  | 'legacy-binding-coverage';

export interface GraphShadowUnknownItem {
  readonly family: GraphShadowUnknownFamily;
  readonly code: string;
}

const LEGACY_DIAGNOSTIC_UNKNOWN = /(?:unknown|unresolved|limit_reached|empty_result)$/u;

export function projectLegacyUnknownItems(input: {
  readonly unknownCount: number;
  readonly diagnostics: readonly { readonly code: string }[];
}): readonly GraphShadowUnknownItem[] {
  const diagnosticItems = input.diagnostics
    .filter((diagnostic) => LEGACY_DIAGNOSTIC_UNKNOWN.test(diagnostic.code))
    .map((diagnostic) => ({
      family: 'legacy-diagnostic-unknown' as const,
      code: diagnostic.code,
    }));
  const mappedDiagnosticCount = diagnosticItems.length;
  const unmapped = Math.max(0, input.unknownCount - mappedDiagnosticCount);
  const bindingItems = Array.from({ length: unmapped }, (_, index) => ({
    family: 'legacy-binding-coverage' as const,
    code: `legacy.binding-coverage.${index + 1}`,
  }));
  return [...diagnosticItems, ...bindingItems];
}

function unresolvedCode(item: unknown, index: number): string {
  if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') {
    return item.id;
  }
  if (
    typeof item === 'object' &&
    item !== null &&
    'code' in item &&
    typeof item.code === 'string'
  ) {
    return item.code;
  }
  return `GRAPH_UNRESOLVED.${String(index + 1)}`;
}

function zoneCode(zone: { readonly code: string; readonly scope?: string }): string {
  return zone.scope ? `${zone.code}@${zone.scope}` : zone.code;
}

export function projectPackageUnknownItems(input: {
  readonly unresolved: readonly unknown[];
  readonly unknownZones: readonly { readonly code: string; readonly scope?: string }[];
  readonly unsupportedZones: readonly { readonly code: string; readonly scope?: string }[];
}): readonly GraphShadowUnknownItem[] {
  return [
    ...input.unresolved.map((item, index) => ({
      family: 'package-unresolved' as const,
      code: unresolvedCode(item, index),
    })),
    ...input.unknownZones.map((zone) => ({
      family: 'package-unknown-zone' as const,
      code: zoneCode(zone),
    })),
    ...input.unsupportedZones.map((zone) => ({
      family: 'package-unsupported-zone' as const,
      code: zoneCode(zone),
    })),
  ];
}

export function unknownItemKey(item: GraphShadowUnknownItem): string {
  return `${item.family}\0${item.code}`;
}

export function unknownComparisonToken(item: GraphShadowUnknownItem): string {
  const identity = `${item.family}::${item.code}`;
  return `${identity}\0${identity}`;
}

export function unknownCauseFromComparisonKey(key: string): GraphUnknownCause {
  if (key === 'legacy-binding-coverage') return 'unmapped-legacy-coverage';
  const causes = GRAPH_UNKNOWN_CAUSE.causes as readonly GraphUnknownCause[];
  if (causes.includes(key as GraphUnknownCause)) return key as GraphUnknownCause;
  const separator = key.indexOf('::');
  const code = separator >= 0 ? key.slice(separator + 2) : key;
  return GRAPH_UNKNOWN_CAUSE.classify(code);
}
