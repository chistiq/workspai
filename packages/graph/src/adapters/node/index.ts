import { Worker } from 'node:worker_threads';

import type {
  GraphWorkerPoolPort,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../ports/index.js';

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
export function createNodeGraphReferenceWorkerPool(): GraphWorkerPoolPort {
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
          worker = new Worker(new URL('./reference-worker-entry.js', import.meta.url), {
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
