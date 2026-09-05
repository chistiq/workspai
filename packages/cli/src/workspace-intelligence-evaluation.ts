import crypto from 'node:crypto';
import path from 'node:path';
import { open, stat, unlink } from 'node:fs/promises';

import fsExtra from 'fs-extra';

import {
  MODEL_USAGE_EVENT_SCHEMA_VERSION,
  MODEL_USAGE_SOURCES,
  WORKSPACE_INTELLIGENCE_EVALUATION_COMPARISON_SCHEMA_VERSION,
  WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
  type WorkspaceEvaluationEvent,
  type WorkspaceEvaluationStrategy,
  type WorkspaceEvaluationSummary,
  type WorkspaceIntelligenceEvaluation,
  type WorkspaceIntelligenceEvaluationComparison,
} from './contracts/workspace-intelligence-evaluation-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

export const WORKSPACE_EVALUATION_LIVE_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLive;
export const WORKSPACE_EVALUATION_LAST_RUN_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun;

const EVENT_CONTRACT = 'contracts/workspace-intelligence/model-usage-event.v1.json';
const EVALUATION_CONTRACT =
  'contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json';
const EVALUATION_COMPARISON_CONTRACT =
  'contracts/workspace-intelligence/workspace-intelligence-evaluation-comparison.v1.json';
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_RETRY_COUNT = 100;
const LOCK_RETRY_DELAY_MS = 25;

function emptySummary(): WorkspaceEvaluationSummary {
  return {
    modelCalls: 0,
    toolCalls: 0,
    tokenSources: {
      providerReported: 0,
      tokenizerCounted: 0,
      estimated: 0,
      unavailable: 0,
    },
    tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0, observedTotal: 0 },
    latencyMs: 0,
    costs: [],
    outcome: { status: 'unknown', verified: false, blockersResolved: 0 },
    efficiency: {
      tokensPerVerifiedOutcome: null,
      noProgressDecisions: 0,
      repeatedArtifactReads: 0,
    },
  };
}

function asCount(value: number | null): number {
  return value ?? 0;
}

