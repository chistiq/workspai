import { parentPort } from 'node:worker_threads';

import {
  GRAPH_REFERENCE_COMPOSITION_TASK,
  executeGraphReferenceCompositionTask,
} from '../../application/compose-graph.js';
import type { GraphCompositionRequest } from '../../application/composition-types.js';
import type { GraphWorkerTaskRequest, GraphWorkerTaskResult } from '../../ports/index.js';

const encoder = new TextEncoder();

if (!parentPort) throw new Error('Graph reference worker requires a worker-thread parent port.');
const workerParentPort = parentPort;

workerParentPort.once('message', (request: GraphWorkerTaskRequest<GraphCompositionRequest>) => {
  const startedAt = performance.now();
  let result: GraphWorkerTaskResult<unknown>;
  try {
    if (
      request.task.id !== GRAPH_REFERENCE_COMPOSITION_TASK.id ||
      request.task.version !== GRAPH_REFERENCE_COMPOSITION_TASK.version
    ) {
      result = {
        status: 'unsupported',
        diagnostics: [],
        metrics: {
          durationMs: performance.now() - startedAt,
          inputBytes: encoder.encode(JSON.stringify(request.input)).byteLength,
          outputBytes: 0,
        },
      };
    } else {
      const output = executeGraphReferenceCompositionTask(request.input);
      const inputBytes = encoder.encode(JSON.stringify(request.input)).byteLength;
      const outputBytes = encoder.encode(JSON.stringify(output)).byteLength;
      result =
        outputBytes > request.maxOutputBytes
          ? {
              status: 'resource-limit',
              diagnostics: [
                {
                  code: 'GRAPH_NODE_WORKER_OUTPUT_LIMIT',
                  severity: 'error',
                  path: '/workers/node/output',
                  message: `Worker output exceeded its ${request.maxOutputBytes} byte budget.`,
                },
              ],
              metrics: { durationMs: performance.now() - startedAt, inputBytes, outputBytes },
            }
          : {
              status: 'complete',
              output,
              diagnostics: [],
              metrics: { durationMs: performance.now() - startedAt, inputBytes, outputBytes },
            };
    }
  } catch (error) {
    result = {
      status: 'failed',
      diagnostics: [
        {
          code: 'GRAPH_NODE_WORKER_EXECUTION_FAILED',
          severity: 'error',
          path: '/workers/node',
          message: error instanceof Error ? error.message : 'Graph worker execution failed.',
        },
      ],
      metrics: {
        durationMs: performance.now() - startedAt,
        inputBytes: 0,
        outputBytes: 0,
      },
    };
  }
  workerParentPort.postMessage(result);
});
