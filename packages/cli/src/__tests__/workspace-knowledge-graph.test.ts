import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertWorkspaceKnowledgeGraphSourceBinding,
  buildWorkspaceKnowledgeGraph,
} from '../workspace-knowledge-graph.js';
import {
  queryKnowledgeEntities,
  queryKnowledgeEvidence,
  queryKnowledgePath,
  searchKnowledgeGraph,
} from '../workspace-knowledge-graph-query.js';
import type { WorkspaceDependencyGraph } from '../contracts/workspace-dependency-graph-contract.js';
import { buildWorkspaceKnowledgeGraphChangeOverlay } from '../workspace-knowledge-graph-change-overlay.js';
import { buildWorkspaceGraphTokenEfficiencyReport } from '../workspace-graph-token-efficiency.js';
import type { WorkspaceContract } from '../utils/workspace-contract.js';
import { buildWorkspaceModel } from '../workspace-model.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';

const NOW = new Date('2026-07-21T12:00:00.000Z');

describe('workspace knowledge graph', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (directory) await fsExtra.remove(directory);
    }
  });

  async function fixture(): Promise<string> {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-knowledge-'));
    tempDirs.push(root);
    await fsExtra.outputJson(path.join(root, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'platform' },
      projects: [],
    });
    await fsExtra.outputJson(path.join(root, 'api', '.workspai', 'project.json'), {
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.outputJson(path.join(root, 'api', 'package.json'), {
      name: '@platform/api',
      version: '1.0.0',
      dependencies: { '@nestjs/core': '^11.0.0' },
    });
    await fsExtra.outputFile(
      path.join(root, 'api', '.env.example'),
      'DATABASE_URL=postgres://user:secret@db/app\nJWT_SECRET=never-export-this\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'test', 'health.spec.ts'),
      'test("ok",()=>{});\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'src', 'health.controller.ts'),
      "import { Controller, Get } from '@nestjs/common';\nimport { healthValue } from './health.service';\nexport class HealthController {\n  @Get('/health')\n  health() { return healthValue; }\n}\n"
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'src', 'health.service.ts'),
      "export const healthValue = 'ok';\n"
    );
    await fsExtra.outputFile(
      path.join(root, 'api', '.rapidkit', 'vendor', 'generated.controller.ts'),
      "export class GeneratedController { @Get('/generated-copy') copy() {} }\n"
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'openapi.yaml'),
      [
        'openapi: 3.1.0',
        'info:',
        '  title: Platform API',
        '  version: 1.0.0',
        'paths:',
        '  /users:',
        '    get:',
        '      operationId: listUsers',
        '      tags: [users]',
        '      responses:',
        "        '200':",
        '          content:',
        '            application/json:',
        '              schema:',
        "                $ref: '#/components/schemas/User'",
        'components:',
        '  schemas:',
        '    User:',
        '      type: object',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'k8s', 'deployment.yaml'),
      [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: api',
        '  namespace: production',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'docs', 'adr', 'ADR-0001-database.md'),
      '# Use PostgreSQL\n\nStatus: accepted\n'
    );
    await fsExtra.outputFile(path.join(root, 'api', 'README.md'), '# Platform API\n');
    await fsExtra.outputFile(
      path.join(root, 'api', 'schema.graphql'),
      'type Query { health: String! }\ntype User { id: ID! }\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'service.proto'),
      'syntax = "proto3";\nservice Users { rpc List (User) returns (User); }\nmessage User { string id = 1; }\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'asyncapi.yaml'),
      'asyncapi: 3.0.0\ninfo:\n  title: Platform Events\nchannels:\n  user.created: {}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'Dockerfile'),
      'FROM node:22-alpine AS runtime\nCMD ["node", "dist/main.js"]\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'infra', 'main.tf'),
      'resource "aws_sqs_queue" "events" { name = "events" }\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'platform.tf'),
      'resource "aws_rds_cluster" "primary" { engine = "postgresql" }\n'
    );

    await fsExtra.outputJson(path.join(root, 'web', '.workspai', 'project.json'), {
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.outputFile(
      path.join(root, 'web', 'pyproject.toml'),
      '[project]\nname = "platform-web"\nversion = "2.0.0"\ndependencies = ["fastapi"]\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'docker-compose.yml'),
      [
        'services:',
        '  api:',
        '    image: platform/api:latest',
        '    environment:',
        '      - API_TOKEN=compose-secret-must-not-leak',
        '    depends_on:',
        '      - db',
        '  db:',
        '    image: postgres:17',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    );
    await fsExtra.outputFile(
      path.join(root, '.github', 'CODEOWNERS'),
      'api/** @platform/backend\n'
    );
    await fsExtra.outputFile(
      path.join(
        root,
        '.venv.broken',
        'lib',
        'python3.12',
        'site-packages',
        'private_recovery_package.py'
      ),
      'RECOVERY_ENVIRONMENT_SECRET = "must-never-enter-the-graph"\n'
    );
    return root;
  }

  function topology(): WorkspaceDependencyGraph {
    return {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: NOW.toISOString(),
      nodes: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      edges: [
        {
          from: 'web',
          to: 'api',
          kind: 'service-dependsOn',
          source: 'contract',
          confidence: 'high',
          evidence: [
            {
              file: '.workspai/workspace.contract.json',
              detail: 'web dependsOn api',
            },
          ],
        },
      ],
      stats: {
        nodeCount: 2,
        edgeCount: 1,
        inferredEdges: 0,
        contractEdges: 1,
        manualEdges: 0,
        authoritativeEdges: 1,
        lowConfidenceEdges: 0,
        orphanCount: 0,
        connectedNodeCount: 2,
        density: 0.5,
        edgeCoverageRatio: 1,
        evidenceCoverageRatio: 1,
        hotspotCount: 0,
        hasCycle: false,
      },
    };
  }

  function modelSource() {
    return {
      kind: 'workspace-model',
      artifact: '.workspai/reports/workspace-model.json',
      hashAlgorithm: 'sha256',
      hash: 'a'.repeat(64),
    } as const;
  }

  function contract(): WorkspaceContract {
    return {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: NOW.toISOString(),
      workspace: { name: 'platform', profile: 'enterprise' },
      projects: [
        {
          slug: 'api',
          relativePath: 'api',
          runtime: 'node',
          framework: 'nestjs',
          modules: [],
          ports: [{ name: 'http', port: 3000, protocol: 'http' }],
          contracts: {
            owns: ['users'],
            apis: [{ name: 'Contract API', basePath: '/api' }],
            publishes: ['user.created'],
            consumes: [],
            dependsOn: [],
            env: ['DATABASE_URL'],
          },
        },
        {
          slug: 'web',
          relativePath: 'web',
          runtime: 'python',
          framework: 'fastapi',
          modules: [],
          ports: [{ name: 'http', port: 8000, protocol: 'http' }],
          contracts: {
            owns: [],
            apis: [],
            publishes: [],
            consumes: ['user.created'],
            dependsOn: ['api'],
            env: [],
          },
        },
      ],
    };
  }

  it('binds identity, structural hash, and project topology to the canonical model', async () => {
    const root = await fixture();
    const model = await buildWorkspaceModel({ workspacePath: root, now: NOW });
    expect(model.graph).toBeDefined();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: {
        name: model.workspace.name,
        ...(model.workspace.profile ? { profile: model.workspace.profile } : {}),
      },
      projects: model.projects.map((project) => ({
        id: project.name,
        path: project.path,
        runtime: project.runtime,
        framework: project.framework,
      })),
      projectTopology: model.graph!,
      contract: contract(),
      now: NOW,
      source: {
        kind: 'workspace-model',
        artifact: '.workspai/reports/workspace-model.json',
        hashAlgorithm: 'sha256',
        hash: hashWorkspaceModel(model),
      },
    });

    expect(() => assertWorkspaceKnowledgeGraphSourceBinding(graph, model)).not.toThrow();

    const mismatchedTopology = structuredClone(graph);
    mismatchedTopology.projectTopology.nodes = mismatchedTopology.projectTopology.nodes.slice(1);
    expect(() => assertWorkspaceKnowledgeGraphSourceBinding(mismatchedTopology, model)).toThrow(
      'project topology does not match'
    );

    const mismatchedIdentity = structuredClone(graph);
    mismatchedIdentity.workspace.name = 'different-workspace';
    expect(() => assertWorkspaceKnowledgeGraphSourceBinding(mismatchedIdentity, model)).toThrow(
      'identity does not match'
    );
  });

  it('returns bounded proof-carrying search context without emitting the whole graph', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    const result = searchKnowledgeGraph(graph, { query: 'health endpoint', limit: 2 });

    expect(result.schemaVersion).toBe('workspace-knowledge-search.v1');
    expect(result.entities.length).toBeLessThanOrEqual(2);
    expect(result.entities.some((entity) => /health/i.test(entity.label))).toBe(true);
    expect(result.proofs.length).toBeGreaterThan(0);
    expect(JSON.stringify(result).length).toBeLessThan(JSON.stringify(graph).length);
  });

  it('weights meaningful rare terms above natural-language stopwords', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    for (let index = 0; index < 40; index += 1) {
      graph.entities.push({
        id: `synthetic-check-${index}`,
        kind: 'symbol',
        label: `check-windows-${index}`,
        identity: {
          key: `symbol:check-windows-${index}`,
          scope: 'workspace',
          aliases: [],
          fingerprint: `check-${index}`,
        },
        attributes: {},
        proofIds: [],
      });
    }
    graph.entities.push({
      id: 'synthetic-user-authentication',
      kind: 'symbol',
      label: 'User authentication',
      identity: {
        key: 'symbol:user-authentication',
        scope: 'workspace',
        aliases: ['authenticate user'],
        fingerprint: 'user-authentication',
      },
      attributes: {},
      proofIds: [],
    });

    const result = searchKnowledgeGraph(graph, {
      query: 'how do we check who a user is',
      limit: 5,
    });

    expect(result.entities[0]?.label).toMatch(/user/i);
    expect(
      result.entities.filter((entity) => entity.label.startsWith('check-windows')).length
    ).toBe(0);
  });

  it('reconciles copied protobuf contracts into one proof-carrying semantic identity', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-protobuf-identity-'));
    tempDirs.push(root);
    const protobuf =
      'syntax = "proto3";\npackage shop.v1;\nservice CheckoutService {}\nmessage CheckoutRequest {}\n';
    for (const project of ['checkout', 'frontend']) {
      await fsExtra.outputJson(path.join(root, project, '.workspai', 'project.json'), {
        runtime: 'go',
      });
      await fsExtra.outputFile(path.join(root, project, 'checkout.proto'), protobuf);
    }
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'shop' },
      projects: [
        { id: 'checkout', path: 'checkout', runtime: 'go' },
        { id: 'frontend', path: 'frontend', runtime: 'go' },
      ],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });

    const services = graph.entities.filter((entity) => entity.label === 'CheckoutService');
    expect(services).toHaveLength(1);
    expect(services[0].proofIds).toHaveLength(2);
    expect(
      graph.relations.filter(
        (relation) => relation.kind === 'exposes' && relation.to === services[0].id
      )
    ).toHaveLength(2);
    expect(
      searchKnowledgeGraph(graph, { query: 'checkout service', kind: 'api' }).entities[0]?.id
    ).toBe(services[0].id);
  });

  it('distinguishes non-applicable providers from applicable providers with empty output', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-provider-quality-'));
    tempDirs.push(root);
    await fsExtra.outputFile(path.join(root, '.github', 'CODEOWNERS'), '# no owners declared\n');
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'empty' },
      projects: [],
      projectTopology: {
        schemaVersion: 'workspace-dependency-graph.v1',
        generatedAt: NOW.toISOString(),
        nodes: [],
        edges: [],
        stats: {
          nodeCount: 0,
          edgeCount: 0,
          inferredEdges: 0,
          contractEdges: 0,
          manualEdges: 0,
          authoritativeEdges: 0,
          lowConfidenceEdges: 0,
          orphanCount: 0,
          connectedNodeCount: 0,
          density: 0,
          edgeCoverageRatio: 1,
          evidenceCoverageRatio: 1,
          hotspotCount: 0,
          hasCycle: false,
        },
      },
      now: NOW,
      source: modelSource(),
    });

    expect(graph.providers.find((provider) => provider.id === 'codeowners')).toMatchObject({
      status: 'partial',
      discoveredEntities: 0,
      discoveredRelations: 0,
      proofCount: 0,
    });
    expect(graph.providers.find((provider) => provider.id === 'openapi')?.status).toBe('skipped');
    expect(graph.quality.providerSuccessRatio).toBe(1);
    expect(graph.quality.unknownCount).toBeGreaterThanOrEqual(1);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'graph.provider.codeowners.empty_result'
    );
  });

  it('discovers Kubernetes manifests by content outside conventional directory names', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-kubernetes-content-'));
    tempDirs.push(root);
    await fsExtra.outputJson(path.join(root, 'api', '.workspai', 'project.json'), {
      runtime: 'go',
    });
    await fsExtra.outputFile(
      path.join(root, 'release', 'all-resources.yaml'),
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: checkout\n  namespace: shop\n'
    );
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'shop' },
      projects: [{ id: 'api', path: 'api', runtime: 'go' }],
      projectTopology: {
        ...topology(),
        nodes: [{ id: 'api', path: 'api', runtime: 'go' }],
        edges: [],
        stats: { ...topology().stats, nodeCount: 1, edgeCount: 0, orphanCount: 1 },
      },
      now: NOW,
      source: modelSource(),
    });

    expect(graph.providers.find((provider) => provider.id === 'kubernetes')).toMatchObject({
      status: 'passed',
      discoveredEntities: 2,
      discoveredRelations: 2,
    });
    expect(graph.entities.some((entity) => entity.label === 'Deployment/checkout')).toBe(true);
  });

  it('runs CI, infrastructure, and ownership providers against adopted external projects', async () => {
    const workspaceRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-external-workspace-')
    );
    const externalRoot = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-external-project-')
    );
    tempDirs.push(workspaceRoot, externalRoot);
    await fsExtra.outputFile(
      path.join(externalRoot, '.github', 'workflows', 'ci.yml'),
      'name: External CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    );
    await fsExtra.outputFile(
      path.join(externalRoot, '.github', 'CODEOWNERS'),
      '* @platform/external\n'
    );
    await fsExtra.outputFile(
      path.join(externalRoot, 'terraform', 'main.tf'),
      'resource "google_container_cluster" "primary" {}\n'
    );
    await fsExtra.outputFile(
      path.join(externalRoot, 'helm-chart', 'Chart.yaml'),
      'apiVersion: v2\nname: external\nversion: 1.0.0\n'
    );

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: workspaceRoot,
      workspace: { name: 'platform' },
      projects: [
        {
          id: 'external',
          path: 'external',
          absolutePath: externalRoot,
          runtime: 'node',
        },
      ],
      projectTopology: {
        ...topology(),
        nodes: [{ id: 'external', path: 'external', runtime: 'node' }],
        edges: [],
        stats: { ...topology().stats, nodeCount: 1, edgeCount: 0, orphanCount: 1 },
      },
      now: NOW,
      source: modelSource(),
    });

    for (const providerId of ['ci-workflow', 'codeowners', 'infrastructure-as-code']) {
      expect(graph.providers.find((provider) => provider.id === providerId)?.status).toBe('passed');
    }
    expect(graph.entities.some((entity) => entity.kind === 'pipeline')).toBe(true);
    expect(graph.entities.some((entity) => entity.kind === 'owner')).toBe(true);
    expect(
      graph.entities.some(
        (entity) =>
          entity.kind === 'deployment' &&
          (entity.label === 'google_container_cluster.primary' ||
            entity.label === 'external Helm chart')
      )
    ).toBe(true);
    expect(
      graph.proofs.some((proof) =>
        proof.artifact.startsWith('external/external/.github/workflows/')
      )
    ).toBe(true);
  });

  it('reports reproducible retrieval-payload savings without claiming model billing savings', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    const report = await buildWorkspaceGraphTokenEfficiencyReport({
      workspacePath: root,
      graph,
      query: 'health endpoint',
      limit: 1,
      now: NOW,
    });

    expect(report).toMatchObject({
      schemaVersion: 'workspace-graph-token-efficiency.v1',
      generatedAt: NOW.toISOString(),
      methodology: {
        id: 'indexed-corpus-vs-bounded-retrieval.v1',
        estimated: true,
        charsPerToken: 4,
      },
      retrieval: { matchCount: 1 },
    });
    expect(report.corpus.artifactCount).toBeGreaterThan(0);
    expect(report.corpus.characterCount).toBeGreaterThan(report.retrieval.characterCount);
    expect(report.savings.reductionPercent).toBeGreaterThan(0);
    expect(report.methodology.claimBoundary).toMatch(/does not claim.*billing savings/i);
  });

  it('builds a portable polyglot entity graph with proof-carrying relations', async () => {
    const workspacePath = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath,
      workspace: { name: 'platform', profile: 'enterprise' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    expect(graph.schemaVersion).toBe('workspace-knowledge-graph.v1');
    expect(graph.generatedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(graph)).not.toContain('.venv.broken');
    expect(JSON.stringify(graph)).not.toContain('private_recovery_package');
    expect(graph.providers.map((provider) => provider.id)).toEqual([
      'architecture-decisions',
      'ci-workflow',
      'codeowners',
      'compose',
      'documentation',
      'infrastructure-as-code',
      'interface-contracts',
      'kubernetes',
      'openapi',
      'source-structure',
      'workspace-foundation',
      'workspace-service-contract',
    ]);
    expect(new Set(graph.entities.map((entity) => entity.kind))).toEqual(
      new Set([
        'workspace',
        'project',
        'package',
        'module',
        'file',
        'symbol',
        'environment',
        'test-suite',
        'api',
        'endpoint',
        'schema',
        'service',
        'container',
        'database',
        'queue',
        'deployment',
        'pipeline',
        'owner',
        'document',
        'decision',
      ])
    );
    expect(graph.relations.some((relation) => relation.kind === 'depends-on')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'exposes')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'references')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'deploys')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'owns')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'publishes')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'consumes')).toBe(true);
    expect(graph.providers.every((provider) => provider.discoveredEntities > 0)).toBe(true);
    expect(graph.quality).toMatchObject({
      portable: true,
      secretValuesEmitted: false,
      entityProofCoverageRatio: 1,
      relationProofCoverageRatio: 1,
      providerSuccessRatio: 1,
      bindingCoverage: {
        apiImplementation: {
          eligibleCount: 2,
          boundCount: 0,
          unknownCount: 2,
          coverageRatio: 0,
        },
        projectTests: {
          eligibleCount: 2,
          boundCount: 1,
          unknownCount: 1,
          coverageRatio: 0.5,
        },
      },
    });
    const localImport = graph.relations.find((relation) => {
      if (relation.kind !== 'imports') return false;
      const target = graph.entities.find((entity) => entity.id === relation.to);
      return target?.kind === 'file' && target.label === 'api/src/health.service.ts';
    });
    expect(localImport).toMatchObject({ confidence: 'high' });
    expect(
      graph.entities.some(
        (entity) =>
          entity.kind === 'module' &&
          entity.attributes.specifier === './health.service' &&
          entity.attributes.resolution === 'unresolved-local'
      )
    ).toBe(false);
    expect(graph.proofs.every((proof) => !path.isAbsolute(proof.artifact))).toBe(true);
    expect(JSON.stringify(graph)).not.toContain('never-export-this');
    expect(JSON.stringify(graph)).not.toContain('postgres://user:secret');
    expect(JSON.stringify(graph)).not.toContain('compose-secret-must-not-leak');
    expect(JSON.stringify(graph)).toContain('API_TOKEN');
    expect(graph.proofs.some((proof) => proof.artifact.includes('.rapidkit/vendor'))).toBe(false);
    expect(graph.entities.some((entity) => entity.label.includes('generated-copy'))).toBe(false);

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const dependencySchema = await fsExtra.readJson(
      path.resolve('contracts/workspace-intelligence/workspace-dependency-graph.v1.json')
    );
    const knowledgeSchema = await fsExtra.readJson(
      path.resolve('contracts/workspace-intelligence/workspace-knowledge-graph.v1.json')
    );
    ajv.addSchema(dependencySchema);
    const validate = ajv.compile(knowledgeSchema);
    expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
  });

  it('creates a deterministic, proof-aware change overlay with bounded impact', async () => {
    const workspacePath = await fixture();
    const base = await buildWorkspaceKnowledgeGraph({
      workspacePath,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    const openApiPath = path.join(workspacePath, 'api', 'openapi.yaml');
    const openApi = await fsExtra.readFile(openApiPath, 'utf8');
    await fsExtra.outputFile(
      openApiPath,
      openApi.replace(
        'components:',
        '  /health:\n    get:\n      operationId: health\n      responses: {}\ncomponents:'
      )
    );
    const head = await buildWorkspaceKnowledgeGraph({
      workspacePath,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: new Date('2026-07-21T12:01:00.000Z'),
      source: modelSource(),
    });
    const overlay = buildWorkspaceKnowledgeGraphChangeOverlay(base, head, NOW);

    expect(overlay.schemaVersion).toBe('workspace-knowledge-graph-change-overlay.v1');
    expect(overlay.entities.added.map((entity) => entity.label)).toContain('GET /health');
    expect(overlay.changedArtifacts).toContain('api/openapi.yaml');
    expect(overlay.summary).toMatchObject({
      entityAdds: 1,
      relationAdds: 2,
      risk: 'medium',
    });
    expect(overlay.summary.proofChanges).toBeGreaterThan(0);
    expect(
      overlay.proofs.changed.some((change) => change.changedFields.includes('contentHash'))
    ).toBe(true);
    expect(
      overlay.relations.added.some(
        (relation) => relation.kind === 'implements' && relation.trust === 'corroborated'
      )
    ).toBe(true);
    expect(overlay.impactedEntityIds.length).toBeGreaterThanOrEqual(2);

    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addSchema(
      await fsExtra.readJson(
        path.resolve('contracts/workspace-intelligence/workspace-dependency-graph.v1.json')
      )
    );
    ajv.addSchema(
      await fsExtra.readJson(
        path.resolve('contracts/workspace-intelligence/workspace-knowledge-graph.v1.json')
      )
    );
    const validate = ajv.compile(
      await fsExtra.readJson(
        path.resolve(
          'contracts/workspace-intelligence/workspace-knowledge-graph-change-overlay.v1.json'
        )
      )
    );
    expect(validate(overlay), JSON.stringify(validate.errors)).toBe(true);
  });

  it('supports entity, evidence and shortest proof-path queries', async () => {
    const workspacePath = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath,
      workspace: { name: 'platform' },
      projects: [
        { id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' },
        { id: 'web', path: 'web', runtime: 'python', framework: 'fastapi' },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    expect(queryKnowledgeEntities(graph, 'endpoint').map((entity) => entity.label)).toEqual([
      'GET /health',
      'GET /users',
    ]);
    const evidence = queryKnowledgeEvidence(graph, 'GET /users');
    expect(evidence.found).toBe(true);
    expect(evidence.proofs[0]).toMatchObject({
      provider: 'openapi',
      artifact: 'api/openapi.yaml',
      pointer: '/paths/~1users/get',
      trust: 'authoritative',
    });
    const webProject = graph.entities.find(
      (entity) => entity.kind === 'project' && entity.projectId === 'web'
    );
    expect(webProject).toBeDefined();
    const pathResult = queryKnowledgePath(graph, webProject?.id ?? '', 'GET /users');
    expect(pathResult.found).toBe(true);
    expect(pathResult.hops.map((hop) => hop.kind)).toEqual(['depends-on', 'exposes', 'contains']);
    expect(pathResult.proofs.length).toBeGreaterThanOrEqual(3);
  });
});
