import fs from 'fs';
import path from 'path';

import chalk from 'chalk';
import { execa } from 'execa';
import {
  detectRuntimeFromMarkers,
  categorizeError,
  checkHealth,
  validateCommand,
  applyEnvironmentCommandVariant,
  resolveWorkspaceStageCommand,
  type RuntimeFamily,
  type ErrorCategory,
  type EnvironmentVariant,
} from './framework-registry.js';
import { readProjectMetadata } from './utils/project-metadata.js';
import { isWorkspaceStageSupported } from './utils/workspace-stage-capabilities.js';
import {
  detectBackendFrameworkFromProject,
  detectRuntimeCandidatesFromProject,
  normalizeBackendFrameworkLabel,
  normalizeBackendRuntimeFamily,
  type BackendPlatformKey,
} from './utils/backend-framework-contract.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import {
  buildPackageRunnerSubprocessEnv,
  resolvePackageRunnerInvocation,
} from './utils/platform-capabilities.js';
import { discoverWorkspaceProjects as discoverWorkspaceProjectsShared } from './utils/workspace-discovery.js';
import { closureFromAdjacency } from './workspace-graph-traversal.js';
import {
  publishWorkspaceRunStageReport,
  readWorkspaceRunEvidence,
  WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
} from './utils/workspace-run-evidence.js';
import { resolveFrameworkRegistryEntry } from './framework-registry.js';
import { firstExistingWorkspaceArtifactPath } from './utils/artifact-path-compat.js';
import {
  projectMetadataCandidates,
  workspaceMetadataCandidates,
  workspaceMetadataPath,
} from './utils/workspace-paths.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { buildPolyglotLifecyclePlan, type PolyglotRuntimeUnit } from './polyglot-lifecycle-plan.js';

export type WorkspaceRunStage = 'init' | 'test' | 'build' | 'start';
export type WorkspaceRunStageName = WorkspaceRunStage | (string & {});

export interface WorkspaceRunOptions {
  workspacePath: string;
  stage: WorkspaceRunStageName;
  scope?: string;
  affected?: boolean;
  blastRadius?: boolean;
  since?: string;
  parallel?: boolean;
  maxWorkers?: number;
  continueOnError?: boolean;
  strict?: boolean;
  json?: boolean;
  enforceGates?: boolean;
  reusePassed?: boolean;
  /** Resolve and report native runtime units without executing commands. */
  planOnly?: boolean;
  /** Limit a polyglot project to one runtime family. */
  runtime?: string;
}

type GateStatus = 'pass' | 'warn' | 'fail' | 'skipped';

interface GateResult {
  gate: 'doctor-workspace' | 'readiness';
  status: GateStatus;
  summary: string;
}

interface ProjectExecutionResult {
  path: string;
  relativePath: string;
  projectName: string;
  selected: boolean;
  affected: boolean;
  status: 'passed' | 'failed' | 'skipped';
  exitCode: number | null;
  durationMs: number;
  reason?: string;
  framework?: string;
  runtimeDetected?: RuntimeFamily;
  executionCommand?: string;
  runtimeExecutions?: Array<{
    unitId: string;
    runtime: string;
    role: 'production' | 'tooling' | 'test' | 'example';
    root: string;
    manifest: string;
    stage: string;
    command: string;
    status: 'planned' | 'passed' | 'failed' | 'skipped';
    exitCode: number | null;
    durationMs: number;
    reason?: string;
  }>;
  // Enterprise features
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  failureDiagnostic?: {
    category: ErrorCategory;
    exitCode: number;
    command: string;
    timedOut: boolean;
    timeoutMs: number;
    outputExcerpt?: string;
  };
  healthStatus?: {
    healthy: boolean;
    reason?: string;
  };
}

export type SelectionMode = 'all' | 'affected' | 'affected+blast-radius';
export type GraphStatus = 'loaded' | 'missing' | 'invalid' | 'not-applicable';

export interface WorkspaceRunReport {
  schemaVersion: '1.0';
  workspacePath: string;
  stage: WorkspaceRunStageName;
  generatedAt: string;
  durationMs: number;
  options: {
    affected: boolean;
    blastRadius: boolean;
    since: string | null;
    parallel: boolean;
    maxWorkers: number;
    continueOnError: boolean;
    strict: boolean;
    enforceGates: boolean;
    scope: string | null;
    reusePassed: boolean;
    planOnly: boolean;
    runtime: string | null;
  };
  selection: {
    mode: SelectionMode;
    since: string | null;
    scope: string | null;
    graphStatus: GraphStatus;
    expansionDepth: number;
  };
  gates: {
    enforced: boolean;
    results: GateResult[];
    blocked: boolean;
    blockingGate?: string;
  };
  summary: {
    projectCount: number;
    selectedCount: number;
    passed: number;
    failed: number;
    skipped: number;
    exitCode: number;
  };
  projects: ProjectExecutionResult[];
  enterpriseControls?: {
    jsonReady: boolean;
    evidencePath: string;
  };
}

export { WORKSPACE_RUN_LAST_REPORT_FILENAME } from './utils/workspace-run-evidence.js';

const STAGE_SET: Set<WorkspaceRunStage> = new Set(['init', 'test', 'build', 'start']);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.workspai',
  '.rapidkit',
  '.venv',
  'dist',
  'build',
  'coverage',
  'htmlcov',
]);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyExistingPath(candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Preflight for wrapper-owned runtimes (rapidkit init/test/build/start).
 * Python projects keep pytest in .venv — global `which pytest` is a false negative.
 */
async function validateWrapperStagePreflight(
  projectPath: string,
  runtime: RuntimeFamily,
  nativeStageCommand: string
): Promise<{ valid: boolean; reason?: string }> {
  if (runtime === 'python') {
    const cliPyCandidates = [
      path.join(projectPath, '.workspai', 'cli.py'),
      path.join(projectPath, '.rapidkit', 'cli.py'),
    ];
    for (const cliPy of cliPyCandidates) {
      if (await pathExists(cliPy)) {
        return { valid: true };
      }
    }
    return {
      valid: false,
      reason:
        'Project-local .workspai/cli.py is missing. Run `workspai init` in this project first.',
    };
  }

  const nativeCommand = nativeStageCommand.trim().split(/\s+/)[0];
  if (nativeCommand && ['npm', 'npx', 'pnpm', 'yarn'].includes(nativeCommand)) {
    const invocation = resolvePackageRunnerInvocation(nativeCommand);
    const result = await execa(invocation.command, [...invocation.prefixArgs, '--version'], {
      reject: false,
      env: buildPackageRunnerSubprocessEnv(),
    });
    if (result.exitCode === 0) {
      return { valid: true };
    }
  }

  return validateCommand(nativeStageCommand);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeScope(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('project:')) {
    const projectScope = trimmed.slice('project:'.length).trim();
    return projectScope || null;
  }
  return trimmed;
}

async function discoverWorkspaceProjects(workspacePath: string): Promise<string[]> {
  const modelPath = path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model);
  if (await pathExists(modelPath)) {
    try {
      const model = await readJsonFile<{ projects?: Array<{ path?: unknown }> }>(modelPath);
      const modeledProjects = (model.projects ?? [])
        .map((project) =>
          typeof project.path === 'string' ? path.resolve(workspacePath, project.path) : null
        )
        .filter((projectPath): projectPath is string => Boolean(projectPath))
        .filter((projectPath, index, values) => values.indexOf(projectPath) === index)
        .filter((projectPath) => fs.existsSync(projectPath));
      if (modeledProjects.length > 0) return modeledProjects.sort();
    } catch {
      // Fall back to bounded local discovery when canonical model evidence is unavailable.
    }
  }
  return discoverWorkspaceProjectsShared(workspacePath, {
    skipDirs: SKIP_DIRS,
    includeHiddenDirs: false,
    descendIntoMatchedProjects: false,
    isProjectDir: async (dirPath, rootPath) => {
      if (
        await hasAnyExistingPath([
          ...projectMetadataCandidates(dirPath, 'context.json'),
          ...projectMetadataCandidates(dirPath, 'project.json'),
        ])
      ) {
        return true;
      }

      if (path.resolve(dirPath) === path.resolve(rootPath)) {
        return false;
      }

      return detectRuntimeCandidatesFromProject(dirPath).length > 0;
    },
  });
}

