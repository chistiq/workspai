/* Generated from schemas/entity-identity.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphEntityIdentityCandidate`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string;
/**
 * This interface was referenced by `WorkspaiGraphEntityIdentityCandidate`'s JSON-Schema
 * via the `definition` "scope".
 */
export type Scope =
  | {
      kind: 'workspace';
      workspaceId: Identifier;
    }
  | {
      kind: 'project';
      workspaceId?: Identifier;
      /**
       * @minItems 1
       * @maxItems 10000
       */
      projectIds: [Identifier, ...Identifier[]];
    }
  | {
      kind: 'selection';
    }
  | {
      kind: 'organization';
      organizationId: Identifier;
      workspaceId?: Identifier;
    };

export interface WorkspaiGraphEntityIdentityCandidate {
  id: Identifier;
  identityScheme: {
    id: 'workspai.graph.portable-entity';
    version: '1';
  };
  kind: Identifier;
  scope: Scope;
  /**
   * @maxItems 1000
   */
  aliases?: {
    id: Identifier;
    reason: 'rename' | 'move' | 'canonicalization' | 'provider-alias';
  }[];
}
