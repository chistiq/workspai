import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import * as buildWorkspaceGraphModule from '../../src/application/build-workspace-graph.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  projectIdentityFromScope,
  runStandaloneGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type {
  GraphWorkspaceOnboardingPlan,
  GraphWorkspaceOnboardingPort,
} from '../../src/contracts/workspace-integration.js';
import type {
  GraphProductHostPorts,
  GraphProjectArtifactStorePort,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import { createRepositoryFilesProvider } from '../../src/providers/index.js';

const scope = { kind: 'project' as const, projectIds: ['project:standalone'] as [string] };

function ports(): GraphProductHostPorts {
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
    fileSource: {
      inventory: async () => ({
        status: 'complete',
        inputs: [
          {
            locator: 'src/index.ts',
            mediaType: 'text/typescript',
            byteLength: 21,
            digest: { algorithm: 'sha256', value: 'a'.repeat(64) },
          },
        ],
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
      }),
      read: async () => new TextEncoder().encode('export const ok = 1;'),
    },
  };
}

function mockStore(): GraphProjectArtifactStorePort {
  return {
    publish: vi.fn(async () => ({
      status: 'committed' as const,
      pointer: '.workspai/reports/graph-generation.json',
      artifacts: {
        'canonical-graph': '.workspai/reports/graph-generations/test/source-evidence-graph.json',
        quality: '.workspai/reports/graph-generations/test/source-evidence-graph-quality.json',
        'provider-runs': '.workspai/reports/graph-generations/test/graph-provider-runs.json',
        publication: '.workspai/reports/graph-generation.json',
      },
    })),
  };
}

function onboardingAdapter(): GraphWorkspaceOnboardingPort {
  return {
    plan: async (request) =>
      Object.freeze({
        request,
        plannedWrites: ['workspace membership'],
        requiresCentralCli: true,
        diagnostics: [],
      }) satisfies GraphWorkspaceOnboardingPlan,
    apply: async () => ({
      status: 'linked',
      workspace: {
        id: 'workspace:managed-default',
        root: '/portable/workspace',
        profile: 'minimal',
      },
      membership: {
        workspaceId: 'workspace:managed-default',
        relationship: 'linked',
      },
      plannedWrites: ['workspace membership'],
      appliedWrites: ['workspace membership'],
      workspaceRenewalCommand: 'workspai workspace graph --write --json',
      diagnostics: [],
    }),
  };
}

function repoRequest(overrides: { ports?: GraphProductHostPorts } = {}) {
  return {
    root: '/portable/project',
    scope,
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: [createRepositoryFilesProvider()],
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: overrides.ports ?? ports(),
  };
}

describe('projectIdentityFromScope', () => {
  it('returns the first project id for project scopes only', () => {
    expect(projectIdentityFromScope(scope)).toBe('project:standalone');
    expect(
      projectIdentityFromScope({ kind: 'workspace', workspaceId: 'workspace:ignored' })
    ).toBeUndefined();
  });
});

