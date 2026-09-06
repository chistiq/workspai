export const AGENT_FRAMEWORK_CAPABILITIES_SCHEMA_VERSION =
  'workspai.agent-framework-capabilities.v1' as const;
export const AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION =
  'workspai.agent-framework-adapter-manifest.v1' as const;
export const AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION =
  'workspai.agent-framework-conformance-report.v1' as const;
export const AGENT_FRAMEWORK_CHANGE_PLAN_SCHEMA_VERSION =
  'workspai.agent-framework-change-plan.v1' as const;
export const AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION =
  'workspai.agent-framework-ownership-receipt.v1' as const;
export const AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION =
  'workspai.agent-framework-admission-candidate.v1' as const;
export const AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION =
  'workspai.agent-framework-adapter-protocol.v1' as const;

export const AGENT_FRAMEWORK_CAPABILITIES_CONTRACT_PATH =
  'contracts/agent-framework-capabilities.v1.json' as const;
export const AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH =
  'contracts/workspace-intelligence/agent-framework-adapter-manifest.v1.json' as const;
export const AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH =
  'contracts/workspace-intelligence/agent-framework-conformance-report.v1.json' as const;
export const AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH =
  'contracts/workspace-intelligence/agent-framework-change-plan.v1.json' as const;
export const AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_CONTRACT_PATH =
  'contracts/workspace-intelligence/agent-framework-ownership-receipt.v1.json' as const;
export const AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH =
  'contracts/workspace-intelligence/agent-framework-admission-candidate.v1.json' as const;

export const AGENT_FRAMEWORK_CAPABILITY_IDS = [
  'single-agent',
  'multi-agent',
  'typed-tools',
  'skills',
  'handoffs',
  'explicit-workflows',
  'streaming',
  'background-execution',
  'durable-execution',
  'human-in-the-loop',
  'conversation-state',
  'memory',
  'checkpoints',
  'resume',
  'schedules',
  'channels',
  'mcp-client',
  'mcp-server',
  'telemetry',
  'evaluations',
  'provider-neutral-models',
  'local-models',
  'local-execution',
  'self-hosting',
  'managed-hosting',
] as const;

export type AgentFrameworkCapabilityId = (typeof AGENT_FRAMEWORK_CAPABILITY_IDS)[number];

export const AGENT_FRAMEWORK_CAPABILITY_SUPPORT = [
  'native',
  'adapter-provided',
  'conditional',
  'unsupported',
] as const;
export type AgentFrameworkCapabilitySupport = (typeof AGENT_FRAMEWORK_CAPABILITY_SUPPORT)[number];

export const AGENT_FRAMEWORK_UPSTREAM_STATUSES = [
  'stable',
  'beta',
  'maintenance',
  'deprecated',
] as const;

export const AGENT_FRAMEWORK_ADAPTER_STABILITIES = [
  'experimental',
  'preview',
  'stable',
  'compatibility',
  'deprecated',
] as const;

export const AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS = [
  'detect',
  'plan-scaffold',
  'plan-attach',
  'render-managed-files',
  'project-context',
  'validate',
  'resolve-runtime',
] as const;
export type AgentFrameworkAdapterOperationId =
  (typeof AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS)[number];

export const AGENT_FRAMEWORK_DETECTION_MARKER_KINDS = [
  'path',
  'file-content',
  'dependency',
] as const;
export type AgentFrameworkDetectionMarkerKind =
  (typeof AGENT_FRAMEWORK_DETECTION_MARKER_KINDS)[number];

export const AGENT_FRAMEWORK_DEPENDENCY_ECOSYSTEMS = ['npm', 'pypi', 'nuget'] as const;
export type AgentFrameworkDependencyEcosystem =
  (typeof AGENT_FRAMEWORK_DEPENDENCY_ECOSYSTEMS)[number];

export const AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS = [
  'manifest-schema',
  'protocol-version',
  'capability-truth',
  'detection-positive',
  'detection-negative',
  'scaffold-plan-safety',
  'attach-plan-safety',
  'managed-file-ownership',
  'user-file-preservation',
  'path-containment',
  'secret-non-persistence',
  'context-generation-binding',
  'mutation-gateway',
  'verification-binding',
  'failure-isolation',
  'idempotency',
  'offline-posture',
  'cross-platform-paths',
] as const;
export type AgentFrameworkConformanceCheckId =
  (typeof AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS)[number];

