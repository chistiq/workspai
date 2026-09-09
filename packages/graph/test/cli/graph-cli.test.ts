import { describe, expect, it, vi } from 'vitest';

import {
  isDirectGraphCliInvocation,
  main,
  runGraphCli,
  type GraphCliDependencies,
  type GraphCliIo,
} from '../../src/cli.js';
import type { GraphRepoBuildResult } from '../../src/application/index.js';
import type { GraphCanonicalGraph, GraphQueryExecutionResult } from '../../src/contracts/index.js';
import { createStandardRepositoryProviders } from '../../src/providers/index.js';

function result(status: GraphRepoBuildResult['status']): GraphRepoBuildResult {
  return {
    status,
    ...(status === 'complete' || status === 'partial'
      ? { graph: { nodes: [], edges: [] } as unknown as GraphCanonicalGraph }
      : {}),
    quality: {
      ...(status === 'complete' || status === 'partial'
        ? { graph: {} as GraphRepoBuildResult['quality']['graph'] }
        : {}),
      unknownZones: [],
      unsupportedZones: [],
      providerFailures: [],
    },
    providers: [],
    diagnostics: [],
    metrics: { inputFiles: 1, inputBytes: 1, providerFacts: 1, omittedFiles: 0 },
  };
}

function harness(build: GraphRepoBuildResult = result('complete')): {
  readonly io: GraphCliIo;
  readonly output: string[];
  readonly errors: string[];
  readonly dependencies: GraphCliDependencies;
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: {
      cwd: '/portable/project',
      writeOut: (value) => output.push(value),
      writeErr: (value) => errors.push(value),
    },
    dependencies: {
      build: vi.fn(async () => build),
      publish: vi.fn(async () => ({
        accepted: true as const,
        value: {
          status: 'committed' as const,
          pointer: '.workspai/reports/graph-generation.json',
          artifacts: {
            'canonical-graph': 'graph.json',
            quality: 'quality.json',
            'provider-runs': 'providers.json',
            publication: 'graph-generation.json',
          },
        },
        issues: [] as const,
      })),
      query: vi.fn(
        async () =>
          ({
            accepted: true,
            value: { result: [] },
            issues: [],
          }) as unknown as GraphQueryExecutionResult<unknown>
      ),
      slice: vi.fn(
        () =>
          ({
            accepted: true as const,
            value: { profile: { id: 'workspai.graph.review-context-slice.standard' } },
            issues: [] as const,
          }) as unknown as ReturnType<GraphCliDependencies['slice']>
      ),
      project: vi.fn(
        () =>
          ({
            accepted: true as const,
            value: {
              nodes: [],
              edges: [],
            },
            issues: [] as const,
          }) as unknown as ReturnType<GraphCliDependencies['project']>
      ),
      providers: createStandardRepositoryProviders,
    },
  };
}

