import path from 'path';
import fsExtra from 'fs-extra';

import {
  buildOperationalSkillsCatalogSection,
  buildWorkspaceOperationalSkills,
  hydrateOperationalPrompts,
  writeWorkspaceOperationalSkills,
} from './workspace-operational-skills.js';
import {
  AGENT_GROUNDING_DOC_PATH,
  LEGACY_AGENT_GROUNDING_DOC_PATH,
  LEGACY_COPILOT_DIAGNOSE_PROMPT_PATH,
  LEGACY_COPILOT_EVIDENCE_INSTRUCTIONS_PATH,
  LEGACY_COPILOT_GROUNDING_SKILL_PATH,
  LEGACY_COPILOT_ADOPT_PROJECT_PROMPT_PATH,
  LEGACY_COPILOT_PROJECT_ONBOARD_PROMPT_PATH,
  LEGACY_COPILOT_RELEASE_READINESS_PROMPT_PATH,
  LEGACY_COPILOT_REPAIR_PROMPT_PATH,
  LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  LEGACY_CLAUDE_EVIDENCE_RULE_PATH,
  LEGACY_CURSOR_GROUNDING_RULE_PATH,
  LEGACY_MCP_DESIGN_REPORT_PATH,
  LEGACY_VSCODE_AGENT_HOOKS_PATH,
  WORKSPAI_CLAUDE_EVIDENCE_RULE_PATH,
  WORKSPAI_COPILOT_ADOPT_PROJECT_PROMPT_PATH,
  WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH,
  WORKSPAI_COPILOT_EVIDENCE_INSTRUCTIONS_PATH,
  WORKSPAI_COPILOT_GROUNDING_SKILL_PATH,
  WORKSPAI_COPILOT_PROJECT_ONBOARD_PROMPT_PATH,
  WORKSPAI_COPILOT_RELEASE_READINESS_PROMPT_PATH,
  WORKSPAI_COPILOT_REPAIR_PROMPT_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  WORKSPAI_CURSOR_GROUNDING_RULE_PATH,
  WORKSPAI_MCP_DESIGN_REPORT_PATH,
  WORKSPAI_SKILLS_DIR,
  WORKSPAI_VSCODE_AGENT_HOOKS_PATH,
  WORKSPACE_SKILLS_INDEX_PATH,
} from './contracts/workspace-artifact-paths.js';
import { buildAgentCustomizationPackContract } from './contracts/agent-customization-pack-contract.js';
import { buildWorkspaceIntelligenceChainContract } from './contracts/workspace-intelligence-chain-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import {
  assertWorkspaceArtifactContract,
  workspaceArtifactContractFor,
} from './contracts/artifact-contract-registry.js';
import {
  createLifecycleTransaction,
  recoverActiveLifecycleTransactions,
} from './utils/lifecycle-transaction.js';
import { readWorkspaceContract } from './utils/workspace-contract.js';
import { firstExistingWorkspaceArtifactPath } from './utils/artifact-path-compat.js';
import {
  buildWorkspaceModel,
  WORKSPACE_MODEL_REPORT_PATH,
  type WorkspaceModel,
} from './workspace-model.js';
import {
  buildWorkspaceAgentContext,
  WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
  writeWorkspaceAgentContext,
  type WorkspaceContextAgent,
} from './workspace-context.js';
import {
  resolveWorkspaceProjectLensTargets,
  syncWorkspaceProjectLenses,
  type SyncWorkspaceProjectLensesResult,
} from './project-intelligence-lens.js';
import {
  PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
  PROJECT_GROUNDING_RELATIVE_PATH,
  PROJECT_WORKSPACE_LINK_RELATIVE_PATH,
} from './utils/workspace-paths.js';

export const AGENT_REPORTS_INDEX_SCHEMA = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.agentIndex;
export const AGENT_CUSTOMIZATION_PACK_SCHEMA =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.agentCustomizationPack;
export const AGENT_REPORTS_INDEX_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex;
export const AGENT_CUSTOMIZATION_PACK_REPORT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.agentCustomizationPack;
export {
  AGENT_GROUNDING_DOC_PATH,
  LEGACY_AGENT_GROUNDING_DOC_PATH,
  LEGACY_COPILOT_GROUNDING_SKILL_PATH,
  LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  LEGACY_CURSOR_GROUNDING_RULE_PATH,
  LEGACY_MCP_DESIGN_REPORT_PATH,
  LEGACY_VSCODE_AGENT_HOOKS_PATH,
  WORKSPAI_COPILOT_GROUNDING_SKILL_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  WORKSPAI_CURSOR_GROUNDING_RULE_PATH,
  WORKSPAI_MCP_DESIGN_REPORT_PATH,
  WORKSPAI_VSCODE_AGENT_HOOKS_PATH,
};

export type AgentGroundingTarget =
  'all' | 'vscode' | 'agents' | 'copilot' | 'cursor' | 'claude' | 'codex' | 'orca';

export type AgentCustomizationPackPreset = 'minimal' | 'enterprise';

export type AgentCustomizationOutputKind =
  | 'report'
  | 'grounding'
  | 'instruction'
  | 'prompt'
  | 'skill'
  | 'skill-resource'
  | 'operational-skill'
  | 'skills-index'
  | 'explain-report'
  | 'agent'
  | 'rule'
  | 'hook'
  | 'mcp-design';

export type AgentCustomizationOutputStatus = 'written' | 'planned' | 'skipped';

export type AgentCustomizationPackOutput = {
  path: string;
  kind: AgentCustomizationOutputKind;
  targets: AgentGroundingTarget[];
  required: boolean;
  status: AgentCustomizationOutputStatus;
};

export type AgentCustomizationPackReport = {
  schemaVersion: typeof AGENT_CUSTOMIZATION_PACK_SCHEMA;
  generatedAt: string;
  workspaceRoot: string;
  preset: AgentCustomizationPackPreset;
  targets: AgentGroundingTarget[];
  sourceReports: string[];
  intelligenceChain: {
    schemaVersion: string;
    contractPath: string;
    currentStep: 'agent-sync';
  };
  outputInventory: AgentCustomizationPackOutput[];
  capabilityMatrix: Record<
    AgentGroundingTarget,
    {
      enabled: boolean;
      outputs: string[];
    }
  >;
  drift: {
    missingRequired: string[];
    staleReports: string[];
    strictViolations: string[];
  };
  answerContract: string[];
  refreshCommand: string;
  experimental: {
    hooksEnabled: boolean;
    mcpReady: boolean;
  };
};

export type AgentReportCatalogEntry = {
  relativePath: string;
  label: string;
  required: boolean;
};

export const AGENT_REPORT_CATALOG: AgentReportCatalogEntry[] = [
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex,
    label: 'Active Goal Pack index',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalPackLastRun,
    label: 'Latest governed Goal Pack',
    required: false,
  },
  {
    relativePath: WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
    label: 'Agent context pack',
    required: true,
  },
  {
    relativePath: WORKSPACE_SKILLS_INDEX_PATH,
    label: 'Operational skills index',
    required: true,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
    label: 'Workspace model',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
    label: 'Workspace knowledge graph',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun,
    label: 'Workspace Intelligence evaluation',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor,
    label: 'Workspace doctor',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.doctorProject,
    label: 'Project doctor',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.doctorRemediationPlan,
    label: 'Doctor remediation plan',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.artifactRemediationPlan,
    label: 'Artifact remediation plan',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.doctorFixResult,
    label: 'Doctor fix result',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
    label: 'Workspace analyze',
    required: false,
  },
  {
    relativePath: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.pipelineLastRun,
    label: 'Governance pipeline',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness,
    label: 'Release readiness',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.impact,
    label: 'Workspace impact',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.verify,
    label: 'Workspace verify',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot,
    label: 'Workspace model snapshot',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.diff,
    label: 'Workspace model diff',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.explain,
    label: 'Workspace explain',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify,
    label: 'Workspace contract verify',
    required: false,
  },
  {
    relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.history,
    label: 'Workspace intelligence history',
    required: false,
  },
];

