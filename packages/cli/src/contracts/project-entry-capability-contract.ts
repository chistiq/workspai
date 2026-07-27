export const PROJECT_ENTRY_CAPABILITY_SCHEMA_VERSION = 'workspai-project-entry-capability-v1';

type ContractStatus = 'available' | 'planned';

export type ProjectEntryCapabilityContract = {
  schemaVersion: typeof PROJECT_ENTRY_CAPABILITY_SCHEMA_VERSION;
  name: string;
  plainLanguageRule: string;
  entryRoutes: Array<{
    id: 'create' | 'adopt' | 'import';
    status: ContractStatus;
    purpose: string;
    commands: string[];
  }>;
  universalExistingProjectEntry: {
    status: 'available';
    appliesTo: string[];
    minimumConditions: string[];
    doesNotRequire: string[];
    result: string[];
  };
  supportDepths: Array<{
    id: string;
    label: string;
    meaning: string;
    examples: string[];
  }>;
  runtimeSignals: {
    purpose: string;
    examples: string[];
    rule: string;
  };
  boundaries: {
    allowedClaims: string[];
    forbiddenClaims: string[];
  };
};

export function buildProjectEntryCapabilityContract(): ProjectEntryCapabilityContract {
  return {
    schemaVersion: PROJECT_ENTRY_CAPABILITY_SCHEMA_VERSION,
    name: 'Project Entry Capability',
    plainLanguageRule:
      'Any readable project can enter Workspace Intelligence through adopt/import. Runtime-specific detection improves understanding depth; it is not the permission gate.',
    entryRoutes: [
      {
        id: 'create',
        status: 'available',
        purpose:
          'Start a new project only through native kits or available official generator paths listed in the create planner contract.',
        commands: ['create workspace', 'create project'],
      },
      {
        id: 'adopt',
        status: 'available',
        purpose:
          'Register an existing local project in place without moving or rewriting its source.',
        commands: ['adopt'],
      },
      {
        id: 'import',
        status: 'available',
        purpose: 'Copy a local project or clone a repository into workspace-owned source.',
        commands: ['import'],
      },
    ],
    universalExistingProjectEntry: {
      status: 'available',
      appliesTo: [
        'any readable repository',
        'any readable local project folder',
        'monorepos and multi-project workspaces',
        'known runtimes, unknown runtimes, and mixed stacks',
      ],
      minimumConditions: [
        'The path is readable by the CLI.',
        'The workspace can write Workspai metadata or record an external adopted path.',
        'The project can be represented with at least a name, path, and entry record.',
      ],
      doesNotRequire: [
        'native scaffold support',
        'official generator support',
        'module command support',
        'a known runtime detector',
        'moving source files into the workspace',
      ],
      result: [
        'project registry membership',
        'workspace model participation',
        'workspace context participation',
        'governance and evidence participation according to available facts',
      ],
    },
    supportDepths: [
      {
        id: 'registered',
        label: 'Registered',
        meaning:
          'The project is known to the workspace and can participate in inventory, context, and governance.',
        examples: ['unknown runtime', 'custom stack', 'legacy service'],
      },
      {
        id: 'detected',
        label: 'Detected',
        meaning:
          'The CLI recognizes runtime or framework signals and can label the project with higher confidence.',
        examples: ['node package.json', 'python pyproject.toml', 'php composer.json'],
      },
      {
        id: 'operational',
        label: 'Operational',
        meaning:
          'The CLI can infer or use lifecycle commands, health checks, or workspace run stages.',
        examples: ['test script', 'build script', 'doctor evidence'],
      },
      {
        id: 'deep',
        label: 'Deep',
        meaning:
          'The project has stack-specific module, doctor, or scaffold support beyond generic Workspace Intelligence.',
        examples: ['FastAPI module support', 'NestJS module support', 'native Workspai kit'],
      },
    ],
    runtimeSignals: {
      purpose:
        'Help the planner and model recognize common existing-project requests and improve labels.',
      examples: ['php', 'ruby', 'rust', 'elixir', 'clojure', 'scala', 'kotlin'],
      rule: 'Runtime signals are examples for detection and messaging, not a closed allowlist for adopt/import.',
    },
    boundaries: {
      allowedClaims: [
        'Any readable project can enter Workspace Intelligence through adopt/import when it can be registered.',
        'Known runtime and framework detectors improve confidence and depth, but unknown projects can still be registered.',
        'Create support is limited to native kits and available official generator paths in the create planner contract.',
      ],
      forbiddenClaims: [
        'Do not say adopt/import supports only the listed runtime signals.',
        'Do not say every imported project receives deep runtime-specific module support.',
        'Do not say Workspai can natively scaffold every language or framework.',
      ],
    },
  };
}
