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
      'router.get(\'/fixture-only\', () => {});\ntest("ok",()=>{});\n'
    );
    await fsExtra.outputJson(path.join(root, 'api', 'test', 'fixtures', 'package.json'), {
      name: '@fixture/not-production',
      dependencies: { 'fixture-only-module': '1.0.0' },
    });
    await fsExtra.outputFile(
      path.join(root, 'api', '.vscode-test', 'extensions', 'fake', 'fake.ts'),
      "router.get('/generated-only', () => {});\n"
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'graphify-out', 'generated.ts'),
      "router.get('/graph-generated-only', () => {});\n"
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

  it('keeps generated test hosts and fixture code out of production architecture surfaces', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [{ id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' }],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    expect(graph.entities.some((entity) => /fixture-only|generated-only/.test(entity.label))).toBe(
      false
    );
    expect(graph.entities.some((entity) => entity.label === '@fixture/not-production')).toBe(false);
    expect(
      graph.entities.some(
        (entity) =>
          entity.kind === 'file' && String(entity.attributes.artifact).includes('.vscode-test')
      )
    ).toBe(false);
    expect(JSON.stringify(graph)).not.toContain('graph-generated-only');
    expect(graph.entities.some((entity) => entity.kind === 'test-suite')).toBe(true);
  });

  it('maps adopted projects outside the workspace to stable portable artifact identities', async () => {
    const workspacePath = await fixture();
    const externalProject = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-external-project-')
    );
    tempDirs.push(externalProject);
    await fsExtra.outputJson(path.join(externalProject, 'package.json'), {
      name: '@platform/external-api',
    });
    await fsExtra.outputFile(
      path.join(externalProject, 'src', 'server.ts'),
      "router.get('/external-health', () => {});\n"
    );
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath,
      workspace: { name: 'platform' },
      projects: [
        {
          id: 'external-api',
          path: path.relative(workspacePath, externalProject),
          runtime: 'node',
        },
      ],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });

    const artifacts = graph.proofs.map((proof) => proof.artifact);
    expect(artifacts.some((artifact) => artifact.startsWith('external/external-api/'))).toBe(true);
    expect(artifacts.every((artifact) => !artifact.split('/').includes('..'))).toBe(true);
    expect(JSON.stringify(graph)).not.toContain(externalProject);
  });

  it('models VS Code extension contributions as proof-backed semantic surfaces', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-vscode-extension-'));
    tempDirs.push(root);
    await fsExtra.outputJson(path.join(root, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'extensions' },
      projects: [],
    });
    await fsExtra.outputJson(path.join(root, 'extension', 'package.json'), {
      name: 'example-extension',
      main: './dist/extension.js',
      engines: { vscode: '^1.106.0' },
      contributes: {
        commands: [
          { command: 'example.openDashboard', title: 'Open Dashboard', category: 'Example' },
          { command: 'example.runDoctor', title: 'Run Doctor', category: 'Example' },
        ],
        viewsContainers: {
          activitybar: [{ id: 'example-container', title: 'Example' }],
        },
        views: {
          'example-container': [{ id: 'example-dashboard', name: 'Dashboard', type: 'webview' }],
        },
        configuration: {
          title: 'Example',
          properties: {
            'example.trace.enabled': {
              type: 'boolean',
              description: 'Enable trace evidence.',
            },
          },
        },
        chatParticipants: [{ id: 'example.agent', name: 'example', fullName: 'Example Agent' }],
      },
    });
    await fsExtra.outputJson(path.join(root, 'extension', 'contracts', 'surface.json'), {
      schemaVersion: 'example.v1',
    });
    await fsExtra.outputFile(
      path.join(root, 'extension', 'src', 'extension.ts'),
      "import surface from '../contracts/surface.json';\nexport function activate() { return surface; }\n"
    );

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'extensions' },
      projects: [
        {
          id: 'extension',
          path: 'extension',
          runtime: 'node',
          framework: 'vscode-extension',
        },
      ],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });

    expect(
      graph.providers.find((provider) => provider.id === 'vscode-extension-manifest')
    ).toMatchObject({ status: 'passed' });
    expect(
      graph.entities.filter(
        (entity) => entity.kind === 'api' && entity.attributes.surface === 'vscode-command'
      )
    ).toHaveLength(2);
    expect(graph.entities.find((entity) => entity.label === 'example.openDashboard')).toMatchObject(
      { attributes: { title: 'Open Dashboard', surface: 'vscode-command' } }
    );
    expect(graph.entities.find((entity) => entity.label === 'example-dashboard')).toMatchObject({
      attributes: { surface: 'vscode-webview' },
    });
    expect(graph.entities.find((entity) => entity.label === 'example.trace.enabled')).toMatchObject(
      { kind: 'schema', attributes: { surface: 'vscode-configuration' } }
    );
    expect(graph.entities.find((entity) => entity.label === 'example.agent')).toMatchObject({
      kind: 'api',
      attributes: { surface: 'vscode-chat-participant' },
    });
    expect(
      graph.entities.find((entity) => entity.label.endsWith('contracts/surface.json'))
    ).toMatchObject({ kind: 'file' });
    expect(
      graph.entities.some(
        (entity) =>
          entity.kind === 'module' &&
          entity.attributes.specifier === '../contracts/surface.json' &&
          entity.attributes.resolution === 'unresolved-local'
      )
    ).toBe(false);
  });

  it('models Python console scripts, resolves package imports, and excludes worked examples', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-python-project-'));
    tempDirs.push(root);
    await fsExtra.outputFile(
      path.join(root, 'app', 'pyproject.toml'),
      [
        '[build-system]',
        'build-backend = "setuptools.build_meta"',
        '[project]',
        'name = "sample-app"',
        'version = "1.0.0"',
        'requires-python = ">=3.11"',
        '[project.scripts]',
        'sample = "sample.cli:main"',
        'sample-mcp = "sample.serve:_main"',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'app', 'sample', '__init__.py'),
      'from .worker import run\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'app', 'sample', 'worker.py'),
      '# Express routes (`app.get("/", handler)`) are examples only.\ndef run(): return 1\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'app', 'worked', 'demo.py'),
      'def phantom_worked_symbol(): return 1\n'
    );
    await fsExtra.outputFile(path.join(root, 'app', 'worked', 'README.md'), '# Worked demo\n');
    await fsExtra.outputFile(
      path.join(root, 'app', 'scripts', 'python-template.ts'),
      'const generated = `\\nfrom .._jsonrpc import Client\\n`;\nexport const keep = true;\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'app', 'sample', 'generated', 'client.py'),
      'class GeneratedClient: pass\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'app', 'e2e', 'test_client.py'),
      'def phantom_e2e_symbol(): return 1\n'
    );

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'python' },
      projects: [{ id: 'app', path: 'app', runtime: 'python', framework: 'python' }],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });

    expect(
      graph.providers.find((provider) => provider.id === 'python-project-manifest')
    ).toMatchObject({ status: 'passed', discoveredEntities: 2, discoveredRelations: 2 });
    expect(
      graph.entities.filter(
        (entity) => entity.kind === 'api' && entity.attributes.surface === 'python-console-script'
      )
    ).toHaveLength(2);
    expect(graph.entities.find((entity) => entity.label === 'sample-mcp')).toMatchObject({
      attributes: { entrypoint: 'sample.serve:_main' },
    });
    expect(
      graph.relations.some((relation) => {
        const from = graph.entities.find((entity) => entity.id === relation.from);
        const to = graph.entities.find((entity) => entity.id === relation.to);
        return (
          relation.kind === 'imports' &&
          String(from?.label).endsWith('sample/__init__.py') &&
          String(to?.label).endsWith('sample/worker.py')
        );
      })
    ).toBe(true);
    expect(graph.entities.some((entity) => entity.kind === 'endpoint')).toBe(false);
    expect(JSON.stringify(graph)).not.toContain('phantom_worked_symbol');
    expect(JSON.stringify(graph)).not.toContain('Worked demo');
    expect(JSON.stringify(graph)).not.toContain('phantom_e2e_symbol');
    expect(
      graph.entities.some(
        (entity) => entity.kind === 'module' && entity.attributes.specifier === '.._jsonrpc'
      )
    ).toBe(false);
    expect(
      graph.entities.find((entity) => String(entity.label).endsWith('sample/generated/client.py'))
    ).toMatchObject({ attributes: { language: 'python', generated: true } });
    expect(
      graph.entities.find(
        (entity) => entity.kind === 'test-suite' && entity.attributes.language === 'python'
      )
    ).toMatchObject({ attributes: { fileCount: 1, language: 'python' } });
  });

  it('parses Python, Cargo, and Maven dependencies without manifest metadata pollution', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-polyglot-manifests-'));
    tempDirs.push(root);
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'python', 'pyproject.toml'),
      [
        '[build-system]',
        'requires = ["setuptools>=70"]',
        'build-backend = "setuptools.build_meta"',
        '[project]',
        'name = "python-sdk"',
        'version = "1.0.0"',
        'authors = [{name = "Example"}]',
        'dependencies = ["httpx>=0.24", "pydantic[email]>=2"]',
        '[project.urls]',
        'Homepage = "https://example.test"',
        '[project.optional-dependencies]',
        'telemetry = ["opentelemetry-api>=1"]',
        '[dependency-groups]',
        'dev = ["pytest>=8"]',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'rust', 'Cargo.toml'),
      [
        '[package]',
        'name = "rust-sdk"',
        'version = "1.0.0"',
        'edition = "2024"',
        'rust-version = "1.85"',
        '[dependencies]',
        'tokio = { version = "1" }',
        'serde_json = "1"',
        '[dev-dependencies]',
        'tempfile = "3"',
        '[[test]]',
        'name = "integration"',
        'required-features = ["test-support"]',
        "[target.'cfg(windows)'.dependencies]",
        'windows-sys = "0.59"',
      ].join('\n')
    );
    await fsExtra.outputJson(path.join(root, 'sdk', 'node', 'package.json'), {
      name: '@example/node-sdk',
      version: '1.0.0',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': './dist/index.js', './extension': './dist/extension.js' },
      engines: { node: '>=20' },
      dependencies: { zod: '^4' },
    });
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'go', 'go.mod'),
      'module example.test/go-sdk\n\ngo 1.24\n\nrequire example.test/dependency v1.0.0\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'dotnet', 'DotnetSdk.csproj'),
      '<Project><PropertyGroup><TargetFrameworks>net8.0;net10.0</TargetFrameworks><RootNamespace>Example.SDK</RootNamespace><Version>1.0.0</Version></PropertyGroup></Project>'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'java', 'pom.xml'),
      [
        '<project>',
        '<artifactId>java-sdk</artifactId><version>1.0.0</version>',
        '<dependencies>',
        '<dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></dependency>',
        '<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId></dependency>',
        '</dependencies>',
        '<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build>',
        '</project>',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'node', 'index.ts'),
      'export const createClient = () => ({});\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'go', 'client.go'),
      'package sdk\ntype Client struct{}\nfunc NewClient() *Client { return &Client{} }\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'go', 'test', 'client_test.go'),
      'package sdk\nfunc TestClient(t *testing.T) {}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'rust', 'src', 'lib.rs'),
      'pub struct Client;\npub async fn connect() {}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'java', 'src', 'Client.java'),
      'public class Client {\n  public String send(String value) { return value; }\n}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'dotnet', 'Client.cs'),
      'public class Client {\n  public async Task SendAsync() { await Task.CompletedTask; }\n}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'python', 'generated', 'rpc.py'),
      '# Generated from: api.schema.json\nclass SessionStartEvent: pass\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'go', 'generated', 'rpc.go'),
      '// Code generated by scripts/codegen/go.ts; DO NOT EDIT.\npackage generated\ntype SessionStartEvent struct{}\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'sdk', 'dotnet', 'generated.h'),
      '// This file is autogenerated from:\n// templates/generated.h.in\nstruct GeneratedHeader {};\n'
    );

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'polyglot' },
      projects: [
        {
          id: 'sdk',
          path: 'sdk',
          runtime: 'dotnet',
          runtimeCandidates: ['dotnet', 'go', 'java', 'node', 'python', 'rust'],
          framework: 'dotnet',
        },
      ],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });
    const packages = graph.entities.filter((entity) => entity.kind === 'package');
    expect(
      packages.find((entity) => entity.label === 'python-sdk')?.attributes.dependencies
    ).toEqual(['httpx', 'opentelemetry-api', 'pydantic', 'pytest']);
    expect(JSON.stringify(packages.find((entity) => entity.label === 'python-sdk'))).not.toContain(
      'Homepage'
    );
    expect(packages.find((entity) => entity.label === 'rust-sdk')?.attributes.dependencies).toEqual(
      ['serde_json', 'tempfile', 'tokio', 'windows-sys']
    );
    expect(packages.find((entity) => entity.label === 'rust-sdk')?.attributes).toMatchObject({
      edition: '2024',
      rustVersion: '1.85',
    });
    expect(packages.find((entity) => entity.label === 'java-sdk')?.attributes.dependencies).toEqual(
      ['com.fasterxml.jackson.core:jackson-databind', 'org.junit.jupiter:junit-jupiter']
    );
    expect(
      packages.find((entity) => entity.label === '@example/node-sdk')?.attributes
    ).toMatchObject({
      entrypoints: ['./dist/index.js', './dist/index.d.ts'],
      exports: ['.', './extension'],
      runtimeConstraints: ['node:>=20'],
    });
    expect(
      packages.find((entity) => entity.label === 'example.test/go-sdk')?.attributes
    ).toMatchObject({
      goVersion: '1.24',
    });
    expect(packages.find((entity) => entity.label === 'DotnetSdk')?.attributes).toMatchObject({
      targetFrameworks: ['net8.0', 'net10.0'],
      rootNamespace: 'Example.SDK',
    });
    const symbols = graph.entities
      .filter((entity) => entity.kind === 'symbol')
      .map((entity) => entity.label);
    expect(symbols).toEqual(
      expect.arrayContaining([
        'createClient',
        'Client',
        'NewClient',
        'connect',
        'send',
        'SendAsync',
      ])
    );
    expect(
      graph.entities.find(
        (entity) => entity.kind === 'test-suite' && entity.attributes.language === 'go'
      )
    ).toMatchObject({ attributes: { fileCount: 1, language: 'go' } });
    expect(graph.entities.filter((entity) => entity.kind === 'runtime-unit')).toHaveLength(6);
    expect(
      graph.entities.find(
        (entity) =>
          entity.kind === 'lifecycle-stage' &&
          entity.attributes.runtime === 'rust' &&
          entity.attributes.stage === 'init'
      )
    ).toMatchObject({ attributes: { command: 'cargo fetch', stage: 'init' } });
    expect(graph.entities.find((entity) => entity.kind === 'protocol')).toMatchObject({
      label: 'SessionStartEvent',
      attributes: { languages: ['go', 'python'], implementationCount: 2 },
    });
    expect(
      graph.relations.filter((relation) => relation.kind === 'implements-protocol')
    ).toHaveLength(2);
    expect(graph.relations.some((relation) => relation.kind === 'equivalent-to')).toBe(true);
    expect(graph.relations.some((relation) => relation.kind === 'generated-from')).toBe(true);
    expect(graph.entities.some((entity) => entity.label.length === 0)).toBe(false);
    expect(
      graph.entities.find(
        (entity) =>
          entity.kind === 'schema' &&
          entity.attributes.sourceReference === 'templates/generated.h.in'
      )
    ).toMatchObject({ label: 'generated.h.in' });
  });

  it('models language roles, local Cargo dependencies, and Deno Rust-JS bridges', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-deno-bridge-'));
    tempDirs.push(root);
    await fsExtra.outputFile(
      path.join(root, 'Cargo.toml'),
      [
        '[package]',
        'name = "deno-app"',
        'version = "1.0.0"',
        '[dependencies]',
        'deno_core.workspace = true',
        'serde.workspace = true',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'libs', 'core', 'Cargo.toml'),
      ['[package]', 'name = "deno_core"', 'version = "1.0.0"'].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'libs', 'core', 'src', 'lib.rs'),
      'pub struct JsRuntime;\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'ext', 'cron', 'lib.rs'),
      [
        'deno_core::extension!(deno_cron,',
        '  ops = [op_cron_next],',
        '  lazy_loaded_js = ["01_cron.ts"],',
        ');',
        '#[op2]',
        'fn op_cron_next() -> bool { true }',
      ].join('\n')
    );
    await fsExtra.outputFile(
      path.join(root, 'ext', 'cron', '01_cron.ts'),
      'export const next = () => core.ops.op_cron_next();\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'tests', 'ffi', 'fixture.c'),
      'int fixture(void) { return 1; }\n'
    );
    await fsExtra.outputJson(path.join(root, 'tests', 'specs', 'fixture', 'package.json'), {
      name: 'not-a-runtime-unit',
      scripts: { test: 'false' },
    });

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'deno' },
      projects: [
        {
          id: 'deno',
          path: '.',
          runtime: 'rust',
          runtimeCandidates: ['rust', 'deno', 'node', 'c'],
          framework: 'rust',
        },
      ],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });

    expect(
      graph.entities.find(
        (entity) => entity.kind === 'language' && entity.attributes.language === 'c'
      )
    ).toMatchObject({ attributes: { productionFileCount: 0, testFileCount: 1 } });
    expect(
      graph.relations.filter((relation) => relation.kind === 'uses-language')
    ).not.toHaveLength(0);
    const packages = new Map(
      graph.entities
        .filter((entity) => entity.kind === 'package')
        .map((entity) => [entity.label, entity])
    );
    expect(packages.get('deno-app')?.attributes.dependencies).toEqual(['deno_core', 'serde']);
    expect(
      graph.relations.some(
        (relation) =>
          relation.kind === 'depends-on' &&
          relation.from === packages.get('deno-app')?.id &&
          relation.to === packages.get('deno_core')?.id
      )
    ).toBe(true);
    expect(graph.entities.some((entity) => entity.label === 'deno_core.workspace')).toBe(false);
    const bridge = graph.entities.find(
      (entity) => entity.kind === 'protocol' && entity.label.includes('deno_cron Rust JavaScript')
    );
    const operation = graph.entities.find(
      (entity) => entity.kind === 'symbol' && entity.label === 'op_cron_next'
    );
    const script = graph.entities.find(
      (entity) => entity.kind === 'file' && entity.label.endsWith('ext/cron/01_cron.ts')
    );
    expect(bridge).toMatchObject({
      attributes: { mechanism: 'deno_core::extension!' },
    });
    expect(
      graph.relations.some(
        (relation) =>
          relation.kind === 'calls' && relation.from === script?.id && relation.to === operation?.id
      )
    ).toBe(true);
    expect(
      graph.entities.some(
        (entity) =>
          entity.kind === 'runtime-unit' &&
          String(entity.attributes.manifest).includes('not-a-runtime-unit')
      )
    ).toBe(false);
    const architectureSearch = searchKnowledgeGraph(graph, {
      query: 'language binding core dependency',
      projectId: 'deno',
      limit: 5,
    });
    expect(architectureSearch.entities.map((entity) => entity.kind)).toEqual(
      expect.arrayContaining(['language', 'package', 'protocol'])
    );
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

  it('diversifies broad operational architecture searches across consumer surfaces', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [{ id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' }],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    for (const [id, kind, label] of [
      ['synthetic-owner', 'owner', 'API ownership'],
      ['synthetic-pipeline', 'pipeline', 'API CI workflow'],
    ] as const) {
      graph.entities.push({
        id,
        kind,
        label,
        projectId: 'api',
        identity: {
          key: `${kind}:api:${id}`,
          scope: 'project',
          aliases: [],
          fingerprint: id,
        },
        attributes: {},
        proofIds: [],
      });
    }

    const result = searchKnowledgeGraph(graph, {
      query: 'ownership CI deployment documentation',
      projectId: 'api',
      limit: 12,
    });

    expect(result.entities.map((entity) => entity.kind)).toEqual(
      expect.arrayContaining(['owner', 'pipeline', 'container', 'document'])
    );
  });

  it('keeps project-scoped agent retrieval out of unrelated project entities', async () => {
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

    const result = searchKnowledgeGraph(graph, {
      query: 'project source package health',
      projectId: 'api',
      projection: 'agent',
    });

    expect(result.projectId).toBe('api');
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities.every((entity) => entity.projectId === 'api')).toBe(true);
  });

  it('treats a scoped project-name query as a bounded architecture overview', async () => {
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

    const result = searchKnowledgeGraph(graph, {
      query: 'api',
      projectId: 'api',
      projection: 'agent',
      limit: 12,
    });

    expect(result.entities[0]).toMatchObject({ kind: 'project', projectId: 'api' });
    expect(
      result.entities.every((entity) => !['file', 'module', 'symbol'].includes(entity.kind))
    ).toBe(true);
    expect(result.totalMatches).toBeLessThan(
      graph.entities.filter((entity) => entity.projectId === 'api').length
    );
  });

  it('uses camel-case query coverage and language facets to rank polyglot symbols', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [{ id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' }],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    for (const [id, language] of [
      ['typescript-client', 'typescript'],
      ['java-client', 'java'],
    ] as const) {
      graph.entities.push({
        id,
        kind: 'symbol',
        label: 'CopilotClient',
        projectId: 'api',
        identity: {
          key: `symbol:api:${language}:CopilotClient`,
          scope: 'project',
          aliases: [],
          fingerprint: id,
        },
        attributes: { language, symbolKind: 'type' },
        proofIds: [],
      });
    }
    graph.entities.push({
      id: 'typescript-noise',
      kind: 'symbol',
      label: 'unrelated',
      projectId: 'api',
      identity: {
        key: 'symbol:api:typescript:unrelated',
        scope: 'project',
        aliases: [],
        fingerprint: 'typescript-noise',
      },
      attributes: { language: 'typescript', symbolKind: 'value' },
      proofIds: [],
    });

    const result = searchKnowledgeGraph(graph, {
      query: 'TypeScript CopilotClient public session',
      projectId: 'api',
      limit: 5,
    });

    expect(result.entities[0]?.id).toBe('typescript-client');
    expect(result.entities.some((entity) => entity.id === 'typescript-noise')).toBe(false);
    expect(result.entities.some((entity) => entity.id === 'java-client')).toBe(false);
  });

  it('hard-bounds every high-cardinality field in the agent search projection', async () => {
    const root = await fixture();
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [{ id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' }],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    const target = graph.entities.find((entity) => entity.kind === 'project')!;
    target.identity.aliases = Array.from({ length: 40 }, (_, index) => `api-alias-${index}`);
    target.attributes = {
      values: Array.from({ length: 40 }, (_, index) => `value-${index}`),
      large: 'x'.repeat(2_000),
    };
    for (let index = 0; index < 80; index += 1) {
      const proofId = `synthetic-proof-${index}`;
      graph.proofs.push({
        id: proofId,
        artifact: `api/proof-${index}.json`,
        provider: 'test',
        trust: 'observed',
        confidence: 'high',
        freshness: 'fresh',
      });
      target.proofIds.push(proofId);
    }

    const result = searchKnowledgeGraph(graph, {
      query: target.identity.key,
      limit: 1,
      projection: 'agent',
    });

    expect(result.budget?.mode).toBe('agent');
    expect(result.proofs.length).toBeLessThanOrEqual(16);
    expect(result.entities[0].proofIds.length).toBeLessThanOrEqual(4);
    expect(result.entities[0].identity.aliases.length).toBeLessThanOrEqual(8);
    expect(result.entities[0].attributes.values).toHaveLength(8);
    expect(String(result.entities[0].attributes.large)).toHaveLength(256);
    expect(result.budget?.omitted.proofs).toBeGreaterThan(0);
    expect(result.budget?.omitted.proofReferences).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    const emittedProofs = new Set(result.proofs.map((proof) => proof.id));
    expect(result.entities[0].proofIds.every((proofId) => emittedProofs.has(proofId))).toBe(true);
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
    const frontendScope = searchKnowledgeGraph(graph, {
      query: 'checkout service schema',
      projectId: 'frontend',
      limit: 5,
    });
    expect(frontendScope.entities.map((entity) => entity.kind)).toEqual(
      expect.arrayContaining(['api', 'schema'])
    );
  });

  it('keeps conflicting protobuf definitions as explicit variants instead of merging attributes', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-protobuf-variants-'));
    tempDirs.push(root);
    await fsExtra.outputJson(path.join(root, 'api', '.workspai', 'project.json'), {
      runtime: 'cpp',
    });
    await fsExtra.outputFile(
      path.join(root, 'api', 'v1', 'checkout.proto'),
      'syntax = "proto3";\npackage shop.v1;\nservice CheckoutService {}\nmessage CheckoutRequest { string id = 1; }\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'api', 'experimental', 'checkout.proto'),
      'syntax = "proto3";\npackage shop.v1;\nservice CheckoutService {}\nmessage CheckoutRequest { int64 id = 1; }\n'
    );

    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'shop' },
      projects: [{ id: 'api', path: 'api', runtime: 'cpp' }],
      projectTopology: topology(),
      now: NOW,
      source: modelSource(),
    });

    expect(graph.entities.filter((entity) => entity.label === 'CheckoutService')).toHaveLength(2);
    expect(graph.entities.filter((entity) => entity.label === 'CheckoutRequest')).toHaveLength(2);
    expect(
      graph.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'graph.knowledge.attribute_conflict' &&
          diagnostic.message.includes('Checkout')
      )
    ).toBe(false);
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

  it('reads portable external proof artifacts through the workspace contract', async () => {
    const root = await fixture();
    const externalRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-external-proof-'));
    tempDirs.push(externalRoot);
    await fsExtra.outputFile(path.join(externalRoot, 'README.md'), 'native proof\n'.repeat(1_000));
    await fsExtra.outputJson(path.join(root, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'platform' },
      projects: [
        {
          slug: 'native',
          relativePath: 'external/native',
          externalPath: externalRoot,
          source: 'adopted-local',
          modules: [],
          ports: [],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
      ],
    });
    const graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: 'platform' },
      projects: [{ id: 'api', path: 'api', runtime: 'node', framework: 'nestjs' }],
      projectTopology: topology(),
      contract: contract(),
      now: NOW,
      source: modelSource(),
    });
    graph.proofs = [
      {
        ...graph.proofs[0],
        artifact: 'external/native/README.md',
      },
    ];

    const report = await buildWorkspaceGraphTokenEfficiencyReport({
      workspacePath: root,
      graph,
      query: 'health endpoint',
      limit: 1,
      now: NOW,
    });

    expect(report.corpus).toMatchObject({ artifactCount: 1, unreadableArtifacts: [] });
    expect(report.corpus.characterCount).toBeGreaterThan(10_000);
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
      'polyglot-semantics',
      'python-project-manifest',
      'runtime-bridge-semantics',
      'source-language-inventory',
      'source-structure',
      'vscode-extension-manifest',
      'workspace-foundation',
      'workspace-service-contract',
    ]);
    expect(new Set(graph.entities.map((entity) => entity.kind))).toEqual(
      new Set([
        'workspace',
        'project',
        'language',
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
    expect(
      graph.providers.every(
        (provider) => provider.status === 'skipped' || provider.discoveredEntities > 0
      )
    ).toBe(true);
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
