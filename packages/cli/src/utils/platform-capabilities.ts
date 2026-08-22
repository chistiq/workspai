import os from 'os';
import path from 'path';
import fs from 'fs-extra';

export type PlatformKind = 'windows' | 'linux' | 'macos' | 'other';

export type PythonVersionProbe = {
  command: string;
  args: string[];
};

export function detectPlatformKind(platform: NodeJS.Platform = process.platform): PlatformKind {
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'macos';
  return 'other';
}

export function isWindowsPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return detectPlatformKind(platform) === 'windows';
}

export function shouldUseShellExecution(platform: NodeJS.Platform = process.platform): boolean {
  return isWindowsPlatform(platform);
}

const PACKAGE_RUNNER_COMMANDS = new Set(['npx', 'npm', 'yarn', 'pnpm']);

export type PackageRunnerInvocation = {
  command: string;
  prefixArgs: string[];
};

function packageRunnerCliBasename(command: string): string {
  return command === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
}

function pathApiForPlatform(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return isWindowsPlatform(platform) ? path.win32 : path.posix;
}

function npmExecPathCandidate(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | null {
  const execPath = env.npm_execpath;
  if (!execPath) return null;

  const pathApi = pathApiForPlatform(platform);
  const basename = pathApi.basename(execPath).toLowerCase();
  if (command === 'npx' && basename !== 'npx-cli.js') {
    const sibling = pathApi.join(pathApi.dirname(execPath), 'npx-cli.js');
    return fs.existsSync(sibling) ? sibling : null;
  }
  if (command === 'npm' && basename === 'npx-cli.js') {
    const sibling = pathApi.join(pathApi.dirname(execPath), 'npm-cli.js');
    return fs.existsSync(sibling) ? sibling : null;
  }
  return fs.existsSync(execPath) ? execPath : null;
}

function wellKnownPackageRunnerCliCandidates(
  command: string,
  nodeExecPath: string,
  platform: NodeJS.Platform
): string[] {
  if (command !== 'npm' && command !== 'npx') return [];

  const cli = packageRunnerCliBasename(command);
  const pathApi = pathApiForPlatform(platform);
  const nodeBinDir = pathApi.dirname(nodeExecPath);
  const prefix = pathApi.dirname(nodeBinDir);

  return [
    pathApi.join(nodeBinDir, 'node_modules', 'npm', 'bin', cli),
    pathApi.join(prefix, 'lib', 'node_modules', 'npm', 'bin', cli),
    pathApi.join(prefix, 'lib64', 'node_modules', 'npm', 'bin', cli),
    pathApi.join('/usr', 'lib', 'node_modules', 'npm', 'bin', cli),
    pathApi.join('/usr', 'local', 'lib', 'node_modules', 'npm', 'bin', cli),
    pathApi.join('/usr', 'share', 'nodejs', 'npm', 'bin', cli),
  ];
}

/** Resolve npx/npm next to the active Node binary (fixes VS Code extension host PATH gaps). */
export function resolvePackageRunnerExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform
): string {
  return resolvePackageRunnerInvocation(command, platform).command;
}

/**
 * Resolve npm-family package runners for subprocess execution.
 *
 * Enterprise surfaces often invoke RapidKit from VS Code, npm/npx shims, or CI
 * jobs with a reduced PATH. Returning command + prefixArgs lets callers safely
 * execute `node npm-cli.js ...` or `corepack npm ...` without shell-string hacks.
 */
