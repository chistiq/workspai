import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { buildGraphChangeOverlay } from '../../src/application/build-graph-change-overlay.js';
import { compareChangeOverlays } from '../../src/application/compare-change-overlays.js';
import {
  applyGraphChangeOverlayStaleness,
  evaluateGraphChangeOverlayStaleness,
} from '../../src/application/evaluate-overlay-staleness.js';
import {
  GRAPH_CHANGE_OVERLAY_CONTRACT,
  GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
  type GraphContentStateLeaf,
  type GraphContentStateManifest,
  type GraphGenerationRef,
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
  const merkleRoot = digest('9999999999999999999999999999999999999999999999999999999999999999');
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

function baseGenerationFrom(manifest: GraphContentStateManifest): GraphGenerationRef {
  return Object.freeze({
    id: 'generation:base',
    generatedAt: manifest.generatedAt,
    contentDigest: manifest.merkleRoot,
  });
}

function overlayRequest(
  base: GraphContentStateManifest,
  proposed: GraphContentStateManifest,
  overlayId = 'overlay:patch-1'
) {
  return {
    overlayId,
    baseGeneration: baseGenerationFrom(base),
    baseManifest: base,
    proposedManifest: proposed,
    proposal: Object.freeze({
      kind: 'patch' as const,
      identity: 'patch:fixture:1',
      digest: proposed.merkleRoot.value,
    }),
    assumptions: Object.freeze(['providers-not-re-executed']),
    generatedAt: '2026-09-09T21:00:00.000Z',
    expiresAt: '2026-09-09T22:00:00.000Z',
  };
}

describe('buildGraphChangeOverlay', () => {
  it('builds a non-canonical overlay bound to targetOverlay rather than a generation', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const proposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('8888888888888888888888888888888888888888888888888888888888888888'),
    });
    const overlay = buildGraphChangeOverlay(overlayRequest(base, proposed));

    expect(overlay.contract).toEqual(GRAPH_CHANGE_OVERLAY_CONTRACT);
    expect(overlay.status).toBe('complete');
    expect(overlay.predictedDelta.contract).toEqual(GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT);
    expect(overlay.predictedDelta.targetOverlay).toBe('overlay:patch-1');
    expect(overlay.predictedDelta).not.toHaveProperty('targetGeneration');
    expect(overlay.predictedDelta.facts).toEqual({
      added: [],
      renewed: [],
      removed: [],
      invalidated: [],
    });
    expect(overlay.quality.releaseClaims).toEqual(
      expect.arrayContaining(['non-canonical-overlay', 'no-latest-advancement'])
    );
    expect(overlay.proposedChangeSet.inputs).toHaveLength(1);
  });

  it('admits the built overlay against its schema without local path leakage', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const proposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('7777777777777777777777777777777777777777777777777777777777777777'),
    });
    const overlay = buildGraphChangeOverlay(overlayRequest(base, proposed));
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'schemas/graph-change-overlay.v0.1.0-candidate.schema.json'),
        'utf8'
      )
    );
    const validate = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      validateFormats: false,
    }).compile(schema);

    expect(validate(JSON.parse(JSON.stringify(overlay))), JSON.stringify(validate.errors)).toBe(
      true
    );
    expect(JSON.stringify(overlay)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });

  it('fails closed when base generation digest does not bind to the base manifest', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const proposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('6666666666666666666666666666666666666666666666666666666666666666'),
    });
    const overlay = buildGraphChangeOverlay({
      ...overlayRequest(base, proposed),
      baseGeneration: Object.freeze({
        id: 'generation:base',
        generatedAt: base.generatedAt,
        contentDigest: digest('0000000000000000000000000000000000000000000000000000000000000000'),
      }),
    });

    expect(overlay.status).toBe('failed');
    expect(overlay.diagnostics.map((entry) => entry.code)).toContain(
      'GRAPH_OVERLAY_BASE_GENERATION_MISMATCH'
    );
  });

  it('evaluates stale overlays when base, proposal or expiry drift', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const proposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('5555555555555555555555555555555555555555555555555555555555555555'),
    });
    const overlay = buildGraphChangeOverlay(overlayRequest(base, proposed));

    expect(
      evaluateGraphChangeOverlayStaleness({
        overlay,
        currentBaseGeneration: overlay.baseGeneration,
        currentProposalDigest: overlay.proposal.digest,
        evaluatedAt: '2026-09-09T21:30:00.000Z',
      }).stale
    ).toBe(false);

    expect(
      evaluateGraphChangeOverlayStaleness({
        overlay,
        currentBaseGeneration: Object.freeze({
          ...overlay.baseGeneration,
          contentDigest: digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        }),
        currentProposalDigest: overlay.proposal.digest,
        evaluatedAt: '2026-09-09T21:30:00.000Z',
      })
    ).toMatchObject({
      stale: true,
      reasons: expect.arrayContaining(['base-generation-changed']),
    });

    expect(
      evaluateGraphChangeOverlayStaleness({
        overlay,
        currentBaseGeneration: overlay.baseGeneration,
        currentProposalDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        evaluatedAt: '2026-09-09T23:00:00.000Z',
      }).reasons
    ).toEqual(expect.arrayContaining(['proposal-changed', 'overlay-expired']));
  });

  it('marks overlay status stale when applyGraphChangeOverlayStaleness detects drift', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const proposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('5555555555555555555555555555555555555555555555555555555555555555'),
    });
    const overlay = buildGraphChangeOverlay(overlayRequest(base, proposed));
    const stale = applyGraphChangeOverlayStaleness({
      overlay,
      currentBaseGeneration: overlay.baseGeneration,
      currentProposalDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      evaluatedAt: '2026-09-09T23:00:00.000Z',
    });
    expect(stale.status).toBe('stale');
    expect(stale.diagnostics.length).toBeGreaterThan(overlay.diagnostics.length);
  });

  it('returns advisory overlap without merge-conflict claims', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const leftProposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('4444444444444444444444444444444444444444444444444444444444444444'),
    });
    const rightProposed = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('3333333333333333333333333333333333333333333333333333333333333333'),
    });
    const left = buildGraphChangeOverlay(overlayRequest(base, leftProposed, 'overlay:left'));
    const right = buildGraphChangeOverlay(overlayRequest(base, rightProposed, 'overlay:right'));

    const overlap = compareChangeOverlays({ left, right });
    expect(overlap.sharedChangedLocators).toEqual(['src/index.ts']);
    expect(overlap.advisoryMergeOrderRisk).toBe('shared-inputs');
    expect(overlap.limitations).toEqual(
      expect.arrayContaining(['No textual, semantic or runtime merge-conflict claim is made.'])
    );
  });
});
