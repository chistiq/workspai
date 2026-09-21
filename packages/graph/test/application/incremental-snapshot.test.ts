import { describe, expect, it } from 'vitest';

import {
  GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA,
  MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS,
  clampIncrementalSnapshotAttempts,
  compareIncrementalSnapshots,
  freezeIncrementalSnapshot,
  gitSnapshotFromJournal,
  membershipSnapshotFromLocators,
} from '../../src/application/incremental-snapshot.js';
import { parseGitStatusPorcelain } from '../../src/application/parse-git-status-porcelain.js';

describe('Incremental snapshot receipts', () => {
  it('matches identical Git and complete membership receipts', () => {
    const git = gitSnapshotFromJournal(parseGitStatusPorcelain(''));
    const membership = membershipSnapshotFromLocators(['src.ts'], true);
    const receipt = freezeIncrementalSnapshot({ git, membership });
    expect(receipt.schema).toBe(GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA);
    expect(compareIncrementalSnapshots(receipt, receipt)).toEqual({ consistent: true });
  });

  it('rejects Git identity or record drift', () => {
    const pre = freezeIncrementalSnapshot({
      git: gitSnapshotFromJournal(parseGitStatusPorcelain('')),
      membership: membershipSnapshotFromLocators(['src.ts'], true),
    });
    const post = freezeIncrementalSnapshot({
      git: gitSnapshotFromJournal(parseGitStatusPorcelain(' M src.ts\n')),
      membership: membershipSnapshotFromLocators(['src.ts'], true),
    });
    expect(compareIncrementalSnapshots(pre, post).consistent).toBe(false);
  });

  it('rejects membership adds and incomplete membership', () => {
    const git = gitSnapshotFromJournal(parseGitStatusPorcelain(''));
    const pre = freezeIncrementalSnapshot({
      git,
      membership: membershipSnapshotFromLocators(['src.ts'], true),
    });
    expect(
      compareIncrementalSnapshots(
        pre,
        freezeIncrementalSnapshot({
          git,
          membership: membershipSnapshotFromLocators(['src.ts', 'extra.ts'], true),
        })
      ).consistent
    ).toBe(false);
    expect(
      compareIncrementalSnapshots(
        pre,
        freezeIncrementalSnapshot({
          git,
          membership: membershipSnapshotFromLocators(['src.ts'], false),
        })
      ).consistent
    ).toBe(false);
  });

  it('clamps snapshot attempts into the admitted bound', () => {
    expect(clampIncrementalSnapshotAttempts(undefined)).toBe(MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS);
    expect(clampIncrementalSnapshotAttempts(0)).toBe(1);
    expect(clampIncrementalSnapshotAttempts(99)).toBe(MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS);
  });
});
