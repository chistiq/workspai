import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphFactBatch,
  type GraphProviderInput,
} from '../../src/contracts/index.js';
import type {
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import {
  createDocumentationSurfacesProvider,
  createSourceDeclarationsProvider,
  createSourceLanguageProvider,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';
import {
  MAX_CALLS_PER_SYMBOL,
  MAX_SYMBOLS_PER_FILE,
} from '../../src/providers/source-declarations.js';

const scope = { kind: 'project' as const, projectIds: ['node-catalog-service'] as [string] };

function digestOf(content: string) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(content).digest('hex'),
  };
}

function input(locator: string, content: string, mediaType = 'text/plain'): GraphProviderInput {
  const bytes = new TextEncoder().encode(content);
  return {
    locator,
    mediaType,
    byteLength: bytes.byteLength,
    digest: digestOf(content),
  };
}

function ports(contents: Readonly<Record<string, string>>): GraphProductHostPorts {
  const inputs = Object.entries(contents).map(([locator, content]) => input(locator, content));
  return {
    clock: { now: () => new Date('2026-09-13T12:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (value) => createHash('sha256').update(value).digest('hex'),
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
      read: async (_root, requested) => new TextEncoder().encode(contents[requested.locator] ?? ''),
    },
  };
}

function build(
  contents: Readonly<Record<string, string>>,
  providers = createStandardRepositoryProviders()
) {
  return buildRepoGraph({
    root: '/fixture',
    scope,
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers,
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: ports(contents),
  });
}

describe('source semantic providers', () => {
  const source = {
    'src/catalog.ts':
      'export function listCatalog(): string[] { return findCatalog();\n}\nexport function findCatalog(): string[] { return []; }\n',
    'src/http.ts':
      "import { listCatalog } from './catalog.ts';\nexport function handle(): string[] { return listCatalog();\n}\n",
    'README.md': '# Catalog\n',
    'notes.md': 'not a governed document surface\n',
    'app.dart': "import 'package:billing/core.dart';\n",
    'dynamic.ts': 'void import(computed());\n',
  };

  it('emits symbols, local calls, language and documents with proof', async () => {
    const result = await build({
      'src/catalog.ts': source['src/catalog.ts']!,
      'src/http.ts': source['src/http.ts']!,
      'README.md': source['README.md']!,
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));

    expect(result.graph.nodes.some((node) => node.kind === 'symbol')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'language')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'document')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'workspace')).toBe(false);
    expect(result.graph.edges.some((edge) => edge.relation === 'defines')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'uses-language')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'documented-by')).toBe(true);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.relation === 'contains' &&
          result.graph?.nodes.find((node) => node.id === edge.from)?.kind === 'workspace'
      )
    ).toBe(false);
    expect(
      createStandardRepositoryProviders().some((provider) =>
        provider.manifest.id.includes('scope-containment')
      )
    ).toBe(false);
    expect(result.graph.edges.every((edge) => edge.proof.evidence.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });

  it('binds unambiguous local C++ calls across quoted includes', async () => {
    const result = await build({
      'src/health.h': 'int serve();\n',
      'src/server.cc': '#include "health.h"\nint boot() { return serve();\n}\n',
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.graph.edges.some((edge) => edge.relation === 'defines')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
  });

  it('binds unambiguous Python, PHP and Ruby local calls through language imports', async () => {
    const python = await build({
      'src/util.py': 'def list_items():\n    return 1\n',
      'src/app.py': 'from .util import list_items\ndef run():\n    return list_items()\n',
    });
    const php = await build({
      'src/bootstrap.php': '<?php\nfunction boot(): void {}\n',
      'src/index.php': "<?php\nrequire_once 'bootstrap.php';\nboot();\n",
    });
    const ruby = await build({
      'src/health.rb': "def health\n  'ok'\nend\n",
      'src/app.rb': "require_relative 'health'\nhealth\n",
    });
    for (const result of [python, php, ruby]) {
      if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
    }
  });

  it('binds unambiguous same-package Go and Java calls without inventing extra edges', async () => {
    const go = await build({
      'src/health.go': 'package app\nfunc Serve() int { return 1 }\n',
      'src/main.go': 'package app\nfunc Boot() int { return Serve() }\n',
    });
    const java = await build({
      'src/Health.java': 'class Health {\n    String status() { return "ok"; }\n}\n',
      'src/App.java':
        'class App {\n    String run() { Health h = new Health(); return h.status();\n}\n}\n',
    });
    const objc = await build({
      'src/Health.m': '@interface Health : NSObject\n- (NSString *)status;\n@end\n',
      'src/main.m':
        '#import "Health.m"\nNSString *run(Health *service) { return [service status]; }\n',
    });
    for (const result of [go, java, objc]) {
      if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
      expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
    }
  });

  it('leaves ambiguous calls and unsupported syntax unknown instead of inventing facts', async () => {
    const ambiguous = await build({
      'src/a.ts': 'export function shared(): void {}\n',
      'src/b.ts': 'export function shared(): void {}\n',
      'src/c.ts': "import { shared } from './a.ts';\nimport { shared } from './b.ts';\nshared();\n",
    });
    expect(ambiguous.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
    expect(ambiguous.status).toBe('partial');
    expect(ambiguous.quality.graph?.integrity).toBe('attention');

    const unsupported = await build({ 'app.dart': source['app.dart']! });
    expect(unsupported.quality.unsupportedZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-language-unsupported', scope: 'app.dart' })
    );
    expect(unsupported.graph?.nodes.some((node) => node.kind === 'symbol')).toBe(false);
  });

  it('does not treat notes.md as a governed document surface', async () => {
    const result = await build({ 'notes.md': source['notes.md']! });
    expect(result.graph?.nodes.some((node) => node.kind === 'document')).toBe(false);
  });

  it('preserves semantics across provider-order permutation', async () => {
    const contents = {
      'src/catalog.ts': source['src/catalog.ts']!,
      'README.md': source['README.md']!,
    };
    const ordered = [
      createSourceDeclarationsProvider(),
      createSourceLanguageProvider(),
      createDocumentationSurfacesProvider(),
    ];
    const reversed = [...ordered].reverse();
    const left = await build(contents, ordered);
    const right = await build(contents, reversed);
    expect(left.graph?.generation.reference.contentDigest).toEqual(
      right.graph?.generation.reference.contentDigest
    );
  });

  it('detects cancellation before emitting further declaration facts', async () => {
    const provider = createSourceDeclarationsProvider();
    await expect(
      provider.collect({
        scope,
        inputs: [input('src/catalog.ts', source['src/catalog.ts']!)],
        observedAt: '2026-09-13T12:00:00.000Z',
        resolveIdentity: async () => {
          throw new Error('identity should not run after cancellation');
        },
        readInput: async () => new Uint8Array(),
        signal: AbortSignal.abort(),
      })
    ).rejects.toThrow(/cancelled/i);
  });

  it('records truncated symbol extraction as unknown, bounded coverage and partial completeness', async () => {
    const sourceFile = Array.from(
      { length: MAX_SYMBOLS_PER_FILE + 3 },
      (_, index) => `export function symbol${String(index).padStart(3, '0')}(): void {}\n`
    ).join('');
    const provider = createSourceDeclarationsProvider();
    const batch = (await provider.collect({
      scope,
      inputs: [input('src/large.ts', sourceFile)],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => ({
        accepted: true as const,
        issues: [] as const,
        value: {
          reference: {
            id: `entity:${identity.kind}:${identity.relativeLocator}`,
            identityScheme: { id: 'workspai.graph.portable-entity', version: '1' },
            kind: identity.kind,
            scope,
          },
          normalizedLocator: identity.relativeLocator,
        },
      }),
      readInput: async () => new TextEncoder().encode(sourceFile),
    })) as GraphFactBatch;
    expect(batch.status).toBe('partial');
    expect(batch.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.source-declarations-truncated',
        scope: 'src/large.ts',
      })
    );
    expect(batch.coverage).toContainEqual(
      expect.objectContaining({
        dimension: 'source-declaration-symbols',
        observed: MAX_SYMBOLS_PER_FILE,
        expected: MAX_SYMBOLS_PER_FILE + 3,
      })
    );
    expect(batch.facts.filter((fact) => fact.predicate === 'defines')).toHaveLength(
      MAX_SYMBOLS_PER_FILE
    );
  });

  it('reports generated index coverage as capped findings, not all discovered declarations', async () => {
    const sourceFile = `// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\n${Array.from(
      { length: MAX_SYMBOLS_PER_FILE + 3 },
      (_, index) => `func Symbol${String(index).padStart(3, '0')}() {}\n`
    ).join('')}`;
    const provider = createSourceDeclarationsProvider();
    const batch = (await provider.collect({
      scope,
      inputs: [input('src/api.pb.go', sourceFile)],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => ({
        accepted: true as const,
        issues: [] as const,
        value: {
          reference: {
            id: `entity:${identity.kind}:${identity.relativeLocator}`,
            identityScheme: { id: 'workspai.graph.portable-entity', version: '1' },
            kind: identity.kind,
            scope,
          },
          normalizedLocator: identity.relativeLocator,
        },
      }),
      readInput: async () => new TextEncoder().encode(sourceFile),
    })) as GraphFactBatch;
    expect(batch.coverage).toContainEqual(
      expect.objectContaining({
        dimension: 'source-generated-symbols-indexed',
        observed: MAX_SYMBOLS_PER_FILE,
        expected: MAX_SYMBOLS_PER_FILE + 3,
      })
    );
    expect(batch.coverage).toContainEqual(
      expect.objectContaining({
        dimension: 'source-generated-symbols-materialized',
        observed: 0,
        expected: MAX_SYMBOLS_PER_FILE,
      })
    );
    expect(batch.facts.filter((fact) => fact.predicate === 'defines')).toHaveLength(0);
  });

  it('records truncated call extraction as unknown instead of silently dropping sites', async () => {
    const names = Array.from(
      { length: MAX_CALLS_PER_SYMBOL + 4 },
      (_, index) => `target${String(index)}();`
    );
    const sourceFile =
      `export function target(): void {}\nexport function run(): void { ${names.join(' ')} }\n`.replaceAll(
        /target\d+\(\);/gu,
        'target();'
      );
    const provider = createSourceDeclarationsProvider();
    const batch = (await provider.collect({
      scope,
      inputs: [input('src/calls.ts', sourceFile)],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => ({
        accepted: true as const,
        issues: [] as const,
        value: {
          reference: {
            id: `entity:${identity.kind}:${identity.relativeLocator}`,
            identityScheme: { id: 'workspai.graph.portable-entity', version: '1' },
            kind: identity.kind,
            scope,
          },
          normalizedLocator: identity.relativeLocator,
        },
      }),
      readInput: async () => new TextEncoder().encode(sourceFile),
    })) as GraphFactBatch;
    expect(batch.status).toBe('partial');
    expect(batch.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-calls-truncated', scope: 'src/calls.ts' })
    );
    expect(
      batch.coverage.find((item) => item.dimension === 'source-declaration-calls')?.observed
    ).toBe(MAX_CALLS_PER_SYMBOL);
    expect(
      batch.coverage.find((item) => item.dimension === 'source-declaration-calls')?.expected
    ).toBeGreaterThan(MAX_CALLS_PER_SYMBOL);
  });

  it('prefers a unique same-file declaration over colliding same-package peers', async () => {
    const result = await build({
      'src/peer.go': 'package app\nfunc Shared() int { return 1 }\n',
      'src/main.go':
        'package app\nfunc Shared() int { return 2 }\nfunc Boot() int { return Shared() }\n',
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
    expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
  });

  it('omits unreferenced generated declarations and keeps unique authored-call targets', async () => {
    const result = await build({
      'src/api.pb.go':
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Get() {}\nfunc Run() { Get() }\n',
      'src/main.go': 'package api\nfunc Boot() {}\n',
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(
      result.graph.edges.filter(
        (edge) =>
          edge.relation === 'defines' &&
          edge.proof.evidence.some((item) => item.relativeLocator === 'src/api.pb.go')
      )
    ).toEqual([]);
    expect(result.graph.edges.some((edge) => edge.relation === 'defines')).toBe(true);
    expect(result.graph.edges.filter((edge) => edge.relation === 'calls')).toEqual([]);
  });

  it('binds authored calls to unique generated targets and prefers authored names', async () => {
    const uniqueGenerated = await build({
      'src/api.pb.go':
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Fetch() {}\n',
      'src/main.go': 'package api\nfunc Boot() { Fetch() }\n',
    });
    if (!uniqueGenerated.graph)
      throw new Error(JSON.stringify(uniqueGenerated.diagnostics, null, 2));
    expect(uniqueGenerated.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
    expect(uniqueGenerated.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
    expect(
      uniqueGenerated.graph.edges.filter(
        (edge) =>
          edge.relation === 'defines' &&
          edge.proof.evidence.some((item) => item.relativeLocator === 'src/api.pb.go')
      )
    ).toHaveLength(1);

    const authoredWins = await build({
      'src/api.pb.go':
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Shared() {}\n',
      'src/main.go':
        'package api\nfunc Shared() int { return 1 }\nfunc Boot() int { return Shared() }\n',
    });
    if (!authoredWins.graph) throw new Error(JSON.stringify(authoredWins.diagnostics, null, 2));
    expect(authoredWins.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
    expect(authoredWins.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);

    const collidingGenerated = await build({
      'src/a.pb.go':
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Fetch() {}\n',
      'src/b.pb.go':
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Fetch() {}\n',
      'src/main.go': 'package api\nfunc Boot() { Fetch() }\n',
    });
    expect(collidingGenerated.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
  });

  it('prefers a unique function over a same-name type for call tokens', async () => {
    const result = await build({
      'src/model.ts':
        'export type Shared = string;\nexport function Shared(): string { return "ok"; }\nexport function run(): string { return Shared();\n}\n',
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
    expect(result.graph.edges.some((edge) => edge.relation === 'calls')).toBe(true);
  });

  it('leaves colliding type-only call candidates unknown rather than guessing a target', async () => {
    const result = await build({
      'src/a.ts': 'export type Shared = string;\n',
      'src/b.ts': 'export interface Shared { value: string }\n',
      'src/c.ts': "import { Shared } from './a.ts';\nimport { Shared } from './b.ts';\nShared();\n",
    });
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous', scope: 'src/c.ts' })
    );
  });

  it('reports unreadable and rejected source inputs as failed, bounded evidence', async () => {
    const provider = createSourceDeclarationsProvider();
    const batch = await provider.collect({
      scope,
      inputs: [input('src/bad.ts', 'export function bad(): void {}')],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async () => ({ accepted: false as const, issues: [] as const }),
      readInput: async () => new TextEncoder().encode('export function bad(): void {}'),
    });
    const collected = batch as GraphFactBatch;
    expect(collected.status).toBe('partial');
    expect(collected.processing[0]?.outcome).toBe('failed');
    expect(collected.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.source-declaration-unreadable', scope: 'src/bad.ts' })
    );
  });

  it('binds Node object-property calls to imported functions instead of inventing local symbols', async () => {
    const result = await build({
      'src/http.ts':
        'export function handleCatalogRequest(): string[] { return []; }\nexport function handleOrderRequest(): string | undefined { return undefined; }\n',
      'src/index.ts':
        "import { handleCatalogRequest, handleOrderRequest } from './http.ts';\nexport function startStorefront() {\n  return {\n    catalog: handleCatalogRequest(),\n    order: handleOrderRequest(),\n  };\n}\n",
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.graph.nodes.filter((node) => node.kind === 'symbol')).toHaveLength(3);
    expect(result.graph.edges.filter((edge) => edge.relation === 'defines')).toHaveLength(3);
    expect(
      result.graph.edges.filter((edge) => edge.relation === 'calls').length
    ).toBeGreaterThanOrEqual(2);
  });
});
