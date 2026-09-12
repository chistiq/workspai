import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_STRUCTURAL_EXTRACTOR_PROFILE_CONTRACT = defineWisContract({
  id: 'workspai.graph.structural-extractor-profile',
  version: '0.1.0-candidate',
});

export type GraphStructuralLanguage =
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
export type GraphStructuralExtraction = 'static-imports' | 'literal-routes';

export interface GraphStructuralLanguageProfile {
  readonly language: GraphStructuralLanguage;
  readonly extensions: readonly string[];
  readonly extractions: readonly GraphStructuralExtraction[];
  readonly unsupportedSyntax: readonly string[];
}

export interface GraphStructuralExtractorProfile {
  readonly contract: typeof GRAPH_STRUCTURAL_EXTRACTOR_PROFILE_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly staticOnly: true;
  readonly authority: 'observed';
  readonly derivation: 'extracted';
  readonly languages: readonly GraphStructuralLanguageProfile[];
}

export const GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE: GraphStructuralExtractorProfile =
  Object.freeze({
    contract: GRAPH_STRUCTURAL_EXTRACTOR_PROFILE_CONTRACT,
    id: 'workspai.graph.structural-extractor.standard',
    version: '0.1.0-candidate',
    staticOnly: true,
    authority: 'observed',
    derivation: 'extracted',
    languages: Object.freeze([
      Object.freeze({
        language: 'node',
        extensions: Object.freeze(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']),
        extractions: Object.freeze(['static-imports', 'literal-routes'] as const),
        unsupportedSyntax: Object.freeze(['dynamic-import', 'computed-route']),
      }),
      Object.freeze({
        language: 'python',
        extensions: Object.freeze(['.py']),
        extractions: Object.freeze(['static-imports', 'literal-routes'] as const),
        unsupportedSyntax: Object.freeze(['dynamic-import', 'computed-route']),
      }),
      Object.freeze({
        language: 'go',
        extensions: Object.freeze(['.go']),
        extractions: Object.freeze(['static-imports', 'literal-routes'] as const),
        unsupportedSyntax: Object.freeze(['plugin-load', 'computed-route']),
      }),
      Object.freeze({
        language: 'java',
        extensions: Object.freeze(['.java']),
        extractions: Object.freeze(['static-imports', 'literal-routes'] as const),
        unsupportedSyntax: Object.freeze(['reflective-load', 'composed-route-annotation']),
      }),
      Object.freeze({
        language: 'dotnet',
        extensions: Object.freeze(['.cs']),
        extractions: Object.freeze(['static-imports', 'literal-routes'] as const),
        unsupportedSyntax: Object.freeze(['assembly-load', 'computed-route']),
      }),
      Object.freeze({
        language: 'rust',
        extensions: Object.freeze(['.rs']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['dynamic-library-load', 'framework-route-macro']),
      }),
      Object.freeze({
        language: 'c-cpp',
        extensions: Object.freeze(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['dynamic-library-load', 'generated-include-path']),
      }),
      Object.freeze({
        language: 'objective-c-matlab',
        extensions: Object.freeze(['.m', '.mm']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['runtime-class-load', 'dynamic-path-import']),
      }),
      Object.freeze({
        language: 'php',
        extensions: Object.freeze(['.php']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['variable-include', 'runtime-class-load']),
      }),
      Object.freeze({
        language: 'ruby',
        extensions: Object.freeze(['.rb']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['computed-require', 'autoload']),
      }),
      Object.freeze({
        language: 'swift',
        extensions: Object.freeze(['.swift']),
        extractions: Object.freeze(['static-imports'] as const),
        unsupportedSyntax: Object.freeze(['dynamic-library-load']),
      }),
    ]),
  });
