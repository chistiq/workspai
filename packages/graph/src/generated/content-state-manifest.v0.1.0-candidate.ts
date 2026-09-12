/* Generated from schemas/content-state-manifest.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphContentStateManifestCandidate`'s JSON-Schema
 * via the `definition` "contentNode".
 */
export type ContentNode = FileLeaf | DirectoryNode;

export interface WorkspaiGraphContentStateManifestCandidate {
  contract: { id: 'workspai.graph.content-state-manifest'; version: '0.1.0-candidate' };
  scope: {
    kind: 'project' | 'workspace';
    projectIds?: string[];
    workspaceId?: string;
  };
  merkleRoot: Digest;
  /**
   * @maxItems 1000000
   */
  nodes: ContentNode[];
  /**
   * @maxItems 100000
   */
  shardDependencies: ShardDependency[];
  generatedAt: string;
}
/**
 * This interface was referenced by `WorkspaiGraphContentStateManifestCandidate`'s JSON-Schema
 * via the `definition` "digest".
 */
export interface Digest {
  algorithm: 'sha256';
  value: string;
}
/**
 * This interface was referenced by `WorkspaiGraphContentStateManifestCandidate`'s JSON-Schema
 * via the `definition` "fileLeaf".
 */
export interface FileLeaf {
  kind: 'file';
  locator: string;
  contentDigest: Digest;
  inputKind: string;
  scanProfileDigest: Digest;
  observations?: {
    sizeBytes?: number;
    modifiedAt?: string;
    gitStatus?: string;
  };
}
/**
 * This interface was referenced by `WorkspaiGraphContentStateManifestCandidate`'s JSON-Schema
 * via the `definition` "directoryNode".
 */
export interface DirectoryNode {
  kind: 'directory';
  locator: string;
  digest: Digest;
  /**
   * @maxItems 1000000
   */
  children: {
    name: string;
    kind: 'file' | 'directory';
    digest: Digest;
  }[];
}
/**
 * This interface was referenced by `WorkspaiGraphContentStateManifestCandidate`'s JSON-Schema
 * via the `definition` "shardDependency".
 */
export interface ShardDependency {
  shardId: string;
  contentDigest: Digest;
  /**
   * @maxItems 1000
   */
  semanticDependencies: Digest[];
  /**
   * @maxItems 1000
   */
  providerStages: string[];
  /**
   * @maxItems 1000
   */
  graphRegions: string[];
  /**
   * @maxItems 1000
   */
  projections: string[];
  /**
   * @maxItems 1000
   */
  queryIndexes: string[];
}
