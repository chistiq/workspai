import { describe, expect, it } from 'vitest';

import {
  beginGraphPhaseSession,
  createGraphPhaseAccumulator,
  graphPhaseTimings,
  recordGraphPhase,
  runWithGraphPhaseSession,
} from '../../src/application/phase-metrics.js';

describe('build-scoped phase metrics', () => {
  it('isolates concurrent builds so A cannot see or clear B', async () => {
    const accA = createGraphPhaseAccumulator();
    const accB = createGraphPhaseAccumulator();
    const seen: { a: number; b: number }[] = [];
    await Promise.all([
      runWithGraphPhaseSession(async () => {
        recordGraphPhase('inventory', { wallMs: 10, files: 1 });
        await Promise.resolve();
        recordGraphPhase('parse', { wallMs: 5, files: 2 });
        seen.push({
          a: graphPhaseTimings().reduce((sum, timing) => sum + timing.wallMs, 0),
          b: accB.timings().reduce((sum, timing) => sum + timing.wallMs, 0),
        });
      }, accA),
      runWithGraphPhaseSession(async () => {
        recordGraphPhase('composition', { wallMs: 40, facts: 9 });
        await Promise.resolve();
        beginGraphPhaseSession();
        recordGraphPhase('contentDigest', { wallMs: 7 });
        seen.push({
          a: accA.timings().reduce((sum, timing) => sum + timing.wallMs, 0),
          b: graphPhaseTimings().reduce((sum, timing) => sum + timing.wallMs, 0),
        });
      }, accB),
    ]);
    expect(accA.timings().some((timing) => timing.phase === 'composition')).toBe(false);
    expect(accA.timings().reduce((sum, timing) => sum + timing.wallMs, 0)).toBe(15);
    expect(accB.timings().some((timing) => timing.phase === 'inventory')).toBe(false);
    expect(accB.timings().reduce((sum, timing) => sum + timing.wallMs, 0)).toBe(7);
    expect(seen.length).toBe(2);
  });

  it('does not leak cancelled-build metrics into the next build', async () => {
    await runWithGraphPhaseSession(async () => {
      recordGraphPhase('inventory', { wallMs: 99, files: 4 });
      throw new Error('cancelled');
    }).catch(() => undefined);
    const next = await runWithGraphPhaseSession(async () => {
      recordGraphPhase('extract', { wallMs: 3, files: 1 });
      return graphPhaseTimings();
    });
    expect(next.map((timing) => timing.phase)).toEqual(['extract']);
    expect(next[0]?.wallMs).toBe(3);
  });

  it('keeps nested overlapping sessions isolated', async () => {
    const outer = await runWithGraphPhaseSession(async () => {
      recordGraphPhase('inventory', { wallMs: 1 });
      const inner = await runWithGraphPhaseSession(async () => {
        recordGraphPhase('parse', { wallMs: 2 });
        return graphPhaseTimings();
      });
      return { outer: graphPhaseTimings(), inner };
    });
    expect(outer.inner.map((timing) => timing.phase)).toEqual(['parse']);
    expect(outer.outer.map((timing) => timing.phase)).toEqual(['inventory']);
  });

  it('records nothing that could be mistaken for graph identity', () => {
    const timings = runWithGraphPhaseSession(() => {
      recordGraphPhase('composition', { wallMs: 12, facts: 4 });
      return graphPhaseTimings();
    });
    expect(JSON.stringify(timings)).not.toMatch(/generation|digest|sha256/u);
  });
});
