import { loadavg } from 'node:os';

import { describe, expect, it } from 'vitest';

import { buildNodeRepoGraph } from '../../src/adapters/node/index.js';

const root = process.env.WORKSPAI_GRAPH_MEASURE_ROOT ?? '';
const mode = process.env.WORKSPAI_GRAPH_MEASURE_MODE ?? '';

describe.skipIf(root.length === 0 || (mode !== 'typescript' && mode !== 'rust'))(
  'native composition measurement sample',
  () => {
    it('records one fresh build without compatibility materialization', async () => {
      if (mode === 'rust') process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
      else delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      const started = Date.now();
      const result = await buildNodeRepoGraph({ root });
      const timings = result.metrics.compositionTimings;
      const sample = {
        mode,
        status: result.status,
        wallMs: Date.now() - started,
        compositionMs: result.metrics.compositionMs ?? 0,
        processTreeRssBytes:
          mode === 'rust'
            ? (timings?.ownedSimultaneousRssBytes ?? 0)
            : (result.metrics.peakObservedRssBytes ?? 0),
        factDigest: result.compositionReceipt?.factSetDigest.value ?? '',
        contentDigest: result.compositionReceipt?.contentDigest.value ?? '',
        fallback: timings?.ownedFallbackReason ?? '',
        truncated: false,
        nodeCount: result.nativeSnapshot?.nodeCount ?? result.graph?.nodes.length ?? 0,
        edgeCount: result.nativeSnapshot?.edgeCount ?? result.graph?.edges.length ?? 0,
        materialized: result.graph !== undefined,
        load1: loadavg()[0] ?? 0,
      };
      process.stdout.write(`MEASURE_SAMPLE=${JSON.stringify(sample)}\n`);
      expect(result.status === 'complete' || result.status === 'partial').toBe(true);
    });
  }
);
