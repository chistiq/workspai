import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import fsExtra from 'fs-extra';

import type {
  WorkspaceKnowledgeAttribute,
  WorkspaceKnowledgeEntity,
  WorkspaceKnowledgeGraph,
  WorkspaceKnowledgeProof,
  WorkspaceKnowledgeRelation,
} from './contracts/workspace-knowledge-graph-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { listCanonicalDoctorFindings } from './utils/doctor-diagnosis-consumer.js';
import type { WorkspaceModel, WorkspaceModelProject } from './workspace-model.js';
import { hashWorkspaceModel } from './workspace-model-hash.js';
import {
  PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
  PROJECT_GROUNDING_RELATIVE_PATH,
  projectMetadataCandidates,
} from './utils/workspace-paths.js';
import {
  extractManagedAgentSection,
  RAPIDKIT_AGENT_GROUNDING_END,
  RAPIDKIT_AGENT_GROUNDING_START,
} from './utils/managed-agent-markers.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  type ProjectWorkspaceRelationship,
  writeProjectWorkspaceLink,
} from './project-workspace-link.js';
import {
  AGENT_ENTRY_HOST_IDS,
  PROJECT_AGENT_ADAPTER_ENTRY_FILES,
  PROJECT_AGENT_ENTRY_RELATIVE_PATH,
  WORKSPAI_AGENT_ENTRY_END,
  WORKSPAI_AGENT_ENTRY_START,
  buildProjectAgentEntryManifest,
  type AgentEntryHostCoverage,
  type AgentEntryHostId,
} from './project-agent-entry.js';

export const PROJECT_CONTEXT_AGENT_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectContextAgent.schemaVersion;
export const PROJECT_GROUNDING_MODE_VALUES = ['managed', 'local', 'off'] as const;
export const WORKSPAI_PROJECT_GROUNDING_START = '<!-- WORKSPAI:PROJECT-GROUNDING:START -->';
export const WORKSPAI_PROJECT_GROUNDING_END = '<!-- WORKSPAI:PROJECT-GROUNDING:END -->';

export type ProjectGroundingMode = (typeof PROJECT_GROUNDING_MODE_VALUES)[number];

export interface ProjectContextAgent {
  schemaVersion: typeof PROJECT_CONTEXT_AGENT_SCHEMA_VERSION;
  generatedAt: string;
  workspace: {
    name: string;
    profile?: string;
    relationship: ProjectWorkspaceRelationship;
    contract: `workspace:${(typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS)['workspaceContract']}`;
    model: `workspace:${(typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['model']}`;
    knowledgeGraph: `workspace:${(typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['knowledgeGraph']}`;
    access: {
      localBinding: (typeof WORKSPACE_SUPPLEMENTAL_ARTIFACTS)['projectWorkspaceLink'];
      canonicalEvidenceAvailableAtGeneration: boolean;
      identityIsFilesystemPath: false;
      resolverCommand: 'workspai project workspace status --json';
      portableUriScheme: 'workspace:';
      resolvedPathPolicy: 'runtime-private-never-persist';
    };
  };
  project: {
    name: string;
    relativePath: string;
    kind?: string;
    runtime?: string;
    runtimeCandidates?: string[];
    framework?: string;
    kit?: string;
    supportTier?: string;
    commands: {
      supported: string[];
      unsupported: string[];
      fleetStages: string[];
    };
    importantFiles: string[];
  };
  intelligence: {
    modelGeneratedAt?: string;
    graphGeneratedAt?: string;
    graphModelHash?: string;
    entityCount: number;
    relationCount: number;
    proofCount: number;
    entitiesByKind: Record<string, number>;
    relationsByKind: Record<string, number>;
    languages: Record<
      string,
      { fileCount: number; symbolCount: number; generatedFileCount: number }
    >;
    semantic: {
      protocolConceptCount: number;
      protocolImplementationBindings: number;
      equivalenceBindings: number;
      generationBindings: number;
      runtimeUnitCount: number;
      lifecycleStageCount: number;
      runtimeCoverage: string[];
    };
    relatedProjects: string[];
    freshness: {
      model: 'fresh' | 'stale' | 'unknown' | 'missing';
      graph: 'fresh' | 'stale' | 'unknown' | 'missing';
      graphMatchesModel: boolean;
    };
    topology: {
      status: 'proven' | 'unproven' | 'unavailable';
      dependencies: ProjectTopologyRelation[];
      dependents: ProjectTopologyRelation[];
    };
    surfaces: {
      services: ProjectLensEntity[];
      packages: ProjectLensEntity[];
      protocols: ProjectLensEntity[];
      runtimeUnits: ProjectLensEntity[];
      lifecycleStages: ProjectLensEntity[];
      apis: ProjectLensEntity[];
      endpoints: ProjectLensEntity[];
      dataStores: ProjectLensEntity[];
      deployments: ProjectLensEntity[];
      pipelines: ProjectLensEntity[];
      tests: ProjectLensEntity[];
      owners: ProjectLensEntity[];
      decisions: ProjectLensEntity[];
      ports: ProjectLensPort[];
    };
    diagnostics: Array<{
      code: string;
      severity: string;
      message: string;
      recommendation?: string;
    }>;
  };
  evidence: {
    readOrder: string[];
    projectProofArtifacts: string[];
    relations: ProjectLensRelation[];
    proofs: ProjectLensProof[];
  };
  blockers: ProjectLensBlocker[];
  agentRouting: {
    enforcement: 'required';
    mandatoryPreflight: {
      command: string;
      successCondition: 'ready';
    };
    workspaceLocator: {
      command: 'workspai project workspace status --json';
      successCondition: 'resolved';
      outputClassification: 'machine-local';
      persistence: 'forbidden';
      disclosure: 'forbidden';
      portableUriScheme: 'workspace:';
    };
    workspaceEvidenceRequiredFor: Array<
      | 'repository-analysis'
      | 'architecture-analysis'
      | 'change-impact'
      | 'cross-project-change'
      | 'contract-change'
      | 'infrastructure-change'
      | 'release-readiness'
    >;
    requiredReadOrder: string[];
    degradedMode: {
      allowCompleteArchitectureClaims: false;
      requireDisclosure: true;
    };
  };
  commands: {
    refresh: string;
    verify: string;
    graphSearch: string;
    doctor: string;
    workspaceStatus: string;
  };
  integrity: {
    algorithm: 'sha256';
    modelHash?: string;
    payloadHash: string;
    portable: true;
    absolutePathsEmitted: false;
  };
}

export interface ProjectTopologyRelation {
  project: string;
  kind: string;
  source: string;
  confidence: string;
  evidence: string[];
}

export interface ProjectLensEntity {
  id: string;
  kind: string;
  label: string;
  attributes: Record<string, WorkspaceKnowledgeAttribute>;
  proofIds: string[];
}

export interface ProjectLensRelation {
  id: string;
  from: string;
  to: string;
  kind: string;
  derivation: string;
  trust: string;
  confidence: string;
  proofIds: string[];
}

export interface ProjectLensProof {
  id: string;
  provider: string;
  artifact: string;
  pointer?: string;
  line?: number;
  derivation: string;
  trust: string;
  confidence: string;
  freshness: string;
}

export interface ProjectLensPort {
  entityId: string;
  label: string;
  attribute: string;
  value: WorkspaceKnowledgeAttribute;
}

export interface ProjectLensBlocker {
  source: string;
  severity: 'warning' | 'error';
  message: string;
  code?: string;
}

export interface SyncProjectIntelligenceLensOptions {
  workspacePath: string;
  projectPath: string;
  projectName?: string;
  relationship?: ProjectWorkspaceRelationship;
  mode?: ProjectGroundingMode;
  now?: Date;
}

