import path from 'path';
import fsExtra from 'fs-extra';

import {
  buildWorkspaceModel,
  type WorkspaceModel,
  type WorkspaceModelValidationIssue,
  type WorkspaceModelValidationResult,
  type WorkspaceModelProject,
} from './workspace-model.js';
import {
  buildWorkspaceIntelligenceChainContract,
  WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
} from './contracts/workspace-intelligence-chain-contract.js';
import { attachRunCorrelation } from './observability/run-correlation.js';
import {
  buildWorkspaceFact,
  summarizeFactFreshness,
  type FactFreshnessContract,
  type FactFreshnessSummary,
  type WorkspaceFact,
} from './contracts/fact-freshness-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import { assertWorkspaceKnowledgeGraphSourceBinding } from './workspace-knowledge-graph.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';

export const WORKSPACE_CONTEXT_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.agentContext;
export const WORKSPACE_CONTEXT_AGENT_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext;

export type WorkspaceContextAgent =
  | 'generic'
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'qwen'
  | 'kimi'
  | 'grok'
  | 'copilot'
  | 'windsurf'
  | 'amazon-q'
  | 'orca';

export type WorkspaceContextSafeCommand = {
  id: string;
  scope: 'workspace' | 'project';
  display: string;
  execute: string;
  description: string;
  project?: string;
  freshness: FactFreshnessContract;
};

export type WorkspaceContextProjectSummary = {
  name: string;
  path: string;
  kind: string;
  runtime: string;
  framework: string;
  generator?: WorkspaceModelProject['generator'];
  createCapability: WorkspaceModelProject['createCapability'];
  supportTier: string;
  safeCommands: string[];
  importantFiles: string[];
  facts: WorkspaceFact[];
};

export type WorkspaceAgentContext = {
  schemaVersion: typeof WORKSPACE_CONTEXT_SCHEMA_VERSION;
  generatedAt: string;
  agent: WorkspaceContextAgent;
  workspaceSummary: string;
  modelRef: string;
  knowledgeGraph: {
    artifact: string;
    schemaVersion: typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph;
    available: boolean;
    entityCount?: number;
    relationCount?: number;
    proofCount?: number;
    queryCommands: string[];
  };
  intelligenceChain: {
    schemaVersion: typeof WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION;
    contractPath: string;
    currentStep: 'context';
    canonicalReadOrder: string[];
  };
  workspace: {
    name: string;
    root: string;
    type: string;
    profile?: string;
  };
  scope: {
    requested: string;
    activeProject?: string;
  };
  projects: WorkspaceContextProjectSummary[];
  safeCommands: WorkspaceContextSafeCommand[];
  facts: WorkspaceFact[];
  factFreshness: FactFreshnessSummary;
  evidence: {
    available: string[];
    missing: string[];
  };
  policies: {
    mode: string;
    source: string | null;
  };
  contracts: {
    exists: boolean;
    path: string;
  };
  validation: WorkspaceModelValidationResult;
  agentInstructions: string[];
  unsafeAssumptions: string[];
  humanSummary: string;

  /**
   * Optional, evidence-backed workspace intelligence projections
   * (enriched summaries of artifacts produced by `workspace intelligence run`).
   */
  impactSummary?: {
    changed?: boolean;
    risk?: string;
    affectedProjects?: number;
    blastRadius?: unknown;
    recommendedCommands?: unknown;
  };
  doctorSummary?: {
    verdict?: string;
    totalIssues?: number;
    advisoryFindings?: number;
    blockingFindings?: number;
    unknownFindings?: number;
    hasSystemErrors?: boolean;
    topSignals?: Array<{
      label?: string;
      scope?: string;
      issueClass?: string;
      status?: string;
      severity?: string;
      recommendation?: string;
    }>;
  };
  analyzeSummary?: {
    score?: number;
    verdict?: string;
    findingCounts?: Record<string, unknown>;
    topFindings?: Array<{
      severity?: string;
      title?: string;
      target?: string;
      remediation?: string;
    }>;
  };
  readinessSummary?: {
    overallStatus?: string;
    blocking?: boolean;
    blockingReasons?: string[];
    gates?: Array<{
      gate?: string;
      status?: string;
      summary?: string;
    }>;
    evidencePath?: string;
  };
  verifySummary?: {
    verdict?: string;
    exitCode?: number;
    stepsFailed?: number;
    stepsMissing?: number;
    blockingReasons?: string[];
    missingEvidence?: string[];
  };
  explainSummary?: {
    summary?: string;
    blockingReasons?: string[];
    releaseVerdict?: string;
    evidenceFreshness?: string;
    sections?: Array<{ id?: string; title?: string; body?: string }>;
  };
  diffSummary?: {
    changed?: boolean;
    addedProjects?: number;
    removedProjects?: number;
    changedProjects?: number;
    workspaceChanges?: number;
    validationChanges?: number;
    gitChangedFiles?: number;
  };
};

