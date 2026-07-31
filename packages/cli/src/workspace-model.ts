import path from 'path';
import fsExtra from 'fs-extra';

import { readImportedProjectsRegistry } from './imported-projects-registry.js';
import {
  detectBackendFrameworkFromProject,
  detectNestedRuntimeCandidatesFromProject,
  detectRuntimeCandidatesFromProject,
  type BackendConfidence,
  type BackendRuntimeFamily,
  type BackendSupportTier,
} from './utils/backend-framework-contract.js';
import {
  resolveProjectCommandCapabilities,
  type CommandCapability,
} from './utils/project-command-capabilities.js';
import type { WorkspaceRunStageName } from './utils/cli-lifecycle-contract.js';
import {
  categorizeWorkspaceProjectKind,
  inferWorkspaceProjectKind,
  type WorkspaceProjectCategory,
  type WorkspaceProjectKind,
} from './utils/project-kind.js';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import {
  resolveCreatePlannerCapability,
  type CreatePlannerCapability,
} from './utils/create-planner-capabilities.js';
import { attachRunCorrelation } from './observability/run-correlation.js';
import {
  inferWorkspaceDependencyGraph,
  inferWorkspaceDependencyGraphIncremental,
} from './workspace-dependency-graph.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import {
  computeModelInputsHash,
  computeProjectSignatures,
  computeWorkspaceFileSignatures,
  getRapidkitCliVersion,
  readWorkspaceModelCache,
  writeWorkspaceModelCache,
} from './workspace-model-cache.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { readWorkspaceContract, type WorkspaceContract } from './utils/workspace-contract.js';
import { readRapidkitProjectJson } from './utils/runtime-detection.js';
import { getRuntimeSupport } from './utils/support-matrix.js';
import { discoverWorkspaceProjects } from './utils/workspace-discovery.js';
import { readWorkspaceMarker } from './workspace-marker.js';
import { workspaceMetadataCandidates } from './utils/workspace-paths.js';
import {
  buildWorkspaceFact,
  summarizeFactFreshness,
  type FactFreshnessSummary,
  type WorkspaceFact,
} from './contracts/fact-freshness-contract.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';

export const WORKSPACE_MODEL_SCHEMA_VERSION = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.model;
export const WORKSPACE_MODEL_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.model;

export type WorkspaceModelEvidenceRef = {
  path: string;
  exists: boolean;
  generatedAt?: string;
  status?: string;
};

export type WorkspaceModelProject = {
  name: string;
  path: string;
  absolutePath?: string;
  kind: WorkspaceProjectKind;
  category: WorkspaceProjectCategory;
  runtime: BackendRuntimeFamily;
  runtimeCandidates: BackendRuntimeFamily[];
  framework: string;
  frameworkDisplayName: string;
  confidence: BackendConfidence;
  detectionSource: string;
  supportTier: BackendSupportTier;
  runtimeSupportTier: BackendSupportTier;
  runtimeDoctorSupport: 'full' | 'readiness' | 'observed';
  moduleSupport: boolean;
  kit?: string;
  engine?: string;
  generator?: {
    id?: string;
    kit?: string;
    displayName?: string;
    source: 'official-generator' | 'metadata';
    commandDisplay?: string;
  };
  createCapability: CreatePlannerCapability;
  commands: {
    supported: string[];
    unsupported: string[];
    global: string[];
    fleetStages: WorkspaceRunStageName[];
    localOnly: string[];
    map: Record<string, CommandCapability>;
  };
  importantFiles: string[];
  evidence: Record<string, WorkspaceModelEvidenceRef | null>;
  provenance: Record<string, string>;
};

export type WorkspaceModelValidationSeverity = 'error' | 'warning';

export type WorkspaceModelValidationIssue = {
  severity: WorkspaceModelValidationSeverity;
  code: string;
  message: string;
  target: string;
};

export type WorkspaceModelValidationResult = {
  status: 'passed' | 'warning' | 'failed';
  errors: number;
  warnings: number;
  issues: WorkspaceModelValidationIssue[];
};

export type WorkspaceModelBuildProvenance = {
  schemaVersion: 'workspace-model-build.v1';
  mode: 'full' | 'cache' | 'incremental';
  outcome: 'rebuilt' | 'partially-reused' | 'reused';
  engineStatus: WorkspaceModelCacheStatus | WorkspaceModelIncrementalMode;
};

export type WorkspaceModel = {
  schemaVersion: typeof WORKSPACE_MODEL_SCHEMA_VERSION;
  generatedAt: string;
  workspace: {
    name: string;
    root: string;
    profile?: string;
    type: 'rapidkit-workspace' | 'observed-workspace';
    marker?: {
      createdBy?: string;
      version?: string;
      createdAt?: string;
    };
  };
  identity: {
    workspaceType: string;
    surfaces: WorkspaceProjectKind[];
    categories: WorkspaceProjectCategory[];
    runtimeFamilies: BackendRuntimeFamily[];
    businessCapabilities: string[];
  };
  discovery: {
    observableScanDepth: number;
  };
  projects: WorkspaceModelProject[];
  policies: {
    mode: string;
    source: string | null;
    exists: boolean;
  };
  contracts: {
    workspaceContractPath: string;
    exists: boolean;
    status: 'known' | 'missing' | 'unknown';
  };
  /** Canonical compact project dependency topology. */
  projectTopology?: WorkspaceDependencyGraph;
  /**
   * @deprecated Use `projectTopology`. This compatibility alias is emitted
   * during the v1 migration window and must remain structurally identical.
   */
  graph?: WorkspaceDependencyGraph;
  evidence: Record<string, WorkspaceModelEvidenceRef | null>;
  summary: {
    projectCount: number;
    runtimes: string[];
    frameworks: string[];
    firstClassProjects: number;
    observedProjects: number;
  };
  facts?: WorkspaceFact[];
  factFreshness?: FactFreshnessSummary;
  validation?: WorkspaceModelValidationResult;
  /**
   * Non-structural command provenance. This tells machine consumers whether
   * the emitted model was rebuilt or safely reused without changing the
   * canonical model hash.
   */
  build?: WorkspaceModelBuildProvenance;
};

export function workspaceModelProjectTopology(
  model: Pick<WorkspaceModel, 'projectTopology' | 'graph'>
): WorkspaceDependencyGraph | undefined {
  return model.projectTopology ?? model.graph;
}

function hasCanonicalWorkspaceModelTopology(
  model: Pick<WorkspaceModel, 'projectTopology' | 'graph'>
): model is Pick<WorkspaceModel, 'projectTopology' | 'graph'> & {
  projectTopology: WorkspaceDependencyGraph;
  graph: WorkspaceDependencyGraph;
} {
  return Boolean(
    model.projectTopology &&
    model.graph &&
    hashCanonicalJson(model.projectTopology) === hashCanonicalJson(model.graph)
  );
}

