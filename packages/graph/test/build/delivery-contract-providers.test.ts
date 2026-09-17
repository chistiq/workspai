import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeGraphProductHostPorts } from '../../src/adapters/node/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type { GraphWorkerTaskRequest, GraphWorkerTaskResult } from '../../src/ports/index.js';
import { createStandardRepositoryProviders } from '../../src/providers/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-delivery-'));
  roots.push(root);
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await mkdir(path.join(root, 'k8s'), { recursive: true });
  await mkdir(path.join(root, 'src', 'handlers'), { recursive: true });
  await mkdir(path.join(root, 'adr'), { recursive: true });
  await writeFile(
    path.join(root, 'openapi.yaml'),
    [
      'openapi: 3.0.3',
      'info:',
      '  title: Catalog',
      'paths:',
      '  /items:',
      '    get:',
      '      operationId: listItems',
      '      responses:',
      '        "200":',
      '          description: ok',
      'components:',
      '  schemas:',
      '    Item:',
      '      type: object',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, 'schema.graphql'),
    'type Query { item(id: ID!): Item }\ntype Item { id: ID! }\n'
  );
  await writeFile(
    path.join(root, 'k8s', 'deploy.yaml'),
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: catalog',
      '  namespace: prod',
      'spec:',
      '  replicas: 1',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    ['name: ci', 'on: [push]', 'jobs:', '  test:', '    runs-on: ubuntu-latest', ''].join('\n')
  );
  await writeFile(path.join(root, 'Dockerfile'), 'FROM python:3.12\n');
  await writeFile(
    path.join(root, 'infra.tf'),
    'resource "aws_db_instance" "catalog" {}\nresource "aws_sqs_queue" "events" {}\n'
  );
  await writeFile(
    path.join(root, 'pyproject.toml'),
    ['[project.scripts]', 'catalog = "catalog.cli:main"', ''].join('\n')
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'catalog-extension',
        engines: { vscode: '^1.90.0' },
        contributes: { commands: [{ command: 'catalog.refresh', title: 'Refresh' }] },
      },
      null,
      2
    ) + '\n'
  );
  await writeFile(path.join(root, 'adr', '0001-catalog.md'), '# Use a catalog service\n');
  await writeFile(
    path.join(root, 'src', 'handlers', 'items.ts'),
    'import express from "express";\nconst app = express();\nexport function listItems(_id: string): string[] { return []; }\napp.get("/items", listItems);\n'
  );
  return root;
}

function ports() {
  const node = createNodeGraphProductHostPorts();
  return {
    ...node,
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 0, inputBytes: 0, outputBytes: 0 },
        };
      },
    },
  };
}

describe('delivery and contract repository providers', () => {
  it('extracts OpenAPI, GraphQL, Kubernetes, CI, IaC, manifests, ADRs and handler bindings', async () => {
    const root = await fixture();
    const result = await buildRepoGraph({
      root,
      scope: { kind: 'project', projectIds: ['project:delivery-fixture'] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.graph.nodes.some((node) => node.kind === 'api')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'schema')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'deployment')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'pipeline')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'container')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'database')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'queue')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'decision')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'exposes')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'deployed-as')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'decided-by')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'implements')).toBe(true);
    expect(result.graph.edges.every((edge) => edge.proof.evidence.length > 0)).toBe(true);
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.openapi-contracts' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.graphql-contracts' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.kubernetes-topology' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.ci-workflow' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({
            id: 'workspai.graph.provider.infrastructure-as-code',
          }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({
            id: 'workspai.graph.provider.python-project-manifest',
          }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({
            id: 'workspai.graph.provider.vscode-extension-manifest',
          }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({
            id: 'workspai.graph.provider.architecture-decisions',
          }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({
            id: 'workspai.graph.provider.api-implementation-binding',
          }),
          collection: 'complete',
        }),
      ])
    );
  });

  it('does not classify unrelated invalid YAML as unreadable Kubernetes input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-kubernetes-precision-'));
    roots.push(root);
    await mkdir(path.join(root, 'lib', 'tests', 'cassettes'), { recursive: true });
    await mkdir(path.join(root, 'charts', 'service', 'templates'), { recursive: true });
    await writeFile(
      path.join(root, 'lib', 'tests', 'cassettes', 'recording.yaml'),
      'responses:\n  - body: { flow_name }: [\n'
    );
    await writeFile(
      path.join(root, 'charts', 'service', 'templates', 'deployment.yaml'),
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Values.name }\n'
    );

    const result = await buildRepoGraph({
      root,
      scope: { kind: 'project', projectIds: ['project:kubernetes-precision'] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
    });

    expect(result.quality.unknownZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'graph.kubernetes-unreadable',
          scope: 'charts/service/templates/deployment.yaml',
        }),
      ])
    );
    expect(result.quality.unknownZones).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'graph.kubernetes-unreadable',
          scope: 'lib/tests/cassettes/recording.yaml',
        }),
      ])
    );
  });
});
