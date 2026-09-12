/* Generated from schemas/query-cache-invalidation.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphQueryCacheInvalidationCandidate {
  contract: { id: 'workspai.graph.query-cache-invalidation'; version: '0.1.0-candidate' };
  /**
   * @minItems 1
   */
  keyDigests: [{}, ...{}[]];
  reason:
    | 'generation'
    | 'ontology'
    | 'proof-policy'
    | 'profile'
    | 'scope'
    | 'redaction'
    | 'authorization'
    | 'corruption';
}
