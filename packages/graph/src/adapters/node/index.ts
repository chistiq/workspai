import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  GraphWorkerPoolPort,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../ports/index.js';
import type { GraphProductHostPorts } from '../../ports/index.js';
import { buildRepoGraph, GRAPH_STANDARD_REPO_BUILD_POLICY } from '../../application/index.js';
import type { GraphRepoBuildPolicy, GraphRepoBuildResult } from '../../application/index.js';
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
  workerUrl: URL = new URL('./reference-worker-entry.js', import.meta.url)
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
            // workers fail before startup. Preserve all other host execution flags.
            execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
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
