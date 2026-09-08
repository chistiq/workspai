/* Generated from schemas/derivation-lineage.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphDerivationLineageCandidate {
  factId: string;
  derivation:
    'observed' | 'extracted' | 'declared' | 'computed' | 'inferred' | 'generated' | 'imported';
  /**
   * @minItems 1
   */
  evidenceRoots: [string, ...string[]];
  parentFactIds: string[];
}