export type BuildWorkspaceModelOptions = {
  workspacePath: string;
  includeAbsolutePaths?: boolean;
  includeEvidence?: boolean;
  observableScanDepth?: number;
  strict?: boolean;
  now?: Date;
  /**
   * Opt-in model/graph cache keyed by `inputsHash` (1.15). Honored only by
   * `buildWorkspaceModelCached`; `buildWorkspaceModel` always rebuilds.
   */
  cache?: boolean;
  /**
   * Incremental reuse (1.16): cached project models keyed by relative path. For
   * paths present here the cached model is reused instead of being rebuilt.
   */
  reuseProjectModels?: Map<string, WorkspaceModelProject>;
  /** Incremental graph inference context (1.16). */
  incrementalGraph?: {
    previousGraph: WorkspaceDependencyGraph;
    changedProjectIds: Set<string>;
    structuralChange: boolean;
  };
};

export type WorkspaceModelCacheStatus = 'hit' | 'miss' | 'disabled';

export type WorkspaceModelIncrementalMode = 'full' | 'incremental' | 'unchanged';

export function createWorkspaceModelBuildProvenance(input: {
  mode: WorkspaceModelBuildProvenance['mode'];
  engineStatus: WorkspaceModelBuildProvenance['engineStatus'];
}): WorkspaceModelBuildProvenance {
  const outcome =
    input.engineStatus === 'hit' || input.engineStatus === 'unchanged'
      ? 'reused'
      : input.engineStatus === 'incremental'
        ? 'partially-reused'
        : 'rebuilt';
  return {
    schemaVersion: 'workspace-model-build.v1',
    mode: input.mode,
    outcome,
    engineStatus: input.engineStatus,
  };
}

const OBSERVABLE_PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'deno.json',
  'deno.jsonc',
  'bun.lock',
  'bun.lockb',
  'deps.edn',
  'project.clj',
  'build.sbt',
  'docker-compose.yml',
  'docker-compose.yaml',
  'terraform.tf',
];

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.workspai',
  '.rapidkit',
  '.venv',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  'htmlcov',
  '.next',
  '.turbo',
]);

function toPosixRelative(workspacePath: string, targetPath: string): string {
  const relativePath = path.relative(workspacePath, targetPath) || '.';
  return relativePath.split(path.sep).join('/');
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await fsExtra.pathExists(filePath))) {
      return null;
    }
    const raw = await fsExtra.readJSON(filePath);
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function hasAnyFile(dirPath: string, fileNames: string[]): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await fsExtra.pathExists(path.join(dirPath, fileName))) {
      return true;
    }
  }
  return false;
}

function resolveObservableScanDepth(input: number | undefined): number {
  const envDepth = Number.parseInt(process.env.RAPIDKIT_WORKSPACE_MODEL_SCAN_DEPTH ?? '', 10);
  const rawDepth =
    typeof input === 'number' && Number.isFinite(input)
      ? input
      : Number.isFinite(envDepth)
        ? envDepth
        : 4;
  return Math.min(12, Math.max(1, Math.trunc(rawDepth)));
}

async function discoverObservableProjectRoots(
  workspacePath: string,
  maxDepth: number
): Promise<string[]> {
  const root = path.resolve(workspacePath);
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: root, depth: 0 }];
  const observed = new Set<string>();
  const visited = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) {
      continue;
    }
    const dirPath = path.resolve(item.dirPath);
    if (visited.has(dirPath)) {
      continue;
    }
    visited.add(dirPath);

    if (dirPath !== root && (await hasAnyFile(dirPath, OBSERVABLE_PROJECT_MARKERS))) {
      observed.add(dirPath);
      continue;
    }

    if (item.depth >= maxDepth) {
      continue;
    }

    let entries: Array<{ isDirectory: () => boolean; name: string }> = [];
    try {
      entries = await fsExtra.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        SKIP_DIRS.has(entry.name) ||
        isPythonVirtualEnvironmentDirectory(entry.name)
      ) {
        continue;
      }
      if (entry.name.startsWith('.') && entry.name !== '.config') {
        continue;
      }
      queue.push({ dirPath: path.join(dirPath, entry.name), depth: item.depth + 1 });
    }
  }

  return Array.from(observed).sort((a, b) => a.localeCompare(b));
}

function collectUniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of paths) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    output.push(resolved);
  }
  return output.sort((a, b) => a.localeCompare(b));
}

