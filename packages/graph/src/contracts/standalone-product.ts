import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_CLI_RESULT_CONTRACT = defineWisContract({
  id: 'workspai.graph.cli-result',
  version: '0.1.0-candidate',
});

export const GRAPH_STANDALONE_SUPPORT_MATRIX_CONTRACT = defineWisContract({
  id: 'workspai.graph.standalone-support-matrix',
  version: '0.1.0-candidate',
});

export const GRAPH_CLI_RESULT_SCHEMA_VERSION = 'workspai.graph.cli-result.v1' as const;

export const GRAPH_CLI_COMMANDS = Object.freeze([
  'inspect',
  'quality',
  'query',
  'providers',
] as const);

export type GraphCliCommand = (typeof GRAPH_CLI_COMMANDS)[number];

export const GRAPH_CLI_EXIT_CODES = Object.freeze({
  success: 0,
  partial: 2,
  failed: 1,
  rejected: 3,
  publicationFailed: 4,
  cancelled: 130,
} as const);

export type GraphCliExitCode = (typeof GRAPH_CLI_EXIT_CODES)[keyof typeof GRAPH_CLI_EXIT_CODES];

export const GRAPH_PUBLIC_EXPORT_SUBPATHS = Object.freeze([
  '.',
  './contracts',
  './providers',
  './conformance',
  './testing',
  './adapters/node',
] as const);

export const GRAPH_PUBLIC_ROOT_VALUE_EXPORTS = Object.freeze([
  'GRAPH_BINDING_PROFILE_CONTRACT',
  'GRAPH_CLI_EXIT_CODES',
  'GRAPH_CLI_RESULT_CONTRACT',
  'GRAPH_CLI_RESULT_SCHEMA_VERSION',
  'GRAPH_PACKAGE_MATURITY',
  'GRAPH_PACKAGE_METADATA',
  'GRAPH_PACKAGE_STATUS_CONTRACT',
  'GRAPH_PROJECT_ARTIFACT_FILES',
  'GRAPH_PROOF_POLICY_CONTRACT',
  'GRAPH_PROJECTIONS_AVAILABLE',
  'GRAPH_PUBLIC_EXPORT_MAP',
  'GRAPH_QUERY_CACHE_OPERATING_BOUNDARY',
  'GRAPH_QUERY_CONTRACT',
  'GRAPH_QUERY_PRESETS',
  'GRAPH_QUERY_RESULT_CONTRACT',
  'GRAPH_REFERENCE_COMPOSITION_TASK',
  'GRAPH_REPOSITORY_PREVIEW_VIEW_CONTRACT',
  'GRAPH_REPOSITORY_PREVIEW_VIEWS_AVAILABLE',
  'GRAPH_RETRIEVAL_PLAN_CONTRACT',
  'GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT',
  'GRAPH_STANDARD_BINDING_PROFILES',
  'GRAPH_STANDARD_COMPOSITION_POLICY',
  'GRAPH_STANDARD_PROOF_POLICY',
  'GRAPH_STANDARD_REPO_BUILD_POLICY',
  'GRAPH_STANDALONE_SUPPORT_MATRIX',
  'assessGraphEdgeProof',
  'buildRepoGraph',
  'buildReviewContextSlice',
  'composeGraph',
  'createQueryCacheKey',
  'evaluateGraphQueryCacheReuse',
  'executeGraphReferenceCompositionTask',
  'getGraphPackageStatus',
  'normalizeGraphQuery',
  'projectRepositoryPreview',
  'queryGraph',
  'writeGraphGeneration',
] as const);

export const GRAPH_ROOT_FORBIDDEN_VALUE_EXPORTS = Object.freeze([
  'addedInputLocators',
  'applyQueryCacheInvalidations',
  'buildGraphChangeOverlay',
  'buildIncrementalRepoGraph',
  'buildWorkspaceGraph',
  'collectGraphSemanticDependencies',
  'compareContentStateManifests',
  'createGraphSlice',
  'planIncrementalGraphBuild',
  'planQueryCacheInvalidation',
  'projectDerivedGraph',
  'projectGraph',
  'providersRequiredForAddedInputs',
  'runStandaloneGraph',
  'summarizeCanonicalGraphDelta',
] as const);

export const GRAPH_PUBLIC_EXPORT_MAP = Object.freeze({
  subpaths: GRAPH_PUBLIC_EXPORT_SUBPATHS,
  rootValueExports: GRAPH_PUBLIC_ROOT_VALUE_EXPORTS,
  rootForbiddenValueExports: GRAPH_ROOT_FORBIDDEN_VALUE_EXPORTS,
});