export interface SyncProjectIntelligenceLensResult {
  mode: ProjectGroundingMode;
  projectPath: string;
  linkPath?: string;
  groundingPath?: string;
  contextPath?: string;
  agentEntryPath?: string;
  agentsPath?: string;
  hostCoverage?: AgentEntryHostCoverage[];
  writtenFiles: string[];
}

export interface SyncWorkspaceProjectLensesResult {
  workspacePath: string;
  mode: ProjectGroundingMode;
  projects: SyncProjectIntelligenceLensResult[];
  skipped: Array<{ name: string; reason: string }>;
}

export interface WorkspaceProjectLensTarget {
  name: string;
  projectPath: string;
  relationship: ProjectWorkspaceRelationship;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

function normalizedPortablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function portableArtifactReference(
  value: string,
  workspacePath: string,
  projectPath: string
): string | null {
  const normalized = value.replace(/\\/g, '/');
  const isWindowsAbsolute = /^[A-Za-z]:\//.test(normalized);
  if (!path.isAbsolute(value) && !isWindowsAbsolute) {
    return normalizedPortablePath(normalized);
  }
  if (isWindowsAbsolute && process.platform !== 'win32') return null;
  const absolute = path.resolve(value);
  const projectRelative = path.relative(projectPath, absolute);
  if (projectRelative && !projectRelative.startsWith('..') && !path.isAbsolute(projectRelative)) {
    return normalizedPortablePath(projectRelative);
  }
  const workspaceRelative = path.relative(workspacePath, absolute);
  if (
    workspaceRelative &&
    !workspaceRelative.startsWith('..') &&
    !path.isAbsolute(workspaceRelative)
  ) {
    return `workspace:${normalizedPortablePath(workspaceRelative)}`;
  }
  return null;
}

function portableText(value: string, workspacePath: string, projectPath: string): string {
  const replacements = [
    [projectPath, 'project:'],
    [projectPath.replace(/\\/g, '/'), 'project:'],
    [workspacePath, 'workspace:'],
    [workspacePath.replace(/\\/g, '/'), 'workspace:'],
  ] as const;
  return replacements.reduce(
    (result, [absolutePath, replacement]) =>
      absolutePath.length > 0 ? result.split(absolutePath).join(replacement) : result,
    value
  );
}

function deriveRelationship(
  projectJson: Record<string, unknown> | null,
  fallback: ProjectWorkspaceRelationship
): ProjectWorkspaceRelationship {
  const adoption = asRecord(projectJson?.adoption);
  if (adoption?.mode === 'linked') return 'adopted';
  const importMetadata = asRecord(projectJson?.import);
  if (importMetadata) return 'imported';
  return fallback;
}

function modelProjectFor(input: {
  model: WorkspaceModel | null;
  projectName: string;
  relativePath: string;
}): WorkspaceModelProject | null {
  if (!input.model) return null;
  const normalizedRelative = normalizedPortablePath(input.relativePath);
  return (
    input.model.projects.find(
      (project) =>
        project.name === input.projectName ||
        normalizedPortablePath(project.path) === normalizedRelative
    ) ?? null
  );
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

const PROJECT_LENS_ENTITY_KIND_ORDER: WorkspaceKnowledgeEntity['kind'][] = [
  'project',
  'language',
  'service',
  'api',
  'endpoint',
  'schema',
  'protocol',
  'runtime-unit',
  'lifecycle-stage',
  'database',
  'queue',
  'container',
  'deployment',
  'pipeline',
  'environment',
  'test-suite',
  'owner',
  'decision',
  'document',
  'package',
  'file',
  'module',
  'symbol',
];

function boundedProjectLensEntities(
  entities: WorkspaceKnowledgeEntity[],
  limit = 160
): WorkspaceKnowledgeEntity[] {
  const perKindLimits: Partial<Record<WorkspaceKnowledgeEntity['kind'], number>> = {
    language: 32,
    api: 32,
    service: 32,
    endpoint: 32,
    schema: 32,
    protocol: 32,
    'runtime-unit': 32,
    'lifecycle-stage': 32,
    file: 8,
    module: 8,
    symbol: 8,
  };
  const selected: WorkspaceKnowledgeEntity[] = [];
  for (const kind of PROJECT_LENS_ENTITY_KIND_ORDER) {
    const candidates = entities
      .filter((entity) => entity.kind === kind)
      .sort(
        (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
      )
      .slice(0, perKindLimits[kind] ?? 32);
    for (const entity of candidates) {
      if (selected.length >= limit) return selected;
      selected.push(entity);
    }
  }
  return selected;
}

function relatedGraphProjection(
  graph: WorkspaceKnowledgeGraph | null,
  projectName: string
): {
  entityCount: number;
  relationCount: number;
  proofCount: number;
  entitiesByKind: Record<string, number>;
  relationsByKind: Record<string, number>;
  languages: ProjectContextAgent['intelligence']['languages'];
  semantic: ProjectContextAgent['intelligence']['semantic'];
  relatedProjects: string[];
  proofArtifacts: string[];
  entities: WorkspaceKnowledgeEntity[];
  relations: WorkspaceKnowledgeRelation[];
  proofs: WorkspaceKnowledgeProof[];
  topology: ProjectContextAgent['intelligence']['topology'];
  diagnostics: ProjectContextAgent['intelligence']['diagnostics'];
} {
  if (!graph) {
    return {
      entityCount: 0,
      relationCount: 0,
      proofCount: 0,
      entitiesByKind: {},
      relationsByKind: {},
      languages: {},
      semantic: {
        protocolConceptCount: 0,
        protocolImplementationBindings: 0,
        equivalenceBindings: 0,
        generationBindings: 0,
        runtimeUnitCount: 0,
        lifecycleStageCount: 0,
        runtimeCoverage: [],
      },
      relatedProjects: [],
      proofArtifacts: [],
      entities: [],
      relations: [],
      proofs: [],
      topology: {
        status: 'unavailable',
        dependencies: [],
        dependents: [],
      },
      diagnostics: [],
    };
  }
  const projectEntity = graph.entities.find(
    (entity) =>
      entity.kind === 'project' &&
      (entity.id === projectName ||
        entity.label === projectName ||
        entity.projectId === projectName)
  );
  const projectIds = new Set(
    graph.entities
      .filter(
        (entity) =>
          entity.projectId === projectName ||
          entity.id === projectEntity?.id ||
          (entity.kind === 'project' && entity.label === projectName)
      )
      .map((entity) => entity.id)
  );
  if (projectEntity) projectIds.add(projectEntity.id);
  const relations = graph.relations.filter(
    (relation) => projectIds.has(relation.from) || projectIds.has(relation.to)
  );
  const connectedEntityIds = new Set(projectIds);
  for (const relation of relations) {
    connectedEntityIds.add(relation.from);
    connectedEntityIds.add(relation.to);
  }
  const entities = graph.entities.filter((entity) => connectedEntityIds.has(entity.id));
  const proofIds = new Set<string>();
  const entitiesByKind: Record<string, number> = {};
  const relationsByKind: Record<string, number> = {};
  const languages: ProjectContextAgent['intelligence']['languages'] = {};
  const inventoriedLanguages = new Set(
    entities
      .filter((entity) => entity.kind === 'language')
      .map((entity) => entity.attributes.language)
      .filter((language): language is string => typeof language === 'string')
  );
  for (const entity of entities) {
    increment(entitiesByKind, entity.kind);
    const language =
      typeof entity.attributes.language === 'string' ? entity.attributes.language : undefined;
    if (language && entity.kind === 'language') {
      languages[language] = {
        fileCount:
          typeof entity.attributes.fileCount === 'number' ? entity.attributes.fileCount : 0,
        symbolCount: languages[language]?.symbolCount ?? 0,
        generatedFileCount:
          typeof entity.attributes.generatedFileCount === 'number'
            ? entity.attributes.generatedFileCount
            : 0,
      };
    } else if (language && (entity.kind === 'file' || entity.kind === 'symbol')) {
      const summary = languages[language] ?? {
        fileCount: 0,
        symbolCount: 0,
        generatedFileCount: 0,
      };
      if (entity.kind === 'file' && !inventoriedLanguages.has(language)) {
        summary.fileCount += 1;
        if (entity.attributes.generated === true) summary.generatedFileCount += 1;
      } else if (entity.kind === 'symbol') {
        summary.symbolCount += 1;
      }
      languages[language] = summary;
    }
    for (const proofId of entity.proofIds) proofIds.add(proofId);
  }
  for (const relation of relations) {
    increment(relationsByKind, relation.kind);
    for (const proofId of relation.proofIds) proofIds.add(proofId);
  }
  const proofs = graph.proofs.filter((proof) => proofIds.has(proof.id));
  const relatedProjects = [
    ...new Set(
      graph.entities
        .filter(
          (entity) =>
            connectedEntityIds.has(entity.id) &&
            entity.projectId &&
            entity.projectId !== projectName
        )
        .map((entity) => entity.projectId as string)
    ),
  ].sort();
  const diagnostics = graph.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.entityIds?.some((id) => connectedEntityIds.has(id)) ||
        diagnostic.relationIds?.some((id) => relations.some((relation) => relation.id === id))
    )
    .map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.recommendation ? { recommendation: diagnostic.recommendation } : {}),
    }));
  const portableTopologyRelation = (
    edge: WorkspaceKnowledgeGraph['projectTopology']['edges'][number],
    relatedProject: string
  ): ProjectTopologyRelation => ({
    project: relatedProject,
    kind: edge.kind,
    source: edge.source,
    confidence: edge.confidence,
    evidence: [...new Set(edge.evidence.map((item) => item.file.replace(/\\/g, '/')))].sort(),
  });
  const dependencies = graph.projectTopology.edges
    .filter((edge) => edge.from === projectName)
    .map((edge) => portableTopologyRelation(edge, edge.to))
    .sort((left, right) =>
      `${left.project}:${left.kind}`.localeCompare(`${right.project}:${right.kind}`)
    );
  const dependents = graph.projectTopology.edges
    .filter((edge) => edge.to === projectName)
    .map((edge) => portableTopologyRelation(edge, edge.from))
    .sort((left, right) =>
      `${left.project}:${left.kind}`.localeCompare(`${right.project}:${right.kind}`)
    );
  const projectedEntities = boundedProjectLensEntities(entities);
  const runtimeUnits = entities.filter((entity) => entity.kind === 'runtime-unit');
  const projectedEntityIds = new Set(projectedEntities.map((entity) => entity.id));
  const projectedRelations = [...relations]
    .sort((left, right) => {
      const leftPriority = Number(
        projectedEntityIds.has(left.from) || projectedEntityIds.has(left.to)
      );
      const rightPriority = Number(
        projectedEntityIds.has(right.from) || projectedEntityIds.has(right.to)
      );
      return rightPriority - leftPriority || left.id.localeCompare(right.id);
    })
    .slice(0, 128);
  const projectedProofIds = new Set([
    ...projectedEntities.flatMap((entity) => entity.proofIds),
    ...projectedRelations.flatMap((relation) => relation.proofIds),
  ]);
  return {
    entityCount: entities.length,
    relationCount: relations.length,
    proofCount: proofs.length,
    entitiesByKind,
    relationsByKind,
    languages: Object.fromEntries(
      Object.entries(languages).sort(([left], [right]) => left.localeCompare(right))
    ),
    semantic: {
      protocolConceptCount: entitiesByKind.protocol ?? 0,
      protocolImplementationBindings: relationsByKind['implements-protocol'] ?? 0,
      equivalenceBindings: relationsByKind['equivalent-to'] ?? 0,
      generationBindings:
        (relationsByKind['generated-from'] ?? 0) + (relationsByKind['generated-by'] ?? 0),
      runtimeUnitCount: runtimeUnits.length,
      lifecycleStageCount: entitiesByKind['lifecycle-stage'] ?? 0,
      runtimeCoverage: [
        ...new Set(
          runtimeUnits
            .map((entity) => entity.attributes.runtime)
            .filter((runtime): runtime is string => typeof runtime === 'string')
        ),
      ].sort(),
    },
    relatedProjects,
    proofArtifacts: [...new Set(proofs.map((proof) => proof.artifact))].sort(),
    entities: projectedEntities,
    relations: projectedRelations,
    proofs: proofs
      .filter((proof) => projectedProofIds.has(proof.id))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 128),
    topology: {
      status:
        dependencies.length > 0 || dependents.length > 0
          ? 'proven'
          : graph.projectTopology.nodes.some((node) => node.id === projectName)
            ? 'unproven'
            : 'unavailable',
      dependencies,
      dependents,
    },
    diagnostics,
  };
}

