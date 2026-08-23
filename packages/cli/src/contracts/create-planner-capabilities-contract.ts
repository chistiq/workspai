import {
  OFFICIAL_CREATE_CANDIDATES,
  resolveCreatePlannerCapability,
  type CreatePlannerLane,
  type CreatePlannerStatus,
} from '../utils/create-planner-capabilities.js';
import { listInteractiveKits } from '../utils/kit-registry.js';
import { WORKSPACE_PROFILE_DEFINITIONS } from '../workspace-profile-compatibility.js';

export const CREATE_PLANNER_CAPABILITIES_SCHEMA_VERSION = 'rapidkit-create-planner-capabilities-v1';

export type CreatePlannerCapabilitiesContract = {
  schemaVersion: typeof CREATE_PLANNER_CAPABILITIES_SCHEMA_VERSION;
  lanes: Record<
    CreatePlannerLane,
    {
      status: CreatePlannerStatus;
      meaning: string;
    }
  >;
  nativeCreate: Array<{
    id: string;
    runtime: string;
    framework: string;
    plannerFramework: string;
    category: string;
    owner: string;
    stability: string;
    versionPolicy: 'tested-baseline';
    moduleSupport: boolean;
    workspacePythonEngine: 'required' | 'optional' | 'none';
  }>;
  officialCreate: Array<{
    id: string;
    aliases: string[];
    ecosystem: string;
    plannerFramework: string;
    runtime: string;
    runtimeCandidates: string[];
    workspacePythonEngine: 'none';
    category: string;
    status: CreatePlannerStatus;
    canExecuteCreate: boolean;
    versionPolicy: 'latest-stable' | 'planned';
    officialCommands: string[];
    adoptAfterCreate: true;
    runtimeRequirements?: Record<string, string>;
  }>;
  existingRuntimeSignals: string[];
  workspaceProfiles: Array<{
    id: string;
    runtimePolicy: 'single-detected' | 'bounded' | 'multi-runtime';
    runtimeFamilies: string[];
    setupRuntimeFamilies: string[];
    pythonEngineAtCreate: 'skipped' | 'optional-default-install';
    pythonEngineAtBootstrap: 'disabled' | 'on-demand';
  }>;
  lifecycle: {
    automatic: string[];
    explicit: string[];
  };
  productRules: string[];
};

function plannerFrameworkForNativeKit(kit: ReturnType<typeof listInteractiveKits>[number]): string {
  if (kit.runtime === 'go') return 'go';
  if (kit.runtime === 'rust') return 'rust';
  return kit.framework;
}

export function buildCreatePlannerCapabilitiesContract(): CreatePlannerCapabilitiesContract {
  const backendNative = listInteractiveKits().map((kit) => ({
    id: kit.id,
    runtime: kit.runtime,
    framework: kit.framework,
    plannerFramework: plannerFrameworkForNativeKit(kit),
    category: kit.category,
    owner: kit.owner,
    stability: kit.stability,
    versionPolicy: kit.versionPolicy,
    moduleSupport: kit.moduleSupport,
    workspacePythonEngine: kit.workspacePythonEngine,
  }));
  const existingRuntimeSignals = ['php', 'ruby', 'rust', 'elixir', 'clojure', 'scala', 'kotlin'];

  return {
    schemaVersion: CREATE_PLANNER_CAPABILITIES_SCHEMA_VERSION,
    lanes: {
      native: {
        status: 'available',
        meaning:
          'Workspai owns the scaffold contract, marker, registry, doctor, bootstrap, and workspace model path.',
      },
      official: {
        status: 'available',
        meaning:
          'A stable ecosystem generator exists. Available entries run the official generator and then register the project; planned entries fall back to adopt/import.',
      },
      existing: {
        status: 'available',
        meaning:
          'The project enters Workspace Intelligence through import/adopt, not native create.',
      },
    },
    nativeCreate: [...backendNative],
    officialCreate: OFFICIAL_CREATE_CANDIDATES.map((candidate) => ({
      ...candidate,
      category: candidate.id.startsWith('frontend.')
        ? 'frontend'
        : candidate.id.startsWith('desktop.')
          ? 'desktop'
          : candidate.id.startsWith('extension.')
            ? 'extension'
            : 'backend',
      officialCommands: [...candidate.officialCommands],
      aliases: [...candidate.aliases],
      runtimeCandidates: [...candidate.runtimeCandidates],
    })),
    existingRuntimeSignals,
    workspaceProfiles: WORKSPACE_PROFILE_DEFINITIONS.map((profile) => ({
      ...profile,
      runtimeFamilies: [...profile.runtimeFamilies],
      setupRuntimeFamilies: [...profile.setupRuntimeFamilies],
    })),
    lifecycle: {
      automatic: [
        'Create the workspace foundation without installing an optional workspace Python engine unless the user explicitly selected that engine in CLI workspace creation.',
        'Run the selected native or official project generator and let that generator own project dependency installation unless --skip-install is set.',
        'Register every created project and refresh the canonical contract, model, proof-backed graph, diff, impact, agent context, grounding, and evidence index.',
      ],
      explicit: [
        'Run workspai bootstrap only when the user requests profile and project dependency initialization or a required kit reports a missing workspace engine.',
        'Run workspai workspace intelligence run --for-agent <agent> --strict for a complete evidence and verification loop.',
        'Run doctor, analyze, readiness, verify, run, Goal, and repair operations when requested by the user or the governed workflow; Create does not silently claim those gates passed.',
      ],
    },
    productRules: [
      'Do not translate unsupported stack requests into unrelated native kits.',
      'If native create is unavailable, explain the lane and guide to adopt/import.',
      'The existing lane is open-ended for readable projects; existingRuntimeSignals are examples for planner detection, not an allowlist.',
      'Use the same capability contract in CLI, CI, VS Code, and AI planning surfaces.',
      'Available official generators request the upstream latest stable channel and record that policy in project evidence.',
      'Native Workspai-owned kits use tested dependency baselines so repeated creates remain deterministic.',
      'Workspace management during project creation is foundation-only; it must not install the optional Python engine. Each selected kit owns its runtime prerequisites and install flow.',
    ],
  };
}

export function resolveContractedCreateCapability(input: {
  kitId?: string;
  framework?: string;
  runtime?: string;
  projectExists?: boolean;
}) {
  return resolveCreatePlannerCapability(input);
}
