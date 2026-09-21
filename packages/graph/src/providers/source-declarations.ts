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
import { writeSync } from 'node:fs';
import type { GraphNativePort } from '../ports/index.js';
import { createObservedEdgeFact, extensionOf } from './observed-edge-fact.js';
import { isGeneratedSource } from './generated-source.js';
import {
  MATRIX_SOURCE_EXTENSIONS,
  decodeMatrixSource,
  extractMatrixImportBindings,
  extractMatrixLocalImportLocators,
  extractMatrixReexportBindings,
  matrixLanguageFor,
  matrixSameDirectoryPeers,
  matrixSourceExtractionBudget,
  matrixUsesNamedImports,
  scanMatrixCallSites,
  selectBalancedMatrixSources,
  type MatrixCallSite,
  type MatrixImportBinding,
  type MatrixReexportBinding,
} from './matrix-source-language.js';
import { extractPublishedMatrixDeclarations } from './route-native-declarations.js';
import { maskMatrixSourceLiteralsCached, matchAllInMatrixCodeView } from './matrix-source-mask.js';
import {
  contentAddressedCompute,
  contentAddressedFactCacheStats,
  contentAddressedFactKey,
  contentAddressedGet,
} from './content-addressed-facts.js';
import { recordGraphDataMovement } from '../application/data-movement.js';
import { recordGraphPhase } from '../application/phase-metrics.js';
import {
  GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
  appendReusedLocatorFacts,
  locatorCallEnvironmentDigest,
  lookupLocatorFactShard,
  rememberLocatorFactShard,
  type GraphLocatorFactShard,
} from '../application/locator-fact-shards.js';

export const SOURCE_DECLARATIONS_PROVIDER_ID = 'workspai.graph.provider.source-declarations';
/**
 * Mandatory semantic implementation identity for this provider. Changing
 * detection, extraction, binding, call-resolution, identity, proof, or quality
 * semantics requires bumping this version (and/or
 * GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION). Session reuse keys the full
 * manifest, so an unversioned implementation change would otherwise reuse
 * stale facts.
 */
export const GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION = '0.1.0-candidate' as const;

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

interface CachedSourceSyntax {
  readonly encodingFallback: boolean;
  readonly generated: boolean;
  readonly codeView: string;
  readonly findings: readonly {
    readonly name: string;
    readonly detail: DeclaredSymbol['detail'];
    readonly line: number;
  }[];
  readonly discovered: number;
  readonly truncated: boolean;
  readonly exportPairs: readonly (readonly [string, string])[];
  readonly pythonAllNames: readonly string[] | undefined;
  readonly callSites: readonly MatrixCallSite[];
}

interface SourceDeclarationShardExtras {
  readonly exportSignature: string;
  readonly dependencyLocators: readonly string[];
  readonly declared: readonly DeclaredSymbol[];
  readonly visible: readonly DeclaredSymbol[];
  readonly defaults: readonly DeclaredSymbol[];
  readonly exportPairs: readonly (readonly [string, string])[];
  readonly pythonAllNames: readonly string[] | undefined;
  readonly reexports: readonly MatrixReexportBinding[];
}

function declarationBench(phase: string, startedAt: number): void {
  if (process.env.WORKSPAI_GRAPH_BENCH_CHILD !== '1') return;
  writeSync(
    2,
    `${JSON.stringify({
      schemaVersion: 'workspai.graph-producer-benchmark-progress.v1',
      event: 'declaration-split',
      phase,
      wallMs: Math.max(0, Math.round(performance.now() - startedAt)),
    })}\n`
  );
}

function isSourceDeclarationExtras(value: unknown): value is SourceDeclarationShardExtras {
  return (
    typeof value === 'object' && value !== null && 'exportSignature' in value && 'declared' in value
  );
}

function exportSignatureOf(
  visible: readonly DeclaredSymbol[],
  exportPairs: readonly (readonly [string, string])[]
): string {
  return [
    ...visible.map((symbol) => `${symbol.name}:${symbol.detail}`),
    ...exportPairs.map(([exported, local]) => `${exported}=${local}`),
  ]
    .sort((left, right) => left.localeCompare(right))
    .join('\0');
}