function portableKnowledgeValue(
  value: WorkspaceKnowledgeAttribute,
  workspacePath: string,
  projectPath: string
): WorkspaceKnowledgeAttribute {
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? portableText(item, workspacePath, projectPath) : item
    );
  }
  return typeof value === 'string' ? portableText(value, workspacePath, projectPath) : value;
}

function projectLensEntity(
  entity: WorkspaceKnowledgeEntity,
  workspacePath: string,
  projectPath: string
): ProjectLensEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    label: portableText(entity.label, workspacePath, projectPath),
    attributes: Object.fromEntries(
      Object.entries(entity.attributes).map(([key, value]) => [
        key,
        portableKnowledgeValue(value, workspacePath, projectPath),
      ])
    ),
    proofIds: [...entity.proofIds].sort(),
  };
}

function projectLensSurfaces(
  entities: WorkspaceKnowledgeEntity[],
  workspacePath: string,
  projectPath: string
): ProjectContextAgent['intelligence']['surfaces'] {
  const byKinds = (...kinds: WorkspaceKnowledgeEntity['kind'][]): ProjectLensEntity[] =>
    entities
      .filter((entity) => kinds.includes(entity.kind))
      .map((entity) => projectLensEntity(entity, workspacePath, projectPath))
      .slice(0, 32);
  const ports: ProjectLensPort[] = [];
  for (const entity of entities) {
    for (const [attribute, value] of Object.entries(entity.attributes)) {
      if (!/(?:^|[-_.])ports?(?:$|[-_.])/i.test(attribute)) continue;
      ports.push({
        entityId: entity.id,
        label: portableText(entity.label, workspacePath, projectPath),
        attribute,
        value: portableKnowledgeValue(value, workspacePath, projectPath),
      });
      if (ports.length >= 32) break;
    }
    if (ports.length >= 32) break;
  }
  return {
    services: byKinds('service'),
    packages: byKinds('package'),
    protocols: byKinds('protocol'),
    runtimeUnits: byKinds('runtime-unit'),
    lifecycleStages: byKinds('lifecycle-stage'),
    apis: byKinds('api'),
    endpoints: byKinds('endpoint'),
    dataStores: byKinds('database', 'queue'),
    deployments: byKinds('container', 'deployment', 'environment'),
    pipelines: byKinds('pipeline'),
    tests: byKinds('test-suite'),
    owners: byKinds('owner'),
    decisions: byKinds('decision'),
    ports,
  };
}

function portableProjectProof(
  proof: WorkspaceKnowledgeProof,
  workspacePath: string,
  projectPath: string
): ProjectLensProof | null {
  const artifact = portableArtifactReference(proof.artifact, workspacePath, projectPath);
  if (!artifact) return null;
  return {
    id: proof.id,
    provider: proof.provider,
    artifact,
    ...(proof.pointer ? { pointer: portableText(proof.pointer, workspacePath, projectPath) } : {}),
    ...(proof.line !== undefined ? { line: proof.line } : {}),
    derivation: proof.derivation,
    trust: proof.trust,
    confidence: proof.confidence,
    freshness: proof.freshness,
  };
}

