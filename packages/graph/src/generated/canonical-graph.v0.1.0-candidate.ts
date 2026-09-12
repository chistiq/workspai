/* Generated from schemas/canonical-graph.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiCanonicalGraphCandidate {
  contract: { id: 'workspai.graph.canonical-graph'; version: '0.1.0-candidate' };
  graphVersion: string;
  generation: {};
  /**
   * @minItems 1
   */
  ontology: [unknown, ...unknown[]];
  /**
   * @maxItems 10000000
   */
  nodes: unknown[];
  /**
   * @maxItems 50000000
   */
  edges: unknown[];
  /**
   * @maxItems 10000000
   */
  assertions: unknown[];
  /**
   * @maxItems 1000000
   */
  disputes: unknown[];
  /**
   * @maxItems 1000000
   */
  unresolved: unknown[];
  /**
   * @maxItems 10000
   */
  diagnostics: unknown[];
}