function indexFromExtras(extras: SourceDeclarationShardExtras): FileSymbolIndex {
  const visibleByName = new Map<string, DeclaredSymbol[]>();
  const allByName = new Map<string, DeclaredSymbol[]>();
  for (const symbol of extras.declared) {
    const all = allByName.get(symbol.name);
    if (all) all.push(symbol);
    else allByName.set(symbol.name, [symbol]);
  }
  for (const symbol of extras.visible) {
    const named = visibleByName.get(symbol.name);
    if (named) named.push(symbol);
    else visibleByName.set(symbol.name, [symbol]);
  }
  return {
    visible: extras.visible,
    visibleByName,
    allByName,
    visibleNames: new Set(visibleByName.keys()),
    defaults: extras.defaults,
  };
}

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
    if (!exportMap) return false;
    for (const exported of exportMap.values()) {
      if (exported === symbol.name) return true;
    }
    return false;
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
  indexes: ReadonlyMap<string, FileSymbolIndex>,
  exportMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  reexportsByFile: ReadonlyMap<string, readonly MatrixReexportBinding[]>
): DeclaredSymbol[] {
  const matches: DeclaredSymbol[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    matches.push(
      ...symbolsForExportedName({
        locator: binding.locator,
        exportedName: binding.exportedName,
        localName: binding.localName,
        callName: name,
        indexes,
        exportMaps,
        reexportsByFile,
        seen,
        depth: 0,
      })
    );
  }
  return uniqueDeclaredSymbols(matches);
}