export function buildCanonicalAgentReportReadOrder(): string[] {
  const catalogPaths = AGENT_REPORT_CATALOG.map((entry) => entry.relativePath);
  const contracted = buildWorkspaceIntelligenceChainContract().consumers.agents.canonicalReadOrder;
  const prioritized = contracted.filter(
    (reportPath) => reportPath !== AGENT_REPORTS_INDEX_PATH && catalogPaths.includes(reportPath)
  );
  return [
    ...new Set([
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex,
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalPackLastRun,
      ...prioritized,
      ...catalogPaths,
    ]),
  ];
}

export type AgentReportIndexEntry = {
  path: string;
  label: string;
  required: boolean;
  exists: boolean;
  validity: 'valid' | 'invalid' | 'uncontracted' | 'missing';
  validationError?: string;
  generatedAt?: string;
  commandId?: string;
  exitCode?: number;
};

export type WorkspaceAgentReportsIndex = {
  schemaVersion: typeof AGENT_REPORTS_INDEX_SCHEMA;
  generatedAt: string;
  workspaceRoot: string;
  intelligenceChain: {
    schemaVersion: string;
    contractPath: string;
    currentStep: 'agent-sync';
  };
  readOrder: string[];
  blockers: string[];
  staleAfterHours: number;
  reports: AgentReportIndexEntry[];
  refreshCommand: string;
};

export type AgentGroundingSyncResult = {
  workspacePath: string;
  indexPath: string;
  packPath?: string;
  pack?: AgentCustomizationPackReport;
  contextPath?: string;
  writtenFiles: string[];
  skippedFiles: string[];
  blockers: string[];
  missingRequired: string[];
  staleReports: string[];
  strictViolations: string[];
  projectLenses?: SyncWorkspaceProjectLensesResult;
};

export type SyncWorkspaceAgentGroundingOptions = {
  workspacePath: string;
  /** Reuse the canonical model already built by the owning lifecycle transaction. */
  model?: WorkspaceModel;
  scope?: string;
  agent?: WorkspaceContextAgent | string | boolean;
  targets?: AgentGroundingTarget[];
  preset?: AgentCustomizationPackPreset;
  write?: boolean;
  dryRun?: boolean;
  strict?: boolean;
  staleAfterHours?: number;
  /** Injectable clock for deterministic freshness evaluation and transactional previews. */
  now?: Date;
  refreshContext?: boolean;
  experimentalHooks?: boolean;
  /** Hydrate matching Workspai prompts, while keeping legacy rapidkit prompt mirrors available. */
  hydratePrompts?: boolean;
  /** Project-level portable grounding policy. */
  projectGrounding?: 'managed' | 'local' | 'off';
};

function displayRapidkitCommand(args: string): string {
  return `npx workspai ${args}`.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function collectStringBlockers(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit);
}

function extractBlockersFromReport(raw: Record<string, unknown>): string[] {
  const direct = collectStringBlockers(raw.blockers, 12);
  if (direct.length > 0) {
    return direct;
  }
  const blockingReasons = collectStringBlockers(raw.blockingReasons, 12);
  if (blockingReasons.length > 0) {
    return blockingReasons;
  }
  const summary = asRecord(raw.summary);
  if (summary && Array.isArray(summary.blockingReasons)) {
    return collectStringBlockers(summary.blockingReasons, 12);
  }
  return [];
}

function coalesceAgentBlockers(values: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.filter((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    return !unique.some((other) => {
      if (other === candidate || !other.includes(':')) return false;
      const normalizedOther = other.toLowerCase();
      return (
        normalizedOther.length > normalizedCandidate.length &&
        normalizedOther.endsWith(normalizedCandidate)
      );
    });
  });
}

function reportGeneratedAt(raw: Record<string, unknown>): string | undefined {
  for (const key of ['generatedAt', 'updatedAt', 'timestamp'] as const) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  // History is an append-only evidence ledger. By contract its freshness is
  // carried by the newest entry, not by a mutable top-level timestamp.
  if (Array.isArray(raw.entries)) {
    const timestamps = raw.entries
      .map((entry) => asRecord(entry)?.generatedAt)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
      .filter((value) => Number.isFinite(Date.parse(value)));
    if (timestamps.length > 0) {
      return timestamps.reduce((latest, candidate) =>
        Date.parse(candidate) > Date.parse(latest) ? candidate : latest
      );
    }
  }

  return undefined;
}

function isStale(generatedAt: string | undefined, staleAfterHours: number, now: Date): boolean {
  if (!generatedAt) {
    return true;
  }
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return now.getTime() - parsed > staleAfterHours * 60 * 60 * 1000;
}

function isAgentReportStale(
  report: Pick<AgentReportIndexEntry, 'path' | 'generatedAt'>,
  staleAfterHours: number,
  now: Date
): boolean {
  // The model snapshot is an accepted structural baseline, not renewable
  // current-state evidence. Its age preserves the Diff boundary by contract;
  // treating it as TTL-stale would force baseline replacement and erase the
  // very changes Workspace Intelligence is expected to detect.
  if (report.path === WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot) {
    return false;
  }
  return isStale(report.generatedAt, staleAfterHours, now);
}

function normalizeTargets(targets: AgentGroundingTarget[] | undefined): Set<AgentGroundingTarget> {
  const input = targets && targets.length > 0 ? targets : (['all'] as AgentGroundingTarget[]);
  if (input.includes('all')) {
    return new Set<AgentGroundingTarget>([
      'all',
      'vscode',
      'agents',
      'copilot',
      'cursor',
      'claude',
      'codex',
      'orca',
    ]);
  }
  return new Set(input);
}

function targetEnabled(selected: Set<AgentGroundingTarget>, target: AgentGroundingTarget): boolean {
  return selected.has('all') || selected.has(target);
}

function targetEnabledForCopilot(selected: Set<AgentGroundingTarget>): boolean {
  return targetEnabled(selected, 'copilot') || targetEnabled(selected, 'vscode');
}

function normalizePreset(
  preset: AgentCustomizationPackPreset | undefined
): AgentCustomizationPackPreset {
  return preset ?? 'enterprise';
}

function inferOutputKind(relativePath: string): AgentCustomizationOutputKind {
  if (relativePath === WORKSPACE_SKILLS_INDEX_PATH) {
    return 'skills-index';
  }
  if (relativePath.includes('workspace-explain-last-run.json')) {
    return 'explain-report';
  }
  if (
    (relativePath.startsWith(`${WORKSPAI_SKILLS_DIR}/`) ||
      relativePath.startsWith('.rapidkit/skills/')) &&
    relativePath.endsWith('.md')
  ) {
    return 'operational-skill';
  }
  if (
    relativePath.includes('hooks') ||
    relativePath === WORKSPAI_VSCODE_AGENT_HOOKS_PATH ||
    relativePath === LEGACY_VSCODE_AGENT_HOOKS_PATH
  ) {
    return 'hook';
  }
  if (
    relativePath.includes('mcp') ||
    relativePath === WORKSPAI_MCP_DESIGN_REPORT_PATH ||
    relativePath === LEGACY_MCP_DESIGN_REPORT_PATH
  ) {
    return 'mcp-design';
  }
  if (relativePath.endsWith('.json')) {
    return 'report';
  }
  if (relativePath.includes('/instructions/') || relativePath.endsWith('copilot-instructions.md')) {
    return 'instruction';
  }
  if (relativePath.includes('/prompts/')) {
    return 'prompt';
  }
  if (relativePath.includes('/skills/') && relativePath.endsWith('/SKILL.md')) {
    return 'skill';
  }
  if (relativePath.includes('/skills/')) {
    return 'skill-resource';
  }
  if (relativePath.includes('/agents/')) {
    return 'agent';
  }
  if (relativePath.includes('/rules/') || relativePath.endsWith('.mdc')) {
    return 'rule';
  }
  return 'grounding';
}

