import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphFactBatch,
  type GraphOntologyProfile,
  type GraphProviderInput,
  type GraphProviderRuntime,
} from '../../src/contracts/index.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
  writeGraphGeneration,
} from '../../src/application/index.js';
import type {
  GraphProjectPublicationRequest,
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import {
  disposeResidentSessions,
  residentBuildObservations,
} from '../../src/application/native-partition-session.js';
import {
  createPackageJsonProvider,
  createRepositoryFilesProvider,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };
const input: GraphProviderInput = {
  locator: 'src/index.ts',
  mediaType: 'text/typescript',
  byteLength: 21,
  digest,
};
const ontology: GraphOntologyProfile = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.repo-build-test',
  version: '1',
  entities: [
    { kind: 'repository', family: 'system' },
    { kind: 'file', family: 'source' },
  ],
  relations: [
    {
      kind: 'contains',
      semantics: 'structural',
      subjectFamilies: ['system'],
      objectFamilies: ['source'],
      symmetric: false,
      transitive: false,
      allowedAuthorities: ['observed'],
      proofPolicy: { id: 'workspai.graph.proof.standard', version: '1' },
    },
  ],
};

function ports(
  inputs: readonly GraphProviderInput[] = [input],
  contents: Readonly<Record<string, string>> = { [input.locator]: 'export const ok = 1;' }
): GraphProductHostPorts {
  return {
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (value) => createHash('sha256').update(value).digest('hex'),
      digestSync: (value) => createHash('sha256').update(value).digest('hex'),
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
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
        inputs,
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

function provider(
  options: { network?: 'deny' | 'allow'; collect?: GraphProviderRuntime['collect'] } = {}
): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: 'workspai.graph.provider.fixture-files',
    version: '1',
    displayName: 'Fixture files',
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
      network: options.network ?? ('deny' as const),
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 1_000, maxFacts: 100, maxInputBytes: 1_024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['repository-files'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
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
    collect:
      options.collect ??
      (() => {
        const factBatch: GraphFactBatch = {
          contract: GRAPH_FACT_BATCH_CONTRACT,
          provider: { id: manifest.id, version: manifest.version },
          batchId: 'batch:fixture-files',
          scope,
          inputs: [{ locator: input.locator, digest: input.digest }],
          facts: [
            {
              factId: 'fact:fixture-file',
              factType: 'source.file',
              subject: {
                id: 'entity:fixture:repository:root',
                identityScheme: GRAPH_IDENTITY_SCHEME,
                kind: 'repository',
                scope,
              },
              predicate: 'contains',
              object: {
                id: 'entity:fixture:file:src-index-ts',
                identityScheme: GRAPH_IDENTITY_SCHEME,
                kind: 'file',
                scope,
              },
              scope,
              evidence: [
                {
                  id: 'evidence:fixture-file',
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
              observedAt: '2026-09-09T12:00:00.000Z',
              inputDigest: input.digest,
              unknownZones: [],
            },
          ],
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
              stage: { id: 'extract', version: '1' },
              outcome: 'processed',
              outputDigest: digest,
              diagnostics: [],
            },
          ],
        };
        return factBatch;
      }),
  };
}

function request(providers: readonly GraphProviderRuntime[], hostPorts = ports()) {
  return {
    root: '/repository',
    scope,
    ontology,
    providers,
    ports: hostPorts,
    policy: {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      composition: {
        ...GRAPH_STANDARD_COMPOSITION_POLICY,
        minimumConfidence: 0.5,
      },
    },
  };
}

describe('buildRepoGraph', () => {
  it('extracts evidence-backed literal routes across supported framework surfaces', async () => {
    const contents = {
      'src/server.ts':
        "import express from 'express';\nconst router = express.Router();\n// router.get('/commented-out', handler);\nrouter.get('/node-health', handler);\nrouter.get(dynamicRoute, handler);\n",
      'api.py':
        "from flask import Flask\napp = Flask(__name__)\n@app.post('/python-orders')\ndef orders(): pass\n",
      'main.go':
        'package main\nimport "net/http"\nfunc routes() { http.HandleFunc("/go-items/:id", handler) }\n',
      'Api.java': '@PutMapping("/java-users/{id}")\nvoid update() {}\n',
      'Program.cs': 'app.MapPatch("/dotnet-jobs/{id}", Handler);\n',
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports(inputs, contents)),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result.status).toBe('partial');
    expect(result.graph.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(5);
    expect(result.graph.edges.filter((edge) => edge.relation === 'exposes')).toHaveLength(5);
    expect(result.providers).toContainEqual(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: 'workspai.graph.provider.repository-routes',
        }),
        detection: 'applicable',
        collection: 'partial',
        factCount: 5,
      })
    );
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.dynamic-route-unsupported',
        scope: 'src/server.ts',
      })
    );
  });

  it('preserves real provider observation time across an unchanged rebuild', async () => {
    const journal = mkdtempSync(join(tmpdir(), 'workspai-journal-'));
    const snapshot = mkdtempSync(join(tmpdir(), 'workspai-snapshot-'));
    const previousJournal = process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    const previousSnapshot = process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = journal;
    process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = snapshot;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    let millis = Date.parse('2026-09-22T00:00:00.000Z');
    const contents: Record<string, string> = {
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
    };
    const inputFor = (locator: string): GraphProviderInput => {
      const content = contents[locator] ?? '';
      const bytes = new TextEncoder().encode(content);
      return {
        locator,
        mediaType: 'text/typescript',
        byteLength: bytes.byteLength,
        digest: { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') },
      };
    };
    const base = ports([], contents);
    const host: GraphProductHostPorts = {
      ...base,
      clock: { now: () => new Date(millis) },
      fileSource: {
        inventory: async () => {
          const inputs = [inputFor('src/a.ts'), inputFor('src/b.ts')];
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
        read: (root, requested, options) => base.fileSource.read(root, requested, options),
      },
    };
    const build = () =>
      buildRepoGraph({
        ...request(createStandardRepositoryProviders(), host),
        ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      });
    try {
      const first = await build();
      const opened = residentBuildObservations().at(-1);
      expect(first.nativeSnapshot).toBeDefined();
      expect(opened?.encodedPartitions).toBeGreaterThan(0);
      const snapshotId = first.nativeSnapshot?.snapshotId;
      millis += 60_000;
      const second = await build();
      const warmed = residentBuildObservations().at(-1);
      expect(second.nativeSnapshot?.snapshotId).toBe(snapshotId);
      expect(warmed?.encodedPartitions).toBe(0);
      expect(warmed?.boundaryBytes).toBe(0);
      expect(warmed?.recomputed).toBe(false);
      expect(warmed?.snapshotIno).toBe(opened?.snapshotIno);
      contents['src/b.ts'] = 'export const b = 3;\n';
      const third = await build();
      const edited = residentBuildObservations().at(-1);
      expect(third.nativeSnapshot).toBeDefined();
      expect(edited?.encodedPartitionIds.some((id) => id.endsWith(':src/b.ts'))).toBe(true);
      expect(edited?.encodedPartitionIds.some((id) => id.endsWith(':src/a.ts'))).toBe(false);
      expect(
        edited?.encodedPartitionIds.every(
          (id) => id.endsWith(':src/b.ts') || id.endsWith(':synthetic:receipt')
        )
      ).toBe(true);
    } finally {
      await disposeResidentSessions();
      if (previousJournal === undefined) delete process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
      else process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = previousJournal;
      if (previousSnapshot === undefined) delete process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
      else process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = previousSnapshot;
      if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
      rmSync(journal, { recursive: true, force: true });
      rmSync(snapshot, { recursive: true, force: true });
    }
  });

  it('does not treat ordinary Map.get or headers.get as unsupported routes', async () => {
    const source =
      'const headers = new Headers();\nheaders.get("content-type");\nconst values = new Map<string, string>();\nvalues.get("id");\n';
    const sourceInput: GraphProviderInput = {
      locator: 'src/util.ts',
      mediaType: 'text/typescript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/util.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.graph?.nodes.some((node) => node.kind === 'endpoint')).toBe(false);
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.dynamic-route-unsupported' })
    );
  });

  it('admits an ASP.NET root route as a non-empty endpoint identity', async () => {
    const source = 'app.MapGet("/", () => Results.Ok());\napp.MapHealthChecks("/health/live");\n';
    const sourceInput: GraphProviderInput = {
      locator: 'Program.cs',
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'Program.cs': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    const endpoints = result.graph?.nodes.filter((node) => node.kind === 'endpoint') ?? [];
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.literal-route-identity-unsupported' })
    );
  });

  it('marks computed routes unknown instead of inventing an endpoint', async () => {
    const source =
      "import express from 'express';\nconst router = express.Router();\nrouter.get(routeFromConfiguration, handler);\n";
    const sourceInput: GraphProviderInput = {
      locator: 'src/server.ts',
      mediaType: 'text/typescript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/server.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.status).toBe('partial');
    expect(result.graph?.nodes.some((node) => node.kind === 'endpoint')).toBe(false);
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.dynamic-route-unsupported' })
    );
  });

  it('binds aliased Express routers and does not omit their dynamic paths', async () => {
    const source =
      "import express from 'express';\nconst api = express.Router();\napi.get('/items', handler);\napi.get(routeFromConfig, handler);\n";
    const sourceInput: GraphProviderInput = {
      locator: 'src/api.ts',
      mediaType: 'text/typescript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/api.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.graph?.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.dynamic-route-unsupported',
        scope: 'src/api.ts',
      })
    );
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.route-receiver-unproven' })
    );
  });

  it('binds require() and named Router construction as proven receivers', async () => {
    const source =
      "import * as express from 'express';\nconst { Router } = require('express');\nconst app = express();\nconst api = Router();\napp.get('/star-health', handler);\napi.post('/named-items', handler);\n";
    const sourceInput: GraphProviderInput = {
      locator: 'src/require.ts',
      mediaType: 'text/javascript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/require.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    expect(
      result.graph?.nodes.filter((node) => node.kind === 'endpoint').length
    ).toBeGreaterThanOrEqual(2);
  });

  it('binds require()() factory invocation as a proven Express or Fastify receiver', async () => {
    const source =
      "const app = require('express')();\nconst server = require('fastify')({ logger: true });\napp.get('/health', handler);\nserver.get('/ready', handler);\n";
    const sourceInput: GraphProviderInput = {
      locator: 'src/cjs-app.ts',
      mediaType: 'text/javascript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/cjs-app.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    expect(
      result.graph?.nodes.filter((node) => node.kind === 'endpoint').length
    ).toBeGreaterThanOrEqual(2);
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.route-receiver-unproven' })
    );
  });

  it('binds chained factory and constructor HTTP calls from import evidence', async () => {
    const contents = {
      'src/express-chain.ts':
        "import express from 'express';\nexpress().get('/express-chain', handler);\nexpress.Router().post('/express-router', handler);\nconst app = express();\napp.get('/fluent-get', handler).post('/fluent-post', handler);\n",
      'src/hono-chain.ts':
        "import { Hono } from 'hono';\nnew Hono().get('/hono-chain', handler);\n",
      'src/cjs-chain.ts': "require('express')().get('/cjs-chain', handler);\n",
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports(inputs, contents)),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    expect(
      result.graph?.nodes.filter((node) => node.kind === 'endpoint').length
    ).toBeGreaterThanOrEqual(6);
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.route-receiver-unproven' })
    );
  });

  it('does not invent Python or Go routes from unproven receiver names', async () => {
    const contents = {
      'api.py': "@app.get('/python-unproven')\ndef orders(): pass\n",
      'main.go': 'package main\nfunc routes() { router.GET("/go-unproven", handler) }\n',
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports(inputs, contents)),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    expect(result.graph?.nodes.some((node) => node.kind === 'endpoint')).toBe(false);
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.route-receiver-unproven', scope: 'api.py' })
    );
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.route-receiver-unproven', scope: 'main.go' })
    );
  });

  it('does not mark uncertain route-shaped calls complete and does not invent endpoints', async () => {
    const source = 'const api = createSurface();\napi.get(routeFromConfig, handler);\n';
    const sourceInput: GraphProviderInput = {
      locator: 'src/surface.ts',
      mediaType: 'text/typescript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(
        createStandardRepositoryProviders(),
        ports([sourceInput], { 'src/surface.ts': source })
      ),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.graph?.nodes.some((node) => node.kind === 'endpoint')).toBe(false);
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.route-receiver-unproven',
        scope: 'src/surface.ts',
      })
    );
  });

  it('keeps file topology but refuses complete structural coverage for an unsupported language', async () => {
    const source = "import 'package:billing/core.dart';\n";
    const sourceInput: GraphProviderInput = {
      locator: 'app.dart',
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports([sourceInput], { 'app.dart': source })),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.status).toBe('partial');
    expect(result.graph?.nodes).toContainEqual(expect.objectContaining({ kind: 'file' }));
    expect(result.quality.unsupportedZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.source-language-unsupported',
        scope: 'app.dart',
      })
    );
  });

  it('models a local Git branch from bounded HEAD evidence without invoking Git', async () => {
    const head = 'ref: refs/heads/feature/graph-preview\n';
    const headInput: GraphProviderInput = {
      locator: '.git/HEAD',
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(head).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(head).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports([headInput], { '.git/HEAD': head })),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result.status).toBe('complete');
    expect(result.metrics.compositionTimings).toEqual(
      expect.objectContaining({
        admitMs: expect.any(Number),
        workerMs: expect.any(Number),
        semanticDigestMs: expect.any(Number),
        edgeProofMs: expect.any(Number),
        contentDigestMs: expect.any(Number),
      })
    );
    expect(result.metrics.providerTimings?.length).toBeGreaterThan(0);
    expect(result.metrics.phaseTimings?.some((timing) => timing.phase === 'inventory')).toBe(true);
    expect(result.metrics.phaseTimings?.some((timing) => timing.phase === 'composition')).toBe(
      true
    );
    expect(result.metrics.cacheHits).toBeGreaterThanOrEqual(0);
    expect(result.metrics.cacheMisses).toBeGreaterThanOrEqual(0);
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ kind: 'branch' }));
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ relation: 'contains', state: 'accepted' })
    );
    expect(result.providers).toContainEqual(
      expect.objectContaining({
        provider: { id: 'workspai.graph.provider.git-head', version: '0.1.0-candidate' },
        detection: 'applicable',
        collection: 'complete',
        factCount: 1,
      })
    );
  });

  it('reports malformed Git HEAD as unknown instead of inventing repository history', async () => {
    const head = 'ref: refs/heads/../outside\n';
    const headInput: GraphProviderInput = {
      locator: '.git/HEAD',
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(head).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(head).digest('hex'),
      },
    };
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), ports([headInput], { '.git/HEAD': head })),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });

    expect(result.status).toBe('partial');
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.git-head-format-unsupported' })
    );
    expect(result.graph?.nodes.some((node) => node.kind === 'branch')).toBe(false);
  });

  it('extracts bounded declared imports across Python, Go, Java, .NET and Rust', async () => {
    const contents = {
      'app.py': "import os\nfrom package.feature import run\noptional = __import__('dynamic')\n",
      'main.go': 'package main\nimport (\n  "context"\n  alias "example.com/team/lib"\n)\n',
      'App.java': 'import java.util.List;\nclass App {}\n',
      'Program.cs': 'using System.Text.Json;\nclass Program {}\n',
      'main.rs': 'use std::collections::HashMap;\nfn main() {}\n',
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const buildRequest = request(createStandardRepositoryProviders(), ports(inputs, contents));
    const result = await buildRepoGraph({
      ...buildRequest,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result.status).toBe('partial');
    expect(result.graph.edges.filter((edge) => edge.relation === 'imports')).toHaveLength(7);
    expect(result.providers).toContainEqual(
      expect.objectContaining({ detection: 'applicable', collection: 'partial', factCount: 7 })
    );
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.language-dynamic-import-unsupported' })
    );
  });

  it('discovers API, runtime, CI and test surfaces without executing repository code', async () => {
    const contents = {
      'contracts/openapi.yaml': 'openapi: 3.1.0\n',
      Dockerfile: 'FROM scratch\n',
      '.github/workflows/ci.yml': 'name: CI\n',
      'tests/health.fixture': 'must never execute\n',
      'src/test_health.fixture': 'must never execute\n',
      [`src/health${'.spec'.repeat(20)}.fixture`]: 'must never execute\n',
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: 'text/plain',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const hostPorts = ports(inputs, contents);
    const read = vi.spyOn(hostPorts.fileSource, 'read');
    const result = await buildRepoGraph({
      ...request(createStandardRepositoryProviders(), hostPorts),
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result.status).toBe('complete');
    expect(result.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'contract' }),
        expect.objectContaining({ kind: 'container' }),
        expect.objectContaining({ kind: 'workflow' }),
        expect.objectContaining({ kind: 'test' }),
      ])
    );
    expect(result.providers).toContainEqual(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: 'workspai.graph.provider.repository-surfaces',
        }),
        detection: 'applicable',
        collection: 'complete',
        factCount: 6,
      })
    );
    expect(result.graph.nodes.filter((node) => node.kind === 'test')).toHaveLength(3);
    expect(read.mock.calls.map((call) => call[1]?.locator).sort()).toEqual([
      '.github/workflows/ci.yml',
      'Dockerfile',
      'contracts/openapi.yaml',
    ]);
    expect(
      read.mock.calls.every((call) => !String(call[1]?.locator ?? '').includes('fixture'))
    ).toBe(true);
  });

  it('links static source imports to local files and external module specifiers', async () => {
    const contents = {
      'package.json': JSON.stringify({ name: 'fixture-app', dependencies: { react: '^19.0.0' } }),
      'src/index.ts':
        "/* import forged from 'not-real'; */\nimport React from 'react';\nimport { helper } from './util.js';\nvoid React; void helper;\n",
      'src/util.ts': 'export const helper = 1;\n',
    };
    const inputs = Object.entries(contents).map(([locator, content]) => ({
      locator,
      mediaType: locator.endsWith('.json') ? 'application/json' : 'text/typescript',
      byteLength: new TextEncoder().encode(content).byteLength,
      digest: {
        algorithm: 'sha256' as const,
        value: createHash('sha256').update(content).digest('hex'),
      },
    }));
    const buildRequest = request(createStandardRepositoryProviders(), ports(inputs, contents));
    const result = await buildRepoGraph({
      ...buildRequest,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result).toMatchObject({ status: 'complete', metrics: { providerFacts: 10 } });
    const importEdges = result.graph.edges.filter((edge) => edge.relation === 'imports');
    expect(importEdges).toHaveLength(2);
    expect(result.graph.nodes).toContainEqual(expect.objectContaining({ kind: 'module' }));
  });

  it('combines file topology and deduplicated package declarations through standard providers', async () => {
    const packageJson = JSON.stringify({
      name: 'fixture-app',
      dependencies: { zod: '^4.0.0', react: '^19.0.0' },
      devDependencies: { zod: '^4.0.0', vitest: '^4.0.0' },
      scripts: { build: 'tsc', test: 'vitest' },
    });
    const packageInput: GraphProviderInput = {
      locator: 'package.json',
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(packageJson).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(packageJson).digest('hex'),
      },
    };
    const buildRequest = request(
      createStandardRepositoryProviders(),
      ports([packageInput], { 'package.json': packageJson })
    );
    const result = await buildRepoGraph({
      ...buildRequest,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result).toMatchObject({
      status: 'complete',
      metrics: { inputFiles: 1, providerFacts: 7 },
      providers: expect.arrayContaining([
        expect.objectContaining({ detection: 'applicable', collection: 'complete', factCount: 6 }),
        expect.objectContaining({ detection: 'applicable', collection: 'complete', factCount: 1 }),
        expect.objectContaining({ detection: 'not-applicable', collection: 'not-run' }),
      ]),
    });
    expect(result.graph.edges.filter((edge) => edge.relation === 'depends-on')).toHaveLength(3);
    expect(result.graph.edges.filter((edge) => edge.relation === 'declares')).toHaveLength(2);
  });

  it('preserves an honest unknown zone when a package manifest is malformed', async () => {
    const malformed = '{"name":';
    const packageInput: GraphProviderInput = {
      locator: 'package.json',
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(malformed).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(malformed).digest('hex'),
      },
    };
    const result = await buildRepoGraph(
      request(
        [createRepositoryFilesProvider(), createPackageJsonProvider()],
        ports([packageInput], { 'package.json': malformed })
      )
    );

    expect(result).toMatchObject({
      status: 'partial',
      quality: {
        unknownZones: [expect.objectContaining({ code: 'graph.package-manifest-unreadable' })],
      },
      providers: expect.arrayContaining([
        expect.objectContaining({ collection: 'partial', factCount: 0 }),
      ]),
    });
  });

  it('extracts literal module calls but abstains from computed and unresolved local claims', async () => {
    const source =
      "import missing from './missing';\nconst legacy = require('./missing');\nvoid import('./lazy');\nconst computed = './computed';\nrequire(computed);\nvoid import(computed);\nvoid legacy; void missing;\n";
    const sourceInput: GraphProviderInput = {
      locator: 'src/index.ts',
      mediaType: 'text/typescript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const result = await buildRepoGraph(
      request(createStandardRepositoryProviders(), ports([sourceInput], { 'src/index.ts': source }))
    );

    expect(result.status).toBe('partial');
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.ecmascript-dynamic-import-unsupported' })
    );
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.ecmascript-local-import-unresolved' })
    );
    expect(result.graph?.edges.filter((edge) => edge.relation === 'imports')).toHaveLength(0);
  });

  it('emits evidence-backed imports for literal CommonJS and dynamic module targets', async () => {
    const source =
      "const express = require('express');\nvoid import('@workspai/runtime');\nvoid express;\n";
    const packageJson = JSON.stringify({
      name: 'literal-module-calls',
      dependencies: { express: 'fixture', '@workspai/runtime': 'fixture' },
    });
    const sourceInput: GraphProviderInput = {
      locator: 'src/index.js',
      mediaType: 'text/javascript',
      byteLength: new TextEncoder().encode(source).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(source).digest('hex'),
      },
    };
    const packageInput: GraphProviderInput = {
      locator: 'package.json',
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(packageJson).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(packageJson).digest('hex'),
      },
    };
    const result = await buildRepoGraph(
      request(
        createStandardRepositoryProviders(),
        ports([sourceInput, packageInput], {
          'src/index.js': source,
          'package.json': packageJson,
        })
      )
    );

    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.ecmascript-dynamic-import-unsupported' })
    );
    const provider = result.providers.find(
      (item) => item.provider.id === 'workspai.graph.provider.ecmascript-imports'
    );
    expect(provider).toMatchObject({ collection: 'complete', factCount: 2 });
    const facts = result.compositionSources
      ?.filter(
        (composition) => composition.manifest.id === 'workspai.graph.provider.ecmascript-imports'
      )
      .flatMap((composition) => composition.batch.facts);
    expect(facts).toHaveLength(2);
    expect(
      facts?.every((fact) => fact.evidence.some((item) => item.relativeLocator === 'src/index.js'))
    ).toBe(true);
  });

  it('reports undecodable source as unknown while preserving independent file topology', async () => {
    const sourceInput: GraphProviderInput = {
      locator: 'src/invalid.ts',
      mediaType: 'text/typescript',
      byteLength: 1,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256')
          .update(new Uint8Array([255]))
          .digest('hex'),
      },
    };
    const hostPorts = ports([sourceInput]);
    hostPorts.fileSource.read = async () => new Uint8Array([255]);
    const result = await buildRepoGraph(request(createStandardRepositoryProviders(), hostPorts));

    expect(result.status).toBe('partial');
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.ecmascript-source-unreadable' })
    );
  });

  it('retains unnamed package identity as an explicit unknown rather than inventing a name', async () => {
    const packageJson = JSON.stringify({ dependencies: [] });
    const packageInput: GraphProviderInput = {
      locator: 'package.json',
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(packageJson).byteLength,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(packageJson).digest('hex'),
      },
    };
    const result = await buildRepoGraph(
      request(
        [createRepositoryFilesProvider(), createPackageJsonProvider()],
        ports([packageInput], { 'package.json': packageJson })
      )
    );

    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.package-name-undeclared' })
    );
  });

  it('builds portable file topology with the package-owned repository provider', async () => {
    const unicodeInput = {
      ...input,
      locator: `src/${'deep/'.repeat(80)}Cafe\u0301.ts`,
      digest: { ...digest, value: 'b'.repeat(64) },
    };
    const result = await buildRepoGraph(
      request([createRepositoryFilesProvider()], ports([unicodeInput]))
    );
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result).toMatchObject({
      status: 'complete',
      metrics: { inputFiles: 1, providerFacts: 1 },
      providers: [{ detection: 'applicable', collection: 'complete', factCount: 1 }],
      graph: { edges: [{ relation: 'contains', state: 'accepted' }] },
    });
    expect(result.graph?.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^entity:workspai:file:sha256:[a-f0-9]{64}$/u),
        expect.stringMatching(/^entity:workspai:repository:sha256:[a-f0-9]{64}$/u),
      ])
    );
  });

  it('admits provider output and composes one canonical repository graph', async () => {
    const result = await buildRepoGraph(request([provider()]));

    expect(result).toMatchObject({
      status: 'complete',
      metrics: { inputFiles: 1, inputBytes: 21, providerFacts: 1, omittedFiles: 0 },
      providers: [
        {
          detection: 'applicable',
          collection: 'complete',
          factCount: 1,
        },
      ],
      graph: {
        nodes: [{ kind: 'file' }, { kind: 'repository' }],
        edges: [{ relation: 'contains', state: 'accepted' }],
      },
      quality: { graph: { integrity: 'pass' }, providerFailures: [] },
    });
  });

  it('fails closed before provider execution when inventory identity is not portable', async () => {
    const detect = vi.fn();
    const runtime = provider();
    runtime.detect = detect;
    const result = await buildRepoGraph(
      request([runtime], ports([{ ...input, locator: 'C:\\repository\\src\\index.ts' }]))
    );

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_REPO_INVENTORY_LOCATOR_INVALID' })
    );
    expect(detect).not.toHaveBeenCalled();
  });

  it('does not execute a network-capable provider under the default offline policy', async () => {
    const collect = vi.fn();
    const runtime = provider({ network: 'allow', collect });
    const result = await buildRepoGraph(request([runtime]));

    expect(result.status).toBe('failed');
    expect(result.providers).toContainEqual(
      expect.objectContaining({ detection: 'blocked', collection: 'not-run' })
    );
    expect(collect).not.toHaveBeenCalled();
  });

  it('rejects reads outside the admitted content-addressed inventory', async () => {
    const runtime = provider({
      collect: async function collect(request) {
        await request.readInput(
          { ...input, locator: 'secrets.env' },
          { maxBytes: 1_024, signal: request.signal }
        );
        throw new Error('unreachable');
      },
    });
    const result = await buildRepoGraph(request([runtime]));

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_PROVIDER_COLLECTION_FAILED' })
    );
  });

  it('fails closed when provider collection exceeds its declared deadline', async () => {
    const runtime = provider({
      collect: () => new Promise(() => undefined),
    });
    const boundedRuntime: GraphProviderRuntime = {
      ...runtime,
      manifest: {
        ...runtime.manifest,
        limits: { ...runtime.manifest.limits, maxDurationMs: 5 },
      },
    };
    const result = await buildRepoGraph(request([boundedRuntime]));

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_PROVIDER_COLLECTION_TIMEOUT' })
    );
  });

  it('rejects invalid build budgets before touching the host filesystem', async () => {
    const hostPorts = ports();
    const inventory = vi.spyOn(hostPorts.fileSource, 'inventory');
    const buildRequest = request([provider()], hostPorts);
    const result = await buildRepoGraph({
      ...buildRequest,
      policy: {
        ...buildRequest.policy,
        limits: { ...buildRequest.policy.limits, maxFiles: 0 },
      },
    });

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_REPO_POLICY_LIMIT_INVALID' })
    );
    expect(inventory).not.toHaveBeenCalled();
  });

  it('rejects duplicate provider identities before either provider executes', async () => {
    const first = provider();
    const second = provider();
    const firstDetect = vi.spyOn(first, 'detect');
    const secondDetect = vi.spyOn(second, 'detect');
    const result = await buildRepoGraph(request([first, second]));

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_REPO_PROVIDER_DUPLICATE' })
    );
    expect(firstDetect).not.toHaveBeenCalled();
    expect(secondDetect).not.toHaveBeenCalled();
  });

  it('does not admit provider output under a different redaction policy', async () => {
    const buildRequest = request([provider()]);
    const result = await buildRepoGraph({
      ...buildRequest,
      policy: { ...buildRequest.policy, redactionProfile: 'strict-portable' },
    });

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_PROVIDER_REDACTION_POLICY_MISMATCH' })
    );
  });

  it.each(['failed', 'cancelled'] as const)(
    'propagates a %s host inventory without executing providers',
    async (status) => {
      const runtime = provider();
      const detect = vi.spyOn(runtime, 'detect');
      const hostPorts = ports();
      hostPorts.fileSource.inventory = async () => ({
        status,
        inputs: [],
        diagnostics: [],
        omittedFiles: 1,
        omittedBytes: 10,
        unknownZones: [
          { code: 'graph.inventory-unavailable', scope: 'repository', reason: 'fixture' },
        ],
        unsupportedZones: [],
      });
      const result = await buildRepoGraph(request([runtime], hostPorts));

      expect(result.status).toBe(status);
      expect(result.quality.unknownZones).toHaveLength(1);
      expect(result.metrics.omittedFiles).toBe(1);
      expect(result.metrics.omittedBytes).toBe(10);
      expect(detect).not.toHaveBeenCalled();
    }
  );

  it('isolates invalid manifests and provider detection failures', async () => {
    const invalidBase = provider();
    const invalidManifest: GraphProviderRuntime = {
      ...invalidBase,
      manifest: { ...invalidBase.manifest, id: 'INVALID PROVIDER' },
    };
    const throwingBase = provider();
    const throwingDetection: GraphProviderRuntime = {
      ...throwingBase,
      manifest: {
        ...throwingBase.manifest,
        id: 'workspai.graph.provider.throwing-detection',
      },
      detect: () => {
        throw new Error('/private/repository/secret');
      },
    };
    const invalidDetectionBase = provider();
    const invalidDetection: GraphProviderRuntime = {
      ...invalidDetectionBase,
      manifest: {
        ...invalidDetectionBase.manifest,
        id: 'workspai.graph.provider.invalid-detection',
      },
      detect: () => ({ invalid: true }),
    };
    const result = await buildRepoGraph(
      request([
        invalidManifest,
        throwingDetection,
        invalidDetection,
        createRepositoryFilesProvider(),
      ])
    );

    expect(result.status).toBe('partial');
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detection: 'invalid', collection: 'not-run' }),
        expect.objectContaining({ detection: 'failed', collection: 'not-run' }),
      ])
    );
    expect(JSON.stringify(result)).not.toContain('/private/repository/secret');
  });

  it('blocks process-capable providers in standalone repository mode', async () => {
    const base = provider();
    const runtime: GraphProviderRuntime = {
      ...base,
      manifest: {
        ...base.manifest,
        permissions: { ...base.manifest.permissions, process: 'allow' },
      },
    };
    const collect = vi.spyOn(runtime, 'collect');
    const result = await buildRepoGraph(request([runtime]));

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_PROVIDER_PROCESS_DENIED' })
    );
    expect(collect).not.toHaveBeenCalled();
  });

  it('rejects malformed collection output and never composes it', async () => {
    const runtime = provider({ collect: () => ({ forged: true }) });
    const result = await buildRepoGraph(request([runtime]));

    expect(result.status).toBe('failed');
    expect(result.providers).toContainEqual(
      expect.objectContaining({ collection: 'invalid', factCount: 0 })
    );
  });

  it('does not compose facts from a provider-declared failed batch', async () => {
    const runtime = provider();
    const collect = runtime.collect.bind(runtime);
    runtime.collect = async (collectionRequest) => ({
      ...((await collect(collectionRequest)) as GraphFactBatch),
      status: 'failed',
    });
    const result = await buildRepoGraph(request([runtime]));

    expect(result.status).toBe('failed');
    expect(result.providers).toContainEqual(
      expect.objectContaining({ collection: 'failed', factCount: 1 })
    );
    expect(result.quality.providerFailures).toContainEqual(
      expect.objectContaining({ providerId: runtime.manifest.id })
    );
  });
});

