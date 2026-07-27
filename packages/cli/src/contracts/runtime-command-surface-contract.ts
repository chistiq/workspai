import { listFrontendGenerators } from '../frontend-project.js';
import {
  buildCreatePlannerCapabilitiesContract,
  type CreatePlannerCapabilitiesContract,
} from './create-planner-capabilities-contract.js';
import { KIT_REGISTRY } from '../utils/kit-registry.js';
import {
  RUNTIME_SURFACE_CORE_PROJECT_COMMANDS,
  RUNTIME_SURFACE_GLOBAL_COMMANDS,
  RUNTIME_SURFACE_LIFECYCLE_COMMANDS,
  RUNTIME_SURFACE_MODULE_MUTATION_COMMANDS,
  RUNTIME_SURFACE_UNIVERSAL_COMMANDS,
} from '../utils/project-command-capabilities.js';
import {
  NPM_ONLY_SCOPED_COMMANDS,
  NPM_ONLY_TOP_LEVEL_COMMANDS,
} from '../utils/cli-command-surface.js';
import { RUNTIME_SUPPORT_MATRIX } from '../utils/support-matrix.js';
import {
  WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
  WORKSPACE_SUBCOMMANDS,
} from '../utils/workspace-command-surface.js';
import {
  WORKSPACE_ARCHIVE_CAPABILITIES_CONTRACT_PATH,
  WORKSPACE_ARCHIVE_CAPABILITIES_SCHEMA_VERSION,
  WORKSPACE_ARCHIVE_CLI_FLAGS,
} from './workspace-archive-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ROOT_COMMANDS,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
} from './workspace-intelligence-runtime-registry.js';
import {
  CLI_OPERATION_RESULT_CONTRACT_PATH,
  CLI_OPERATION_RESULT_SCHEMA_VERSION,
} from './cli-operation-result-contract.js';
import { WORKSPACE_ARTIFACT_CONTRACTS } from './artifact-contract-registry.js';
import { AGENT_ACTION_OUTCOME_SCHEMA_VERSION } from './agent-action-outcome-contract.js';
import {
  WORKSPACE_ACTION_CONTRACTS,
  workspaceActionFlagDescription,
} from './workspace-action-contract.js';

export const RUNTIME_COMMAND_SURFACE_SCHEMA_VERSION = 'rapidkit-runtime-command-surface-v1';

export type RuntimeCommandDocumentation = {
  invocation: string;
  summary: string;
  canonicalArgv: string[];
  input?: {
    transport: 'stdin';
    mediaType: 'application/json';
    required: boolean;
    schemaVersion: string;
    contractPath: string;
  };
  output?: {
    defaultFormat: 'human-or-json' | 'raw-text';
    modes?: Array<{
      selector: string;
      format: 'json' | 'raw-text';
      mediaType:
        | 'application/json'
        | 'application/x-ndjson'
        | 'application/ld+json'
        | 'application/graphml+xml'
        | 'application/gexf+xml'
        | 'text/vnd.graphviz'
        | 'text/vnd.mermaid';
    }>;
  };
  exitSemantics?: {
    default: string;
    strict: string;
    failure: string;
  };
};

export type RuntimeCommandSurfaceContract = {
  schemaVersion: string;
  lifecycleCommands: string[];
  moduleMutationCommands: string[];
  globalCommands: string[];
  universalCommands: string[];
  coreProjectCommands: string[];
  npmOwnedTopLevelCommands: string[];
  npmOwnedScopedCommands: string[][];
  commandDocumentation: RuntimeCommandDocumentation[];
  artifactContracts: Array<{
    artifactPath: string;
    schemaVersion: string | number;
    contractPath: string;
    producerCommands: string[][];
  }>;
  workspaceSubcommands: string[];
  workspaceActions: Array<{
    id: string;
    usage: string;
    summary: string;
    options: Array<{ flag: string; description: string }>;
    subactions: string[];
    artifact: string | null;
    examples: string[];
  }>;
  workspaceIntelligenceSubcommands: string[];
  workspaceIntelligenceRootCommands: string[];
  workspaceIntelligenceExecution: Array<{
    id: string;
    argv: string[];
    produces: Array<{
      path: string;
      schemaVersion: string | null;
      contractPath: string | null;
    }>;
  }>;
  jsonOperationResult: { schemaVersion: string; contractPath: string };
  workspaceArchive: {
    schemaVersion: string;
    contractPath: string;
    commands: string[];
    flags: string[];
  };
  moduleSuggestionFrameworks: string[];
  moduleUnsupportedFrameworks: string[];
  scaffoldKits: string[];
  createPlanner: {
    lanes: CreatePlannerCapabilitiesContract['lanes'];
    nativeCreateKits: string[];
    officialCreate: string[];
    existingRuntimeSignals: string[];
  };
  runtimeMatrix: Record<
    string,
    {
      tier: string;
      scaffold: boolean;
      import: boolean;
      moduleCommands: boolean;
      doctor: string;
      lifecycleCommands: string[];
    }
  >;
};

