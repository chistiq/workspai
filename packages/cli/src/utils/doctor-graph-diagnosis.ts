import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION,
  type DoctorGraphDiagnosis,
  type DoctorGraphEntityRef,
  type DoctorGraphFinding,
} from '../contracts/doctor-graph-diagnosis-contract.js';
import type {
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeEntityKind,
  WorkspaceKnowledgeGraph,
} from '../contracts/workspace-knowledge-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import {
  assertWorkspaceKnowledgeGraphSourceBinding,
  WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH,
} from '../workspace-knowledge-graph.js';
import { queryKnowledgePath } from '../workspace-knowledge-graph-query.js';
import type { WorkspaceModel } from '../workspace-model.js';
import { assertJsonSchemaContract } from './json-schema-contract.js';

const CLAIM_BOUNDARY =
  'Graph paths identify evidence-backed structural reachability and verification candidates; they do not prove runtime causality or that every affected surface has been discovered.';

const ROOT_KINDS: Readonly<Record<string, readonly WorkspaceKnowledgeEntityKind[]>> = {
  dependency: ['package', 'module'],
  security: ['package', 'module'],
  test: ['test-suite'],
  quality: ['file', 'symbol', 'module'],
  container: ['container'],
  deployment: ['deployment', 'container', 'environment'],
  environment: ['environment'],
  configuration: ['environment', 'file'],
  runtime: ['service', 'container', 'deployment'],
  'workspace-contract': ['project', 'service', 'api', 'endpoint'],
  'source-tree': ['file', 'module', 'symbol'],
  framework: ['service', 'project', 'package'],
  custom: ['project'],
  unknown: ['project'],
};

const AFFECTED_KINDS = new Set<WorkspaceKnowledgeEntityKind>([
  'project',
  'service',
  'api',
  'endpoint',
  'schema',
  'database',
  'queue',
  'container',
  'deployment',
  'pipeline',
  'environment',
  'document',
  'decision',
  'test-suite',
  'owner',
]);

const VERIFY_KINDS = new Set<WorkspaceKnowledgeEntityKind>(['test-suite', 'pipeline']);

type DoctorGraphSource = {
  graph: WorkspaceKnowledgeGraph;
  model: WorkspaceModel;
  entitiesById: ReadonlyMap<string, WorkspaceKnowledgeEntity>;
  edges: ReadonlyMap<string, string[]>;
};

const doctorGraphSourceCache = new Map<string, Promise<DoctorGraphSource>>();

async function loadDoctorGraphSource(
  graphPath: string,
  modelPath: string
): Promise<DoctorGraphSource> {
  const [graphStat, modelStat] = await Promise.all([
    fsExtra.stat(graphPath),
    fsExtra.stat(modelPath),
  ]);
  const cacheKey = [
    graphPath,
    graphStat.size,
    graphStat.mtimeMs,
    modelPath,
    modelStat.size,
    modelStat.mtimeMs,
  ].join(':');
  const cached = doctorGraphSourceCache.get(cacheKey);
  if (cached) return cached;

  if (doctorGraphSourceCache.size >= 4) doctorGraphSourceCache.clear();
  const pending = (async () => {
    const [graphPayload, modelPayload] = await Promise.all([
      fsExtra.readJSON(graphPath),
      fsExtra.readJSON(modelPath),
    ]);
    assertJsonSchemaContract(
      graphPayload,
      'contracts/workspace-intelligence/workspace-knowledge-graph.v1.json',
      'Doctor graph diagnosis source'
    );
    assertJsonSchemaContract(
      modelPayload,
      'contracts/workspace-intelligence/workspace-model.v1.json',
      'Doctor graph diagnosis model'
    );
    const graph = graphPayload as WorkspaceKnowledgeGraph;
    return {
      graph,
      model: modelPayload as WorkspaceModel,
      entitiesById: new Map(graph.entities.map((entity) => [entity.id, entity])),
      edges: adjacency(graph),
    };
  })();
  doctorGraphSourceCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    doctorGraphSourceCache.delete(cacheKey);
    throw error;
  }
}

export type DoctorGraphDiagnosisProbe = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  reason: string;
  issueClass?: string;
  subjects?: string[];
};

export type BuildDoctorGraphDiagnosisOptions = {
  workspacePath?: string;
  projectPath: string;
  projectName: string;
  probes?: DoctorGraphDiagnosisProbe[];
  issues?: string[];
  now?: Date;
};

function portablePath(root: string | undefined, target: string): string {
  if (!root) return '.';
  const relative = path.relative(root, target).split(path.sep).join('/');
  return relative && !relative.startsWith('../') ? relative : '.';
}

