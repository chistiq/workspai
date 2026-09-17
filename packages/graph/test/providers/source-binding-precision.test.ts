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
        'src/handlers/items.ts':
          'export function handle(): string[] { return listItems("listItems"); }\nexport function listItems(_id: string): string[] { return []; }\n',
      },
      [createOpenApiContractsProvider(), createApiImplementationBindingProvider()]
    );
    expect(handled.graph?.edges.some((edge) => edge.relation === 'implements')).toBe(true);
  });
});