function stringFromRecord(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolFromRecord(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}

function resolveGeneratorIdentity(
  projectJson: Record<string, unknown> | null,
  kit: string | undefined,
  fallbackDisplayName: string
): WorkspaceModelProject['generator'] | undefined {
  const frontend =
    projectJson?.frontend &&
    typeof projectJson.frontend === 'object' &&
    !Array.isArray(projectJson.frontend)
      ? (projectJson.frontend as Record<string, unknown>)
      : undefined;
  const generatorId = stringFromRecord(frontend, 'generator');
  const commandDisplay = stringFromRecord(frontend, 'command_display');
  const isFrontendKit = typeof kit === 'string' && kit.startsWith('frontend.');

  if (!generatorId && !isFrontendKit) {
    return undefined;
  }

  return {
    ...(generatorId ? { id: generatorId } : {}),
    ...(kit ? { kit } : {}),
    displayName: fallbackDisplayName,
    source: boolFromRecord(frontend, 'official_generator') ? 'official-generator' : 'metadata',
    ...(commandDisplay ? { commandDisplay } : {}),
  };
}

async function collectImportantFiles(projectPath: string): Promise<string[]> {
  const candidates = [
    '.workspai/project.json',
    '.workspai/context.json',
    '.rapidkit/project.json',
    '.rapidkit/context.json',
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'composer.json',
    'Gemfile',
    'mix.exs',
    'deno.json',
    'Dockerfile',
    'docker-compose.yml',
    'README.md',
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await fsExtra.pathExists(path.join(projectPath, candidate))) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function evidenceRef(
  workspacePath: string,
  relativePath: string,
  includeEvidence: boolean,
  displayPath = relativePath
): Promise<WorkspaceModelEvidenceRef | null> {
  const artifactPath = await firstExistingWorkspaceArtifactPath(workspacePath, relativePath);
  const exists = artifactPath !== null;
  const ref: WorkspaceModelEvidenceRef = {
    path: displayPath.split(path.sep).join('/'),
    exists,
  };

  if (artifactPath && includeEvidence) {
    const raw = await readJsonIfExists(artifactPath);
    if (typeof raw?.generatedAt === 'string') {
      ref.generatedAt = raw.generatedAt;
    }
    const status = raw?.status ?? raw?.result ?? raw?.verdict;
    if (typeof status === 'string') {
      ref.status = status;
    }
  }

  return ref;
}

async function projectEvidenceRefs(
  workspacePath: string,
  projectPath: string,
  includeEvidence: boolean
): Promise<Record<string, WorkspaceModelEvidenceRef | null>> {
  const projectRelative = toPosixRelative(workspacePath, projectPath);
  const projectReportPrefix = '.workspai/reports';
  const projectEvidence = (fileName: string) =>
    evidenceRef(
      projectPath,
      `${projectReportPrefix}/${fileName}`,
      includeEvidence,
      `${projectRelative}/${projectReportPrefix}/${fileName}`
    );
  const projectDoctor = await projectEvidence('doctor-project-last-run.json');
  const legacyProjectDoctor =
    projectDoctor?.exists === true ? projectDoctor : await projectEvidence('doctor-last-run.json');
  return {
    doctor: legacyProjectDoctor,
    remediationPlan: await projectEvidence('doctor-remediation-plan-last-run.json'),
    fixResult: await projectEvidence('doctor-fix-result-last-run.json'),
    analyze: await projectEvidence('analyze-last-run.json'),
    readiness: await projectEvidence('release-readiness-last-run.json'),
  };
}

async function buildProjectModel(
  workspacePath: string,
  projectPath: string,
  options: Required<
    Pick<BuildWorkspaceModelOptions, 'includeAbsolutePaths' | 'includeEvidence'>
  > & {
    contractProject?: WorkspaceContract['projects'][number];
  }
): Promise<WorkspaceModelProject> {
  const projectJson = readRapidkitProjectJson(projectPath);
  const detection = detectBackendFrameworkFromProject(projectPath, projectJson);
  const capabilities = resolveProjectCommandCapabilities(projectPath);
  const runtimeSupport = getRuntimeSupport(detection.runtime);
  const kind = await inferWorkspaceProjectKind(projectPath, projectJson);
  const projectName = options.contractProject?.slug
    ? options.contractProject.slug
    : typeof projectJson?.name === 'string' && projectJson.name.trim()
      ? projectJson.name.trim()
      : path.basename(projectPath);
  const kit =
    typeof projectJson?.kit_name === 'string'
      ? projectJson.kit_name
      : typeof projectJson?.kit === 'string'
        ? projectJson.kit
        : options.contractProject?.kit;
  const engine =
    typeof projectJson?.engine === 'string'
      ? projectJson.engine
      : capabilities.engine !== 'unknown'
        ? capabilities.engine
        : undefined;
  const generator = resolveGeneratorIdentity(projectJson, kit, detection.displayName);
  const createCapability = resolveCreatePlannerCapability({
    kitId: kit,
    framework: detection.key,
    runtime: detection.runtime,
  });
  const relativeProjectPath = path.relative(workspacePath, projectPath);
  const isExternalProject =
    relativeProjectPath === '..' || relativeProjectPath.startsWith(`..${path.sep}`);
  const detectedRuntimeCandidates = isExternalProject
    ? detectNestedRuntimeCandidatesFromProject(projectPath)
    : detectRuntimeCandidatesFromProject(projectPath);
  const runtimeCandidates = [
    detection.runtime,
    ...detectedRuntimeCandidates.filter((runtime) => runtime !== detection.runtime),
  ];

  return {
    name: projectName,
    path: toPosixRelative(workspacePath, projectPath),
    ...(options.includeAbsolutePaths ? { absolutePath: projectPath } : {}),
    kind,
    category: categorizeWorkspaceProjectKind(kind),
    runtime: detection.runtime,
    runtimeCandidates,
    framework: detection.key,
    frameworkDisplayName: detection.displayName,
    confidence: detection.confidence,
    detectionSource: detection.source,
    supportTier: detection.supportTier,
    runtimeSupportTier: runtimeSupport.tier,
    runtimeDoctorSupport: runtimeSupport.doctorSupport,
    moduleSupport: capabilities.moduleSupport,
    ...(kit ? { kit } : {}),
    ...(engine ? { engine } : {}),
    ...(generator ? { generator } : {}),
    createCapability,
    commands: {
      supported: capabilities.supportedCommands,
      unsupported: capabilities.unsupportedCommands,
      global: capabilities.globalCommands,
      fleetStages: capabilities.fleetStages,
      localOnly: capabilities.localOnlyCommands,
      map: capabilities.commandMap,
    },
    importantFiles: await collectImportantFiles(projectPath),
    evidence: await projectEvidenceRefs(workspacePath, projectPath, options.includeEvidence),
    provenance: {
      path: options.contractProject
        ? 'workspace contract declaration reconciled with filesystem discovery'
        : 'filesystem discovery',
      runtime: detection.source,
      framework: detection.source,
      commands: 'project command capability matrix',
      createCapability: 'create planner capability contract',
      evidence: 'project .workspai/reports',
    },
  };
}

async function readWorkspaceJson(workspacePath: string): Promise<Record<string, unknown> | null> {
  for (const candidate of workspaceMetadataCandidates(workspacePath, 'workspace.json')) {
    const value = await readJsonIfExists(candidate);
    if (value) {
      return value;
    }
  }
  return null;
}

function inferWorkspaceType(projects: WorkspaceModelProject[]): string {
  if (projects.length === 0) {
    return 'empty-workspace';
  }
  const categories = new Set(projects.map((project) => project.category));
  if (categories.size > 1) {
    return 'polyglot-product-workspace';
  }
  if (categories.has('frontend') && projects.length > 1) {
    return 'full-stack-workspace';
  }
  if (categories.has('frontend')) {
    return 'frontend-workspace';
  }
  if (categories.has('desktop')) {
    return 'desktop-application-workspace';
  }
  if (categories.has('extension')) {
    return 'extension-workspace';
  }
  if (categories.has('library')) {
    return 'library-workspace';
  }
  if (projects.length > 1) {
    return 'backend-platform';
  }
  return 'backend-workspace';
}

function inferBusinessCapabilities(projects: WorkspaceModelProject[]): string[] {
  const capabilityHints = new Set<string>();
  for (const project of projects) {
    const normalized = `${project.name} ${project.path}`.toLowerCase();
    for (const capability of [
      'auth',
      'billing',
      'payment',
      'notification',
      'order',
      'admin',
      'report',
      'search',
      'analytics',
    ]) {
      if (normalized.includes(capability)) {
        capabilityHints.add(capability);
      }
    }
  }
  return Array.from(capabilityHints).sort();
}

function issue(
  severity: WorkspaceModelValidationSeverity,
  code: string,
  message: string,
  target: string
): WorkspaceModelValidationIssue {
  return { severity, code, message, target };
}

function validateWorkspaceModel(
  model: Omit<WorkspaceModel, 'validation'>
): WorkspaceModelValidationResult {
  const issues: WorkspaceModelValidationIssue[] = [];

  if (!model.workspace.name.trim()) {
    issues.push(
      issue('error', 'workspace.name.missing', 'Workspace name could not be resolved.', 'workspace')
    );
  }

  if (model.workspace.type === 'observed-workspace') {
    issues.push(
      issue(
        'warning',
        'workspace.marker.missing',
        'Workspace marker is missing; model is based on filesystem observation.',
        'workspace.marker'
      )
    );
  }

  if (model.summary.projectCount === 0) {
    issues.push(
      issue(
        'warning',
        'workspace.projects.empty',
        'No project roots were detected in this workspace.',
        'projects'
      )
    );
  }

  if (!model.contracts.exists) {
    issues.push(
      issue(
        'warning',
        'workspace.contract.missing',
        'Workspace contract is missing; dependency and API edges may be incomplete.',
        model.contracts.workspaceContractPath
      )
    );
  }

  const seenProjectNames = new Map<string, WorkspaceModelProject[]>();
  for (const project of model.projects) {
    const key = project.name.toLowerCase();
    const bucket = seenProjectNames.get(key) ?? [];
    bucket.push(project);
    seenProjectNames.set(key, bucket);

    if (!project.importantFiles.length) {
      issues.push(
        issue(
          'warning',
          'project.markers.missing',
          `Project ${project.name} has no important manifest files recorded.`,
          project.path
        )
      );
    }

    const projectRoot = path.isAbsolute(project.path)
      ? project.path
      : path.resolve(model.workspace.root, project.path);
    if (!fsExtra.existsSync(projectRoot)) {
      issues.push(
        issue(
          'warning',
          'project.path.missing',
          `Registered project ${project.name} is not available at its declared path.`,
          project.path
        )
      );
    }

    if (project.runtime === 'unknown') {
      issues.push(
        issue(
          'warning',
          'project.runtime.unknown',
          `Project ${project.name} runtime could not be confidently detected.`,
          project.path
        )
      );
    }

    const advertisedCommands = ['test', 'build'];
    for (const commandName of advertisedCommands) {
      if (
        project.commands.supported.includes(commandName) &&
        project.commands.unsupported.includes(commandName)
      ) {
        issues.push(
          issue(
            'error',
            'project.commands.conflict',
            `Project ${project.name} marks ${commandName} as both supported and unsupported.`,
            project.path
          )
        );
      }
    }

    const fleetStageSet = new Set<string>(project.commands.fleetStages);
    const localOnlySet = new Set<string>(project.commands.localOnly);
    for (const commandName of project.commands.fleetStages) {
      if (localOnlySet.has(commandName)) {
        issues.push(
          issue(
            'error',
            'project.commands.scope-conflict',
            `Project ${project.name} marks ${commandName} as both fleet and local-only.`,
            project.path
          )
        );
      }

      const capability = project.commands.map[commandName];
      if (
        !capability ||
        capability.status !== 'supported' ||
        capability.fleetEligible !== true ||
        capability.executionScope !== 'fleet'
      ) {
        issues.push(
          issue(
            'error',
            'project.commands.fleet-stage-invalid',
            `Project ${project.name} advertises ${commandName} as a fleet stage without a supported fleet capability.`,
            project.path
          )
        );
      }
    }

    for (const commandName of project.commands.localOnly) {
      const capability = project.commands.map[commandName];
      if (
        !capability ||
        capability.status !== 'supported' ||
        capability.executionScope !== 'local-only' ||
        capability.fleetEligible === true
      ) {
        issues.push(
          issue(
            'error',
            'project.commands.local-only-invalid',
            `Project ${project.name} advertises ${commandName} as local-only without a matching local-only capability.`,
            project.path
          )
        );
      }
    }

    for (const capability of Object.values(project.commands.map)) {
      if (capability.status !== 'supported') {
        continue;
      }
      if (capability.fleetEligible === true && !fleetStageSet.has(capability.command)) {
        issues.push(
          issue(
            'error',
            'project.commands.fleet-stage-missing',
            `Project ${project.name} capability ${capability.command} is fleet-eligible but missing from fleetStages.`,
            project.path
          )
        );
      }
      if (
        capability.executionScope === 'local-only' &&
        capability.fleetEligible !== true &&
        !localOnlySet.has(capability.command)
      ) {
        issues.push(
          issue(
            'error',
            'project.commands.local-only-missing',
            `Project ${project.name} capability ${capability.command} is local-only but missing from localOnly commands.`,
            project.path
          )
        );
      }
    }
  }

  for (const [name, projects] of seenProjectNames.entries()) {
    if (projects.length > 1) {
      issues.push(
        issue(
          'error',
          'project.name.duplicate',
          `Project name "${name}" is ambiguous across ${projects.length} project roots.`,
          projects.map((project) => project.path).join(', ')
        )
      );
    }
  }
  if (
    model.projectTopology &&
    model.graph &&
    hashCanonicalJson({ ...model.projectTopology, generatedAt: '<ignored>' }) !==
      hashCanonicalJson({ ...model.graph, generatedAt: '<ignored>' })
  ) {
    issues.push(
      issue(
        'error',
        'workspace.project-topology.alias-mismatch',
        'Deprecated model.graph must remain structurally identical to canonical model.projectTopology during the v1 migration window.',
        'projectTopology'
      )
    );
  }

  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return {
    status: errors > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed',
    errors,
    warnings,
    issues,
  };
}

export function validateWorkspaceModelStrict(
  model: WorkspaceModel
): WorkspaceModelValidationResult {
  return validateWorkspaceModel(model);
}

function modelFactSourcePath(pathParts: string[]): string {
  return pathParts.join('.');
}

export function buildWorkspaceModelFacts(model: WorkspaceModel, now: Date): WorkspaceFact[] {
  const sourceArtifact = WORKSPACE_MODEL_REPORT_PATH;
  const generatedAt = model.generatedAt;
  const facts: WorkspaceFact[] = [
    buildWorkspaceFact({
      id: 'workspace.name',
      label: 'Workspace name',
      scope: 'workspace',
      value: model.workspace.name,
      freshness: {
        kind: 'durable',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['workspace', 'name']),
        reason: 'Workspace identity is structural metadata and changes through workspace setup.',
      },
    }),
    buildWorkspaceFact({
      id: 'workspace.type',
      label: 'Workspace type',
      scope: 'workspace',
      value: model.identity.workspaceType,
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['identity', 'workspaceType']),
        reason: 'Workspace type is derived from the current project inventory.',
      },
    }),
    buildWorkspaceFact({
      id: 'workspace.projectCount',
      label: 'Project count',
      scope: 'workspace',
      value: model.summary.projectCount,
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['summary', 'projectCount']),
        reason:
          'Project count is derived from workspace discovery and should be refreshed after structural changes.',
      },
    }),
    buildWorkspaceFact({
      id: 'workspace.runtimeFamilies',
      label: 'Runtime families',
      scope: 'workspace',
      value: model.identity.runtimeFamilies,
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['identity', 'runtimeFamilies']),
        reason: 'Runtime coverage is inferred from project surfaces.',
      },
    }),
    buildWorkspaceFact({
      id: 'workspace.policyMode',
      label: 'Workspace policy mode',
      scope: 'policy',
      value: model.policies.mode,
      freshness: {
        kind: 'durable',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['policies', 'mode']),
        reason: 'Policy mode is configuration, not runtime state.',
      },
    }),
    buildWorkspaceFact({
      id: 'workspace.contract.exists',
      label: 'Workspace contract presence',
      scope: 'contract',
      value: model.contracts.exists,
      freshness: {
        kind: 'derived',
        category: 'structure',
        generatedAt,
        now,
        sourceArtifact,
        sourcePath: modelFactSourcePath(['contracts', 'exists']),
        reason:
          'Contract presence is derived from workspace files and should be refreshed before release gating.',
      },
    }),
  ];

  const projectTopology = workspaceModelProjectTopology(model);
  if (projectTopology) {
    facts.push(
      buildWorkspaceFact({
        id: 'graph.edgeCount',
        label: 'Dependency graph edge count',
        scope: 'graph',
        value: projectTopology.stats.edgeCount,
        freshness: {
          kind: 'derived',
          category: 'structure',
          generatedAt: projectTopology.generatedAt ?? generatedAt,
          now,
          sourceArtifact,
          sourcePath: modelFactSourcePath(['projectTopology', 'stats', 'edgeCount']),
          reason: 'Graph topology is derived from manifests, imports, and workspace contracts.',
        },
      }),
      buildWorkspaceFact({
        id: 'graph.evidenceCoverageRatio',
        label: 'Dependency graph evidence coverage',
        scope: 'graph',
        value: projectTopology.stats.evidenceCoverageRatio,
        freshness: {
          kind: 'derived',
          category: 'structure',
          generatedAt: projectTopology.generatedAt ?? generatedAt,
          now,
          sourceArtifact,
          sourcePath: modelFactSourcePath(['projectTopology', 'stats', 'evidenceCoverageRatio']),
          reason:
            'Graph evidence coverage changes when dependency evidence or contract edges change.',
        },
      })
    );
  }

  for (const [index, project] of model.projects.entries()) {
    const projectSource = `projects[${index}]`;
    const projectFreshness = {
      kind: 'derived' as const,
      category: 'structure' as const,
      generatedAt,
      now,
      sourceArtifact,
      reason:
        'Project facts are derived from workspace discovery, project metadata, and framework probes.',
    };
    facts.push(
      buildWorkspaceFact({
        id: `project.${project.name}.kind`,
        label: `${project.name} kind`,
        scope: 'project',
        project: project.name,
        value: project.kind,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'kind']),
        },
      }),
      buildWorkspaceFact({
        id: `project.${project.name}.category`,
        label: `${project.name} category`,
        scope: 'project',
        project: project.name,
        value: project.category,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'category']),
        },
      }),
      buildWorkspaceFact({
        id: `project.${project.name}.runtime`,
        label: `${project.name} runtime`,
        scope: 'project',
        project: project.name,
        value: project.runtime,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'runtime']),
        },
      }),
      buildWorkspaceFact({
        id: `project.${project.name}.framework`,
        label: `${project.name} framework`,
        scope: 'project',
        project: project.name,
        value: project.frameworkDisplayName,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'frameworkDisplayName']),
        },
      }),
      buildWorkspaceFact({
        id: `project.${project.name}.supportTier`,
        label: `${project.name} support tier`,
        scope: 'project',
        project: project.name,
        value: project.supportTier,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'supportTier']),
        },
      }),
      buildWorkspaceFact({
        id: `project.${project.name}.safeFleetStages`,
        label: `${project.name} safe fleet stages`,
        scope: 'command',
        project: project.name,
        value: project.commands.fleetStages,
        freshness: {
          ...projectFreshness,
          sourcePath: modelFactSourcePath([projectSource, 'commands', 'fleetStages']),
          reason: 'Safe command availability is derived from package and project command surfaces.',
        },
      })
    );

    for (const [key, ref] of Object.entries(project.evidence)) {
      facts.push(
        buildWorkspaceFact({
          id: `project.${project.name}.evidence.${key}`,
          label: `${project.name} ${key} evidence`,
          scope: 'evidence',
          project: project.name,
          value: ref
            ? { path: ref.path, exists: ref.exists, status: ref.status ?? null }
            : { exists: false },
          freshness: {
            kind: ref?.exists ? 'evidence-backed' : 'verify-before-use',
            category: 'verification',
            generatedAt: ref?.generatedAt ?? generatedAt,
            now,
            status: ref?.exists ? undefined : 'unknown',
            sourceArtifact: ref?.path ?? sourceArtifact,
            sourcePath: modelFactSourcePath([projectSource, 'evidence', key]),
            verifyBeforeUse: true,
            reason: ref?.exists
              ? 'Evidence reports can expire or become stale after source changes.'
              : 'Missing evidence must be generated before this fact is used for verification.',
          },
        })
      );
    }
  }

  for (const [key, ref] of Object.entries(model.evidence)) {
    facts.push(
      buildWorkspaceFact({
        id: `workspace.evidence.${key}`,
        label: `Workspace ${key} evidence`,
        scope: 'evidence',
        value: ref ? { path: ref.path, exists: ref.exists, status: ref.status ?? null } : null,
        freshness: {
          kind: ref?.exists ? 'evidence-backed' : 'verify-before-use',
          category: 'verification',
          generatedAt: ref?.generatedAt ?? generatedAt,
          now,
          status: ref?.exists ? undefined : 'unknown',
          sourceArtifact: ref?.path ?? sourceArtifact,
          sourcePath: modelFactSourcePath(['evidence', key]),
          verifyBeforeUse: true,
          reason: ref?.exists
            ? 'Workspace evidence can expire or become stale after project, dependency, or policy changes.'
            : 'Missing workspace evidence must be generated before release or repair decisions.',
        },
      })
    );
  }

  return facts;
}

