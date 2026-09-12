import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { planIncrementalGraphBuild } from '../../src/application/plan-incremental-graph-build.js';
import {
  GRAPH_CHANGE_SET_CONTRACT,
  GRAPH_DELTA_CONTRACT,
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
        ? { ...shard, contentDigest: next.contentDigest ?? shard.contentDigest }
        : shard
    ),
  });
}

describe('planIncrementalGraphBuild', () => {
  it('plans a no-op incremental path when manifests are identical', () => {
    const manifest = readManifest('minimal-content-state-manifest.json');
    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: manifest,
      targetManifest: manifest,
    });

    expect(plan.status).toBe('complete');
    expect(plan.changeSet.contract).toEqual(GRAPH_CHANGE_SET_CONTRACT);
    expect(plan.changeSet.inputs).toEqual([]);
    expect(plan.delta.contract).toEqual(GRAPH_DELTA_CONTRACT);
    expect(plan.delta.execution.skippedByDigest).toBe(1);
    expect(plan.delta.execution.recomputed).toBe(0);
    expect(plan.delta.execution.scanned).toBe(0);
    expect(plan.delta.execution.parsed).toBe(0);
    expect(plan.accounting).toMatchObject({
      merkle: { comparedBranches: 0, skippedBranches: 1 },
      leaves: { added: 0, edited: 0, deleted: 0, renewed: 0, renameCandidates: 0, unchanged: 1 },
      shards: { reused: 1, rejected: 0 },
      bytes: { hashed: 0, reused: 0 },
    });
    expect(plan.providersToRecompute).toEqual([]);
    expect(plan.changeSet.causes).toEqual([]);
    expect(plan.delta.equivalence).toBe('not-assessed');
  });

  it('emits GraphDelta invalidations for edited content without fabricating fact ids', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('9999999999999999999999999999999999999999999999999999999999999999'),
    });
    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: base,
      targetManifest: target,
    });

    expect(plan.status).toBe('complete');
    expect(plan.changeSet.inputs).toHaveLength(1);
    expect(plan.providersToRecompute).toEqual(['workspai.graph.provider.ecmascript-imports']);
    expect(plan.delta.affectedProviders).toEqual(['workspai.graph.provider.ecmascript-imports']);
    expect(plan.delta.affectedProjections).toEqual(['workspai.graph.projection.dependency']);
    expect(plan.delta.downstreamInvalidations).toEqual(['query-cache:dependency-neighbors']);
    expect(plan.delta.facts).toEqual({
      added: [],
      renewed: [],
      removed: [],
      invalidated: [],
    });
    expect(plan.delta.execution).toMatchObject({
      detected: 1,
      scanned: 0,
      parsed: 0,
      recomputed: 1,
      skippedByDigest: 0,
    });
    expect(plan.accounting.leaves.edited).toBe(1);
    expect(plan.accounting.shards.rejected).toBe(1);
  });

  it('fails closed when comparison scope mismatches', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, {
      scope: { kind: 'workspace', workspaceId: 'workspace:other' },
    });
    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: base,
      targetManifest: target,
    });

    expect(plan.status).toBe('failed');
    expect(plan.changeSet.inputs).toEqual([]);
    expect(plan.providersToRecompute).toEqual([]);
    expect(plan.delta.execution.failed).toBe(1);
  });

  it('reports partial status when comparison budgets truncate changed inputs', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, {
      merkleRoot: digest('4444444444444444444444444444444444444444444444444444444444444444'),
      nodes: [
        ...base.nodes,
        {
          kind: 'file',
          locator: 'src/extra.ts',
          contentDigest: digest('5555555555555555555555555555555555555555555555555555555555555555'),
          inputKind: 'source-file',
          scanProfileDigest: digest(
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          ),
        },
      ] as GraphContentStateManifest['nodes'],
    });

    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: base,
      targetManifest: replaceFile(target, 'src/index.ts', {
        contentDigest: digest('6666666666666666666666666666666666666666666666666666666666666666'),
      }),
      comparisonBudget: { maxChangedInputs: 1 },
    });

    expect(plan.status).toBe('partial');
    expect(plan.changeSet.inputs).toHaveLength(1);
    expect(plan.delta.execution.truncation).toHaveLength(1);
  });

  it('attributes shard rejection to ontology, redaction and provider stamps instead of content', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const stamps = {
      ontology: digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      proofPolicy: digest('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      redaction: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
      compositionPolicy: digest('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
      providers: {
        'workspai.graph.provider.ecmascript-imports': digest(
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        ),
      },
      required: [
        digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        digest('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
        digest('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        digest('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
      ],
    };
    const stampedBase = withManifest(base, {
      shardDependencies: base.shardDependencies.map((shard) => ({
        ...shard,
        semanticDependencies: [
          stamps.ontology,
          stamps.proofPolicy,
          stamps.redaction,
          stamps.compositionPolicy,
          stamps.providers['workspai.graph.provider.ecmascript-imports']!,
        ],
      })),
    });
    const nextRedaction = digest(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    );
    const target = withManifest(stampedBase, {
      shardDependencies: stampedBase.shardDependencies.map((shard) => ({
        ...shard,
        semanticDependencies: [
          stamps.ontology,
          stamps.proofPolicy,
          nextRedaction,
          stamps.compositionPolicy,
          stamps.providers['workspai.graph.provider.ecmascript-imports']!,
        ],
      })),
    });
    const nextStamps = {
      ...stamps,
      redaction: nextRedaction,
      required: [stamps.ontology, stamps.proofPolicy, nextRedaction, stamps.compositionPolicy],
    };
    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: stampedBase,
      targetManifest: target,
      requiredSemanticDependencies: nextStamps.required,
      semanticStamps: nextStamps,
    });

    expect(plan.shardReuse.rejected[0]?.reason).toBe('missing-semantic-dependency');
    expect(plan.changeSet.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'redaction', source: 'shard-reuse-planning' }),
      ])
    );
    expect(
      plan.changeSet.causes.some(
        (cause) => cause.kind === 'content' && cause.source === 'shard-reuse-planning'
      )
    ).toBe(false);
  });
});
