import fs from 'fs';
import path from 'path';

import fsExtra from 'fs-extra';

import { readImportedProjectsRegistry } from './imported-projects-registry.js';
import {
  detectBackendFrameworkFromProject,
  type BackendRuntimeFamily,
} from './utils/backend-framework-contract.js';
import { readRapidkitProjectJson } from './utils/runtime-detection.js';
import {
  hasWorkspaceRootMarkers,
  projectMetadataCandidates,
  workspaceMetadataCandidates,
} from './utils/workspace-paths.js';

export type WorkspaceProfile =
  | 'minimal'
  | 'python-only'
  | 'node-only'
  | 'go-only'
  | 'java-only'
  | 'dotnet-only'
  | 'polyglot'
  | 'enterprise';

export const WORKSPACE_PROFILES: readonly WorkspaceProfile[] = [
  'minimal',
  'python-only',
  'node-only',
  'go-only',
  'java-only',
  'dotnet-only',
  'polyglot',
  'enterprise',
] as const;

export const PYTHON_FREE_WORKSPACE_PROFILES: ReadonlySet<WorkspaceProfile> = new Set([
  'minimal',
  'node-only',
  'go-only',
  'java-only',
  'dotnet-only',
]);

export const PYTHON_CAPABLE_WORKSPACE_PROFILES: ReadonlySet<WorkspaceProfile> = new Set([
  'python-only',
  'polyglot',
  'enterprise',
]);

export type WorkspaceProfileDefinition = {
  id: WorkspaceProfile;
  runtimePolicy: 'single-detected' | 'bounded' | 'multi-runtime';
  runtimeFamilies: WorkspaceProfileRuntime[];
  setupRuntimeFamilies: WorkspaceProfileRuntime[];
  pythonEngineAtCreate: 'skipped' | 'optional-default-install';
  pythonEngineAtBootstrap: 'disabled' | 'on-demand';
};

/** Canonical profile semantics shared by Create, Bootstrap, contracts, and IDEs. */
export const WORKSPACE_PROFILE_DEFINITIONS: readonly WorkspaceProfileDefinition[] = [
  {
    id: 'minimal',
    runtimePolicy: 'single-detected',
    runtimeFamilies: [],
    setupRuntimeFamilies: [],
    pythonEngineAtCreate: 'skipped',
    pythonEngineAtBootstrap: 'on-demand',
  },
  {
    id: 'python-only',
    runtimePolicy: 'bounded',
    runtimeFamilies: ['python'],
    setupRuntimeFamilies: ['python'],
    pythonEngineAtCreate: 'optional-default-install',
    pythonEngineAtBootstrap: 'on-demand',
  },
  {
    id: 'node-only',
    runtimePolicy: 'bounded',
    runtimeFamilies: ['node'],
    setupRuntimeFamilies: ['node'],
    pythonEngineAtCreate: 'skipped',
    pythonEngineAtBootstrap: 'disabled',
  },
  {
    id: 'go-only',
    runtimePolicy: 'bounded',
    runtimeFamilies: ['go'],
    setupRuntimeFamilies: ['go'],
    pythonEngineAtCreate: 'skipped',
    pythonEngineAtBootstrap: 'disabled',
  },
  {
    id: 'java-only',
    runtimePolicy: 'bounded',
    runtimeFamilies: ['java'],
    setupRuntimeFamilies: ['java'],
    pythonEngineAtCreate: 'skipped',
    pythonEngineAtBootstrap: 'disabled',
  },
  {
    id: 'dotnet-only',
    runtimePolicy: 'bounded',
    runtimeFamilies: ['dotnet'],
    setupRuntimeFamilies: ['dotnet'],
    pythonEngineAtCreate: 'skipped',
    pythonEngineAtBootstrap: 'disabled',
  },
  {
    id: 'polyglot',
    runtimePolicy: 'multi-runtime',
    runtimeFamilies: [],
    setupRuntimeFamilies: ['python', 'node', 'go', 'java', 'dotnet'],
    pythonEngineAtCreate: 'optional-default-install',
    pythonEngineAtBootstrap: 'on-demand',
  },
  {
    id: 'enterprise',
    runtimePolicy: 'multi-runtime',
    runtimeFamilies: [],
    setupRuntimeFamilies: ['python', 'node', 'go', 'java', 'dotnet'],
    pythonEngineAtCreate: 'optional-default-install',
    pythonEngineAtBootstrap: 'on-demand',
  },
] as const;

