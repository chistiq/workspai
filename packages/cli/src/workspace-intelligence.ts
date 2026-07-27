import path from 'path';

import fsExtra from 'fs-extra';

import {
  buildWorkspaceModel,
  workspaceModelProjectTopology,
  WORKSPACE_MODEL_SCHEMA_VERSION,
  WORKSPACE_MODEL_REPORT_PATH,
  type BuildWorkspaceModelOptions,
  type WorkspaceModel,
  type WorkspaceModelProject,
} from './workspace-model.js';
import {
  collectGitWorkingTreeObservation,
  type GitWorkingTreeObservation,
} from './workspace-git-observation.js';
import { attachRunCorrelation } from './observability/run-correlation.js';
import { transitiveDependents } from './workspace-graph-traversal.js';
import { computeGraphCentrality } from './workspace-graph-centrality.js';
import type { WorkspaceGraphEdgeKind } from './contracts/workspace-dependency-graph-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { writeWorkspaceArtifactJson } from './utils/artifact-path-compat.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
export { hashWorkspaceModel } from './workspace-model-hash.js';
import {
  hashLegacyWorkspaceModelV1,
  hashWorkspaceModel,
  stableStringify,
} from './workspace-model-hash.js';

export const WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.snapshot;
export const WORKSPACE_MODEL_DIFF_SCHEMA_VERSION = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.diff;
export const WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot;
export const WORKSPACE_MODEL_DIFF_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.diff;
export const WORKSPACE_IMPACT_SCHEMA_VERSION = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.impact;
export const WORKSPACE_IMPACT_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.impact;

export type WorkspaceModelSnapshot = {
  schemaVersion: typeof WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  modelHash: string;
  modelRef: string;
  model: WorkspaceModel;
};

export function migrateLegacyWorkspaceModelSnapshot(
  snapshot: WorkspaceModelSnapshot
): WorkspaceModelSnapshot | null {
  if (
    snapshot.model.projectTopology ||
    !snapshot.model.graph ||
    snapshot.modelHash !== hashLegacyWorkspaceModelV1(snapshot.model)
  ) {
    return null;
  }
  const model: WorkspaceModel = {
    ...snapshot.model,
    projectTopology: snapshot.model.graph,
    graph: snapshot.model.graph,
  };
  return {
    ...snapshot,
    modelHash: hashWorkspaceModel(model),
    model,
  };
}

export type WorkspaceModelDiffChangeType =
  | 'project.added'
  | 'project.removed'
  | 'project.changed'
  | 'workspace.changed'
  | 'validation.changed'
  | 'git.file.changed'
  | 'git.untracked'
  | 'git.deleted';

export type WorkspaceModelDiffChange = {
  type: WorkspaceModelDiffChangeType;
  severity: 'info' | 'warning' | 'critical';
  target: string;
  message: string;
  before?: unknown;
  after?: unknown;
};

export type WorkspaceModelDiffGitSummary = {
  available: boolean;
  ref?: string;
  branch?: string;
  commit?: string;
  dirty: boolean;
  changedFiles: number;
  untrackedFiles: number;
  deletedFiles: number;
};

export type WorkspaceModelDiff = {
  schemaVersion: typeof WORKSPACE_MODEL_DIFF_SCHEMA_VERSION;
  generatedAt: string;
  fromRef: string;
  toRef: string;
  fromHash: string;
  toHash: string;
  summary: {
    changed: boolean;
    addedProjects: number;
    removedProjects: number;
    changedProjects: number;
    workspaceChanges: number;
    validationChanges: number;
    gitChangedFiles: number;
  };
  git?: WorkspaceModelDiffGitSummary;
  changes: WorkspaceModelDiffChange[];
  currentModel: WorkspaceModel;
};

export type WorkspaceImpactRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type WorkspaceImpactCommand = {
  id: string;
  label: string;
  scope: 'workspace' | 'project';
  project?: string;
  display: string;
  execute: string;
  required: boolean;
};

export type WorkspaceImpactItem = {
  id: string;
  scope: 'workspace' | 'project';
  target: string;
  title: string;
  summary: string;
  risk: WorkspaceImpactRisk;
  reasons: string[];
  project?: Pick<
    WorkspaceModelProject,
    'name' | 'path' | 'kind' | 'runtime' | 'framework' | 'supportTier' | 'generator'
  >;
  verification: WorkspaceImpactCommand[];
  /**
   * Graph-aware blast-radius metadata (additive, 1.10). `direct` items changed
   * themselves; `transitive` items are reached through the dependency graph.
   */
  origin?: 'direct' | 'transitive';
  /** Hops from the nearest directly-changed project (direct items are 0). */
  distance?: number;
  /** Shortest dependency path from a changed origin to this project (ids). */
  path?: string[];
  /** Edge kind on the hop that pulled this project into the blast radius. */
  via?: WorkspaceGraphEdgeKind | null;
  /** Graph centrality of this project (additive, 1.12). */
  centrality?: WorkspaceImpactCentrality;
};

