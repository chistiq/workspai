import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderManifest,
  type GraphScope,
  type GraphValidationIssue,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { admitGraphProviderOutput } from '../conformance/index.js';

import { composeGraph } from './compose-graph.js';
import {
  projectGraphReference,
  type GraphWorkspaceBuildExecution,
  type GraphWorkspaceBuildRequest,
  type GraphWorkspaceBuildResult,
  type GraphWorkspaceProjectInput,
} from './workspace-build-types.js';

const WORKSPACE_COMPOSITION_PROVIDER_ID = 'workspai.graph.provider.workspace-composition';

const workspaceCompositionManifest: GraphProviderManifest = Object.freeze({
  contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
  id: WORKSPACE_COMPOSITION_PROVIDER_ID,
  version: '0.1.0-candidate',
  displayName: 'Workspace composition',
  determinism: 'deterministic',
  capabilities: {
    entityKinds: ['workspace', 'project', 'artifact'],
    relationKinds: ['contains', 'depends-on'],
    relationSemantics: ['structural', 'declarative'] as const,
    factFamilies: ['workspace.membership', 'workspace.generation-reference'],
    allowedClaims: ['declared'],
  },
  permissions: {
    filesystem: 'none' as const,
    network: 'deny' as const,
    process: 'deny' as const,
    credentials: 'deny' as const,
  },
  limits: { maxDurationMs: 1_000, maxFacts: 10_000, maxInputBytes: 1_024 },
  contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
  supportedInputs: ['workspace-composition'],
  incremental: 'none',
  identitySchemes: [GRAPH_IDENTITY_SCHEME],
});

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return { code, severity, path, message };
}

function issue(code: string, path: string, message: string): GraphValidationIssue {
  return { code, path, message };
}

function workspaceEntity(scope: GraphScope, workspaceId: string) {
  return Object.freeze({
    id: `workspace:${workspaceId}`,
    identityScheme: GRAPH_IDENTITY_SCHEME,
    kind: 'workspace',
    scope,
  });
}

function projectEntity(scope: GraphScope, projectIdentity: string) {
  return Object.freeze({
    id: projectIdentity,
    identityScheme: GRAPH_IDENTITY_SCHEME,
    kind: 'project',
    scope,
  });
}

function generationArtifactEntity(
  scope: GraphScope,
  projectIdentity: string,
  generationId: string
) {
  return Object.freeze({
    id: `artifact:${projectIdentity}:${generationId}`,
    identityScheme: GRAPH_IDENTITY_SCHEME,
    kind: 'artifact',
    scope,
  });
}

function membershipFacts(
  scope: GraphScope,
  workspaceId: string,
  projects: readonly GraphWorkspaceProjectInput[],
  observedAt: string
): GraphWorkspaceFact[] {
  const workspace = workspaceEntity(scope, workspaceId);
  const facts: GraphWorkspaceFact[] = [];
  for (const [index, project] of projects.entries()) {
    const projectRef = projectEntity(scope, project.projectIdentity);
    const generationRef = generationArtifactEntity(
      scope,
      project.projectIdentity,
      project.graph.generation.reference.id
    );
    const evidence = [
      Object.freeze({
        id: `evidence:workspace-composition:${project.projectIdentity}:${project.graph.generation.reference.id}`,
        sourceKind: 'graph-generation' as const,
        relativeLocator: project.artifactRef,
        digest: project.graph.generation.reference.contentDigest,
      }),
    ];
    const base = {
      scope,
      evidence,
      provenance: {
        id: WORKSPACE_COMPOSITION_PROVIDER_ID,
        version: workspaceCompositionManifest.version,
      },
      derivation: 'declared' as const,
      authority: 'declared' as const,
      confidence: 1,
      freshness: { status: 'current' as const },
      truthLifecycle: { invalidatedBy: ['input-change'] as const },
      observedAt,
      inputDigest: project.graph.generation.reference.contentDigest,
      unknownZones: [] as const,
    };
    facts.push(
      Object.freeze({
        ...base,
        factId: `fact:workspace-contains:${String(index).padStart(8, '0')}:${project.projectIdentity}`,
        factType: 'workspace.membership',
        subject: workspace,
        predicate: 'contains',
        object: projectRef,
        extensions: Object.freeze({ relationship: project.membership }),
      }),
      Object.freeze({
        ...base,
        factId: `fact:workspace-generation-ref:${String(index).padStart(8, '0')}:${project.graph.generation.reference.id}`,
        factType: 'workspace.generation-reference',
        subject: projectRef,
        predicate: 'depends-on',
        object: generationRef,
        extensions: Object.freeze({
          graphGeneration: project.graph.generation.reference.id,
          graphDigest: project.graph.generation.reference.contentDigest,
          projectArtifact: project.artifactRef,
        }),
      })
    );
  }
  return facts;
}

