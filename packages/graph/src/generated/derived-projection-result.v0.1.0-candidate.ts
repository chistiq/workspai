/* Generated from schemas/derived-projection-result.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphDerivedProjectionResultCandidate {
  contract: { id: 'workspai.graph.derived-projection-result'; version: '0.1.0-candidate' };
  descriptor: {
    profile: {};
    algorithm: {
      id: string;
      version: string;
      seed: string;
    };
    sourceGeneration: {};
    proofThreshold: string;
    limitations: string[];
    omissions: unknown[];
    accuracyEvidence?: unknown[];
  };
  kind: 'community' | 'flow' | 'review-risk' | 'architecture-summary';
  communities?: unknown[];
  flowRanks?: unknown[];
  reviewFindings?: unknown[];
  architecture?: {};
  unknownZones: unknown[];
  unsupportedZones: unknown[];
  truncation: {
    truncated: boolean;
    reasons: 'items'[];
  };
}