export type WorkspaceImpactCentrality = {
  fanIn: number;
  fanOut: number;
  reach: number;
  betweenness: number;
  isHotspot: boolean;
};

export type WorkspaceImpactHotspot = {
  project: string;
  fanIn: number;
  fanOut: number;
  reach: number;
  betweenness: number;
};

export type WorkspaceImpact = {
  schemaVersion: typeof WORKSPACE_IMPACT_SCHEMA_VERSION;
  generatedAt: string;
  fromRef: string;
  diffRef: string;
  workspace: Pick<WorkspaceModel['workspace'], 'name' | 'profile' | 'type'>;
  summary: {
    changed: boolean;
    risk: WorkspaceImpactRisk;
    affectedProjects: number;
    workspaceItems: number;
    recommendedCommands: number;
    /** Graph-aware blast-radius summary (additive, 1.10). */
    blastRadius: {
      directlyAffected: number;
      transitivelyAffected: number;
      maxDistance: number;
      graphEdges: number;
    };
  };
  affectedProjects: WorkspaceImpactItem[];
  /** Projects pulled in only through the dependency graph (additive, 1.10). */
  transitiveImpact: WorkspaceImpactItem[];
  /** High-centrality projects on critical paths (additive, 1.12). */
  criticalPathHotspots: WorkspaceImpactHotspot[];
  workspaceImpact: WorkspaceImpactItem[];
  verificationPlan: WorkspaceImpactCommand[];
  agentBrief: {
    headline: string;
    bullets: string[];
    unsafeAssumptions: string[];
  };
  diff: WorkspaceModelDiff;
};

export type BuildWorkspaceModelSnapshotOptions = Pick<
  BuildWorkspaceModelOptions,
  'workspacePath' | 'includeAbsolutePaths' | 'includeEvidence' | 'observableScanDepth' | 'now'
> & {
  model?: WorkspaceModel;
};

export type DiffWorkspaceModelOptions = Pick<
  BuildWorkspaceModelOptions,
  'workspacePath' | 'includeAbsolutePaths' | 'includeEvidence' | 'observableScanDepth' | 'now'
> & {
  fromPath: string;
  model?: WorkspaceModel;
  includeGitObservation?: boolean;
  gitObservation?: GitWorkingTreeObservation;
};

export function isGitDiffSource(fromPath: string): boolean {
  const normalized = fromPath.trim().toLowerCase();
  return normalized === 'git' || normalized.startsWith('git:');
}

export function parseGitDiffRef(fromPath: string): string {
  const normalized = fromPath.trim();
  if (normalized.toLowerCase() === 'git') {
    return 'HEAD';
  }
  if (normalized.toLowerCase().startsWith('git:')) {
    return normalized.slice('git:'.length).trim() || 'HEAD';
  }
  return 'HEAD';
}

export type BuildWorkspaceImpactOptions = DiffWorkspaceModelOptions & {
  scope?: string;
  diff?: WorkspaceModelDiff;
};

function resolveWorkspaceRelativePath(workspacePath: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
}

async function readModelFromPath(
  filePath: string
): Promise<{ model: WorkspaceModel; hash: string }> {
  const payload = (await fsExtra.readJson(filePath)) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Workspace model input is not a JSON object: ${filePath}`);
  }

  const record = payload as Record<string, unknown>;
  if (record.schemaVersion === WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION) {
    assertJsonSchemaContract(
      payload,
      'contracts/workspace-intelligence/workspace-model-snapshot.v1.json',
      `Workspace model snapshot ${filePath}`
    );
    const snapshot = record as WorkspaceModelSnapshot;
    if (!snapshot.model || snapshot.model.schemaVersion !== WORKSPACE_MODEL_SCHEMA_VERSION) {
      throw new Error(`Invalid workspace model snapshot: ${filePath}`);
    }
    const computedHash = hashWorkspaceModel(snapshot.model);
    if (snapshot.modelHash !== computedHash) {
      const migrated = migrateLegacyWorkspaceModelSnapshot(snapshot);
      if (!migrated) {
        throw new Error(`Workspace model snapshot hash mismatch: ${filePath}`);
      }
      return { model: migrated.model, hash: migrated.modelHash };
    }
    return { model: snapshot.model, hash: snapshot.modelHash };
  }

  if (record.schemaVersion === WORKSPACE_MODEL_SCHEMA_VERSION) {
    assertJsonSchemaContract(
      payload,
      'contracts/workspace-intelligence/workspace-model.v1.json',
      `Workspace model ${filePath}`
    );
    const model = record as WorkspaceModel;
    return { model, hash: hashWorkspaceModel(model) };
  }

  if (record.schemaVersion === WORKSPACE_MODEL_DIFF_SCHEMA_VERSION) {
    throw new Error(
      `workspace diff --from received a diff report (${path.basename(filePath)}). Use a workspace model snapshot or model report as baseline, e.g. ${WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH}. To analyze an existing diff report, run: npx workspai workspace impact --from ${path.basename(filePath)} --json`
    );
  }

  throw new Error(`Unsupported workspace model input schema: ${String(record.schemaVersion)}`);
}

async function readDiffFromPath(filePath: string): Promise<WorkspaceModelDiff | null> {
  const payload = (await fsExtra.readJson(filePath)) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Workspace diff input is not a JSON object: ${filePath}`);
  }

  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== WORKSPACE_MODEL_DIFF_SCHEMA_VERSION) {
    return null;
  }

  assertJsonSchemaContract(
    payload,
    'contracts/workspace-intelligence/workspace-model-diff.v1.json',
    `Workspace model diff ${filePath}`
  );

  const diff = record as WorkspaceModelDiff;
  if (
    !diff.currentModel ||
    diff.currentModel.schemaVersion !== WORKSPACE_MODEL_SCHEMA_VERSION ||
    !diff.summary ||
    !Array.isArray(diff.changes)
  ) {
    throw new Error(`Invalid workspace model diff report: ${filePath}`);
  }
  if (diff.toHash !== hashWorkspaceModel(diff.currentModel)) {
    throw new Error(`Workspace model diff current-model hash mismatch: ${filePath}`);
  }
  return diff;
}

