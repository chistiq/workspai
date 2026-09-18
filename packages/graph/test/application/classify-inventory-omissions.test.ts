import { describe, expect, it } from 'vitest';

import {
  classifyGraphInventoryOmission,
  excludedDirectoryOmissionCode,
  inventoryCodesPreventCompleteness,
  inventoryOmissionIsResourceTruncation,
  summarizeGraphInventoryOmissions,
} from '../../src/application/classify-inventory-omissions.js';

describe('inventory omission classification', () => {
  it('classifies policy and symlink omissions as bounded complete regions', () => {
    expect(classifyGraphInventoryOmission('graph.sensitive-input-omitted')).toBe('policy-excluded');
    expect(classifyGraphInventoryOmission('graph.repository-symlink-unsupported')).toBe(
      'symlink-policy'
    );
    expect(classifyGraphInventoryOmission('graph.git-indirection-unsupported')).toBe(
      'policy-excluded'
    );
    expect(
      inventoryCodesPreventCompleteness([
        'graph.sensitive-input-omitted',
        'graph.repository-symlink-unsupported',
        'graph.repository-vendored-directory',
      ])
    ).toBe(false);
    expect(inventoryOmissionIsResourceTruncation('graph.sensitive-input-omitted')).toBe(false);
  });

  it('treats resource truncation and unsafe locators as unknown completeness', () => {
    expect(classifyGraphInventoryOmission('graph.repository-budget-truncated')).toBe(
      'file-count-budget'
    );
    expect(inventoryOmissionIsResourceTruncation('graph.repository-file-size-truncated')).toBe(
      true
    );
    expect(inventoryCodesPreventCompleteness(['graph.repository-depth-truncated'])).toBe(true);
    expect(inventoryCodesPreventCompleteness(['graph.unicode-locator-collision'])).toBe(true);
    expect(classifyGraphInventoryOmission('graph.unknown-new-code')).toBe('unclassified');
    expect(inventoryCodesPreventCompleteness(['graph.unknown-new-code'])).toBe(true);
  });

  it('maps excluded directory names generically without repository-specific paths', () => {
    expect(excludedDirectoryOmissionCode('node_modules')).toBe(
      'graph.repository-vendored-directory'
    );
    expect(excludedDirectoryOmissionCode('dist')).toBe('graph.repository-policy-directory');
    expect(excludedDirectoryOmissionCode('.git')).toBe('graph.repository-ignored-directory');
    expect(excludedDirectoryOmissionCode('.github')).toBe('graph.repository-policy-directory');
    expect(excludedDirectoryOmissionCode('tmp')).toBe('graph.repository-policy-directory');
  });

  it('summarizes omission classes with bounded codes', () => {
    expect(
      summarizeGraphInventoryOmissions([
        'graph.repository-symlink-unsupported',
        'graph.repository-symlink-unsupported',
        'graph.sensitive-input-omitted',
      ])
    ).toEqual([
      {
        class: 'policy-excluded',
        count: 1,
        codes: ['graph.sensitive-input-omitted'],
      },
      {
        class: 'symlink-policy',
        count: 2,
        codes: ['graph.repository-symlink-unsupported'],
      },
    ]);
  });
});
