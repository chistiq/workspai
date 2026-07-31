import { createHash } from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

import { collectProjectTestCoverage } from './project-test-coverage.js';
import { evaluateReleaseReadiness } from './readiness.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import { runWorkspaceIntelligenceChain } from './workspace-intelligence-runner.js';
import { buildWorkspaceModel, type WorkspaceModelProject } from './workspace-model.js';
import { runWorkspaceStage } from './workspace-run.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

export const VERIFIED_GOAL_SCHEMA_VERSION = 'workspai.verified-goal.v1' as const;
export const VERIFIED_GOAL_STATUS_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.verifiedGoalStatus;
export const VERIFIED_GOAL_LAST_RUN_REPORT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.verifiedGoalStatus;
const VERIFIED_GOAL_CONTRACT_PATH =
  'contracts/workspace-intelligence/verified-goal.v1.json' as const;
const VERIFIED_GOAL_STATUS_CONTRACT_PATH =
  'contracts/workspace-intelligence/verified-goal-status.v1.json' as const;

export type VerifiedGoalKind = 'release-readiness' | 'dependency-security' | 'test-coverage';
export type VerifiedGoalState =
  'planned' | 'active' | 'blocked' | 'verified' | 'failed' | 'cancelled';
export type VerifiedGoalCheckStatus = 'passed' | 'failed' | 'blocked' | 'missing' | 'skipped';

export type VerifiedGoalScope = {
  kind: 'workspace' | 'project';
  projectName?: string;
  projectPath?: string;
};

export type VerifiedGoalContract = {
  schemaVersion: typeof VERIFIED_GOAL_SCHEMA_VERSION;
  id: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  workspace: {
    name: string;
    path: string;
  };
  scope: VerifiedGoalScope;
  kind: VerifiedGoalKind;
  summary: string;
  constraints: {
    allowBreakingChanges: boolean;
    allowForce: boolean;
    requireBuild: boolean;
    requireTests: boolean;
  };
  criteria:
    | {
        kind: 'release-readiness';
        readiness: 'pass';
        workspaceVerify: 'ready';
      }
    | {
        kind: 'dependency-security';
        maximumBlockingVulnerabilities: 0;
        requireFreshAudit: true;
      }
    | {
        kind: 'test-coverage';
        metric: 'auto';
        minimumPercent: number;
      };
  baseline: VerifiedGoalMeasurement;
  dependencySafetyBaseline?: {
    manifests: Array<{
      path: string;
      ecosystem: string;
      sha256: string;
      dependencies?: Record<string, string>;
    }>;
  };
  artifactPaths: {
    goal: string;
    status: string;
    latestReport: string;
  };
};

export type VerifiedGoalCheck = {
  id: string;
  label: string;
  status: VerifiedGoalCheckStatus;
  expected: string;
  actual: string;
  evidencePath?: string;
  message: string;
};

export type VerifiedGoalMeasurement = {
  measuredAt: string;
  value: number | null;
  target: number | null;
  unit: 'percent' | 'blocking-vulnerabilities' | 'gates' | 'unknown';
  status: 'satisfied' | 'unsatisfied' | 'unavailable';
  evidencePaths: string[];
  message: string;
};

export type VerifiedGoalStatus = {
  schemaVersion: typeof VERIFIED_GOAL_STATUS_SCHEMA_VERSION;
  goalId: string;
  goalFingerprint: string;
  workspacePath: string;
  updatedAt: string;
  state: VerifiedGoalState;
  attempt: number;
  progress: VerifiedGoalMeasurement;
  checks: VerifiedGoalCheck[];
  blockingReasons: string[];
  evidencePaths: string[];
  nextActions: string[];
  artifactPath: string;
};

export type PlanVerifiedGoalOptions = {
  workspacePath: string;
  kind: VerifiedGoalKind;
  scope?: string;
  target?: number;
  allowBreakingChanges?: boolean;
  allowForce?: boolean;
  requireBuild?: boolean;
  requireTests?: boolean;
};

export type VerifyVerifiedGoalOptions = {
  workspacePath: string;
  goalId: string;
  run?: boolean;
  runIntelligence?: boolean;
};

type DoctorDependencyAudit = {
  generatedAt?: string;
  status?: string;
  blockingFindingCount?: number | null;
  findingCount?: number | null;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const DEPENDENCY_MANIFEST_NAMES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.lockfile',
  'packages.lock.json',
  'Directory.Packages.props',
  'composer.json',
  'composer.lock',
  'Gemfile',
  'Gemfile.lock',
  'mix.exs',
  'mix.lock',
  'deps.edn',
  'project.clj',
  'build.sbt',
] as const;
const DEPENDENCY_MANIFEST_NAME_SET = new Set(
  DEPENDENCY_MANIFEST_NAMES.map((entry) => entry.toLowerCase())
);
const DEPENDENCY_SCAN_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.workspai',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '__pycache__',
  'node_modules',
  'vendor',
  'pods',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
  '.coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
]);
const MAX_DEPENDENCY_SCAN_ENTRIES = 100_000;

