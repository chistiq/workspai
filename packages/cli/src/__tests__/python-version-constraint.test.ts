import { describe, expect, it } from 'vitest';

import { evaluatePythonVersionConstraint } from '../utils/python-version-constraint.js';

describe('Python requires-python constraints', () => {
  it('rejects a host interpreter below the project minimum', () => {
    expect(evaluatePythonVersionConstraint('Python 3.13.5', '>=3.14.2')).toMatchObject({
      version: '3.13.5',
      satisfied: false,
      unsupportedSpecifiers: [],
    });
  });

  it('supports compound, exclusion, wildcard, and compatible-release clauses', () => {
    expect(evaluatePythonVersionConstraint('3.12.4', '>=3.11,<3.13,!=3.12.3').satisfied).toBe(true);
    expect(evaluatePythonVersionConstraint('3.12.4', '==3.12.*').satisfied).toBe(true);
    expect(evaluatePythonVersionConstraint('3.15.0', '~=3.14.2').satisfied).toBe(false);
    expect(evaluatePythonVersionConstraint('3.14.9', '~=3.14.2').satisfied).toBe(true);
  });

  it('reports unsupported clauses as unknown instead of claiming compatibility', () => {
    expect(evaluatePythonVersionConstraint('3.13.5', 'not-a-specifier')).toMatchObject({
      satisfied: null,
      unsupportedSpecifiers: ['not-a-specifier'],
    });
  });
});
