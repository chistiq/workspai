import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { queryChangeOverlay } from '../../src/application/query-change-overlay.js';
import { applyGraphChangeOverlayStaleness } from '../../src/application/evaluate-overlay-staleness.js';
import type { GraphChangeOverlay } from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('queryChangeOverlay', () => {
  it('returns predicted impact for subjects referenced by the overlay delta', () => {
    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'fixtures/g6/minimal-graph-change-overlay.json'),
        'utf8'
      )
    ) as GraphChangeOverlay;
    const result = queryChangeOverlay({
      overlay: {
        ...overlay,
        predictedDelta: {
          ...overlay.predictedDelta,
          affectedProviders: ['workspai.graph.provider.ecmascript-imports'],
          changedInputs: [
            {
              kind: 'edited',
              locator: 'src/index.ts',
              inputKind: 'source-file',
              scanProfileDigest: {
                algorithm: 'sha256',
                value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            },
          ],
        },
      },
      query: {
        kind: 'impact',
        subject: 'workspai.graph.provider.ecmascript-imports',
      },
    });
    expect(result.observed).toBe('base-generation-bound');
    expect(result.predicted.affectedProviders).toContain(
      'workspai.graph.provider.ecmascript-imports'
    );
  });

  it('returns empty predicted impact when the subject is not referenced', () => {
    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'fixtures/g6/minimal-graph-change-overlay.json'),
        'utf8'
      )
    ) as GraphChangeOverlay;
    const result = queryChangeOverlay({
      overlay,
      query: { kind: 'impact', subject: 'service:billing' },
    });
    expect(result.predicted.affectedProviders).toEqual([]);
    expect(
      result.diagnostics.some((entry) => entry.code === 'GRAPH_OVERLAY_QUERY_NO_PREDICTED_IMPACT')
    ).toBe(true);
  });

  it('rejects unsupported overlay query kinds fail-closed', () => {
    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'fixtures/g6/minimal-graph-change-overlay.json'),
        'utf8'
      )
    ) as GraphChangeOverlay;
    const result = queryChangeOverlay({
      overlay,
      query: { kind: 'unsupported' as 'impact', subject: 'service:billing' },
    });
    expect(
      result.diagnostics.some((entry) => entry.code === 'GRAPH_OVERLAY_QUERY_UNSUPPORTED')
    ).toBe(true);
  });

  it('fails closed for stale overlays', () => {
    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, 'fixtures/g6/minimal-graph-change-overlay.json'),
        'utf8'
      )
    ) as GraphChangeOverlay;
    const stale = applyGraphChangeOverlayStaleness({
      overlay,
      currentBaseGeneration: overlay.baseGeneration,
      currentProposalDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      evaluatedAt: '2026-09-09T23:00:00.000Z',
    });
    const result = queryChangeOverlay({
      overlay: stale,
      query: { kind: 'impact', subject: 'workspai.graph.provider.ecmascript-imports' },
    });
    expect(result.predicted.affectedProviders).toEqual([]);
    expect(result.diagnostics.some((entry) => entry.code === 'GRAPH_OVERLAY_QUERY_STALE')).toBe(
      true
    );
  });
});