export function resolvePackageRunnerInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  nodeExecPath: string = process.execPath
): PackageRunnerInvocation {
  const normalized = command.trim();
  if (!PACKAGE_RUNNER_COMMANDS.has(normalized)) {
    return { command: normalized, prefixArgs: [] };
  }

  if (normalized === 'npm' || normalized === 'npx') {
    const npmExecPath = npmExecPathCandidate(normalized, env, platform);
    if (npmExecPath) {
      return { command: nodeExecPath, prefixArgs: [npmExecPath] };
    }

    for (const candidate of wellKnownPackageRunnerCliCandidates(
      normalized,
      nodeExecPath,
      platform
    )) {
      if (fs.existsSync(candidate)) {
        return { command: nodeExecPath, prefixArgs: [candidate] };
      }
    }
  }

  const pathApi = pathApiForPlatform(platform);
  const nodeBinDir = pathApi.dirname(nodeExecPath);
  const extension = isWindowsPlatform(platform) ? '.cmd' : '';
  const candidates = [
    pathApi.join(nodeBinDir, `${normalized}${extension}`),
    pathApi.join(nodeBinDir, normalized),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, prefixArgs: [] };
    }
  }

  if (normalized === 'npm') {
    return { command: 'corepack', prefixArgs: ['npm'] };
  }

  return { command: normalized, prefixArgs: [] };
}

export function augmentPathWithNodeBin(
  pathEnv?: string,
  platform: NodeJS.Platform = process.platform,
  nodeExecPath: string = process.execPath
): string {
  const delimiter = isWindowsPlatform(platform) ? ';' : ':';
  const nodeBin = pathApiForPlatform(platform).dirname(nodeExecPath);
  const parts = (pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);
  if (!parts.includes(nodeBin)) {
    parts.unshift(nodeBin);
  }
  return parts.join(delimiter);
}

/** npm_config keys inherited from `npx --package …` that break nested npx/npm runs. */
const NPX_PARENT_PACKAGE_ENV_KEYS = ['npm_config_package', 'npm_config__package'] as const;

/**
 * Env for spawning nested npx/npm/yarn/pnpm from RapidKit.
 * Strips parent `npx --package file:…` package pins so inner generators resolve from the registry.
 */
export function buildPackageRunnerSubprocessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  nodeExecPath: string = process.execPath
): NodeJS.ProcessEnv {
  const rapidkitCorepackHome = path.join(os.tmpdir(), 'rapidkit-corepack');
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PATH: augmentPathWithNodeBin(baseEnv.PATH, platform, nodeExecPath),
    COREPACK_HOME: baseEnv.COREPACK_HOME ?? rapidkitCorepackHome,
  };
  for (const key of NPX_PARENT_PACKAGE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

/**
 * Official scaffolders are resolved from their stable channel at execution
 * time. Make npm reject a generator tree that does not support the operator's
 * current Node.js runtime instead of leaving behind an unusable scaffold after
 * an engine warning.
 */
export function buildLatestStableGeneratorEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  nodeExecPath: string = process.execPath
): NodeJS.ProcessEnv {
  return {
    ...buildPackageRunnerSubprocessEnv(baseEnv, platform, nodeExecPath),
    npm_config_engine_strict: 'true',
  };
}

export function getDefaultPythonCommand(platform: NodeJS.Platform = process.platform): string {
  return isWindowsPlatform(platform) ? 'python' : 'python3';
}

export function getPythonCommandCandidates(platform: NodeJS.Platform = process.platform): string[] {
  return isWindowsPlatform(platform) ? ['python', 'py', 'python3'] : ['python3', 'python'];
}

export function getPythonVersionProbeCandidates(
  maxMinor = 14,
  minMinor = 10,
  platform: NodeJS.Platform = process.platform
): PythonVersionProbe[] {
  const probes: PythonVersionProbe[] = [];

  if (isWindowsPlatform(platform)) {
    for (let minor = maxMinor; minor >= minMinor; minor -= 1) {
      probes.push({ command: 'py', args: [`-3.${minor}`, '--version'] });
    }
    probes.push({ command: 'py', args: ['-3', '--version'] });
    probes.push({ command: 'python', args: ['--version'] });
    return probes;
  }

  for (let minor = maxMinor; minor >= minMinor; minor -= 1) {
    probes.push({ command: `python3.${minor}`, args: ['--version'] });
  }
  probes.push({ command: 'python3', args: ['--version'] });
  probes.push({ command: 'python', args: ['--version'] });
  return probes;
}

