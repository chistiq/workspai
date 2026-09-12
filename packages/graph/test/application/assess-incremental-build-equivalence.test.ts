import { describe, expect, it } from 'vitest';

import { assessIncrementalBuildEquivalence } from '../../src/application/assess-incremental-build-equivalence.js';

const digest = (value: string) => ({ algorithm: 'sha256' as const, value });

describe('assessIncrementalBuildEquivalence', () => {
  it('passes when reference and candidate digests match', () => {
    const reference = digest('a'.repeat(64));
    expect(
      assessIncrementalBuildEquivalence({ referenceDigest: reference, candidateDigest: reference })
    ).toMatchObject({ equivalence: 'pass' });
  });

  it('blocks on digest mismatch fail-closed', () => {
    const result = assessIncrementalBuildEquivalence({
      referenceDigest: digest('a'.repeat(64)),
      candidateDigest: digest('b'.repeat(64)),
    });
    expect(result.equivalence).toBe('blocked');
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('remains not-assessed when evidence is incomplete', () => {
    expect(assessIncrementalBuildEquivalence({}).equivalence).toBe('not-assessed');
  });
});
