import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import type { GraphDiagnostic, GraphPublicationManifest } from '../contracts/index.js';
import type {
  GraphDigestPort,
  GraphProjectArtifact,
  GraphProjectArtifactName,
  GraphProjectArtifactStorePort,
  GraphProjectPublicationResult,
} from '../ports/index.js';

import type { GraphRepoBuildResult } from './repo-build-types.js';

export interface GraphProjectPublicationIndex {
  readonly schemaVersion: 'workspai.graph.project-publication-index.v1';
  readonly generation: GraphPublicationManifest;
  readonly buildStatus: 'complete';
  readonly artifacts: Readonly<
    Record<
      Exclude<GraphProjectArtifactName, 'publication'>,
      { readonly digest: string; readonly path: string }
    >
  >;
}

export const GRAPH_PROJECT_ARTIFACT_FILES: Readonly<Record<GraphProjectArtifactName, string>> =
  Object.freeze({
    'canonical-graph': 'source-evidence-graph.json',
    quality: 'source-evidence-graph-quality.json',
    'provider-runs': 'graph-provider-runs.json',
    publication: 'graph-generation.json',
  });

function generationArtifactPath(generationKey: string, name: GraphProjectArtifactName): string {
  return `.workspai/reports/graph-generations/${generationKey}/${GRAPH_PROJECT_ARTIFACT_FILES[name]}`;
}

export type GraphProjectPublicationOutcome =
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

type GraphProjectPublicationFailureCode = Extract<
  GraphProjectPublicationOutcome,
  { readonly accepted: false }
>['code'];

function failure(
  code: GraphProjectPublicationFailureCode,
  issueCode: string,
  message: string
): GraphProjectPublicationOutcome {
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

/**
 * Publishes one immutable project generation through an injected atomic store.
 * Only complete, validated builds are publishable and no host path enters the artifacts.
 */
export async function writeGraphGeneration(request: {
  readonly build: GraphRepoBuildResult;
  readonly store: GraphProjectArtifactStorePort;
  readonly digest: GraphDigestPort;
  readonly signal?: AbortSignal;
}): Promise<GraphProjectPublicationOutcome> {
  const { build } = request;
  if (build.status !== 'complete' || !build.graph || !build.quality.graph) {
    return failure(
      'invalid-build',
      'GRAPH_PROJECT_PUBLICATION_BUILD_INVALID',
      'Only a complete graph build with canonical graph quality can advance the current generation.'
    );
  }
  const buildStatus = build.status;
  if (request.signal?.aborted) {
    return failure(
      'publication-failed',
      'GRAPH_PROJECT_PUBLICATION_CANCELLED',
      'Project graph publication was cancelled before staging.'
    );
  }

  const graphArtifact = await artifact('canonical-graph', build.graph, request.digest);
  const qualityArtifact = await artifact('quality', build.quality, request.digest);
  const providersArtifact = await artifact('provider-runs', build.providers, request.digest);
  if (!graphArtifact || !qualityArtifact || !providersArtifact) {
    return failure(
      'serialization-failed',
      'GRAPH_PROJECT_PUBLICATION_SERIALIZATION_FAILED',
      'Project graph artifacts could not be canonically serialized.'
    );
  }

  const generation: GraphPublicationManifest = {
    generation: build.graph.generation,
    artifactDigest: graphArtifact.digest,
    qualityDigest: qualityArtifact.digest,
    publication: 'committed',
  };
  const index: GraphProjectPublicationIndex = {
    schemaVersion: 'workspai.graph.project-publication-index.v1',
    generation,
    buildStatus,
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
      'GRAPH_PROJECT_PUBLICATION_INDEX_FAILED',
      'Project graph publication index could not be canonically serialized.'
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
      'GRAPH_PROJECT_PUBLICATION_STORE_FAILED',
      'The artifact store failed without advancing a trusted project generation.'
    );
  }
}
