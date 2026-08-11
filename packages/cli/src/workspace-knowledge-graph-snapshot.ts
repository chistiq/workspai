import fsExtra from 'fs-extra';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import type { WorkspaceModel } from './workspace-model.js';
import {
  assertWorkspaceKnowledgeGraphSourceBinding,
  computeWorkspaceKnowledgeGraphInputFingerprint,
} from './workspace-knowledge-graph.js';
import { firstExistingWorkspaceArtifactPath } from './utils/artifact-path-compat.js';

export type WorkspaceKnowledgeGraphSnapshotResult =
  | {
      status: 'hit';
      model: WorkspaceModel;
      graph: WorkspaceKnowledgeGraph;
      modelPath: string;
      graphPath: string;
    }
  | {
      status: 'miss';
      reason:
        | 'missing-model'
        | 'missing-graph'
        | 'invalid-model'
        | 'invalid-graph'
        | 'missing-input-fingerprint'
        | 'invalid-input-fingerprint'
        | 'live-input-mismatch'
        | 'input-scan-failed'
        | 'stale-proof'
        | 'source-mismatch';
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isWorkspaceModel(value: unknown): value is WorkspaceModel {
  const candidate = record(value);
  return Boolean(
    candidate &&
    candidate.schemaVersion === WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model &&
    record(candidate.workspace) &&
    Array.isArray(candidate.projects) &&
    (record(candidate.projectTopology) || record(candidate.graph))
  );
}

function isWorkspaceKnowledgeGraph(value: unknown): value is WorkspaceKnowledgeGraph {
  const candidate = record(value);
  return Boolean(
    candidate &&
    candidate.schemaVersion === WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph &&
    record(candidate.source) &&
    record(candidate.workspace) &&
    Array.isArray(candidate.entities) &&
    Array.isArray(candidate.relations) &&
    Array.isArray(candidate.proofs) &&
    Array.isArray(candidate.providers) &&
    record(candidate.quality)
  );
}

async function readJson(path: string): Promise<unknown> {
  try {
    return await fsExtra.readJson(path);
  } catch {
    return null;
  }
}

/**
 * Load the canonical persisted graph only when it is structurally valid and is
 * cryptographically bound to the persisted canonical model. This is a
 * read-only fast path for agent retrieval; graph emit/intelligence remain the
 * authoritative refresh operations.
 */
export async function readWorkspaceKnowledgeGraphSnapshot(
  workspacePath: string
): Promise<WorkspaceKnowledgeGraphSnapshotResult> {
  const [modelPath, graphPath] = await Promise.all([
    firstExistingWorkspaceArtifactPath(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model),
    firstExistingWorkspaceArtifactPath(
      workspacePath,
      WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph
    ),
  ]);
  if (!modelPath) return { status: 'miss', reason: 'missing-model' };
  if (!graphPath) return { status: 'miss', reason: 'missing-graph' };

  const [modelCandidate, graphCandidate] = await Promise.all([
    readJson(modelPath),
    readJson(graphPath),
  ]);
  if (!isWorkspaceModel(modelCandidate)) return { status: 'miss', reason: 'invalid-model' };
  if (!isWorkspaceKnowledgeGraph(graphCandidate)) {
    return { status: 'miss', reason: 'invalid-graph' };
  }
  if (graphCandidate.proofs.some((proof) => proof.freshness === 'stale')) {
    return { status: 'miss', reason: 'stale-proof' };
  }
  try {
    assertWorkspaceKnowledgeGraphSourceBinding(graphCandidate, modelCandidate);
  } catch {
    return { status: 'miss', reason: 'source-mismatch' };
  }
  const inputs = graphCandidate.source.inputs;
  if (!inputs) return { status: 'miss', reason: 'missing-input-fingerprint' };
  const workspaceScopes = inputs.scopes.filter((scope) => scope.kind === 'workspace');
  const projectScopes = inputs.scopes.filter((scope) => scope.kind === 'project');
  const expectedProjectIds = modelCandidate.projects.map((project) => project.name).sort();
  const observedProjectIds = projectScopes.map((scope) => scope.id).sort();
  const projectFileLimits = new Set(projectScopes.map((scope) => scope.fileLimit));
  if (
    inputs.schemaVersion !== 'workspace-knowledge-graph-inputs.v1' ||
    inputs.strategy !== 'hybrid-git-content-v2' ||
    inputs.hashAlgorithm !== 'sha256' ||
    workspaceScopes.length !== 1 ||
    projectFileLimits.size > 1 ||
    JSON.stringify(expectedProjectIds) !== JSON.stringify(observedProjectIds)
  ) {
    return { status: 'miss', reason: 'invalid-input-fingerprint' };
  }
  let liveInputs: WorkspaceKnowledgeGraph['source']['inputs'];
  try {
    liveInputs = await computeWorkspaceKnowledgeGraphInputFingerprint({
      workspacePath,
      projects: modelCandidate.projects.map((project) => ({
        id: project.name,
        path: project.path,
        ...(project.absolutePath ? { absolutePath: project.absolutePath } : {}),
      })),
      projectFileLimit: projectScopes[0]?.fileLimit ?? 20_000,
      workspaceFileLimit: workspaceScopes[0].fileLimit,
    });
  } catch {
    return { status: 'miss', reason: 'input-scan-failed' };
  }
  if (!liveInputs || liveInputs.hash !== inputs.hash) {
    return { status: 'miss', reason: 'live-input-mismatch' };
  }
  return {
    status: 'hit',
    model: modelCandidate,
    graph: graphCandidate,
    modelPath,
    graphPath,
  };
}
