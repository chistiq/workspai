import { describe, expect, it } from 'vitest';

import {
  graphDataMovementSnapshot,
  recordGraphDataMovement,
  recordGraphRetainedBytes,
  runWithGraphDataMovementSession,
} from '../../src/application/data-movement.js';
import { snapshotGraphBuildMemory } from '../../src/application/build-memory.js';

describe('build-scoped data movement and memory', () => {
  it('isolates counters between concurrent sessions', async () => {
    const seen: number[] = [];
    await Promise.all([
      runWithGraphDataMovementSession(async () => {
        recordGraphDataMovement('cloned', 2);
        recordGraphRetainedBytes('facts', 32);
        await Promise.resolve();
        seen.push(graphDataMovementSnapshot()?.ops.cloned ?? 0);
      }),
      runWithGraphDataMovementSession(async () => {
        recordGraphDataMovement('hashed', 9);
        await Promise.resolve();
        seen.push(graphDataMovementSnapshot()?.ops.cloned ?? 0);
      }),
    ]);
    expect(seen).toContain(2);
    expect(seen).toContain(0);
  });

  it('snapshots process memory without affecting graph identity fields', () => {
    const snapshot = snapshotGraphBuildMemory('end');
    expect(snapshot.rssBytes).toBeGreaterThan(0);
    expect(snapshot.heapUsedBytes).toBeGreaterThan(0);
    expect(snapshot.at).toBe('end');
  });
});