export function summarizeWorkspaceEvaluation(
  events: readonly WorkspaceEvaluationEvent[]
): WorkspaceEvaluationSummary {
  const summary = emptySummary();
  const artifactReads = new Map<string, number>();
  const costs = new Map<
    string,
    { currency: string; amount: number; providerReported: number; estimated: number }
  >();

  for (const event of events) {
    if (event.kind === 'model-call') {
      summary.modelCalls += 1;
      const sourceKey = {
        'provider-reported': 'providerReported',
        'tokenizer-counted': 'tokenizerCounted',
        estimated: 'estimated',
        unavailable: 'unavailable',
      }[event.modelCall.source] as keyof typeof summary.tokenSources;
      summary.tokenSources[sourceKey] += 1;
      summary.tokens.input += asCount(event.modelCall.inputTokens);
      summary.tokens.output += asCount(event.modelCall.outputTokens);
      summary.tokens.cachedInput += asCount(event.modelCall.cachedInputTokens);
      summary.tokens.reasoning += asCount(event.modelCall.reasoningTokens);
      summary.latencyMs += event.modelCall.latencyMs ?? 0;
      if (event.modelCall.cost) {
        const currency = event.modelCall.cost.currency.toUpperCase();
        const cost = costs.get(currency) ?? {
          currency,
          amount: 0,
          providerReported: 0,
          estimated: 0,
        };
        cost.amount += event.modelCall.cost.amount;
        if (event.modelCall.cost.source === 'provider-reported') {
          cost.providerReported += event.modelCall.cost.amount;
        } else {
          cost.estimated += event.modelCall.cost.amount;
        }
        costs.set(currency, cost);
      }
      continue;
    }
    if (event.kind === 'tool-call') {
      summary.toolCalls += 1;
      summary.latencyMs += event.toolCall.durationMs ?? 0;
      if (!event.toolCall.changedSource && event.toolCall.result === 'passed') {
        summary.efficiency.noProgressDecisions += 1;
      }
      if (event.toolCall.artifact) {
        artifactReads.set(
          event.toolCall.artifact,
          (artifactReads.get(event.toolCall.artifact) ?? 0) + 1
        );
      }
      continue;
    }
    if (event.kind === 'outcome') {
      summary.outcome = {
        status: event.outcome.status,
        verified: event.outcome.verified,
        blockersResolved: event.outcome.blockersResolved,
      };
    }
  }

  summary.tokens.observedTotal = summary.tokens.input + summary.tokens.output;
  summary.costs = [...costs.values()]
    .map((cost) => ({
      ...cost,
      amount: Number(cost.amount.toFixed(8)),
      providerReported: Number(cost.providerReported.toFixed(8)),
      estimated: Number(cost.estimated.toFixed(8)),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  summary.efficiency.repeatedArtifactReads = [...artifactReads.values()].reduce(
    (total, reads) => total + Math.max(0, reads - 1),
    0
  );
  summary.efficiency.tokensPerVerifiedOutcome =
    summary.outcome.verified &&
    summary.outcome.status === 'passed' &&
    summary.tokenSources.providerReported +
      summary.tokenSources.tokenizerCounted +
      summary.tokenSources.estimated >
      0
      ? summary.tokens.observedTotal
      : null;
  return summary;
}

export function normalizeWorkspaceEvaluationEvent(
  payload: unknown,
  now = new Date()
): WorkspaceEvaluationEvent {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Evaluation event must be a JSON object.');
  }
  const candidate = payload as Record<string, unknown>;
  const event = {
    ...candidate,
    schemaVersion: MODEL_USAGE_EVENT_SCHEMA_VERSION,
    eventId:
      typeof candidate.eventId === 'string' && candidate.eventId.trim()
        ? candidate.eventId.trim()
        : crypto.randomUUID(),
    recordedAt:
      typeof candidate.recordedAt === 'string' && candidate.recordedAt.trim()
        ? candidate.recordedAt
        : now.toISOString(),
  } as unknown as WorkspaceEvaluationEvent;
  assertJsonSchemaContract(event, EVENT_CONTRACT, 'workspace evaluation event');
  const expectedBody = {
    'model-call': 'modelCall',
    'tool-call': 'toolCall',
    outcome: 'outcome',
    milestone: 'milestone',
  }[event.kind];
  const suppliedBodies = ['modelCall', 'toolCall', 'outcome', 'milestone'].filter(
    (key) => candidate[key] !== undefined
  );
  if (suppliedBodies.length !== 1 || suppliedBodies[0] !== expectedBody) {
    throw new Error(`Evaluation event kind ${event.kind} requires only ${expectedBody}.`);
  }
  if (
    event.kind === 'model-call' &&
    event.modelCall.source !== 'unavailable' &&
    event.modelCall.inputTokens === null &&
    event.modelCall.outputTokens === null
  ) {
    throw new Error('Measured model calls require at least one input or output token count.');
  }
  return event;
}

export function createWorkspaceEvaluation(input: {
  workspacePath: string;
  workspaceName?: string;
  taskId: string;
  strategy?: WorkspaceEvaluationStrategy;
  sessionId?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  baselineRunId?: string;
  now?: Date;
  runId?: string;
}): WorkspaceIntelligenceEvaluation {
  const now = input.now ?? new Date();
  const workspacePath = path.resolve(input.workspacePath);
  const report: WorkspaceIntelligenceEvaluation = {
    schemaVersion: WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
    runId: input.runId ?? crypto.randomUUID(),
    sessionId: input.sessionId ?? crypto.randomUUID(),
    status: 'live',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    workspace: {
      name: input.workspaceName?.trim() || path.basename(workspacePath),
      path: workspacePath,
    },
    configuration: {
      taskId: input.taskId.trim(),
      strategy: input.strategy ?? 'workspace-intelligence',
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
    },
    methodology: {
      id: 'provider-usage-and-verified-outcome.v1',
      claimBoundary:
        'Provider-reported and tokenizer-counted values are measured; estimated values remain explicitly labelled. Verified task success is required before reporting tokens per successful outcome.',
    },
    events: [],
    summary: emptySummary(),
  };
  assertJsonSchemaContract(report, EVALUATION_CONTRACT, 'workspace evaluation');
  return report;
}

async function writeAtomicJson(target: string, payload: unknown): Promise<void> {
  await fsExtra.ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsExtra.writeJson(temporary, payload, { spaces: 2 });
    await fsExtra.rename(temporary, target);
  } finally {
    await fsExtra.remove(temporary).catch(() => undefined);
  }
}

async function withEvaluationLock<T>(
  workspacePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(path.resolve(workspacePath), `${WORKSPACE_EVALUATION_LIVE_PATH}.lock`);
  await fsExtra.ensureDir(path.dirname(lockPath));
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
        );
        return await operation();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
  throw new Error('Timed out waiting for the workspace evaluation writer lock.');
}

export async function writeWorkspaceEvaluation(
  workspacePath: string,
  report: WorkspaceIntelligenceEvaluation,
  relativePath: string = WORKSPACE_EVALUATION_LIVE_PATH
): Promise<string> {
  const outputPath = path.join(path.resolve(workspacePath), relativePath);
  assertJsonSchemaContract(report, EVALUATION_CONTRACT, relativePath);
  await writeAtomicJson(outputPath, report);
  return outputPath;
}

