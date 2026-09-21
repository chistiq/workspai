export {
  classifyGraphInventoryOmission,
  excludedDirectoryOmissionCode,
  inventoryCodesPreventCompleteness,
  inventoryOmissionIsResourceTruncation,
  summarizeGraphInventoryOmissions,
  GRAPH_INVENTORY_OMISSION_CLASSES,
  type GraphInventoryOmissionClass,
} from './classify-inventory-omissions.js';
export { GRAPH_PACKAGE_STATUS_CONTRACT, getGraphPackageStatus } from './package-status.js';
export {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_PROOF_POLICY,
  GRAPH_COMPOSITION_RECEIPT_SCHEMA,
  GRAPH_COMPOSITION_ORDERING_RULES,
  compositionReceiptMatchesPublishedGraph,
  compositionSemanticReceiptsEqual,
  type GraphCompositionDecision,
  type GraphCompositionOutput,
  type GraphCompositionPolicy,
  type GraphCompositionReceipt,
  type GraphCompositionRequest,
  type GraphCompositionResult,
  type GraphCompositionSemanticReceipt,
  type GraphCompositionSource,
  type GraphCompositionTimings,
  type GraphReferenceCompositionTaskOutput,
} from './composition-types.js';
export {
  GRAPH_REFERENCE_COMPOSITION_TASK,
  composeGraph,
  computeGraphCompositionSemanticReceipt,
  executeGraphReferenceCompositionTask,
} from './compose-graph.js';
export { normalizeGraphQuery, queryGraph, type GraphQueryOptions } from './query-graph.js';
export { assessGraphEdgeProof, type GraphProofPolicyAssessment } from './assess-proof.js';
export {
  createQueryCacheKey,
  evaluateGraphQueryCacheReuse,
  applyQueryCacheInvalidations,
  type GraphQueryCacheKeyRequest,
  type GraphQueryCachePolicy,
  type GraphQueryCacheRequest,
} from './query-cache.js';
export { planQueryCacheInvalidation } from './plan-query-cache-invalidation.js';
export type { GraphQueryCacheInvalidationRequest } from './plan-query-cache-invalidation.js';
export { GRAPH_STANDARD_REPO_BUILD_POLICY, buildRepoGraph } from './build-repo-graph.js';
export {
  referenceGraphNativeTraversal,
  routeGraphNativeTraversal,
  type GraphNativeTraversalRoute,
} from './route-native-traversal.js';
export type {
  GraphIncrementalExecutionPath,
  GraphIncrementalRepoBuildRequest,
  GraphIncrementalRepoBuildResult,
  GraphIncrementalQueryCacheRequest,
} from './incremental-repo-build-types.js';
export type {
  GraphRepoBuildCompositionReuse,
  GraphRepoBuildMetrics,
  GraphRepoBuildPolicy,
  GraphRepoBuildQuality,
  GraphRepoBuildRequest,
  GraphRepoBuildResult,
} from './repo-build-types.js';
export {
  GRAPH_REPO_PHASE_NAMES,
  beginGraphPhaseSession,
  createGraphPhaseAccumulator,
  graphPhaseTimings,
  recordGraphPhase,
  runWithGraphPhaseSession,
  type GraphRepoPhaseName,
  type GraphRepoPhaseTiming,
} from './phase-metrics.js';
export {
  GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
  GRAPH_LOCATOR_FACT_SHARD_LIMIT_BYTES,
  GRAPH_LOCATOR_FACT_SHARD_LIMIT_ENTRIES,
  GRAPH_LOCATOR_FACT_SHARD_LIMIT_FACTS,
  appendReusedLocatorFacts,
  compositionSourcesAreIdenticalFacts,
  createLocatorFactShardStore,
  lookupLocatorFactShard,
  rememberLocatorFactShard,
  runWithLocatorFactShardStore,
  setLocatorFactShardExtractionEnvironment,
  locatorCallEnvironmentDigest,
  expandCallEnvironmentLocators,
  type GraphLocatorFactShard,
  type GraphLocatorFactShardKey,
  type GraphLocatorFactShardStats,
  type LocatorFactShardStore,
} from './locator-fact-shards.js';
export {
  GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION,
  GRAPH_EXTRACTION_ENVIRONMENT_DEPENDENCIES,
  GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA,
  GRAPH_LANGUAGE_RUNTIME_DETECTION_VERSION,
  GRAPH_NATIVE_ENGINE_ABI_VERSION,
  GRAPH_PRODUCT_SCAN_PROFILE_ID,
  GRAPH_ECMASCRIPT_SYNTAX_VERSION,
  GRAPH_MATRIX_SOURCE_MASK_VERSION,
  digestGraphExtractionEnvironment,
  graphProviderPermissionBlocks,
  reusedProviderSourcesSatisfyCurrentBoundary,
} from './extraction-environment.js';
export {
  graphDataMovementSnapshot,
  recordGraphDataMovement,
  runWithGraphDataMovementSession,
  type GraphDataMovementSnapshot,
} from './data-movement.js';
export {
  snapshotGraphBuildMemory,
  processLifetimePeakRssBytes,
  type GraphBuildMemorySnapshot,
} from './build-memory.js';
export {
  GRAPH_PROJECT_ARTIFACT_FILES,
  writeGraphGeneration,
  type GraphProjectPublicationIndex,
  type GraphProjectPublicationOutcome,
} from './publish-project-graph.js';
export { buildWorkspaceGraph } from './build-workspace-graph.js';
export { assessIncrementalBuildEquivalence } from './assess-incremental-build-equivalence.js';
export type {
  GraphIncrementalBuildEquivalenceRequest,
  GraphIncrementalBuildEquivalenceResult,
} from './assess-incremental-build-equivalence.js';
export { buildContentStateManifest } from './build-content-state-manifest.js';
export { buildIncrementalRepoGraph } from './build-incremental-repo-graph.js';
export {
  contentStateLeavesFromProviderInputs,
  type GraphContentStateLeafInput,
  type GraphContentStateManifestBuildRequest,
} from './content-state-manifest-types.js';
export { compareContentStateManifests } from './compare-content-state-manifest.js';
export { planInventoryReread } from './plan-inventory-reread.js';
export type {
  GraphInventoryRereadDecision,
  GraphInventoryRereadPlan,
} from './plan-inventory-reread.js';
export {
  GRAPH_INVENTORY_MEMBERSHIP_SCHEMA,
  MAX_INVENTORY_MEMBERSHIP_BYTES,
  MAX_INVENTORY_MEMBERSHIP_LOCATORS,
  admittedInventoryMembershipSnapshot,
  applyInventoryMembership,
  compareInventoryMembership,
  freezeInventoryMembership,
  inventoryMembershipIsBounded,
  inventoryMembershipIsComplete,
  type GraphInventoryMembershipComparison,
  type GraphInventoryMembershipSnapshot,
} from './inventory-membership.js';
export {
  GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA,
  MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS,
  clampIncrementalSnapshotAttempts,
  compareIncrementalSnapshots,
  freezeIncrementalSnapshot,
  gitSnapshotFromJournal,
  membershipSnapshotFromLocators,
  type GraphIncrementalSnapshotComparison,
  type GraphIncrementalSnapshotReceipt,
} from './incremental-snapshot.js';
export {
  absentChangeJournal,
  isGitlinkMode,
  parseGitLsFilesStageZ,
  parseGitLsFilesVerboseZ,
  parseGitStatusPorcelain,
  parseGitStatusPorcelainV2Z,
  scopeChangeJournalToGraphRoot,
  untrustedChangeJournal,
} from './parse-git-status-porcelain.js';
export {
  admitGitSkipReread,
  freezeGitWorktreeBaseline,
  isAdmittedGitWorktreeBaseline,
  journalDirtyLocators,
} from './git-worktree-baseline.js';
export { diffGraphGenerations, summarizeCanonicalGraphDelta } from './diff-graph-generations.js';
export type { GraphGenerationDiff } from './diff-graph-generations.js';
export {
  summarizeDeltaProcessingLedger,
  summarizeInputProcessingLedger,
  type GraphInputProcessingLedger,
} from './summarize-input-processing-ledger.js';
export { planShardReuseAndInvalidation } from './plan-shard-reuse.js';
export { planIncrementalGraphBuild } from './plan-incremental-graph-build.js';
export {
  planProviderRecomputeScope,
  type GraphProviderRecomputeScopePlan,
  type GraphProviderRecomputeScopeRequest,
} from './plan-provider-recompute-scope.js';
export {
  addedInputLocators,
  providersRequiredForAddedInputs,
  type GraphAddedInputRecomputeRequest,
} from './providers-required-for-added-inputs.js';
export {
  buildGraphChangeOverlay,
  buildGraphChangeOverlay as createChangeOverlay,
} from './build-graph-change-overlay.js';
export {
  applyGraphChangeOverlayStaleness,
  evaluateGraphChangeOverlayStaleness,
} from './evaluate-overlay-staleness.js';
export { buildShardDependenciesFromSources } from './build-shard-dependencies.js';
export {
  collectGraphSemanticDependencies,
  semanticDependenciesForShard,
  type GraphIncrementalSemanticStamps,
  type GraphSemanticDependencyRequest,
} from './collect-semantic-dependencies.js';
export { compareChangeOverlays } from './compare-change-overlays.js';
export { queryChangeOverlay } from './query-change-overlay.js';
export type {
  GraphChangeOverlayQuery,
  GraphChangeOverlayQueryRequest,
  GraphChangeOverlayQueryResult,
} from './query-change-overlay.js';
export type {
  GraphIncrementalAccounting,
  GraphIncrementalBuildPlan,
  GraphIncrementalBuildRequest,
} from './incremental-build-types.js';
export type {
  GraphChangeOverlayOverlapRequest,
  GraphChangeOverlayRequest,
  GraphOverlayStalenessRequest,
} from './proposed-change-types.js';
export { runStandaloneGraph } from './run-standalone-graph.js';
export {
  writeWorkspaceGraphGeneration,
  GRAPH_WORKSPACE_ARTIFACT_FILES,
  type GraphWorkspacePublicationIndex,
  type GraphWorkspacePublicationOutcome,
} from './publish-workspace-graph.js';
export {
  projectIdentityFromScope,
  workspaceScope,
  type GraphStandaloneGraphExecution,
  type GraphStandaloneGraphRequest,
  type GraphStandaloneInteraction,
  type GraphStandaloneMode,
} from './standalone-build-types.js';
export {
  projectGraphReference,
  type GraphDualScopeGraphResult,
  type GraphWorkspaceBuildExecution,
  type GraphWorkspaceBuildMetrics,
  type GraphWorkspaceBuildPolicy,
  type GraphWorkspaceBuildRequest,
  type GraphWorkspaceBuildResult,
  type GraphWorkspaceProjectInput,
} from './workspace-build-types.js';
