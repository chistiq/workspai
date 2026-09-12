/* Generated from schemas/review-context-slice.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphReviewContextSliceCandidate {
  contract: { id: 'workspai.graph.review-context-slice'; version: '0.1.0-candidate' };
  profile: {};
  sourceGeneration: {};
  sourceQueryDigest: {};
  /**
   * @maxItems 10000
   */
  entities: unknown[];
  /**
   * @maxItems 10000
   */
  paths: unknown[];
  /**
   * @maxItems 10000
   */
  evidence: unknown[];
  /**
   * @maxItems 10000
   */
  disputes: unknown[];
  /**
   * @maxItems 10000
   */
  unknownBoundaries: unknown[];
  sourceCost: {};
  quality: {};
  analysis: {};
  cost: {
    candidateItems: number;
    returnedItems: number;
    contentBytes: number;
  };
  truncation: {
    truncated: boolean;
    reasons: ('entities' | 'paths' | 'evidence' | 'disputes' | 'unknown-zones' | 'content-bytes')[];
  };
}