async function readProjectBlockers(
  workspacePath: string,
  projectPath: string,
  projectName: string
): Promise<ProjectLensBlocker[]> {
  const blockers: ProjectLensBlocker[] = [];
  const index = await readJsonIfPresent<{ blockers?: unknown }>(
    path.join(workspacePath, '.workspai', 'reports', 'INDEX.json')
  );
  if (Array.isArray(index?.blockers)) {
    for (const blocker of index.blockers) {
      if (typeof blocker !== 'string') continue;
      if (
        blocker.startsWith(`${projectName}:`) ||
        blocker.includes(`project:${projectName}`) ||
        blocker.includes(`project ${projectName}`)
      ) {
        blockers.push({
          source: 'workspace-report-index',
          severity: 'error',
          message: portableText(blocker, workspacePath, projectPath),
        });
      }
    }
  }
  const doctor = await readJsonIfPresent<{
    projectName?: unknown;
    project?: Record<string, unknown>;
  }>(path.join(workspacePath, '.workspai', 'reports', 'doctor-project-last-run.json'));
  if (doctor?.projectName === projectName) {
    for (const finding of listCanonicalDoctorFindings({
      project: doctor.project,
    })) {
      blockers.push({
        source: 'doctor-project',
        severity: finding.status === 'blocking' ? 'error' : 'warning',
        message: portableText(finding.message, workspacePath, projectPath),
        ...(finding.id ? { code: finding.id } : {}),
      });
    }
  }
  return [
    ...new Map(
      blockers.map((blocker) => [
        `${blocker.source}:${blocker.code ?? ''}:${blocker.message}`,
        blocker,
      ])
    ).values(),
  ].slice(0, 32);
}

