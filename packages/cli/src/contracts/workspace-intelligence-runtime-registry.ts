/**
 * Physical source of truth for the canonical Workspace Intelligence chain.
 *
 * This module intentionally has no producer/runtime imports. It may consume
 * data-only schema constants from extraction-safe contract modules; producers,
 * command dispatchers, generated contracts, IDE adapters, and conformance tests
 * must consume these descriptors instead of repeating command or artifact strings.
 */

import {
  DOCTOR_CAPABILITIES_SCHEMA_VERSION,
  DOCTOR_VALIDATION_SCHEMA_VERSION,
} from './doctor-capabilities-contract.js';

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
  repairTransaction: '.workspai/reports/workspace-repair-last-run.json',
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
  repairTransaction: 'workspai.workspace-repair-transaction.v1',
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
  repairTransaction: 'contracts/workspace-intelligence/workspace-repair-transaction.v1.json',
} as const satisfies Record<WorkspaceIntelligenceArtifactId, string | null>;

export type WorkspaceSupplementalArtifactContract = {
  artifactPath: string;
  schemaVersion: string | number;
  schemaVersionField?: 'schemaVersion' | 'schema_version' | 'schema' | 'version';
  contractPath: string;
  producerCommands: readonly (readonly string[])[];
};

/**
 * Canonical registry for public artifacts produced outside the ordered
 * Workspace Intelligence chain. Artifact validation and discovery consume
 * this table directly; producer paths must never be re-declared elsewhere.
 */
