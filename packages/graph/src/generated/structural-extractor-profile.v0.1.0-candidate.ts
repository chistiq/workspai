/* Generated from schemas/structural-extractor-profile.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphStructuralExtractorProfileCandidate {
  contract: {
    id: 'workspai.graph.structural-extractor-profile';
    version: '0.1.0-candidate';
  };
  id: string;
  version: string;
  staticOnly: true;
  authority: 'observed';
  derivation: 'extracted';
  /**
   * @minItems 1
   * @maxItems 32
   */
  languages: [Language, ...Language[]];
}
/**
 * This interface was referenced by `WorkspaiGraphStructuralExtractorProfileCandidate`'s JSON-Schema
 * via the `definition` "language".
 */
export interface Language {
  language:
    | 'node'
    | 'python'
    | 'go'
    | 'java'
    | 'dotnet'
    | 'rust'
    | 'c-cpp'
    | 'objective-c-matlab'
    | 'php'
    | 'ruby'
    | 'swift';
  /**
   * @minItems 1
   * @maxItems 32
   */
  extensions: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 8
   */
  extractions:
    | ['static-imports' | 'literal-routes']
    | ['static-imports' | 'literal-routes', 'static-imports' | 'literal-routes']
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ]
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ]
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ]
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ]
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ]
    | [
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
        'static-imports' | 'literal-routes',
      ];
  /**
   * @maxItems 32
   */
  unsupportedSyntax: string[];
}
