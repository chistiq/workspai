import crypto from 'crypto';
import os from 'os';
import path from 'path';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';
import { BOOTSTRAP_CORE_COMMANDS_SET } from './bootstrapCoreCommands';
import {
  getDefaultPythonCommand,
  getPythonCommandCandidates,
  getPythonVersionProbeCandidates,
  getUserLocalBinCandidates,
  getVenvPythonPath,
  getVenvRapidkitPath,
  isWindowsPlatform,
} from '../utils/platform-capabilities.js';
import { getProbeTimeoutMs } from '../utils/command-timeouts.js';
import {
  LEGACY_RAPIDKIT_WORKSPACE_MARKER,
  WORKSPAI_WORKSPACE_MARKER,
} from '../utils/workspace-paths.js';
import { withInterprocessLock } from '../utils/interprocess-lock.js';
import { evaluatePythonVersionConstraint } from '../utils/python-version-constraint.js';
import {
  coreInstallTarget,
  RAPIDKIT_CORE_PACKAGE,
  RAPIDKIT_CORE_MINIMUM_PYTHON,
  RAPIDKIT_CORE_MINIMUM_PYTHON_MINOR,
  RAPIDKIT_CORE_REQUIRES_PYTHON,
  RAPIDKIT_CORE_VERSION,
} from './core-runtime-compatibility.js';

export type PythonCommand = string;

const probeTimeoutMs = getProbeTimeoutMs();