export function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  return typeof value === 'string' && WORKSPACE_PROFILES.includes(value as WorkspaceProfile);
}

export function isPythonFreeWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  return isWorkspaceProfile(value) && PYTHON_FREE_WORKSPACE_PROFILES.has(value);
}

export type WorkspaceProfilePolicyMode = 'warn' | 'strict';

export type WorkspaceProfileRuntime = BackendRuntimeFamily;

export interface WorkspaceProfileCompatibilityResult {
  ok: boolean;
  checkId: string;
  status: 'passed' | 'failed';
  profile: WorkspaceProfile | string;
  runtimes: WorkspaceProfileRuntime[];
  message: string;
  recommendedProfile?: WorkspaceProfile;
  recommendedCommand?: string;
  ciRecommendedCommand?: string;
  severity: 'none' | 'warning' | 'error';
}

const PROFILE_RUNTIME: Record<string, WorkspaceProfileRuntime | undefined> = {
  'python-only': 'python',
  'node-only': 'node',
  'go-only': 'go',
  'java-only': 'java',
  'dotnet-only': 'dotnet',
};

const RUNTIME_DISPLAY: Record<WorkspaceProfileRuntime, string> = {
  python: 'Python',
  node: 'Node',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  php: 'PHP',
  ruby: 'Ruby',
  rust: 'Rust',
  elixir: 'Elixir',
  clojure: 'Clojure',
  scala: 'Scala',
  kotlin: 'Kotlin',
  deno: 'Deno',
  bun: 'Bun',
  c: 'C',
  cpp: 'C++',
  unknown: 'Unknown',
};

const RUNTIME_PROFILE: Partial<
  Record<Exclude<WorkspaceProfileRuntime, 'unknown'>, WorkspaceProfile>
> = {
  python: 'python-only',
  node: 'node-only',
  go: 'go-only',
  java: 'java-only',
  dotnet: 'dotnet-only',
};

const RUNTIME_ORDER: WorkspaceProfileRuntime[] = [
  'node',
  'deno',
  'bun',
  'python',
  'go',
  'java',
  'kotlin',
  'scala',
  'dotnet',
  'php',
  'ruby',
  'rust',
  'elixir',
  'clojure',
  'c',
  'cpp',
  'unknown',
];

function workspaceProfileRuntimeFamily(runtime: WorkspaceProfileRuntime): WorkspaceProfileRuntime {
  if (runtime === 'bun' || runtime === 'deno') {
    return 'node';
  }
  if (runtime === 'kotlin' || runtime === 'scala') {
    return 'java';
  }
  return runtime;
}

export function normalizeWorkspaceProfile(raw: unknown): WorkspaceProfile | string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return 'minimal';
  }
  return raw.trim().toLowerCase();
}

export function normalizeWorkspaceProfileRuntime(raw: unknown): WorkspaceProfileRuntime {
  if (typeof raw !== 'string') {
    return 'unknown';
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'python' ||
    normalized === 'node' ||
    normalized === 'go' ||
    normalized === 'java' ||
    normalized === 'dotnet' ||
    normalized === 'php' ||
    normalized === 'ruby' ||
    normalized === 'rust' ||
    normalized === 'elixir' ||
    normalized === 'clojure' ||
    normalized === 'scala' ||
    normalized === 'kotlin' ||
    normalized === 'deno' ||
    normalized === 'bun' ||
    normalized === 'c' ||
    normalized === 'cpp'
  ) {
    return normalized as WorkspaceProfileRuntime;
  }

  if (
    normalized === 'c++' ||
    normalized === 'cplusplus' ||
    normalized === 'cc' ||
    normalized === 'clang++' ||
    normalized === 'g++'
  ) {
    return 'cpp';
  }
  if (normalized === 'clang' || normalized === 'gcc') {
    return 'c';
  }

  return 'unknown';
}

export function sortWorkspaceProfileRuntimes(
  runtimes: Iterable<unknown>
): WorkspaceProfileRuntime[] {
  const normalized = new Set<WorkspaceProfileRuntime>();
  for (const runtime of runtimes) {
    normalized.add(normalizeWorkspaceProfileRuntime(runtime));
  }
  return [...normalized].sort(
    (left, right) => RUNTIME_ORDER.indexOf(left) - RUNTIME_ORDER.indexOf(right)
  );
}

