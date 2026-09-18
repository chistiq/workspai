import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphEntityReference,
  type GraphFactBatch,
  type GraphProviderCollectionRequest,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphUnknownZone,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import type { GraphNativePort } from '../ports/index.js';
import { createObservedEdgeFact, extensionOf } from './observed-edge-fact.js';
import { isGeneratedSource } from './generated-source.js';
import {
  MATRIX_SOURCE_EXTENSIONS,
  decodeMatrixSource,
  extractMatrixImportBindings,
  extractMatrixLocalImportLocators,
  matrixLanguageFor,
  matrixSameDirectoryPeers,
  matrixSourceExtractionBudget,
  matrixUsesNamedImports,
  scanMatrixCallSites,
  selectBalancedMatrixSources,
  type MatrixImportBinding,
} from './matrix-source-language.js';
import { extractPublishedMatrixDeclarations } from './route-native-declarations.js';
import { maskMatrixSourceLiterals, matchAllInMatrixCodeView } from './matrix-source-mask.js';

export const SOURCE_DECLARATIONS_PROVIDER_ID = 'workspai.graph.provider.source-declarations';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
export const MAX_SYMBOLS_PER_FILE = 500;
export const MAX_CALLS_PER_SYMBOL = 80;
export const NATIVE_DECLARATION_MIN_FILES = 24;

export interface GraphSourceDeclarationProviderOptions {
  readonly native?: GraphNativePort;
  readonly loadNative?: () => Promise<GraphNativePort | undefined>;
}

interface DeclaredSymbol {
  readonly name: string;
  readonly detail: 'function' | 'type' | 'value' | 'method';
  readonly line: number;
  readonly locator: string;
  readonly generated: boolean;
  reference: GraphEntityReference | undefined;
}

type CallBinding = DeclaredSymbol | 'ambiguous' | undefined;

function sourceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => MATRIX_SOURCE_EXTENSIONS.has(extensionOf(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function extractSymbols(
  source: string,
  locator: string,
  native: GraphNativePort | undefined,
  codeView: string
): {
  readonly findings: readonly {
    name: string;
    detail: DeclaredSymbol['detail'];
    line: number;
  }[];
  readonly discovered: number;
  readonly truncated: boolean;
} {
  const all = extractPublishedMatrixDeclarations(
    source,
    matrixLanguageFor(locator),
    native,
    codeView
  ).declarations;
  return {
    findings: all.slice(0, MAX_SYMBOLS_PER_FILE),
    discovered: all.length,
    truncated: all.length > MAX_SYMBOLS_PER_FILE,
  };
}

function uniqueSymbols(symbols: readonly DeclaredSymbol[]): DeclaredSymbol[] {
  const seen = new Set<string>();
  const unique: DeclaredSymbol[] = [];
  for (const symbol of symbols) {
    const key = symbol.reference?.id ?? `${symbol.locator}:${symbol.detail}:${symbol.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(symbol);
  }
  return unique;
}

function named(symbols: readonly DeclaredSymbol[], name: string): DeclaredSymbol[] {
  return symbols.filter((symbol) => symbol.name === name);
}

function parseExportNameMap(source: string, codeView: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of matchAllInMatrixCodeView(
    source,
    codeView,
    /^[^\S\r\n]*export\s+\{([^}]+)\}/gmu
  )) {
    for (const part of (match[1] ?? '').split(',')) {
      const item = part.trim();
      if (!item || item.startsWith('type ')) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(item);
      if (aliased?.[1] && aliased[2]) {
        names.set(aliased[2], aliased[1]);
        continue;
      }
      const name = /^([A-Za-z_$][\w$]*)$/u.exec(item)?.[1];
      if (name) names.set(name, name);
    }
  }
  return names;
}

function parsePythonAll(source: string, codeView: string): ReadonlySet<string> | undefined {
  const assigned = matchAllInMatrixCodeView(
    source,
    codeView,
    /^[^\S\r\n]*__all__\s*=\s*(\[[^\]]*\]|\([^)]*\))/gmu
  )[0];
  if (!assigned?.[1]) return undefined;
  const names = new Set<string>();
  for (const item of assigned[1].matchAll(/['"]([A-Za-z_][\w]*)['"]/gu)) {
    if (item[1]) names.add(item[1]);
  }
  return names;
}

function isVisibleOutsideFile(
  symbol: DeclaredSymbol,
  language: ReturnType<typeof matrixLanguageFor>,
  _source: string | undefined,
  lines: readonly string[] | undefined,
  exportMap: ReadonlyMap<string, string> | undefined,
  pythonAll: ReadonlySet<string> | undefined
): boolean {
  if (language === 'go') return /^[A-Z]/u.test(symbol.name);
  if (language === 'python') {
    if (pythonAll) return pythonAll.has(symbol.name);
    return !symbol.name.startsWith('_');
  }
  if (language === 'node' || language === null) {
    const line = lines?.[symbol.line - 1] ?? '';
    if (/^\s*export\b/u.test(line)) return true;
    return exportMap ? [...exportMap.values()].includes(symbol.name) : false;
  }
  if (language === 'rust') {
    const line = lines?.[symbol.line - 1] ?? '';
    return /^\s*pub(?:\s|\()/u.test(line);
  }
  if (language === 'java' || language === 'kotlin' || language === 'dotnet') {
    const line = lines?.[symbol.line - 1] ?? '';
    return !/\bprivate\b/u.test(line);
  }
  return true;
}

function defaultExportSymbols(
  symbols: readonly DeclaredSymbol[],
  source: string | undefined,
  lines: readonly string[] | undefined,
  codeView: string | undefined
): DeclaredSymbol[] {
  if (!source || !lines || !codeView) return [];
  const direct = symbols.filter((symbol) =>
    /^\s*export\s+default\b/u.test(lines[symbol.line - 1] ?? '')
  );
  if (direct.length > 0) return direct;
  for (const match of matchAllInMatrixCodeView(
    source,
    codeView,
    /^[^\S\r\n]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/gmu
  )) {
    const name = match[1];
    if (!name) continue;
    return symbols.filter((symbol) => symbol.name === name);
  }
  return [];
}

function importedCallCandidates(
  name: string,
  bindings: readonly MatrixImportBinding[],
  symbolsByFile: ReadonlyMap<string, readonly DeclaredSymbol[]>,
  sources: ReadonlyMap<string, string>,
  codeViews: ReadonlyMap<string, string>,
  linesByFile: ReadonlyMap<string, readonly string[]>,
  exportMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  pythonAllByFile: ReadonlyMap<string, ReadonlySet<string> | undefined>
): DeclaredSymbol[] {
  const matches: DeclaredSymbol[] = [];
  for (const binding of bindings) {
    const symbols = symbolsByFile.get(binding.locator) ?? [];
    const source = sources.get(binding.locator);
    const codeView = codeViews.get(binding.locator);
    const lines = linesByFile.get(binding.locator);
    const exportMap = exportMaps.get(binding.locator);
    const pythonAll = pythonAllByFile.get(binding.locator);
    const language = matrixLanguageFor(binding.locator);
    if (binding.exportedName === '*') {
      for (const symbol of symbols) {
        if (symbol.name !== name) continue;
        if (isVisibleOutsideFile(symbol, language, source, lines, exportMap, pythonAll)) {
          matches.push(symbol);
        }
      }
      continue;
    }
    if (binding.localName !== name) continue;
    if (binding.exportedName === 'default') {
      matches.push(...defaultExportSymbols(symbols, source, lines, codeView));
      continue;
    }
    const localName = exportMap?.get(binding.exportedName) ?? binding.exportedName;
    for (const symbol of symbols) {
      if (symbol.name !== localName) continue;
      if (
        language === 'python' ||
        isVisibleOutsideFile(symbol, language, source, lines, exportMap, pythonAll)
      ) {
        matches.push(symbol);
      }
    }
  }
  return matches;
}

function isKeywordDeclarationName(source: string, index: number): boolean {
  const before = source.slice(0, index);
  return /(?:^|[^A-Za-z0-9_$])(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|def|func|fn|fun)\s+$/u.test(
    before
  );
}

function memberReceiver(source: string, index: number): string | undefined {
  let cursor = index - 1;
  while (cursor >= 0 && /[ \t]/u.test(source[cursor] ?? '')) cursor -= 1;
  if (source[cursor] !== '.') return undefined;
  cursor -= 1;
  while (cursor >= 0 && /[ \t]/u.test(source[cursor] ?? '')) cursor -= 1;
  const end = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/u.test(source[cursor] ?? '')) cursor -= 1;
  const name = source.slice(cursor + 1, end);
  return name || undefined;
}

async function materializeDeclaredSymbol(
  symbol: DeclaredSymbol,
  request: GraphProviderCollectionRequest
): Promise<GraphEntityReference> {
  if (symbol.reference) return symbol.reference;
  const identity = await request.resolveIdentity({
    namespace: 'workspai',
    kind: 'symbol',
    relativeLocator: `${symbol.locator}:${symbol.detail}:${symbol.name}`,
    caseSensitivity: 'sensitive',
    scope: request.scope,
  });
  if (!identity.accepted) throw new Error('Symbol identity could not be resolved.');
  symbol.reference = identity.value.reference;
  return identity.value.reference;
}

function preferCallable(matches: readonly DeclaredSymbol[]): CallBinding {
  const unique = uniqueSymbols(matches);
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return unique[0];
  const behavioral = unique.filter(
    (symbol) => symbol.detail === 'function' || symbol.detail === 'method'
  );
  if (behavioral.length === 1) return behavioral[0];
  if (behavioral.length > 1) return 'ambiguous';
  const types = unique.filter((symbol) => symbol.detail === 'type');
  if (types.length === 1) return types[0];
  return 'ambiguous';
}

/**
 * Local unique wins. Authored imports then authored same-package peers.
 * Generated names stay in the call-target index as unique targets and never
 * create name collisions against authored symbols or against each other unless
 * no authored candidate exists and several generated symbols share the name.
 * Unreferenced generated internals are not materialized as define facts.
 */
function resolveCallTarget(
  name: string,
  local: readonly DeclaredSymbol[],
  imported: readonly DeclaredSymbol[],
  peers: readonly DeclaredSymbol[]
): CallBinding {
  const localHit = preferCallable(named(local, name));
  if (localHit !== undefined) return localHit;
  const authoredImported = preferCallable(imported.filter((symbol) => !symbol.generated));
  if (authoredImported !== undefined) return authoredImported;
  const authoredPeers = preferCallable(
    named(
      peers.filter((symbol) => !symbol.generated),
      name
    )
  );
  if (authoredPeers !== undefined) return authoredPeers;
  return preferCallable([...imported, ...named(peers, name)].filter((symbol) => symbol.generated));
}

function warning(code: string, scope: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path: scope, message };
}

export function createSourceDeclarationsProvider(
  options: GraphSourceDeclarationProviderOptions = {}
): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: SOURCE_DECLARATIONS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Source declarations and local calls',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'symbol'],
      relationKinds: ['defines', 'calls'],
      relationSemantics: ['structural', 'behavioral'] as const,
      factFamilies: ['source.declaration', 'source.call'],
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
    supportedInputs: ['source-declarations'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        MATRIX_SOURCE_EXTENSIONS.has(extensionOf(locator))
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['source-declarations'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const eligible = sourceInputs(request.inputs);
      const selectedLocators = selectBalancedMatrixSources(
        eligible.map((input) => input.locator),
        matrixSourceExtractionBudget(eligible.length)
      );
      const selected = new Set(selectedLocators);
      const inputs = eligible.filter((input) => selected.has(input.locator));
      const available = new Set(eligible.map((input) => input.locator));
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const symbolsByFile = new Map<string, DeclaredSymbol[]>();
      const sources = new Map<string, string>();
      const codeViews = new Map<string, string>();
      const files = new Map<string, GraphEntityReference>();
      const generated = new Set<string>();
      let discoveredAuthoredSymbols = 0;
      let discoveredGeneratedSymbols = 0;
      let indexedGeneratedSymbols = 0;
      let emittedAuthoredSymbols = 0;
      let emittedGeneratedSymbols = 0;
      let discoveredCalls = 0;
      let emittedCalls = 0;
      let examinedCalls = 0;
      let resolvedCalls = 0;
      let ambiguousCalls = 0;
      let unresolvedCalls = 0;
      let truncated = false;
      if (inputs.length < eligible.length) {
        truncated = true;
        diagnostics.push(
          warning(
            'graph.source-declarations-truncated',
            '.',
            `Declaration extraction sampled ${String(inputs.length)} file(s) from ${String(eligible.length)} matrix source file(s).`
          )
        );
        unknownZones.push({
          code: 'graph.source-declarations-truncated',
          scope: '.',
          reason: `Declaration extraction sampled ${String(inputs.length)} of ${String(eligible.length)} matrix source files; omitted files remain unknown.`,
        });
      }
      let native = options.native;
      if (!native && options.loadNative && inputs.length >= NATIVE_DECLARATION_MIN_FILES) {
        native = await options.loadNative();
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted)
          throw new Error('Source declaration collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const decoded = decodeMatrixSource(bytes);
          const source = decoded.text;
          const language = matrixLanguageFor(input.locator);
          const codeView = maskMatrixSourceLiterals(source, language);
          sources.set(input.locator, source);
          codeViews.set(input.locator, codeView);
          if (isGeneratedSource(input.locator, source)) generated.add(input.locator);
          if (decoded.encodingFallback) {
            const encoding = warning(
              'graph.source-declaration-encoding-fallback',
              input.locator,
              'Source was admitted with a latin1 fallback after UTF-8 rejected the bytes; declarations remain observed under that encoding.'
            );
            diagnostics.push(encoding);
            inputDiagnostics.push(encoding);
          }
          const file = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!file.accepted) throw new Error('Source file identity could not be resolved.');
          files.set(input.locator, file.value.reference);
          const extracted = extractSymbols(source, input.locator, native, codeView);
          const generatedFile = generated.has(input.locator);
          if (generatedFile) {
            discoveredGeneratedSymbols += extracted.discovered;
            indexedGeneratedSymbols += extracted.findings.length;
          } else discoveredAuthoredSymbols += extracted.discovered;
          if (extracted.truncated) {
            truncated = true;
            const truncation = warning(
              'graph.source-declarations-truncated',
              input.locator,
              `Symbol extraction stopped at ${String(MAX_SYMBOLS_PER_FILE)} declarations; remaining declarations are unknown.`
            );
            diagnostics.push(truncation);
            inputDiagnostics.push(truncation);
            unknownZones.push({
              code: 'graph.source-declarations-truncated',
              scope: input.locator,
              reason: `File exceeded ${String(MAX_SYMBOLS_PER_FILE)} extracted declarations; omitted declarations remain unknown.`,
            });
          }
          const declared: DeclaredSymbol[] = [];
          if (!generatedFile) {
            const identities = await Promise.all(
              extracted.findings.map((symbol) =>
                request.resolveIdentity({
                  namespace: 'workspai',
                  kind: 'symbol',
                  relativeLocator: `${input.locator}:${symbol.detail}:${symbol.name}`,
                  caseSensitivity: 'sensitive',
                  scope: request.scope,
                })
              )
            );
            for (const [symbolIndex, symbol] of extracted.findings.entries()) {
              if (facts.length >= manifest.limits.maxFacts) {
                outcome = 'omitted';
                truncated = true;
                unknownZones.push({
                  code: 'graph.source-declarations-truncated',
                  scope: input.locator,
                  reason: 'Declaration facts exceeded the provider output budget.',
                });
                break;
              }
              const identity = identities[symbolIndex];
              if (!identity?.accepted) throw new Error('Symbol identity could not be resolved.');
              declared.push({
                name: symbol.name,
                detail: symbol.detail,
                line: symbol.line,
                locator: input.locator,
                reference: identity.value.reference,
                generated: false,
              });
              emittedAuthoredSymbols += 1;
              facts.push(
                createObservedEdgeFact({
                  factId: `fact:source-declaration:${String(inputIndex).padStart(8, '0')}:${String(symbolIndex).padStart(8, '0')}:${input.digest.value}`,
                  factType: 'source.declaration',
                  subject: file.value.reference,
                  predicate: 'defines',
                  object: identity.value.reference,
                  request,
                  source: input,
                  provider: manifest,
                  evidenceId: `evidence:source-declaration:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'source-file',
                  derivation: 'extracted',
                  authority: 'observed',
                  confidence: 0.7,
                })
              );
            }
          } else {
            for (const symbol of extracted.findings) {
              declared.push({
                name: symbol.name,
                detail: symbol.detail,
                line: symbol.line,
                locator: input.locator,
                reference: undefined,
                generated: true,
              });
            }
          }
          symbolsByFile.set(input.locator, declared);
        } catch {
          const failure = warning(
            'graph.source-declaration-invalid',
            input.locator,
            'Source input could not be decoded or analyzed within the admitted boundary.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.source-declaration-unreadable',
            scope: input.locator,
            reason: 'Declarations are unknown because the source input could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'source-declarations', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      const linesByFile = new Map<string, string[]>();
      const exportMaps = new Map<string, Map<string, string>>();
      const pythonAllByFile = new Map<string, ReadonlySet<string> | undefined>();
      for (const [locator, sourceText] of sources) {
        const codeView = codeViews.get(locator);
        if (!codeView) continue;
        linesByFile.set(locator, sourceText.split(/\r?\n/u));
        exportMaps.set(locator, parseExportNameMap(sourceText, codeView));
        pythonAllByFile.set(
          locator,
          matrixLanguageFor(locator) === 'python' ? parsePythonAll(sourceText, codeView) : undefined
        );
      }

      for (const [inputIndex, input] of inputs.entries()) {
        const source = sources.get(input.locator);
        const codeView = codeViews.get(input.locator);
        const file = files.get(input.locator);
        if (!source || !codeView || !file || generated.has(input.locator)) continue;
        const language = matrixLanguageFor(input.locator);
        const importedLocators = extractMatrixLocalImportLocators(
          input.locator,
          source,
          language,
          available,
          codeView
        );
        const importBindings = extractMatrixImportBindings(
          input.locator,
          source,
          language,
          available,
          codeView
        );
        const peerLocators = matrixSameDirectoryPeers(input.locator, available);
        const localSymbols = symbolsByFile.get(input.locator) ?? [];
        const importedSymbols = matrixUsesNamedImports(language)
          ? []
          : importedLocators.flatMap((locator) =>
              (symbolsByFile.get(locator) ?? []).filter((symbol) =>
                isVisibleOutsideFile(
                  symbol,
                  matrixLanguageFor(locator),
                  sources.get(locator),
                  linesByFile.get(locator),
                  exportMaps.get(locator),
                  pythonAllByFile.get(locator)
                )
              )
            );
        const peerSymbols = peerLocators.flatMap((locator) =>
          (symbolsByFile.get(locator) ?? []).filter((symbol) =>
            isVisibleOutsideFile(
              symbol,
              language,
              sources.get(locator),
              linesByFile.get(locator),
              exportMaps.get(locator),
              pythonAllByFile.get(locator)
            )
          )
        );
        const knownNames = new Set([
          ...localSymbols.map((symbol) => symbol.name),
          ...importedSymbols.map((symbol) => symbol.name),
          ...peerSymbols.map((symbol) => symbol.name),
          ...importBindings.flatMap((binding) =>
            binding.exportedName === '*'
              ? (symbolsByFile.get(binding.locator) ?? [])
                  .filter((symbol) =>
                    isVisibleOutsideFile(
                      symbol,
                      matrixLanguageFor(binding.locator),
                      sources.get(binding.locator),
                      linesByFile.get(binding.locator),
                      exportMaps.get(binding.locator),
                      pythonAllByFile.get(binding.locator)
                    )
                  )
                  .map((symbol) => symbol.name)
              : [binding.localName]
          ),
        ]);
        let callIndex = 0;
        const emittedForName = new Map<string, number>();
        const ambiguousNames = new Set<string>();
        const truncatedNames = new Set<string>();
        for (const site of scanMatrixCallSites(source, language, codeView)) {
          if (isKeywordDeclarationName(source, site.index)) continue;
          examinedCalls += 1;
          if (!knownNames.has(site.name)) {
            unresolvedCalls += 1;
            continue;
          }
          const receiver = memberReceiver(source, site.index);
          const namedImportLanguage = matrixUsesNamedImports(language);
          const memberNamespace =
            namedImportLanguage && receiver
              ? importBindings.filter(
                  (binding) => binding.localName === receiver && binding.exportedName === '*'
                )
              : [];
          const freeBindings = importBindings.filter(
            (binding) => binding.exportedName !== '*' || binding.localName === '*'
          );
          const importedHits = importedCallCandidates(
            site.name,
            namedImportLanguage && receiver ? memberNamespace : freeBindings,
            symbolsByFile,
            sources,
            codeViews,
            linesByFile,
            exportMaps,
            pythonAllByFile
          );
          const target = resolveCallTarget(
            site.name,
            namedImportLanguage && receiver ? [] : localSymbols,
            [
              ...importedHits,
              ...(namedImportLanguage && receiver ? [] : named(importedSymbols, site.name)),
            ],
            namedImportLanguage && receiver ? [] : peerSymbols
          );
          if (target === 'ambiguous') {
            discoveredCalls += 1;
            ambiguousCalls += 1;
            if (!ambiguousNames.has(site.name)) {
              ambiguousNames.add(site.name);
              unknownZones.push({
                code: 'graph.source-call-ambiguous',
                scope: input.locator,
                reason: `Call sites for ${site.name} resolved to multiple local declarations and were left unknown.`,
              });
            }
            continue;
          }
          if (!target) {
            unresolvedCalls += 1;
            continue;
          }
          discoveredCalls += 1;
          resolvedCalls += 1;
          const emittedCount = emittedForName.get(site.name) ?? 0;
          if (emittedCount >= MAX_CALLS_PER_SYMBOL) {
            truncated = true;
            if (!truncatedNames.has(site.name)) {
              truncatedNames.add(site.name);
              unknownZones.push({
                code: 'graph.source-calls-truncated',
                scope: input.locator,
                reason: `Call extraction for ${site.name} stopped at ${String(MAX_CALLS_PER_SYMBOL)} sites; remaining calls are unknown.`,
              });
            }
            continue;
          }
          if (facts.length >= manifest.limits.maxFacts) {
            truncated = true;
            unknownZones.push({
              code: 'graph.source-calls-truncated',
              scope: input.locator,
              reason: 'Call facts exceeded the provider output budget.',
            });
            break;
          }
          const targetReference = await materializeDeclaredSymbol(target, request);
          facts.push(
            createObservedEdgeFact({
              factId: `fact:source-call:${String(inputIndex).padStart(8, '0')}:${String(callIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.call',
              subject: file,
              predicate: 'calls',
              object: targetReference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:source-call:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'source-file',
              derivation: 'extracted',
              authority: 'observed',
              confidence: 0.7,
            })
          );
          callIndex += 1;
          emittedCalls += 1;
          emittedForName.set(site.name, emittedCount + 1);
        }
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (!generated.has(input.locator)) continue;
        const file = files.get(input.locator);
        if (!file) continue;
        const declared = symbolsByFile.get(input.locator) ?? [];
        for (const [symbolIndex, symbol] of declared.entries()) {
          if (!symbol.reference) continue;
          if (facts.length >= manifest.limits.maxFacts) {
            truncated = true;
            unknownZones.push({
              code: 'graph.source-declarations-truncated',
              scope: input.locator,
              reason: 'Declaration facts exceeded the provider output budget.',
            });
            break;
          }
          emittedGeneratedSymbols += 1;
          facts.push(
            createObservedEdgeFact({
              factId: `fact:source-declaration:${String(inputIndex).padStart(8, '0')}:${String(symbolIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.declaration',
              subject: file,
              predicate: 'defines',
              object: symbol.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:source-declaration:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'source-file',
              derivation: 'extracted',
              authority: 'observed',
              confidence: 0.7,
            })
          );
        }
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:source-declarations:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'source-declarations',
            observed: inputs.length,
            expected: eligible.length,
          },
          {
            dimension: 'source-declaration-symbols',
            observed: emittedAuthoredSymbols + emittedGeneratedSymbols,
            expected: discoveredAuthoredSymbols + emittedGeneratedSymbols,
          },
          {
            dimension: 'source-generated-symbols-indexed',
            observed: indexedGeneratedSymbols,
            expected: discoveredGeneratedSymbols,
          },
          {
            dimension: 'source-generated-symbols-materialized',
            observed: emittedGeneratedSymbols,
            expected: indexedGeneratedSymbols,
          },
          {
            dimension: 'source-declaration-calls',
            observed: emittedCalls,
            expected: discoveredCalls,
          },
          {
            dimension: 'source-calls-examined',
            observed: examinedCalls,
          },
          {
            dimension: 'source-calls-resolved',
            observed: resolvedCalls,
            expected: examinedCalls,
          },
          {
            dimension: 'source-calls-ambiguous',
            observed: ambiguousCalls,
            expected: examinedCalls,
          },
          {
            dimension: 'source-calls-unresolved',
            observed: unresolvedCalls,
            expected: examinedCalls,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          truncated ||
          unknownZones.length > 0 ||
          processing.some((entry) => entry.outcome !== 'processed')
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
