/* Generated from schemas/ontology-profile.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphOntologyProfileCandidate {
  contract: { id: 'workspai.graph.ontology-profile'; version: '0.1.0-candidate' };
  id: string;
  version: string;
  extends?: {}[];
  /**
   * @minItems 1
   */
  entities: [
    {
      kind: string;
      family: string;
      extensionNamespace?: string;
    },
    ...{
      kind: string;
      family: string;
      extensionNamespace?: string;
    }[],
  ];
  /**
   * @minItems 1
   */
  relations: [
    {
      kind: string;
      semantics: 'structural' | 'behavioral' | 'declarative' | 'derived';
      /**
       * @minItems 1
       */
      subjectFamilies: [string, ...string[]];
      /**
       * @minItems 1
       */
      objectFamilies: [string, ...string[]];
      inverse?: string;
      symmetric: boolean;
      transitive: boolean;
      /**
       * @minItems 1
       */
      allowedAuthorities: [
        'declared' | 'observed' | 'verified' | 'inferred',
        ...('declared' | 'observed' | 'verified' | 'inferred')[],
      ];
      proofPolicy: {};
      extensionNamespace?: string;
    },
    ...{
      kind: string;
      semantics: 'structural' | 'behavioral' | 'declarative' | 'derived';
      /**
       * @minItems 1
       */
      subjectFamilies: [string, ...string[]];
      /**
       * @minItems 1
       */
      objectFamilies: [string, ...string[]];
      inverse?: string;
      symmetric: boolean;
      transitive: boolean;
      /**
       * @minItems 1
       */
      allowedAuthorities: [
        'declared' | 'observed' | 'verified' | 'inferred',
        ...('declared' | 'observed' | 'verified' | 'inferred')[],
      ];
      proofPolicy: {};
      extensionNamespace?: string;
    }[],
  ];
}
