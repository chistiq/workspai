/* Generated from schemas/repository-preview-view.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphRepositoryPreviewViewCandidate {
  contract: { id: 'workspai.graph.repository-preview-view'; version: '0.1.0-candidate' };
  profile: {};
  sourceGeneration: {};
  view: 'source' | 'structural' | 'evidence';
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
