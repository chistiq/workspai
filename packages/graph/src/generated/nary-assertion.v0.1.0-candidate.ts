/* Generated from schemas/nary-assertion.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphNaryAssertionCandidate {
  contract: { id: 'workspai.graph.nary-assertion'; version: '0.1.0-candidate' };
  id: string;
  relation: string;
  profile: {};
  /**
   * @minItems 2
   * @maxItems 1000
   */
  participants: [
    {
      role: string;
      entity: {};
      ordinal?: number;
    },
    {
      role: string;
      entity: {};
      ordinal?: number;
    },
    ...{
      role: string;
      entity: {};
      ordinal?: number;
    }[],
  ];
  /**
   * @minItems 1
   */
  facts: [string, ...string[]];
  derivation:
    'observed' | 'extracted' | 'declared' | 'computed' | 'inferred' | 'generated' | 'imported';
  state: 'accepted' | 'disputed' | 'rejected' | 'unresolved';
  proof: {};
  freshness: {};
  confidence: number;
}
