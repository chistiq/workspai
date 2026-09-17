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
import { isGeneratedSource } from '../../src/providers/generated-source.js';
import {
  createApiImplementationBindingProvider,
  createOpenApiContractsProvider,
  createSourceDeclarationsProvider,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';

const scope = { kind: 'project' as const, projectIds: ['binding-precision'] as [string] };

function digestOf(content: string) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(content).digest('hex'),
  };
}

function input(locator: string, content: string): GraphProviderInput {
  const bytes = new TextEncoder().encode(content);
  return {
    locator,
    mediaType: 'text/plain',
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

async function collectDeclarations(
  contents: Readonly<Record<string, string>>
): Promise<GraphFactBatch> {
  const provider = createSourceDeclarationsProvider();
  const inputs = Object.entries(contents).map(([locator, content]) => input(locator, content));
  return (await provider.collect({
    scope,
    inputs,
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
    readInput: async (requested) => new TextEncoder().encode(contents[requested.locator] ?? ''),
  })) as GraphFactBatch;
}

function objectId(batch: GraphFactBatch, predicate: string): string[] {
  return batch.facts
    .filter((fact) => fact.predicate === predicate)
    .map((fact) => ('id' in fact.object ? fact.object.id : ''));
}

function callsFrom(batch: GraphFactBatch, locator: string): string[] {
  return batch.facts
    .filter(
      (fact) =>
        fact.predicate === 'calls' && 'id' in fact.subject && fact.subject.id.includes(locator)
    )
    .map((fact) => ('id' in fact.object ? fact.object.id : ''));
}

describe('source binding precision', () => {
  it('does not declare or call names that only appear in strings and docstrings', async () => {
    const batch = await collectDeclarations({
      'src/app.ts':
        '`function phantom() {}`;\nexport default function actual() { actual(); }\nconst note = "target()";\n',
      'src/app.py': 'def actual():\n    """\ndef phantom():\n        pass\n    """\n    return 1\n',
    });
    const defined = objectId(batch, 'defines');
    expect(defined.some((id) => id.includes('phantom'))).toBe(false);
    expect(defined.some((id) => id.includes(':function:actual'))).toBe(true);
    expect(objectId(batch, 'calls').some((id) => id.includes('target'))).toBe(false);
  });

  it('binds short names and import aliases, and does not cross private module members', async () => {
    const batch = await collectDeclarations({
      'src/lib.ts': 'export function fetchItems(): void {}\nfunction hidden(): void {}\n',
      'src/app.ts':
        "import { fetchItems as load } from './lib.ts';\nexport function go(): void {\n  load();\n  hidden();\n  go();\n}\n",
    });
    const called = objectId(batch, 'calls');
    expect(called.some((id) => id.includes('fetchItems'))).toBe(true);
    expect(called.some((id) => id.includes('hidden'))).toBe(false);
    expect(called.some((id) => id.includes(':function:go'))).toBe(true);
    expect(batch.unknownZones).not.toContainEqual(
      expect.objectContaining({ code: 'graph.source-call-ambiguous' })
    );
  });

  it('requires a handler declaration for OpenAPI implements and keeps authored do-not-edit strings', async () => {
    expect(
      isGeneratedSource(
        'src/app.ts',
        '/* license */ const note = "do not edit";\nexport function actual() {}\n'
      )
    ).toBe(false);
    expect(
      isGeneratedSource(
        'src/app.ts',
        '<!-- license\n-->\nexport function actual(): string { return "do not edit"; }\n'
      )
    ).toBe(false);
    expect(
      isGeneratedSource(
        'src/app.ts',
        'export function actual(): string { return "do not edit"; }\n'
      )
    ).toBe(false);
    expect(
      isGeneratedSource(
        'src/api.pb.go',
        '// Code generated by protoc-gen-go. DO NOT EDIT.\npackage api\nfunc Fetch() {}\n'
      )
    ).toBe(true);

    const stringOnly = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/controllers/items.ts': 'const documentationExample = "listItems";\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(stringOnly.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(false);
    expect(stringOnly.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.api-binding-unbound' })
    );

    const handled = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/app.ts':
          'import express from "express";\nconst app = express();\nexport function listItems(_id: string): string[] { return []; }\napp.get("/items", listItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(handled.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(true);

    const nameOnly = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/handlers/items.ts': 'export function listItems(): string[] { return []; }\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(nameOnly.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(false);

    const splitContracts = await build(
      {
        'catalog/openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'billing/openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Billing\npaths:\n  /bills:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/handlers/items.ts':
          'import express from "express";\nconst app = express();\nexport function listItems(): string[] { return []; }\napp.get("/items", listItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    const implemented = (splitContracts.graph?.edges ?? []).filter(
      (edge) => edge.relation === 'implements'
    );
    expect(implemented).toHaveLength(1);
    expect(splitContracts.quality.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.api-binding-unbound',
        scope: 'billing/openapi.yaml',
      })
    );
    expect(splitContracts.quality.unknownZones).not.toContainEqual(
      expect.objectContaining({
        code: 'graph.api-binding-unbound',
        scope: 'catalog/openapi.yaml',
      })
    );

    const mapGet = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/handlers/items.ts':
          'export function listItems(): void {}\nconst cache = new Map();\ncache.get("/items", listItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(mapGet.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(false);
    expect(mapGet.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.api-binding-unbound', scope: 'openapi.yaml' })
    );

    const arbitraryApp = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/handlers/items.ts':
          'export function listItems(): void {}\nconst app = { get(_path: string, _handler: unknown): void {} };\napp.get("/items", listItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(arbitraryApp.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(false);
    expect(arbitraryApp.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.api-binding-unbound', scope: 'openapi.yaml' })
    );

    const ambiguousHandlers = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: listItems\n      responses:\n        "200":\n          description: ok\n',
        'src/handlers/first.ts':
          'import express from "express";\nconst app = express();\nexport function listItems(): void {}\napp.get("/items", listItems);\n',
        'src/controllers/second.ts':
          'import express from "express";\nconst app = express();\nexport function listItems(): void {}\napp.get("/items", listItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(ambiguousHandlers.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(
      false
    );
    expect(ambiguousHandlers.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.api-binding-ambiguous', scope: 'openapi.yaml' })
    );

    const partiallyRoutedOperationId = await build(
      {
        'openapi.yaml':
          'openapi: 3.0.3\ninfo:\n  title: Catalog\npaths:\n  /items:\n    get:\n      operationId: mutateItems\n      responses:\n        "200":\n          description: ok\n    post:\n      operationId: mutateItems\n      responses:\n        "200":\n          description: ok\n',
        'src/app.ts':
          'import express from "express";\nconst app = express();\nexport function mutateItems(): void {}\napp.get("/items", mutateItems);\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(
      partiallyRoutedOperationId.graph?.edges.filter((edge) => edge.relation === 'implements')
    ).toHaveLength(1);
    expect(partiallyRoutedOperationId.quality.unknownZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.api-binding-unbound',
        scope: 'openapi.yaml',
        reason: expect.stringContaining('POST /items'),
      })
    );
  });

  it('ignores template imports, regex call shapes, export aliases and namespace members', async () => {
    const batch = await collectDeclarations({
      'src/lib.ts': 'function fetchItems(): void {}\nexport { fetchItems as load };\n',
      'src/ns.ts': 'export function fetchItems(): void {}\n',
      'src/app.ts': [
        'const src = `',
        "import { phantom } from './lib.ts';",
        '`;',
        "import { load } from './lib.ts';",
        "import * as api from './ns.ts';",
        'export function target(): void {}',
        'const r = /target()/;',
        'export function run(): void {',
        '  load();',
        '  api.fetchItems();',
        '  go();',
        '}',
        'export function go(): void { go(); }',
      ].join('\n'),
    });
    const called = objectId(batch, 'calls');
    expect(called.some((id) => id.includes('fetchItems'))).toBe(true);
    expect(called.some((id) => id.includes(':function:go'))).toBe(true);
    expect(called.filter((id) => id.includes(':function:target'))).toEqual([]);
    expect(objectId(batch, 'defines').some((id) => id.includes('phantom'))).toBe(false);
  });

  it('does not treat a regex after return as a call, and still binds a real return call', async () => {
    const regex = await collectDeclarations({
      'src/app.ts':
        'export function target(): void {}\nexport function example(): RegExp { return /target()/; }\n',
    });
    expect(objectId(regex, 'calls').filter((id) => id.includes(':function:target'))).toEqual([]);
    expect(regex.unknownZones).toEqual([]);

    const real = await collectDeclarations({
      'src/app.ts':
        'export function target(): void {}\nexport function example(): void { return target(); }\n',
    });
    expect(objectId(real, 'calls').some((id) => id.includes(':function:target'))).toBe(true);
  });

  it('treats an Objective-C message receiver as a receiver, not a called selector', async () => {
    const batch = await collectDeclarations({
      'src/Health.m':
        '@implementation Health\n- (void)service {}\n- (void)health {}\n- (void)run { [service health]; }\n@end\n',
    });
    const called = objectId(batch, 'calls');
    expect(called.some((id) => id.includes(':method:health'))).toBe(true);
    expect(called.some((id) => id.includes(':method:service'))).toBe(false);
  });

  it('binds indirect default exports and explicit Python underscore imports', async () => {
    const batch = await collectDeclarations({
      'src/lib.ts': 'function actual(): void {}\nexport default actual;\n',
      'src/app.ts': "import catalog from './lib.ts';\nexport function run(): void { catalog(); }\n",
      'src/util.py':
        'def _helper():\n    return 1\ndef public():\n    return 2\n__all__ = ["public"]\n',
      'src/explicit.py': 'from .util import _helper\ndef run():\n    _helper()\n',
      'src/star.py': 'from .util import *\ndef run():\n    public()\n    _helper()\n',
    });
    const called = objectId(batch, 'calls');
    expect(called.some((id) => id.includes(':function:actual'))).toBe(true);
    expect(callsFrom(batch, 'src/explicit.py').some((id) => id.includes(':function:_helper'))).toBe(
      true
    );
    expect(callsFrom(batch, 'src/star.py').some((id) => id.includes(':function:public'))).toBe(
      true
    );
    expect(callsFrom(batch, 'src/star.py').some((id) => id.includes('_helper'))).toBe(false);
    expect(batch.coverage).toContainEqual(
      expect.objectContaining({ dimension: 'source-calls-examined' })
    );
    expect(batch.coverage).toContainEqual(
      expect.objectContaining({ dimension: 'source-calls-unresolved' })
    );
  });
});