function inferOutputTargets(relativePath: string): AgentGroundingTarget[] {
  if (relativePath.startsWith('.github/')) {
    return ['vscode', 'copilot'];
  }
  if (relativePath.startsWith('.cursor/')) {
    return ['cursor'];
  }
  if (relativePath.startsWith('.claude/') || relativePath === 'CLAUDE.md') {
    return ['claude'];
  }
  if (relativePath === 'AGENTS.md' || relativePath.startsWith('.rapidkit/')) {
    return ['agents', 'codex', 'orca', 'vscode'];
  }
  if (relativePath.startsWith('.vscode/')) {
    return ['vscode'];
  }
  return ['agents'];
}

function isRequiredPackOutput(relativePath: string, preset: AgentCustomizationPackPreset): boolean {
  const contract = buildAgentCustomizationPackContract();
  return contract.presets[preset].requiredOutputs.includes(relativePath);
}

async function resolveModelForAgentSync(
  workspacePath: string,
  prefetched?: WorkspaceModel
): Promise<WorkspaceModel> {
  if (prefetched) {
    return prefetched;
  }
  const reportPath =
    (await firstExistingWorkspaceArtifactPath(workspacePath, WORKSPACE_MODEL_REPORT_PATH)) ??
    path.join(workspacePath, WORKSPACE_MODEL_REPORT_PATH);
  if (await fsExtra.pathExists(reportPath)) {
    try {
      const raw = (await fsExtra.readJson(reportPath)) as Record<string, unknown>;
      assertWorkspaceArtifactContract(WORKSPACE_MODEL_REPORT_PATH, raw, reportPath);
      return raw as WorkspaceModel;
    } catch {
      // fall through to live build
    }
  }
  return buildWorkspaceModel({
    workspacePath,
    includeEvidence: true,
  });
}

function isSafeWorkspaceRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !path.isAbsolute(relativePath) &&
    !relativePath.split(/[\\/]+/).includes('..')
  );
}

function buildCapabilityMatrix(input: {
  targets: AgentGroundingTarget[];
  outputs: AgentCustomizationPackOutput[];
}): AgentCustomizationPackReport['capabilityMatrix'] {
  const knownTargets: AgentGroundingTarget[] = [
    'all',
    'vscode',
    'agents',
    'copilot',
    'cursor',
    'claude',
    'codex',
    'orca',
  ];
  return Object.fromEntries(
    knownTargets.map((target) => [
      target,
      {
        enabled: input.targets.includes('all') || input.targets.includes(target),
        outputs: input.outputs
          .filter((output) => output.targets.includes(target))
          .map((output) => output.path)
          .sort(),
      },
    ])
  ) as AgentCustomizationPackReport['capabilityMatrix'];
}

