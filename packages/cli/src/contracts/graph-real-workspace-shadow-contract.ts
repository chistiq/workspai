import type {
  GraphModelAuthorityReceipt,
  GraphShadowComparisonStatus,
  GraphShadowDifferenceClass,
  GraphShadowParityReport,
} from './graph-shadow-parity-contract.js';

export const GRAPH_REAL_WORKSPACE_INVENTORY_SCHEMA_VERSION =
  'workspai.graph-real-workspace-inventory.v1' as const;

export const GRAPH_REAL_WORKSPACE_QUALIFICATION_SCHEMA_VERSION =
  'workspai.graph-real-workspace-qualification.v1-candidate' as const;

export const GRAPH_G8_REAL_WORKSPACE_PLATFORM_REPORT_SCHEMA_VERSION =
  'workspai.graph-g8-real-workspace-platform-report.v1-candidate' as const;

export const GRAPH_G8_REAL_WORKSPACE_MATRIX_ADMISSION_SCHEMA_VERSION =
  'workspai.graph-g8-real-workspace-matrix-admission.v1-candidate' as const;

export const GRAPH_REAL_WORKSPACE_APPROVALS_V1_SCHEMA_VERSION =
  'workspai.graph-real-workspace-approvals.v1' as const;

export const GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION =
  'workspai.graph-real-workspace-approvals.v2' as const;

export const GRAPH_REAL_WORKSPACE_PROFILE = 'g8-real-workspace.v1' as const;

export const GRAPH_REAL_WORKSPACE_PRIMARY_DIFFERENCE_CODES = [
  'GRAPH_SHADOW_NODE_LEGACY_ONLY',
  'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
  'GRAPH_SHADOW_RELATION_LEGACY_ONLY',
  'GRAPH_SHADOW_RELATION_PACKAGE_ONLY',
  'GRAPH_SHADOW_PROOF_LEGACY_ONLY',
  'GRAPH_SHADOW_PROOF_PACKAGE_ONLY',
  'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL',
  'GRAPH_SHADOW_UNKNOWN_FAMILY_UNMAPPED',
  'GRAPH_SHADOW_UNKNOWN_ZONE_LEGACY_ONLY',
  'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
  'GRAPH_SHADOW_COMPLETENESS_DIFFERENT',
  'GRAPH_SHADOW_DIAGNOSTIC_LEGACY_ONLY',
  'GRAPH_SHADOW_DIAGNOSTIC_PACKAGE_ONLY',
] as const;

export type GraphRealWorkspaceTargetKind = 'committed-fixture' | 'local-reference';

export type GraphRealWorkspaceObservationStatus =
  'compared' | 'unavailable-local-observation' | 'failed';

export interface GraphRealWorkspaceInventoryEntry {
  readonly id: string;
  readonly kind: GraphRealWorkspaceTargetKind;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly relativeRoot?: string;
  readonly directoryName?: string;
  readonly trustedBaseline: boolean;
  readonly requiredFor: readonly ('regression' | 'cross-platform' | 'local-observation')[];
}

export interface GraphRealWorkspaceInventory {
  readonly schemaVersion: typeof GRAPH_REAL_WORKSPACE_INVENTORY_SCHEMA_VERSION;
  readonly profile: typeof GRAPH_REAL_WORKSPACE_PROFILE;
  readonly mappingVersion: string;
  readonly required: readonly GraphRealWorkspaceInventoryEntry[];
  readonly optionalLocalReferences: readonly GraphRealWorkspaceInventoryEntry[];
}

export interface GraphRealWorkspaceApprovalRecord {
  readonly corpusId: string;
  readonly sourceTreeDigest: string;
  readonly mappingVersion: string;
  readonly code: string;
  readonly key: string;
  readonly setDigest: string;
  readonly classification: Exclude<GraphShadowDifferenceClass, 'regression'>;
  readonly reason: string;
}

export interface GraphRealWorkspaceApprovals {
  readonly schemaVersion: typeof GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION;
  readonly mappingVersion: string;
  readonly records: readonly GraphRealWorkspaceApprovalRecord[];
}

export interface GraphRealWorkspaceLimits {
  readonly maxNodes: number;
  readonly maxRelations: number;
  readonly maxProofs: number;
  readonly maxDiagnostics: number;
  readonly maxFileBytes: number;
  readonly maxControlBytes: number;
  readonly timeoutMs: number;
  readonly inventoryFileLimit: number;
  readonly maxFilesPerProject: number;
  readonly maxCopyDepth: number;
  readonly maxEntriesPerDirectory: number;
  readonly maxCopiedFileBytes: number;
  readonly maxCopiedFiles: number;
}

