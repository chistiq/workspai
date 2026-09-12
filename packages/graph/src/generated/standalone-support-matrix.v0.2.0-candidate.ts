/* Generated from schemas/standalone-support-matrix.v0.2.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphStandaloneSupportMatrixV020Candidate {
  contract: { id: 'workspai.graph.standalone-support-matrix'; version: '0.2.0-candidate' };
  maturity: 'internal-stable';
  distribution: 'internal-only';
  npmPublication: 'prohibited';
  publishable: false;
  standaloneStable: true;
  publicPreview: false;
  centralCliRuntime: 'shadow-comparison-only';
  nativeAcceleration: 'bundled-wasm-candidate';
  rustEngineTarget: {
    implementation: 'bundled-conformance-candidate';
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
    'c-cpp': 'official-offline';
    'objective-c-matlab': 'official-offline';
    php: 'official-offline';
    ruby: 'official-offline';
    swift: 'official-offline';
    elixir: 'official-offline';
    kotlin: 'official-offline';
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
    until: 'cli-shadow-parity';
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
    'standalone-stable' | 'cli-shadow-parity',
    ...('standalone-stable' | 'cli-shadow-parity')[],
  ];
  /**
   * @minItems 1
   */
  unsupportedCapabilities: [
    'standalone-stable' | 'cli-runtime-bridge' | 'native-acceleration-as-primary',
    ...('standalone-stable' | 'cli-runtime-bridge' | 'native-acceleration-as-primary')[],
  ];
  /**
   * @minItems 1
   */
  limitations: [string, ...string[]];
}
/**
 * This interface was referenced by `WorkspaiGraphStandaloneSupportMatrixV020Candidate`'s JSON-Schema
 * via the `definition` "platform".
 */
export interface Platform {
  declared: true;
  remoteAdmission: 'admitted';
}