export type AgentFrameworkCapabilityDeclaration = {
  support: AgentFrameworkCapabilitySupport;
  evidence: string[];
  prerequisites: string[];
  limitations: string[];
};

export type AgentFrameworkDetectionMarker =
  | { id: string; kind: 'path'; path: string; weight: number }
  | {
      id: string;
      kind: 'file-content';
      path: string;
      needle: string;
      maxBytes: number;
      weight: number;
    }
  | {
      id: string;
      kind: 'dependency';
      ecosystem: AgentFrameworkDependencyEcosystem;
      name: string;
      match: 'exact' | 'prefix';
      manifestPaths: string[];
      manifestSuffixes: string[];
      searchDepth: number;
      weight: number;
    };

export type AgentFrameworkAdapterManifest = {
  schemaVersion: typeof AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION;
  protocolVersion: typeof AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION;
  adapter: {
    id: string;
    package: string;
    version: string;
    stability: (typeof AGENT_FRAMEWORK_ADAPTER_STABILITIES)[number];
  };
  framework: {
    id: string;
    name: string;
    homepage: string;
    license: string;
    upstreamStatus: (typeof AGENT_FRAMEWORK_UPSTREAM_STATUSES)[number];
    supportedVersionRange: string;
    testedVersions: string[];
  };
  implementation: {
    languages: string[];
    runtimes: string[];
    platforms: Array<'linux' | 'darwin' | 'win32'>;
    executionBoundary: 'in-process' | 'subprocess' | 'remote' | 'none';
    distribution: 'bundled' | 'optional-package' | 'external-tool';
  };
  operations: Record<
    AgentFrameworkAdapterOperationId,
    {
      supported: boolean;
      mode: 'read-only' | 'plan-only' | 'render-only' | 'resolve-only';
      limitations: string[];
    }
  >;
  capabilities: Record<AgentFrameworkCapabilityId, AgentFrameworkCapabilityDeclaration>;
  detection: {
    authoredMarkers: AgentFrameworkDetectionMarker[];
    generatedMarkers: AgentFrameworkDetectionMarker[];
    minimumAuthoredMarkers: number;
    minimumConfidence: number;
  };
  ownership: {
    canonicalTruth: 'workspai';
    runtimeState: 'framework';
    sessionState: 'framework';
    mutationAdmission: 'workspai-pcc';
    verificationOwner: 'workspai-cli';
    managedWritePolicy: 'owned-files-or-managed-sections';
    conflictPolicy: 'preserve-user-content';
    managedRoots: string[];
  };
  security: {
    secrets: 'references-only';
    network: 'deny-unless-explicitly-granted';
    generatedCodeExecution: 'disabled-unless-explicitly-granted';
    toolMutation: 'approval-required';
    untrustedInput: 'isolated';
    telemetrySensitiveData: 'redacted';
  };
  bindings: {
    contextInputs: string[];
    evidenceInputs: string[];
    mutationGateway: 'proof-carrying-change';
    verificationGateway: 'workspace-verify';
    projectionPolicy: 'references-and-bounded-projections-only';
  };
};

export type AgentFrameworkConformanceReport = {
  schemaVersion: typeof AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION;
  protocolVersion: typeof AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION;
  generatedAt: string;
  adapter: {
    id: string;
    version: string;
    manifestSha256: string;
  };
  frameworkVersion: string;
  cliVersion: string;
  environment: {
    platform: 'linux' | 'darwin' | 'win32';
    architecture: string;
    runtime: string;
    runtimeVersion: string;
  };
  checks: Array<{
    id: AgentFrameworkConformanceCheckId;
    status: 'passed' | 'failed' | 'skipped';
    required: boolean;
    summary: string;
    evidencePaths: string[];
    durationMs: number;
  }>;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    required: number;
  };
  verdict: 'admitted' | 'blocked';
  blockers: string[];
  limitations: string[];
};

