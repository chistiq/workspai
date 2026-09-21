import { describe, expect, it } from 'vitest';

import {
  parseGitLsFilesStageZ,
  parseGitLsFilesVerboseZ,
  parseGitStatusPorcelainV2Z,
  planInventoryReread,
  scopeChangeJournalToGraphRoot,
} from '../../src/application/index.js';
import { GRAPH_GIT_WORKTREE_BASELINE_SCHEMA } from '../../src/ports/index.js';
import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';

const scanProfileDigest = Object.freeze({
  algorithm: 'sha256' as const,
  value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

function z(records: readonly string[]): string {
  return `${records.join('\0')}\0`;
}

describe('Git porcelain v2 -z parsing', () => {
  it('parses ordinary, untracked, rename and copy records without quoting', () => {
    const journal = parseGitStatusPorcelainV2Z(
      z([
        '1 .M N... 100644 100644 100644 0 0 src/quoted file.ts',
        '1 A. N... 100644 100644 100644 0 0 src/added.ts',
        '? src/new file.ts',
        '2 R. N... 100644 100644 100644 0 0 R100 src/renamed.ts',
        'src/old.ts',
        '2 C. N... 100644 100644 100644 0 0 C100 src/copy.ts',
        'src/origin.ts',
      ])
    );
    expect(journal.trust).toBe('trusted');
    expect(journal.records.map((record) => `${record.kind}:${record.locator}`)).toEqual([
      'changed:src/quoted file.ts',
      'added:src/added.ts',
      'untracked:src/new file.ts',
      'renamed:src/renamed.ts',
      'renamed:src/copy.ts',
    ]);
    expect(journal.records[3]?.priorLocator).toBe('src/old.ts');
  });

  it('preserves newlines, Unicode, quotes and rename arrows inside filenames', () => {
    const journal = parseGitStatusPorcelainV2Z(
      z([
        '1 .M N... 100644 100644 100644 0 0 src/new\nline.ts',
        '1 .M N... 100644 100644 100644 0 0 src/quote"file.ts',
        '1 .M N... 100644 100644 100644 0 0 src/arrow -> file.ts',
        '1 .M N... 100644 100644 100644 0 0 src/Caf\u00e9.ts',
      ])
    );
    expect(journal.trust).toBe('trusted');
    expect(journal.records.map((record) => record.locator)).toEqual([
      'src/new\nline.ts',
      'src/quote"file.ts',
      'src/arrow -> file.ts',
      'src/Caf\u00e9.ts',
    ]);
  });

  it('treats malformed, unmerged, absolute and escaping records as untrusted', () => {
    expect(parseGitStatusPorcelainV2Z('not porcelain\0').trust).toBe('untrusted');
    expect(
      parseGitStatusPorcelainV2Z(z(['2 R. N... 100644 100644 100644 0 0 R100 dest.ts'])).trust
    ).toBe('untrusted');
    expect(
      parseGitStatusPorcelainV2Z(z(['1 .M N... 100644 100644 100644 0 0 /tmp/abs.ts'])).trust
    ).toBe('untrusted');
    expect(
      parseGitStatusPorcelainV2Z(z(['1 .M N... 100644 100644 100644 0 0 ../escape.ts'])).trust
    ).toBe('untrusted');
    expect(
      parseGitStatusPorcelainV2Z(z(['u UU N... 100644 100644 100644 100644 0 0 0 src/conflict.ts']))
        .trust
    ).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z('# branch.oid abc\0').trust).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z(z(['! /tmp/ignored.ts'])).trust).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z(z(['! src/ignored.ts'])).records[0]?.kind).toBe('unknown');
    expect(parseGitStatusPorcelainV2Z(z(['1 BAD'])).trust).toBe('untrusted');
    expect(
      scopeChangeJournalToGraphRoot(
        {
          trust: 'trusted',
          source: 'git',
          records: [{ locator: '../escape.ts', kind: 'changed' }],
          diagnostics: [],
        },
        'packages/cli/'
      ).trust
    ).toBe('untrusted');
    expect(
      scopeChangeJournalToGraphRoot(
        {
          trust: 'trusted',
          source: 'git',
          records: [{ locator: 'src/new.ts', kind: 'renamed', priorLocator: '../old.ts' }],
          diagnostics: [],
        },
        'packages/cli/'
      ).trust
    ).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z(z(['? /abs.ts'])).trust).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z(z(['? nested/'])).trust).toBe('untrusted');
    expect(parseGitStatusPorcelainV2Z(z(['? nested/'])).diagnostics[0]?.message).toMatch(
      /directory/u
    );
    expect(
      parseGitStatusPorcelainV2Z(
        z([
          '1 .M S.M. 160000 160000 160000 abcdefabcdefabcdefabcdefabcdefabcdefabcd abcdefabcdefabcdefabcdefabcdefabcdefabcd nested',
        ])
      ).trust
    ).toBe('untrusted');
    expect(
      parseGitStatusPorcelainV2Z(
        z([
          '1 .M S.M. 160000 160000 160000 abcdefabcdefabcdefabcdefabcdefabcdefabcd abcdefabcdefabcdefabcdefabcdefabcdefabcd nested',
        ])
      ).diagnostics[0]?.message
    ).toMatch(/[Gg]itlink|submodule/u);
  });

  it('scopes subdirectory records and does not ignore malformed paths while trusted', () => {
    const scoped = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z(
        z([
          '1 .M N... 100644 100644 100644 0 0 packages/cli/src/index.ts',
          '1 .M N... 100644 100644 100644 0 0 packages/graph/src/cli.ts',
          '? packages/cli/src/new.ts',
          '2 R. N... 100644 100644 100644 0 0 R100 packages/cli/src/renamed.ts',
          'packages/cli/src/old.ts',
        ])
      ),
      'packages/cli/'
    );
    expect(scoped.trust).toBe('trusted');
    expect(scoped.records.map((record) => `${record.kind}:${record.locator}`)).toEqual([
      'changed:src/index.ts',
      'untracked:src/new.ts',
      'renamed:src/renamed.ts',
    ]);
  });

  it('scopes cross-boundary renames as add or delete and untrusts unsafe prefixes', () => {
    const entering = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z(
        z([
          '2 R. N... 100644 100644 100644 0 0 R100 packages/cli/src/from-graph.ts',
          'packages/graph/src/old.ts',
        ])
      ),
      'packages/cli/'
    );
    expect(entering.records.map((record) => `${record.kind}:${record.locator}`)).toEqual([
      'added:src/from-graph.ts',
    ]);
    const leaving = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z(
        z([
          '2 R. N... 100644 100644 100644 0 0 R100 packages/graph/src/from-cli.ts',
          'packages/cli/src/old.ts',
        ])
      ),
      'packages/cli/'
    );
    expect(leaving.records.map((record) => `${record.kind}:${record.locator}`)).toEqual([
      'deleted:src/old.ts',
    ]);
    const bothOut = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z(
        z([
          '2 R. N... 100644 100644 100644 0 0 R100 packages/graph/src/new.ts',
          'packages/graph/src/old.ts',
        ])
      ),
      'packages/cli/'
    );
    expect(bothOut.records).toEqual([]);
    expect(scopeChangeJournalToGraphRoot(entering, '../escape/').trust).toBe('untrusted');
  });

  it('rereads restored locators recorded on a trusted dirty-base journal', () => {
    const plan = planInventoryReread({
      priorManifest: buildContentStateManifest({
        scope: { kind: 'project', projectIds: ['project:fixture'] },
        generatedAt: '2026-09-09T20:00:00.000Z',
        scanProfileDigest,
        leaves: [
          {
            locator: 'src/index.ts',
            contentDigest: {
              algorithm: 'sha256',
              value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            },
            inputKind: 'source-file',
            scanProfileDigest,
          },
        ],
      }),
      journal: {
        trust: 'trusted',
        source: 'git',
        records: [{ locator: 'src/index.ts', kind: 'changed', gitStatus: 'restored' }],
        diagnostics: [],
        baseline: {
          schema: GRAPH_GIT_WORKTREE_BASELINE_SCHEMA,
          worktreeKey: 'b'.repeat(64),
          head: 'c'.repeat(40),
          indexKey: 'd'.repeat(64),
          prefix: '',
          clean: false,
          detached: false,
          branch: 'main',
          dirtyLocators: ['src/index.ts'],
        },
      },
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.rereadLocators).toEqual(['src/index.ts']);
    expect(plan.reusedLocators).toEqual([]);
  });
});

