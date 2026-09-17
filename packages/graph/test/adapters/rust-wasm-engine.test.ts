import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
  reclaimBundledEngineBuffers,
} from '../../src/adapters/node/index.js';
import { GRAPH_LOCATOR_IDENTITY } from '../../src/conformance/locator-identity-api.js';
import type { GraphNativeTraversalRequest } from '../../src/ports/index.js';
import {
  extractMatrixDeclarations,
  matrixLanguageFor,
} from '../../src/providers/matrix-source-language.js';
import { routeGraphNativeDeclarations } from '../../src/providers/route-native-declarations.js';

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
  it('keeps UTF-8, empty input, changing buffer sizes and physical evidence lines in parity', async () => {
    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    const sources = [
      '',
      '/* header\r\n * comment 🦀\r\n */\r\nexport/* note */function actual() {}\r\n// function hidden() {}\r\nfunction next() {}',
      'funct/* split */ion fake() {}',
      'function a() {} /* unfinished',
      '// unicode 🦀 and lone surrogate \ud800\nfunction real() {}',
      'function repeated() {}\n'.repeat(16_384),
      'function small() {}',
      '',
    ];
    for (const source of sources) {
      const result = port.extractDeclarations!({ source, language: 'node' });
      expect(result.status).toBe('complete');
      expect(result.metrics.inputBytes).toBe(Buffer.byteLength(source));
      expect(result.declarations).toEqual(extractMatrixDeclarations(source, 'node'));
    }
    expect(
      port.extractDeclarations!({
        source: 'function f() {}\n'.repeat(16_385),
        language: 'node',
      }).status
    ).toBe('rejected');
    expect(
      port.extractDeclarations!({ source: 'function recovered() {}', language: 'node' }).status
    ).toBe('complete');
  });

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
    expect(port.artifactDigest).toEqual({
      algorithm: 'sha256',
      value: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('does not export or own Graph locator identity', async () => {
    const bytes = await readFile(engineUrl);
    const wasm = (
      globalThis as unknown as {
        readonly WebAssembly: {
          readonly Module: {
            new (bytes: Uint8Array): unknown;
            exports(module: unknown): readonly { readonly name: string; readonly kind: string }[];
          };
        };
      }
    ).WebAssembly;
    const exported = wasm.Module.exports(new wasm.Module(bytes)).map((item) => item.name);
    expect(exported.some((name) => /identity|locator|uri|decode/iu.test(name))).toBe(false);
    expect(exported).toEqual(
      expect.arrayContaining([
        'memory',
        'graph_engine_abi_version',
        'graph_engine_reachable',
        'graph_engine_extract_declarations',
        'graph_engine_alloc_u32',
        'graph_engine_dealloc_u32',
        'graph_engine_alloc_u8',
        'graph_engine_dealloc_u8',
      ])
    );

    const before = GRAPH_LOCATOR_IDENTITY.classify('src/foo%ZZ.ts', 'file');
    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    expect(port.descriptor.semanticAuthority).toBe('typescript');
    expect(port.traverseReachable({ nodeCount: 1, edges: [], start: 0, maxDepth: 0 }).status).toBe(
      'complete'
    );
    expect(GRAPH_LOCATOR_IDENTITY.classify('src/foo%ZZ.ts', 'file')).toEqual(before);
    expect(GRAPH_LOCATOR_IDENTITY.classify('%2e%2e%2fsecret.ts', 'file').class).toBe('unsafe');
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

  it('matches TypeScript matrix declarations without becoming Graph authority', async () => {
    const port = await createNodeRustWasmGraphNativePort(engineUrl);
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['src/a.ts', 'export function listItems(): void {}\n'],
      ['src/a.py', 'def list_items():\n    return 1\n'],
      ['src/a.go', 'package a\nfunc ListItems() {}\n'],
      ['src/A.java', 'class ListItems {\n    String health() { return "ok"; }\n}\n'],
      ['src/A.cs', 'class ListItems {\n    public static string Status() => "ok";\n}\n'],
      ['src/a.rs', 'fn list_items() {}\n'],
      ['src/a.cc', 'int list_items() { return 0; }\n'],
      ['src/a.m', '@interface ListItems : NSObject\n- (NSString *)health;\n@end\n'],
      ['src/a.php', '<?php\nfunction list_items(): string { return "ok"; }\n'],
      ['src/a.rb', "def list_items\n  'ok'\nend\n"],
      ['src/a.swift', 'func listItems() -> String { "ok" }\n'],
      ['src/a.ex', 'defmodule ListItems do\n  def health(), do: :ok\nend\n'],
      ['src/A.kt', 'class ListItems {\n  fun health() = "ok"\n}\n'],
      ['src/control.cc', 'int ready() { return 1; }\nif (ready()) { return; }\n'],
      [
        'src/comments.cc',
        'int ready() { return 1; }\n/*\ncomment\n*/\nint later() { return 2; }\n',
      ],
    ];
    for (const [locator, source] of cases) {
      const language = matrixLanguageFor(locator);
      const execution = port.extractDeclarations?.({ source, language });
      expect(execution?.status, locator).toBe('complete');
      expect(execution?.declarations, locator).toEqual(extractMatrixDeclarations(source, language));
      expect(routeGraphNativeDeclarations(source, language, port)).toEqual({
        engine: 'rust-wasm',
        reason: 'parity-qualified',
        declarations: extractMatrixDeclarations(source, language),
      });
    }

    const fixturesRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../fixtures/g4/repositories'
    );
    const fixtureFiles = [
      'c-cpp/main.cc',
      'dotnet/Program.cs',
      'elixir/application.ex',
      'elixir/router.ex',
      'go/main.go',
      'java/HealthController.java',
      'kotlin/Application.kt',
      'node/src/health.ts',
      'node/src/server.ts',
      'objective-c-matlab/main.m',
      'php/index.php',
      'python/app.py',
      'ruby/app.rb',
      'rust/main.rs',
      'swift/main.swift',
    ];
    for (const locator of fixtureFiles) {
      const source = await readFile(path.join(fixturesRoot, locator), 'utf8');
      const language = matrixLanguageFor(locator);
      const execution = port.extractDeclarations?.({ source, language });
      expect(execution?.status, locator).toBe('complete');
      expect(execution?.declarations, locator).toEqual(extractMatrixDeclarations(source, language));
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
    const bytes = await readFile(engineUrl);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-wasm-'));
    try {
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(path.join(directory, 'missing.wasm')))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_UNAVAILABLE',
      } satisfies Partial<GraphNativeAdapterLoadError>);

      const invalidPath = path.join(directory, 'invalid.wasm');
      const invalidBytes = new Uint8Array([0, 1, 2, 3]);
      await writeFile(invalidPath, invalidBytes);
      await writeFile(
        `${invalidPath}.sha256`,
        `${createHash('sha256').update(invalidBytes).digest('hex')}\n`
      );
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(invalidPath))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_INVALID',
      } satisfies Partial<GraphNativeAdapterLoadError>);

      await writeFile(path.join(directory, 'plain.wasm'), bytes);
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(path.join(directory, 'plain.wasm')))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_DIGEST_MISSING',
      } satisfies Partial<GraphNativeAdapterLoadError>);

      await writeFile(path.join(directory, 'mismatch.wasm'), bytes);
      await writeFile(path.join(directory, 'mismatch.wasm.sha256'), `${'0'.repeat(64)}\n`);
      await expect(
        createNodeRustWasmGraphNativePort(pathToFileURL(path.join(directory, 'mismatch.wasm')))
      ).rejects.toMatchObject({
        name: 'GraphNativeAdapterLoadError',
        code: 'GRAPH_NATIVE_ARTIFACT_DIGEST_MISMATCH',
      } satisfies Partial<GraphNativeAdapterLoadError>);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('never deallocates trapped engine pointers on a replacement instance', () => {
    const events: string[] = [];
    reclaimBundledEngineBuffers({
      trapped: true,
      dealloc: () => {
        events.push('dealloc');
      },
      reinitialize: () => {
        events.push('reinitialize');
      },
    });
    expect(events).toEqual(['reinitialize']);

    events.length = 0;
    reclaimBundledEngineBuffers({
      trapped: false,
      dealloc: () => {
        events.push('dealloc');
      },
      reinitialize: () => {
        events.push('reinitialize');
      },
    });
    expect(events).toEqual(['dealloc']);

    events.length = 0;
    reclaimBundledEngineBuffers({
      trapped: false,
      dealloc: () => {
        throw new Error('stale pointer');
      },
      reinitialize: () => {
        events.push('reinitialize');
      },
    });
    expect(events).toEqual(['reinitialize']);
  });
});
