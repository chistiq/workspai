import type { GraphNativePort } from './graph-package-runtime.js';
import { buildPreparedProjectPackageGraph } from './graph-package-project-build.js';
import { renderCanonicalGraphAsWorkspaceKnowledgeGraph } from './graph-package-compatibility-renderer.js';
import type { GraphPackageCompatibilitySourceBinding } from './graph-package-compatibility-renderer.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import { buildWorkspaceKnowledgeGraphChangeOverlay } from './workspace-knowledge-graph-change-overlay.js';
import {
  buildProjectKnowledgeGraphReference,
  projectWorkspaceKnowledgeGraph,
  type ProjectKnowledgeGraphReference,
} from './workspace-knowledge-graph-projection.js';
import {
  queryKnowledgeEntities,
  queryKnowledgeEvidence,
  queryKnowledgePath,
  searchKnowledgeGraph,
  type WorkspaceKnowledgeEvidenceQuery,
  type WorkspaceKnowledgePathQuery,
  type WorkspaceKnowledgeSearchResult,
} from './workspace-knowledge-graph-query.js';
import { buildWorkspaceKnowledgeGraph } from './workspace-knowledge-graph.js';
import type { BuildWorkspaceKnowledgeGraphOptions } from './workspace-knowledge-graph.js';
import {
  routeHostGraphReachability,
  type HostGraphNativeReachabilityRoute,
} from './graph-package-native-routing.js';
import type { WorkspaceKnowledgeGraphChangeOverlay } from './contracts/workspace-knowledge-graph-change-overlay-contract.js';

/**
 * G8 production authority remains the released CLI composer. Package-primary
 * cutover is a later governed decision and must never happen by silent fallback.
 */
export const GRAPH_CONSUMER_RUNTIME_AUTHORITY = 'official-internal-graph-capability' as const;
export const GRAPH_CONSUMER_PACKAGE_PRIMARY = false as const;
export const GRAPH_CONSUMER_SILENT_FALLBACK = 'prohibited' as const;
export const GRAPH_PACKAGE_PRIMARY_NOT_ADMITTED = 'GRAPH_PACKAGE_PRIMARY_NOT_ADMITTED' as const;
export const GRAPH_PACKAGE_PRIMARY_COMPARE_OVERLAY =
  'GRAPH_PACKAGE_PRIMARY_COMPARE_OVERLAY' as const;
export const GRAPH_CONSUMER_SHADOW_RECEIPT_SCHEMA_VERSION =
  'workspai.graph-consumer-shadow-receipt.v1-candidate' as const;
export const GRAPH_PACKAGE_PRIMARY_COMPARE_RECEIPT_SCHEMA_VERSION =
  'workspai.graph-consumer-package-primary-compare-receipt.v1-candidate' as const;

export const GRAPH_CONSUMER_SURFACE_IDS = [
  'workspace-graph-generation',
  'source-graph',
  'graph-entities-evidence',
  'model-generation',
  'diff',
  'impact',
  'verify',
  'explain',
  'context-grounding',
  'agent-synchronization',
  'proof-carrying-change',
  'doctor-repair',
  'studio-extension',
  'mcp',
  'ci-automation',
  'g8-shadow-bridge',
] as const;

export type GraphConsumerSurfaceId = (typeof GRAPH_CONSUMER_SURFACE_IDS)[number];

export interface GraphConsumerParityStatus {
  readonly id: GraphConsumerSurfaceId;
  readonly authority: 'legacy-cli-composer' | 'released-cli-with-package-shadow';
  readonly packagePrimary: false;
  readonly fallback: 'prohibited';
  readonly adapter: 'implemented-local-candidate';
  readonly shadowReady: true;
}

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

export interface PackageConsumerQuerySurfaces {
  readonly entities: ReturnType<typeof queryKnowledgeEntities>;
  readonly search: WorkspaceKnowledgeSearchResult;
  readonly evidence: WorkspaceKnowledgeEvidenceQuery;
  readonly path: WorkspaceKnowledgePathQuery;
}