export const GRAPH_QUERY_CACHE_OPERATING_BOUNDARY = Object.freeze({
  defaultStore: 'none',
  hostPersistence: 'injected-only',
  network: 'deny',
  resultEnvelopeCacheField: 'prohibited',
  historicalRetention: 'generation-keyed-until-policy-revocation',
  latestGenerationAlias: 'rejected',
  secrets: 'redaction-policy-digest-bound',
  canonicalReuseIdentity: 'exact-digest',
});

export const GRAPH_STANDALONE_PACKED_JOBS = Object.freeze([
  Object.freeze({
    id: 'help',
    args: Object.freeze(['--help'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success]),
    output: 'help',
  }),
  Object.freeze({
    id: 'inspect-json',
    args: Object.freeze(['inspect', '.', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-project-only',
    args: Object.freeze(['inspect', '.', '--mode', 'project-only', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-source-view',
    args: Object.freeze(['inspect', '.', '--view', 'source', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-structural-view',
    args: Object.freeze(['inspect', '.', '--view', 'structural', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-evidence-view',
    args: Object.freeze(['inspect', '.', '--view', 'evidence', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'providers-list',
    args: Object.freeze(['providers', 'list', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success]),
  }),
  Object.freeze({
    id: 'providers-inspect-repository-files',
    args: Object.freeze([
      'providers',
      'inspect',
      'workspai.graph.provider.repository-files',
      '--json',
    ] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success]),
  }),
  Object.freeze({
    id: 'query-entry-points',
    args: Object.freeze(['query', '.', '--preset', 'entryPoints', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'query-review-context-slice',
    args: Object.freeze(['query', '.', '--preset', 'reviewContext', '--slice', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'query-contract-topology',
    args: Object.freeze(['query', '.', '--preset', 'contractTopology', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'query-architecture-conformance',
    args: Object.freeze(['query', '.', '--preset', 'architectureConformance', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'query-operational-risk',
    args: Object.freeze(['query', '.', '--preset', 'operationalRisk', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
    requiresSubject: true,
  }),
  Object.freeze({
    id: 'query-dependencies',
    args: Object.freeze(['query', '.', '--preset', 'dependencies', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
    requiresSubject: true,
  }),
  Object.freeze({
    id: 'query-owners',
    args: Object.freeze(['query', '.', '--preset', 'owners', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
    requiresSubject: true,
  }),
  Object.freeze({
    id: 'query-impact',
    args: Object.freeze(['query', '.', '--preset', 'impact', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
    requiresSubject: true,
    requiresTarget: true,
  }),
  Object.freeze({
    id: 'query-dependencies-without-subject',
    args: Object.freeze(['query', '.', '--preset', 'dependencies', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'query-unknown-preset',
    args: Object.freeze(['query', '.', '--preset', 'unknown', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'query-without-preset',
    args: Object.freeze(['query', '.', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'query-slice-without-review-context',
    args: Object.freeze(['query', '.', '--preset', 'entryPoints', '--slice', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'quality-write-rejected',
    args: Object.freeze(['quality', '.', '--write', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'providers-inspect-unknown',
    args: Object.freeze([
      'providers',
      'inspect',
      'workspai.graph.provider.unknown',
      '--json',
    ] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'quality-json',
    args: Object.freeze(['quality', '.', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-workspace-without-onboarding',
    args: Object.freeze([
      'inspect',
      '.',
      '--mode',
      'project-and-default-workspace',
      '--json',
    ] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.partial]),
  }),
  Object.freeze({
    id: 'inspect-existing-workspace-without-selection',
    args: Object.freeze([
      'inspect',
      '.',
      '--mode',
      'project-and-existing-workspace',
      '--json',
    ] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'inspect-existing-workspace-write-without-selection',
    args: Object.freeze([
      'inspect',
      '.',
      '--mode',
      'project-and-existing-workspace',
      '--write',
      '--json',
    ] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.rejected]),
  }),
  Object.freeze({
    id: 'inspect-write',
    args: Object.freeze(['inspect', '.', '--write', '--json'] as const),
    acceptedExitCodes: Object.freeze([GRAPH_CLI_EXIT_CODES.success, GRAPH_CLI_EXIT_CODES.partial]),
  }),
] as const);

export const GRAPH_STANDALONE_SUPPORT_MATRIX = Object.freeze({
  contract: GRAPH_STANDALONE_SUPPORT_MATRIX_CONTRACT,
  maturity: 'repository-preview-candidate',
  publishable: false,
  standaloneStable: false,
  publicPreview: false,
  centralCliRuntime: 'prohibited',
  nativeAcceleration: 'prohibited',
  defaultMode: 'project-only',
  workspaceParticipation: 'typed-handoff-optional',
  network: 'deny',
  runtime: { node: '>=20.19.0' },
  platforms: Object.freeze({
    linux: Object.freeze({ declared: true, remoteAdmission: 'pending' }),
    darwin: Object.freeze({ declared: true, remoteAdmission: 'pending' }),
    win32: Object.freeze({ declared: true, remoteAdmission: 'pending' }),
  }),
  languages: Object.freeze({
    node: 'official-offline',
    python: 'official-offline',
    go: 'official-offline',
    java: 'official-offline',
    dotnet: 'official-offline',
    rust: 'official-offline',
    unsupported: 'abstention',
  }),
  queryCache: GRAPH_QUERY_CACHE_OPERATING_BOUNDARY,
  externalProviderSdk: Object.freeze({
    status: 'deferred',
    until: 'standalone-stable',
  }),
  publicPreviewMigrations: Object.freeze([] as const),
  packedJobs: Object.freeze(GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id)),
  plannedCapabilities: Object.freeze([
    'standalone-stable',
    'public-preview',
    'cli-shadow-parity',
  ] as const),
  unsupportedCapabilities: Object.freeze([
    'standalone-stable',
    'public-preview',
    'cli-runtime-bridge',
    'native-acceleration',
  ] as const),
  limitations: Object.freeze([
    'incremental-orchestration-not-on-root-api',
    'git-is-not-merkle-authority',
    'similarity-barred-from-canonical-reuse',
    'query-cache-is-optional-injected-store',
    'overlays-do-not-publish-canonical-generations',
    'external-provider-sdk-deferred',
    'signed-provenance-unattested',
    'rollback-procedure-not-proven',
    'retrieval-benchmark-is-synthetic-fixture-labelled',
    'g6-cross-platform-admission-pending',
    'standalone-stable-not-admitted',
    'central-cli-runtime-prohibited',
  ] as const),
});

export const GRAPH_RETRIEVAL_BENCHMARK_CONTRACT = defineWisContract({
  id: 'workspai.graph.retrieval-benchmark',
  version: '0.1.0-candidate',
});

export const GRAPH_RETRIEVAL_BENCHMARK_CLAIM = Object.freeze({
  groundTruthClass: 'synthetic',
  accuracyClaim: 'none',
  publicAccuracyClaimPermitted: false,
} as const);

export const GRAPH_SBOM_SPEC = Object.freeze({
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  provenance: 'unattested',
  slsa: 'not-generated',
  npmProvenance: 'not-generated',
} as const);

export const GRAPH_RELEASE_INVENTORY_CONTRACT = defineWisContract({
  id: 'workspai.graph.release-inventory',
  version: '0.1.0-candidate',
});

export const GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY = Object.freeze({
  sourceMaps: 'excluded',
  governance: 'excluded',
  machineLocalPaths: 'rejected',
  secrets: 'rejected',
  catalogDigest: 'required',
  signedAttestation: 'not-generated',
  rollbackProcedure: 'not-proven',
} as const);

export const GRAPH_INCIDENT_CLASSES = Object.freeze([
  'compromised-provider-or-package',
  'contract-or-identity-regression',
  'corrupted-cache-or-artifact-generation',
  'false-authoritative-edge-or-missing-conflict',
  'secret-or-path-leakage',
  'performance-amplification',
  'cli-package-incompatibility',
] as const);

export const GRAPH_ROLLBACK_PROCEDURE = Object.freeze({
  status: 'not-proven',
  restores: 'last-supported-package-and-graph-generation',
  sourceRewrite: 'prohibited',
} as const);

export type GraphStandaloneSupportMatrix = typeof GRAPH_STANDALONE_SUPPORT_MATRIX;
export type GraphPublicExportMap = typeof GRAPH_PUBLIC_EXPORT_MAP;
export type GraphQueryCacheOperatingBoundary = typeof GRAPH_QUERY_CACHE_OPERATING_BOUNDARY;
export type GraphPackedArtifactSecurityBoundary = typeof GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY;
export type GraphIncidentClass = (typeof GRAPH_INCIDENT_CLASSES)[number];
export type GraphRollbackProcedure = typeof GRAPH_ROLLBACK_PROCEDURE;