async function readProjectDeclaredName(projectPath: string): Promise<string | null> {
  for (const relativeConfigPath of [
    path.join('.workspai', 'project.json'),
    path.join('.workspai', 'context.json'),
    path.join('.rapidkit', 'project.json'),
    path.join('.rapidkit', 'context.json'),
  ]) {
    const configPath = path.join(projectPath, relativeConfigPath);
    if (!(await pathExists(configPath))) {
      continue;
    }
    try {
      const payload = await readJsonFile<Record<string, unknown>>(configPath);
      const name = payload.name ?? payload.projectName ?? payload.slug;
      if (typeof name === 'string' && name.trim()) {
        return name.trim();
      }
    } catch {
      // Keep scope resolution resilient; path and basename matching still apply.
    }
  }
  return null;
}

async function filterProjectsByScope(
  workspacePath: string,
  projects: string[],
  rawScope: string | undefined
): Promise<{ projects: string[]; normalizedScope: string | null }> {
  const normalizedScope = normalizeScope(rawScope);
  if (!normalizedScope) {
    return { projects, normalizedScope: null };
  }

  const requested = normalizePathForMatch(normalizedScope).toLowerCase();
  const matched: string[] = [];
  for (const projectPath of projects) {
    const relativePath = normalizePathForMatch(path.relative(workspacePath, projectPath));
    const basename = path.basename(projectPath);
    const declaredName = await readProjectDeclaredName(projectPath);
    const candidates = [relativePath, basename, declaredName]
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .map((item) => normalizePathForMatch(item).toLowerCase());
    if (candidates.includes(requested)) {
      matched.push(projectPath);
    }
  }

  if (matched.length === 0) {
    throw new Error(`Workspace run scope did not match any project: ${rawScope}`);
  }

  return { projects: matched, normalizedScope };
}

async function computeAffectedProjects(
  workspacePath: string,
  projects: string[],
  since: string
): Promise<Set<string>> {
  const changedFiles = await execa('git', ['diff', '--name-only', `${since}...HEAD`], {
    cwd: workspacePath,
    reject: false,
    env: buildCleanGitEnv(),
  });

  if (changedFiles.exitCode !== 0) {
    return new Set(projects);
  }

  const lines = changedFiles.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalizePathForMatch(line));

  if (lines.length === 0) {
    return new Set();
  }

  const matched = new Set<string>();
  for (const projectPath of projects) {
    const relative = normalizePathForMatch(path.relative(workspacePath, projectPath));
    if (!relative || relative === '.') {
      continue;
    }

    const prefix = `${relative}/`;
    if (lines.some((line) => line === relative || line.startsWith(prefix))) {
      matched.add(projectPath);
    }
  }

  return matched;
}

interface BlastRadiusResult {
  expanded: Set<string>;
  graphStatus: 'loaded' | 'missing' | 'invalid';
  expansionDepth: number;
}

async function expandAffectedWithBlastRadius(
  workspacePath: string,
  projects: string[],
  initialAffected: Set<string>
): Promise<BlastRadiusResult> {
  const contractPath =
    (await firstExistingWorkspaceArtifactPath(
      workspacePath,
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract
    )) ?? workspaceMetadataPath(workspacePath, 'workspace.contract.json');
  if (await pathExists(contractPath)) {
    try {
      const contractResult = await expandAffectedWithContract(
        workspacePath,
        projects,
        initialAffected,
        contractPath
      );
      if (contractResult.graphStatus !== 'missing') {
        return contractResult;
      }
    } catch {
      return { expanded: initialAffected, graphStatus: 'invalid', expansionDepth: 0 };
    }
  }

  const graphPath =
    (await firstExistingWorkspaceArtifactPath(
      workspacePath,
      '.workspai/workspace-dependency-graph.json'
    )) ?? workspaceMetadataPath(workspacePath, 'workspace-dependency-graph.json');
  if (!(await pathExists(graphPath))) {
    return { expanded: initialAffected, graphStatus: 'missing', expansionDepth: 0 };
  }

  let payload: unknown;
  try {
    payload = await readJsonFile(graphPath);
  } catch {
    return { expanded: initialAffected, graphStatus: 'invalid', expansionDepth: 0 };
  }

  const knownProjects = new Set(projects.map((projectPath) => path.resolve(projectPath)));
  const reverseDeps = new Map<string, Set<string>>();

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { expanded: initialAffected, graphStatus: 'invalid', expansionDepth: 0 };
  }

  const projectEntries = Array.isArray((payload as Record<string, unknown>).projects)
    ? ((payload as Record<string, unknown>).projects as unknown[])
    : [];

  for (const entry of projectEntries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const rawPath = typeof row.path === 'string' ? row.path : '';
    const sourceProject = path.resolve(workspacePath, rawPath);
    if (!knownProjects.has(sourceProject)) {
      continue;
    }

    const dependsOn = Array.isArray(row.dependsOn)
      ? row.dependsOn.filter((item): item is string => typeof item === 'string')
      : [];

    for (const dep of dependsOn) {
      const dependencyProject = path.resolve(workspacePath, dep);
      if (!knownProjects.has(dependencyProject)) {
        continue;
      }
      if (!reverseDeps.has(dependencyProject)) {
        reverseDeps.set(dependencyProject, new Set<string>());
      }
      reverseDeps.get(dependencyProject)?.add(sourceProject);
    }
  }

  const closure = closureFromAdjacency(reverseDeps, initialAffected);
  return { expanded: closure.reached, graphStatus: 'loaded', expansionDepth: closure.added };
}

