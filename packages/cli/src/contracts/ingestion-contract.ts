export const INGESTION_PLAN_SCHEMA_VERSION = 'workspai.ingestion-plan.v1' as const;
export const INGESTION_RESULT_SCHEMA_VERSION = 'workspai.ingestion-result.v1' as const;
export const ADOPT_EFFECTS_SCHEMA_VERSION = 'workspai.adopt-effects.v1' as const;
export const INGESTION_PLAN_CONTRACT_PATH = 'contracts/ingestion-plan.v1.json' as const;
export const INGESTION_RESULT_CONTRACT_PATH = 'contracts/ingestion-result.v1.json' as const;
export const ADOPT_EFFECTS_CONTRACT_PATH = 'contracts/adopt-effects.v1.json' as const;

export type IngestionAction =
  | 'adopt-project'
  | 'import-project'
  | 'connect-workspace'
  | 'import-workspace'
  | 'hydrate-workspace';
export type IngestionResourceKind = 'project' | 'workspace';
export type IngestionSourceKind = 'local-folder' | 'git-url' | 'archive';
export type IngestionMode = 'link' | 'copy' | 'clone' | 'hydrate';
export type IngestionOwnership = 'external' | 'workspace-owned' | 'materialized';
export type IngestionRegistration = 'project' | 'workspace' | 'none';

export interface IngestionPlan {
  schemaVersion: typeof INGESTION_PLAN_SCHEMA_VERSION;
  action: IngestionAction;
  resourceKind: IngestionResourceKind;
  sourceKind: IngestionSourceKind;
  mode: IngestionMode;
  ownership: IngestionOwnership;
  registration: IngestionRegistration;
  source: string;
  targetWorkspace?: string;
  destination?: string;
  projectGrounding?: 'managed' | 'local' | 'off';
}

export interface IngestionResult {
  schemaVersion: typeof INGESTION_RESULT_SCHEMA_VERSION;
  status: 'passed' | 'preview' | 'failed';
  plan: IngestionPlan;
  workspacePath?: string;
  projectPath?: string;
  writtenFiles: string[];
  registered: boolean;
  verified: boolean;
  warnings: string[];
}

export interface AdoptProjectEffects {
  schemaVersion: typeof ADOPT_EFFECTS_SCHEMA_VERSION;
  sourceMode: 'linked';
  sourceCodeModified: false;
  projectMetadataFiles: string[];
  repositoryControlFiles: Array<{
    path: string;
    action: 'reconcile';
    condition: string;
  }>;
  workspaceOperations: Array<
    | 'register-project'
    | 'sync-contract'
    | 'rebuild-model'
    | 'rebuild-graph'
    | 'sync-agent-grounding'
  >;
}

export function buildIngestionPlan(input: Omit<IngestionPlan, 'schemaVersion'>): IngestionPlan {
  return { schemaVersion: INGESTION_PLAN_SCHEMA_VERSION, ...input };
}

export function buildIngestionPlanSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/ingestion-plan.v1.json',
    title: 'Workspai Ingestion Plan v1',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'action',
      'resourceKind',
      'sourceKind',
      'mode',
      'ownership',
      'registration',
      'source',
    ],
    properties: {
      schemaVersion: { const: INGESTION_PLAN_SCHEMA_VERSION },
      action: {
        enum: [
          'adopt-project',
          'import-project',
          'connect-workspace',
          'import-workspace',
          'hydrate-workspace',
        ],
      },
      resourceKind: { enum: ['project', 'workspace'] },
      sourceKind: { enum: ['local-folder', 'git-url', 'archive'] },
      mode: { enum: ['link', 'copy', 'clone', 'hydrate'] },
      ownership: { enum: ['external', 'workspace-owned', 'materialized'] },
      registration: { enum: ['project', 'workspace', 'none'] },
      source: { type: 'string', minLength: 1 },
      targetWorkspace: { type: 'string', minLength: 1 },
      destination: { type: 'string', minLength: 1 },
      projectGrounding: { enum: ['managed', 'local', 'off'] },
    },
  };
}

export function buildIngestionResultSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/ingestion-result.v1.json',
    title: 'Workspai Ingestion Result v1',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'status',
      'plan',
      'writtenFiles',
      'registered',
      'verified',
      'warnings',
    ],
    properties: {
      schemaVersion: { const: INGESTION_RESULT_SCHEMA_VERSION },
      status: { enum: ['passed', 'preview', 'failed'] },
      plan: { $ref: 'https://workspai.dev/contracts/ingestion-plan.v1.json' },
      workspacePath: { type: 'string', minLength: 1 },
      projectPath: { type: 'string', minLength: 1 },
      writtenFiles: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        uniqueItems: true,
      },
      registered: { type: 'boolean' },
      verified: { type: 'boolean' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

export function buildAdoptEffectsSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/adopt-effects.v1.json',
    title: 'Workspai Adopt Effects v1',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'sourceMode',
      'sourceCodeModified',
      'projectMetadataFiles',
      'repositoryControlFiles',
      'workspaceOperations',
    ],
    properties: {
      schemaVersion: { const: ADOPT_EFFECTS_SCHEMA_VERSION },
      sourceMode: { const: 'linked' },
      sourceCodeModified: { const: false },
      projectMetadataFiles: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        uniqueItems: true,
      },
      repositoryControlFiles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'action', 'condition'],
          properties: {
            path: { type: 'string', minLength: 1 },
            action: { const: 'reconcile' },
            condition: { type: 'string', minLength: 1 },
          },
        },
      },
      workspaceOperations: {
        type: 'array',
        items: {
          enum: [
            'register-project',
            'sync-contract',
            'rebuild-model',
            'rebuild-graph',
            'sync-agent-grounding',
          ],
        },
        uniqueItems: true,
      },
    },
  };
}
