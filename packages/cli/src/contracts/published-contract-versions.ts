import { CLI_LOG_EVENT_SCHEMA_VERSION } from './cli-log-event-contract.js';
import { FACT_FRESHNESS_SCHEMA_VERSION } from './fact-freshness-contract.js';
import { FRESHNESS_METADATA_SCHEMA_VERSION } from './freshness-metadata-contract.js';
import { PROJECT_ENTRY_CAPABILITY_SCHEMA_VERSION } from './project-entry-capability-contract.js';
import { RUNTIME_COMMAND_SURFACE_SCHEMA_VERSION } from './runtime-command-surface-contract.js';
import { BLOCKER_RESOLUTION_SCHEMA_VERSION } from './blocker-resolution-contract.js';
import { AGENT_ACTION_OUTCOME_SCHEMA_VERSION } from './agent-action-outcome-contract.js';
import { DOCTOR_FIX_RESULT_SCHEMA_VERSION } from './doctor-fix-result-contract.js';
import { DOCTOR_REMEDIATION_PLAN_SCHEMA_VERSION } from './doctor-remediation-plan-contract.js';
import { ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION } from './artifact-remediation-plan-contract.js';
import { WORKSPACE_EXPLAIN_SCHEMA_VERSION } from './workspace-explain-contract.js';
import { WORKSPACE_OPERATIONAL_SKILL_SCHEMA_VERSION } from './workspace-operational-skill-contract.js';
import { WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION } from './workspace-skills-index-contract.js';
import { AGENT_CUSTOMIZATION_PACK_SCHEMA_VERSION } from './agent-customization-pack-contract.js';
import { WORKSPACE_DEPENDENCY_GRAPH_SCHEMA_VERSION } from './workspace-dependency-graph-contract.js';
import { WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION } from './workspace-knowledge-graph-contract.js';
import { DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION } from './doctor-graph-diagnosis-contract.js';
import { DOCTOR_DIAGNOSIS_SCHEMA_VERSION } from './doctor-diagnosis-contract.js';
import { DOCTOR_SUMMARY_SCHEMA_VERSION } from './doctor-summary-contract.js';
import {
  DOCTOR_CAPABILITIES_SCHEMA_VERSION,
  DOCTOR_VALIDATION_SCHEMA_VERSION,
} from './doctor-capabilities-contract.js';
import { WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION } from './workspace-knowledge-graph-change-overlay-contract.js';
import { WORKSPACE_INTELLIGENCE_ARCHITECTURE_SCHEMA_VERSION } from './workspace-intelligence-architecture-contract.js';
import { WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION } from './workspace-intelligence-chain-contract.js';
import { WORKSPACE_HISTORY_SCHEMA_VERSION } from '../workspace-history.js';
import { WORKSPACE_CONTEXT_SCHEMA_VERSION } from '../workspace-context.js';
import { WORKSPACE_MODEL_SCHEMA_VERSION } from '../workspace-model.js';
import { WORKSPACE_IMPACT_SCHEMA_VERSION } from '../workspace-intelligence.js';
import { WORKSPACE_VERIFY_SCHEMA_VERSION } from '../workspace-verify.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from './workspace-intelligence-runtime-registry.js';
import {
  WORKSPACE_ARCHIVE_CAPABILITIES_SCHEMA_VERSION,
  WORKSPACE_ARCHIVE_MANIFEST_SCHEMA_VERSION,
  WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
} from './workspace-archive-contract.js';
import { CLI_OPERATION_RESULT_SCHEMA_VERSION } from './cli-operation-result-contract.js';
import { OPERATIONAL_JSON_SCHEMA_VERSIONS } from './operational-json-schemas.js';
import { CLI_RUNTIME_COMMAND_INVENTORY_SCHEMA_VERSION } from '../utils/cli-command-surface.js';
import { WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION } from '../workspace-knowledge-graph-query.js';
import { WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION } from '../workspace-graph-token-efficiency.js';
import {
  MODEL_USAGE_EVENT_SCHEMA_VERSION,
  WORKSPACE_INTELLIGENCE_EVALUATION_COMPARISON_SCHEMA_VERSION,
  WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
} from './workspace-intelligence-evaluation-contract.js';
import {
  DOCTOR_PROJECT_EVIDENCE_SCHEMA,
  DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
} from '../utils/doctor-evidence-contract.js';
import { PROJECT_WORKSPACE_RESOLUTION_SCHEMA_VERSION } from './project-workspace-resolution-contract.js';
import {
  ADOPT_EFFECTS_SCHEMA_VERSION,
  INGESTION_PLAN_SCHEMA_VERSION,
  INGESTION_RESULT_SCHEMA_VERSION,
} from './ingestion-contract.js';
import { STUDIO_CARD_REPAIR_CAPABILITIES_SCHEMA_VERSION } from './studio-card-repair-capabilities-contract.js';
import { WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION } from './workspace-repair-transaction-contract.js';
import { WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION } from './workspace-repair-proposal-contract.js';
import { WORKSPACE_REPAIR_CAPABILITIES_SCHEMA_VERSION } from './workspace-repair-capabilities-contract.js';
import {
  GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
  GOAL_INDEX_SCHEMA_VERSION,
  GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  GOAL_PACK_SCHEMA_VERSION,
  GOAL_PLAN_RESULT_SCHEMA_VERSION,
} from '../goals/goal-pack-contract.js';