export type AgentFrameworkAdmissionCandidate = {
  schemaVersion: typeof AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION;
  protocolVersion: typeof AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION;
  generatedAt: string;
  sourceCommit: string;
  cliVersion: string;
  reviewStatus: 'pending';
  adapters: Array<{
    id: string;
    version: string;
    manifestSha256: string;
    framework: { id: string };
    lanes: Array<{
      platform: 'linux' | 'darwin' | 'win32';
      runtime: string;
      runtimeVersion: string;
      frameworkVersion: string;
      report: { path: string; sha256: string };
      evidence: Array<{ path: string; sha256: string }>;
    }>;
  }>;
  verdict: 'admitted';
  blockers: [];
};

const CAPABILITY_MEANINGS: Record<AgentFrameworkCapabilityId, string> = {
  'single-agent': 'Run one agent through a declared model and bounded tool surface.',
  'multi-agent': 'Coordinate multiple named agents without hiding their ownership or handoffs.',
  'typed-tools': 'Expose tools with machine-validatable input and output contracts.',
  skills: 'Load bounded procedures or reusable instructions on demand.',
  handoffs: 'Transfer work between agents with explicit state and responsibility.',
  'explicit-workflows': 'Execute a declared graph or ordered workflow rather than an opaque loop.',
  streaming: 'Stream typed runtime events or model output.',
  'background-execution': 'Continue bounded work outside an attached interactive request.',
  'durable-execution': 'Persist enough runtime state to survive process interruption.',
  'human-in-the-loop': 'Pause at a declared boundary and resume from an explicit human decision.',
  'conversation-state':
    'Own framework conversation or thread state without becoming workspace truth.',
  memory: 'Provide framework memory with explicit scope, persistence, and retention semantics.',
  checkpoints: 'Persist resumable workflow checkpoints.',
  resume: 'Resume a prior run without silently replaying admitted effects.',
  schedules: 'Trigger declared work on a schedule.',
  channels: 'Receive and send messages through declared external channels.',
  'mcp-client': 'Consume MCP tools through an explicitly configured client boundary.',
  'mcp-server': 'Expose framework capabilities through an MCP server boundary.',
  telemetry: 'Emit correlated, redacted runtime telemetry.',
  evaluations: 'Run repeatable agent or workflow evaluations with recorded evidence.',
  'provider-neutral-models':
    'Select among multiple model providers through a stable client boundary.',
  'local-models':
    'Use a declared local model provider without claiming offline execution by default.',
  'local-execution': 'Run the framework on the user machine.',
  'self-hosting': 'Run on infrastructure controlled by the user or organization.',
  'managed-hosting': 'Deploy to an upstream or third-party managed runtime.',
};

const OPERATION_MODES: Record<
  AgentFrameworkAdapterOperationId,
  AgentFrameworkAdapterManifest['operations'][AgentFrameworkAdapterOperationId]['mode']
> = {
  detect: 'read-only',
  'plan-scaffold': 'plan-only',
  'plan-attach': 'plan-only',
  'render-managed-files': 'render-only',
  'project-context': 'resolve-only',
  validate: 'read-only',
  'resolve-runtime': 'resolve-only',
};

function strictObject(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return { type: 'object', additionalProperties: false, required, properties };
}

function stringArray(minItems = 0) {
  return { type: 'array', items: { type: 'string', minLength: 1 }, minItems, uniqueItems: true };
}

function relativePathArray(minItems = 1) {
  return {
    type: 'array',
    minItems,
    uniqueItems: true,
    items: {
      type: 'string',
      minLength: 1,
      not: {
        anyOf: [
          { pattern: '^/' },
          { pattern: '^[A-Za-z]:[\\\\/]' },
          { pattern: '(^|[\\\\/])\\.\\.([\\\\/]|$)' },
        ],
      },
    },
  };
}

function relativePathSchema() {
  return {
    type: 'string',
    minLength: 1,
    not: {
      anyOf: [
        { pattern: '^/' },
        { pattern: '^[A-Za-z]:[\\/]' },
        { pattern: '(^|[\\/])\\.\\.([\\/]|$)' },
      ],
    },
  };
}