export async function buildWorkspaceModel(
  input: BuildWorkspaceModelOptions
): Promise<WorkspaceModel> {
  const workspacePath = path.resolve(input.workspacePath);
  const includeAbsolutePaths = input.includeAbsolutePaths === true;
  const includeEvidence = input.includeEvidence === true;
  const observableScanDepth = resolveObservableScanDepth(input.observableScanDepth);
  const now = input.now ?? new Date();
  const [
    marker,
    workspaceJson,
    workspaceContract,
    importedProjects,
    rapidkitProjectPaths,
    observableProjectPaths,
  ] = await Promise.all([
    readWorkspaceMarker(workspacePath),
    readWorkspaceJson(workspacePath),
    loadWorkspaceContractSafely(workspacePath),
    readImportedProjectsRegistry(workspacePath),
    discoverWorkspaceProjects(workspacePath, { descendIntoMatchedProjects: false }),
    discoverObservableProjectRoots(workspacePath, observableScanDepth),
  ]);

  const contractProjectPaths = new Map<string, WorkspaceContract['projects'][number]>();
  for (const project of workspaceContract?.projects ?? []) {
    const projectPath = project.externalPath
      ? path.resolve(project.externalPath)
      : path.resolve(workspacePath, project.relativePath);
    contractProjectPaths.set(projectPath, project);
  }
  const projectPaths = collectUniquePaths([
    ...rapidkitProjectPaths,
    ...observableProjectPaths,
    ...contractProjectPaths.keys(),
    ...importedProjects.map((project) =>
      path.isAbsolute(project.path) ? project.path : path.join(workspacePath, project.path)
    ),
  ]);
  const reuseProjectModels = input.reuseProjectModels;
  const projects = await Promise.all(
    projectPaths.map((projectPath) => {
      if (reuseProjectModels) {
        const rel = path
          .relative(workspacePath, path.resolve(projectPath))
          .split(path.sep)
          .join('/');
        const cached = reuseProjectModels.get(rel);
        if (cached) {
          return Promise.resolve(cached);
        }
      }
      return buildProjectModel(workspacePath, projectPath, {
        includeAbsolutePaths,
        includeEvidence,
        contractProject: contractProjectPaths.get(path.resolve(projectPath)),
      });
    })
  );

  const workspaceName =
    typeof workspaceJson?.workspace_name === 'string'
      ? workspaceJson.workspace_name
      : typeof workspaceJson?.name === 'string'
        ? workspaceJson.name
        : marker?.name || workspaceContract?.workspace.name || path.basename(workspacePath);
  const workspaceProfile =
    typeof workspaceJson?.profile === 'string'
      ? workspaceJson.profile
      : typeof workspaceJson?.mode === 'string'
        ? workspaceJson.mode
        : workspaceContract?.workspace.profile;
  const surfaces = Array.from(new Set(projects.map((project) => project.kind))).sort();
  const categories = Array.from(new Set(projects.map((project) => project.category))).sort();
  const runtimeFamilies = Array.from(
    new Set(
      projects.flatMap((project) =>
        project.runtimeCandidates.length > 0 ? project.runtimeCandidates : [project.runtime]
      )
    )
  ).sort();
  const frameworks = Array.from(new Set(projects.map((project) => project.framework))).sort();
  const policiesSource = [
    '.workspai/policies.yml',
    '.workspai/policies.yaml',
    '.rapidkit/policies.yml',
    '.rapidkit/policies.yaml',
  ].find((candidate) => fsExtra.existsSync(path.join(workspacePath, candidate)));
  const contractPath =
    workspaceMetadataCandidates(workspacePath, 'workspace.contract.json')
      .map((candidate) => path.relative(workspacePath, candidate).split(path.sep).join('/'))
      .find((candidate) => fsExtra.existsSync(path.join(workspacePath, candidate))) ??
    '.workspai/workspace.contract.json';
  const contractExists = await fsExtra.pathExists(path.join(workspacePath, contractPath));

  const model: Omit<WorkspaceModel, 'validation'> = {
    schemaVersion: WORKSPACE_MODEL_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    workspace: {
      name: workspaceName,
      root: workspacePath,
      ...(workspaceProfile ? { profile: workspaceProfile } : {}),
      type: marker ? 'rapidkit-workspace' : 'observed-workspace',
      ...(marker
        ? {
            marker: {
              createdBy: marker.createdBy,
              version: marker.version,
              createdAt: marker.createdAt,
            },
          }
        : {}),
    },
    identity: {
      workspaceType: inferWorkspaceType(projects),
      surfaces,
      categories,
      runtimeFamilies,
      businessCapabilities: inferBusinessCapabilities(projects),
    },
    discovery: {
      observableScanDepth,
    },
    projects,
    policies: {
      mode:
        typeof workspaceJson?.policy_mode === 'string'
          ? workspaceJson.policy_mode
          : typeof workspaceJson?.policyMode === 'string'
            ? workspaceJson.policyMode
            : 'warn',
      source: policiesSource ?? null,
      exists: Boolean(policiesSource),
    },
    contracts: {
      workspaceContractPath: contractPath,
      exists: contractExists,
      status: contractExists ? 'known' : 'missing',
    },
    evidence: {
      doctor: await evidenceRef(
        workspacePath,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor,
        includeEvidence
      ),
      projectDoctor: await evidenceRef(
        workspacePath,
        '.workspai/reports/doctor-project-last-run.json',
        includeEvidence
      ),
      doctorRemediationPlan: await evidenceRef(
        workspacePath,
        '.workspai/reports/doctor-remediation-plan-last-run.json',
        includeEvidence
      ),
      artifactRemediationPlan: await evidenceRef(
        workspacePath,
        '.workspai/reports/artifact-remediation-plan-last-run.json',
        includeEvidence
      ),
      doctorFixResult: await evidenceRef(
        workspacePath,
        '.workspai/reports/doctor-fix-result-last-run.json',
        includeEvidence
      ),
      analyze: await evidenceRef(
        workspacePath,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
        includeEvidence
      ),
      readiness: await evidenceRef(
        workspacePath,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness,
        includeEvidence
      ),
      pipeline: await evidenceRef(
        workspacePath,
        '.workspai/reports/pipeline-last-run.json',
        includeEvidence
      ),
    },
    summary: {
      projectCount: projects.length,
      runtimes: runtimeFamilies,
      frameworks,
      firstClassProjects: projects.filter((project) => project.supportTier === 'first-class')
        .length,
      observedProjects: projects.filter((project) => project.supportTier === 'observed').length,
    },
  };
  const graph = await inferModelDependencyGraph(workspacePath, model as WorkspaceModel, {
    contractExists,
    now,
    incrementalGraph: input.incrementalGraph,
  });
  const modelWithGraph: Omit<WorkspaceModel, 'validation'> = {
    ...model,
    projectTopology: graph,
    graph,
  };

  const validation = validateWorkspaceModel(modelWithGraph);
  const facts = buildWorkspaceModelFacts({ ...modelWithGraph, validation }, now);
  const factFreshness = summarizeFactFreshness({
    facts,
    generatedAt: now.toISOString(),
    now,
  });
  return {
    ...modelWithGraph,
    facts,
    factFreshness,
    validation,
  };
}

