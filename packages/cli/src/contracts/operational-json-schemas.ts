import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
} from './workspace-intelligence-runtime-registry.js';

type JsonSchema = Record<string, unknown>;

export const OPERATIONAL_JSON_SCHEMA_VERSIONS = {
  autopilotRelease: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.autopilotReleaseLastRun.schemaVersion,
  workspaceList: 'rapidkit-workspace-list-v1',
  workspaceSync: 'rapidkit-workspace-sync-v1',
  compatibilityMatrix: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.compatibilityMatrix.schemaVersion,
  mcpDesign: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaiMcpDesign.schemaVersion,
  agentHooks: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.agentHooks.schemaVersion,
  projectArchive: 'rapidkit-project-archive-v1',
  workspaceSnapshot: 'rapidkit-workspace-snapshot-v1',
  workspaceSnapshotV2: 'rapidkit-workspace-snapshot-v2',
  infraPlan: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.infraPlan.schemaVersion,
  privateProductManifest: 'rapidkit.private-product-manifest.v1',
  productFactoryPlan: 'rapidkit.product-factory-plan.v1',
  workspaceModelCache: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceModelCache.schemaVersion,
  workspaceWatchEvent: 'workspace-watch-event.v1',
  doctorProjectScan: 'doctor-project-scan-v2',
  doctorWorkspaceCache:
    WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.doctorWorkspaceCache.schemaVersion,
} as const;

const OPERATIONAL_JSON_SCHEMA_TITLES: Record<string, string> = {
  'autopilot-release.v1.json': 'Workspai Autopilot Release Evidence',
  'workspace-list.v1.json': 'Workspai Workspace List',
  'workspace-sync.v1.json': 'Workspai Workspace Sync Evidence',
  'compatibility-matrix.v1.json': 'Workspai Compatibility Matrix',
  'workspace-intelligence/mcp-design.v1.json': 'Workspai MCP Design',
  'workspace-intelligence/agent-hooks.v1.json': 'Workspai Agent Hooks',
  'project-archive.v1.json': 'Workspai Project Archive Manifest',
  'workspace-snapshot.v1.json': 'Workspai Workspace Snapshot v1',
  'workspace-snapshot.v2.json': 'Workspai Workspace Snapshot v2',
  'infra-plan.v1.json': 'Workspai Infrastructure Plan',
  'private-product-manifest.v1.json': 'Workspai Private Product Manifest',
  'product-factory-plan.v1.json': 'Workspai Product Factory Plan',
  'workspace-model-cache.v1.json': 'Workspai Workspace Model Cache',
  'workspace-watch-event.v1.json': 'Workspai Workspace Watch Event',
  'doctor-project-scan.v2.json': 'Workspai Doctor Project Scan',
  'doctor-workspace-cache.v2.json': 'Workspai Doctor Workspace Cache',
};

function objectSchema(
  schemaVersion: string,
  required: string[],
  properties: JsonSchema
): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['schemaVersion', ...required],
    properties: { schemaVersion: { const: schemaVersion }, ...properties },
    additionalProperties: true,
  };
}

function legacySchemaObject(
  schema: string,
  required: string[],
  properties: JsonSchema
): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['schema', ...required],
    properties: { schema: { const: schema }, ...properties },
    additionalProperties: false,
  };
}