function detectionMarkerSchema() {
  const common = {
    id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
    weight: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
  };
  return {
    oneOf: [
      strictObject({ ...common, kind: { const: 'path' }, path: relativePathSchema() }),
      strictObject({
        ...common,
        kind: { const: 'file-content' },
        path: relativePathSchema(),
        needle: { type: 'string', minLength: 1, maxLength: 256 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 1048576 },
      }),
      strictObject({
        ...common,
        kind: { const: 'dependency' },
        ecosystem: { enum: [...AGENT_FRAMEWORK_DEPENDENCY_ECOSYSTEMS] },
        name: { type: 'string', minLength: 1, maxLength: 214 },
        match: { enum: ['exact', 'prefix'] },
        manifestPaths: relativePathArray(0),
        manifestSuffixes: {
          type: 'array',
          items: { type: 'string', pattern: '^\\.[A-Za-z0-9._-]+$', maxLength: 32 },
          maxItems: 16,
          uniqueItems: true,
        },
        searchDepth: { type: 'integer', minimum: 0, maximum: 8 },
      }),
    ],
  };
}

export function buildAgentFrameworkCapabilitiesContract() {
  return {
    schemaVersion: AGENT_FRAMEWORK_CAPABILITIES_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    positioning: {
      kit: 'A user-facing, versioned scaffold that may select one framework adapter.',
      adapter:
        'A framework-specific implementation of this contract shared by create and attach flows.',
      framework:
        'The owner of agent execution, runtime state, conversations, tools, memory, and orchestration.',
      modelProvider:
        'An independently selected model service or local runtime; it is not the framework identity.',
    },
    authorities: {
      workspai: [
        'workspace model and graph truth',
        'bounded context and evidence generation',
        'Goal and impact scope',
        'mutation admission and proof-carrying change state',
        'canonical verification and evidence sealing',
        'managed-file ownership policy',
      ],
      framework: [
        'agent and workflow execution',
        'conversation, memory, checkpoint, and runtime state',
        'model invocation and framework-native tool dispatch',
        'channels, schedules, handoffs, and framework telemetry',
      ],
      human: ['risk approval', 'scope expansion decisions', 'secret and network grants'],
      forbiddenForAdapter: [
        'invent or mutate canonical Model or Graph truth',
        'turn inferred framework output into verification evidence',
        'apply source mutations outside the Workspai PCC or Repair admission boundary',
        'persist secrets, unrestricted model output, or absolute machine paths in portable artifacts',
        'overwrite user-authored files without an owned-file or managed-section lease',
      ],
    },
    capabilities: AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => ({
      id,
      meaning: CAPABILITY_MEANINGS[id],
      allowedSupport: [...AGENT_FRAMEWORK_CAPABILITY_SUPPORT],
      evidenceRequired: true,
    })),
    adapterOperations: AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS.map((id) => ({
      id,
      mode: OPERATION_MODES[id],
      directSourceMutationAllowed: false,
    })),
    detection: {
      authoredEvidenceRequired: true,
      generatedEvidenceCanConfirmButCannotSelect: true,
      literalContentMatchingOnly: true,
      boundedFileReads: true,
      ambiguousMatchesFailClosed: true,
    },
    lifecycle: [
      { id: 'understand', owner: 'workspai-cli', mutation: 'none' },
      { id: 'impact', owner: 'workspai-cli', mutation: 'none' },
      { id: 'propose', owner: 'framework', mutation: 'proposal-only' },
      { id: 'approve', owner: 'human-or-policy', mutation: 'authorization-only' },
      { id: 'execute', owner: 'workspai-cli', mutation: 'authorized-effects-only' },
      { id: 'verify', owner: 'workspai-cli', mutation: 'none' },
      { id: 'seal', owner: 'workspai-cli', mutation: 'canonical-evidence-only' },
    ],
    kitRelationship: {
      rule: 'An agent project kit declares one primary framework adapter. A workspace may host multiple separately scoped adapter instances, and cross-framework bridges must be explicit. The same adapters are reusable by existing-project attach flows.',
      workspaceAllowsMultipleScopedAdapters: true,
      implicitCrossFrameworkBridgeAllowed: false,
      frameworkIsNotModelProvider: true,
      frameworkIsNotProjectRuntime: true,
      noCoreBranchingByFrameworkId: true,
    },
    versioning: {
      adapterProtocol: 'SemVer-compatible immutable v1 envelope; breaking fields require v2.',
      upstreamFramework:
        'Agent framework kits select the latest admitted baseline, never an unchecked latest registry release. Discovery and candidate pull requests are automatic; promotion requires complete cross-platform conformance and human merge review.',
      stability: {
        experimental: 'Contract exploration only; not advertised as usable.',
        preview: 'Usable only with explicit preview selection and complete required conformance.',
        stable: 'All required conformance checks pass on the claimed platform and runtime matrix.',
        compatibility:
          'Supported for migration or maintained upstream lines; never the default new-project choice.',
        deprecated: 'Discovery and migration guidance only; new scaffold is forbidden.',
      },
    },
    security: {
      defaults: [
        'Network, generated-code execution, secrets, and mutating tools are not implicitly granted.',
        'Framework runtime state is untrusted input to canonical Workspai evidence producers.',
        'All paths are relative, containment-checked, symlink-aware, and bound to an authorized project root.',
        'Portable artifacts contain references or bounded projections, never raw secret-bearing sessions.',
        'Framework dependencies are pinned by a tested-baseline policy and audited before admission.',
        'Stable and preview release channels remain explicit and cannot be silently interchanged.',
        'Scheduled update automation executes trusted default-branch code, opens review-only pull requests, and never merges candidates.',
      ],
    },
    publication: {
      manifestSchema: AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
      conformanceSchema: AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
      changePlanSchema: AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
      ownershipReceiptSchema: AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_CONTRACT_PATH,
      admissionCandidateSchema: AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH,
      requiredChecks: [...AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS],
      stableAdmission:
        'A stable adapter requires one passed instance of every required check for each advertised platform/runtime lane and no blockers.',
    },
  };
}

