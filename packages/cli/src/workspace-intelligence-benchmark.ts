import crypto from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import type {
  WorkspaceEvaluationSummary,
  WorkspaceIntelligenceEvaluation,
  WorkspaceIntelligenceEvaluationComparison,
} from './contracts/workspace-intelligence-evaluation-contract.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  buildWorkspaceGraphTokenEfficiencyReport,
  type WorkspaceGraphCorpusMetrics,
} from './workspace-graph-token-efficiency.js';
import {
  WORKSPACE_EVALUATION_LAST_RUN_PATH,
  compareWorkspaceEvaluations,
  readWorkspaceEvaluation,
} from './workspace-intelligence-evaluation.js';
import { readWorkspaceMarker } from './workspace-marker.js';

export const WORKSPACE_INTELLIGENCE_BENCHMARK_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceIntelligenceBenchmark.schemaVersion;
export const WORKSPACE_INTELLIGENCE_BENCHMARK_REPORT_PATH =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceIntelligenceBenchmark.artifactPath;
export const WORKSPACE_INTELLIGENCE_BENCHMARK_CONTRACT_PATH =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceIntelligenceBenchmark.contractPath;

export const WORKSPACE_INTELLIGENCE_BENCHMARK_SUITES = {
  'agent-core.v1': {
    id: 'agent-core.v1',
    version: 1,
    title: 'Cross-project agent retrieval core',
    scenarios: [
      {
        id: 'architecture',
        title: 'Architecture and runtime discovery',
        preferredKinds: ['service', 'runtime-unit', 'language', 'project', 'workspace'],
      },
      {
        id: 'ownership',
        title: 'Dependency and ownership discovery',
        preferredKinds: ['package', 'module', 'owner', 'project', 'workspace'],
      },
      {
        id: 'interfaces',
        title: 'Interface and contract discovery',
        preferredKinds: ['api', 'endpoint', 'protocol', 'schema', 'project', 'workspace'],
      },
      {
        id: 'change-safety',
        title: 'Change safety and verification discovery',
        preferredKinds: [
          'test-suite',
          'lifecycle-stage',
          'pipeline',
          'module',
          'project',
          'workspace',
        ],
      },
      {
        id: 'delivery',
        title: 'Build and delivery discovery',
        preferredKinds: [
          'pipeline',
          'deployment',
          'container',
          'lifecycle-stage',
          'project',
          'workspace',
        ],
      },
    ],
  },
} as const;

export type WorkspaceIntelligenceBenchmarkSuiteId =
  keyof typeof WORKSPACE_INTELLIGENCE_BENCHMARK_SUITES;

export type EvaluationProvenance = 'measured' | 'mixed' | 'estimated' | 'unavailable';

export type WorkspaceIntelligenceBenchmark = {
  schemaVersion: typeof WORKSPACE_INTELLIGENCE_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  workspace: { name: string; path: string };
  suite: { id: WorkspaceIntelligenceBenchmarkSuiteId; version: number; title: string };
  graph: {
    schemaVersion: string;
    sourceArtifact: string;
    sourceHash: string;
    entityCount: number;
    relationCount: number;
    proofCount: number;
  };
  methodology: {
    id: 'multi-scenario-bounded-retrieval.v1';
    charsPerEstimatedToken: 4;
    deterministic: true;
    networkRequired: false;
    scenarioTargetPolicy: 'evidence-backed-representative.v1';
    claimBoundary: string;
  };
  corpus: WorkspaceGraphCorpusMetrics;
  scenarios: Array<{
    id: string;
    title: string;
    query: string;
    queryOrigin: 'graph-derived';
    targetEntityId: string;
    targetKind: string;
    targetRetrieved: boolean;
    result: 'matched' | 'empty';
    matchCount: number;
    truncated: boolean;
    retrievalCharacterCount: number;
    retrievalEstimatedTokens: number;
    estimatedTokensAvoided: number;
    estimatedReductionPercent: number;
  }>;
  retrievalSummary: {
    provenance: 'estimated';
    scenarioCount: number;
    matchedScenarioCount: number;
    medianRetrievalEstimatedTokens: number;
    p95RetrievalEstimatedTokens: number;
    medianEstimatedReductionPercent: number;
    status: 'passed' | 'partial' | 'unavailable';
  };
  evaluation: {
    availability: 'available' | 'unavailable';
    provenance: EvaluationProvenance;
    current?: {
      runId: string;
      taskId: string;
      strategy: string;
      status: string;
      summary: WorkspaceEvaluationSummary;
    };
    comparison?: WorkspaceIntelligenceEvaluationComparison;
    trustedMeasuredReductionPercent: number | null;
    claimBoundary: string;
  };
};

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(fraction * ordered.length) - 1));
  return ordered[index] ?? 0;
}