async function readJsonIfExists(
  absolutePath: string,
  relativePath: string
): Promise<{
  payload: Record<string, unknown> | null;
  exists: boolean;
  validity: AgentReportIndexEntry['validity'];
  validationError?: string;
}> {
  try {
    if (!(await fsExtra.pathExists(absolutePath))) {
      return { payload: null, exists: false, validity: 'missing' };
    }
    const raw = await fsExtra.readJson(absolutePath);
    const payload = asRecord(raw);
    if (!payload) {
      return {
        payload: null,
        exists: true,
        validity: 'invalid',
        validationError: 'Artifact root must be a JSON object',
      };
    }
    if (!workspaceArtifactContractFor(relativePath)) {
      return { payload, exists: true, validity: 'uncontracted' };
    }
    assertWorkspaceArtifactContract(relativePath, payload, absolutePath);
    return { payload, exists: true, validity: 'valid' };
  } catch (error) {
    return {
      payload: null,
      exists: true,
      validity: 'invalid',
      validationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildWorkspaceAgentReportsIndex(input: {
  workspacePath: string;
  staleAfterHours?: number;
  now?: Date;
}): Promise<WorkspaceAgentReportsIndex> {
  const now = input.now ?? new Date();
  const staleAfterHours = input.staleAfterHours ?? 24;
  const reports: AgentReportIndexEntry[] = [];
  const blockers: string[] = [];

  for (const entry of AGENT_REPORT_CATALOG) {
    const absolutePath =
      (await firstExistingWorkspaceArtifactPath(input.workspacePath, entry.relativePath)) ??
      path.join(input.workspacePath, entry.relativePath);
    const read = await readJsonIfExists(absolutePath, entry.relativePath);
    const raw = read.payload;
    if (read.validity === 'invalid') {
      blockers.push(`Invalid evidence contract: ${entry.relativePath}`);
    } else if (raw) {
      blockers.push(...extractBlockersFromReport(raw));
    }
    reports.push({
      path: entry.relativePath,
      label: entry.label,
      required: entry.required,
      exists: read.exists,
      validity: read.validity,
      validationError: read.validationError,
      generatedAt: raw ? reportGeneratedAt(raw) : undefined,
      commandId: typeof raw?.commandId === 'string' ? raw.commandId : undefined,
      exitCode: typeof raw?.exitCode === 'number' ? raw.exitCode : undefined,
    });
  }

  const uniqueBlockers = coalesceAgentBlockers(blockers).slice(0, 16);
  const intelligenceChain = buildWorkspaceIntelligenceChainContract();

  return {
    schemaVersion: AGENT_REPORTS_INDEX_SCHEMA,
    generatedAt: now.toISOString(),
    workspaceRoot: input.workspacePath,
    intelligenceChain: {
      schemaVersion: intelligenceChain.schemaVersion,
      contractPath: intelligenceChain.contractPath,
      currentStep: 'agent-sync',
    },
    readOrder: buildCanonicalAgentReportReadOrder(),
    blockers: uniqueBlockers,
    staleAfterHours,
    reports,
    refreshCommand: displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
  };
}

function buildAgentsMarkdown(input: {
  index: WorkspaceAgentReportsIndex;
  context?: Awaited<ReturnType<typeof buildWorkspaceAgentContext>> | null;
}): string {
  const lines = [
    '# Workspai agent grounding',
    '',
    'Cross-tool instructions for Copilot, Cursor, Claude Code, Codex, Grok, and other agents.',
    '',
    '## Read order (mandatory before workspace diagnosis)',
    '',
    `1. \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` — latest blockers, timestamps, and report paths`,
    `2. \`${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalIndex}\` — when present, read the active Goal Pack and its handoff before choosing work.`,
    `3. \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\` — read only task-relevant context`,
    '4. Read only the task-relevant evidence artifacts listed in the index.',
    '5. Use the Goal Pack retrieval queries, `workspace graph search <query> --limit 12 --json`, or MCP `searchWorkspaceGraph` before loading the full graph.',
    '',
    'Do **not** full-repo scan or inject the complete graph when a bounded query can answer the task.',
    '',
    '## Regenerate intelligence',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    displayRapidkitCommand('workspace context --for-agent --json --write'),
    displayRapidkitCommand('pipeline --json --write'),
    '```',
    '',
  ];

  if (input.index.blockers.length > 0) {
    lines.push('## Current blockers', '');
    for (const blocker of input.index.blockers.slice(0, 12)) {
      lines.push(`- ${blocker}`);
    }
    lines.push('');
  }

  if (input.context?.safeCommands?.length) {
    lines.push('## Safe commands (prefer these)', '');
    for (const command of input.context.safeCommands.slice(0, 10)) {
      lines.push(`- \`${command.display}\` — ${command.description}`);
    }
    lines.push('');
  }

  lines.push(
    '## Rules',
    '',
    '- Treat `.workspai/reports/*` as the source of truth for health, gates, and release posture.',
    '- Prefer deterministic Workspai CLI commands over heuristic framework guesses.',
    '- If evidence is missing or stale, run the refresh commands above before proposing fixes.',
    '- Keep project-scoped advice aligned with the active project named in the context pack.',
    '- Never claim that an active goal is satisfied until its CLI-owned verification lifecycle is `verified`.',
    ''
  );

  return lines.join('\n');
}

function buildAgentGroundingDoc(index: WorkspaceAgentReportsIndex): string {
  return [
    '# Workspai agent grounding',
    '',
    `Generated: ${index.generatedAt}`,
    '',
    `This file is tool-agnostic. Synced agents should read it together with \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\`.`,
    '',
    '## Mandatory read order',
    '',
    ...index.readOrder.map((reportPath, idx) => `${idx + 1}. \`${reportPath}\``),
    '',
    index.blockers.length > 0 ? '## Blockers' : '',
    ...(index.blockers.length > 0 ? index.blockers.map((blocker) => `- ${blocker}`) : []),
    '',
    '## Refresh',
    '',
    '```bash',
    index.refreshCommand,
    '```',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function buildCopilotInstructions(): string {
  return [
    '# Workspai workspace grounding',
    '',
    'Before answering workspace, release, or architecture questions:',
    '',
    '1. Read `AGENTS.md` (managed Workspai section).',
    `2. Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` and only task-relevant context from \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\`.`,
    '3. Use bounded `workspace graph search` or MCP `searchWorkspaceGraph` before scanning the full repository.',
    '',
    'Regenerate stale intelligence:',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    '```',
    '',
  ].join('\n');
}

function buildClaudeMarkdown(): string {
  return [
    '## Claude Code',
    '',
    `- Load \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` before diagnosing blockers.`,
    '- Use `.claude/rules/workspai-evidence.md` for scoped Workspai evidence rules.',
    '- Treat `.claude/rules/rapidkit-evidence.md` as a legacy compatibility mirror.',
    '- Refresh grounding with `npx workspai workspace agent-sync --write`.',
    '',
  ].join('\n');
}

function buildCursorRule(): string {
  return [
    '---',
    'description: Workspai workspace evidence and intelligence grounding',
    'globs: []',
    'alwaysApply: true',
    '---',
    '',
    'Before proposing fixes in this workspace:',
    '',
    `1. Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agents}\` and \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\`.`,
    `2. Read only task-relevant context from \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\`.`,
    '3. Prefer bounded graph search and evidence reports over full-repo exploration.',
    '',
    'Refresh when stale:',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    '```',
    '',
  ].join('\n');
}

function buildCopilotEvidenceInstructions(): string {
  return [
    '---',
    'applyTo: ".workspai/**,**/.workspai/**,.rapidkit/**,**/.rapidkit/**"',
    'description: Workspai evidence and intelligence artifacts',
    '---',
    '',
    'When working under `.workspai/` or legacy `.rapidkit/`:',
    '',
    '- Treat `.workspai/reports/*` JSON reports as canonical gate and health evidence.',
    `- Start from \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` for read order and blockers.`,
    '- Do not invent pass/fail state — cite `exitCode`, `blockers`, and `generatedAt` fields.',
    '',
  ].join('\n');
}

function buildCopilotWorkspaceInstructions(): string {
  return [
    '---',
    'applyTo: "**"',
    'description: Workspai workspace scope, evidence, and command discipline',
    '---',
    '',
    '# Workspai Workspace Intelligence',
    '',
    'Use Workspai reports as the workspace source of truth before giving architectural, repair, release, or project lifecycle advice.',
    '',
    '## Scope rules',
    '',
    `- Start from \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\`; read only task-relevant context and evidence.`,
    '- Prefer bounded `workspace graph search` or MCP `searchWorkspaceGraph` over loading the complete graph.',
    '- Distinguish workspace-level blockers from project-level blockers.',
    '- When a project is active, cite its name, path, framework, and evidence source.',
    '- Do not translate unsupported stack requests into unrelated native kits.',
    '',
    '## Answer contract',
    '',
    'Return answers with: Scope, Evidence, Diagnosis, Fix Plan, Run, Verify, Assumptions.',
    '',
  ].join('\n');
}

function buildClaudeEvidenceRule(): string {
  return [
    '# Workspai evidence',
    '',
    'Applies when reading or editing `.workspai/reports/*`.',
    '',
    '- Start from `INDEX.json`, then `workspace-context-agent.json`.',
    '- Use report blockers as the primary fix target.',
    '- Regenerate with `npx workspai workspace agent-sync --write`.',
    '',
  ].join('\n');
}

function buildLegacyClaudeEvidenceRule(): string {
  return [
    '# Legacy RapidKit evidence alias',
    '',
    'Compatibility path only. Use `.claude/rules/workspai-evidence.md` as the canonical rule.',
    '',
  ].join('\n');
}

function buildLegacyCursorRule(): string {
  return [
    '---',
    'description: Legacy RapidKit metadata compatibility alias',
    'globs: [".rapidkit/**", "**/.rapidkit/**"]',
    'alwaysApply: false',
    '---',
    '',
    'Use `.cursor/rules/workspai-grounding.mdc` for canonical Workspai grounding.',
    '',
  ].join('\n');
}

function buildLegacyCopilotInstructions(kind: 'workspace' | 'evidence'): string {
  return [
    '---',
    'applyTo: ".rapidkit/**,**/.rapidkit/**"',
    'description: Legacy RapidKit metadata compatibility alias',
    '---',
    '',
    `Use \`.github/instructions/workspai-${kind}.instructions.md\` as the canonical Workspai instruction.`,
    '',
  ].join('\n');
}

function buildCopilotDiagnosePrompt(): string {
  return [
    '---',
    'description: Diagnose Workspai workspace blockers from evidence reports',
    '---',
    '',
    'Diagnose this workspace using Workspai evidence only.',
    '',
    'Read:',
    '',
    `- \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\``,
    `- \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\``,
    '- Any fail/warn reports referenced in the index',
    '',
    'Return:',
    '',
    '1. Root cause grounded in report blockers',
    '2. Smallest safe fix path (commands + file edits)',
    '3. One verification command to prove recovery',
    '',
  ].join('\n');
}

function buildWorkflowPrompt(input: {
  description: string;
  objective: string;
  expectedOutput: string[];
}): string {
  return [
    '---',
    `description: ${input.description}`,
    '---',
    '',
    input.objective,
    '',
    'Read first:',
    '',
    `- \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\``,
    `- \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\``,
    '- Any report referenced by the current blocker or task',
    '',
    'Return:',
    '',
    ...input.expectedOutput.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Use the standard Workspai answer contract: Scope, Evidence, Diagnosis, Fix Plan, Run, Verify, Assumptions.',
    '',
  ].join('\n');
}

function buildSkillResource(input: { title: string; lines: string[] }): string {
  return ['# ' + input.title, '', ...input.lines, ''].join('\n');
}

function buildMcpToolsResource(): string {
  return buildSkillResource({
    title: 'MCP Tool Design',
    lines: [
      'Workspai MCP is a read-mostly bridge over contract-validated workspace artifacts.',
      '',
      'Candidate read tools:',
      `- \`getWorkspaceModel\` — read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}\`.`,
      `- \`getWorkspaceKnowledgeGraph\` — read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}\`.`,
      `- \`getWorkspaceEvaluation\` — read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun}\` (or the live evaluation when requested).`,
      '- `queryWorkspaceEntities` — filter proof-backed graph entities by kind.',
      '- `searchWorkspaceGraph` — retrieve bounded proof-backed context by text query.',
      '- `getWorkspaceGraphEvidence` — resolve evidence for an entity or relation.',
      '- `findWorkspaceGraphPath` — find a shortest proof-carrying relationship path.',
      `- \`getEvidenceIndex\` — read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\`.`,
      '- `getBlockers` — derive current blockers from INDEX and gate reports.',
      '- `getSafeCommands` — read safe commands from `workspace-context-agent.json`.',
      '- `getProjectContext` — return one project-scoped slice of the workspace model.',
      '- `getArtifact` — read one explicit artifact path inside the workspace root.',
      `- \`listOperationalSkills\` — read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.skillsIndex}\`.`,
      '- `getWorkspaceExplain` — read/build workspace explain for release-blocked or project scope.',
      '- `refreshWorkspaceIntelligence` — explicit user-approved refresh command only.',
      '',
      'Write or repair tools require explicit approval boundaries and are intentionally not part of the first read-mostly design.',
    ],
  });
}

function buildMcpDesignManifest(input: { workspacePath: string; generatedAt: string }): string {
  return `${JSON.stringify(
    {
      schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaiMcpDesign.schemaVersion,
      generatedAt: input.generatedAt,
      workspaceRoot: input.workspacePath,
      status: 'design-only',
      mode: 'read-mostly',
      safety: {
        writeToolsEnabled: false,
        approvalRequiredForRefresh: true,
        artifactReadsMustStayInsideWorkspace: true,
      },
      candidateTools: [
        {
          name: 'getWorkspaceModel',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.model],
          mutates: false,
        },
        {
          name: 'getWorkspaceKnowledgeGraph',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph],
          mutates: false,
        },
        {
          name: 'getWorkspaceEvaluation',
          reads: [
            WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLive,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun,
          ],
          mutates: false,
        },
        {
          name: 'queryWorkspaceEntities',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph],
          mutates: false,
        },
        {
          name: 'searchWorkspaceGraph',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph],
          mutates: false,
        },
        {
          name: 'getWorkspaceGraphEvidence',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph],
          mutates: false,
        },
        {
          name: 'findWorkspaceGraphPath',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph],
          mutates: false,
        },
        {
          name: 'getEvidenceIndex',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex],
          mutates: false,
        },
        {
          name: 'getBlockers',
          reads: [
            WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.verify,
            WORKSPACE_SUPPLEMENTAL_ARTIFACTS.pipelineLastRun,
          ],
          mutates: false,
        },
        {
          name: 'getSafeCommands',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext],
          mutates: false,
        },
        {
          name: 'getProjectContext',
          reads: [
            WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
          ],
          mutates: false,
        },
        {
          name: 'getArtifact',
          reads: ['requested workspace-relative artifact path'],
          mutates: false,
        },
        {
          name: 'listOperationalSkills',
          reads: [WORKSPACE_INTELLIGENCE_ARTIFACTS.skillsIndex],
          mutates: false,
        },
        {
          name: 'getWorkspaceExplain',
          reads: [
            WORKSPACE_INTELLIGENCE_ARTIFACTS.explain,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.verify,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.impact,
          ],
          mutates: false,
        },
        {
          name: 'refreshWorkspaceIntelligence',
          command: displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
          mutates: true,
          approvalRequired: true,
        },
      ],
    },
    null,
    2
  )}\n`;
}

function buildExperimentalHooksConfig(input: {
  workspacePath: string;
  generatedAt: string;
}): string {
  return `${JSON.stringify(
    {
      schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.agentHooks.schemaVersion,
      generatedAt: input.generatedAt,
      workspaceRoot: input.workspacePath,
      enabledByDefault: false,
      mode: 'advisory',
      hooks: [
        {
          name: 'workspai-pre-tool-use-workspace-boundary',
          event: 'PreToolUse',
          purpose: 'Block or warn on state-changing commands outside the active workspace root.',
          defaultAction: 'warn',
          rules: [
            'Allow read-only commands.',
            'Warn before write/delete commands outside workspaceRoot.',
            'Never run destructive commands without explicit user approval.',
          ],
        },
        {
          name: 'workspai-post-tool-use-verify-suggestion',
          event: 'PostToolUse',
          purpose: 'Suggest non-destructive verification commands after edits.',
          defaultAction: 'suggest',
          commands: [
            displayRapidkitCommand('doctor workspace'),
            displayRapidkitCommand('workspace verify --strict --json'),
          ],
        },
        {
          name: 'workspai-user-prompt-submit-scope-hint',
          event: 'UserPromptSubmit',
          purpose: 'Inject lightweight workspace scope and evidence index hints.',
          defaultAction: 'inject-context-hint',
          reads: [
            WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex,
            WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
          ],
        },
      ],
    },
    null,
    2
  )}\n`;
}

function buildWorkspaceIntelligenceSkill(catalogSection?: string): string {
  const lines = [
    '---',
    'name: workspai-workspace-intelligence',
    'description: Use Workspai workspace intelligence reports to answer, repair, verify, and release with evidence',
    '---',
    '',
    '# Workspai Workspace Intelligence',
    '',
    'Use this skill for workspace architecture, project lifecycle, blocker repair, release readiness, agent grounding, and CI evidence questions.',
    '',
    '## Decision flow',
    '',
    '1. Load `resources/scope-model.md`.',
    `2. Load \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\`.`,
    `3. Load \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\`.`,
    `4. Load \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.skillsIndex}\` when operational playbooks are needed.`,
    '5. Load the smallest evidence report required for the task.',
    '6. Answer with Scope, Evidence, Diagnosis, Fix Plan, Run, Verify, Assumptions.',
    '',
    '## Rules',
    '',
    '- Prefer Workspai reports over full-repo scans.',
    '- Never claim a gate passed without a cited report.',
    '- Separate display commands from execution requests.',
    '- Keep project-scoped fixes inside the active project unless workspace evidence says otherwise.',
    '',
  ];
  if (catalogSection?.trim()) {
    lines.push(catalogSection.trim(), '');
  }
  return lines.join('\n');
}

function buildWorkspaiAgent(input: {
  name: string;
  description: string;
  mode: 'read-only' | 'repair' | 'release' | 'onboard';
  tools: string[];
}): string {
  return [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    `tools: [${input.tools.map((tool) => `'${tool}'`).join(', ')}]`,
    '---',
    '',
    `You are the ${input.name} agent for Workspai Workspace Intelligence.`,
    '',
    `Mode: ${input.mode}.`,
    '',
    `Start every task by reading \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\` and \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\`.`,
    '',
    'Use this answer contract:',
    '',
    '- Scope',
    '- Evidence',
    '- Diagnosis',
    '- Fix Plan',
    '- Run',
    '- Verify',
    '- Assumptions',
    '',
    'Do not invent health, readiness, or policy status. Cite report paths and command outputs.',
    '',
  ].join('\n');
}

function buildCopilotSkill(): string {
  return [
    '---',
    'name: workspai-grounding',
    'description: Load Workspai workspace intelligence reports before diagnosing or changing code',
    '---',
    '',
    '# Workspai grounding',
    '',
    'Use when the user asks about workspace health, release gates, doctor/pipeline failures, or project structure.',
    '',
    '## Workflow',
    '',
    `1. Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentIndex}\``,
    `2. Read \`${WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext}\``,
    '3. Read fail/warn evidence artifacts listed in the index',
    '4. Propose the smallest safe fix with explicit verification commands',
    '',
    '## Refresh stale evidence',
    '',
    '```bash',
    displayRapidkitCommand('workspace agent-sync --write --refresh-context'),
    '```',
    '',
  ].join('\n');
}

async function writeTextFile(
  absolutePath: string,
  content: string,
  write: boolean
): Promise<'written' | 'skipped'> {
  if (!write) {
    return 'skipped';
  }
  await fsExtra.ensureDir(path.dirname(absolutePath));
  await fsExtra.writeFile(absolutePath, content, 'utf8');
  return 'written';
}

async function writeManagedMarkdownFile(input: {
  absolutePath: string;
  generatedBody: string;
  preamble?: string;
  write: boolean;
}): Promise<'written' | 'skipped'> {
  if (!input.write) {
    return 'skipped';
  }
  const existing = (await fsExtra.pathExists(input.absolutePath))
    ? await fsExtra.readFile(input.absolutePath, 'utf8')
    : null;
  const { upsertManagedAgentSection } = await import('./utils/managed-agent-markers.js');
  const managed = upsertManagedAgentSection(existing, input.generatedBody);
  const content = input.preamble ? `${input.preamble.trimEnd()}\n\n${managed}` : managed;
  await fsExtra.ensureDir(path.dirname(input.absolutePath));
  await fsExtra.writeFile(input.absolutePath, content, 'utf8');
  return 'written';
}

export function parseAgentGroundingTargets(input?: string): AgentGroundingTarget[] | undefined {
  if (!input?.trim()) {
    return undefined;
  }
  const allowed = new Set<AgentGroundingTarget>([
    'all',
    'vscode',
    'agents',
    'copilot',
    'cursor',
    'claude',
    'codex',
    'orca',
  ]);
  const parsed = input
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is AgentGroundingTarget => allowed.has(part as AgentGroundingTarget));
  return parsed.length > 0 ? parsed : undefined;
}

function buildAgentCustomizationPackReport(input: {
  workspacePath: string;
  generatedAt: string;
  preset: AgentCustomizationPackPreset;
  targets: AgentGroundingTarget[];
  index: WorkspaceAgentReportsIndex;
  outputs: AgentCustomizationPackOutput[];
  missingRequired: string[];
  staleReports: string[];
  strictViolations: string[];
  experimentalHooks: boolean;
}): AgentCustomizationPackReport {
  const outputInventory = [...input.outputs].sort((a, b) => a.path.localeCompare(b.path));
  const intelligenceChain = buildWorkspaceIntelligenceChainContract();
  return {
    schemaVersion: AGENT_CUSTOMIZATION_PACK_SCHEMA,
    generatedAt: input.generatedAt,
    workspaceRoot: input.workspacePath,
    preset: input.preset,
    targets: [...input.targets].sort(),
    sourceReports: input.index.reports
      .filter((report) => report.exists)
      .map((report) => report.path)
      .sort(),
    intelligenceChain: {
      schemaVersion: intelligenceChain.schemaVersion,
      contractPath: intelligenceChain.contractPath,
      currentStep: 'agent-sync',
    },
    outputInventory,
    capabilityMatrix: buildCapabilityMatrix({ targets: input.targets, outputs: outputInventory }),
    drift: {
      missingRequired: input.missingRequired,
      staleReports: input.staleReports,
      strictViolations: input.strictViolations,
    },
    answerContract: ['Scope', 'Evidence', 'Diagnosis', 'Fix Plan', 'Run', 'Verify', 'Assumptions'],
    refreshCommand: displayRapidkitCommand(
      `workspace agent-sync --write --refresh-context --preset ${input.preset}`
    ),
    experimental: {
      hooksEnabled: input.experimentalHooks,
      mcpReady: outputInventory.some((output) => output.kind === 'mcp-design'),
    },
  };
}

async function syncWorkspaceAgentGroundingUnsafe(
  options: SyncWorkspaceAgentGroundingOptions
): Promise<AgentGroundingSyncResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const now = options.now ?? new Date();
  const staleAfterHours = options.staleAfterHours ?? 24;
  const selectedTargets = normalizeTargets(options.targets);
  const selectedTargetList = [...selectedTargets].sort();
  const preset = normalizePreset(options.preset);
  const write = options.write === true;
  const strict = options.strict === true;

  let contextPath: string | undefined;
  let context: Awaited<ReturnType<typeof buildWorkspaceAgentContext>> | null = null;
  let sharedModel: WorkspaceModel | undefined = options.model;

  if (options.refreshContext) {
    sharedModel ??= await buildWorkspaceModel({
      workspacePath,
      includeEvidence: true,
    });
    context = await buildWorkspaceAgentContext({
      workspacePath,
      model: sharedModel,
      agent: options.agent ?? 'generic',
      scope: options.scope,
      includeEvidence: true,
    });
    if (write) {
      contextPath = await writeWorkspaceAgentContext(context, workspacePath);
    }
  }

  const strictViolations: string[] = [];

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const outputs: AgentCustomizationPackOutput[] = [];

  const record = (result: 'written' | 'skipped', relativePath: string) => {
    if (result === 'written') {
      writtenFiles.push(relativePath);
    } else {
      skippedFiles.push(relativePath);
    }
    outputs.push({
      path: relativePath,
      kind: inferOutputKind(relativePath),
      targets: inferOutputTargets(relativePath),
      required: isRequiredPackOutput(relativePath, preset),
      status: result === 'written' ? 'written' : options.dryRun ? 'planned' : 'skipped',
    });
  };

  let operationalSkillsCatalogSection = '';
  const model = await resolveModelForAgentSync(workspacePath, sharedModel);
  let contract: Awaited<ReturnType<typeof readWorkspaceContract>>['contract'] | null = null;
  try {
    contract = (await readWorkspaceContract({ workspacePath })).contract;
  } catch {
    contract = null;
  }
  const operationalSkills = buildWorkspaceOperationalSkills({
    workspacePath,
    model,
    context,
    contract,
    generatedAt: now,
  });
  const skillsWrite = await writeWorkspaceOperationalSkills({
    workspacePath,
    skills: operationalSkills,
    generatedAt: now.toISOString(),
    write,
  });
  for (const skill of skillsWrite.skills) {
    record(write ? 'written' : 'skipped', skill.canonicalPath);
  }
  record(write ? 'written' : 'skipped', WORKSPACE_SKILLS_INDEX_PATH);
  operationalSkillsCatalogSection = buildOperationalSkillsCatalogSection(skillsWrite.index);

  // Build the consumer index only after every required intelligence artifact
  // owned by this command has been materialized. Building INDEX.json before
  // workspace-skills-index.json made a successful agent-sync publish a stale
  // `exists:false` entry for a file written milliseconds later.
  const index = await buildWorkspaceAgentReportsIndex({
    workspacePath,
    staleAfterHours,
    now,
  });

  record(
    await writeTextFile(
      path.join(workspacePath, AGENT_REPORTS_INDEX_PATH),
      `${JSON.stringify(index, null, 2)}\n`,
      write
    ),
    AGENT_REPORTS_INDEX_PATH
  );

  record(
    await writeTextFile(
      path.join(workspacePath, AGENT_GROUNDING_DOC_PATH),
      `${buildAgentGroundingDoc(index)}\n`,
      write
    ),
    AGENT_GROUNDING_DOC_PATH
  );

  if (targetEnabled(selectedTargets, 'agents') || targetEnabled(selectedTargets, 'vscode')) {
    record(
      await writeManagedMarkdownFile({
        absolutePath: path.join(workspacePath, 'AGENTS.md'),
        generatedBody: buildAgentsMarkdown({ index, context }),
        write,
      }),
      'AGENTS.md'
    );
  }

  if (targetEnabled(selectedTargets, 'claude')) {
    const claudePath = path.join(workspacePath, 'CLAUDE.md');
    if (write) {
      const { upsertManagedAgentSection } = await import('./utils/managed-agent-markers.js');
      const existing = (await fsExtra.pathExists(claudePath))
        ? await fsExtra.readFile(claudePath, 'utf8')
        : '';
      const withManaged = upsertManagedAgentSection(existing, buildClaudeMarkdown());
      const content = withManaged.includes('@AGENTS.md')
        ? withManaged
        : `@AGENTS.md\n\n${withManaged}`;
      await fsExtra.ensureDir(path.dirname(claudePath));
      await fsExtra.writeFile(claudePath, content, 'utf8');
      writtenFiles.push('CLAUDE.md');
    } else {
      skippedFiles.push('CLAUDE.md');
    }
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_CLAUDE_EVIDENCE_RULE_PATH),
        `${buildClaudeEvidenceRule()}\n`,
        write
      ),
      WORKSPAI_CLAUDE_EVIDENCE_RULE_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_CLAUDE_EVIDENCE_RULE_PATH),
        `${buildLegacyClaudeEvidenceRule()}\n`,
        write
      ),
      LEGACY_CLAUDE_EVIDENCE_RULE_PATH
    );
  }

  if (targetEnabled(selectedTargets, 'cursor')) {
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_CURSOR_GROUNDING_RULE_PATH),
        buildCursorRule(),
        write
      ),
      WORKSPAI_CURSOR_GROUNDING_RULE_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_CURSOR_GROUNDING_RULE_PATH),
        buildLegacyCursorRule(),
        write
      ),
      LEGACY_CURSOR_GROUNDING_RULE_PATH
    );
  }

  if (targetEnabledForCopilot(selectedTargets)) {
    record(
      await writeManagedMarkdownFile({
        absolutePath: path.join(workspacePath, '.github/copilot-instructions.md'),
        generatedBody: buildCopilotInstructions(),
        write,
      }),
      '.github/copilot-instructions.md'
    );
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH),
        buildCopilotWorkspaceInstructions(),
        write
      ),
      WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH),
        buildLegacyCopilotInstructions('workspace'),
        write
      ),
      LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_COPILOT_EVIDENCE_INSTRUCTIONS_PATH),
        buildCopilotEvidenceInstructions(),
        write
      ),
      WORKSPAI_COPILOT_EVIDENCE_INSTRUCTIONS_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_COPILOT_EVIDENCE_INSTRUCTIONS_PATH),
        buildLegacyCopilotInstructions('evidence'),
        write
      ),
      LEGACY_COPILOT_EVIDENCE_INSTRUCTIONS_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH),
        buildCopilotDiagnosePrompt(),
        write
      ),
      WORKSPAI_COPILOT_DIAGNOSE_PROMPT_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_COPILOT_DIAGNOSE_PROMPT_PATH),
        buildCopilotDiagnosePrompt(),
        write
      ),
      LEGACY_COPILOT_DIAGNOSE_PROMPT_PATH
    );
    if (preset === 'enterprise') {
      const promptDefinitions = [
        [
          WORKSPAI_COPILOT_REPAIR_PROMPT_PATH,
          buildWorkflowPrompt({
            description: 'Repair Workspai blockers with evidence and verification',
            objective: 'Plan the smallest safe repair for the current Workspai blocker.',
            expectedOutput: [
              'Blocker and affected workspace/project scope',
              'Evidence paths and exact failing signals',
              'Minimal fix plan',
              'Human-run commands',
              'Verification command and expected success signal',
            ],
          }),
        ],
        [
          WORKSPAI_COPILOT_RELEASE_READINESS_PROMPT_PATH,
          buildWorkflowPrompt({
            description: 'Assess Workspai release readiness from evidence',
            objective: 'Assess whether this workspace is release-ready using Workspai gates.',
            expectedOutput: [
              'Readiness verdict with cited reports',
              'Blocking gates',
              'Safe next command',
              'Verification checklist',
            ],
          }),
        ],
        [
          WORKSPAI_COPILOT_PROJECT_ONBOARD_PROMPT_PATH,
          buildWorkflowPrompt({
            description: 'Onboard a project into Workspai Workspace Intelligence',
            objective:
              'Guide project onboarding using workspace model and create planner capabilities.',
            expectedOutput: [
              'Target project scope',
              'Native create, official generator, or existing lane',
              'Safe commands',
              'Post-onboarding verification',
            ],
          }),
        ],
        [
          WORKSPAI_COPILOT_ADOPT_PROJECT_PROMPT_PATH,
          buildWorkflowPrompt({
            description: 'Adopt an existing project into Workspai governance',
            objective: 'Adopt an existing project without changing its runtime behavior.',
            expectedOutput: [
              'Detected stack and confidence',
              'Adoption plan',
              'Generated metadata expectations',
              'Doctor and workspace model verification',
            ],
          }),
        ],
      ] as const;

      for (const [relativePath, content] of promptDefinitions) {
        record(
          await writeTextFile(path.join(workspacePath, relativePath), content, write),
          relativePath
        );
      }
      const legacyPromptDefinitions = [
        [LEGACY_COPILOT_REPAIR_PROMPT_PATH, promptDefinitions[0][1]],
        [LEGACY_COPILOT_RELEASE_READINESS_PROMPT_PATH, promptDefinitions[1][1]],
        [LEGACY_COPILOT_PROJECT_ONBOARD_PROMPT_PATH, promptDefinitions[2][1]],
        [LEGACY_COPILOT_ADOPT_PROJECT_PROMPT_PATH, promptDefinitions[3][1]],
      ] as const;
      for (const [relativePath, content] of legacyPromptDefinitions) {
        record(
          await writeTextFile(path.join(workspacePath, relativePath), content, write),
          relativePath
        );
      }

      if (options.hydratePrompts === true) {
        for (const relativePath of await hydrateOperationalPrompts({
          workspacePath,
          skills: skillsWrite.skills,
          write,
        })) {
          record(write ? 'written' : 'skipped', relativePath);
        }
      }
    }
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_COPILOT_GROUNDING_SKILL_PATH),
        buildCopilotSkill(),
        write
      ),
      WORKSPAI_COPILOT_GROUNDING_SKILL_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_COPILOT_GROUNDING_SKILL_PATH),
        buildCopilotSkill(),
        write
      ),
      LEGACY_COPILOT_GROUNDING_SKILL_PATH
    );
    if (preset === 'enterprise') {
      record(
        await writeTextFile(
          path.join(workspacePath, WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH),
          buildWorkspaceIntelligenceSkill(operationalSkillsCatalogSection),
          write
        ),
        WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH
      );
      record(
        await writeTextFile(
          path.join(workspacePath, LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH),
          buildWorkspaceIntelligenceSkill(operationalSkillsCatalogSection),
          write
        ),
        LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH
      );
      const resources = [
        [
          'artifact-map.md',
          buildSkillResource({
            title: 'Artifact Map',
            lines: AGENT_REPORT_CATALOG.map(
              (entry) => `- \`${entry.relativePath}\` — ${entry.label}`
            ),
          }),
        ],
        [
          'command-map.md',
          buildSkillResource({
            title: 'Command Map',
            lines: [
              '- `npx workspai workspace agent-sync --write --refresh-context` — refresh agent grounding.',
              '- `npx workspai workspace model --json --write` — refresh workspace model.',
              '- `npx workspai doctor workspace` — refresh health evidence.',
              '- `npx workspai workspace verify --strict --json` — verify release gates.',
            ],
          }),
        ],
        [
          'scope-model.md',
          buildSkillResource({
            title: 'Scope Model',
            lines: [
              '- Workspace scope is the default source of truth.',
              '- Project scope is selected only when the active task targets a specific project.',
              '- Always name the workspace and project when giving repair or lifecycle advice.',
            ],
          }),
        ],
        [
          'runtime-support.md',
          buildSkillResource({
            title: 'Runtime Support',
            lines: [
              '- Native create is available only for Workspai-owned scaffold contracts.',
              '- Unsupported stacks should use the official lane when a stable ecosystem generator exists.',
              '- Existing projects should use the existing lane when native create is unavailable.',
            ],
          }),
        ],
        [
          'create-planner-capabilities.md',
          buildSkillResource({
            title: 'Create Planner Capabilities',
            lines: [
              '- Use `contracts/create-planner-capabilities.v1.json` to decide native, official, or existing.',
              '- Do not map PHP, WordPress, Laravel, Rails, or Symfony requests to unrelated native kits.',
              '- Explain unsupported native create requests and guide users to adopt/import.',
            ],
          }),
        ],
        ['mcp-tools.md', buildMcpToolsResource()],
      ] as const;

      for (const [fileName, content] of resources) {
        const relativePath = `${path.dirname(WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH)}/resources/${fileName}`;
        record(
          await writeTextFile(path.join(workspacePath, relativePath), content, write),
          relativePath
        );
        const legacyRelativePath = `${path.dirname(LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH)}/resources/${fileName}`;
        record(
          await writeTextFile(path.join(workspacePath, legacyRelativePath), content, write),
          legacyRelativePath
        );
      }

      const agents = [
        [
          'workspai-advisor.agent.md',
          buildWorkspaiAgent({
            name: 'Workspai Advisor',
            description: 'Read-only workspace and project guidance using Workspai evidence',
            mode: 'read-only',
            tools: ['search', 'read'],
          }),
        ],
        [
          'workspai-repair.agent.md',
          buildWorkspaiAgent({
            name: 'Workspai Repair',
            description: 'Turn Workspai blockers into minimal fixes and verification steps',
            mode: 'repair',
            tools: ['search', 'read', 'edit'],
          }),
        ],
        [
          'workspai-release.agent.md',
          buildWorkspaiAgent({
            name: 'Workspai Release',
            description: 'Assess readiness, governance gates, and release safety from evidence',
            mode: 'release',
            tools: ['search', 'read'],
          }),
        ],
        [
          'workspai-project-onboarder.agent.md',
          buildWorkspaiAgent({
            name: 'Workspai Project Onboarder',
            description: 'Guide create, import, and adopt flows with Workspai contracts',
            mode: 'onboard',
            tools: ['search', 'read', 'edit'],
          }),
        ],
      ] as const;

      for (const [fileName, content] of agents) {
        const relativePath = `.github/agents/${fileName}`;
        record(
          await writeTextFile(path.join(workspacePath, relativePath), content, write),
          relativePath
        );
      }
    }
  }

  if (preset === 'enterprise') {
    const mcpDesignManifest = buildMcpDesignManifest({
      workspacePath,
      generatedAt: index.generatedAt,
    });
    assertWorkspaceArtifactContract(WORKSPAI_MCP_DESIGN_REPORT_PATH, JSON.parse(mcpDesignManifest));
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_MCP_DESIGN_REPORT_PATH),
        mcpDesignManifest,
        write
      ),
      WORKSPAI_MCP_DESIGN_REPORT_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_MCP_DESIGN_REPORT_PATH),
        mcpDesignManifest,
        write
      ),
      LEGACY_MCP_DESIGN_REPORT_PATH
    );
  }

  if (preset === 'enterprise' && options.experimentalHooks === true) {
    const hooksConfig = buildExperimentalHooksConfig({
      workspacePath,
      generatedAt: index.generatedAt,
    });
    assertWorkspaceArtifactContract(WORKSPAI_VSCODE_AGENT_HOOKS_PATH, JSON.parse(hooksConfig));
    record(
      await writeTextFile(
        path.join(workspacePath, WORKSPAI_VSCODE_AGENT_HOOKS_PATH),
        hooksConfig,
        write
      ),
      WORKSPAI_VSCODE_AGENT_HOOKS_PATH
    );
    record(
      await writeTextFile(
        path.join(workspacePath, LEGACY_VSCODE_AGENT_HOOKS_PATH),
        hooksConfig,
        write
      ),
      LEGACY_VSCODE_AGENT_HOOKS_PATH
    );
  }

  if (targetEnabled(selectedTargets, 'codex') || targetEnabled(selectedTargets, 'orca')) {
    // Codex/Grok/Orca: rely on AGENTS.md + INDEX; no separate proprietary format yet.
    if (!targetEnabled(selectedTargets, 'agents')) {
      record(
        await writeManagedMarkdownFile({
          absolutePath: path.join(workspacePath, 'AGENTS.md'),
          generatedBody: buildAgentsMarkdown({ index, context }),
          write,
        }),
        'AGENTS.md'
      );
    }
  }

  const finalIndex = write
    ? await buildWorkspaceAgentReportsIndex({
        workspacePath,
        staleAfterHours,
        now,
      })
    : index;
  const missingRequired = finalIndex.reports
    .filter((report) => report.required && !report.exists)
    .map((r) => r.path);
  const staleReports = finalIndex.reports
    .filter((report) => report.exists && isAgentReportStale(report, staleAfterHours, now))
    .map((report) => report.path);

  if (strict) {
    if (missingRequired.length > 0) {
      strictViolations.push(`Missing required reports: ${missingRequired.join(', ')}`);
    }
    if (staleReports.length > 0) {
      strictViolations.push(`Stale reports (>${staleAfterHours}h): ${staleReports.join(', ')}`);
    }
    const unsafeOutputs = outputs
      .map((output) => output.path)
      .filter((relativePath) => !isSafeWorkspaceRelativePath(relativePath));
    if (unsafeOutputs.length > 0) {
      strictViolations.push(`Unsafe generated output paths: ${unsafeOutputs.join(', ')}`);
    }
  }

  const projectLenses = write
    ? await syncWorkspaceProjectLenses({
        workspacePath,
        mode: options.projectGrounding ?? 'managed',
        now,
      })
    : undefined;
  if (strict && projectLenses && projectLenses.skipped.length > 0) {
    strictViolations.push(
      `Project grounding incomplete: ${projectLenses.skipped
        .map((project) => `${project.name} (${project.reason})`)
        .join(', ')}`
    );
  }

  const pack = buildAgentCustomizationPackReport({
    workspacePath,
    generatedAt: now.toISOString(),
    preset,
    targets: selectedTargetList,
    index: finalIndex,
    outputs: [
      ...outputs,
      {
        path: AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
        kind: 'report',
        targets: ['agents', 'vscode', 'copilot', 'codex', 'orca'],
        required: true,
        status: write ? 'written' : options.dryRun ? 'planned' : 'skipped',
      },
    ],
    missingRequired,
    staleReports,
    strictViolations,
    experimentalHooks: options.experimentalHooks === true,
  });

  if (write && process.env.WORKSPAI_TEST_FAIL_AGENT_SYNC_BEFORE_PACK === '1') {
    throw new Error('Injected agent-sync failure before generation commit.');
  }

  record(
    await writeTextFile(
      path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH),
      `${JSON.stringify(pack, null, 2)}\n`,
      write
    ),
    AGENT_CUSTOMIZATION_PACK_REPORT_PATH
  );

  return {
    workspacePath,
    indexPath: path.join(workspacePath, AGENT_REPORTS_INDEX_PATH),
    packPath: path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH),
    pack,
    contextPath,
    writtenFiles,
    skippedFiles,
    blockers: index.blockers,
    missingRequired,
    staleReports,
    strictViolations,
    projectLenses,
  };
}