const COMMAND_SUMMARIES: Readonly<Record<string, string>> = {
  add: 'Add a supported module or capability to the active project through its runtime adapter.',
  adopt:
    'Register an existing local repository as a governed Workspai project without recreating its source.',
  ai: 'Manage AI configuration, recommendations, and embedding operations for the active workspace.',
  'ai generate-embeddings':
    'Generate the initial semantic embedding index from the current project or workspace sources.',
  'ai recommend':
    'Recommend relevant modules or actions from the detected project context and configured AI provider.',
  'ai update-embeddings':
    'Refresh the semantic embedding index after source or workspace context changes.',
  analyze:
    'Evaluate workspace evidence and produce governance findings for downstream readiness and release decisions.',
  'analyze --json':
    'Emit the workspace analysis result as structured JSON for CI and contract-aware consumers.',
  autopilot:
    'Coordinate supported automated governance actions while preserving explicit evidence and release gates.',
  'autopilot release':
    'Build a governed release proposal from current analysis, readiness, and verification evidence.',
  bootstrap:
    'Establish the selected workspace profile, toolchain, and dependency baseline before project execution.',
  build: 'Run the detected project build lifecycle through the owning runtime adapter.',
  cache: 'Inspect or clear Workspai cache entries used by workspace and project operations.',
  checkpoint:
    'Capture a named project or workspace checkpoint that can anchor later comparison or recovery.',
  commands:
    'Publish the installed CLI command inventory, ownership boundaries, aliases, options, and integrity verdict.',
  config:
    'Manage persisted Workspai CLI and provider configuration for the current user environment.',
  'config ai': 'Inspect or update the active AI provider, model, and embedding configuration.',
  'config remove-api-key': 'Remove a persisted provider API key from Workspai configuration.',
  'config set-api-key': 'Store a provider API key for authenticated AI operations.',
  'config show': 'Display the effective Workspai configuration with secret values protected.',
  create:
    'Create a supported workspace, project, or module through the canonical planner and generator boundary.',
  dev: 'Run the detected project development lifecycle with its runtime-specific development command.',
  diff: 'Compare governed project state against a selected baseline and report the observed changes.',
  docs: 'Generate or validate documentation through the detected project documentation lifecycle.',
  doctor:
    'Diagnose the active project or workspace and produce actionable findings with evidence-backed remediation guidance.',
  'doctor workspace':
    'Diagnose cross-project workspace health, contracts, policies, toolchains, and operational evidence.',
  'doctor workspace --json':
    'Emit workspace Doctor findings as structured evidence for verification and automation consumers.',
  format:
    'Run the detected project formatter while respecting workspace policy and runtime ownership.',
  frameworks: 'List scaffold frameworks and kits currently supported by the installed CLI.',
  help: 'Display contextual CLI usage, arguments, options, and command discovery guidance.',
  import:
    'Copy or clone an existing project into the workspace and register its detected runtime capabilities.',
  info: 'Report detected project, runtime, workspace, and toolchain information for the current scope.',
  infra:
    'Manage governed infrastructure planning and lifecycle operations for the active workspace.',
  'infra down': 'Stop the workspace infrastructure stack and optionally remove governed volumes.',
  'infra status':
    'Inspect infrastructure service state and expose a strict machine-checkable status verdict.',
  'infra up': 'Start the workspace infrastructure stack from its governed configuration.',
  init: 'Initialize dependencies and required setup for the active project or complete workspace scope.',
  license: 'Inspect or validate the effective Workspai license and feature entitlement state.',
  lint: 'Run the detected project lint lifecycle under workspace compatibility and policy gates.',
  list: 'List detected or registered resources for the current command scope.',
  merge:
    'Combine supported governed configuration or project state through the owning runtime operation.',
  mirror:
    'Manage local package or dependency mirrors used by offline and controlled development workflows.',
  'mirror status': 'Inspect mirror configuration, lock state, and cached artifact inventory.',
  'mirror sync': 'Synchronize governed mirror artifacts and publish integrity evidence.',
  modules: 'List supported project modules and their runtime-specific capability state.',
  optimize: 'Apply supported project optimization operations through the detected runtime adapter.',
  pipeline:
    'Run the governance pipeline from sync and diagnostics through analysis, readiness, verification, and optional release automation.',
  product: 'Manage governed product manifests and factory planning operations.',
  'product manifest': 'Inspect or create the product manifest that defines product factory inputs.',
  'project archive':
    'Move a project into governed archive storage while preserving registry metadata and recovery evidence.',
  'project archives': 'List governed project archives and their available restoration metadata.',
  'project commands':
    'Discover commands supported by the selected project runtime and its current capability tier.',
  'project coverage':
    'Run or inspect runtime-native test coverage and publish normalized, project-scoped evidence against an explicit target.',
  'project workspace':
    'Resolve or repair the machine-local binding from the current project to its canonical Workspai workspace.',
  'project workspace status':
    'Validate and report the canonical workspace currently bound to a Workspai project.',
  'project workspace relink':
    'Rebuild the machine-local project binding after validating canonical workspace contract membership.',
  'project delete':
    'Delete a registered project through guarded workspace safety and recovery checks.',
  'project restore':
    'Restore an archived project to its workspace path and reconcile registry ownership.',
  readiness:
    'Evaluate whether current workspace evidence satisfies release-readiness requirements and blockers.',
  'readiness --json':
    'Emit the release-readiness verdict, blockers, and evidence references as structured JSON.',
  'readiness --json --skip-verify':
    'Refresh pre-verification readiness evidence without consuming a verify artifact from an earlier chain run.',
  reconcile:
    'Reconcile detected project or workspace state with its governed metadata and registered configuration.',
  rollback:
    'Restore supported generated or governed state to the previous recorded operation boundary.',
  setup:
    'Install or validate runtime-specific prerequisites required by the selected workspace profile.',
  shell: 'Open a workspace-aware shell with resolved project, runtime, and toolchain context.',
  snapshot:
    'Manage governed workspace recovery snapshots independently from Workspace Intelligence model baselines.',
  'snapshot inspect':
    'Inspect snapshot metadata, contents, and recovery compatibility without restoring it.',
  'snapshot restore': 'Restore a governed snapshot through the workspace recovery boundary.',
  start: 'Run the detected project production or service-start lifecycle command.',
  test: 'Run the detected project test lifecycle under workspace compatibility and policy gates.',
  uninstall:
    'Remove a supported module, tool, or generated integration through its owning operation.',
  upgrade: 'Upgrade supported Workspai-managed dependencies or generated project capabilities.',
  version: 'Report the installed CLI version and published contract compatibility metadata.',
  workspace:
    'Dispatch workspace discovery, intelligence, governance, portability, and fleet lifecycle operations.',
  'workspace agent-sync':
    'Project current workspace context into governed agent instructions, reports, skills, and integration files.',
  'workspace agent-sync --write':
    'Publish the governed agent surface generation as a recoverable workspace transaction.',
  'workspace agent-sync --write --json --preset enterprise':
    'Generate the enterprise agent-grounding pack, persist every governed artifact, and emit a structured result.',
  'workspace context':
    'Build a scoped workspace context projection from the current model and evidence for human or agent consumption.',
  'workspace context --for-agent --json --write --no-agent-sync':
    'Persist structured agent context without mutating downstream agent instruction surfaces.',
  'workspace contract verify --strict --json':
    'Strictly validate workspace contracts and emit a structured evidence artifact that blocks on violations.',
  'workspace contract sync':
    'Reconcile discovered projects into the canonical workspace contract and registry summary.',
  'workspace diff':
    'Compare the current canonical workspace model with a snapshot or source-control baseline.',
  'workspace diff --from .workspai/reports/workspace-model-snapshot.json --json':
    'Compute structured model changes from the canonical snapshot artifact for downstream impact analysis.',
  'workspace explain':
    'Explain a workspace relationship, project, or blocker from traceable model and evidence references.',
  'workspace explain release-blocked --json --write':
    'Persist a structured explanation of release blockers and the evidence that caused the verdict.',
  'workspace feedback record --json':
    'Validate an agent action outcome from stdin and append it to governed Workspace Intelligence history.',
  'workspace impact':
    'Calculate the blast radius of a workspace diff across projects, dependencies, tests, policies, and gates.',
  'workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --json':
    'Compute structured impact evidence from the latest canonical workspace model diff artifact.',
  'workspace model':
    'Discover and normalize workspace entities, relationships, ownership, runtime, contract, and evidence state.',
  'workspace intelligence':
    'Run the canonical Workspace Intelligence dependency graph as one evidence-coherent operation.',
  'workspace intelligence run':
    'Execute every required Workspace Intelligence stage in dependency order and persist one authoritative run result.',
  'workspace model --json --write':
    'Persist the canonical workspace model and emit the same versioned representation as JSON.',
  'workspace verify':
    'Combine impact, diagnostics, contracts, analysis, and readiness evidence into a governed verification verdict.',
  'workspace verify --from-impact .workspai/reports/workspace-impact-last-run.json --json':
    'Verify the latest impact artifact and append the structured outcome to Workspace Intelligence history.',
  'workspace list':
    'List registered workspaces through the canonical workspace discovery boundary.',
  'workspace sync':
    'Reconcile registered projects and workspace identity with the current filesystem state.',
  'workspace registry': 'Inspect and maintain the canonical workspace registry boundary.',
  'workspace foundation':
    'Inspect or establish the foundational metadata required by workspace operations.',
  'workspace snapshot':
    'Capture a versioned workspace or model baseline for comparison and recovery.',
  'workspace graph':
    'Query or export the evidence-backed workspace graph derived from the canonical model.',
  'workspace watch': 'Observe relevant workspace changes and publish versioned watch events.',
  'workspace remediation-plan':
    'Generate a structured remediation plan from current workspace evidence.',
  'workspace why': 'Explain why a relationship, verdict, or workspace fact exists.',
  'workspace trace': 'Trace a change or finding through its evidence and dependency relationships.',
  'workspace feedback': 'Record structured feedback about Workspace Intelligence output.',
  'workspace eval':
    'Measure model usage, agent activity, cost provenance, and verified task outcomes without storing prompt or response bodies.',
  'workspace eval init':
    'Initialize one live, versioned Workspace Intelligence evaluation run for a fixed task and retrieval strategy.',
  'workspace eval record --json':
    'Validate one privacy-bounded usage or outcome event from stdin and append it to the live evaluation artifact.',
  'workspace eval report --json':
    'Finalize the live evaluation into an authoritative last-run report for IDE, CI, and comparison consumers.',
  'workspace mcp': 'Expose Workspace Intelligence through the MCP integration boundary.',
  'workspace policy': 'Inspect or update workspace governance policy.',
  'workspace contract': 'Inspect and verify explicit workspace contracts.',
  'workspace share': 'Prepare a governed workspace sharing surface.',
  'workspace export': 'Export workspace intelligence into a portable consumer representation.',
  'workspace archive': 'Create or inspect a governed workspace archive.',
  'workspace hydrate': 'Restore or materialize workspace state from a portable representation.',
  'workspace import': 'Attach an existing project or repository to the workspace inventory.',
  'workspace run': 'Run a supported lifecycle command across registered workspace projects.',
  'workspace init': 'Initialize workspace and project dependencies through the shared init flow.',
  'ai info': 'Report the active AI provider, model, and embedding configuration.',
  'snapshot list': 'List governed workspace snapshots available for inspection or recovery.',
  'doctor project': 'Diagnose the current project and emit structured project evidence.',
  project: 'Expose project-scoped command discovery, archive, restore, and deletion operations.',
  'infra plan': 'Generate a versioned infrastructure plan without applying infrastructure changes.',
  'product plan': 'Generate a product factory plan from the current product definition.',
  'product manifest create': 'Create a governed product manifest for product planning operations.',
  'snapshot create': 'Create a governed workspace snapshot for comparison or recovery.',
};

