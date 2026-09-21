import { describe, expect, it } from 'vitest';

import {
  admitGitSkipReread,
  freezeGitWorktreeBaseline,
} from '../../src/application/git-worktree-baseline.js';
import { GRAPH_GIT_WORKTREE_BASELINE_SCHEMA } from '../../src/ports/index.js';
import type { GraphGitWorktreeBaseline } from '../../src/ports/index.js';

function baseline(overrides: Partial<GraphGitWorktreeBaseline> = {}): GraphGitWorktreeBaseline {
  return {
    schema: GRAPH_GIT_WORKTREE_BASELINE_SCHEMA,
    worktreeKey: 'a'.repeat(64),
    head: 'b'.repeat(40),
    indexKey: 'c'.repeat(64),
    prefix: '',
    clean: true,
    detached: false,
    branch: 'main',
    ...overrides,
  };
}

describe('admitGitSkipReread', () => {
  it('admits a clean base in the same worktree with compatible HEAD', () => {
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({
          clean: false,
          dirtyLocators: ['changed.ts'],
          indexKey: 'd'.repeat(64),
        }),
        scopedRecordCount: 1,
      })
    ).toEqual({ admitted: true });
  });

  it('admits a dirty base that records dirty locators in the same worktree', () => {
    expect(
      admitGitSkipReread({
        base: baseline({ clean: false, dirtyLocators: ['src.ts'] }),
        current: baseline({ clean: false, dirtyLocators: ['src.ts'], indexKey: 'd'.repeat(64) }),
        scopedRecordCount: 1,
      })
    ).toEqual({ admitted: true });
  });

  it('rejects a dirty base that omitted dirty locators', () => {
    expect(
      admitGitSkipReread({
        base: baseline({ clean: false }),
        current: baseline(),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
  });

  it('rejects missing, switched, detached, and empty-porcelain index drift', () => {
    expect(
      admitGitSkipReread({
        base: undefined,
        current: baseline(),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline({ clean: false }),
        current: baseline(),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ worktreeKey: 'e'.repeat(64) }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ head: 'f'.repeat(40) }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ branch: 'other' }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ indexKey: 'd'.repeat(64) }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ prefix: 'packages/cli/' }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline(),
        current: baseline({ detached: true, branch: '' }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline({ scanProfileDigest: '1'.repeat(64) }),
        current: baseline({ scanProfileDigest: '2'.repeat(64) }),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      admitGitSkipReread({
        base: baseline({ branch: 'feat\\other' }),
        current: baseline(),
        scopedRecordCount: 0,
      }).admitted
    ).toBe(false);
    expect(
      freezeGitWorktreeBaseline(
        baseline({ scanProfileDigest: '1'.repeat(64), inventoryDigest: '2'.repeat(64) })
      )
    ).toMatchObject({
      scanProfileDigest: '1'.repeat(64),
      inventoryDigest: '2'.repeat(64),
    });
  });
});
