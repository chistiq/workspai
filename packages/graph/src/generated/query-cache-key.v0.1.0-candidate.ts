/* Generated from schemas/query-cache-key.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphQueryCacheKeyCandidate {
  contract: { id: 'workspai.graph.query-cache'; version: '0.1.0-candidate' };
  graphGeneration: {};
  queryDigest: {};
  ontologyDigest: {};
  proofPolicyDigest: {};
  profileDigest: {};
  plannerProfileDigest: {};
  resultProfileDigest: {};
  /**
   * @maxItems 1000
   */
  projectionDigests: {}[];
  /**
   * @maxItems 1000
   */
  indexDigests: {}[];
  /**
   * @maxItems 1000
   */
  requiredExtensions: {}[];
  overlayDigest?: {};
  scope: {};
  redactionPolicyDigest: {};
  authorizationDigest: {};
  budget: {
    maxDepth: number;
    maxNodes: number;
    maxEdges: number;
    maxEvidence: number;
  };
  page?: {
    cursor: string;
    size: number;
  };
}
