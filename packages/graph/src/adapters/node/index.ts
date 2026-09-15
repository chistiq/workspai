import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  GraphWorkerPoolPort,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../ports/index.js';
import type { GraphProductHostPorts } from '../../ports/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  collectGraphSemanticDependencies,
  contentStateLeavesFromProviderInputs,
  type GraphIncrementalRepoBuildResult,
  type GraphRepoBuildPolicy,
  type GraphRepoBuildResult,
} from '../../application/index.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphOntologyProfile,
  type GraphProviderRuntime,
  type GraphScope,
} from '../../contracts/index.js';
import { createStandardRepositoryProviders } from '../../providers/index.js';

import { createNodeGraphFileSource } from './repository-file-source.js';

export { createNodeGraphFileSource } from './repository-file-source.js';
export { createNodeProjectArtifactStore } from './project-artifact-store.js';
export { createNodeWorkspaceArtifactStore } from './workspace-artifact-store.js';
export {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
  reclaimBundledEngineBuffers,
  type GraphNativeAdapterLoadErrorCode,
} from './rust-wasm-engine.js';
export {
  referenceGraphNativeTraversal,
  routeGraphNativeTraversal,
  type GraphNativeTraversalRoute,
} from '../../application/route-native-traversal.js';

export interface NodeRepoGraphBuildRequest {
  readonly root: string;
  readonly scope?: GraphScope;
  readonly ontology?: GraphOntologyProfile;
  readonly providers?: readonly GraphProviderRuntime[];
  readonly policy?: GraphRepoBuildPolicy;
  readonly signal?: AbortSignal;
  /** Overrides the packaged reference worker location for bundled executable hosts. */
  readonly workerUrl?: URL;
}

function inheritedWorkerExecArgv(workerUrl: URL): string[] {
  const javascriptWorker = workerUrl.pathname.endsWith('.js');
  const args: string[] = [];
  const source = process.execArgv.filter((argument) => !argument.startsWith('--input-type'));
  for (let index = 0; index < source.length; index += 1) {
    const argument = source[index];
    const next = source[index + 1];
    if (javascriptWorker && argument === '--import' && next === 'tsx') {
      index += 1;
      continue;
    }
    args.push(argument);
  }
  return args;
}

function packagedReferenceWorkerUrl(): URL {
  try {
    const adapterEntry = import.meta.resolve('@workspai/graph/adapters/node');
    return new URL('./reference-worker-entry.js', adapterEntry);
  } catch {
    // Source-level and non-package consumers retain the adjacent-entry fallback.
    return new URL('./reference-worker-entry.js', import.meta.url);
  }
}

function emptyResult<TOutput>(
  status: 'failed' | 'cancelled' | 'resource-limit',
  code: string,
  message: string,
  durationMs: number
): GraphWorkerTaskResult<TOutput> {
  return {
    status,
    diagnostics: [
      {
        code,
        severity: status === 'cancelled' ? 'info' : 'error',
        path: '/workers/node',
        message,
      },
    ],
    metrics: { durationMs, inputBytes: 0, outputBytes: 0 },
  };
}

/**
 * Creates a bounded one-task-per-worker Node adapter for the portable Graph
 * reference task protocol. Worker isolation is an execution concern only and
 * cannot redefine composition semantics.
 */
export function createNodeGraphReferenceWorkerPool(
  workerUrl: URL = packagedReferenceWorkerUrl()
): GraphWorkerPoolPort {
  return {
    execute<TInput, TOutput>(
      request: GraphWorkerTaskRequest<TInput>
    ): Promise<GraphWorkerTaskResult<TOutput>> {
      const startedAt = performance.now();
      if (request.signal?.aborted) {
        return Promise.resolve(
          emptyResult('cancelled', 'GRAPH_NODE_WORKER_CANCELLED', 'Task was already cancelled.', 0)
        );
      }
      if (
        !Number.isInteger(request.timeoutMs) ||
        request.timeoutMs <= 0 ||
        !Number.isInteger(request.maxOutputBytes) ||
        request.maxOutputBytes <= 0
      ) {
        return Promise.resolve(
          emptyResult(
            'resource-limit',
            'GRAPH_NODE_WORKER_BUDGET_INVALID',
            'Worker timeout and output budgets must be positive integers.',
            0
          )
        );
      }

      return new Promise((resolve) => {
        let worker: Worker;
        try {
          worker = new Worker(workerUrl, {
            // Eval/STDIN-only flags inherited from a host process make file-backed
            // workers fail before startup. Bare `--import tsx` also fails after the
            // host chdirs away from the package, so JavaScript workers drop it.
            execArgv: inheritedWorkerExecArgv(workerUrl),
          });
        } catch (error) {
          resolve(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_START_FAILED',
              error instanceof Error ? error.message : 'Worker could not be started.',
              performance.now() - startedAt
            )
          );
          return;
        }
        let settled = false;
        const finish = (result: GraphWorkerTaskResult<TOutput>): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', cancel);
          void worker.terminate();
          resolve(result);
        };
        const cancel = (): void => {
          finish(
            emptyResult(
              'cancelled',
              'GRAPH_NODE_WORKER_CANCELLED',
              'Task was cancelled before completion.',
              performance.now() - startedAt
            )
          );
        };
        const timeout = setTimeout(() => {
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_TIMEOUT',
              `Task exceeded its ${request.timeoutMs}ms execution budget.`,
              performance.now() - startedAt
            )
          );
        }, request.timeoutMs);
        timeout.unref();
        request.signal?.addEventListener('abort', cancel, { once: true });
        worker.once('message', (result: GraphWorkerTaskResult<TOutput>) => finish(result));
        worker.once('error', (error) =>
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_CRASHED',
              error.message,
              performance.now() - startedAt
            )
          )
        );
        worker.once('exit', (code) => {
          if (code !== 0)
            finish(
              emptyResult(
                'failed',
                'GRAPH_NODE_WORKER_EXITED',
                `Worker exited with code ${code}.`,
                performance.now() - startedAt
              )
            );
        });
        const { signal: _signal, ...portableRequest } = request;
        try {
          worker.postMessage(portableRequest);
        } catch (error) {
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_INPUT_NOT_PORTABLE',
              error instanceof Error ? error.message : 'Worker input could not be transferred.',
              performance.now() - startedAt
            )
          );
        }
      });
    },
  };
}

