import type { GraphCanonicalGraph, GraphDiagnostic } from '../contracts/index.js';
import type {
  GraphWorkspaceOnboardingPlan,
  GraphWorkspaceOnboardingRequest,
} from '../contracts/workspace-integration.js';

import { buildRepoGraph } from './build-repo-graph.js';
import { writeGraphGeneration } from './publish-project-graph.js';
import { writeWorkspaceGraphGeneration } from './publish-workspace-graph.js';
import {
  projectIdentityFromScope,
  type GraphStandaloneGraphExecution,
  type GraphStandaloneGraphRequest,
  workspaceScope,
} from './standalone-build-types.js';
import { buildWorkspaceGraph } from './build-workspace-graph.js';
import type { GraphDualScopeGraphResult } from './workspace-build-types.js';

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return { code, severity, path, message };
}

function onboardingRequest(
  request: GraphStandaloneGraphRequest,
  projectIdentity: string,
  graph: GraphCanonicalGraph
): GraphWorkspaceOnboardingRequest {
  return Object.freeze({
    mode: request.mode as GraphWorkspaceOnboardingRequest['mode'],
    project: Object.freeze({
      proposedId: projectIdentity,
      root: request.repo.root,
      graphGeneration: graph.generation.reference.id,
      graphDigest: graph.generation.reference.contentDigest,
      artifactRef: '.workspai/reports/source-evidence-graph.json',
    }),
    workspace: request.workspace,
    requestedProfile: 'minimal',
    interaction: request.interaction.approved ? 'non-interactive-approved' : 'interactive-approved',
  });
}

function workspaceState(
  status: GraphDualScopeGraphResult['workspace']['status'],
  rest: Omit<GraphDualScopeGraphResult['workspace'], 'status'> = {}
): GraphDualScopeGraphResult['workspace'] {
  return Object.freeze({ status, ...rest });
}

function failedProject(
  build: Awaited<ReturnType<typeof buildRepoGraph>>,
  diagnostics: GraphDiagnostic[]
): GraphDualScopeGraphResult {
  return Object.freeze({
    status: 'failed',
    project: { build },
    workspace: workspaceState('not-requested'),
    diagnostics: Object.freeze(diagnostics),
  });
}

