#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  queryGraph,
  runStandaloneGraph,
  writeGraphGeneration,
} from './application/index.js';
import type { GraphRepoBuildResult, GraphStandaloneGraphExecution } from './application/index.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  GRAPH_CLI_COMMANDS,
  GRAPH_CLI_EXIT_CODES,
  GRAPH_CLI_RESULT_SCHEMA_VERSION,
  GRAPH_QUERY_CONTRACT,
  GRAPH_QUERY_PRESETS,
  type GraphCliCommand,
} from './contracts/index.js';
import {
  buildNodeRepoGraph,
  createNodeGraphProductHostPorts,
  createNodeProjectArtifactStore,
  createNodeWorkspaceArtifactStore,
} from './adapters/node/index.js';
import type {
  GraphCanonicalGraph,
  GraphDiagnostic,
  GraphProviderRuntime,
  GraphQuery,
  GraphQueryExecutionResult,
} from './contracts/index.js';
import { createStandardRepositoryProviders } from './providers/index.js';
import {
  buildReviewContextSlice,
  projectRepositoryPreview,
  type GraphRepositoryPreviewView,
  type GraphRepositoryPreviewViewExecution,
  type GraphReviewContextSliceExecution,
} from './projections/index.js';

interface GraphCliOptions {
  readonly command: GraphCliCommand;
  readonly root: string;
  readonly write: boolean;
  readonly json: boolean;
  readonly mode:
    'project-only' | 'project-and-default-workspace' | 'project-and-existing-workspace';
  readonly workspace?: string;
  readonly providerAction?: 'list' | 'inspect';
  readonly providerId?: string;
  readonly preset?: keyof typeof GRAPH_QUERY_PRESETS;
  readonly subject?: string;
  readonly target?: string;
  readonly view?: GraphRepositoryPreviewView;
  readonly slice: boolean;
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
  slice(
    result: GraphQueryExecutionResult<unknown> & { readonly accepted: true }
  ): GraphReviewContextSliceExecution;
  project(
    graph: GraphCanonicalGraph,
    quality: NonNullable<GraphRepoBuildResult['quality']['graph']>,
    view: GraphRepositoryPreviewView
  ): GraphRepositoryPreviewViewExecution;
  providers(): readonly GraphProviderRuntime[];
  standalone(
    root: string,
    options: Pick<GraphCliOptions, 'mode' | 'workspace' | 'write'>,
    signal: AbortSignal
  ): Promise<GraphStandaloneGraphExecution>;
}

