/**
 * Tiered extraction classification. Detecting a file extension is inventory, not
 * semantic language support. Syntax-aware parsing is admitted only where a
 * dedicated extractor exists; literals/comments masking remains a fallback.
 */
export type GraphExtractionTier =
  'inventory' | 'syntax-scan' | 'module-resolution' | 'semantic' | 'unsupported';

export type GraphExtractionSupport = 'supported' | 'partial' | 'unsupported';

export interface GraphExtractionSupportClaim {
  readonly language: string;
  readonly factClass: string;
  readonly tier: GraphExtractionTier;
  readonly support: GraphExtractionSupport;
  readonly notes: string;
}

function claim(
  language: string,
  factClass: string,
  tier: GraphExtractionTier,
  support: GraphExtractionSupport,
  notes: string
): GraphExtractionSupportClaim {
  return Object.freeze({ language, factClass, tier, support, notes });
}

export const GRAPH_EXTRACTION_SUPPORT: readonly GraphExtractionSupportClaim[] = Object.freeze([
  claim('javascript', 'files', 'inventory', 'supported', 'Portable locators and content digests.'),
  claim(
    'javascript',
    'imports',
    'module-resolution',
    'partial',
    'Literal ESM/CJS specifiers with relative resolution; dynamic specifiers stay unknown.'
  ),
  claim(
    'javascript',
    'declarations',
    'syntax-scan',
    'partial',
    'Keyword and native declaration scan; not a full JS parser.'
  ),
  claim(
    'javascript',
    'calls',
    'module-resolution',
    'partial',
    'Conservative named binding; collisions stay ambiguous.'
  ),
  claim(
    'javascript',
    'routes',
    'syntax-scan',
    'partial',
    'HTTP library import, factory, alias, and syntax-scanned call chains; unproven receivers stay unknown.'
  ),
  claim(
    'javascript',
    'exports',
    'syntax-scan',
    'partial',
    'Export keyword, alias, and barrel re-export following with a bounded depth.'
  ),
  claim(
    'javascript',
    'inheritance',
    'unsupported',
    'unsupported',
    'Class-to-class heritage is not an admitted ontology edge.'
  ),
  claim('python', 'files', 'inventory', 'supported', 'Portable locators and content digests.'),
  claim(
    'python',
    'imports',
    'module-resolution',
    'partial',
    'Literal import/from specifiers; dynamic importlib stays unknown.'
  ),
  claim(
    'python',
    'declarations',
    'syntax-scan',
    'partial',
    'def/class scan with __all__ and leading-underscore visibility; not a Python AST.'
  ),
  claim(
    'python',
    'calls',
    'module-resolution',
    'partial',
    'Named imports bind when the target is unique; star imports stay conservative.'
  ),
  claim(
    'python',
    'routes',
    'syntax-scan',
    'partial',
    'Flask/FastAPI/Starlette constructor evidence; name-only @app decorators stay unproven.'
  ),
  claim('go', 'files', 'inventory', 'supported', 'Portable locators and content digests.'),
  claim(
    'go',
    'imports',
    'syntax-scan',
    'partial',
    'Quoted import paths; blank and dot imports are recorded as specifiers only.'
  ),
  claim(
    'go',
    'declarations',
    'syntax-scan',
    'partial',
    'func declarations; exported identifiers require an uppercase first letter.'
  ),
  claim(
    'go',
    'calls',
    'module-resolution',
    'partial',
    'Same-directory package peers bind unique exported funcs; other packages stay unknown.'
  ),
  claim(
    'go',
    'routes',
    'syntax-scan',
    'partial',
    'net/http and imported router methods with proven receivers.'
  ),
  claim('java', 'routes', 'syntax-scan', 'partial', 'HTTP mapping annotations with literal paths.'),
  claim(
    'dotnet',
    'routes',
    'syntax-scan',
    'partial',
    'Map* and Http* attributes with literal paths.'
  ),
  claim(
    'c-cpp',
    'imports',
    'module-resolution',
    'partial',
    'Quoted includes resolve onto inventoried files; angle-bracket includes stay unresolved.'
  ),
  claim(
    'rust',
    'declarations',
    'syntax-scan',
    'partial',
    'fn/struct/trait/enum scan; pub visibility is required for cross-file calls.'
  ),
  claim(
    'configuration',
    'configuration',
    'syntax-scan',
    'partial',
    'package.json, Python project manifests, and VS Code manifests.'
  ),
  claim(
    'yaml',
    'deployment',
    'syntax-scan',
    'partial',
    'Compose, Kubernetes, and infrastructure-as-code documents.'
  ),
  claim(
    'json',
    'routes',
    'syntax-scan',
    'partial',
    'OpenAPI/Swagger path objects when the document declares openapi or swagger.'
  ),
  claim(
    'protobuf',
    'handlers',
    'syntax-scan',
    'partial',
    'service/rpc declarations from .proto files; generated stubs stay unknown without source evidence.'
  ),
]);

export function extractionSupportFor(
  language: string,
  factClass: string
): GraphExtractionSupportClaim | undefined {
  return GRAPH_EXTRACTION_SUPPORT.find(
    (claim) => claim.language === language && claim.factClass === factClass
  );
}