export const WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS = {
  goalIndex: {
    artifactPath: '.workspai/goals/index.json',
    schemaVersion: 'workspai.goal-index.v1',
    contractPath: 'contracts/workspace-intelligence/goal-index.v1.json',
    producerCommands: [['goal']],
  },
  projectWorkspaceLink: {
    artifactPath: '.workspai/workspace-link.local.json',
    schemaVersion: 'project-workspace-link.v1',
    contractPath: 'contracts/project-workspace-link.v1.json',
    producerCommands: [
      ['adopt'],
      ['import'],
      ['project', 'workspace', 'relink'],
      ['workspace', 'sync'],
    ],
  },
  projectContextAgent: {
    artifactPath: '.workspai/reports/project-context-agent.json',
    schemaVersion: 'project-context-agent.v1',
    contractPath: 'contracts/workspace-intelligence/project-context-agent.v1.json',
    producerCommands: [
      ['adopt'],
      ['import'],
      ['workspace', 'sync'],
      ['workspace', 'agent-sync', '--write'],
    ],
  },
  projectAgentEntry: {
    artifactPath: '.workspai/agent-entry.v1.json',
    schemaVersion: 'workspai.agent-entry.v1',
    contractPath: 'contracts/workspace-intelligence/project-agent-entry.v1.json',
    producerCommands: [
      ['adopt'],
      ['import'],
      ['workspace', 'sync'],
      ['workspace', 'agent-sync', '--write'],
    ],
  },
  workspaceContract: {
    artifactPath: '.workspai/workspace.contract.json',
    schemaVersion: 1,
    contractPath: 'contracts/workspace-contract.v1.json',
    producerCommands: [
      ['workspace', 'sync'],
      ['workspace', 'contract', 'sync'],
    ],
  },
  workspaceModelCache: {
    artifactPath: '.workspai/cache/workspace-model.v1.json',
    schemaVersion: 'workspace-model-cache.v1',
    contractPath: 'contracts/workspace-model-cache.v1.json',
    producerCommands: [['workspace', 'model']],
  },
  workspaceRegistry: {
    artifactPath: '.workspai/workspace-registry.v1.json',
    schemaVersion: 'workspace-registry.v1',
    contractPath: 'contracts/workspace-registry.v1.json',
    producerCommands: [['workspace', 'sync']],
  },
  compatibilityMatrix: {
    artifactPath: '.workspai/compatibility-matrix.json',
    schemaVersion: 'rapidkit.compatibility-matrix.v1',
    contractPath: 'contracts/compatibility-matrix.v1.json',
    producerCommands: [['bootstrap']],
  },
  doctorWorkspaceCache: {
    artifactPath: '.workspai/reports/doctor-workspace-cache.json',
    schemaVersion: 'doctor-workspace-cache-v2',
    contractPath: 'contracts/doctor-workspace-cache.v2.json',
    producerCommands: [['doctor', 'workspace']],
  },
  doctorCapabilities: {
    artifactPath: '.workspai/reports/doctor-capabilities.json',
    schemaVersion: DOCTOR_CAPABILITIES_SCHEMA_VERSION,
    contractPath: 'contracts/workspace-intelligence/doctor-capabilities.v1.json',
    producerCommands: [['doctor', 'capabilities', '--write']],
  },
  doctorValidation: {
    artifactPath: '.workspai/reports/doctor-validation-last-run.json',
    schemaVersion: DOCTOR_VALIDATION_SCHEMA_VERSION,
    contractPath: 'contracts/workspace-intelligence/doctor-validation.v1.json',
    producerCommands: [['doctor', 'capabilities', '--validate', '--write']],
  },
  bootstrapCompliance: {
    artifactPath: '.workspai/reports/bootstrap-compliance.latest.json',
    schemaVersion: 'bootstrap-compliance.v1',
    contractPath: 'contracts/bootstrap-compliance.v1.json',
    producerCommands: [['bootstrap']],
  },
  mirrorOps: {
    artifactPath: '.workspai/reports/mirror-ops.latest.json',
    schemaVersion: 'mirror-ops.v1',
    contractPath: 'contracts/mirror-ops.v1.json',
    producerCommands: [['mirror', 'status']],
  },
  transparencyEvidence: {
    artifactPath: '.workspai/reports/transparency-evidence.latest.json',
    schemaVersion: 'transparency-evidence.v1',
    contractPath: 'contracts/transparency-evidence.v1.json',
    producerCommands: [['mirror', 'sync']],
  },
  workspaceShareBundle: {
    artifactPath: '.workspai/reports/share-bundle.json',
    schemaVersion: '1.1',
    schemaVersionField: 'schema_version',
    contractPath: 'contracts/workspace-share-bundle.v1.json',
    producerCommands: [['workspace', 'share']],
  },
  doctorProject: {
    artifactPath: '.workspai/reports/doctor-project-last-run.json',
    schemaVersion: 'doctor-project-evidence-v1',
    contractPath: 'contracts/doctor-project-evidence.v1.json',
    producerCommands: [['doctor', 'project']],
  },
  doctorReceipt: {
    artifactPath: '.workspai/reports/doctor-receipt-last-run.json',
    schemaVersion: 'workspai.doctor-receipt.v1',
    contractPath: 'contracts/workspace-intelligence/doctor-receipt.v1.json',
    producerCommands: [
      ['doctor', 'workspace'],
      ['doctor', 'project'],
    ],
  },
  projectTestCoverage: {
    artifactPath: '.workspai/reports/project-test-coverage-last-run.json',
    schemaVersion: 'workspai.project-test-coverage.v1',
    contractPath: 'contracts/project-test-coverage.v1.json',
    producerCommands: [['project', 'coverage']],
  },
  goalPackLastRun: {
    artifactPath: '.workspai/reports/goal-pack-last-run.json',
    schemaVersion: 'workspai.goal-pack.v1',
    contractPath: 'contracts/workspace-intelligence/goal-pack.v1.json',
    producerCommands: [['goal']],
  },
  doctorRemediationPlan: {
    artifactPath: '.workspai/reports/doctor-remediation-plan-last-run.json',
    schemaVersion: 'doctor-remediation-plan-v2',
    contractPath: 'contracts/doctor-remediation-plan.v2.json',
    producerCommands: [['workspace', 'remediation-plan']],
  },
  artifactRemediationPlan: {
    artifactPath: '.workspai/reports/artifact-remediation-plan-last-run.json',
    schemaVersion: 'artifact-remediation-plan-v1',
    contractPath: 'contracts/artifact-remediation-plan.v1.json',
    producerCommands: [['workspace', 'remediation-plan']],
  },
  doctorFixResult: {
    artifactPath: '.workspai/reports/doctor-fix-result-last-run.json',
    schemaVersion: 'rapidkit-doctor-fix-result-v1',
    contractPath: 'contracts/workspace-intelligence/doctor-fix-result.v1.json',
    producerCommands: [['doctor', 'workspace']],
  },
  pipelineLastRun: {
    artifactPath: '.workspai/reports/pipeline-last-run.json',
    schemaVersion: 'rapidkit-pipeline-v1',
    contractPath: 'contracts/pipeline-last-run.v1.json',
    producerCommands: [['pipeline']],
  },
  autopilotReleaseLastRun: {
    artifactPath: '.workspai/reports/autopilot-release-last-run.json',
    schemaVersion: 'autopilot-release-v1',
    contractPath: 'contracts/autopilot-release.v1.json',
    producerCommands: [['autopilot', 'release']],
  },
  autopilotReleaseAlias: {
    artifactPath: '.workspai/reports/autopilot-release.json',
    schemaVersion: 'autopilot-release-v1',
    contractPath: 'contracts/autopilot-release.v1.json',
    producerCommands: [['autopilot', 'release']],
  },
  workspaceRunLast: {
    artifactPath: '.workspai/reports/workspace-run-last.json',
    schemaVersion: 'workspace-run-v1',
    contractPath: 'contracts/workspace-run-last.v1.json',
    producerCommands: [['workspace', 'run']],
  },
  workspaiMcpDesign: {
    artifactPath: '.workspai/reports/workspai-mcp-design.json',
    schemaVersion: 'workspai-mcp-design.v1',
    contractPath: 'contracts/workspace-intelligence/mcp-design.v1.json',
    producerCommands: [['workspace', 'agent-sync', '--write']],
  },
  legacyMcpDesign: {
    artifactPath: '.workspai/reports/rapidkit-mcp-design.json',
    schemaVersion: 'workspai-mcp-design.v1',
    contractPath: 'contracts/workspace-intelligence/mcp-design.v1.json',
    producerCommands: [['workspace', 'agent-sync', '--write']],
  },
  workspaceWhy: {
    artifactPath: '.workspai/reports/workspace-why-last-run.json',
    schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.explain,
    contractPath: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.explain,
    producerCommands: [['workspace', 'why']],
  },
  workspaceTrace: {
    artifactPath: '.workspai/reports/workspace-trace-last-run.json',
    schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.explain,
    contractPath: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.explain,
    producerCommands: [['workspace', 'trace']],
  },
  agentHooks: {
    artifactPath: '.vscode/workspai-agent-hooks.json',
    schemaVersion: 'workspai-agent-hooks.v1',
    contractPath: 'contracts/workspace-intelligence/agent-hooks.v1.json',
    producerCommands: [['workspace', 'agent-sync']],
  },
  infraPlan: {
    artifactPath: '.workspai/reports/infra-plan.json',
    schemaVersion: 'rapidkit.infra-plan.v1',
    contractPath: 'contracts/infra-plan.v1.json',
    producerCommands: [['infra', 'plan']],
  },
} as const satisfies Record<string, WorkspaceSupplementalArtifactContract>;

