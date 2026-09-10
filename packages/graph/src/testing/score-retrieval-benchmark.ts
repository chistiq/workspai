import {
  GRAPH_RETRIEVAL_BENCHMARK_CLAIM,
  GRAPH_RETRIEVAL_BENCHMARK_CONTRACT,
} from '../contracts/index.js';

export interface GraphRetrievalBenchmarkExpectation {
  readonly accepted: boolean;
  readonly resultIds?: readonly string[];
  readonly pathNodeIds?: readonly string[];
  readonly truncated?: boolean;
  readonly selectedStrategy?: string;
  readonly issueCodes?: readonly string[];
  readonly unknownCodes?: readonly string[];
}

export interface GraphRetrievalBenchmarkCase {
  readonly id: string;
  readonly family: string;
  readonly query: Record<string, unknown>;
  readonly expect: GraphRetrievalBenchmarkExpectation;
}

export interface GraphRetrievalBenchmarkCorpus {
  readonly id: string;
  readonly version: string;
  readonly groundTruthClass: 'synthetic';
  readonly accuracyClaim: 'none';
  readonly graph: unknown;
  readonly cases: readonly GraphRetrievalBenchmarkCase[];
}

export interface GraphRetrievalBenchmarkObservation {
  readonly id: string;
  readonly accepted: boolean;
  readonly resultIds: readonly string[];
  readonly pathNodeIds: readonly string[];
  readonly truncated: boolean;
  readonly selectedStrategy?: string;
  readonly queryDigest?: string;
  readonly issueCodes: readonly string[];
  readonly unknownCodes: readonly string[];
  readonly elapsedMs: number;
}

export interface GraphRetrievalBenchmarkCaseResult {
  readonly id: string;
  readonly family: string;
  readonly status: 'passed' | 'failed';
  readonly scored: boolean;
  readonly precision?: number;
  readonly recall?: number;
  readonly f1?: number;
  readonly truncated: boolean;
  readonly diagnostics: readonly string[];
}

function ratio(matched: number, total: number): number {
  return total === 0 ? 0 : matched / total;
}

function f1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function missing(expected: readonly string[], actual: readonly string[]): string[] {
  const seen = new Set(actual);
  return expected.filter((item) => !seen.has(item));
}

