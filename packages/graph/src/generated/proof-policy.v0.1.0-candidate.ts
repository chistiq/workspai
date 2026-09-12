/* Generated from schemas/proof-policy.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphProofPolicyCandidate {
  contract: { id: 'workspai.graph.proof-policy'; version: '0.1.0-candidate' };
  id: string;
  version: string;
  minimumAuthority: 'declared' | 'observed' | 'verified' | 'inferred';
  minimumIndependentRoots: number;
  verificationRequired: boolean;
  allowDisputed: boolean;
  allowStale: boolean;
}
