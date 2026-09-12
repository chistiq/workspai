import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  GRAPH_QUERY_CACHE_CONTRACT,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphQueryCacheEntry,
} from '../../src/contracts/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  collectGraphSemanticDependencies,
  contentStateLeavesFromProviderInputs,
  executeGraphReferenceCompositionTask,
  parseGitStatusPorcelain,
} from '../../src/application/index.js';
import type {
  GraphFileInventoryRequest,
  GraphProductHostPorts,
  GraphQueryCacheStorePort,
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
  collectCalls: string[],
  version = '1'
): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id,
    version,
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

async function semanticStampsFor(runtime: readonly GraphProviderRuntime[]) {
  return collectGraphSemanticDependencies({
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    compositionPolicy: GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
    redactionProfile: GRAPH_STANDARD_REPO_BUILD_POLICY.redactionProfile,
    providerManifests: runtime.map((provider) => provider.manifest),
    digest: ports({}).digest,
  });
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
      baseGraph: full.graph,
    });

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.providers.some((entry) => entry.collection === 'not-run')).toBe(true);
    expect(incremental.plan.providersToRecompute).toEqual([]);
    expect(incremental.processing.length).toBeGreaterThan(0);
    expect(collectCalls).toEqual([]);
    expect(incremental.plan.delta.graph).toEqual({
      addedNodes: [],
      removedNodes: [],
      changedNodes: [],
      changedEdges: [],
      addedAssertions: [],
      removedAssertions: [],
      changedAssertions: [],
    });
    expect(incremental.plan.delta.facts).toEqual({
      added: [],
      renewed: [],
      removed: [],
      invalidated: [],
    });

    const mismatched = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target-mismatch',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: { algorithm: 'sha256', value: 'f'.repeat(64) },
      baseGraph: full.graph,
    });
    expect(mismatched.equivalence).toBe('blocked');
    expect(mismatched.status).toBe('failed');
    expect(mismatched.quality.graph).toMatchObject({
      integrity: 'blocked',
      incrementalEquivalence: 'blocked',
    });
    expect(mismatched.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GRAPH_INCREMENTAL_EQUIVALENCE_MISMATCH' }),
      ])
    );
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
    expect(incremental.plan.delta.execution).toMatchObject({
      detected: 0,
      scanned: 0,
      parsed: 0,
      recomputed: 0,
      skippedByDigest: 1,
    });
    expect(incremental.plan.accounting.bytes).toEqual({ hashed: 0, reused: 20 });
    expect(incremental.equivalence).toBe('pass');
    expect(collectCalls.filter((id) => id === 'workspai.graph.provider.fixture-a').length).toBe(0);
  });

  it('matches full-rebuild digest across trusted Git, absent journal, untrusted journal and another checkout root', async () => {
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });
    const run = async (root: string, portOptions: { porcelain?: string } = {}) => {
      collectCalls.length = 0;
      return buildIncrementalRepoGraph({
        root,
        scope,
        ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
        providers,
        policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
        ports: ports(files, portOptions),
        baseManifest,
        baseGeneration: 'generation:base',
        targetGeneration: 'generation:target',
        baseSources: full.compositionSources ?? [],
        providersToRecompute: [],
        scanProfileDigest,
        referenceGenerationDigest: full.graph?.generation.reference.contentDigest,
      });
    };

    const trusted = await run('/fixture', { porcelain: '' });
    const absent = await run('/fixture');
    const untrusted = await run('/fixture', { porcelain: 'not porcelain' });
    const otherCheckout = await run('/checkout-b', { porcelain: '' });
    const digest = full.graph?.generation.reference.contentDigest;

    expect(trusted.inventoryReread.trust).toBe('trusted');
    expect(absent.inventoryReread.trust).toBe('absent');
    expect(untrusted.inventoryReread.trust).toBe('untrusted');
    expect(trusted.plan.delta.execution.scanned).toBe(0);
    expect(absent.plan.delta.execution.scanned).toBe(1);
    expect(untrusted.plan.delta.execution.scanned).toBe(1);
    expect(trusted.graph?.generation.reference.contentDigest).toEqual(digest);
    expect(absent.graph?.generation.reference.contentDigest).toEqual(digest);
    expect(untrusted.graph?.generation.reference.contentDigest).toEqual(digest);
    expect(otherCheckout.graph?.generation.reference.contentDigest).toEqual(digest);
    expect(trusted.equivalence).toBe('pass');
    expect(absent.equivalence).toBe('pass');
    expect(untrusted.equivalence).toBe('pass');
    expect(otherCheckout.equivalence).toBe('pass');
    expect(trusted.targetManifest.merkleRoot).toEqual(absent.targetManifest.merkleRoot);
    expect(trusted.targetManifest.merkleRoot).toEqual(untrusted.targetManifest.merkleRoot);
    expect(trusted.targetManifest.merkleRoot).toEqual(otherCheckout.targetManifest.merkleRoot);
    expect(
      otherCheckout.targetManifest.nodes
        .filter((node) => node.kind === 'file')
        .map((node) => node.locator)
    ).toEqual(['src/index.ts']);
    expect(JSON.stringify(otherCheckout.graph)).not.toContain('/checkout-b');
    expect(JSON.stringify(otherCheckout.targetManifest)).not.toContain('/checkout-b');
    expect(trusted.plan.changeSet.causes).toEqual([]);
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
    expect(incremental.plan.delta.execution).toMatchObject({
      detected: 1,
      scanned: 1,
      skippedByDigest: 1,
    });
    expect(incremental.plan.delta.execution.parsed).toBeGreaterThan(0);
    expect(incremental.plan.accounting.leaves.edited).toBe(1);
    expect(incremental.plan.accounting.bytes.hashed).toBeGreaterThan(0);
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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

  it('records a journal rename as a rename-candidate after portable digest comparison', async () => {
    const content = 'export const ok = 1;';
    const files: Record<string, string> = { 'src/old.ts': content };
    const collectCalls: string[] = [];
    const providers = [
      fixtureProvider('workspai.graph.provider.fixture-a', 'src/old.ts', collectCalls),
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
        [inputFor('src/old.ts', content)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });

    delete files['src/old.ts'];
    files['src/new.ts'] = content;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: 'R  src/old.ts -> src/new.ts\n' }),
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

    expect(incremental.inventoryReread.deletedLocators).toEqual(['src/old.ts']);
    expect(incremental.inventoryReread.rereadLocators).toEqual(['src/new.ts']);
    expect(incremental.plan.changeSet.inputs).toEqual([
      expect.objectContaining({
        kind: 'rename-candidate',
        locator: 'src/new.ts',
        renameCandidate: {
          priorLocator: 'src/old.ts',
          nextLocator: 'src/new.ts',
          confidence: 1,
        },
      }),
    ]);
    expect(incremental.plan.accounting.leaves.renameCandidates).toBe(1);
    expect(incremental.plan.delta.execution.scanned).toBe(1);
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
    expect(incremental.plan.delta.execution.scanned).toBe(1);
    expect(incremental.plan.delta.execution.skippedByDigest).toBe(0);
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(first)
      ),
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

  it('surfaces scan-profile drift as renewed and recomputes instead of reusing shards', async () => {
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });
    collectCalls.length = 0;
    const nextScan = { algorithm: 'sha256' as const, value: 'b'.repeat(64) };
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest: nextScan,
    });
    expect(incremental.plan.changeSet.inputs).toEqual([
      expect.objectContaining({ kind: 'renewed', locator: 'src/index.ts' }),
    ]);
    expect(incremental.plan.accounting.leaves.renewed).toBe(1);
    expect(incremental.plan.shardReuse.reused).toEqual([]);
    expect(collectCalls).toEqual(['workspai.graph.provider.fixture-a']);
  });

  it('applies query-cache invalidation without failing the incremental build', async () => {
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
    if (!full.graph) {
      throw new Error('expected a composed graph');
    }
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T12:00:00.000Z',
      scanProfileDigest,
      leaves: contentStateLeavesFromProviderInputs(
        [inputFor('src/index.ts', files['src/index.ts']!)],
        scanProfileDigest
      ),
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });
    const digest = (value: string) =>
      Object.freeze({ algorithm: 'sha256' as const, value: value.padEnd(64, '0') });
    const cacheKey = {
      contract: GRAPH_QUERY_CACHE_CONTRACT,
      graphGeneration: {
        id: 'generation:older',
        generatedAt: '2026-09-08T20:00:00.000Z',
        contentDigest: digest('old'),
      },
      queryDigest: digest('query'),
      ontologyDigest: full.graph.generation.ontologySetDigest,
      proofPolicyDigest: full.graph.generation.proofPolicySetDigest,
      profileDigest: digest('profile'),
      plannerProfileDigest: digest('planner'),
      resultProfileDigest: digest('result'),
      projectionDigests: [],
      indexDigests: [],
      requiredExtensions: [],
      scope,
      redactionPolicyDigest: digest('redact'),
      authorizationDigest: digest('auth'),
      budget: { maxDepth: 4, maxNodes: 100, maxEdges: 200, maxEvidence: 50 },
    };
    const keep: GraphQueryCacheEntry = {
      contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
      keyDigest: digest('keep'),
      key: cacheKey,
      result: null,
      resultDigest: digest('result-body'),
      freshness: { status: 'current' },
    };
    const drop: GraphQueryCacheEntry = {
      ...keep,
      keyDigest: digest('drop'),
      key: { ...cacheKey, authorizationDigest: digest('old-auth') },
    };
    const entries = new Map<string, GraphQueryCacheEntry>();
    const store: GraphQueryCacheStorePort = {
      async get(keyDigest) {
        return entries.get(`${keyDigest.algorithm}:${keyDigest.value}`);
      },
      async publish(entry) {
        entries.set(`${entry.keyDigest.algorithm}:${entry.keyDigest.value}`, entry);
      },
      async invalidate(keyDigests) {
        for (const keyDigest of keyDigests) {
          entries.delete(`${keyDigest.algorithm}:${keyDigest.value}`);
        }
      },
    };
    await store.publish(keep);
    await store.publish(drop);
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      queryCache: {
        store,
        entries: [keep, drop],
        policy: { authorizationDigest: digest('auth') },
      },
    });
    expect(incremental.status).toBe('complete');
    expect(entries.has(`${keep.keyDigest.algorithm}:${keep.keyDigest.value}`)).toBe(true);
    expect(entries.has(`${drop.keyDigest.algorithm}:${drop.keyDigest.value}`)).toBe(false);
    expect(
      incremental.queryCacheInvalidations?.some((item) => item.reason === 'authorization')
    ).toBe(true);

    const failingStore: GraphQueryCacheStorePort = {
      async get() {
        return undefined;
      },
      async publish() {
        return undefined;
      },
      async invalidate() {
        throw new Error('store down');
      },
    };
    const failedInvalidation = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      queryCache: {
        store: failingStore,
        entries: [drop],
        policy: { authorizationDigest: digest('auth') },
      },
    });
    expect(failedInvalidation.status).toBe('complete');
    expect(
      failedInvalidation.diagnostics.some(
        (entry) => entry.code === 'GRAPH_QUERY_CACHE_INVALIDATION_FAILED'
      )
    ).toBe(true);
  });

  it('recomputes when ontology identity changes with unchanged content', async () => {
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });
    const driftedOntology = Object.freeze({
      ...CORE_GRAPH_ONTOLOGY_PROFILE,
      version: '0.1.0-candidate+drift',
    });
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: driftedOntology,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: driftedOntology,
      providers,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: rebuilt.graph?.generation.reference.contentDigest,
    });

    expect(incremental.plan.changeSet.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ontology', source: 'shard-reuse-planning' }),
      ])
    );
    expect(incremental.plan.providersToRecompute).toEqual(['workspai.graph.provider.fixture-a']);
    expect(collectCalls).toEqual(['workspai.graph.provider.fixture-a']);
    expect(incremental.equivalence).toBe('pass');
  });

  it('recomputes when a provider manifest version changes with unchanged content', async () => {
    const files = { 'src/index.ts': 'export const ok = 1;' };
    const collectCalls: string[] = [];
    const id = 'workspai.graph.provider.fixture-a';
    const baseProviders = [fixtureProvider(id, 'src/index.ts', collectCalls, '1')];
    const nextProviders = [fixtureProvider(id, 'src/index.ts', collectCalls, '2')];
    const full = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: baseProviders,
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(baseProviders)
      ),
    });
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: nextProviders,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files),
    });
    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: nextProviders,
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: rebuilt.graph?.generation.reference.contentDigest,
    });

    expect(incremental.plan.changeSet.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'provider', source: 'shard-reuse-planning' }),
      ])
    );
    expect(incremental.plan.providersToRecompute).toEqual([id]);
    expect(collectCalls).toEqual([id]);
    expect(incremental.equivalence).toBe('pass');
  });

  it('recomputes when composition policy identity changes with unchanged content', async () => {
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
      shardDependencies: buildShardDependenciesFromSources(
        full.compositionSources ?? [],
        await semanticStampsFor(providers)
      ),
    });
    const driftedPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      composition: {
        ...GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
        version: '0.1.0-candidate+drift',
      },
    };
    const rebuilt = await buildRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: driftedPolicy,
      ports: ports(files),
    });
    collectCalls.length = 0;
    const incremental = await buildIncrementalRepoGraph({
      root: '/fixture',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers,
      policy: driftedPolicy,
      ports: ports(files, { porcelain: '' }),
      baseManifest,
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseSources: full.compositionSources ?? [],
      providersToRecompute: [],
      scanProfileDigest,
      referenceGenerationDigest: rebuilt.graph?.generation.reference.contentDigest,
    });

    expect(incremental.plan.changeSet.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'schema',
          source: 'shard-reuse-planning',
          detail: 'composition-policy',
        }),
      ])
    );
    expect(incremental.plan.providersToRecompute).toEqual(['workspai.graph.provider.fixture-a']);
    expect(collectCalls).toEqual(['workspai.graph.provider.fixture-a']);
    expect(incremental.equivalence).toBe('pass');
  });
});
