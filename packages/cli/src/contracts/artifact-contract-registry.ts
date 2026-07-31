import path from 'node:path';

import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  type WorkspaceIntelligenceArtifactId,
} from './workspace-intelligence-runtime-registry.js';

export type WorkspaceArtifactContractDescriptor = {
  artifactPath: string;
  schemaVersion: string | number;
  schemaVersionField?: 'schemaVersion' | 'schema_version' | 'schema' | 'version';
  contractPath: string;
  producerCommands: string[][];
};

type WorkspaceArtifactContractInput = Omit<WorkspaceArtifactContractDescriptor, 'producerCommands'>;

const descriptors = Object.keys(WORKSPACE_INTELLIGENCE_ARTIFACTS).flatMap((id) => {
  const artifactId = id as WorkspaceIntelligenceArtifactId;
  const schemaVersion = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[artifactId];
  const contractPath = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[artifactId];
  if (!schemaVersion || !contractPath) return [];
  return [
    {
      artifactPath: WORKSPACE_INTELLIGENCE_ARTIFACTS[artifactId],
      schemaVersion,
      contractPath,
    },
  ];
});

const supplementalDescriptors: WorkspaceArtifactContractInput[] = [
  {
    artifactPath: '.workspai/workspace-link.local.json',
    schemaVersion: 'project-workspace-link.v1',
    contractPath: 'contracts/project-workspace-link.v1.json',
  },
  {
    artifactPath: '.workspai/reports/project-context-agent.json',
    schemaVersion: 'project-context-agent.v1',
    contractPath: 'contracts/workspace-intelligence/project-context-agent.v1.json',
  },
  {
    artifactPath: '.workspai/workspace.contract.json',
    schemaVersion: 1,
    contractPath: 'contracts/workspace-contract.v1.json',
  },
  {
    artifactPath: '.workspai/cache/workspace-model.v1.json',
    schemaVersion: 'workspace-model-cache.v1',
    contractPath: 'contracts/workspace-model-cache.v1.json',
  },
  {
    artifactPath: '.workspai/workspace-registry.v1.json',
    schemaVersion: 'workspace-registry.v1',
    contractPath: 'contracts/workspace-registry.v1.json',
  },
  {
    artifactPath: '.workspai/compatibility-matrix.json',
    schemaVersion: 'rapidkit.compatibility-matrix.v1',
    contractPath: 'contracts/compatibility-matrix.v1.json',
  },
  {
    artifactPath: '.workspai/reports/doctor-workspace-cache.json',
    schemaVersion: 'doctor-workspace-cache-v2',
    contractPath: 'contracts/doctor-workspace-cache.v2.json',
  },
  {
    artifactPath: '.workspai/reports/bootstrap-compliance.latest.json',
    schemaVersion: 'bootstrap-compliance.v1',
    contractPath: 'contracts/bootstrap-compliance.v1.json',
  },
  {
    artifactPath: '.workspai/reports/mirror-ops.latest.json',
    schemaVersion: 'mirror-ops.v1',
    contractPath: 'contracts/mirror-ops.v1.json',
  },
  {
    artifactPath: '.workspai/reports/transparency-evidence.latest.json',
    schemaVersion: 'transparency-evidence.v1',
    contractPath: 'contracts/transparency-evidence.v1.json',
  },
  {
    artifactPath: '.workspai/reports/share-bundle.json',
    schemaVersion: '1.1',
    schemaVersionField: 'schema_version',
    contractPath: 'contracts/workspace-share-bundle.v1.json',
  },
  {
    artifactPath: '.workspai/reports/doctor-project-last-run.json',
    schemaVersion: 'doctor-project-evidence-v1',
    contractPath: 'contracts/doctor-project-evidence.v1.json',
  },
  {
    artifactPath: '.workspai/reports/project-test-coverage-last-run.json',
    schemaVersion: 'workspai.project-test-coverage.v1',
    contractPath: 'contracts/project-test-coverage.v1.json',
  },
  {
    artifactPath: '.workspai/reports/doctor-remediation-plan-last-run.json',
    schemaVersion: 'doctor-remediation-plan-v2',
    contractPath: 'contracts/doctor-remediation-plan.v2.json',
  },
  {
    artifactPath: '.workspai/reports/artifact-remediation-plan-last-run.json',
    schemaVersion: 'artifact-remediation-plan-v1',
    contractPath: 'contracts/artifact-remediation-plan.v1.json',
  },
  {
    artifactPath: '.workspai/reports/doctor-fix-result-last-run.json',
    schemaVersion: 'rapidkit-doctor-fix-result-v1',
    contractPath: 'contracts/workspace-intelligence/doctor-fix-result.v1.json',
  },
  {
    artifactPath: '.workspai/reports/pipeline-last-run.json',
    schemaVersion: 'rapidkit-pipeline-v1',
    contractPath: 'contracts/pipeline-last-run.v1.json',
  },
  {
    artifactPath: '.workspai/reports/autopilot-release-last-run.json',
    schemaVersion: 'autopilot-release-v1',
    contractPath: 'contracts/autopilot-release.v1.json',
  },
  {
    artifactPath: '.workspai/reports/autopilot-release.json',
    schemaVersion: 'autopilot-release-v1',
    contractPath: 'contracts/autopilot-release.v1.json',
  },
  {
    artifactPath: '.workspai/reports/workspace-run-last.json',
    schemaVersion: 'workspace-run-v1',
    contractPath: 'contracts/workspace-run-last.v1.json',
  },
  {
    artifactPath: '.workspai/reports/workspai-mcp-design.json',
    schemaVersion: 'workspai-mcp-design.v1',
    contractPath: 'contracts/workspace-intelligence/mcp-design.v1.json',
  },
  {
    artifactPath: '.workspai/reports/rapidkit-mcp-design.json',
    schemaVersion: 'workspai-mcp-design.v1',
    contractPath: 'contracts/workspace-intelligence/mcp-design.v1.json',
  },
  {
    artifactPath: '.workspai/reports/workspace-why-last-run.json',
    schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.explain,
    contractPath: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.explain,
  },
  {
    artifactPath: '.workspai/reports/workspace-trace-last-run.json',
    schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.explain,
    contractPath: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.explain,
  },
  {
    artifactPath: '.vscode/workspai-agent-hooks.json',
    schemaVersion: 'workspai-agent-hooks.v1',
    contractPath: 'contracts/workspace-intelligence/agent-hooks.v1.json',
  },
  {
    artifactPath: '.workspai/reports/infra-plan.json',
    schemaVersion: 'rapidkit.infra-plan.v1',
    contractPath: 'contracts/infra-plan.v1.json',
  },
];