export function getVenvBinDirectory(
  venvPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return isWindowsPlatform(platform) ? path.join(venvPath, 'Scripts') : path.join(venvPath, 'bin');
}

export function getVenvPythonPath(
  venvPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return isWindowsPlatform(platform)
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');
}

export function getVenvRapidkitPath(
  venvPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return isWindowsPlatform(platform)
    ? path.join(venvPath, 'Scripts', 'rapidkit.exe')
    : path.join(venvPath, 'bin', 'rapidkit');
}

export function getVenvActivateScriptPath(
  venvPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return isWindowsPlatform(platform)
    ? path.join(venvPath, 'Scripts', 'activate')
    : path.join(venvPath, 'bin', 'activate');
}

export function getRapidkitLocalScriptCandidates(
  cwd: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (isWindowsPlatform(platform)) {
    return [
      path.join(cwd, 'workspai.cmd'),
      path.join(cwd, '.workspai', 'rapidkit.cmd'),
      path.join(cwd, 'rapidkit.cmd'),
      path.join(cwd, '.rapidkit', 'rapidkit.cmd'),
    ];
  }
  return [
    path.join(cwd, 'workspai'),
    path.join(cwd, '.workspai', 'rapidkit'),
    path.join(cwd, 'rapidkit'),
    path.join(cwd, '.rapidkit', 'rapidkit'),
  ];
}

export function getWorkspaceRegistryDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  void platform;
  const isolatedStateDirectory = getIsolatedWorkspaceStateDirectory(env);
  if (isolatedStateDirectory) {
    return isolatedStateDirectory;
  }
  const homeDir = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(homeDir, '.workspai');
}

export function getLegacyWorkspaceRegistryDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  void platform;
  const isolatedStateDirectory = getIsolatedWorkspaceStateDirectory(env);
  if (isolatedStateDirectory) {
    return path.join(isolatedStateDirectory, 'legacy');
  }
  const homeDir = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(homeDir, '.rapidkit');
}

export function getWorkspaceRegistryFileCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const candidates = [
    path.join(getWorkspaceRegistryDirectory(env, platform), 'workspaces.json'),
    path.join(getLegacyWorkspaceRegistryDirectory(env, platform), 'workspaces.json'),
  ];

  // A task-scoped state root is a hermetic boundary. Do not merge registry
  // candidates from the user's home or platform configuration directories.
  if (getIsolatedWorkspaceStateDirectory(env)) {
    return [...new Set(candidates)];
  }

  if (isWindowsPlatform(platform)) {
    const configHome = env.XDG_CONFIG_HOME || env.APPDATA;
    if (configHome) {
      candidates.push(path.join(configHome, 'workspai', 'workspaces.json'));
      candidates.push(path.join(configHome, 'rapidkit', 'workspaces.json'));
    }
  }

  return [...new Set(candidates)];
}

function getIsolatedWorkspaceStateDirectory(env: NodeJS.ProcessEnv): string | null {
  const configuredDirectory = env.WORKSPAI_STATE_DIR?.trim();
  return configuredDirectory && path.isAbsolute(configuredDirectory)
    ? path.normalize(configuredDirectory)
    : null;
}

export function getUserLocalBinCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const candidates: string[] = [];

  if (isWindowsPlatform(platform)) {
    if (env.USERPROFILE) {
      candidates.push(path.join(env.USERPROFILE, '.local', 'bin'));
    }
    if (env.APPDATA) {
      candidates.push(path.join(env.APPDATA, 'Python', 'Scripts'));
    }
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Python', 'Scripts'));
    }
  } else {
    candidates.push(path.join(os.homedir(), '.local', 'bin'));
  }

  return [...new Set(candidates.filter(Boolean))];
}