export const WORKSPACE_SUPPLEMENTAL_ARTIFACTS = Object.freeze(
  Object.fromEntries(
    Object.entries(WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS).map(([id, descriptor]) => [
      id,
      descriptor.artifactPath,
    ])
  )
) as {
  readonly [
    K in keyof typeof WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS
  ]: (typeof WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS)[K]['artifactPath'];
};

export const WORKSPACE_INTELLIGENCE_ADDITIONAL_PRODUCERS = {
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun]: [['workspace', 'intelligence', 'run']],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot]: [['workspace', 'snapshot']],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.history]: [['workspace', 'feedback', 'record', '--json']],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLive]: [
    ['workspace', 'eval', 'init'],
    ['workspace', 'eval', 'record', '--json'],
  ],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun]: [['workspace', 'eval', 'report', '--json']],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.verifiedGoalStatus]: [
    ['workspace', 'goal', 'plan'],
    ['workspace', 'goal', 'verify'],
  ],
  [WORKSPACE_INTELLIGENCE_ARTIFACTS.repairTransaction]: [
    ['workspace', 'repair', 'plan'],
    ['workspace', 'repair', 'propose'],
    ['workspace', 'repair', 'approve'],
    ['workspace', 'repair', 'decide'],
    ['workspace', 'repair', 'execute'],
    ['workspace', 'repair', 'resume'],
    ['workspace', 'repair', 'rollback'],
    ['workspace', 'repair', 'cancel'],
  ],
} as const satisfies Readonly<Record<string, readonly (readonly string[])[]>>;

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
