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
  parseGitStatusPorcelain,
} from '../../src/application/index.js';
import type {
  GraphFileInventoryRequest,
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
} from '../../src/ports/index.js';

const scanProfileDigest = {
  algorithm: 'sha256' as const,
  value: 'a'.repeat(64),
};
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };

function inputFor(locator: string, content: string): GraphProviderInput {
  const bytes = new TextEncoder().encode(content);
  return {
    locator,
    mediaType: locator.endsWith('.ts') ? 'text/typescript' : 'application/octet-stream',
    byteLength: bytes.byteLength,
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function ports(
  files: Record<string, string>,
  options: { porcelain?: string; inventoryCalls?: Array<readonly string[] | undefined> } = {}
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
      inventory: async (request: GraphFileInventoryRequest) => {
        options.inventoryCalls?.push(request.onlyLocators);
        const all = Object.entries(files).map(([locator, content]) => inputFor(locator, content));
        const inputs =
          request.onlyLocators === undefined
            ? all
            : all.filter((entry) => request.onlyLocators?.includes(entry.locator));
        return {
          status: 'complete',
          inputs,
          diagnostics: [],
          omittedFiles: 0,
          omittedBytes: 0,
          unknownZones: [],
          unsupportedZones: [],
        };
      },
      read: async (_root, requested) => new TextEncoder().encode(files[requested.locator] ?? ''),
    },
    ...(options.porcelain !== undefined
      ? {
          changeJournal: {
            inspect: async () => parseGitStatusPorcelain(options.porcelain ?? ''),
          },
        }
      : {}),
  };
}

function fixtureProvider(
  id: string,
  locator: string,
  collectCalls: string[]
): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id,
    version: '1',
    displayName: id,
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file'],
      relationKinds: ['contains'],
      factFamilies: ['source.file'],
      allowedClaims: ['observed'],
      relationSemantics: ['structural'] as const,
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
  const input = inputFor(locator, 'placeholder');
  const factBatch = (digest: GraphProviderInput['digest']): GraphFactBatch => ({
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: manifest.id, version: manifest.version },
    batchId: `batch:${id}`,
    scope,
    inputs: [{ locator, digest }],
    facts: [],
    diagnostics: [],
    coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
    unknownZones: [],
    unsupportedZones: [],
    redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
    status: 'complete',
    processing: [
      {
        input: { locator, digest },
        provider: { id: manifest.id, version: manifest.version },
        stage: { id: `${id}:stage`, version: manifest.version },
        outcome: 'processed',
        outputDigest: digest,
        diagnostics: [],
      },
    ],
  });
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
    collect: async (request) => {
      collectCalls.push(id);
      const admitted = request.inputs.find((entry) => entry.locator === locator) ?? input;
      return factBatch(admitted.digest);
    },
  };
}