export const PUBLISHED_CONTRACT_CATALOG_SCHEMA_VERSION =
  'workspai-published-contract-catalog-v1' as const;
export const WORKSPACE_GRAPH_STREAM_SCHEMA_VERSION = 'workspace-graph-stream.v1' as const;

/** Single source of truth for schema versions advertised to IDE/CI consumers. */
export function getPublishedContractVersions() {
  return {
    workspaceContract: 1,
    runtimeCommandSurface: RUNTIME_COMMAND_SURFACE_SCHEMA_VERSION,
    cliRuntimeCommandInventory: CLI_RUNTIME_COMMAND_INVENTORY_SCHEMA_VERSION,
    cliOperationResult: CLI_OPERATION_RESULT_SCHEMA_VERSION,
    publishedContractCatalog: PUBLISHED_CONTRACT_CATALOG_SCHEMA_VERSION,
    workspaceArchiveCapabilities: WORKSPACE_ARCHIVE_CAPABILITIES_SCHEMA_VERSION,
    workspaceArchiveManifest: WORKSPACE_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    workspaceArchiveOperationResult: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
    ingestionPlan: INGESTION_PLAN_SCHEMA_VERSION,
    ingestionResult: INGESTION_RESULT_SCHEMA_VERSION,
    adoptEffects: ADOPT_EFFECTS_SCHEMA_VERSION,
    projectEntryCapability: PROJECT_ENTRY_CAPABILITY_SCHEMA_VERSION,
    projectWorkspaceLink:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectWorkspaceLink.schemaVersion,
    projectWorkspaceResolution: PROJECT_WORKSPACE_RESOLUTION_SCHEMA_VERSION,
    projectContextAgent:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectContextAgent.schemaVersion,
    doctorProjectEvidence: DOCTOR_PROJECT_EVIDENCE_SCHEMA,
    doctorWorkspaceEvidence: DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
    doctorGraphDiagnosis: DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION,
    doctorDiagnosis: DOCTOR_DIAGNOSIS_SCHEMA_VERSION,
    doctorCapabilities: DOCTOR_CAPABILITIES_SCHEMA_VERSION,
    doctorValidation: DOCTOR_VALIDATION_SCHEMA_VERSION,
    doctorReceipt: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorReceipt.schemaVersion,
    doctorSummary: DOCTOR_SUMMARY_SCHEMA_VERSION,
    projectTestCoverage:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectTestCoverage.schemaVersion,
    verifiedGoal: 'workspai.verified-goal.v1',
    verifiedGoalStatus: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.verifiedGoalStatus,
    goalPack: GOAL_PACK_SCHEMA_VERSION,
    goalAgentHandoff: GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
    goalPlanResult: GOAL_PLAN_RESULT_SCHEMA_VERSION,
    goalIndex: GOAL_INDEX_SCHEMA_VERSION,
    goalLifecycleResult: GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
    workspaceIntelligenceArchitecture: WORKSPACE_INTELLIGENCE_ARCHITECTURE_SCHEMA_VERSION,
    workspaceIntelligenceChain: WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
    workspaceIntelligenceArtifacts: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
    cliLogEvent: CLI_LOG_EVENT_SCHEMA_VERSION,
    freshnessMetadata: FRESHNESS_METADATA_SCHEMA_VERSION,
    factFreshness: FACT_FRESHNESS_SCHEMA_VERSION,
    blockerResolution: BLOCKER_RESOLUTION_SCHEMA_VERSION,
    workspaceModel: WORKSPACE_MODEL_SCHEMA_VERSION,
    workspaceImpact: WORKSPACE_IMPACT_SCHEMA_VERSION,
    workspaceVerify: WORKSPACE_VERIFY_SCHEMA_VERSION,
    workspaceContext: WORKSPACE_CONTEXT_SCHEMA_VERSION,
    workspaceDependencyGraph: WORKSPACE_DEPENDENCY_GRAPH_SCHEMA_VERSION,
    workspaceKnowledgeGraph: WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    workspaceGraphStream: WORKSPACE_GRAPH_STREAM_SCHEMA_VERSION,
    workspaceKnowledgeGraphChangeOverlay: WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION,
    workspaceKnowledgeSearch: WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
    workspaceGraphTokenEfficiency: WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION,
    modelUsageEvent: MODEL_USAGE_EVENT_SCHEMA_VERSION,
    workspaceIntelligenceEvaluation: WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
    workspaceIntelligenceEvaluationComparison:
      WORKSPACE_INTELLIGENCE_EVALUATION_COMPARISON_SCHEMA_VERSION,
    workspaceIntelligenceHistory: WORKSPACE_HISTORY_SCHEMA_VERSION,
    agentCustomizationPackCapabilities: AGENT_CUSTOMIZATION_PACK_SCHEMA_VERSION,
    agentCustomizationPackReport: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.agentCustomizationPack,
    agentReportsIndex: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.agentIndex,
    workspaceOperationalSkill: WORKSPACE_OPERATIONAL_SKILL_SCHEMA_VERSION,
    workspaceSkillsIndex: WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION,
    workspaceExplain: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
    agentActionOutcome: AGENT_ACTION_OUTCOME_SCHEMA_VERSION,
    doctorRemediationPlan: DOCTOR_REMEDIATION_PLAN_SCHEMA_VERSION,
    doctorDependencyRepairTransaction: 'workspai.doctor-dependency-repair-transaction.v1',
    artifactRemediationPlan: ARTIFACT_REMEDIATION_PLAN_SCHEMA_VERSION,
    studioCardRepairCapabilities: STUDIO_CARD_REPAIR_CAPABILITIES_SCHEMA_VERSION,
    workspaceRepairProposal: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
    workspaceRepairCapabilities: WORKSPACE_REPAIR_CAPABILITIES_SCHEMA_VERSION,
    workspaceRepairTransaction: WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
    doctorFixResult: DOCTOR_FIX_RESULT_SCHEMA_VERSION,
    backendImportStackParitySnapshot: 'backend-import-stack-parity-v1',
    bootstrapCompliance:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.bootstrapCompliance.schemaVersion,
    commandCapabilities: 'rapidkit-command-capabilities-v1',
    createPlannerCapabilities: 'rapidkit-create-planner-capabilities-v1',
    doctorRemediationPlanLegacy: DOCTOR_REMEDIATION_PLAN_SCHEMA_VERSION,
    extensionCliCompatibility: 'rapidkit-extension-cli-compatibility.v1',
    infraStack: 'rapidkit.infra-stack.v1',
    mirrorOps: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.mirrorOps.schemaVersion,
    moduleLayout: 'rapidkit.module-layout.v1',
    moduleSupport: 'rapidkit-module-support-v1',
    pipelineLastRun: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.pipelineLastRun.schemaVersion,
    transparencyEvidence:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.transparencyEvidence.schemaVersion,
    version: 'rapidkit-version-v1',
    studioBlockerHandoff: 'rapidkit-studio-blocker-handoff-v1',
    workspaceRegistry: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceRegistry.schemaVersion,
    workspaceRunLast: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceRunLast.schemaVersion,
    workspaceShareBundle:
      WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceShareBundle.schemaVersion,
    ...OPERATIONAL_JSON_SCHEMA_VERSIONS,
  };
}

