/* Generated from schemas/proposed-graph-delta.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphProposedGraphDeltaCandidate {
  contract: { id: 'workspai.graph.proposed-graph-delta'; version: '0.1.0-candidate' };
  baseGeneration: string;
  targetOverlay: string;
  /**
   * @maxItems 1000000
   */
  changedInputs: {}[];
  /**
   * @maxItems 10000
   */
  affectedProviders: string[];
  facts: {
    added: string[];
    renewed: string[];
    removed: string[];
    invalidated: string[];
  };
  graph: {
    addedNodes: string[];
    removedNodes: string[];
    changedNodes: string[];
    changedEdges: string[];
    addedAssertions: string[];
    removedAssertions: string[];
    changedAssertions: string[];
  };
  /**
   * @maxItems 10000
   */
  affectedProjections: string[];
  /**
   * @maxItems 100000
   */
  downstreamInvalidations: string[];
  execution: {};
  equivalence: 'pass' | 'attention' | 'blocked' | 'not-assessed';
}
