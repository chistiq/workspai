/* Generated from schemas/g8-real-workspace-matrix-admission.v1-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphG8RealWorkspaceMatrixAdmissionCandidate {
  schemaVersion: 'workspai.graph-g8-real-workspace-matrix-admission.v1-candidate';
  package: '@workspai/graph';
  stage: 'G8';
  checkpoint: 'real-workspace-cross-platform-parity';
  status: 'pr-candidate' | 'admitted-candidate' | 'blocked';
  admitted: boolean;
  nextStage: 'G9';
  nextStageAuthorized: false;
  crossPlatformAdmission: 'pending';
  currentGraphAuthority: 'official-internal-graph-capability';
  authorizedRuntimeMode: 'g8-shadow-comparison-only';
  sourceCommit: string;
  testedCommit: string;
  runId: string;
  event: 'pull_request' | 'push';
  inventoryDigest: string;
  mappingVersion: string;
  /**
   * @minItems 3
   * @maxItems 3
   */
  requiredRunnerOperatingSystems: [
    'Linux' | 'macOS' | 'Windows',
    'Linux' | 'macOS' | 'Windows',
    'Linux' | 'macOS' | 'Windows',
  ];
  /**
   * @minItems 0
   * @maxItems 3
   */
  evidence:
    | []
    | [
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
      ]
    | [
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
      ]
    | [
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
        {
          runnerOs: 'Linux' | 'macOS' | 'Windows';
          runnerArch: string;
          node: string;
          runId: string;
          digest: string;
          reportDigest: string;
          semanticOutputDigest: string;
          sourceTreeDigest: string;
          scopeDigest: string;
          providerProfileDigest: string;
          graphPolicyDigest: string;
          resourceBudgetDigest: string;
          redactionAuthorizationDigest: string;
          comparisonStatus: 'equivalent' | 'different' | 'incomparable' | 'failed';
          /**
           * @maxItems 32
           */
          differenceCodes: string[];
          packageExecutionStatus: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
        },
      ];
  /**
   * @maxItems 64
   */
  failures: string[];
}
