export interface CallCorpusCase {
  readonly id: string;
  readonly language: string;
  readonly expectedClass: 'exact' | 'ambiguous' | 'unknown' | 'unsupported';
  readonly expectedTargets: readonly string[];
}

export interface CallPrediction {
  readonly id: string;
  readonly predictedClass: CallCorpusCase['expectedClass'];
  readonly predictedTargets: readonly string[];
}

export interface CallLanguageScore {
  readonly cases: number;
  readonly edgeTruePositives: number;
  readonly edgeFalsePositives: number;
  readonly edgeFalseNegatives: number;
  readonly edgeF1: number;
  readonly unknownRate: number;
  readonly ambiguousRate: number;
}

export interface CallScore {
  readonly reviewStatus: 'candidate-unreviewed';
  readonly edgeTruePositives: number;
  readonly edgeFalsePositives: number;
  readonly edgeFalseNegatives: number;
  readonly edgePrecision: number;
  readonly edgeRecall: number;
  readonly edgeF1: number;
  readonly classificationMatches: number;
  readonly classificationTotal: number;
  readonly unknownRate: number;
  readonly ambiguousRate: number;
  readonly byLanguage: Readonly<Record<string, CallLanguageScore>>;
}

function sameTargets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const ordered = [...left].sort();
  return [...right].sort().every((target, index) => target === ordered[index]);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function edgeF1(truePositives: number, falsePositives: number, falseNegatives: number): number {
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return ratio(2 * precision * recall, precision + recall);
}

interface EdgeTotals {
  edgeTruePositives: number;
  edgeFalsePositives: number;
  edgeFalseNegatives: number;
  classificationMatches: number;
  unknown: number;
  ambiguous: number;
}

function scoreGroup(
  cases: readonly CallCorpusCase[],
  predictions: readonly CallPrediction[]
): EdgeTotals {
  const predicted = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const totals: EdgeTotals = {
    edgeTruePositives: 0,
    edgeFalsePositives: 0,
    edgeFalseNegatives: 0,
    classificationMatches: 0,
    unknown: 0,
    ambiguous: 0,
  };
  for (const item of cases) {
    if (item.expectedClass === 'unknown') totals.unknown += 1;
    if (item.expectedClass === 'ambiguous') totals.ambiguous += 1;
    const prediction = predicted.get(item.id);
    const classMatches = prediction?.predictedClass === item.expectedClass;
    const targetsMatch = prediction
      ? sameTargets(prediction.predictedTargets, item.expectedTargets)
      : item.expectedTargets.length === 0;
    if (classMatches && targetsMatch) totals.classificationMatches += 1;
    if (item.expectedClass === 'exact') {
      const expected = new Set(item.expectedTargets);
      const actual = new Set(prediction?.predictedTargets ?? []);
      for (const target of actual) {
        if (expected.has(target)) totals.edgeTruePositives += 1;
        else totals.edgeFalsePositives += 1;
      }
      for (const target of expected) {
        if (!actual.has(target)) totals.edgeFalseNegatives += 1;
      }
    } else {
      const expected = new Set(item.expectedTargets);
      for (const target of prediction?.predictedTargets ?? []) {
        if (!expected.has(target)) totals.edgeFalsePositives += 1;
      }
    }
  }
  return totals;
}

/**
 * Edge F1 counts only exact targets. Unknown, ambiguous, and unsupported
 * matches are classification outcomes. Duplicate prediction ids are rejected.
 * This does not review the corpus and does not admit a call gate.
 */
export function scoreCallCorpus(
  cases: readonly CallCorpusCase[],
  predictions: readonly CallPrediction[]
): CallScore {
  const seen = new Set<string>();
  for (const prediction of predictions) {
    if (seen.has(prediction.id)) throw new Error('duplicate-prediction');
    seen.add(prediction.id);
  }
  const known = new Set(cases.map((item) => item.id));
  const totals = scoreGroup(cases, predictions);
  for (const prediction of predictions) {
    if (!known.has(prediction.id)) {
      totals.edgeFalsePositives += prediction.predictedTargets.length || 1;
    }
  }
  const byLanguage: Record<string, CallLanguageScore> = {};
  const languages = new Map<string, CallCorpusCase[]>();
  for (const item of cases) {
    const group = languages.get(item.language) ?? [];
    group.push(item);
    languages.set(item.language, group);
  }
  for (const [language, group] of languages) {
    const ids = new Set(group.map((item) => item.id));
    const languageTotals = scoreGroup(
      group,
      predictions.filter((prediction) => ids.has(prediction.id))
    );
    byLanguage[language] = {
      cases: group.length,
      edgeTruePositives: languageTotals.edgeTruePositives,
      edgeFalsePositives: languageTotals.edgeFalsePositives,
      edgeFalseNegatives: languageTotals.edgeFalseNegatives,
      edgeF1: edgeF1(
        languageTotals.edgeTruePositives,
        languageTotals.edgeFalsePositives,
        languageTotals.edgeFalseNegatives
      ),
      unknownRate: ratio(languageTotals.unknown, group.length),
      ambiguousRate: ratio(languageTotals.ambiguous, group.length),
    };
  }
  const precision = ratio(
    totals.edgeTruePositives,
    totals.edgeTruePositives + totals.edgeFalsePositives
  );
  const recall = ratio(
    totals.edgeTruePositives,
    totals.edgeTruePositives + totals.edgeFalseNegatives
  );
  return {
    reviewStatus: 'candidate-unreviewed',
    edgeTruePositives: totals.edgeTruePositives,
    edgeFalsePositives: totals.edgeFalsePositives,
    edgeFalseNegatives: totals.edgeFalseNegatives,
    edgePrecision: precision,
    edgeRecall: recall,
    edgeF1: ratio(2 * precision * recall, precision + recall),
    classificationMatches: totals.classificationMatches,
    classificationTotal: cases.length,
    unknownRate: ratio(totals.unknown, cases.length),
    ambiguousRate: ratio(totals.ambiguous, cases.length),
    byLanguage,
  };
}
