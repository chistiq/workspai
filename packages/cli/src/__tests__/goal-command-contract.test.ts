import { describe, expect, it } from 'vitest';

import { validateGoalCommandSelection } from '../goals/goal-command-contract.js';

describe('goal command selection contract', () => {
  it('selects planning and each lifecycle operation deterministically', () => {
    expect(validateGoalCommandSelection({ intent: '  Map the architecture  ' })).toEqual({
      operation: 'plan',
      intent: 'Map the architecture',
    });
    expect(validateGoalCommandSelection({ status: true })).toEqual({ operation: 'status' });
    expect(validateGoalCommandSelection({ verify: 'goal-12345678', run: false })).toEqual({
      operation: 'verify',
    });
  });

  it('rejects multiple lifecycle operations before any artifact write', () => {
    expect(() => validateGoalCommandSelection({ list: true, cancel: 'goal-12345678' })).toThrow(
      'exactly one'
    );
  });

  it('rejects intent and planning-only flags on lifecycle operations', () => {
    expect(() => validateGoalCommandSelection({ intent: 'Map it', status: true })).toThrow(
      'Do not combine'
    );
    expect(() => validateGoalCommandSelection({ status: true, refresh: true })).toThrow(
      'planning-only'
    );
    expect(() => validateGoalCommandSelection({ list: true, run: false })).toThrow(
      'only with --verify'
    );
  });
});
