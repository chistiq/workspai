/* Generated from schemas/projection-result.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphProjectionResultCandidate {
  contract: { id: 'workspai.graph.projection-result'; version: '0.1.0-candidate' };
  profile: {};
  sourceGeneration: {};
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
  evidence: unknown[];
  /**
   * @maxItems 100000
   */
  unknownZones: unknown[];
  /**
   * @maxItems 100000
   */
  unsupportedZones: unknown[];
  omitted: {
    entityKinds: string[];
    relationSemantics: string[];
    relations: string[];
  };
  cost: {
    scannedNodes: number;
    scannedEdges: number;
    returnedNodes: number;
    returnedEdges: number;
    returnedEvidence: number;
  };
  truncation: {
    truncated: boolean;
    reasons: ('nodes' | 'edges' | 'evidence')[];
  };
}