const COMMAND_DOCUMENTATION_OVERRIDES: Readonly<
  Record<string, Omit<RuntimeCommandDocumentation, 'invocation' | 'summary'>>
> = {
  'workspace feedback': {
    canonicalArgv: ['workspace', 'feedback', 'record', '--json'],
    input: {
      transport: 'stdin',
      mediaType: 'application/json',
      required: true,
      schemaVersion: AGENT_ACTION_OUTCOME_SCHEMA_VERSION,
      contractPath: 'contracts/workspace-intelligence/agent-action-outcome.v1.json',
    },
    output: {
      defaultFormat: 'human-or-json',
      modes: [{ selector: '--json', format: 'json', mediaType: 'application/json' }],
    },
  },
  'workspace eval': {
    canonicalArgv: ['workspace', 'eval', 'status', '--json'],
    input: {
      transport: 'stdin',
      mediaType: 'application/json',
      required: false,
      schemaVersion: 'model-usage-event.v1',
      contractPath: 'contracts/workspace-intelligence/model-usage-event.v1.json',
    },
    output: {
      defaultFormat: 'human-or-json',
      modes: [
        {
          selector: 'init <task> [strategy] --json',
          format: 'json',
          mediaType: 'application/json',
        },
        { selector: 'record --json', format: 'json', mediaType: 'application/json' },
        { selector: 'status --json', format: 'json', mediaType: 'application/json' },
        { selector: 'report --json', format: 'json', mediaType: 'application/json' },
        {
          selector: 'compare --from <report> --json',
          format: 'json',
          mediaType: 'application/json',
        },
      ],
    },
  },
  'workspace graph': {
    canonicalArgv: ['workspace', 'graph', 'emit', '--json'],
    output: {
      defaultFormat: 'human-or-json',
      modes: [
        {
          selector: 'search <query> --limit <count> --json',
          format: 'json',
          mediaType: 'application/json',
        },
        {
          selector: 'benchmark <query> --limit <count> --json',
          format: 'json',
          mediaType: 'application/json',
        },
        { selector: 'emit --json', format: 'json', mediaType: 'application/json' },
        { selector: 'explain <project> --json', format: 'json', mediaType: 'application/json' },
        { selector: 'entities [kind] --json', format: 'json', mediaType: 'application/json' },
        {
          selector: 'evidence <id-or-unique-label> --json',
          format: 'json',
          mediaType: 'application/json',
        },
        { selector: 'path <from> <to> --json', format: 'json', mediaType: 'application/json' },
        {
          selector: 'overlay --from <graph> --json',
          format: 'json',
          mediaType: 'application/json',
        },
        { selector: 'dot', format: 'raw-text', mediaType: 'text/vnd.graphviz' },
        { selector: 'mermaid', format: 'raw-text', mediaType: 'text/vnd.mermaid' },
        { selector: 'jsonld', format: 'raw-text', mediaType: 'application/ld+json' },
        { selector: 'graphml', format: 'raw-text', mediaType: 'application/graphml+xml' },
        { selector: 'gexf', format: 'raw-text', mediaType: 'application/gexf+xml' },
      ],
    },
  },
  'workspace watch': {
    canonicalArgv: ['workspace', 'watch', '--json'],
    output: {
      defaultFormat: 'human-or-json',
      modes: [
        { selector: '--json', format: 'json', mediaType: 'application/x-ndjson' },
        {
          selector: '--graph-stream --json',
          format: 'json',
          mediaType: 'application/x-ndjson',
        },
      ],
    },
  },
  pipeline: {
    canonicalArgv: ['pipeline', '--json'],
    output: {
      defaultFormat: 'human-or-json',
      modes: [{ selector: '--json', format: 'json', mediaType: 'application/json' }],
    },
    exitSemantics: {
      default: 'Warning-only pipeline reports are advisory and return exit code 0.',
      strict: 'With --strict, warning-only pipeline reports return a non-zero exit code.',
      failure: 'Execution failures and failed stages return a non-zero exit code in every mode.',
    },
  },
};