function containsAbsolutePath(value: unknown, forbiddenRoots: readonly string[] = []): boolean {
  if (typeof value === 'string') {
    return (
      /^[A-Za-z]:[\\/]/.test(value) ||
      /(?:^|[\s("'`])[A-Za-z]:[\\/]/.test(value) ||
      /(?:^|[\s("'`])\/(?:Users|home|private|var|opt|srv|mnt|Volumes|tmp)\//.test(value) ||
      forbiddenRoots.some(
        (root) =>
          root.length > 0 && (value.includes(root) || value.includes(root.replace(/\\/g, '/')))
      )
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsAbsolutePath(item, forbiddenRoots));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsAbsolutePath(item, forbiddenRoots)
    );
  }
  return false;
}

function hashPortablePayload(payload: Omit<ProjectContextAgent, 'integrity'>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function buildProjectContextAgent(
  options: SyncProjectIntelligenceLensOptions
): Promise<ProjectContextAgent> {
  const workspacePath = path.resolve(options.workspacePath);
  const projectPath = path.resolve(options.projectPath);
  const projectJsonPath = projectMetadataCandidates(projectPath, 'project.json').find((candidate) =>
    fs.existsSync(candidate)
  );
  const projectJson = projectJsonPath
    ? await readJsonIfPresent<Record<string, unknown>>(projectJsonPath)
    : null;
  const contract = await readJsonIfPresent<{
    workspace?: { name?: string; profile?: string };
    projects?: Array<{
      slug?: string;
      relativePath?: string;
      externalPath?: string;
      relationship?: ProjectWorkspaceRelationship;
      runtime?: string;
      framework?: string;
      kit?: string;
    }>;
  }>(path.join(workspacePath, '.workspai', 'workspace.contract.json'));
  const normalizedProjectPath = path.resolve(projectPath);
  const contractProject =
    contract?.projects?.find((project) => {
      if (project.externalPath) return path.resolve(project.externalPath) === normalizedProjectPath;
      if (!project.relativePath || project.relativePath.startsWith('external/')) return false;
      return path.resolve(workspacePath, project.relativePath) === normalizedProjectPath;
    }) ??
    contract?.projects?.find(
      (project) =>
        project.slug === options.projectName || project.slug === path.basename(projectPath)
    );
  const projectName =
    options.projectName ??
    (typeof projectJson?.name === 'string' ? projectJson.name : undefined) ??
    contractProject?.slug ??
    path.basename(projectPath);
  const relativePath =
    contractProject?.relativePath ??
    (() => {
      const relative = normalizedPortablePath(path.relative(workspacePath, projectPath));
      return !relative || relative.startsWith('..') ? `external/${projectName}` : relative;
    })();
  const model = await readJsonIfPresent<WorkspaceModel>(
    path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model)
  );
  const graph = await readJsonIfPresent<WorkspaceKnowledgeGraph>(
    path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph)
  );
  const modelHash = model ? hashWorkspaceModel(model) : undefined;
  const graphMatchesModel = Boolean(modelHash && graph?.source.hash === modelHash);
  const modelProject = modelProjectFor({ model, projectName, relativePath });
  const graphProjection = relatedGraphProjection(graphMatchesModel ? graph : null, projectName);
  const blockers = await readProjectBlockers(workspacePath, projectPath, projectName);
  const proofFreshness = graphProjection.proofs.map((proof) => proof.freshness);
  const graphFreshness: ProjectContextAgent['intelligence']['freshness']['graph'] = !graph
    ? 'missing'
    : !graphMatchesModel || proofFreshness.includes('stale')
      ? 'stale'
      : proofFreshness.includes('unknown')
        ? 'unknown'
        : 'fresh';
  const modelFreshness: ProjectContextAgent['intelligence']['freshness']['model'] = !model
    ? 'missing'
    : (model.factFreshness?.status ?? 'unknown');
  const lensDiagnostics: ProjectContextAgent['intelligence']['diagnostics'] = [
    ...(!model
      ? [
          {
            code: 'project.context.model-missing',
            severity: 'warning',
            message:
              'The canonical Workspace Model has not been generated yet. Refresh workspace intelligence before relying on project topology.',
          },
        ]
      : []),
    ...(model && !modelProject
      ? [
          {
            code: 'project.context.project-not-materialized',
            severity: 'warning',
            message:
              'The project is registered in the workspace contract but is not present in the current Workspace Model.',
          },
        ]
      : []),
    ...(!graph
      ? [
          {
            code: 'project.context.graph-missing',
            severity: 'warning',
            message:
              'The Workspace Knowledge Graph has not been generated yet. Run the workspace intelligence loop to build proof-backed relationships.',
          },
        ]
      : []),
    ...(graph && !graphMatchesModel
      ? [
          {
            code: 'project.context.graph-model-mismatch',
            severity: 'warning',
            message:
              'The persisted Knowledge Graph does not match the current Workspace Model and was excluded from this project lens.',
          },
        ]
      : []),
  ];
  const relationship = deriveRelationship(
    projectJson,
    options.relationship ?? contractProject?.relationship ?? 'managed'
  );
  const payloadWithoutIntegrity: Omit<ProjectContextAgent, 'integrity'> = {
    schemaVersion: PROJECT_CONTEXT_AGENT_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    workspace: {
      name: contract?.workspace?.name ?? model?.workspace.name ?? path.basename(workspacePath),
      ...(contract?.workspace?.profile || model?.workspace.profile
        ? { profile: contract?.workspace?.profile ?? model?.workspace.profile }
        : {}),
      relationship,
      contract: `workspace:${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract}`,
      model: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}`,
      knowledgeGraph: `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}`,
      access: {
        localBinding: WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectWorkspaceLink,
        canonicalEvidenceAvailableAtGeneration: true,
        identityIsFilesystemPath: false,
        resolverCommand: 'workspai project workspace status --json',
        portableUriScheme: 'workspace:',
        resolvedPathPolicy: 'runtime-private-never-persist',
      },
    },
    project: {
      name: projectName,
      relativePath,
      ...(modelProject?.kind ? { kind: modelProject.kind } : {}),
      ...(modelProject?.runtime || contractProject?.runtime
        ? { runtime: modelProject?.runtime ?? contractProject?.runtime }
        : {}),
      ...(modelProject?.runtimeCandidates?.length
        ? { runtimeCandidates: [...modelProject.runtimeCandidates].sort() }
        : {}),
      ...(modelProject?.framework || contractProject?.framework
        ? { framework: modelProject?.framework ?? contractProject?.framework }
        : {}),
      ...(modelProject?.kit || contractProject?.kit
        ? { kit: modelProject?.kit ?? contractProject?.kit }
        : {}),
      ...(modelProject?.supportTier ? { supportTier: modelProject.supportTier } : {}),
      commands: {
        supported: [...(modelProject?.commands.supported ?? [])].sort(),
        unsupported: [...(modelProject?.commands.unsupported ?? [])].sort(),
        fleetStages: [...(modelProject?.commands.fleetStages ?? [])].sort(),
      },
      importantFiles: [
        ...new Set(
          (modelProject?.importantFiles ?? [])
            .map((value) => portableArtifactReference(value, workspacePath, projectPath))
            .filter((value): value is string => value !== null)
        ),
      ].sort(),
    },
    intelligence: {
      ...(model?.generatedAt ? { modelGeneratedAt: model.generatedAt } : {}),
      ...(graph?.generatedAt ? { graphGeneratedAt: graph.generatedAt } : {}),
      ...(graph?.source.hash ? { graphModelHash: graph.source.hash } : {}),
      entityCount: graphProjection.entityCount,
      relationCount: graphProjection.relationCount,
      proofCount: graphProjection.proofCount,
      entitiesByKind: graphProjection.entitiesByKind,
      relationsByKind: graphProjection.relationsByKind,
      languages: graphProjection.languages,
      semantic: graphProjection.semantic,
      relatedProjects: graphProjection.relatedProjects,
      freshness: {
        model: modelFreshness,
        graph: graphFreshness,
        graphMatchesModel,
      },
      topology: {
        ...graphProjection.topology,
        dependencies: graphProjection.topology.dependencies.map((dependency) => ({
          ...dependency,
          evidence: dependency.evidence
            .map((value) => portableArtifactReference(value, workspacePath, projectPath))
            .filter((value): value is string => value !== null),
        })),
        dependents: graphProjection.topology.dependents.map((dependent) => ({
          ...dependent,
          evidence: dependent.evidence
            .map((value) => portableArtifactReference(value, workspacePath, projectPath))
            .filter((value): value is string => value !== null),
        })),
      },
      surfaces: projectLensSurfaces(graphProjection.entities, workspacePath, projectPath),
      diagnostics: [...lensDiagnostics, ...graphProjection.diagnostics].map((diagnostic) => ({
        ...diagnostic,
        message: portableText(diagnostic.message, workspacePath, projectPath),
        ...(diagnostic.recommendation
          ? {
              recommendation: portableText(diagnostic.recommendation, workspacePath, projectPath),
            }
          : {}),
      })),
    },
    evidence: {
      readOrder: [
        PROJECT_AGENT_ENTRY_RELATIVE_PATH,
        '.workspai/PROJECT-GROUNDING.md',
        WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent,
        'AGENTS.md',
        'workspace:.workspai/goals/index.json',
        `workspace:${WORKSPACE_SUPPLEMENTAL_ARTIFACTS.goalPackLastRun}`,
        'workspace:.workspai/reports/INDEX.json',
        'workspace:.workspai/reports/workspace-context-agent.json',
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}`,
        `workspace:${WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph}`,
      ],
      projectProofArtifacts: [
        ...new Set(
          graphProjection.proofArtifacts
            .map((value) => portableArtifactReference(value, workspacePath, projectPath))
            .filter((value): value is string => value !== null)
        ),
      ],
      relations: graphProjection.relations.map((relation) => ({
        id: relation.id,
        from: relation.from,
        to: relation.to,
        kind: relation.kind,
        derivation: relation.derivation,
        trust: relation.trust,
        confidence: relation.confidence,
        proofIds: [...relation.proofIds].sort(),
      })),
      proofs: graphProjection.proofs
        .map((proof) => portableProjectProof(proof, workspacePath, projectPath))
        .filter((proof): proof is ProjectLensProof => proof !== null),
    },
    blockers,
    agentRouting: {
      enforcement: 'required',
      mandatoryPreflight: {
        command: 'workspai agent bootstrap --for-agent generic --strict --json',
        successCondition: 'ready',
      },
      workspaceLocator: {
        command: 'workspai project workspace status --json',
        successCondition: 'resolved',
        outputClassification: 'machine-local',
        persistence: 'forbidden',
        disclosure: 'forbidden',
        portableUriScheme: 'workspace:',
      },
      workspaceEvidenceRequiredFor: [
        'repository-analysis',
        'architecture-analysis',
        'change-impact',
        'cross-project-change',
        'contract-change',
        'infrastructure-change',
        'release-readiness',
      ],
      requiredReadOrder: [
        PROJECT_AGENT_ENTRY_RELATIVE_PATH,
        'command:workspai agent bootstrap --for-agent generic --strict --json',
        'command:workspai project workspace status --json',
        WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectContextAgent,
        'workspace:.workspai/reports/INDEX.json',
        'workspace:.workspai/reports/workspace-context-agent.json',
        `command:npx workspai workspace graph search ${JSON.stringify(projectName)} --scope ${JSON.stringify(`project:${projectName}`)} --limit 12 --json`,
      ],
      degradedMode: {
        allowCompleteArchitectureClaims: false,
        requireDisclosure: true,
      },
    },
    commands: {
      refresh: 'workspai workspace intelligence run --for-agent generic --strict --json',
      verify: 'workspai workspace verify --strict --json',
      graphSearch: `workspai workspace graph search ${JSON.stringify(projectName)} --scope ${JSON.stringify(`project:${projectName}`)} --limit 12 --json`,
      doctor: 'workspai doctor project --json',
      workspaceStatus: 'workspai project workspace status --json',
    },
  };
  if (containsAbsolutePath(payloadWithoutIntegrity, [workspacePath, projectPath])) {
    throw new Error('Project context lens rejected a non-portable absolute path.');
  }
  const context: ProjectContextAgent = {
    ...payloadWithoutIntegrity,
    integrity: {
      algorithm: 'sha256',
      ...(modelHash ? { modelHash } : {}),
      payloadHash: hashPortablePayload(payloadWithoutIntegrity),
      portable: true,
      absolutePathsEmitted: false,
    },
  };
  assertJsonSchemaContract(
    context,
    'contracts/workspace-intelligence/project-context-agent.v1.json',
    'Project context agent'
  );
  return context;
}

function buildProjectGroundingMarkdown(context: ProjectContextAgent): string {
  const related =
    context.intelligence.relatedProjects.length > 0
      ? context.intelligence.relatedProjects.map((name) => `\`${name}\``).join(', ')
      : 'No proven cross-project relation is currently available.';
  const diagnostics =
    context.intelligence.diagnostics.length > 0
      ? context.intelligence.diagnostics
          .slice(0, 8)
          .map(
            (diagnostic) =>
              `- **${diagnostic.severity} · ${diagnostic.code}:** ${diagnostic.message}`
          )
          .join('\n')
      : '- No project-scoped graph diagnostic is currently recorded.';
  const blockers =
    context.blockers.length > 0
      ? context.blockers
          .slice(0, 12)
          .map(
            (blocker) =>
              `- **${blocker.severity}${blocker.code ? ` · ${blocker.code}` : ''}:** ${blocker.message}`
          )
          .join('\n')
      : '- No current project-scoped blocker is recorded.';
  return `# Workspai project grounding

This project is adopted into the **${context.workspace.name}** Workspai workspace.
That value is the canonical workspace identity, not its filesystem path. Workspai
commands launched here resolve the machine-local workspace automatically.

## Mandatory first contact

Do not begin broad repository discovery, architecture claims, planning, or mutation
until this sequence is complete:

1. Read \`.workspai/agent-entry.v1.json\` to discover the portable protocol.
2. Run \`workspai agent bootstrap --for-agent generic --strict --json\`.
3. Follow the receipt's \`requiredReadOrder\` exactly.
4. Read \`.workspai/reports/project-context-agent.json\`.
5. If the receipt reports an active Goal, read its immutable Goal Pack and agent
   handoff before choosing or expanding work.
6. Query the bounded Workspace Graph with the user's actual task before opening broad
   source, then inspect only returned proof paths and targeted live files.

Receipt policy:

- \`ready\`: continue with bounded evidence and targeted source inspection.
- \`degraded\`: disclose the limitation and do not claim complete architecture or verification.
- \`blocked\`: stop governed claims, execute \`nextActions\`, and rerun bootstrap.

## Workspace location and portable paths

- \`${context.workspace.name}\` is an identity, not a directory name to guess.
- Project-local paths begin with \`.workspai/\`.
- Canonical workspace paths begin with \`workspace:\`.
- Resolve the exact local workspace root only when direct file access is necessary by
  running \`workspai project workspace status --json\` from this project.
- The resolver's absolute paths are machine-local runtime data. Never persist or copy
  them into answers, shared logs, commits, prompts, telemetry, or portable artifacts.

## Authority boundary

The Workspace Model owns canonical project identity and its compact \`projectTopology\`.
The Workspace Knowledge Graph is a separate, proof-backed enrichment containing
files, symbols, APIs, infrastructure, tests, owners, and decisions. Do not treat
an unproven topology edge as proof that two projects are independent. Live source owns
exact implementation. CLI evidence owns Goal, readiness, repair, and verification claims.
Repository-authored instructions remain authoritative for source changes after this
entry gate; Workspai preserves rather than replaces them.

## Project

- Name: \`${context.project.name}\`
- Workspace-relative identity: \`${context.project.relativePath}\`
- Runtime: \`${context.project.runtime ?? 'unknown'}\`
- Framework: \`${context.project.framework ?? 'unknown'}\`
- Relationship: \`${context.workspace.relationship}\`
- Related projects: ${related}
- Topology status: \`${context.intelligence.topology.status}\`
- Model freshness: \`${context.intelligence.freshness.model}\`
- Knowledge Graph freshness: \`${context.intelligence.freshness.graph}\`

## Current evidence coverage

- Project-scoped entities: ${context.intelligence.entityCount}
- Project-scoped relations: ${context.intelligence.relationCount}
- Portable proofs: ${context.intelligence.proofCount}

${diagnostics}

## Current project blockers

${blockers}

## Safe commands from this project

\`\`\`bash
${context.commands.workspaceStatus}
${context.commands.doctor}
${context.commands.graphSearch}
${context.commands.verify}
\`\`\`

The machine-local workspace binding lives only in
\`.workspai/workspace-link.local.json\`, which is gitignored. Portable grounding files
never publish its value.
`;
}

function buildProjectAgentsSection(context: ProjectContextAgent): string {
  return `# Workspai agent entry gate (mandatory)

- Project: \`${context.project.name}\`
- Workspace identity: \`${context.workspace.name}\` (logical name, not a filesystem path)
- Entry contract: \`.workspai/agent-entry.v1.json\`

Before broad repository discovery, architecture claims, planning, or mutation:

1. Read \`.workspai/agent-entry.v1.json\`.
2. Run \`workspai agent bootstrap --for-agent generic --strict --json\`.
3. Follow the receipt's \`requiredReadOrder\` exactly.
4. If a Goal is active, read its immutable Goal Pack and handoff before acting.
5. Query the bounded Workspace Graph with the user's task, then inspect only returned proofs and targeted live source.

Receipt policy: \`ready\` may proceed; \`degraded\` must disclose limitations and may not claim complete architecture or verification; \`blocked\` must stop governed claims, execute \`nextActions\`, and rerun bootstrap.

\`workspace:\` paths belong to the canonical workspace, not this project's \`.workspai\` directory. Resolve their machine-local root at runtime with \`workspai project workspace status --json\`. That output is machine-local: never copy it into answers, shared logs, commits, or portable artifacts.

Authority: Workspai evidence owns identity, topology, goals, readiness, and verification. Live source and repository-authored rules own exact implementation and source conventions.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function managedBlockPattern(start: string, end: string): RegExp {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
}

function removeProjectManagedAgentSection(existing: string): string {
  let result = existing.replace(
    managedBlockPattern(WORKSPAI_PROJECT_GROUNDING_START, WORKSPAI_PROJECT_GROUNDING_END),
    ''
  );
  const legacySection = extractManagedAgentSection(result);
  if (legacySection?.includes('# Workspai project boundary')) {
    result = result.replace(
      managedBlockPattern(RAPIDKIT_AGENT_GROUNDING_START, RAPIDKIT_AGENT_GROUNDING_END),
      ''
    );
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function upsertProjectManagedAgentSection(existing: string, generated: string): string {
  const withoutManaged = removeProjectManagedAgentSection(existing);
  const block = `${WORKSPAI_PROJECT_GROUNDING_START}\n${generated.trim()}\n${WORKSPAI_PROJECT_GROUNDING_END}`;
  return withoutManaged ? `${block}\n\n${withoutManaged}\n` : `${block}\n`;
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, contents, 'utf8');
    try {
      await fsp.rename(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fsExtra.move(temporaryPath, filePath, { overwrite: true });
    }
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function isAuthoredTrackedDeletion(projectPath: string, fileName: string): Promise<boolean> {
  let gitRootResult;
  try {
    gitRootResult = await execa('git', ['rev-parse', '--show-toplevel'], {
      cwd: projectPath,
      reject: false,
    });
  } catch {
    return false;
  }
  if (gitRootResult?.exitCode !== 0) return false;
  const reportedGitRoot = gitRootResult.stdout.trim();
  if (!reportedGitRoot) return false;
  let gitRoot: string;
  let canonicalProjectPath: string;
  try {
    [gitRoot, canonicalProjectPath] = await Promise.all([
      fsp.realpath(path.resolve(reportedGitRoot)),
      fsp.realpath(projectPath),
    ]);
  } catch {
    return false;
  }
  const targetPath = path.resolve(canonicalProjectPath, fileName);
  const relativePath = path.relative(gitRoot, targetPath).replace(/\\/g, '/');
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    return false;
  }
  let committed;
  try {
    committed = await execa('git', ['cat-file', '-e', `HEAD:${relativePath}`], {
      cwd: gitRoot,
      reject: false,
    });
  } catch {
    return false;
  }
  if (committed?.exitCode !== 0) return false;
  let deleted;
  try {
    deleted = await execa(
      'git',
      ['ls-files', '--deleted', '--error-unmatch', '--', `:(top)${relativePath}`],
      { cwd: gitRoot, reject: false }
    );
  } catch {
    return false;
  }
  return deleted?.exitCode === 0;
}

async function reconcileGroundingIgnores(
  projectPath: string,
  mode: ProjectGroundingMode
): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const existing = await fsp.readFile(gitignorePath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  const desired = [
    PROJECT_GROUNDING_RELATIVE_PATH,
    PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
    PROJECT_AGENT_ENTRY_RELATIVE_PATH,
  ];
  const retained = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() !== '# Workspai local project grounding' &&
        !desired.includes(line.trim() as (typeof desired)[number])
    );
  while (retained.length > 0 && retained[retained.length - 1] === '') retained.pop();
  if (mode === 'local') {
    if (retained.length > 0) retained.push('');
    retained.push('# Workspai local project grounding', ...desired);
  }
  const updated = retained.length > 0 ? `${retained.join('\n')}\n` : '';
  if (updated !== existing) await writeAtomic(gitignorePath, updated);
}

type ProjectAgentAdapter = {
  host: 'claude' | 'gemini' | 'qwen' | 'amazon-q';
  relativePath: string;
  importFromAgents: string;
  importFromGrounding: string;
};

const PROJECT_AGENT_ADAPTERS: readonly ProjectAgentAdapter[] = [
  {
    host: 'claude',
    relativePath: 'CLAUDE.md',
    importFromAgents: '@AGENTS.md',
    importFromGrounding: '@.workspai/PROJECT-GROUNDING.md',
  },
  {
    host: 'gemini',
    relativePath: 'GEMINI.md',
    importFromAgents: '@./AGENTS.md',
    importFromGrounding: '@./.workspai/PROJECT-GROUNDING.md',
  },
  {
    host: 'qwen',
    relativePath: 'QWEN.md',
    importFromAgents: '@AGENTS.md',
    importFromGrounding: '@.workspai/PROJECT-GROUNDING.md',
  },
  {
    host: 'amazon-q',
    relativePath: '.amazonq/rules/workspai-agent-entry.md',
    importFromAgents: '',
    importFromGrounding: '',
  },
] as const;

if (
  PROJECT_AGENT_ADAPTERS.length !== PROJECT_AGENT_ADAPTER_ENTRY_FILES.length ||
  PROJECT_AGENT_ADAPTERS.some(
    (adapter, index) => adapter.relativePath !== PROJECT_AGENT_ADAPTER_ENTRY_FILES[index]
  )
) {
  throw new Error('Project agent adapter paths must match the portable entry contract.');
}

async function findUnsafeAdapterParent(
  projectPath: string,
  relativePath: string
): Promise<string | null> {
  const segments = relativePath.split('/').slice(0, -1);
  let current = projectPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return path.relative(projectPath, current).split(path.sep).join('/');
    }
  }
  return null;
}

function projectAgentAdapterBody(input: {
  adapter: ProjectAgentAdapter;
  agentsAvailable: boolean;
}): string {
  const imported = input.agentsAvailable
    ? input.adapter.importFromAgents
    : input.adapter.importFromGrounding;
  if (imported) {
    return `${imported}

# Workspai host binding · ${input.adapter.host}

The imported Workspai entry gate is mandatory. Validate this host with
\`workspai agent bootstrap --for-agent ${input.adapter.host} --strict --json\`, then follow
the receipt's \`requiredReadOrder\`, Goal handoff, bounded Graph queries, proof paths,
status policy, workspace locator privacy policy, and authority boundary. Do not repeat
the imported instructions or replace repository-authored source rules.`;
  }
  return `# Workspai entry for ${input.adapter.host}

Before broad repository discovery, architecture claims, planning, or mutation:

1. Read \`.workspai/agent-entry.v1.json\`.
2. Run \`workspai agent bootstrap --for-agent ${input.adapter.host} --strict --json\`.
3. Follow \`requiredReadOrder\`, any active Goal handoff, bounded Graph queries, and returned proof paths.

Receipt policy: \`ready\` may proceed; \`degraded\` must disclose limitations; \`blocked\` must execute \`nextActions\` and rerun bootstrap before governed claims.

The workspace name is a logical identity, not a path. Resolve \`workspace:\` URIs at runtime with \`workspai project workspace status --json\`; its absolute paths are machine-local and must never be copied into shared output or portable artifacts. Live source owns exact implementation; Workspai evidence owns identity, topology, goals, readiness, and verification. Repository-authored rules remain authoritative for source changes after this entry gate.`;
}