async function expandAffectedWithContract(
  workspacePath: string,
  projects: string[],
  initialAffected: Set<string>,
  contractPath: string
): Promise<BlastRadiusResult> {
  const payload = await readJsonFile<unknown>(contractPath);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { expanded: initialAffected, graphStatus: 'invalid', expansionDepth: 0 };
  }

  const contract = payload as Record<string, unknown>;
  const projectEntries = Array.isArray(contract.projects) ? contract.projects : null;
  if (!projectEntries) {
    return { expanded: initialAffected, graphStatus: 'invalid', expansionDepth: 0 };
  }

  const projectBySlug = new Map<string, string>();
  const projectByPath = new Map<string, string>();
  for (const projectPath of projects) {
    const relativePath = normalizePathForMatch(path.relative(workspacePath, projectPath));
    projectByPath.set(relativePath, path.resolve(projectPath));
  }

  const publishes = new Map<string, Set<string>>();
  const consumersByEvent = new Map<string, Set<string>>();
  const reverseDeps = new Map<string, Set<string>>();

  for (const entry of projectEntries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const relativePath =
      typeof row.relativePath === 'string' ? normalizePathForMatch(row.relativePath) : slug;
    const projectPath = projectByPath.get(relativePath);
    if (!slug || !projectPath) continue;
    projectBySlug.set(slug, projectPath);
  }

  for (const entry of projectEntries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const sourceProject = projectBySlug.get(slug);
    if (!sourceProject) continue;

    const contracts =
      row.contracts && typeof row.contracts === 'object' && !Array.isArray(row.contracts)
        ? (row.contracts as Record<string, unknown>)
        : {};
    const dependsOn = Array.isArray(contracts.dependsOn)
      ? contracts.dependsOn.filter((item): item is string => typeof item === 'string')
      : [];
    const publishesEvents = Array.isArray(contracts.publishes)
      ? contracts.publishes.filter((item): item is string => typeof item === 'string')
      : [];
    const consumesEvents = Array.isArray(contracts.consumes)
      ? contracts.consumes.filter((item): item is string => typeof item === 'string')
      : [];

    for (const dependencySlug of dependsOn) {
      const dependencyProject = projectBySlug.get(dependencySlug);
      if (!dependencyProject) continue;
      if (!reverseDeps.has(dependencyProject)) {
        reverseDeps.set(dependencyProject, new Set<string>());
      }
      reverseDeps.get(dependencyProject)?.add(sourceProject);
    }

    for (const eventName of publishesEvents) {
      if (!publishes.has(eventName)) {
        publishes.set(eventName, new Set<string>());
      }
      publishes.get(eventName)?.add(sourceProject);
    }
    for (const eventName of consumesEvents) {
      if (!consumersByEvent.has(eventName)) {
        consumersByEvent.set(eventName, new Set<string>());
      }
      consumersByEvent.get(eventName)?.add(sourceProject);
    }
  }

  for (const [eventName, publisherProjects] of publishes.entries()) {
    const consumerProjects = consumersByEvent.get(eventName);
    if (!consumerProjects) continue;
    for (const publisherProject of publisherProjects) {
      if (!reverseDeps.has(publisherProject)) {
        reverseDeps.set(publisherProject, new Set<string>());
      }
      for (const consumerProject of consumerProjects) {
        if (consumerProject !== publisherProject) {
          reverseDeps.get(publisherProject)?.add(consumerProject);
        }
      }
    }
  }

  const closure = closureFromAdjacency(reverseDeps, initialAffected);
  return { expanded: closure.reached, graphStatus: 'loaded', expansionDepth: closure.added };
}

