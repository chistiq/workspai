/* Generated from schemas/evidence-independence.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphEvidenceIndependenceCandidate {
  independent: boolean;
  roots: string[];
  rejectedPairs: {
    left: string;
    right: string;
    reason: 'same-root' | 'ancestor' | 'generated-sibling';
  }[];
}
