/* Generated from schemas/provider-manifest.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphProviderManifestCandidate`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string;
/**
 * @minItems 1
 * @maxItems 1000
 *
 * This interface was referenced by `WorkspaiGraphProviderManifestCandidate`'s JSON-Schema
 * via the `definition` "nonEmptyIdentifiers".
 */
export type NonEmptyIdentifiers = [Identifier, ...Identifier[]];

export interface WorkspaiGraphProviderManifestCandidate {
  contract: { id: 'workspai.graph.provider-manifest'; version: '0.1.0-candidate' };
  id: Identifier;
  version: Identifier;
  displayName: string;
  determinism: 'deterministic' | 'seeded' | 'nondeterministic';
  capabilities: {
    entityKinds: NonEmptyIdentifiers;
    relationKinds: NonEmptyIdentifiers;
    /**
     * @minItems 1
     */
    relationSemantics: [
      'structural' | 'behavioral' | 'declarative' | 'derived',
      ...('structural' | 'behavioral' | 'declarative' | 'derived')[],
    ];
    factFamilies: NonEmptyIdentifiers;
    allowedClaims: NonEmptyIdentifiers;
  };
  permissions: {
    filesystem: 'none' | 'read';
    network: 'deny' | 'allow';
    process: 'deny' | 'allow';
    credentials: 'deny';
  };
  limits: {
    maxDurationMs: number;
    maxFacts: number;
    maxInputBytes?: number;
  };
  contractVersions: NonEmptyIdentifiers;
  supportedInputs: NonEmptyIdentifiers;
  incremental: 'none' | 'input' | 'native';
  /**
   * @minItems 1
   */
  identitySchemes: [
    {
      id: Identifier;
      version: Identifier;
    },
    ...{
      id: Identifier;
      version: Identifier;
    }[],
  ];
}
