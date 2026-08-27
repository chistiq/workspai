import path from 'node:path';

import type {
  WorkspaceKnowledgeDiagnostic,
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProof,
  WorkspaceKnowledgeProviderRun,
  WorkspaceKnowledgeRelation,
} from './contracts/workspace-knowledge-graph-contract.js';
import type { WorkspaceModelProject } from './workspace-model.js';
import {
  calculateWorkspaceKnowledgeBindingCoverage,
  countWorkspaceKnowledgeUnknowns,
} from './workspace-knowledge-graph-quality.js';

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function projectDiagnostic(
  diagnostic: WorkspaceKnowledgeDiagnostic,
  entityIds: ReadonlySet<string>,
  relationIds: ReadonlySet<string>,
  projectId: string
): boolean {
  if (diagnostic.entityIds?.some((id) => entityIds.has(id))) return true;
  if (diagnostic.relationIds?.some((id) => relationIds.has(id))) return true;
  if (diagnostic.entityIds?.length || diagnostic.relationIds?.length) return false;
  return !/\bproject\b/i.test(diagnostic.message) || diagnostic.message.includes(projectId);
}

function scopedProvider(
  provider: WorkspaceKnowledgeProviderRun,
  projectId: string,
  entities: readonly WorkspaceKnowledgeEntity[],
  relations: readonly WorkspaceKnowledgeRelation[],
  proofs: readonly WorkspaceKnowledgeProof[]
): WorkspaceKnowledgeProviderRun {
  const providerProofIds = new Set(
    proofs.filter((proof) => proof.provider === provider.id).map((proof) => proof.id)
  );
  const inputCoverage = provider.inputCoverage?.filter(
    (coverage) =>
      coverage.scope === 'workspace' ||
      (coverage.scope === 'project' && coverage.scopeId === projectId)
  );
  return {
    ...provider,
    discoveredEntities: entities.filter((entity) =>
      entity.proofIds.some((proofId) => providerProofIds.has(proofId))
    ).length,
    discoveredRelations: relations.filter((relation) =>
      relation.proofIds.some((proofId) => providerProofIds.has(proofId))
    ).length,
    proofCount: providerProofIds.size,
    ...(inputCoverage ? { inputCoverage } : {}),
  };
}

/**
 * Derive the durable graph owned by one project. Project-owned entities are
 * complete for that project; direct boundary entities are retained so every
 * emitted relation remains resolvable without copying another project's full
 * graph into this project.
 */
export function projectWorkspaceKnowledgeGraph(
  graph: WorkspaceKnowledgeGraph,
  projectId: string
): WorkspaceKnowledgeGraph {
  const ownedEntityIds = new Set(
    graph.entities.filter((entity) => entity.projectId === projectId).map((entity) => entity.id)
  );
  const relations = graph.relations.filter(
    (relation) => ownedEntityIds.has(relation.from) || ownedEntityIds.has(relation.to)
  );
  const selectedEntityIds = new Set(ownedEntityIds);
  for (const relation of relations) {
    selectedEntityIds.add(relation.from);
    selectedEntityIds.add(relation.to);
  }
  const entities = graph.entities.filter((entity) => selectedEntityIds.has(entity.id));
  const selectedProofIds = new Set([...entities, ...relations].flatMap((entry) => entry.proofIds));
  const proofs = graph.proofs.filter((proof) => selectedProofIds.has(proof.id));
  const relationIds = new Set(relations.map((relation) => relation.id));
  const diagnostics = graph.diagnostics.filter((diagnostic) =>
    projectDiagnostic(diagnostic, selectedEntityIds, relationIds, projectId)
  );
  const providers = graph.providers.map((provider) =>
    scopedProvider(provider, projectId, entities, relations, proofs)
  );
  const selectedInputScopes =
    graph.source.inputs?.scopes.filter(
      (scope) => scope.kind === 'workspace' || (scope.kind === 'project' && scope.id === projectId)
    ) ?? [];
  const completeScopes = selectedInputScopes.filter((scope) => !scope.truncated).length;
  const providerCompleteness = providers.reduce(
    (summary, provider) => {
      if (provider.status === 'failed') summary.failed += 1;
      else if (
        provider.status === 'skipped' ||
        provider.inputCoverage?.every((coverage) => coverage.status === 'not-applicable')
      ) {
        summary.notApplicable += 1;
      } else if (
        provider.status === 'partial' ||
        provider.inputCoverage?.some((coverage) => coverage.status === 'bounded')
      ) {
        summary.bounded += 1;
      } else summary.complete += 1;
      return summary;
    },
    { complete: 0, bounded: 0, notApplicable: 0, failed: 0 }
  );
  const bindingCoverage = calculateWorkspaceKnowledgeBindingCoverage(entities, relations);

  return {
    ...graph,
    entities,
    relations,
    proofs,
    providers,
    quality: {
      entityCount: entities.length,
      relationCount: relations.length,
      proofCount: proofs.length,
      entityProofCoverageRatio: ratio(
        entities.filter((entity) => entity.proofIds.length > 0).length,
        entities.length
      ),
      relationProofCoverageRatio: ratio(
        relations.filter((relation) => relation.proofIds.length > 0).length,
        relations.length
      ),
      providerSuccessRatio: ratio(
        providers.filter((provider) => provider.status !== 'failed').length,
        providers.length
      ),
      conflictCount: diagnostics.filter((diagnostic) => diagnostic.code.includes('conflict'))
        .length,
      unknownCount: countWorkspaceKnowledgeUnknowns(diagnostics, bindingCoverage),
      bindingCoverage,
      ...(graph.quality.completeness
        ? {
            completeness: {
              status:
                selectedInputScopes.some((scope) => scope.truncated) ||
                providerCompleteness.bounded > 0 ||
                providerCompleteness.failed > 0
                  ? ('bounded' as const)
                  : ('complete' as const),
              inventory: {
                scopeCount: selectedInputScopes.length,
                completeScopes,
                boundedScopes: selectedInputScopes.length - completeScopes,
                eligibleFiles: selectedInputScopes.reduce(
                  (count, scope) => count + (scope.eligibleFileCount ?? scope.fileCount),
                  0
                ),
                indexedFiles: selectedInputScopes.reduce(
                  (count, scope) => count + scope.fileCount,
                  0
                ),
                eligibleFileCountExact: selectedInputScopes.every(
                  (scope) => scope.eligibleFileCountExact !== false
                ),
              },
              providers: providerCompleteness,
            },
          }
        : {}),
      portable: true,
      secretValuesEmitted: false,
    },
    diagnostics,
  };
}

export function workspaceModelProjectRoot(
  workspacePath: string,
  project: Pick<WorkspaceModelProject, 'path' | 'absolutePath'>
): string {
  return path.resolve(project.absolutePath ?? path.join(workspacePath, project.path));
}