function dependencyManifestName(fileName: string): boolean {
  return (
    DEPENDENCY_MANIFEST_NAME_SET.has(fileName.toLowerCase()) ||
    /\.(?:csproj|fsproj|vbproj)$/i.test(fileName)
  );
}

async function discoverDependencyManifestPaths(projectPath: string): Promise<string[]> {
  const queue = [projectPath];
  const manifests: string[] = [];
  let scannedEntries = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined) break;
    const entries = await fsExtra.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    scannedEntries += entries.length;
    if (scannedEntries > MAX_DEPENDENCY_SCAN_ENTRIES) {
      throw new Error(
        `Dependency safety baseline exceeded ${MAX_DEPENDENCY_SCAN_ENTRIES} filesystem entries under ${projectPath}. Narrow the project boundary before creating this goal.`
      );
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!DEPENDENCY_SCAN_EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && dependencyManifestName(entry.name)) {
        manifests.push(absolutePath);
      }
    }
  }
  return manifests;
}

function dependencyEcosystem(fileName: string): string {
  if (
    /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(
      fileName
    )
  ) {
    return 'node';
  }
  if (
    /^(?:pyproject\.toml|requirements\.txt|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock)$/i.test(
      fileName
    )
  ) {
    return 'python';
  }
  if (/^go\.(?:mod|sum)$/i.test(fileName)) return 'go';
  if (/^Cargo\.(?:toml|lock)$/i.test(fileName)) return 'rust';
  if (/^(?:pom\.xml|build\.gradle(?:\.kts)?|gradle\.lockfile)$/i.test(fileName)) return 'jvm';
  if (/^(?:Directory\.Packages\.props|packages\.lock\.json)$/i.test(fileName)) return 'dotnet';
  if (/^composer\.(?:json|lock)$/i.test(fileName)) return 'php';
  if (/^Gemfile(?:\.lock)?$/i.test(fileName)) return 'ruby';
  if (/^mix\.(?:exs|lock)$/i.test(fileName)) return 'elixir';
  if (/^(?:deps\.edn|project\.clj)$/i.test(fileName)) return 'clojure';
  if (/^build\.sbt$/i.test(fileName)) return 'scala';
  if (/\.(?:csproj|fsproj|vbproj)$/i.test(fileName)) return 'dotnet';
  return 'unknown';
}