describe('Git ls-files -v -z parsing', () => {
  it('keeps cached files observable and flags assume-unchanged and skip-worktree', () => {
    const parsed = parseGitLsFilesVerboseZ(
      z(['H src.ts', 'h assumed.ts', 'S skip.ts', 's both.ts', 'H path with space.ts'])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toEqual([
      { tag: 'H', locator: 'src.ts' },
      { tag: 'h', locator: 'assumed.ts' },
      { tag: 'S', locator: 'skip.ts' },
      { tag: 's', locator: 'both.ts' },
      { tag: 'H', locator: 'path with space.ts' },
    ]);
    expect(
      parsed.entries.filter((entry) => entry.tag !== 'H').map((entry) => entry.locator)
    ).toEqual(['assumed.ts', 'skip.ts', 'both.ts']);
  });

  it('rejects malformed, absolute and escaping locators', () => {
    expect(parseGitLsFilesVerboseZ(z(['H'])).ok).toBe(false);
    expect(parseGitLsFilesVerboseZ(z(['Hsrc.ts'])).ok).toBe(false);
    expect(parseGitLsFilesVerboseZ(z(['H /tmp/abs.ts'])).ok).toBe(false);
    expect(parseGitLsFilesVerboseZ(z(['H ../escape.ts'])).ok).toBe(false);
    expect(parseGitLsFilesVerboseZ(z(['1 src.ts'])).ok).toBe(false);
  });
});

describe('Git ls-files --stage -z parsing', () => {
  it('keeps regular files and flags gitlinks', () => {
    const parsed = parseGitLsFilesStageZ(
      z([
        '100644 efeee5db16c087416d13e29bc506c998eeaf0827 0\tsrc.ts',
        '160000 1b1f523188545307c7914e6a3fdbc349900c5ba0 0\tnested',
      ])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toEqual([
      { mode: '100644', locator: 'src.ts' },
      { mode: '160000', locator: 'nested' },
    ]);
  });

  it('rejects malformed stage records', () => {
    expect(parseGitLsFilesStageZ(z(['100644 hash 0 src.ts'])).ok).toBe(false);
    expect(parseGitLsFilesStageZ(z(['160000 abc 0\tnested'])).ok).toBe(false);
    expect(
      parseGitLsFilesStageZ(z(['100644 efeee5db16c087416d13e29bc506c998eeaf0827 0\t/abs.ts'])).ok
    ).toBe(false);
  });
});
