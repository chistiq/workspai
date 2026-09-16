import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphEntityReference,
  type GraphFactBatch,
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
  extractMatrixLocalImportLocators,
  matchMatrixCallSites,
  matrixLanguageFor,
  matrixSameDirectoryPeers,
  matrixSourceExtractionBudget,
  selectBalancedMatrixSources,
  stripMatrixSourceComments,
} from './matrix-source-language.js';
import { extractPublishedMatrixDeclarations } from './route-native-declarations.js';

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
  readonly detail: string;
  readonly line: number;
  readonly locator: string;
  readonly reference: GraphEntityReference;
}

function sourceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => MATRIX_SOURCE_EXTENSIONS.has(extensionOf(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function extractSymbols(
  source: string,
  locator: string,
  native: GraphNativePort | undefined
): {
  readonly findings: readonly { name: string; detail: string; line: number }[];
  readonly discovered: number;
  readonly truncated: boolean;
} {
  const all = extractPublishedMatrixDeclarations(
    source,
    matrixLanguageFor(locator),
    native
  ).declarations;
  return {
    findings: all.slice(0, MAX_SYMBOLS_PER_FILE),
    discovered: all.length,
    truncated: all.length > MAX_SYMBOLS_PER_FILE,
  };
}

function uniqueSymbols(symbols: readonly DeclaredSymbol[]): DeclaredSymbol[] {
  const unique: DeclaredSymbol[] = [];
  for (const symbol of symbols) {
    if (!unique.some((item) => item.reference.id === symbol.reference.id)) unique.push(symbol);
  }
  return unique;
}

function resolveCallTarget(
  name: string,
  local: readonly DeclaredSymbol[],
  imported: readonly DeclaredSymbol[],
  peers: readonly DeclaredSymbol[]
): DeclaredSymbol | 'ambiguous' | undefined {
  const localMatches = uniqueSymbols(local.filter((symbol) => symbol.name === name));
  if (localMatches.length === 1) return localMatches[0];
  if (localMatches.length > 1) return 'ambiguous';
  const importedMatches = uniqueSymbols(imported.filter((symbol) => symbol.name === name));
  if (importedMatches.length === 1) return importedMatches[0];
  if (importedMatches.length > 1) return 'ambiguous';
  const peerMatches = uniqueSymbols(peers.filter((symbol) => symbol.name === name));
  if (peerMatches.length === 1) return peerMatches[0];
  if (peerMatches.length > 1) return 'ambiguous';
  return undefined;
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
      const files = new Map<string, GraphEntityReference>();
      const generated = new Set<string>();
      let discoveredSymbols = 0;
      let emittedSymbols = 0;
      let discoveredCalls = 0;
      let emittedCalls = 0;
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
          sources.set(input.locator, source);
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
          const extracted = extractSymbols(source, input.locator, native);
          discoveredSymbols += extracted.discovered;
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
            const identity = await request.resolveIdentity({
              namespace: 'workspai',
              kind: 'symbol',
              relativeLocator: `${input.locator}:${symbol.detail}:${symbol.name}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!identity.accepted) throw new Error('Symbol identity could not be resolved.');
            declared.push({
              name: symbol.name,
              detail: symbol.detail,
              line: symbol.line,
              locator: input.locator,
              reference: identity.value.reference,
            });
            emittedSymbols += 1;
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

      for (const [inputIndex, input] of inputs.entries()) {
        const source = sources.get(input.locator);
        const file = files.get(input.locator);
        if (!source || !file || generated.has(input.locator)) continue;
        const language = matrixLanguageFor(input.locator);
        const importedLocators = extractMatrixLocalImportLocators(
          input.locator,
          source,
          language,
          available
        );
        const peerLocators = matrixSameDirectoryPeers(input.locator, available);
        const localSymbols = (symbolsByFile.get(input.locator) ?? []).filter(
          (symbol) => symbol.name.length >= 3
        );
        const importedSymbols = importedLocators.flatMap(
          (locator) => symbolsByFile.get(locator) ?? []
        );
        const peerSymbols = peerLocators.flatMap((locator) => symbolsByFile.get(locator) ?? []);
        const names = [
          ...new Set(
            [...localSymbols, ...importedSymbols, ...peerSymbols]
              .map((symbol) => symbol.name)
              .filter((name) => name.length >= 3)
          ),
        ].sort((left, right) => left.localeCompare(right));
        let callIndex = 0;
        const searchable = stripMatrixSourceComments(source, language);
        for (const name of names) {
          const target = resolveCallTarget(name, localSymbols, importedSymbols, peerSymbols);
          if (target === 'ambiguous') {
            unknownZones.push({
              code: 'graph.source-call-ambiguous',
              scope: input.locator,
              reason: `Call sites for ${name} resolved to multiple local declarations and were left unknown.`,
            });
            continue;
          }
          if (!target) continue;
          const matches = matchMatrixCallSites(searchable, language, name).map((index) => ({
            index,
          }));
          if (matches.length === 0) continue;
          const eligible = matches.filter((match) => {
            const line = searchable.slice(0, match.index ?? 0).split(/\r?\n/u).length;
            return !(target.locator === input.locator && target.line === line);
          });
          discoveredCalls += eligible.length;
          if (eligible.length > MAX_CALLS_PER_SYMBOL) {
            truncated = true;
            unknownZones.push({
              code: 'graph.source-calls-truncated',
              scope: input.locator,
              reason: `Call extraction for ${name} stopped at ${String(MAX_CALLS_PER_SYMBOL)} sites; remaining calls are unknown.`,
            });
          }
          const limited = eligible.slice(0, MAX_CALLS_PER_SYMBOL);
          for (let emitted = 0; emitted < limited.length; emitted += 1) {
            if (facts.length >= manifest.limits.maxFacts) {
              truncated = true;
              unknownZones.push({
                code: 'graph.source-calls-truncated',
                scope: input.locator,
                reason: 'Call facts exceeded the provider output budget.',
              });
              break;
            }
            facts.push(
              createObservedEdgeFact({
                factId: `fact:source-call:${String(inputIndex).padStart(8, '0')}:${String(callIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'source.call',
                subject: file,
                predicate: 'calls',
                object: target.reference,
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
          }
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
            observed: emittedSymbols,
            expected: discoveredSymbols,
          },
          {
            dimension: 'source-declaration-calls',
            observed: emittedCalls,
            expected: discoveredCalls,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          truncated || processing.some((entry) => entry.outcome !== 'processed')
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