function nodeDependencySnapshot(content: string): Record<string, string> | undefined {
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const value = manifest[field];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
        if (typeof range === 'string') result[`${field}:${name}`] = range;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

async function dependencySafetyBaseline(
  workspacePath: string,
  scope: VerifiedGoalScope
): Promise<NonNullable<VerifiedGoalContract['dependencySafetyBaseline']>> {
  const model = await buildWorkspaceModel({ workspacePath, includeAbsolutePaths: true });
  const projects = model.projects.filter(
    (project) =>
      scope.kind === 'workspace' ||
      project.name === scope.projectName ||
      path.resolve(workspacePath, project.path) === path.resolve(scope.projectPath ?? '')
  );
  const manifests = new Map<
    string,
    NonNullable<VerifiedGoalContract['dependencySafetyBaseline']>['manifests'][number]
  >();
  for (const project of projects) {
    const projectPath = path.resolve(workspacePath, project.path);
    const discovered = await discoverDependencyManifestPaths(projectPath);
    for (const absolutePath of discovered) {
      const name = path.basename(absolutePath);
      const content = await fsExtra.readFile(absolutePath, 'utf8');
      const relativePath = path.relative(workspacePath, absolutePath).split(path.sep).join('/');
      manifests.set(relativePath, {
        path: relativePath,
        ecosystem: dependencyEcosystem(name),
        sha256: createHash('sha256').update(content).digest('hex'),
        ...(name === 'package.json' ? { dependencies: nodeDependencySnapshot(content) ?? {} } : {}),
      });
    }
  }
  return {
    manifests: [...manifests.values()].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function majorFromRange(range: string): number | null {
  const normalized = range.replace(/^(?:workspace:|npm:[^@]+@)/, '');
  const match = normalized.match(/(?:^|[^\d])(\d+)(?:\.\d+)?(?:\.\d+)?/);
  return match ? Number(match[1]) : null;
}

function dependencyLockFile(relativePath: string): boolean {
  return /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Cargo\.lock|gradle\.lockfile|packages\.lock\.json|composer\.lock|Gemfile\.lock|mix\.lock)$/i.test(
    relativePath
  );
}

async function dependencySafetyCheck(goal: VerifiedGoalContract): Promise<VerifiedGoalCheck> {
  const baseline = goal.dependencySafetyBaseline;
  if (!baseline) {
    return check({
      id: 'change-policy',
      label: 'Change safety policy',
      status: 'missing',
      expected: 'dependency manifest safety baseline',
      actual: 'baseline unavailable',
    });
  }
  const reasons: string[] = [];
  const current = await dependencySafetyBaseline(goal.workspace.path, goal.scope);
  const currentByPath = new Map(current.manifests.map((manifest) => [manifest.path, manifest]));
  const baselineByPath = new Map(baseline.manifests.map((manifest) => [manifest.path, manifest]));
  const changedPaths = new Set<string>();
  for (const manifest of baseline.manifests) {
    const next = currentByPath.get(manifest.path);
    if (!next || next.sha256 !== manifest.sha256) changedPaths.add(manifest.path);
  }
  for (const manifest of current.manifests) {
    if (!baselineByPath.has(manifest.path)) changedPaths.add(manifest.path);
  }

  for (const manifest of current.manifests) {
    if (!baselineByPath.has(manifest.path) && !dependencyLockFile(manifest.path)) {
      reasons.push(`${manifest.path} was added after the safety baseline`);
    }
  }
  for (const manifest of baseline.manifests) {
    const next = currentByPath.get(manifest.path);
    if (!next) {
      reasons.push(`${manifest.path} was removed`);
      continue;
    }
    if (next.sha256 === manifest.sha256) continue;
    if (manifest.dependencies) {
      const content = await fsExtra.readFile(path.join(goal.workspace.path, manifest.path), 'utf8');
      const current = nodeDependencySnapshot(content);
      if (!current) {
        reasons.push(`${manifest.path} is not valid dependency JSON`);
        continue;
      }
      for (const [name, previousRange] of Object.entries(manifest.dependencies)) {
        const nextRange = current[name];
        if (!nextRange) {
          reasons.push(`${name.replace(/^[^:]+:/, '')} was removed`);
          continue;
        }
        if (nextRange === previousRange) continue;
        const previousMajor = majorFromRange(previousRange);
        const nextMajor = majorFromRange(nextRange);
        if (
          previousMajor === null ||
          nextMajor === null ||
          previousMajor !== nextMajor ||
          /(?:latest|\*)/i.test(nextRange)
        ) {
          reasons.push(
            `${name.replace(/^[^:]+:/, '')} changed outside its proven major range (${previousRange} → ${nextRange})`
          );
        }
      }
      continue;
    }
    if (dependencyLockFile(manifest.path)) continue;
    const manifestDirectory = path.posix.dirname(manifest.path);
    const reconciledLock = [...currentByPath.values()].some((candidate) => {
      const candidateDirectory = path.posix.dirname(candidate.path);
      return (
        candidate.ecosystem === manifest.ecosystem &&
        (candidateDirectory === manifestDirectory ||
          manifestDirectory.startsWith(`${candidateDirectory}/`)) &&
        dependencyLockFile(candidate.path) &&
        changedPaths.has(candidate.path)
      );
    });
    if (!reconciledLock) {
      reasons.push(
        `${manifest.path} changed without a matching reconciled ${manifest.ecosystem} lockfile`
      );
    }
  }
  return check({
    id: 'change-policy',
    label: 'Change safety policy',
    status: reasons.length === 0 ? 'passed' : 'blocked',
    expected: 'no force, removal, unbounded, or major dependency changes',
    actual: reasons.length === 0 ? 'manifest changes are within proven bounds' : reasons.join('; '),
  });
}

function goalPaths(
  workspacePath: string,
  goalId: string
): {
  directory: string;
  goal: string;
  status: string;
  latestReport: string;
} {
  if (!/^[a-z0-9][a-z0-9._-]{7,95}$/i.test(goalId)) {
    throw new Error(`Invalid verified goal id: ${goalId}`);
  }
  const directory = path.join(workspacePath, '.workspai', 'goals', goalId);
  return {
    directory,
    goal: path.join(directory, 'goal.json'),
    status: path.join(directory, 'status.json'),
    latestReport: path.join(workspacePath, VERIFIED_GOAL_LAST_RUN_REPORT_PATH),
  };
}

function goalIdentity(goal: VerifiedGoalContract): Record<string, unknown> {
  return {
    workspacePath: path.resolve(goal.workspace.path),
    kind: goal.kind,
    scope: goal.scope,
    target: goal.criteria.kind === 'test-coverage' ? goal.criteria.minimumPercent : null,
    constraints: goal.constraints,
  };
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await fsExtra.ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsExtra.writeJson(temporaryPath, payload, { spaces: 2 });
  await fsExtra.rename(temporaryPath, filePath);
}

async function resolveScope(
  workspacePath: string,
  rawScope?: string
): Promise<{ scope: VerifiedGoalScope; project?: WorkspaceModelProject }> {
  const normalized = rawScope?.trim();
  if (!normalized || normalized === 'workspace') {
    return { scope: { kind: 'workspace' } };
  }
  const requested = normalized.startsWith('project:')
    ? normalized.slice('project:'.length).trim()
    : normalized;
  if (!requested) throw new Error('Project goal scope must name a project.');
  const model = await buildWorkspaceModel({ workspacePath, includeAbsolutePaths: true });
  const matches = model.projects.filter((project) => {
    const absolutePath = path.resolve(workspacePath, project.path);
    return (
      project.name === requested ||
      project.path === requested ||
      absolutePath === path.resolve(requested)
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Project goal scope was not found: ${requested}`
        : `Project goal scope is ambiguous: ${requested}`
    );
  }
  const project = matches[0];
  const projectPath = path.resolve(workspacePath, project.path);
  return {
    project,
    scope: { kind: 'project', projectName: project.name, projectPath },
  };
}

function statusForMeasurement(
  value: number | null,
  target: number,
  direction: 'minimum' | 'maximum'
): VerifiedGoalMeasurement['status'] {
  if (value === null) return 'unavailable';
  return direction === 'minimum'
    ? value >= target
      ? 'satisfied'
      : 'unsatisfied'
    : value <= target
      ? 'satisfied'
      : 'unsatisfied';
}

async function readJsonRecord(filePath: string | null): Promise<Record<string, unknown> | null> {
  if (!filePath) return null;
  try {
    const payload = (await fsExtra.readJson(filePath)) as unknown;
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function doctorProjects(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(payload.projects)) {
    return payload.projects.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    );
  }
  if (payload.project && typeof payload.project === 'object' && !Array.isArray(payload.project)) {
    return [payload.project as Record<string, unknown>];
  }
  return [];
}

function dependencyAuditOf(project: Record<string, unknown>): DoctorDependencyAudit | null {
  const value = project.dependencyAudit;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DoctorDependencyAudit)
    : null;
}

async function dependencyMeasurement(
  workspacePath: string,
  scope: VerifiedGoalScope
): Promise<VerifiedGoalMeasurement> {
  const doctorPath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor
  );
  const doctor = await readJsonRecord(doctorPath);
  if (!doctor) {
    return {
      measuredAt: new Date().toISOString(),
      value: null,
      target: 0,
      unit: 'blocking-vulnerabilities',
      status: 'unavailable',
      evidencePaths: [],
      message: 'Fresh Doctor dependency evidence is not available.',
    };
  }
  const selected = doctorProjects(doctor).filter((project) => {
    if (scope.kind === 'workspace') return true;
    const projectName =
      typeof project.name === 'string'
        ? project.name
        : typeof project.projectName === 'string'
          ? project.projectName
          : '';
    const projectPath =
      typeof project.path === 'string'
        ? path.resolve(project.path)
        : typeof project.projectPath === 'string'
          ? path.resolve(project.projectPath)
          : '';
    return (
      projectName === scope.projectName ||
      (scope.projectPath !== undefined && projectPath === path.resolve(scope.projectPath))
    );
  });
  const audits = selected
    .map(dependencyAuditOf)
    .filter((audit): audit is DoctorDependencyAudit => audit !== null);
  const knownCounts = audits
    .map((audit) => audit.blockingFindingCount)
    .filter((value): value is number => Number.isInteger(value) && Number(value) >= 0);
  const value =
    selected.length > 0 && knownCounts.length === selected.length
      ? knownCounts.reduce((total, count) => total + count, 0)
      : null;
  return {
    measuredAt: (() => {
      const timestamps = audits
        .map((audit) => audit.generatedAt)
        .filter((entry): entry is string => typeof entry === 'string')
        .sort();
      return timestamps[timestamps.length - 1] ?? new Date().toISOString();
    })(),
    value,
    target: 0,
    unit: 'blocking-vulnerabilities',
    status: statusForMeasurement(value, 0, 'maximum'),
    evidencePaths: doctorPath ? [doctorPath] : [],
    message:
      value === null
        ? 'Doctor did not publish complete dependency audit counts for the selected scope.'
        : `${value} blocking dependency vulnerability finding(s) remain.`,
  };
}

async function releaseMeasurement(workspacePath: string): Promise<VerifiedGoalMeasurement> {
  const readiness = await evaluateReleaseReadiness({
    startPath: workspacePath,
    writeReport: false,
  });
  const value = readiness.gates.filter((gate) => gate.status === 'pass').length;
  const target = readiness.gates.length;
  return {
    measuredAt: readiness.generatedAt,
    value,
    target,
    unit: 'gates',
    status: readiness.overallStatus === 'pass' ? 'satisfied' : 'unsatisfied',
    evidencePaths: [
      ...new Set(
        readiness.gates
          .map((gate) => gate.evidencePath)
          .filter((entry): entry is string => typeof entry === 'string')
      ),
    ],
    message:
      readiness.overallStatus === 'pass'
        ? 'All release readiness gates pass.'
        : `${target - value} release readiness gate(s) still require work.`,
  };
}

async function coverageMeasurement(input: {
  projectPath: string;
  target: number;
  run: boolean;
}): Promise<{
  measurement: VerifiedGoalMeasurement;
  executionStatus: 'passed' | 'below-target' | 'unavailable' | 'failed';
}> {
  const coverage = await collectProjectTestCoverage({
    projectPath: input.projectPath,
    target: input.target,
    run: input.run,
  });
  const selected = coverage.metrics[coverage.target.metric];
  const value = selected?.percent ?? null;
  return {
    executionStatus: coverage.status,
    measurement: {
      measuredAt: coverage.generatedAt,
      value,
      target: input.target,
      unit: 'percent',
      status: statusForMeasurement(value, input.target, 'minimum'),
      evidencePaths: [coverage.artifactPaths.project],
      message:
        coverage.status === 'failed'
          ? 'The runtime-native coverage test command failed.'
          : value === null
            ? 'Machine-readable coverage evidence is unavailable.'
            : `${coverage.target.metric} coverage is ${value}% (target ${input.target}%).`,
    },
  };
}

async function coverageMeasurementForScope(input: {
  workspacePath: string;
  scope: VerifiedGoalScope;
  target: number;
  run: boolean;
}): Promise<{
  measurement: VerifiedGoalMeasurement;
  executionStatus: 'passed' | 'below-target' | 'unavailable' | 'failed';
}> {
  if (input.scope.kind === 'project') {
    if (!input.scope.projectPath) {
      throw new Error('Coverage goal project scope does not have a project path.');
    }
    return coverageMeasurement({
      projectPath: input.scope.projectPath,
      target: input.target,
      run: input.run,
    });
  }

  const model = await buildWorkspaceModel({
    workspacePath: input.workspacePath,
    includeAbsolutePaths: true,
  });
  if (model.projects.length === 0) {
    return {
      executionStatus: 'unavailable',
      measurement: {
        measuredAt: new Date().toISOString(),
        value: null,
        target: input.target,
        unit: 'percent',
        status: 'unavailable',
        evidencePaths: [],
        message: 'The workspace does not contain a registered project to measure.',
      },
    };
  }

  const results = [];
  for (const project of model.projects) {
    results.push({
      projectName: project.name,
      result: await coverageMeasurement({
        projectPath: path.resolve(input.workspacePath, project.path),
        target: input.target,
        run: input.run,
      }),
    });
  }
  const failed = results.filter((entry) => entry.result.executionStatus === 'failed');
  const unavailable = results.filter((entry) => entry.result.measurement.status === 'unavailable');
  const belowTarget = results.filter((entry) => entry.result.measurement.status === 'unsatisfied');
  const values = results
    .map((entry) => entry.result.measurement.value)
    .filter((value): value is number => value !== null);
  const value = values.length === results.length && values.length > 0 ? Math.min(...values) : null;
  const executionStatus =
    failed.length > 0
      ? 'failed'
      : unavailable.length > 0
        ? 'unavailable'
        : belowTarget.length > 0
          ? 'below-target'
          : 'passed';
  const measurementTimes = results.map((entry) => entry.result.measurement.measuredAt).sort();
  const problems = [
    ...failed.map((entry) => `${entry.projectName}: coverage command failed`),
    ...unavailable.map((entry) => `${entry.projectName}: coverage unavailable`),
    ...belowTarget.map(
      (entry) => `${entry.projectName}: ${entry.result.measurement.value ?? 'unknown'}%`
    ),
  ];
  return {
    executionStatus,
    measurement: {
      measuredAt: measurementTimes[measurementTimes.length - 1] ?? new Date().toISOString(),
      value,
      target: input.target,
      unit: 'percent',
      status:
        executionStatus === 'passed'
          ? 'satisfied'
          : executionStatus === 'below-target'
            ? 'unsatisfied'
            : 'unavailable',
      evidencePaths: [
        ...new Set(results.flatMap((entry) => entry.result.measurement.evidencePaths)),
      ],
      message:
        executionStatus === 'passed'
          ? `Every registered project has at least ${input.target}% test coverage.`
          : `Workspace coverage is not verified: ${problems.join('; ')}.`,
    },
  };
}

function summaryFor(input: {
  kind: VerifiedGoalKind;
  scope: VerifiedGoalScope;
  target?: number;
}): string {
  const subject =
    input.scope.kind === 'project'
      ? `project ${input.scope.projectName ?? 'selected project'}`
      : 'workspace';
  if (input.kind === 'release-readiness') return `Prepare the ${subject} for release.`;
  if (input.kind === 'dependency-security') {
    return `Resolve blocking dependency vulnerabilities in the ${subject} without unsafe changes.`;
  }
  return `Raise ${subject} test coverage to ${input.target ?? 80}% without breaking its build.`;
}

function criteriaFor(kind: VerifiedGoalKind, target: number): VerifiedGoalContract['criteria'] {
  if (kind === 'release-readiness') {
    return { kind, readiness: 'pass', workspaceVerify: 'ready' };
  }
  if (kind === 'dependency-security') {
    return { kind, maximumBlockingVulnerabilities: 0, requireFreshAudit: true };
  }
  return { kind, metric: 'auto', minimumPercent: target };
}

async function measureBaseline(input: {
  workspacePath: string;
  kind: VerifiedGoalKind;
  scope: VerifiedGoalScope;
  target: number;
}): Promise<VerifiedGoalMeasurement> {
  if (input.kind === 'release-readiness') return releaseMeasurement(input.workspacePath);
  if (input.kind === 'dependency-security') {
    return dependencyMeasurement(input.workspacePath, input.scope);
  }
  return (
    await coverageMeasurementForScope({
      workspacePath: input.workspacePath,
      scope: input.scope,
      target: input.target,
      run: false,
    })
  ).measurement;
}

export async function planVerifiedGoal(
  options: PlanVerifiedGoalOptions
): Promise<{ goal: VerifiedGoalContract; status: VerifiedGoalStatus; resumed: boolean }> {
  const workspacePath = path.resolve(options.workspacePath);
  const target = Math.max(0, Math.min(100, Math.round(options.target ?? 80)));
  const { scope } = await resolveScope(workspacePath, options.scope);
  const identity = {
    workspacePath: path.resolve(workspacePath),
    kind: options.kind,
    scope,
    target: options.kind === 'test-coverage' ? target : null,
    constraints: {
      allowBreakingChanges: options.allowBreakingChanges === true,
      allowForce: options.allowForce === true,
      requireBuild: options.requireBuild !== false,
      requireTests: options.requireTests !== false,
    },
  };
  const fingerprint = sha256(identity);
  const id = `goal-${options.kind}-${fingerprint.slice(0, 16)}`;
  const paths = goalPaths(workspacePath, id);
  if (await fsExtra.pathExists(paths.goal)) {
    const { goal, status } = await readVerifiedGoal(workspacePath, id);
    if (goal.fingerprint === fingerprint) {
      return { goal, status, resumed: status.state !== 'verified' };
    }
  }

  const now = new Date().toISOString();
  const baseline = await measureBaseline({
    workspacePath,
    kind: options.kind,
    scope,
    target,
  });
  const goal: VerifiedGoalContract = {
    schemaVersion: VERIFIED_GOAL_SCHEMA_VERSION,
    id,
    fingerprint,
    createdAt: now,
    updatedAt: now,
    workspace: { name: path.basename(workspacePath), path: workspacePath },
    scope,
    kind: options.kind,
    summary: summaryFor({ kind: options.kind, scope, target }),
    constraints: identity.constraints,
    criteria: criteriaFor(options.kind, target),
    baseline,
    ...(options.kind === 'dependency-security'
      ? { dependencySafetyBaseline: await dependencySafetyBaseline(workspacePath, scope) }
      : {}),
    artifactPaths: {
      goal: paths.goal,
      status: paths.status,
      latestReport: paths.latestReport,
    },
  };
  const status: VerifiedGoalStatus = {
    schemaVersion: VERIFIED_GOAL_STATUS_SCHEMA_VERSION,
    goalId: id,
    goalFingerprint: fingerprint,
    workspacePath,
    updatedAt: now,
    state: 'planned',
    attempt: 0,
    progress: baseline,
    checks: [],
    blockingReasons: [],
    evidencePaths: baseline.evidencePaths,
    nextActions:
      options.kind === 'test-coverage'
        ? ['Add focused tests for the lowest-coverage source paths.', 'Run verified goal checks.']
        : options.kind === 'dependency-security'
          ? [
              'Inspect the fresh project dependency audit.',
              'Apply only compatible non-force dependency repairs.',
              'Reconcile the lockfile, test, build, and verify again.',
            ]
          : [
              'Inspect the current remediation plan and failing release gates.',
              'Repair the next causal blocker, then verify again.',
            ],
    artifactPath: paths.status,
  };
  assertJsonSchemaContract(goal, VERIFIED_GOAL_CONTRACT_PATH, 'Verified goal');
  assertJsonSchemaContract(status, VERIFIED_GOAL_STATUS_CONTRACT_PATH, 'Verified goal status');
  await writeJsonAtomic(paths.goal, goal);
  await writeJsonAtomic(paths.status, status);
  await writeWorkspaceArtifactJson(workspacePath, VERIFIED_GOAL_LAST_RUN_REPORT_PATH, status);
  return { goal, status, resumed: false };
}

export async function readVerifiedGoal(
  workspacePath: string,
  goalId: string
): Promise<{ goal: VerifiedGoalContract; status: VerifiedGoalStatus }> {
  const paths = goalPaths(path.resolve(workspacePath), goalId);
  const goal = (await fsExtra.readJson(paths.goal)) as VerifiedGoalContract;
  const status = (await fsExtra.readJson(paths.status)) as VerifiedGoalStatus;
  assertJsonSchemaContract(goal, VERIFIED_GOAL_CONTRACT_PATH, 'Verified goal');
  assertJsonSchemaContract(status, VERIFIED_GOAL_STATUS_CONTRACT_PATH, 'Verified goal status');
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const artifactPathsMatch =
    path.resolve(goal.artifactPaths.goal) === path.resolve(paths.goal) &&
    path.resolve(goal.artifactPaths.status) === path.resolve(paths.status) &&
    path.resolve(goal.artifactPaths.latestReport) === path.resolve(paths.latestReport);
  if (
    goal.schemaVersion !== VERIFIED_GOAL_SCHEMA_VERSION ||
    status.schemaVersion !== VERIFIED_GOAL_STATUS_SCHEMA_VERSION ||
    goal.id !== status.goalId ||
    goal.fingerprint !== status.goalFingerprint ||
    goal.fingerprint !== sha256(goalIdentity(goal)) ||
    path.resolve(goal.workspace.path) !== resolvedWorkspacePath ||
    path.resolve(status.workspacePath) !== resolvedWorkspacePath ||
    !artifactPathsMatch
  ) {
    throw new Error(`Verified goal artifacts are inconsistent: ${goalId}`);
  }
  return { goal, status };
}

function check(
  input: Omit<VerifiedGoalCheck, 'message'> & { message?: string }
): VerifiedGoalCheck {
  return {
    ...input,
    message: input.message ?? `${input.label}: ${input.actual}; expected ${input.expected}.`,
  };
}

async function runBuildAndTestChecks(input: {
  goal: VerifiedGoalContract;
  run: boolean;
  includeTests?: boolean;
}): Promise<VerifiedGoalCheck[]> {
  const checks: VerifiedGoalCheck[] = [];
  const scope =
    input.goal.scope.kind === 'project' && input.goal.scope.projectName
      ? `project:${input.goal.scope.projectName}`
      : undefined;
  for (const stage of ['test', 'build'] as const) {
    if (stage === 'test' && input.includeTests === false) continue;
    const required =
      stage === 'test' ? input.goal.constraints.requireTests : input.goal.constraints.requireBuild;
    if (!required) {
      checks.push(
        check({
          id: stage,
          label: `${stage} validation`,
          status: 'skipped',
          expected: 'not required',
          actual: 'skipped by goal contract',
        })
      );
      continue;
    }
    if (!input.run) {
      checks.push(
        check({
          id: stage,
          label: `${stage} validation`,
          status: 'missing',
          expected: 'fresh passed evidence',
          actual: 'execution disabled',
        })
      );
      continue;
    }
    const report = await runWorkspaceStage({
      workspacePath: input.goal.workspace.path,
      stage,
      scope,
      parallel: false,
      continueOnError: false,
      strict: true,
      json: true,
      enforceGates: false,
    });
    checks.push(
      check({
        id: stage,
        label: `${stage} validation`,
        status: report.summary.exitCode === 0 ? 'passed' : 'failed',
        expected: 'exit 0',
        actual: `exit ${report.summary.exitCode}`,
        evidencePath: path.join(
          input.goal.workspace.path,
          '.workspai',
          'reports',
          'workspace-run-last.json'
        ),
      })
    );
    if (report.summary.exitCode !== 0) break;
  }
  return checks;
}

export async function verifyVerifiedGoal(
  options: VerifyVerifiedGoalOptions
): Promise<VerifiedGoalStatus> {
  const workspacePath = path.resolve(options.workspacePath);
  const { goal, status: previous } = await readVerifiedGoal(workspacePath, options.goalId);
  const run = options.run !== false;
  const checks: VerifiedGoalCheck[] = [];
  let progress: VerifiedGoalMeasurement;

  if (run && options.runIntelligence !== false) {
    const chain = await runWorkspaceIntelligenceChain({
      workspacePath,
      strict: true,
      agent: 'generic',
    });
    const evidenceRefreshCompleted = chain.exitCode === 0 || chain.exitCode === 2;
    const goalRequiresNonBlockingChain = goal.kind === 'release-readiness';
    checks.push(
      check({
        id: 'workspace-intelligence-chain',
        label: 'Workspace Intelligence chain',
        status:
          chain.exitCode === 0
            ? 'passed'
            : chain.exitCode === 2 && !goalRequiresNonBlockingChain
              ? 'passed'
              : chain.exitCode === 2
                ? 'blocked'
                : 'failed',
        expected: 'passed',
        actual:
          chain.exitCode === 2 && evidenceRefreshCompleted && !goalRequiresNonBlockingChain
            ? `${chain.status}; canonical evidence refreshed for goal-scoped verification`
            : chain.status,
        evidencePath: path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun),
      })
    );
  }

  if (goal.kind === 'release-readiness') {
    progress = await releaseMeasurement(workspacePath);
    checks.push(
      check({
        id: 'release-readiness',
        label: 'Release readiness',
        status: progress.status === 'satisfied' ? 'passed' : 'blocked',
        expected: 'all gates pass',
        actual: progress.message,
        evidencePath: path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness),
      })
    );
    const verifyPath = await firstExistingWorkspaceArtifactPath(
      workspacePath,
      WORKSPACE_INTELLIGENCE_ARTIFACTS.verify
    );
    const verify = await readJsonRecord(verifyPath);
    const verdict =
      verify?.summary && typeof verify.summary === 'object' && !Array.isArray(verify.summary)
        ? String((verify.summary as Record<string, unknown>).verdict ?? 'missing')
        : 'missing';
    checks.push(
      check({
        id: 'workspace-verify',
        label: 'Workspace verification',
        status: verdict === 'ready' ? 'passed' : verdict === 'missing' ? 'missing' : 'blocked',
        expected: 'ready',
        actual: verdict,
        evidencePath: path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.verify),
      })
    );
  } else if (goal.kind === 'dependency-security') {
    progress = await dependencyMeasurement(workspacePath, goal.scope);
    checks.push(
      check({
        id: 'dependency-audit',
        label: 'Dependency security audit',
        status:
          progress.status === 'satisfied'
            ? 'passed'
            : progress.status === 'unavailable'
              ? 'missing'
              : 'blocked',
        expected: '0 blocking vulnerabilities',
        actual: progress.message,
        evidencePath: progress.evidencePaths[0],
      })
    );
    checks.push(
      goal.constraints.allowBreakingChanges || goal.constraints.allowForce
        ? check({
            id: 'change-policy',
            label: 'Change safety policy',
            status: 'blocked',
            expected: 'breaking and force changes disabled',
            actual: `allowBreakingChanges=${goal.constraints.allowBreakingChanges}, allowForce=${goal.constraints.allowForce}`,
          })
        : await dependencySafetyCheck(goal)
    );
    if (progress.status === 'satisfied') {
      checks.push(...(await runBuildAndTestChecks({ goal, run })));
    }
  } else {
    const target =
      goal.criteria.kind === 'test-coverage' ? goal.criteria.minimumPercent : goal.baseline.target;
    if (target === null) {
      throw new Error('Coverage goal does not have a valid target.');
    }
    const coverageResult = await coverageMeasurementForScope({
      workspacePath,
      scope: goal.scope,
      target,
      run,
    });
    progress = coverageResult.measurement;
    checks.push(
      check({
        id: 'coverage',
        label: 'Test coverage',
        status:
          progress.status === 'satisfied'
            ? 'passed'
            : progress.status === 'unavailable'
              ? 'missing'
              : 'blocked',
        expected: `at least ${target}%`,
        actual: progress.message,
        evidencePath: progress.evidencePaths[0],
      })
    );
    checks.push(
      check({
        id: 'test',
        label: 'Coverage test execution',
        status:
          coverageResult.executionStatus === 'failed'
            ? 'failed'
            : coverageResult.executionStatus === 'unavailable'
              ? 'missing'
              : 'passed',
        expected: 'runtime-native coverage test command completed',
        actual:
          coverageResult.executionStatus === 'failed'
            ? 'coverage test command failed'
            : coverageResult.executionStatus === 'unavailable'
              ? 'coverage execution evidence unavailable'
              : 'coverage evidence produced by the test runner',
        evidencePath: progress.evidencePaths[0],
      })
    );
    if (progress.status === 'satisfied') {
      checks.push(...(await runBuildAndTestChecks({ goal, run, includeTests: false })));
    }
  }

  const blockingReasons = checks
    .filter(
      (entry) =>
        entry.status === 'blocked' || entry.status === 'failed' || entry.status === 'missing'
    )
    .map((entry) => entry.message);
  const evidencePaths = [
    ...new Set([
      ...progress.evidencePaths,
      ...checks
        .map((entry) => entry.evidencePath)
        .filter((entry): entry is string => typeof entry === 'string'),
    ]),
  ];
  const verified =
    progress.status === 'satisfied' &&
    checks.every((entry) => entry.status === 'passed' || entry.status === 'skipped');
  const paths = goalPaths(workspacePath, goal.id);
  const nextActions = verified
    ? []
    : goal.kind === 'test-coverage'
      ? [
          'Inspect low-coverage files from the coverage artifact.',
          'Add focused tests and verify again.',
        ]
      : goal.kind === 'dependency-security'
        ? [
            'Use fresh audit candidates and compatible package-manager repairs.',
            'Reconcile lockfiles before running verified goal checks again.',
          ]
        : ['Repair the first blocking readiness gate and verify the goal again.'];
  const status: VerifiedGoalStatus = {
    schemaVersion: VERIFIED_GOAL_STATUS_SCHEMA_VERSION,
    goalId: goal.id,
    goalFingerprint: goal.fingerprint,
    workspacePath,
    updatedAt: new Date().toISOString(),
    state: verified
      ? 'verified'
      : checks.some((entry) => entry.status === 'failed')
        ? 'failed'
        : 'blocked',
    attempt: previous.attempt + 1,
    progress,
    checks,
    blockingReasons,
    evidencePaths,
    nextActions,
    artifactPath: paths.status,
  };
  assertJsonSchemaContract(status, VERIFIED_GOAL_STATUS_CONTRACT_PATH, 'Verified goal status');
  await writeJsonAtomic(paths.status, status);
  await writeWorkspaceArtifactJson(workspacePath, VERIFIED_GOAL_LAST_RUN_REPORT_PATH, status);
  return status;
}
