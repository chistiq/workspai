import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_QUALITY_CONTRACT,
  type GraphCanonicalGraph,
  type GraphQualityReport,
} from '../../src/contracts/index.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  buildWorkspaceGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import type {
  GraphExecutionPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';

const digest = { algorithm: 'sha256' as const, value: 'c'.repeat(64) };
const projectScope = { kind: 'project' as const, projectIds: ['project:api'] as [string] };
const workspaceScope = {
  kind: 'workspace' as const,
  workspaceId: 'workspace:platform',
};
const generation = {
  id: 'generation:project-api',
  generatedAt: '2026-09-09T00:00:00.000Z',
  contentDigest: digest,
};

const projectGraph: GraphCanonicalGraph = {
  contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
  graphVersion: '0.1.0-candidate',
  generation: {
    reference: generation,
    graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
    architectureEpoch: 'wis-graph-1',
    ontologySetDigest: digest,
    proofPolicySetDigest: digest,
    inputsDigest: digest,
    factSetDigest: digest,
    providerSetDigest: digest,
    compositionPolicyDigest: digest,
  },
  ontology: [{ id: 'workspai.graph.ontology.core', version: '0.1.0-candidate' }],
  nodes: [
    {
      id: 'project:api',
      kind: 'project',
      scope: projectScope,
      identityScheme: GRAPH_IDENTITY_SCHEME,
    },
    {
      id: 'file:project-api:src/index.ts',
      kind: 'file',
      scope: projectScope,
      identityScheme: GRAPH_IDENTITY_SCHEME,
    },
  ],
  edges: [
    {
      id: 'edge:project-api:contains-index',
      relation: 'contains',
      semantics: 'structural',
      from: 'project:api',
      to: 'file:project-api:src/index.ts',
      state: 'accepted',
      facts: ['fact:project-api:contains-index'],
      derivations: ['observed'],
      proof: {
        policy: { id: 'workspai.graph.proof.standard', version: '1' },
        state: 'supported',
        evidence: [
          {
            id: 'evidence:project-api:index',
            sourceKind: 'repository-file',
            relativeLocator: 'src/index.ts',
            digest,
          },
        ],
        authorities: ['observed'],
        corroborationGroups: [],
        counterEvidence: [],
        missingRequirements: [],
        evaluatedAt: '2026-09-09T00:00:00.000Z',
        inputDigest: digest,
        explanationCode: 'PROJECT_CONTAINS_FILE',
      },
      freshness: { status: 'current' },
      confidence: 1,
      explanation: { code: 'PROJECT_CONTAINS_FILE', drivers: ['repository-file'] },
    },
  ],
  assertions: [],
  disputes: [],
  unresolved: [],
  diagnostics: [],
};

const projectQuality: GraphQualityReport = {
  contract: GRAPH_QUALITY_CONTRACT,
  generation,
  integrity: 'pass',
  determinism: 'pass',
  incrementalEquivalence: 'not-assessed',
  coverage: [],
  proofStates: {
    supported: 0,
    corroborated: 0,
    verified: 0,
    disputed: 0,
    insufficient: 0,
    unresolved: 0,
  },
  unknownZones: [],
  unsupportedZones: [],
  staleZones: [],
  conflicts: [],
  orphans: [],
  providerFailures: [],
  releaseClaims: [],
};

function ports(): GraphExecutionPorts {
  return {
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (value) => createHash('sha256').update(value).digest('hex'),
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
        };
      },
    },
  };
}

describe('buildWorkspaceGraph', () => {
  it('composes a workspace graph from immutable project generations without re-extraction', async () => {
    const result = await buildWorkspaceGraph({
      context: {
        workspaceId: workspaceScope.workspaceId,
        root: '/portable/workspace',
        scope: workspaceScope,
      },
      projects: [
        {
          projectIdentity: 'project:api',
          graph: projectGraph,
          quality: projectQuality,
          artifactRef: '.workspai/reports/source-evidence-graph.json',
          membership: 'linked',
        },
      ],
      policy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports: ports(),
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('complete');
    expect(result.value.graph?.nodes.some((node) => node.kind === 'workspace')).toBe(true);
    expect(result.value.graph?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'file:project-api:src/index.ts' }),
        expect.objectContaining({ id: 'workspace-membership:workspace:platform:project:api' }),
      ])
    );
    expect(result.value.graph?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'edge:project-api:contains-index' }),
        expect.objectContaining({ relation: 'contains', from: 'workspace:workspace:platform' }),
      ])
    );
    expect(result.value.projectReferences[0]).toMatchObject({
      projectIdentity: 'project:api',
      graphGeneration: generation.id,
      membership: { workspaceId: workspaceScope.workspaceId, relationship: 'linked' },
    });
  });

  it('rejects project graphs without validated generation digests', async () => {
    const invalidGraph = {
      ...projectGraph,
      generation: {
        ...projectGraph.generation,
        reference: {
          ...generation,
          contentDigest: { algorithm: 'sha256' as const, value: '' },
        },
      },
    };
    const result = await buildWorkspaceGraph({
      context: {
        workspaceId: workspaceScope.workspaceId,
        root: '/portable/workspace',
        scope: workspaceScope,
      },
      projects: [
        {
          projectIdentity: 'project:api',
          graph: invalidGraph,
          quality: projectQuality,
          artifactRef: '.workspai/reports/source-evidence-graph.json',
          membership: 'linked',
        },
      ],
      policy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports: ports(),
    });
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('GRAPH_WORKSPACE_PROJECT_GENERATION_INVALID');
  });

  it('rejects project quality that is blocked or bound to a different generation', async () => {
    for (const quality of [
      { ...projectQuality, integrity: 'blocked' as const },
      {
        ...projectQuality,
        generation: { ...projectQuality.generation, id: 'generation:different' },
      },
    ]) {
      const result = await buildWorkspaceGraph({
        context: {
          workspaceId: workspaceScope.workspaceId,
          root: '/portable/workspace',
          scope: workspaceScope,
        },
        projects: [
          {
            projectIdentity: 'project:api',
            graph: projectGraph,
            quality,
            artifactRef: '.workspai/reports/source-evidence-graph.json',
            membership: 'linked',
          },
        ],
        policy: {
          network: 'deny',
          redactionProfile: 'portable-default',
          composition: GRAPH_STANDARD_COMPOSITION_POLICY,
        },
        ports: ports(),
      });
      expect(result).toMatchObject({ accepted: false, code: 'invalid-input' });
    }
  });

  it('rejects workspace composition without admitted project graphs', async () => {
    const result = await buildWorkspaceGraph({
      context: {
        workspaceId: workspaceScope.workspaceId,
        root: '/portable/workspace',
        scope: workspaceScope,
      },
      projects: [],
      policy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports: ports(),
    });
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('GRAPH_WORKSPACE_PROJECTS_REQUIRED');
  });
});