function commandSummary(invocation: string): string {
  const curated = COMMAND_SUMMARIES[invocation];
  if (curated) return curated;
  throw new Error(
    `Runtime command ${invocation} is missing a command-specific summary. ` +
      'Every published command must explain its own operational role.'
  );
}

function buildCommandDocumentation(
  invocations: readonly string[]
): RuntimeCommandSurfaceContract['commandDocumentation'] {
  return [...new Set(invocations)]
    .sort((left, right) => left.localeCompare(right))
    .map((invocation) => ({
      invocation,
      summary: commandSummary(invocation),
      ...COMMAND_DOCUMENTATION_OVERRIDES[invocation],
      canonicalArgv:
        COMMAND_DOCUMENTATION_OVERRIDES[invocation]?.canonicalArgv ?? invocation.split(/\s+/),
    }));
}

const MODULE_UNSUPPORTED_BACKEND_FRAMEWORKS = ['go', 'springboot', 'dotnet'] as const;

/** Stable scaffold kit ordering shared with rapidkit-vscode package.json enum */
const CANONICAL_BACKEND_KIT_ORDER = [
  'fastapi.standard',
  'fastapi.ddd',
  'nestjs.standard',
  'gofiber.standard',
  'gogin.standard',
  'springboot.standard',
  'dotnet.webapi.clean',
] as const;

