import { GRAPH_PROJECT_ARTIFACT_FILES } from '../../application/publish-project-graph.js';

import type { GraphProjectArtifact, GraphProjectArtifactName } from '../../ports/index.js';

import {
  createNodePublicationArtifactStore,
  parsePublicationArtifact,
  publicationProperty,
  validatePublicationArtifactIntegrity,
} from './publication-artifact-store.js';

const REQUIRED_ARTIFACTS = Object.freeze(
  Object.keys(GRAPH_PROJECT_ARTIFACT_FILES).sort() as GraphProjectArtifactName[]
);

function validateProjectArtifacts(
  generationKey: string,
  artifacts: readonly GraphProjectArtifact[]
): void {
  validatePublicationArtifactIntegrity(artifacts, REQUIRED_ARTIFACTS, 'Project');
  const byName = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
  const graph = parsePublicationArtifact(byName.get('canonical-graph') as GraphProjectArtifact);
  const publication = parsePublicationArtifact(byName.get('publication') as GraphProjectArtifact);
  if (
    publicationProperty(graph, 'generation', 'reference', 'contentDigest', 'value') !==
      generationKey ||
    publication.schemaVersion !== 'workspai.graph.project-publication-index.v1' ||
    publicationProperty(
      publication,
      'generation',
      'generation',
      'reference',
      'contentDigest',
      'value'
    ) !== generationKey
  ) {
    throw new Error('Project publication generation identity validation failed.');
  }
  for (const name of ['canonical-graph', 'quality', 'provider-runs'] as const) {
    const current = byName.get(name);
    const expectedPath = `.workspai/reports/graph-generations/${generationKey}/${GRAPH_PROJECT_ARTIFACT_FILES[name]}`;
    if (
      !current ||
      publicationProperty(publication, 'artifacts', name, 'digest') !== current.digest.value ||
      publicationProperty(publication, 'artifacts', name, 'path') !== expectedPath
    ) {
      throw new Error('Project publication artifact binding validation failed.');
    }
  }
  if (
    publicationProperty(publication, 'generation', 'artifactDigest', 'value') !==
      byName.get('canonical-graph')?.digest.value ||
    publicationProperty(publication, 'generation', 'qualityDigest', 'value') !==
      byName.get('quality')?.digest.value
  ) {
    throw new Error('Project publication manifest digest binding validation failed.');
  }
}

/** Creates a locked, immutable and pointer-last project artifact store. */
export function createNodeProjectArtifactStore(projectRoot: string) {
  return createNodePublicationArtifactStore(projectRoot, {
    scopeLabel: 'project',
    rootLabel: 'project root',
    artifactFiles: GRAPH_PROJECT_ARTIFACT_FILES,
    lockFileName: '.graph-publication.lock',
    validateArtifacts: validateProjectArtifacts,
  });
}
