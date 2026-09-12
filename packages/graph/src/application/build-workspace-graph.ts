import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  GRAPH_QUALITY_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphCanonicalGraph,
  type GraphDiagnostic,
  type GraphEdge,
  type GraphFactBatch,
  type GraphGeneration,
  type GraphNaryRelationAssertion,
  type GraphProviderManifest,
  type GraphQualityReport,
  type GraphProofState,
  type GraphScope,
  type GraphValidationIssue,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import {
  admitGraphProviderOutput,
  validateCanonicalGraph,
  validateGraphQualityReport,
} from '../conformance/index.js';

import { composeGraph } from './compose-graph.js';
import { digestCanonicalGraphInput } from './digest-canonical-graph-input.js';
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
    factFamilies: [
      'workspace.membership',
      'workspace.project-reference',
      'workspace.generation-reference',
    ],
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

function membershipEntity(scope: GraphScope, workspaceId: string, projectIdentity: string) {
  return Object.freeze({
    id: `workspace-membership:${workspaceId}:${projectIdentity}`,
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
    const projectScope = project.graph.nodes.find(
      (node) =>
        node.scope.kind === 'project' && node.scope.projectIds.includes(project.projectIdentity)
    )!.scope;
    const projectRef = Object.freeze({
      id: project.projectIdentity,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'project',
      scope: projectScope,
    });
    const membershipRef = membershipEntity(scope, workspaceId, project.projectIdentity);
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
        object: membershipRef,
        extensions: Object.freeze({ relationship: project.membership }),
      }),
      Object.freeze({
        ...base,
        factId: `fact:workspace-project-ref:${String(index).padStart(8, '0')}:${project.projectIdentity}`,
        factType: 'workspace.project-reference',
        subject: membershipRef,
        predicate: 'depends-on',
        object: projectRef,
        extensions: Object.freeze({ projectIdentity: project.projectIdentity }),
      }),
      Object.freeze({
        ...base,
        factId: `fact:workspace-generation-ref:${String(index).padStart(8, '0')}:${project.graph.generation.reference.id}`,
        factType: 'workspace.generation-reference',
        subject: membershipRef,
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

function canonical(input: unknown): string {
  const result = canonicalizeGraphValue(input);
  if (!result.accepted) throw new Error(result.issues[0]?.message ?? 'Canonicalization failed.');
  return result.value;
}

function mergeIdentities<T extends { readonly id: string }>(
  groups: readonly (readonly T[])[],
  path: string,
  issues: GraphValidationIssue[]
): readonly T[] {
  const merged = new Map<string, T>();
  for (const value of groups.flat()) {
    const prior = merged.get(value.id);
    if (prior && canonical(prior) !== canonical(value)) {
      issues.push(
        issue(
          'GRAPH_WORKSPACE_IDENTITY_CONFLICT',
          `${path}/${value.id}`,
          'Workspace composition found the same canonical identity with different content.'
        )
      );
      continue;
    }
    merged.set(value.id, value);
  }
  return Object.freeze([...merged.values()].sort((left, right) => left.id.localeCompare(right.id)));
}

function uniqueCanonical<T>(groups: readonly (readonly T[])[]): readonly T[] {
  return Object.freeze(
    [...new Map(groups.flat().map((value) => [canonical(value), value])).values()].sort(
      (left, right) => canonical(left).localeCompare(canonical(right))
    )
  );
}

function portableArtifactRef(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]/u).includes('..')
  );
}

function graphDigestPayload(
  graph: Omit<GraphCanonicalGraph, 'generation'> & {
    readonly generation: Omit<GraphGeneration, 'reference'>;
  }
): unknown {
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      const { evaluatedAt: _evaluatedAt, ...proof } = edge.proof;
      return { ...edge, proof };
    }),
    assertions: graph.assertions.map((assertion) => {
      const { evaluatedAt: _evaluatedAt, ...proof } = assertion.proof;
      return { ...assertion, proof };
    }),
  };
}

async function mergeWorkspaceGraphs(
  request: GraphWorkspaceBuildRequest,
  overlayGraph: GraphCanonicalGraph,
  overlayQuality: GraphQualityReport,
  generatedAt: string
): Promise<
  { graph: GraphCanonicalGraph; quality: GraphQualityReport } | readonly GraphValidationIssue[]
