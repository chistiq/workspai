export const GRAPH_FACT_CLASS_QUALITY_SCHEMA = 'workspai.graph.fact-class-quality.v1' as const;

export const GRAPH_FACT_CLASSES = [
  'files',
  'projects',
  'declarations',
  'exports',
  'imports',
  'calls',
  'inheritance',
  'routes',
  'handlers',
  'configuration',
  'deployment',
  'tests',
  'generated-bindings',
  'dependencies',
] as const;

export type GraphFactClass = (typeof GRAPH_FACT_CLASSES)[number];

export const GRAPH_FACT_CLASS_DIFFERENCE_KINDS = [
  'package-regression',
  'package-improvement',
  'legacy-false-positive',
  'legacy-false-negative',
  'incomparable',
  'approved-semantic-difference',
] as const;

export type GraphFactClassDifferenceKind = (typeof GRAPH_FACT_CLASS_DIFFERENCE_KINDS)[number];

export interface GraphFactClassKeySet {
  readonly keys: readonly string[];
  readonly unsupportedKeys?: readonly string[];
  readonly ambiguousKeys?: readonly string[];
  readonly truncatedKeys?: readonly string[];
  readonly generatedExcludedKeys?: readonly string[];
  readonly evidenceFailureKeys?: readonly string[];
}

export interface GraphFactClassApproval {
  readonly factClass: GraphFactClass;
  readonly key: string;
  readonly kind: 'approved-semantic-difference';
  readonly reason: string;
}

export interface GraphFactClassQualityRequest {
  readonly expected: Readonly<Partial<Record<GraphFactClass, GraphFactClassKeySet>>>;
  readonly packageFull: Readonly<Partial<Record<GraphFactClass, GraphFactClassKeySet>>>;
  readonly packageIncremental?: Readonly<Partial<Record<GraphFactClass, GraphFactClassKeySet>>>;
  readonly legacy?: Readonly<Partial<Record<GraphFactClass, GraphFactClassKeySet>>>;
  /**
   * Per-key approvals only. A missing key, empty reason, or class-wide
   * suppression is rejected so repository-wide bulk approvals cannot hide
   * regressions.
   */
  readonly approvals?: readonly GraphFactClassApproval[];
}

export interface GraphFactClassMetrics {
  readonly factClass: GraphFactClass;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly unsupported: number;
  readonly ambiguous: number;
  readonly truncated: number;
  readonly generatedExcluded: number;
  readonly evidenceFailures: number;
  readonly packageFullKeys: readonly string[];
  readonly packageIncrementalKeys?: readonly string[];
  readonly legacyKeys?: readonly string[];
  readonly expectedKeys: readonly string[];
  readonly differences: readonly {
    readonly key: string;
    readonly kind: GraphFactClassDifferenceKind;
  }[];
}

export interface GraphFactClassQualityReport {
  readonly schema: typeof GRAPH_FACT_CLASS_QUALITY_SCHEMA;
  readonly publicAccuracyClaimPermitted: false;
  readonly classes: readonly GraphFactClassMetrics[];
  readonly failures: readonly string[];
}

function freezeSorted(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(values ?? [])].sort((left, right) => left.localeCompare(right)));
}

function unique(values: readonly string[]): readonly string[] {
  return freezeSorted([...new Set(values)]);
}

function ratio(matched: number, total: number): number {
  return total === 0 ? 0 : matched / total;
}

