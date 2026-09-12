import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
} from '../../src/adapters/node/index.js';
import type { GraphNativeTraversalRequest } from '../../src/ports/index.js';

const engineUrl = new URL('../../dist/native/graph-engine.wasm', import.meta.url);

function referenceTraversal(request: GraphNativeTraversalRequest): readonly number[] {
  const adjacency = Array.from({ length: request.nodeCount }, () => new Set<number>());
  for (const [from, to] of request.edges) adjacency[from]?.add(to);
  const ordered = adjacency.map((neighbors) => [...neighbors].sort((left, right) => left - right));
  const depths = new Array<number>(request.nodeCount).fill(Number.POSITIVE_INFINITY);
  const queue = [request.start];
  const output: number[] = [];
  depths[request.start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor];
    if (node === undefined) break;
    output.push(node);
    const depth = depths[node] ?? Number.POSITIVE_INFINITY;
    if (depth >= request.maxDepth) continue;
    for (const neighbor of ordered[node] ?? []) {
      if (depths[neighbor] === Number.POSITIVE_INFINITY) {
        depths[neighbor] = depth + 1;
        queue.push(neighbor);
      }
    }
  }
  return output;
}

function seededRequests(): readonly GraphNativeTraversalRequest[] {
  let state = 0x5eed_1234;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  return Array.from({ length: 64 }, () => {
    const nodeCount = 2 + (next() % 79);
    const edgeCount = next() % (nodeCount * 4);
    const edges = Array.from(
      { length: edgeCount },
      () => [next() % nodeCount, next() % nodeCount] as const
    );
    return {
      nodeCount,
      edges,
      start: next() % nodeCount,
      maxDepth: next() % (nodeCount + 2),
    };
  });
}

describe('bundled Rust WASM Graph native port', () => {
  it('loads a self-contained product artifact without a user toolchain', async () => {
    const bytes = await readFile(engineUrl);
    const wasm = (
      globalThis as unknown as {
        readonly WebAssembly: {
          readonly Module: {
            new (bytes: Uint8Array): unknown;
            imports(module: unknown): readonly unknown[];
          };
        };
      }
    ).WebAssembly;
    const module = new wasm.Module(bytes);
    expect(wasm.Module.imports(module)).toEqual([]);

    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    expect(port.descriptor).toEqual({
      engine: 'rust-wasm',
      abiVersion: 1,
      artifact: 'product-bundled',
      semanticAuthority: 'typescript',
      dynamicDownload: 'prohibited',
      userToolchain: 'not-required',
      maxNodes: 1_000_000,
      maxEdges: 5_000_000,
      maxMemoryBytes: 268_435_456,
    });
  });

  it('matches the TypeScript reference semantics across deterministic fixtures', async () => {
    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    const fixed: readonly GraphNativeTraversalRequest[] = [
      { nodeCount: 1, edges: [], start: 0, maxDepth: 0 },
      {
        nodeCount: 6,
        edges: [
          [0, 2],
          [2, 4],
          [0, 1],
          [1, 3],
          [0, 1],
          [4, 0],
        ],
        start: 0,
        maxDepth: 2,
      },
      {
        nodeCount: 4,
        edges: [
          [3, 0],
          [2, 3],
          [1, 2],
          [0, 1],
        ],
        start: 2,
        maxDepth: 10,
      },
    ];
    for (const request of [...fixed, ...seededRequests()]) {
      const execution = port.traverseReachable(request);
      expect(execution.status).toBe('complete');
      expect(execution.nodes).toEqual(referenceTraversal(request));
      expect(execution.diagnostics).toEqual([]);
    }
  });

  it('rejects malformed or unbounded input before crossing the ABI', async () => {
    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    for (const request of [
      { nodeCount: 0, edges: [], start: 0, maxDepth: 0 },
      { nodeCount: 2, edges: [], start: 2, maxDepth: 0 },
      { nodeCount: 2, edges: [[0, 2] as const], start: 0, maxDepth: 1 },
      { nodeCount: 2.5, edges: [], start: 0, maxDepth: 1 },
    ]) {
      const execution = port.traverseReachable(request);
      expect(execution.status).toBe('rejected');
      expect(execution.nodes).toEqual([]);
      expect(execution.diagnostics[0]?.code).toBe('GRAPH_NATIVE_INPUT_REJECTED');
    }
  });

  it('reports unavailable and corrupt artifacts as typed load failures', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-wasm-'));
    try {
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(path.join(directory, 'missing.wasm')))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_UNAVAILABLE',
      } satisfies Partial<GraphNativeAdapterLoadError>);

      const invalidPath = path.join(directory, 'invalid.wasm');
      await writeFile(invalidPath, new Uint8Array([0, 1, 2, 3]));
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(invalidPath))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_INVALID',
      } satisfies Partial<GraphNativeAdapterLoadError>);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
