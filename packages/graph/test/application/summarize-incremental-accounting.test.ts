import { describe, expect, it } from 'vitest';

import { planIncrementalGraphBuild } from '../../src/application/plan-incremental-graph-build.js';
import {
  emptyIncrementalAccounting,
  overlayExecutedIncrementalAccounting,
  summarizeIncrementalAccounting,
} from '../../src/application/summarize-incremental-accounting.js';
import type { GraphContentStateManifest } from '../../src/contracts/index.js';

const digest = (value: string) => ({ algorithm: 'sha256' as const, value });

function manifest(locator: string, content: string): GraphContentStateManifest {
  return {
    contract: { id: 'workspai.graph.content-state-manifest', version: '0.1.0-candidate' },
    scope: { kind: 'project', projectIds: ['project:fixture'] },
    merkleRoot: digest(content),
    nodes: [
      {
        kind: 'file',
        locator,
        contentDigest: digest(content),
        inputKind: 'source-file',
        scanProfileDigest: digest('a'.repeat(64)),
      },
    ],
    shardDependencies: [],
    generatedAt: '2026-09-09T12:00:00.000Z',
  };
}

describe('summarizeIncrementalAccounting', () => {
  it('counts Merkle, leaf and shard dimensions without inventing hashed bytes at plan time', () => {
    const base = manifest('src/a.ts', 'c'.repeat(64));
    const target = manifest('src/a.ts', 'd'.repeat(64));
    const plan = planIncrementalGraphBuild({
      baseGeneration: 'generation:base',
      targetGeneration: 'generation:target',
      baseManifest: base,
      targetManifest: target,
    });
    expect(plan.accounting).toEqual(
      summarizeIncrementalAccounting({
        comparison: plan.comparison,
        shardReuse: plan.shardReuse,
        baseManifest: base,
        targetManifest: target,
      })
    );
    expect(plan.accounting.bytes).toEqual({ hashed: 0, reused: 0 });
    expect(emptyIncrementalAccounting().leaves.unchanged).toBe(0);
  });

  it('overlays hashed bytes and this-run parse counts onto planned execution', () => {
    const hashed = {
      locator: 'src/a.ts',
      mediaType: 'text/typescript',
      byteLength: 12,
      digest: digest('e'.repeat(64)),
    };
    const reused = {
      locator: 'src/b.ts',
      mediaType: 'text/typescript',
      byteLength: 8,
      digest: digest('f'.repeat(64)),
    };
    const overlaid = overlayExecutedIncrementalAccounting({
      planned: {
        detected: 1,
        scanned: 0,
        parsed: 0,
        recomputed: 1,
        skippedByDigest: 1,
        unsupported: 0,
        failed: 0,
        truncation: [],
        processing: [],
      },
      accounting: {
        ...emptyIncrementalAccounting(),
        leaves: { added: 0, edited: 1, deleted: 0, renewed: 0, renameCandidates: 0, unchanged: 1 },
      },
      hashedInputs: [hashed],
      reusedInputs: [reused],
      reread: {
        trust: 'trusted',
        source: 'git',
        rereadLocators: ['src/a.ts'],
        reusedLocators: ['src/b.ts'],
        deletedLocators: [],
        decisions: {
          'src/a.ts': 'reread',
          'src/b.ts': 'reuse-prior-digest',
        },
        observations: {},
        diagnostics: [],
      },
      thisRunProcessing: [
        {
          input: { locator: hashed.locator, digest: hashed.digest },
          provider: { id: 'provider:a', version: '1' },
          stage: { id: 'stage', version: '1' },
          outcome: 'processed',
          diagnostics: [],
        },
      ],
      providersExecuted: 1,
      unsupportedZones: 0,
      failed: false,
    });
    expect(overlaid.execution).toMatchObject({
      detected: 1,
      scanned: 1,
      parsed: 1,
      recomputed: 1,
      skippedByDigest: 1,
    });
    expect(overlaid.accounting.bytes).toEqual({ hashed: 12, reused: 8 });
  });
});
