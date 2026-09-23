import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { admitDeclaredGraphLocator } from '../domain/locator-identity.js';
import { collectRustUseImports } from '../domain/rust-use.js';
import { appendReusedLocatorFacts } from '../application/locator-fact-shards.js';
import {
  decodeMatrixSource,
  matrixSourceExtractionBudget,
  selectBalancedMatrixSources,
} from './matrix-source-language.js';

export const LANGUAGE_IMPORTS_PROVIDER_ID = 'workspai.graph.provider.language-imports';

type Language =
  | 'python'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'rust'
  | 'c-cpp'
  | 'objective-c-matlab'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'elixir'
  | 'kotlin';
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;

const EXTENSION_LANGUAGE: Readonly<Record<string, Language>> = Object.freeze({
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'dotnet',
  '.rs': 'rust',
  '.c': 'c-cpp',
  '.cc': 'c-cpp',
  '.cpp': 'c-cpp',
  '.cxx': 'c-cpp',
  '.h': 'c-cpp',
  '.hh': 'c-cpp',
  '.hpp': 'c-cpp',
  '.hxx': 'c-cpp',
  '.m': 'objective-c-matlab',
  '.mm': 'objective-c-matlab',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
});

function extension(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function languageFor(locator: string): Language | null {
  return EXTENSION_LANGUAGE[extension(locator)] ?? null;
}

function supportedInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => languageFor(input.locator) !== null)
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function stripComments(source: string, language: Language): string {
  const hashIsComment = language === 'python' || language === 'ruby' || language === 'elixir';
  const withoutBlocks = hashIsComment ? source : source.replace(/\/\*[\s\S]*?\*\//gu, '');
  return withoutBlocks
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trimStart();
      return hashIsComment ? !trimmed.startsWith('#') : !trimmed.startsWith('//');
    })
    .join('\n');
}

function extractGoImports(source: string): string[] {
  const imports: string[] = [];
  let block = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*import\s*\(\s*$/u.test(line)) {
      block = true;
      continue;
    }
    if (block && /^\s*\)\s*$/u.test(line)) {
      block = false;
      continue;
    }
    const match = block
      ? /^\s*(?:[._A-Za-z][\w.]*\s+)?["`]([^"`]+)["`]/u.exec(line)
      : /^\s*import\s+(?:[._A-Za-z][\w.]*\s+)?["`]([^"`]+)["`]/u.exec(line);
    if (match?.[1]) imports.push(match[1]);
  }
  return imports;
}