export function recommendWorkspaceProfileForRuntimes(
  runtimes: Iterable<unknown>
): WorkspaceProfile | undefined {
  const knownRuntimes = sortWorkspaceProfileRuntimes(runtimes).filter(
    (runtime): runtime is Exclude<WorkspaceProfileRuntime, 'unknown'> => runtime !== 'unknown'
  );
  if (knownRuntimes.length === 0) {
    return undefined;
  }
  if (knownRuntimes.length === 1) {
    return RUNTIME_PROFILE[knownRuntimes[0]];
  }
  return 'polyglot';
}

export function buildWorkspaceProfileBootstrapCommand(
  profile: WorkspaceProfile,
  options: { ci?: boolean } = {}
): string {
  return `npx workspai bootstrap --profile ${profile}${options.ci ? ' --ci --json' : ''}`;
}

function resultSeverity(
  ok: boolean,
  mode: WorkspaceProfilePolicyMode
): WorkspaceProfileCompatibilityResult['severity'] {
  if (ok) {
    return 'none';
  }
  return mode === 'strict' ? 'error' : 'warning';
}

function withRecommendation(input: {
  ok: boolean;
  checkId: string;
  profile: WorkspaceProfile | string;
  runtimes: WorkspaceProfileRuntime[];
  message: string;
  mode: WorkspaceProfilePolicyMode;
}): WorkspaceProfileCompatibilityResult {
  const recommendedProfile = input.ok
    ? undefined
    : (recommendWorkspaceProfileForRuntimes(input.runtimes) ?? 'polyglot');
  return {
    ok: input.ok,
    checkId: input.checkId,
    status: input.ok ? 'passed' : 'failed',
    profile: input.profile,
    runtimes: input.runtimes,
    message: input.message,
    recommendedProfile,
    recommendedCommand: recommendedProfile
      ? buildWorkspaceProfileBootstrapCommand(recommendedProfile)
      : undefined,
    ciRecommendedCommand: recommendedProfile
      ? buildWorkspaceProfileBootstrapCommand(recommendedProfile, { ci: true })
      : undefined,
    severity: resultSeverity(input.ok, input.mode),
  };
}

export function resolveWorkspaceProfileCompatibility(input: {
  profile: unknown;
  runtimes: Iterable<unknown>;
  mode?: WorkspaceProfilePolicyMode;
}): WorkspaceProfileCompatibilityResult {
  const profile = normalizeWorkspaceProfile(input.profile);
  const runtimes = sortWorkspaceProfileRuntimes(input.runtimes);
  const mode = input.mode ?? 'warn';
  const requiredRuntime = PROFILE_RUNTIME[profile];

  if (requiredRuntime) {
    const compatible =
      runtimes.length === 0 ||
      runtimes.every((runtime) => workspaceProfileRuntimeFamily(runtime) === requiredRuntime);
    return withRecommendation({
      ok: compatible,
      checkId: `profile.${profile}`,
      profile,
      runtimes,
      message: compatible
        ? `${profile} profile validated for discovered projects.`
        : `${profile} profile mismatch: detected runtimes [${runtimes.join(', ')}].`,
      mode,
    });
  }

  if (profile === 'minimal') {
    const runtimeKinds = runtimes.filter((runtime) => runtime !== 'unknown');
    const runtimeFamilies = new Set(
      runtimeKinds.map((runtime) => workspaceProfileRuntimeFamily(runtime))
    );
    const compatible = runtimeFamilies.size <= 1;
    return withRecommendation({
      ok: compatible,
      checkId: 'profile.minimal',
      profile,
      runtimes,
      message: compatible
        ? 'minimal profile is compatible with detected runtime mix.'
        : `minimal profile mismatch: multiple runtimes detected [${runtimeKinds.join(', ')}].`,
      mode,
    });
  }

  return withRecommendation({
    ok: true,
    checkId: `profile.${profile}`,
    profile,
    runtimes,
    message: `${profile} profile accepts the detected runtime mix.`,
    mode,
  });
}

