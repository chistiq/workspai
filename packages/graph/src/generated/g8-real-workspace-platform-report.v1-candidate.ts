/* Generated from schemas/g8-real-workspace-platform-report.v1-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "mappingVersion".
 */
export type MappingVersion = string;
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "sha256".
 */
export type Sha256 = string;
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "commit".
 */
export type Commit = string;
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "portableId".
 */
export type PortableId = string;

export interface WorkspaiGraphG8RealWorkspacePlatformReportCandidate {
  schemaVersion: 'workspai.graph-g8-real-workspace-platform-report.v1-candidate';
  package: '@workspai/graph';
  stage: 'G8';
  checkpoint: 'real-workspace-cross-platform-parity';
  status: 'passed-platform' | 'failed';
  admitted: false;
  nextStage: 'G9';
  nextStageAuthorized: false;
  crossPlatformAdmission: 'pending';
  currentGraphAuthority: 'official-internal-graph-capability';
  authorizedRuntimeMode: 'g8-shadow-comparison-only';
  mappingVersion: MappingVersion;
  inventoryDigest: Sha256;
  sourceFixtureDigest: Sha256;
  sourceTreeDigest: Sha256;
  scopeDigest: Sha256;
  providerProfileDigest: Sha256;
  graphPolicyDigest: Sha256;
  redactionAuthorizationDigest: Sha256;
  resourceBudgetDigest: Sha256;
  reportDigest: Sha256;
  semanticOutputDigest: Sha256;
  comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
  /**
   * @maxItems 32
   */
  differenceCodes: string[];
  packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
  environment: {
    platform: 'linux' | 'darwin' | 'win32';
    architecture: string;
    node: string;
  };
  platformEvidence: {
    status: 'passed' | 'failed';
    runnerOs: 'Linux' | 'macOS' | 'Windows';
    runnerArch: string;
  };
  ci: {
    provider: 'github-actions';
    runId: string;
    event: 'pull_request' | 'push';
    sourceCommit: Commit;
    testedCommit: Commit;
  };
  versions: {
    cli: VersionBinding;
    graphPackage: VersionBinding;
  };
  qualification: Qualification;
  receipt: Receipt;
  /**
   * @maxItems 64
   */
  failures: string[];
}
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "versionBinding".
 */
export interface VersionBinding {
  version: string;
  commit: Commit;
}
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "qualification".
 */
export interface Qualification {
  schemaVersion: 'workspai.graph-real-workspace-qualification.v1-candidate';
  profile: 'g8-real-workspace.v1';
  inventoryDigest: Sha256;
  mappingVersion: MappingVersion;
  /**
   * @minItems 1
   * @maxItems 8
   */
  observations:
    | [Observation]
    | [Observation, Observation]
    | [Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation, Observation, Observation]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
      ];
  mutatedCanonicalArtifacts: boolean;
  usedProcessCwdAsAuthority: boolean;
  receipt: Receipt;
}
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "observation".
 */
export interface Observation {
  id: PortableId;
  kind: 'committed-fixture' | 'local-reference';
  projectId: PortableId;
  status: 'compared' | 'unavailable-local-observation' | 'failed';
  reason?: string;
  packageExecution?: {
    status: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
    inputFiles: number;
    providerFacts: number;
  };
  comparison?: {
    status: 'equivalent' | 'different' | 'incomparable' | 'failed';
    mappingVersion: MappingVersion;
    reportDigest: Sha256;
    semanticOutputDigest: Sha256;
    sourceTreeDigest: Sha256;
    regressions: number;
    approvedDifferences: number;
    /**
     * @maxItems 32
     */
    differenceCodes: string[];
    sourceFixtureDigest: Sha256;
    scopeDigest: Sha256;
    providerProfileDigest: Sha256;
    graphPolicyDigest: Sha256;
    redactionAuthorizationDigest: Sha256;
    resourceBudgetDigest: Sha256;
  };
}
/**
 * This interface was referenced by `WorkspaiGraphG8RealWorkspacePlatformReportCandidate`'s JSON-Schema
 * via the `definition` "receipt".
 */
export interface Receipt {
  schemaVersion: 'workspai.graph-model-authority-receipt.v1-candidate';
  epoch: 'package-shadow';
  executionPath: 'compared';
  comparison: {
    status: 'equivalent' | 'different' | 'incomparable' | 'failed';
    profile: string;
    reportDigest: Sha256;
  };
  authority: 'released-cli';
  packageWrites: 'prohibited';
  fallback: 'prohibited';
}