const SUPPLEMENTAL_ARTIFACT_PRODUCERS: Readonly<Record<string, readonly string[][]>> = {
  '.workspai/workspace-link.local.json': [
    ['adopt'],
    ['import'],
    ['project', 'workspace', 'relink'],
    ['workspace', 'sync'],
  ],
  '.workspai/reports/project-context-agent.json': [
    ['adopt'],
    ['import'],
    ['workspace', 'sync'],
    ['workspace', 'agent-sync', '--write'],
  ],
  '.workspai/workspace.contract.json': [
    ['workspace', 'sync'],
    ['workspace', 'contract', 'sync'],
  ],
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
  '.workspai/cache/workspace-model.v1.json': [['workspace', 'model']],
  '.workspai/workspace-registry.v1.json': [['workspace', 'sync']],
  '.workspai/compatibility-matrix.json': [['bootstrap']],
  '.workspai/reports/doctor-workspace-cache.json': [['doctor', 'workspace']],
  '.workspai/reports/bootstrap-compliance.latest.json': [['bootstrap']],
  '.workspai/reports/mirror-ops.latest.json': [['mirror', 'status']],
  '.workspai/reports/transparency-evidence.latest.json': [['mirror', 'sync']],
  '.workspai/reports/share-bundle.json': [['workspace', 'share']],
  '.workspai/reports/doctor-project-last-run.json': [['doctor', 'project']],
  '.workspai/reports/project-test-coverage-last-run.json': [['project', 'coverage']],
  '.workspai/reports/doctor-remediation-plan-last-run.json': [['workspace', 'remediation-plan']],
  '.workspai/reports/artifact-remediation-plan-last-run.json': [['workspace', 'remediation-plan']],
  '.workspai/reports/doctor-fix-result-last-run.json': [['doctor', 'workspace']],
  '.workspai/reports/pipeline-last-run.json': [['pipeline']],
  '.workspai/reports/autopilot-release-last-run.json': [['autopilot', 'release']],
  '.workspai/reports/autopilot-release.json': [['autopilot', 'release']],
  '.workspai/reports/workspace-run-last.json': [['workspace', 'run']],
  '.workspai/reports/workspai-mcp-design.json': [['workspace', 'agent-sync', '--write']],
  '.workspai/reports/rapidkit-mcp-design.json': [['workspace', 'agent-sync', '--write']],
  '.workspai/reports/workspace-why-last-run.json': [['workspace', 'why']],
  '.workspai/reports/workspace-trace-last-run.json': [['workspace', 'trace']],
  '.vscode/workspai-agent-hooks.json': [['workspace', 'agent-sync']],
  '.workspai/reports/infra-plan.json': [['infra', 'plan']],
};

