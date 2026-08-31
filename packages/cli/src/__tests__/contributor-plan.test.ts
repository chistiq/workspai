import { describe, expect, it } from 'vitest';

import {
  buildContributorPlan,
  normalizeRepositoryPath,
} from '../../../../scripts/contributor-plan.mjs';

describe('contributor validation plan', () => {
  it('keeps a documentation-only contribution on the bounded docs path', () => {
    const plan = buildContributorPlan(['packages/cli/docs/agent-entry.md']);

    expect(plan.status).toBe('ready');
    expect(plan.routes.map((route) => route.id)).toEqual(['docs']);
    expect(plan.commands.map((entry) => entry.id)).toEqual(['english', 'docs']);
  });

  it('composes source, test, and contract gates without duplicate commands', () => {
    const plan = buildContributorPlan([
      'packages/cli/src/proof-carrying-change.ts',
      'packages/cli/src/__tests__/proof-carrying-change.test.ts',
      'packages/cli/contracts/workspace-intelligence/proof-carrying-change-capsule.v1.json',
    ]);

    expect(plan.routes.map((route) => route.id)).toEqual(['contracts', 'runtime', 'tests']);
    expect(plan.commands.map((entry) => entry.id)).toEqual([
      'english',
      'typecheck',
      'lint',
      'format',
      'contracts',
      'test',
    ]);
  });

  it('normalizes Windows separators and rejects paths outside the repository', () => {
    expect(normalizeRepositoryPath('packages\\cli\\README.md')).toBe('packages/cli/README.md');
    expect(() => normalizeRepositoryPath('../private.txt')).toThrow(/repository-relative path/u);
    expect(() => normalizeRepositoryPath('/tmp/private.txt')).toThrow(/repository-relative path/u);
    expect(() => normalizeRepositoryPath('C:\\private.txt')).toThrow(/repository-relative path/u);
  });

  it('routes workflow files through automation rather than documentation', () => {
    const plan = buildContributorPlan(['.github/workflows/ci.yml']);

    expect(plan.routes.map((route) => route.id)).toEqual(['automation']);
    expect(plan.commands.at(-1)?.id).toBe('workflow');
  });

  it('returns an explicit no-change plan', () => {
    expect(buildContributorPlan([])).toEqual({
      schemaVersion: 'workspai.contributor-validation-plan.v1',
      status: 'no-changes',
      files: [],
      routes: [],
      commands: [],
    });
  });
});