describe('writeGraphGeneration', () => {
  it('publishes canonical immutable artifacts through the injected store', async () => {
    const hostPorts = ports();
    const build = await buildRepoGraph(request([provider()], hostPorts));
    const publish = vi.fn(async (publicationRequest: GraphProjectPublicationRequest) => ({
      status: 'committed' as const,
      pointer: '.workspai/reports/graph-generation.json',
      artifacts: Object.fromEntries(
        publicationRequest.artifacts.map((candidate) => [
          candidate.name,
          `.workspai/reports/${candidate.name}.json`,
        ])
      ) as Record<'canonical-graph' | 'quality' | 'provider-runs' | 'publication', string>,
    }));

    const result = await writeGraphGeneration({
      build,
      store: { publish },
      digest: hostPorts.digest,
    });

    expect(result).toMatchObject({ accepted: true, value: { status: 'committed' } });
    expect(publish).toHaveBeenCalledOnce();
    const publication = publish.mock.calls[0]?.[0];
    expect(publication?.generationKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(publication?.artifacts.map((candidate) => candidate.name).sort()).toEqual([
      'canonical-graph',
      'provider-runs',
      'publication',
      'quality',
    ]);
    for (const candidate of publication?.artifacts ?? []) {
      expect(createHash('sha256').update(candidate.bytes).digest('hex')).toBe(
        candidate.digest.value
      );
      expect(new TextDecoder().decode(candidate.bytes)).not.toContain('/repository');
    }
    const publicationArtifact = publication?.artifacts.find(
      (candidate) => candidate.name === 'publication'
    );
    const publicationIndex = JSON.parse(
      new TextDecoder().decode(publicationArtifact?.bytes ?? new Uint8Array())
    ) as {
      artifacts: Record<string, { digest: string; path: string }>;
    };
    expect(publicationIndex.artifacts['canonical-graph']?.path).toMatch(
      /^\.workspai\/reports\/graph-generations\/[a-f0-9]{64}\/source-evidence-graph\.json$/u
    );
    expect(publicationIndex.artifacts.quality?.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('refuses partial, failed, or cancelled builds and never calls the store', async () => {
    const publish = vi.fn();
    const hostPorts = ports();
    const base = await buildRepoGraph(request([provider()], hostPorts));

    for (const status of ['partial', 'failed', 'cancelled'] as const) {
      const result = await writeGraphGeneration({
        build: {
          ...base,
          status,
          ...(status === 'partial' ? {} : { graph: undefined }),
        },
        store: { publish },
        digest: hostPorts.digest,
      });
      expect(result).toMatchObject({ accepted: false, code: 'invalid-build' });
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not call the store when cancellation is already requested', async () => {
    const hostPorts = ports();
    const build = await buildRepoGraph(request([provider()], hostPorts));
    const publish = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const result = await writeGraphGeneration({
      build,
      store: { publish },
      digest: hostPorts.digest,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: 'GRAPH_PROJECT_PUBLICATION_CANCELLED' })],
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('converts store failures into portable diagnostics', async () => {
    const hostPorts = ports();
    const build = await buildRepoGraph(request([provider()], hostPorts));
    const result = await writeGraphGeneration({
      build,
      store: {
        publish: async () => {
          throw new Error('/private/repository/secret');
        },
      },
      digest: hostPorts.digest,
    });

    expect(result).toMatchObject({ accepted: false, code: 'publication-failed' });
    expect(JSON.stringify(result)).not.toContain('/private/repository/secret');
  });
});