export type PublishedContractDescriptor = {
  schemaVersion: string | number | Record<string, string | null>;
  contractPath: string | null;
  publication: 'json-schema' | 'capability-contract' | 'embedded-type';
  artifacts?: Record<
    string,
    { path: string; schemaVersion: string | null; contractPath: string | null }
  >;
};

/** Discoverable paths for every version advertised by the CLI. */
export function getPublishedContractCatalog() {
  const versions = getPublishedContractVersions();
  const paths: Record<keyof typeof versions, string | null> = {
    workspaceContract: 'contracts/workspace-contract.v1.json',
    runtimeCommandSurface: 'contracts/runtime-command-surface.v1.json',
    cliRuntimeCommandInventory: 'contracts/cli-runtime-command-inventory.v1.snapshot.json',
    cliOperationResult: 'contracts/cli-operation-result.v1.json',
    publishedContractCatalog: 'contracts/published-contract-catalog.v1.json',
    workspaceArchiveCapabilities: 'contracts/workspace-archive-capabilities.v1.json',
    workspaceArchiveManifest: 'contracts/workspace-archive-manifest.v1.json',
    workspaceArchiveOperationResult: 'contracts/workspace-archive-operation-result.v1.json',
    ingestionPlan: 'contracts/ingestion-plan.v1.json',
    ingestionResult: 'contracts/ingestion-result.v1.json',
    adoptEffects: 'contracts/adopt-effects.v1.json',
    projectEntryCapability: 'contracts/project-entry-capability.v1.json',
    projectWorkspaceLink: 'contracts/project-workspace-link.v1.json',
    projectWorkspaceResolution: 'contracts/project-workspace-resolution.v1.json',
    projectContextAgent: 'contracts/workspace-intelligence/project-context-agent.v1.json',
    doctorProjectEvidence: 'contracts/doctor-project-evidence.v1.json',
    doctorWorkspaceEvidence: 'contracts/doctor-workspace-evidence.v1.json',
    doctorGraphDiagnosis: 'contracts/workspace-intelligence/doctor-graph-diagnosis.v1.json',
    doctorDiagnosis: 'contracts/workspace-intelligence/doctor-diagnosis.v1.json',
    doctorCapabilities: 'contracts/workspace-intelligence/doctor-capabilities.v1.json',
    doctorValidation: 'contracts/workspace-intelligence/doctor-validation.v1.json',
    doctorReceipt: 'contracts/workspace-intelligence/doctor-receipt.v1.json',
    doctorSummary: 'contracts/workspace-intelligence/doctor-summary.v1.json',
    projectTestCoverage: 'contracts/project-test-coverage.v1.json',
    verifiedGoal: 'contracts/workspace-intelligence/verified-goal.v1.json',
    verifiedGoalStatus: 'contracts/workspace-intelligence/verified-goal-status.v1.json',
    goalPack: 'contracts/workspace-intelligence/goal-pack.v1.json',
    goalAgentHandoff: 'contracts/workspace-intelligence/goal-agent-handoff.v1.json',
    goalPlanResult: 'contracts/workspace-intelligence/goal-plan-result.v1.json',
    goalIndex: 'contracts/workspace-intelligence/goal-index.v1.json',
    goalLifecycleResult: 'contracts/workspace-intelligence/goal-lifecycle-result.v1.json',
    workspaceIntelligenceArchitecture: 'contracts/workspace-intelligence-architecture.v1.json',
    workspaceIntelligenceChain: 'contracts/workspace-intelligence-chain.v1.json',
    workspaceIntelligenceArtifacts: null,
    cliLogEvent: 'contracts/cli-log-event.v1.json',
    freshnessMetadata: null,
    factFreshness: 'contracts/workspace-intelligence/fact-freshness.v1.json',
    blockerResolution: 'contracts/workspace-intelligence/blocker-resolution.v1.json',
    workspaceModel: 'contracts/workspace-intelligence/workspace-model.v1.json',
    workspaceImpact: 'contracts/workspace-intelligence/workspace-impact.v1.json',
    workspaceVerify: 'contracts/workspace-intelligence/workspace-verify.v1.json',
    workspaceContext: 'contracts/workspace-intelligence/workspace-context.v1.json',
    workspaceDependencyGraph: 'contracts/workspace-intelligence/workspace-dependency-graph.v1.json',
    workspaceKnowledgeGraph: 'contracts/workspace-intelligence/workspace-knowledge-graph.v1.json',
    workspaceGraphStream: 'contracts/workspace-intelligence/workspace-graph-stream.v1.json',
    workspaceKnowledgeGraphChangeOverlay:
      'contracts/workspace-intelligence/workspace-knowledge-graph-change-overlay.v1.json',
    workspaceKnowledgeSearch: 'contracts/workspace-intelligence/workspace-knowledge-search.v1.json',
    workspaceGraphTokenEfficiency:
      'contracts/workspace-intelligence/workspace-graph-token-efficiency.v1.json',
    modelUsageEvent: 'contracts/workspace-intelligence/model-usage-event.v1.json',
    workspaceIntelligenceEvaluation:
      'contracts/workspace-intelligence/workspace-intelligence-evaluation.v1.json',
    workspaceIntelligenceEvaluationComparison:
      'contracts/workspace-intelligence/workspace-intelligence-evaluation-comparison.v1.json',
    workspaceIntelligenceHistory:
      'contracts/workspace-intelligence/workspace-intelligence-history.v1.json',
    agentCustomizationPackCapabilities: 'contracts/agent-customization-pack.v1.json',
    agentCustomizationPackReport:
      'contracts/workspace-intelligence/agent-customization-pack-report.v1.json',
    agentReportsIndex: 'contracts/workspace-intelligence/agent-reports-index.v1.json',
    workspaceOperationalSkill:
      'contracts/workspace-intelligence/workspace-operational-skill.v1.json',
    workspaceSkillsIndex: 'contracts/workspace-intelligence/workspace-skills-index.v1.json',
    workspaceExplain: 'contracts/workspace-intelligence/workspace-explain.v1.json',
    agentActionOutcome: 'contracts/workspace-intelligence/agent-action-outcome.v1.json',
    doctorRemediationPlan: 'contracts/doctor-remediation-plan.v2.json',
    doctorDependencyRepairTransaction:
      'contracts/workspace-intelligence/doctor-dependency-repair-transaction.v1.json',
    artifactRemediationPlan: 'contracts/artifact-remediation-plan.v1.json',
    studioCardRepairCapabilities: 'contracts/studio-card-repair-capabilities.v1.json',
    workspaceRepairProposal: 'contracts/workspace-intelligence/workspace-repair-proposal.v1.json',
    workspaceRepairCapabilities: 'contracts/workspace-repair-capabilities.v1.json',
    workspaceRepairTransaction:
      'contracts/workspace-intelligence/workspace-repair-transaction.v1.json',
    doctorFixResult: 'contracts/workspace-intelligence/doctor-fix-result.v1.json',
    backendImportStackParitySnapshot: 'contracts/backend-import-stack-parity.snapshot.json',
    bootstrapCompliance: 'contracts/bootstrap-compliance.v1.json',
    commandCapabilities: 'contracts/command-capabilities.v1.json',
    createPlannerCapabilities: 'contracts/create-planner-capabilities.v1.json',
    doctorRemediationPlanLegacy: 'contracts/doctor-remediation-plan.v1.json',
    extensionCliCompatibility: 'contracts/extension-cli-compatibility.v1.json',
    infraStack: 'contracts/infra-stack.v1.json',
    mirrorOps: 'contracts/mirror-ops.v1.json',
    moduleLayout: 'contracts/module-layout.v1.json',
    moduleSupport: 'contracts/module-support.v1.json',
    pipelineLastRun: 'contracts/pipeline-last-run.v1.json',
    transparencyEvidence: 'contracts/transparency-evidence.v1.json',
    version: 'contracts/version.v1.json',
    studioBlockerHandoff: 'contracts/workspace-intelligence/studio-blocker-handoff.v1.json',
    workspaceRegistry: 'contracts/workspace-registry.v1.json',
    workspaceRunLast: 'contracts/workspace-run-last.v1.json',
    workspaceShareBundle: 'contracts/workspace-share-bundle.v1.json',
    autopilotRelease: 'contracts/autopilot-release.v1.json',
    workspaceList: 'contracts/workspace-list.v1.json',
    workspaceSync: 'contracts/workspace-sync.v1.json',
    compatibilityMatrix: 'contracts/compatibility-matrix.v1.json',
    mcpDesign: 'contracts/workspace-intelligence/mcp-design.v1.json',
    agentHooks: 'contracts/workspace-intelligence/agent-hooks.v1.json',
    projectArchive: 'contracts/project-archive.v1.json',
    workspaceSnapshot: 'contracts/workspace-snapshot.v1.json',
    workspaceSnapshotV2: 'contracts/workspace-snapshot.v2.json',
    infraPlan: 'contracts/infra-plan.v1.json',
    privateProductManifest: 'contracts/private-product-manifest.v1.json',
    productFactoryPlan: 'contracts/product-factory-plan.v1.json',
    workspaceModelCache: 'contracts/workspace-model-cache.v1.json',
    workspaceWatchEvent: 'contracts/workspace-watch-event.v1.json',
    doctorProjectScan: 'contracts/doctor-project-scan.v2.json',
    doctorWorkspaceCache: 'contracts/doctor-workspace-cache.v2.json',
  };

  return Object.fromEntries(
    Object.entries(versions).map(([id, schemaVersion]) => {
      const contractPath = paths[id as keyof typeof versions];
      return [
        id,
        {
          schemaVersion,
          contractPath,
          publication: contractPath
            ? id === 'runtimeCommandSurface' ||
              id === 'cliRuntimeCommandInventory' ||
              id.endsWith('Capabilities') ||
              id.endsWith('Snapshot') ||
              id === 'extensionCliCompatibility' ||
              id === 'moduleLayout' ||
              id === 'moduleSupport'
              ? 'capability-contract'
              : 'json-schema'
            : 'embedded-type',
          ...(id === 'workspaceIntelligenceArtifacts'
            ? {
                artifacts: Object.fromEntries(
                  Object.keys(WORKSPACE_INTELLIGENCE_ARTIFACTS).map((artifactId) => [
                    artifactId,
                    {
                      path: WORKSPACE_INTELLIGENCE_ARTIFACTS[
                        artifactId as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACTS
                      ],
                      schemaVersion:
                        WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[
                          artifactId as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS
                        ],
                      contractPath:
                        WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[
                          artifactId as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS
                        ],
                    },
                  ])
                ),
              }
            : {}),
        } satisfies PublishedContractDescriptor,
      ];
    })
  );
}

export function buildPublishedContractCatalog() {
  return {
    schemaVersion: PUBLISHED_CONTRACT_CATALOG_SCHEMA_VERSION,
    contracts: getPublishedContractCatalog(),
  };
}

export type PublishedContractVersions = ReturnType<typeof getPublishedContractVersions>;
