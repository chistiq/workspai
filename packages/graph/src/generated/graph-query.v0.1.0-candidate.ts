/* Generated from schemas/graph-query.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphQueryCandidate {
  contract: { id: 'workspai.graph.query'; version: '0.1.0-candidate' };
  kind:
    | 'dependencies'
    | 'owners'
    | 'impact'
    | 'entry-points'
    | 'related'
    | 'cycles'
    | 'evidence'
    | 'path'
    | 'bindings'
    | 'operational-risk'
    | 'contract-topology'
    | 'architecture-conformance';
  subject?: string;
  target?: string;
  scope?: {};
  direction?: 'outgoing' | 'incoming' | 'both';
  /**
   * @maxItems 1000
   */
  relations?: string[];
  minimumProof?:
    'supported' | 'corroborated' | 'verified' | 'disputed' | 'insufficient' | 'unresolved';
  includeDisputed?: boolean;
  strategy?: 'direct' | 'graph' | 'hybrid' | 'auto';
  bindingProfile?: {};
  utilityProfile?: {};
  budget?: {
    maxDepth?: number;
    maxNodes?: number;
    maxEdges?: number;
    maxEvidence?: number;
  };
  page?: {
    cursor?: string;
    size: number;
  };
}