async function shouldEnforceWorkspaceRunGates(
  workspacePath: string,
  explicitFlag: boolean | undefined
): Promise<boolean> {
  if (typeof explicitFlag === 'boolean') {
    return explicitFlag;
  }

  const policyPath =
    workspaceMetadataCandidates(workspacePath, 'policies.yml').find((candidate) =>
      fs.existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'policies.yml');
  if (!(await pathExists(policyPath))) {
    return true;
  }

  let raw = '';
  try {
    raw = await fs.promises.readFile(policyPath, 'utf-8');
  } catch {
    return true;
  }

  const match = raw.match(/^[\t ]*rules\.enforce_workspace_run_gates:\s*(true|false)\s*(?:#.*)?$/m);
  if (!match) {
    return true;
  }

  return match[1] === 'true';
}

function resolveWorkspaceRunStageTimeoutMs(stage: string): number {
  const raw = process.env.RAPIDKIT_WORKSPACE_RUN_STAGE_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return stage === 'init' ? 120_000 : 90_000;
}

function resolvePositiveDuration(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type StartupSubprocessResult = {
  exitCode?: number | null;
  stdout?: unknown;
  stderr?: unknown;
  timedOut?: boolean;
};

type StartupSubprocess = Promise<StartupSubprocessResult> & {
  kill?: (signal?: NodeJS.Signals, options?: { forceKillAfterDelay?: number }) => boolean;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStartupSmoke(input: {
  projectPath: string;
  finalCommand: string;
  useRapidkitWrapper: boolean;
  runtime: RuntimeFamily;
  framework?: string;
  timeoutMs: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  healthStatus: { healthy: boolean; reason?: string };
  timedOut?: boolean;
}> {
  const entrypoint = process.argv[1];
  if (input.useRapidkitWrapper && !entrypoint) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Workspai entrypoint is unavailable for startup verification.',
      healthStatus: { healthy: false, reason: 'Workspai entrypoint is unavailable.' },
    };
  }

  const subprocess = (input.useRapidkitWrapper && entrypoint
    ? execa(process.execPath, [entrypoint, 'start'], {
        cwd: input.projectPath,
        reject: false,
        timeout: input.timeoutMs,
        env: {
          ...process.env,
          RAPIDKIT_WORKSPACE_RUN_CHILD: '1',
        },
      })
    : execa(input.finalCommand, [], {
        cwd: input.projectPath,
        reject: false,
        shell: true,
        timeout: input.timeoutMs,
      })) as unknown as StartupSubprocess;

  const completion = Promise.resolve(subprocess).then(
    (result) => ({ kind: 'exit' as const, result }),
    (error: unknown) => ({ kind: 'error' as const, error })
  );
  const startupGraceMs = resolvePositiveDuration('WORKSPAI_WORKSPACE_RUN_STARTUP_GRACE_MS', 2_000);
  const initial = await Promise.race([
    completion,
    delay(startupGraceMs).then(() => ({ kind: 'alive' as const })),
  ]);

  if (initial.kind === 'error') {
    const timedOut =
      typeof initial.error === 'object' &&
      initial.error !== null &&
      'timedOut' in initial.error &&
      Boolean((initial.error as { timedOut?: unknown }).timedOut);
    return {
      exitCode: timedOut ? 124 : 1,
      stdout: '',
      stderr: initial.error instanceof Error ? initial.error.message : String(initial.error),
      timedOut,
      healthStatus: { healthy: false, reason: 'The start command failed before readiness.' },
    };
  }
  if (initial.kind === 'exit') {
    const exitCode = Number(initial.result.exitCode ?? 0);
    return {
      exitCode,
      stdout: String(initial.result.stdout ?? ''),
      stderr: String(initial.result.stderr ?? ''),
      healthStatus: {
        healthy: exitCode === 0,
        reason:
          exitCode === 0
            ? 'The start command completed successfully.'
            : `The start command exited with code ${exitCode} before readiness.`,
      },
    };
  }

  const healthConfig = resolveFrameworkRegistryEntry(input.runtime, input.framework)?.healthCheck;
  let healthStatus: { healthy: boolean; reason?: string } = healthConfig
    ? { healthy: false, reason: 'The configured health check has not passed yet.' }
    : {
        healthy: true,
        reason: `The service remained alive for ${startupGraceMs}ms (bounded startup smoke).`,
      };

  if (healthConfig) {
    const healthTimeoutMs = resolvePositiveDuration(
      'WORKSPAI_WORKSPACE_RUN_STARTUP_HEALTH_TIMEOUT_MS',
      15_000
    );
    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      const probe = await checkHealth(healthConfig, input.projectPath);
      healthStatus = { healthy: probe.healthy, reason: probe.reason };
      if (probe.healthy) {
        break;
      }
      const processState = await Promise.race([
        completion,
        delay(350).then(() => ({ kind: 'alive' as const })),
      ]);
      if (processState.kind !== 'alive') {
        healthStatus = {
          healthy: false,
          reason: 'The service exited before its configured health check passed.',
        };
        break;
      }
    }
  }

  try {
    subprocess.kill?.('SIGTERM', { forceKillAfterDelay: 1_000 });
  } catch {
    try {
      subprocess.kill?.();
    } catch {
      // Best-effort cleanup. The command timeout remains the final safety net.
    }
  }
  const settled = await Promise.race([
    completion,
    delay(2_000).then(() => ({ kind: 'alive' as const })),
  ]);
  const result = settled.kind === 'exit' ? settled.result : undefined;
  return {
    exitCode: healthStatus.healthy ? 0 : 1,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
    healthStatus,
  };
}

async function runRapidkitSelfCommand(args: string[], cwd: string, timeoutMs?: number) {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'RapidKit entrypoint is unavailable for nested workspace-run execution.',
    };
  }

  try {
    const result = await execa(process.execPath, [entrypoint, ...args], {
      cwd,
      reject: false,
      timeout: timeoutMs,
      env: {
        ...process.env,
        RAPIDKIT_WORKSPACE_RUN_CHILD: '1',
      },
    });

    return {
      exitCode: Number(result.exitCode ?? 1),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const timedOut =
      typeof error === 'object' &&
      error !== null &&
      'timedOut' in error &&
      Boolean((error as { timedOut?: unknown }).timedOut);
    return {
      exitCode: timedOut ? 124 : 1,
      stdout:
        typeof error === 'object' && error !== null && 'stdout' in error
          ? String((error as { stdout?: unknown }).stdout ?? '')
          : '',
      stderr:
        typeof error === 'object' && error !== null && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

function isWrapperOwnedRuntime(runtime: RuntimeFamily): boolean {
  return (
    runtime === 'node' ||
    runtime === 'go' ||
    runtime === 'java' ||
    runtime === 'python' ||
    runtime === 'dotnet' ||
    runtime === 'rust' ||
    runtime === 'php'
  );
}

function isVitestRuntime(): boolean {
  return (
    process.env.VITEST === 'true' || process.env.VITEST === '1' || process.env.NODE_ENV === 'test'
  );
}

function boundedFailureOutput(lines: string[], limit = 8): string {
  if (lines.length <= limit) return lines.join('\n');
  const headCount = 3;
  return [...lines.slice(0, headCount), ...lines.slice(-(limit - headCount))].join('\n');
}

function primaryFailureLine(lines: string[]): string | undefined {
  const failureSignal =
    /(?:\bnot found\b|\bno such\b|\bmissing\b|\bfailed\b|\berror\b|\bexception\b|\bcannot\b|\bdenied\b|\btimeout\b|\btimed out\b|\benoent\b|\beacces\b|\beperm\b)/i;
  return [...lines].reverse().find((line) => failureSignal.test(line)) ?? lines.at(-1);
}

async function runRapidkitInitInProcess(cwd: string) {
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    const { handleInitCommand } = await import('./index.js');
    const exitCode = await handleInitCommand(['init']);
    return {
      exitCode,
      stdout: '',
      stderr: '',
    };
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Detect project framework from metadata and file markers.
 * Reads .workspai/context.json for explicit configuration, with legacy metadata fallback.
 * Also extracts command overrides and environment configuration.
 */
async function detectProjectFramework(projectPath: string): Promise<{
  runtime: RuntimeFamily;
  framework?: string;
  commandOverrides?: Record<string, string>;
  environmentCommandVariants?: EnvironmentVariant;
  environment?: 'dev' | 'staging' | 'prod';
}> {
  const toWorkspaceRuntime = (runtime: string | undefined): RuntimeFamily => {
    const canonicalRuntime = normalizeBackendRuntimeFamily(runtime);
    if (canonicalRuntime === 'node' || canonicalRuntime === 'bun') return 'node';
    if (canonicalRuntime === 'python') return 'python';
    if (canonicalRuntime === 'go') return 'go';
    if (canonicalRuntime === 'java') return 'java';
    if (canonicalRuntime === 'php') return 'php';
    if (canonicalRuntime === 'ruby') return 'ruby';
    if (canonicalRuntime === 'rust') return 'rust';
    if (canonicalRuntime === 'dotnet') return 'dotnet';
    if (canonicalRuntime === 'elixir') return 'elixir';
    if (
      canonicalRuntime === 'clojure' ||
      canonicalRuntime === 'scala' ||
      canonicalRuntime === 'kotlin'
    ) {
      return 'jvm-generic';
    }

    const markerRuntime = detectRuntimeFromMarkers(projectPath);
    return markerRuntime;
  };

  const toWorkspaceFramework = (framework: string | undefined): string | undefined => {
    if (!framework) {
      return undefined;
    }

    const canonicalFramework = normalizeBackendFrameworkLabel(framework);
    const specificFrameworks = new Set<BackendPlatformKey>([
      'fastapi',
      'django',
      'flask',
      'nestjs',
      'express',
      'fastify',
      'koa',
      'gofiber',
      'gogin',
      'echo',
      'springboot',
      'laravel',
      'symfony',
      'rails',
      'sinatra',
      'dotnet',
      'actix',
      'axum',
      'rocket',
      'phoenix',
    ]);

    if (specificFrameworks.has(canonicalFramework)) {
      return canonicalFramework;
    }

    return undefined;
  };

  const metadata = readProjectMetadata(projectPath);
  const detection =
    metadata?.detection ??
    detectBackendFrameworkFromProject(projectPath, metadata?.projectJson ?? null);
  const context = metadata?.contextJson;
  const runtime = toWorkspaceRuntime(detection.runtime);
  const framework = toWorkspaceFramework(detection.key);

  const commandOverrides: Record<string, string> = {};
  const stageKeys = new Set(['init', 'test', 'build', 'start']);
  if (context?.commands && typeof context.commands === 'object') {
    for (const [key, val] of Object.entries(context.commands as Record<string, unknown>)) {
      if (typeof val === 'string' && stageKeys.has(key)) {
        commandOverrides[key] = val;
      }
    }
  }

  let environmentCommandVariants: EnvironmentVariant | undefined;
  if (context?.commandEnvironments && typeof context.commandEnvironments === 'object') {
    const variants = context.commandEnvironments as Record<string, unknown>;
    environmentCommandVariants = {
      dev: typeof variants.dev === 'string' ? variants.dev : undefined,
      staging: typeof variants.staging === 'string' ? variants.staging : undefined,
      prod: typeof variants.prod === 'string' ? variants.prod : undefined,
      default: typeof variants.default === 'string' ? variants.default : undefined,
    };
  }

  return {
    runtime,
    framework,
    commandOverrides: Object.keys(commandOverrides).length > 0 ? commandOverrides : undefined,
    environmentCommandVariants,
    environment:
      typeof context?.environment === 'string'
        ? (context.environment as 'dev' | 'staging' | 'prod')
        : undefined,
  };
}

/**
 * Execute a stage command with enterprise features:
 * - Command override support
 * - Preflight validation
 * - Error categorization
 * - Health checks
 */
async function executeStageCommand(
  projectPath: string,
  stage: string,
  runtime: RuntimeFamily,
  framework?: string,
  commandOverrides?: Record<string, string>,
  environmentCommandVariants?: EnvironmentVariant,
  environment?: 'dev' | 'staging' | 'prod'
): Promise<{
  exitCode: number;
  command: string;
  message?: string;
  errorCategory?: ErrorCategory;
  healthStatus?: { healthy: boolean; reason?: string };
  failureDiagnostic?: ProjectExecutionResult['failureDiagnostic'];
}> {
  const useRapidkitWrapper = !commandOverrides?.[stage] && isWrapperOwnedRuntime(runtime);

  // Step 0: Resolve the command, checking overrides first
  let baseCommand: string | undefined;

  // Check if override exists for this stage
  if (commandOverrides && commandOverrides[stage]) {
    baseCommand = commandOverrides[stage];
  } else if (useRapidkitWrapper) {
    // For npm adapters, use 'rapidkit' wrapper
    baseCommand = `rapidkit ${stage}`;
  } else {
    baseCommand = resolveWorkspaceStageCommand({
      projectPath,
      runtime,
      framework,
      stage,
    });
  }

  if (!baseCommand) {
    return {
      exitCode: 127,
      command: `<stage not supported for ${runtime}>`,
      message: `No stage command found for runtime '${runtime}' and framework '${framework || 'unknown'}'`,
      errorCategory: 'runtime',
    };
  }

  const finalCommand = applyEnvironmentCommandVariant(
    baseCommand,
    environmentCommandVariants,
    environment
  );
  if (!finalCommand) {
    return {
      exitCode: 127,
      command: baseCommand,
      message: 'Failed to resolve stage command',
      errorCategory: 'runtime',
    };
  }

  // Step 1: Preflight validation
  const nativeStageCommand = resolveWorkspaceStageCommand({
    projectPath,
    runtime,
    framework,
    stage,
  });

  if (!useRapidkitWrapper) {
    const validation = await validateCommand(finalCommand);
    if (!validation.valid) {
      return {
        exitCode: 127,
        command: finalCommand,
        message: validation.reason || 'Command not available',
        errorCategory: 'setup',
      };
    }
  } else if (nativeStageCommand) {
    const validation = useRapidkitWrapper
      ? await validateWrapperStagePreflight(projectPath, runtime, nativeStageCommand)
      : await validateCommand(nativeStageCommand);
    if (!validation.valid) {
      return {
        exitCode: 127,
        command: finalCommand,
        message: validation.reason || 'Command not available',
        errorCategory: 'setup',
      };
    }
  }

  // Step 2: Execute the command
  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  let errorCategory: ErrorCategory | undefined;
  let healthStatus: { healthy: boolean; reason?: string } | undefined;
  const timeoutMs = resolveWorkspaceRunStageTimeoutMs(stage);
  const startedAt = Date.now();

  try {
    const result =
      stage === 'start'
        ? await runStartupSmoke({
            projectPath,
            finalCommand,
            useRapidkitWrapper,
            runtime,
            framework,
            timeoutMs,
          })
        : useRapidkitWrapper
          ? stage === 'init' && isVitestRuntime()
            ? await runRapidkitInitInProcess(projectPath)
            : await runRapidkitSelfCommand([stage], projectPath, timeoutMs)
          : await execa(finalCommand, [], {
              cwd: projectPath,
              reject: false,
              shell: true,
              timeout: timeoutMs,
            });

    exitCode = Number(result.exitCode ?? 0);
    stdout = result.stdout;
    stderr = result.stderr;
    healthStatus =
      stage === 'start'
        ? (result as { healthStatus?: { healthy: boolean; reason?: string } }).healthStatus
        : undefined;

    // Categorize error if non-zero exit
    if (exitCode !== 0) {
      const output = `${stdout}\n${stderr}`;
      const durationMs = Date.now() - startedAt;
      const timedOut =
        exitCode === 124 ||
        categorizeError(output) === 'timeout' ||
        (exitCode === 143 && durationMs >= Math.floor(timeoutMs * 0.8));
      errorCategory = timedOut ? 'timeout' : categorizeError(output);
    }
  } catch (error) {
    const timedOut =
      typeof error === 'object' &&
      error !== null &&
      'timedOut' in error &&
      Boolean((error as { timedOut?: unknown }).timedOut);
    return {
      exitCode: timedOut ? 124 : 1,
      command: finalCommand,
      message: timedOut
        ? `Stage timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Command execution failed',
      errorCategory: timedOut ? 'timeout' : 'runtime',
    };
  }

  // Step 3: Health check (if configured)
  const combinedOutput = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const outputExcerpt = boundedFailureOutput(combinedOutput);
  const failureSummary = primaryFailureLine(combinedOutput);
  const durationMs = Date.now() - startedAt;
  const timedOut =
    exitCode === 124 ||
    errorCategory === 'timeout' ||
    (exitCode === 143 && durationMs >= Math.floor(timeoutMs * 0.8));
  const normalizedCategory = exitCode === 0 ? undefined : timedOut ? 'timeout' : errorCategory;
  const failureDiagnostic =
    exitCode === 0 || !normalizedCategory
      ? undefined
      : {
          category: normalizedCategory,
          exitCode,
          command: finalCommand,
          timedOut,
          timeoutMs,
          ...(outputExcerpt ? { outputExcerpt } : {}),
        };

  return {
    exitCode,
    command: finalCommand,
    errorCategory: normalizedCategory,
    healthStatus,
    failureDiagnostic,
    message: timedOut
      ? `Stage timed out after ${timeoutMs}ms`
      : exitCode !== 0
        ? failureSummary
          ? `Stage failed with exit code ${exitCode}: ${failureSummary}`
          : `Stage failed with exit code ${exitCode}`
        : undefined,
  };
}

function parseJsonOutput<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function runtimeInstallHint(runtime: RuntimeFamily | undefined): string | null {
  switch (runtime) {
    case 'dotnet':
      return 'Install .NET 8+ SDK, then rerun `npx workspai setup dotnet` or `npx workspai init`.';
    case 'go':
      return 'Install Go 1.21+, then rerun `npx workspai setup go` or `npx workspai init`.';
    case 'java':
    case 'jvm-generic':
      return 'Install Java 21+ and Maven/Gradle, then rerun `npx workspai setup java` or `npx workspai init`.';
    case 'node':
      return 'Install Node.js LTS and npm/pnpm/yarn, then rerun `npx workspai setup node` or `npx workspai init`.';
    case 'python':
      return 'Install Python 3.10+ and pip/Poetry, then rerun `npx workspai setup python` or `npx workspai init`.';
    default:
      return null;
  }
}

async function runWorkspaceGates(workspacePath: string): Promise<GateResult[]> {
  const gates: GateResult[] = [];

  const doctor = await runRapidkitSelfCommand(['doctor', 'workspace', '--json'], workspacePath);
  if (doctor.exitCode !== 0) {
    gates.push({
      gate: 'doctor-workspace',
      status: 'fail',
      summary: 'doctor workspace command failed',
    });
  } else {
    const payload = parseJsonOutput<Record<string, unknown>>(doctor.stdout);
    const health = payload?.healthScore as Record<string, unknown> | undefined;
    const errors = Number(health?.errors ?? 0);
    if (Number.isFinite(errors) && errors > 0) {
      gates.push({
        gate: 'doctor-workspace',
        status: 'fail',
        summary: `doctor workspace reports ${errors} error(s)`,
      });
    } else {
      gates.push({
        gate: 'doctor-workspace',
        status: 'pass',
        summary: 'doctor workspace passed',
      });
    }
  }

  const readiness = await runRapidkitSelfCommand(['readiness', '--json'], workspacePath);
  if (readiness.exitCode !== 0) {
    gates.push({
      gate: 'readiness',
      status: 'fail',
      summary: 'readiness command failed',
    });
  } else {
    const payload = parseJsonOutput<Record<string, unknown>>(readiness.stdout);
    const overallStatus = String(payload?.overallStatus ?? '').toLowerCase();
    if (overallStatus === 'fail') {
      gates.push({
        gate: 'readiness',
        status: 'fail',
        summary: 'readiness overall status is fail',
      });
    } else if (overallStatus === 'warn') {
      gates.push({
        gate: 'readiness',
        status: 'warn',
        summary: 'readiness overall status is warn',
      });
    } else {
      gates.push({
        gate: 'readiness',
        status: 'pass',
        summary: 'readiness overall status is pass',
      });
    }
  }

  return gates;
}

const RESERVED_NON_FLEET_STAGES = new Set(['dev', 'stop']);

function ensureRunnableStage(stage: string): boolean {
  const normalized = stage.trim();
  if (!normalized) {
    return false;
  }
  if (RESERVED_NON_FLEET_STAGES.has(normalized.toLowerCase())) {
    return false;
  }
  if (STAGE_SET.has(normalized as WorkspaceRunStage)) {
    return true;
  }
  return /^[a-z][a-z0-9_-]*$/i.test(normalized);
}

function projectPassedStageReport(
  stageReport: WorkspaceRunReport,
  projectPath: string,
  workspacePath: string
): boolean {
  const relativePath = normalizePathForMatch(path.relative(workspacePath, projectPath));
  const projects = Array.isArray(stageReport.projects) ? stageReport.projects : [];
  return projects.some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const record = entry as ProjectExecutionResult;
    const candidates = [record.relativePath, record.path]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => normalizePathForMatch(value));
    return (
      record.status === 'passed' &&
      (candidates.includes(relativePath) ||
        candidates.some((candidate) => candidate.endsWith(`/${relativePath}`)))
    );
  });
}

function resolveStageDependencies(
  runtime: RuntimeFamily,
  framework?: string
): WorkspaceRunStageName[] {
  const entry = resolveFrameworkRegistryEntry(runtime, framework);
  return (entry?.dependencies ?? []) as WorkspaceRunStageName[];
}

function normalizeWorkers(maxWorkers: number | undefined, projectCount: number): number {
  const fallback = Math.max(1, Math.min(4, projectCount));
  const parsed = Number(maxWorkers ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(16, Math.trunc(parsed)));
}

export async function runWorkspaceStage(options: WorkspaceRunOptions): Promise<WorkspaceRunReport> {
  if (!ensureRunnableStage(options.stage)) {
    throw new Error(`Unsupported workspace run stage: ${options.stage}`);
  }

  const startedAt = Date.now();
  const workspacePath = path.resolve(options.workspacePath);
  const cachedEvidence = await readWorkspaceRunEvidence(workspacePath);
  const projectPaths = await discoverWorkspaceProjects(workspacePath);
  const { projects: scopedProjectPaths, normalizedScope } = await filterProjectsByScope(
    workspacePath,
    projectPaths,
    options.scope
  );

  const affectedOnly = options.affected === true;
  const blastRadius = options.blastRadius === true;
  const since = options.since?.trim() || 'HEAD~1';
  const initialAffectedProjects = affectedOnly
    ? await computeAffectedProjects(workspacePath, scopedProjectPaths, since)
    : new Set(scopedProjectPaths);

  let affectedProjects: Set<string>;
  let graphStatus: GraphStatus = 'not-applicable';
  let expansionDepth = 0;
  let selectionMode: SelectionMode = 'all';

  if (affectedOnly && blastRadius) {
    const result = await expandAffectedWithBlastRadius(
      workspacePath,
      projectPaths,
      initialAffectedProjects
    );
    affectedProjects = result.expanded;
    graphStatus = result.graphStatus;
    expansionDepth = result.expansionDepth;
    selectionMode = 'affected+blast-radius';
  } else if (affectedOnly) {
    affectedProjects = initialAffectedProjects;
    selectionMode = 'affected';
  } else {
    affectedProjects = initialAffectedProjects;
    selectionMode = 'all';
  }

  const enforceGates =
    options.stage === 'init' || options.planOnly === true
      ? false
      : await shouldEnforceWorkspaceRunGates(workspacePath, options.enforceGates);
  const gateResults: GateResult[] = enforceGates
    ? await runWorkspaceGates(workspacePath)
    : [
        {
          gate: 'doctor-workspace',
          status: 'skipped',
          summary: 'workspace run gates disabled',
        },
        {
          gate: 'readiness',
          status: 'skipped',
          summary: 'workspace run gates disabled',
        },
      ];
  const blockingGate = gateResults.find((gate) => gate.status === 'fail');

  const runTargets = scopedProjectPaths.filter((projectPath) => affectedProjects.has(projectPath));
  const continueOnError = options.continueOnError === true || options.stage === 'init';
  const parallel = options.parallel === true;
  const maxWorkers = normalizeWorkers(options.maxWorkers, runTargets.length);
  const totalTargets = runTargets.length;
  let completedTargets = 0;

  if (!options.json) {
    console.log(
      chalk.gray(
        `Workspace run (${options.stage}) started: ${totalTargets} target(s), ${parallel ? `parallel x${maxWorkers}` : 'sequential'}`
      )
    );
  }

  const executionRows = new Map<string, ProjectExecutionResult>();
  for (const projectPath of projectPaths) {
    const relativePath = normalizePathForMatch(path.relative(workspacePath, projectPath));
    const insideScope = scopedProjectPaths.includes(projectPath);
    const selected = insideScope && affectedProjects.has(projectPath);
    executionRows.set(projectPath, {
      path: projectPath,
      relativePath,
      projectName: path.basename(relativePath) || path.basename(projectPath),
      selected,
      affected: selected,
      status: 'skipped',
      exitCode: null,
      durationMs: 0,
      reason: selected ? undefined : insideScope ? 'not affected' : 'outside scope',
      framework: undefined,
      runtimeDetected: undefined,
      executionCommand: undefined,
    });
  }

  if (blockingGate) {
    for (const projectPath of runTargets) {
      const row = executionRows.get(projectPath);
      if (row) {
        row.status = 'skipped';
        row.reason = `blocked by ${blockingGate.gate}`;
      }
    }
  } else {
    const runOne = async (projectPath: string): Promise<void> => {
      const row = executionRows.get(projectPath);
      if (!row) {
        return;
      }

      const relativePath = normalizePathForMatch(path.relative(workspacePath, projectPath));

      if (!options.json) {
        console.log(
          chalk.gray(`⏳ [${completedTargets}/${totalTargets}] ${options.stage} ${relativePath}`)
        );
      }

      row.selected = true;
      row.affected = true;
      const started = Date.now();

      const lifecyclePlan = buildPolyglotLifecyclePlan(projectPath);
      const runtimeFilter = options.runtime?.trim().toLowerCase();
      const plannedUnits = lifecyclePlan.units
        .filter((unit) => !runtimeFilter || unit.runtime === runtimeFilter)
        .map((unit) => ({
          unit,
          stage: unit.stages.find((candidate) => candidate.stage === options.stage),
        }))
        .filter(
          (
            entry
          ): entry is { unit: PolyglotRuntimeUnit; stage: PolyglotRuntimeUnit['stages'][number] } =>
            Boolean(entry.stage)
        );
      const runtimeExecutions: NonNullable<ProjectExecutionResult['runtimeExecutions']> =
        plannedUnits.map(({ unit, stage }) => ({
          unitId: unit.id,
          runtime: unit.runtime,
          role: unit.role,
          root: unit.root,
          manifest: unit.manifest,
          stage: stage.stage,
          command: stage.command,
          status: 'planned',
          exitCode: null,
          durationMs: 0,
        }));
      row.runtimeExecutions = runtimeExecutions;

      if (options.planOnly) {
        row.runtimeDetected = plannedUnits[0]?.unit.runtime;
        row.status = 'skipped';
        row.reason =
          plannedUnits.length > 0
            ? `plan only: ${plannedUnits.length} runtime unit(s)`
            : runtimeFilter
              ? `no ${runtimeFilter} runtime unit supports stage "${options.stage}"`
              : `no runtime unit supports stage "${options.stage}"`;
        row.durationMs = Date.now() - started;
        completedTargets += 1;
        return;
      }

      if (lifecyclePlan.polyglot || runtimeFilter) {
        if (plannedUnits.length === 0) {
          row.status = 'failed';
          row.reason = runtimeFilter
            ? `No ${runtimeFilter} runtime unit supports stage "${options.stage}"`
            : `No runtime unit supports stage "${options.stage}"`;
          row.errorCategory = 'setup';
          row.errorMessage = row.reason;
          row.exitCode = 127;
          row.durationMs = Date.now() - started;
          completedTargets += 1;
          return;
        }

        let firstFailure: string | undefined;
        for (let unitIndex = 0; unitIndex < plannedUnits.length; unitIndex += 1) {
          const { unit, stage } = plannedUnits[unitIndex];
          const execution = runtimeExecutions[unitIndex];
          const unitPath = path.resolve(projectPath, unit.root);
          const unitStarted = Date.now();
          const detected = await detectProjectFramework(unitPath);
          const result = await executeStageCommand(
            unitPath,
            options.stage,
            unit.runtime,
            detected.framework,
            { [options.stage]: stage.command },
            detected.environmentCommandVariants,
            detected.environment
          );
          execution.durationMs = Date.now() - unitStarted;
          execution.exitCode = result.exitCode;
          execution.status = result.exitCode === 0 ? 'passed' : 'failed';
          execution.reason = result.message;
          if (result.exitCode !== 0 && !firstFailure)
            firstFailure = result.message ?? stage.command;
          if (result.exitCode !== 0 && !continueOnError) {
            for (const pending of runtimeExecutions.slice(unitIndex + 1)) {
              pending.status = 'skipped';
              pending.reason = 'stopped after runtime-unit failure';
            }
            break;
          }
        }
        const failedUnit = runtimeExecutions.find((execution) => execution.status === 'failed');
        row.runtimeDetected = plannedUnits[0]?.unit.runtime;
        row.executionCommand = runtimeExecutions
          .filter((execution) => execution.status !== 'skipped')
          .map((execution) => `[${execution.runtime}:${execution.root}] ${execution.command}`)
          .join(' && ');
        row.durationMs = Date.now() - started;
        row.exitCode = failedUnit?.exitCode ?? 0;
        row.status = failedUnit ? 'failed' : 'passed';
        row.reason = failedUnit ? (firstFailure ?? 'runtime-unit stage failed') : undefined;
        row.errorCategory = failedUnit ? 'runtime' : undefined;
        row.errorMessage = row.reason;
        completedTargets += 1;
        return;
      }

      // Detect framework and runtime for this project (with overrides)
      const { runtime, framework, commandOverrides, environmentCommandVariants, environment } =
        await detectProjectFramework(projectPath);
      row.runtimeDetected = runtime;
      row.framework = framework;

      const stageSupport = isWorkspaceStageSupported(projectPath, options.stage);
      if (!stageSupport.supported) {
        row.status = stageSupport.shouldFail === false ? 'skipped' : 'failed';
        row.reason = stageSupport.reason ?? `stage "${options.stage}" unsupported for project`;
        row.durationMs = Date.now() - started;
        row.exitCode = row.status === 'failed' ? 127 : null;
        if (row.status === 'failed') {
          row.errorCategory = 'setup';
          row.errorMessage = row.reason;
        }
        completedTargets += 1;
        return;
      }

      if (options.reusePassed && cachedEvidence) {
        const priorStage =
          cachedEvidence.stages[options.stage as WorkspaceRunStage] ??
          (cachedEvidence.stages as Record<string, WorkspaceRunReport | undefined>)[options.stage];
        if (priorStage && projectPassedStageReport(priorStage, projectPath, workspacePath)) {
          row.status = 'passed';
          row.reason = 'reused passed result from workspace-run-last.json';
          row.durationMs = Date.now() - started;
          row.exitCode = 0;
          completedTargets += 1;
          if (!options.json) {
            console.log(chalk.gray(`↺ reused passed cache for ${relativePath}`));
          }
          return;
        }
      }

      // Framework dependencies describe prerequisites for later lifecycle
      // stages (for example test/build require init). A stage can never be its
      // own prerequisite; otherwise the presence of any cached run artifact
      // makes the first init permanently unreachable.
      const dependencyStages = resolveStageDependencies(runtime, framework).filter(
        (dependencyStage) => dependencyStage !== options.stage
      );
      if (dependencyStages.length > 0 && cachedEvidence) {
        const missingDependency = dependencyStages.find((dependencyStage) => {
          const dependencyReport = cachedEvidence.stages[dependencyStage];
          return (
            !dependencyReport ||
            !projectPassedStageReport(dependencyReport, projectPath, workspacePath)
          );
        });
        if (missingDependency) {
          row.status = 'skipped';
          row.reason = `dependency stage "${missingDependency}" not satisfied in workspace-run-last.json`;
          row.durationMs = Date.now() - started;
          row.exitCode = null;
          completedTargets += 1;
          return;
        }
      }

      // Execute stage command with enterprise features
      const execResult = await executeStageCommand(
        projectPath,
        options.stage,
        runtime,
        framework,
        commandOverrides,
        environmentCommandVariants,
        environment
      );
      row.executionCommand = execResult.command;
      row.errorCategory = execResult.errorCategory;
      row.healthStatus = execResult.healthStatus;
      row.failureDiagnostic = execResult.failureDiagnostic;
      row.durationMs = Date.now() - started;
      row.exitCode = execResult.exitCode;

      if (execResult.exitCode === 0) {
        row.status = 'passed';
        row.reason = undefined;
      } else {
        row.status = 'failed';
        row.reason = execResult.message || 'stage command failed';
        row.errorMessage = execResult.message;
      }

      completedTargets += 1;

      if (!options.json) {
        const percentage =
          totalTargets > 0 ? Math.round((completedTargets / totalTargets) * 100) : 100;
        const statusIcon = row.status === 'passed' ? chalk.green('✅') : chalk.red('❌');
        console.log(
          chalk.gray(
            `${statusIcon} [${completedTargets}/${totalTargets}] (${percentage}%) ${relativePath} ${row.durationMs}ms`
          )
        );
        if (row.status === 'failed') {
          if (row.reason) {
            console.log(chalk.red(`   Reason: ${row.reason}`));
          }
          if (row.executionCommand) {
            console.log(chalk.gray(`   Command: ${row.executionCommand}`));
          }
          const hint = runtimeInstallHint(row.runtimeDetected);
          if (hint && row.errorCategory === 'setup') {
            console.log(chalk.gray(`   Hint: ${hint}`));
          }
        }
      }
    };

    if (parallel && runTargets.length > 1) {
      let index = 0;
      let failed = false;
      const workers = new Array(maxWorkers).fill(null).map(async () => {
        while (index < runTargets.length) {
          if (failed && !continueOnError) {
            return;
          }

          const currentIndex = index;
          index += 1;
          const projectPath = runTargets[currentIndex];
          await runOne(projectPath);

          const row = executionRows.get(projectPath);
          if (row?.status === 'failed') {
            failed = true;
          }
        }
      });

      await Promise.all(workers);

      if (!continueOnError && failed) {
        let stop = false;
        for (const projectPath of runTargets) {
          const row = executionRows.get(projectPath);
          if (!row) continue;

          if (row.status === 'failed') {
            stop = true;
            continue;
          }

          if (stop && row.status === 'skipped') {
            row.reason = row.reason || 'stopped after failure';
          }
        }
      }
    } else {
      for (const projectPath of runTargets) {
        await runOne(projectPath);
        const row = executionRows.get(projectPath);
        if (!continueOnError && row?.status === 'failed') {
          const pending = runTargets.slice(runTargets.indexOf(projectPath) + 1);
          for (const pendingPath of pending) {
            const pendingRow = executionRows.get(pendingPath);
            if (pendingRow) {
              pendingRow.status = 'skipped';
              pendingRow.reason = 'stopped after failure';
            }
          }
          break;
        }
      }
    }
  }

  const rows: ProjectExecutionResult[] = [];
  for (const projectPath of projectPaths) {
    const row = executionRows.get(projectPath);
    if (!row) {
      continue;
    }
    rows.push(row);
  }
  const passed = rows.filter((row) => row.status === 'passed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const skipped = rows.filter((row) => row.status === 'skipped').length;

  const strict = options.strict === true;
  const exitCode =
    failed > 0 ||
    (strict && gateResults.some((gate) => gate.status === 'fail' || gate.status === 'warn'))
      ? 1
      : 0;

  const report: WorkspaceRunReport = {
    schemaVersion: '1.0',
    workspacePath,
    stage: options.stage,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    options: {
      affected: affectedOnly,
      blastRadius,
      since: affectedOnly ? since : null,
      parallel,
      maxWorkers,
      continueOnError,
      strict,
      enforceGates,
      scope: normalizedScope,
      reusePassed: options.reusePassed === true,
      planOnly: options.planOnly === true,
      runtime: options.runtime?.trim() || null,
    },
    selection: {
      mode: selectionMode,
      since: affectedOnly ? since : null,
      scope: normalizedScope,
      graphStatus,
      expansionDepth,
    },
    gates: {
      enforced: enforceGates,
      results: gateResults,
      blocked: Boolean(blockingGate),
      blockingGate: blockingGate?.gate,
    },
    summary: {
      projectCount: projectPaths.length,
      selectedCount: runTargets.length,
      passed,
      failed,
      skipped,
      exitCode,
    },
    projects: rows,
    enterpriseControls: {
      jsonReady: true,
      evidencePath: WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH,
    },
  };

  const reportPath = path.join(workspacePath, WORKSPACE_RUN_LAST_REPORT_RELATIVE_PATH);
  await publishWorkspaceRunStageReport(workspacePath, report);

  if (!options.json) {
    if (blockingGate) {
      console.log(chalk.red(`❌ Workspace run blocked by ${blockingGate.gate}`));
      console.log(chalk.gray(`   ${blockingGate.summary}`));
    }
    console.log(
      chalk.cyan(
        `Workspace run (${options.stage}) => passed: ${passed}, failed: ${failed}, skipped: ${skipped}`
      )
    );
    console.log(chalk.gray(`Report: ${reportPath}`));
  }

  return report;
}
