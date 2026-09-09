#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryGraph, writeGraphGeneration } from './application/index.js';
import type { GraphRepoBuildResult } from './application/index.js';
import {
  buildNodeRepoGraph,
  createNodeGraphProductHostPorts,
  createNodeProjectArtifactStore,
} from './adapters/node/index.js';
import { GRAPH_QUERY_CONTRACT, GRAPH_QUERY_PRESETS } from './contracts/index.js';
import type {
  GraphCanonicalGraph,
  GraphDiagnostic,
  GraphProviderRuntime,
  GraphQuery,
  GraphQueryExecutionResult,
} from './contracts/index.js';
import { createStandardRepositoryProviders } from './providers/index.js';

type GraphCliCommand = 'inspect' | 'quality' | 'query' | 'providers';

interface GraphCliOptions {
  readonly command: GraphCliCommand;
  readonly root: string;
  readonly write: boolean;
  readonly json: boolean;
  readonly mode: 'project-only';
  readonly providerAction?: 'list' | 'inspect';
  readonly providerId?: string;
  readonly preset?: keyof typeof GRAPH_QUERY_PRESETS;
  readonly subject?: string;
  readonly target?: string;
}

export interface GraphCliIo {
  readonly cwd: string;
  writeOut(value: string): void;
  writeErr(value: string): void;
}

export interface GraphCliDependencies {
  build(root: string, signal: AbortSignal): Promise<GraphRepoBuildResult>;
  publish(
    root: string,
    build: GraphRepoBuildResult,
    signal: AbortSignal
  ): ReturnType<typeof writeGraphGeneration>;
  query(graph: GraphCanonicalGraph, query: GraphQuery): Promise<GraphQueryExecutionResult<unknown>>;
  providers(): readonly GraphProviderRuntime[];
}

const HELP = `Workspai Graph repository preview

Usage:
  workspai-graph inspect [root] [--mode project-only] [--write] [--json]
  workspai-graph quality [root] [--json]
  workspai-graph query [root] --preset <name> [--subject <id>] [--target <id>] [--json]
  workspai-graph providers list [--json]
  workspai-graph providers inspect <provider-id> [--json]

The preview is local, offline and read-only unless --write is explicitly supplied.
`;

class GraphCliInputError extends Error {}

function takeValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new GraphCliInputError(`${option} requires a value.`);
  return value;
}

function parseArgs(args: readonly string[], cwd: string): GraphCliOptions | 'help' {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return 'help';
  const command = args[0];
  if (!['inspect', 'quality', 'query', 'providers'].includes(command ?? '')) {
    throw new GraphCliInputError('Expected inspect, quality, query or providers.');
  }
  let root = cwd;
  let write = false;
  let json = false;
  let mode: 'project-only' = 'project-only';
  let preset: keyof typeof GRAPH_QUERY_PRESETS | undefined;
  let subject: string | undefined;
  let target: string | undefined;
  let providerAction: 'list' | 'inspect' | undefined;
  let providerId: string | undefined;
  const positionals: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--write') write = true;
    else if (argument === '--mode') {
      const value = takeValue(args, index, argument);
      index += 1;
      if (value !== 'project-only') {
        throw new GraphCliInputError(
          'Only project-only mode is admitted by the standalone repository preview.'
        );
      }
      mode = value;
    } else if (argument === '--preset') {
      const value = takeValue(args, index, argument);
      index += 1;
      if (!(value in GRAPH_QUERY_PRESETS)) throw new GraphCliInputError(`Unknown preset: ${value}`);
      preset = value as keyof typeof GRAPH_QUERY_PRESETS;
    } else if (argument === '--subject') {
      subject = takeValue(args, index, argument);
      index += 1;
    } else if (argument === '--target') {
      target = takeValue(args, index, argument);
      index += 1;
    } else if (argument?.startsWith('-'))
      throw new GraphCliInputError(`Unknown option: ${argument}`);
    else positionals.push(argument ?? '');
  }

  if (command === 'providers') {
    providerAction = positionals[0] as 'list' | 'inspect' | undefined;
    providerId = positionals[1];
    if (
      !providerAction ||
      !['list', 'inspect'].includes(providerAction) ||
      positionals.length > (providerAction === 'inspect' ? 2 : 1) ||
      (providerAction === 'inspect' && !providerId)
    ) {
      throw new GraphCliInputError('Providers requires list or inspect <provider-id>.');
    }
  } else {
    if (positionals.length > 1)
      throw new GraphCliInputError('Only one repository root is allowed.');
    root = path.resolve(cwd, positionals[0] ?? '.');
  }
  if (write && command !== 'inspect')
    throw new GraphCliInputError('--write is supported only by inspect.');
  if (command === 'query' && !preset)
    throw new GraphCliInputError('Query requires --preset <name>.');
  if (command !== 'query' && (preset || subject || target))
    throw new GraphCliInputError('Query options are supported only by query.');

  return {
    command: command as GraphCliCommand,
    root,
    write,
    json,
    mode,
    providerAction,
    providerId,
    preset,
    subject,
    target,
  };
}

function envelope(
  command: GraphCliCommand | 'input',
  status: 'complete' | 'partial' | 'failed' | 'cancelled',
  data: unknown,
  diagnostics: readonly GraphDiagnostic[] = []
): string {
  return `${JSON.stringify({
    schemaVersion: 'workspai.graph.cli-result.v1',
    command,
    status,
    data,
    diagnostics,
  })}\n`;
}

function emit(io: GraphCliIo, json: boolean, error: boolean, payload: string, human: string): void {
  const value = json ? payload : `${human.trimEnd()}\n`;
  if (error) io.writeErr(value);
  else io.writeOut(value);
}

