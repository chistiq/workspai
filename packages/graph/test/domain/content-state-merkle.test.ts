import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assembleContentStateMerkle,
  assertPortableLocator,
  baseName,
  canonicalDirectoryMaterial,
  directoryChild,
  isUnderDirectory,
  parentLocator,
} from '../../src/domain/content-state-merkle.js';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('content-state merkle canonicalization', () => {
  it('orders directory children lexicographically regardless of input order', () => {
    const children = [
      directoryChild('z.ts', 'file', { algorithm: 'sha256', value: 'a'.repeat(64) }),
      directoryChild('a.ts', 'file', { algorithm: 'sha256', value: 'b'.repeat(64) }),
    ];
    const material = canonicalDirectoryMaterial(children);
    expect(material.startsWith('a.ts')).toBe(true);
    expect(material).toContain('z.ts');
    expect(canonicalDirectoryMaterial([...children].reverse())).toBe(material);
  });

  it('derives stable directory digests from canonical material', () => {
    const material = canonicalDirectoryMaterial([
      directoryChild('index.ts', 'file', {
        algorithm: 'sha256',
        value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }),
    ]);
    expect(digest(material)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('extracts portable parent locators', () => {
    expect(parentLocator('src/index.ts')).toBe('src');
    expect(parentLocator('README.md')).toBe('');
    expect(baseName('src/index.ts')).toBe('index.ts');
  });

  it('rejects non-portable locators fail-closed', () => {
    expect(() => assertPortableLocator('../escape')).toThrow(/not portable/);
    expect(() => assertPortableLocator('')).toThrow(/not portable/);
  });

  it('uses path-boundary directory membership so lib does not match library', () => {
    expect(isUnderDirectory('library/foo.ts', 'lib')).toBe(false);
    expect(isUnderDirectory('lib/foo.ts', 'lib')).toBe(true);
    expect(isUnderDirectory('lib', 'lib')).toBe(true);
    const assembled = assembleContentStateMerkle(
      [
        {
          locator: 'lib/foo.ts',
          contentDigest: { algorithm: 'sha256', value: 'c'.repeat(64) },
        },
        {
          locator: 'library/foo.ts',
          contentDigest: { algorithm: 'sha256', value: 'd'.repeat(64) },
        },
      ],
      (material) => ({
        algorithm: 'sha256',
        value: createHash('sha256').update(material, 'utf8').digest('hex'),
      })
    );
    expect(assembled.directories.has('lib')).toBe(true);
    expect(assembled.directories.has('library')).toBe(true);
    expect(assembled.directories.get('lib')?.children).toHaveLength(1);
    expect(assembled.directories.get('library')?.children).toHaveLength(1);
  });
});
