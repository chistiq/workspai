import { GRAPH_WORKSPACE_ARTIFACT_FILES } from '../../application/publish-workspace-graph.js';

import type { GraphProjectArtifact, GraphProjectArtifactName } from '../../ports/index.js';

import {
  createNodePublicationArtifactStore,
  parsePublicationArtifact,
  publicationProperty,
  validatePublicationArtifactIntegrity,
} from './publication-artifact-store.js';

const REQUIRED_ARTIFACTS = Object.freeze(
  Object.keys(GRAPH_WORKSPACE_ARTIFACT_FILES).sort() as GraphProjectArtifactName[]
);

function validateWorkspaceArtifacts(
  generationKey: string,
  artifacts: readonly GraphProjectArtifact[]
): void {
  validatePublicationArtifactIntegrity(artifacts, REQUIRED_ARTIFACTS, 'Workspace');
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const graph = parsePublicationArtifact(byName.get('canonical-graph') as GraphProjectArtifact);
  const publication = parsePublicationArtifact(byName.get('publication') as GraphProjectArtifact);
  if (
    publicationProperty(graph, 'generation', 'reference', 'contentDigest', 'value') !==
      generationKey ||
    publication.schemaVersion !== 'workspai.graph.workspace-publication-index.v1' ||
    publicationProperty(
      publication,
      'generation',
      'generation',
      'reference',
      'contentDigest',
      'value'
    ) !== generationKey
  ) {
    throw new Error('Workspace publication generation identity validation failed.');
  }
  for (const name of ['canonical-graph', 'quality', 'provider-runs'] as const) {
    const current = byName.get(name);
    const expectedPath = `.workspai/reports/graph-generations/${generationKey}/${GRAPH_WORKSPACE_ARTIFACT_FILES[name]}`;
    if (
      !current ||
      publicationProperty(publication, 'artifacts', name, 'digest') !== current.digest.value ||
      publicationProperty(publication, 'artifacts', name, 'path') !== expectedPath
    ) {
      throw new Error('Workspace publication artifact binding validation failed.');
    }
  }
  if (
    publicationProperty(publication, 'generation', 'artifactDigest', 'value') !==
      byName.get('canonical-graph')?.digest.value ||
    publicationProperty(publication, 'generation', 'qualityDigest', 'value') !==
      byName.get('quality')?.digest.value
  ) {
    throw new Error('Workspace publication manifest digest binding validation failed.');
  }
}

/** Creates a locked, immutable and pointer-last workspace artifact store. */
export function createNodeWorkspaceArtifactStore(workspaceRoot: string) {
  return createNodePublicationArtifactStore(workspaceRoot, {
    scopeLabel: 'workspace',
    rootLabel: 'workspace root',
    artifactFiles: GRAPH_WORKSPACE_ARTIFACT_FILES,
    lockFileName: '.workspace-graph-publication.lock',
    validateArtifacts: validateWorkspaceArtifacts,
  });
}