function entityRef(entity: WorkspaceKnowledgeEntity): DoctorGraphEntityRef {
  return {
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    ...(entity.projectId ? { projectId: entity.projectId } : {}),
  };
}

function emptyDiagnosis(
  options: BuildDoctorGraphDiagnosisOptions,
  status: DoctorGraphDiagnosis['status'],
  diagnostic: string,
  graph: DoctorGraphDiagnosis['graph'] = { artifact: WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH }
): DoctorGraphDiagnosis {
  return {
    schemaVersion: DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    status,
    claimBoundary: CLAIM_BOUNDARY,
    graph,
    project: {
      name: options.projectName,
      path: portablePath(options.workspacePath, options.projectPath),
    },
    summary: {
      findingCount: 0,
      rootEntityCount: 0,
      affectedEntityCount: 0,
      verificationTargetCount: 0,
      proofPathCount: 0,
      subjectCount: 0,
      unresolvedSubjectCount: 0,
      unknownCount: 1,
    },
    findings: [],
    diagnostics: [diagnostic],
  };
}

function resolveProjectEntity(
  graph: WorkspaceKnowledgeGraph,
  options: BuildDoctorGraphDiagnosisOptions
): WorkspaceKnowledgeEntity | undefined {
  const relative = portablePath(options.workspacePath, options.projectPath).toLowerCase();
  const candidates = new Set(
    [options.projectName, path.basename(options.projectPath), relative]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  return graph.entities
    .filter((entity) => entity.kind === 'project')
    .find((entity) => {
      const values = [
        entity.projectId,
        entity.label,
        entity.identity.key,
        ...entity.identity.aliases,
        typeof entity.attributes.path === 'string' ? entity.attributes.path : undefined,
      ]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.toLowerCase());
      return values.some((value) => candidates.has(value) || candidates.has(path.basename(value)));
    });
}

function projectEntities(
  graph: WorkspaceKnowledgeGraph,
  project: WorkspaceKnowledgeEntity
): WorkspaceKnowledgeEntity[] {
  const projectId = project.projectId ?? project.label;
  const directlyScoped = graph.entities.filter(
    (entity) =>
      entity.id === project.id ||
      entity.projectId === projectId ||
      entity.projectId === project.projectId
  );
  const scopedIds = new Set(directlyScoped.map((entity) => entity.id));
  const projectBoundSharedIds = new Set<string>();
  for (const relation of graph.relations) {
    if (scopedIds.has(relation.from)) projectBoundSharedIds.add(relation.to);
    if (scopedIds.has(relation.to)) projectBoundSharedIds.add(relation.from);
  }
  return graph.entities.filter(
    (entity) => scopedIds.has(entity.id) || projectBoundSharedIds.has(entity.id)
  );
}

function adjacency(graph: WorkspaceKnowledgeGraph): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const append = (from: string, to: string): void => {
    const values = result.get(from) ?? [];
    values.push(to);
    result.set(from, values);
  };
  for (const relation of graph.relations) {
    append(relation.from, relation.to);
    append(relation.to, relation.from);
  }
  for (const values of result.values()) values.sort();
  return result;
}

function reachableEntityIds(
  edges: ReadonlyMap<string, string[]>,
  starts: readonly string[],
  maxDepth: number
): string[] {
  const visited = new Set(starts);
  const queue = starts.map((id) => ({ id, depth: 0 }));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || current.depth >= maxDepth) continue;
    for (const next of edges.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  return [...visited];
}

