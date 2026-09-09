export const GRAPH_CONFORMANCE_PROFILE = Object.freeze({
  id: 'workspai.graph.conformance',
  version: '0.1.0-candidate',
  maturity: 'query-candidate' as const,
  requiredSuites: [
    'contracts',
    'semantic-invalid',
    'provider-admission',
    'canonical-replay',
    'identity-portability',
    'lineage-independence',
    'reference-composition',
    'proof-evaluation',
    'conflict-preservation',
    'quality-assessment',
    'execution-port-responsiveness',
    'query-normalization',
    'proof-carrying-query',
    'cross-layer-binding',
    'query-budget-and-pagination',
    'query-result-abstention',
    'query-scale-baseline',
    'query-cache-lifecycle',
    'architecture-boundaries',
    'determinism',
    'security-adversarial',
    'cross-platform',
    'package-consumer',
  ] as const,
});

export {
  GRAPH_SHARED_ADOPTION_PROFILE,
  assessGraphSharedEnvelope,
  type GraphSharedAdoptionFailureCode,
  type GraphSharedAdoptionResult,
} from './shared-adoption.js';
export {
  admitGraphProviderOutput,
  validateGraphFactBatch,
  validateGraphProviderDetectionRequest,
  validateGraphProviderDetectionResult,
  validateGraphProviderManifest,
  type GraphProviderOutputAdmission,
} from './foundation.js';
export { canonicalizeGraphValue, digestCanonicalGraphValue } from './canonical-json.js';
export { normalizeGraphEntityIdentity, resolveGraphEntityIdentity } from './identity.js';
export { assessGraphEvidenceIndependence } from './lineage.js';
export {
  validateCanonicalGraph,
  validateGraphModelGenerationBinding,
  validateGraphNaryAssertion,
  validateGraphOntologyProfile,
  validateGraphPublicationManifest,
  validateGraphQualityReport,
  validateGraphQueryCacheEntry,
  validateGraphQueryCacheInvalidation,
  validateGraphQueryCacheKey,
  validateGraphQueryCacheReuseDecision,
} from './graph.js';
export {
  validateGraphBindingProfile,
  validateGraphProofPolicy,
  validateGraphQuery,
  validateGraphQueryResult,
} from './query.js';
export {
  validateGraphChangeOverlay,
  validateGraphChangeSet,
  validateGraphContentStateManifest,
  validateGraphDelta,
  validateGraphProposedChangeSet,
  validateGraphProposedGraphDelta,
} from './incremental.js';