describe('buildIncrementalRepoGraph', () => {
  it('reuses prior provider output and assesses equivalence against a full build', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
      fixtureProvider('workspai.graph.provider.fixture-b', 'src/index.ts', collectCalls),
    ];
    const hostPorts = ports(files);
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
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    collectCalls.length = 0;
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
    expect(collectCalls).toEqual([]);
  });

  it('skips content hashing of unchanged files when a trusted Git journal is empty', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const inventoryCalls: Array<readonly string[] | undefined> = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '', inventoryCalls }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: full.graph?.generation.reference.contentDigest,
    });

    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.reusedLocators).toEqual(['src/index.ts']);
    expect(inventoryCalls).toEqual([[]]);
    expect(incremental.equivalence).toBe('pass');
    expect(collectCalls.filter((id) => id === 'workspai.graph.provider.fixture-a').length).toBe(0);
  });

  it('recomputes only providers bound to edited files and matches a clean full rebuild', async () => {
    const files: Record<string, string> = {
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': 'export const b = 1;',
    };
    const collectCalls: string[] = [];
    const inventoryCalls: Array<readonly string[] | undefined> = [];
    const providerA = 'workspai.graph.provider.fixture-a';
    const providerB = 'workspai.graph.provider.fixture-b';
    const providers = [
      fixtureProvider(providerA, 'src/a.ts', collectCalls),
      fixtureProvider(providerB, 'src/b.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/a.ts', files['src/a.ts']!), inputFor('src/b.ts', files['src/b.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    files['src/a.ts'] = 'export const a = 2;';
    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: ' M src/a.ts\n', inventoryCalls }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    const incrementalCollects = [...collectCalls];

    collectCalls.length = 0;
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });

    expect(inventoryCalls).toEqual([['src/a.ts']]);
    expect(incrementalCollects).toEqual([providerA]);
    expect(incremental.plan.providersToRecompute).toEqual([providerA]);
    expect(incremental.providers.find((entry) => entry.provider.id === providerB)?.collection).toBe(
      'not-run'
    );
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.graph?.generation.reference.contentDigest
    );
    expect(
      (
        await buildIncrementalRepoGraph({
          root: '/fixture',
          scope,
          ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
          providers,
          policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
          ports: ports(files, { porcelain: ' M src/a.ts\n' }),
          baseManifest,
          baseGeneration: 'generation:base',
          targetGeneration: 'generation:target',
          baseSources: full.compositionSources ?? [],
          providersToRecompute: [],
          scanProfileDigest,
          referenceGenerationDigest: rebuilt.graph?.generation.reference.contentDigest,
        })
      ).equivalence
    ).toBe('pass');
  });

  it('matches a clean full rebuild after an added file', async () => {
    const files: Record<string, string> = { 'src/a.ts': 'export const a = 1;' };
    const collectCalls: string[] = [];
    const providerA = 'workspai.graph.provider.fixture-a';
    const providers = [fixtureProvider(providerA, 'src/a.ts', collectCalls)];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/a.ts', files['src/a.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    files['src/b.ts'] = 'export const b = 1;';
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '?? src/b.ts\n' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    expect(incremental.targetManifest.nodes.some((node) => node.locator === 'src/b.ts')).toBe(true);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.graph?.generation.reference.contentDigest
    );
  });

  it('matches a clean full rebuild after a deleted file', async () => {
    const files: Record<string, string> = {
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': 'export const b = 1;',
    };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/a.ts', collectCalls),
      fixtureProvider('workspai.graph.provider.fixture-b', 'src/b.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/a.ts', files['src/a.ts']!), inputFor('src/b.ts', files['src/b.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });

    delete files['src/b.ts'];
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: ' D src/b.ts\n' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    expect(
      incremental.targetManifest.nodes.some(
        (node) => node.kind === 'file' && node.locator === 'src/b.ts'
      )
    ).toBe(false);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.graph?.generation.reference.contentDigest
    );
  });

  it('fails closed when incremental provider coverage is incomplete', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
      fixtureProvider('workspai.graph.provider.fixture-b', 'src/index.ts', collectCalls),
    ];
    const failed = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
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

  it('treats a throwing change journal as untrusted', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });
    const host = ports(files);
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: {
        ...host,
        changeJournal: {
          inspect: async () => {
            throw new Error('journal unavailable');
          },
        },
      },
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.status).toBe('complete');
  });

  it('fails closed when incremental inventory throws', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });
    const host = ports(files);
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: {
        ...host,
        fileSource: {
          inventory: async () => {
            throw new Error('inventory exploded');
          },
          read: host.fileSource.read,
        },
      },
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    expect(incremental.status).toBe('failed');
  });

  it('cancels incremental inventory after host cancellation', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/index.ts', collectCalls),
    ];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });
    const host = ports(files);
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: {
        ...host,
        cancellation: { aborted: true, throwIfAborted: () => undefined },
        fileSource: {
          inventory: async () => {
            throw new Error('inventory exploded');
          },
          read: host.fileSource.read,
        },
      },
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    expect(incremental.status).toBe('cancelled');
  });

  it('recomputes providers that have no reusable prior source', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const providerA = 'workspai.graph.provider.fixture-a';
    const providerB = 'workspai.graph.provider.fixture-b';
    const first = [fixtureProvider(providerA, 'src/index.ts', collectCalls)];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: first,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(full.compositionSources ?? []),
    });
    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: [first[0]!, fixtureProvider(providerB, 'src/index.ts', collectCalls)],
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
    });
    expect(incremental.plan.providersToRecompute).toEqual([providerB]);
    expect(collectCalls).toEqual([providerB]);
  });
});
