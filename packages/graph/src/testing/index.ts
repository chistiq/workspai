export const GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES = Object.freeze([
  'workspai',
  'commander',
  'chalk',
  'ora',
  'inquirer',
  'vscode',
] as const);
export {
  scoreGraphRetrievalBenchmark,
  type GraphRetrievalBenchmarkCase,
  type GraphRetrievalBenchmarkCaseResult,
  type GraphRetrievalBenchmarkCorpus,
  type GraphRetrievalBenchmarkExpectation,
  type GraphRetrievalBenchmarkObservation,
} from './score-retrieval-benchmark.js';