function producerCommandsFor(artifactPath: string): string[][] {
  const intelligenceProducers = Object.values(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS)
    .filter((step) => (step.produces as readonly string[]).includes(artifactPath))
    .map((step) => [...step.command]);
  const supplemental = SUPPLEMENTAL_ARTIFACT_PRODUCERS[artifactPath] ?? [];
  return [...intelligenceProducers, ...supplemental.map((command) => [...command])];
}

export const WORKSPACE_ARTIFACT_CONTRACTS = Object.freeze(
  Object.fromEntries(
    [...descriptors, ...supplementalDescriptors].map((descriptor) => [
      descriptor.artifactPath,
      {
        ...descriptor,
        producerCommands: producerCommandsFor(descriptor.artifactPath),
      },
    ])
  )
) as Readonly<Record<string, WorkspaceArtifactContractDescriptor>>;

function normalizeArtifactPath(artifactPath: string): string {
  return artifactPath.split(path.sep).join('/').replace(/^\.\//, '');
}

const WORKSPACE_ARTIFACT_PATTERN_CONTRACTS = [
  {
    pattern: /^\.workspai\/reports\/bootstrap-compliance-[^/]+\.json$/,
    canonicalPath: '.workspai/reports/bootstrap-compliance.latest.json',
  },
  {
    pattern: /^\.workspai\/reports\/mirror-ops-[^/]+\.json$/,
    canonicalPath: '.workspai/reports/mirror-ops.latest.json',
  },
  {
    pattern: /^\.workspai\/reports\/transparency-evidence-[^/]+\.json$/,
    canonicalPath: '.workspai/reports/transparency-evidence.latest.json',
  },
  {
    pattern: /^\.workspai\/reports\/projects\/[^/]+\/doctor-project-last-run\.json$/,
    canonicalPath: '.workspai/reports/doctor-project-last-run.json',
  },
  {
    pattern: /^\.workspai\/reports\/projects\/[^/]+\/project-test-coverage-last-run\.json$/,
    canonicalPath: '.workspai/reports/project-test-coverage-last-run.json',
  },
] as const;

export function workspaceArtifactContractFor(
  artifactPath: string
): WorkspaceArtifactContractDescriptor | null {
  const normalized = normalizeArtifactPath(artifactPath);
  const exact = WORKSPACE_ARTIFACT_CONTRACTS[normalized];
  if (exact) return exact;
  const pattern = WORKSPACE_ARTIFACT_PATTERN_CONTRACTS.find((entry) =>
    entry.pattern.test(normalized)
  );
  return pattern ? (WORKSPACE_ARTIFACT_CONTRACTS[pattern.canonicalPath] ?? null) : null;
}

export function assertWorkspaceArtifactContract(
  artifactPath: string,
  payload: unknown,
  artifactLabel = artifactPath
): void {
  const normalized = normalizeArtifactPath(artifactPath);
  const descriptor = workspaceArtifactContractFor(artifactPath);
  if (!descriptor) {
    if (normalized.startsWith('.workspai/reports/') && normalized.endsWith('.json')) {
      throw new Error(
        `${artifactLabel} is a public workspace report without a registered artifact contract`
      );
    }
    return;
  }

  const schemaVersionField = descriptor.schemaVersionField ?? 'schemaVersion';
  const schemaVersion =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)[schemaVersionField]
      : undefined;
  if (schemaVersion !== descriptor.schemaVersion) {
    throw new Error(
      `${artifactLabel} schemaVersion is ${String(schemaVersion)}, expected ${descriptor.schemaVersion}`
    );
  }
  assertJsonSchemaContract(payload, descriptor.contractPath, artifactLabel);
}