function buildScaffoldKits(): string[] {
  const registryScaffoldKits = KIT_REGISTRY.filter(
    (kit) => kit.owner === 'core' || kit.generator
  ).map((kit) => kit.id);
  const registrySet = new Set(registryScaffoldKits);
  const backendKits = [
    ...CANONICAL_BACKEND_KIT_ORDER.filter((kitId) => registrySet.has(kitId)),
    ...registryScaffoldKits.filter(
      (kitId) =>
        !CANONICAL_BACKEND_KIT_ORDER.includes(kitId as (typeof CANONICAL_BACKEND_KIT_ORDER)[number])
    ),
  ];
  const frontendKits = listFrontendGenerators().map((definition) => definition.kitId);
  return [...backendKits, ...frontendKits];
}

function buildModuleSuggestionFrameworks(): string[] {
  const seen = new Set<string>();
  const frameworks: string[] = [];
  for (const kit of KIT_REGISTRY) {
    if (!kit.moduleSupport) {
      continue;
    }
    const scaffoldFramework =
      kit.framework === 'gofiber' || kit.framework === 'gogin' || kit.framework === 'echo'
        ? 'go'
        : kit.framework === 'springboot'
          ? 'springboot'
          : kit.framework === 'dotnet'
            ? 'dotnet'
            : kit.framework === 'fastapi'
              ? 'fastapi'
              : kit.framework === 'nestjs'
                ? 'nestjs'
                : String(kit.framework);
    if (!seen.has(scaffoldFramework)) {
      seen.add(scaffoldFramework);
      frameworks.push(scaffoldFramework);
    }
  }
  return frameworks;
}

