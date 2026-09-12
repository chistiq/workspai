import { describe, expect, it } from 'vitest';

import { planProviderRecomputeScope } from '../../src/application/plan-provider-recompute-scope.js';

describe('planProviderRecomputeScope', () => {
  it('classifies registered providers without executing recompute', () => {
    const plan = planProviderRecomputeScope({
      providersToRecompute: [
        'workspai.graph.provider.ecmascript-imports',
        'workspai.graph.provider.unknown',
      ],
      registeredProviderIds: [
        'workspai.graph.provider.ecmascript-imports',
        'workspai.graph.provider.standard-structural',
      ],
    });
    expect(plan.toRecompute).toEqual(['workspai.graph.provider.ecmascript-imports']);
    expect(plan.unaffected).toEqual(['workspai.graph.provider.standard-structural']);
    expect(plan.unknownRequested).toEqual(['workspai.graph.provider.unknown']);
  });
});