export type BuildWorkspaceAgentContextOptions = {
  workspacePath: string;
  agent?: string | boolean;
  scope?: string;
  includeEvidence?: boolean;
  observableScanDepth?: number;
  strict?: boolean;
  now?: Date;
  model?: WorkspaceModel;
};

function normalizeAgent(agent: string | boolean | undefined): WorkspaceContextAgent {
  if (typeof agent !== 'string' || !agent.trim() || agent === 'true') {
    return 'generic';
  }
  const normalized = agent.trim().toLowerCase();
  if (
    normalized === 'codex' ||
    normalized === 'claude' ||
    normalized === 'cursor' ||
    normalized === 'gemini' ||
    normalized === 'qwen' ||
    normalized === 'kimi' ||
    normalized === 'grok' ||
    normalized === 'copilot' ||
    normalized === 'windsurf' ||
    normalized === 'amazon-q' ||
    normalized === 'orca'
  ) {
    return normalized;
  }
  return 'generic';
}

function pinnedRapidkitCommand(args: string): string {
  return `npx --yes --package workspai workspai ${args}`.trim();
}

function displayRapidkitCommand(args: string): string {
  return `npx workspai ${args}`.trim();
}

async function safeReadWorkspaceJsonArtifact<T>(
  workspacePath: string,
  artifactPath: string,
  expectedSchemaVersion: string
): Promise<T | null> {
  const absolutePath = path.join(workspacePath, artifactPath);
  if (!(await fsExtra.pathExists(absolutePath))) return null;
  try {
    const json = (await fsExtra.readJson(absolutePath)) as any;
    if (!json || json.schemaVersion !== expectedSchemaVersion) return null;
    return json as T;
  } catch {
    return null;
  }
}

function command(
  input: Omit<WorkspaceContextSafeCommand, 'display' | 'execute' | 'freshness'> & {
    args: string;
    generatedAt: string;
    now: Date;
  }
): WorkspaceContextSafeCommand {
  return {
    id: input.id,
    scope: input.scope,
    display: displayRapidkitCommand(input.args),
    execute: pinnedRapidkitCommand(input.args),
    description: input.description,
    ...(input.project ? { project: input.project } : {}),
    freshness: buildWorkspaceFact({
      id: `command.${input.id}`,
      label: `${input.id} command`,
      scope: 'command',
      value: {
        display: displayRapidkitCommand(input.args),
        execute: pinnedRapidkitCommand(input.args),
      },
      ...(input.project ? { project: input.project } : {}),
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt: input.generatedAt,
        now: input.now,
        sourceArtifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        sourcePath: `safeCommands.${input.id}`,
        reason: 'Safe command surfaces are derived from workspace model command capabilities.',
      },
    }).freshness,
  };
}

function projectCommandArgs(project: WorkspaceModelProject, action: string): string {
  return `workspace run ${action} --scope project:${project.name}`;
}

function normalizeProjectScope(scope: string): string {
  return (scope.startsWith('project:') ? scope.slice('project:'.length) : scope)
    .trim()
    .toLowerCase();
}

