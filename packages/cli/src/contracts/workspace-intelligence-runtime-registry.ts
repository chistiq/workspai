/**
 * Physical source of truth for the canonical Workspace Intelligence chain.
 *
 * This module intentionally has no runtime imports. Producers, command
 * dispatchers, generated contracts, IDE adapters, and conformance tests must
 * consume these descriptors instead of repeating command or artifact strings.
 */

export const WORKSPACE_INTELLIGENCE_ARTIFACTS = {
  model: '.workspai/reports/workspace-model.json',
  knowledgeGraph: '.workspai/reports/workspace-knowledge-graph.json',
  snapshot: '.workspai/reports/workspace-model-snapshot.json',
  diff: '.workspai/reports/workspace-model-diff-last-run.json',
  impact: '.workspai/reports/workspace-impact-last-run.json',
  analyze: '.workspai/reports/analyze-last-run.json',
  doctor: '.workspai/reports/doctor-last-run.json',
  contractVerify: '.workspai/reports/workspace-contract-verify-last-run.json',
  readiness: '.workspai/reports/release-readiness-last-run.json',
  verify: '.workspai/reports/workspace-verify-last-run.json',
  history: '.workspai/reports/workspace-intelligence-history.json',
  agentContext: '.workspai/reports/workspace-context-agent.json',
  agentIndex: '.workspai/reports/INDEX.json',
  agentCustomizationPack: '.workspai/reports/agent-customization-pack.json',
  skillsIndex: '.workspai/reports/workspace-skills-index.json',
  agents: 'AGENTS.md',
  explain: '.workspai/reports/workspace-explain-last-run.json',
  intelligenceRun: '.workspai/reports/workspace-intelligence-run-last-run.json',
  evaluationLive: '.workspai/reports/workspace-intelligence-evaluation-live.json',
  evaluationLastRun: '.workspai/reports/workspace-intelligence-evaluation-last-run.json',
  verifiedGoalStatus: '.workspai/reports/verified-goal-last-run.json',
} as const;

export type WorkspaceIntelligenceArtifactId = keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACTS;
export type WorkspaceIntelligenceArtifactPath =
  (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)[WorkspaceIntelligenceArtifactId];

export const WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS = {
  model: 'workspace-model.v1',
  knowledgeGraph: 'workspace-knowledge-graph.v1',
  snapshot: 'workspace-model-snapshot.v1',
  diff: 'workspace-model-diff.v1',
  impact: 'workspace-impact.v1',
  analyze: 'rapidkit-analyze-v1',
  doctor: 'doctor-workspace-evidence-v1',
  contractVerify: 'workspace-contract-verify.v1',
  readiness: 'release-readiness-v1',
  verify: 'workspace-verify.v1',
  history: 'workspace-intelligence-history.v1',
  agentContext: 'workspace-context.v1',
  agentIndex: 'rapidkit-agent-reports-index.v1',
  agentCustomizationPack: 'rapidkit-agent-customization-pack.v1',
  skillsIndex: 'workspace-skills-index.v1',
  agents: null,
  explain: 'workspace-explain.v1',
  intelligenceRun: 'workspace-intelligence-run.v1',
  evaluationLive: 'workspace-intelligence-evaluation.v1',
  evaluationLastRun: 'workspace-intelligence-evaluation.v1',
  verifiedGoalStatus: 'workspai.verified-goal-status.v1',
} as const satisfies Record<WorkspaceIntelligenceArtifactId, string | null>;

export const WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS = {
  model: 'contracts/workspace-intelligence/workspace-model.v1.json',
  knowledgeGraph: 'contracts/workspace-intelligence/workspace-knowledge-graph.v1.json',
  snapshot: 'contracts/workspace-intelligence/workspace-model-snapshot.v1.json',
  diff: 'contracts/workspace-intelligence/workspace-model-diff.v1.json',
  impact: 'contracts/workspace-intelligence/workspace-impact.v1.json',
  analyze: 'contracts/analyze-last-run.v1.json',
  doctor: 'contracts/doctor-workspace-evidence.v1.json',
  contractVerify: 'contracts/workspace-intelligence/workspace-contract-verify.v1.json',
  readiness: 'contracts/release-readiness.v1.json',
  verify: 'contracts/workspace-intelligence/workspace-verify.v1.json',
  history: 'contracts/workspace-intelligence/workspace-intelligence-history.v1.json',
  agentContext: 'contracts/workspace-intelligence/workspace-context.v1.json',
  agentIndex: 'contracts/workspace-intelligence/agent-reports-index.v1.json',
  agentCustomizationPack:
    'contracts/workspace-intelligence/agent-customization-pack-report.v1.json',
  skillsIndex: 'contracts/workspace-intelligence/workspace-skills-index.v1.json',
  agents: null,
  explain: 'contracts/workspace-intelligence/workspace-explain.v1.json',
  intelligenceRun: 'contracts/workspace-intelligence/workspace-intelligence-run.v1.json',
  evaluationLive: 'contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json',
  evaluationLastRun: 'contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json',
  verifiedGoalStatus: 'contracts/workspace-intelligence/verified-goal-status.v1.json',
} as const satisfies Record<WorkspaceIntelligenceArtifactId, string | null>;

