/* Generated from schemas/binding-profile.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphBindingProfileCandidate {
  contract: { id: 'workspai.graph.binding-profile'; version: '0.1.0-candidate' };
  id: string;
  version: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  sourceKinds: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 64
   */
  steps: [
    {
      /**
       * @minItems 1
       * @maxItems 100
       */
      relations: [string, ...string[]];
      direction: 'outgoing' | 'incoming' | 'both';
      /**
       * @minItems 1
       * @maxItems 4
       */
      semantics:
        | ['structural' | 'behavioral' | 'declarative' | 'derived']
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ]
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ]
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ];
      /**
       * @maxItems 100
       */
      targetKinds?: string[];
    },
    ...{
      /**
       * @minItems 1
       * @maxItems 100
       */
      relations: [string, ...string[]];
      direction: 'outgoing' | 'incoming' | 'both';
      /**
       * @minItems 1
       * @maxItems 4
       */
      semantics:
        | ['structural' | 'behavioral' | 'declarative' | 'derived']
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ]
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ]
        | [
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
            'structural' | 'behavioral' | 'declarative' | 'derived',
          ];
      /**
       * @maxItems 100
       */
      targetKinds?: string[];
    }[],
  ];
  minimumProof:
    'supported' | 'corroborated' | 'verified' | 'disputed' | 'insufficient' | 'unresolved';
}
