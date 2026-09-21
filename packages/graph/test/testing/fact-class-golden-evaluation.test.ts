import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type {
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import { createStandardRepositoryProviders } from '../../src/providers/index.js';
import { factClassObservationsFromGraph, scoreFactClassQuality } from '../../src/testing/index.js';

const scope = { kind: 'project' as const, projectIds: ['fact-class-golden'] as [string] };

function digestOf(content: string) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(content).digest('hex'),
  };
}

function ports(contents: Readonly<Record<string, string>>): GraphProductHostPorts {
  const inputs = Object.entries(contents).map(([locator, content]) => {
    const bytes = new TextEncoder().encode(content);
    return {
      locator,
      mediaType: 'text/plain',
      byteLength: bytes.byteLength,
      digest: digestOf(content),
    };
  });
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

describe('synthetic fact-class golden evaluation', () => {
  it('scores package full facts against manually justified expected keys', async () => {
    const contents = {
      'package.json': '{"name":"golden","private":true}\n',
      'src/server.ts':
        "import express from 'express';\nexport function health(): string { return 'ok'; }\nconst app = express();\napp.get('/health', health);\n",
      'api.py':
        "from flask import Flask\napp = Flask(__name__)\n@app.post('/orders')\ndef orders():\n    return []\n",
      'src/server.test.ts':
        "import { health } from './server.js';\nexport function testHealth(): string { return health(); }\n",
      'proto/health.proto':
        'syntax = "proto3";\nservice Health { rpc Check (Ping) returns (Pong); }\nmessage Ping {}\nmessage Pong {}\n',
      'deploy/compose.yaml': 'services:\n  api:\n    image: api:1\n',
      'src/comments.ts':
        '// call health()\nconst text = "app.get(\'/nope\', health)";\nfunction unusedLocal(): void {}\n',
      'src/dynamic.ts': 'const method = "get";\napp[method](path, handler);\n',
    };
    const result = await buildRepoGraph({
      root: 'golden',
      scope,
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: ports(contents),
    });
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    const facts = result.compositionSources?.flatMap((source) => source.batch.facts) ?? [];
    const observed = factClassObservationsFromGraph(
      result.graph,
      facts,
      result.quality.unknownZones
    );
    const report = scoreFactClassQuality({
      expected: {
        files: {
          keys: [
            'package.json',
            'src/server.ts',
            'api.py',
            'src/server.test.ts',
            'proto/health.proto',
            'deploy/compose.yaml',
            'src/comments.ts',
            'src/dynamic.ts',
          ],
        },
        routes: { keys: ['GET /health', 'POST /orders'] },
        projects: { keys: ['golden'] },
        imports: { keys: ['express', 'flask', './server.js'] },
        declarations: { keys: ['health', 'orders', 'testHealth', 'app', 'unusedLocal'] },
        exports: { keys: ['health', 'orders', 'testHealth'] },
        calls: { keys: ['health'] },
        tests: { keys: ['src/server.test.ts'] },
      },
      packageFull: observed,
      packageIncremental: observed,
    });
    const byClass = Object.fromEntries(
      report.classes.map((entry) => [entry.factClass, entry] as const)
    );
    expect(byClass.files?.falseNegatives).toBe(0);
    expect(byClass.files?.truePositives).toBe(8);
    expect(byClass.routes?.truePositives).toBe(2);
    expect(byClass.routes?.falseNegatives).toBe(0);
    expect(byClass.routes?.packageFullKeys).not.toContain('GET /nope');
    expect(byClass.projects?.truePositives).toBe(1);
    expect(byClass.imports?.truePositives).toBeGreaterThanOrEqual(3);
    expect(byClass.declarations?.truePositives).toBeGreaterThanOrEqual(4);
    expect(byClass.exports?.truePositives).toBeGreaterThanOrEqual(2);
    expect(byClass.exports?.packageFullKeys).not.toContain('unusedLocal');
    expect(byClass.calls?.truePositives).toBeGreaterThanOrEqual(1);
    expect(byClass.calls?.recall).toBe(1);
    expect(byClass.calls?.precision).toBeGreaterThan(0);
    expect(byClass.tests?.truePositives).toBeGreaterThanOrEqual(1);
    expect(byClass.tests?.recall).toBe(1);
    expect(byClass.tests?.precision).toBeGreaterThan(0);
    expect(byClass.tests?.packageFullKeys.some((key) => key.startsWith('sha256:'))).toBe(false);
    expect(result.metrics.inventoryMs).toBeDefined();
    expect(result.metrics.memoryStages?.some((stage) => stage.at === 'start')).toBe(true);
    expect(result.metrics.processLifetimePeakRssBytes).toBeGreaterThan(0);
    expect(report.publicAccuracyClaimPermitted).toBe(false);
  });
});
