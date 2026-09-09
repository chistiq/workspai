import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import { buildGraphChangeOverlay } from '../../src/application/build-graph-change-overlay.js';
import { compareContentStateManifests } from '../../src/application/compare-content-state-manifest.js';
import { planIncrementalGraphBuild } from '../../src/application/plan-incremental-graph-build.js';
import { planShardReuseAndInvalidation } from '../../src/application/plan-shard-reuse.js';
import type {
  GraphContentStateLeaf,
  GraphContentStateManifest,
  GraphGenerationRef,
} from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (value: string) => ({ algorithm: 'sha256' as const, value });

function readManifest(name: string): GraphContentStateManifest {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'fixtures/g6', name), 'utf8')
  ) as GraphContentStateManifest;
}

function replaceFile(
  manifest: GraphContentStateManifest,
  locator: string,
  next: Partial<GraphContentStateLeaf>
): GraphContentStateManifest {
  return {
    ...structuredClone(manifest),
    merkleRoot: digest('1212121212121212121212121212121212121212121212121212121212121212'),
    nodes: manifest.nodes.map((node) =>
      node.kind === 'file' && node.locator === locator ? { ...node, ...next } : node
    ),
    shardDependencies: manifest.shardDependencies.map((shard) =>
      shard.shardId.endsWith(`:${locator}`)
        ? { ...shard, contentDigest: next.contentDigest ?? shard.contentDigest }
        : shard
    ),
  };
}

describe('G6 incremental pipeline integration', () => {
  it('chains comparison, shard reuse, incremental planning and overlay prediction consistently', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('abababababababababababababababababababababababababababababababab'),
    });
    const baseGeneration: GraphGenerationRef = Object.freeze({
      id: 'generation:base',
      generatedAt: base.generatedAt,
      contentDigest: base.merkleRoot,
    });

    const comparison = compareContentStateManifests({ base, target });
    const shardReuse = planShardReuseAndInvalidation({
      base,
      target,
      changedInputs: comparison.changedInputs,
    });
    const incremental = planIncrementalGraphBuild({
      baseGeneration: baseGeneration.id,
      targetGeneration: 'generation:target',
      baseManifest: base,
      targetManifest: target,
    });
    const overlay = buildGraphChangeOverlay({
      overlayId: 'overlay:pipeline',
      baseGeneration,
      baseManifest: base,
      proposedManifest: target,
      proposal: Object.freeze({
        kind: 'working-tree',
        identity: 'working-tree:fixture',
        digest: target.merkleRoot.value,
      }),
      assumptions: Object.freeze(['pipeline-fixture']),
      generatedAt: '2026-09-09T21:00:00.000Z',
    });

    expect(comparison.changedInputs).toEqual(incremental.changeSet.inputs);
    expect(shardReuse.invalidatedProviders).toEqual(incremental.providersToRecompute);
    expect(overlay.predictedDelta.changedInputs).toEqual(comparison.changedInputs);
    expect(overlay.predictedDelta.affectedProviders).toEqual(shardReuse.invalidatedProviders);
    expect(overlay.predictedDelta.execution.recomputed).toBe(shardReuse.rejected.length);
    expect(overlay.quality.generation).toEqual(baseGeneration);
  });

  it('supports manifests built from admitted leaves without hand-authored Merkle nodes', () => {
    const scanProfileDigest = digest(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    const scope = Object.freeze({
      kind: 'project' as const,
      projectIds: ['project:pipeline'] as [string, ...string[]],
    });
    const base = buildContentStateManifest({
      scope,
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest,
      leaves: [
        {
          locator: 'src/index.ts',
          contentDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
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
          contentDigest: digest('abababababababababababababababababababababababababababababababab'),
          inputKind: 'source-file',
          scanProfileDigest,
        },
      ],
    });
    const comparison = compareContentStateManifests({ base, target });
    const incremental = planIncrementalGraphBuild({
      baseGeneration: 'generation:built-base',
      targetGeneration: 'generation:built-target',
      baseManifest: base,
      targetManifest: target,
    });
    expect(comparison.changedInputs).toEqual(incremental.changeSet.inputs);
  });
});
