import { readFile } from 'node:fs/promises';

import type {
  GraphNativePort,
  GraphNativeTraversalRequest,
  GraphNativeTraversalResult,
} from '../../ports/index.js';

const ABI_VERSION = 1;
const MAX_NODES = 1_000_000;
const MAX_EDGES = 5_000_000;
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const UINT32_MAX = 0xffff_ffff;

export type GraphNativeAdapterLoadErrorCode =
  | 'GRAPH_NATIVE_ARTIFACT_UNAVAILABLE'
  | 'GRAPH_NATIVE_ARTIFACT_INVALID'
  | 'GRAPH_NATIVE_DYNAMIC_IMPORT_PROHIBITED'
  | 'GRAPH_NATIVE_ABI_EXPORT_MISSING'
  | 'GRAPH_NATIVE_ABI_VERSION_MISMATCH'
  | 'GRAPH_NATIVE_RESOURCE_LIMIT_MISMATCH';

export class GraphNativeAdapterLoadError extends Error {
  readonly code: GraphNativeAdapterLoadErrorCode;

  constructor(code: GraphNativeAdapterLoadErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'GraphNativeAdapterLoadError';
    this.code = code;
  }
}

interface WasmMemory {
  readonly buffer: ArrayBuffer;
}

interface WasmApi {
  compile(bytes: Uint8Array): Promise<unknown>;
  instantiate(module: unknown, imports: Record<string, never>): Promise<{ exports: unknown }>;
  Module: {
    imports(module: unknown): readonly unknown[];
  };
}

interface GraphEngineExports {
  readonly memory: WasmMemory;
  readonly graph_engine_abi_version: () => number;
  readonly graph_engine_memory_limit_bytes: () => number;
  readonly graph_engine_max_nodes: () => number;
  readonly graph_engine_max_edges: () => number;
  readonly graph_engine_alloc_u32: (length: number) => number;
  readonly graph_engine_dealloc_u32: (pointer: number, capacity: number) => void;
  readonly graph_engine_reachable: (
    nodeCount: number,
    edgeWordsPointer: number,
    edgeCount: number,
    start: number,
    maxDepth: number,
    outputPointer: number,
    outputCapacity: number
  ) => number;
}

const ERROR_CODES: Readonly<Record<number, string>> = Object.freeze({
  [-1]: 'GRAPH_NATIVE_NODE_COUNT_INVALID',
  [-2]: 'GRAPH_NATIVE_START_INVALID',
  [-3]: 'GRAPH_NATIVE_EDGE_LIMIT_EXCEEDED',
  [-4]: 'GRAPH_NATIVE_EDGE_INVALID',
  [-5]: 'GRAPH_NATIVE_OUTPUT_LIMIT_EXCEEDED',
});

function result(
  status: GraphNativeTraversalResult['status'],
  request: GraphNativeTraversalRequest,
  startedAt: number,
  nodes: readonly number[] = [],
  code?: string,
  message?: string
): GraphNativeTraversalResult {
  return {
    status,
    nodes: Object.freeze([...nodes]),
    diagnostics:
      code && message
        ? Object.freeze([
            Object.freeze({
              code,
              severity: 'error' as const,
              path: '/native/traversal' as const,
              message,
            }),
          ])
        : Object.freeze([]),
    metrics: Object.freeze({
      durationMs: performance.now() - startedAt,
      inputEdges: request.edges.length,
      outputNodes: nodes.length,
    }),
  };
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

function validateRequest(request: GraphNativeTraversalRequest): string | undefined {
  if (!isUint32(request.nodeCount) || request.nodeCount === 0 || request.nodeCount > MAX_NODES) {
    return 'nodeCount must be a positive uint32 within the engine limit.';
  }
  if (!isUint32(request.start) || request.start >= request.nodeCount) {
    return 'start must identify a node in the bounded graph.';
  }
  if (!isUint32(request.maxDepth)) return 'maxDepth must be a uint32.';
  if (request.edges.length > MAX_EDGES) return 'edges exceed the engine limit.';
  for (const edge of request.edges) {
    if (
      edge.length !== 2 ||
      !isUint32(edge[0]) ||
      !isUint32(edge[1]) ||
      edge[0] >= request.nodeCount ||
      edge[1] >= request.nodeCount
    ) {
      return 'Every edge must contain two in-range uint32 node identifiers.';
    }
  }
  return undefined;
}

function assertExports(exports: unknown): asserts exports is GraphEngineExports {
  const candidate = exports as Partial<GraphEngineExports>;
  if (
    !candidate.memory ||
    !(candidate.memory.buffer instanceof ArrayBuffer) ||
    typeof candidate.graph_engine_abi_version !== 'function' ||
    typeof candidate.graph_engine_memory_limit_bytes !== 'function' ||
    typeof candidate.graph_engine_max_nodes !== 'function' ||
    typeof candidate.graph_engine_max_edges !== 'function' ||
    typeof candidate.graph_engine_alloc_u32 !== 'function' ||
    typeof candidate.graph_engine_dealloc_u32 !== 'function' ||
    typeof candidate.graph_engine_reachable !== 'function'
  ) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ABI_EXPORT_MISSING');
  }
  if (candidate.graph_engine_abi_version() !== ABI_VERSION) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ABI_VERSION_MISMATCH');
  }
  if (
    candidate.graph_engine_memory_limit_bytes() !== MAX_MEMORY_BYTES ||
    candidate.graph_engine_max_nodes() !== MAX_NODES ||
    candidate.graph_engine_max_edges() !== MAX_EDGES
  ) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_RESOURCE_LIMIT_MISMATCH');
  }
}

