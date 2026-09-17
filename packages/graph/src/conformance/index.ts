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
export {
  canonicalizeGraphValue,
  cloneCanonicalGraphValue,
  digestCanonicalGraphValue,
  measureCanonicalGraphValueBytes,
  streamCanonicalGraphValue,
} from './canonical-json.js';
export { normalizeGraphEntityIdentity, resolveGraphEntityIdentity } from './identity.js';
export { GRAPH_LOCATOR_IDENTITY } from './locator-identity-api.js';
export {
  GRAPH_COMPARABLE_SURFACE,
  GRAPH_GENERATED_ARTIFACT,
  GRAPH_UNKNOWN_CAUSE,
} from './semantic-parity-api.js';
export { GRAPH_INVENTORY_SURFACE } from './inventory-surface-api.js';
export {
  GRAPH_COMPARABLE_SURFACE_CONTRACT,
  GRAPH_COMPARABLE_SURFACE_LAW,
  GRAPH_GENERATED_ARTIFACT_CONTRACT,
  GRAPH_GENERATED_ARTIFACT_LAW,
  GRAPH_INVENTORY_SURFACE_CONTRACT,
  GRAPH_INVENTORY_SURFACE_LAW,
  GRAPH_LOCATOR_IDENTITY_CONTRACT,
  GRAPH_LOCATOR_IDENTITY_LAW,
  GRAPH_UNKNOWN_CAUSE_CONTRACT,
  GRAPH_UNKNOWN_CAUSE_LAW,
  type GraphUnknownCause,
  type GraphGeneratedArtifactTreatment,
  type GraphComparableMembership,
  type GraphInventorySurfaceClass,
  type GraphOmittedSubtree,
  type GraphUnknownClassificationOrigin,
} from '../contracts/index.js';
export {
  GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES,
  MAX_GRAPH_URI_DECODE_ROUNDS,
  admitDeclaredGraphLocator,
  classifyGraphRelativeLocator,
  decodeGraphLocatorState,
  opaqueGraphDeclaredLocator,
  type GraphOpaqueDeclaredLocatorPrefix,
  type GraphRelativeLocatorClass,
  type GraphRelativeLocatorClassification,
} from '../domain/locator-identity.js';
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