function workspaceCompositionBatch(
  request: GraphWorkspaceBuildRequest,
  observedAt: string
): GraphFactBatch {
  const scope = request.context.scope;
  return Object.freeze({
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: {
      id: WORKSPACE_COMPOSITION_PROVIDER_ID,
      version: workspaceCompositionManifest.version,
    },
    batchId: `batch:workspace-composition:${request.context.workspaceId}`,
    scope,
    inputs: Object.freeze(
      request.projects.map((project) => ({
        locator: `workspace-composition/${project.projectIdentity}/${project.graph.generation.reference.id}`,
        digest: project.graph.generation.reference.contentDigest,
      }))
    ),
    facts: Object.freeze(
      membershipFacts(scope, request.context.workspaceId, request.projects, observedAt)
    ),
    diagnostics: [],
    coverage: Object.freeze([
      {
        dimension: 'workspace.projects',
        observed: request.projects.length,
        expected: request.projects.length,
      },
    ]),
    unknownZones: [],
    unsupportedZones: [],
    redaction: Object.freeze({ policy: request.policy.redactionProfile, redacted: 0, omitted: 0 }),
    status: 'complete',
    processing: Object.freeze(
      request.projects.map((project) =>
        Object.freeze({
          input: Object.freeze({
            locator: `workspace-composition/${project.projectIdentity}/${project.graph.generation.reference.id}`,
            digest: project.graph.generation.reference.contentDigest,
          }),
          provider: {
            id: WORKSPACE_COMPOSITION_PROVIDER_ID,
            version: workspaceCompositionManifest.version,
          },
          stage: Object.freeze({
            id: 'workspace-composition',
            version: workspaceCompositionManifest.version,
          }),
          outcome: 'processed' as const,
          outputDigest: project.graph.generation.reference.contentDigest,
          diagnostics: [] as const,
        })
      )
    ),
  });
}

/** Composes a workspace graph from immutable project generations without re-extracting repositories. */
export async function buildWorkspaceGraph(
  request: GraphWorkspaceBuildRequest
): Promise<GraphWorkspaceBuildExecution> {
  if (request.projects.length === 0) {
    return {
      accepted: false,
      code: 'invalid-input',
      issues: [
        issue(
          'GRAPH_WORKSPACE_PROJECTS_REQUIRED',
          '/projects',
          'Workspace composition requires at least one admitted project graph reference.'
        ),
      ],
    };
  }
  for (const [index, project] of request.projects.entries()) {
    if (project.graph.generation.reference.contentDigest.value.length === 0) {
      return {
        accepted: false,
        code: 'invalid-input',
        issues: [
          issue(
            'GRAPH_WORKSPACE_PROJECT_GENERATION_INVALID',
            `/projects/${index}/graph/generation/reference/contentDigest`,
            'Each project graph reference must carry a validated generation digest.'
          ),
        ],
      };
    }
  }

  request.ports.cancellation.throwIfAborted();
  const observedAt = request.ports.clock.now().toISOString();
  const batch = workspaceCompositionBatch(request, observedAt);
  const admitted = admitGraphProviderOutput(workspaceCompositionManifest, batch);
  if (!admitted.accepted) {
    return {
      accepted: false,
      code: 'invalid-input',
      issues: admitted.issues,
    };
  }

  const sources = Object.freeze([
    { manifest: admitted.manifest, batch: admitted.batch },
    ...(request.sources ?? []),
  ]);
  const composed = await composeGraph(
    {
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      sources,
      policy: request.policy.composition,
    },
    request.ports
  );
  if (!composed.accepted) {
    return {
      accepted: false,
      code: composed.code === 'cancelled' ? 'cancelled' : 'composition-failed',
      issues: composed.issues,
    };
  }

  const projectReferences = Object.freeze(
    request.projects.map((project) => projectGraphReference(project, request.context.workspaceId))
  );
  const result: GraphWorkspaceBuildResult = Object.freeze({
    status: 'complete',
    graph: composed.value.graph,
    quality: Object.freeze({
      graph: composed.value.quality,
      unknownZones: composed.value.quality.unknownZones,
      unsupportedZones: composed.value.quality.unsupportedZones,
      providerFailures: [],
    }),
    projectReferences,
    diagnostics: composed.value.graph.unresolved.length
      ? [
          diagnostic(
            'GRAPH_WORKSPACE_UNRESOLVED_REFERENCES',
            'warning',
            '/graph/unresolved',
            'Workspace composition retained unresolved project or membership references.'
          ),
        ]
      : [],
    metrics: Object.freeze({
      projectCount: request.projects.length,
      referencedGenerations: request.projects.length,
      workspaceFacts: batch.facts.length,
    }),
  });

  return { accepted: true, value: result, issues: [] };
}