describe('runStandaloneGraph', () => {
  it('returns complete-project-only without workspace onboarding', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-only',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('complete-project-only');
    expect(result.value.workspace.status).toBe('not-requested');
    expect(result.value.project.generation?.id).toBeDefined();
  });

  it('reports handoff-unavailable when workspace mode lacks an onboarding adapter', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('handoff-unavailable');
    expect(result.value.project.generation?.id).toBeDefined();
  });

  it('composes dual-scope output when onboarding succeeds', async () => {
    const projectStore = mockStore();
    const workspaceStore = mockStore();
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: true,
      projectStore,
      workspaceStore,
      onboarding: onboardingAdapter(),
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('complete-dual-scope');
    expect(result.value.workspace.status).toBe('complete');
    expect(result.value.workspace.projectReference?.graphGeneration).toBe(
      result.value.project.generation?.id
    );
    expect(projectStore.publish).toHaveBeenCalledOnce();
    expect(workspaceStore.publish).toHaveBeenCalledOnce();
  });

  it('rejects existing-workspace mode without a workspace selection', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-existing-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('GRAPH_STANDALONE_WORKSPACE_SELECTION_REQUIRED');
  });

  it('rejects orchestration without an explicit project scope', async () => {
    const result = await runStandaloneGraph({
      repo: {
        ...repoRequest(),
        scope: { kind: 'workspace', workspaceId: 'workspace:only' },
      },
      mode: 'project-only',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(false);
    expect(result.issues[0]?.code).toBe('GRAPH_STANDALONE_PROJECT_SCOPE_REQUIRED');
  });

  it('keeps a complete project result when workspace approval is missing', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      interaction: { approved: false },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('complete-project-only');
    expect(result.value.workspace.status).toBe('not-requested');
    expect(
      result.value.diagnostics.some(
        (item) => item.code === 'GRAPH_STANDALONE_WORKSPACE_NOT_APPROVED'
      )
    ).toBe(true);
  });

  it('returns partial when project publication fails', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-only',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: true,
      projectStore: {
        publish: async () => {
          throw new Error('store unavailable');
        },
      },
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('not-requested');
  });

  it('returns partial when onboarding planning fails', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      onboarding: {
        plan: async () => {
          throw new Error('planning failed');
        },
        apply: async () => ({
          status: 'failed',
          plannedWrites: [],
          appliedWrites: [],
          diagnostics: [],
        }),
      },
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('handoff-unavailable');
  });

  it('returns partial when onboarding apply fails', async () => {
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      onboarding: {
        plan: onboardingAdapter().plan,
        apply: async () => ({
          status: 'failed',
          plannedWrites: ['workspace membership'],
          appliedWrites: [],
          workspaceRenewalCommand: 'workspai workspace link --project <path>',
          diagnostics: [
            {
              code: 'GRAPH_WORKSPACE_ONBOARDING_FAILED',
              severity: 'error',
              path: '/onboarding/apply',
              message: 'Workspace onboarding could not be applied.',
            },
          ],
        }),
      },
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('failed');
  });

  it.each(['failed', 'cancelled'] as const)(
    'returns failed when repository inventory is %s',
    async (status) => {
      const hostPorts = ports();
      hostPorts.fileSource.inventory = async () => ({
        status,
        inputs: [],
        diagnostics: [],
        omittedFiles: 1,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
      });
      const result = await runStandaloneGraph({
        repo: repoRequest({ ports: hostPorts }),
        mode: 'project-only',
        workspacePolicy: {
          network: 'deny',
          redactionProfile: 'portable-default',
          composition: GRAPH_STANDARD_COMPOSITION_POLICY,
        },
        write: false,
        interaction: { approved: true },
      });
      expect(result.accepted).toBe(true);
      if (!result.accepted) return;
      expect(result.value.status).toBe('failed');
      expect(result.value.project.build.status).toBe(status);
    }
  );

  it('returns partial when workspace composition is rejected', async () => {
    const spy = vi.spyOn(buildWorkspaceGraphModule, 'buildWorkspaceGraph').mockResolvedValue({
      accepted: false,
      code: 'composition-failed',
      issues: [
        {
          code: 'GRAPH_WORKSPACE_COMPOSITION_REJECTED',
          path: '/projects',
          message: 'Workspace composition was rejected.',
        },
      ],
    });
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: false,
      onboarding: onboardingAdapter(),
      interaction: { approved: true },
    });
    spy.mockRestore();
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('failed');
  });

  it('returns partial when workspace publication fails after composition', async () => {
    const projectStore = mockStore();
    const result = await runStandaloneGraph({
      repo: repoRequest(),
      mode: 'project-and-default-workspace',
      workspacePolicy: {
        network: 'deny',
        redactionProfile: 'portable-default',
        composition: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      write: true,
      projectStore,
      workspaceStore: {
        publish: async () => {
          throw new Error('workspace store unavailable');
        },
      },
      onboarding: onboardingAdapter(),
      interaction: { approved: true },
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.value.status).toBe('partial');
    expect(result.value.workspace.status).toBe('failed');
    expect(projectStore.publish).toHaveBeenCalledOnce();
  });
});