function representativeScenarioTarget(
  graph: WorkspaceKnowledgeGraph,
  preferredKinds: readonly string[]
): { entity: WorkspaceKnowledgeGraph['entities'][number]; query: string } {
  const labelCounts = new Map<string, number>();
  for (const entity of graph.entities) {
    const label = entity.label.trim().toLowerCase();
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  for (const kind of preferredKinds) {
    const matches = graph.entities
      .filter((entity) => entity.kind === kind)
      .sort((left, right) => left.id.localeCompare(right.id));
    const uniqueLabel = matches.find(
      (entity) => labelCounts.get(entity.label.trim().toLowerCase()) === 1
    );
    if (uniqueLabel) return { entity: uniqueLabel, query: uniqueLabel.label };
    const match = matches[0];
    if (match) return { entity: match, query: match.identity.key };
  }
  const fallback = [...graph.entities].sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!fallback) throw new Error('Workspace benchmark requires at least one graph entity.');
  return { entity: fallback, query: fallback.identity.key };
}

export function classifyWorkspaceEvaluationProvenance(
  evaluation: WorkspaceIntelligenceEvaluation | undefined
): EvaluationProvenance {
  if (!evaluation || evaluation.summary.modelCalls === 0) return 'unavailable';
  const sources = evaluation.summary.tokenSources;
  const measured = sources.providerReported + sources.tokenizerCounted;
  const classified = measured + sources.estimated + sources.unavailable;
  if (classified !== evaluation.summary.modelCalls) return 'mixed';
  if (measured === evaluation.summary.modelCalls) return 'measured';
  if (sources.estimated === evaluation.summary.modelCalls) return 'estimated';
  if (sources.unavailable === evaluation.summary.modelCalls) return 'unavailable';
  return 'mixed';
}

export function trustedMeasuredEvaluationReduction(input: {
  comparison: WorkspaceIntelligenceEvaluationComparison | undefined;
  currentProvenance: EvaluationProvenance;
  baselineProvenance: EvaluationProvenance;
}): number | null {
  return input.comparison?.taskAligned === true &&
    input.comparison.comparableOutcome === true &&
    input.currentProvenance === 'measured' &&
    input.baselineProvenance === 'measured'
    ? input.comparison.delta.reductionPercent
    : null;
}

async function optionalEvaluation(
  workspacePath: string,
  reportPath: string
): Promise<WorkspaceIntelligenceEvaluation | undefined> {
  try {
    return await readWorkspaceEvaluation(workspacePath, reportPath);
  } catch {
    return undefined;
  }
}