export interface GraphConsumerShadowReceipt {
  readonly schemaVersion: typeof GRAPH_CONSUMER_SHADOW_RECEIPT_SCHEMA_VERSION;
  readonly epoch: 'package-shadow';
  readonly executionPath: 'compared';
  readonly authority: 'released-cli';
  readonly packagePrimary: false;
  readonly fallback: 'prohibited';
  readonly packageWrites: 'prohibited';
  readonly packageGeneration: PackageWorkspaceKnowledgeGraphCandidate['packageGeneration'];
  readonly consumers: readonly GraphConsumerParityStatus[];
}

export interface PackageIntelligenceConsumerParity {
  readonly candidate: PackageWorkspaceKnowledgeGraphCandidate;
  readonly sourceGraph: WorkspaceKnowledgeGraph;
  readonly sourceReference: ProjectKnowledgeGraphReference;
  readonly queries: PackageConsumerQuerySurfaces;
  readonly overlay: WorkspaceKnowledgeGraphChangeOverlay;
  readonly reachability?: HostGraphNativeReachabilityRoute;
  readonly receipt: GraphConsumerShadowReceipt;
}

export function graphConsumerParityStatuses(): readonly GraphConsumerParityStatus[] {
  return GRAPH_CONSUMER_SURFACE_IDS.map((id) => ({
    id,
    authority:
      id === 'g8-shadow-bridge' ? 'released-cli-with-package-shadow' : 'legacy-cli-composer',
    packagePrimary: false,
    fallback: 'prohibited',
    adapter: 'implemented-local-candidate',
    shadowReady: true,
  }));
}

/** Production consumer path. Remains the released CLI composer during G8. */
export async function resolveWorkspaceKnowledgeGraphForConsumer(
  options: BuildWorkspaceKnowledgeGraphOptions
): Promise<WorkspaceKnowledgeGraph> {
  return buildWorkspaceKnowledgeGraph(options);
}

export class GraphPackagePrimaryNotAdmittedError extends Error {
  readonly code = GRAPH_PACKAGE_PRIMARY_NOT_ADMITTED;

  constructor() {
    super(
      'Package-primary Graph execution is not admitted. G8 remains shadow-only and silent fallback is prohibited.'
    );
    this.name = 'GraphPackagePrimaryNotAdmittedError';
  }
}

export class GraphPackagePrimaryCompareOverlayError extends Error {
  readonly code = GRAPH_PACKAGE_PRIMARY_COMPARE_OVERLAY;

  constructor() {
    super(
      'Package-primary-with-compare cannot overlay a package candidate onto itself. Legacy authority must be an independently built released-CLI graph.'
    );
    this.name = 'GraphPackagePrimaryCompareOverlayError';
  }
}

/**
 * Unadmitted package-primary entry. Always throws.
 *
 * Production consumers must not call executePackagePrimaryWithCompare. That
 * function is a fail-closed comparison receipt only and never publishes package
 * graph truth while GRAPH_CONSUMER_PACKAGE_PRIMARY remains false.
 */
export async function refuseUnadmittedPackagePrimaryExecution(): Promise<never> {
  throw new GraphPackagePrimaryNotAdmittedError();
}

export interface PackagePrimaryCompareReceipt {
  readonly schemaVersion: typeof GRAPH_PACKAGE_PRIMARY_COMPARE_RECEIPT_SCHEMA_VERSION;
  readonly epoch: 'package-primary-with-compare';
  readonly executionPath: 'compared';
  readonly authority: 'released-cli';
  readonly packagePrimary: false;
  readonly admittedProducer: false;
  readonly fallback: 'prohibited';
  readonly packageWrites: 'prohibited';
  readonly overlay: 'independent-legacy-versus-package';
  readonly packageGeneration: PackageWorkspaceKnowledgeGraphCandidate['packageGeneration'];
  readonly comparison: WorkspaceKnowledgeGraphChangeOverlay;
  readonly consumers: readonly GraphConsumerParityStatus[];
}

/**
 * Fail-closed comparison of an independently built released-CLI graph against a
 * package candidate. This is not production Graph authority, does not write
 * artifacts, and does not fall back to legacy when comparison fails.
 */
