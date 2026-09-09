import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
} from '../../src/contracts/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  contentStateLeavesFromProviderInputs,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import type { GraphProductHostPorts, GraphWorkerTaskRequest } from '../../src/ports/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scanProfileDigest = digest;
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };
const input: GraphProviderInput = {
  locator: 'src/index.ts',
  mediaType: 'text/typescript',
  byteLength: 21,
  digest,
};

function ports(
  contents: Readonly<Record<string, string>> = { [input.locator]: 'export const ok = 1;' }
): GraphProductHostPorts {
  return {
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (value) => createHash('sha256').update(value).digest('hex'),
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<{
        status: 'complete';
        output: TOutput;
        diagnostics: [];
        metrics: { durationMs: number; inputBytes: number; outputBytes: number };
      }> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
        };
      },
    },
    fileSource: {
      inventory: async () => ({
        status: 'complete',
        inputs: [input],
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
      }),
      read: async (_root, requested) =>
        new TextEncoder().encode(contents[requested.locator] ?? 'export const ok = 1;'),
    },
  };
}

function fixtureProvider(id: string): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id,
    version: '1',
    displayName: id,
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
    limits: { maxDurationMs: 1_000, maxFacts: 100, maxInputBytes: 1_024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['repository-files'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };
  const factBatch: GraphFactBatch = {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: manifest.id, version: manifest.version },
    batchId: `batch:${id}`,
    scope,
    inputs: [{ locator: input.locator, digest: input.digest }],
    facts: [],
    diagnostics: [],
    coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
    unknownZones: [],
    unsupportedZones: [],
    redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
    status: 'complete',
    processing: [
      {
        input: { locator: input.locator, digest: input.digest },
        provider: { id: manifest.id, version: manifest.version },
        stage: { id: `${id}:stage`, version: manifest.version },
        outcome: 'processed',
        outputDigest: input.digest,
        diagnostics: [],
      },
    ],
  };
  return {
    manifest,
    detect: () => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: 'applicable',
      matchedInputs: ['repository-files'],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async () => factBatch,
  };
}

describe('buildIncrementalRepoGraph', () => {
  it('reuses prior provider output and assesses equivalence against a full build', async () => {
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a'),
      fixtureProvider('workspai.graph.provider.fixture-b'),
    ];
    const hostPorts = ports();
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: hostPorts,
    });
    expect(full.compositionSources?.length).toBe(2);

    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs([input], scanProfileDigest),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: hostPorts,
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: full.graph?.generation.reference.contentDigest,
    });

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.providers.some((entry) => entry.collection === 'not-run')).toBe(true);
    expect(incremental.plan.providersToRecompute).toEqual([]);
    expect(incremental.processing.length).toBeGreaterThan(0);
  });

  it('fails closed when incremental provider coverage is incomplete', async () => {
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a'),
      fixtureProvider('workspai.graph.provider.fixture-b'),
    ];
    const failed = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
      compositionReuse: {
        reusedSources: [],
        providersToRecompute: ['workspai.graph.provider.fixture-a'],
      },
    });
    expect(failed.status).toBe('failed');
    expect(
      failed.diagnostics.some((entry) => entry.code === 'GRAPH_REPO_INCREMENTAL_PROVIDER_UNCOVERED')
    ).toBe(true);
  });
});