export async function readWorkspaceEvaluation(
  workspacePath: string,
  relativeOrAbsolutePath: string = WORKSPACE_EVALUATION_LIVE_PATH
): Promise<WorkspaceIntelligenceEvaluation> {
  const inputPath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(path.resolve(workspacePath), relativeOrAbsolutePath);
  const report = (await fsExtra.readJson(inputPath)) as WorkspaceIntelligenceEvaluation;
  assertJsonSchemaContract(report, EVALUATION_CONTRACT, inputPath);
  return report;
}

export async function appendWorkspaceEvaluationEvent(input: {
  workspacePath: string;
  payload: unknown;
  now?: Date;
}): Promise<WorkspaceIntelligenceEvaluation> {
  return withEvaluationLock(input.workspacePath, async () => {
    const report = await readWorkspaceEvaluation(input.workspacePath);
    if (report.status !== 'live') {
      throw new Error(`Evaluation ${report.runId} is ${report.status}; initialize a new run.`);
    }
    const event = normalizeWorkspaceEvaluationEvent(input.payload, input.now);
    if (report.events.some((candidate) => candidate.eventId === event.eventId)) {
      return report;
    }
    const updated: WorkspaceIntelligenceEvaluation = {
      ...report,
      updatedAt: (input.now ?? new Date()).toISOString(),
      events: [...report.events, event],
      summary: summarizeWorkspaceEvaluation([...report.events, event]),
    };
    await writeWorkspaceEvaluation(input.workspacePath, updated);
    return updated;
  });
}

export async function finalizeWorkspaceEvaluation(input: {
  workspacePath: string;
  status?: 'completed' | 'aborted';
  now?: Date;
}): Promise<{ report: WorkspaceIntelligenceEvaluation; outputPath: string }> {
  return withEvaluationLock(input.workspacePath, async () => {
    const report = await readWorkspaceEvaluation(input.workspacePath);
    const completedAt = (input.now ?? new Date()).toISOString();
    const finalized: WorkspaceIntelligenceEvaluation = {
      ...report,
      status: input.status ?? 'completed',
      updatedAt: completedAt,
      completedAt,
      summary: summarizeWorkspaceEvaluation(report.events),
    };
    const outputPath = await writeWorkspaceEvaluation(
      input.workspacePath,
      finalized,
      WORKSPACE_EVALUATION_LAST_RUN_PATH
    );
    await writeWorkspaceEvaluation(input.workspacePath, finalized);
    return { report: finalized, outputPath };
  });
}

export function compareWorkspaceEvaluations(
  current: WorkspaceIntelligenceEvaluation,
  baseline: WorkspaceIntelligenceEvaluation
): WorkspaceIntelligenceEvaluationComparison {
  const currentTokens = current.summary.tokens.observedTotal;
  const baselineTokens = baseline.summary.tokens.observedTotal;
  const tokenDelta = currentTokens - baselineTokens;
  const comparison: WorkspaceIntelligenceEvaluationComparison = {
    schemaVersion: WORKSPACE_INTELLIGENCE_EVALUATION_COMPARISON_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    taskAligned: current.configuration.taskId === baseline.configuration.taskId,
    current: {
      runId: current.runId,
      strategy: current.configuration.strategy,
      tokens: currentTokens,
      verified: current.summary.outcome.verified,
      status: current.summary.outcome.status,
    },
    baseline: {
      runId: baseline.runId,
      strategy: baseline.configuration.strategy,
      tokens: baselineTokens,
      verified: baseline.summary.outcome.verified,
      status: baseline.summary.outcome.status,
    },
    delta: {
      tokens: tokenDelta,
      reductionPercent:
        baselineTokens === 0 ? null : Number(((-tokenDelta / baselineTokens) * 100).toFixed(2)),
      modelCalls: current.summary.modelCalls - baseline.summary.modelCalls,
      toolCalls: current.summary.toolCalls - baseline.summary.toolCalls,
      latencyMs: Number((current.summary.latencyMs - baseline.summary.latencyMs).toFixed(2)),
    },
    comparableOutcome:
      current.summary.outcome.verified &&
      baseline.summary.outcome.verified &&
      current.summary.outcome.status === baseline.summary.outcome.status,
  };
  assertJsonSchemaContract(
    comparison,
    EVALUATION_COMPARISON_CONTRACT,
    'workspace evaluation comparison'
  );
  return comparison;
}

export function assertWorkspaceEvaluationSourceTaxonomy(): void {
  if (MODEL_USAGE_SOURCES.length !== 4) {
    throw new Error('Model usage source taxonomy is incomplete.');
  }
}