/**
 * Build the workspace model with the opt-in `inputsHash` cache (1.15). On a cache
 * hit the stored model is returned byte-for-byte (skipping the expensive
 * per-project + graph-inference rebuild); on a miss the freshly built model is
 * persisted. When `cache` is not requested this delegates straight to
 * `buildWorkspaceModel` and reports `disabled`.
 */
export async function buildWorkspaceModelCached(
  input: BuildWorkspaceModelOptions
): Promise<{ model: WorkspaceModel; cache: WorkspaceModelCacheStatus }> {
  if (input.cache !== true) {
    return { model: await buildWorkspaceModel(input), cache: 'disabled' };
  }

  const workspacePath = path.resolve(input.workspacePath);
  const observableScanDepth = resolveObservableScanDepth(input.observableScanDepth);
  const cliVersion = getRapidkitCliVersion();

  const [marker, workspaceJson, importedProjects, rapidkitProjectPaths, observableProjectPaths] =
    await Promise.all([
      readWorkspaceMarker(workspacePath),
      readWorkspaceJson(workspacePath),
      readImportedProjectsRegistry(workspacePath),
      discoverWorkspaceProjects(workspacePath, { descendIntoMatchedProjects: false }),
      discoverObservableProjectRoots(workspacePath, observableScanDepth),
    ]);
  const projectPaths = collectUniquePaths([
    ...rapidkitProjectPaths,
    ...observableProjectPaths,
    ...importedProjects.map((project) =>
      path.isAbsolute(project.path) ? project.path : path.join(workspacePath, project.path)
    ),
  ]);

  const inputsHash = await computeModelInputsHash({
    workspacePath,
    cliVersion,
    flags: {
      includeAbsolutePaths: input.includeAbsolutePaths === true,
      includeEvidence: input.includeEvidence === true,
      observableScanDepth,
    },
    projectPaths,
    workspaceJson,
    marker,
  });

  const cached = await readWorkspaceModelCache(workspacePath);
  if (
    cached &&
    cached.cliVersion === cliVersion &&
    cached.inputsHash === inputsHash &&
    hasCanonicalWorkspaceModelTopology(cached.model)
  ) {
    return { model: cached.model, cache: 'hit' };
  }

  const model = await buildWorkspaceModel({ ...input, cache: false });
  const [projectSignatures, workspaceFileSignatures] = await Promise.all([
    computeProjectSignatures(workspacePath, projectPaths),
    computeWorkspaceFileSignatures(workspacePath),
  ]);
  await writeWorkspaceModelCache(workspacePath, {
    cliVersion,
    inputsHash,
    generatedAt: (input.now ?? new Date()).toISOString(),
    model,
    projectSignatures,
    workspaceFileSignatures,
  });
  return { model, cache: 'miss' };
}