const HELP = `Workspai Graph standalone executable

Usage:
  workspai-graph inspect [root] [--mode project-only|project-and-default-workspace|project-and-existing-workspace] [--workspace <id-or-path>] [--view source|structural|evidence] [--write] [--json]
  workspai-graph quality [root] [--json]
  workspai-graph query [root] --preset <name> [--subject <id>] [--target <id>] [--slice] [--json]
  workspai-graph providers list [--json]
  workspai-graph providers inspect <provider-id> [--json]

JSON results use schemaVersion ${GRAPH_CLI_RESULT_SCHEMA_VERSION}.
Exit codes: ${GRAPH_CLI_EXIT_CODES.success} success, ${GRAPH_CLI_EXIT_CODES.partial} partial, ${GRAPH_CLI_EXIT_CODES.failed} failed, ${GRAPH_CLI_EXIT_CODES.rejected} rejected, ${GRAPH_CLI_EXIT_CODES.publicationFailed} publication failed, ${GRAPH_CLI_EXIT_CODES.cancelled} cancelled.
Query presets: ${Object.keys(GRAPH_QUERY_PRESETS).join(', ')}.

The executable is local, offline and read-only unless --write is explicitly supplied.
It does not import the central Workspai CLI. Standalone-stable admission is not claimed.
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
  if (!GRAPH_CLI_COMMANDS.some((value) => value === command)) {
    throw new GraphCliInputError('Expected inspect, quality, query or providers.');
  }
  let root = cwd;
  let write = false;
  let json = false;
  let mode: GraphCliOptions['mode'] = 'project-only';
  let workspace: string | undefined;
  let preset: keyof typeof GRAPH_QUERY_PRESETS | undefined;
  let subject: string | undefined;
  let target: string | undefined;
  let view: GraphRepositoryPreviewView | undefined;
  let slice = false;
  let providerAction: 'list' | 'inspect' | undefined;
  let providerId: string | undefined;
  const positionals: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--slice') {
      slice = true;
      continue;
    }
    if (argument === '--write') write = true;
    else if (argument === '--mode') {
      const value = takeValue(args, index, argument);
      index += 1;
      if (
        ![
          'project-only',
          'project-and-default-workspace',
          'project-and-existing-workspace',
        ].includes(value)
      ) {
        throw new GraphCliInputError(`Unknown inspect mode: ${value}`);
      }
      mode = value as GraphCliOptions['mode'];
    } else if (argument === '--workspace') {
      workspace = takeValue(args, index, argument);
      index += 1;
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
    } else if (argument === '--view') {
      const value = takeValue(args, index, argument);
      index += 1;
      if (!['source', 'structural', 'evidence'].includes(value)) {
        throw new GraphCliInputError(`Unknown repository preview view: ${value}`);
      }
      view = value as GraphRepositoryPreviewView;
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
  if (mode === 'project-and-existing-workspace' && !workspace && command === 'inspect' && write) {
    throw new GraphCliInputError(
      'Existing-workspace mode requires --workspace <id-or-path> when writing.'
    );
  }
  if (command === 'query' && !preset)
    throw new GraphCliInputError('Query requires --preset <name>.');
  if (command !== 'query' && (preset || subject || target))
    throw new GraphCliInputError('Query options are supported only by query.');
  if (command !== 'inspect' && view)
    throw new GraphCliInputError('--view is supported only by inspect.');
  if (command === 'inspect' && view && mode !== 'project-only') {
    throw new GraphCliInputError('--view is supported only in project-only inspect mode.');
  }
  if (slice && (command !== 'query' || preset !== 'reviewContext'))
    throw new GraphCliInputError('--slice is supported only by the reviewContext query preset.');

  return {
    command: command as GraphCliCommand,
    root,
    write,
    json,
    mode,
    workspace,
    providerAction,
    providerId,
    preset,
    subject,
    target,
    view,
    slice,
  };
}

function envelope(
  command: GraphCliCommand | 'input',
  status: 'complete' | 'partial' | 'failed' | 'cancelled',
  data: unknown,
  diagnostics: readonly GraphDiagnostic[] = []
): string {
  return `${JSON.stringify({
    schemaVersion: GRAPH_CLI_RESULT_SCHEMA_VERSION,
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

function workspaceSelection(
  root: string,
  workspace?: string
): { readonly id?: string; readonly root?: string } | undefined {
  if (!workspace) return undefined;
  if (workspace.startsWith('workspace:')) return { id: workspace };
  return {
    root: path.isAbsolute(workspace) ? workspace : path.resolve(root, workspace),
  };
}

function dualScopeCliStatus(
  status: 'complete-project-only' | 'complete-dual-scope' | 'partial' | 'failed'
): 'complete' | 'partial' | 'failed' {
  if (status === 'complete-dual-scope' || status === 'complete-project-only') return 'complete';
  if (status === 'partial') return 'partial';
  return 'failed';
}

function defaultDependencies(): GraphCliDependencies {
  const workerUrl = new URL('./adapters/node/reference-worker-entry.js', import.meta.url);
  return {
    build: (root, signal) => buildNodeRepoGraph({ root, signal, workerUrl }),
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
    slice: (result) => buildReviewContextSlice(result.value),
    project: projectRepositoryPreview,
    providers: createStandardRepositoryProviders,
    standalone: (root, options, signal) => {
      const ports = createNodeGraphProductHostPorts({ signal, workerUrl });
      const workspace = workspaceSelection(root, options.workspace);
      const workspaceRoot = workspace?.root;
      return runStandaloneGraph({
        repo: {
          root,
          scope: { kind: 'project', projectIds: ['project:implicit-single-repository'] },
          ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
          providers: createStandardRepositoryProviders(),
          policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
          ports,
        },
        mode: options.mode,
        workspace,
        workspacePolicy: {
          network: 'deny',
          redactionProfile: 'portable-default',
          composition: GRAPH_STANDARD_COMPOSITION_POLICY,
        },
        write: options.write,
        projectStore: options.write ? createNodeProjectArtifactStore(root) : undefined,
        workspaceStore:
          options.write && workspaceRoot
            ? createNodeWorkspaceArtifactStore(workspaceRoot)
            : undefined,
        interaction: { approved: true },
        signal,
      });
    },
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
    return GRAPH_CLI_EXIT_CODES.rejected;
  }
  if (options === 'help') {
    io.writeOut(HELP);
    return GRAPH_CLI_EXIT_CODES.success;
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
      return GRAPH_CLI_EXIT_CODES.rejected;
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
    return GRAPH_CLI_EXIT_CODES.success;
  }

  if (options.command === 'inspect' && options.mode !== 'project-only') {
    const orchestration = await dependencies.standalone(
      options.root,
      { mode: options.mode, workspace: options.workspace, write: options.write },
      signal
    );
    if (!orchestration.accepted) {
      const payload = envelope('inspect', 'failed', null, [
        ...orchestration.issues.map((issue) => ({
          code: issue.code,
          severity: 'error' as const,
          path: issue.path,
          message: issue.message,
        })),
      ]);
      emit(
        io,
        options.json,
        true,
        payload,
        `Graph inspect rejected. ${orchestration.issues.map((item) => item.message).join(' ')}`
      );
      return GRAPH_CLI_EXIT_CODES.rejected;
    }
    const status = dualScopeCliStatus(orchestration.value.status);
    emit(
      io,
      options.json,
      false,
      envelope('inspect', status, orchestration.value, orchestration.value.diagnostics),
      `Graph inspect: ${orchestration.value.status}\nWorkspace: ${orchestration.value.workspace.status}${orchestration.value.workspace.renewalCommand ? `\nRenewal: ${orchestration.value.workspace.renewalCommand}` : ''}`
    );
    if (orchestration.value.status === 'failed') return GRAPH_CLI_EXIT_CODES.failed;
    if (orchestration.value.status === 'partial') return GRAPH_CLI_EXIT_CODES.partial;
    return GRAPH_CLI_EXIT_CODES.success;
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
    return build.status === 'cancelled'
      ? GRAPH_CLI_EXIT_CODES.cancelled
      : GRAPH_CLI_EXIT_CODES.failed;
  }

  if (options.command === 'inspect') {
    const view =
      options.view && build.quality.graph
        ? dependencies.project(build.graph, build.quality.graph, options.view)
        : undefined;
    if (view && !view.accepted) {
      emit(
        io,
        options.json,
        true,
        envelope(
          'inspect',
          'failed',
          view,
          view.issues.map((issue) => ({ ...issue, severity: 'error' as const }))
        ),
        `Graph view failed. ${view.issues.map((issue) => issue.message).join(' ')}`
      );
      return GRAPH_CLI_EXIT_CODES.rejected;
    }
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
      return publication.issues.some((issue) => issue.code.includes('CANCELLED'))
        ? GRAPH_CLI_EXIT_CODES.cancelled
        : GRAPH_CLI_EXIT_CODES.publicationFailed;
    }
    emit(
      io,
      options.json,
      false,
      envelope(
        'inspect',
        build.status,
        {
          ...(view?.accepted
            ? {
                build: {
                  status: build.status,
                  quality: build.quality,
                  providers: build.providers,
                  diagnostics: build.diagnostics,
                  metrics: build.metrics,
                },
                view: view.value,
              }
            : { build }),
          ...(publication ? { publication: publication.value } : {}),
        },
        build.diagnostics
      ),
      `Graph preview: ${build.status}\nFiles: ${build.metrics.inputFiles}\nNodes: ${view?.accepted ? view.value.nodes.length : build.graph.nodes.length}\nEdges: ${view?.accepted ? view.value.edges.length : build.graph.edges.length}${options.view ? `\nView: ${options.view}` : ''}${publication ? `\nPublication: ${publication.value.status}` : ''}`
    );
    return GRAPH_CLI_EXIT_CODES.success;
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
    return build.status === 'partial' ? GRAPH_CLI_EXIT_CODES.partial : GRAPH_CLI_EXIT_CODES.success;
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
    return result.code === 'resource-limit'
      ? GRAPH_CLI_EXIT_CODES.partial
      : GRAPH_CLI_EXIT_CODES.rejected;
  }
  const slice = options.slice ? dependencies.slice(result) : undefined;
  if (slice && !slice.accepted) {
    emit(
      io,
      options.json,
      true,
      envelope(
        'query',
        'failed',
        slice,
        slice.issues.map((issue) => ({ ...issue, severity: 'error' as const }))
      ),
      `Graph review context slice failed. ${slice.issues.map((issue) => issue.message).join(' ')}`
    );
    return GRAPH_CLI_EXIT_CODES.rejected;
  }
  emit(
    io,
    options.json,
    false,
    envelope(
      'query',
      build.status,
      slice?.accepted ? slice.value : result.value,
      build.diagnostics
    ),
    `Graph query: ${build.status}\nPreset: ${options.preset ?? ''}${slice?.accepted ? '\nOutput: bounded review context slice' : ''}`
  );
  return GRAPH_CLI_EXIT_CODES.success;
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

type GraphCliRealpath = (value: string) => string;

/** Compares executable identity after resolving platform path aliases and symlinks. */
export function isDirectGraphCliInvocation(
  argvPath: string | undefined,
  moduleUrl: string,
  resolveRealpath: GraphCliRealpath = realpathSync
): boolean {
  if (!argvPath) return false;
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  const canonical = (value: string): string => {
    const resolved = path.resolve(value);
    let real = resolved;
    try {
      real = resolveRealpath(resolved);
    } catch {
      // A lexical comparison still gives imported/test hosts a fail-closed fallback.
    }
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  return canonical(argvPath) === canonical(modulePath);
}

if (isDirectGraphCliInvocation(process.argv[1], import.meta.url)) {
  void main();
}