function buildModuleUnsupportedFrameworks(): string[] {
  const frontendScaffoldIds = listFrontendGenerators().map((definition) => definition.id);
  return [...MODULE_UNSUPPORTED_BACKEND_FRAMEWORKS, ...frontendScaffoldIds];
}

function buildRuntimeMatrix(): RuntimeCommandSurfaceContract['runtimeMatrix'] {
  const matrix: RuntimeCommandSurfaceContract['runtimeMatrix'] = {};

  for (const [runtime, entry] of Object.entries(RUNTIME_SUPPORT_MATRIX)) {
    matrix[runtime] = {
      tier: entry.tier,
      scaffold: entry.scaffoldSupport,
      import: entry.importSupport,
      moduleCommands: entry.moduleCommands,
      doctor: entry.doctorSupport,
      lifecycleCommands: [...entry.lifecycleCommands],
    };
  }

  return matrix;
}

export function buildRuntimeCommandSurfaceContract(): RuntimeCommandSurfaceContract {
  const createPlanner = buildCreatePlannerCapabilitiesContract();
  const intelligenceExecutions = Object.entries(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS).map(
    ([id, step]) => ({ id, step })
  );
  const commandInvocations = [
    ...RUNTIME_SURFACE_LIFECYCLE_COMMANDS,
    ...RUNTIME_SURFACE_MODULE_MUTATION_COMMANDS,
    ...RUNTIME_SURFACE_GLOBAL_COMMANDS,
    ...RUNTIME_SURFACE_UNIVERSAL_COMMANDS,
    ...RUNTIME_SURFACE_CORE_PROJECT_COMMANDS,
    ...NPM_ONLY_TOP_LEVEL_COMMANDS,
    ...NPM_ONLY_SCOPED_COMMANDS.map((command) => command.join(' ')),
    'workspace',
    ...WORKSPACE_SUBCOMMANDS.map((command) => `workspace ${command}`),
    ...WORKSPACE_INTELLIGENCE_ROOT_COMMANDS,
    ...intelligenceExecutions.map(({ step }) => step.command.join(' ')),
    ...Object.values(WORKSPACE_ARTIFACT_CONTRACTS).flatMap((descriptor) =>
      descriptor.producerCommands.map((command) => command.join(' '))
    ),
  ];
  return {
    schemaVersion: RUNTIME_COMMAND_SURFACE_SCHEMA_VERSION,
    lifecycleCommands: [...RUNTIME_SURFACE_LIFECYCLE_COMMANDS],
    moduleMutationCommands: [...RUNTIME_SURFACE_MODULE_MUTATION_COMMANDS],
    globalCommands: [...RUNTIME_SURFACE_GLOBAL_COMMANDS],
    universalCommands: [...RUNTIME_SURFACE_UNIVERSAL_COMMANDS],
    coreProjectCommands: [...RUNTIME_SURFACE_CORE_PROJECT_COMMANDS],
    npmOwnedTopLevelCommands: [...NPM_ONLY_TOP_LEVEL_COMMANDS],
    npmOwnedScopedCommands: NPM_ONLY_SCOPED_COMMANDS.map((command) => [...command]),
    commandDocumentation: buildCommandDocumentation(commandInvocations),
    artifactContracts: Object.values(WORKSPACE_ARTIFACT_CONTRACTS).map((descriptor) => ({
      artifactPath: descriptor.artifactPath,
      schemaVersion: descriptor.schemaVersion,
      contractPath: descriptor.contractPath,
      producerCommands: descriptor.producerCommands.map((command) => [...command]),
    })),
    workspaceSubcommands: [...WORKSPACE_SUBCOMMANDS],
    workspaceActions: WORKSPACE_SUBCOMMANDS.map((id) => {
      const descriptor = WORKSPACE_ACTION_CONTRACTS[id];
      return {
        id,
        usage: descriptor.usage,
        summary: descriptor.summary,
        options: descriptor.flags.map((flag) => ({
          flag,
          description: workspaceActionFlagDescription(flag),
        })),
        subactions: 'subactions' in descriptor ? [...descriptor.subactions] : [],
        artifact: 'artifact' in descriptor ? descriptor.artifact : null,
        examples: [...descriptor.examples],
      };
    }),
    workspaceIntelligenceSubcommands: [...WORKSPACE_INTELLIGENCE_SUBCOMMANDS],
    workspaceIntelligenceRootCommands: [...WORKSPACE_INTELLIGENCE_ROOT_COMMANDS],
    workspaceIntelligenceExecution: intelligenceExecutions.map(({ id, step }) => ({
      id,
      argv: [...step.command],
      produces: step.produces.map((artifactPath) => {
        const matchedId = Object.entries(WORKSPACE_INTELLIGENCE_ARTIFACTS).find(
          ([, candidatePath]) => candidatePath === artifactPath
        )?.[0] as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS | undefined;
        return {
          path: artifactPath,
          schemaVersion: matchedId ? WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[matchedId] : null,
          contractPath: matchedId
            ? WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[matchedId]
            : null,
        };
      }),
    })),
    jsonOperationResult: {
      schemaVersion: CLI_OPERATION_RESULT_SCHEMA_VERSION,
      contractPath: CLI_OPERATION_RESULT_CONTRACT_PATH,
    },
    workspaceArchive: {
      schemaVersion: WORKSPACE_ARCHIVE_CAPABILITIES_SCHEMA_VERSION,
      contractPath: WORKSPACE_ARCHIVE_CAPABILITIES_CONTRACT_PATH,
      commands: ['export', 'inspect', 'verify', 'doctor', 'hydrate'],
      flags: Object.values(WORKSPACE_ARCHIVE_CLI_FLAGS).map((flag) => flag.signature),
    },
    moduleSuggestionFrameworks: buildModuleSuggestionFrameworks(),
    moduleUnsupportedFrameworks: buildModuleUnsupportedFrameworks(),
    scaffoldKits: buildScaffoldKits(),
    createPlanner: {
      lanes: createPlanner.lanes,
      nativeCreateKits: createPlanner.nativeCreate.map((entry) => entry.id),
      officialCreate: createPlanner.officialCreate.map((entry) => entry.id),
      existingRuntimeSignals: [...createPlanner.existingRuntimeSignals],
    },
    runtimeMatrix: buildRuntimeMatrix(),
  };
}
