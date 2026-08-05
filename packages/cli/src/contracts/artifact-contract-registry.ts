import path from 'node:path';

import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ADDITIONAL_PRODUCERS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  type WorkspaceIntelligenceArtifactId,
} from './workspace-intelligence-runtime-registry.js';

export type WorkspaceArtifactContractDescriptor = {
  artifactPath: string;
  schemaVersion: string | number;
  schemaVersionField?: 'schemaVersion' | 'schema_version' | 'schema' | 'version';
  contractPath: string;
  producerCommands: string[][];
};

function intelligenceProducerCommands(artifactPath: string): string[][] {
  const orderedChainProducers = Object.values(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS)
    .filter((step) => (step.produces as readonly string[]).includes(artifactPath))
    .map((step) => [...step.command]);
  const additionalProducers =
    WORKSPACE_INTELLIGENCE_ADDITIONAL_PRODUCERS[
      artifactPath as keyof typeof WORKSPACE_INTELLIGENCE_ADDITIONAL_PRODUCERS
    ] ?? [];
  return [
    ...orderedChainProducers,
    ...additionalProducers.map((command: readonly string[]) => [...command]),
  ];
}

const intelligenceDescriptors: WorkspaceArtifactContractDescriptor[] = Object.keys(
  WORKSPACE_INTELLIGENCE_ARTIFACTS
).flatMap((id) => {
  const artifactId = id as WorkspaceIntelligenceArtifactId;
  const schemaVersion = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[artifactId];
  const contractPath = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[artifactId];
  if (!schemaVersion || !contractPath) return [];
  const artifactPath = WORKSPACE_INTELLIGENCE_ARTIFACTS[artifactId];
  return [
    {
      artifactPath,
      schemaVersion,
      contractPath,
      producerCommands: intelligenceProducerCommands(artifactPath),
    },
  ];
});

const supplementalDescriptors: WorkspaceArtifactContractDescriptor[] = Object.values(
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS
).map((descriptor) => ({
  ...descriptor,
  producerCommands: descriptor.producerCommands.map((command) => [...command]),
}));

export const WORKSPACE_ARTIFACT_CONTRACTS = Object.freeze(
  Object.fromEntries(
    [...intelligenceDescriptors, ...supplementalDescriptors].map((descriptor) => [
      descriptor.artifactPath,
      descriptor,
    ])
  )
) as Readonly<Record<string, WorkspaceArtifactContractDescriptor>>;

function normalizeArtifactPath(artifactPath: string): string {
  return artifactPath.split(path.sep).join('/').replace(/^\.\//, '');
}

const S = WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS;
const WORKSPACE_ARTIFACT_PATTERN_CONTRACTS = [
  {
    pattern: /^\.workspai\/reports\/bootstrap-compliance-[^/]+\.json$/,
    canonicalPath: S.bootstrapCompliance.artifactPath,
  },
  {
    pattern: /^\.workspai\/reports\/mirror-ops-[^/]+\.json$/,
    canonicalPath: S.mirrorOps.artifactPath,
  },
  {
    pattern: /^\.workspai\/reports\/transparency-evidence-[^/]+\.json$/,
    canonicalPath: S.transparencyEvidence.artifactPath,
  },
  {
    pattern: /^\.workspai\/reports\/projects\/[^/]+\/doctor-project-last-run\.json$/,
    canonicalPath: S.doctorProject.artifactPath,
  },
  {
    pattern: /^\.workspai\/reports\/projects\/[^/]+\/project-test-coverage-last-run\.json$/,
    canonicalPath: S.projectTestCoverage.artifactPath,
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
