import { describe, expect, it } from 'vitest';

import { planInventoryReread } from '../../src/application/plan-inventory-reread.js';
import {
  absentChangeJournal,
  parseGitStatusPorcelain,
  untrustedChangeJournal,
} from '../../src/application/parse-git-status-porcelain.js';
import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';

const scanProfileDigest = Object.freeze({
  algorithm: 'sha256' as const,
  value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

function manifest() {
  return buildContentStateManifest({
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
      {
        locator: 'README.md',
        contentDigest: {
          algorithm: 'sha256',
          value: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        },
        inputKind: 'source-file',
        scanProfileDigest,
      },
    ],
  });
}

describe('Git-aware inventory reread planning', () => {
  it('reuses unchanged leaves when a trusted empty Git status is supplied', () => {
    const plan = planInventoryReread({
      priorManifest: manifest(),
      journal: parseGitStatusPorcelain(''),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.trust).toBe('trusted');
    expect(plan.reusedLocators).toEqual(['README.md', 'src/index.ts']);
    expect(plan.rereadLocators).toEqual([]);
  });

  it('rereads only Git-reported changes and new files', () => {
    const plan = planInventoryReread({
      priorManifest: manifest(),
      journal: parseGitStatusPorcelain(' M src/index.ts\n?? src/new.ts\n'),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.rereadLocators).toEqual(['src/index.ts', 'src/new.ts']);
    expect(plan.reusedLocators).toEqual(['README.md']);
  });

  it('forces a conservative full reread when the journal is absent or untrusted', () => {
    const prior = manifest();
    expect(
      planInventoryReread({
        priorManifest: prior,
        journal: absentChangeJournal(),
        scanProfileDigestValue: scanProfileDigest.value,
      }).rereadLocators
    ).toEqual(['README.md', 'src/index.ts']);
    expect(
      planInventoryReread({
        priorManifest: prior,
        journal: untrustedChangeJournal('git', 'Git index is incomplete.'),
        scanProfileDigestValue: scanProfileDigest.value,
      }).reusedLocators
    ).toEqual([]);
  });

  it('parses rename records without treating Git as Merkle authority', () => {
    const journal = parseGitStatusPorcelain('R  src/old.ts -> src/index.ts\n');
    expect(journal.records[0]).toMatchObject({
      locator: 'src/index.ts',
      kind: 'renamed',
      priorLocator: 'src/old.ts',
    });
    const plan = planInventoryReread({
      priorManifest: manifest(),
      journal,
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.rereadLocators).toContain('src/index.ts');
  });

  it('marks trusted deletions and rereads when the scan profile drifted', () => {
    const deleted = planInventoryReread({
      priorManifest: manifest(),
      journal: parseGitStatusPorcelain(' D README.md\n'),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(deleted.deletedLocators).toEqual(['README.md']);
    expect(deleted.reusedLocators).toEqual(['src/index.ts']);

    const drifted = planInventoryReread({
      priorManifest: manifest(),
      journal: parseGitStatusPorcelain(''),
      scanProfileDigestValue: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(drifted.rereadLocators).toEqual(['README.md', 'src/index.ts']);
  });

  it('decodes quoted porcelain paths', () => {
    const journal = parseGitStatusPorcelain(' M "src/quoted file.ts"\n');
    expect(journal.records[0]?.locator).toBe('src/quoted file.ts');
  });

  it('ignores truncated porcelain lines and maps copy/unknown codes', () => {
    const journal = parseGitStatusPorcelain('xx\nC  src/a.ts -> src/b.ts\n!! ignored\n?? new.ts\n');
    expect(journal.records.map((record) => record.kind)).toEqual([
      'renamed',
      'unknown',
      'untracked',
    ]);
  });
});
