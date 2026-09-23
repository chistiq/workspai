import { describe, expect, it } from 'vitest';

import { resolveDeclaredImportLocator } from '../../src/providers/language-imports.js';

const locators = new Set([
  'src/currency/src/server.cpp',
  'src/currency/src/logger_common.h',
  'include/vector.h',
]);

describe('declared import file resolution', () => {
  it('binds a quoted header to the admitted file beside the importer', () => {
    expect(
      resolveDeclaredImportLocator('src/currency/src/server.cpp', 'logger_common.h', locators)
    ).toBe('src/currency/src/logger_common.h');
  });

  it('keeps a bare module and a missing header unresolved', () => {
    expect(resolveDeclaredImportLocator('src/app.py', 'os', locators)).toBeUndefined();
    expect(
      resolveDeclaredImportLocator('src/currency/src/server.cpp', 'missing.h', locators)
    ).toBeUndefined();
  });

  it('refuses parent traversal', () => {
    expect(
      resolveDeclaredImportLocator('src/currency/src/server.cpp', '../secret.h', locators)
    ).toBeUndefined();
  });
});
