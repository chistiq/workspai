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
import { ECMASCRIPT_STATIC_IMPORT_PATTERN } from './ecmascript-import-pattern.js';
import { maskMatrixSourceLiteralsCached, matchAllInMatrixCodeView } from './matrix-source-mask.js';
import { admitDeclaredGraphLocator } from '../domain/locator-identity.js';
import {
  classifyModuleSpecifier,
  resolveEcmaScriptModuleLocator,
} from '../domain/module-resolution.js';
import { appendReusedLocatorFacts } from '../application/locator-fact-shards.js';

export const ECMASCRIPT_IMPORTS_PROVIDER_ID = 'workspai.graph.provider.ecmascript-imports';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
const LITERAL_COMMONJS_REQUIRE = /\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/gmu;
const LITERAL_DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/gmu;

function extension(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function sourceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => SOURCE_EXTENSIONS.has(extension(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function hasComputedModuleCall(source: string, masked: string): boolean {
  const calls = [/\brequire\s*\(/gmu, /\bimport\s*\(/gmu] as const;
  const literal = /^(?:require|import)\s*\(\s*(['"])[^'"\r\n]+\1\s*\)/u;
  for (const pattern of calls) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (source[index] !== masked[index]) continue;
      if (!literal.test(source.slice(index))) return true;
    }
  }
  return false;
}

function resolveLocalImport(
  source: string,
  specifier: string,
  available: ReadonlySet<string>
): string | null {
  return resolveEcmaScriptModuleLocator({
    fromLocator: source,
    specifier,
    available,
  });
}

function warning(code: string, scope: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path: scope, message };
}

export function createEcmaScriptImportsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: ECMASCRIPT_IMPORTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'ECMAScript static imports',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'module'],
      relationKinds: ['imports'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.static-import'],
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
    supportedInputs: ['ecmascript-source'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        SOURCE_EXTENSIONS.has(extension(locator))
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['ecmascript-source'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = sourceInputs(request.inputs);
      const available = new Set(request.inputs.map((input) => input.locator));
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Source import collection was cancelled.');
        if (
          appendReusedLocatorFacts(
            {
              providerId: ECMASCRIPT_IMPORTS_PROVIDER_ID,
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
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const codeView = maskMatrixSourceLiteralsCached(source, 'node', input.digest.value);
          const specifiers = [
            ...matchAllInMatrixCodeView(source, codeView, ECMASCRIPT_STATIC_IMPORT_PATTERN).map(
              (match) => match[1]
            ),
            ...matchAllInMatrixCodeView(source, codeView, LITERAL_COMMONJS_REQUIRE).map(
              (match) => match[2]
            ),
            ...matchAllInMatrixCodeView(source, codeView, LITERAL_DYNAMIC_IMPORT).map(
              (match) => match[2]
            ),
          ].filter((specifier): specifier is string => Boolean(specifier));
          const uniqueSpecifiers = [...new Set(specifiers)].sort((left, right) =>
            left.localeCompare(right)
          );
          const subject = await request.resolveIdentity({
            namespace: 'workspai',
            kind: 'file',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!subject.accepted) throw new Error('Source identity could not be resolved.');

          for (const [specifierIndex, specifier] of uniqueSpecifiers.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              outcome = 'omitted';
              unknownZones.push({
                code: 'graph.ecmascript-imports-truncated',
                scope: input.locator,
                reason: 'Static import facts exceeded the provider output budget.',
              });
              break;
            }
            const specifierClass = classifyModuleSpecifier(specifier);
            const local =
              specifierClass === 'relative'
                ? resolveLocalImport(input.locator, specifier, available)
                : null;
            if (specifierClass === 'relative' && !local) {
              unknownZones.push({
                code: 'graph.ecmascript-local-import-unresolved',
                scope: input.locator,
                reason: 'A relative static import did not resolve to an inventoried source file.',
              });
              continue;
            }
            if (specifierClass === 'unsupported') {
              unknownZones.push({
                code: 'graph.ecmascript-import-specifier-unsupported',
                scope: input.locator,
                reason: 'A static import specifier is not a portable relative or package locator.',
              });
              continue;
            }
            const object = await request.resolveIdentity({
              namespace: local ? 'workspai' : 'ecmascript-module',
              kind: local ? 'file' : 'module',
              relativeLocator: local ?? admitDeclaredGraphLocator(specifier, 'encoded'),
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!object.accepted)
              throw new Error('Imported entity identity could not be resolved.');
            facts.push({
              factId: `fact:ecmascript-import:${String(inputIndex).padStart(8, '0')}:${String(specifierIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.static-import',
              subject: subject.value.reference,
              predicate: 'imports',
              object: object.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:ecmascript-import:${String(inputIndex).padStart(8, '0')}`,
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
              extensions: Object.freeze({ moduleSpecifier: specifier }),
            });
          }
          if (hasComputedModuleCall(source, codeView)) {
            unknownZones.push({
              code: 'graph.ecmascript-dynamic-import-unsupported',
              scope: input.locator,
              reason: 'Computed CommonJS or dynamic import targets are outside this profile.',
            });
            outcome = outcome === 'omitted' ? outcome : 'unsupported';
          }
        } catch {
          const failure = warning(
            'graph.ecmascript-source-invalid',
            input.locator,
            'Source input could not be decoded or analyzed within the admitted boundary.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.ecmascript-source-unreadable',
            scope: input.locator,
            reason: 'Static imports are unknown because the source input could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'ecmascript-static-imports', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:ecmascript-imports:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'ecmascript-source', observed: inputs.length, expected: inputs.length },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
