import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  GraphFactBatch,
  GraphProviderCollectionRequest,
  GraphProviderInput,
  GraphProviderRuntime,
} from '../../src/contracts/index.js';
import { createArchitectureDecisionsProvider } from '../../src/providers/architecture-decisions.js';
import { createCiWorkflowProvider } from '../../src/providers/ci-workflow.js';
import { createDocumentationSurfacesProvider } from '../../src/providers/documentation-surfaces.js';
import {
  createGraphqlContractsProvider,
  graphqlDefinitions,
} from '../../src/providers/graphql-contracts.js';
import { createInfrastructureAsCodeProvider } from '../../src/providers/infrastructure-as-code.js';
import { createKubernetesTopologyProvider } from '../../src/providers/kubernetes-topology.js';
import {
  createOpenApiContractsProvider,
  openApiOperationIds,
} from '../../src/providers/openapi-contracts.js';
import { parseStructuredDocuments } from '../../src/providers/structured-documents.js';
import { stripComments } from '../../src/providers/observed-edge-fact.js';

const scope = {
  kind: 'project' as const,
  projectIds: ['project:delivery-branch-coverage'] as [string],
};

function providerInput(locator: string, source: string): GraphProviderInput {
  const bytes = new TextEncoder().encode(source);
  return {
    locator,
    mediaType: locator.endsWith('.json') ? 'application/json' : 'text/plain',
    byteLength: bytes.byteLength,
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

async function collect(
  provider: GraphProviderRuntime,
  contents: Readonly<Record<string, string>>,
  unreadable: ReadonlySet<string> = new Set()
): Promise<GraphFactBatch> {
  const inputs = Object.entries(contents).map(([locator, source]) =>
    providerInput(locator, source)
  );
  return (await provider.collect({
    scope,
    inputs,
    observedAt: '2026-09-17T12:00:00.000Z',
    resolveIdentity: async (identity) => ({
      accepted: true as const,
      issues: [] as const,
      value: {
        reference: {
          id: `entity:${identity.namespace}:${identity.kind}:${identity.relativeLocator}`,
          identityScheme: { id: 'workspai.graph.portable-entity', version: '1' },
          kind: identity.kind,
          scope,
        },
        normalizedLocator: identity.relativeLocator,
      },
    }),
    readInput: async (input) => {
      if (unreadable.has(input.locator)) throw new Error('fixture read failure');
      return new TextEncoder().encode(contents[input.locator] ?? '');
    },
  } satisfies GraphProviderCollectionRequest)) as GraphFactBatch;
}

function predicates(batch: GraphFactBatch): string[] {
  return batch.facts.map((fact) => fact.predicate);
}

function objectIds(batch: GraphFactBatch): string[] {
  return batch.facts.map((fact) => ('id' in fact.object ? fact.object.id : ''));
}

describe('delivery contract provider branches', () => {
  it('parses JSON, safe YAML, and rejects malformed structured documents', () => {
    expect(parseStructuredDocuments('{"openapi":"3.1.0"}', 'openapi.json')).toEqual([
      { openapi: '3.1.0' },
    ]);
    expect(parseStructuredDocuments('---\nvalue: 1\n---\nnull\n', 'values.yaml')).toEqual([
      { value: 1 },
    ]);
    expect(() => parseStructuredDocuments('value: [', 'bad.yaml')).toThrow(
      'Structured YAML is not valid'
    );
  });

  it('extracts GraphQL schema and executable definition variants', async () => {
    const definitions = graphqlDefinitions(
      [
        '"""type Hidden { ignored: Boolean }"""',
        'schema { query: Query }',
        'extend type Query { extra: String }',
        'scalar Date',
        'interface Node { id: ID! }',
        'union Search = Item',
        'enum State { READY }',
        'input Filter { term: String }',
        'directive @auth on FIELD_DEFINITION',
        'query ListItems { items { id } }',
        'mutation CreateItem { createItem { id } }',
        'subscription Events { events { id } }',
        'fragment ItemFields on Item { id }',
      ].join('\n')
    );
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'schema', name: 'schema', extended: false }),
        expect.objectContaining({ kind: 'type', name: 'Query', extended: true }),
        expect.objectContaining({ kind: 'query', name: 'ListItems' }),
        expect.objectContaining({ kind: 'fragment', name: 'ItemFields' }),
      ])
    );

    const provider = createGraphqlContractsProvider();
    expect(provider.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    expect(provider.detect({ availableInputs: ['schema.gql'], scopeKind: 'project' }).status).toBe(
      'applicable'
    );
    const batch = await collect(
      provider,
      {
        'schema.gql': [
          'type Query { items: [Item!]! }',
          'type Item { id: ID! }',
          'query ListItems { items { id } }',
          'extend type Query { extra: String }',
        ].join('\n'),
        'broken.graphql': 'query Broken { value }',
      },
      new Set(['broken.graphql'])
    );
    expect(batch.status).toBe('partial');
    expect(batch.facts.some((fact) => fact.factType === 'contract.graphql-operation')).toBe(true);
    expect(predicates(batch)).toEqual(expect.arrayContaining(['contains', 'exposes', 'consumes']));
    expect(batch.unknownZones).toEqual([
      expect.objectContaining({ code: 'graph.graphql-unreadable', scope: 'broken.graphql' }),
    ]);
  });

  it('covers OpenAPI, Swagger, AsyncAPI, schema references and invalid documents', async () => {
    expect(
      openApiOperationIds(
        JSON.stringify({
          swagger: '2.0',
          paths: {
            '/items': {
              parameters: [],
              get: { operationId: 'listItems' },
              post: { operationId: 'createItem' },
            },
            '/ignored': 'not-an-object',
          },
        }),
        'swagger.json'
      )
    ).toEqual(['createItem', 'listItems']);
    expect(openApiOperationIds('title: unrelated\n', 'openapi.yaml')).toEqual([]);

    const provider = createOpenApiContractsProvider();
    expect(provider.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    const batch = await collect(provider, {
      'openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Catalog' },
        components: { schemas: { Item: { type: 'object' } } },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              responses: { 200: { $ref: '#/components/schemas/Item' } },
            },
            parameters: [],
          },
        },
        channels: { 'item.created': {} },
      }),
      'swagger.yaml': [
        'swagger: "2.0"',
        'info: { title: Legacy }',
        'definitions:',
        '  LegacyItem: { type: object }',
        'paths: {}',
      ].join('\n'),
      'openapi.empty.yaml': 'info: { title: Missing marker }\n',
      'openapi.bad.yaml': 'openapi: [\n',
    });
    expect(batch.status).toBe('partial');
    expect(predicates(batch)).toEqual(
      expect.arrayContaining(['contains', 'exposes', 'declares', 'depends-on'])
    );
    expect(batch.facts.some((fact) => fact.factType === 'contract.asyncapi-event')).toBe(true);
    expect(batch.unknownZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'graph.openapi-document-unrecognized' }),
        expect.objectContaining({ code: 'graph.openapi-unreadable' }),
      ])
    );
  });

  it('extracts CI variants and keeps malformed workflows partial', async () => {
    const provider = createCiWorkflowProvider();
    expect(provider.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    const batch = await collect(provider, {
      Jenkinsfile: 'stage(\'Build\')\nstage("Test")\n',
      'prow/verify.sh': '#!/bin/sh\n',
      '.gitlab-ci.yml': [
        'stages: [build]',
        'variables: { CI: "true" }',
        '.template: {}',
        'build: { script: echo build }',
        'deploy: { script: echo deploy }',
      ].join('\n'),
      '.github/workflows/ci.yml': [
        'jobs: { test: {} }',
        'workflows:',
        '  jobs: { release: {} }',
        'stages: [package]',
      ].join('\n'),
      '.circleci/empty.yml': '{}\n',
      '.drone.yml': 'stages: deploy\n',
      '.travis.yml': 'stages:\n  build: {}\n',
      '.buildkite/bad.yml': 'jobs: [\n',
    });
    expect(batch.status).toBe('partial');
    expect(objectIds(batch)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Jenkinsfile#Build'),
        expect.stringContaining('prow/verify.sh#verify'),
        expect.stringContaining('.gitlab-ci.yml#deploy'),
        expect.stringContaining('.github/workflows/ci.yml#release'),
        expect.stringContaining('.circleci/empty.yml#pipeline'),
        expect.stringContaining('.drone.yml#deploy'),
        expect.stringContaining('.travis.yml#build'),
      ])
    );
    expect(batch.unknownZones).toEqual([
      expect.objectContaining({ code: 'graph.ci-workflow-unreadable' }),
    ]);
  });

  it('extracts Docker, Terraform and Helm variants while exposing invalid IaC', async () => {
    const provider = createInfrastructureAsCodeProvider();
    expect(provider.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    const batch = await collect(provider, {
      Dockerfile: 'FROM node:24 AS builder\nFROM nginx:stable\n',
      'infra.tf': [
        'resource "aws_db_instance" "primary" {}',
        'resource "aws_sqs_queue" "events" {}',
        'resource "aws_ecs_service" "api" {}',
      ].join('\n'),
      'Chart.yaml': 'name: checkout\napiVersion: v2\n',
      'bad/Chart.yaml': 'name: [\n',
    });
    expect(batch.status).toBe('partial');
    expect(predicates(batch)).toEqual(
      expect.arrayContaining(['deployed-as', 'requires', 'declares'])
    );
    expect(objectIds(batch)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('database:terraform/aws_db_instance/primary'),
        expect.stringContaining('queue:terraform/aws_sqs_queue/events'),
        expect.stringContaining('deployment:terraform/aws_ecs_service/api'),
        expect.stringContaining('deployment:helm/checkout'),
      ])
    );
    expect(batch.unknownZones).toEqual([
      expect.objectContaining({ code: 'graph.infrastructure-unreadable' }),
    ]);
  });

  it('classifies Kubernetes workloads, services, namespaces and malformed input', async () => {
    const provider = createKubernetesTopologyProvider();
    expect(provider.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    const batch = await collect(provider, {
      'k8s/resources.yaml': [
        'apiVersion: apps/v1',
        'kind: StatefulSet',
        'metadata: { name: database, namespace: prod }',
        '---',
        'apiVersion: v1',
        'kind: Service',
        'metadata: { name: database }',
        '---',
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata: { name: settings }',
        '---',
        'metadata: { name: incomplete }',
      ].join('\n'),
      'k8s/bad.yaml': 'apiVersion: [\n',
    });
    expect(batch.status).toBe('partial');
    expect(predicates(batch)).toEqual(
      expect.arrayContaining(['deployed-as', 'contains', 'runs-on'])
    );
    expect(objectIds(batch)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('deployment:StatefulSet/prod/database'),
        expect.stringContaining('service:Service/default/database'),
        expect.stringContaining('environment:ConfigMap/default/settings'),
      ])
    );
    expect(batch.unknownZones).toEqual([
      expect.objectContaining({ code: 'graph.kubernetes-unreadable' }),
    ]);
    expect(batch.coverage).toEqual([
      expect.objectContaining({ dimension: 'kubernetes-documents', observed: 1, expected: 2 }),
    ]);
  });

  it('admits architecture decisions and documentation surfaces while keeping unreadable files partial', async () => {
    expect(stripComments('const value = 1; /* hidden */\n// comment\nconst next = 2;\n')).toBe(
      'const value = 1; \n\nconst next = 2;\n'
    );
    const decisions = createArchitectureDecisionsProvider();
    expect(decisions.detect({ availableInputs: ['README.md'], scopeKind: 'project' }).status).toBe(
      'not-applicable'
    );
    const decisionBatch = await collect(
      decisions,
      {
        'adr/0001-catalog.md': '# Use a catalog service\n',
        'docs/ADR-0002.md': '# Reject guessed edges\n',
      },
      new Set(['docs/ADR-0002.md'])
    );
    expect(decisionBatch.status).toBe('partial');
    expect(decisionBatch.facts.some((fact) => fact.predicate === 'decided-by')).toBe(true);
    expect(decisionBatch.unknownZones).toEqual([
      expect.objectContaining({
        code: 'graph.architecture-decision-unreadable',
        scope: 'docs/ADR-0002.md',
      }),
    ]);

    const documents = createDocumentationSurfacesProvider();
    expect(
      documents.detect({ availableInputs: ['src/index.ts'], scopeKind: 'project' }).status
    ).toBe('not-applicable');
    const documentBatch = await collect(
      documents,
      {
        'README.md': '# Catalog\n',
        'ARCHITECTURE.md': '# Architecture\n',
        'CONTRIBUTING.md': '# Contributing\n',
        'SECURITY.md': '# Security\n',
      },
      new Set(['SECURITY.md'])
    );
    expect(documentBatch.status).toBe('partial');
    expect(documentBatch.facts).toHaveLength(3);
    expect(documentBatch.unknownZones).toEqual([
      expect.objectContaining({
        code: 'graph.documentation-unreadable',
        scope: 'SECURITY.md',
      }),
    ]);
  });
});
