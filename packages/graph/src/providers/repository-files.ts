import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE,
} from '../contracts/index.js';
import { appendReusedLocatorFacts } from '../application/locator-fact-shards.js';
import { graphUnsupportedObservation } from '../domain/unknown-cause.js';
import type { GraphProviderCollectionRequest } from '../contracts/provider.js';
import { isHostSuppliedGraphInputLocator } from './scope-containment.js';

export const REPOSITORY_FILES_PROVIDER_ID = 'workspai.graph.provider.repository-files';

const SUPPORTED_SOURCE_EXTENSIONS = new Set(
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.flatMap((profile) => profile.extensions)
);
const KNOWN_SOURCE_EXTENSIONS = new Set([
  ...SUPPORTED_SOURCE_EXTENSIONS,
  '.c',
  '.cc',
  '.clj',
  '.cljs',
  '.cpp',
  '.dart',
  '.ex',
  '.exs',
  '.fs',
  '.fsx',
  '.groovy',
  '.hs',
  '.kt',
  '.kts',
  '.lua',
  '.m',
  '.mlx',
  '.mlapp',
  '.p',
  '.mm',
  '.php',
  '.rb',
  '.scala',
  '.sol',
  '.swift',
  '.zig',
]);

function extension(locator: string): string {
  const basename = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

function isKnownSourceExtension(value: string): boolean {
  // MEX modules are executable code surfaces even though their platform suffix
  // varies. MATLAB data, figures, toolboxes and installers remain artifacts,
  // not source-code coverage candidates.
  return KNOWN_SOURCE_EXTENSIONS.has(value) || /^\.mex[a-z0-9_]*$/u.test(value);
}

async function* streamRepositoryFileBatches(
  manifest: { readonly id: string; readonly version: string },
  request: GraphProviderCollectionRequest
): AsyncGenerator<GraphFactBatch> {
  const repository = await request.resolveIdentity({
    namespace: 'workspai',
    kind: 'repository',
    relativeLocator: '.',
    caseSensitivity: 'sensitive',
    scope: request.scope,
  });
  if (!repository.accepted) {
    throw new Error(`Repository identity failed: ${repository.issues[0]?.code ?? 'unknown'}`);
  }
  const inputs = request.inputs.filter(
    (input) => !input.locator.startsWith('.git/') && !isHostSuppliedGraphInputLocator(input.locator)
  );
  const recognizedCodeInputs = inputs.filter((input) =>
    isKnownSourceExtension(extension(input.locator))
  );
  const semanticallySupportedInputs = recognizedCodeInputs.filter((input) =>
    SUPPORTED_SOURCE_EXTENSIONS.has(extension(input.locator))
  );
  const unsupportedZones = inputs
    .filter((input) => {
      const sourceExtension = extension(input.locator);
      return (
        isKnownSourceExtension(sourceExtension) && !SUPPORTED_SOURCE_EXTENSIONS.has(sourceExtension)
      );
    })
    .map((input) =>
      graphUnsupportedObservation({
        code: 'graph.source-language-unsupported',
        scope: input.locator,
        reason: `Semantic extraction is not admitted for ${extension(input.locator)} inputs; inventory and provenance remain preserved.`,
        provider: REPOSITORY_FILES_PROVIDER_ID,
        stage: 'provider-collect',
        language: extension(input.locator).replace(/^\./u, ''),
      })
    );
  const processing = inputs.map((input) => ({
    input: { locator: input.locator, digest: input.digest },
    provider: { id: manifest.id, version: manifest.version },
    stage: { id: 'repository-file-inventory', version: manifest.version },
    outcome: 'processed' as const,
    outputDigest: input.digest,
    diagnostics: [],
  }));
  yield {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: manifest.id, version: manifest.version },
    batchId: `batch:repository-files:${inputs.length}`,
    scope: request.scope,
    inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
    facts: [],
    diagnostics: [],
    coverage: [
      {
        dimension: 'repository-files',
        observed: inputs.length,
        expected: inputs.length,
      },
      {
        dimension: 'recognized-code-semantic-depth',
        observed: semanticallySupportedInputs.length,
        expected: recognizedCodeInputs.length,
      },
    ],
    unknownZones: [],
    unsupportedZones,
    redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
    status: unsupportedZones.length > 0 ? 'partial' : 'complete',
    processing,
  };
  for (const [index, input] of inputs.entries()) {
    if (request.signal?.aborted) throw new Error('Repository file collection was cancelled.');
    const facts: GraphWorkspaceFact[] = [];
    if (
      !appendReusedLocatorFacts(
        {
          providerId: REPOSITORY_FILES_PROVIDER_ID,
          locator: input.locator,
          inputDigest: input.digest.value,
          inputIndex: index,
        },
        '',
        facts,
        [],
        []
      )
    ) {
      const file = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: input.locator,
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!file.accepted) {
        throw new Error(
          `File identity failed for ${input.locator}: ${file.issues[0]?.code ?? 'unknown'}`
        );
      }
      facts.push({
        factId: `fact:repository-file:${String(index).padStart(8, '0')}:${input.digest.value}`,
        factType: 'source.file',
        subject: repository.value.reference,
        predicate: 'contains',
        object: file.value.reference,
        scope: request.scope,
        evidence: [
          {
            id: `evidence:repository-file:${String(index).padStart(8, '0')}`,
            sourceKind: 'source-file',
            relativeLocator: input.locator,
            digest: input.digest,
          },
        ],
        provenance: { id: manifest.id, version: manifest.version },
        derivation: 'observed',
        authority: 'observed',
        confidence: 1,
        freshness: { status: 'current' },
        truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
        observedAt: request.observedAt,
        partitionOwner: { locator: input.locator, observationOrigin: 'build-clock' },
        inputDigest: input.digest,
        unknownZones: [],
      });
    }
    yield {
      contract: GRAPH_FACT_BATCH_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      batchId: `batch:repository-files:${input.locator}`,
      scope: request.scope,
      inputs: [{ locator: input.locator, digest: input.digest }],
      facts,
      diagnostics: [],
      coverage: [],
      unknownZones: [],
      unsupportedZones: [],
      redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
      status: 'complete',
      processing: [
        {
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'repository-file-inventory', version: manifest.version },
          outcome: 'processed',
          outputDigest: input.digest,
          diagnostics: [],
        },
      ],
    };
  }
}