export async function buildWorkspaceIntelligenceBenchmark(input: {
  workspacePath: string;
  graph: WorkspaceKnowledgeGraph;
  suite?: WorkspaceIntelligenceBenchmarkSuiteId;
  limit?: number;
  evaluationPath?: string;
  baselineEvaluationPath?: string;
  now?: Date;
}): Promise<WorkspaceIntelligenceBenchmark> {
  const workspacePath = path.resolve(input.workspacePath);
  const suiteId = input.suite ?? 'agent-core.v1';
  const suite = WORKSPACE_INTELLIGENCE_BENCHMARK_SUITES[suiteId];
  const scenarios: WorkspaceIntelligenceBenchmark['scenarios'] = [];
  let corpus: WorkspaceGraphCorpusMetrics | undefined;
  for (const scenario of suite.scenarios) {
    const selected = representativeScenarioTarget(input.graph, scenario.preferredKinds);
    const target = selected.entity;
    const report = await buildWorkspaceGraphTokenEfficiencyReport({
      workspacePath,
      graph: input.graph,
      query: selected.query,
      limit: input.limit ?? 12,
      ...(corpus ? { corpus } : {}),
      now: input.now,
    });
    corpus = report.corpus;
    const targetRetrieved = report.retrieval.payload.entities.some(
      (entity) => entity.id === target.id
    );
    scenarios.push({
      id: scenario.id,
      title: scenario.title,
      query: selected.query,
      queryOrigin: 'graph-derived',
      targetEntityId: target.id,
      targetKind: target.kind,
      targetRetrieved,
      result: targetRetrieved ? 'matched' : 'empty',
      matchCount: report.retrieval.matchCount,
      truncated: report.retrieval.truncated,
      retrievalCharacterCount: report.retrieval.characterCount,
      retrievalEstimatedTokens: report.retrieval.estimatedTokens,
      estimatedTokensAvoided: report.savings.estimatedTokensAvoided,
      estimatedReductionPercent: report.savings.reductionPercent,
    });
  }
  corpus ??= { artifactCount: 0, characterCount: 0, estimatedTokens: 0, unreadableArtifacts: [] };
  const current = await optionalEvaluation(
    workspacePath,
    input.evaluationPath ?? WORKSPACE_EVALUATION_LAST_RUN_PATH
  );
  const baseline = input.baselineEvaluationPath
    ? await optionalEvaluation(workspacePath, input.baselineEvaluationPath)
    : undefined;
  const comparison =
    current && baseline ? compareWorkspaceEvaluations(current, baseline) : undefined;
  const currentProvenance = classifyWorkspaceEvaluationProvenance(current);
  const baselineProvenance = classifyWorkspaceEvaluationProvenance(baseline);
  const trustedMeasuredReductionPercent = trustedMeasuredEvaluationReduction({
    comparison,
    currentProvenance,
    baselineProvenance,
  });
  const marker = await readWorkspaceMarker(workspacePath);
  const matchedScenarioCount = scenarios.filter((scenario) => scenario.result === 'matched').length;
  const retrievalTokens = scenarios.map((scenario) => scenario.retrievalEstimatedTokens);
  const reductions = scenarios.map((scenario) => scenario.estimatedReductionPercent);
  const report: WorkspaceIntelligenceBenchmark = {
    schemaVersion: WORKSPACE_INTELLIGENCE_BENCHMARK_SCHEMA_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    workspace: { name: marker?.name || path.basename(workspacePath), path: workspacePath },
    suite: { id: suite.id, version: suite.version, title: suite.title },
    graph: {
      schemaVersion: input.graph.schemaVersion,
      sourceArtifact: input.graph.source.artifact,
      sourceHash: input.graph.source.hash,
      entityCount: input.graph.entities.length,
      relationCount: input.graph.relations.length,
      proofCount: input.graph.proofs.length,
    },
    methodology: {
      id: 'multi-scenario-bounded-retrieval.v1',
      charsPerEstimatedToken: 4,
      deterministic: true,
      networkRequired: false,
      scenarioTargetPolicy: 'evidence-backed-representative.v1',
      claimBoundary:
        'Retrieval values estimate payload size against readable proof-source text across fixed scenario categories with deterministic evidence-backed representative targets. They do not establish answer equivalence, model billing savings, or task success.',
    },
    corpus,
    scenarios,
    retrievalSummary: {
      provenance: 'estimated',
      scenarioCount: scenarios.length,
      matchedScenarioCount,
      medianRetrievalEstimatedTokens: percentile(retrievalTokens, 0.5),
      p95RetrievalEstimatedTokens: percentile(retrievalTokens, 0.95),
      medianEstimatedReductionPercent: percentile(reductions, 0.5),
      status:
        corpus.estimatedTokens === 0
          ? 'unavailable'
          : matchedScenarioCount === scenarios.length
            ? 'passed'
            : 'partial',
    },
    evaluation: {
      availability: current ? 'available' : 'unavailable',
      provenance: currentProvenance,
      ...(current
        ? {
            current: {
              runId: current.runId,
              taskId: current.configuration.taskId,
              strategy: current.configuration.strategy,
              status: current.status,
              summary: current.summary,
            },
          }
        : {}),
      ...(comparison ? { comparison } : {}),
      trustedMeasuredReductionPercent,
      claimBoundary:
        'A measured reduction is reported only for task-aligned runs with comparable verified outcomes when every model call in both runs uses provider-reported or tokenizer-counted usage.',
    },
  };
  assertJsonSchemaContract(
    report,
    WORKSPACE_INTELLIGENCE_BENCHMARK_CONTRACT_PATH,
    'workspace intelligence benchmark'
  );
  return report;
}

export async function writeWorkspaceIntelligenceBenchmark(
  workspacePath: string,
  report: WorkspaceIntelligenceBenchmark,
  outputPath: string = WORKSPACE_INTELLIGENCE_BENCHMARK_REPORT_PATH
): Promise<string> {
  assertJsonSchemaContract(report, WORKSPACE_INTELLIGENCE_BENCHMARK_CONTRACT_PATH, outputPath);
  const target = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(path.resolve(workspacePath), outputPath);
  const relative = path.relative(path.resolve(workspacePath), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Workspace benchmark output must remain inside the workspace.');
  }
  await fsExtra.ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsExtra.writeJson(temporary, report, { spaces: 2 });
    await fsExtra.rename(temporary, target);
  } finally {
    await fsExtra.remove(temporary).catch(() => undefined);
  }
  return target;
}