export const WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES = {
  analyze: 'analyze',
  workspace: 'workspace <action> [subaction] [key] [value]',
  doctor: 'doctor [scope]',
  readiness: 'readiness',
} as const;

export const WORKSPACE_INTELLIGENCE_ROOT_COMMANDS = [
  'analyze',
  'readiness',
  'doctor',
  'workspace',
] as const satisfies ReadonlyArray<keyof typeof WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES>;

export const WORKSPACE_INTELLIGENCE_STEP_IDS = [
  'model',
  'diff',
  'impact',
  'doctor-evidence',
  'contract-evidence',
  'analyze-evidence',
  'readiness-evidence',
  'verify',
  'context',
  'agent-sync',
  'explain',
] as const;

export type WorkspaceIntelligenceStepId = (typeof WORKSPACE_INTELLIGENCE_STEP_IDS)[number];

export const WORKSPACE_INTELLIGENCE_PREFLIGHT_IDS = ['sync', 'baseline'] as const;

export type WorkspaceIntelligencePreflightId =
  (typeof WORKSPACE_INTELLIGENCE_PREFLIGHT_IDS)[number];

export const WORKSPACE_INTELLIGENCE_PREFLIGHT_ARTIFACTS = {
  sync: ['.workspai/workspace.contract.json', '.workspai/workspace-registry.v1.json'],
  baseline: [WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot],
} as const satisfies Record<WorkspaceIntelligencePreflightId, readonly string[]>;

type RuntimeStepDescriptor = {
  command: readonly string[];
  produces: readonly WorkspaceIntelligenceArtifactPath[];
};

const A = WORKSPACE_INTELLIGENCE_ARTIFACTS;

export const WORKSPACE_INTELLIGENCE_RUNTIME_STEPS = {
  model: {
    command: ['workspace', 'model', '--json', '--write'],
    produces: [A.model, A.knowledgeGraph],
  },
  diff: {
    command: ['workspace', 'diff', '--from', A.snapshot, '--json'],
    produces: [A.diff],
  },
  impact: {
    command: ['workspace', 'impact', '--from', A.diff, '--json'],
    produces: [A.impact],
  },
  'doctor-evidence': {
    command: ['doctor', 'workspace', '--json'],
    produces: [A.doctor],
  },
  'contract-evidence': {
    command: ['workspace', 'contract', 'verify', '--strict', '--json'],
    produces: [A.contractVerify],
  },
  'analyze-evidence': {
    command: ['analyze', '--json'],
    produces: [A.analyze],
  },
  'readiness-evidence': {
    // Verify is the definitive downstream gate. Reading a previous verify here
    // creates a first-run cycle and can mix evidence from different chain runs.
    command: ['readiness', '--json', '--skip-verify'],
    produces: [A.readiness],
  },
  verify: {
    command: ['workspace', 'verify', '--from-impact', A.impact, '--json'],
    produces: [A.verify, A.history],
  },
  context: {
    command: ['workspace', 'context', '--for-agent', '--json', '--write', '--no-agent-sync'],
    produces: [A.agentContext],
  },
  'agent-sync': {
    command: ['workspace', 'agent-sync', '--write', '--json', '--preset', 'enterprise'],
    produces: [A.agentIndex, A.agentCustomizationPack, A.skillsIndex, A.agents],
  },
  explain: {
    command: ['workspace', 'explain', 'release-blocked', '--json', '--write'],
    produces: [A.explain],
  },
} as const satisfies Record<WorkspaceIntelligenceStepId, RuntimeStepDescriptor>;

export function workspaceIntelligenceRuntimeStep(id: WorkspaceIntelligenceStepId) {
  return WORKSPACE_INTELLIGENCE_RUNTIME_STEPS[id];
}
