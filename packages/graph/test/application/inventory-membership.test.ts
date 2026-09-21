import { describe, expect, it } from 'vitest';

import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import {
  GRAPH_INVENTORY_MEMBERSHIP_SCHEMA,
  MAX_INVENTORY_MEMBERSHIP_BYTES,
  MAX_INVENTORY_MEMBERSHIP_LOCATORS,
  applyInventoryMembership,
  compareInventoryMembership,
  freezeInventoryMembership,
  inventoryMembershipIsBounded,
  inventoryMembershipIsComplete,
} from '../../src/application/inventory-membership.js';
import { parseGitStatusPorcelain } from '../../src/application/parse-git-status-porcelain.js';
import { planInventoryReread } from '../../src/application/plan-inventory-reread.js';

const scanProfileDigest = Object.freeze({
  algorithm: 'sha256' as const,
  value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
});

function manifest(locators: readonly string[]) {
  return buildContentStateManifest({
    scope: { kind: 'project', projectIds: ['project:fixture'] },
    generatedAt: '2026-09-09T20:00:00.000Z',
    scanProfileDigest,
    leaves: locators.map((locator, index) => ({
      locator,
      contentDigest: {
        algorithm: 'sha256' as const,
        value: `${index.toString(16).padStart(64, 'c')}`,
      },
      inputKind: 'source-file',
      scanProfileDigest,
    })),
  });
}

describe('Inventory membership', () => {
  it('detects added and removed locators independently of Git', () => {
    expect(
      compareInventoryMembership(['src.ts', 'kept.ts'], ['kept.ts', 'ignored-new.ts'])
    ).toEqual({
      added: ['ignored-new.ts'],
      removed: ['src.ts'],
      retained: ['kept.ts'],
    });
  });

  it('hashes new membership files and drops files that left the tree', () => {
    const plan = planInventoryReread({
      priorManifest: manifest(['src.ts', 'gone.ts']),
      journal: parseGitStatusPorcelain(''),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.reusedLocators).toEqual(['gone.ts', 'src.ts']);
    const updated = applyInventoryMembership(plan, ['src.ts', 'ignored-new.ts']);
    expect(updated.rereadLocators).toEqual(['ignored-new.ts']);
    expect(updated.reusedLocators).toEqual(['src.ts']);
    expect(updated.deletedLocators).toEqual(['gone.ts']);
  });

  it('rereads a Git-deleted locator that is still present on the filesystem', () => {
    const plan = planInventoryReread({
      priorManifest: manifest(['restored.ts']),
      journal: parseGitStatusPorcelain(' D restored.ts\n'),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.deletedLocators).toEqual(['restored.ts']);
    const updated = applyInventoryMembership(plan, ['restored.ts']);
    expect(updated.rereadLocators).toEqual(['restored.ts']);
    expect(updated.deletedLocators).toEqual([]);
  });

  it('rereads a membership file that Git classified as skip-absent', () => {
    const plan = planInventoryReread({
      priorManifest: manifest(['src.ts']),
      journal: parseGitStatusPorcelain(' D phantom.ts\n'),
      scanProfileDigestValue: scanProfileDigest.value,
    });
    expect(plan.decisions['phantom.ts']).toBe('skip-absent');
    const updated = applyInventoryMembership(plan, ['src.ts', 'phantom.ts']);
    expect(updated.rereadLocators).toContain('phantom.ts');
  });

  it('ignores non-portable and directory-shaped membership locators', () => {
    expect(
      compareInventoryMembership(['../escape', 'dir/', 'kept.ts'], ['kept.ts', 'dir/'])
    ).toEqual({
      added: [],
      removed: [],
      retained: ['kept.ts'],
    });
    expect(freezeInventoryMembership(['../escape', 'dir/'])?.locators).toEqual([]);
  });

  it('freezes a versioned NFC membership snapshot', () => {
    const snapshot = freezeInventoryMembership(['b.ts', 'Cafe\u0301.ts', 'b.ts'], {
      complete: true,
    });
    expect(snapshot?.schema).toBe(GRAPH_INVENTORY_MEMBERSHIP_SCHEMA);
    expect(snapshot?.complete).toBe(true);
    expect(snapshot?.locators).toEqual(['b.ts', 'Caf\u00e9.ts']);
  });

  it('does not treat missing membership as complete', () => {
    expect(
      inventoryMembershipIsComplete({
        status: 'complete',
        inputs: [],
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
      })
    ).toBe(false);
  });

  it('does not treat failed or cancelled inventory as complete membership', () => {
    const base = {
      inputs: [],
      diagnostics: [],
      omittedFiles: 0,
      omittedBytes: 0,
      unknownZones: [],
      unsupportedZones: [],
      membershipLocators: ['a.ts'],
    };
    expect(inventoryMembershipIsComplete({ ...base, status: 'failed' })).toBe(false);
    expect(inventoryMembershipIsComplete({ ...base, status: 'cancelled' })).toBe(false);
  });

  it('does not treat truncated membership as complete', () => {
    expect(
      inventoryMembershipIsComplete({
        status: 'complete',
        inputs: [],
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
        membershipLocators: ['a.ts'],
        membershipTruncated: true,
      })
    ).toBe(false);
  });

  it('rejects unbounded membership locator counts and encoded bytes', () => {
    expect(
      inventoryMembershipIsBounded(
        Array.from({ length: MAX_INVENTORY_MEMBERSHIP_LOCATORS + 1 }, () => 'a.ts')
      )
    ).toBe(false);
    expect(inventoryMembershipIsBounded(['a'.repeat(MAX_INVENTORY_MEMBERSHIP_BYTES)])).toBe(false);
  });
});