async function reconcileProjectAgentAdapter(input: {
  projectPath: string;
  adapter: ProjectAgentAdapter;
  mode: ProjectGroundingMode;
  agentsAvailable: boolean;
}): Promise<{ path?: string; reason?: string }> {
  const unsafeParent = await findUnsafeAdapterParent(input.projectPath, input.adapter.relativePath);
  if (unsafeParent) {
    return {
      reason: `${input.adapter.relativePath} has an unsafe repository-authored parent at ${unsafeParent}.`,
    };
  }
  const absolutePath = path.join(input.projectPath, input.adapter.relativePath);
  const stat = await fsp.lstat(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) {
    return { reason: `${input.adapter.relativePath} is a repository-authored symbolic link.` };
  }
  const existed = stat?.isFile() === true;
  const existing = await fsp.readFile(absolutePath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  if (
    input.mode === 'managed' &&
    !existed &&
    (await isAuthoredTrackedDeletion(input.projectPath, input.adapter.relativePath))
  ) {
    return { reason: `${input.adapter.relativePath} has an authored tracked deletion.` };
  }
  const withoutManaged = existing
    .replace(managedBlockPattern(WORKSPAI_AGENT_ENTRY_START, WORKSPAI_AGENT_ENTRY_END), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const updated =
    input.mode === 'managed'
      ? [
          withoutManaged,
          `${WORKSPAI_AGENT_ENTRY_START}\n${projectAgentAdapterBody(input).trim()}\n${WORKSPAI_AGENT_ENTRY_END}`,
        ]
          .filter(Boolean)
          .join('\n\n')
      : withoutManaged;
  if (!updated) {
    if (existed) await fsp.rm(absolutePath, { force: true });
    return {};
  }
  const normalized = `${updated.trimEnd()}\n`;
  if (normalized !== existing) await writeAtomic(absolutePath, normalized);
  return input.mode === 'managed' ? { path: input.adapter.relativePath } : {};
}

function hostCoverage(input: {
  mode: ProjectGroundingMode;
  agentsAvailable: boolean;
  adapters: Map<ProjectAgentAdapter['host'], { path?: string; reason?: string }>;
}): AgentEntryHostCoverage[] {
  const portableGrounding: AgentEntryHostCoverage = {
    id: 'generic',
    discovery: 'portable-fallback',
    entryFiles: [PROJECT_GROUNDING_RELATIVE_PATH],
    status: 'ready',
    managed: input.mode === 'managed',
  };
  const agentsHosts: AgentEntryHostId[] = [
    'codex',
    'kimi',
    'grok',
    'copilot',
    'cursor',
    'windsurf',
  ];
  const agentsCoverage = agentsHosts.map<AgentEntryHostCoverage>((id) => ({
    id,
    discovery: 'native',
    entryFiles: ['AGENTS.md'],
    status: input.agentsAvailable ? 'ready' : 'blocked',
    managed: input.mode === 'managed' && input.agentsAvailable,
    ...(!input.agentsAvailable
      ? { reason: 'AGENTS.md could not be managed without overriding authored repository state.' }
      : {}),
  }));
  const adapterCoverage = PROJECT_AGENT_ADAPTERS.map<AgentEntryHostCoverage>((adapter) => {
    const result = input.adapters.get(adapter.host);
    return {
      id: adapter.host,
      discovery: 'adapter',
      entryFiles: [adapter.relativePath],
      status: result?.path ? 'ready' : input.mode === 'managed' ? 'blocked' : 'degraded',
      managed: Boolean(result?.path),
      ...(!result?.path
        ? {
            reason:
              result?.reason ??
              'Provider adapter generation is disabled by the project grounding policy.',
          }
        : {}),
    };
  });
  const coverage = [portableGrounding, ...agentsCoverage, ...adapterCoverage];
  return AGENT_ENTRY_HOST_IDS.map(
    (id) => coverage.find((entry) => entry.id === id) as AgentEntryHostCoverage
  );
}

async function reconcileProjectAgents(
  projectPath: string,
  mode: ProjectGroundingMode,
  context?: ProjectContextAgent
): Promise<string | undefined> {
  const agentsPath = path.join(projectPath, 'AGENTS.md');
  const agentsStat = await fsp.lstat(agentsPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  // Preserve repository-authored symlinks. Workspai still publishes portable
  // grounding under .workspai without following or replacing the link target.
  if (agentsStat?.isSymbolicLink()) return undefined;
  const existed = agentsStat?.isFile() === true;
  const existing = await fsp.readFile(agentsPath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  if (mode === 'managed' && !context) {
    throw new Error('Managed project grounding requires a project context.');
  }
  if (mode === 'managed' && !existed) {
    if (await isAuthoredTrackedDeletion(projectPath, 'AGENTS.md')) {
      // A tracked deletion is authored worktree state. The portable project
      // grounding remains available under .workspai without resurrecting it.
      return undefined;
    }
  }
  const updated =
    mode === 'managed' && context
      ? upsertProjectManagedAgentSection(existing, buildProjectAgentsSection(context))
      : removeProjectManagedAgentSection(existing);
  if (!updated) {
    if (existed) await fsp.rm(agentsPath, { force: true });
    return undefined;
  }
  const normalized = `${updated.trimEnd()}\n`;
  if (normalized !== existing) await writeAtomic(agentsPath, normalized);
  return mode === 'managed' ? agentsPath : undefined;
}

export async function syncProjectIntelligenceLens(
  options: SyncProjectIntelligenceLensOptions
): Promise<SyncProjectIntelligenceLensResult> {
  const mode = options.mode ?? 'managed';
  const workspacePath = path.resolve(options.workspacePath);
  const projectPath = path.resolve(options.projectPath);
  if (mode === 'off') {
    const projectJsonPath = projectMetadataCandidates(projectPath, 'project.json').find(
      (candidate) => fs.existsSync(candidate)
    );
    const projectJson = projectJsonPath
      ? await readJsonIfPresent<Record<string, unknown>>(projectJsonPath)
      : null;
    const projectName =
      options.projectName ??
      (typeof projectJson?.name === 'string' ? projectJson.name : undefined) ??
      path.basename(projectPath);
    const relationship = deriveRelationship(projectJson, options.relationship ?? 'managed');
    const link = await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName,
      relationship,
      now: options.now,
    });
    await reconcileGroundingIgnores(projectPath, mode);
    await reconcileProjectAgents(projectPath, mode);
    await Promise.all(
      PROJECT_AGENT_ADAPTERS.map((adapter) =>
        reconcileProjectAgentAdapter({
          projectPath,
          adapter,
          mode,
          agentsAvailable: false,
        })
      )
    );
    await Promise.all([
      fsp.rm(path.join(projectPath, PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH), {
        force: true,
      }),
      fsp.rm(path.join(projectPath, PROJECT_GROUNDING_RELATIVE_PATH), { force: true }),
      fsp.rm(path.join(projectPath, PROJECT_AGENT_ENTRY_RELATIVE_PATH), { force: true }),
    ]);
    return {
      mode,
      projectPath,
      linkPath: link.linkPath,
      writtenFiles: [WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectWorkspaceLink],
    };
  }
  const context = await buildProjectContextAgent(options);
  const relationship = context.workspace.relationship;
  const link = await writeProjectWorkspaceLink({
    workspacePath,
    projectPath,
    projectName: context.project.name,
    relationship,
    workspaceName: context.workspace.name,
    relativePath: context.project.relativePath,
    now: options.now,
  });
  await reconcileGroundingIgnores(projectPath, mode);
  const agentsPath = await reconcileProjectAgents(projectPath, mode, context);
  const adapterResults = new Map<ProjectAgentAdapter['host'], { path?: string; reason?: string }>();
  for (const adapter of PROJECT_AGENT_ADAPTERS) {
    adapterResults.set(
      adapter.host,
      await reconcileProjectAgentAdapter({
        projectPath,
        adapter,
        mode,
        agentsAvailable: Boolean(agentsPath),
      })
    );
  }
  const coverage = hostCoverage({
    mode,
    agentsAvailable: Boolean(agentsPath),
    adapters: adapterResults,
  });
  const contextPath = path.join(projectPath, PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH);
  const groundingPath = path.join(projectPath, PROJECT_GROUNDING_RELATIVE_PATH);
  const agentEntryPath = path.join(projectPath, PROJECT_AGENT_ENTRY_RELATIVE_PATH);
  const agentEntry = buildProjectAgentEntryManifest({ context, hosts: coverage });
  await writeAtomic(contextPath, `${JSON.stringify(context, null, 2)}\n`);
  await writeAtomic(groundingPath, `${buildProjectGroundingMarkdown(context).trimEnd()}\n`);
  await writeAtomic(agentEntryPath, `${JSON.stringify(agentEntry, null, 2)}\n`);
  const writtenFiles = [
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectWorkspaceLink,
    PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
    PROJECT_GROUNDING_RELATIVE_PATH,
    PROJECT_AGENT_ENTRY_RELATIVE_PATH,
  ];
  if (agentsPath) writtenFiles.push('AGENTS.md');
  for (const result of adapterResults.values()) {
    if (result.path) writtenFiles.push(result.path);
  }
  return {
    mode,
    projectPath,
    linkPath: link.linkPath,
    groundingPath,
    contextPath,
    agentEntryPath,
    agentsPath,
    hostCoverage: coverage,
    writtenFiles,
  };
}

export async function syncWorkspaceProjectLenses(input: {
  workspacePath: string;
  mode?: ProjectGroundingMode;
  now?: Date;
}): Promise<SyncWorkspaceProjectLensesResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const mode = input.mode ?? 'managed';
  const targets = await resolveWorkspaceProjectLensTargets(workspacePath);
  const results: SyncProjectIntelligenceLensResult[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const project of targets.resolved) {
    try {
      results.push(
        await syncProjectIntelligenceLens({
          workspacePath,
          projectPath: project.projectPath,
          projectName: project.name,
          relationship: project.relationship,
          mode,
          now: input.now,
        })
      );
    } catch (error) {
      skipped.push({
        name: project.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { workspacePath, mode, projects: results, skipped: [...targets.skipped, ...skipped] };
}

export async function resolveWorkspaceProjectLensTargets(workspacePathInput: string): Promise<{
  resolved: WorkspaceProjectLensTarget[];
  skipped: Array<{ name: string; reason: string }>;
}> {
  const workspacePath = path.resolve(workspacePathInput);
  const contract = await readJsonIfPresent<{
    projects?: Array<{
      slug?: string;
      relativePath?: string;
      externalPath?: string;
      relationship?: ProjectWorkspaceRelationship;
    }>;
  }>(path.join(workspacePath, '.workspai', 'workspace.contract.json'));
  const resolved: WorkspaceProjectLensTarget[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const project of contract?.projects ?? []) {
    const name = project.slug ?? project.relativePath ?? 'unknown-project';
    const projectPath =
      typeof project.externalPath === 'string'
        ? path.resolve(project.externalPath)
        : typeof project.relativePath === 'string' && !project.relativePath.startsWith('external/')
          ? path.resolve(workspacePath, project.relativePath)
          : null;
    if (!projectPath || !fs.existsSync(projectPath)) {
      skipped.push({ name, reason: 'project path is unavailable on this machine' });
      continue;
    }
    resolved.push({
      name,
      projectPath,
      relationship: project.relationship ?? 'managed',
    });
  }
  return { resolved, skipped };
}
