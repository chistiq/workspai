import {
  buildProjectEntryCapabilityContract,
  type ProjectEntryCapabilityContract,
} from './project-entry-capability-contract.js';
import { buildRuntimeCommandSurfaceContract } from './runtime-command-surface-contract.js';
import {
  buildWorkspaceIntelligenceChainContract,
  WORKSPACE_INTELLIGENCE_CHAIN_CONTRACT_PATH,
  WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
} from './workspace-intelligence-chain-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
} from './workspace-intelligence-runtime-registry.js';

export const WORKSPACE_INTELLIGENCE_ARCHITECTURE_SCHEMA_VERSION =
  'workspai-workspace-intelligence-architecture-v1';

type ContractStatus = 'available' | 'planned';

export type WorkspaceIntelligenceArchitectureContract = {
  schemaVersion: string;
  name: string;
  canonicalPositioning: {
    tagline: string;
    category: string;
    primaryPromise: string;
    mentalModel: string[];
  };
  workspaceLifecycle: ReturnType<
    typeof buildWorkspaceIntelligenceChainContract
  >['workspaceLifecycle'];
  observedInputs: ReturnType<
    typeof buildWorkspaceIntelligenceChainContract
  >['boundaries']['inputs'];
  outputFamilies: ReturnType<
    typeof buildWorkspaceIntelligenceChainContract
  >['boundaries']['outputs'];
  deliveryChannels: ReturnType<typeof buildWorkspaceIntelligenceChainContract>['deliveryChannels'];
  feedback: ReturnType<typeof buildWorkspaceIntelligenceChainContract>['feedback'];
  auxiliaryCapabilities: ReturnType<
    typeof buildWorkspaceIntelligenceChainContract
  >['auxiliaryCapabilities'];
  architectureCore: {
    executionChainContract: {
      schemaVersion: string;
      path: string;
    };
    loop: Array<{
      id: string;
      status: ContractStatus;
      purpose: string;
      commands: string[];
      artifacts: string[];
    }>;
    evidencePrinciples: string[];
    modelGraphRelationship: {
      direction: 'workspace-sources -> workspace-model -> workspace-knowledge-graph';
      canonicalAuthority: {
        artifact: (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['model'];
        schemaVersion: (typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS)['model'];
      };
      derivedRepresentation: {
        artifact: (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['knowledgeGraph'];
        schemaVersion: (typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS)['knowledgeGraph'];
      };
      sourceBinding: {
        kind: 'workspace-model';
        artifact: (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['model'];
        hashAlgorithm: 'sha256';
        hashSemantics: 'stable structural model projection';
      };
      inventoryRule: 'reconcile discovered, imported, adopted, and contract-declared projects';
      missingProjectRule: 'preserve a contract-declared missing project as a validation warning';
      topologyRule: 'knowledge graph project topology must match the canonical model topology';
      publication: 'one locked rollback-capable artifact transaction';
      mutationRule: 'knowledge graph enrichment never mutates the authorizing model during a run';
      staleConsumerRule: 'reject a graph whose source binding does not match the current model';
    };
  };
  consumers: Array<{
    id: string;
    status: ContractStatus;
    consumes: string[];
    allowedClaims: string[];
  }>;
  claimBoundaries: {
    allowed: string[];
    forbiddenUnlessImplemented: string[];
  };
  createPlannerReality: {
    nativeCreateKits: string[];
    officialCreate: string[];
    existingRuntimeSignals: string[];
  };
  projectEntryCapability: ProjectEntryCapabilityContract;
  futureExtensions: Array<{
    id: string;
    status: ContractStatus;
    claimRule: string;
  }>;
};

export function buildWorkspaceIntelligenceArchitectureContract(): WorkspaceIntelligenceArchitectureContract {
  const runtimeSurface = buildRuntimeCommandSurfaceContract();
  const chain = buildWorkspaceIntelligenceChainContract();
  const projectEntryCapability = buildProjectEntryCapabilityContract();

  return {
    schemaVersion: WORKSPACE_INTELLIGENCE_ARCHITECTURE_SCHEMA_VERSION,
    name: 'Workspace Intelligence Architecture',
    canonicalPositioning: {
      tagline: 'Open-Source Workspace Intelligence for Software Systems',
      category: 'Workspace Intelligence',
      primaryPromise:
        'Workspai turns repositories, projects, dependencies, rules, changes, and evidence into shared understanding for developers, CI, IDEs, and AI agents.',
      mentalModel: [
        'Repositories · Projects · Dependencies · Changes',
        'Workspace Intelligence',
        'Evidence-backed outputs',
        'Developers · CI · IDEs · AI agents',
      ],
    },
    workspaceLifecycle: chain.workspaceLifecycle,
    observedInputs: chain.boundaries.inputs,
    outputFamilies: chain.boundaries.outputs,
    deliveryChannels: chain.deliveryChannels,
    feedback: chain.feedback,
    auxiliaryCapabilities: chain.auxiliaryCapabilities,
    architectureCore: {
      executionChainContract: {
        schemaVersion: WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
        path: WORKSPACE_INTELLIGENCE_CHAIN_CONTRACT_PATH,
      },
      loop: chain.steps.map((step) => ({
        id: step.id,
        status: 'available' as const,
        purpose: step.purpose,
        commands: [step.command.join(' ')],
        artifacts: [...step.produces],
      })),
      evidencePrinciples: [
        'Evidence is the source of understanding; documentation is an output, not the authority.',
        'Facts should be marked or treated as verified, observed, inferred, or unknown based on available evidence.',
        'Marketing and integration surfaces must not claim native, doctor depth, module support, or agent grounding beyond the generated contracts.',
      ],
      modelGraphRelationship: {
        direction: 'workspace-sources -> workspace-model -> workspace-knowledge-graph',
        canonicalAuthority: {
          artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
          schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model,
        },
        derivedRepresentation: {
          artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph,
          schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph,
        },
        sourceBinding: {
          kind: 'workspace-model',
          artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
          hashAlgorithm: 'sha256',
          hashSemantics: 'stable structural model projection',
        },
        inventoryRule: 'reconcile discovered, imported, adopted, and contract-declared projects',
        missingProjectRule: 'preserve a contract-declared missing project as a validation warning',
        topologyRule: 'knowledge graph project topology must match the canonical model topology',
        publication: 'one locked rollback-capable artifact transaction',
        mutationRule: 'knowledge graph enrichment never mutates the authorizing model during a run',
        staleConsumerRule: 'reject a graph whose source binding does not match the current model',
      },
    },
    consumers: [
      {
        id: 'developers',
        status: 'available',
        consumes: [
          'workspace model',
          'doctor evidence',
          'explain/trace narratives',
          'workspace run results',
        ],
        allowedClaims: [
          'Developers can inspect structure, context, impact, verification, and remediation evidence from one workspace model.',
        ],
      },
      {
        id: 'ci',
        status: 'available',
        consumes: [
          'pipeline',
          'readiness',
          'workspace verify',
          'doctor workspace/project evidence',
        ],
        allowedClaims: [
          'CI can gate release readiness and workspace verification through structured JSON reports and exit codes.',
        ],
      },
      {
        id: 'ides-and-extensions',
        status: 'available',
        consumes: [
          'runtime-command-surface.v1.json',
          'workspace registry',
          'agent customization pack',
        ],
        allowedClaims: [
          'IDEs can discover supported command surfaces and consume shared contracts instead of parsing help text.',
        ],
      },
      {
        id: 'ai-agents',
        status: 'available',
        consumes: ['workspace context', 'AGENTS.md', 'skills index', 'MCP evidence tools'],
        allowedClaims: [
          'AI agents can use generated grounding artifacts and MCP access to work from evidence-backed workspace context.',
        ],
      },
      {
        id: 'docs-and-marketing',
        status: 'available',
        consumes: [
          'this architecture contract',
          'project-entry-capability.v1.json',
          'runtime-command-surface.v1.json',
          'create-planner-capabilities.v1.json',
        ],
        allowedClaims: [
          'Public messaging can describe the architecture as inputs -> Workspace Intelligence -> consumers.',
        ],
      },
    ],
    claimBoundaries: {
      allowed: [
        'Open-Source Workspace Intelligence for Software Systems.',
        'One shared model of structure, context, impact, and verification.',
        'Workspai can create projects only for native kits and available official generator paths listed in the create planner contract.',
        'Any readable project can enter Workspace Intelligence through adopt/import when it can be registered.',
        'Existing projects can enter Workspace Intelligence through adopt/import when they are readable and can be registered, even when native scaffold is unavailable.',
        'Existing runtime signals in the create planner are examples for detection, not a closed allowlist of adopt/import support.',
        'Agent grounding is available through workspace context, agent-sync, generated agent files, skills index, and MCP evidence access.',
        'Verification and governance claims must reference doctor, analyze, readiness, pipeline, workspace verify, or generated evidence artifacts.',
      ],
      forbiddenUnlessImplemented: [
        'Do not claim native scaffolding for every language or framework.',
        'Do not claim module commands are supported for runtimes where moduleSupport/moduleCommands are false.',
        'Do not claim a chat UI or repository chat exists in the CLI unless a shipped command or product surface implements it.',
        'Do not present inferred or unknown facts as verified evidence.',
        'Do not describe documentation as the source of truth; documentation must be described as generated from evidence.',
      ],
    },
    createPlannerReality: {
      nativeCreateKits: runtimeSurface.createPlanner.nativeCreateKits,
      officialCreate: runtimeSurface.createPlanner.officialCreate,
      existingRuntimeSignals: runtimeSurface.createPlanner.existingRuntimeSignals,
    },
    projectEntryCapability,
    futureExtensions: [],
  };
}