export function resolveWorkspaceProfileProjectCompatibility(input: {
  profile: unknown;
  runtime: unknown;
  subjectLabel: string;
  mode?: WorkspaceProfilePolicyMode;
}): WorkspaceProfileCompatibilityResult {
  const profile = normalizeWorkspaceProfile(input.profile);
  const runtime = normalizeWorkspaceProfileRuntime(input.runtime);
  const mode = input.mode ?? 'warn';
  const requiredRuntime = PROFILE_RUNTIME[profile];

  if (!requiredRuntime || runtime === 'unknown') {
    return withRecommendation({
      ok: true,
      checkId: `profile.${profile}`,
      profile,
      runtimes: [runtime],
      message:
        runtime === 'unknown'
          ? `Project "${input.subjectLabel}" runtime is unknown; profile compatibility will be checked by workspace doctor.`
          : `${profile} profile accepts project "${input.subjectLabel}".`,
      mode,
    });
  }

  const compatible = workspaceProfileRuntimeFamily(runtime) === requiredRuntime;
  return withRecommendation({
    ok: compatible,
    checkId: `profile.${profile}`,
    profile,
    runtimes: compatible ? [runtime] : sortWorkspaceProfileRuntimes([requiredRuntime, runtime]),
    message: compatible
      ? `Project "${input.subjectLabel}" is compatible with workspace profile "${profile}".`
      : `Project "${input.subjectLabel}" is ${RUNTIME_DISPLAY[runtime]}, but workspace profile is "${profile}".`,
    mode,
  });
}

export async function readWorkspaceProfilePolicyMode(
  workspacePath: string
): Promise<WorkspaceProfilePolicyMode> {
  const policyFilePath = (
    await Promise.all(
      workspaceMetadataCandidates(workspacePath, 'policies.yml').map(async (candidate) =>
        (await fsExtra.pathExists(candidate)) ? candidate : null
      )
    )
  ).find((candidate): candidate is string => typeof candidate === 'string');
  if (!policyFilePath) {
    return 'warn';
  }

  try {
    const policyRaw = await fsExtra.readFile(policyFilePath, 'utf-8');
    const modeMatch = policyRaw.match(/^\s*mode:\s*(warn|strict)\s*(?:#.*)?$/m);
    return modeMatch?.[1] === 'strict' ? 'strict' : 'warn';
  } catch {
    return 'warn';
  }
}

export async function readWorkspaceManifestProfile(
  workspacePath: string
): Promise<WorkspaceProfile | string> {
  const workspaceJsonPath = (
    await Promise.all(
      workspaceMetadataCandidates(workspacePath, 'workspace.json').map(async (candidate) =>
        (await fsExtra.pathExists(candidate)) ? candidate : null
      )
    )
  ).find((candidate): candidate is string => typeof candidate === 'string');
  if (!workspaceJsonPath) {
    return 'minimal';
  }

  try {
    const workspaceJson = (await fsExtra.readJson(workspaceJsonPath)) as Record<string, unknown>;
    return normalizeWorkspaceProfile(workspaceJson.profile);
  } catch {
    return 'minimal';
  }
}

export async function collectWorkspaceProfileRuntimes(
  workspacePath: string,
  options: { additionalRuntimes?: Iterable<unknown> } = {}
): Promise<WorkspaceProfileRuntime[]> {
  const runtimes = new Set<WorkspaceProfileRuntime>();
  const projectPaths: string[] = [];
  const visited = new Set<string>();
  const stack = [workspacePath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath || visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      if (['node_modules', 'dist', 'build', 'target', 'coverage', 'htmlcov'].includes(entry.name)) {
        continue;
      }

      const candidate = path.join(currentPath, entry.name);
      if (candidate !== workspacePath && hasWorkspaceRootMarkers(candidate)) {
        continue;
      }
      const hasProjectMetadata = (
        await Promise.all(
          [
            ...projectMetadataCandidates(candidate, 'context.json'),
            ...projectMetadataCandidates(candidate, 'project.json'),
          ].map(async (metadataPath) => fsExtra.pathExists(metadataPath))
        )
      ).some(Boolean);
      if (hasProjectMetadata) {
        projectPaths.push(candidate);
        continue;
      }

      stack.push(candidate);
    }
  }

  for (const projectPath of projectPaths) {
    const projectJson = readRapidkitProjectJson(projectPath);
    runtimes.add(
      normalizeWorkspaceProfileRuntime(
        detectBackendFrameworkFromProject(projectPath, projectJson).runtime
      )
    );
  }

  for (const project of await readImportedProjectsRegistry(workspacePath)) {
    runtimes.add(normalizeWorkspaceProfileRuntime(project.runtime));
  }

  for (const runtime of options.additionalRuntimes ?? []) {
    runtimes.add(normalizeWorkspaceProfileRuntime(runtime));
  }

  return sortWorkspaceProfileRuntimes(runtimes);
}

export function formatWorkspaceProfileCompatibilityHint(
  result: WorkspaceProfileCompatibilityResult,
  options: { ci?: boolean } = {}
): string | null {
  const command = options.ci ? result.ciRecommendedCommand : result.recommendedCommand;
  return command ? `Recommended: ${command}` : null;
}