function f1Score(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function asSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

function observation(set: GraphFactClassKeySet | undefined): {
  readonly keys: readonly string[];
  readonly unsupported: readonly string[];
  readonly ambiguous: readonly string[];
  readonly truncated: readonly string[];
  readonly generatedExcluded: readonly string[];
  readonly evidenceFailures: readonly string[];
} {
  return {
    keys: unique(set?.keys ?? []),
    unsupported: unique(set?.unsupportedKeys ?? []),
    ambiguous: unique(set?.ambiguousKeys ?? []),
    truncated: unique(set?.truncatedKeys ?? []),
    generatedExcluded: unique(set?.generatedExcludedKeys ?? []),
    evidenceFailures: unique(set?.evidenceFailureKeys ?? []),
  };
}

function approvalMap(
  approvals: readonly GraphFactClassApproval[] | undefined,
  failures: string[]
): ReadonlyMap<string, GraphFactClassApproval> {
  const approved = new Map<string, GraphFactClassApproval>();
  for (const approval of approvals ?? []) {
    if (!GRAPH_FACT_CLASSES.includes(approval.factClass)) {
      failures.push(`approval fact class is not admitted: ${approval.factClass}`);
      continue;
    }
    if (approval.kind !== 'approved-semantic-difference') {
      failures.push(`approval kind must be per-key approved-semantic-difference: ${approval.key}`);
      continue;
    }
    if (!approval.key || approval.key.includes('*') || approval.key === approval.factClass) {
      failures.push(`blanket or empty approval keys are forbidden: ${approval.factClass}`);
      continue;
    }
    if (!approval.reason.trim()) {
      failures.push(`approval reason is required: ${approval.factClass}:${approval.key}`);
      continue;
    }
    const token = `${approval.factClass}\0${approval.key}`;
    if (approved.has(token)) {
      failures.push(`duplicate approval: ${approval.factClass}:${approval.key}`);
      continue;
    }
    approved.set(token, approval);
  }
  return approved;
}

function classifyKey(input: {
  readonly factClass: GraphFactClass;
  readonly key: string;
  readonly expected: ReadonlySet<string>;
  readonly packageKeys: ReadonlySet<string>;
  readonly legacyKeys: ReadonlySet<string> | undefined;
  readonly approved: ReadonlyMap<string, GraphFactClassApproval>;
}): readonly GraphFactClassDifferenceKind[] {
  const token = `${input.factClass}\0${input.key}`;
  if (input.approved.has(token)) return ['approved-semantic-difference'];
  const expected = input.expected.has(input.key);
  const observed = input.packageKeys.has(input.key);
  const legacy = input.legacyKeys?.has(input.key);
  const kinds: GraphFactClassDifferenceKind[] = [];
  if (expected && observed && legacy === false) kinds.push('package-improvement');
  if (expected && !observed) kinds.push('package-regression');
  if (expected && legacy === false) kinds.push('legacy-false-negative');
  if (!expected && legacy === true) kinds.push('legacy-false-positive');
  if (!expected && observed && legacy !== true) kinds.push('package-regression');
  return kinds;
}

export function scoreFactClassQuality(
  request: GraphFactClassQualityRequest
): GraphFactClassQualityReport {
  const failures: string[] = [];
  const approved = approvalMap(request.approvals, failures);
  const classes: GraphFactClassMetrics[] = [];

  for (const factClass of GRAPH_FACT_CLASSES) {
    const expected = observation(request.expected[factClass]);
    const packageFull = observation(request.packageFull[factClass]);
    const incremental = request.packageIncremental
      ? observation(request.packageIncremental[factClass])
      : undefined;
    const legacy = request.legacy ? observation(request.legacy[factClass]) : undefined;
    const expectedSet = asSet(expected.keys);
    const packageSet = asSet(packageFull.keys);
    const legacySet = legacy ? asSet(legacy.keys) : undefined;

    if (incremental) {
      const fullToken = packageFull.keys.join('\0');
      const incrementalToken = incremental.keys.join('\0');
      if (fullToken !== incrementalToken) {
        failures.push(`${factClass}: package incremental keys drifted from package full`);
      }
    }

    const truePositiveKeys = expected.keys.filter((key) => packageSet.has(key));
    const falsePositiveKeys = packageFull.keys.filter((key) => !expectedSet.has(key));
    const falseNegativeKeys = expected.keys.filter((key) => !packageSet.has(key));
    const precision = ratio(truePositiveKeys.length, packageFull.keys.length);
    const recall = ratio(truePositiveKeys.length, expected.keys.length);

    const differenceKeys = unique([
      ...falsePositiveKeys,
      ...falseNegativeKeys,
      ...(legacy?.keys ?? []),
      ...expected.keys.filter((key) => legacySet !== undefined && !legacySet.has(key)),
    ]);
    const differences = differenceKeys.flatMap((key) => {
      if (
        expectedSet.has(key) &&
        packageSet.has(key) &&
        (legacySet === undefined || legacySet.has(key))
      ) {
        return [];
      }
      return classifyKey({
        factClass,
        key,
        expected: expectedSet,
        packageKeys: packageSet,
        legacyKeys: legacySet,
        approved,
      }).map((kind) => ({ key, kind }));
    });

    classes.push({
      factClass,
      truePositives: truePositiveKeys.length,
      falsePositives: falsePositiveKeys.length,
      falseNegatives: falseNegativeKeys.length,
      precision,
      recall,
      f1: f1Score(precision, recall),
      unsupported: expected.unsupported.length + packageFull.unsupported.length,
      ambiguous: expected.ambiguous.length + packageFull.ambiguous.length,
      truncated: expected.truncated.length + packageFull.truncated.length,
      generatedExcluded: expected.generatedExcluded.length + packageFull.generatedExcluded.length,
      evidenceFailures: expected.evidenceFailures.length + packageFull.evidenceFailures.length,
      packageFullKeys: packageFull.keys,
      ...(incremental ? { packageIncrementalKeys: incremental.keys } : {}),
      ...(legacy ? { legacyKeys: legacy.keys } : {}),
      expectedKeys: expected.keys,
      differences: Object.freeze(
        [...differences].sort(
          (left, right) => left.key.localeCompare(right.key) || left.kind.localeCompare(right.kind)
        )
      ),
    });
  }

  return {
    schema: GRAPH_FACT_CLASS_QUALITY_SCHEMA,
    publicAccuracyClaimPermitted: false,
    classes: Object.freeze(classes),
    failures: Object.freeze(failures),
  };
}
