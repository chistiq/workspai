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
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-system-topology-'));
  roots.push(root);
  await mkdir(path.join(root, '.github'), { recursive: true });
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await mkdir(path.join(root, 'src', 'checkout'), { recursive: true });
  await mkdir(path.join(root, 'src', 'currency'), { recursive: true });
  await writeFile(
    path.join(root, 'compose.yaml'),
    [
      'services:',
      '  checkout:',
      '    image: example/checkout:1',
      '    depends_on:',
      '      currency:',
      '        condition: service_started',
      '  currency:',
      '    image: example/currency:1',
      '    depends_on: [checkout]',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, '.github', 'CODEOWNERS'),
    [
      '* @example/platform',
      '/src/checkout/ @example/checkout',
      '*.cpp native@example.com',
      'dashboard.mlapp @example/matlab',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, 'src', 'checkout', 'main.go'),
    'package main\n\nfunc main() {}\n'
  );
  await writeFile(path.join(root, 'src', 'currency', 'server.cpp'), 'int main() { return 0; }\n');
  await writeFile(path.join(root, 'dashboard.mlapp'), new Uint8Array([80, 75, 3, 4]));
  await writeFile(
    path.join(root, 'health.proto'),
    [
      'syntax = "proto3";',
      'package workspai.health;',
      'import "google/protobuf/empty.proto";',
      'message HealthReply { string status = 1; }',
      'service Health {',
      '  rpc Check (google.protobuf.Empty) returns (HealthReply);',
      '}',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, 'BUILD.bazel'),
    [
      'cc_library(',
      '    name = "checkout",',
      '    deps = ["//src/currency:currency"],',
      ')',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(root, 'CMakeLists.txt'),
    [
      'add_library(currency src/currency/server.cpp)',
      'add_executable(checkout src/checkout/main.go)',
      'target_link_libraries(checkout PRIVATE currency)',
      '',
    ].join('\n')
  );
  const entrypoints: Readonly<Record<string, string>> = {
    'main.rs': 'fn main() {}\n',
    'Application.java': 'public class Application { public static void main(String[] args) {} }\n',
    'Program.cs': 'static void Main(string[] args) {}\n',
    'main.kt': 'fun main() {}\n',
    'Application.swift': '@main struct Application { static func main() {} }\n',
    'main.dart': 'void main() {}\n',
    'main.zig': 'pub fn main() void {}\n',
    'Program.fs': '[<EntryPoint>]\nlet main argv = 0\n',
    'Application.scala': 'object Application extends App {}\n',
    'application.ex': 'def start(_type, _args) do\n  :ok\nend\n',
    'main.lua': 'print("ready")\n',
    'index.php': '<?php echo "ready";\n',
    'bin/server.rb': 'puts "ready"\n',
    'main.py': 'def main():\n    pass\n',
    'script.rb': '#!/usr/bin/env ruby\nputs "ready"\n',
  };
  await Promise.all(
    Object.entries(entrypoints).map(([locator, source]) =>
      writeFile(path.join(root, ...locator.split('/')), source)
    )
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

describe('system topology repository providers', () => {
  it('binds Compose services, ownership and cross-language entrypoints to evidence', async () => {
    const root = await fixture();
    const result = await buildRepoGraph({
      root,
      scope: { kind: 'project', projectIds: ['project:system-topology-fixture'] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
    });

    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    expect(result.graph.nodes.filter((node) => node.kind === 'service')).toHaveLength(3);
    expect(result.graph.nodes.some((node) => node.kind === 'team')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'owner')).toBe(true);
    expect(result.graph.nodes.filter((node) => node.kind === 'command').length).toBeGreaterThan(15);
    expect(result.graph.edges.some((edge) => edge.relation === 'depends-on')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.relation === 'owned-by')).toBe(true);
    expect(result.graph.edges.filter((edge) => edge.relation === 'deployed-as')).toHaveLength(2);
    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.edges.every((edge) => edge.proof.evidence.length > 0)).toBe(true);
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.compose-topology' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.codeowners' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.source-entrypoints' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.protobuf-topology' }),
          collection: 'complete',
        }),
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'workspai.graph.provider.build-topology' }),
          collection: 'complete',
        }),
      ])
    );
  });

  it('fails closed when Compose syntax cannot be parsed safely', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'compose.yaml'), 'services: [invalid\n');
    const result = await buildRepoGraph({
      root,
      scope: { kind: 'project', projectIds: ['project:invalid-compose-fixture'] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
    });

    expect(result.status).toBe('partial');
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.compose-topology-unknown' })
    );
  });

  it('reports an invalid Compose service definition without dropping valid services', async () => {
    const root = await fixture();
    await writeFile(
      path.join(root, 'compose.yaml'),
      ['services:', '  valid:', '    image: example/valid:1', '  invalid: scalar', ''].join('\n')
    );
    const result = await buildRepoGraph({
      root,
      scope: { kind: 'project', projectIds: ['project:partial-compose-fixture'] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(),
    });

    expect(result.status).toBe('partial');
    expect(result.graph?.edges.filter((edge) => edge.relation === 'deployed-as')).toHaveLength(1);
    expect(result.quality.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.compose-service-definition-invalid' })
    );
  });
});
