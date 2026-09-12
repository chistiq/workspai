import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const REPOSITORY_SURFACES_PROVIDER_ID = 'workspai.graph.provider.repository-surfaces';

interface SurfaceClassification {
  readonly kind: 'artifact' | 'contract' | 'container' | 'workflow' | 'test';
  readonly family: string;
  readonly predicate: 'declares' | 'contains';
  readonly sourceKind: string;
}

function basename(locator: string): string {
  return locator.slice(locator.lastIndexOf('/') + 1).toLowerCase();
}

function isTestSurface(locator: string, name: string): boolean {
  const segments = locator.split('/');
  if (
    segments.some((segment) => ['test', 'tests', 'spec', 'specs', '__tests__'].includes(segment))
  ) {
    return true;
  }
  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex <= 0) return false;
  const stem = name.slice(0, extensionIndex);
  return (
    stem.endsWith('.test') ||
    stem.endsWith('.spec') ||
    stem.endsWith('_test') ||
    stem.startsWith('test_')
  );
}

function classify(input: GraphProviderInput): readonly SurfaceClassification[] {
  const locator = input.locator.toLowerCase();
  const name = basename(locator);
  const result: SurfaceClassification[] = [];
  if (
    /(?:^|\/)(?:openapi|swagger|asyncapi)(?:\.[^/]+)?\.(?:json|ya?ml)$/u.test(locator) ||
    /(?:^|\/)contracts?\/[^/]+\.(?:json|ya?ml|proto|graphql|gql)$/u.test(locator) ||
    /\.(?:proto|graphql|gql)$/u.test(locator)
  ) {
    result.push({
      kind: 'contract',
      family: 'declaration.contract',
      predicate: 'declares',
      sourceKind: 'contract-declaration',
    });
  }
  if (
    /\.(?:mat|fig|mlx|mlapp|mltbx|mlappinstall|mlpkginstall|p)$/u.test(locator) ||
    /\.mex[a-z0-9_]*$/u.test(locator)
  ) {
    result.push({
      kind: 'artifact',
      family: 'artifact.matlab',
      predicate: 'declares',
      sourceKind: 'matlab-artifact',
    });
  }
  if (
    name === 'dockerfile' ||
    name.startsWith('dockerfile.') ||
    /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/u.test(locator) ||
    /(?:^|\/)k8s\/[^/]+\.ya?ml$/u.test(locator) ||
    /(?:^|\/)kubernetes\/[^/]+\.ya?ml$/u.test(locator)
  ) {
    result.push({
      kind: 'container',
      family: 'declaration.runtime',
      predicate: 'declares',
      sourceKind: 'runtime-declaration',
    });
  }
  if (
    /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/u.test(locator) ||
    name === 'jenkinsfile' ||
    name === '.gitlab-ci.yml' ||
    name === 'azure-pipelines.yml' ||
    name === 'circle.yml'
  ) {
    result.push({
      kind: 'workflow',
      family: 'delivery.workflow',
      predicate: 'contains',
      sourceKind: 'delivery-declaration',
    });
  }
  if (isTestSurface(locator, name)) {
    result.push({
      kind: 'test',
      family: 'delivery.test',
      predicate: 'contains',
      sourceKind: 'test-source',
    });
  }
  return result;
}

function surfaceInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => classify(input).length > 0)
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

export function createRepositorySurfacesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: REPOSITORY_SURFACES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Repository contracts, runtime and delivery surfaces',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'artifact', 'contract', 'container', 'workflow', 'test'],
      relationKinds: ['declares', 'contains'],
      relationSemantics: ['declarative', 'structural'] as const,
      factFamilies: [
        'declaration.contract',
        'declaration.runtime',
        'delivery.workflow',
        'delivery.test',
      ],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 100_000 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['contract-declarations', 'runtime-declarations', 'delivery-surfaces'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some(
        (locator) =>
          classify({
            locator,
            mediaType: 'application/octet-stream',
            byteLength: 0,
            digest: { algorithm: 'sha256', value: '0'.repeat(64) },
          }).length > 0
      );
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
      const inputs = surfaceInputs(request.inputs);
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted)
        throw new Error('Repository surface identity could not be resolved.');
      const facts: GraphWorkspaceFact[] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted)
          throw new Error('Repository surface collection was cancelled.');
        const classifications = classify(input);
        for (const [surfaceIndex, surface] of classifications.entries()) {
          const identity = await request.resolveIdentity({
            namespace: `repository-${surface.kind}`,
            kind: surface.kind,
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!identity.accepted)
            throw new Error('Repository surface identity could not be resolved.');
          facts.push({
            factId: `fact:repository-surface:${String(inputIndex).padStart(8, '0')}:${String(surfaceIndex).padStart(2, '0')}:${input.digest.value}`,
            factType: surface.family,
            subject: repository.value.reference,
            predicate: surface.predicate,
            object: identity.value.reference,
            scope: request.scope,
            evidence: [
              {
                id: `evidence:repository-surface:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: surface.sourceKind,
                relativeLocator: input.locator,
                digest: input.digest,
              },
            ],
            provenance: { id: manifest.id, version: manifest.version },
            derivation: 'declared',
            authority: 'declared',
            confidence: 1,
            freshness: { status: 'current' },
            truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
            observedAt: request.observedAt,
            inputDigest: input.digest,
            unknownZones: [],
          });
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'repository-surface-classification', version: manifest.version },
          outcome: 'processed',
          outputDigest: input.digest,
          diagnostics: [],
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:repository-surfaces:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics: [],
        coverage: [
          { dimension: 'repository-surfaces', observed: inputs.length, expected: inputs.length },
        ],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