export function scoreGraphRetrievalBenchmark(
  corpus: GraphRetrievalBenchmarkCorpus,
  observations: readonly GraphRetrievalBenchmarkObservation[]
): {
  readonly contract: typeof GRAPH_RETRIEVAL_BENCHMARK_CONTRACT;
  readonly corpus: { readonly id: string; readonly version: string };
  readonly groundTruthClass: 'synthetic';
  readonly accuracyClaim: 'none';
  readonly publicAccuracyClaimPermitted: false;
  readonly cases: readonly GraphRetrievalBenchmarkCaseResult[];
  readonly scoredCases: number;
  readonly meanPrecision: number | null;
  readonly meanRecall: number | null;
  readonly meanF1: number | null;
  readonly failures: readonly string[];
} {
  const failures: string[] = [];
  if (corpus.groundTruthClass !== GRAPH_RETRIEVAL_BENCHMARK_CLAIM.groundTruthClass) {
    failures.push('Retrieval corpus ground truth must stay synthetic');
  }
  if (corpus.accuracyClaim !== GRAPH_RETRIEVAL_BENCHMARK_CLAIM.accuracyClaim) {
    failures.push('Retrieval corpus cannot claim production accuracy');
  }
  if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(JSON.stringify(corpus))) {
    failures.push('Retrieval corpus contains a machine-local path');
  }

  const byId = new Map(observations.map((item) => [item.id, item]));
  const cases: GraphRetrievalBenchmarkCaseResult[] = [];
  const precisions: number[] = [];
  const recalls: number[] = [];
  const f1s: number[] = [];

  for (const fixture of corpus.cases) {
    const observed = byId.get(fixture.id);
    const diagnostics: string[] = [];
    if (!observed) {
      diagnostics.push('missing-observation');
      failures.push(`${fixture.id}: missing observation`);
      cases.push({
        id: fixture.id,
        family: fixture.family,
        status: 'failed',
        scored: false,
        truncated: false,
        diagnostics,
      });
      continue;
    }
    if (observed.accepted !== fixture.expect.accepted) {
      diagnostics.push('accepted-mismatch');
    }
    if (fixture.expect.truncated !== undefined && observed.truncated !== fixture.expect.truncated) {
      diagnostics.push('truncated-mismatch');
    }
    if (
      fixture.expect.selectedStrategy !== undefined &&
      observed.selectedStrategy !== fixture.expect.selectedStrategy
    ) {
      diagnostics.push('strategy-mismatch');
    }
    if (fixture.expect.resultIds) {
      const extra = missing(observed.resultIds, fixture.expect.resultIds);
      const absent = missing(fixture.expect.resultIds, observed.resultIds);
      if (extra.length > 0 || absent.length > 0) diagnostics.push('result-mismatch');
    }
    if (fixture.expect.pathNodeIds) {
      const extra = missing(observed.pathNodeIds, fixture.expect.pathNodeIds);
      const absent = missing(fixture.expect.pathNodeIds, observed.pathNodeIds);
      if (extra.length > 0 || absent.length > 0) diagnostics.push('path-mismatch');
    }
    if (fixture.expect.issueCodes) {
      const absent = missing(fixture.expect.issueCodes, observed.issueCodes);
      if (absent.length > 0) diagnostics.push('issue-mismatch');
    }
    if (fixture.expect.unknownCodes) {
      const absent = missing(fixture.expect.unknownCodes, observed.unknownCodes);
      if (absent.length > 0) diagnostics.push('unknown-mismatch');
    }
    const eligible =
      fixture.expect.accepted &&
      Boolean(fixture.expect.resultIds) &&
      observed.accepted &&
      !observed.truncated;
    let precision: number | undefined;
    let recall: number | undefined;
    let scoreF1: number | undefined;
    if (fixture.expect.resultIds && observed.accepted) {
      const expected = fixture.expect.resultIds;
      const actual = observed.resultIds;
      const matched = expected.filter((id) => actual.includes(id)).length;
      precision = ratio(matched, actual.length);
      recall = ratio(matched, expected.length);
      scoreF1 = f1(precision, recall);
    }
    const scored = eligible && diagnostics.length === 0;
    if (scored && precision !== undefined && recall !== undefined && scoreF1 !== undefined) {
      precisions.push(precision);
      recalls.push(recall);
      f1s.push(scoreF1);
    }
    if (diagnostics.length > 0) failures.push(`${fixture.id}: ${diagnostics.join(',')}`);
    cases.push({
      id: fixture.id,
      family: fixture.family,
      status: diagnostics.length > 0 ? 'failed' : 'passed',
      scored,
      ...(precision === undefined ? {} : { precision, recall, f1: scoreF1 }),
      truncated: observed.truncated,
      diagnostics,
    });
  }

  for (const observation of observations) {
    if (!corpus.cases.some((item) => item.id === observation.id)) {
      failures.push(`${observation.id}: unexpected observation`);
    }
  }

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    contract: GRAPH_RETRIEVAL_BENCHMARK_CONTRACT,
    corpus: { id: corpus.id, version: corpus.version },
    groundTruthClass: GRAPH_RETRIEVAL_BENCHMARK_CLAIM.groundTruthClass,
    accuracyClaim: GRAPH_RETRIEVAL_BENCHMARK_CLAIM.accuracyClaim,
    publicAccuracyClaimPermitted: GRAPH_RETRIEVAL_BENCHMARK_CLAIM.publicAccuracyClaimPermitted,
    cases,
    scoredCases: precisions.length,
    meanPrecision: mean(precisions),
    meanRecall: mean(recalls),
    meanF1: mean(f1s),
    failures,
  };
}