function diffSignatureMaps(
  previous: Record<string, string>,
  current: Record<string, string>
): { changed: Set<string>; added: Set<string>; removed: Set<string> } {
  const changed = new Set<string>();
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [key, value] of Object.entries(current)) {
    if (!(key in previous)) {
      added.add(key);
    } else if (previous[key] !== value) {
      changed.add(key);
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in current)) {
      removed.add(key);
    }
  }
  return { changed, added, removed };
}

function shallowSignaturesEqual(
  a: Record<string, string> = {},
  b: Record<string, string> = {}
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Graph-aware incremental model build (roadmap 1.16). Reuses cached project
 * models for unchanged projects and re-infers only the dependency-graph edges
 * incident to changed projects. Falls back to a full rebuild when no compatible
 * cache exists or when workspace-level inputs (contract/workspace.json/policies)
 * change. When nothing changed at all the cached model is returned as `unchanged`.
 */
export async function buildWorkspaceModelIncremental(
  input: BuildWorkspaceModelOptions
): Promise<{ model: WorkspaceModel; mode: WorkspaceModelIncrementalMode }> {
  const workspacePath = path.resolve(input.workspacePath);
  const observableScanDepth = resolveObservableScanDepth(input.observableScanDepth);
  const cliVersion = getRapidkitCliVersion();
  const now = input.now ?? new Date();

  const [marker, workspaceJson, importedProjects, rapidkitProjectPaths, observableProjectPaths] =
    await Promise.all([
      readWorkspaceMarker(workspacePath),
      readWorkspaceJson(workspacePath),
      readImportedProjectsRegistry(workspacePath),
      discoverWorkspaceProjects(workspacePath, { descendIntoMatchedProjects: false }),
      discoverObservableProjectRoots(workspacePath, observableScanDepth),
    ]);
  const projectPaths = collectUniquePaths([
    ...rapidkitProjectPaths,
    ...observableProjectPaths,
    ...importedProjects.map((project) =>
      path.isAbsolute(project.path) ? project.path : path.join(workspacePath, project.path)
    ),
  ]);

  const cached = await readWorkspaceModelCache(workspacePath);
  const buildFull = async (): Promise<{ model: WorkspaceModel; mode: 'full' }> => {
    const model = await buildWorkspaceModel({ ...input, cache: false });
    const inputsHash = await computeModelInputsHash({
      workspacePath,
      cliVersion,
      flags: {
        includeAbsolutePaths: input.includeAbsolutePaths === true,
        includeEvidence: input.includeEvidence === true,
        observableScanDepth,
      },
      projectPaths,
      workspaceJson,
      marker,
    });
    const [projectSignatures, workspaceFileSignatures] = await Promise.all([
      computeProjectSignatures(workspacePath, projectPaths),
      computeWorkspaceFileSignatures(workspacePath),
    ]);
    await writeWorkspaceModelCache(workspacePath, {
      cliVersion,
      inputsHash,
      generatedAt: now.toISOString(),
      model,
      projectSignatures,
      workspaceFileSignatures,
    });
    return { model, mode: 'full' };
  };

  const cachedTopology = cached ? workspaceModelProjectTopology(cached.model) : undefined;
  if (
    !cached ||
    cached.cliVersion !== cliVersion ||
    !cached.projectSignatures ||
    !cachedTopology ||
    !hasCanonicalWorkspaceModelTopology(cached.model)
  ) {
    return buildFull();
  }

  const currentWorkspaceSignatures = await computeWorkspaceFileSignatures(workspacePath);
  if (!shallowSignaturesEqual(cached.workspaceFileSignatures, currentWorkspaceSignatures)) {
    // Workspace contract / config changed: affects all projects + graph contract
    // edges, so rebuild fully to stay correct.
    return buildFull();
  }

  const currentProjectSignatures = await computeProjectSignatures(workspacePath, projectPaths);
  const { changed, added, removed } = diffSignatureMaps(
    cached.projectSignatures,
    currentProjectSignatures
  );

  if (changed.size === 0 && added.size === 0 && removed.size === 0) {
    return { model: cached.model, mode: 'unchanged' };
  }

  // Reuse cached project models for projects whose signature is unchanged.
  const changedOrAddedRel = new Set([...changed, ...added]);
  const reuseProjectModels = new Map<string, WorkspaceModelProject>();
  for (const project of cached.model.projects) {
    const rel = project.path.split(path.sep).join('/');
    if (!changedOrAddedRel.has(rel) && !removed.has(rel)) {
      reuseProjectModels.set(rel, project);
    }
  }

  // Names whose outgoing code-import edges must be re-scanned. A renamed changed
  // project (graph node id changes) is treated as a structural change.
  const changedProjectIds = new Set<string>();
  let renameDetected = false;
  for (const project of cached.model.projects) {
    const rel = project.path.split(path.sep).join('/');
    if (changed.has(rel)) {
      changedProjectIds.add(project.name);
    }
  }

  const structuralChange = added.size > 0 || removed.size > 0;

  const model = await buildWorkspaceModel({
    ...input,
    cache: false,
    reuseProjectModels,
    incrementalGraph: {
      previousGraph: cachedTopology,
      changedProjectIds,
      structuralChange: structuralChange || renameDetected,
    },
  });

  // Detect a rename among changed projects (cached name vs rebuilt name); if so,
  // the scoped graph result may be stale, so rebuild fully for correctness.
  for (const project of cached.model.projects) {
    const rel = project.path.split(path.sep).join('/');
    if (!changed.has(rel)) {
      continue;
    }
    const rebuilt = model.projects.find(
      (candidate) => candidate.path.split(path.sep).join('/') === rel
    );
    if (rebuilt && rebuilt.name !== project.name) {
      renameDetected = true;
      break;
    }
  }
  if (renameDetected) {
    return buildFull();
  }

  const inputsHash = await computeModelInputsHash({
    workspacePath,
    cliVersion,
    flags: {
      includeAbsolutePaths: input.includeAbsolutePaths === true,
      includeEvidence: input.includeEvidence === true,
      observableScanDepth,
    },
    projectPaths,
    workspaceJson,
    marker,
  });
  await writeWorkspaceModelCache(workspacePath, {
    cliVersion,
    inputsHash,
    generatedAt: now.toISOString(),
    model,
    projectSignatures: currentProjectSignatures,
    workspaceFileSignatures: currentWorkspaceSignatures,
  });
  return { model, mode: 'incremental' };
}

async function loadWorkspaceContractSafely(
  workspacePath: string
): Promise<WorkspaceContract | null> {
  try {
    const { contract } = await readWorkspaceContract({ workspacePath });
    return contract && typeof contract === 'object' ? contract : null;
  } catch {
    return null;
  }
}

/**
 * Infer the first-class dependency graph for the model. Failures degrade to an
 * empty (but valid) graph so a single bad manifest never breaks model building;
 * the field stays present and deterministic for downstream consumers.
 */
async function inferModelDependencyGraph(
  workspacePath: string,
  model: WorkspaceModel,
  options: {
    contractExists: boolean;
    now: Date;
    incrementalGraph?: BuildWorkspaceModelOptions['incrementalGraph'];
  }
): Promise<WorkspaceDependencyGraph> {
  const contract = options.contractExists ? await loadWorkspaceContractSafely(workspacePath) : null;
  try {
    if (options.incrementalGraph) {
      return await inferWorkspaceDependencyGraphIncremental({
        workspacePath,
        model,
        contract,
        now: options.now,
        previousGraph: options.incrementalGraph.previousGraph,
        changedProjectIds: options.incrementalGraph.changedProjectIds,
        structuralChange: options.incrementalGraph.structuralChange,
      });
    }
    return await inferWorkspaceDependencyGraph({
      workspacePath,
      model,
      contract,
      now: options.now,
    });
  } catch {
    const nodes = model.projects.map((project) => ({ id: project.name, path: project.path }));
    return {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: options.now.toISOString(),
      nodes,
      edges: [],
      stats: {
        nodeCount: nodes.length,
        edgeCount: 0,
        inferredEdges: 0,
        contractEdges: 0,
        manualEdges: 0,
        authoritativeEdges: 0,
        lowConfidenceEdges: 0,
        orphanCount: nodes.length,
        connectedNodeCount: 0,
        density: 0,
        edgeCoverageRatio: nodes.length > 0 ? 0 : 1,
        evidenceCoverageRatio: 1,
        hotspotCount: 0,
        hasCycle: false,
      },
      diagnostics:
        nodes.length > 1
          ? [
              {
                code: 'graph.inference.failed',
                severity: 'warning',
                message:
                  'Dependency graph inference failed; model contains projects but no dependency edges.',
                recommendation:
                  'Run workspace model again after fixing graph inputs, or add workspace contract/manual graph overrides.',
                nodeIds: nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b)),
              },
            ]
          : undefined,
    };
  }
}

