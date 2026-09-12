/* Generated from schemas/retrieval-plan.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphRetrievalPlanCandidate {
  contract: { id: 'workspai.graph.retrieval-plan'; version: '0.1.0-candidate' };
  profile: {};
  /**
   * @minItems 3
   * @maxItems 3
   */
  candidates: [{}, {}, {}];
  selected: 'direct' | 'graph' | 'hybrid';
  fallbackReason?: string;
  budget: {};
}
