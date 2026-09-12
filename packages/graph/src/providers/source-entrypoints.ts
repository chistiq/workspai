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

export const SOURCE_ENTRYPOINTS_PROVIDER_ID = 'workspai.graph.provider.source-entrypoints';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 100_000;
const CANDIDATE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.dart',
  '.ex',
  '.exs',
  '.fs',
  '.fsx',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.lua',
  '.mjs',
  '.mts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.swift',
  '.ts',
  '.tsx',
  '.zig',
]);
const DIRECT_APPLICATION_EXTENSIONS = new Set(['.mlapp']);

function extension(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function basename(locator: string): string {
  return locator.slice(locator.lastIndexOf('/') + 1).toLowerCase();
}

function candidateInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => {
      const value = extension(input.locator);
      return CANDIDATE_EXTENSIONS.has(value) || DIRECT_APPLICATION_EXTENSIONS.has(value);
    })
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function isSourceEntrypoint(locator: string, source: string): string | undefined {
  const ext = extension(locator);
  const name = basename(locator);
  if (/^#![^\r\n]+/u.test(source)) return 'executable-shebang';
  if (ext === '.go' && /\bpackage\s+main\b[\s\S]*\bfunc\s+main\s*\(/u.test(source))
    return 'go-main';
  if (ext === '.rs' && /\bfn\s+main\s*\(/u.test(source)) return 'rust-main';
  if (['.c', '.cc', '.cpp'].includes(ext) && /\b(?:int|auto)\s+main\s*\(/u.test(source))
    return 'native-main';
  if (ext === '.java' && /\bpublic\s+static\s+void\s+main\s*\(/u.test(source)) return 'java-main';
  if (
    ext === '.cs' &&
    (name === 'program.cs' ||
      /\bstatic\s+(?:async\s+)?(?:void|Task(?:<int>)?|int)\s+Main\s*\(/u.test(source))
  )
    return 'dotnet-main';
  if (['.kt', '.kts'].includes(ext) && /\bfun\s+main\s*\(/u.test(source)) return 'kotlin-main';
  if (ext === '.swift' && (/@main\b/u.test(source) || /\bstatic\s+func\s+main\s*\(/u.test(source)))
    return 'swift-main';
  if (ext === '.dart' && /\bvoid\s+main\s*\(/u.test(source)) return 'dart-main';
  if (ext === '.zig' && /\bpub\s+fn\s+main\s*\(/u.test(source)) return 'zig-main';
  if (['.fs', '.fsx'].includes(ext) && /\[<EntryPoint>\]/u.test(source)) return 'fsharp-main';
  if (ext === '.scala' && /\b(?:object\s+\w+\s+extends\s+App|def\s+main\s*\()/u.test(source))
    return 'scala-main';
  if (['.ex', '.exs'].includes(ext) && /\bdef\s+start\s*\([^)]*\)\s+do\b/u.test(source))
    return 'elixir-application-start';
  if (ext === '.lua' && /(?:^|\/)main\.lua$/u.test(locator.toLowerCase())) return 'lua-main-file';
  if (ext === '.php' && /(?:^|\/)(?:index\.php|bin\/console)$/u.test(locator.toLowerCase()))
    return 'php-front-controller';
  if (ext === '.rb' && /(?:^|\/)bin\/[^/]+$/u.test(locator.toLowerCase())) return 'ruby-bin';
  if (ext === '.py' && ['__main__.py', 'main.py', 'manage.py', 'wsgi.py', 'asgi.py'].includes(name))
    return 'python-main-file';
  return undefined;
}

export function createSourceEntrypointsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: SOURCE_ENTRYPOINTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Cross-language source entrypoints',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'command'],
      relationKinds: ['declares'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['source.entrypoint'],
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
    supportedInputs: ['cross-language-source-entrypoints', 'matlab-application-artifacts'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => {
        const value = extension(locator);
        return CANDIDATE_EXTENSIONS.has(value) || DIRECT_APPLICATION_EXTENSIONS.has(value);
      });
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? [...manifest.supportedInputs] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = candidateInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      for (const [inputIndex, input] of inputs.entries()) {
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const inputExtension = extension(input.locator);
          const reason = DIRECT_APPLICATION_EXTENSIONS.has(inputExtension)
            ? 'matlab-application-artifact'
            : isSourceEntrypoint(
                input.locator,
                new TextDecoder('utf-8', { fatal: true }).decode(
                  await request.readInput(input, {
                    maxBytes: MAX_SOURCE_BYTES,
                    signal: request.signal,
                  })
                )
              );
          if (reason) {
            const source = await request.resolveIdentity({
              namespace: 'workspai',
              kind: 'file',
              relativeLocator: input.locator,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            const command = await request.resolveIdentity({
              namespace: 'source-entrypoint',
              kind: 'command',
              relativeLocator: `entrypoints/${encodeURIComponent(input.locator)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!source.accepted || !command.accepted)
              throw new Error('Entrypoint identity could not be resolved.');
            facts.push({
              factId: `fact:source-entrypoint:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'source.entrypoint',
              subject: source.value.reference,
              predicate: 'declares',
              object: command.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:source-entrypoint:${String(inputIndex).padStart(8, '0')}`,
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
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion', 'provider-change'] },
              observedAt: request.observedAt,
              inputDigest: input.digest,
              unknownZones: [],
              extensions: { 'workspai.graph.entrypoint.reason': reason },
            });
          }
        } catch (error) {
          const item: GraphDiagnostic = {
            code: 'graph.entrypoint-source-invalid',
            severity: 'warning',
            path: input.locator,
            message:
              error instanceof Error ? error.message : 'Entrypoint source could not be analyzed.',
          };
          diagnostics.push(item);
          inputDiagnostics.push(item);
          unknownZones.push({
            code: 'graph.entrypoint-unknown',
            scope: input.locator,
            reason:
              'Entrypoint status is unknown because the candidate source could not be read safely.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'source-entrypoint-detection', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:source-entrypoints:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'entrypoint-candidates', observed: inputs.length, expected: inputs.length },
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