/** Orchestrates project-first standalone execution with optional workspace composition. */
export async function runStandaloneGraph(
  request: GraphStandaloneGraphRequest
): Promise<GraphStandaloneGraphExecution> {
  const projectIdentity = projectIdentityFromScope(request.repo.scope);
  if (!projectIdentity) {
    return {
      accepted: false,
      code: 'invalid-input',
      issues: [
        {
          code: 'GRAPH_STANDALONE_PROJECT_SCOPE_REQUIRED',
          path: '/repo/scope',
          message: 'Standalone orchestration requires an explicit project scope.',
        },
      ],
    };
  }
  if (
    request.mode === 'project-and-existing-workspace' &&
    !request.workspace?.id &&
    !request.workspace?.root
  ) {
    return {
      accepted: false,
      code: 'invalid-input',
      issues: [
        {
          code: 'GRAPH_STANDALONE_WORKSPACE_SELECTION_REQUIRED',
          path: '/workspace',
          message: 'Existing-workspace mode requires a workspace id or root.',
        },
      ],
    };
  }

  request.repo.ports.cancellation.throwIfAborted();
  const build = await buildRepoGraph(request.repo);
  const diagnostics: GraphDiagnostic[] = [...build.diagnostics];

  if (build.status === 'cancelled') {
    return {
      accepted: true,
      value: failedProject(build, diagnostics),
      issues: [],
    };
  }
  if (
    build.status === 'failed' ||
    !build.graph ||
    !build.quality.graph ||
    (build.status !== 'complete' && build.status !== 'partial')
  ) {
    return {
      accepted: true,
      value: failedProject(build, diagnostics),
      issues: [],
    };
  }

  let projectArtifact: string | undefined;
  if (request.write && request.projectStore) {
    const publication = await writeGraphGeneration({
      build,
      store: request.projectStore,
      digest: request.repo.ports.digest,
      signal: request.signal,
    });
    if (!publication.accepted) {
      diagnostics.push(...publication.issues);
      return {
        accepted: true,
        value: Object.freeze({
          status: 'partial',
          project: { build, generation: build.graph.generation.reference },
          workspace: workspaceState('not-requested'),
          diagnostics: Object.freeze(diagnostics),
        }),
        issues: [],
      };
    }
    projectArtifact = publication.value.pointer;
  }

  if (request.mode === 'project-only') {
    return {
      accepted: true,
      value: Object.freeze({
        status: 'complete-project-only',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('not-requested'),
        diagnostics: Object.freeze(diagnostics),
      }),
      issues: [],
    };
  }

  if (!request.interaction.approved) {
    return {
      accepted: true,
      value: Object.freeze({
        status: 'complete-project-only',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('not-requested'),
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic(
            'GRAPH_STANDALONE_WORKSPACE_NOT_APPROVED',
            'info',
            '/interaction',
            'Workspace onboarding was not approved; the project result remains complete.'
          ),
        ]),
      }),
      issues: [],
    };
  }

  if (!request.onboarding) {
    return {
      accepted: true,
      value: Object.freeze({
        status: 'partial',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('handoff-unavailable', {
          renewalCommand: 'workspai workspace link --project <path>',
        }),
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic(
            'GRAPH_STANDALONE_ONBOARDING_ADAPTER_MISSING',
            'warning',
            '/onboarding',
            'Workspace composition requires an injected onboarding adapter; none was supplied.'
          ),
        ]),
      }),
      issues: [],
    };
  }

  const handoff = onboardingRequest(request, projectIdentity, build.graph);
  let plan: GraphWorkspaceOnboardingPlan;
  try {
    plan = await request.onboarding.plan(handoff);
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'GRAPH_STANDALONE_ONBOARDING_PLAN_FAILED',
        'error',
        '/onboarding/plan',
        error instanceof Error ? error.message : 'Workspace onboarding planning failed.'
      )
    );
    return {
      accepted: true,
      value: Object.freeze({
        status: 'partial',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('handoff-unavailable'),
        diagnostics: Object.freeze(diagnostics),
      }),
      issues: [],
    };
  }

  const onboarding = await request.onboarding.apply(plan, {
    approved: request.interaction.approved,
    signal: request.signal,
  });
  diagnostics.push(...onboarding.diagnostics);
  if (onboarding.status === 'failed' || !onboarding.workspace) {
    return {
      accepted: true,
      value: Object.freeze({
        status: 'partial',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('failed', {
          renewalCommand: onboarding.workspaceRenewalCommand,
        }),
        diagnostics: Object.freeze(diagnostics),
      }),
      issues: [],
    };
  }

  const workspaceId = onboarding.workspace.id;
  const workspaceBuild = await buildWorkspaceGraph({
    context: {
      workspaceId,
      root: onboarding.workspace.root,
      scope: workspaceScope(workspaceId),
    },
    projects: [
      {
        projectIdentity,
        graph: build.graph,
        quality: build.quality.graph,
        artifactRef: '.workspai/reports/source-evidence-graph.json',
        membership:
          onboarding.membership?.relationship ??
          (onboarding.status === 'adopted-in-place' ? 'adopted-in-place' : 'linked'),
      },
    ],
    policy: request.workspacePolicy,
    ports: request.repo.ports,
    signal: request.signal,
  });

  if (!workspaceBuild.accepted || workspaceBuild.value.status === 'failed') {
    diagnostics.push(
      ...(workspaceBuild.accepted
        ? workspaceBuild.value.diagnostics
        : workspaceBuild.issues.map((issue) => ({
            code: issue.code,
            severity: 'error' as const,
            path: issue.path,
            message: issue.message,
          })))
    );
    return {
      accepted: true,
      value: Object.freeze({
        status: 'partial',
        project: {
          build,
          artifact: projectArtifact,
          generation: build.graph.generation.reference,
        },
        workspace: workspaceState('failed', {
          build: workspaceBuild.accepted ? workspaceBuild.value : undefined,
          renewalCommand: onboarding.workspaceRenewalCommand,
        }),
        diagnostics: Object.freeze(diagnostics),
      }),
      issues: [],
    };
  }

  let workspaceArtifact: string | undefined;
  if (request.write && request.workspaceStore) {
    const publication = await writeWorkspaceGraphGeneration({
      build: workspaceBuild.value,
      store: request.workspaceStore,
      digest: request.repo.ports.digest,
      signal: request.signal,
    });
    if (!publication.accepted) {
      diagnostics.push(...publication.issues);
      return {
        accepted: true,
        value: Object.freeze({
          status: 'partial',
          project: {
            build,
            artifact: projectArtifact,
            generation: build.graph.generation.reference,
          },
          workspace: workspaceState('failed', {
            build: workspaceBuild.value,
            projectReference: workspaceBuild.value.projectReferences[0],
            renewalCommand: onboarding.workspaceRenewalCommand,
          }),
          diagnostics: Object.freeze(diagnostics),
        }),
        issues: [],
      };
    }
    workspaceArtifact = publication.value.pointer;
  }

  const result: GraphDualScopeGraphResult = Object.freeze({
    status: 'complete-dual-scope',
    project: {
      build,
      artifact: projectArtifact,
      generation: build.graph.generation.reference,
    },
    workspace: workspaceState('complete', {
      build: workspaceBuild.value,
      artifact: workspaceArtifact,
      generation: workspaceBuild.value.graph?.generation.reference,
      projectReference: workspaceBuild.value.projectReferences[0],
      renewalCommand: onboarding.workspaceRenewalCommand,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
  return { accepted: true, value: result, issues: [] };
}
