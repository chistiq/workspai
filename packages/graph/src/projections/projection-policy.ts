import type { WisEvidenceReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphEdge,
  GraphEntityReference,
  GraphScope,
} from '../contracts/index.js';

export const GRAPH_ADMITTED_REDACTION_POLICIES = Object.freeze([
  'portable-default',
  'agent-local',
] as const);

export type GraphAdmittedRedactionPolicy = (typeof GRAPH_ADMITTED_REDACTION_POLICIES)[number];

const SENSITIVE_SEGMENT = /^(?:\.env(?:\..*)?|id_rsa|credentials?|secrets?|private[-_]?key)$/iu;

function sensitiveValue(value: string): boolean {
  return value.split(/[\\/:]/u).some((segment) => SENSITIVE_SEGMENT.test(segment));
}

function workspaceId(scope: GraphScope): string | undefined {
  return 'workspaceId' in scope ? scope.workspaceId : undefined;
}

function projectIds(scope: GraphScope): readonly string[] {
  return 'projectIds' in scope && Array.isArray(scope.projectIds) ? scope.projectIds : [];
}

/** Fail-closed scope authorization shared by all projection surfaces. */
export function graphEntityMatchesScope(
  entity: GraphEntityReference,
  requested?: GraphScope
): boolean {
  if (!requested) return true;

  if (requested.kind === 'organization') {
    return (
      entity.scope.kind === 'organization' &&
      entity.scope.organizationId === requested.organizationId &&
      (!requested.workspaceId || entity.scope.workspaceId === requested.workspaceId)
    );
  }

  if (requested.kind === 'workspace') {
    return workspaceId(entity.scope) === requested.workspaceId;
  }

  if (requested.kind === 'project') {
    const allowed = new Set(requested.projectIds);
    const actual = projectIds(entity.scope);
    return (
      actual.length > 0 &&
      actual.every((projectId) => allowed.has(projectId)) &&
      (!requested.workspaceId || workspaceId(entity.scope) === requested.workspaceId)
    );
  }

  if (requested.entityIds?.includes(entity.id)) return true;
  if (requested.workspaceId && workspaceId(entity.scope) !== requested.workspaceId) return false;
  if (requested.projectIds) {
    const allowed = new Set(requested.projectIds);
    const actual = projectIds(entity.scope);
    return actual.length > 0 && actual.every((projectId) => allowed.has(projectId));
  }
  return requested.workspaceId !== undefined;
}

/**
 * Resolves project members of a workspace only through explicit canonical
 * workspace-to-project edges. This prevents an unscoped project node from
 * entering a workspace projection merely because it exists in the graph.
 */
export function createGraphScopePredicate(
  graph: GraphCanonicalGraph,
  requested?: GraphScope
): (entity: GraphEntityReference) => boolean {
  if (!requested || requested.kind !== 'workspace') {
    return (entity) => graphEntityMatchesScope(entity, requested);
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const admittedProjects = new Set<string>();
  for (const edge of graph.edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;
    for (const [workspaceSide, projectSide] of [
      [from, to],
      [to, from],
    ] as const) {
      if (
        graphEntityMatchesScope(workspaceSide, requested) &&
        projectSide.scope.kind === 'project'
      ) {
        for (const projectId of projectSide.scope.projectIds) admittedProjects.add(projectId);
      }
    }
  }
  return (entity) => {
    if (graphEntityMatchesScope(entity, requested)) return true;
    if (entity.scope.kind !== 'project') return false;
    return (
      entity.scope.projectIds.length > 0 &&
      entity.scope.projectIds.every((projectId) => admittedProjects.has(projectId))
    );
  };
}

export function admittedRedactionPolicy(value: string): value is GraphAdmittedRedactionPolicy {
  return GRAPH_ADMITTED_REDACTION_POLICIES.includes(value as GraphAdmittedRedactionPolicy);
}

function portableLocator(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]/u).includes('..') &&
    !sensitiveValue(value)
  );
}

function portableIdentifier(value: string): boolean {
  return (
    !/(^|:)(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\.\.)(?:.*)/u.test(value) && !sensitiveValue(value)
  );
}

/** Removes evidence that cannot safely cross the selected projection boundary. */
export function redactGraphEvidence(
  evidence: WisEvidenceReference,
  _policy: GraphAdmittedRedactionPolicy
): WisEvidenceReference | undefined {
  if (!portableIdentifier(evidence.id)) return undefined;
  if (evidence.relativeLocator && !portableLocator(evidence.relativeLocator)) return undefined;
  if (evidence.artifact?.relativeLocator && !portableLocator(evidence.artifact.relativeLocator)) {
    return undefined;
  }
  return Object.freeze({ ...evidence });
}

export function redactGraphEdge(
  edge: GraphEdge,
  policy: GraphAdmittedRedactionPolicy,
  includeEvidence: boolean,
  permittedEvidenceIds?: ReadonlySet<string>
): GraphEdge {
  const evidence = includeEvidence
    ? edge.proof.evidence
        .map((entry) => redactGraphEvidence(entry, policy))
        .filter(
          (entry): entry is WisEvidenceReference =>
            entry !== undefined && (!permittedEvidenceIds || permittedEvidenceIds.has(entry.id))
        )
    : [];
  const counterEvidence = includeEvidence
    ? edge.proof.counterEvidence
        .map((entry) => redactGraphEvidence(entry, policy))
        .filter(
          (entry): entry is WisEvidenceReference =>
            entry !== undefined && (!permittedEvidenceIds || permittedEvidenceIds.has(entry.id))
        )
    : [];
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  return Object.freeze({
    ...edge,
    proof: Object.freeze({
      ...edge.proof,
      evidence: Object.freeze(evidence),
      counterEvidence: Object.freeze(counterEvidence),
      corroborationGroups: Object.freeze(
        includeEvidence
          ? edge.proof.corroborationGroups
              .map((group) => ({
                ...group,
                evidence: Object.freeze(
                  group.evidence.filter((entry) => evidenceIds.has(entry.id))
                ),
              }))
              .filter((group) => group.evidence.length > 0)
          : []
      ),
    }),
  });
}
