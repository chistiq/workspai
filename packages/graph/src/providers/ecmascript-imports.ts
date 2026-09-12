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

export const ECMASCRIPT_IMPORTS_PROVIDER_ID = 'workspai.graph.provider.ecmascript-imports';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const RESOLUTION_EXTENSIONS = ['', ...SOURCE_EXTENSIONS];
const TYPESCRIPT_RUNTIME_REWRITES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '.js': Object.freeze(['.ts', '.tsx']),
  '.jsx': Object.freeze(['.tsx']),
  '.mjs': Object.freeze(['.mts']),
  '.cjs': Object.freeze(['.cts']),
});
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 500_000;
const STATIC_IMPORT =
  /^\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)['"]([^'"\r\n]+)['"]/gmu;

function extension(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
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

function sourceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => SOURCE_EXTENSIONS.has(extension(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function resolveLocalImport(
  source: string,
  specifier: string,
  available: ReadonlySet<string>
): string | null {
  const candidate = resolveRelative(directory(source), specifier);
  if (!candidate) return null;
  const runtimeExtension = extension(candidate);
  const rewrites = TYPESCRIPT_RUNTIME_REWRITES[runtimeExtension] ?? [];
  if (rewrites.length > 0) {
    const stem = candidate.slice(0, -runtimeExtension.length);
    for (const rewrite of rewrites) {
      const typescriptSource = `${stem}${rewrite}`;
      if (available.has(typescriptSource)) return typescriptSource;
    }
  }
  for (const extension of RESOLUTION_EXTENSIONS) {
    const direct = `${candidate}${extension}`;
    if (available.has(direct)) return direct;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const indexed = `${candidate}/index${extension}`;
    if (available.has(indexed)) return indexed;
  }
  return null;
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
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_SOURCE_BYTES,
            signal: request.signal,
          });
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const syntaxView = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
          const specifiers = [...syntaxView.matchAll(STATIC_IMPORT)]
            .map((match) => match[1])
            .filter((specifier): specifier is string => Boolean(specifier));
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
            const local = specifier.startsWith('.')
              ? resolveLocalImport(input.locator, specifier, available)
              : null;
            if (specifier.startsWith('.') && !local) {
              unknownZones.push({
                code: 'graph.ecmascript-local-import-unresolved',
                scope: input.locator,
                reason: 'A relative static import did not resolve to an inventoried source file.',
              });
              continue;
            }
            const object = await request.resolveIdentity({
              namespace: local ? 'workspai' : 'ecmascript-module',
              kind: local ? 'file' : 'module',
              relativeLocator: local ?? specifier,
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
              inputDigest: input.digest,
              unknownZones: [],
            });
          }
          if (/\brequire\s*\(|\bimport\s*\(/u.test(source)) {
            unknownZones.push({
              code: 'graph.ecmascript-dynamic-import-unsupported',
              scope: input.locator,
              reason:
                'Dynamic import and CommonJS require targets are outside this static profile.',
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
