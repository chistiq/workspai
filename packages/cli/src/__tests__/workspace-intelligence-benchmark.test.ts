import { describe, expect, it } from 'vitest';

import type {
  WorkspaceIntelligenceEvaluation,
  WorkspaceIntelligenceEvaluationComparison,
} from '../contracts/workspace-intelligence-evaluation-contract.js';
import {
  classifyWorkspaceEvaluationProvenance,
  trustedMeasuredEvaluationReduction,
} from '../workspace-intelligence-benchmark.js';

function evaluationSources(input: {
  modelCalls: number;
  providerReported?: number;
  tokenizerCounted?: number;
  estimated?: number;
  unavailable?: number;
}): WorkspaceIntelligenceEvaluation {
  return {
    summary: {
      modelCalls: input.modelCalls,
      tokenSources: {
        providerReported: input.providerReported ?? 0,
        tokenizerCounted: input.tokenizerCounted ?? 0,
        estimated: input.estimated ?? 0,
        unavailable: input.unavailable ?? 0,
      },
    },
  } as WorkspaceIntelligenceEvaluation;
}

function comparison(input: {
  taskAligned: boolean;
  comparableOutcome: boolean;
  reductionPercent: number | null;
}): WorkspaceIntelligenceEvaluationComparison {
  return {
    taskAligned: input.taskAligned,
    comparableOutcome: input.comparableOutcome,
    delta: { reductionPercent: input.reductionPercent },
  } as WorkspaceIntelligenceEvaluationComparison;
}

describe('workspace intelligence benchmark claim policy', () => {
  it('classifies provider and tokenizer counts as measured but preserves mixed estimates', () => {
    expect(
      classifyWorkspaceEvaluationProvenance(
        evaluationSources({ modelCalls: 2, providerReported: 1, tokenizerCounted: 1 })
      )
    ).toBe('measured');
    expect(
      classifyWorkspaceEvaluationProvenance(
        evaluationSources({ modelCalls: 2, providerReported: 1, estimated: 1 })
      )
    ).toBe('mixed');
    expect(
      classifyWorkspaceEvaluationProvenance(evaluationSources({ modelCalls: 2, estimated: 2 }))
    ).toBe('estimated');
    expect(classifyWorkspaceEvaluationProvenance(undefined)).toBe('unavailable');
  });

  it('publishes measured reduction only for aligned comparable all-measured runs', () => {
    const aligned = comparison({
      taskAligned: true,
      comparableOutcome: true,
      reductionPercent: 37.5,
    });
    expect(
      trustedMeasuredEvaluationReduction({
        comparison: aligned,
        currentProvenance: 'measured',
        baselineProvenance: 'measured',
      })
    ).toBe(37.5);
    expect(
      trustedMeasuredEvaluationReduction({
        comparison: aligned,
        currentProvenance: 'mixed',
        baselineProvenance: 'measured',
      })
    ).toBeNull();
    expect(
      trustedMeasuredEvaluationReduction({
        comparison: comparison({
          taskAligned: false,
          comparableOutcome: true,
          reductionPercent: 37.5,
        }),
        currentProvenance: 'measured',
        baselineProvenance: 'measured',
      })
    ).toBeNull();
  });
});
