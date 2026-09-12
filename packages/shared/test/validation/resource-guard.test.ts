import { describe, expect, it } from 'vitest';

import { inspectJsonResourceLimits } from '../../src/validation/resource-guard.js';
import type { WisValidationLimits } from '../../src/validation/types.js';

const limits: WisValidationLimits = {
  maxDepth: 4,
  maxNodes: 20,
  maxStringLength: 8,
  maxTotalStringLength: 12,
  maxDiagnostics: 10,
};

function codes(value: unknown, overrides?: Partial<WisValidationLimits>): string[] {
  return inspectJsonResourceLimits(value, { ...limits, ...overrides }).map((entry) => entry.code);
}

describe('JSON resource preflight', () => {
  it.each([null, true, false, 0, 1.5, 'safe', [1, 2], { safe: true }])(
    'accepts JSON value %#',
    (value) => expect(codes(value)).toEqual([])
  );

  it.each([
    { value: Number.NaN, code: 'WIS_RESOURCE_NON_JSON_NUMBER' },
    { value: Number.POSITIVE_INFINITY, code: 'WIS_RESOURCE_NON_JSON_NUMBER' },
    { value: undefined, code: 'WIS_RESOURCE_NON_JSON_VALUE' },
    { value: 1n, code: 'WIS_RESOURCE_NON_JSON_VALUE' },
    { value: Symbol('value'), code: 'WIS_RESOURCE_NON_JSON_VALUE' },
    { value: () => undefined, code: 'WIS_RESOURCE_NON_JSON_VALUE' },
    { value: new Date(), code: 'WIS_RESOURCE_NON_PLAIN_OBJECT' },
  ])('rejects non-portable value with $code', ({ value, code }) => {
    expect(codes(value)).toContain(code);
  });

  it('enforces depth, node and string budgets', () => {
    expect(codes({ child: { leaf: true } }, { maxDepth: 1 })).toContain('WIS_RESOURCE_DEPTH_LIMIT');
    expect(codes([1, 2, 3], { maxNodes: 2 })).toContain('WIS_RESOURCE_NODE_LIMIT');
    expect(codes('123456789')).toContain('WIS_RESOURCE_STRING_LIMIT');
    expect(codes(['1234567', '7654321'])).toContain('WIS_RESOURCE_TOTAL_STRING_LIMIT');
  });

  it('rejects sparse arrays and array accessors without invocation', () => {
    const sparse = new Array(1);
    expect(codes(sparse)).toContain('WIS_RESOURCE_ACCESSOR_PROPERTY');

    let invoked = false;
    const accessor: unknown[] = [null];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        invoked = true;
        return 'unsafe';
      },
    });
    expect(codes(accessor)).toContain('WIS_RESOURCE_ACCESSOR_PROPERTY');
    expect(invoked).toBe(false);
  });

  it('accepts null-prototype records but rejects symbol and accessor keys', () => {
    const value = Object.create(null) as Record<string | symbol, unknown>;
    value.safe = true;
    value[Symbol('private')] = true;
    Object.defineProperty(value, 'a/b~c', { enumerable: true, get: () => 'unsafe' });
    const diagnostics = inspectJsonResourceLimits(value, limits);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WIS_RESOURCE_SYMBOL_KEY' }),
        expect.objectContaining({
          code: 'WIS_RESOURCE_ACCESSOR_PROPERTY',
          path: '/a~1b~0c',
        }),
      ])
    );
  });

  it('retains hidden overflow evidence so diagnostic truncation is honest', () => {
    const value = Object.create(null) as Record<string | symbol, unknown>;
    value[Symbol('first')] = true;
    Object.defineProperty(value, 'unsafe', { enumerable: true, get: () => true });

    expect(inspectJsonResourceLimits(value, { ...limits, maxDiagnostics: 1 })).toHaveLength(2);
  });

  it('observes cancellation before touching the next traversal value', () => {
    let invoked = false;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, 'danger', {
      enumerable: true,
      get() {
        invoked = true;
        return true;
      },
    });

    expect(inspectJsonResourceLimits(input, limits, { aborted: true })).toEqual([
      expect.objectContaining({ code: 'WIS_RESOURCE_CANCELLED' }),
    ]);
    expect(invoked).toBe(false);
  });
});
