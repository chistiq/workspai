import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  buildWorkspaceGraph,
  executeGraphReferenceCompositionTask,
  writeWorkspaceGraphGeneration,
} from '../../src/application/index.js';
import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_QUALITY_CONTRACT,
  type GraphCanonicalGraph,
  type GraphQualityReport,
} from '../../src/contracts/index.js';
import type {
  GraphExecutionPorts,
  GraphProjectPublicationRequest,
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
  ],
  edges: [],
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

async function workspaceBuild() {
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
  if (!result.accepted) throw new Error('workspace build failed');
  return result.value;
}

describe('writeWorkspaceGraphGeneration', () => {
  it('publishes canonical immutable workspace artifacts through the injected store', async () => {
    const build = await workspaceBuild();
    const publish = vi.fn(async (publicationRequest: GraphProjectPublicationRequest) => ({
      status: 'committed' as const,
      pointer: '.workspai/reports/graph-generation.json',
      artifacts: Object.fromEntries(
        publicationRequest.artifacts.map((candidate) => [
          candidate.name,
          `.workspai/reports/${candidate.name}.json`,
        ])
      ) as Record<'canonical-graph' | 'quality' | 'provider-runs' | 'publication', string>,
    }));

    const result = await writeWorkspaceGraphGeneration({
      build,
      store: { publish },
      digest: ports().digest,
    });

    expect(result).toMatchObject({ accepted: true, value: { status: 'committed' } });
    expect(publish).toHaveBeenCalledOnce();
    const publication = publish.mock.calls[0]?.[0];
    expect(publication?.generationKey).toMatch(/^[a-f0-9]{64}$/u);
    const publicationArtifact = publication?.artifacts.find(
      (candidate) => candidate.name === 'publication'
    );
    const publicationIndex = JSON.parse(
      new TextDecoder().decode(publicationArtifact?.bytes ?? new Uint8Array())
    ) as {
      schemaVersion: string;
      artifacts: Record<string, { digest: string; path: string }>;
    };
    expect(publicationIndex.schemaVersion).toBe('workspai.graph.workspace-publication-index.v1');
    expect(publicationIndex.artifacts['canonical-graph']?.path).toMatch(
      /^\.workspai\/reports\/graph-generations\/[a-f0-9]{64}\/workspace-graph\.json$/u
    );
  });

  it('refuses partial, failed, and cancelled builds and never calls the store', async () => {
    const publish = vi.fn();
    const build = await workspaceBuild();

    for (const status of ['partial', 'failed', 'cancelled'] as const) {
      const result = await writeWorkspaceGraphGeneration({
        build: {
          ...build,
          status,
          ...(status === 'partial' ? {} : { graph: undefined }),
        },
        store: { publish },
        digest: ports().digest,
      });
      expect(result).toMatchObject({ accepted: false, code: 'invalid-build' });
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not call the store when cancellation is already requested', async () => {
    const build = await workspaceBuild();
    const publish = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const result = await writeWorkspaceGraphGeneration({
      build,
      store: { publish },
      digest: ports().digest,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: 'GRAPH_WORKSPACE_PUBLICATION_CANCELLED' })],
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('converts store failures into portable diagnostics', async () => {
    const build = await workspaceBuild();
    const result = await writeWorkspaceGraphGeneration({
      build,
      store: {
        publish: async () => {
          throw new Error('/private/workspace/secret');
        },
      },
      digest: ports().digest,
    });

    expect(result).toMatchObject({ accepted: false, code: 'publication-failed' });
    expect(JSON.stringify(result)).not.toContain('/private/workspace/secret');
  });
});