async function joinRepositoryFileBatches(
  batches: AsyncIterable<GraphFactBatch>
): Promise<GraphFactBatch> {
  let receipt: GraphFactBatch | undefined;
  const inputs: GraphFactBatch['inputs'][number][] = [];
  const facts: GraphWorkspaceFact[] = [];
  const processing: GraphFactBatch['processing'][number][] = [];
  for await (const batch of batches) {
    if (batch.facts.length === 0 && batch.coverage.length > 0) {
      receipt = batch;
      continue;
    }
    inputs.push(...batch.inputs);
    facts.push(...batch.facts);
    processing.push(...batch.processing);
  }
  if (!receipt) throw new Error('repository-files stream did not emit a receipt');
  return {
    ...receipt,
    inputs,
    facts,
    processing,
  };
}

export function createRepositoryFilesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: REPOSITORY_FILES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Repository files',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file'],
      relationKinds: ['contains'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.file'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 100_000 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['repository-files'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: request.availableInputs.some(
        (input) => !input.startsWith('.git/') && !isHostSuppliedGraphInputLocator(input)
      )
        ? 'applicable'
        : 'not-applicable',
      matchedInputs: request.availableInputs.some(
        (input) => !input.startsWith('.git/') && !isHostSuppliedGraphInputLocator(input)
      )
        ? ['repository-files']
        : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    partitionStream: (request) => streamRepositoryFileBatches(manifest, request),
    collect: async (request) =>
      joinRepositoryFileBatches(streamRepositoryFileBatches(manifest, request)),
  };
}
