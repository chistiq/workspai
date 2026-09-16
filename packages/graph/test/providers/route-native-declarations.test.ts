import { describe, expect, it } from 'vitest';

import type { GraphNativePort } from '../../src/ports/index.js';
import { extractMatrixDeclarations } from '../../src/providers/matrix-source-language.js';
import { routeGraphNativeDeclarations } from '../../src/providers/route-native-declarations.js';

function port(
  declarations: readonly {
    name: string;
    detail: 'function' | 'type' | 'value' | 'method';
    line: number;
  }[],
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
      status: 'complete',
      nodes: [],
      diagnostics: [],
      metrics: { durationMs: 0, inputEdges: 0, outputNodes: 0 },
    }),
    extractDeclarations: () => ({
      status,
      declarations,
      diagnostics:
        status === 'complete'
          ? []
          : [
              {
                code: 'GRAPH_NATIVE_ENGINE_TRAPPED',
                severity: 'error',
                path: '/native/declarations',
                message: 'forced failure',
              },
            ],
      metrics: { durationMs: 0, inputBytes: 0, outputDeclarations: declarations.length },
    }),
  };
}

describe('Graph native declaration routing', () => {
  const source = 'export function listItems(): void {}\n';

  it('keeps TypeScript as the authority when native is unavailable or mismatched', () => {
    const reference = extractMatrixDeclarations(source, 'node');
    expect(routeGraphNativeDeclarations(source, 'node', undefined)).toEqual({
      engine: 'typescript',
      reason: 'native-unavailable',
      declarations: reference,
    });
    expect(routeGraphNativeDeclarations(source, 'node', port([], 'failed'))).toEqual({
      engine: 'typescript',
      reason: 'native-failed',
      declarations: reference,
    });
    expect(
      routeGraphNativeDeclarations(
        source,
        'node',
        port([{ name: 'other', detail: 'function', line: 1 }])
      )
    ).toEqual({
      engine: 'typescript',
      reason: 'native-mismatch',
      declarations: reference,
    });
  });

  it('selects the bundled engine only when declarations match TypeScript', () => {
    const reference = extractMatrixDeclarations(source, 'node');
    expect(routeGraphNativeDeclarations(source, 'node', port(reference))).toEqual({
      engine: 'rust-wasm',
      reason: 'parity-qualified',
      declarations: reference,
    });
  });
});
