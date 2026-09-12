import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import type { GraphDiagnostic, GraphPublicationManifest } from '../contracts/index.js';
import type {
  GraphDigestPort,
  GraphProjectArtifact,
  GraphProjectArtifactName,
  GraphProjectArtifactStorePort,
  GraphProjectPublicationResult,
} from '../ports/index.js';

import type { GraphWorkspaceBuildResult } from './workspace-build-types.js';

export interface GraphWorkspacePublicationIndex {
  readonly schemaVersion: 'workspai.graph.workspace-publication-index.v1';
  readonly generation: GraphPublicationManifest;
  readonly buildStatus: 'complete';
  readonly projectReferences: GraphWorkspaceBuildResult['projectReferences'];
  readonly artifacts: Readonly<
    Record<
      Exclude<GraphProjectArtifactName, 'publication'>,
      { readonly digest: string; readonly path: string }
    >
  >;
}

export const GRAPH_WORKSPACE_ARTIFACT_FILES: Readonly<Record<GraphProjectArtifactName, string>> =
  Object.freeze({
    'canonical-graph': 'workspace-graph.json',
    quality: 'workspace-graph-quality.json',
    'provider-runs': 'workspace-provider-runs.json',
    publication: 'graph-generation.json',
  });

function generationArtifactPath(generationKey: string, name: GraphProjectArtifactName): string {
  return `.workspai/reports/graph-generations/${generationKey}/${GRAPH_WORKSPACE_ARTIFACT_FILES[name]}`;
}

export type GraphWorkspacePublicationOutcome =
  | {
      readonly accepted: true;
      readonly value: GraphProjectPublicationResult;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly code: 'invalid-build' | 'serialization-failed' | 'publication-failed';
      readonly issues: readonly GraphDiagnostic[];
    };

function failure(
  code: Extract<GraphWorkspacePublicationOutcome, { readonly accepted: false }>['code'],
  issueCode: string,
  message: string
): GraphWorkspacePublicationOutcome {
  return {
    accepted: false,
    code,
    issues: [{ code: issueCode, severity: 'error', path: '/publication', message }],
  };
}

function serialize(value: unknown): Uint8Array | null {
  const canonical = canonicalizeGraphValue(value);
  return canonical.accepted ? new TextEncoder().encode(`${canonical.value}\n`) : null;
}

async function artifact(
  name: GraphProjectArtifactName,
  value: unknown,
  digest: GraphDigestPort
): Promise<GraphProjectArtifact | null> {
  const bytes = serialize(value);
  if (!bytes) return null;
  return {
    name,
    mediaType: 'application/json',
    bytes,
    digest: { algorithm: 'sha256', value: await digest.digest(bytes) },
  };
}

/** Publishes one complete immutable workspace generation through an injected atomic store. */
export async function writeWorkspaceGraphGeneration(request: {
  readonly build: GraphWorkspaceBuildResult;
  readonly store: GraphProjectArtifactStorePort;
  readonly digest: GraphDigestPort;
  readonly signal?: AbortSignal;
}): Promise<GraphWorkspacePublicationOutcome> {
  const { build } = request;
  if (build.status !== 'complete' || !build.graph || !build.quality.graph) {
    return failure(
      'invalid-build',
      'GRAPH_WORKSPACE_PUBLICATION_BUILD_INVALID',
      'Only a complete workspace build with canonical graph quality can advance the current generation.'
    );
  }
  const buildStatus = build.status;
  if (request.signal?.aborted) {
    return failure(
      'publication-failed',
      'GRAPH_WORKSPACE_PUBLICATION_CANCELLED',
      'Workspace graph publication was cancelled before staging.'
    );
  }

  const graphArtifact = await artifact('canonical-graph', build.graph, request.digest);
  const qualityArtifact = await artifact('quality', build.quality, request.digest);
  const providersArtifact = await artifact(
    'provider-runs',
    { projectReferences: build.projectReferences, metrics: build.metrics },
    request.digest
  );
  if (!graphArtifact || !qualityArtifact || !providersArtifact) {
    return failure(
      'serialization-failed',
      'GRAPH_WORKSPACE_PUBLICATION_SERIALIZATION_FAILED',
      'Workspace graph artifacts could not be canonically serialized.'
    );
  }

  const generation: GraphPublicationManifest = {
    generation: build.graph.generation,
    artifactDigest: graphArtifact.digest,
    qualityDigest: qualityArtifact.digest,
    publication: 'committed',
  };
  const index: GraphWorkspacePublicationIndex = {
    schemaVersion: 'workspai.graph.workspace-publication-index.v1',
    generation,
    buildStatus,
    projectReferences: build.projectReferences,
    artifacts: {
      'canonical-graph': {
        digest: graphArtifact.digest.value,
        path: generationArtifactPath(
          build.graph.generation.reference.contentDigest.value,
          'canonical-graph'
        ),
      },
      quality: {
        digest: qualityArtifact.digest.value,
        path: generationArtifactPath(
          build.graph.generation.reference.contentDigest.value,
          'quality'
        ),
      },
      'provider-runs': {
        digest: providersArtifact.digest.value,
        path: generationArtifactPath(
          build.graph.generation.reference.contentDigest.value,
          'provider-runs'
        ),
      },
    },
  };
  const publicationArtifact = await artifact('publication', index, request.digest);
  if (!publicationArtifact) {
    return failure(
      'serialization-failed',
      'GRAPH_WORKSPACE_PUBLICATION_INDEX_FAILED',
      'Workspace graph publication index could not be canonically serialized.'
    );
  }

  try {
    const value = await request.store.publish({
      generationKey: build.graph.generation.reference.contentDigest.value,
      artifacts: [graphArtifact, qualityArtifact, providersArtifact, publicationArtifact],
      signal: request.signal,
    });
    return { accepted: true, value, issues: [] };
  } catch {
    return failure(
      'publication-failed',
      'GRAPH_WORKSPACE_PUBLICATION_STORE_FAILED',
      'The artifact store failed without advancing a trusted workspace generation.'
    );
  }
}
