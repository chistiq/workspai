export type PythonVersionConstraintResult = {
  version: string;
  specifier: string;
  satisfied: boolean | null;
  unsupportedSpecifiers: string[];
};

type PythonRelease = {
  raw: string;
  parts: number[];
};

function parseRelease(value: string): PythonRelease | null {
  const match = value.trim().match(/^(?:Python\s+)?(\d+(?:\.\d+){0,3})/i);
  if (!match) return null;
  return {
    raw: match[1],
    parts: match[1].split('.').map((part) => Number.parseInt(part, 10)),
  };
}

function compareRelease(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function wildcardMatches(version: readonly number[], expected: string): boolean {
  const prefix = expected
    .replace(/\.\*$/u, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return prefix.every((part, index) => version[index] === part);
}

function compatibleUpperBound(expected: readonly number[]): number[] {
  if (expected.length <= 2) return [(expected[0] ?? 0) + 1];
  const prefix = expected.slice(0, -1);
  prefix[prefix.length - 1] = (prefix[prefix.length - 1] ?? 0) + 1;
  return prefix;
}

function evaluateSpecifier(version: PythonRelease, rawSpecifier: string): boolean | null {
  const match = rawSpecifier.trim().match(/^(===|~=|==|!=|>=|<=|>|<)\s*(.+)$/u);
  if (!match) return null;
  const [, operator, expectedValue] = match;
  if ((operator === '==' || operator === '!=') && /\.\*$/u.test(expectedValue)) {
    const matched = wildcardMatches(version.parts, expectedValue);
    return operator === '==' ? matched : !matched;
  }
  const expected = parseRelease(expectedValue);
  if (!expected) return null;
  const comparison = compareRelease(version.parts, expected.parts);
  if (operator === '===') return version.raw === expected.raw;
  if (operator === '==') return comparison === 0;
  if (operator === '!=') return comparison !== 0;
  if (operator === '>=') return comparison >= 0;
  if (operator === '<=') return comparison <= 0;
  if (operator === '>') return comparison > 0;
  if (operator === '<') return comparison < 0;
  if (operator === '~=') {
    return (
      comparison >= 0 && compareRelease(version.parts, compatibleUpperBound(expected.parts)) < 0
    );
  }
  return null;
}

/**
 * Evaluate the PEP 440 release clauses commonly used by `requires-python`.
 * Unknown clauses fail open as `satisfied: null`; Doctor reports them as
 * unverified rather than incorrectly claiming compatibility.
 */
export function evaluatePythonVersionConstraint(
  versionValue: string,
  specifierValue: string
): PythonVersionConstraintResult {
  const version = parseRelease(versionValue);
  const specifier = specifierValue.trim();
  const clauses = specifier
    .replace(/^\(|\)$/gu, '')
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (!version || clauses.length === 0) {
    return {
      version: version?.raw ?? versionValue.trim(),
      specifier,
      satisfied: null,
      unsupportedSpecifiers: clauses.length === 0 ? [specifier] : clauses,
    };
  }
  const results = clauses.map((clause) => ({ clause, result: evaluateSpecifier(version, clause) }));
  const unsupportedSpecifiers = results
    .filter((entry) => entry.result === null)
    .map((entry) => entry.clause);
  return {
    version: version.raw,
    specifier,
    satisfied:
      unsupportedSpecifiers.length > 0 ? null : results.every((entry) => entry.result === true),
    unsupportedSpecifiers,
  };
}