export function buildAgentFrameworkAdapterManifestSchema() {
  const capability = strictObject({
    support: { enum: [...AGENT_FRAMEWORK_CAPABILITY_SUPPORT] },
    evidence: stringArray(),
    prerequisites: stringArray(),
    limitations: stringArray(),
  });
  const operationProperties = Object.fromEntries(
    AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS.map((id) => [
      id,
      strictObject({
        supported: { type: 'boolean' },
        mode: { const: OPERATION_MODES[id] },
        limitations: stringArray(),
      }),
    ])
  );
  const capabilityProperties = Object.fromEntries(
    AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => [id, capability])
  );

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/workspace-intelligence/agent-framework-adapter-manifest.v1.json',
    title: 'Workspai Agent Framework Adapter Manifest v1',
    ...strictObject({
      schemaVersion: { const: AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION },
      protocolVersion: { const: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION },
      adapter: strictObject({
        id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
        package: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        stability: { enum: [...AGENT_FRAMEWORK_ADAPTER_STABILITIES] },
      }),
      framework: strictObject({
        id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
        name: { type: 'string', minLength: 1 },
        homepage: { type: 'string', format: 'uri' },
        license: { type: 'string', minLength: 1 },
        upstreamStatus: { enum: [...AGENT_FRAMEWORK_UPSTREAM_STATUSES] },
        supportedVersionRange: { type: 'string', minLength: 1 },
        testedVersions: stringArray(1),
      }),
      implementation: strictObject({
        languages: stringArray(1),
        runtimes: stringArray(1),
        platforms: {
          type: 'array',
          items: { enum: ['linux', 'darwin', 'win32'] },
          minItems: 1,
          uniqueItems: true,
        },
        executionBoundary: { enum: ['in-process', 'subprocess', 'remote', 'none'] },
        distribution: { enum: ['bundled', 'optional-package', 'external-tool'] },
      }),
      operations: strictObject(operationProperties),
      capabilities: strictObject(capabilityProperties),
      detection: strictObject({
        authoredMarkers: {
          type: 'array',
          items: detectionMarkerSchema(),
          minItems: 1,
          maxItems: 64,
        },
        generatedMarkers: {
          type: 'array',
          items: detectionMarkerSchema(),
          maxItems: 64,
        },
        minimumAuthoredMarkers: { type: 'integer', minimum: 1 },
        minimumConfidence: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      }),
      ownership: strictObject({
        canonicalTruth: { const: 'workspai' },
        runtimeState: { const: 'framework' },
        sessionState: { const: 'framework' },
        mutationAdmission: { const: 'workspai-pcc' },
        verificationOwner: { const: 'workspai-cli' },
        managedWritePolicy: { const: 'owned-files-or-managed-sections' },
        conflictPolicy: { const: 'preserve-user-content' },
        managedRoots: relativePathArray(),
      }),
      security: strictObject({
        secrets: { const: 'references-only' },
        network: { const: 'deny-unless-explicitly-granted' },
        generatedCodeExecution: { const: 'disabled-unless-explicitly-granted' },
        toolMutation: { const: 'approval-required' },
        untrustedInput: { const: 'isolated' },
        telemetrySensitiveData: { const: 'redacted' },
      }),
      bindings: strictObject({
        contextInputs: relativePathArray(),
        evidenceInputs: relativePathArray(),
        mutationGateway: { const: 'proof-carrying-change' },
        verificationGateway: { const: 'workspace-verify' },
        projectionPolicy: { const: 'references-and-bounded-projections-only' },
      }),
    }),
  };
}

export function buildAgentFrameworkConformanceReportSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/workspace-intelligence/agent-framework-conformance-report.v1.json',
    title: 'Workspai Agent Framework Conformance Report v1',
    ...strictObject({
      schemaVersion: { const: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION },
      protocolVersion: { const: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION },
      generatedAt: { type: 'string', format: 'date-time' },
      adapter: strictObject({
        id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
        version: { type: 'string', minLength: 1 },
        manifestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      }),
      frameworkVersion: { type: 'string', minLength: 1 },
      cliVersion: { type: 'string', minLength: 1 },
      environment: strictObject({
        platform: { enum: ['linux', 'darwin', 'win32'] },
        architecture: { type: 'string', minLength: 1 },
        runtime: { type: 'string', minLength: 1 },
        runtimeVersion: { type: 'string', minLength: 1 },
      }),
      checks: {
        type: 'array',
        minItems: AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.length,
        items: strictObject({
          id: { enum: [...AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS] },
          status: { enum: ['passed', 'failed', 'skipped'] },
          required: { type: 'boolean' },
          summary: { type: 'string', minLength: 1 },
          evidencePaths: relativePathArray(),
          durationMs: { type: 'number', minimum: 0 },
        }),
      },
      summary: strictObject({
        passed: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
        skipped: { type: 'integer', minimum: 0 },
        required: { type: 'integer', minimum: AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.length },
      }),
      verdict: { enum: ['admitted', 'blocked'] },
      blockers: stringArray(),
      limitations: stringArray(),
    }),
    allOf: [
      {
        if: { properties: { verdict: { const: 'blocked' } }, required: ['verdict'] },
        then: { properties: { blockers: { type: 'array', minItems: 1 } } },
      },
      {
        if: { properties: { verdict: { const: 'admitted' } }, required: ['verdict'] },
        then: { properties: { blockers: { type: 'array', maxItems: 0 } } },
      },
    ],
  };
}

export function buildAgentFrameworkChangePlanSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/workspace-intelligence/agent-framework-change-plan.v1.json',
    title: 'Workspai Agent Framework Change Plan v1',
    ...strictObject({
      schemaVersion: { const: AGENT_FRAMEWORK_CHANGE_PLAN_SCHEMA_VERSION },
      status: { enum: ['planned', 'blocked', 'no-op'] },
      adapterId: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
      adapterVersion: { type: 'string', minLength: 1 },
      frameworkVersion: { type: 'string', minLength: 1 },
      mode: { enum: ['scaffold', 'attach'] },
      projectRoot: { const: '.' },
      target: strictObject({
        project: { type: 'string', minLength: 1 },
        artifactPrefix: relativePathSchema(),
      }),
      instanceName: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$' },
      files: {
        type: 'array',
        items: strictObject({
          path: relativePathSchema(),
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          overwrite: { enum: ['create-only', 'replace-if-owned'] },
        }),
      },
      changes: {
        type: 'array',
        items: strictObject({
          kind: {
            enum: ['create-file', 'replace-owned-file', 'dependency-recommendation'],
          },
          path: relativePathSchema(),
          summary: { type: 'string', minLength: 1 },
        }),
      },
      requiredEnvironment: stringArray(),
      permissions: {
        type: 'array',
        items: { enum: ['network:model-provider', 'network:dependency-registry'] },
        uniqueItems: true,
      },
      blockers: stringArray(),
    }),
    allOf: [
      {
        if: { properties: { status: { const: 'blocked' } }, required: ['status'] },
        then: { properties: { blockers: { type: 'array', minItems: 1 } } },
      },
      {
        if: { properties: { status: { const: 'planned' } }, required: ['status'] },
        then: {
          properties: {
            changes: { type: 'array', minItems: 1 },
            files: { type: 'array', minItems: 1 },
            blockers: { type: 'array', maxItems: 0 },
          },
        },
      },
      {
        if: { properties: { status: { const: 'no-op' } }, required: ['status'] },
        then: {
          properties: {
            changes: { type: 'array', maxItems: 0 },
            files: { type: 'array', maxItems: 0 },
            blockers: { type: 'array', maxItems: 0 },
          },
        },
      },
    ],
  };
}