export async function writeWorkspaceModel(
  model: WorkspaceModel,
  workspacePath: string
): Promise<string> {
  const contract = model.contracts.exists ? await loadWorkspaceContractSafely(workspacePath) : null;
  const { buildWorkspaceKnowledgeGraph } = await import('./workspace-knowledge-graph.js');
  const persistedModel = attachRunCorrelation(model);
  const knowledgeGraph = await buildWorkspaceKnowledgeGraph({
    workspacePath,
    workspace: {
      name: model.workspace.name,
      ...(model.workspace.profile ? { profile: model.workspace.profile } : {}),
    },
    projects: model.projects.map((project) => ({
      id: project.name,
      path: project.path,
      ...(project.absolutePath ? { absolutePath: project.absolutePath } : {}),
      runtime: project.runtime,
      runtimeCandidates: project.runtimeCandidates,
      framework: project.framework,
      kind: project.kind,
      category: project.category,
      ...(project.kit ? { kit: project.kit } : {}),
    })),
    projectTopology:
      workspaceModelProjectTopology(model) ??
      (await inferModelDependencyGraph(workspacePath, model, {
        contractExists: model.contracts.exists,
        now: new Date(model.generatedAt),
      })),
    contract,
    now: new Date(model.generatedAt),
    source: {
      kind: 'workspace-model',
      artifact: WORKSPACE_MODEL_REPORT_PATH,
      hashAlgorithm: 'sha256',
      hash: hashWorkspaceModel(persistedModel),
    },
  });
  const [, modelPath] = await writeWorkspaceArtifactJsonSet(
    workspacePath,
    WORKSPACE_MODEL_REPORT_PATH,
    [
      { relativePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph, payload: knowledgeGraph },
      { relativePath: WORKSPACE_MODEL_REPORT_PATH, payload: persistedModel },
    ]
  );
  return modelPath;
}
