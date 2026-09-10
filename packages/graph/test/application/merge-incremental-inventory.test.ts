import { describe, expect, it } from 'vitest';

import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import {
  mergeIncrementalInventory,
  projectShardDependencies,
} from '../../src/application/merge-incremental-inventory.js';
import { planInventoryReread } from '../../src/application/plan-inventory-reread.js';
import { parseGitStatusPorcelain } from '../../src/application/parse-git-status-porcelain.js';
import { graphInputMediaType } from '../../src/domain/input-media-type.js';

const scanProfileDigest = Object.freeze({
  algorithm: 'sha256' as const,
  value: 'a'.repeat(64),
});

function manifest(leaves: Parameters<typeof buildContentStateManifest>[0]['leaves']) {
  return buildContentStateManifest({
    scope: { kind: 'project', projectIds: ['project:fixture'] },
    generatedAt: '2026-09-09T12:00:00.000Z',
    scanProfileDigest,
    leaves,
    shardDependencies: [
      {
        shardId: 'shard:stage:src/keep.ts',
        contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        semanticDependencies: [],
        providerStages: ['keep'],
        graphRegions: [],
        projections: [],
        queryIndexes: [],
      },
      {
        shardId: 'shard:stage:missing.ts',
        contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
        semanticDependencies: [],
        providerStages: ['gone'],
        graphRegions: [],
        projections: [],
        queryIndexes: [],
      },
    ],
  });
}

describe('mergeIncrementalInventory', () => {
  it('falls back to a fresh hash when a reused leaf has no size observation', () => {
    const prior = manifest([
      {
        locator: 'src/keep.ts',
        contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        inputKind: 'source-file',
        scanProfileDigest,
      },
    ]);
    const reread = planInventoryReread({
      priorManifest: prior,
      journal: parseGitStatusPorcelain(''),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    const fresh = {
      locator: 'src/keep.ts',
      mediaType: 'text/typescript',
      byteLength: 21,
      digest: { algorithm: 'sha256' as const, value: 'e'.repeat(64) },
    };
    expect(
      mergeIncrementalInventory({
        priorManifest: prior,
        reread,
        inventoried: [fresh],
      })
    ).toEqual([fresh]);
    expect(
      mergeIncrementalInventory({
        priorManifest: prior,
        reread,
        inventoried: [],
      })
    ).toEqual([]);
  });

  it('omits journal-deleted locators even when inventory still lists them', () => {
    const prior = manifest([
      {
        locator: 'src/keep.ts',
        contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        inputKind: 'source-file',
        scanProfileDigest,
        observations: { sizeBytes: 8 },
      },
      {
        locator: 'src/gone.ts',
        contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
        inputKind: 'source-file',
        scanProfileDigest,
        observations: { sizeBytes: 8 },
      },
    ]);
    const reread = planInventoryReread({
      priorManifest: prior,
      journal: parseGitStatusPorcelain(' D src/gone.ts\n'),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    const merged = mergeIncrementalInventory({
      priorManifest: prior,
      reread,
      inventoried: [
        {
          locator: 'src/gone.ts',
          mediaType: 'text/typescript',
          byteLength: 8,
          digest: { algorithm: 'sha256', value: 'd'.repeat(64) },
        },
      ],
    });
    expect(merged.map((input) => input.locator)).toEqual(['src/keep.ts']);
  });

  it('drops shards that cannot bind to an admitted locator', () => {
    const prior = manifest([
      {
        locator: 'src/keep.ts',
        contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        inputKind: 'source-file',
        scanProfileDigest,
        observations: { sizeBytes: 8 },
      },
    ]);
    expect(
      projectShardDependencies(prior, [
        {
          locator: 'src/keep.ts',
          mediaType: 'text/typescript',
          byteLength: 8,
          digest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        },
      ]).map((shard) => shard.shardId)
    ).toEqual(['shard:stage:src/keep.ts']);
  });

  it('drops shards whose providers are no longer registered', () => {
    const prior = manifest([
      {
        locator: 'src/keep.ts',
        contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        inputKind: 'source-file',
        scanProfileDigest,
        observations: { sizeBytes: 8 },
      },
    ]);
    expect(
      projectShardDependencies(
        prior,
        [
          {
            locator: 'src/keep.ts',
            mediaType: 'text/typescript',
            byteLength: 8,
            digest: { algorithm: 'sha256', value: 'c'.repeat(64) },
          },
        ],
        { registeredProviderIds: ['other'] }
      )
    ).toEqual([]);
  });
});

describe('graphInputMediaType', () => {
  it('maps Git HEAD and unknown extensions portably', () => {
    expect(graphInputMediaType('.git/HEAD')).toBe('text/plain');
    expect(graphInputMediaType('LICENSE')).toBe('application/octet-stream');
  });
});