function uniqueDeclaredSymbols(symbols: readonly DeclaredSymbol[]): DeclaredSymbol[] {
  const seen = new Set<string>();
  const unique: DeclaredSymbol[] = [];
  for (const symbol of symbols) {
    const key = `${symbol.locator}:${symbol.detail}:${symbol.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(symbol);
  }
  return unique;
}

interface FileSymbolIndex {
  readonly visible: readonly DeclaredSymbol[];
  readonly visibleByName: ReadonlyMap<string, readonly DeclaredSymbol[]>;
  readonly allByName: ReadonlyMap<string, readonly DeclaredSymbol[]>;
  readonly visibleNames: ReadonlySet<string>;
  readonly defaults: readonly DeclaredSymbol[];
}

function buildFileSymbolIndex(
  locator: string,
  symbols: readonly DeclaredSymbol[],
  sources: ReadonlyMap<string, string>,
  codeViews: ReadonlyMap<string, string>,
  linesByFile: ReadonlyMap<string, readonly string[]>,
  exportMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  pythonAllByFile: ReadonlyMap<string, ReadonlySet<string> | undefined>
): FileSymbolIndex {
  const language = matrixLanguageFor(locator);
  const source = sources.get(locator);
  const lines = linesByFile.get(locator);
  const exportMap = exportMaps.get(locator);
  const pythonAll = pythonAllByFile.get(locator);
  const visible: DeclaredSymbol[] = [];
  const visibleByName = new Map<string, DeclaredSymbol[]>();
  const allByName = new Map<string, DeclaredSymbol[]>();
  for (const symbol of symbols) {
    const all = allByName.get(symbol.name);
    if (all) all.push(symbol);
    else allByName.set(symbol.name, [symbol]);
    if (!isVisibleOutsideFile(symbol, language, source, lines, exportMap, pythonAll)) continue;
    visible.push(symbol);
    const named = visibleByName.get(symbol.name);
    if (named) named.push(symbol);
    else visibleByName.set(symbol.name, [symbol]);
  }
  return {
    visible,
    visibleByName,
    allByName,
    visibleNames: new Set(visibleByName.keys()),
    defaults: defaultExportSymbols(symbols, source, lines, codeViews.get(locator)),
  };
}

function symbolsForExportedName(input: {
  readonly locator: string;
  readonly exportedName: string;
  readonly localName: string;
  readonly callName: string;
  readonly indexes: ReadonlyMap<string, FileSymbolIndex>;
  readonly exportMaps: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly reexportsByFile: ReadonlyMap<string, readonly MatrixReexportBinding[]>;
  readonly seen: Set<string>;
  readonly depth: number;
}): DeclaredSymbol[] {
  if (input.depth > 8) return [];
  const token = `${input.locator}\0${input.exportedName}\0${input.callName}`;
  if (input.seen.has(token)) return [];
  input.seen.add(token);
  const index = input.indexes.get(input.locator);
  const matches: DeclaredSymbol[] = [];
  if (index) {
    if (input.exportedName === '*') {
      if (input.localName !== '*' && input.localName !== input.callName) {
        // namespace import: calls are member-shaped and not resolved here
      } else {
        matches.push(...(index.visibleByName.get(input.callName) ?? []));
      }
    } else if (input.localName === input.callName || input.exportedName === input.callName) {
      if (input.exportedName === 'default') {
        matches.push(...index.defaults);
      } else {
        const localName =
          input.exportMaps.get(input.locator)?.get(input.exportedName) ?? input.exportedName;
        const pool =
          matrixLanguageFor(input.locator) === 'python' ? index.allByName : index.visibleByName;
        matches.push(...(pool.get(localName) ?? []));
      }
    }
  }
  const wanted = input.exportedName === '*' ? input.callName : input.exportedName;
  for (const reexport of input.reexportsByFile.get(input.locator) ?? []) {
    const followsStar = reexport.exportedName === '*';
    const followsNamed = reexport.exportedName === wanted;
    if (!followsStar && !followsNamed) continue;
    matches.push(
      ...symbolsForExportedName({
        ...input,
        locator: reexport.locator,
        exportedName: followsStar
          ? wanted
          : reexport.sourceExportedName === '*'
            ? wanted
            : reexport.sourceExportedName,
        localName: followsStar ? '*' : reexport.sourceExportedName,
        depth: input.depth + 1,
      })
    );
  }
  return matches;
}

export const DECLARATION_KEYWORD_LOOKBEHIND = 96;
export const CONSTRUCTOR_LOOKBEHIND = 16;

export function isKeywordDeclarationName(source: string, index: number): boolean {
  const start = Math.max(0, index - DECLARATION_KEYWORD_LOOKBEHIND);
  return /(?:^|[^A-Za-z0-9_$])(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|def|func|fn|fun)\s+$/u.test(
    source.slice(start, index)
  );
}

export function isConstructorCall(source: string, index: number): boolean {
  const start = Math.max(0, index - CONSTRUCTOR_LOOKBEHIND);
  return /(?:^|[^A-Za-z0-9_$])new\s+$/u.test(source.slice(start, index));
}

function isMemberCall(source: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /[ \t]/u.test(source[cursor] ?? '')) cursor -= 1;
  return source[cursor] === '.';
}

function memberReceiver(source: string, index: number): string | undefined {
  let cursor = index - 1;
  while (cursor >= 0 && /[ \t]/u.test(source[cursor] ?? '')) cursor -= 1;
  if (source[cursor] !== '.') return undefined;
  cursor -= 1;
  if (source[cursor] === '?') cursor -= 1;
  while (cursor >= 0 && /[ \t]/u.test(source[cursor] ?? '')) cursor -= 1;
  const end = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/u.test(source[cursor] ?? '')) cursor -= 1;
  const name = source.slice(cursor + 1, end);
  return name || undefined;
}

function isLocalMemberReceiver(receiver: string): boolean {
  return receiver === 'this' || receiver === 'self' || receiver === 'super';
}

const EXTERNAL_FREE_CALL_NAMES = new Set([
  'Array',
  'BigInt',
  'Boolean',
  'Buffer',
  'Date',
  'Error',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'Reflect',
  'Set',
  'String',
  'Symbol',
  'console',
  'decodeURIComponent',
  'encodeURIComponent',
  'fetch',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'process',
  'require',
  'structuredClone',
  'dict',
  'getattr',
  'hasattr',
  'int',
  'isinstance',
  'len',
  'list',
  'print',
  'range',
  'setattr',
  'str',
  'super',
  'tuple',
  'type',
]);

function isExternalFreeCall(siteName: string, knownNames: ReadonlySet<string>): boolean {
  return !knownNames.has(siteName) && EXTERNAL_FREE_CALL_NAMES.has(siteName);
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
    version: GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION,
    displayName: 'Source declarations and local calls',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'symbol'],
      relationKinds: ['defines', 'calls', 'exports'],
      relationSemantics: ['structural', 'behavioral'] as const,
      factFamilies: ['source.declaration', 'source.call', 'source.export'],
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
      const linesByFile = new Map<string, string[]>();
      const exportMaps = new Map<string, Map<string, string>>();
      const pythonAllByFile = new Map<string, ReadonlySet<string> | undefined>();
      const reexportsByFile = new Map<string, MatrixReexportBinding[]>();
      const callSitesByFile = new Map<string, readonly MatrixCallSite[]>();
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
      let externalCalls = 0;
      let excludedCalls = 0;
      let truncatedCalls = 0;
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
      const nativeStartedAt = performance.now();
      if (!native && options.loadNative && inputs.length >= NATIVE_DECLARATION_MIN_FILES) {
        native = await options.loadNative();
      }
      declarationBench('native-load', nativeStartedAt);

      const preparedFiles: {
        readonly inputIndex: number;
        readonly input: GraphProviderInput;
        readonly extracted: {
          readonly findings: CachedSourceSyntax['findings'];
          readonly discovered: number;
          readonly truncated: boolean;
        };
        readonly generatedFile: boolean;
        readonly inputDiagnostics: GraphDiagnostic[];
        readonly restored?: boolean;
        outcome: GraphFactBatch['processing'][number]['outcome'];
      }[] = [];
      const restoredShards = new Map<string, GraphLocatorFactShard>();
      const exportSignatures = new Map<string, string>();
      const dependencyLocatorsByFile = new Map<string, readonly string[]>();
      const fileIdentityJobs: Promise<
        Awaited<ReturnType<GraphProviderCollectionRequest['resolveIdentity']>>
      >[] = [];

      const prepareStartedAt = performance.now();
      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted)
          throw new Error('Source declaration collection was cancelled.');
        const inputDiagnostics: GraphDiagnostic[] = [];
        const shard = lookupLocatorFactShard({
          providerId: SOURCE_DECLARATIONS_PROVIDER_ID,
          locator: input.locator,
          inputDigest: input.digest.value,
          inputIndex,
        });
        if (shard && isSourceDeclarationExtras(shard.extras)) {
          restoredShards.set(input.locator, shard);
          exportSignatures.set(input.locator, shard.extras.exportSignature);
          dependencyLocatorsByFile.set(input.locator, shard.extras.dependencyLocators);
          symbolsByFile.set(input.locator, [...shard.extras.declared]);
          exportMaps.set(input.locator, new Map(shard.extras.exportPairs));
          pythonAllByFile.set(
            input.locator,
            shard.extras.pythonAllNames ? new Set(shard.extras.pythonAllNames) : undefined
          );
          reexportsByFile.set(input.locator, [...shard.extras.reexports]);
          const fileRef = shard.facts.find(
            (fact) => fact.predicate === 'defines' || fact.predicate === 'exports'
          )?.subject;
          if (fileRef) files.set(input.locator, fileRef);
          preparedFiles.push({
            inputIndex,
            input,
            extracted: {
              findings: shard.extras.declared.map((symbol) => ({
                name: symbol.name,
                detail: symbol.detail,
                line: symbol.line,
              })),
              discovered: shard.extras.declared.length,
              truncated: false,
            },
            generatedFile:
              shard.extras.declared.length > 0 &&
              shard.extras.declared.every((symbol) => symbol.generated),
            inputDiagnostics,
            outcome: 'processed',
            restored: true,
          });
          fileIdentityJobs.push(
            fileRef
              ? Promise.resolve({
                  accepted: true as const,
                  value: { reference: fileRef, normalizedLocator: input.locator },
                  issues: [],
                })
              : request.resolveIdentity({
                  namespace: 'workspai',
                  kind: 'file',
                  relativeLocator: input.locator,
                  caseSensitivity: 'sensitive',
                  scope: request.scope,
                })
          );
          continue;
        }
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const decoded = decodeMatrixSource(bytes);
          const source = decoded.text;
          const language = matrixLanguageFor(input.locator);
          recordGraphPhase('languageClassification', { files: 1, invocations: 1 });
          const syntaxKey = contentAddressedFactKey({
            extractorId: SOURCE_DECLARATIONS_PROVIDER_ID,
            extractorVersion: `${manifest.version}:syntax:code-view`,
            contentDigest: input.digest.value,
            configuration: `${language ?? 'unknown'}:${native?.extractDeclarations ? 'native' : 'typescript'}`,
          });
          const beforeCache = contentAddressedFactCacheStats();
          let syntax = contentAddressedGet<CachedSourceSyntax>(syntaxKey);
          if (!syntax) {
            syntax = contentAddressedCompute(syntaxKey, (): CachedSourceSyntax => {
              const parseStartedAt = performance.now();
              const codeView = maskMatrixSourceLiteralsCached(source, language, input.digest.value);
              recordGraphPhase('parse', {
                wallMs: performance.now() - parseStartedAt,
                files: 1,
                bytes: bytes.byteLength,
                cacheMisses: 1,
              });
              const extractStartedAt = performance.now();
              const nativeStartedAt = performance.now();
              const extractedSymbols = extractSymbols(source, input.locator, native, codeView);
              if (native?.extractDeclarations) {
                recordGraphPhase('nodeNativeBoundary', {
                  wallMs: performance.now() - nativeStartedAt,
                  files: 1,
                });
                recordGraphDataMovement('nativeBoundary');
              }
              const pythonAll =
                language === 'python' ? parsePythonAll(source, codeView) : undefined;
              recordGraphPhase('extract', {
                wallMs: performance.now() - extractStartedAt,
                files: 1,
                facts: extractedSymbols.findings.length,
                cacheMisses: 1,
              });
              return {
                encodingFallback: decoded.encodingFallback,
                generated: isGeneratedSource(input.locator, source),
                codeView,
                findings: extractedSymbols.findings,
                discovered: extractedSymbols.discovered,
                truncated: extractedSymbols.truncated,
                exportPairs: Object.freeze([...parseExportNameMap(source, codeView)]),
                pythonAllNames: pythonAll ? Object.freeze([...pythonAll]) : undefined,
                callSites: Object.freeze(scanMatrixCallSites(source, language, codeView)),
              };
            });
          }
          if (!syntax) {
            throw new Error('Source syntax extraction did not produce a snapshot.');
          }
          if (contentAddressedFactCacheStats().hits > beforeCache.hits) {
            recordGraphPhase('parse', { files: 1, cacheHits: 1, bytes: bytes.byteLength });
            recordGraphPhase('extract', { files: 1, cacheHits: 1, facts: syntax.findings.length });
          }
          const codeView = syntax.codeView;
          const extracted = {
            findings: syntax.findings,
            discovered: syntax.discovered,
            truncated: syntax.truncated,
          };
          sources.set(input.locator, source);
          codeViews.set(input.locator, codeView);
          linesByFile.set(input.locator, source.split(/\r?\n/u));
          exportMaps.set(input.locator, new Map(syntax.exportPairs));
          pythonAllByFile.set(
            input.locator,
            syntax.pythonAllNames ? new Set(syntax.pythonAllNames) : undefined
          );
          callSitesByFile.set(input.locator, syntax.callSites);
          if (syntax.generated || isGeneratedSource(input.locator, source))
            generated.add(input.locator);
          if (decoded.encodingFallback) {
            const encoding = warning(
              'graph.source-declaration-encoding-fallback',
              input.locator,
              'Source was admitted with a latin1 fallback after UTF-8 rejected the bytes; declarations remain observed under that encoding.'
            );
            diagnostics.push(encoding);
            inputDiagnostics.push(encoding);
          }
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
          preparedFiles.push({
            inputIndex,
            input,
            extracted,
            generatedFile,
            inputDiagnostics,
            outcome: 'processed',
          });
          fileIdentityJobs.push(
            request.resolveIdentity({
              namespace: 'workspai',
              kind: 'file',
              relativeLocator: input.locator,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            })
          );
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
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'source-declarations', version: manifest.version },
            outcome: 'failed',
            diagnostics: inputDiagnostics,
          });
        }
      }

      declarationBench('prepare', prepareStartedAt);
      const identityStartedAt = performance.now();
      const fileIdentities = await Promise.all(fileIdentityJobs);
      const symbolIdentityJobs: Promise<
        Awaited<ReturnType<GraphProviderCollectionRequest['resolveIdentity']>>
      >[] = [];
      const symbolOwners: { readonly preparedIndex: number; readonly symbolIndex: number }[] = [];
      for (const [preparedIndex, prepared] of preparedFiles.entries()) {
        if (prepared.restored) {
          const file = fileIdentities[preparedIndex];
          if (file?.accepted) files.set(prepared.input.locator, file.value.reference);
          continue;
        }
        const file = fileIdentities[preparedIndex];
        if (!file?.accepted) {
          const failure = warning(
            'graph.source-declaration-invalid',
            prepared.input.locator,
            'Source input could not be decoded or analyzed within the admitted boundary.'
          );
          diagnostics.push(failure);
          prepared.inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.source-declaration-unreadable',
            scope: prepared.input.locator,
            reason: 'Declarations are unknown because the source input could not be admitted.',
          });
          processing.push({
            input: { locator: prepared.input.locator, digest: prepared.input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'source-declarations', version: manifest.version },
            outcome: 'failed',
            diagnostics: prepared.inputDiagnostics,
          });
          continue;
        }
        files.set(prepared.input.locator, file.value.reference);
        if (prepared.generatedFile) continue;
        for (const [symbolIndex, symbol] of prepared.extracted.findings.entries()) {
          symbolOwners.push({ preparedIndex, symbolIndex });
          symbolIdentityJobs.push(
            request.resolveIdentity({
              namespace: 'workspai',
              kind: 'symbol',
              relativeLocator: `${prepared.input.locator}:${symbol.detail}:${symbol.name}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            })
          );
        }
      }
      const symbolIdentities = await Promise.all(symbolIdentityJobs);
      recordGraphPhase('factDeduplication', {
        wallMs: performance.now() - identityStartedAt,
        facts: symbolIdentityJobs.length,
        files: preparedFiles.length,
      });
      recordGraphDataMovement('deduplicated', Math.max(1, symbolIdentityJobs.length));
      const identitiesByPrepared = new Map<
        number,
        Map<number, (typeof symbolIdentities)[number]>
      >();
      for (const [jobIndex, owner] of symbolOwners.entries()) {
        const bySymbol = identitiesByPrepared.get(owner.preparedIndex) ?? new Map();
        bySymbol.set(owner.symbolIndex, symbolIdentities[jobIndex]!);
        identitiesByPrepared.set(owner.preparedIndex, bySymbol);
      }

      for (const [preparedIndex, prepared] of preparedFiles.entries()) {
        if (prepared.restored) continue;
        const file = files.get(prepared.input.locator);
        if (!file) continue;
        const declared: DeclaredSymbol[] = [];
        if (!prepared.generatedFile) {
          const identities = identitiesByPrepared.get(preparedIndex) ?? new Map();
          for (const [symbolIndex, symbol] of prepared.extracted.findings.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              prepared.outcome = 'omitted';
              truncated = true;
              unknownZones.push({
                code: 'graph.source-declarations-truncated',
                scope: prepared.input.locator,
                reason: 'Declaration facts exceeded the provider output budget.',
              });
              break;
            }
            const identity = identities.get(symbolIndex);
            if (!identity?.accepted) throw new Error('Symbol identity could not be resolved.');
            declared.push({
              name: symbol.name,
              detail: symbol.detail,
              line: symbol.line,
              locator: prepared.input.locator,
              reference: identity.value.reference,
              generated: false,
            });
            emittedAuthoredSymbols += 1;
            facts.push(
              createObservedEdgeFact({
                factId: `fact:source-declaration:${String(prepared.inputIndex).padStart(8, '0')}:${String(symbolIndex).padStart(8, '0')}:${prepared.input.digest.value}`,
                factType: 'source.declaration',
                subject: file,
                predicate: 'defines',
                object: identity.value.reference,
                request,
                source: prepared.input,
                provider: manifest,
                evidenceId: `evidence:source-declaration:${String(prepared.inputIndex).padStart(8, '0')}`,
                sourceKind: 'source-file',
                derivation: 'extracted',
                authority: 'observed',
                confidence: 0.7,
                extensions: Object.freeze({ symbolName: symbol.name }),
              })
            );
          }
        } else {
          for (const symbol of prepared.extracted.findings) {
            declared.push({
              name: symbol.name,
              detail: symbol.detail,
              line: symbol.line,
              locator: prepared.input.locator,
              reference: undefined,
              generated: true,
            });
          }
        }
        symbolsByFile.set(prepared.input.locator, declared);
        processing.push({
          input: { locator: prepared.input.locator, digest: prepared.input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'source-declarations', version: manifest.version },
          outcome: prepared.outcome,
          ...(prepared.outcome === 'processed' ? { outputDigest: prepared.input.digest } : {}),
          diagnostics: prepared.inputDiagnostics,
        });
      }

      const symbolIndexes = new Map<string, FileSymbolIndex>();
      for (const [locator, declared] of symbolsByFile) {
        const restored = restoredShards.get(locator);
        if (restored && isSourceDeclarationExtras(restored.extras)) {
          symbolIndexes.set(locator, indexFromExtras(restored.extras));
          continue;
        }
        symbolIndexes.set(
          locator,
          buildFileSymbolIndex(
            locator,
            declared,
            sources,
            codeViews,
            linesByFile,
            exportMaps,
            pythonAllByFile
          )
        );
        exportSignatures.set(
          locator,
          exportSignatureOf(symbolIndexes.get(locator)?.visible ?? [], [
            ...(exportMaps.get(locator) ?? []),
          ])
        );
      }

      for (const [locator, sourceText] of sources) {
        const codeView = codeViews.get(locator);
        if (!codeView) continue;
        recordGraphPhase('moduleResolution', { files: 1, invocations: 1 });
        reexportsByFile.set(
          locator,
          extractMatrixReexportBindings(
            locator,
            sourceText,
            matrixLanguageFor(locator),
            available,
            codeView
          )
        );
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (generated.has(input.locator)) continue;
        const file = files.get(input.locator);
        const sourceText = sources.get(input.locator);
        const codeView = codeViews.get(input.locator);
        if (!file || !sourceText || !codeView) continue;
        const declared = symbolIndexes.get(input.locator)?.visible ?? [];
        for (const [symbolIndex, symbol] of declared.entries()) {
          if (!symbol.reference) continue;
          if (facts.length >= manifest.limits.maxFacts) {
            truncated = true;
            unknownZones.push({
              code: 'graph.source-exports-truncated',
              scope: input.locator,
              reason: 'Export facts exceeded the provider output budget.',
            });
            break;
          }
          facts.push(
            createObservedEdgeFact({
              factId: `fact:source-export:${String(inputIndex).padStart(8, '0')}:${String(symbolIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.export',
              subject: file,
              predicate: 'exports',
              object: symbol.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:source-export:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'source-file',
              derivation: 'extracted',
              authority: 'observed',
              confidence: 0.7,
              extensions: Object.freeze({ symbolName: symbol.name }),
            })
          );
        }
      }

      const callBindStartedAt = performance.now();
      for (const [inputIndex, input] of inputs.entries()) {
        const restored = restoredShards.get(input.locator);
        const language = matrixLanguageFor(input.locator);
        let source = sources.get(input.locator);
        let codeView = codeViews.get(input.locator);
        const file = files.get(input.locator);
        if (!file || generated.has(input.locator)) {
          if (restored && !processing.some((record) => record.input.locator === input.locator)) {
            processing.push(restored.processing);
          }
          continue;
        }
        const importedLocators =
          dependencyLocatorsByFile.get(input.locator) ??
          (source && codeView
            ? extractMatrixLocalImportLocators(input.locator, source, language, available, codeView)
            : []);
        const peerLocators = matrixSameDirectoryPeers(input.locator, available);
        const dependencyLocators = [...new Set([...importedLocators, ...peerLocators])].sort(
          (left, right) => left.localeCompare(right)
        );
        dependencyLocatorsByFile.set(input.locator, dependencyLocators);
        const callEnvironmentDigest = locatorCallEnvironmentDigest(
          dependencyLocators,
          exportSignatures,
          reexportsByFile
        );
        if (
          appendReusedLocatorFacts(
            {
              providerId: SOURCE_DECLARATIONS_PROVIDER_ID,
              locator: input.locator,
              inputDigest: input.digest.value,
              inputIndex,
            },
            callEnvironmentDigest,
            facts,
            processing,
            unknownZones
          )
        ) {
          continue;
        }
        if (restored) {
          processing.push(restored.processing);
          if (isSourceDeclarationExtras(restored.extras)) {
            facts.push(...restored.facts.filter((fact) => fact.factType !== 'source.call'));
          }
        }
        if (!source || !codeView) {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const decoded = decodeMatrixSource(bytes);
          source = decoded.text;
          codeView = maskMatrixSourceLiteralsCached(source, language, input.digest.value);
          sources.set(input.locator, source);
          codeViews.set(input.locator, codeView);
        }
        if (!source || !codeView) continue;
        const importBindings = extractMatrixImportBindings(
          input.locator,
          source,
          language,
          available,
          codeView
        );
        const localSymbols = symbolsByFile.get(input.locator) ?? [];
        const importedSymbols = matrixUsesNamedImports(language)
          ? []
          : importedLocators.flatMap((locator) => symbolIndexes.get(locator)?.visible ?? []);
        const peerSymbols = peerLocators.flatMap(
          (locator) => symbolIndexes.get(locator)?.visible ?? []
        );
        const knownNames = new Set([
          ...localSymbols.map((symbol) => symbol.name),
          ...importedSymbols.map((symbol) => symbol.name),
          ...peerSymbols.map((symbol) => symbol.name),
          ...importBindings.flatMap((binding) =>
            binding.exportedName === '*'
              ? [...(symbolIndexes.get(binding.locator)?.visibleNames ?? [])]
              : [binding.localName]
          ),
        ]);
        let callIndex = 0;
        const emittedForName = new Map<string, number>();
        const ambiguousNames = new Set<string>();
        const truncatedNames = new Set<string>();
        for (const site of callSitesByFile.get(input.locator) ??
          scanMatrixCallSites(source, language, codeView)) {
          if (
            isKeywordDeclarationName(source, site.index) ||
            isConstructorCall(source, site.index)
          ) {
            excludedCalls += 1;
            continue;
          }
          const receiver = memberReceiver(source, site.index);
          const member = isMemberCall(source, site.index);
          const namedImportLanguage = matrixUsesNamedImports(language);
          const memberNamespace =
            member && receiver && !isLocalMemberReceiver(receiver)
              ? importBindings.filter(
                  (binding) => binding.localName === receiver && binding.exportedName === '*'
                )
              : [];
          if (
            member &&
            !(receiver && isLocalMemberReceiver(receiver)) &&
            memberNamespace.length === 0
          ) {
            externalCalls += 1;
            continue;
          }
          if (!receiver && isExternalFreeCall(site.name, knownNames)) {
            externalCalls += 1;
            continue;
          }
          examinedCalls += 1;
          if (!receiver && !knownNames.has(site.name)) {
            unresolvedCalls += 1;
            continue;
          }
          const freeBindings = importBindings.filter(
            (binding) => binding.exportedName !== '*' || binding.localName === '*'
          );
          const importedHits = importedCallCandidates(
            site.name,
            member ? memberNamespace : freeBindings,
            symbolIndexes,
            exportMaps,
            reexportsByFile
          );
          const target = resolveCallTarget(
            site.name,
            receiver && member && namedImportLanguage && !isLocalMemberReceiver(receiver)
              ? []
              : localSymbols,
            [...importedHits, ...(member ? [] : named(importedSymbols, site.name))],
            member ? [] : peerSymbols
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
            truncatedCalls += 1;
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
            truncatedCalls += 1;
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
              extensions: Object.freeze({ calleeName: site.name }),
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
              extensions: Object.freeze({ symbolName: symbol.name }),
            })
          );
        }
      }
      recordGraphPhase('moduleResolution', {
        wallMs: performance.now() - callBindStartedAt,
        files: inputs.length,
        facts: emittedCalls,
      });
      declarationBench('call-bind', callBindStartedAt);

      const rememberStartedAt = performance.now();
      const factsByLocator = new Map<string, GraphWorkspaceFact[]>();
      for (const fact of facts) {
        const locator = fact.evidence[0]?.relativeLocator;
        if (!locator) continue;
        const group = factsByLocator.get(locator);
        if (group) group.push(fact);
        else factsByLocator.set(locator, [fact]);
      }
      for (const [inputIndex, input] of inputs.entries()) {
        const index = symbolIndexes.get(input.locator);
        const processingRecord = processing.find(
          (record) => record.input.locator === input.locator
        );
        if (!index || !processingRecord) continue;
        rememberLocatorFactShard({
          schema: GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
          providerId: SOURCE_DECLARATIONS_PROVIDER_ID,
          providerVersion: manifest.version,
          locator: input.locator,
          inputDigest: input.digest.value,
          inputIndex,
          facts: Object.freeze(factsByLocator.get(input.locator) ?? []),
          unknownZones: Object.freeze(unknownZones.filter((zone) => zone.scope === input.locator)),
          processing: processingRecord,
          callEnvironmentDigest: locatorCallEnvironmentDigest(
            dependencyLocatorsByFile.get(input.locator) ?? [],
            exportSignatures,
            reexportsByFile
          ),
          extras: Object.freeze({
            exportSignature: exportSignatures.get(input.locator) ?? '',
            dependencyLocators: dependencyLocatorsByFile.get(input.locator) ?? [],
            declared: symbolsByFile.get(input.locator) ?? [],
            visible: index.visible,
            defaults: index.defaults,
            exportPairs: Object.freeze([...(exportMaps.get(input.locator) ?? [])]),
            pythonAllNames: pythonAllByFile.get(input.locator)
              ? Object.freeze([...(pythonAllByFile.get(input.locator) ?? [])])
              : undefined,
            reexports: Object.freeze([...(reexportsByFile.get(input.locator) ?? [])]),
          } satisfies SourceDeclarationShardExtras),
        });
      }
      declarationBench('remember', rememberStartedAt);

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
          {
            dimension: 'source-calls-external',
            observed: externalCalls,
          },
          {
            dimension: 'source-calls-excluded',
            observed: excludedCalls,
          },
          {
            dimension: 'source-calls-truncated',
            observed: truncatedCalls,
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
