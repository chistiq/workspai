import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKSPACE_EVALUATION_LAST_RUN_PATH,
  appendWorkspaceEvaluationEvent,
  compareWorkspaceEvaluations,
  createWorkspaceEvaluation,
  finalizeWorkspaceEvaluation,
  normalizeWorkspaceEvaluationEvent,
  readWorkspaceEvaluation,
  summarizeWorkspaceEvaluation,
  writeWorkspaceEvaluation,
} from '../workspace-intelligence-evaluation.js';

describe('workspace intelligence evaluation', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => fsExtra.remove(directory)));
  });

  it('keeps measured, estimated, unavailable, cost, latency and verified outcome provenance distinct', () => {
    const events = [
      normalizeWorkspaceEvaluationEvent({
        kind: 'model-call',
        modelCall: {
          provider: 'provider-a',
          model: 'model-a',
          source: 'provider-reported',
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 40,
          reasoningTokens: 5,
          latencyMs: 250,
          cost: { amount: 0.01, currency: 'USD', source: 'provider-reported' },
        },
      }),
      normalizeWorkspaceEvaluationEvent({
        kind: 'model-call',
        modelCall: {
          provider: 'provider-b',
          model: 'model-b',
          source: 'estimated',
          tokenizer: 'portable-char-estimate',
          inputTokens: 50,
          outputTokens: 10,
          cachedInputTokens: null,
          reasoningTokens: null,
          latencyMs: null,
          cost: { amount: 0.004, currency: 'USD', source: 'catalog-estimated' },
        },
      }),
      normalizeWorkspaceEvaluationEvent({
        kind: 'tool-call',
        toolCall: {
          tool: 'read-artifact',
          result: 'passed',
          changedSource: false,
          durationMs: 25,
          artifact: '.workspai/reports/workspace-model.json',
        },
      }),
      normalizeWorkspaceEvaluationEvent({
        kind: 'tool-call',
        toolCall: {
          tool: 'read-artifact',
          result: 'passed',
          changedSource: false,
          durationMs: 20,
          artifact: '.workspai/reports/workspace-model.json',
        },
      }),
      normalizeWorkspaceEvaluationEvent({
        kind: 'outcome',
        outcome: { status: 'passed', verified: true, blockersResolved: 1 },
      }),
    ];

    const summary = summarizeWorkspaceEvaluation(events);
    expect(summary.tokens).toEqual({
      input: 150,
      output: 30,
      cachedInput: 40,
      reasoning: 5,
      observedTotal: 180,
    });
    expect(summary.tokenSources).toEqual({
      providerReported: 1,
      tokenizerCounted: 0,
      estimated: 1,
      unavailable: 0,
    });
    expect(summary.costs).toEqual([
      { currency: 'USD', amount: 0.014, providerReported: 0.01, estimated: 0.004 },
    ]);
    expect(summary.efficiency).toEqual({
      tokensPerVerifiedOutcome: 180,
      noProgressDecisions: 2,
      repeatedArtifactReads: 1,
    });
    expect(summary.latencyMs).toBe(295);
  });

  it('rejects prompt bodies and false measured-token claims', () => {
    expect(() =>
      normalizeWorkspaceEvaluationEvent({
        kind: 'model-call',
        prompt: 'secret prompt body',
        modelCall: {
          provider: 'provider',
          model: 'model',
          source: 'provider-reported',
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          latencyMs: 1,
        },
      })
    ).toThrow(/additional propert/i);
    expect(() =>
      normalizeWorkspaceEvaluationEvent({
        kind: 'model-call',
        modelCall: {
          provider: 'provider',
          model: 'model',
          source: 'tokenizer-counted',
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          latencyMs: 1,
        },
      })
    ).toThrow(/require at least one/i);
  });

  it('does not report zero tokens per verified outcome when no usable model measurement exists', () => {
    const events = [
      normalizeWorkspaceEvaluationEvent({
        kind: 'tool-call',
        toolCall: {
          tool: 'workspace verify',
          result: 'passed',
          changedSource: false,
          durationMs: 10,
        },
      }),
      normalizeWorkspaceEvaluationEvent({
        kind: 'outcome',
        outcome: { status: 'passed', verified: true, blockersResolved: 0 },
      }),
    ];

    expect(summarizeWorkspaceEvaluation(events).efficiency.tokensPerVerifiedOutcome).toBeNull();
  });

  it('persists a live run atomically, records idempotently, finalizes, and compares', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'wsp-eval-'));
    tempDirs.push(workspacePath);
    const baseline = createWorkspaceEvaluation({
      workspacePath,
      taskId: 'repair-readiness',
      strategy: 'full-corpus',
      runId: 'baseline-run',
      sessionId: 'baseline-session',
      now: new Date('2026-07-22T00:00:00.000Z'),
    });
    const baselineEvent = normalizeWorkspaceEvaluationEvent({
      eventId: 'baseline-call',
      recordedAt: '2026-07-22T00:00:01.000Z',
      kind: 'model-call',
      modelCall: {
        provider: 'provider',
        model: 'model',
        source: 'provider-reported',
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 100,
      },
    });
    baseline.events = [baselineEvent];
    baseline.summary = summarizeWorkspaceEvaluation(baseline.events);

    const live = createWorkspaceEvaluation({
      workspacePath,
      taskId: 'repair-readiness',
      strategy: 'workspace-intelligence',
      runId: 'current-run',
      sessionId: 'current-session',
      now: new Date('2026-07-22T01:00:00.000Z'),
    });
    await writeWorkspaceEvaluation(workspacePath, live);
    const payload = {
      eventId: 'current-call',
      recordedAt: '2026-07-22T01:00:01.000Z',
      kind: 'model-call',
      modelCall: {
        provider: 'provider',
        model: 'model',
        source: 'provider-reported',
        inputTokens: 400,
        outputTokens: 40,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 50,
      },
    };
    await appendWorkspaceEvaluationEvent({ workspacePath, payload });
    await appendWorkspaceEvaluationEvent({ workspacePath, payload });
    await appendWorkspaceEvaluationEvent({
      workspacePath,
      payload: {
        eventId: 'outcome',
        kind: 'outcome',
        outcome: { status: 'passed', verified: true, blockersResolved: 1 },
      },
    });
    const finalized = await finalizeWorkspaceEvaluation({
      workspacePath,
      now: new Date('2026-07-22T01:05:00.000Z'),
    });
    expect(finalized.report.events).toHaveLength(2);
    expect(finalized.report.summary.tokens.observedTotal).toBe(440);
    expect(
      await readWorkspaceEvaluation(workspacePath, WORKSPACE_EVALUATION_LAST_RUN_PATH)
    ).toEqual(finalized.report);

    const comparison = compareWorkspaceEvaluations(finalized.report, baseline);
    expect(comparison.taskAligned).toBe(true);
    expect(comparison.delta.tokens).toBe(-660);
    expect(comparison.delta.reductionPercent).toBe(60);
  });

  it('serializes concurrent extension and CLI event writers without losing events', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'wsp-eval-lock-'));
    tempDirs.push(workspacePath);
    await writeWorkspaceEvaluation(
      workspacePath,
      createWorkspaceEvaluation({ workspacePath, taskId: 'live-sidebar', runId: 'live-run' })
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        appendWorkspaceEvaluationEvent({
          workspacePath,
          payload: {
            eventId: `tool-${index}`,
            kind: 'tool-call',
            toolCall: {
              tool: 'read-artifact',
              result: 'passed',
              changedSource: false,
              durationMs: 1,
              artifact: `.workspai/reports/${index}.json`,
            },
          },
        })
      )
    );
    const report = await readWorkspaceEvaluation(workspacePath);
    expect(report.events).toHaveLength(12);
    expect(report.summary.toolCalls).toBe(12);
  });
});
