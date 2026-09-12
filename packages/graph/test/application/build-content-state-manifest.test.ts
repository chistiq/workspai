import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import { contentStateLeavesFromProviderInputs } from '../../src/application/content-state-manifest-types.js';
import { compareContentStateManifests } from '../../src/application/compare-content-state-manifest.js';
import { validateGraphContentStateManifest } from '../../src/conformance/incremental.js';
import type { GraphContentStateManifest } from '../../src/contracts/index.js';

const scanProfileDigest = Object.freeze({
  algorithm: 'sha256' as const,
  value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

const scope = Object.freeze({
  kind: 'project' as const,
  projectIds: ['project:fixture'] as [string, ...string[]],
});

describe('buildContentStateManifest', () => {
  it('builds a deterministic manifest with derived directory digests', () => {
    const request = {
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'src/index.ts',
          contentDigest: {
            algorithm: 'sha256',
            value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    };
    const first = buildContentStateManifest(request);
    const second = buildContentStateManifest(request);
    expect(first).toEqual(second);
    expect(validateGraphContentStateManifest(first).accepted).toBe(true);
    expect(first.nodes.some((node) => node.kind === 'directory' && node.locator === 'src')).toBe(
      true
    );
  });

  it('feeds the incremental comparison engine without fixture hand-authoring', () => {
    const base = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'src/index.ts',
          contentDigest: {
            algorithm: 'sha256',
            value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    });
    const target = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'src/index.ts',
          contentDigest: {
            algorithm: 'sha256',
            value: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    });
    const comparison = compareContentStateManifests({ base, target });
    expect(comparison.status).toBe('complete');
    expect(comparison.changedInputs.some((change) => change.kind === 'edited')).toBe(true);
  });

  it('maps provider inventory inputs into portable content-state leaves', () => {
    const leaves = contentStateLeavesFromProviderInputs(
      [
        {
          locator: 'src/index.ts',
          mediaType: 'text/typescript',
          byteLength: 42,
          digest: {
            algorithm: 'sha256',
            value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
        },
      ],
      scanProfileDigest
    );
    const manifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves,
    });
    expect(
      manifest.nodes.some((node) => node.kind === 'file' && node.locator === 'src/index.ts')
    ).toBe(true);
  });

  it('derives nested directory digests bottom-up', () => {
    const manifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'src/lib/util.ts',
          contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
          inputKind: 'source-file',
          scanProfileDigest,
        },
        {
          locator: 'README.md',
          contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    });
    expect(
      manifest.nodes.some((node) => node.kind === 'directory' && node.locator === 'src/lib')
    ).toBe(true);
  });

  it('rejects non-portable locators fail-closed', () => {
    expect(() =>
      buildContentStateManifest({
        scope,
        generatedAt: '2026-09-09T20:00:00.000Z',
        scanProfileDigest,
        leaves: [
          {
            locator: '../escape.ts',
            contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
            inputKind: 'source-file',
            scanProfileDigest,
          },
        ],
      })
    ).toThrow(/not portable/);
  });

  it('rejects duplicate locators fail-closed', () => {
    expect(() =>
      buildContentStateManifest({
        scope,
        generatedAt: '2026-09-09T20:00:00.000Z',
        scanProfileDigest,
        leaves: [
          {
            locator: 'src/index.ts',
            contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
            inputKind: 'source-file',
            scanProfileDigest,
          },
          {
            locator: 'src/index.ts',
            contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
            inputKind: 'source-file',
            scanProfileDigest,
          },
        ],
      })
    ).toThrow(/Duplicate content-state leaf locator/);
  });

  it('separates lib and library path-boundary prefixes', () => {
    const manifest = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'lib/foo.ts',
          contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
          inputKind: 'source-file',
          scanProfileDigest,
        },
        {
          locator: 'library/foo.ts',
          contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    });
    expect(
      manifest.nodes.filter((node) => node.kind === 'directory').map((node) => node.locator)
    ).toEqual(['lib', 'library']);
    expect(validateGraphContentStateManifest(manifest).accepted).toBe(true);
  });

  it('reassembles the minimal G6 fixture from its admitted leaves', () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        new URL('../../fixtures/g6/minimal-content-state-manifest.json', import.meta.url),
        'utf8'
      )
    ) as GraphContentStateManifest;
    const file = fixture.nodes.find((node) => node.kind === 'file');
    if (!file || file.kind !== 'file') {
      throw new Error('expected a file leaf in the G6 fixture');
    }
    const rebuilt = buildContentStateManifest({
      scope: fixture.scope,
      generatedAt: fixture.generatedAt,
      scanProfileDigest: file.scanProfileDigest,
      leaves: [
        {
          locator: file.locator,
          contentDigest: file.contentDigest,
          inputKind: file.inputKind,
          scanProfileDigest: file.scanProfileDigest,
        },
      ],
      shardDependencies: fixture.shardDependencies,
    });
    expect(validateGraphContentStateManifest(fixture).accepted).toBe(true);
    expect(rebuilt.merkleRoot).toEqual(fixture.merkleRoot);
    const fixtureDirectory = fixture.nodes.find((node) => node.kind === 'directory');
    const rebuiltDirectory = rebuilt.nodes.find((node) => node.kind === 'directory');
    expect(rebuiltDirectory).toEqual(fixtureDirectory);
    expect(fixtureDirectory && fixtureDirectory.kind === 'directory').toBe(true);
    if (fixtureDirectory && fixtureDirectory.kind === 'directory') {
      expect(fixtureDirectory.children[0]?.digest.value).not.toBe(file.contentDigest.value);
    }
  });
});