> {
  const issues: GraphValidationIssue[] = [];
  const projectGraphs = request.projects.map((project) => project.graph);
  const nodes = mergeIdentities(
    [...projectGraphs.map((graph) => graph.nodes), overlayGraph.nodes],
    '/nodes',
    issues
  );
  const edges = mergeIdentities<GraphEdge>(
    [...projectGraphs.map((graph) => graph.edges), overlayGraph.edges],
    '/edges',
    issues
  );
  const assertions = mergeIdentities<GraphNaryRelationAssertion>(
    [...projectGraphs.map((graph) => graph.assertions), overlayGraph.assertions],
    '/assertions',
    issues
  );
  if (issues.length > 0) return issues;

  const ontology = uniqueCanonical([
    ...projectGraphs.map((graph) => graph.ontology),
    overlayGraph.ontology,
  ]);
  const disputes = mergeIdentities(
    [...projectGraphs.map((graph) => graph.disputes), overlayGraph.disputes],
    '/disputes',
    issues
  );
  const unresolved = mergeIdentities(
    [...projectGraphs.map((graph) => graph.unresolved), overlayGraph.unresolved],
    '/unresolved',
    issues
  );
  if (issues.length > 0) return issues;

  const generationBase = Object.freeze({
    graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
    architectureEpoch: request.policy.composition.architectureEpoch,
    ontologySetDigest: await digestCanonicalGraphInput(ontology, request.ports.digest),
    proofPolicySetDigest: await digestCanonicalGraphInput(
      [
        ...projectGraphs.map((graph) => graph.generation.proofPolicySetDigest),
        overlayGraph.generation.proofPolicySetDigest,
      ],
      request.ports.digest
    ),
    inputsDigest: await digestCanonicalGraphInput(
      request.projects.map((project) => ({
        identity: project.projectIdentity,
        generation: project.graph.generation.reference,
        artifact: project.artifactRef,
        membership: project.membership,
      })),
      request.ports.digest
    ),
    factSetDigest: await digestCanonicalGraphInput(
      [
        ...projectGraphs.map((graph) => graph.generation.factSetDigest),
        overlayGraph.generation.factSetDigest,
      ],
      request.ports.digest
    ),
    providerSetDigest: await digestCanonicalGraphInput(
      [
        ...projectGraphs.map((graph) => graph.generation.providerSetDigest),
        overlayGraph.generation.providerSetDigest,
      ],
      request.ports.digest
    ),
    compositionPolicyDigest: await digestCanonicalGraphInput(
      {
        workspacePolicy: request.policy.composition,
        projectPolicies: projectGraphs.map((graph) => graph.generation.compositionPolicyDigest),
      },
      request.ports.digest
    ),
  });
  const graphPayload = {
    contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
    graphVersion: GRAPH_CANONICAL_GRAPH_CONTRACT.version,
    generation: generationBase,
    ontology,
    nodes,
    edges,
    assertions,
    disputes,
    unresolved,
    diagnostics: uniqueCanonical([
      ...projectGraphs.map((graph) => graph.diagnostics),
      overlayGraph.diagnostics,
    ]),
  };
  const contentDigest = await digestCanonicalGraphInput(
    graphDigestPayload(graphPayload),
    request.ports.digest
  );
  const generation: GraphGeneration = Object.freeze({
    reference: Object.freeze({
      id: `generation:${contentDigest.value.slice(0, 32)}`,
      generatedAt,
      contentDigest,
      parents: request.projects.map((project) => project.graph.generation.reference.id).sort(),
    }),
    ...generationBase,
  });
  const graph: GraphCanonicalGraph = Object.freeze({ ...graphPayload, generation });

  const proofStates: Record<GraphProofState, number> = {
    supported: 0,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  };
  for (const edge of edges) proofStates[edge.proof.state] += 1;
  for (const assertion of assertions) proofStates[assertion.proof.state] += 1;
  const qualities = [...request.projects.map((project) => project.quality), overlayQuality];
  const connected = new Set([
    ...edges.flatMap((edge) => [edge.from, edge.to]),
    ...assertions.flatMap((assertion) => assertion.participants.map((entry) => entry.entity.id)),
  ]);
  const quality: GraphQualityReport = Object.freeze({
    contract: GRAPH_QUALITY_CONTRACT,
    generation: generation.reference,
    integrity: qualities.some((entry) => entry.integrity === 'blocked')
      ? 'blocked'
      : qualities.some((entry) => entry.integrity === 'attention') ||
          disputes.length > 0 ||
          unresolved.length > 0
        ? 'attention'
        : 'pass',
    determinism: qualities.every((entry) => entry.determinism === 'pass') ? 'pass' : 'blocked',
    incrementalEquivalence: 'not-assessed',
    coverage: uniqueCanonical(qualities.map((entry) => entry.coverage)),
    proofStates: Object.freeze(proofStates),
    unknownZones: uniqueCanonical(qualities.map((entry) => entry.unknownZones)),
    unsupportedZones: uniqueCanonical(qualities.map((entry) => entry.unsupportedZones)),
    staleZones: uniqueCanonical(qualities.map((entry) => entry.staleZones)),
    conflicts: disputes,
    orphans: Object.freeze(nodes.filter((node) => !connected.has(node.id))),
    providerFailures: uniqueCanonical(qualities.map((entry) => entry.providerFailures)),
    releaseClaims: Object.freeze([]),
  });
  const graphValidation = validateCanonicalGraph(graph, CORE_GRAPH_ONTOLOGY_PROFILE);
  if (!graphValidation.accepted) return graphValidation.issues;
  const qualityValidation = validateGraphQualityReport(quality);
  if (!qualityValidation.accepted) return qualityValidation.issues;
  return { graph, quality };
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
  if (
    new Set(request.projects.map((project) => project.projectIdentity)).size !==
    request.projects.length
  ) {
    return {
      accepted: false,
      code: 'invalid-input',
      issues: [
        issue(
          'GRAPH_WORKSPACE_PROJECT_IDENTITY_DUPLICATE',
          '/projects',
          'Workspace composition requires exactly one immutable input per project identity.'
        ),
      ],
    };
  }
  for (const [index, project] of request.projects.entries()) {
    const graphValidation = validateCanonicalGraph(project.graph, CORE_GRAPH_ONTOLOGY_PROFILE);
    const projectScopePresent = project.graph.nodes.some(
      (node) =>
        node.scope.kind === 'project' && node.scope.projectIds.includes(project.projectIdentity)
    );
    const qualityMatches =
      project.quality.generation.id === project.graph.generation.reference.id &&
      project.quality.generation.contentDigest.value ===
        project.graph.generation.reference.contentDigest.value;
    if (
      !graphValidation.accepted ||
      !projectScopePresent ||
      !qualityMatches ||
      project.quality.integrity === 'blocked' ||
      project.quality.determinism !== 'pass' ||
      !portableArtifactRef(project.artifactRef)
    ) {
      return {
        accepted: false,
        code: 'invalid-input',
        issues: [
          issue(
            'GRAPH_WORKSPACE_PROJECT_GENERATION_INVALID',
            `/projects/${index}`,
            'Each project must provide a valid canonical graph, matching non-blocked quality, portable artifact reference, and a scope containing its project identity.'
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

  const merged = await mergeWorkspaceGraphs(
    request,
    composed.value.graph,
    composed.value.quality,
    observedAt
  );
  if (!('graph' in merged)) {
    return { accepted: false, code: 'composition-failed', issues: merged };
  }

  const projectReferences = Object.freeze(
    request.projects.map((project) => projectGraphReference(project, request.context.workspaceId))
  );
  const result: GraphWorkspaceBuildResult = Object.freeze({
    status: 'complete',
    graph: merged.graph,
    quality: Object.freeze({
      graph: merged.quality,
      unknownZones: merged.quality.unknownZones,
      unsupportedZones: merged.quality.unsupportedZones,
      providerFailures: [],
    }),
    projectReferences,
    diagnostics: merged.graph.unresolved.length
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
