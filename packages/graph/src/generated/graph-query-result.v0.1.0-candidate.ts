/* Generated from schemas/graph-query-result.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphQueryResultCandidate {
  contract: { id: 'workspai.graph.query-result'; version: '0.1.0-candidate' };
  query: {};
  queryDigest: {};
  generation: {};
  result: unknown;
  /**
   * @maxItems 1000
   */
  paths: unknown[];
  /**
   * @maxItems 100000
   */
  evidence: unknown[];
  /**
   * @maxItems 100000
   */
  disputes: unknown[];
  /**
   * @maxItems 100000
   */
  unknownBoundaries: unknown[];
  freshness: {};
  confidence: number;
  cost: {};
  retrievalPlan: {};
  utility: {};
  quality: {};
  analysis: {};
  truncation: {};
  /**
   * @maxItems 100000
   */
  diagnostics: unknown[];
}
