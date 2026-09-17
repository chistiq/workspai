import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_LOCATOR_IDENTITY_CONTRACT,
  GRAPH_LOCATOR_IDENTITY_LAW,
  GRAPH_PUBLIC_EXPORT_MAP,
  GRAPH_PUBLIC_ROOT_VALUE_EXPORTS,
} from '../../src/contracts/index.js';
import {
  GRAPH_LOCATOR_IDENTITY,
  classifyGraphRelativeLocator,
  normalizeGraphEntityIdentity,
  resolveGraphEntityIdentity,
} from '../../src/conformance/index.js';
import {
  referenceGraphNativeTraversal,
  routeGraphNativeTraversal,
} from '../../src/application/route-native-traversal.js';
import type { GraphNativePort, GraphNativeTraversalRequest } from '../../src/ports/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };

function entityId(
  relativeLocator: string,
  kind: string,
  caseSensitivity: 'sensitive' | 'insensitive' = 'sensitive'
): string {
  const result = normalizeGraphEntityIdentity({
    namespace: 'workspai',
    kind,
    relativeLocator,
    caseSensitivity,
    scope,
  });
  expect(result.accepted, relativeLocator).toBe(true);
  return result.accepted ? result.value.reference.id : '';
}

function digestPort() {
  return {
    algorithm: 'sha256' as const,
    digest: async (value: Uint8Array) => createHash('sha256').update(value).digest('hex'),
  };
}