export interface GraphRealWorkspaceObservation {
  readonly id: string;
  readonly kind: GraphRealWorkspaceTargetKind;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly status: GraphRealWorkspaceObservationStatus;
  readonly reason?: string;
  readonly packageExecution?: {
    readonly status: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
    readonly inputFiles: number;
    readonly omittedFiles: number;
    readonly omittedBytes: number;
    readonly providerFacts: number;
    readonly workspaceId: string;
  };
  readonly comparison?: {
    readonly status: GraphShadowComparisonStatus;
    readonly mappingVersion: string;
    readonly reportDigest: string;
    readonly semanticOutputDigest: string;
    readonly sourceTreeDigest: string;
    readonly regressions: number;
    readonly approvedDifferences: number;
    readonly differenceCodes: readonly string[];
    readonly sourceFixtureDigest: string;
    readonly scopeDigest: string;
    readonly providerProfileDigest: string;
    readonly graphPolicyDigest: string;
    readonly redactionAuthorizationDigest: string;
    readonly resourceBudgetDigest: string;
  };
  readonly report?: GraphShadowParityReport;
  readonly copyBudget?: {
    readonly observedFiles: number;
    readonly maxCopiedFiles: number;
    readonly maxCopiedFileBytes: number;
    readonly truncated: boolean;
  };
}

export interface GraphRealWorkspaceQualificationResult {
  readonly schemaVersion: typeof GRAPH_REAL_WORKSPACE_QUALIFICATION_SCHEMA_VERSION;
  readonly profile: typeof GRAPH_REAL_WORKSPACE_PROFILE;
  readonly inventoryDigest: string;
  readonly mappingVersion: string;
  readonly observations: readonly GraphRealWorkspaceObservation[];
  readonly mutatedCanonicalArtifacts: boolean;
  readonly usedProcessCwdAsAuthority: boolean;
  readonly receipt: GraphModelAuthorityReceipt;
}

export interface GraphG8RealWorkspacePlatformReport {
  readonly schemaVersion: typeof GRAPH_G8_REAL_WORKSPACE_PLATFORM_REPORT_SCHEMA_VERSION;
  readonly package: '@workspai/graph';
  readonly stage: 'G8';
  readonly checkpoint: 'real-workspace-cross-platform-parity';
  readonly status: 'passed-platform' | 'failed';
  readonly admitted: false;
  readonly nextStage: 'G9';
  readonly nextStageAuthorized: false;
  readonly crossPlatformAdmission: 'pending';
  readonly currentGraphAuthority: 'official-internal-graph-capability';
  readonly authorizedRuntimeMode: 'g8-shadow-comparison-only';
  readonly mappingVersion: string;
  readonly inventoryDigest: string;
  readonly sourceFixtureDigest: string;
  readonly sourceTreeDigest: string;
  readonly scopeDigest: string;
  readonly providerProfileDigest: string;
  readonly graphPolicyDigest: string;
  readonly redactionAuthorizationDigest: string;
  readonly resourceBudgetDigest: string;
  readonly reportDigest: string;
  readonly semanticOutputDigest: string;
  readonly comparisonStatus: GraphShadowComparisonStatus;
  readonly differenceCodes: readonly string[];
  readonly packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
  readonly environment: {
    readonly platform: 'linux' | 'darwin' | 'win32';
    readonly architecture: string;
    readonly node: string;
  };
  readonly platformEvidence: {
    readonly status: 'passed' | 'failed';
    readonly runnerOs: 'Linux' | 'macOS' | 'Windows';
    readonly runnerArch: string;
  };
  readonly ci: {
    readonly provider: 'github-actions';
    readonly runId: string;
    readonly event: 'pull_request' | 'push';
    readonly sourceCommit: string;
    readonly testedCommit: string;
  };
  readonly versions: {
    readonly cli: { readonly version: string; readonly commit: string };
    readonly graphPackage: { readonly version: string; readonly commit: string };
  };
  readonly qualification: GraphRealWorkspaceQualificationResult;
  readonly receipt: GraphModelAuthorityReceipt;
  readonly failures: readonly string[];
}