function packagedEngineUrl(): URL {
  try {
    const adapterEntry = import.meta.resolve('@workspai/graph/adapters/node');
    return new URL('../../native/graph-engine.wasm', adapterEntry);
  } catch {
    return new URL('../../../dist/native/graph-engine.wasm', import.meta.url);
  }
}

/** Loads the product-bundled engine. It performs no download and never invokes Cargo. */
export async function createNodeRustWasmGraphNativePort(
  engineUrl: URL = packagedEngineUrl()
): Promise<GraphNativePort> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(engineUrl);
  } catch (error) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_UNAVAILABLE', error);
  }
  const wasm = (globalThis as unknown as { readonly WebAssembly: WasmApi }).WebAssembly;
  let module: unknown;
  try {
    module = await wasm.compile(bytes);
  } catch (error) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_INVALID', error);
  }
  if (wasm.Module.imports(module).length !== 0) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_DYNAMIC_IMPORT_PROHIBITED');
  }
  let instance: { exports: unknown };
  try {
    instance = await wasm.instantiate(module, {});
  } catch (error) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_INVALID', error);
  }
  assertExports(instance.exports);
  const engine = instance.exports;

  return Object.freeze({
    descriptor: Object.freeze({
      engine: 'rust-wasm' as const,
      abiVersion: ABI_VERSION,
      artifact: 'product-bundled' as const,
      semanticAuthority: 'typescript' as const,
      dynamicDownload: 'prohibited' as const,
      userToolchain: 'not-required' as const,
      maxNodes: MAX_NODES,
      maxEdges: MAX_EDGES,
      maxMemoryBytes: MAX_MEMORY_BYTES,
    }),
    traverseReachable(request: GraphNativeTraversalRequest): GraphNativeTraversalResult {
      const startedAt = performance.now();
      const invalid = validateRequest(request);
      if (invalid) {
        return result('rejected', request, startedAt, [], 'GRAPH_NATIVE_INPUT_REJECTED', invalid);
      }

      const edgeWordCount = request.edges.length * 2;
      const outputCapacity = request.nodeCount;
      let edgePointer = 0;
      let outputPointer = 0;
      try {
        edgePointer = engine.graph_engine_alloc_u32(edgeWordCount);
        outputPointer = engine.graph_engine_alloc_u32(outputCapacity);
        if ((edgeWordCount > 0 && edgePointer === 0) || outputPointer === 0) {
          return result(
            'failed',
            request,
            startedAt,
            [],
            'GRAPH_NATIVE_ALLOCATION_FAILED',
            'The bundled engine could not allocate bounded traversal memory.'
          );
        }
        if (edgeWordCount > 0) {
          const edgeMemory = new Uint32Array(engine.memory.buffer, edgePointer, edgeWordCount);
          let offset = 0;
          for (const [from, to] of request.edges) {
            edgeMemory[offset++] = from;
            edgeMemory[offset++] = to;
          }
        }
        const length = engine.graph_engine_reachable(
          request.nodeCount,
          edgePointer,
          request.edges.length,
          request.start,
          request.maxDepth,
          outputPointer,
          outputCapacity
        );
        if (length < 0) {
          const code = ERROR_CODES[length] ?? 'GRAPH_NATIVE_ENGINE_REJECTED';
          return result(
            'rejected',
            request,
            startedAt,
            [],
            code,
            `Bundled engine rejected input (${length}).`
          );
        }
        if (length > outputCapacity) {
          return result(
            'failed',
            request,
            startedAt,
            [],
            'GRAPH_NATIVE_OUTPUT_INVALID',
            'Bundled engine returned an output beyond its declared capacity.'
          );
        }
        const nodes = Array.from(new Uint32Array(engine.memory.buffer, outputPointer, length));
        return result('complete', request, startedAt, nodes);
      } catch (error) {
        return result(
          'failed',
          request,
          startedAt,
          [],
          'GRAPH_NATIVE_ENGINE_TRAPPED',
          error instanceof Error ? error.message : 'Bundled engine execution failed.'
        );
      } finally {
        if (edgePointer !== 0) engine.graph_engine_dealloc_u32(edgePointer, edgeWordCount);
        if (outputPointer !== 0) engine.graph_engine_dealloc_u32(outputPointer, outputCapacity);
      }
    },
  });
}
