import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createContentAddressedFactSession,
  disposeContentAddressedFactSession,
  runWithContentAddressedFactSession,
} from '../../src/providers/content-addressed-facts.js';
import {
  MATRIX_SOURCE_MASK_VERSION,
  maskMatrixSourceLiterals,
  maskMatrixSourceLiteralsCached,
} from '../../src/providers/matrix-source-mask.js';

function digestOf(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('cached matrix code views', () => {
  it('matches the uncached mask and reuses the same immutable string', () => {
    const session = createContentAddressedFactSession();
    const source = 'const secret = "hide";\nfoo();\n';
    const digest = digestOf(source);
    runWithContentAddressedFactSession(session, () => {
      const expected = maskMatrixSourceLiterals(source, 'node');
      const first = maskMatrixSourceLiteralsCached(source, 'node', digest);
      const second = maskMatrixSourceLiteralsCached(source, 'node', digest);
      expect(first).toBe(expected);
      expect(second).toBe(first);
      expect(MATRIX_SOURCE_MASK_VERSION).toContain('matrix-source-mask');
    });
    disposeContentAddressedFactSession(session);
  });

  it('does not reuse a view across languages', () => {
    const session = createContentAddressedFactSession();
    const source = '# comment\nvalue = "x"\n';
    const digest = digestOf(source);
    runWithContentAddressedFactSession(session, () => {
      const python = maskMatrixSourceLiteralsCached(source, 'python', digest);
      const node = maskMatrixSourceLiteralsCached(source, 'node', digest);
      expect(python).not.toBe(node);
      expect(python).toBe(maskMatrixSourceLiterals(source, 'python'));
      expect(node).toBe(maskMatrixSourceLiterals(source, 'node'));
    });
    disposeContentAddressedFactSession(session);
  });
});