export function buildAgentFrameworkOwnershipReceiptSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/workspace-intelligence/agent-framework-ownership-receipt.v1.json',
    title: 'Workspai Agent Framework Ownership Receipt v1',
    ...strictObject({
      schemaVersion: { const: AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION },
      generatedAt: { type: 'string', format: 'date-time' },
      changeId: { type: 'string', pattern: '^change-[a-z0-9][a-z0-9-]{7,95}$' },
      adapter: strictObject({
        id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
        version: { type: 'string', minLength: 1 },
        manifestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      }),
      framework: strictObject({
        id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
        version: { type: 'string', minLength: 1 },
      }),
      target: strictObject({
        workspace: { type: 'string', minLength: 1 },
        project: { type: 'string', minLength: 1 },
        artifactPrefix: relativePathSchema(),
        instanceName: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$' },
      }),
      files: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: strictObject({
          path: relativePathSchema(),
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        }),
      },
    }),
  };
}

export function buildAgentFrameworkAdmissionCandidateSchema() {
  const digestReference = strictObject({
    path: relativePathSchema(),
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/contracts/workspace-intelligence/agent-framework-admission-candidate.v1.json',
    title: 'Workspai Agent Framework Admission Candidate v1',
    ...strictObject({
      schemaVersion: { const: AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION },
      protocolVersion: { const: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION },
      generatedAt: { type: 'string', format: 'date-time' },
      sourceCommit: { type: 'string', pattern: '^[a-f0-9]{40}(?:[a-f0-9]{24})?$' },
      cliVersion: { type: 'string', minLength: 1 },
      reviewStatus: { const: 'pending' },
      adapters: {
        type: 'array',
        minItems: 1,
        items: strictObject({
          id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
          version: { type: 'string', minLength: 1 },
          manifestSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          framework: strictObject({
            id: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' },
          }),
          lanes: {
            type: 'array',
            minItems: 1,
            items: strictObject({
              platform: { enum: ['linux', 'darwin', 'win32'] },
              runtime: { type: 'string', minLength: 1 },
              runtimeVersion: { type: 'string', minLength: 1 },
              frameworkVersion: { type: 'string', minLength: 1 },
              report: digestReference,
              evidence: {
                type: 'array',
                minItems: AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.length,
                items: digestReference,
              },
            }),
          },
        }),
      },
      verdict: { const: 'admitted' },
      blockers: { type: 'array', maxItems: 0 },
    }),
  };
}

export function validateAgentFrameworkAdapterManifest(
  manifest: AgentFrameworkAdapterManifest
): string[] {
  const violations: string[] = [];
  if (manifest.schemaVersion !== AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION) {
    violations.push('manifest schema version is incompatible');
  }
  if (manifest.protocolVersion !== AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION) {
    violations.push('adapter protocol version is incompatible');
  }
  const declaredCapabilities = Object.keys(manifest.capabilities).sort();
  const expectedCapabilities = [...AGENT_FRAMEWORK_CAPABILITY_IDS].sort();
  if (JSON.stringify(declaredCapabilities) !== JSON.stringify(expectedCapabilities)) {
    violations.push('capability inventory must be exact and complete');
  }
  const declaredOperations = Object.keys(manifest.operations).sort();
  const expectedOperations = [...AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS].sort();
  if (JSON.stringify(declaredOperations) !== JSON.stringify(expectedOperations)) {
    violations.push('adapter operation inventory must be exact and complete');
  }
  for (const id of AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS) {
    if (manifest.operations[id]?.mode !== OPERATION_MODES[id]) {
      violations.push(`${id} must use ${OPERATION_MODES[id]} mode`);
    }
  }
  for (const [id, capability] of Object.entries(manifest.capabilities)) {
    if (capability.support !== 'unsupported' && capability.evidence.length === 0) {
      violations.push(`${id} support requires evidence`);
    }
  }
  if (manifest.framework.testedVersions.length === 0) {
    violations.push('at least one exact framework version must be tested');
  }
  const markerIds = [
    ...manifest.detection.authoredMarkers,
    ...manifest.detection.generatedMarkers,
  ].map((marker) => marker.id);
  if (new Set(markerIds).size !== markerIds.length) {
    violations.push('detection marker ids must be unique');
  }
  if (manifest.detection.minimumAuthoredMarkers > manifest.detection.authoredMarkers.length) {
    violations.push('minimum authored markers exceeds the authored marker inventory');
  }
  for (const marker of [
    ...manifest.detection.authoredMarkers,
    ...manifest.detection.generatedMarkers,
  ]) {
    if (
      marker.kind === 'dependency' &&
      marker.manifestPaths.length === 0 &&
      marker.manifestSuffixes.length === 0
    ) {
      violations.push(`${marker.id} dependency detection requires a manifest path or suffix`);
    }
  }
  if (manifest.adapter.stability === 'stable' && manifest.framework.upstreamStatus !== 'stable') {
    violations.push('a stable adapter requires a stable upstream framework');
  }
  if (
    manifest.framework.upstreamStatus === 'maintenance' &&
    manifest.adapter.stability !== 'compatibility'
  ) {
    violations.push('a maintenance-mode framework must use compatibility stability');
  }
  if (
    manifest.framework.upstreamStatus === 'beta' &&
    !['experimental', 'preview'].includes(manifest.adapter.stability)
  ) {
    violations.push('a beta framework may use only experimental or preview stability');
  }
  if (
    manifest.framework.upstreamStatus === 'deprecated' &&
    manifest.adapter.stability !== 'deprecated'
  ) {
    violations.push('a deprecated framework must use deprecated adapter stability');
  }
  if (
    manifest.framework.upstreamStatus === 'deprecated' &&
    manifest.operations['plan-scaffold'].supported
  ) {
    violations.push('a deprecated framework cannot advertise new-project scaffolding');
  }
  return violations;
}

export function validateAgentFrameworkConformanceReport(
  report: AgentFrameworkConformanceReport
): string[] {
  const violations: string[] = [];
  if (report.schemaVersion !== AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION) {
    violations.push('conformance schema version is incompatible');
  }
  if (report.protocolVersion !== AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION) {
    violations.push('conformance protocol version is incompatible');
  }
  const counts = { passed: 0, failed: 0, skipped: 0, required: 0 };
  const seen = new Set<string>();
  let requiredChecksPassed = true;
  for (const check of report.checks) {
    if (seen.has(check.id)) violations.push(`duplicate conformance check: ${check.id}`);
    seen.add(check.id);
    counts[check.status] += 1;
    if (check.required) counts.required += 1;
  }
  for (const id of AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS) {
    const check = report.checks.find((candidate) => candidate.id === id);
    if (!check) {
      violations.push(`missing required conformance check: ${id}`);
      requiredChecksPassed = false;
    } else if (!check.required) {
      violations.push(`${id} must be marked required`);
      requiredChecksPassed = false;
    } else if (check.status !== 'passed') {
      requiredChecksPassed = false;
    }
  }
  if (
    counts.passed !== report.summary.passed ||
    counts.failed !== report.summary.failed ||
    counts.skipped !== report.summary.skipped ||
    counts.required !== report.summary.required
  ) {
    violations.push('conformance summary does not match check results');
  }
  const shouldAdmit =
    violations.length === 0 && requiredChecksPassed && report.blockers.length === 0;
  if ((report.verdict === 'admitted') !== shouldAdmit) {
    violations.push('conformance verdict does not match required checks and blockers');
  }
  return violations;
}