function defaultDependencies(): GraphCliDependencies {
  return {
    build: (root, signal) =>
      buildNodeRepoGraph({
        root,
        signal,
        workerUrl: new URL('./adapters/node/reference-worker-entry.js', import.meta.url),
      }),
    publish: (root, build, signal) => {
      const ports = createNodeGraphProductHostPorts({ signal });
      return writeGraphGeneration({
        build,
        store: createNodeProjectArtifactStore(root),
        digest: ports.digest,
        signal,
      });
    },
    query: (graph, input) => {
      const ports = createNodeGraphProductHostPorts();
      return queryGraph(graph, input, ports.digest);
    },
    providers: createStandardRepositoryProviders,
  };
}

export async function runGraphCli(
  args: readonly string[],
  io: GraphCliIo,
  dependencies: GraphCliDependencies = defaultDependencies(),
  signal: AbortSignal = new AbortController().signal
): Promise<number> {
  let options: GraphCliOptions | 'help';
  try {
    options = parseArgs(args, io.cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid command input.';
    const payload = envelope('input', 'failed', null, [
      {
        code: 'GRAPH_CLI_INPUT_INVALID',
        severity: 'error',
        path: '/arguments',
        message,
      },
    ]);
    emit(io, args.includes('--json'), true, payload, `Graph input error: ${message}`);
    return 3;
  }
  if (options === 'help') {
    io.writeOut(HELP);
    return 0;
  }

  if (options.command === 'providers') {
    const providers = dependencies.providers();
    const data =
      options.providerAction === 'list'
        ? providers.map((provider) => ({
            id: provider.manifest.id,
            version: provider.manifest.version,
            displayName: provider.manifest.displayName,
            permissions: provider.manifest.permissions,
          }))
        : providers.find((provider) => provider.manifest.id === options.providerId)?.manifest;
    if (!data) {
      const payload = envelope('providers', 'failed', null, [
        {
          code: 'GRAPH_PROVIDER_UNKNOWN',
          severity: 'error',
          path: '/provider',
          message: 'Provider is not part of the admitted offline set.',
        },
      ]);
      emit(io, options.json, true, payload, `Unknown Graph provider: ${options.providerId ?? ''}`);
      return 3;
    }
    emit(
      io,
      options.json,
      false,
      envelope('providers', 'complete', data),
      options.providerAction === 'list'
        ? (data as readonly { readonly id: string; readonly version: string }[])
            .map((provider) => `${provider.id} ${provider.version}`)
            .join('\n')
        : JSON.stringify(data, null, 2)
    );
    return 0;
  }

  const build = await dependencies.build(options.root, signal);
  if (!build.graph || build.status === 'failed' || build.status === 'cancelled') {
    const payload = envelope(
      options.command,
      build.status,
      { quality: build.quality, metrics: build.metrics },
      build.diagnostics
    );
    emit(
      io,
      options.json,
      true,
      payload,
      `Graph ${options.command} failed (${build.status}). ${build.diagnostics.map((item) => item.message).join(' ')}`
    );
    return build.status === 'cancelled' ? 130 : 1;
  }

  if (options.command === 'inspect') {
    const publication = options.write
      ? await dependencies.publish(options.root, build, signal)
      : undefined;
    if (publication && !publication.accepted) {
      emit(
        io,
        options.json,
        true,
        envelope('inspect', 'failed', { build, publication }, publication.issues),
        `Graph publication failed. ${publication.issues.map((issue) => issue.message).join(' ')}`
      );
      return publication.issues.some((issue) => issue.code.includes('CANCELLED')) ? 130 : 4;
    }
    emit(
      io,
      options.json,
      false,
      envelope(
        'inspect',
        build.status,
        { build, ...(publication ? { publication: publication.value } : {}) },
        build.diagnostics
      ),
      `Graph preview: ${build.status}\nFiles: ${build.metrics.inputFiles}\nNodes: ${build.graph.nodes.length}\nEdges: ${build.graph.edges.length}${publication ? `\nPublication: ${publication.value.status}` : ''}`
    );
    return 0;
  }
  if (options.command === 'quality') {
    emit(
      io,
      options.json,
      false,
      envelope(
        'quality',
        build.status,
        { quality: build.quality, metrics: build.metrics },
        build.diagnostics
      ),
      `Graph quality: ${build.status}\nFiles: ${build.metrics.inputFiles}\nUnknown zones: ${build.quality.unknownZones.length}\nUnsupported zones: ${build.quality.unsupportedZones.length}`
    );
    return build.status === 'partial' ? 2 : 0;
  }

  const selected = GRAPH_QUERY_PRESETS[options.preset as keyof typeof GRAPH_QUERY_PRESETS];
  const input: GraphQuery = {
    ...selected.query,
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.target ? { target: options.target } : {}),
    contract: GRAPH_QUERY_CONTRACT,
  };
  const result = await dependencies.query(build.graph, input);
  if (!result.accepted) {
    emit(
      io,
      options.json,
      true,
      envelope(
        'query',
        'failed',
        result,
        result.issues.map((issue) => ({ ...issue, severity: 'error' as const }))
      ),
      `Graph query failed. ${result.issues.map((issue) => issue.message).join(' ')}`
    );
    return result.code === 'resource-limit' ? 2 : 3;
  }
  emit(
    io,
    options.json,
    false,
    envelope('query', build.status, result.value, build.diagnostics),
    `Graph query: ${build.status}\nPreset: ${options.preset ?? ''}`
  );
  return 0;
}

export async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    process.exitCode = await runGraphCli(
      process.argv.slice(2),
      {
        cwd: process.cwd(),
        writeOut: (value) => process.stdout.write(value),
        writeErr: (value) => process.stderr.write(value),
      },
      undefined,
      controller.signal
    );
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
