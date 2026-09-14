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
import { createObservedEdgeFact, extensionOf, stripComments } from './observed-edge-fact.js';

export const SOURCE_DECLARATIONS_PROVIDER_ID = 'workspai.graph.provider.source-declarations';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
export const MAX_SYMBOLS_PER_FILE = 100;
export const MAX_CALLS_PER_SYMBOL = 20;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.go',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.py',
  '.rs',
  '.ts',
  '.tsx',
]);
const SYMBOL_PATTERNS: readonly { readonly pattern: RegExp; readonly detail: string }[] = [
  {
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u,
    detail: 'function',
  },
  {
    pattern:
      /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/u,
    detail: 'type',
  },
  {
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u,
    detail: 'value',
  },
  { pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/u, detail: 'function' },
  { pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/u, detail: 'function' },
  { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/u, detail: 'function' },
];
const STATIC_IMPORT =
  /^\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)['"]([^'"\r\n]+)['"]/gmu;

interface DeclaredSymbol {
  readonly name: string;
  readonly detail: string;
  readonly line: number;
  readonly locator: string;
  readonly reference: GraphEntityReference;
}

function sourceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => SOURCE_EXTENSIONS.has(extensionOf(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function directory(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? '' : locator.slice(0, separator);
}

function resolveRelative(base: string, relative: string): string | null {
  const normalized: string[] = [];
  for (const segment of [...(base ? base.split('/') : []), ...relative.split('/')]) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else normalized.push(segment);
  }
  return normalized.join('/');
}

function resolveLocalImport(
  source: string,
  specifier: string,
  available: ReadonlySet<string>
): string | null {
  const candidate = resolveRelative(directory(source), specifier);
  if (!candidate) return null;
  const extensions = ['', ...SOURCE_EXTENSIONS];
  for (const extension of extensions) {
    const direct = `${candidate}${extension}`;
    if (available.has(direct)) return direct;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const indexed = `${candidate}/index${extension}`;
    if (available.has(indexed)) return indexed;
  }
  return null;
}

function extractSymbols(source: string): {
  readonly findings: readonly { name: string; detail: string; line: number }[];
  readonly discovered: number;
  readonly truncated: boolean;
} {
  const findings: { name: string; detail: string; line: number }[] = [];
  let discovered = 0;
  const lines = stripComments(source).split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const candidate of SYMBOL_PATTERNS) {
      const match = lines[index]?.match(candidate.pattern);
      const name = match?.[1]?.trim();
      if (!name) continue;
      discovered += 1;
      if (findings.length < MAX_SYMBOLS_PER_FILE) {
        findings.push({ name, detail: candidate.detail, line: index + 1 });
      }
      break;
    }
  }
  return {
    findings,
    discovered,
    truncated: discovered > MAX_SYMBOLS_PER_FILE,
  };
}

function warning(code: string, scope: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path: scope, message };
}

export function createSourceDeclarationsProvider(): GraphProviderRuntime {
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
        SOURCE_EXTENSIONS.has(extensionOf(locator))
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
      const inputs = sourceInputs(request.inputs);
      const available = new Set(request.inputs.map((input) => input.locator));
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const symbolsByFile = new Map<string, DeclaredSymbol[]>();
      const sources = new Map<string, string>();
      const files = new Map<string, GraphEntityReference>();
      let discoveredSymbols = 0;
      let emittedSymbols = 0;
      let discoveredCalls = 0;
      let emittedCalls = 0;
      let truncated = false;

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
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          sources.set(input.locator, source);
          const file = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!file.accepted) throw new Error('Source file identity could not be resolved.');
          files.set(input.locator, file.value.reference);
          const extracted = extractSymbols(source);
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
        if (!source || !file) continue;
        const imported = new Set<string>();
        for (const match of stripComments(source).matchAll(STATIC_IMPORT)) {
          const specifier = match[1];
          if (!specifier?.startsWith('.')) continue;
          const local = resolveLocalImport(input.locator, specifier, available);
          if (local) imported.add(local);
        }
        const candidates = [
          ...(symbolsByFile.get(input.locator) ?? []),
          ...[...imported].flatMap((locator) => symbolsByFile.get(locator) ?? []),
        ];
        const byName = new Map<string, DeclaredSymbol[]>();
        for (const symbol of candidates) {
          if (symbol.name.length < 3) continue;
          const values = byName.get(symbol.name) ?? [];
          if (!values.some((item) => item.reference.id === symbol.reference.id))
            values.push(symbol);
          byName.set(symbol.name, values);
        }
        let callIndex = 0;
        for (const [name, targets] of [...byName.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
          const matches = [...source.matchAll(new RegExp(`\\b${escaped}\\s*\\(`, 'gu'))];
          if (matches.length === 0) continue;
          if (targets.length !== 1) {
            unknownZones.push({
              code: 'graph.source-call-ambiguous',
              scope: input.locator,
              reason: `Call sites for ${name} resolved to multiple local declarations and were left unknown.`,
            });
            continue;
          }
          const target = targets[0]!;
          const eligible = matches.filter((match) => {
            const line = source.slice(0, match.index ?? 0).split(/\r?\n/u).length;
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
            expected: inputs.length,
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
