/* Generated from schemas/graph-slice-result.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphSliceResultCandidate {
  contract: { id: 'workspai.graph.slice-result'; version: '0.1.0-candidate' };
  profile: {};
  sourceGeneration: {};
  request: {
    intent: 'understand' | 'impact' | 'review' | 'repair' | 'release';
    /**
     * @minItems 1
     */
    subjects: [string, ...string[]];
    includeEvidence: boolean;
    redactionPolicy: string;
  };
  /**
   * @maxItems 100000
   */
  nodes: unknown[];
  /**
   * @maxItems 500000
   */
  edges: unknown[];
  /**
   * @maxItems 100000
   */
  paths: unknown[];
  /**
   * @maxItems 100000
   */
  evidence: unknown[];
  /**
   * @maxItems 100000
   */
  unknownBoundaries: unknown[];
  proofSummary: {};
  quality: {};
  explanation: {};
  cost: {};
  truncation: {};
}
