import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_COMPARABLE_SURFACE,
  GRAPH_GENERATED_ARTIFACT,
  GRAPH_LOCATOR_IDENTITY,
} from '@workspai/graph/conformance';
import { GRAPH_LOCATOR_IDENTITY_CONTRACT } from '@workspai/graph/contracts';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_SHADOW_MAPPING_VERSION,
  MAX_URI_DECODE_ROUNDS,
  comparableLegacyIdentity,
  comparablePackageIdentity,
  comparableProofLocator,
  decodeComparableLocator,
  decodeComparableLocatorState,
  inferLegacyProjectId,
  isGeneratedWorkspaceControlLocator,
  isUnsafeComparableLocator,
  mapShadowKind,
  mapShadowRelation,
  normalizeComparablePath,
  projectLegacyIdentity,
  projectPackageIdentity,
  projectProofLocator,
  stripDuplicatedProjectPrefix,
} from '../graph-shadow-comparison-projection.js';

function encodedLayers(value: string, layers: number): string {
  let current = value;
  for (let index = 0; index < layers; index += 1) {
    current = encodeURIComponent(current);
  }
  return current;
}

describe('Graph shadow comparison projection', () => {
  it('consumes the versioned Graph locator-identity contract instead of a parallel decoder', () => {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const relative of ['graph-shadow-comparison-projection.ts', 'graph-shadow-parity.ts']) {
      const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
      expect(source, relative).not.toMatch(/@workspai\/graph\/domain/u);
      expect(source, relative).not.toMatch(/locator-identity\.js/u);
    }
    const projection = fs.readFileSync(
      path.join(sourceRoot, 'graph-shadow-comparison-projection.ts'),
      'utf8'
    );
    expect(projection).toMatch(/GRAPH_LOCATOR_IDENTITY/u);
    expect(projection).toMatch(/GRAPH_GENERATED_ARTIFACT/u);
    expect(projection).toMatch(/GRAPH_COMPARABLE_SURFACE/u);
    expect(projection).not.toMatch(/\.workspai/u);
    expect(GRAPH_LOCATOR_IDENTITY.contract).toEqual(GRAPH_LOCATOR_IDENTITY_CONTRACT);
    expect(GRAPH_LOCATOR_IDENTITY_CONTRACT).toEqual({
      id: 'workspai.graph.locator-identity',
      version: '1',
    });
    expect(MAX_URI_DECODE_ROUNDS).toBe(GRAPH_LOCATOR_IDENTITY.maxUriDecodeRounds);
    expect(GRAPH_LOCATOR_IDENTITY.classify).toBeTypeOf('function');
  });

  it('keeps the mapping version exact and does not rewrite production identity keys', () => {
    expect(GRAPH_SHADOW_MAPPING_VERSION).toBe('workspai.graph-shadow-mapping.v2');
    expect(comparableLegacyIdentity('file:app:src/catalog.ts', 'file', 'app')).toBe(
      'file:src/catalog.ts'
    );
    expect(comparableLegacyIdentity('file:app:app/src/catalog.ts', 'file', 'app')).toBe(
      'file:src/catalog.ts'
    );
  });

  it('strips duplicated project prefixes without collapsing distinct files', () => {
    expect(stripDuplicatedProjectPrefix('app/src/catalog.ts', 'app')).toBe('src/catalog.ts');
    expect(stripDuplicatedProjectPrefix('src/catalog.ts', 'app')).toBe('src/catalog.ts');
    expect(stripDuplicatedProjectPrefix('app', 'app')).toBe('.');
    expect(comparableLegacyIdentity('file:app:app/src/a.ts', 'file', 'app')).not.toBe(
      comparableLegacyIdentity('file:app:app/src/b.ts', 'file', 'app')
    );
  });

  it('normalizes Windows separators and rejects drive letters, traversal and host paths', () => {
    expect(normalizeComparablePath('src\\catalog.ts')).toBe('src/catalog.ts');
    expect(isUnsafeComparableLocator('C:\\Users\\graph\\src.ts')).toBe(true);
    expect(isUnsafeComparableLocator('/Users/research/src.ts')).toBe(true);
    expect(isUnsafeComparableLocator('/home/runner/src.ts')).toBe(true);
    expect(isUnsafeComparableLocator('/private/var/folders/zz/src.ts')).toBe(true);
    expect(isUnsafeComparableLocator('/var/folders/zz/src.ts')).toBe(true);
    expect(isUnsafeComparableLocator('../secret.ts')).toBe(true);
    expect(isUnsafeComparableLocator('src/../../etc/passwd')).toBe(true);
    expect(isUnsafeComparableLocator('src/\0hidden.ts')).toBe(true);
    expect(isUnsafeComparableLocator('\\\\server\\share\\file.ts')).toBe(true);
    expect(isUnsafeComparableLocator('//server/share/file.ts')).toBe(true);
    expect(isUnsafeComparableLocator('\\\\?\\C:\\Windows\\file.ts')).toBe(true);
    expect(isUnsafeComparableLocator('src/foo/../../../etc/passwd')).toBe(true);
    expect(isUnsafeComparableLocator('\uFF0E\uFF0E/secret.ts')).toBe(true);
    expect(comparableProofLocator('/tmp/private.ts', 'app')).toBeNull();
    expect(comparableProofLocator('C:/repo/src.ts', 'app')).toBeNull();
    expect(comparableProofLocator('src/catalog.ts', 'app')).toBe('src/catalog.ts');
  });

  it('keeps symlink alias locators distinct instead of collapsing them', () => {
    expect(comparablePackageIdentity('src/real.ts', 'file', 'app')).toBe('src/real.ts');
    expect(comparablePackageIdentity('src/alias.ts', 'file', 'app')).toBe('src/alias.ts');
    expect(comparablePackageIdentity('entity:workspai:file:src%2Freal.ts', 'file', 'app')).toBe(
      'file:src/real.ts'
    );
    expect(comparablePackageIdentity('entity:workspai:file:src%2Falias.ts', 'file', 'app')).toBe(
      'file:src/alias.ts'
    );
  });

  it('separates generated-artifact locators from source-repository proof using the Graph policy', () => {
    expect(GRAPH_GENERATED_ARTIFACT.defaultTreatment).toBe('bounded-unknown');
    expect(isGeneratedWorkspaceControlLocator('.github/workflows/ci.yml', 'app')).toBe(false);
    expect(isGeneratedWorkspaceControlLocator('.workspai/workspace.contract.json', 'app')).toBe(
      false
    );
    expect(isGeneratedWorkspaceControlLocator('app/.workspai/workspace.contract.json', 'app')).toBe(
      false
    );
    expect(isGeneratedWorkspaceControlLocator('dist/out.js', 'app')).toBe(false);
    expect(isGeneratedWorkspaceControlLocator('src/bin/main.rs', 'app')).toBe(false);
    expect(isGeneratedWorkspaceControlLocator('node_modules/left-pad/index.js', 'app')).toBe(true);
    expect(isGeneratedWorkspaceControlLocator('src/catalog.ts', 'app')).toBe(false);
    expect(comparableProofLocator('.workspai/graph.json', 'app')).toBe('.workspai/graph.json');
    expect(comparableProofLocator('.github/workflows/ci.yml', 'app')).toBe(
      '.github/workflows/ci.yml'
    );
    expect(comparableProofLocator('dist/out.js', 'app')).toBe('dist/out.js');
    expect(comparableProofLocator('src/catalog.ts', 'app')).toBe('src/catalog.ts');
    expect(GRAPH_GENERATED_ARTIFACT.classifyLocator('.cache/tmp.json').class).toBe('source');
    expect(GRAPH_GENERATED_ARTIFACT.classifyLocator('.github/workflows/ci.yml').class).toBe(
      'source'
    );
  });

  it('projects package hashed identities through observed renderings only', () => {
    expect(comparablePackageIdentity('entity:workspai:repository:.', 'repository', 'app')).toBe(
      'project:app'
    );
    expect(
      comparablePackageIdentity(
        'entity:workspai:symbol:src%2Fcatalog.ts%3Afunction%3AlistCatalog',
        'symbol',
        'app'
      )
    ).toBe('symbol:src/catalog.ts:function:listCatalog');
    expect(
      comparableLegacyIdentity(
        'symbol:app:app/src/catalog.ts:function:listCatalog',
        'symbol',
        'app'
      )
    ).toBe('symbol:src/catalog.ts:function:listCatalog');
  });

  it('maps kind and relation names through the Graph comparable-surface corpus', () => {
    expect(mapShadowKind('test-suite')).toBe(GRAPH_COMPARABLE_SURFACE.mapKind('test-suite'));
    expect(mapShadowKind('test-suite')).toBe('test');
    expect(mapShadowKind('repository')).toBe('project');
    expect(mapShadowRelation('documents')).toBe('documented-by');
    expect(mapShadowRelation('owns')).toBe('owned-by');
    expect(GRAPH_COMPARABLE_SURFACE.classifyKind('widget').membership).toBe('outside-corpus');
    expect(GRAPH_COMPARABLE_SURFACE.classifyKind('file').membership).toBe('in-corpus');
    expect(inferLegacyProjectId([{ kind: 'project', identity: { key: 'project:app' } }])).toBe(
      'app'
    );
  });

  it('rejects URI-encoded traversal after decode and does not render it for equivalence', () => {
    expect(isUnsafeComparableLocator('%2e%2e%2fsecret.ts')).toBe(true);
    expect(isUnsafeComparableLocator('%252e%252e%252fsecret.ts')).toBe(true);
    expect(isUnsafeComparableLocator('src/%2e%2e/%2e%2e/etc/passwd')).toBe(true);
    expect(
      projectPackageIdentity('entity:workspai:file:%2e%2e%2fsecret.ts', 'file', 'app')
    ).toEqual({ status: 'unsafe', locator: '../secret.ts' });
    expect(projectLegacyIdentity('file:app:%2e%2e%2fsecret.ts', 'file', 'app')).toEqual({
      status: 'unsafe',
      locator: '../secret.ts',
    });
    expect(projectProofLocator('%2e%2e%2fsecret.ts', 'app')).toEqual({
      status: 'unsafe',
      locator: '../secret.ts',
    });
    expect(() =>
      comparablePackageIdentity('entity:workspai:file:%2e%2e%2fsecret.ts', 'file', 'app')
    ).toThrow(/Unsafe comparable identity/);
    expect(comparableProofLocator('%2e%2e%2fsecret.ts', 'app')).toBeNull();
  });

  it('fails closed when URI decoding does not stabilize within the decode budget', () => {
    expect(MAX_URI_DECODE_ROUNDS).toBe(8);
    expect(decodeComparableLocatorState(encodedLayers('src/ok.ts', 1))).toEqual({
      status: 'stable',
      value: 'src/ok.ts',
    });
    expect(decodeComparableLocatorState(encodedLayers('src/ok.ts', 8))).toEqual({
      status: 'stable',
      value: 'src/ok.ts',
    });
    expect(
      projectPackageIdentity(`entity:workspai:file:${encodedLayers('src/ok.ts', 8)}`, 'file', 'app')
    ).toEqual({
      status: 'comparable',
      identity: 'file:src/ok.ts',
    });

    for (const layers of [9, 16, 25, 64]) {
      const encoded = encodedLayers('src/ok.ts', layers);
      expect(decodeComparableLocatorState(encoded)).toEqual({
        status: 'unstable',
        value: encoded,
      });
      expect(decodeComparableLocator(encoded)).toBe(encoded);
      expect(isUnsafeComparableLocator(encoded)).toBe(true);
      expect(projectPackageIdentity(`entity:workspai:file:${encoded}`, 'file', 'app')).toEqual({
        status: 'unsafe',
        locator: encoded,
      });
      expect(projectLegacyIdentity(`file:app:${encoded}`, 'file', 'app')).toEqual({
        status: 'unsafe',
        locator: encoded,
      });
    }

    for (const layers of [1, 8, 9, 16, 25, 64]) {
      const encoded = encodedLayers('../secret.ts', layers);
      expect(isUnsafeComparableLocator(encoded)).toBe(true);
      expect(projectPackageIdentity(`entity:workspai:file:${encoded}`, 'file', 'app').status).toBe(
        'unsafe'
      );
      expect(projectLegacyIdentity(`file:app:${encoded}`, 'file', 'app').status).toBe('unsafe');
      expect(
        projectPackageIdentity(
          `entity:workspai:file:${encodedLayers('%2e%2e%2fsecret.ts', layers)}`,
          'file',
          'app'
        ).status
      ).toBe('unsafe');
    }
  });

  it('treats literal percent filenames as comparable while still failing closed on traversal encodings', () => {
    expect(decodeComparableLocatorState('%ZZ')).toEqual({ status: 'stable', value: '%ZZ' });
    expect(decodeComparableLocatorState('src%2')).toEqual({ status: 'stable', value: 'src%2' });
    expect(decodeComparableLocatorState('foo%25ZZ.ts')).toEqual({
      status: 'stable',
      value: 'foo%ZZ.ts',
    });
    expect(isUnsafeComparableLocator('%ZZ')).toBe(false);
    expect(isUnsafeComparableLocator('src/foo%ZZ.ts')).toBe(false);
    expect(isUnsafeComparableLocator('src\\foo%ZZ.ts')).toBe(false);
    expect(isUnsafeComparableLocator('encoded/runtime.ts')).toBe(false);
    expect(isUnsafeComparableLocator('encoded\\runtime.ts')).toBe(false);
    expect(isUnsafeComparableLocator('targets/instructions.td')).toBe(false);
    expect(isUnsafeComparableLocator('targets\\instructions.td')).toBe(false);
    expect(normalizeComparablePath('src\\foo%ZZ.ts')).toBe(
      normalizeComparablePath('src/foo%ZZ.ts')
    );
    expect(normalizeComparablePath('encoded\\runtime.ts')).toBe(
      normalizeComparablePath('encoded/runtime.ts')
    );
    expect(normalizeComparablePath('targets\\instructions.td')).toBe(
      normalizeComparablePath('targets/instructions.td')
    );
    expect(projectPackageIdentity('entity:workspai:file:%ZZ', 'file', 'app')).toEqual({
      status: 'comparable',
      identity: 'file:%ZZ',
    });
    expect(projectPackageIdentity('entity:workspai:file:foo%25ZZ.ts', 'file', 'app')).toEqual({
      status: 'comparable',
      identity: 'file:foo%ZZ.ts',
    });
    expect(comparablePackageIdentity('entity:workspai:file:src%2Ffoo%25ZZ.ts', 'file', 'app')).toBe(
      'file:src/foo%ZZ.ts'
    );
  });

  it('keeps producer-opaque encoded locators comparable without reconstituting traversal', () => {
    const opaque = `encoded/${encodeURIComponent('../secret.h').replaceAll('.', '%2E')}`;
    const rendered = encodeURIComponent(opaque);
    expect(decodeComparableLocatorState(rendered, 'module')).toEqual({
      status: 'stable',
      value: opaque,
    });
    expect(isUnsafeComparableLocator(rendered, 'module')).toBe(false);
    expect(isUnsafeComparableLocator(opaque, 'module')).toBe(false);
    expect(isUnsafeComparableLocator(opaque, 'file')).toBe(true);
    expect(
      projectPackageIdentity(`entity:c-cpp-module:module:${rendered}`, 'module', 'app')
    ).toEqual({
      status: 'comparable',
      identity: `module:${opaque}`,
    });
    expect(isUnsafeComparableLocator('%2e%2e%2fsecret.ts')).toBe(true);
  });
});
