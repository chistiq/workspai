import { describe, expect, it } from 'vitest';

import {
  findNonEnglishTextViolations,
  looksBinary,
} from '../../../../scripts/english-text-guard.mjs';

describe('English text repository guard', () => {
  it('rejects non-ASCII language scripts and accented letters', () => {
    const samples = [
      String.fromCodePoint(0x0627),
      String.fromCodePoint(0x8ba4),
      String.fromCodePoint(0x0430),
      String.fromCodePoint(0x03bd),
      String.fromCodePoint(0x00e9),
    ];

    for (const sample of samples) {
      expect(findNonEnglishTextViolations(`text=${sample}`, 'fixture.txt')).toHaveLength(1);
    }
  });

  it('allows ASCII English and language-neutral Unicode symbols', () => {
    const content = `English text ${String.fromCodePoint(0x2139)} ${String.fromCodePoint(0x1f680)} ->`;
    expect(findNonEnglishTextViolations(content, 'fixture.txt')).toEqual([]);
  });

  it('reports line and code-point evidence without echoing source text', () => {
    const content = `English\n${String.fromCodePoint(0x0627)}`;
    expect(findNonEnglishTextViolations(content, 'fixture.txt')).toEqual([
      expect.objectContaining({
        file: 'fixture.txt',
        line: 2,
        column: 1,
        kind: 'non-ascii-letter',
        codePoint: 'U+0627',
      }),
    ]);
  });

  it('does not inspect binary payloads', () => {
    expect(looksBinary(Buffer.from([0x50, 0x4e, 0x47, 0x00, 0xff]))).toBe(true);
  });
});