export async function buildWorkspaceModelSnapshot(
  options: BuildWorkspaceModelSnapshotOptions
): Promise<WorkspaceModelSnapshot> {
  const model =
    options.model ??
    (await buildWorkspaceModel({
      workspacePath: options.workspacePath,
      includeAbsolutePaths: options.includeAbsolutePaths,
      includeEvidence: options.includeEvidence,
      observableScanDepth: options.observableScanDepth,
      now: options.now,
    }));

  return {
    schemaVersion: WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    modelHash: hashWorkspaceModel(model),
    modelRef: WORKSPACE_MODEL_REPORT_PATH,
    model,
  };
}

export async function writeWorkspaceModelSnapshot(
  snapshot: WorkspaceModelSnapshot,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
    attachRunCorrelation(snapshot)
  );
}

function projectSignature(project: WorkspaceModelProject): Record<string, unknown> {
  return {
    name: project.name,
    path: project.path,
    kind: project.kind,
    runtime: project.runtime,
    framework: project.framework,
    generator: project.generator,
    supportTier: project.supportTier,
    commands: project.commands,
    importantFiles: project.importantFiles,
  };
}

function addChange(changes: WorkspaceModelDiffChange[], change: WorkspaceModelDiffChange): void {
  changes.push(change);
}

function compareWorkspace(
  before: WorkspaceModel,
  after: WorkspaceModel
): WorkspaceModelDiffChange[] {
  const changes: WorkspaceModelDiffChange[] = [];
  const workspaceFields: Array<keyof WorkspaceModel['workspace']> = ['name', 'profile', 'type'];
  const identityFields: Array<keyof WorkspaceModel['identity']> = [
    'workspaceType',
    'surfaces',
    'runtimeFamilies',
    'businessCapabilities',
  ];

  for (const field of workspaceFields) {
    const beforeValue = before.workspace[field];
    const afterValue = after.workspace[field];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      addChange(changes, {
        type: 'workspace.changed',
        severity: 'info',
        target: `workspace.${field}`,
        message: `Workspace metadata field changed: ${String(field)}`,
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  for (const field of identityFields) {
    const beforeValue = before.identity[field];
    const afterValue = after.identity[field];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      addChange(changes, {
        type: 'workspace.changed',
        severity: 'info',
        target: `identity.${field}`,
        message: `Workspace identity field changed: ${String(field)}`,
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  if (stableStringify(before.policies) !== stableStringify(after.policies)) {
    addChange(changes, {
      type: 'workspace.changed',
      severity: 'warning',
      target: 'policies',
      message: 'Workspace policy summary changed.',
      before: before.policies,
      after: after.policies,
    });
  }

  // Evidence is produced downstream of structural diff and changes on every
  // healthy chain run. It is freshness input for gates, not source change. If
  // compared here the chain observes its own reports and can never be idempotent.

  if (stableStringify(before.discovery) !== stableStringify(after.discovery)) {
    addChange(changes, {
      type: 'workspace.changed',
      severity: 'info',
      target: 'discovery',
      message: 'Workspace discovery settings changed.',
      before: before.discovery,
      after: after.discovery,
    });
  }

  if (before.contracts.exists !== after.contracts.exists) {
    addChange(changes, {
      type: 'workspace.changed',
      severity: after.contracts.exists ? 'info' : 'warning',
      target: after.contracts.workspaceContractPath,
      message: 'Workspace contract presence changed.',
      before: before.contracts.exists,
      after: after.contracts.exists,
    });
  }

  return changes;
}

function compareValidation(
  before: WorkspaceModel,
  after: WorkspaceModel
): WorkspaceModelDiffChange[] {
  const beforeValidation = before.validation ?? null;
  const afterValidation = after.validation ?? null;
  if (stableStringify(beforeValidation) === stableStringify(afterValidation)) {
    return [];
  }
  return [
    {
      type: 'validation.changed',
      severity: afterValidation?.status === 'failed' ? 'critical' : 'warning',
      target: 'validation',
      message: 'Workspace model validation changed.',
      before: beforeValidation,
      after: afterValidation,
    },
  ];
}

function compareProjects(
  before: WorkspaceModel,
  after: WorkspaceModel
): WorkspaceModelDiffChange[] {
  const changes: WorkspaceModelDiffChange[] = [];
  const beforeByPath = new Map(before.projects.map((project) => [project.path, project]));
  const afterByPath = new Map(after.projects.map((project) => [project.path, project]));

  for (const [projectPath, project] of afterByPath.entries()) {
    const previous = beforeByPath.get(projectPath);
    if (!previous) {
      addChange(changes, {
        type: 'project.added',
        severity: 'info',
        target: projectPath,
        message: `Project added: ${project.name}`,
        after: projectSignature(project),
      });
      continue;
    }

    const beforeSignature = projectSignature(previous);
    const afterSignature = projectSignature(project);
    if (stableStringify(beforeSignature) !== stableStringify(afterSignature)) {
      const runtimeChanged =
        previous.runtime !== project.runtime || previous.framework !== project.framework;
      addChange(changes, {
        type: 'project.changed',
        severity: runtimeChanged ? 'warning' : 'info',
        target: projectPath,
        message: `Project changed: ${project.name}`,
        before: beforeSignature,
        after: afterSignature,
      });
    }
  }

  for (const [projectPath, project] of beforeByPath.entries()) {
    if (afterByPath.has(projectPath)) {
      continue;
    }
    addChange(changes, {
      type: 'project.removed',
      severity: 'warning',
      target: projectPath,
      message: `Project removed: ${project.name}`,
      before: projectSignature(project),
    });
  }

  return changes.sort((a, b) => `${a.type}:${a.target}`.localeCompare(`${b.type}:${b.target}`));
}

export async function diffWorkspaceModel(
  options: DiffWorkspaceModelOptions
): Promise<WorkspaceModelDiff> {
  const workspacePath = path.resolve(options.workspacePath);
  const gitRequested = isGitDiffSource(options.fromPath);
  const gitRef = gitRequested ? parseGitDiffRef(options.fromPath) : undefined;
  let resolvedFromPath = options.fromPath;
  if (gitRequested) {
    const snapshotPath = path.join(workspacePath, WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH);
    if (!(await fsExtra.pathExists(snapshotPath))) {
      throw new Error(
        'Git-aware workspace diff requires an existing snapshot at .workspai/reports/workspace-model-snapshot.json. Run: npx workspai workspace snapshot --json'
      );
    }
    resolvedFromPath = WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH;
  }

  const fromPath = resolveWorkspaceRelativePath(workspacePath, resolvedFromPath);
  const previous = await readModelFromPath(fromPath);
  const currentModel =
    options.model ??
    (await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: options.includeAbsolutePaths,
      includeEvidence: options.includeEvidence,
      observableScanDepth: options.observableScanDepth,
      now: options.now,
    }));
  const currentHash = hashWorkspaceModel(currentModel);
  const changes = [
    ...compareWorkspace(previous.model, currentModel),
    ...compareProjects(previous.model, currentModel),
    ...compareValidation(previous.model, currentModel),
  ];

  let gitObservation: GitWorkingTreeObservation | undefined;
  if (options.includeGitObservation !== false) {
    gitObservation =
      options.gitObservation ?? collectGitWorkingTreeObservation(workspacePath, { ref: gitRef });
    if (gitObservation.available) {
      appendGitObservationChanges(changes, gitObservation, currentModel);
    }
  }

  const gitChangedFiles = changes.filter((change) => change.type.startsWith('git.')).length;
  const modelChanged = previous.hash !== currentHash;
  const fromRef = gitRequested
    ? `git:${gitRef ?? 'HEAD'}`
    : path.relative(workspacePath, fromPath).split(path.sep).join('/');

  return {
    schemaVersion: WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    fromRef,
    toRef: WORKSPACE_MODEL_REPORT_PATH,
    fromHash: previous.hash,
    toHash: currentHash,
    summary: {
      changed: modelChanged || gitChangedFiles > 0,
      addedProjects: changes.filter((change) => change.type === 'project.added').length,
      removedProjects: changes.filter((change) => change.type === 'project.removed').length,
      changedProjects: changes.filter((change) => change.type === 'project.changed').length,
      workspaceChanges: changes.filter((change) => change.type === 'workspace.changed').length,
      validationChanges: changes.filter((change) => change.type === 'validation.changed').length,
      gitChangedFiles,
    },
    git: gitObservation?.available
      ? summarizeGitObservation(gitObservation, gitRef)
      : { available: false, dirty: false, changedFiles: 0, untrackedFiles: 0, deletedFiles: 0 },
    changes,
    currentModel,
  };
}

export async function writeWorkspaceModelDiff(
  diff: WorkspaceModelDiff,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_MODEL_DIFF_REPORT_PATH,
    attachRunCorrelation(diff)
  );
}

function riskRank(risk: WorkspaceImpactRisk): number {
  return { none: 0, low: 1, medium: 2, high: 3, critical: 4 }[risk];
}

function highestRisk(risks: WorkspaceImpactRisk[]): WorkspaceImpactRisk {
  return risks.reduce<WorkspaceImpactRisk>(
    (highest, risk) => (riskRank(risk) > riskRank(highest) ? risk : highest),
    'none'
  );
}

const RISK_BY_RANK: WorkspaceImpactRisk[] = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * A transitively-affected project is one notch less risky than the changed
 * project that reached it (a dependent is risky, but the change is one hop away),
 * floored at `low` so it still gets a verification command.
 */
function downgradeRisk(risk: WorkspaceImpactRisk): WorkspaceImpactRisk {
  const downgraded = Math.max(1, riskRank(risk) - 1);
  return RISK_BY_RANK[downgraded];
}

/**
 * A change to a critical-path hotspot (many transitive dependents) is riskier
 * than the same change to a leaf, so bump it one level (capped at `critical`).
 */
function escalateRisk(risk: WorkspaceImpactRisk): WorkspaceImpactRisk {
  const escalated = Math.min(RISK_BY_RANK.length - 1, riskRank(risk) + 1);
  return RISK_BY_RANK[escalated];
}

function normalizeCommandParts(parts: string[]): string {
  return parts.join(' ');
}

function buildImpactCommand(
  id: string,
  label: string,
  args: string[],
  options: {
    scope: 'workspace' | 'project';
    project?: string;
    required?: boolean;
  }
): WorkspaceImpactCommand {
  return {
    id,
    label,
    scope: options.scope,
    project: options.project,
    display: normalizeCommandParts(['npx', 'workspai', ...args]),
    execute: normalizeCommandParts(['npx', '--yes', '--package', 'workspai', 'workspai', ...args]),
    required: options.required !== false,
  };
}

function projectVerificationPlan(project: WorkspaceModelProject): WorkspaceImpactCommand[] {
  const scope = `project:${project.name}`;
  const fleetStages = project.commands.fleetStages;
  return [
    buildImpactCommand(
      `project.${project.name}.init`,
      `Run init for ${project.name}`,
      ['workspace', 'run', 'init', '--scope', scope, '--json'],
      {
        scope: 'project',
        project: project.name,
        required: fleetStages.includes('init'),
      }
    ),
    buildImpactCommand(
      `project.${project.name}.test`,
      `Run tests for ${project.name}`,
      ['workspace', 'run', 'test', '--scope', scope, '--json'],
      {
        scope: 'project',
        project: project.name,
        required: fleetStages.includes('test'),
      }
    ),
    buildImpactCommand(
      `project.${project.name}.build`,
      `Run build for ${project.name}`,
      ['workspace', 'run', 'build', '--scope', scope, '--json'],
      {
        scope: 'project',
        project: project.name,
        required: fleetStages.includes('build'),
      }
    ),
    buildImpactCommand(
      `project.${project.name}.start`,
      `Run start for ${project.name}`,
      ['workspace', 'run', 'start', '--scope', scope, '--json'],
      {
        scope: 'project',
        project: project.name,
        required: fleetStages.includes('start'),
      }
    ),
  ];
}

export function workspaceVerificationPlan(): WorkspaceImpactCommand[] {
  return [
    buildImpactCommand(
      'workspace.doctor',
      'Run workspace doctor',
      ['doctor', 'workspace', '--json'],
      { scope: 'workspace' }
    ),
    buildImpactCommand(
      'workspace.contract.verify',
      'Verify workspace contract',
      ['workspace', 'contract', 'verify', '--json'],
      { scope: 'workspace' }
    ),
    buildImpactCommand('workspace.readiness', 'Run release readiness', ['readiness', '--json'], {
      scope: 'workspace',
    }),
    buildImpactCommand('workspace.analyze', 'Run workspace analyze', ['analyze', '--json'], {
      scope: 'workspace',
      required: false,
    }),
    buildImpactCommand('workspace.pipeline', 'Run governance pipeline', ['pipeline', '--json'], {
      scope: 'workspace',
      required: false,
    }),
    buildImpactCommand(
      'workspace.doctor-fix',
      'Verify doctor fix result',
      ['doctor', 'workspace', '--fix', '--json'],
      { scope: 'workspace', required: false }
    ),
  ];
}

function findProjectForRelativePath(
  model: WorkspaceModel,
  relativePath: string
): WorkspaceModelProject | undefined {
  const normalized = relativePath.split(path.sep).join('/');
  const candidates = model.projects
    .filter((project) => {
      const projectPath = project.path.split(path.sep).join('/');
      return normalized === projectPath || normalized.startsWith(`${projectPath}/`);
    })
    .sort((left, right) => right.path.length - left.path.length);
  return candidates[0];
}

function appendGitObservationChanges(
  changes: WorkspaceModelDiffChange[],
  observation: GitWorkingTreeObservation,
  model: WorkspaceModel
): void {
  const existingTargets = new Set(changes.map((change) => change.target));

  const appendFileChange = (
    type: Extract<
      WorkspaceModelDiffChangeType,
      'git.file.changed' | 'git.untracked' | 'git.deleted'
    >,
    filePath: string
  ): void => {
    const normalized = filePath.split(path.sep).join('/');
    const target = `git:${normalized}`;
    if (existingTargets.has(target)) {
      return;
    }
    const project = findProjectForRelativePath(model, normalized);
    const projectLabel = project ? `${project.name} (${project.path})` : 'workspace';
    addChange(changes, {
      type,
      severity: type === 'git.deleted' ? 'warning' : 'info',
      target,
      message: `Git ${type === 'git.untracked' ? 'untracked' : type === 'git.deleted' ? 'deleted' : 'changed'} file affects ${projectLabel}: ${normalized}`,
      after: {
        path: normalized,
        project: project?.name,
        projectPath: project?.path,
      },
    });
    existingTargets.add(target);
  };

  for (const filePath of observation.changedFiles) {
    appendFileChange('git.file.changed', filePath);
  }
  for (const filePath of observation.untrackedFiles) {
    appendFileChange('git.untracked', filePath);
  }
  for (const filePath of observation.deletedFiles) {
    appendFileChange('git.deleted', filePath);
  }
}

function summarizeGitObservation(
  observation: GitWorkingTreeObservation,
  gitRef?: string
): WorkspaceModelDiffGitSummary {
  return {
    available: true,
    ref: gitRef ?? observation.ref,
    branch: observation.branch,
    commit: observation.commit,
    dirty: observation.dirty,
    changedFiles: observation.changedFiles.length,
    untrackedFiles: observation.untrackedFiles.length,
    deletedFiles: observation.deletedFiles.length,
  };
}

function dedupeCommands(commands: WorkspaceImpactCommand[]): WorkspaceImpactCommand[] {
  const seen = new Set<string>();
  const output: WorkspaceImpactCommand[] = [];
  for (const command of commands) {
    const key = `${command.scope}:${command.project ?? ''}:${command.display}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(command);
  }
  return output;
}

function projectRiskForChange(change: WorkspaceModelDiffChange): WorkspaceImpactRisk {
  if (change.type === 'project.removed') {
    return 'high';
  }
  if (change.severity === 'critical') {
    return 'critical';
  }
  if (change.severity === 'warning') {
    return 'high';
  }
  if (change.type === 'project.added') {
    return 'medium';
  }
  return 'medium';
}

function workspaceRiskForChange(
  change: WorkspaceModelDiffChange,
  options?: { projectCount?: number }
): WorkspaceImpactRisk {
  if (change.severity === 'critical') {
    return 'critical';
  }
  if (change.target === 'policies' || change.target.includes('contract')) {
    return 'high';
  }
  if (change.type === 'validation.changed') {
    if ((options?.projectCount ?? 0) === 0) {
      return 'low';
    }
    return 'high';
  }
  if (change.target === 'evidence') {
    return 'low';
  }
  return change.severity === 'warning' ? 'medium' : 'low';
}

function softenImpactRiskForEmptyWorkspace(input: {
  risk: WorkspaceImpactRisk;
  affectedProjects: number;
  projectCount: number;
  changes: WorkspaceModelDiffChange[];
}): WorkspaceImpactRisk {
  if (input.affectedProjects > 0 || input.projectCount > 0) {
    return input.risk;
  }

  const bootstrapNoiseOnly = input.changes.every((change) => {
    if (change.severity === 'critical') {
      return false;
    }
    return change.type.startsWith('git.') || change.type === 'validation.changed';
  });
  if (!bootstrapNoiseOnly) {
    return input.risk;
  }

  if (riskRank(input.risk) >= riskRank('high')) {
    return 'low';
  }
  if (input.risk === 'medium') {
    return 'low';
  }
  return input.risk;
}

function scopeMatchesProject(scope: string | undefined, project: WorkspaceModelProject): boolean {
  if (!scope || scope === 'workspace') {
    return true;
  }
  const normalized = (scope.startsWith('project:') ? scope.slice('project:'.length) : scope)
    .trim()
    .toLowerCase();
  return [project.name, project.path, path.basename(project.path), project.absolutePath]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())
    .includes(normalized);
}

function buildAgentBrief(impact: {
  changed: boolean;
  risk: WorkspaceImpactRisk;
  affectedProjects: WorkspaceImpactItem[];
  workspaceImpact: WorkspaceImpactItem[];
}): WorkspaceImpact['agentBrief'] {
  if (!impact.changed) {
    return {
      headline: 'No workspace model impact detected.',
      bullets: ['The current workspace model matches the provided snapshot/report.'],
      unsafeAssumptions: ['Do not claim runtime verification passed unless a report exists.'],
    };
  }

  const projectNames = impact.affectedProjects.map((item) => item.project?.name ?? item.target);
  return {
    headline: `Workspace impact risk: ${impact.risk}.`,
    bullets: [
      `Affected projects: ${projectNames.length ? projectNames.join(', ') : 'none'}.`,
      `Workspace-level items: ${impact.workspaceImpact.length}.`,
      'Use the verification plan before recommending apply, rollback, or release actions.',
    ],
    unsafeAssumptions: [
      'Do not infer test/build success from impact alone.',
      'Do not apply fixes without project scope and verification evidence.',
      'Use display commands for users and execute commands for automation.',
    ],
  };
}

export async function buildWorkspaceImpact(
  options: BuildWorkspaceImpactOptions
): Promise<WorkspaceImpact> {
  const workspacePath = path.resolve(options.workspacePath);
  const gitRequested = isGitDiffSource(options.fromPath);
  let diff = options.diff;
  if (!diff && !gitRequested) {
    const fromPath = resolveWorkspaceRelativePath(workspacePath, options.fromPath);
    diff = (await readDiffFromPath(fromPath)) ?? undefined;
  }
  if (!diff) {
    diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: options.fromPath,
      includeAbsolutePaths: options.includeAbsolutePaths,
      includeEvidence: options.includeEvidence,
      includeGitObservation: options.includeGitObservation,
      gitObservation: options.gitObservation,
      now: options.now,
      model: options.model,
    });
  }
  const currentProjectsByPath = new Map(
    diff.currentModel.projects.map((project) => [project.path, project])
  );
  const currentProjectsByName = new Map(
    diff.currentModel.projects.map((project) => [project.name, project])
  );
  const projectChanges = diff.changes.filter((change) => change.type.startsWith('project.'));
  const projectReasons = new Map<string, WorkspaceModelDiffChange[]>();

  for (const change of projectChanges) {
    const project =
      currentProjectsByPath.get(change.target) ??
      (typeof (change.before as { name?: unknown } | undefined)?.name === 'string'
        ? currentProjectsByName.get((change.before as { name: string }).name)
        : undefined);
    const target = project?.path ?? change.target;
    const existing = projectReasons.get(target) ?? [];
    existing.push(change);
    projectReasons.set(target, existing);
  }

  const affectedProjects: WorkspaceImpactItem[] = [];
  for (const [target, changes] of projectReasons.entries()) {
    const project = currentProjectsByPath.get(target);
    if (project && !scopeMatchesProject(options.scope, project)) {
      continue;
    }
    const risk = highestRisk(changes.map(projectRiskForChange));
    const projectName =
      project?.name ??
      (typeof (changes[0]?.before as { name?: unknown } | undefined)?.name === 'string'
        ? String((changes[0].before as { name: string }).name)
        : target);
    affectedProjects.push({
      id: `project:${projectName}`,
      scope: 'project',
      target,
      title: `Project impact: ${projectName}`,
      summary: changes.map((change) => change.message).join(' '),
      risk,
      reasons: changes.map((change) => `${change.type}: ${change.message}`),
      project: project
        ? {
            name: project.name,
            path: project.path,
            kind: project.kind,
            runtime: project.runtime,
            framework: project.framework,
            supportTier: project.supportTier,
            ...(project.generator ? { generator: project.generator } : {}),
          }
        : undefined,
      verification: project ? projectVerificationPlan(project) : workspaceVerificationPlan(),
    });
  }

  // Graph-aware transitive blast radius (1.10): propagate from directly-changed
  // projects to their transitive dependents via the model's dependency graph.
  const graph = workspaceModelProjectTopology(diff.currentModel);
  const centrality = graph ? computeGraphCentrality(graph) : undefined;
  const directlyAffectedNames = new Set(
    affectedProjects
      .map((item) => item.project?.name)
      .filter((name): name is string => typeof name === 'string')
  );
  const riskByName = new Map<string, WorkspaceImpactRisk>();
  for (const item of affectedProjects) {
    if (item.project?.name) {
      const nodeCentrality = centrality?.byId.get(item.project.name);
      if (nodeCentrality) {
        item.centrality = {
          fanIn: nodeCentrality.fanIn,
          fanOut: nodeCentrality.fanOut,
          reach: nodeCentrality.reach,
          betweenness: nodeCentrality.betweenness,
          isHotspot: nodeCentrality.isHotspot,
        };
        // Centrality-weighted risk: a change to a critical-path hotspot escalates.
        if (nodeCentrality.isHotspot) {
          item.risk = escalateRisk(item.risk);
          item.reasons = [
            ...item.reasons,
            `graph.hotspot: critical-path project with ${nodeCentrality.reach} transitive dependent(s); risk escalated.`,
          ];
        }
      }
      item.origin = 'direct';
      item.distance = 0;
      riskByName.set(item.project.name, item.risk);
    }
  }

  const transitiveImpact: WorkspaceImpactItem[] = [];
  let maxDistance = 0;
  if (graph && directlyAffectedNames.size > 0) {
    const reached = transitiveDependents(graph, directlyAffectedNames);
    for (const node of reached.values()) {
      if (node.distance === 0 || directlyAffectedNames.has(node.id)) {
        continue;
      }
      const project = currentProjectsByName.get(node.id);
      if (project && !scopeMatchesProject(options.scope, project)) {
        continue;
      }
      const originName = node.path[0];
      const predecessor = node.path[node.path.length - 2] ?? originName;
      const originRisk = riskByName.get(originName) ?? 'medium';
      const risk = downgradeRisk(originRisk);
      const centralityNode = centrality?.byId.get(node.id);
      maxDistance = Math.max(maxDistance, node.distance);
      transitiveImpact.push({
        id: `transitive:${node.id}`,
        scope: 'project',
        target: project?.path ?? node.id,
        title: `Transitive impact: ${node.id}`,
        summary: `Depends on changed project ${originName}${
          node.via ? ` via ${node.via}` : ''
        } (distance ${node.distance}).`,
        risk,
        reasons: [
          `graph.dependent: depends on ${predecessor}${
            node.via ? ` via ${node.via}` : ''
          } (path ${node.path.join(' -> ')})`,
        ],
        project: project
          ? {
              name: project.name,
              path: project.path,
              kind: project.kind,
              runtime: project.runtime,
              framework: project.framework,
              supportTier: project.supportTier,
              ...(project.generator ? { generator: project.generator } : {}),
            }
          : undefined,
        verification: project ? projectVerificationPlan(project) : workspaceVerificationPlan(),
        origin: 'transitive',
        distance: node.distance,
        path: node.path,
        via: node.via,
        ...(centralityNode
          ? {
              centrality: {
                fanIn: centralityNode.fanIn,
                fanOut: centralityNode.fanOut,
                reach: centralityNode.reach,
                betweenness: centralityNode.betweenness,
                isHotspot: centralityNode.isHotspot,
              },
            }
          : {}),
      });
    }
  }
  transitiveImpact.sort((a, b) => a.target.localeCompare(b.target));

  const criticalPathHotspots: WorkspaceImpactHotspot[] = centrality
    ? centrality.hotspots.flatMap((id) => {
        const node = centrality.byId.get(id);
        return node
          ? [
              {
                project: id,
                fanIn: node.fanIn,
                fanOut: node.fanOut,
                reach: node.reach,
                betweenness: node.betweenness,
              },
            ]
          : [];
      })
    : [];

  const workspaceChanges = diff.changes.filter((change) => !change.type.startsWith('project.'));
  const projectCount = diff.currentModel.summary?.projectCount ?? diff.currentModel.projects.length;
  const workspaceImpact: WorkspaceImpactItem[] = workspaceChanges.map((change) => ({
    id: `workspace:${change.target}`,
    scope: 'workspace',
    target: change.target,
    title: `Workspace impact: ${change.target}`,
    summary: change.message,
    risk: workspaceRiskForChange(change, { projectCount }),
    reasons: [`${change.type}: ${change.message}`],
    verification: workspaceVerificationPlan(),
  }));

  const verificationPlan = dedupeCommands([
    ...affectedProjects.flatMap((item) => item.verification),
    ...transitiveImpact.flatMap((item) => item.verification),
    ...workspaceImpact.flatMap((item) => item.verification),
    ...(diff.summary.changed ? workspaceVerificationPlan() : []),
  ]).filter((command) => command.required);
  const rawRisk = highestRisk([
    ...affectedProjects.map((item) => item.risk),
    ...transitiveImpact.map((item) => item.risk),
    ...workspaceImpact.map((item) => item.risk),
  ]);
  const risk = softenImpactRiskForEmptyWorkspace({
    risk: rawRisk,
    affectedProjects: affectedProjects.length,
    projectCount,
    changes: diff.changes,
  });
  const summary = {
    changed: diff.summary.changed,
    risk,
    affectedProjects: affectedProjects.length,
    workspaceItems: workspaceImpact.length,
    recommendedCommands: verificationPlan.length,
    blastRadius: {
      directlyAffected: affectedProjects.length,
      transitivelyAffected: transitiveImpact.length,
      maxDistance,
      graphEdges: graph?.edges.length ?? 0,
    },
  };

  return {
    schemaVersion: WORKSPACE_IMPACT_SCHEMA_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    fromRef: diff.fromRef,
    diffRef: WORKSPACE_MODEL_DIFF_REPORT_PATH,
    workspace: {
      name: diff.currentModel.workspace.name,
      profile: diff.currentModel.workspace.profile,
      type: diff.currentModel.workspace.type,
    },
    summary,
    affectedProjects: affectedProjects.sort((a, b) => a.target.localeCompare(b.target)),
    transitiveImpact,
    criticalPathHotspots,
    workspaceImpact: workspaceImpact.sort((a, b) => a.target.localeCompare(b.target)),
    verificationPlan,
    agentBrief: buildAgentBrief({
      changed: summary.changed,
      risk,
      affectedProjects,
      workspaceImpact,
    }),
    diff,
  };
}

export async function writeWorkspaceImpact(
  impact: WorkspaceImpact,
  workspacePath: string
): Promise<string> {
  return writeWorkspaceArtifactJson(
    workspacePath,
    WORKSPACE_IMPACT_REPORT_PATH,
    attachRunCorrelation(impact)
  );
}
