import { buildPreparedProjectPackageGraph } from './graph-package-project-build.js';
import { renderCanonicalGraphAsWorkspaceKnowledgeGraph } from './graph-package-compatibility-renderer.js';
import type { GraphPackageCompatibilitySourceBinding } from './graph-package-compatibility-renderer.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import { buildWorkspaceKnowledgeGraph } from './workspace-knowledge-graph.js';
import type { BuildWorkspaceKnowledgeGraphOptions } from './workspace-knowledge-graph.js';

/**
 * G8 production authority remains the released CLI composer. Package-primary
 * cutover is a later governed decision and must never happen by silent fallback.
 */
export const GRAPH_CONSUMER_RUNTIME_AUTHORITY = 'official-internal-graph-capability' as const;
export const GRAPH_CONSUMER_PACKAGE_PRIMARY = false as const;
export const GRAPH_CONSUMER_SILENT_FALLBACK = 'prohibited' as const;

export interface PackageWorkspaceKnowledgeGraphCandidate {
  readonly authority: 'package-shadow-candidate';
  readonly packagePrimary: false;
  readonly fallback: 'prohibited';
  readonly graph: WorkspaceKnowledgeGraph;
  readonly packageGeneration: {
    readonly inputsDigest: string;
    readonly providerSetDigest: string;
    readonly compositionPolicyDigest: string;
  };
}

/** Production consumer path. Remains the released CLI composer during G8. */
export async function resolveWorkspaceKnowledgeGraphForConsumer(
  options: BuildWorkspaceKnowledgeGraphOptions
): Promise<WorkspaceKnowledgeGraph> {
  return buildWorkspaceKnowledgeGraph(options);
}

/**
 * Read-only package candidate for consumer shadow tests. It does not persist
 * artifacts, replace production authority, or invent topology or workspace identity.
 */
export async function buildPackageWorkspaceKnowledgeGraphCandidate(input: {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly projectRoot: string;
  readonly workspaceName: string;
  readonly generatedAt: string;
  readonly projectTopology: WorkspaceDependencyGraph;
  readonly sourceBinding: GraphPackageCompatibilitySourceBinding;
  readonly signal?: AbortSignal;
}): Promise<PackageWorkspaceKnowledgeGraphCandidate> {
  const built = await buildPreparedProjectPackageGraph({
    context: {
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      workspaceId: input.workspaceId,
    },
    signal: input.signal,
  });
  if (!built.comparison || !built.semanticBinding) {
    throw new Error('Package Graph candidate could not be rendered without a canonical graph.');
  }
  return {
    authority: 'package-shadow-candidate',
    packagePrimary: false,
    fallback: 'prohibited',
    graph: renderCanonicalGraphAsWorkspaceKnowledgeGraph({
      projectId: input.projectId,
      workspaceName: input.workspaceName,
      generatedAt: input.generatedAt,
      package: built.comparison,
      projectTopology: input.projectTopology,
      sourceBinding: input.sourceBinding,
    }),
    packageGeneration: {
      inputsDigest: built.semanticBinding.sourceFixtureDigest,
      providerSetDigest: built.semanticBinding.providerProfileDigest,
      compositionPolicyDigest: built.semanticBinding.graphPolicyDigest,
    },
  };
}
