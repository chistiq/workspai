import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { GraphStructuralLanguage } from '../../contracts/index.js';
import type {
  GraphNativeDeclaration,
  GraphNativeDeclarationRequest,
  GraphNativeDeclarationResult,
  GraphNativePort,
  GraphNativeTraversalRequest,
  GraphNativeTraversalResult,
} from '../../ports/index.js';

const ABI_VERSION = 1;
const MAX_NODES = 1_000_000;
const MAX_EDGES = 5_000_000;
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const MAX_DECLARATION_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DECLARATIONS = 16_384;
const LANGUAGE_UNSPECIFIED = 255;
const UINT32_MAX = 0xffff_ffff;
const NATIVE_DECLARATION_LANGUAGES: readonly GraphStructuralLanguage[] = Object.freeze([
  'node',
  'python',
  'go',
  'java',
  'dotnet',
  'rust',
  'c-cpp',
  'objective-c-matlab',
  'php',
  'ruby',
  'swift',
  'elixir',
  'kotlin',
]);
const DECLARATION_DETAILS = Object.freeze(['function', 'type', 'value', 'method'] as const);

export type GraphNativeAdapterLoadErrorCode =
  | 'GRAPH_NATIVE_ARTIFACT_UNAVAILABLE'
  | 'GRAPH_NATIVE_ARTIFACT_INVALID'
  | 'GRAPH_NATIVE_ARTIFACT_DIGEST_MISSING'
  | 'GRAPH_NATIVE_ARTIFACT_DIGEST_MISMATCH'
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
  Instance: new (module: unknown, imports: Record<string, never>) => { exports: unknown };
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
  readonly graph_engine_alloc_u8: (length: number) => number;
  readonly graph_engine_dealloc_u8: (pointer: number, capacity: number) => void;
  readonly graph_engine_reachable: (
    nodeCount: number,
    edgeWordsPointer: number,
    edgeCount: number,
    start: number,
    maxDepth: number,
    outputPointer: number,
    outputCapacity: number
  ) => number;
  readonly graph_engine_extract_declarations: (
    sourcePointer: number,
    sourceLen: number,
    language: number,
    recordsPointer: number,
    recordsCapacity: number,
    namesPointer: number,
    namesCapacity: number
  ) => number;
}