function extractImports(source: string, language: Language): string[] {
  const syntax = stripComments(source, language);
  const imports: string[] = [];
  if (language === 'go') return extractGoImports(syntax);
  if (language === 'c-cpp') {
    for (const match of syntax.matchAll(/^\s*#\s*include\s*[<"]([^>"\r\n]+)[>"]/gmu))
      if (match[1]) imports.push(match[1].trim());
    return imports;
  }
  if (language === 'objective-c-matlab') {
    for (const pattern of [
      /^\s*#\s*(?:include|import)\s*[<"]([^>"\r\n]+)[>"]/gmu,
      /^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\.\*)?)\s*;?\s*$/gmu,
    ])
      for (const match of syntax.matchAll(pattern)) if (match[1]) imports.push(match[1].trim());
    return imports;
  }
  if (language === 'php') {
    for (const pattern of [
      /^\s*use\s+(?:function\s+|const\s+)?([^;{\r\n]+)\s*;/gmu,
      /\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?["']([^"']+)["']/gmu,
    ])
      for (const match of syntax.matchAll(pattern)) if (match[1]) imports.push(match[1].trim());
    return imports;
  }
  if (language === 'ruby') {
    for (const match of syntax.matchAll(
      /^\s*(?:require|require_relative|load)\s*(?:\(\s*)?["']([^"']+)["']/gmu
    ))
      if (match[1]) imports.push(match[1].trim());
    return imports;
  }
  if (language === 'swift') {
    for (const match of syntax.matchAll(
      /^\s*(?:@testable\s+|@_exported\s+)?import\s+(?:\w+\s+)?([A-Za-z_]\w*)/gmu
    ))
      if (match[1]) imports.push(match[1]);
    return imports;
  }
  if (language === 'elixir') {
    for (const match of syntax.matchAll(
      /^\s*(?:alias|import|require|use)\s+([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)*)/gmu
    ))
      if (match[1]) imports.push(match[1]);
    return imports;
  }
  if (language === 'rust') {
    return collectRustUseImports(syntax).map((item) => item.path);
  }
  const patterns: readonly RegExp[] =
    language === 'python'
      ? [/^\s*import\s+([A-Za-z_][\w.]*)/gmu, /^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+/gmu]
      : language === 'java'
        ? [/^\s*import\s+(?:static\s+)?([A-Za-z_$][\w$.*]*)\s*;/gmu]
        : language === 'kotlin'
          ? [/^\s*import\s+([A-Za-z_$][\w$.*]*)(?:\s+as\s+[A-Za-z_]\w*)?\s*$/gmu]
          : language === 'dotnet'
            ? [
                /^\s*(?:global\s+)?using\s+(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/gmu,
              ]
            : [];
  for (const pattern of patterns) {
    for (const match of syntax.matchAll(pattern)) if (match[1]) imports.push(match[1].trim());
  }
  return imports;
}

function unsupportedDynamicSyntax(source: string, language: Language): boolean {
  return (
    (language === 'python' && /\b(?:__import__|importlib\.import_module)\s*\(/u.test(source)) ||
    ((language === 'java' || language === 'kotlin') && /\bClass\.forName\s*\(/u.test(source)) ||
    (language === 'dotnet' && /\bAssembly\.(?:Load|LoadFrom|LoadFile)\s*\(/u.test(source)) ||
    (language === 'go' && /\bplugin\.Open\s*\(/u.test(source)) ||
    (language === 'rust' && /\blibloading\b/u.test(source)) ||
    (language === 'c-cpp' && /\b(?:dlopen|LoadLibrary(?:A|W)?)\s*\(/u.test(source)) ||
    (language === 'objective-c-matlab' && /\b(?:NSClassFromString|dlopen)\s*\(/u.test(source)) ||
    (language === 'php' &&
      /\b(?:require_once|include_once|require|include)\b\s*\(?\s*\$/u.test(source)) ||
    (language === 'ruby' &&
      /\b(?:require_relative|require|load)\b\s*\(?\s*[^"'\s]/u.test(source)) ||
    (language === 'swift' && /\bdlopen\s*\(/u.test(source)) ||
    (language === 'elixir' &&
      /\b(?:Module\.concat|Code\.(?:require_file|eval_file))\s*\(/u.test(source))
  );
}

function importedModuleLocator(imported: string): string {
  return admitDeclaredGraphLocator(imported, 'encoded');
}

function joinPortableLocator(directory: string, relative: string): string | undefined {
  const parts = [...(directory === '.' ? [] : directory.split('/')), ...relative.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') return undefined;
    out.push(part);
  }
  return out.join('/');
}

/**
 * Bind a path-shaped declared import to an admitted repository file.
 * Bare module names stay modules. Missing files stay modules. `..` is refused.
 */
export function resolveDeclaredImportLocator(
  importer: string,
  specifier: string,
  locators: ReadonlySet<string>
): string | undefined {
  if (
    !specifier ||
    specifier.startsWith('/') ||
    specifier.includes('\\') ||
    specifier.includes('..') ||
    !(specifier.startsWith('.') || specifier.includes('/') || specifier.includes('.'))
  ) {
    return undefined;
  }
  const directory = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '.';
  const normalized = specifier.replace(/^\.\//u, '');
  const relative = joinPortableLocator(directory, normalized);
  if (relative && locators.has(relative)) return relative;
  if (locators.has(normalized)) return normalized;
  return undefined;
}

function warning(code: string, path: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path, message };
}

export function createLanguageImportsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: LANGUAGE_IMPORTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Cross-language declared imports',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'module'],
      relationKinds: ['imports'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.declared-import'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: 128 * 1024 * 1024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: [
      'python-source',
      'go-source',
      'java-source',
      'dotnet-source',
      'rust-source',
      'c-cpp-source',
      'objective-c-matlab-source',
      'php-source',
      'ruby-source',
      'swift-source',
      'elixir-source',
      'kotlin-source',
    ],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const languages = new Set(
        request.availableInputs
          .map(languageFor)
          .filter((language): language is Language => language !== null)
      );
      const matchedInputs = [...languages].sort().map((language) => `${language}-source`);
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: matchedInputs.length > 0 ? 'applicable' : 'not-applicable',
        matchedInputs,
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const eligible = supportedInputs(request.inputs);
      const selectedLocators = new Set(
        selectBalancedMatrixSources(
          eligible.map((input) => input.locator),
          matrixSourceExtractionBudget(eligible.length)
        )
      );
      const inputs = eligible.filter((input) => selectedLocators.has(input.locator));
      const admittedLocators = new Set(request.inputs.map((input) => input.locator));
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const sampled = inputs.length < eligible.length;
      if (sampled) {
        unknownZones.push({
          code: 'graph.language-imports-truncated',
          scope: '.',
          reason: `Declared-import extraction sampled ${String(inputs.length)} of ${String(eligible.length)} matrix source files; omitted files remain unknown.`,
        });
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (
          appendReusedLocatorFacts(
            {
              providerId: LANGUAGE_IMPORTS_PROVIDER_ID,
              locator: input.locator,
              inputDigest: input.digest.value,
              inputIndex,
            },
            '',
            facts,
            processing,
            unknownZones
          )
        ) {
          continue;
        }
        const language = languageFor(input.locator);
        if (!language) continue;
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const decoded = decodeMatrixSource(bytes);
          const source = decoded.text;
          if (decoded.encodingFallback) {
            const encoding = warning(
              'graph.language-source-encoding-fallback',
              input.locator,
              'Source was admitted with a latin1 fallback after UTF-8 rejected the bytes; declared imports remain observed under that encoding.'
            );
            diagnostics.push(encoding);
            inputDiagnostics.push(encoding);
          }
          const subject = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!subject.accepted) throw new Error('Source identity could not be resolved.');
          const imports = [...new Set(extractImports(source, language))].sort((left, right) =>
            left.localeCompare(right)
          );
          for (const [importIndex, imported] of imports.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              outcome = 'omitted';
              unknownZones.push({
                code: 'graph.language-imports-truncated',
                scope: input.locator,
                reason: 'Declared import facts exceeded the provider output budget.',
              });
              break;
            }
            const resolvedFile = resolveDeclaredImportLocator(
              input.locator,
              imported,
              admittedLocators
            );
            const target = await request.resolveIdentity(
              resolvedFile
                ? {
                    namespace: 'workspai',
                    kind: 'file',
                    relativeLocator: resolvedFile,
                    caseSensitivity: 'sensitive',
                    scope: request.scope,
                  }
                : {
                    namespace: `${language}-module`,
                    kind: 'module',
                    relativeLocator: importedModuleLocator(imported),
                    caseSensitivity: language === 'dotnet' ? 'insensitive' : 'sensitive',
                    scope: request.scope,
                  }
            );
            if (!target.accepted)
              throw new Error('Imported module identity could not be resolved.');
            facts.push({
              factId: `fact:language-import:${String(inputIndex).padStart(8, '0')}:${String(importIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.declared-import',
              subject: subject.value.reference,
              predicate: 'imports',
              object: target.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:language-import:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'source-file',
                  relativeLocator: input.locator,
                  digest: input.digest,
                },
              ],
              provenance: { id: manifest.id, version: manifest.version },
              derivation: 'extracted',
              authority: 'observed',
              confidence: 1,
              freshness: { status: 'current' },
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
              observedAt: request.observedAt,
              partitionOwner: { locator: input.locator, observationOrigin: 'build-clock' },
              inputDigest: input.digest,
              unknownZones: [],
              extensions: Object.freeze({ moduleSpecifier: imported }),
            });
          }
          if (unsupportedDynamicSyntax(source, language)) {
            unknownZones.push({
              code: 'graph.language-dynamic-import-unsupported',
              scope: input.locator,
              reason: 'Dynamic module loading is outside the declared-import profile.',
            });
            if (outcome !== 'omitted') outcome = 'unsupported';
          }
        } catch {
          const failure = warning(
            'graph.language-source-invalid',
            input.locator,
            'Source input could not be decoded or analyzed within the admitted boundary.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.language-source-unreadable',
            scope: input.locator,
            reason: 'Declared imports are unknown because source input could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: `${language}-declared-imports`, version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:language-imports:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'supported-language-source',
            observed: inputs.length,
            expected: eligible.length,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          sampled || processing.some((entry) => entry.outcome !== 'processed')
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