async function readWorkspaceMarkerJson(
  workspaceDir: string
): Promise<Record<string, unknown> | null> {
  for (const markerName of [WORKSPAI_WORKSPACE_MARKER, LEGACY_RAPIDKIT_WORKSPACE_MARKER]) {
    const markerPath = path.join(workspaceDir, markerName);
    if (!(await fsExtra.pathExists(markerPath))) continue;
    try {
      const marker = await fsExtra.readJson(markerPath);
      if (marker && typeof marker === 'object') {
        return marker as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function pythonCommandCandidates(): PythonCommand[] {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) candidates.push(trimmed);
  };

  add(process.env.RAPIDKIT_BRIDGE_PYTHON);
  add(process.env.RAPIDKIT_PYTHON_CMD);
  add(process.env.POETRY_PYTHON);

  const spec = coreInstallTarget();
  const looksLikeLocalCorePath =
    (spec.startsWith('/') || spec.startsWith('.') || spec.startsWith('..')) &&
    !spec.startsWith('file:');
  if (looksLikeLocalCorePath) {
    add(getVenvPythonPath(path.join(path.resolve(spec), '.venv')));
  }

  for (const probe of getPythonVersionProbeCandidates(14, RAPIDKIT_CORE_MINIMUM_PYTHON_MINOR)) {
    if (probe.args.length === 1 && probe.args[0] === '--version') {
      add(probe.command);
    }
  }

  for (const candidate of getPythonCommandCandidates()) {
    add(candidate);
  }

  return [...new Set(candidates)];
}

function pythonLauncherArgs(cmd: string, args: string[]): string[] {
  return cmd === 'py' ? ['-3', ...args] : args;
}

function parsePythonVersion(output: unknown): string | null {
  const match = String(output ?? '').match(/Python\s+(\d+\.\d+(?:\.\d+)?)/i);
  return match?.[1] ?? null;
}

export async function hasCoreCompatiblePython(cmd: PythonCommand): Promise<boolean> {
  try {
    const result = await execa(cmd, pythonLauncherArgs(cmd, ['--version']), {
      reject: false,
      stdio: 'pipe',
      timeout: 2500,
    });
    if (result.exitCode !== 0) return false;
    const version = parsePythonVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    return (
      version !== null &&
      evaluatePythonVersionConstraint(version, RAPIDKIT_CORE_REQUIRES_PYTHON).satisfied === true
    );
  } catch {
    return false;
  }
}

type ExecOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function coreCommandArgs(args: string[]): string[] {
  // Core 0.6.3 emits a banner unless --json is explicit, even with --json-schema.
  if (
    args[0] === 'modules' &&
    args[1] === 'list' &&
    !args.includes('--json') &&
    args.some((arg) => arg === '--json-schema' || arg.startsWith('--json-schema='))
  ) {
    return [...args, '--json'];
  }
  return args;
}

type CaptureResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function filterNoisyInitOutput(text: string): string {
  if (!text) return text;

  const noisyPatterns = [
    "Installed Poetry version does not support '--no-update'. Falling back to 'poetry lock'.",
  ];

  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !noisyPatterns.some((pattern) => line.includes(pattern)));
  return kept.join('\n');
}

type BridgeErrorCode =
  | 'PYTHON_NOT_FOUND'
  | 'BRIDGE_VENV_CREATE_FAILED'
  | 'BRIDGE_PIP_BOOTSTRAP_FAILED'
  | 'BRIDGE_PIP_UPGRADE_FAILED'
  | 'BRIDGE_PIP_INSTALL_FAILED'
  | 'BRIDGE_VENV_HEALTH_FAILED'
  | 'BRIDGE_VENV_LOCK_FAILED'
  | 'BRIDGE_VENV_BOOTSTRAP_FAILED';

class BridgeError extends Error {
  public code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function formatBridgeError(err: unknown): string {
  if (err instanceof BridgeError) {
    switch (err.code) {
      case 'PYTHON_NOT_FOUND': {
        const expectedCmd = getDefaultPythonCommand();
        return (
          'Workspai could not find Python (python3/python/py) on your PATH.\n' +
          `Install Python ${RAPIDKIT_CORE_MINIMUM_PYTHON}+ and ensure \`${expectedCmd}\` is available, then retry.\n` +
          'Tip: if you are inside a RapidKit project, use the local ./rapidkit launcher.'
        );
      }
      case 'BRIDGE_VENV_CREATE_FAILED':
        return (
          'Workspai failed to create its bridge virtual environment.\n' +
          (isWindowsPlatform()
            ? 'Ensure Python is installed with venv support.\n'
            : 'Ensure Python venv support is installed (e.g., python3-venv).\n') +
          `Details: ${err.message}`
        );
      case 'BRIDGE_PIP_BOOTSTRAP_FAILED':
        return (
          'Workspai could not bootstrap pip inside the bridge virtual environment.\n' +
          (isWindowsPlatform()
            ? 'Ensure pip is available for your Python installation and retry.\n'
            : 'Install python3-venv/python3-pip and retry.\n') +
          `Details: ${err.message}`
        );
      case 'BRIDGE_PIP_UPGRADE_FAILED':
        return (
          'Workspai could not upgrade pip in the bridge virtual environment.\n' +
          'Check your network/proxy or disable RAPIDKIT_BRIDGE_UPGRADE_PIP.\n' +
          `Details: ${err.message}`
        );
      case 'BRIDGE_PIP_INSTALL_FAILED':
        return (
          'Workspai could not install rapidkit-core in the bridge virtual environment.\n' +
          `Check the configured package index for ${coreInstallTarget()}, or install it with pipx.\n` +
          `Details: ${err.message}`
        );
      case 'BRIDGE_VENV_LOCK_FAILED':
        return (
          'Workspai could not acquire the shared Python bridge bootstrap lock.\n' +
          'Another Workspai process may still be preparing the environment; retry after it completes.\n' +
          `Details: ${err.message}`
        );
      case 'BRIDGE_VENV_HEALTH_FAILED':
        return (
          'Workspai created the Python bridge environment, but its Core runtime health check failed.\n' +
          'The incomplete bridge was discarded so the next run can rebuild it safely.\n' +
          `Details: ${err.message}`
        );
      default:
        return `Workspai bridge error: ${err.message}`;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  return `Workspai failed to run the Python core engine: ${msg}`;
}

function coreInstallTargetId(): string {
  const spec = coreInstallTarget();
  const extra = process.env.RAPIDKIT_CORE_PYTHON_PACKAGE_ID;
  const raw = extra && extra.trim() ? `${spec}|${extra.trim()}` : spec;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg && xdg.trim()) return xdg;
  return path.join(os.homedir(), '.cache');
}

function legacyBridgeVenvDir(): string {
  return path.join(cacheRoot(), 'rapidkit', 'npm-bridge', 'venv');
}

function bridgeVenvDir(): string {
  const id = coreInstallTargetId();
  return path.join(cacheRoot(), 'rapidkit', 'npm-bridge', `venv-${id}`);
}

function bridgePython(venvDir: string): string {
  return getVenvPythonPath(venvDir);
}

function bridgeRapidkitCli(venvDir: string): string {
  return getVenvRapidkitPath(venvDir);
}

async function probeBridgeVenvHealth(venvDir: string): Promise<{
  healthy: boolean;
  details: string;
}> {
  const probes: Array<{ cmd: string; args: string[] }> = [];
  const cli = bridgeRapidkitCli(venvDir);
  if (await fsExtra.pathExists(cli)) {
    probes.push({ cmd: cli, args: ['--version', '--json'] });
  }
  probes.push({
    cmd: bridgePython(venvDir),
    args: ['-m', 'rapidkit', '--version', '--json'],
  });

  const failures: string[] = [];
  for (const probe of probes) {
    try {
      const result = await execa(probe.cmd, probe.args, {
        reject: false,
        stdio: 'pipe',
        timeout: 30_000,
      });
      if (result.exitCode === 0 && (await isCoreJsonVersion(result.stdout))) {
        return { healthy: true, details: '' };
      }
      const output = [result.stdout, result.stderr]
        .map((value) => (value ?? '').toString().trim())
        .filter(Boolean)
        .join('\n');
      failures.push(output || `${probe.cmd} exited with ${String(result.exitCode)}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { healthy: false, details: failures.join('\n') };
}

async function findUserLocalRapidkitRunner(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<RapidkitRunner | null> {
  const names = isWindowsPlatform(platform) ? ['rapidkit.exe', 'rapidkit.cmd'] : ['rapidkit'];
  const candidates = getUserLocalBinCandidates(env, platform).flatMap((dir) =>
    names.map((name) => path.join(dir, name))
  );

  for (const candidate of [...new Set(candidates)]) {
    try {
      if (!(await fsExtra.pathExists(candidate))) continue;
      const res = await execa(candidate, ['--version', '--json'], {
        reject: false,
        stdio: 'pipe',
        timeout: 4000,
      });
      if (res.exitCode === 0 && (await isCoreJsonVersion(res.stdout))) {
        return { cmd: candidate, baseArgs: [] };
      }
    } catch {
      // Ignore broken candidates and keep scanning deterministic user-local locations.
    }
  }

  return null;
}

async function findPathRapidkitRunner(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<RapidkitRunner | null> {
  const executableName = isWindowsPlatform(platform) ? 'rapidkit.exe' : 'rapidkit';
  const pathEnv = (env.PATH ?? '').split(path.delimiter).filter(Boolean);

  for (const dir of pathEnv) {
    const candidate = path.join(dir, executableName);
    try {
      if (!(await fsExtra.pathExists(candidate))) continue;
      const res = await execa(candidate, ['--version', '--json'], {
        reject: false,
        stdio: 'pipe',
        timeout: 4000,
      });
      if (res.exitCode === 0 && (await isCoreJsonVersion(res.stdout, { requireSchema: true }))) {
        return { cmd: candidate, baseArgs: [] };
      }
    } catch {
      // Ignore broken PATH candidates and continue scanning.
    }
  }

  return null;
}

function isPinnedSpec(spec: string): boolean {
  return /[<>=!~]=|@|\.whl$|\.tar\.gz$|\.zip$|git\+|https?:\/\//.test(spec);
}

function commandsCachePath(): string {
  return path.join(cacheRoot(), 'rapidkit', 'npm-bridge', 'core-commands.json');
}

async function findInterpreterRapidkitRunner(cmd: PythonCommand): Promise<RapidkitRunner | null> {
  const args = pythonLauncherArgs(cmd, ['-m', 'rapidkit']);
  if (await probeCoreVersion(cmd, args)) return { cmd, baseArgs: args };

  try {
    const scriptPathRes = await execa(
      cmd,
      pythonLauncherArgs(cmd, [
        '-c',
        "import sysconfig, os; print(os.path.join(sysconfig.get_path('scripts'), 'rapidkit'))",
      ]),
      { reject: false, stdio: 'pipe', timeout: 2000 }
    );
    const base = (scriptPathRes.stdout ?? '').toString().trim();
    const script = base && isWindowsPlatform() ? `${base}.exe` : base;
    if (script && (await fsExtra.pathExists(script)) && (await probeCoreVersion(script, []))) {
      return { cmd: script, baseArgs: [] };
    }
  } catch {
    // Keep looking when an interpreter has no usable Core console script.
  }
  return null;
}

async function tryRapidkit(cmd: PythonCommand): Promise<boolean> {
  return (await findInterpreterRapidkitRunner(cmd)) !== null;
}

async function probeCoreVersion(cmd: string, baseArgs: string[]): Promise<boolean> {
  try {
    const probe = await execa(cmd, [...baseArgs, '--version', '--json'], {
      reject: false,
      stdio: 'pipe',
      timeout: 8000,
    });
    return probe.exitCode === 0 && (await isCoreJsonVersion(probe.stdout, { requireSchema: true }));
  } catch {
    return false;
  }
}

type RapidkitRunner = {
  cmd: string;
  baseArgs: string[];
  workspaceDir?: string;
};

async function isCoreJsonVersion(
  stdout: unknown,
  options?: { requireSchema?: boolean }
): Promise<boolean> {
  const out = (stdout ?? '').toString().trim();
  if (!out) return false;
  try {
    const parsed = JSON.parse(out) as unknown;
    if (!parsed || typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    if (!('version' in record)) {
      return false;
    }
    if (typeof record.version !== 'string' || !/^\d+\.\d+/.test(record.version)) return false;
    const target = coreInstallTarget();
    if (target === RAPIDKIT_CORE_PACKAGE) {
      if (record.version !== RAPIDKIT_CORE_VERSION) return false;
    } else {
      const constraint = parseRapidkitCoreConstraint(target);
      if (constraint && !isVersionSatisfyingConstraint(record.version, constraint)) return false;
    }
    if (options?.requireSchema) {
      return record.schema_version === 1 || record.schemaVersion === 'rapidkit-core-version-v1';
    }
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRunner(
  startDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<RapidkitRunner | null> {
  const readMarkerVenvPath = async (workspaceDir: string): Promise<string | null> => {
    try {
      const marker = await readWorkspaceMarkerJson(workspaceDir);
      const metadata = marker?.metadata as { python?: { venvPath?: unknown } } | undefined;
      const raw = metadata?.python?.venvPath;
      if (typeof raw !== 'string' || !raw.trim()) return null;
      return path.isAbsolute(raw) ? raw : path.join(workspaceDir, raw);
    } catch {
      return null;
    }
  };

  const probeVenv = async (
    workspaceDir: string,
    venvDir: string
  ): Promise<RapidkitRunner | null> => {
    const py = getVenvPythonPath(venvDir, platform);
    if (!(await fsExtra.pathExists(py)) || !(await hasCoreCompatiblePython(py))) return null;
    const cli = getVenvRapidkitPath(venvDir, platform);
    if (await fsExtra.pathExists(cli)) {
      const probe = await execa(cli, ['--version', '--json'], {
        reject: false,
        stdio: 'pipe',
        timeout: 1500,
        cwd: workspaceDir,
      });
      if (probe.exitCode === 0 && (await isCoreJsonVersion(probe.stdout))) {
        return { cmd: cli, baseArgs: [], workspaceDir };
      }
    }

    {
      const probe = await execa(py, ['-m', 'rapidkit', '--version', '--json'], {
        reject: false,
        stdio: 'pipe',
        timeout: 1500,
        cwd: workspaceDir,
      });
      if (probe.exitCode === 0 && (await isCoreJsonVersion(probe.stdout))) {
        return { cmd: py, baseArgs: ['-m', 'rapidkit'], workspaceDir };
      }
    }

    return null;
  };

  let p = startDir;
  // Hard cap to avoid pathological scans.
  for (let i = 0; i < 25; i += 1) {
    const markerVenvPath = await readMarkerVenvPath(p);
    const venvCandidates = [path.join(p, '.venv'), markerVenvPath].filter(
      (value): value is string => !!value
    );

    for (const venvDir of [...new Set(venvCandidates)]) {
      const runner = await probeVenv(p, venvDir);
      if (runner) {
        return runner;
      }
    }

    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }

  return null;
}

// Read Python version from workspace marker or .python-version file
async function getWorkspacePythonVersion(workspaceDir: string): Promise<string | null> {
  // Try .python-version file first (most explicit)
  try {
    const pythonVersionPath = path.join(workspaceDir, '.python-version');
    if (await fsExtra.pathExists(pythonVersionPath)) {
      const content = await fsExtra.readFile(pythonVersionPath, 'utf-8');
      const version = content.trim();
      if (version) return version;
    }
  } catch {
    // Ignore
  }

  // Try workspace marker, canonical first and legacy as fallback.
  try {
    const marker = await readWorkspaceMarkerJson(workspaceDir);
    if (typeof marker?.pythonVersion === 'string' && marker.pythonVersion.trim()) {
      return marker.pythonVersion.trim();
    }
    const metadata = marker?.metadata as { python?: { pythonVersion?: unknown } } | undefined;
    const metadataVersion = metadata?.python?.pythonVersion;
    if (typeof metadataVersion === 'string' && metadataVersion.trim()) {
      return metadataVersion.trim();
    }
  } catch {
    // Ignore
  }

  return null;
}

async function resolveRapidkitRunner(cwd?: string): Promise<RapidkitRunner> {
  // If the user is inside a RapidKit workspace created by the npm package,
  // prefer its local .venv engine without requiring manual activation.
  if (cwd && cwd.trim()) {
    try {
      const local = await findWorkspaceRunner(cwd);
      if (local) {
        // Also set PYENV_VERSION based on workspace Python version
        const workspaceDir =
          local.workspaceDir ??
          (path.dirname(local.cmd).includes('.venv')
            ? path.dirname(path.dirname(path.dirname(local.cmd)))
            : path.dirname(local.cmd));
        const pythonVersion = await getWorkspacePythonVersion(workspaceDir);
        if (pythonVersion) {
          process.env.PYENV_VERSION = pythonVersion;
        }
        return local;
      }
    } catch {
      // Ignore and fall back to the default bridge/system resolution.
    }
  }

  if (process.env.RAPIDKIT_BRIDGE_FORCE_VENV !== '1') {
    for (const cmd of pythonCommandCandidates()) {
      if (!(await hasCoreCompatiblePython(cmd))) continue;
      const runner = await findInterpreterRapidkitRunner(cmd);
      if (runner) return runner;
    }

    const userLocalRunner = await findUserLocalRapidkitRunner();
    if (userLocalRunner) return userLocalRunner;
    const pathRunner = await findPathRapidkitRunner();
    if (pathRunner) return pathRunner;
  }

  const pythonPath = await ensureBridgeVenvFromCandidates();
  const runner = await findInterpreterRapidkitRunner(pythonPath);
  if (runner) return runner;
  throw new BridgeError('BRIDGE_VENV_HEALTH_FAILED', 'No usable Core entry point was found.');
}

async function pickSystemPython(): Promise<PythonCommand | null> {
  for (const cmd of pythonCommandCandidates()) {
    if (!(await hasCoreCompatiblePython(cmd))) continue;
    return cmd;
  }
  return null;
}

async function ensureBridgeVenvFromCandidates(): Promise<string> {
  let lastBootstrapError: unknown = null;
  let detectedPython = false;
  let detectedUnsupportedPython = false;

  for (const cmd of pythonCommandCandidates()) {
    let version: string | null = null;
    try {
      const probe = await execa(cmd, pythonLauncherArgs(cmd, ['--version']), {
        reject: false,
        stdio: 'pipe',
        timeout: 2000,
      });
      if (probe.exitCode !== 0) continue;
      version = parsePythonVersion(`${probe.stdout ?? ''}\n${probe.stderr ?? ''}`);
      detectedPython ||= version !== null;
      if (
        !version ||
        evaluatePythonVersionConstraint(version, RAPIDKIT_CORE_REQUIRES_PYTHON).satisfied !== true
      ) {
        detectedUnsupportedPython = true;
        continue;
      }
    } catch {
      // A missing candidate is expected while probing python3/python/py. Do not
      // leak platform-specific ENOENT details as a bridge bootstrap error.
      continue;
    }

    try {
      return await ensureBridgeVenv(cmd);
    } catch (err) {
      lastBootstrapError = err;
      continue;
    }
  }

  if (!detectedPython) {
    throw new BridgeError('PYTHON_NOT_FOUND', 'No Python interpreter found (python3/python/py).');
  }
  if (detectedUnsupportedPython && !lastBootstrapError) {
    throw new BridgeError(
      'PYTHON_NOT_FOUND',
      `Python ${RAPIDKIT_CORE_MINIMUM_PYTHON}+ is required by RapidKit Core ${RAPIDKIT_CORE_VERSION}.`
    );
  }
  if (lastBootstrapError instanceof BridgeError) {
    throw lastBootstrapError;
  }
  if (lastBootstrapError instanceof Error) {
    throw new BridgeError('BRIDGE_VENV_BOOTSTRAP_FAILED', lastBootstrapError.message);
  }
  throw new BridgeError(
    'BRIDGE_VENV_BOOTSTRAP_FAILED',
    'Python was detected, but the Workspai bridge environment could not be created.'
  );
}

/**
 * Check if rapidkit-core is available in ANY Python environment (comprehensive detection)
 */
async function checkRapidkitCoreAvailable(): Promise<boolean> {
  const verbose = !!process.env.RAPIDKIT_DEBUG;
  const debug = (msg: string) => {
    if (verbose) {
      process.stderr.write(`[DEBUG] checkRapidkitCore: ${msg}\n`);
    }
  };

  const dynamicPythonCommands = Array.from(
    new Set([
      ...getPythonCommandCandidates(),
      ...getPythonVersionProbeCandidates(14, RAPIDKIT_CORE_MINIMUM_PYTHON_MINOR).map(
        (probe) => probe.command
      ),
    ])
  );

  // Method 1: Try detected Python commands with import
  for (const cmd of dynamicPythonCommands) {
    if (!(await hasCoreCompatiblePython(cmd))) continue;
    try {
      debug(`Method 1: trying ${cmd} import`);
      const result = await execa(
        cmd,
        pythonLauncherArgs(cmd, ['-c', 'import rapidkit_core; print(1)']),
        {
          reject: false,
          stdio: 'pipe',
          timeout: probeTimeoutMs,
        }
      );
      if (result.exitCode === 0 && result.stdout?.trim() === '1') {
        debug(`✓ Found via ${cmd} import`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 2: Try python -m pip show
  for (const cmd of dynamicPythonCommands) {
    try {
      debug(`Method 2: trying ${cmd} -m pip show`);
      const result = await execa(
        cmd,
        pythonLauncherArgs(cmd, ['-m', 'pip', 'show', 'rapidkit-core']),
        {
          reject: false,
          stdio: 'pipe',
          timeout: probeTimeoutMs,
        }
      );
      if (result.exitCode === 0 && result.stdout?.includes('Name: rapidkit-core')) {
        debug(`✓ Found via ${cmd} -m pip show`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 3: Try direct pip/pip3 commands
  for (const cmd of ['pip', 'pip3']) {
    try {
      debug(`Method 3: trying ${cmd} show`);
      const result = await execa(cmd, ['show', 'rapidkit-core'], {
        reject: false,
        stdio: 'pipe',
        timeout: probeTimeoutMs,
      });
      if (result.exitCode === 0 && result.stdout?.includes('Name: rapidkit-core')) {
        debug(`✓ Found via ${cmd} show`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 4: Check pyenv versions (direct path access)
  try {
    debug('Method 4: checking pyenv versions');
    const versionsResult = await execa('pyenv', ['versions', '--bare'], {
      reject: false,
      stdio: 'pipe',
      timeout: probeTimeoutMs,
    });

    if (versionsResult.exitCode === 0 && versionsResult.stdout) {
      const versions = versionsResult.stdout.split('\n').filter((v) => v.trim());
      debug(`Found pyenv versions: ${versions.join(', ')}`);

      for (const version of versions) {
        const pyenvRoot = process.env.PYENV_ROOT || path.join(os.homedir(), '.pyenv');
        const pipPath = path.join(pyenvRoot, 'versions', version.trim(), 'bin', 'pip');

        try {
          const result = await execa(pipPath, ['show', 'rapidkit-core'], {
            reject: false,
            stdio: 'pipe',
            timeout: probeTimeoutMs,
          });
          if (result.exitCode === 0 && result.stdout?.includes('Name: rapidkit-core')) {
            debug(`✓ Found in pyenv ${version}`);
            return true;
          }
        } catch {
          // Try with PYENV_VERSION environment variable
          try {
            const result = await execa('pyenv', ['exec', 'pip', 'show', 'rapidkit-core'], {
              reject: false,
              stdio: 'pipe',
              timeout: probeTimeoutMs,
              env: {
                ...process.env,
                PYENV_VERSION: version.trim(),
              },
            });
            if (result.exitCode === 0 && result.stdout?.includes('Name: rapidkit-core')) {
              debug(`✓ Found in pyenv ${version} via PYENV_VERSION`);
              return true;
            }
          } catch {
            continue;
          }
        }
      }
    }
  } catch {
    debug('pyenv not available');
  }

  // Method 5: Check user site-packages
  for (const cmd of dynamicPythonCommands) {
    try {
      debug(`Method 5: checking ${cmd} user site`);
      const result = await execa(cmd, pythonLauncherArgs(cmd, ['-m', 'site', '--user-site']), {
        reject: false,
        stdio: 'pipe',
        timeout: probeTimeoutMs,
      });

      if (result.exitCode === 0 && result.stdout) {
        const userSite = result.stdout.trim();
        const pkgPath = path.join(userSite, 'rapidkit_core');

        if (await fsExtra.pathExists(pkgPath)) {
          debug(`✓ Found in user site-packages`);
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  // Method 6: Check pipx
  try {
    debug('Method 6: checking pipx');
    const result = await execa('pipx', ['list'], {
      reject: false,
      stdio: 'pipe',
      timeout: probeTimeoutMs,
    });
    if (result.exitCode === 0 && result.stdout?.includes('rapidkit-core')) {
      debug(`✓ Found via pipx`);
      return true;
    }
  } catch {
    debug('pipx not available');
  }

  for (const cmd of dynamicPythonCommands) {
    try {
      debug(`Method 6: checking ${cmd} -m pipx list`);
      const result = await execa(cmd, pythonLauncherArgs(cmd, ['-m', 'pipx', 'list']), {
        reject: false,
        stdio: 'pipe',
        timeout: probeTimeoutMs,
      });
      if (result.exitCode === 0 && result.stdout?.includes('rapidkit-core')) {
        debug(`✓ Found via ${cmd} -m pipx list`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 7: Check poetry (if in a project directory)
  try {
    debug('Method 7: checking poetry');
    const result = await execa('poetry', ['show', 'rapidkit-core'], {
      reject: false,
      stdio: 'pipe',
      timeout: probeTimeoutMs,
    });
    if (result.exitCode === 0) {
      debug(`✓ Found via poetry`);
      return true;
    }
  } catch {
    debug('poetry check failed');
  }

  for (const cmd of dynamicPythonCommands) {
    try {
      debug(`Method 7: checking ${cmd} -m poetry show rapidkit-core`);
      const result = await execa(
        cmd,
        pythonLauncherArgs(cmd, ['-m', 'poetry', 'show', 'rapidkit-core']),
        {
          reject: false,
          stdio: 'pipe',
          timeout: probeTimeoutMs,
        }
      );
      if (result.exitCode === 0) {
        debug(`✓ Found via ${cmd} -m poetry`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 8: Check conda
  try {
    debug('Method 8: checking conda');
    const result = await execa('conda', ['list', 'rapidkit-core'], {
      reject: false,
      stdio: 'pipe',
      timeout: probeTimeoutMs,
    });
    if (result.exitCode === 0 && result.stdout?.includes('rapidkit-core')) {
      debug(`✓ Found via conda`);
      return true;
    }
  } catch {
    debug('conda not available');
  }

  debug('✗ Not found in any environment');
  return false;
}

type VersionCompareOp = '==' | '>=' | '<=' | '>' | '<' | '~=';

type VersionConstraintPart = {
  op: VersionCompareOp;
  version: string;
};

type RapidkitCoreVersionCompatibility = {
  isCompatible: boolean;
  installedVersion: string | null;
  expectedConstraint: string | null;
  reason:
    | 'compatible'
    | 'incompatible-version'
    | 'constraint-missing'
    | 'constraint-unsupported'
    | 'version-not-detected';
};

function parseRapidkitCoreConstraint(spec: string): string | null {
  const trimmed = spec.trim();

  if (!trimmed || !trimmed.startsWith('rapidkit-core')) {
    return null;
  }

  // Examples:
  // rapidkit-core==0.27.4
  // rapidkit-core>=0.27,<0.28
  // rapidkit-core ~=0.27.4
  const constraint = trimmed.slice('rapidkit-core'.length).trim();
  if (!constraint) return null;

  // Unsupported install targets (URL/git/path/whl/tar) cannot be compared safely.
  if (/[\/@]|\.whl$|\.tar\.gz$|\.zip$|git\+|https?:\/\//.test(constraint)) {
    return null;
  }

  return constraint;
}

function normalizeVersionTuple(version: string): number[] | null {
  const cleaned = version.trim();
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  const tuple: number[] = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)/);
    if (!match) {
      tuple.push(0);
      continue;
    }
    tuple.push(Number.parseInt(match[1], 10));
  }

  return tuple;
}

function compareVersionTuple(a: number[], b: number[]): number {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    const av = i < a.length ? a[i] : 0;
    const bv = i < b.length ? b[i] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function bumpCompatibleUpperBound(version: number[]): number[] {
  if (version.length <= 1) {
    return [version[0] + 1];
  }

  // PEP 440 ~= behavior:
  // ~=X.Y   => >=X.Y,<X+1
  // ~=X.Y.Z => >=X.Y.Z,<X.Y+1
  if (version.length === 2) {
    return [version[0] + 1, 0];
  }

  return [version[0], version[1] + 1, 0];
}

function parseConstraintParts(constraint: string): VersionConstraintPart[] | null {
  const rawParts = constraint
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawParts.length === 0) return null;

  const parts: VersionConstraintPart[] = [];
  for (const raw of rawParts) {
    const match = raw.match(/^(==|>=|<=|>|<|~=)\s*([0-9][0-9A-Za-z+._-]*)$/);
    if (!match) return null;
    parts.push({ op: match[1] as VersionCompareOp, version: match[2] });
  }
  return parts;
}

function isVersionSatisfyingConstraint(version: string, constraint: string): boolean {
  const installed = normalizeVersionTuple(version);
  if (!installed) return false;

  const parts = parseConstraintParts(constraint);
  if (!parts) return false;

  for (const part of parts) {
    const target = normalizeVersionTuple(part.version);
    if (!target) return false;

    const cmp = compareVersionTuple(installed, target);
    if (part.op === '==' && cmp !== 0) return false;
    if (part.op === '>=' && cmp < 0) return false;
    if (part.op === '<=' && cmp > 0) return false;
    if (part.op === '>' && cmp <= 0) return false;
    if (part.op === '<' && cmp >= 0) return false;

    if (part.op === '~=') {
      if (cmp < 0) return false;
      const upperBound = bumpCompatibleUpperBound(target);
      if (compareVersionTuple(installed, upperBound) >= 0) return false;
    }
  }

  return true;
}

async function detectRapidkitCoreVersion(): Promise<string | null> {
  const dynamicPythonCommands = Array.from(
    new Set([
      ...getPythonCommandCandidates(),
      ...getPythonVersionProbeCandidates(14, RAPIDKIT_CORE_MINIMUM_PYTHON_MINOR).map(
        (probe) => probe.command
      ),
    ])
  );

  const parseVersionFromPipShow = (text: string): string | null => {
    const match = text.match(/^Version:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  };

  for (const cmd of dynamicPythonCommands) {
    if (!(await hasCoreCompatiblePython(cmd))) continue;
    try {
      const result = await execa(
        cmd,
        pythonLauncherArgs(cmd, ['-m', 'pip', 'show', 'rapidkit-core']),
        {
          reject: false,
          stdio: 'pipe',
          timeout: probeTimeoutMs,
        }
      );

      if (result.exitCode === 0) {
        const parsed = parseVersionFromPipShow(result.stdout || '');
        if (parsed) return parsed;
      }
    } catch {
      continue;
    }
  }

  for (const cmd of ['pip', 'pip3']) {
    try {
      const result = await execa(cmd, ['show', 'rapidkit-core'], {
        reject: false,
        stdio: 'pipe',
        timeout: probeTimeoutMs,
      });

      if (result.exitCode === 0) {
        const parsed = parseVersionFromPipShow(result.stdout || '');
        if (parsed) return parsed;
      }
    } catch {
      continue;
    }
  }

  try {
    const result = await execa('pipx', ['list'], {
      reject: false,
      stdio: 'pipe',
      timeout: probeTimeoutMs,
    });
    if (result.exitCode === 0 && result.stdout) {
      const match = result.stdout.match(/rapidkit-core\s+([0-9][0-9A-Za-z+._-]*)/i);
      if (match?.[1]) return match[1];
    }
  } catch {
    // ignore and continue
  }

  return null;
}

async function checkRapidkitCoreVersionCompatible(): Promise<RapidkitCoreVersionCompatibility> {
  const spec = coreInstallTarget();
  const expectedConstraint = parseRapidkitCoreConstraint(spec);

  if (!expectedConstraint) {
    // Version-aware reuse requires explicit constraint (e.g. ==, >=,<, ~=)
    // in RAPIDKIT_CORE_PYTHON_PACKAGE.
    return {
      isCompatible: false,
      installedVersion: null,
      expectedConstraint: null,
      reason: isPinnedSpec(spec) ? 'constraint-unsupported' : 'constraint-missing',
    };
  }

  const installedVersion = await detectRapidkitCoreVersion();
  if (!installedVersion) {
    return {
      isCompatible: false,
      installedVersion: null,
      expectedConstraint,
      reason: 'version-not-detected',
    };
  }

  const isCompatible =
    spec === RAPIDKIT_CORE_PACKAGE
      ? installedVersion === RAPIDKIT_CORE_VERSION
      : isVersionSatisfyingConstraint(installedVersion, expectedConstraint);
  return {
    isCompatible,
    installedVersion,
    expectedConstraint,
    reason: isCompatible ? 'compatible' : 'incompatible-version',
  };
}

async function ensureBridgeVenv(pythonCmd: PythonCommand): Promise<string> {
  const desiredDir = bridgeVenvDir();
  const timeoutMs = Math.max(
    60_000,
    Number(process.env.RAPIDKIT_BRIDGE_LOCK_TIMEOUT_MS ?? 10 * 60_000)
  );
  const staleMs = Math.max(
    timeoutMs + 60_000,
    Number(process.env.RAPIDKIT_BRIDGE_LOCK_STALE_MS ?? 15 * 60_000)
  );

  try {
    return await withInterprocessLock(
      `${desiredDir}.lock`,
      () => ensureBridgeVenvLocked(pythonCmd),
      { timeoutMs, staleMs, purpose: 'python-core-bridge-bootstrap' }
    );
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BridgeError('BRIDGE_VENV_LOCK_FAILED', message);
  }
}

async function ensureBridgeVenvLocked(pythonCmd: PythonCommand): Promise<string> {
  const desiredDir = bridgeVenvDir();
  const legacyDir = legacyBridgeVenvDir();
  const spec = coreInstallTarget();
  const candidates = [desiredDir];

  if (!isPinnedSpec(spec) && !(await fsExtra.pathExists(desiredDir))) {
    if (await fsExtra.pathExists(legacyDir)) {
      candidates.push(legacyDir);
    }
  }

  for (const venvDir of candidates) {
    const py = bridgePython(venvDir);
    if (!(await fsExtra.pathExists(py))) continue;

    try {
      const health = await probeBridgeVenvHealth(venvDir);
      if (health.healthy && (await hasCoreCompatiblePython(py))) {
        return py;
      }
      await fsExtra.remove(venvDir);
    } catch {
      await fsExtra.remove(venvDir);
    }
  }

  const venvDir = desiredDir;

  const bootstrapEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Keep bootstrap noise out of stdout/stderr as much as possible.
    // Even if pip emits notices, we prefer them on stderr (and avoid them entirely when possible).
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };

  const retryCount = Math.max(0, Number(process.env.RAPIDKIT_BRIDGE_PIP_RETRY ?? '2'));
  const baseDelayMs = Math.max(
    200,
    Number(process.env.RAPIDKIT_BRIDGE_PIP_RETRY_DELAY_MS ?? '800')
  );
  const pipTimeoutMs = Math.max(
    10_000,
    Number(process.env.RAPIDKIT_BRIDGE_PIP_TIMEOUT_MS ?? '120000')
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runBootstrap = async (
    cmd: string,
    cmdArgs: string[],
    timeoutMs?: number
  ): Promise<void> => {
    const res = await execa(cmd, cmdArgs, {
      reject: false,
      // Keep stdout captured (avoid polluting JSON), but stream stderr so users see progress.
      stdio: ['ignore', 'pipe', 'inherit'],
      env: bootstrapEnv,
      timeout: timeoutMs,
    });

    if (res.exitCode === 0) return;

    const out = (res.stdout ?? '').toString();
    const err = (res.stderr ?? '').toString();
    const details = [out, err].filter(Boolean).join('\n');
    const msg = details ? `${cmd} ${cmdArgs.join(' ')}\n${details}` : `${cmd} ${cmdArgs.join(' ')}`;
    throw new Error(msg);
  };

  const runBootstrapWithRetry = async (
    cmd: string,
    cmdArgs: string[],
    timeoutMs?: number
  ): Promise<void> => {
    let attempt = 0;
    // total attempts = retryCount + 1
    while (true) {
      try {
        await runBootstrap(cmd, cmdArgs, timeoutMs);
        return;
      } catch (err) {
        if (attempt >= retryCount) throw err;
        const jitter = Math.floor(Math.random() * 200);
        const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
        attempt += 1;
        await sleep(delay);
      }
    }
  };

  try {
    await fsExtra.ensureDir(path.dirname(venvDir));
    try {
      await runBootstrap(pythonCmd, pythonLauncherArgs(pythonCmd, ['-m', 'venv', venvDir]), 60_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BridgeError('BRIDGE_VENV_CREATE_FAILED', msg);
    }

    const vpy = bridgePython(venvDir);

    // Check if pip is available in venv (some systems create venv without pip)
    const pipCheck = await execa(vpy, ['-m', 'pip', '--version'], {
      reject: false,
      stdio: 'pipe',
      timeout: 2000,
    });

    if (pipCheck.exitCode !== 0) {
      // pip not available, try to bootstrap it using ensurepip
      const ensurePipResult = await execa(vpy, ['-m', 'ensurepip', '--default-pip'], {
        reject: false,
        stdio: ['ignore', 'pipe', 'inherit'],
        env: bootstrapEnv,
        timeout: 60_000,
      });

      if (ensurePipResult.exitCode !== 0) {
        throw new BridgeError(
          'BRIDGE_PIP_BOOTSTRAP_FAILED',
          'ensurepip failed; install python3-venv/python3-pip and retry.'
        );
      }
    }

    if (process.env.RAPIDKIT_BRIDGE_UPGRADE_PIP === '1') {
      try {
        await runBootstrapWithRetry(vpy, ['-m', 'pip', 'install', '-U', 'pip'], pipTimeoutMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new BridgeError('BRIDGE_PIP_UPGRADE_FAILED', msg);
      }
    }

    // IMPORTANT: never inherit stdout here.
    // Bootstrap output must not pollute stdout because core commands like `rapidkit list --json`
    // rely on stdout being valid JSON.
    try {
      await runBootstrapWithRetry(
        vpy,
        ['-m', 'pip', 'install', '-U', coreInstallTarget()],
        pipTimeoutMs
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BridgeError('BRIDGE_PIP_INSTALL_FAILED', msg);
    }
    const health = await probeBridgeVenvHealth(venvDir);
    if (!health.healthy) {
      await fsExtra.remove(venvDir);
      throw new BridgeError(
        'BRIDGE_VENV_HEALTH_FAILED',
        health.details ||
          'rapidkit --version --json did not return the expected Core version contract.'
      );
    }
    return vpy;
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new BridgeError('BRIDGE_VENV_BOOTSTRAP_FAILED', msg);
  }
}

export async function resolveRapidkitPython(): Promise<
  { kind: 'system'; cmd: PythonCommand } | { kind: 'venv'; pythonPath: string }
> {
  // Deterministic mode (used by drift-guard / CI): always use the bridge venv.
  // This avoids accidentally using a developer's globally-installed rapidkit.
  if (process.env.RAPIDKIT_BRIDGE_FORCE_VENV === '1') {
    const pythonPath = await ensureBridgeVenvFromCandidates();
    return { kind: 'venv', pythonPath };
  }

  // Prefer system python if it already has rapidkit available.
  for (const cmd of pythonCommandCandidates()) {
    if (!(await hasCoreCompatiblePython(cmd))) continue;
    if (await tryRapidkit(cmd)) {
      return { kind: 'system', cmd };
    }
  }

  // Otherwise bootstrap a cached venv and install rapidkit-core there.
  const system = await pickSystemPython();
  if (!system) {
    throw new BridgeError('PYTHON_NOT_FOUND', 'No Python interpreter found (python3/python/py).');
  }
  let pythonPath: string;
  try {
    pythonPath = await ensureBridgeVenv(system);
  } catch {
    pythonPath = await ensureBridgeVenvFromCandidates();
  }
  return { kind: 'venv', pythonPath };
}

export async function runCoreRapidkit(args: string[], opts?: ExecOpts): Promise<number> {
  try {
    const runner = await resolveRapidkitRunner(opts?.cwd);
    const cmd = runner.cmd;
    const cmdArgs = [...runner.baseArgs, ...coreCommandArgs(args)];

    const isInitCommand = args[0] === 'init';

    if (isInitCommand) {
      const res = await execa(cmd, cmdArgs, {
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        reject: false,
        stdio: 'pipe',
      });

      const filteredStdout = filterNoisyInitOutput((res.stdout ?? '').toString());
      const filteredStderr = filterNoisyInitOutput((res.stderr ?? '').toString());

      if (filteredStdout) {
        process.stdout.write(
          filteredStdout.endsWith('\n') ? filteredStdout : `${filteredStdout}\n`
        );
      }
      if (filteredStderr) {
        process.stderr.write(
          filteredStderr.endsWith('\n') ? filteredStderr : `${filteredStderr}\n`
        );
      }

      return typeof res.exitCode === 'number' ? res.exitCode : 1;
    }

    const res = await execa(cmd, cmdArgs, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      reject: false,
      stdio: 'inherit',
    });

    return typeof res.exitCode === 'number' ? res.exitCode : 1;
  } catch (e) {
    process.stderr.write(`${formatBridgeError(e)}\n`);
    return 1;
  }
}

/**
 * Known RapidKitError patterns from the Python core engine.
 * Maps a regex (tested against collected stderr) to a user-friendly message factory.
 */
const KNOWN_CORE_ERRORS: Array<{
  pattern: RegExp;
  message: (match: RegExpMatchArray) => string;
}> = [
  {
    pattern: /RapidKitError:\s*Directory '([^']+)' exists and force is not set/,
    message: (m) => {
      const dir = path.basename(m[1]);
      return (
        `❌ Directory "${dir}" already exists.\n` +
        `   Target: ${m[1]}\n` +
        '💡 Choose a different name, or inspect and move/remove the existing directory first.'
      );
    },
  },
  {
    pattern: /RapidKitError:\s*Project name '([^']+)' is (invalid|not allowed)/i,
    message: (m) =>
      `❌ Invalid project name: "${m[1]}"\n` +
      `💡 Use lowercase letters, numbers, and hyphens only (e.g. my-api).`,
  },
  {
    pattern: /RapidKitError:\s*Kit '([^']+)' not found/i,
    message: (m) =>
      `❌ Unknown kit: "${m[1]}"\n` + `💡 Run "npx workspai list" to see available kits.`,
  },
  {
    // Generic RapidKitError fallback — extract just the message line
    pattern: /RapidKitError:\s*(.+)/,
    message: (m) => `❌ ${m[1].trim()}`,
  },
];

/**
 * Like runCoreRapidkit but streams stdout live while silently buffering stderr.
 * On failure, known RapidKitError patterns are replaced with clean user-facing
 * messages instead of showing the raw Python traceback.
 */
export async function runCoreRapidkitStreamed(args: string[], opts?: ExecOpts): Promise<number> {
  const { spawn } = await import('child_process');

  try {
    const runner = await resolveRapidkitRunner(opts?.cwd);
    const cmd = runner.cmd;
    const cmdArgs = [...runner.baseArgs, ...coreCommandArgs(args)];

    return await new Promise<number>((resolve) => {
      const child = spawn(cmd, cmdArgs, {
        cwd: opts?.cwd,
        env: { ...process.env, ...opts?.env },
        stdio: ['inherit', 'inherit', 'pipe'],
      });

      const stderrChunks: Buffer[] = [];

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('close', (code) => {
        const exitCode = code ?? 1;

        if (exitCode !== 0 && stderrChunks.length > 0) {
          const raw = Buffer.concat(stderrChunks).toString('utf8');

          for (const { pattern, message } of KNOWN_CORE_ERRORS) {
            const match = raw.match(pattern);
            if (match) {
              process.stderr.write(message(match) + '\n');
              resolve(exitCode);
              return;
            }
          }

          // No known pattern — fall back to the raw output so nothing is lost
          process.stderr.write(raw);
        }

        resolve(exitCode);
      });

      child.on('error', (err) => {
        process.stderr.write(`${formatBridgeError(err)}\n`);
        resolve(1);
      });
    });
  } catch (e) {
    process.stderr.write(`${formatBridgeError(e)}\n`);
    return 1;
  }
}

export async function runCoreRapidkitCapture(
  args: string[],
  opts?: ExecOpts
): Promise<CaptureResult> {
  try {
    const runner = await resolveRapidkitRunner(opts?.cwd);
    const cmd = runner.cmd;
    const cmdArgs = [...runner.baseArgs, ...coreCommandArgs(args)];

    const res = await execa(cmd, cmdArgs, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      reject: false,
      stdio: 'pipe',
    });

    return {
      exitCode: typeof res.exitCode === 'number' ? res.exitCode : 1,
      stdout: (res.stdout ?? '').toString(),
      stderr: (res.stderr ?? '').toString(),
    };
  } catch (e) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${formatBridgeError(e)}\n`,
    };
  }
}

type CoreCommandsCache = {
  schema_version: 1;
  fetched_at: number;
  rapidkit_version?: string;
  commands: string[];
};

function parseCoreCommandsFromHelp(helpText: string): Set<string> {
  const commands = new Set<string>();

  // Typer/Click help format typically contains a "Commands:" section:
  //   Commands:
  //     list     List available kits
  //     modules  ...
  // Older or alternative formats may include lines like: "rapidkit <cmd>".
  const lines = helpText.split('\n');

  let inCommandsSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');

    if (!inCommandsSection) {
      if (/^\s*Commands:\s*$/i.test(line)) {
        inCommandsSection = true;
      }
      // Fallback: some help outputs include explicit invocations
      const explicit = line.match(/^\s*rapidkit\s+([a-z0-9_-]+)\b/i);
      if (explicit) {
        const name = explicit[1].trim();
        if (name && !name.startsWith('-')) commands.add(name);
      }
      continue;
    }

    // End of section (blank line or next header)
    if (!line.trim()) break;
    if (/^\s*(Options|Arguments|Usage|Commands)\s*:/i.test(line)) continue;

    // Parse command rows: "  <name>  <description>"
    const m = line.match(/^\s*([a-z0-9][a-z0-9_-]*)\b/i);
    if (!m) continue;
    const name = m[1].trim();
    if (name && !name.startsWith('-')) commands.add(name);
  }

  return commands;
}

async function tryReadCommandsCache(): Promise<CoreCommandsCache | null> {
  const p = commandsCachePath();
  if (!(await fsExtra.pathExists(p))) return null;
  try {
    const data = await fsExtra.readJson(p);
    if (data && data.schema_version === 1 && Array.isArray(data.commands)) {
      return data as CoreCommandsCache;
    }
  } catch {
    // ignore
  }
  return null;
}

async function writeCommandsCache(cache: CoreCommandsCache): Promise<void> {
  const p = commandsCachePath();
  await fsExtra.ensureDir(path.dirname(p));
  await fsExtra.writeJson(p, cache, { spaces: 2 });
}

async function getCoreVersion(): Promise<string | undefined> {
  const res = await runCoreRapidkitCapture(['version', '--json'], { cwd: process.cwd() });
  if (res.exitCode !== 0) return undefined;
  try {
    const payload = JSON.parse(res.stdout);
    const v = payload?.version;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

async function getCoreCommandsJson(): Promise<string[] | null> {
  const res = await runCoreRapidkitCapture(['commands', '--json'], { cwd: process.cwd() });
  if (res.exitCode !== 0) return null;
  try {
    const payload = JSON.parse(res.stdout) as {
      schema_version?: number;
      commands?: unknown;
    };
    if (payload?.schema_version !== 1 || !Array.isArray(payload.commands)) return null;
    const list = payload.commands.filter((c): c is string => typeof c === 'string');
    return list.length ? list : null;
  } catch {
    return null;
  }
}

export async function getCoreTopLevelCommands(): Promise<Set<string>> {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const cached = await tryReadCommandsCache();
  const currentVersion = await getCoreVersion();

  // Guard against buggy/empty caches (e.g., if parsing previously returned nothing).
  // Treat as missing so we re-fetch and/or fall back to bootstrap commands.
  const cachedHasCommands = !!cached?.commands?.length;

  if (
    cachedHasCommands &&
    now - cached.fetched_at < ONE_DAY_MS &&
    (!currentVersion || !cached.rapidkit_version || cached.rapidkit_version === currentVersion)
  ) {
    return new Set(cached.commands);
  }

  const jsonCommands = await getCoreCommandsJson();
  if (jsonCommands?.length) {
    const list = Array.from(new Set(jsonCommands)).sort();
    await writeCommandsCache({
      schema_version: 1,
      fetched_at: now,
      rapidkit_version: currentVersion,
      commands: list,
    });
    return new Set(list);
  }

  const help = await runCoreRapidkitCapture(['--help'], { cwd: process.cwd() });
  if (help.exitCode !== 0) {
    // Fall back to the cached set if available.
    if (cachedHasCommands && cached?.commands) return new Set(cached.commands);
    return new Set(BOOTSTRAP_CORE_COMMANDS_SET);
  }

  const cmds = parseCoreCommandsFromHelp(help.stdout);
  if (cmds.size === 0) {
    // If we can't parse help output, don't poison the cache.
    // Fall back to an empty set here; shouldForwardToCore() will still forward
    // well-known commands via BOOTSTRAP_CORE_COMMANDS_SET.
    return new Set(BOOTSTRAP_CORE_COMMANDS_SET);
  }
  const list = Array.from(cmds).sort();

  await writeCommandsCache({
    schema_version: 1,
    fetched_at: now,
    rapidkit_version: currentVersion,
    commands: list,
  });

  return cmds;
}

export async function getCachedCoreTopLevelCommands(): Promise<Set<string> | null> {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const cached = await tryReadCommandsCache();
  if (!cached) return null;
  if (now - cached.fetched_at >= ONE_DAY_MS) return null;
  if (!cached.commands?.length) return null;
  return new Set(cached.commands);
}

export type ModulesCatalog = {
  schema_version: 1;
  generated_at?: string;
  etag?: string;
  filters?: {
    category?: string | null;
    tag?: string | null;
    detailed?: boolean;
    [key: string]: unknown;
  };
  stats?: {
    total?: number;
    returned?: number;
    invalid?: number;
    [key: string]: unknown;
  };
  modules: Array<Record<string, unknown>>;
  invalid_modules?: Array<{ slug: string; messages?: string[] }>;
  warnings?: string[];
  errors?: string[];
  source?: string;
  fetched_at?: number;
};

type ModulesCatalogOptions = {
  category?: string;
  tag?: string;
  detailed?: boolean;
  ttlMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function modulesCatalogCachePath(): string {
  return path.join(cacheRoot(), 'rapidkit', 'npm-bridge', 'modules-catalog.json');
}

async function tryReadModulesCatalogCache(): Promise<ModulesCatalog | null> {
  const p = modulesCatalogCachePath();
  if (!(await fsExtra.pathExists(p))) return null;
  try {
    const data = await fsExtra.readJson(p);
    if (data && data.schema_version === 1 && Array.isArray(data.modules)) {
      return data as ModulesCatalog;
    }
  } catch {
    // ignore
  }
  return null;
}

async function writeModulesCatalogCache(cache: ModulesCatalog): Promise<void> {
  const p = modulesCatalogCachePath();
  await fsExtra.ensureDir(path.dirname(p));
  await fsExtra.writeJson(p, cache, { spaces: 2 });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getModulesCatalog(
  opts: ModulesCatalogOptions = {}
): Promise<ModulesCatalog | null> {
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : 30 * 60 * 1000;
  const now = Date.now();

  const cached = await tryReadModulesCatalogCache();
  if (cached?.fetched_at && now - cached.fetched_at < ttlMs) {
    return cached;
  }

  const args = ['modules', 'list', '--json-schema', '1'];
  if (opts.category) args.push('--category', opts.category);
  if (opts.tag) args.push('--tag', opts.tag);
  if (opts.detailed) args.push('--detailed');

  const res = await runCoreRapidkitCapture(args, { cwd: opts.cwd, env: opts.env });
  if (res.exitCode === 0) {
    const payload = safeJsonParse(res.stdout) as ModulesCatalog | null;
    if (payload && payload.schema_version === 1 && Array.isArray(payload.modules)) {
      const enriched = { ...payload, fetched_at: now };
      await writeModulesCatalogCache(enriched);
      return enriched;
    }
  }

  const legacy = await runCoreRapidkitCapture(['modules', 'list', '--json'], {
    cwd: opts.cwd,
    env: opts.env,
  });
  if (legacy.exitCode === 0) {
    const data = safeJsonParse(legacy.stdout);
    if (Array.isArray(data)) {
      const legacyPayload: ModulesCatalog = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        filters: {
          category: opts.category ?? null,
          tag: opts.tag ?? null,
          detailed: !!opts.detailed,
        },
        stats: {
          total: data.length,
          returned: data.length,
          invalid: 0,
        },
        modules: data as Array<Record<string, unknown>>,
        source: 'legacy-json',
        fetched_at: now,
      };
      await writeModulesCatalogCache(legacyPayload);
      return legacyPayload;
    }
  }

  if (cached) return cached;
  return null;
}
// --- internal/private functions for testing ---
export const __test__ = {
  pythonCommandCandidates,
  pickSystemPython,
  ensureBridgeVenv,
  probeBridgeVenvHealth,
  ensureBridgeVenvFromCandidates,
  parseCoreCommandsFromHelp,
  tryRapidkit,
  findUserLocalRapidkitRunner,
  findPathRapidkitRunner,
  findWorkspaceRunner,
  checkRapidkitCoreAvailable,
  checkRapidkitCoreVersionCompatible,
  isVersionSatisfyingConstraint,
};

// Export the comprehensive detection function for public use
export { checkRapidkitCoreAvailable, checkRapidkitCoreVersionCompatible };