describe('Graph locator-identity public contract', () => {
  it('is versioned on the contracts subpath and applied through the conformance API', () => {
    expect(GRAPH_LOCATOR_IDENTITY_CONTRACT).toEqual({
      id: 'workspai.graph.locator-identity',
      version: '1',
    });
    expect(GRAPH_LOCATOR_IDENTITY.contract).toEqual(GRAPH_LOCATOR_IDENTITY_CONTRACT);
    expect(GRAPH_LOCATOR_IDENTITY.classify).toBe(classifyGraphRelativeLocator);
    expect(GRAPH_LOCATOR_IDENTITY.maxUriDecodeRounds).toBe(8);
    expect(GRAPH_LOCATOR_IDENTITY.classes).toEqual(['portable', 'opaque', 'unsafe']);
    expect(Object.isFrozen(GRAPH_LOCATOR_IDENTITY)).toBe(true);
    expect(Object.isFrozen(GRAPH_LOCATOR_IDENTITY_CONTRACT)).toBe(true);
    expect(Object.isFrozen(GRAPH_LOCATOR_IDENTITY_LAW)).toBe(true);
    expect(GRAPH_LOCATOR_IDENTITY_LAW).toEqual({
      contract: GRAPH_LOCATOR_IDENTITY_CONTRACT,
      opaqueDeclaredPrefixes: ['encoded', 'targets'],
      maxUriDecodeRounds: 8,
      classes: ['portable', 'opaque', 'unsafe'],
    });
    expect([...GRAPH_PUBLIC_EXPORT_MAP.subpaths]).toEqual(
      expect.arrayContaining(['./contracts', './conformance'])
    );
    expect([...GRAPH_PUBLIC_EXPORT_MAP.contractsValueExports]).toEqual(
      expect.arrayContaining(['GRAPH_LOCATOR_IDENTITY_CONTRACT', 'GRAPH_LOCATOR_IDENTITY_LAW'])
    );
    expect([...GRAPH_PUBLIC_EXPORT_MAP.conformanceValueExports]).toEqual(
      expect.arrayContaining(['GRAPH_LOCATOR_IDENTITY'])
    );
    expect([...GRAPH_PUBLIC_ROOT_VALUE_EXPORTS]).not.toContain('GRAPH_LOCATOR_IDENTITY');
    expect([...GRAPH_PUBLIC_ROOT_VALUE_EXPORTS]).not.toContain('GRAPH_LOCATOR_IDENTITY_CONTRACT');
    expect([...GRAPH_PUBLIC_ROOT_VALUE_EXPORTS]).not.toContain('GRAPH_LOCATOR_IDENTITY_LAW');
    expect([...GRAPH_PUBLIC_ROOT_VALUE_EXPORTS]).not.toContain('classifyGraphRelativeLocator');
  });

  it('fails closed on percent traversal, nested decode, Windows, UNC, Unicode, and symlink escapes', () => {
    const unsafe = [
      '%2e%2e%2fsecret.ts',
      '%2E%2E%2Fsecret.ts',
      '%252e%252e%252fsecret.ts',
      'src/%2e%2e/%2e%2e/etc/passwd',
      '../secret.ts',
      'src/foo/../../../etc/passwd',
      'src/foo/..\\..\\..\\etc\\passwd',
      'C:\\Users\\graph\\src.ts',
      'C:/Windows/src.ts',
      '/etc/passwd',
      '\\\\server\\share\\file.ts',
      '//server/share/file.ts',
      '\\\\?\\C:\\Windows\\file.ts',
      '\\\\.\\UNC\\server\\share\\file.ts',
      'src/foo/\0hidden.ts',
      '\uFF0E\uFF0E/\uFF0Fetc/passwd',
      '\uFF05\uFF12\uFF45\uFF05\uFF12\uFF45\uFF0Fsecret.ts',
      'src\u2215..\u2215etc\u2215passwd',
    ];
    for (const locator of unsafe) {
      expect(GRAPH_LOCATOR_IDENTITY.classify(locator, 'file').class, locator).toBe('unsafe');
      expect(
        normalizeGraphEntityIdentity({
          namespace: 'workspai',
          kind: 'file',
          relativeLocator: locator,
          caseSensitivity: 'sensitive',
          scope,
        }).accepted,
        locator
      ).toBe(false);
    }

    let nested = '../secret.ts';
    for (let layer = 0; layer < GRAPH_LOCATOR_IDENTITY.maxUriDecodeRounds + 4; layer += 1) {
      nested = encodeURIComponent(nested);
    }
    expect(GRAPH_LOCATOR_IDENTITY.classify(nested, 'file').class).toBe('unsafe');
  });

  it('gives legal percent, encoded/, and targets/ names the same identity across POSIX and Windows shapes', () => {
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ['src/foo%ZZ.ts', 'src\\foo%ZZ.ts', 'file'],
      ['src/foo%25ZZ.ts', 'src\\foo%25ZZ.ts', 'file'],
      ['encoded/runtime.ts', 'encoded\\runtime.ts', 'file'],
      ['targets/instructions.td', 'targets\\instructions.td', 'file'],
      ['src/encoded/foo.ts', 'src\\encoded\\foo.ts', 'file'],
      ['src/targets/bar.ts', 'src\\targets\\bar.ts', 'file'],
    ];
    for (const [posix, windows, kind] of pairs) {
      const posixClass = GRAPH_LOCATOR_IDENTITY.classify(posix, kind);
      const windowsClass = GRAPH_LOCATOR_IDENTITY.classify(windows, kind);
      expect(posixClass).toEqual({ class: 'portable', locator: posix });
      expect(windowsClass).toEqual(posixClass);
      expect(entityId(posix, kind)).toBe(entityId(windows, kind));
    }

    const nfc = entityId('src/Caf\u00e9%done.ts', 'file');
    const nfd = entityId('src/Cafe\u0301%done.ts', 'file');
    const windowsNfd = entityId('src\\Cafe\u0301%done.ts', 'file');
    expect(nfc).toBe(nfd);
    expect(nfc).toBe(windowsNfd);

    expect(entityId('SRC\\FOO%ZZ.TS', 'file', 'insensitive')).toBe(
      entityId('src/foo%zz.ts', 'file', 'insensitive')
    );

    const opaqueEncoded = GRAPH_LOCATOR_IDENTITY.opaqueDeclared('encoded', 'pkg%util');
    const opaqueTargets = GRAPH_LOCATOR_IDENTITY.opaqueDeclared('targets', '//foo:bar');
    expect(GRAPH_LOCATOR_IDENTITY.classify(opaqueEncoded, 'module')).toEqual({
      class: 'opaque',
      locator: opaqueEncoded,
    });
    expect(GRAPH_LOCATOR_IDENTITY.classify(opaqueTargets, 'module')).toEqual({
      class: 'opaque',
      locator: opaqueTargets,
    });
    expect(entityId(opaqueEncoded, 'module')).toBe(
      entityId(encodeURIComponent(opaqueEncoded), 'module')
    );
    expect(
      GRAPH_LOCATOR_IDENTITY.classify(
        GRAPH_LOCATOR_IDENTITY.opaqueDeclared('encoded', '../secret.h'),
        'file'
      ).class
    ).toBe('unsafe');
    expect(GRAPH_LOCATOR_IDENTITY.classify('encoded/pkg%25util', 'file').class).toBe('portable');
    expect(GRAPH_LOCATOR_IDENTITY.classify('targets/instructions.td', 'file').class).toBe(
      'portable'
    );
  });

  it('keeps locator identity on the TypeScript host for Node fallback and WASM traversal', async () => {
    const rust = fs.readFileSync(
      path.join(repositoryRoot, 'crates/graph-engine/src/lib.rs'),
      'utf8'
    );
    const adapter = fs.readFileSync(
      path.join(packageRoot, 'src/adapters/node/rust-wasm-engine.ts'),
      'utf8'
    );
    expect(rust).toMatch(/owns no Graph identity/);
    expect(rust).not.toMatch(/relativeLocator|decodeURIComponent|locator-identity/u);
    expect(adapter).toMatch(/semanticAuthority: 'typescript'/);
    expect(adapter).not.toMatch(
      /locator-identity|classifyGraphRelativeLocator|GRAPH_LOCATOR_IDENTITY/u
    );

    const locators = [
      'src/foo%ZZ.ts',
      'targets/instructions.td',
      '%2e%2e%2fsecret.ts',
      GRAPH_LOCATOR_IDENTITY.opaqueDeclared('encoded', '../secret.h'),
    ] as const;
    const before = locators.map((locator) => ({
      file: GRAPH_LOCATOR_IDENTITY.classify(locator, 'file'),
      module: GRAPH_LOCATOR_IDENTITY.classify(locator, 'module'),
      identity: normalizeGraphEntityIdentity({
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: locator,
        caseSensitivity: 'sensitive',
        scope,
      }),
    }));

    const request: GraphNativeTraversalRequest = {
      nodeCount: 3,
      edges: [
        [0, 1],
        [1, 2],
      ],
      start: 0,
      maxDepth: 2,
    };
    const reference = referenceGraphNativeTraversal(request);
    expect(routeGraphNativeTraversal(request, undefined)).toEqual({
      engine: 'typescript',
      reason: 'native-unavailable',
      nodes: reference,
    });

    const native: GraphNativePort = {
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
        nodes: reference,
        diagnostics: [],
        metrics: { durationMs: 0, inputEdges: 2, outputNodes: reference.length },
      }),
    };
    expect(routeGraphNativeTraversal(request, native)).toEqual({
      engine: 'rust-wasm',
      reason: 'parity-qualified',
      nodes: reference,
    });

    const after = locators.map((locator) => ({
      file: GRAPH_LOCATOR_IDENTITY.classify(locator, 'file'),
      module: GRAPH_LOCATOR_IDENTITY.classify(locator, 'module'),
      identity: normalizeGraphEntityIdentity({
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: locator,
        caseSensitivity: 'sensitive',
        scope,
      }),
    }));
    expect(after).toEqual(before);

    const resolved = await resolveGraphEntityIdentity(
      {
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: 'src/foo%ZZ.ts',
        caseSensitivity: 'sensitive',
        scope,
      },
      digestPort()
    );
    expect(resolved.accepted).toBe(true);
    if (resolved.accepted) {
      expect(resolved.value.reference.id).toMatch(/^entity:workspai:file:sha256:[a-f0-9]{64}$/u);
    }
  });
});
