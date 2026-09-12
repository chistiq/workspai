import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compareContentStateManifests } from '../../src/application/compare-content-state-manifest.js';
import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import { planShardReuseAndInvalidation } from '../../src/application/plan-shard-reuse.js';
import {
  GRAPH_CANONICAL_SHARD_REUSE_IDENTITY,
  GRAPH_SHARD_REUSE_REJECTION_REASONS,
  type GraphContentStateLeaf,
  type GraphContentStateManifest,
} from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (value: string) => ({ algorithm: 'sha256' as const, value });

function readManifest(name: string): GraphContentStateManifest {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'fixtures/g6', name), 'utf8')
  ) as GraphContentStateManifest;
}

function withManifest(
  manifest: GraphContentStateManifest,
  patch: Partial<GraphContentStateManifest>
): GraphContentStateManifest {
  return { ...structuredClone(manifest), ...patch };
}

function replaceFile(
  manifest: GraphContentStateManifest,
  locator: string,
  next: Partial<GraphContentStateLeaf>
): GraphContentStateManifest {
  const merkleRoot = digest('1111111111111111111111111111111111111111111111111111111111111111');
  return withManifest(manifest, {
    nodes: manifest.nodes.map((node) => {
      if (node.kind === 'file' && node.locator === locator) {
        return { ...node, ...next };
      }
      if (node.kind === 'directory') {
        return { ...node, digest: merkleRoot };
      }
      return node;
    }),
    merkleRoot,
    shardDependencies: manifest.shardDependencies.map((shard) =>
      shard.shardId.endsWith(`:${locator}`)
        ? {
            ...shard,
            contentDigest: next.contentDigest ?? shard.contentDigest,
          }
        : shard
    ),
  });
}

describe('planShardReuseAndInvalidation', () => {
  it('admits only exact-digest reuse reasons and never similarity', () => {
    expect(GRAPH_CANONICAL_SHARD_REUSE_IDENTITY).toBe('exact-digest');
    expect([...GRAPH_SHARD_REUSE_REJECTION_REASONS]).toEqual([
      'missing-target-shard',
      'unauthorized-shard',
      'content-changed',
      'content-incompatible',
      'semantic-incompatible',
      'missing-semantic-dependency',
      'extra-semantic-dependency',
    ]);
    for (const banned of ['similarity', 'similar', 'approximate', 'knn', 'vector', 'embedding']) {
      expect(GRAPH_SHARD_REUSE_REJECTION_REASONS).not.toContain(banned);
    }
  });

  it('reuses shards when content and semantic dependencies remain exact', () => {
    const manifest = readManifest('minimal-content-state-manifest.json');
    const plan = planShardReuseAndInvalidation({
      base: manifest,
      target: manifest,
      changedInputs: [],
    });

    expect(plan.status).toBe('complete');
    expect(plan.reused).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
    expect(plan.invalidatedProviders).toEqual([]);
  });

  it('rejects shards bound to changed locators and invalidates downstream surfaces', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('9999999999999999999999999999999999999999999999999999999999999999'),
    });
    const comparison = compareContentStateManifests({ base, target });
    const plan = planShardReuseAndInvalidation({
      base,
      target,
      changedInputs: comparison.changedInputs,
    });

    expect(plan.reused).toEqual([]);
    expect(plan.rejected).toEqual([
      expect.objectContaining({
        shardId: 'shard:ecmascript-imports:src/index.ts',
        reason: 'content-changed',
      }),
    ]);
    expect(plan.invalidatedProviders).toEqual(['workspai.graph.provider.ecmascript-imports']);
    expect(plan.invalidatedProjections).toEqual(['workspai.graph.projection.dependency']);
    expect(plan.invalidatedQueryIndexes).toEqual(['dependency-neighbors']);
    expect(plan.invalidatedGraphRegions).toEqual(['imports']);
  });

  it('rejects shards when semantic dependencies drift', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, {
      shardDependencies: base.shardDependencies.map((shard) => ({
        ...shard,
        semanticDependencies: [
          digest('abababababababababababababababababababababababababababababababab'),
        ],
      })),
    });

    const plan = planShardReuseAndInvalidation({
      base,
      target,
      changedInputs: [],
    });

    expect(plan.reused).toEqual([]);
    expect(plan.rejected[0]).toMatchObject({
      shardId: 'shard:ecmascript-imports:src/index.ts',
      reason: 'semantic-incompatible',
    });
  });

  it('rejects reused shards that lack content-membership in the target tree', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, {
      shardDependencies: base.shardDependencies.map((shard) => ({
        ...shard,
        contentDigest: digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      })),
    });
    const plan = planShardReuseAndInvalidation({
      base: target,
      target,
      changedInputs: [],
    });
    expect(plan.reused).toEqual([]);
    expect(plan.rejected[0]).toMatchObject({
      reason: 'content-incompatible',
      detail: 'missing-content-membership',
    });
  });

  it('rejects missing, unauthorized and semantically incomplete shards', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, { shardDependencies: [] });
    const missingPlan = planShardReuseAndInvalidation({
      base,
      target,
      changedInputs: [],
    });
    expect(missingPlan.rejected[0]?.reason).toBe('missing-target-shard');

    const unauthorizedPlan = planShardReuseAndInvalidation({
      base,
      target: base,
      changedInputs: [],
      authorizedShardIds: ['shard:other'],
    });
    expect(unauthorizedPlan.rejected[0]?.reason).toBe('unauthorized-shard');

    const required = digest('0000000000000000000000000000000000000000000000000000000000000000');
    const incompletePlan = planShardReuseAndInvalidation({
      base,
      target: base,
      changedInputs: [],
      requiredSemanticDependencies: [required],
    });
    expect(incompletePlan.rejected[0]?.reason).toBe('missing-semantic-dependency');
  });

  it('does not treat a shared content digest as membership of a different locator', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const shifted = withManifest(base, {
      shardDependencies: base.shardDependencies.map((shard) => ({
        ...shard,
        shardId: 'shard:ecmascript-imports:library/index.ts',
      })),
    });
    const plan = planShardReuseAndInvalidation({
      base: shifted,
      target: shifted,
      changedInputs: [],
    });
    expect(plan.reused).toEqual([]);
    expect(plan.rejected[0]).toMatchObject({
      reason: 'content-incompatible',
      detail: 'missing-content-membership',
    });
  });

  it('rejects shards when only scan-profile identity renewed', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const nextScan = digest('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    const leaf = {
      locator: 'src/index.ts',
      contentDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    };
    const shard = {
      shardId: 'shard:ecmascript-imports:src/index.ts',
      contentDigest: leaf.contentDigest,
      semanticDependencies: [
        digest('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
      ],
      providerStages: ['workspai.graph.provider.ecmascript-imports'],
      graphRegions: ['imports'],
      projections: ['workspai.graph.projection.dependency'],
      queryIndexes: ['dependency-neighbors'],
    };
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf],
      shardDependencies: [shard],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: nextScan,
      leaves: [{ ...leaf, scanProfileDigest: nextScan }],
      shardDependencies: [shard],
    });
    const comparison = compareContentStateManifests({ base, target });
    const plan = planShardReuseAndInvalidation({
      base,
      target,
      changedInputs: comparison.changedInputs,
    });
    expect(comparison.changedInputs[0]?.kind).toBe('renewed');
    expect(plan.reused).toEqual([]);
    expect(plan.rejected).toEqual([
      expect.objectContaining({
        shardId: shard.shardId,
        reason: 'content-changed',
      }),
    ]);
  });
});