export function createNodeGraphProductHostPorts(
  options: { readonly signal?: AbortSignal; readonly workerUrl?: URL } = {}
): GraphProductHostPorts {
  const signal = options.signal;
  return {
    clock: { now: () => new Date() },
    digest: {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => {
        const hash = createHash('sha256');
        return {
          update: (chunk: Uint8Array) => {
            hash.update(chunk);
          },
          digest: async () => hash.digest('hex'),
        };
      },
    },
    cancellation: {
      get aborted() {
        return signal?.aborted === true;
      },
      throwIfAborted: () => signal?.throwIfAborted(),
    },
    scheduler: { yield: () => waitForImmediate() },
    workers: createNodeGraphReferenceWorkerPool(options.workerUrl),
    fileSource: createNodeGraphFileSource(),
    signal,
  };
}

/**
 * Runs the package-owned, offline repository preview with secure Node host adapters.
 * It does not create Workspai metadata, execute project code or persist a graph.
 */
export function buildNodeRepoGraph(
  request: NodeRepoGraphBuildRequest
): Promise<GraphRepoBuildResult> {
  return buildRepoGraph({
    root: request.root,
    scope: request.scope ?? {
      kind: 'project',
      projectIds: ['project:implicit-single-repository'],
    },
    ontology: request.ontology ?? CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: request.providers ?? createStandardRepositoryProviders(),
    policy: request.policy ?? GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: createNodeGraphProductHostPorts({
      signal: request.signal,
      workerUrl: request.workerUrl,
    }),
  });
}

const NODE_INCREMENTAL_SCAN_PROFILE = Object.freeze({
  algorithm: 'sha256' as const,
  value: createHash('sha256').update('workspai.graph.node-product-scan-profile.v1').digest('hex'),
});

export interface NodeIncrementalRepoGraphBuildRequest extends NodeRepoGraphBuildRequest {
  readonly base: GraphRepoBuildResult;
}

/**
 * Runs skip-reread incremental rebuild through the Node product host.
 * This host has no change journal, so skip-reread is not trusted unless a
 * journal port is later injected. Equivalence against the same tree is still
 * assessed.
 */
export async function buildNodeIncrementalRepoGraph(
  request: NodeIncrementalRepoGraphBuildRequest
): Promise<GraphIncrementalRepoBuildResult> {
  if (!request.base.graph || !request.base.compositionSources) {
    throw new Error(
      'Incremental Node Graph build requires a complete base generation with composition sources.'
    );
  }
  const scope = request.scope ?? {
    kind: 'project',
    projectIds: ['project:implicit-single-repository'],
  };
  const ontology = request.ontology ?? CORE_GRAPH_ONTOLOGY_PROFILE;
  const providers = request.providers ?? createStandardRepositoryProviders();
  const policy = request.policy ?? GRAPH_STANDARD_REPO_BUILD_POLICY;
  const ports = createNodeGraphProductHostPorts({
    signal: request.signal,
    workerUrl: request.workerUrl,
  });
  const inventory = await ports.fileSource.inventory({
    root: request.root,
    maxFiles: policy.limits.maxFiles,
    maxTotalBytes: policy.limits.maxTotalBytes,
    maxFileBytes: policy.limits.maxFileBytes,
    maxDepth: policy.limits.maxDepth,
    maxDirectoryEntries: policy.limits.maxDirectoryEntries,
    excludedDirectories: policy.excludedDirectories,
    sensitiveFiles: policy.sensitiveFiles,
    signal: request.signal,
  });
  const stamps = await collectGraphSemanticDependencies({
    ontology,
    compositionPolicy: policy.composition,
    redactionProfile: policy.redactionProfile,
    providerManifests: providers.map((provider) => provider.manifest),
    digest: ports.digest,
  });
  const baseManifest = buildContentStateManifest({
    scope,
    generatedAt: request.base.graph.generation.reference.generatedAt,
    scanProfileDigest: NODE_INCREMENTAL_SCAN_PROFILE,
    leaves: contentStateLeavesFromProviderInputs(inventory.inputs, NODE_INCREMENTAL_SCAN_PROFILE),
    shardDependencies: buildShardDependenciesFromSources(request.base.compositionSources, stamps),
  });
  return buildIncrementalRepoGraph({
    root: request.root,
    scope,
    ontology,
    providers,
    policy,
    ports,
    baseManifest,
    baseGeneration: request.base.graph.generation.reference.id,
    targetGeneration: `${request.base.graph.generation.reference.id}:incremental`,
    baseSources: request.base.compositionSources,
    providersToRecompute: [],
    scanProfileDigest: NODE_INCREMENTAL_SCAN_PROFILE,
    referenceGenerationDigest: request.base.graph.generation.reference.contentDigest,
    baseGraph: request.base.graph,
  });
}
