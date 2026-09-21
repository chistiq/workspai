import { describe, expect, it } from 'vitest';

import {
  classifyModuleSpecifier,
  joinPortableLocatorPath,
  resolveEcmaScriptModuleLocator,
  resolveRelativePortableLocator,
} from '../../src/domain/module-resolution.js';

describe('module resolution', () => {
  it('classifies relative specifiers and refuses package names as files', () => {
    expect(classifyModuleSpecifier('./lib')).toBe('relative');
    expect(classifyModuleSpecifier('../lib')).toBe('relative');
    expect(classifyModuleSpecifier('express')).toBe('package');
    expect(classifyModuleSpecifier('foo/bar')).toBe('package');
    expect(classifyModuleSpecifier('node:fs')).toBe('package');
    expect(classifyModuleSpecifier('/abs/lib')).toBe('unsupported');
    expect(classifyModuleSpecifier('a\\b')).toBe('unsupported');
  });

  it('resolves TypeScript runtime rewrites, index barrels and refuses package collisions', () => {
    const available = new Set(['src/lib.ts', 'src/pkg/index.ts', 'src/express.ts']);
    expect(
      resolveEcmaScriptModuleLocator({
        fromLocator: 'src/app.ts',
        specifier: './lib.js',
        available,
      })
    ).toBe('src/lib.ts');
    expect(
      resolveEcmaScriptModuleLocator({
        fromLocator: 'src/app.ts',
        specifier: './lib.js',
        available: new Set(['src/lib.js', 'src/lib.ts']),
      })
    ).toBe('src/lib.js');
    expect(
      resolveEcmaScriptModuleLocator({
        fromLocator: 'src/app.ts',
        specifier: './pkg',
        available,
      })
    ).toBe('src/pkg/index.ts');
    expect(
      resolveEcmaScriptModuleLocator({
        fromLocator: 'src/app.ts',
        specifier: 'express',
        available,
      })
    ).toBeNull();
    expect(resolveRelativePortableLocator('', '../secret')).toBeNull();
    expect(resolveRelativePortableLocator('src', 'health.h')).toBeNull();
    expect(joinPortableLocatorPath('src', 'health.h')).toBe('src/health.h');
    expect(joinPortableLocatorPath('src', '../secret')).toBe('secret');
    expect(joinPortableLocatorPath('', '../secret')).toBeNull();
  });
});
