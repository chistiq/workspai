import {
  GRAPH_UNKNOWN_CAUSE_LAW,
  GRAPH_UNKNOWN_CAUSES,
  type GraphUnknownCause,
} from '../contracts/semantic-parity.js';
import type {
  GraphUnknownBound,
  GraphUnknownCompleteness,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../contracts/foundation.js';
import {
  classifyGraphInventoryOmission,
  type GraphInventoryOmissionClass,
} from './inventory-omissions.js';

export function graphUnknownDiagnosticCode(code: string): string {
  const trimmed = code.normalize('NFC').trim();
  const scoped = trimmed.indexOf('@');
  return scoped >= 0 ? trimmed.slice(0, scoped) : trimmed;
}

function causeFromOmission(omission: GraphInventoryOmissionClass): GraphUnknownCause | undefined {
  switch (omission) {
    case 'policy-excluded':
    case 'repository-configuration':
    case 'ignored':
    case 'symlink-policy':
    case 'binary':
      return 'inventory-policy';
    case 'generated':
    case 'vendored':
      return 'generated-or-vendor-policy';
    case 'unsupported':
      return 'unsupported-syntax';
    case 'size-budget':
    case 'file-count-budget':
    case 'time-budget':
    case 'cancelled':
      return 'resource-bound';
    case 'inaccessible':
      return 'parser-limitation';
    case 'unsafe-path':
    case 'unclassified':
      return undefined;
  }
}

function isUnknownCause(value: string | undefined): value is GraphUnknownCause {
  return value !== undefined && (GRAPH_UNKNOWN_CAUSES as readonly string[]).includes(value);
}

/**
 * Classifies an unknown/unsupported diagnostic by general cause.
 * Structured `cause` on the observation is preferred. Diagnostic-code
 * substrings remain a backwards-compatible fallback only. Unclassified
 * and unmapped-legacy-coverage stay admission-blocking.
 */
export function classifyGraphUnknownCause(code: string): GraphUnknownCause {
  const diagnostic = graphUnknownDiagnosticCode(code);
  const lowered = diagnostic.toLowerCase();
  if (lowered.startsWith('legacy.binding-coverage')) return 'unmapped-legacy-coverage';
  const fromOmission = causeFromOmission(classifyGraphInventoryOmission(diagnostic));
  if (fromOmission) return fromOmission;
  if (lowered.includes('unsupported') || lowered.includes('-dynamic')) return 'unsupported-syntax';
  if (
    lowered.includes('truncated') ||
    lowered.includes('budget') ||
    lowered.includes('size-limit') ||
    lowered.includes('cancelled')
  ) {
    return 'resource-bound';
  }
  if (lowered.includes('vendored') || lowered.includes('generated-directory')) {
    return 'generated-or-vendor-policy';
  }
  if (
    lowered.includes('ambiguous') ||
    lowered.includes('unreadable') ||
    lowered.includes('unresolved') ||
    lowered.includes('invalid') ||
    lowered.includes('undeclared') ||
    lowered.includes('unknown')
  ) {
    return 'parser-limitation';
  }
  return 'unclassified';
}

export function completenessForUnknownCause(cause: GraphUnknownCause): GraphUnknownCompleteness {
  switch (cause) {
    case 'unsupported-syntax':
      return 'unsupported';
    case 'inventory-policy':
    case 'generated-or-vendor-policy':
      return 'bounded';
    case 'parser-limitation':
    case 'resource-bound':
    case 'unmapped-legacy-coverage':
    case 'unclassified':
      return 'partial';
  }
}

export function boundForUnknownCause(cause: GraphUnknownCause): GraphUnknownBound {
  switch (cause) {
    case 'inventory-policy':
    case 'generated-or-vendor-policy':
      return 'policy-bounded';
    case 'unsupported-syntax':
      return 'unsupported';
    case 'parser-limitation':
      return 'partial';
    case 'resource-bound':
      return 'resource-limited';
    case 'unmapped-legacy-coverage':
    case 'unclassified':
      return 'failed';
  }
}

export function severityForUnknownCause(cause: GraphUnknownCause): 'info' | 'warning' | 'error' {
  switch (cause) {
    case 'inventory-policy':
    case 'generated-or-vendor-policy':
      return 'info';
    case 'unsupported-syntax':
    case 'parser-limitation':
    case 'resource-bound':
      return 'warning';
    case 'unmapped-legacy-coverage':
    case 'unclassified':
      return 'error';
  }
}

export type GraphUnknownObservationInput = {
  readonly code: string;
  readonly scope: string;
  readonly reason: string;
  readonly cause?: GraphUnknownCause;
  readonly stage?: string;
  readonly provider?: string;
  readonly language?: string;
  readonly evidence?: readonly string[];
  readonly classificationOrigin?: (typeof GRAPH_UNKNOWN_CAUSE_LAW.classificationOrigins)[number];
};

export function structurizeUnknownZone(
  zone: GraphUnknownZone | GraphUnsupportedZone | GraphUnknownObservationInput,
  context: {
    readonly provider?: string;
    readonly stage?: string;
    readonly language?: string;
  } = {}
): GraphUnknownZone {
  const structuredCause = isUnknownCause(zone.cause);
  const cause = structuredCause ? zone.cause : classifyGraphUnknownCause(zone.code);
  const language = zone.language ?? context.language;
  const evidence = 'evidence' in zone ? zone.evidence : undefined;
  const classificationOrigin =
    zone.classificationOrigin ?? (structuredCause ? 'structured-producer' : 'legacy-fallback');
  return Object.freeze({
    code: zone.code,
    scope: zone.scope,
    reason: zone.reason,
    cause,
    stage: zone.stage ?? context.stage ?? 'unspecified',
    provider: zone.provider ?? context.provider ?? 'unspecified',
    ...(language ? { language } : {}),
    completeness: completenessForUnknownCause(cause),
    bound: boundForUnknownCause(cause),
    severity: severityForUnknownCause(cause),
    admissionImpact: GRAPH_UNKNOWN_CAUSE_LAW.admissionImpact,
    classificationOrigin,
    ...(evidence && evidence.length > 0 ? { evidence: Object.freeze([...evidence]) } : {}),
  });
}

export function graphUnknownObservation(input: GraphUnknownObservationInput): GraphUnknownZone {
  return structurizeUnknownZone(input);
}

export function graphUnsupportedObservation(
  input: GraphUnknownObservationInput
): GraphUnsupportedZone {
  return structurizeUnknownZone(input);
}

export function summarizeGraphUnknownCauses(codes: readonly string[]): readonly {
  readonly cause: GraphUnknownCause;
  readonly disposition: typeof GRAPH_UNKNOWN_CAUSE_LAW.disposition;
  readonly admissionImpact: typeof GRAPH_UNKNOWN_CAUSE_LAW.admissionImpact;
  readonly count: number;
  readonly codes: readonly string[];
}[] {
  const grouped = new Map<GraphUnknownCause, { count: number; codes: Set<string> }>();
  for (const code of codes) {
    const cause = classifyGraphUnknownCause(code);
    const current = grouped.get(cause) ?? { count: 0, codes: new Set<string>() };
    current.count += 1;
    current.codes.add(code);
    grouped.set(cause, current);
  }
  return Object.freeze(
    GRAPH_UNKNOWN_CAUSE_LAW.causes.flatMap((cause) => {
      const value = grouped.get(cause);
      if (!value) return [];
      return [
        Object.freeze({
          cause,
          disposition: GRAPH_UNKNOWN_CAUSE_LAW.disposition,
          admissionImpact: GRAPH_UNKNOWN_CAUSE_LAW.admissionImpact,
          count: value.count,
          codes: Object.freeze([...value.codes].sort((left, right) => left.localeCompare(right))),
        }),
      ];
    })
  );
}