export async function syncWorkspaceAgentGrounding(
  options: SyncWorkspaceAgentGroundingOptions
): Promise<AgentGroundingSyncResult> {
  if (options.write !== true) return syncWorkspaceAgentGroundingUnsafe(options);

  const workspacePath = path.resolve(options.workspacePath);
  const journalDirectory = path.join(workspacePath, '.workspai', 'transactions', 'agent-sync');
  await recoverActiveLifecycleTransactions(journalDirectory);
  const preview = await syncWorkspaceAgentGroundingUnsafe({
    ...options,
    write: false,
    dryRun: true,
  });
  if (!preview.pack) throw new Error('Agent-sync dry run did not produce an output inventory.');
  const outputPaths = [
    ...preview.pack.outputInventory.map((output) => output.path),
    AGENT_REPORTS_INDEX_PATH,
    AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
  ];
  const transaction = await createLifecycleTransaction({ journalDirectory });
  try {
    for (const relativePath of [...new Set(outputPaths)].sort()) {
      const absolutePath = path.resolve(workspacePath, relativePath);
      const relative = path.relative(workspacePath, absolutePath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Agent-sync output escapes workspace root: ${relativePath}`);
      }
      await transaction.captureFile(absolutePath);
    }
    const projectTargets = await resolveWorkspaceProjectLensTargets(workspacePath);
    for (const project of projectTargets.resolved) {
      for (const relativePath of [
        PROJECT_WORKSPACE_LINK_RELATIVE_PATH,
        PROJECT_GROUNDING_RELATIVE_PATH,
        PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
        'AGENTS.md',
        '.gitignore',
      ]) {
        await transaction.captureFile(path.join(project.projectPath, relativePath));
      }
    }
    const result = await syncWorkspaceAgentGroundingUnsafe(options);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Agent-sync generation failed and rollback was incomplete.'
      );
    }
    throw error;
  }
}
