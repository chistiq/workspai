/* Generated from schemas/standalone-support-matrix.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphStandaloneSupportMatrixCandidate {
  contract: { id: 'workspai.graph.standalone-support-matrix'; version: '0.1.0-candidate' };
  maturity: 'repository-preview-candidate';
  distribution: 'internal-only';
  npmPublication: 'prohibited';
  publishable: false;
  standaloneStable: false;
  publicPreview: false;
  centralCliRuntime: 'prohibited';
  nativeAcceleration: 'prohibited';
  rustEngineTarget: {
    implementation: 'required-in-g8';
    baselineArtifact: 'product-bundled-wasm';
    activation: 'evidence-gated';
    semanticOwner: '@workspai/graph';
    referenceRuntime: 'typescript-node';
    userToolchain: 'prohibited';
    dynamicDownload: 'prohibited';
    fallback: 'parity-qualified-typescript';
  };
  defaultMode: 'project-only';
  workspaceParticipation: 'typed-handoff-optional';
  network: 'deny';
  runtime: {
    node: '>=20.19.0';
  };
  platforms: {
    linux: Platform;
    darwin: Platform;
    win32: Platform;
  };
  languages: {
    node: 'official-offline';
    python: 'official-offline';
    go: 'official-offline';
    java: 'official-offline';
    dotnet: 'official-offline';
    rust: 'official-offline';
    unsupported: 'abstention';
  };
  queryCache: {
    defaultStore: 'none';
    hostPersistence: 'injected-only';
    network: 'deny';
    resultEnvelopeCacheField: 'prohibited';
    historicalRetention: 'generation-keyed-until-policy-revocation';
    latestGenerationAlias: 'rejected';
    secrets: 'redaction-policy-digest-bound';
    canonicalReuseIdentity: 'exact-digest';
  };
  externalProviderSdk: {
    status: 'deferred';
    until: 'standalone-stable';
  };
  /**
   * @maxItems 0
   */
  publicPreviewMigrations: [];
  /**
   * @minItems 1
   * @maxItems 32
   */
  packedJobs: [string, ...string[]];
  /**
   * @minItems 1
   */
  plannedCapabilities: [
    'standalone-stable' | 'rust-wasm-engine' | 'cli-shadow-parity',
    ...('standalone-stable' | 'rust-wasm-engine' | 'cli-shadow-parity')[],
  ];
  /**
   * @minItems 1
   */
  unsupportedCapabilities: [
    'standalone-stable' | 'cli-runtime-bridge' | 'native-acceleration',
    ...('standalone-stable' | 'cli-runtime-bridge' | 'native-acceleration')[],
  ];
  /**
   * @minItems 1
   */
  limitations: [string, ...string[]];
}
/**
 * This interface was referenced by `WorkspaiGraphStandaloneSupportMatrixCandidate`'s JSON-Schema
 * via the `definition` "platform".
 */
export interface Platform {
  declared: true;
  remoteAdmission: 'pending';
}