const ERROR_CODES: Readonly<Record<number, string>> = Object.freeze({
  [-1]: 'GRAPH_NATIVE_NODE_COUNT_INVALID',
  [-2]: 'GRAPH_NATIVE_START_INVALID',
  [-3]: 'GRAPH_NATIVE_EDGE_LIMIT_EXCEEDED',
  [-4]: 'GRAPH_NATIVE_EDGE_INVALID',
  [-5]: 'GRAPH_NATIVE_OUTPUT_LIMIT_EXCEEDED',
  [-11]: 'GRAPH_NATIVE_LANGUAGE_INVALID',
  [-12]: 'GRAPH_NATIVE_SOURCE_LIMIT_EXCEEDED',
  [-13]: 'GRAPH_NATIVE_DECLARATION_LIMIT_EXCEEDED',
  [-14]: 'GRAPH_NATIVE_SOURCE_INVALID',
  [-15]: 'GRAPH_NATIVE_OUTPUT_LIMIT_EXCEEDED',
  [-16]: 'GRAPH_NATIVE_OUTPUT_LIMIT_EXCEEDED',
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

function languageCode(language: GraphStructuralLanguage | null): number | undefined {
  if (language === null) return LANGUAGE_UNSPECIFIED;
  const index = NATIVE_DECLARATION_LANGUAGES.indexOf(language);
  return index >= 0 ? index : undefined;
}

function declarationResult(
  status: GraphNativeDeclarationResult['status'],
  startedAt: number,
  inputBytes: number,
  declarations: readonly GraphNativeDeclaration[] = [],
  code?: string,
  message?: string
): GraphNativeDeclarationResult {
  return {
    status,
    declarations: Object.freeze([...declarations]),
    diagnostics:
      code && message
        ? Object.freeze([
            Object.freeze({
              code,
              severity: 'error' as const,
              path: '/native/declarations' as const,
              message,
            }),
          ])
        : Object.freeze([]),
    metrics: Object.freeze({
      durationMs: performance.now() - startedAt,
      inputBytes,
      outputDeclarations: declarations.length,
    }),
  };
}

function validateDeclarationRequest(request: GraphNativeDeclarationRequest): string | undefined {
  if (typeof request.source !== 'string') return 'source must be a string.';
  if (languageCode(request.language) === undefined) {
    return 'language must be an official-offline matrix language or null.';
  }
  return undefined;
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
    typeof candidate.graph_engine_alloc_u8 !== 'function' ||
    typeof candidate.graph_engine_dealloc_u8 !== 'function' ||
    typeof candidate.graph_engine_reachable !== 'function' ||
    typeof candidate.graph_engine_extract_declarations !== 'function'
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

function declaredDigestUrl(engineUrl: URL): URL {
  return new URL(`${engineUrl.href}.sha256`);
}

/**
 * Reclaims traversal buffers without deallocating pointers that belong to a
 * trapped instance. Reinitialize first on trap; never free stale pointers
 * against a replacement engine.
 */
export function reclaimBundledEngineBuffers(input: {
  readonly trapped: boolean;
  readonly dealloc: () => void;
  readonly reinitialize: () => void;
}): void {
  if (input.trapped) {
    input.reinitialize();
    return;
  }
  try {
    input.dealloc();
  } catch {
    input.reinitialize();
  }
}

async function readDeclaredArtifactDigest(engineUrl: URL): Promise<string> {
  let declared: string;
  try {
    declared = (await readFile(declaredDigestUrl(engineUrl), 'utf8')).trim();
  } catch (error) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_DIGEST_MISSING', error);
  }
  if (!/^[a-f0-9]{64}$/u.test(declared)) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_DIGEST_MISSING');
  }
  return declared;
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
  const artifactDigest = {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(bytes).digest('hex'),
  };
  const declaredDigest = await readDeclaredArtifactDigest(engineUrl);
  if (declaredDigest !== artifactDigest.value) {
    throw new GraphNativeAdapterLoadError('GRAPH_NATIVE_ARTIFACT_DIGEST_MISMATCH');
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
  const instantiate = (): GraphEngineExports => {
    const instance = new wasm.Instance(module, {});
    assertExports(instance.exports);
    return instance.exports;
  };
  let engine = instantiate();

  const reinitialize = (): void => {
    engine = instantiate();
  };

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
    artifactDigest: Object.freeze(artifactDigest),
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
      let trapped = false;
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
        trapped = true;
        return result(
          'failed',
          request,
          startedAt,
          [],
          'GRAPH_NATIVE_ENGINE_TRAPPED',
          error instanceof Error ? error.message : 'Bundled engine execution failed.'
        );
      } finally {
        reclaimBundledEngineBuffers({
          trapped,
          dealloc: () => {
            if (edgePointer !== 0) engine.graph_engine_dealloc_u32(edgePointer, edgeWordCount);
            if (outputPointer !== 0) engine.graph_engine_dealloc_u32(outputPointer, outputCapacity);
          },
          reinitialize: () => {
            try {
              reinitialize();
            } catch {
              // Isolation already failed closed; the next call re-throws on use.
            }
          },
        });
      }
    },
    extractDeclarations(request: GraphNativeDeclarationRequest): GraphNativeDeclarationResult {
      const startedAt = performance.now();
      const invalid = validateDeclarationRequest(request);
      const sourceBytes = new TextEncoder().encode(request.source);
      if (invalid) {
        return declarationResult(
          'rejected',
          startedAt,
          sourceBytes.byteLength,
          [],
          'GRAPH_NATIVE_INPUT_REJECTED',
          invalid
        );
      }
      if (sourceBytes.byteLength > MAX_DECLARATION_SOURCE_BYTES) {
        return declarationResult(
          'rejected',
          startedAt,
          sourceBytes.byteLength,
          [],
          'GRAPH_NATIVE_SOURCE_LIMIT_EXCEEDED',
          'Source exceeds the bundled declaration scan limit.'
        );
      }

      const language = languageCode(request.language);
      if (language === undefined) {
        return declarationResult(
          'rejected',
          startedAt,
          sourceBytes.byteLength,
          [],
          'GRAPH_NATIVE_LANGUAGE_INVALID',
          'language must be an official-offline matrix language or null.'
        );
      }

      const recordWords = MAX_DECLARATIONS * 4;
      const namesCapacity = Math.max(sourceBytes.byteLength, 1);
      let sourcePointer = 0;
      let recordsPointer = 0;
      let namesPointer = 0;
      let trapped = false;
      try {
        if (sourceBytes.byteLength > 0) {
          sourcePointer = engine.graph_engine_alloc_u8(sourceBytes.byteLength);
          if (sourcePointer === 0) {
            return declarationResult(
              'failed',
              startedAt,
              sourceBytes.byteLength,
              [],
              'GRAPH_NATIVE_ALLOCATION_FAILED',
              'The bundled engine could not allocate bounded declaration source memory.'
            );
          }
          new Uint8Array(engine.memory.buffer, sourcePointer, sourceBytes.byteLength).set(
            sourceBytes
          );
        }
        recordsPointer = engine.graph_engine_alloc_u32(recordWords);
        namesPointer = engine.graph_engine_alloc_u8(namesCapacity);
        if (recordsPointer === 0 || namesPointer === 0) {
          return declarationResult(
            'failed',
            startedAt,
            sourceBytes.byteLength,
            [],
            'GRAPH_NATIVE_ALLOCATION_FAILED',
            'The bundled engine could not allocate bounded declaration output memory.'
          );
        }
        const count = engine.graph_engine_extract_declarations(
          sourcePointer,
          sourceBytes.byteLength,
          language,
          recordsPointer,
          MAX_DECLARATIONS,
          namesPointer,
          namesCapacity
        );
        if (count < 0) {
          const code = ERROR_CODES[count] ?? 'GRAPH_NATIVE_ENGINE_REJECTED';
          return declarationResult(
            'rejected',
            startedAt,
            sourceBytes.byteLength,
            [],
            code,
            `Bundled engine rejected declaration input (${String(count)}).`
          );
        }
        if (count > MAX_DECLARATIONS) {
          return declarationResult(
            'failed',
            startedAt,
            sourceBytes.byteLength,
            [],
            'GRAPH_NATIVE_OUTPUT_INVALID',
            'Bundled engine returned more declarations than its declared capacity.'
          );
        }
        const records = new Uint32Array(engine.memory.buffer, recordsPointer, count * 4);
        const names = new Uint8Array(engine.memory.buffer, namesPointer, namesCapacity);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const declarations: GraphNativeDeclaration[] = [];
        for (let index = 0; index < count; index += 1) {
          const base = index * 4;
          const detail = DECLARATION_DETAILS[records[base + 1] ?? -1];
          const offset = records[base + 2] ?? 0;
          const length = records[base + 3] ?? 0;
          if (
            detail === undefined ||
            !isUint32(records[base] ?? -1) ||
            offset + length > namesCapacity
          ) {
            return declarationResult(
              'failed',
              startedAt,
              sourceBytes.byteLength,
              [],
              'GRAPH_NATIVE_OUTPUT_INVALID',
              'Bundled engine returned a malformed declaration record.'
            );
          }
          declarations.push({
            name: decoder.decode(names.subarray(offset, offset + length)),
            detail,
            line: records[base] ?? 0,
          });
        }
        return declarationResult('complete', startedAt, sourceBytes.byteLength, declarations);
      } catch (error) {
        trapped = true;
        return declarationResult(
          'failed',
          startedAt,
          sourceBytes.byteLength,
          [],
          'GRAPH_NATIVE_ENGINE_TRAPPED',
          error instanceof Error ? error.message : 'Bundled engine execution failed.'
        );
      } finally {
        reclaimBundledEngineBuffers({
          trapped,
          dealloc: () => {
            if (sourcePointer !== 0) {
              engine.graph_engine_dealloc_u8(sourcePointer, sourceBytes.byteLength);
            }
            if (recordsPointer !== 0) engine.graph_engine_dealloc_u32(recordsPointer, recordWords);
            if (namesPointer !== 0) engine.graph_engine_dealloc_u8(namesPointer, namesCapacity);
          },
          reinitialize: () => {
            try {
              reinitialize();
            } catch {
              // Isolation already failed closed; the next call re-throws on use.
            }
          },
        });
      }
    },
  });
}