function normalizedEntitySubjectValues(entity: WorkspaceKnowledgeEntity): Set<string> {
  const attributeValues = ['name', 'specifier', 'package', 'module'].flatMap((key) => {
    const value = entity.attributes[key];
    return Array.isArray(value) ? value : [value];
  });
  return new Set(
    [entity.label, ...entity.identity.aliases, ...attributeValues]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizedFindingStatement(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacyIssueCoveredByProbe(
  issue: string,
  probes: readonly DoctorGraphDiagnosisProbe[]
): boolean {
  const normalizedIssue = normalizedFindingStatement(issue);
  if (!normalizedIssue) return true;
  return probes.some((probe) => {
    const normalizedReason = normalizedFindingStatement(probe.reason);
    return (
      normalizedReason === normalizedIssue ||
      normalizedReason.includes(normalizedIssue) ||
      normalizedIssue.includes(normalizedReason)
    );
  });
}

function rootEntitiesForFinding(
  project: WorkspaceKnowledgeEntity,
  scoped: readonly WorkspaceKnowledgeEntity[],
  issueClass: string,
  subjects: readonly string[]
): { roots: WorkspaceKnowledgeEntity[]; unresolvedSubjects: string[] } {
  const kinds = ROOT_KINDS[issueClass] ?? ROOT_KINDS.unknown;
  const normalizedSubjects = [
    ...new Set(subjects.map((value) => value.trim().toLowerCase()).filter(Boolean)),
  ];
  if (normalizedSubjects.length > 0) {
    const matches = scoped.filter(
      (entity) =>
        kinds?.includes(entity.kind) &&
        normalizedSubjects.some((candidate) => normalizedEntitySubjectValues(entity).has(candidate))
    );
    const resolved = new Set(
      normalizedSubjects.filter((candidate) =>
        matches.some((entity) => normalizedEntitySubjectValues(entity).has(candidate))
      )
    );
    return {
      roots: matches.length > 0 ? matches.slice(0, 4) : [project],
      unresolvedSubjects: subjects.filter(
        (candidate) => !resolved.has(candidate.trim().toLowerCase())
      ),
    };
  }
  const matches = scoped.filter((entity) => kinds?.includes(entity.kind)).slice(0, 4);
  return { roots: matches.length > 0 ? matches : [project], unresolvedSubjects: [] };
}

function findingFromProbe(
  graph: WorkspaceKnowledgeGraph,
  project: WorkspaceKnowledgeEntity,
  context: {
    scoped: readonly WorkspaceKnowledgeEntity[];
    scopedIds: ReadonlySet<string>;
    entitiesById: ReadonlyMap<string, WorkspaceKnowledgeEntity>;
    edges: ReadonlyMap<string, string[]>;
    projectRelativePath: string;
  },
  probe: DoctorGraphDiagnosisProbe
): DoctorGraphFinding {
  const issueClass = probe.issueClass ?? 'unknown';
  const subjects = [
    ...new Set((probe.subjects ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  const { roots, unresolvedSubjects } = rootEntitiesForFinding(
    project,
    context.scoped,
    issueClass,
    subjects
  );
  const reachable = reachableEntityIds(
    context.edges,
    roots.map((entity) => entity.id),
    3
  )
    .map((id) => context.entitiesById.get(id))
    .filter((entity): entity is WorkspaceKnowledgeEntity => Boolean(entity));
  const affected = reachable
    .filter(
      (entity) =>
        context.scopedIds.has(entity.id) &&
        !roots.some((root) => root.id === entity.id) &&
        AFFECTED_KINDS.has(entity.kind)
    )
    .slice(0, 6);
  const verificationTargets = reachable
    .filter((entity) => context.scopedIds.has(entity.id) && VERIFY_KINDS.has(entity.kind))
    .slice(0, 2);
  const destinations = [...affected, ...verificationTargets]
    .filter(
      (entity, index, values) =>
        values.findIndex((candidate) => candidate.id === entity.id) === index
    )
    .slice(0, 3);
  const proofPaths = destinations.flatMap((target) => {
    const candidates = roots
      .map((root) => queryKnowledgePath(graph, root.id, target.id))
      .filter((candidate) => candidate.found)
      .sort((a, b) => a.hops.length - b.hops.length);
    const selected = candidates[0];
    if (!selected) return [];
    return [
      {
        from: selected.resolvedFrom ?? selected.from,
        to: selected.resolvedTo ?? selected.to,
        entityPath: selected.entityPath,
        hops: selected.hops,
        proofIds: selected.proofs.map((proof) => proof.id),
      },
    ];
  });
  const proofIds = new Set([
    ...roots.flatMap((entity) => entity.proofIds),
    ...proofPaths.flatMap((proofPath) => proofPath.proofIds),
  ]);
  const sourceArtifacts = graph.proofs
    .filter((proof) => proofIds.has(proof.id))
    .map((proof) => proof.artifact)
    .filter((artifact) => {
      if (context.projectRelativePath === '.') return true;
      const normalizedArtifact = artifact.split(path.sep).join('/').replace(/^\.\//, '');
      return normalizedArtifact.startsWith(`${context.projectRelativePath}/`);
    })
    .filter((artifact, index, values) => values.indexOf(artifact) === index)
    .sort()
    .slice(0, 4);
  const unknowns: string[] = [];
  if (affected.length === 0) {
    unknowns.push('No affected surface is structurally reachable from the selected root evidence.');
  }
  if (verificationTargets.length === 0) {
    unknowns.push(
      'No graph-connected test suite or pipeline is available as a verification target.'
    );
  }
  if (sourceArtifacts.length === 0) {
    unknowns.push('The selected graph entities do not carry portable source evidence.');
  }
  if (unresolvedSubjects.length > 0) {
    unknowns.push(
      `No canonical graph entity resolved for ${unresolvedSubjects.length} reported subject(s): ${unresolvedSubjects.join(', ')}.`
    );
  }
  return {
    issueId: probe.id,
    issueClass,
    status: probe.status === 'fail' ? 'fail' : 'warn',
    reason: probe.reason,
    scope: 'structural-impact-candidates',
    subjects,
    unresolvedSubjects,
    rootEntities: roots.map(entityRef),
    affectedEntities: affected.map(entityRef),
    verificationTargets: verificationTargets.map(entityRef),
    proofPaths,
    sourceArtifacts,
    unknowns,
  };
}

export async function buildDoctorGraphDiagnosis(
  options: BuildDoctorGraphDiagnosisOptions
): Promise<DoctorGraphDiagnosis> {
  if (!options.workspacePath) {
    return emptyDiagnosis(
      options,
      'graph-missing',
      'Project is not attached to a Workspai workspace; no workspace graph can be consulted.'
    );
  }
  const graphPath = path.join(options.workspacePath, WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH);
  const modelPath = path.join(options.workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model);
  if (!(await fsExtra.pathExists(graphPath))) {
    return emptyDiagnosis(
      options,
      'graph-missing',
      'Workspace knowledge graph is missing. Run workspace model before relying on graph-aware diagnosis.'
    );
  }
  if (!(await fsExtra.pathExists(modelPath))) {
    return emptyDiagnosis(
      options,
      'model-missing',
      'Canonical workspace model is missing, so graph source binding cannot be verified.'
    );
  }

  let graph: WorkspaceKnowledgeGraph;
  let model: WorkspaceModel;
  let entitiesById: ReadonlyMap<string, WorkspaceKnowledgeEntity>;
  let edges: ReadonlyMap<string, string[]>;
  try {
    ({ graph, model, entitiesById, edges } = await loadDoctorGraphSource(graphPath, modelPath));
  } catch (error) {
    return emptyDiagnosis(
      options,
      'invalid',
      `Graph-aware diagnosis rejected invalid evidence: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const graphMetadata: DoctorGraphDiagnosis['graph'] = {
    artifact: WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH,
    schemaVersion: graph.schemaVersion,
    sourceArtifact: graph.source.artifact,
    sourceHash: graph.source.hash,
    entityCount: graph.entities.length,
    relationCount: graph.relations.length,
    proofCount: graph.proofs.length,
  };
  try {
    assertWorkspaceKnowledgeGraphSourceBinding(graph, model);
  } catch (error) {
    return emptyDiagnosis(
      options,
      'stale',
      error instanceof Error ? error.message : String(error),
      graphMetadata
    );
  }

  const project = resolveProjectEntity(graph, options);
  if (!project) {
    return emptyDiagnosis(
      options,
      'project-unresolved',
      'The current project could not be resolved to one canonical project entity.',
      graphMetadata
    );
  }

  const scoped = projectEntities(graph, project);
  const context = {
    scoped,
    scopedIds: new Set(scoped.map((entity) => entity.id)),
    entitiesById,
    edges,
    projectRelativePath: portablePath(options.workspacePath, options.projectPath),
  };

  const findingProbes = (options.probes ?? []).filter(
    (probe): probe is DoctorGraphDiagnosisProbe & { status: 'warn' | 'fail' } =>
      probe.status !== 'pass'
  );
  const findings = [
    ...findingProbes,
    ...(options.issues ?? [])
      .filter((reason) => !legacyIssueCoveredByProbe(reason, findingProbes))
      .map((reason, index) => ({
        id: `legacy-project-issue-${index + 1}`,
        status: 'fail' as const,
        reason,
        issueClass: 'runtime',
      })),
  ].map((probe) => findingFromProbe(graph, project, context, probe));

  return {
    schemaVersion: DOCTOR_GRAPH_DIAGNOSIS_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    status: 'available',
    claimBoundary: CLAIM_BOUNDARY,
    graph: graphMetadata,
    project: {
      name: options.projectName,
      path: portablePath(options.workspacePath, options.projectPath),
      entityId: project.id,
    },
    summary: {
      findingCount: findings.length,
      rootEntityCount: new Set(
        findings.flatMap((finding) => finding.rootEntities.map((entity) => entity.id))
      ).size,
      affectedEntityCount: new Set(
        findings.flatMap((finding) => finding.affectedEntities.map((entity) => entity.id))
      ).size,
      verificationTargetCount: new Set(
        findings.flatMap((finding) => finding.verificationTargets.map((entity) => entity.id))
      ).size,
      proofPathCount: findings.reduce((sum, finding) => sum + finding.proofPaths.length, 0),
      subjectCount: new Set(findings.flatMap((finding) => finding.subjects)).size,
      unresolvedSubjectCount: new Set(findings.flatMap((finding) => finding.unresolvedSubjects))
        .size,
      unknownCount: findings.reduce((sum, finding) => sum + finding.unknowns.length, 0),
    },
    findings,
    diagnostics: [],
  };
}
