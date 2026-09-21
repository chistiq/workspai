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
export {
  GRAPH_FACT_CLASS_DIFFERENCE_KINDS,
  GRAPH_FACT_CLASS_QUALITY_SCHEMA,
  GRAPH_FACT_CLASSES,
  scoreFactClassQuality,
  type GraphFactClass,
  type GraphFactClassApproval,
  type GraphFactClassDifferenceKind,
  type GraphFactClassKeySet,
  type GraphFactClassMetrics,
  type GraphFactClassQualityReport,
  type GraphFactClassQualityRequest,
} from './score-fact-class-quality.js';
export {
  decodeGraphEntityLocator,
  factClassObservationsFromFacts,
  factClassObservationsFromGraph,
} from './fact-class-observation.js';
