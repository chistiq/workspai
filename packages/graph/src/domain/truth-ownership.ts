export const GRAPH_TRUTH_DEPENDENCY_DIRECTION = Object.freeze([
  'wis-contracts',
  'facts-and-evidence',
  'canonical-graph-generation',
  'model-and-consumer-projections',
] as const);

export const GRAPH_TRUTH_INVARIANTS = Object.freeze([
  'graph-owns-relation-acceptance-and-proof',
  'model-does-not-write-back-graph-truth',
  'storage-backends-do-not-change-semantics',
  'generated-projections-do-not-self-corroborate',
] as const);
