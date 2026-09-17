import { describe, expect, it } from 'vitest';

import {
  referenceGraphNativeTraversal,
  routeGraphNativeTraversal,
} from '../../src/application/route-native-traversal.js';
import type { GraphNativePort, GraphNativeTraversalRequest } from '../../src/ports/index.js';

function port(
  nodes: readonly number[],
  status: 'complete' | 'failed' = 'complete'
): GraphNativePort {
  return {
    descriptor: {
      engine: 'rust-wasm',
      abiVersion: 1,
      artifact: 'product-bundled',
      semanticAuthority: 'typescript',
      dynamicDownload: 'prohibited',
      userToolchain: 'not-required',
      maxNodes: 1_000_000,
      maxEdges: 5_000_000,
      maxMemoryBytes: 268_435_456,
    },
    artifactDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    traverseReachable: () => ({
      status,
      nodes,
      diagnostics:
        status === 'complete'
          ? []
          : [
              {
                code: 'GRAPH_NATIVE_ENGINE_TRAPPED',
                severity: 'error',
                path: '/native/traversal',
                message: 'forced failure',
              },
            ],
      metrics: { durationMs: 0, inputEdges: 0, outputNodes: nodes.length },
    }),
  };
}

describe('Graph native traversal routing', () => {
  const request: GraphNativeTraversalRequest = {
    nodeCount: 3,
    edges: [
      [0, 1],
      [1, 2],
    ],
    start: 0,
    maxDepth: 2,
  };

  it('keeps TypeScript as the authority when native is unavailable or mismatched', () => {
    const reference = referenceGraphNativeTraversal(request);
    expect(routeGraphNativeTraversal(request, undefined)).toEqual({
      engine: 'typescript',
      reason: 'native-unavailable',
      nodes: reference,
    });
    expect(routeGraphNativeTraversal(request, port([0], 'failed'))).toEqual({
      engine: 'typescript',
      reason: 'native-failed',
      nodes: reference,
    });
    expect(routeGraphNativeTraversal(request, port([2, 1, 0]))).toEqual({
      engine: 'typescript',
      reason: 'native-mismatch',
      nodes: reference,
    });
  });

  it('selects the bundled engine only when the node identity matches TypeScript', () => {
    const reference = referenceGraphNativeTraversal(request);
    expect(routeGraphNativeTraversal(request, port(reference))).toEqual({
      engine: 'rust-wasm',
      reason: 'parity-qualified',
      nodes: reference,
    });
  });
});