describe('workspai-graph CLI', () => {
  it('recognizes the same executable through a platform path alias', () => {
    const realpath = (value: string): string =>
      value.startsWith('/var/') ? `/private${value}` : value;
    expect(
      isDirectGraphCliInvocation(
        '/var/folders/workspai/node_modules/@workspai/graph/dist/cli.js',
        'file:///private/var/folders/workspai/node_modules/@workspai/graph/dist/cli.js',
        realpath
      )
    ).toBe(true);
    expect(
      isDirectGraphCliInvocation(
        '/var/folders/workspai/node_modules/@workspai/graph/dist/other.js',
        'file:///private/var/folders/workspai/node_modules/@workspai/graph/dist/cli.js',
        realpath
      )
    ).toBe(false);
    expect(isDirectGraphCliInvocation(undefined, import.meta.url, realpath)).toBe(false);
  });

  it('is helpful without reading a repository', async () => {
    const test = harness();
    expect(await runGraphCli([], test.io, test.dependencies)).toBe(0);
    expect(test.output.join('')).toContain('read-only unless --write');
    expect(test.dependencies.build).not.toHaveBeenCalled();
  });

  it('rejects unknown input with the contract exit code and JSON diagnostic', async () => {
    const test = harness();
    expect(await runGraphCli(['inspect', '--unknown', '--json'], test.io, test.dependencies)).toBe(
      3
    );
    expect(JSON.parse(test.errors[0] ?? '{}')).toMatchObject({
      schemaVersion: 'workspai.graph.cli-result.v1',
      status: 'failed',
      diagnostics: [{ code: 'GRAPH_CLI_INPUT_INVALID' }],
    });
    expect(test.dependencies.build).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown'],
    ['query', '--preset'],
    ['query', '--preset', 'unknown'],
    ['query'],
    ['quality', '--write'],
    ['quality', '--view', 'source'],
    ['query', '--preset', 'entryPoints', '--slice'],
    ['inspect', '--slice'],
    ['inspect', '--view', 'unknown'],
    ['inspect', '--mode', 'project-and-default-workspace'],
    ['inspect', '--subject', 'entity:unexpected'],
    ['inspect', 'one', 'two'],
    ['providers'],
    ['providers', 'inspect'],
    ['providers', 'list', 'unexpected'],
  ])('rejects malformed command shape %j before repository access', async (...args) => {
    const test = harness();
    expect(await runGraphCli(args, test.io, test.dependencies)).toBe(3);
    expect(test.dependencies.build).not.toHaveBeenCalled();
  });

  it('keeps inspect read-only unless write is explicit', async () => {
    const test = harness();
    expect(
      await runGraphCli(
        ['inspect', '.', '--mode', 'project-only', '--json'],
        test.io,
        test.dependencies
      )
    ).toBe(0);
    expect(test.dependencies.publish).not.toHaveBeenCalled();
    expect(JSON.parse(test.output[0] ?? '{}')).toMatchObject({
      command: 'inspect',
      status: 'complete',
    });

    expect(
      await runGraphCli(['inspect', '.', '--write', '--json'], test.io, test.dependencies)
    ).toBe(0);
    expect(test.dependencies.publish).toHaveBeenCalledOnce();

    const human = harness();
    expect(await runGraphCli(['inspect'], human.io, human.dependencies)).toBe(0);
    expect(human.output[0]).toContain('Graph preview: complete');

    const projected = harness();
    expect(
      await runGraphCli(
        ['inspect', '.', '--view', 'evidence', '--json'],
        projected.io,
        projected.dependencies
      )
    ).toBe(0);
    expect(projected.dependencies.project).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'evidence'
    );
    expect(JSON.parse(projected.output[0] ?? '{}')).toMatchObject({
      data: { view: { nodes: [], edges: [] } },
    });
  });

  it('uses quality exit 2 for an honest partial repository build', async () => {
    const test = harness(result('partial'));
    expect(await runGraphCli(['quality', '--json'], test.io, test.dependencies)).toBe(2);
    expect(JSON.parse(test.output[0] ?? '{}')).toMatchObject({
      command: 'quality',
      status: 'partial',
    });
  });

  it('runs admitted presets and reports query contract failures', async () => {
    const test = harness();
    expect(
      await runGraphCli(['query', '--preset', 'entryPoints', '--json'], test.io, test.dependencies)
    ).toBe(0);
    expect(test.dependencies.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'entry-points' })
    );

    test.dependencies.query = vi.fn(async () => ({
      accepted: false as const,
      code: 'invalid-query' as const,
      issues: [{ code: 'GRAPH_QUERY_INVALID', path: '/query', message: 'Invalid query.' }],
    }));
    expect(
      await runGraphCli(
        ['query', '--preset', 'impact', '--subject', 'entity:missing', '--json'],
        test.io,
        test.dependencies
      )
    ).toBe(3);
    expect(JSON.parse(test.errors[0] ?? '{}')).toMatchObject({
      command: 'query',
      status: 'failed',
    });

    test.dependencies.query = vi.fn(async () => ({
      accepted: false as const,
      code: 'resource-limit' as const,
      issues: [{ code: 'GRAPH_QUERY_LIMIT', path: '/budget', message: 'Limit exceeded.' }],
    }));
    expect(
      await runGraphCli(['query', '--preset', 'entryPoints'], test.io, test.dependencies)
    ).toBe(2);
  });

  it('emits a bounded slice only for the fixed review context preset', async () => {
    const test = harness();
    expect(
      await runGraphCli(
        ['query', '--preset', 'reviewContext', '--slice', '--json'],
        test.io,
        test.dependencies
      )
    ).toBe(0);
    expect(test.dependencies.slice).toHaveBeenCalledOnce();
    expect(JSON.parse(test.output[0] ?? '{}')).toMatchObject({
      command: 'query',
      data: { profile: { id: 'workspai.graph.review-context-slice.standard' } },
    });

    test.dependencies.slice = vi.fn(() => ({
      accepted: false as const,
      issues: [
        {
          code: 'GRAPH_REVIEW_CONTEXT_SLICE_BUDGET_INVALID',
          path: '/budget',
          message: 'Invalid slice budget.',
        },
      ],
    }));
    expect(
      await runGraphCli(
        ['query', '--preset', 'reviewContext', '--slice'],
        test.io,
        test.dependencies
      )
    ).toBe(3);
  });

  it('lists and inspects only the admitted offline provider set', async () => {
    const test = harness();
    expect(await runGraphCli(['providers', 'list', '--json'], test.io, test.dependencies)).toBe(0);
    const list = JSON.parse(test.output[0] ?? '{}') as { data: { id: string }[] };
    expect(list.data).toHaveLength(7);
    expect(list.data.every((provider) => provider.id.startsWith('workspai.graph.provider.'))).toBe(
      true
    );

    expect(
      await runGraphCli(
        ['providers', 'inspect', 'workspai.graph.provider.unknown', '--json'],
        test.io,
        test.dependencies
      )
    ).toBe(3);

    const inspected = harness();
    expect(
      await runGraphCli(
        ['providers', 'inspect', 'workspai.graph.provider.repository-files'],
        inspected.io,
        inspected.dependencies
      )
    ).toBe(0);
    expect(inspected.output[0]).toContain('Repository files');
  });

  it('maps build cancellation and publication failure to stable exit codes', async () => {
    const cancelled = harness(result('cancelled'));
    expect(await runGraphCli(['inspect'], cancelled.io, cancelled.dependencies)).toBe(130);

    const publicationFailure = harness();
    publicationFailure.dependencies.publish = vi.fn(async () => ({
      accepted: false as const,
      code: 'publication-failed' as const,
      issues: [
        {
          code: 'GRAPH_PROJECT_PUBLICATION_STORE_FAILED',
          severity: 'error' as const,
          path: '/publication',
          message: 'Publication failed.',
        },
      ],
    }));
    expect(
      await runGraphCli(
        ['inspect', '--write'],
        publicationFailure.io,
        publicationFailure.dependencies
      )
    ).toBe(4);

    publicationFailure.dependencies.publish = vi.fn(async () => ({
      accepted: false as const,
      code: 'publication-failed' as const,
      issues: [
        {
          code: 'GRAPH_PROJECT_PUBLICATION_CANCELLED',
          severity: 'error' as const,
          path: '/publication',
          message: 'Publication cancelled.',
        },
      ],
    }));
    expect(
      await runGraphCli(
        ['inspect', '--write'],
        publicationFailure.io,
        publicationFailure.dependencies
      )
    ).toBe(130);

    const failed = harness(result('failed'));
    expect(await runGraphCli(['quality'], failed.io, failed.dependencies)).toBe(1);
  });

  it('constructs the production provider dependency set without repository access', async () => {
    const output: string[] = [];
    expect(
      await runGraphCli(['providers', 'list'], {
        cwd: '/portable/project',
        writeOut: (value) => output.push(value),
        writeErr: () => undefined,
      })
    ).toBe(0);
    expect(output[0]).toContain('workspai.graph.provider.repository-files');
  });

  it('binds the executable host lifecycle to the same tested command runner', async () => {
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = [process.execPath, '/portable/workspai-graph', 'providers', 'list', '--json'];
    try {
      await main();
      expect(process.exitCode).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('workspai.graph.cli-result.v1'));
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