export async function executePackagePrimaryWithCompare(input: {
  readonly legacyAuthority: WorkspaceKnowledgeGraph;
  readonly packageCandidate: PackageWorkspaceKnowledgeGraphCandidate;
}): Promise<PackagePrimaryCompareReceipt> {
  if (input.packageCandidate.packagePrimary !== false) {
    throw new GraphPackagePrimaryNotAdmittedError();
  }
  if (input.legacyAuthority === input.packageCandidate.graph) {
    throw new GraphPackagePrimaryCompareOverlayError();
  }
  return {
    schemaVersion: GRAPH_PACKAGE_PRIMARY_COMPARE_RECEIPT_SCHEMA_VERSION,
    epoch: 'package-primary-with-compare',
    executionPath: 'compared',
    authority: 'released-cli',
    packagePrimary: false,
    admittedProducer: false,
    fallback: 'prohibited',
    packageWrites: 'prohibited',
    overlay: 'independent-legacy-versus-package',
    packageGeneration: input.packageCandidate.packageGeneration,
    comparison: buildWorkspaceKnowledgeGraphChangeOverlay(
      input.legacyAuthority,
      input.packageCandidate.graph
    ),
    consumers: graphConsumerParityStatuses(),
  };
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

export function buildPackageSourceGraphCandidate(
  candidate: PackageWorkspaceKnowledgeGraphCandidate,
  projectId: string
): WorkspaceKnowledgeGraph {
  return projectWorkspaceKnowledgeGraph(candidate.graph, projectId);
}

export function queryPackageConsumerGraph(
  graph: WorkspaceKnowledgeGraph,
  input: { readonly projectId: string; readonly query: string }
): PackageConsumerQuerySurfaces {
  const project = graph.entities.find((entity) => entity.kind === 'project')?.id;
  const file = graph.entities.find((entity) => entity.kind === 'file')?.id;
  return {
    entities: queryKnowledgeEntities(graph, undefined, input.projectId),
    search: searchKnowledgeGraph(graph, {
      query: input.query,
      limit: 8,
      projectId: input.projectId,
    }),
    evidence: queryKnowledgeEvidence(graph, file ?? input.query, input.projectId),
    path: queryKnowledgePath(
      graph,
      project ?? input.projectId,
      file ?? input.query,
      input.projectId
    ),
  };
}

/**
 * Runs every inventoried Workspace Intelligence consumer against a package
 * shadow candidate without changing production Graph authority.
 */
export async function buildPackageIntelligenceConsumerParity(input: {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly projectRoot: string;
  readonly workspaceName: string;
  readonly generatedAt: string;
  readonly projectTopology: WorkspaceDependencyGraph;
  readonly sourceBinding: GraphPackageCompatibilitySourceBinding;
  readonly signal?: AbortSignal;
  readonly native?: GraphNativePort;
}): Promise<PackageIntelligenceConsumerParity> {
  const candidate = await buildPackageWorkspaceKnowledgeGraphCandidate(input);
  const sourceGraph = buildPackageSourceGraphCandidate(candidate, input.projectId);
  const startEntityId =
    candidate.graph.entities.find((entity) => entity.kind === 'project')?.id ??
    candidate.graph.entities[0]?.id;
  return {
    candidate,
    sourceGraph,
    sourceReference: buildProjectKnowledgeGraphReference(candidate.graph, input.projectId),
    queries: queryPackageConsumerGraph(candidate.graph, {
      projectId: input.projectId,
      query: 'index',
    }),
    // Shadow self-overlay only. This is not package-versus-legacy compare.
    overlay: buildWorkspaceKnowledgeGraphChangeOverlay(candidate.graph, candidate.graph),
    ...(startEntityId
      ? {
          reachability: routeHostGraphReachability({
            graph: candidate.graph,
            startEntityId,
            native: input.native,
          }),
        }
      : {}),
    receipt: {
      schemaVersion: GRAPH_CONSUMER_SHADOW_RECEIPT_SCHEMA_VERSION,
      epoch: 'package-shadow',
      executionPath: 'compared',
      authority: 'released-cli',
      packagePrimary: false,
      fallback: 'prohibited',
      packageWrites: 'prohibited',
      packageGeneration: candidate.packageGeneration,
      consumers: graphConsumerParityStatuses(),
    },
  };
}