export function buildOperationalJsonSchemas(): Record<string, JsonSchema> {
  const versions = OPERATIONAL_JSON_SCHEMA_VERSIONS;
  const schemas = {
    'autopilot-release.v1.json': objectSchema(
      versions.autopilotRelease,
      [
        'generatedAt',
        'workspacePath',
        'mode',
        'summary',
        'stages',
        'blockingReasons',
        'nextActions',
        'artifacts',
      ],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        workspacePath: { type: 'string', minLength: 1 },
        mode: { enum: ['audit', 'safe-fix', 'enforce'] },
        summary: {
          type: 'object',
          required: [
            'releaseScore',
            'verdict',
            'blockers',
            'warnings',
            'safeFixesApplied',
            'manualActions',
            'exitCode',
          ],
          properties: {
            releaseScore: { type: 'number', minimum: 0, maximum: 100 },
            verdict: { enum: ['approved', 'blocked', 'partial'] },
            blockers: { type: 'integer', minimum: 0 },
            warnings: { type: 'integer', minimum: 0 },
            safeFixesApplied: { type: 'integer', minimum: 0 },
            manualActions: { type: 'integer', minimum: 0 },
            exitCode: { enum: [0, 1, 2, 3] },
          },
          additionalProperties: false,
        },
        stages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'status', 'durationMs', 'summary'],
            properties: {
              name: {
                enum: [
                  'doctor-workspace',
                  'analyze',
                  'readiness',
                  'remediation-plan',
                  'remediation-apply',
                  'workspace-run-test-build',
                ],
              },
              status: { enum: ['pass', 'warn', 'fail', 'skipped'] },
              durationMs: { type: 'number', minimum: 0 },
              summary: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        blockingReasons: { type: 'array', items: { type: 'string' } },
        warningReasons: { type: 'array', items: { type: 'string' } },
        nextActions: { type: 'array', items: { type: 'string' } },
        artifacts: {
          type: 'object',
          required: ['reportPath'],
          properties: {
            reportPath: { type: 'string', minLength: 1 },
            aliasEvidencePath: { type: 'string', minLength: 1 },
            analyzeEvidencePath: { type: 'string', minLength: 1 },
            readinessEvidencePath: { type: 'string', minLength: 1 },
            workspaceRunEvidencePath: { type: 'string', minLength: 1 },
            workspaceRunTestPath: { type: 'string', minLength: 1 },
            workspaceRunBuildPath: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
        enterpriseControls: {
          type: 'object',
          required: ['jsonReady', 'evidencePath', 'aliasEvidencePath'],
          properties: {
            jsonReady: { type: 'boolean' },
            evidencePath: { type: 'string', minLength: 1 },
            aliasEvidencePath: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      }
    ),
    'workspace-list.v1.json': objectSchema(
      versions.workspaceList,
      ['registryPath', 'workspaces', 'summary'],
      {
        registryPath: { type: 'string', minLength: 1 },
        workspaces: { type: 'array', items: { type: 'object' } },
        summary: {
          type: 'object',
          required: ['total', 'missing', 'registryExists', 'registryValid', 'cleanupApplied'],
          properties: {
            total: { type: 'integer', minimum: 0 },
            missing: { type: 'integer', minimum: 0 },
            registryExists: { type: 'boolean' },
            registryValid: { type: 'boolean' },
            cleanupApplied: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      }
    ),
    'workspace-sync.v1.json': objectSchema(
      versions.workspaceSync,
      ['workspacePath', 'registry', 'contractSynced', 'registrySummary'],
      {
        workspacePath: { type: 'string', minLength: 1 },
        registry: { type: 'object' },
        contractSynced: { type: 'boolean' },
        registrySummary: { type: 'object' },
      }
    ),
    'compatibility-matrix.v1.json': objectSchema(
      versions.compatibilityMatrix,
      ['generatedAt', 'source', 'runtimes', 'notes'],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        source: { type: 'string', minLength: 1 },
        runtimes: { type: 'object', additionalProperties: { type: 'object' } },
        notes: { type: 'array', items: { type: 'string' } },
      }
    ),
    'workspace-intelligence/mcp-design.v1.json': objectSchema(
      versions.mcpDesign,
      ['generatedAt', 'workspaceRoot', 'status', 'mode', 'safety', 'candidateTools'],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        workspaceRoot: { type: 'string', minLength: 1 },
        status: { const: 'design-only' },
        mode: { const: 'read-mostly' },
        safety: { type: 'object' },
        candidateTools: { type: 'array', items: { type: 'object' } },
      }
    ),
    'workspace-intelligence/agent-hooks.v1.json': objectSchema(
      versions.agentHooks,
      ['generatedAt', 'workspaceRoot', 'enabledByDefault', 'mode', 'hooks'],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        workspaceRoot: { type: 'string', minLength: 1 },
        enabledByDefault: { type: 'boolean' },
        mode: { const: 'advisory' },
        hooks: { type: 'array', items: { type: 'object' } },
      }
    ),
    'project-archive.v1.json': legacySchemaObject(
      versions.projectArchive,
      ['projectName', 'originalPath', 'archivedPath', 'archivedAt'],
      {
        projectName: { type: 'string', minLength: 1 },
        originalPath: { type: 'string', minLength: 1 },
        archivedPath: { type: 'string', minLength: 1 },
        reason: { type: 'string' },
        archivedAt: { type: 'string', format: 'date-time' },
        safetySnapshotPath: { type: 'string', minLength: 1 },
      }
    ),
    'workspace-snapshot.v1.json': legacySchemaObject(
      versions.workspaceSnapshot,
      ['name', 'mode', 'createdAt', 'workspaceName', 'workspacePath', 'copiedPaths', 'projects'],
      {
        name: { type: 'string', minLength: 1 },
        mode: { enum: ['metadata', 'full'] },
        reason: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        workspaceName: { type: 'string', minLength: 1 },
        workspacePath: { type: 'string', minLength: 1 },
        copiedPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
        projects: { type: 'array', items: { type: 'object' } },
      }
    ),
    'workspace-snapshot.v2.json': legacySchemaObject(
      versions.workspaceSnapshotV2,
      [
        'name',
        'mode',
        'createdAt',
        'workspaceName',
        'workspacePath',
        'copiedPaths',
        'projects',
        'recoveryScope',
      ],
      {
        name: { type: 'string', minLength: 1 },
        mode: { const: 'project' },
        reason: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        workspaceName: { type: 'string', minLength: 1 },
        workspacePath: { type: 'string', minLength: 1 },
        copiedPaths: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        projects: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: {
            type: 'object',
            required: ['name', 'relativePath'],
            properties: {
              name: { type: 'string', minLength: 1 },
              relativePath: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        recoveryScope: {
          type: 'object',
          required: ['kind', 'projectName', 'relativePath'],
          properties: {
            kind: { const: 'project' },
            projectName: { type: 'string', minLength: 1 },
            relativePath: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      }
    ),
    'infra-plan.v1.json': objectSchema(
      versions.infraPlan,
      [
        'generatedAt',
        'workspacePath',
        'strategy',
        'composePath',
        'envExamplePath',
        'services',
        'connectionEnv',
        'sources',
        'warnings',
      ],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        workspacePath: { type: 'string', minLength: 1 },
        workspaceName: { type: 'string', minLength: 1 },
        contractPath: { type: 'string', minLength: 1 },
        strategy: { const: 'sidecar' },
        composePath: { type: 'string', minLength: 1 },
        envExamplePath: { type: 'string', minLength: 1 },
        services: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'displayName', 'category', 'image', 'ports', 'sources'],
            properties: {
              id: { type: 'string', minLength: 1 },
              displayName: { type: 'string', minLength: 1 },
              category: { type: 'string', minLength: 1 },
              image: { type: 'string', minLength: 1 },
              ports: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'host', 'container'],
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    host: { type: 'integer', minimum: 1, maximum: 65535 },
                    container: { type: 'integer', minimum: 1, maximum: 65535 },
                  },
                  additionalProperties: false,
                },
              },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['kind', 'value'],
                  properties: {
                    kind: { enum: ['module', 'env-var', 'override', 'contract-env'] },
                    value: { type: 'string', minLength: 1 },
                    project: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
        connectionEnv: { type: 'object', additionalProperties: { type: 'string' } },
        sources: {
          type: 'object',
          required: ['modules', 'envVars', 'overrides'],
          properties: {
            modules: { type: 'array', items: { type: 'string' } },
            envVars: { type: 'array', items: { type: 'string' } },
            overrides: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        warnings: { type: 'array', items: { type: 'string' } },
        serviceEnvOverrides: {
          type: 'object',
          additionalProperties: { type: 'object', additionalProperties: { type: 'string' } },
        },
      }
    ),
    'private-product-manifest.v1.json': objectSchema(
      versions.privateProductManifest,
      ['generatedAt', 'product', 'workspace', 'projects', 'factory'],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        product: {
          type: 'object',
          required: ['rank', 'slug', 'title', 'category', 'tier', 'summary'],
          properties: {
            rank: { type: 'number' },
            slug: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            category: { type: 'string', minLength: 1 },
            tier: { type: 'string', minLength: 1 },
            summary: { type: 'string' },
          },
          additionalProperties: false,
        },
        workspace: {
          type: 'object',
          required: ['name', 'profile', 'outputHint'],
          properties: {
            name: { type: 'string', minLength: 1 },
            profile: { const: 'enterprise' },
            outputHint: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
        projects: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: {
            type: 'object',
            required: ['slug', 'kit', 'runtime', 'framework', 'modules', 'moduleGaps'],
            properties: {
              slug: { const: 'api' },
              kit: { type: 'string', minLength: 1 },
              runtime: { const: 'python' },
              framework: { const: 'fastapi' },
              modules: { type: 'array', items: { type: 'string' } },
              moduleGaps: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
        factory: {
          type: 'object',
          required: [
            'sourceBacklogPath',
            'manifestChecksum',
            'requiredCommands',
            'releaseEvidencePath',
          ],
          properties: {
            sourceBacklogPath: { type: 'string', minLength: 1 },
            manifestChecksum: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            requiredCommands: { type: 'array', items: { type: 'string', minLength: 1 } },
            releaseEvidencePath: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      }
    ),
    'product-factory-plan.v1.json': objectSchema(
      versions.productFactoryPlan,
      ['generatedAt', 'source', 'defaults', 'stats', 'products'],
      {
        generatedAt: { type: 'string', format: 'date-time' },
        source: {
          type: 'object',
          required: ['backlogPath', 'backlogSchemaVersion', 'purpose', 'publicationRule'],
          properties: {
            backlogPath: { type: 'string', minLength: 1 },
            backlogSchemaVersion: { type: ['string', 'null'] },
            purpose: { type: ['string', 'null'] },
            publicationRule: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        defaults: {
          type: 'object',
          required: ['kit', 'workspaceProfile', 'projectSlug'],
          properties: {
            kit: { type: 'string', minLength: 1 },
            workspaceProfile: { const: 'enterprise' },
            projectSlug: { const: 'api' },
          },
          additionalProperties: false,
        },
        stats: {
          type: 'object',
          required: [
            'totalProducts',
            'plannedProducts',
            'readyProducts',
            'blockedProducts',
            'uniqueModules',
            'knownModuleGaps',
          ],
          properties: {
            totalProducts: { type: 'integer', minimum: 0 },
            plannedProducts: { type: 'integer', minimum: 0 },
            readyProducts: { type: 'integer', minimum: 0 },
            blockedProducts: { type: 'integer', minimum: 0 },
            uniqueModules: { type: 'integer', minimum: 0 },
            knownModuleGaps: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
        products: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'rank',
              'slug',
              'title',
              'category',
              'tier',
              'summary',
              'modules',
              'moduleGaps',
              'recommendedKit',
              'workspaceProfile',
              'readiness',
            ],
            properties: {
              rank: { type: 'number' },
              slug: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              category: { type: 'string', minLength: 1 },
              tier: { type: 'string', minLength: 1 },
              summary: { type: 'string' },
              modules: { type: 'array', items: { type: 'string' } },
              moduleGaps: { type: 'array', items: { type: 'string' } },
              recommendedKit: { type: 'string', minLength: 1 },
              workspaceProfile: { const: 'enterprise' },
              readiness: {
                type: 'object',
                required: ['status', 'blockingGaps'],
                properties: {
                  status: { enum: ['ready-for-private-manifest', 'blocked-by-module-gaps'] },
                  blockingGaps: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
      }
    ),
    'workspace-model-cache.v1.json': objectSchema(
      versions.workspaceModelCache,
      ['cliVersion', 'inputsHash', 'generatedAt', 'model'],
      {
        cliVersion: { type: 'string', minLength: 1 },
        inputsHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        generatedAt: { type: 'string', format: 'date-time' },
        model: {
          type: 'object',
          required: ['schemaVersion'],
          properties: {
            schemaVersion: { const: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model },
          },
          additionalProperties: true,
        },
        projectSignatures: {
          type: 'object',
          additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
        workspaceFileSignatures: {
          type: 'object',
          additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        },
      }
    ),
    'workspace-watch-event.v1.json': objectSchema(
      versions.workspaceWatchEvent,
      [
        'kind',
        'sequence',
        'timestamp',
        'mode',
        'modelHash',
        'modelHashChanged',
        'changedProjects',
        'addedProjects',
        'removedProjects',
        'graph',
        'durationMs',
      ],
      {
        kind: { enum: ['ready', 'changed', 'unchanged', 'error'] },
        sequence: { type: 'integer', minimum: -1 },
        timestamp: { type: 'string', format: 'date-time' },
        mode: { enum: ['initial', 'full', 'incremental', 'unchanged'] },
        modelHash: { type: 'string', pattern: '^(?:[a-f0-9]{64})?$' },
        modelHashChanged: { type: 'boolean' },
        changedProjects: { type: 'array', items: { type: 'string' } },
        addedProjects: { type: 'array', items: { type: 'string' } },
        removedProjects: { type: 'array', items: { type: 'string' } },
        graph: {
          type: 'object',
          required: ['nodeCount', 'edgeCount', 'edgesAdded', 'edgesRemoved'],
          properties: {
            nodeCount: { type: 'integer', minimum: 0 },
            edgeCount: { type: 'integer', minimum: 0 },
            edgesAdded: { type: 'array', items: { type: 'object' } },
            edgesRemoved: { type: 'array', items: { type: 'object' } },
          },
          additionalProperties: false,
        },
        durationMs: { type: 'number', minimum: 0 },
        error: { type: 'string' },
      }
    ),
    'doctor-project-scan.v2.json': objectSchema(
      versions.doctorProjectScan,
      ['name', 'path', 'venvActive', 'depsInstalled', 'coreInstalled', 'issues'],
      {
        name: { type: 'string', minLength: 1 },
        path: { type: 'string', minLength: 1 },
        venvActive: { type: 'boolean' },
        depsInstalled: { type: 'boolean' },
        coreInstalled: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
        fixCommands: { type: 'array', items: { type: 'string' } },
        runtimeFamily: { type: 'string' },
        projectKind: { type: 'string' },
        probes: { type: 'array', items: { type: 'object' } },
      }
    ),
    'doctor-workspace-cache.v2.json': objectSchema(
      versions.doctorWorkspaceCache,
      ['signature', 'generatedAt', 'projects'],
      {
        signature: { type: 'string', minLength: 1 },
        generatedAt: { type: 'string', format: 'date-time' },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'path', 'venvActive', 'depsInstalled', 'coreInstalled', 'issues'],
            properties: {
              name: { type: 'string', minLength: 1 },
              path: { type: 'string', minLength: 1 },
              venvActive: { type: 'boolean' },
              depsInstalled: { type: 'boolean' },
              coreInstalled: { type: 'boolean' },
              issues: { type: 'array', items: { type: 'string' } },
              fixCommands: { type: 'array', items: { type: 'string' } },
              runtimeFamily: { type: 'string' },
              projectKind: { type: 'string' },
              probes: { type: 'array', items: { type: 'object' } },
            },
            additionalProperties: true,
          },
        },
      }
    ),
  };
  return Object.fromEntries(
    Object.entries(schemas).map(([fileName, schema]) => {
      const { $schema, ...schemaBody } = schema;
      return [
        fileName,
        {
          $schema,
          $id: `https://workspai.dev/schemas/${fileName}`,
          title: OPERATIONAL_JSON_SCHEMA_TITLES[fileName],
          ...schemaBody,
        },
      ];
    })
  );
}