function projectScopeCandidates(project: WorkspaceModelProject): string[] {
  return [project.name, project.path, path.basename(project.path), project.absolutePath]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function buildSafeCommands(
  model: WorkspaceModel,
  activeProject: WorkspaceModelProject | undefined,
  now: Date
): WorkspaceContextSafeCommand[] {
  const commandContext = { generatedAt: model.generatedAt, now };
  const commands: WorkspaceContextSafeCommand[] = [
    command({
      id: 'workspace.model',
      scope: 'workspace',
      args: 'workspace model --json',
      description: 'Read the canonical workspace intelligence model.',
      ...commandContext,
    }),
    command({
      id: 'workspace.graph.entities',
      scope: 'workspace',
      args: 'workspace graph entities --json',
      description: 'Query proof-backed workspace entities without loading the full graph.',
      ...commandContext,
    }),
    command({
      id: 'workspace.graph.evidence',
      scope: 'workspace',
      args: 'workspace graph evidence <entity-or-relation> --json',
      description: 'Resolve portable evidence for a graph entity or relation.',
      ...commandContext,
    }),
    command({
      id: 'workspace.graph.path',
      scope: 'workspace',
      args: 'workspace graph path <from> <to> --json',
      description: 'Find a shortest proof-carrying path between workspace entities.',
      ...commandContext,
    }),
    command({
      id: 'workspace.doctor',
      scope: 'workspace',
      args: 'doctor workspace --json',
      description: 'Check workspace health before claiming verification.',
      ...commandContext,
    }),
    command({
      id: 'workspace.pipeline',
      scope: 'workspace',
      args: 'pipeline --json',
      description: 'Run the governed sync, doctor, analyze, readiness, and autopilot loop.',
      ...commandContext,
    }),
    command({
      id: 'workspace.contract.verify',
      scope: 'workspace',
      args: 'workspace contract verify --json',
      description: 'Verify workspace contract and dependency edges.',
      ...commandContext,
    }),
    command({
      id: 'workspace.verify',
      scope: 'workspace',
      args: 'workspace verify --json',
      description: 'Evaluate evidence freshness and verification gates before release decisions.',
      ...commandContext,
    }),
  ];

  const scopedProjects = activeProject ? [activeProject] : model.projects;
  for (const project of scopedProjects) {
    if (project.commands.fleetStages.includes('test')) {
      commands.push(
        command({
          id: `project.${project.name}.test`,
          scope: 'project',
          project: project.name,
          args: projectCommandArgs(project, 'test'),
          description: `Run tests for ${project.name} through workspace orchestration.`,
          ...commandContext,
        })
      );
    }
    if (project.commands.fleetStages.includes('build')) {
      commands.push(
        command({
          id: `project.${project.name}.build`,
          scope: 'project',
          project: project.name,
          args: projectCommandArgs(project, 'build'),
          description: `Build ${project.name} through workspace orchestration.`,
          ...commandContext,
        })
      );
    }
  }

  return commands;
}

function summarizeProjectSafeCommands(project: WorkspaceModelProject): string[] {
  return project.commands.fleetStages
    .filter((stage) => stage === 'test' || stage === 'build')
    .map((stage) => `workspace run ${stage}`);
}

function resolveActiveProject(
  model: WorkspaceModel,
  scope: string | undefined
): WorkspaceModelProject | undefined {
  if (!scope?.startsWith('project:')) {
    return undefined;
  }
  const requested = normalizeProjectScope(scope);
  if (!requested) {
    return undefined;
  }
  return model.projects.find((project) => projectScopeCandidates(project).includes(requested));
}

function buildContextValidation(
  model: WorkspaceModel,
  scope: string | undefined,
  activeProject: WorkspaceModelProject | undefined
): WorkspaceModelValidationResult {
  const issues: WorkspaceModelValidationIssue[] = [...(model.validation?.issues ?? [])];
  if (scope?.startsWith('project:') && !activeProject) {
    issues.push({
      severity: 'error',
      code: 'context.scope.project.missing',
      message: `Requested project scope was not found: ${scope}`,
      target: scope,
    });
  }

  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return {
    status: errors > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed',
    errors,
    warnings,
    issues,
  };
}

async function evidenceState(
  model: WorkspaceModel,
  workspacePath: string
): Promise<{ available: string[]; missing: string[] }> {
  const available: string[] = [];
  const missing: string[] = [];
  for (const [key, ref] of Object.entries(model.evidence)) {
    if (ref && (await firstExistingWorkspaceArtifactPath(workspacePath, ref.path)) !== null) {
      available.push(`${key}: ${ref.path}`);
    } else {
      missing.push(key);
    }
  }
  return { available: available.sort(), missing: missing.sort() };
}

function summarizeWorkspace(model: WorkspaceModel): string {
  const projectCount = model.summary.projectCount;
  const runtimeText = model.summary.runtimes.length
    ? `${model.summary.runtimes.join(', ')} runtime coverage`
    : 'no runtime coverage';
  const surfaceText = model.identity.surfaces.length
    ? model.identity.surfaces.join(', ')
    : 'no detected surfaces';
  return `${model.workspace.name} is a ${model.identity.workspaceType} with ${projectCount} project${projectCount === 1 ? '' : 's'}, ${runtimeText}, and ${surfaceText}.`;
}

function unsafeAssumptions(model: WorkspaceModel): string[] {
  const assumptions: string[] = [
    'Do not claim a command passed unless a report or command output proves it.',
    'Do not infer secrets or environment values from file names.',
    'Do not change project scope without checking the selected project.',
  ];
  if (!model.contracts.exists) {
    assumptions.push('Workspace contract is missing; dependency and API edges may be incomplete.');
  }
  if (model.summary.observedProjects > 0) {
    assumptions.push(
      'Some projects are observed rather than first-class; command support may be partial.'
    );
  }
  return assumptions;
}

export async function buildWorkspaceAgentContext(
  input: BuildWorkspaceAgentContextOptions
): Promise<WorkspaceAgentContext> {
  const model =
    input.model ??
    (await buildWorkspaceModel({
      workspacePath: input.workspacePath,
      includeEvidence: input.includeEvidence === true,
      observableScanDepth: input.observableScanDepth,
      now: input.now,
    }));
  const agent = normalizeAgent(input.agent);
  const activeProject = resolveActiveProject(model, input.scope);
  const validation = buildContextValidation(model, input.scope, activeProject);
  if (input.strict === true && validation.status !== 'passed') {
    const summary = validation.issues
      .map((item) => `${item.severity}:${item.code}:${item.target}`)
      .join(', ');
    throw new Error(`Workspace context strict validation failed: ${summary}`);
  }
  const now = input.now ?? new Date();
  const baseFacts = model.facts ?? [];
  const projectSet = new Set(
    (activeProject ? [activeProject] : model.projects).map((item) => item.name)
  );
  const scopedModelFacts = baseFacts.filter((fact) => {
    if (!fact.project) {
      return true;
    }
    return projectSet.has(fact.project);
  });
  const projects = (activeProject ? [activeProject] : model.projects).map((project) => {
    const projectFacts = scopedModelFacts.filter((fact) => fact.project === project.name);
    return {
      name: project.name,
      path: project.path,
      kind: project.kind,
      category: project.category,
      runtime: project.runtime,
      framework: project.frameworkDisplayName,
      ...(project.generator ? { generator: project.generator } : {}),
      createCapability: project.createCapability,
      supportTier: project.supportTier,
      safeCommands: summarizeProjectSafeCommands(project),
      importantFiles: project.importantFiles,
      facts: projectFacts,
    };
  });
  const evidence = await evidenceState(model, input.workspacePath);
  const knowledgeGraphPath = path.join(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph
  );
  const knowledgeGraph = (await fsExtra.pathExists(knowledgeGraphPath))
    ? ((await fsExtra
        .readJson(knowledgeGraphPath)
        .catch(() => null)) as WorkspaceKnowledgeGraph | null)
    : null;
  let knowledgeGraphAvailable = false;
  if (knowledgeGraph?.schemaVersion === WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph) {
    try {
      assertWorkspaceKnowledgeGraphSourceBinding(knowledgeGraph, model);
      knowledgeGraphAvailable = true;
    } catch {
      // A stale or independently-produced graph is not valid context for this model generation.
    }
  }
  const workspaceSummary = summarizeWorkspace(model);
  const safeCommands = buildSafeCommands(model, activeProject, now);

  const impactArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.impact,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.impact
  );
  const doctorArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.doctor
  );
  const analyzeArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.analyze
  );
  const readinessArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.readiness
  );
  const verifyArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.verify,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.verify
  );
  const explainArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.explain,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.explain
  );
  const diffArtifact = await safeReadWorkspaceJsonArtifact<any>(
    input.workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.diff,
    WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.diff
  );

  const impactSummary: WorkspaceAgentContext['impactSummary'] = impactArtifact?.summary
    ? {
        changed: impactArtifact.summary.changed,
        risk: impactArtifact.summary.risk,
        affectedProjects: impactArtifact.summary.affectedProjects,
        blastRadius: impactArtifact.summary.blastRadius,
        recommendedCommands: impactArtifact.summary.recommendedCommands,
      }
    : undefined;

  const doctorSummary: WorkspaceAgentContext['doctorSummary'] = doctorArtifact?.summary
    ? {
        verdict: doctorArtifact.summary.verdict,
        totalIssues: doctorArtifact.summary.totalIssues,
        advisoryFindings: doctorArtifact.summary.advisoryFindings,
        blockingFindings: doctorArtifact.summary.blockingFindings,
        unknownFindings: doctorArtifact.summary.unknownFindings,
        hasSystemErrors: doctorArtifact.summary.hasSystemErrors,
        topSignals: (() => {
          const projects: any[] = Array.isArray(doctorArtifact.projects)
            ? doctorArtifact.projects
            : [];
          const signals: any[] = [];
          for (const project of projects.slice(0, 6)) {
            const probes: any[] = Array.isArray(project?.probes) ? project.probes : [];
            for (const probe of probes.slice(0, 10)) {
              if (probe?.status === 'fail' || probe?.severity === 'error') {
                signals.push({
                  label: probe.label,
                  scope: probe.scope,
                  issueClass: probe.issueClass,
                  status: probe.status,
                  severity: probe.severity,
                  recommendation: probe.recommendation,
                });
              }
            }
          }
          return signals.slice(0, 8);
        })(),
      }
    : undefined;

  const analyzeSummary: WorkspaceAgentContext['analyzeSummary'] = analyzeArtifact?.summary
    ? {
        score: analyzeArtifact.summary.score,
        verdict: analyzeArtifact.summary.verdict,
        findingCounts: analyzeArtifact.summary.findings,
        topFindings: (() => {
          const findings: any[] = Array.isArray(analyzeArtifact.findings)
            ? analyzeArtifact.findings
            : [];
          const prioritized = findings
            .filter((f) => f?.severity === 'fail' || f?.severity === 'warn')
            .slice(0, 8);
          return prioritized.map((f) => ({
            severity: f.severity,
            title: f.title,
            target: f.target,
            remediation: f.remediation,
          }));
        })(),
      }
    : undefined;

  const readinessSummary: WorkspaceAgentContext['readinessSummary'] = readinessArtifact
    ? {
        overallStatus: readinessArtifact.overallStatus,
        blocking: readinessArtifact.blocking,
        blockingReasons: readinessArtifact.blockingReasons,
        evidencePath: readinessArtifact.evidencePath,
        gates: Array.isArray(readinessArtifact.gates)
          ? readinessArtifact.gates.slice(0, 6).map((g: any) => ({
              gate: g.gate,
              status: g.status,
              summary: g.summary,
            }))
          : undefined,
      }
    : undefined;

  const verifySummary: WorkspaceAgentContext['verifySummary'] = verifyArtifact?.summary
    ? {
        verdict: verifyArtifact.summary.verdict,
        exitCode: verifyArtifact.summary.exitCode,
        stepsFailed: verifyArtifact.summary.stepsFailed,
        stepsMissing: verifyArtifact.summary.stepsMissing,
        blockingReasons: verifyArtifact.blockingReasons,
        missingEvidence: verifyArtifact.missingEvidence,
      }
    : undefined;

  const explainSummary: WorkspaceAgentContext['explainSummary'] = explainArtifact
    ? {
        summary: explainArtifact.summary,
        blockingReasons: explainArtifact.blockingReasons,
        releaseVerdict: explainArtifact.releaseVerdict,
        evidenceFreshness: explainArtifact.evidenceFreshness,
        sections: Array.isArray(explainArtifact.sections)
          ? explainArtifact.sections.slice(0, 4).map((s: any) => ({
              id: s.id,
              title: s.title,
              body: s.body,
            }))
          : undefined,
      }
    : undefined;

  const diffSummary: WorkspaceAgentContext['diffSummary'] = diffArtifact?.summary
    ? {
        changed: diffArtifact.summary.changed,
        addedProjects: diffArtifact.summary.addedProjects,
        removedProjects: diffArtifact.summary.removedProjects,
        changedProjects: diffArtifact.summary.changedProjects,
        workspaceChanges: diffArtifact.summary.workspaceChanges,
        validationChanges: diffArtifact.summary.validationChanges,
        gitChangedFiles: diffArtifact.summary.gitChangedFiles,
      }
    : undefined;
  const commandFacts = safeCommands.map((safeCommand) =>
    buildWorkspaceFact({
      id: `context.command.${safeCommand.id}`,
      label: `${safeCommand.id} safe command`,
      scope: 'command',
      value: {
        display: safeCommand.display,
        execute: safeCommand.execute,
        scope: safeCommand.scope,
      },
      ...(safeCommand.project ? { project: safeCommand.project } : {}),
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt: model.generatedAt,
        now,
        sourceArtifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
        sourcePath: `safeCommands.${safeCommand.id}`,
        reason: 'Context safe commands are derived from workspace model command capabilities.',
      },
    })
  );
  const facts = [...scopedModelFacts, ...commandFacts];
  const factFreshness = summarizeFactFreshness({
    facts,
    generatedAt: now.toISOString(),
    now,
  });
  const intelligenceChain = buildWorkspaceIntelligenceChainContract();

  return {
    schemaVersion: WORKSPACE_CONTEXT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    agent,
    workspaceSummary,
    modelRef: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
    knowledgeGraph: {
      artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
      schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph,
      available: knowledgeGraphAvailable,
      ...(typeof knowledgeGraph?.quality?.entityCount === 'number'
        ? { entityCount: knowledgeGraph.quality.entityCount }
        : {}),
      ...(typeof knowledgeGraph?.quality?.relationCount === 'number'
        ? { relationCount: knowledgeGraph.quality.relationCount }
        : {}),
      ...(typeof knowledgeGraph?.quality?.proofCount === 'number'
        ? { proofCount: knowledgeGraph.quality.proofCount }
        : {}),
      queryCommands: [
        displayRapidkitCommand('workspace graph search <query> --limit 12 --json'),
        displayRapidkitCommand('workspace graph entities [kind] --json'),
        displayRapidkitCommand('workspace graph evidence <entity-or-relation> --json'),
        displayRapidkitCommand('workspace graph path <from> <to> --json'),
      ],
    },
    intelligenceChain: {
      schemaVersion: intelligenceChain.schemaVersion,
      contractPath: intelligenceChain.contractPath,
      currentStep: 'context',
      canonicalReadOrder: [...intelligenceChain.consumers.agents.canonicalReadOrder],
    },
    workspace: {
      name: model.workspace.name,
      root: model.workspace.root,
      type: model.identity.workspaceType,
      ...(model.workspace.profile ? { profile: model.workspace.profile } : {}),
    },
    scope: {
      requested: input.scope ?? 'workspace',
      ...(activeProject ? { activeProject: activeProject.name } : {}),
    },
    projects,
    safeCommands,
    facts,
    factFreshness,
    evidence,
    policies: {
      mode: model.policies.mode,
      source: model.policies.source,
    },
    contracts: {
      exists: model.contracts.exists,
      path: model.contracts.workspaceContractPath,
    },
    validation,
    agentInstructions: [
      `Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` first, then this context pack and linked evidence reports.`,
      'Use `workspace graph search <query> --limit 12 --json` for bounded, proof-backed retrieval before loading the full graph.',
      `Load \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}\` only when a complete graph export is explicitly required.`,
      'Use this context as the workspace source of truth before inspecting random files.',
      'Prefer workspace-level evidence over generic framework assumptions.',
      'Use `display` commands when explaining steps to a human.',
      'Use `execute` commands when launching commands from automation or tooling.',
      'Treat `facts[].freshness.verifyBeforeUse` as a hard refresh requirement before using that fact in advice, fixes, or release decisions.',
      'Do not carry extracted facts beyond their freshness contract; re-read or regenerate evidence when the contract says stale, unknown, live, or verify-before-use.',
      'Keep project-scoped advice tied to the active project scope.',
      'Regenerate stale grounding with `npx workspai workspace agent-sync --write --refresh-context`.',
    ],
    unsafeAssumptions: [
      ...unsafeAssumptions(model),
      ...(factFreshness.verifyBeforeUseFacts > 0
        ? [
            `${factFreshness.verifyBeforeUseFacts} fact(s) require verification before use; do not treat them as durable workspace structure.`,
          ]
        : []),
    ],
    humanSummary: [
      workspaceSummary,
      `Evidence available: ${evidence.available.length}. Missing evidence groups: ${evidence.missing.join(', ') || 'none'}.`,
      activeProject
        ? `Active project scope: ${activeProject.name} (${activeProject.frameworkDisplayName}).`
        : 'Scope: whole workspace.',
    ].join('\n'),

    impactSummary,
    doctorSummary,
    analyzeSummary,
    readinessSummary,
    verifySummary,
    explainSummary,
    diffSummary,
  };
}

export async function writeWorkspaceAgentContext(
  context: WorkspaceAgentContext,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
    attachRunCorrelation(context)
  );
}
