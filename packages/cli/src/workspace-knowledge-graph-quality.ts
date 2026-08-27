import type {
  WorkspaceKnowledgeDiagnostic,
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeRelation,
} from './contracts/workspace-knowledge-graph-contract.js';

function bindingCoverage(eligibleIds: readonly string[], boundIds: ReadonlySet<string>) {
  const eligible = [...new Set(eligibleIds)];
  const boundCount = eligible.filter((id) => boundIds.has(id)).length;
  return {
    eligibleCount: eligible.length,
    boundCount,
    unknownCount: eligible.length - boundCount,
    coverageRatio: eligible.length === 0 ? null : boundCount / eligible.length,
  };
}

/** Recompute semantic binding coverage for any complete graph projection. */
export function calculateWorkspaceKnowledgeBindingCoverage(
  entities: readonly WorkspaceKnowledgeEntity[],
  relations: readonly WorkspaceKnowledgeRelation[]
): NonNullable<WorkspaceKnowledgeGraph['quality']['bindingCoverage']> {
  const projectIds = entities
    .filter((entity) => entity.kind === 'project')
    .map((entity) => entity.id);
  const endpointIds = entities
    .filter((entity) => entity.kind === 'endpoint')
    .map((entity) => entity.id);
  const endpointIdSet = new Set(endpointIds);
  // Registration is project-local and applies only to runtime-served contract
  // surfaces. Commands, chat participants, client operation documents and
  // shared protocol identities are API-shaped graph surfaces, but requiring a
  // server runtime registration for them would manufacture unknowns.
  const apiIds = entities
    .filter(
      (entity) =>
        entity.kind === 'api' &&
        Boolean(entity.projectId) &&
        entity.attributes.runtimeRegistrationRequired === true
    )
    .map((entity) => entity.id);
  const apiIdSet = new Set(apiIds);
  const entityKindById = new Map(entities.map((entity) => [entity.id, entity.kind]));
  const implementedEndpoints = new Set(
    relations
      .filter(
        (relation) =>
          relation.kind === 'implements' ||
          (relation.kind === 'defines' &&
            entityKindById.get(relation.from) === 'file' &&
            entityKindById.get(relation.to) === 'endpoint')
      )
      .flatMap((relation) =>
        endpointIdSet.has(relation.from)
          ? [relation.from]
          : endpointIdSet.has(relation.to)
            ? [relation.to]
            : []
      )
  );
  const registeredApis = new Set(
    relations
      .filter(
        (relation) =>
          relation.kind === 'implements' &&
          (entityKindById.get(relation.from) === 'runtime-unit' ||
            entityKindById.get(relation.to) === 'runtime-unit')
      )
      .flatMap((relation) =>
        apiIdSet.has(relation.from)
          ? [relation.from]
          : apiIdSet.has(relation.to)
            ? [relation.to]
            : []
      )
  );
  const projectIdSet = new Set(projectIds);
  const projectsForRelation = (kind: WorkspaceKnowledgeRelation['kind']) =>
    new Set(
      relations
        .filter((relation) => relation.kind === kind)
        .flatMap((relation) => [relation.from, relation.to])
        .filter((id) => projectIdSet.has(id))
    );
  return {
    apiImplementation: bindingCoverage(endpointIds, implementedEndpoints),
    apiRuntimeRegistration: bindingCoverage(apiIds, registeredApis),
    projectTests: bindingCoverage(projectIds, projectsForRelation('tests')),
    projectDeployment: bindingCoverage(projectIds, projectsForRelation('deploys')),
    projectOwnership: bindingCoverage(projectIds, projectsForRelation('owns')),
  };
}

export function countWorkspaceKnowledgeUnknowns(
  diagnostics: readonly WorkspaceKnowledgeDiagnostic[],
  binding: NonNullable<WorkspaceKnowledgeGraph['quality']['bindingCoverage']>
): number {
  const explicitUnknownCount = diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code.includes('unknown') ||
        diagnostic.code.includes('unresolved') ||
        diagnostic.code.includes('limit_reached') ||
        diagnostic.code.endsWith('.empty_result')
    )
    .reduce(
      (count, diagnostic) =>
        count + Math.max(diagnostic.entityIds?.length ?? 0, diagnostic.relationIds?.length ?? 0, 1),
      0
    );
  return (
    explicitUnknownCount +
    Object.values(binding).reduce((count, dimension) => count + dimension.unknownCount, 0)
  );
}
