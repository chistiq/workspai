/* Generated from schemas/graph-change-overlay.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphChangeOverlayCandidate {
  contract: { id: 'workspai.graph.change-overlay'; version: '0.1.0-candidate' };
  id: string;
  baseGeneration: {
    id: string;
    generatedAt: string;
    contentDigest: {};
  };
  proposal: {
    kind: 'patch' | 'working-tree' | 'branch' | 'pull-request' | 'external';
    identity: string;
    digest: string;
  };
  status: 'complete' | 'partial' | 'failed' | 'stale';
  proposedChangeSet: {};
  predictedDelta: {};
  quality: {};
  unknownZones: unknown[];
  diagnostics: unknown[];
  generatedAt: string;
  expiresAt?: string;
}
