import crypto from 'node:crypto';

import type { WorkspaceModel } from './workspace-model.js';

export function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableSort(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableSort((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

export function hashCanonicalJson(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function hashWorkspaceModel(model: WorkspaceModel): string {
  const {
    runId: _ignoredRunId,
    evidence: _ignoredEvidence,
    facts: _ignoredFacts,
    factFreshness: _ignoredFactFreshness,
    build: _ignoredBuildProvenance,
    graph: _ignoredDeprecatedGraphAlias,
    projectTopology: _ignoredProjectTopology,
    projects,
    ...modelWithoutLiveState
  } = model as WorkspaceModel & { runId?: string };
  const structuralProjects = projects.map((project) => {
    const { evidence: _ignoredProjectEvidence, ...structuralProject } = project;
    return structuralProject;
  });
  const projectTopology = model.projectTopology ?? model.graph;
  return hashCanonicalJson({
    ...modelWithoutLiveState,
    generatedAt: '<ignored>',
    projects: structuralProjects,
    projectTopology: projectTopology ? { ...projectTopology, generatedAt: '<ignored>' } : undefined,
    validation: model.validation
      ? {
          ...model.validation,
          issues: model.validation.issues
            .map((issue) => ({ ...issue }))
            .sort((a, b) => {
              const left = `${a.severity}:${a.code}:${a.target}:${a.message}`;
              const right = `${b.severity}:${b.code}:${b.target}:${b.message}`;
              return left.localeCompare(right);
            }),
        }
      : undefined,
  });
}

/**
 * Hash contract used by workspace-model.v1 snapshots before `projectTopology`
 * became the canonical topology field. This exists only to authenticate and
 * migrate already-written snapshots; new artifacts must use
 * `hashWorkspaceModel`.
 */
export function hashLegacyWorkspaceModelV1(model: WorkspaceModel): string {
  const {
    runId: _ignoredRunId,
    evidence: _ignoredEvidence,
    facts: _ignoredFacts,
    factFreshness: _ignoredFactFreshness,
    projects,
    ...modelWithoutLiveState
  } = model as WorkspaceModel & { runId?: string };
  const structuralProjects = projects.map((project) => {
    const { evidence: _ignoredProjectEvidence, ...structuralProject } = project;
    return structuralProject;
  });
  return hashCanonicalJson({
    ...modelWithoutLiveState,
    generatedAt: '<ignored>',
    projects: structuralProjects,
    graph: model.graph ? { ...model.graph, generatedAt: '<ignored>' } : undefined,
    validation: model.validation
      ? {
          ...model.validation,
          issues: model.validation.issues
            .map((issue) => ({ ...issue }))
            .sort((a, b) => {
              const left = `${a.severity}:${a.code}:${a.target}:${a.message}`;
              const right = `${b.severity}:${b.code}:${b.target}:${b.message}`;
              return left.localeCompare(right);
            }),
        }
      : undefined,
  });
}
