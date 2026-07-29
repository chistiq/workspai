import { promises as fsPromises } from 'fs';
import * as fsExtra from 'fs-extra';
import path from 'path';
import { prompt } from './cli-ui/index.js';
import { printWorkspaceCreationReceipt } from './cli-ui/workspace-creation-receipt.js';
import {
  assertIndependentWorkspaceTarget,
  formatWorkspaceCdCommand,
} from './utils/workspace-create-location.js';
import { finalizeWorkspaceOnboarding } from './utils/workspace-onboarding.js';
import chalk from 'chalk';
import type { CliSpinnerHandle } from './observability/cli-progress.js';
import { execa } from 'execa';
import { logger } from './logger.js';
import { createCliSpinner, emitCliInstallProgress } from './observability/cli-progress.js';
import { UserConfig, getTestRapidKitPath } from './config.js';
import { getVersion } from './update-checker.js';
import {
  DirectoryExistsError,
  PythonNotFoundError,
  PoetryNotFoundError,
  PipxNotFoundError,
  InstallationError,
  RapidKitNotAvailableError,
} from './errors.js';
import { getPythonCommand } from './utils.js';
import {
  getDefaultPythonCommand,
  getWorkspaceRegistryDirectory,
  getWorkspaceRegistryFileCandidates,
  getPythonCommandCandidates,
  getPythonVersionProbeCandidates,
  getUserLocalBinCandidates,
  getVenvPythonPath,
  isWindowsPlatform,
} from './utils/platform-capabilities.js';
import {
  createLifecycleTransaction,
  recoverActiveLifecycleTransactions,
  type LifecycleTransaction,
} from './utils/lifecycle-transaction.js';
import { WORKSPACE_CONTRACT_PATH } from './utils/workspace-contract.js';
import { WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH } from './utils/workspace-registry-summary.js';
import {
  createNpmWorkspaceMarker,
  writeWorkspaceMarker as writeWorkspaceMarkerToFile,
} from './workspace-marker.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import {
  LEGACY_RAPIDKIT_METADATA_DIR,
  LEGACY_RAPIDKIT_WORKSPACE_MARKER,
  WORKSPAI_METADATA_DIR,
  WORKSPAI_WORKSPACE_MARKER,
} from './utils/workspace-paths.js';

const WORKSPACE_LIFECYCLE_JOURNAL_DIRECTORY = 'transactions';

function lifecycleJournalDirectory(): string {
  return path.join(getWorkspaceRegistryDirectory(), WORKSPACE_LIFECYCLE_JOURNAL_DIRECTORY);
}

async function beginLifecycleTransaction(): Promise<LifecycleTransaction> {
  const journalDirectory = lifecycleJournalDirectory();
  await recoverActiveLifecycleTransactions(journalDirectory);
  return createLifecycleTransaction({ journalDirectory });
}

async function captureGlobalRegistryFiles(transaction: LifecycleTransaction): Promise<void> {
  for (const registryFile of getWorkspaceRegistryFileCandidates()) {
    await transaction.captureFile(registryFile);
  }
}

async function beginNewWorkspaceTransaction(workspacePath: string): Promise<LifecycleTransaction> {
  const transaction = await beginLifecycleTransaction();
  try {
    await captureGlobalRegistryFiles(transaction);
    await transaction.captureOwnedTree(workspacePath);
    return transaction;
  } catch (error) {
    return rollbackLifecycleTransaction(transaction, error);
  }
}

async function beginExistingWorkspaceTransaction(
  workspacePath: string
): Promise<LifecycleTransaction> {
  const transaction = await beginLifecycleTransaction();
  try {
    await captureGlobalRegistryFiles(transaction);
    await transaction.captureOwnedTree(path.join(workspacePath, WORKSPAI_METADATA_DIR));
    await transaction.captureOwnedTree(path.join(workspacePath, '.venv'));

    const touchedFiles = [
      WORKSPAI_WORKSPACE_MARKER,
      '.gitignore',
      path.join(WORKSPAI_METADATA_DIR, 'workspace.json'),
      path.join(WORKSPAI_METADATA_DIR, 'toolchain.lock'),
      path.join(WORKSPAI_METADATA_DIR, 'policies.yml'),
      path.join(WORKSPAI_METADATA_DIR, 'cache-config.yml'),
      WORKSPACE_CONTRACT_PATH,
      WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH,
      'pyproject.toml',
      'poetry.toml',
      'poetry.lock',
      'rapidkit',
      'rapidkit.cmd',
      'README.md',
      '.rapidkit-global',
    ];
    for (const relativePath of touchedFiles) {
      await transaction.captureFile(path.join(workspacePath, relativePath));
    }
    return transaction;
  } catch (error) {
    return rollbackLifecycleTransaction(transaction, error);
  }
}

async function commitLifecycleTransaction(transaction: LifecycleTransaction): Promise<void> {
  await transaction.commit();
  if (transaction.journalPath) {
    await fsPromises
      .rm(path.dirname(transaction.journalPath), { recursive: true, force: true })
      .catch((error) => logger.debug(`Could not remove committed lifecycle journal: ${error}`));
  }
}

async function rollbackLifecycleTransaction(
  transaction: LifecycleTransaction,
  failure: unknown
): Promise<never> {
  try {
    await transaction.rollback();
  } catch (rollbackFailure) {
    throw new AggregateError(
      [failure, rollbackFailure],
      'Workspace lifecycle failed and rollback was incomplete.'
    );
  }
  throw failure;
}

async function writeWorkspaceMarker(
  workspacePath: string,
  workspaceName: string,
  installMethod?: 'poetry' | 'venv' | 'pipx',
  pythonVersion?: string,
  bootstrapMeta?: WorkspaceBootstrapMeta
): Promise<void> {
  const markerObj = createNpmWorkspaceMarker(
    workspaceName,
    getVersion(),
    installMethod,
    bootstrapMeta?.pythonEngine
      ? {
          coreStatus: bootstrapMeta.pythonEngine,
          ...(bootstrapMeta.pythonEngineReason
            ? { coreReason: bootstrapMeta.pythonEngineReason }
            : {}),
          ...(pythonVersion ? { pythonVersion } : {}),
        }
      : undefined
  );

  // Add Python version to marker if provided
  if (pythonVersion && !bootstrapMeta?.pythonEngine) {
    if (!markerObj.metadata) markerObj.metadata = {};
    (markerObj.metadata as Record<string, unknown>).python = { pythonVersion };
  }

  await writeWorkspaceMarkerToFile(workspacePath, markerObj);
}

async function writeWorkspaceGitignore(workspacePath: string): Promise<void> {
  // Keep parity with the VS Code extension workspace output.
  await fsExtra.outputFile(
    path.join(workspacePath, '.gitignore'),
    `.venv/\n__pycache__/\n*.pyc\n.env\n${LEGACY_RAPIDKIT_WORKSPACE_MARKER}\n${LEGACY_RAPIDKIT_METADATA_DIR}/\n\n`,
    'utf-8'
  );
}

type GitInitSpinner = Pick<CliSpinnerHandle, 'start' | 'succeed' | 'warn'>;

async function findContainingGitRoot(targetPath: string): Promise<string | null> {
  try {
    const result = await execa('git', ['rev-parse', '--show-toplevel'], {
      cwd: targetPath,
      env: buildCleanGitEnv(),
    });
    return result.stdout.trim() ? path.resolve(targetPath, result.stdout.trim()) : null;
  } catch {
    return null;
  }
}

async function initializeStandaloneGitRepository(
  targetPath: string,
  spinner: GitInitSpinner,
  commitMessage: string
): Promise<void> {
  const existingGitRoot = await findContainingGitRoot(targetPath);
  if (existingGitRoot) {
    spinner.warn('Git initialization skipped because target is already inside a git worktree');
    return;
  }

  spinner.start('Initializing git repository');
  try {
    await execa('git', ['init'], { cwd: targetPath, env: buildCleanGitEnv() });
    await execa('git', ['add', '.'], { cwd: targetPath, env: buildCleanGitEnv() });
    // A generated workspace must get a usable baseline even on fresh machines where
    // the user has not configured a global Git identity yet. Keep this identity local
    // to the one bootstrap commit; subsequent commits use the user's normal config.
    await execa(
      'git',
      [
        '-c',
        'user.name=Workspai',
        '-c',
        'user.email=workspai@localhost',
        'commit',
        '-m',
        commitMessage,
      ],
      {
        cwd: targetPath,
        env: buildCleanGitEnv(),
      }
    );
    spinner.succeed('Git repository initialized');
  } catch {
    spinner.warn('Could not initialize git repository');
  }
}

/**
 * Write minimal pyproject.toml + poetry.toml stubs for workspaces created with
 * Python-free profiles (go-only, node-only, minimal).  These stubs carry no
 * dependencies — Poetry creates them instantly without touching the network.
 *
 * Having the files ensures that `workspai bootstrap --profile python-only`
 * (or any Python-requiring profile) can simply run `poetry install --no-root`
 * + `poetry add rapidkit-core` on the existing project without needing to
 * re-initialise from scratch.
 */
async function writePyprojectStub(workspacePath: string, workspaceName: string): Promise<void> {
  const safe = workspaceName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

  // poetry.toml — local config: keep venv inside the project (same as full workspaces)
  await fsExtra.outputFile(
    path.join(workspacePath, 'poetry.toml'),
    '[virtualenvs]\nin-project = true\n',
    'utf-8'
  );

  // pyproject.toml — minimal valid Poetry project with rapidkit-core declared.
  // rapidkit-core is listed so that when the user upgrades to a Python profile
  // (via `workspai bootstrap --profile python-only`), a plain
  // `poetry install --no-root` is enough — no separate `poetry add` needed.
  await fsExtra.outputFile(
    path.join(workspacePath, 'pyproject.toml'),
    `[tool.poetry]\n` +
      `name = "${safe}"\n` +
      `version = "0.1.0"\n` +
      `description = "Workspai workspace"\n` +
      `authors = []\n` +
      `package-mode = false\n\n` +
      `[tool.poetry.dependencies]\n` +
      `python = "^3.10"\n` +
      `rapidkit-core = "*"\n\n` +
      `[build-system]\n` +
      `requires = ["poetry-core"]\n` +
      `build-backend = "poetry.core.masonry.api"\n`,
    'utf-8'
  );
}

export function buildWorkspaceManifest(
  workspaceName: string,
  installMethod: InstallMethod,
  pythonVersion?: string,
  profile?: string,
  bootstrapMeta?: WorkspaceBootstrapMeta
): string {
  return JSON.stringify(
    {
      schema_version: '1.0',
      workspace_name: workspaceName,
      workspai_version: getVersion(),
      rapidkit_version: getVersion(),
      created_at: new Date().toISOString(),
      created_by: 'workspai',
      profile: profile || 'minimal',
      ...(bootstrapMeta?.profileRequested
        ? { profile_requested: bootstrapMeta.profileRequested }
        : {}),
      ...(bootstrapMeta?.bootstrapNote ? { bootstrap_note: bootstrapMeta.bootstrapNote } : {}),
      engine: {
        install_method: installMethod,
        python_version: pythonVersion || null,
        ...(bootstrapMeta?.pythonEngine
          ? {
              python_core: {
                status: bootstrapMeta.pythonEngine,
                ...(bootstrapMeta.pythonEngineReason
                  ? { reason: bootstrapMeta.pythonEngineReason }
                  : {}),
              },
            }
          : {}),
      },
    },
    null,
    2
  );
}

function buildToolchainLock(
  installMethod: InstallMethod,
  pythonVersion?: string,
  nodeVersion?: string,
  goVersion?: string,
  dotnetVersion?: string,
  bootstrapMeta?: WorkspaceBootstrapMeta
): string {
  return JSON.stringify(
    {
      schema_version: '1.0',
      generated_by: 'workspai',
      generated_at: new Date().toISOString(),
      runtime: {
        python: {
          version: pythonVersion || null,
          install_method: installMethod,
          ...(bootstrapMeta?.pythonEngine
            ? {
                core: {
                  status: bootstrapMeta.pythonEngine,
                  ...(bootstrapMeta.pythonEngineReason
                    ? { reason: bootstrapMeta.pythonEngineReason }
                    : {}),
                },
              }
            : {}),
        },
        node: {
          version: nodeVersion || process.version,
        },
        go: {
          version: goVersion || null,
        },
        java: {
          version: null,
          build_tool: null,
          build_tool_version: null,
        },
        dotnet: {
          version: dotnetVersion || null,
          sdk: dotnetVersion || null,
        },
      },
    },
    null,
    2
  );
}

function buildPoliciesYaml(): string {
  return `version: "1.0"
mode: warn # "warn" or "strict"
dependency_sharing_mode: isolated # "isolated" or "shared-runtime-caches" or "shared-node-deps"
# change profile (recommended): npx workspai bootstrap --profile polyglot
# change mode/dependency manually: edit this file and rerun npx workspai init
rules:
  enforce_workspace_marker: true
  enforce_toolchain_lock: false
  disallow_untrusted_tool_sources: false
`;
}

function buildCacheConfigYaml(): string {
  return `version: "1.0"
cache:
  strategy: shared # "shared" or "on-demand"
  prune_on_bootstrap: false
  self_heal: true
  verify_integrity: false
`;
}

async function detectGoVersion(): Promise<string | undefined> {
  try {
    const { stdout: goOut } = await execa('go', ['version'], { timeout: 3000, stdio: 'pipe' });
    const gm = goOut.match(/go(\d+\.\d+(?:\.\d+)?)/i);
    return gm ? gm[1] : undefined;
  } catch {
    return undefined;
  }
}

async function detectDotnetVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execa('dotnet', ['--version'], {
      timeout: 3000,
      stdio: 'pipe',
    });
    const version = stdout.trim();
    return version.length > 0 ? version : undefined;
  } catch {
    return undefined;
  }
}

async function writeWorkspaceFoundationFiles(
  workspacePath: string,
  workspaceName: string,
  installMethod: InstallMethod,
  pythonVersion?: string,
  profile?: string,
  bootstrapMeta?: WorkspaceBootstrapMeta
): Promise<void> {
  // Detect optional runtimes silently so toolchain.lock is accurate without blocking creation.
  const [goVersion, dotnetVersion] = await Promise.all([detectGoVersion(), detectDotnetVersion()]);

  const files: Array<{ fileName: string; content: string }> = [
    {
      fileName: 'workspace.json',
      content: buildWorkspaceManifest(
        workspaceName,
        installMethod,
        pythonVersion,
        profile,
        bootstrapMeta
      ),
    },
    {
      fileName: 'toolchain.lock',
      content: buildToolchainLock(
        installMethod,
        pythonVersion,
        process.version,
        goVersion,
        dotnetVersion,
        bootstrapMeta
      ),
    },
    { fileName: 'policies.yml', content: buildPoliciesYaml() },
    { fileName: 'cache-config.yml', content: buildCacheConfigYaml() },
  ];

  for (const file of files) {
    await fsExtra.outputFile(
      path.join(workspacePath, WORKSPAI_METADATA_DIR, file.fileName),
      file.content,
      'utf-8'
    );
  }
}

/**
 * Ensure workspace foundation files exist for legacy workspaces.
 *
 * This helper writes only missing files by default so existing workspace
 * configuration is preserved. It can be used by commands like `bootstrap`
 * to auto-heal workspaces created before the foundation-file architecture.
 */
export async function syncWorkspaceFoundationFiles(
  workspacePath: string,
  options?: {
    workspaceName?: string;
    installMethod?: InstallMethod;
    pythonVersion?: string;
    profile?: string;
    writeMarker?: boolean;
    writeGitignore?: boolean;
    onlyIfMissing?: boolean;
  }
): Promise<string[]> {
  const {
    workspaceName = path.basename(workspacePath),
    installMethod = 'venv',
    pythonVersion,
    profile,
    writeMarker = true,
    writeGitignore = true,
    onlyIfMissing = true,
  } = options || {};

  const created: string[] = [];

  const [goVersion, dotnetVersion] = await Promise.all([detectGoVersion(), detectDotnetVersion()]);

  const foundationFiles: Array<{ relPath: string; legacyRelPath: string; content: string }> = [
    {
      relPath: path.join(WORKSPAI_METADATA_DIR, 'workspace.json'),
      legacyRelPath: path.join(LEGACY_RAPIDKIT_METADATA_DIR, 'workspace.json'),
      content: buildWorkspaceManifest(workspaceName, installMethod, pythonVersion, profile),
    },
    {
      relPath: path.join(WORKSPAI_METADATA_DIR, 'toolchain.lock'),
      legacyRelPath: path.join(LEGACY_RAPIDKIT_METADATA_DIR, 'toolchain.lock'),
      content: buildToolchainLock(
        installMethod,
        pythonVersion,
        process.version,
        goVersion,
        dotnetVersion
      ),
    },
    {
      relPath: path.join(WORKSPAI_METADATA_DIR, 'policies.yml'),
      legacyRelPath: path.join(LEGACY_RAPIDKIT_METADATA_DIR, 'policies.yml'),
      content: buildPoliciesYaml(),
    },
    {
      relPath: path.join(WORKSPAI_METADATA_DIR, 'cache-config.yml'),
      legacyRelPath: path.join(LEGACY_RAPIDKIT_METADATA_DIR, 'cache-config.yml'),
      content: buildCacheConfigYaml(),
    },
  ];

  for (const file of foundationFiles) {
    const absPath = path.join(workspacePath, file.relPath);
    const legacyAbsPath = path.join(workspacePath, file.legacyRelPath);
    const primaryExists = await fsExtra.pathExists(absPath);
    const legacyExists = await fsExtra.pathExists(legacyAbsPath);
    if (onlyIfMissing && primaryExists) {
      continue;
    }
    if (onlyIfMissing && legacyExists) {
      await fsExtra.copy(legacyAbsPath, absPath);
      created.push(file.relPath);
    } else {
      await fsExtra.outputFile(absPath, file.content, 'utf-8');
      created.push(file.relPath);
    }
  }

  if (writeMarker) {
    const canonicalMarkerExists = await fsExtra.pathExists(
      path.join(workspacePath, WORKSPAI_WORKSPACE_MARKER)
    );
    if (!canonicalMarkerExists || !onlyIfMissing) {
      const markerObj = createNpmWorkspaceMarker(workspaceName, getVersion(), installMethod);
      if (pythonVersion) {
        if (!markerObj.metadata) markerObj.metadata = {};
        (markerObj.metadata as Record<string, unknown>).python = { pythonVersion };
      }
      await writeWorkspaceMarkerToFile(workspacePath, markerObj);
      created.push(WORKSPAI_WORKSPACE_MARKER);
    }
  }

  if (writeGitignore) {
    const gitignorePath = path.join(workspacePath, '.gitignore');
    if (!onlyIfMissing || !(await fsExtra.pathExists(gitignorePath))) {
      await writeWorkspaceGitignore(workspacePath);
      created.push('.gitignore');
    }
  }

  return created;
}

type InstallMethod = 'poetry' | 'venv' | 'pipx';
type PythonEngineMode = 'install' | 'skip';
type WorkspaceBootstrapMeta = {
  profileRequested?: string;
  bootstrapNote?: string;
  pythonEngine?: 'installed' | 'skipped';
  pythonEngineReason?: string;
};

export const PYTHON_FREE_WORKSPACE_PROFILES = new Set([
  'go-only',
  'java-only',
  'dotnet-only',
  'node-only',
  'minimal',
]);

const PYTHON_PROFILE_FALLBACK_CHAIN: Record<string, string> = {
  'python-only': 'minimal',
  polyglot: 'node-only',
  enterprise: 'polyglot',
};

/** Follow fallback chain until a Python-free bootstrap profile is reached. */
export function resolvePythonFreeFallbackProfile(profile: string): string {
  let current = profile;
  const visited = new Set<string>();

  while (!PYTHON_FREE_WORKSPACE_PROFILES.has(current)) {
    if (visited.has(current)) {
      return 'minimal';
    }
    visited.add(current);
    const next = PYTHON_PROFILE_FALLBACK_CHAIN[current];
    if (!next) {
      return 'minimal';
    }
    current = next;
  }

  return current;
}

const MIN_SUPPORTED_PYTHON = '3.10';
const BASELINE_SUPPORTED_PYTHON_VERSIONS = ['3.10', '3.11', '3.12'] as const;

type InstallMethodAvailability = {
  poetry: boolean;
  pipx: boolean;
};

type PipxInvoker = { kind: 'binary' } | { kind: 'python-module'; pythonCmd: string };

// Detect actual Python version installed on system (not just requested version)
async function detectActualPythonVersion(pythonCmd: string): Promise<string | null> {
  try {
    const { stdout } = await execa(pythonCmd, ['--version'], { timeout: 3000 });
    const match = stdout.match(/Python (\d+\.\d+\.\d+)/);
    if (match) {
      return match[1]; // Return full version like "3.10.19"
    }
  } catch {
    // Ignore
  }
  return null;
}

// Write .python-version file to workspace for pyenv compatibility
async function writePythonVersion(workspacePath: string, pythonVersion: string): Promise<void> {
  try {
    await fsPromises.writeFile(
      path.join(workspacePath, '.python-version'),
      `${pythonVersion}\n`,
      'utf-8'
    );
    logger.debug(`Created .python-version with ${pythonVersion}`);
  } catch (error) {
    logger.warn(`Failed to create .python-version: ${error}`);
  }
}

function ensureUserLocalBinOnPath(): void {
  const current = process.env.PATH || '';
  const parts = current.split(path.delimiter).filter(Boolean);
  const nextParts = [...parts];

  for (const candidate of getUserLocalBinCandidates()) {
    if (!nextParts.includes(candidate)) {
      nextParts.unshift(candidate);
    }
  }

  process.env.PATH = nextParts.join(path.delimiter);
}

async function ensurePipxAvailable(spinner: CliSpinnerHandle, yes: boolean): Promise<PipxInvoker> {
  ensureUserLocalBinOnPath();

  spinner.start('Checking pipx installation');
  try {
    await execa('pipx', ['--version']);
    spinner.succeed('pipx found');
    return { kind: 'binary' };
  } catch (_error) {
    // Try python -m pipx (pipx may be installed but not on PATH)
  }

  const pythonCmd = getPythonCommand();
  try {
    await execa(pythonCmd, ['-m', 'pipx', '--version']);
    spinner.succeed('pipx found');
    return { kind: 'python-module', pythonCmd };
  } catch (_error) {
    // Continue to interactive flow below.
  }

  if (yes) {
    throw new PipxNotFoundError();
  }

  // Prevent spinner redraw from interfering with interactive prompt rendering.
  // Some mocked CliSpinnerHandle instances in tests do not implement `stop`.
  (spinner as unknown as { stop?: () => void }).stop?.();

  const { installPipx } = (await prompt([
    {
      type: 'confirm',
      name: 'installPipx',
      message: 'pipx is not installed. Install it now (user install via python -m pip)?',
      default: true,
    },
  ])) as { installPipx: boolean };

  if (!installPipx) {
    throw new PipxNotFoundError();
  }

  spinner.start('Installing pipx (user install)');
  try {
    // Best-effort: upgrade pip first, then install pipx.
    try {
      await execa(pythonCmd, ['-m', 'pip', 'install', '--user', '--upgrade', 'pip']);
    } catch (_pipUpgradeError) {
      // Ignore pip upgrade issues.
    }
    await execa(pythonCmd, ['-m', 'pip', 'install', '--user', '--upgrade', 'pipx']);
  } catch (error: unknown) {
    const err = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown };
    const msg = String(err?.stderr || err?.shortMessage || err?.message || '');
    throw new InstallationError(
      'Install pipx with python -m pip',
      error instanceof Error ? error : new Error(msg)
    );
  }
  spinner.succeed('pipx installed');

  ensureUserLocalBinOnPath();
  try {
    await execa(pythonCmd, ['-m', 'pipx', '--version']);
    return { kind: 'python-module', pythonCmd };
  } catch (error: unknown) {
    const err = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown };
    const msg = String(
      err?.stderr || err?.shortMessage || err?.message || 'pipx not runnable after install'
    );
    throw new InstallationError(
      'Verify pipx after install',
      new Error(`${msg}\n\nTry reopening your terminal or run: ${pythonCmd} -m pipx ensurepath`)
    );
  }
}

async function execaPipx(invoker: PipxInvoker, args: string[]) {
  if (invoker.kind === 'binary') {
    return execa('pipx', args);
  }
  return execa(invoker.pythonCmd, ['-m', 'pipx', ...args]);
}

function normalizePythonMajorMinor(version: string): string | null {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return null;
  return `${match[1]}.${match[2]}`;
}

function parsePythonMajorMinorFromOutput(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/Python\s+(\d+)\.(\d+)(?:\.\d+)?/i);
  if (!match) return null;
  return `${match[1]}.${match[2]}`;
}

function comparePythonMajorMinor(a: string, b: string): number {
  const [amaj, amin] = a.split('.').map((n) => Number(n));
  const [bmaj, bmin] = b.split('.').map((n) => Number(n));
  if (amaj !== bmaj) return amaj - bmaj;
  return amin - bmin;
}

function isPythonAtLeast(version: string, minVersion: string): boolean {
  return comparePythonMajorMinor(version, minVersion) >= 0;
}

async function detectPythonVersionPromptModel(preferredVersion?: string): Promise<{
  choices: Array<{ name: string; value: string }>;
  defaultValue: string;
}> {
  const detectedVersions = new Set<string>();
  const probes = getPythonVersionProbeCandidates(14, 10);

  for (const probe of probes) {
    try {
      const res = await execa(probe.command, probe.args, { timeout: 2500 });
      const parsed = parsePythonMajorMinorFromOutput(`${res.stdout || ''}\n${res.stderr || ''}`);
      if (parsed && isPythonAtLeast(parsed, MIN_SUPPORTED_PYTHON)) {
        detectedVersions.add(parsed);
      }
    } catch {
      // Ignore probe failures.
    }
  }

  let currentSystemPython: string | null = null;
  try {
    const current = await execa(getPythonCommand(), ['--version'], { timeout: 2500 });
    const parsed = parsePythonMajorMinorFromOutput(
      `${current.stdout || ''}\n${current.stderr || ''}`
    );
    if (parsed && isPythonAtLeast(parsed, MIN_SUPPORTED_PYTHON)) {
      currentSystemPython = parsed;
      detectedVersions.add(parsed);
    }
  } catch {
    // Ignore current-python detection failures.
  }

  const baseline = BASELINE_SUPPORTED_PYTHON_VERSIONS.filter((v) =>
    isPythonAtLeast(v, MIN_SUPPORTED_PYTHON)
  );
  const allCandidateVersions = new Set<string>([...baseline, ...detectedVersions]);

  const sortedCandidates = Array.from(allCandidateVersions).sort((a, b) =>
    comparePythonMajorMinor(b, a)
  );

  const preferredNormalized = preferredVersion ? normalizePythonMajorMinor(preferredVersion) : null;
  const defaultValue =
    preferredNormalized && isPythonAtLeast(preferredNormalized, MIN_SUPPORTED_PYTHON)
      ? preferredNormalized
      : currentSystemPython || sortedCandidates[0] || MIN_SUPPORTED_PYTHON;

  if (!allCandidateVersions.has(defaultValue)) {
    allCandidateVersions.add(defaultValue);
  }

  const finalSorted = Array.from(allCandidateVersions).sort((a, b) =>
    comparePythonMajorMinor(b, a)
  );

  const choices = finalSorted.map((version) => {
    const tags: string[] = [];
    if (version === currentSystemPython) tags.push('current system');
    if (version === MIN_SUPPORTED_PYTHON) tags.push('minimum supported');
    if (detectedVersions.has(version) && version !== currentSystemPython) tags.push('detected');

    return {
      name: tags.length > 0 ? `${version} (${tags.join(', ')})` : version,
      value: version,
    };
  });

  return { choices, defaultValue };
}

async function detectInstallMethodAvailability(): Promise<InstallMethodAvailability> {
  ensureUserLocalBinOnPath();

  let poetry = false;
  let pipx = false;

  try {
    await execa('poetry', ['--version'], { timeout: 2500 });
    poetry = true;
  } catch {
    poetry = false;
  }

  try {
    await execa('pipx', ['--version'], { timeout: 2500 });
    pipx = true;
  } catch {
    const pythonCmd = getDefaultPythonCommand();
    try {
      await execa(pythonCmd, ['-m', 'pipx', '--version'], { timeout: 2500 });
      pipx = true;
    } catch {
      pipx = false;
    }
  }

  return { poetry, pipx };
}

async function isPoetryAvailable(): Promise<boolean> {
  ensureUserLocalBinOnPath();
  try {
    await execa('poetry', ['--version'], { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

function resolveInteractiveInstallMethodDefault(
  preferred: InstallMethod,
  availability: InstallMethodAvailability
): InstallMethod {
  if (preferred === 'poetry' && availability.poetry) return 'poetry';
  if (preferred === 'pipx' && availability.pipx) return 'pipx';
  if (preferred === 'venv') return 'venv';

  if (availability.poetry) return 'poetry';
  return 'venv';
}

async function ensurePoetryAvailable(spinner: CliSpinnerHandle, yes: boolean): Promise<void> {
  ensureUserLocalBinOnPath();

  spinner.start('Checking Poetry installation');
  try {
    await execa('poetry', ['--version']);
    spinner.succeed('Poetry found');
    return;
  } catch (_error) {
    // Continue to interactive flow below.
  }

  if (yes) {
    throw new PoetryNotFoundError();
  }

  const { installPoetry } = (await prompt([
    {
      type: 'confirm',
      name: 'installPoetry',
      message: 'Poetry is not installed. Install it now using pipx?',
      default: true,
    },
  ])) as { installPoetry: boolean };

  if (!installPoetry) {
    throw new PoetryNotFoundError();
  }

  const pipx = await ensurePipxAvailable(spinner, yes);

  spinner.start('Installing Poetry with pipx');
  try {
    await execaPipx(pipx, ['install', 'poetry']);
  } catch (error: unknown) {
    const err = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown };
    const msg = String(err?.stderr || err?.shortMessage || err?.message || '');
    // If it's already installed, attempt an upgrade; otherwise treat as a hard failure.
    if (/already\s+installed|already\s+seems\s+to\s+be\s+installed|exists/i.test(msg)) {
      try {
        await execaPipx(pipx, ['upgrade', 'poetry']);
      } catch (_upgradeError) {
        // ignore upgrade errors; we just need a working poetry
      }
    } else {
      throw new InstallationError(
        'Install Poetry with pipx',
        error instanceof Error ? error : new Error(msg)
      );
    }
  }
  spinner.succeed('Poetry installed');

  ensureUserLocalBinOnPath();
  try {
    await execa('poetry', ['--version']);
  } catch (error: unknown) {
    const err = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown };
    const msg = String(
      err?.stderr || err?.shortMessage || err?.message || 'Poetry not found on PATH'
    );
    throw new InstallationError(
      'Verify Poetry after pipx install',
      new Error(
        `${msg}\n\nPoetry may be installed but not on PATH yet. Try reopening your terminal or run: pipx ensurepath`
      )
    );
  }
}

function workspaceLauncherSh(
  installMethod: InstallMethod,
  options: { pythonEngineSkipped?: boolean } = {}
): string {
  // Intentionally avoid calling bare `rapidkit` to prevent recursion into the npm wrapper.
  // Prefer the in-workspace venv when present, otherwise fall back to `poetry run rapidkit`.
  const allowPoetry = installMethod === 'poetry';
  const skippedHint = options.pythonEngineSkipped
    ? `echo "- Python engine installation was intentionally skipped for this workspace." 1>&2
echo "- For npm-owned workspace commands, run: npx workspai <command>" 1>&2
echo "- To install the local Python engine later, create a RapidKit Core module-enabled project, then run: npx workspai workspace run init" 1>&2
`
    : `echo "- If you used venv: ensure .venv exists (or re-run the installer)." 1>&2
`;
  return `#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

VENV_RAPIDKIT="$SCRIPT_DIR/.venv/bin/rapidkit"
if [ -x "$VENV_RAPIDKIT" ]; then
  exec "$VENV_RAPIDKIT" "$@"
fi

${
  allowPoetry
    ? `if command -v poetry >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/pyproject.toml" ]; then
  exec poetry run rapidkit "$@"
fi

`
    : ''
}if command -v rapidkit >/dev/null 2>&1; then
  RAPIDKIT_CMD=$(command -v rapidkit)
  if [ "$RAPIDKIT_CMD" != "$SCRIPT_DIR/rapidkit" ] && [ "$RAPIDKIT_CMD" != "$SCRIPT_DIR/.workspai/rapidkit" ] && [ "$RAPIDKIT_CMD" != "$SCRIPT_DIR/.rapidkit/rapidkit" ]; then
    RAPIDKIT_LOCAL_LAUNCHER_BYPASS=1 exec "$RAPIDKIT_CMD" "$@"
  fi
fi

for RAPIDKIT_CORE in "$HOME/.local/bin/rapidkit" "$HOME/Library/Python/3.14/bin/rapidkit" "$HOME/Library/Python/3.13/bin/rapidkit" "$HOME/Library/Python/3.12/bin/rapidkit" "$HOME/Library/Python/3.11/bin/rapidkit" "$HOME/Library/Python/3.10/bin/rapidkit"; do
  if [ -x "$RAPIDKIT_CORE" ]; then
    exec "$RAPIDKIT_CORE" "$@"
  fi
done

echo "RapidKit launcher could not find a local Python CLI." 1>&2
${skippedHint}${
    options.pythonEngineSkipped
      ? ''
      : allowPoetry
        ? `echo "- If you used Poetry: run 'poetry install' and retry, or activate the env." 1>&2
`
        : ''
  }${
    options.pythonEngineSkipped
      ? `echo "Tip: use 'npx workspai workspace model --json' for Workspace Intelligence without the Python engine." 1>&2
`
      : `echo "Tip: you can also run: ./.venv/bin/rapidkit --help" 1>&2
`
  }exit 1
`;
}

function workspaceLauncherCmd(
  installMethod: InstallMethod,
  options: { pythonEngineSkipped?: boolean } = {}
): string {
  const allowPoetry = installMethod === 'poetry';
  const skippedHint = options.pythonEngineSkipped
    ? `echo - Python engine installation was intentionally skipped for this workspace. 1>&2
echo - For npm-owned workspace commands, run: npx workspai ^<command^> 1>&2
echo - To install the local Python engine later, create a RapidKit Core module-enabled project, then run: npx workspai workspace run init 1>&2
`
    : `echo Tip: run .venv\\Scripts\\rapidkit.exe --help 1>&2
`;
  // Windows launcher: prefer in-project venv, else fall back to Poetry.
  return `@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

if exist "%SCRIPT_DIR%\\.venv\\Scripts\\rapidkit.exe" (
  "%SCRIPT_DIR%\\.venv\\Scripts\\rapidkit.exe" %*
  exit /b %ERRORLEVEL%
)

${
  allowPoetry
    ? `where poetry >nul 2>nul
if %ERRORLEVEL%==0 if exist "%SCRIPT_DIR%\\pyproject.toml" (
  poetry run rapidkit %*
  exit /b %ERRORLEVEL%
)

`
    : ''
}:rapidkit_npm_wrapper_fallback
for /f "delims=" %%R in ('where rapidkit.cmd 2^>nul') do (
  if /I not "%%~fR"=="%SCRIPT_DIR%rapidkit.cmd" if /I not "%%~fR"=="%SCRIPT_DIR%.workspai\\rapidkit.cmd" if /I not "%%~fR"=="%SCRIPT_DIR%.rapidkit\\rapidkit.cmd" (
    set "RAPIDKIT_LOCAL_LAUNCHER_BYPASS=1"
    "%%~fR" %*
    exit /b %ERRORLEVEL%
  )
)

:rapidkit_core_fallback
for %%R in ("%USERPROFILE%\\.local\\bin\\rapidkit.exe" "%APPDATA%\\Python\\Scripts\\rapidkit.exe" "%LOCALAPPDATA%\\Programs\\Python\\Scripts\\rapidkit.exe") do (
  if exist "%%~R" (
    "%%~R" %*
    exit /b %ERRORLEVEL%
  )
)

echo RapidKit launcher could not find a local Python CLI. 1>&2
${skippedHint}echo Tip: for npm-owned workspace commands, run npx --yes --package workspai workspai %* from a shell where npm is on PATH. 1>&2
exit /b 1
`;
}

export async function writeWorkspaceLauncher(
  workspacePath: string,
  installMethod: InstallMethod,
  options: { pythonEngineSkipped?: boolean } = {}
): Promise<void> {
  // Always create the launcher; it degrades gracefully for pipx installs.
  await fsExtra.outputFile(
    path.join(workspacePath, 'rapidkit'),
    workspaceLauncherSh(installMethod, options),
    { encoding: 'utf-8', mode: 0o755 }
  );
  await fsExtra.outputFile(
    path.join(workspacePath, 'rapidkit.cmd'),
    workspaceLauncherCmd(installMethod, options),
    'utf-8'
  );
}

interface CreateProjectOptions {
  skipGit?: boolean;
  skipPythonEngine?: boolean;
  testMode?: boolean;
  demoMode?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  userConfig?: UserConfig;
  installMethod?: InstallMethod;
  /** Bootstrap profile written into .workspai/workspace.json (e.g. 'python-only', 'go-only'). */
  profile?: string;
  /** Parent directory for workspace creation. Defaults to process.cwd(). */
  parentDirectory?: string;
}

export async function createProject(
  projectName: string | undefined,
  options: CreateProjectOptions
) {
  // Existing directories cannot be registered as a workspace via createProject. If callers need
  // to register the current directory as a workspace (e.g., when creating a project outside a
  // workspace) use `registerWorkspaceAtPath` instead.

  const {
    skipGit = false,
    skipPythonEngine = false,
    testMode = false,
    demoMode = false,
    dryRun = false,
    yes = false,
    userConfig = {},
    installMethod: providedInstallMethod,
    profile,
    parentDirectory,
  } = options;

  // Default to 'rapidkit' directory
  const name = projectName || 'rapidkit';
  const projectPath = parentDirectory
    ? path.resolve(parentDirectory, name)
    : path.resolve(process.cwd(), name);

  // Check if directory exists
  if (await fsExtra.pathExists(projectPath)) {
    throw new DirectoryExistsError(name);
  }

  await assertIndependentWorkspaceTarget(projectPath);

  // Dry-run mode - show what would be created
  if (dryRun) {
    const defaultProfile = profile || (yes ? 'minimal' : undefined);
    const defaultInstallMethod =
      providedInstallMethod || userConfig.defaultInstallMethod || 'poetry';
    const defaultPythonVersion = userConfig.pythonVersion || '3.10';
    await showDryRun(
      projectPath,
      name,
      demoMode,
      userConfig,
      defaultProfile,
      defaultInstallMethod,
      defaultPythonVersion,
      skipGit,
      skipPythonEngine
    );
    return;
  }

  // Demo mode - create workspace with demo kit setup script
  if (demoMode) {
    await createDemoWorkspace(projectPath, name, skipGit);
    return;
  }

  // Step 0: Choose workspace profile (if not already provided by caller)
  // Profiles that don't involve Python skip the Python-specific prompts.
  const PYTHON_PROFILES = new Set(['python-only', 'polyglot', 'enterprise']);
  let resolvedProfile: string = profile || '';

  if (!yes && !profile) {
    const { selectedProfile } = (await prompt([
      {
        type: 'rawlist',
        name: 'selectedProfile',
        message: 'Select workspace profile:',
        choices: [
          {
            name: 'minimal     — Foundation files only (fastest bootstrap, mixed projects)',
            value: 'minimal',
          },
          {
            name: 'java-only   — Java runtime (Spring Boot services)',
            value: 'java-only',
          },
          {
            name: 'python-only — Python + Poetry (FastAPI, Django, ML pipelines)',
            value: 'python-only',
          },
          {
            name: 'node-only   — Node.js runtime (NestJS, Express, Next.js)',
            value: 'node-only',
          },
          {
            name: 'go-only     — Go runtime (Fiber, Gin, gRPC, microservices)',
            value: 'go-only',
          },
          {
            name: 'dotnet-only — .NET runtime (ASP.NET Core services)',
            value: 'dotnet-only',
          },
          {
            name: 'polyglot    — Python + Node.js + Go + Java + .NET multi-runtime workspace',
            value: 'polyglot',
          },
          {
            name: 'enterprise  — Polyglot + governance + Sigstore verification',
            value: 'enterprise',
          },
        ],
        default: 1,
      },
    ])) as { selectedProfile: string };
    resolvedProfile = selectedProfile;
  } else if (!resolvedProfile) {
    resolvedProfile = 'minimal';
  }

  // Profiles that can use the Python engine: python-only, polyglot, enterprise.
  // The engine install is optional so users can start with Workspace Intelligence
  // governance and add rapidkit-core later only when they need Python-backed kits/modules.
  const needsPythonPrompts = !yes && PYTHON_PROFILES.has(resolvedProfile);
  const pythonEngineMode: PythonEngineMode = !PYTHON_PROFILES.has(resolvedProfile)
    ? 'skip'
    : skipPythonEngine
      ? 'skip'
      : needsPythonPrompts
        ? (
            (await prompt([
              {
                type: 'confirm',
                name: 'installPythonEngine',
                message:
                  'Install the optional RapidKit Python engine now? (needed for Python-backed kits/modules)',
                default: true,
              },
            ])) as { installPythonEngine?: boolean }
          ).installPythonEngine !== false
          ? 'install'
          : 'skip'
        : 'install';
  const needsPythonInstallPrompts = needsPythonPrompts && pythonEngineMode === 'install';
  const promptDefaultPythonVersion =
    typeof userConfig.pythonVersion === 'string' && userConfig.pythonVersion.trim().length > 0
      ? userConfig.pythonVersion.trim()
      : undefined;
  const promptDefaultInstallMethod = (providedInstallMethod ||
    userConfig.defaultInstallMethod ||
    'poetry') as InstallMethod;

  const installMethodAvailability = needsPythonInstallPrompts
    ? await detectInstallMethodAvailability()
    : { poetry: true, pipx: true };
  const pythonVersionPromptModel = needsPythonInstallPrompts
    ? await detectPythonVersionPromptModel(promptDefaultPythonVersion)
    : {
        choices: BASELINE_SUPPORTED_PYTHON_VERSIONS.map((v) => ({ name: v, value: v })),
        defaultValue: MIN_SUPPORTED_PYTHON,
      };
  const installMethodPromptDefault = resolveInteractiveInstallMethodDefault(
    promptDefaultInstallMethod,
    installMethodAvailability
  );

  const installMethodChoices = [
    {
      name: installMethodAvailability.poetry
        ? '🎯 Poetry (Recommended - includes virtual env + dependency mgmt)'
        : '🎯 Poetry (Recommended) — not detected (we can install it)',
      value: 'poetry',
    },
    {
      name: '📦 pip with venv (Standard, zero extra tools)',
      value: 'venv',
    },
    {
      name: installMethodAvailability.pipx
        ? '🔧 pipx (Global isolated - RapidKit Core only, no local venv)'
        : '🔧 pipx (Global isolated) — not detected (we can install it)',
      value: 'pipx',
    },
  ] as const;

  // Step 1: Choose Python version and install method (or auto-select with --yes / non-Python profile)
  const pythonAnswers: { pythonVersion: string; installMethod: InstallMethod } =
    needsPythonInstallPrompts
      ? ((await prompt([
          {
            type: 'rawlist',
            name: 'pythonVersion',
            message: 'Select Python version for RapidKit:',
            choices: pythonVersionPromptModel.choices,
            default: pythonVersionPromptModel.defaultValue,
          },
          {
            type: 'rawlist',
            name: 'installMethod',
            message: 'How would you like to manage the workspace environment?',
            choices: installMethodChoices,
            default: installMethodPromptDefault,
          },
        ])) as { pythonVersion: string; installMethod: InstallMethod })
      : await (async () => {
          if (pythonEngineMode === 'skip') {
            return {
              pythonVersion: userConfig.pythonVersion || '3.10',
              installMethod: 'venv' as InstallMethod,
            };
          }
          const resolvedMethod: InstallMethod =
            providedInstallMethod ||
            (userConfig.defaultInstallMethod as InstallMethod | undefined) ||
            (await (async (): Promise<InstallMethod> => {
              try {
                await execa('poetry', ['--version'], { timeout: 3000 });
                return 'poetry';
              } catch {
                logger.warn(
                  'Poetry not found — auto-selecting venv. Pass --install-method poetry to override.'
                );
                return 'venv';
              }
            })());
          return {
            pythonVersion: userConfig.pythonVersion || '3.10',
            installMethod: resolvedMethod,
          };
        })();

  // ── Lite workspace fast path ─────────────────────────────────────────────────
  // Profiles that don't involve a Python engine skip Poetry/venv/pipx entirely.
  // Go kits are 100% npm-level. Node-only workspaces can scaffold Go projects or
  // await a lazy Python install on first `create project nestjs.standard`.
  // Minimal workspaces are bootstrapped on-demand as well.
  // Go and Java kits are truly Python-free: they run entirely through npm.
  // node-only / minimal use
  // nestjs.standard which depends on rapidkit-core (Python), so they follow
  // the full Python install path.
  const PYTHON_FREE_PROFILES = PYTHON_FREE_WORKSPACE_PROFILES;

  if (PYTHON_FREE_PROFILES.has(resolvedProfile)) {
    const spinner2 = createCliSpinner('Creating workspace', {
      component: 'create',
      phase: 'workspace.python-free',
    });
    const transaction = await beginNewWorkspaceTransaction(projectPath);
    try {
      await fsExtra.ensureDir(projectPath);
      spinner2.succeed('Directory created');

      // Workspace marker + foundation files only. Python-free profiles should
      // not create Python engine artifacts; bootstrap/profile changes can add
      // them later if the user explicitly opts into the Python engine.
      await writeWorkspaceMarker(projectPath, name, 'venv', undefined);
      await writeWorkspaceFoundationFiles(projectPath, name, 'venv', undefined, resolvedProfile);
      await writeWorkspaceGitignore(projectPath);

      const onboarding = await finalizeWorkspaceOnboarding(projectPath, {
        workspaceName: name,
        silent: true,
      });
      await commitLifecycleTransaction(transaction);

      if (!skipGit) {
        await initializeStandaloneGitRepository(
          projectPath,
          spinner2,
          'Initial commit: Workspai workspace'
        );
      }

      printWorkspaceCreationReceipt({
        workspaceName: name,
        workspacePath: projectPath,
        profile: resolvedProfile,
        projectCount: onboarding?.projectCount ?? 0,
      });
    } catch (_err) {
      spinner2.fail('Failed to create workspace');
      console.error(chalk.red('\n❌ Error:'), _err);
      return rollbackLifecycleTransaction(transaction, _err);
    }
    return; // ← skip Python env setup entirely
  }

  if (PYTHON_PROFILES.has(resolvedProfile) && pythonEngineMode === 'skip') {
    const spinner2 = createCliSpinner('Creating workspace', {
      component: 'create',
      phase: 'workspace.python-engine-skipped',
    });
    const transaction = await beginNewWorkspaceTransaction(projectPath);
    try {
      await fsExtra.ensureDir(projectPath);
      spinner2.succeed('Directory created');

      const pythonEngineSkipMeta: WorkspaceBootstrapMeta = {
        bootstrapNote: 'python-engine-skipped',
        pythonEngine: 'skipped',
        pythonEngineReason: 'user-opted-out',
      };
      await writeWorkspaceMarker(projectPath, name, 'venv', undefined, pythonEngineSkipMeta);
      await writeWorkspaceFoundationFiles(
        projectPath,
        name,
        'venv',
        undefined,
        resolvedProfile,
        pythonEngineSkipMeta
      );
      await writeWorkspaceGitignore(projectPath);
      await writeWorkspaceLauncher(projectPath, 'venv', { pythonEngineSkipped: true });

      const onboarding = await finalizeWorkspaceOnboarding(projectPath, {
        workspaceName: name,
        silent: true,
      });
      await commitLifecycleTransaction(transaction);

      if (!skipGit) {
        await initializeStandaloneGitRepository(
          projectPath,
          spinner2,
          `Initial commit: Workspai workspace (${resolvedProfile})`
        );
      }

      printWorkspaceCreationReceipt({
        workspaceName: name,
        workspacePath: projectPath,
        profile: resolvedProfile,
        projectCount: onboarding?.projectCount ?? 0,
        pythonEngine: 'skipped',
        note: 'Install the optional Python engine later only when a Python-backed kit needs it.',
      });
      return;
    } catch (_err) {
      spinner2.fail('Failed to create workspace');
      console.error(chalk.red('\n❌ Error:'), _err);
      return rollbackLifecycleTransaction(transaction, _err);
    }
  }

  // ── Python pre-check (only for python-required profiles) ───────────────────
  // go-only / java-only / dotnet-only / node-only / minimal users have already returned above without
  // needing Python at all. Only python-only / polyglot / enterprise reach here.
  // Smart fallback: if Python is not found, offer options instead of hard failure.
  {
    const pythonCmd = getPythonCommand();
    let pythonAvailable = false;
    try {
      await execa(pythonCmd, ['--version'], { timeout: 5000 });
      pythonAvailable = true;
    } catch {
      try {
        await execa('python', ['--version'], { timeout: 5000 });
        pythonAvailable = true;
      } catch {
        pythonAvailable = false;
      }
    }

    if (!pythonAvailable) {
      const originalProfile = resolvedProfile;
      const fallback = resolvePythonFreeFallbackProfile(resolvedProfile);
      const isInteractive = needsPythonPrompts && !yes; // User was prompted before

      if (isInteractive) {
        // Interactive mode: ask user what to do
        console.log(chalk.yellow(`\n⚠️  Python 3.10+ is not detected on this system.\n`));
        console.log(chalk.cyan('You have 3 options:\n'));

        const { pythonAction } = (await prompt([
          {
            type: 'rawlist',
            name: 'pythonAction',
            message: 'What would you like to do?',
            choices: [
              {
                name: `📥 Install Python now (I'll show you the command for your OS)`,
                value: 'install',
              },
              {
                name: `🔄 Switch to "${fallback}" profile (no Python required)`,
                value: 'fallback',
              },
              {
                name: '❌ Cancel and install Python manually',
                value: 'cancel',
              },
            ],
          },
        ])) as { pythonAction: string };

        if (pythonAction === 'cancel') {
          console.log(chalk.cyan('\n💡 How to install Python:\n'));
          console.log(chalk.white('   Ubuntu / Debian:  sudo apt install python3.10'));
          console.log(chalk.white('   macOS (Homebrew): brew install python@3.10'));
          console.log(chalk.white('   Windows:          https://python.org/downloads\n'));
          console.log(chalk.gray(`   After installing Python, run:  npx workspai ${name}\n`));
          process.exit(1);
        }

        if (pythonAction === 'install') {
          console.log(chalk.cyan('\n💡 Install Python on your system:\n'));
          const osType = process.platform;
          if (osType === 'linux') {
            console.log(
              chalk.white('   sudo apt update && sudo apt install python3.10 python3.10-venv\n')
            );
          } else if (osType === 'darwin') {
            console.log(chalk.white('   brew install python@3.10\n'));
          } else if (osType === 'win32') {
            console.log(chalk.white('   Download: https://python.org/downloads\n'));
            console.log(chalk.white('   Run the installer and check "Add Python to PATH"\n'));
          }
          console.log(chalk.gray(`   After installing, run:  npx workspai ${name}\n`));
          process.exit(0);
        }

        if (pythonAction === 'fallback') {
          console.log(
            chalk.green(`\n✅ Switching to "${fallback}" profile (no Python required).\n`)
          );
          resolvedProfile = fallback;
          if (PYTHON_FREE_PROFILES.has(fallback)) {
            const spinner2 = createCliSpinner('Creating workspace', {
              component: 'create',
              phase: 'workspace.python-free',
            });
            const transaction = await beginNewWorkspaceTransaction(projectPath);
            try {
              await fsExtra.ensureDir(projectPath);
              spinner2.succeed('Directory created');

              await writeWorkspaceMarker(projectPath, name, 'venv', undefined);
              await writeWorkspaceFoundationFiles(projectPath, name, 'venv', undefined, fallback, {
                profileRequested: originalProfile,
                bootstrapNote: 'python-free-fallback',
              });
              await writeWorkspaceGitignore(projectPath);

              const onboarding = await finalizeWorkspaceOnboarding(projectPath, {
                workspaceName: name,
                silent: true,
              });
              await commitLifecycleTransaction(transaction);

              if (!skipGit) {
                await initializeStandaloneGitRepository(
                  projectPath,
                  spinner2,
                  `Initial commit: Workspai workspace (${fallback} profile)`
                );
              }

              printWorkspaceCreationReceipt({
                workspaceName: name,
                workspacePath: projectPath,
                profile: fallback,
                projectCount: onboarding?.projectCount ?? 0,
                note: `Requested ${originalProfile}; used ${fallback} because Python was unavailable.`,
              });
              return; // Exit successfully with fallback profile
            } catch (_err) {
              spinner2.fail('Failed to create workspace');
              console.error(chalk.red('\n❌ Error:'), _err);
              return rollbackLifecycleTransaction(transaction, _err);
            }
          }
        }
      } else {
        // Non-interactive mode (--yes): auto-fallback
        console.log(
          chalk.yellow(
            `\n⚠️  Python not detected. Auto-switching to "${fallback}" profile (no Python required).\n`
          )
        );
        resolvedProfile = fallback;

        if (PYTHON_FREE_PROFILES.has(fallback)) {
          const spinner2 = createCliSpinner('Creating workspace', {
            component: 'create',
            phase: 'workspace.python-free',
          });
          const transaction = await beginNewWorkspaceTransaction(projectPath);
          try {
            await fsExtra.ensureDir(projectPath);
            spinner2.succeed('Directory created');

            await writeWorkspaceMarker(projectPath, name, 'venv', undefined);
            await writeWorkspaceFoundationFiles(projectPath, name, 'venv', undefined, fallback, {
              profileRequested: originalProfile,
              bootstrapNote: 'python-free-fallback',
            });
            await writeWorkspaceGitignore(projectPath);

            const onboarding = await finalizeWorkspaceOnboarding(projectPath, {
              workspaceName: name,
              silent: true,
            });
            await commitLifecycleTransaction(transaction);

            if (!skipGit) {
              await initializeStandaloneGitRepository(
                projectPath,
                spinner2,
                `Initial commit: Workspai workspace (${fallback})`
              );
            }

            printWorkspaceCreationReceipt({
              workspaceName: name,
              workspacePath: projectPath,
              profile: fallback,
              projectCount: onboarding?.projectCount ?? 0,
              note: `Requested ${originalProfile}; used ${fallback} because Python was unavailable.`,
            });
            return; // Exit successfully
          } catch (_err) {
            spinner2.fail('Failed to create workspace');
            console.error(chalk.red('\n❌ Error:'), _err);
            return rollbackLifecycleTransaction(transaction, _err);
          }
        }
      }
    }
  }

  // ── Python-required profiles (python-only / polyglot / enterprise) ──────────
  const spinner = createCliSpinner('Creating directory', {
    component: 'create',
    phase: 'workspace.directory',
  });
  const transaction = await beginNewWorkspaceTransaction(projectPath);

  try {
    // Create directory
    await fsExtra.ensureDir(projectPath);
    spinner.succeed('Directory created');

    // Detect actual Python version before installation
    spinner.start('Detecting Python version');
    let actualPythonVersion: string | null = null;
    const realPython = await findRealPython(pythonAnswers.pythonVersion);
    if (realPython) {
      actualPythonVersion = await detectActualPythonVersion(realPython);
      if (actualPythonVersion) {
        logger.info(` Detected Python ${actualPythonVersion}`);
        spinner.succeed(`Python ${actualPythonVersion} detected`);
      } else {
        spinner.warn('Could not detect exact Python version');
      }
    } else {
      // Fallback to getPythonCommand
      const pythonCmd = getPythonCommand();
      actualPythonVersion = await detectActualPythonVersion(pythonCmd);
      if (actualPythonVersion) {
        spinner.succeed(`Python ${actualPythonVersion} detected`);
      } else {
        spinner.warn('Could not detect Python version, proceeding with defaults');
      }
    }

    // Auto-fallback: if user selected Poetry but Poetry is not installed,
    // continue with pip + venv instead of blocking.
    if (pythonAnswers.installMethod === 'poetry' && !(await isPoetryAvailable())) {
      spinner.warn('Poetry not found — auto-fallback to pip + venv');
      pythonAnswers.installMethod = 'venv';
    }

    // Create workspace marker with actual Python version
    await writeWorkspaceMarker(
      projectPath,
      name,
      pythonAnswers.installMethod,
      actualPythonVersion || undefined
    );

    // Write .python-version file for pyenv compatibility
    if (actualPythonVersion) {
      await writePythonVersion(projectPath, actualPythonVersion);
    }

    await writeWorkspaceFoundationFiles(
      projectPath,
      name,
      pythonAnswers.installMethod,
      actualPythonVersion || pythonAnswers.pythonVersion,
      resolvedProfile || profile
    );

    // Create .gitignore regardless of git initialization (matches VS Code extension behavior).
    await writeWorkspaceGitignore(projectPath);

    // Write pyproject.toml stub with rapidkit-core declared so that poetry install
    // --no-root can resolve everything in one pass (avoids the slow `poetry add` step).
    await writePyprojectStub(projectPath, name);

    // Install RapidKit based on method
    if (pythonAnswers.installMethod === 'poetry') {
      try {
        await installWithPoetry(
          projectPath,
          pythonAnswers.pythonVersion,
          spinner,
          testMode,
          userConfig,
          yes
        );
      } catch (poetryError: unknown) {
        // If Poetry fails due to pyenv shim issues, try venv as fallback
        const errorDetails =
          (poetryError as Error & { details?: string })?.details ||
          (poetryError as Error)?.message ||
          String(poetryError);
        const isShimError =
          errorDetails.includes('pyenv') ||
          errorDetails.includes('exit status 127') ||
          errorDetails.includes('returned non-zero exit status 127');

        if (isShimError) {
          spinner.warn('Poetry encountered Python discovery issues, trying venv method');
          logger.debug(`Poetry error (attempting venv fallback): ${errorDetails}`);

          try {
            await installWithVenv(
              projectPath,
              pythonAnswers.pythonVersion,
              spinner,
              testMode,
              userConfig
            );
            // Update the marker to reflect actual install method
            pythonAnswers.installMethod = 'venv';
          } catch (venvError) {
            // Both methods failed - throw the venv error as it's more recent
            throw venvError;
          }
        } else {
          throw poetryError;
        }
      }
    } else if (pythonAnswers.installMethod === 'venv') {
      await installWithVenv(
        projectPath,
        pythonAnswers.pythonVersion,
        spinner,
        testMode,
        userConfig
      );
    } else {
      await installWithPipx(projectPath, spinner, testMode, userConfig, yes);
    }

    // Create a local launcher so users can run RapidKit without activating the env.
    await writeWorkspaceLauncher(projectPath, pythonAnswers.installMethod);

    spinner.succeed('Workspai environment ready!');

    const onboarding = await finalizeWorkspaceOnboarding(projectPath, {
      workspaceName: name,
      silent: true,
    });
    await commitLifecycleTransaction(transaction);

    if (!options.skipGit) {
      await initializeStandaloneGitRepository(
        projectPath,
        spinner,
        'Initial commit: Workspai environment'
      );
    }

    printWorkspaceCreationReceipt({
      workspaceName: name,
      workspacePath: projectPath,
      profile: resolvedProfile,
      projectCount: onboarding?.projectCount ?? 0,
      pythonEngine: 'installed',
      pythonVersion: pythonAnswers.pythonVersion,
      installMethod: pythonAnswers.installMethod,
    });
  } catch (_error) {
    spinner.fail('Failed to create Workspai environment');
    console.error(chalk.red('\n❌ Error:'), _error);

    return rollbackLifecycleTransaction(transaction, _error);
  }
}

// Find real Python executable (bypass pyenv shims that might fail)
async function findRealPython(pythonVersion: string): Promise<string | null> {
  // Try multiple strategies to find a working Python
  const candidates: string[] = [];

  // 1. Try pyenv versions directly (bypass shims)
  if (!isWindowsPlatform()) {
    try {
      // Prefer the concrete interpreter selected by pyenv for this shell.
      const { stdout } = await execa('pyenv', ['which', 'python']);
      const pyenvPython = stdout.trim();
      if (pyenvPython) candidates.push(pyenvPython);
    } catch {
      // pyenv not available or failed
    }
  }

  // 2. Try utility-driven cross-platform commands
  const preferredMinor = Number(pythonVersion.split('.')[1]);
  const probeCommands = getPythonVersionProbeCandidates(preferredMinor, 10)
    .map((probe) => probe.command)
    .filter(Boolean);
  candidates.push(`python${pythonVersion}`, ...probeCommands, ...getPythonCommandCandidates());

  const uniqueCandidates = [...new Set(candidates)];

  // Test each candidate
  for (const candidate of uniqueCandidates) {
    try {
      const versionArgs = candidate === 'py' ? ['-3', '--version'] : ['--version'];
      const probeArgs =
        candidate === 'py'
          ? ['-3', '-c', 'import sys; sys.exit(0)']
          : ['-c', 'import sys; sys.exit(0)'];
      const { stdout } = await execa(candidate, versionArgs, { timeout: 2000 });
      const version = stdout.match(/Python (\d+\.\d+)/)?.[1];
      if (version && isPythonAtLeast(version, pythonVersion)) {
        // Verify this Python actually works (not a broken shim)
        await execa(candidate, probeArgs, { timeout: 2000 });
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

// Install RapidKit with Poetry
async function installWithPoetry(
  projectPath: string,
  pythonVersion: string,
  spinner: CliSpinnerHandle,
  testMode?: boolean,
  userConfig?: UserConfig,
  _yes = false
) {
  await ensurePoetryAvailable(spinner, _yes);

  // Find a working Python before initializing Poetry
  spinner.start('Finding Python interpreter');
  const realPython = await findRealPython(pythonVersion);
  if (realPython) {
    logger.debug(`Found working Python: ${realPython}`);
    spinner.succeed('Python found');
  } else {
    spinner.warn('Could not verify Python path, proceeding with default');
  }

  spinner.start('Initializing Poetry project');

  // If a pyproject.toml stub was pre-written (contains rapidkit-core), skip
  // `poetry init` entirely.  The stub already declares the dependency, so
  // `poetry install --no-root` below will resolve everything in one pass.
  const pyprojectPath = path.join(projectPath, 'pyproject.toml');
  const existingPyprojectContent = (await fsExtra.pathExists(pyprojectPath))
    ? await fsPromises.readFile(pyprojectPath, 'utf-8')
    : '';
  const hasPrewrittenStub = existingPyprojectContent.includes('rapidkit-core');

  if (!hasPrewrittenStub) {
    await execa('poetry', ['init', '--no-interaction', '--python', `^${pythonVersion}`], {
      cwd: projectPath,
    });

    spinner.succeed('Poetry project initialized');

    // Set package-mode = false since this is a workspace, not a package
    // Poetry 2.2+ uses PEP 621 format with [project] instead of [tool.poetry]
    const pyprojectContent = await fsPromises.readFile(pyprojectPath, 'utf-8');

    let updatedContent = pyprojectContent;

    // Try to add package-mode = false in the right place
    if (updatedContent.includes('[tool.poetry]')) {
      // Old format - add after [tool.poetry]
      updatedContent = updatedContent.replace(
        '[tool.poetry]',
        '[tool.poetry]\npackage-mode = false'
      );
    } else if (updatedContent.includes('[project]')) {
      // New PEP 621 format - add before [build-system]
      if (updatedContent.includes('[build-system]')) {
        updatedContent = updatedContent.replace(
          '[build-system]',
          '\n[tool.poetry]\npackage-mode = false\n\n[build-system]'
        );
      } else {
        // Add at the end if no build-system section
        updatedContent += '\n\n[tool.poetry]\npackage-mode = false\n';
      }
    }

    await fsPromises.writeFile(pyprojectPath, updatedContent, 'utf-8');
  } else {
    spinner.succeed('Poetry project initialized');
  }

  // Configure in-project venv (write poetry.toml before creating the venv).
  spinner.start('Configuring Poetry');
  try {
    // Use --local to avoid affecting global Poetry config
    await execa('poetry', ['config', 'virtualenvs.in-project', 'true', '--local'], {
      cwd: projectPath,
    });
    spinner.succeed('Poetry configured');
  } catch (_error) {
    // Not a fatal error; continue with installation.
    spinner.warn('Could not configure Poetry virtualenvs.in-project');
  }

  // Pre-create the virtualenv with `python -m venv` BEFORE telling Poetry which
  // Python to use.  This is critical: if we call `poetry env use <python>` first,
  // Poetry bootstraps its own venv (slow network call); then overwriting it with
  // `python -m venv .venv` leaves a "foreign" venv that causes
  // `poetry install --no-root` to fail.
  //
  // Correct order:
  //   1. python -m venv .venv          (instant, no network)
  //   2. poetry env use .venv/bin/python (points Poetry at the ready venv)
  //   3. poetry install --no-root       (near-instant — venv already exists)
  spinner.start('Creating virtualenv');
  const pythonBin = realPython || getPythonCommand();
  let venvPythonBin: string = getVenvPythonPath(path.join(projectPath, '.venv'));
  try {
    await execa(pythonBin, ['-m', 'venv', '.venv'], { cwd: projectPath, timeout: 60000 });
    spinner.succeed('Virtualenv created');
  } catch (venvError) {
    logger.debug(`python -m venv failed: ${venvError}`);
    // Non-fatal: fall through and let Poetry attempt its own venv creation.
    spinner.warn('Could not pre-create virtualenv, Poetry will try');
    venvPythonBin = realPython || getPythonCommand(); // fallback: point to system Python
  }

  // Tell Poetry to use the venv we just created (or the system Python as fallback).
  try {
    await execa('poetry', ['env', 'use', venvPythonBin || getPythonCommand()], {
      cwd: projectPath,
    });
    logger.debug(`Poetry env set to: ${venvPythonBin}`);
  } catch (envError) {
    // Non-fatal — Poetry will discover the in-project .venv on its own.
    logger.debug(`Could not set Poetry env: ${envError}`);
  }

  // Install rapidkit-core into the virtualenv.
  //
  // Fast path (pre-written stub, production): `pip install rapidkit-core` is
  // ~3-4x faster than Poetry's SAT resolver (`poetry install --no-root` or
  // `poetry add`) because pip skips full dependency solving.
  //
  // Legacy / test paths still go through Poetry so existing behaviour is preserved.
  spinner.start('Installing RapidKit');

  if (hasPrewrittenStub && !testMode) {
    // Production fast path — use pip directly.
    const localRapidKitPath = getTestRapidKitPath(userConfig || {});
    const hasLocalRapidKitPath = localRapidKitPath
      ? await fsExtra.pathExists(localRapidKitPath)
      : false;
    const installTarget: string =
      hasLocalRapidKitPath && localRapidKitPath ? localRapidKitPath : 'rapidkit-core';

    if (localRapidKitPath && !hasLocalRapidKitPath) {
      logger.warn(
        `WORKSPAI_DEV_PATH/RAPIDKIT_DEV_PATH points to a path that does not exist: ${localRapidKitPath}. Falling back to PyPI.`
      );
    }

    spinner.text = hasLocalRapidKitPath
      ? 'Installing RapidKit from local path'
      : 'Installing RapidKit from PyPI';
    let installSuccess = false;
    let lastPipError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!hasLocalRapidKitPath) {
          emitCliInstallProgress({
            status: 'started',
            message: 'Installing RapidKit from PyPI',
            installMethod: 'poetry',
            attempt,
            maxAttempts: 3,
          });
        }
        await execa(venvPythonBin, ['-m', 'pip', 'install', installTarget, '--quiet'], {
          cwd: projectPath,
          timeout: 180000,
        });
        installSuccess = true;
        if (!hasLocalRapidKitPath) {
          emitCliInstallProgress({
            status: 'succeeded',
            message: 'RapidKit installed from PyPI',
            installMethod: 'poetry',
            attempt,
            maxAttempts: 3,
          });
        }
        break;
      } catch (err) {
        lastPipError = err;
        logger.debug(`pip install rapidkit-core attempt ${attempt} failed: ${err}`);
        if (attempt < 3) {
          spinner.text = `Retrying installation (attempt ${attempt + 1}/3)`;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (!installSuccess) {
      const errorMsg =
        (lastPipError as Error & { stderr?: string })?.stderr ||
        (lastPipError as Error)?.message ||
        'Unknown error';
      logger.debug(`All pip install attempts failed. Last error: ${errorMsg}`);
      if (errorMsg.includes('Could not find') || errorMsg.includes('No matching distribution')) {
        throw new RapidKitNotAvailableError();
      } else {
        throw new InstallationError(
          'Install rapidkit-core with pip',
          new Error(
            `Failed to install rapidkit-core after 3 attempts.\n` +
              `Error: ${errorMsg}\n\n` +
              `Possible solutions:\n` +
              `  1. Check your internet connection\n` +
              `  2. Try installing manually: cd ${path.basename(projectPath)} && poetry add rapidkit-core\n` +
              `  3. Use venv method instead: npx workspai ${path.basename(projectPath)} --install-method=venv`
          )
        );
      }
    }
  } else {
    // Test mode OR legacy (no pre-written stub) — use original Poetry flow.
    // Sync lockfile + install deps into the (now-existing) venv.  With an
    // already-present .venv this is near-instant for an empty project.
    spinner.text = 'Syncing Poetry environment';
    try {
      await execa('poetry', ['install', '--no-root'], { cwd: projectPath, timeout: 120000 });
      spinner.succeed('Poetry environment synced');
    } catch (venvError) {
      logger.debug(`poetry install --no-root failed: ${venvError}`);
      spinner.warn('Could not sync Poetry environment, proceeding with add command');
    }

    spinner.start('Installing RapidKit');
    if (testMode) {
      // Test mode: Install from local path (configured via environment or config file)
      const localPath = getTestRapidKitPath(userConfig || {});
      if (!localPath) {
        throw new InstallationError(
          'Test mode installation',
          new Error(
            'No local RapidKit path configured. Set WORKSPAI_DEV_PATH (or legacy RAPIDKIT_DEV_PATH).'
          )
        );
      }
      logger.debug(`Installing from local path: ${localPath}`);
      spinner.text = 'Installing RapidKit from local path (test mode)';
      await execa('poetry', ['add', localPath], { cwd: projectPath });
    } else {
      // Legacy / fallback: no pre-written stub — add rapidkit-core explicitly.
      // Production: Install from PyPI
      spinner.text = 'Installing RapidKit from PyPI';

      let installSuccess = false;
      let lastError: unknown = null;

      // Try up to 3 times with increasing timeouts
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          emitCliInstallProgress({
            status: 'started',
            message: 'Installing RapidKit from PyPI',
            installMethod: 'poetry',
            attempt,
            maxAttempts: 3,
          });
          await execa('poetry', ['add', 'rapidkit-core'], {
            cwd: projectPath,
            timeout: 60000 * attempt, // 60s, 120s, 180s
          });
          installSuccess = true;
          emitCliInstallProgress({
            status: 'succeeded',
            message: 'RapidKit installed from PyPI',
            installMethod: 'poetry',
            attempt,
            maxAttempts: 3,
          });
          break;
        } catch (error) {
          lastError = error;
          logger.debug(`Poetry add attempt ${attempt} failed: ${error}`);

          if (attempt < 3) {
            spinner.text = `Retrying installation (attempt ${attempt + 1}/3)`;
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s between retries
          }
        }
      }

      if (!installSuccess) {
        // All attempts failed - provide helpful error
        const errorMsg =
          (lastError as Error & { stderr?: string })?.stderr ||
          (lastError as Error)?.message ||
          'Unknown error';
        logger.debug(`All Poetry install attempts failed. Last error: ${errorMsg}`);

        // Check if it's a network/PyPI issue vs other issues
        if (errorMsg.includes('Could not find') || errorMsg.includes('No matching distribution')) {
          throw new RapidKitNotAvailableError();
        } else {
          throw new InstallationError(
            'Install rapidkit-core with Poetry',
            new Error(
              `Failed to install rapidkit-core after 3 attempts.\n` +
                `Error: ${errorMsg}\n\n` +
                `Possible solutions:\n` +
                `  1. Check your internet connection\n` +
                `  2. Try installing manually: cd ${path.basename(projectPath)} && poetry add rapidkit-core\n` +
                `  3. Use venv method instead: npx workspai ${path.basename(projectPath)} --install-method=venv`
            )
          );
        }
      }
    }
  }
  spinner.succeed('RapidKit installed in project virtualenv');

  // Also install globally with pipx for CLI access
  try {
    const { checkRapidkitCoreAvailable } = await import('./core-bridge/pythonRapidkitExec.js');
    const isGloballyAvailable = await checkRapidkitCoreAvailable();

    if (!isGloballyAvailable && !testMode) {
      spinner.start('Checking optional global pipx installation');
      const pipx = await ensurePipxAvailable(spinner, true);
      try {
        spinner.start('Installing RapidKit globally with pipx for CLI access');
        await execaPipx(pipx, ['install', 'rapidkit-core']);
        spinner.succeed('RapidKit installed globally');
      } catch (pipxError) {
        // Not fatal - project virtualenv has it
        spinner.warn('Could not install globally (non-fatal, project virtualenv has RapidKit)');
        logger.debug(`pipx install failed: ${pipxError}`);
      }
    }
  } catch (checkError) {
    // Non-fatal - optional global install should never block workspace creation
    spinner.succeed('Skipped optional global pipx installation');
    logger.debug(`Global install check skipped: ${checkError}`);
  }
}

// Install RapidKit with venv + pip
async function installWithVenv(
  projectPath: string,
  pythonVersion: string,
  spinner: CliSpinnerHandle,
  testMode?: boolean,
  userConfig?: UserConfig,
  _yes = false
) {
  spinner.start(`Checking Python ${pythonVersion}`);

  const pythonCmd = getPythonCommand();
  try {
    const { stdout } = await execa(pythonCmd, ['--version']);
    const version = stdout.match(/Python (\d+\.\d+)/)?.[1];

    if (version && !isPythonAtLeast(version, pythonVersion)) {
      throw new PythonNotFoundError(pythonVersion, version);
    }

    spinner.succeed(`Python ${version} found`);
  } catch (_error) {
    if (_error instanceof PythonNotFoundError) {
      throw _error;
    }
    throw new PythonNotFoundError(pythonVersion);
  }

  spinner.start('Creating virtual environment');
  try {
    await execa(pythonCmd, ['-m', 'venv', '.venv'], { cwd: projectPath });
    spinner.succeed('Virtual environment created');
  } catch (venvError: unknown) {
    spinner.fail('Failed to create virtual environment');

    // Type guard: check if error has stdout property (from execa)
    const hasStdout = (err: unknown): err is { stdout: string } => {
      return (
        typeof err === 'object' &&
        err !== null &&
        'stdout' in err &&
        typeof (err as Record<string, unknown>).stdout === 'string'
      );
    };

    // Check if it's the ensurepip issue
    if (hasStdout(venvError) && venvError.stdout.includes('ensurepip is not')) {
      const match = venvError.stdout.match(/apt install (python[\d.]+-venv)/);
      const packageName = match ? match[1] : 'python3-venv';

      throw new InstallationError(
        'Python venv module not available',
        new Error(
          `Virtual environment creation failed.\n\n` +
            `On Debian/Ubuntu systems, install the venv package:\n` +
            `  sudo apt install ${packageName}\n\n` +
            `Or use Poetry instead (recommended):\n` +
            `  npx workspai create workspace ${path.basename(projectPath)} --yes --install-method poetry`
        )
      );
    }

    // Other venv errors
    throw new InstallationError(
      'Virtual environment creation',
      venvError instanceof Error ? venvError : new Error(String(venvError))
    );
  }

  spinner.start('Installing RapidKit');
  // Use python -m pip for cross-platform compatibility.
  // Windows 25.0+ requires this instead of calling pip.exe directly.
  const venvPython = getVenvPythonPath(path.join(projectPath, '.venv'));

  await execa(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: projectPath });

  if (testMode) {
    // Test mode: Install from local path (configured via environment or config file)
    const localPath = getTestRapidKitPath(userConfig || {});
    if (!localPath) {
      throw new InstallationError(
        'Test mode installation',
        new Error(
          'No local RapidKit path configured. Set WORKSPAI_DEV_PATH (or legacy RAPIDKIT_DEV_PATH).'
        )
      );
    }
    logger.debug(`Installing from local path: ${localPath}`);
    spinner.text = 'Installing RapidKit from local path (test mode)';
    await execa(venvPython, ['-m', 'pip', 'install', '-e', localPath], { cwd: projectPath });
  } else {
    // Production: Install from PyPI
    spinner.text = 'Installing RapidKit from PyPI';

    let installSuccess = false;
    let lastError: unknown = null;

    // Try up to 3 times with increasing timeouts
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        emitCliInstallProgress({
          status: 'started',
          message: 'Installing RapidKit from PyPI',
          installMethod: 'venv',
          attempt,
          maxAttempts: 3,
        });
        await execa(venvPython, ['-m', 'pip', 'install', 'rapidkit-core'], {
          cwd: projectPath,
          timeout: 60000 * attempt, // 60s, 120s, 180s
        });
        installSuccess = true;
        emitCliInstallProgress({
          status: 'succeeded',
          message: 'RapidKit installed from PyPI',
          installMethod: 'venv',
          attempt,
          maxAttempts: 3,
        });
        break;
      } catch (error) {
        lastError = error;
        logger.debug(`pip install attempt ${attempt} failed: ${error}`);

        if (attempt < 3) {
          spinner.text = `Retrying installation (attempt ${attempt + 1}/3)`;
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s between retries
        }
      }
    }

    if (!installSuccess) {
      // All attempts failed
      const errorMsg =
        (lastError as Error & { stderr?: string })?.stderr ||
        (lastError as Error)?.message ||
        'Unknown error';
      logger.debug(`All pip install attempts failed. Last error: ${errorMsg}`);

      if (errorMsg.includes('Could not find') || errorMsg.includes('No matching distribution')) {
        throw new RapidKitNotAvailableError();
      } else {
        throw new InstallationError(
          'Install rapidkit-core with pip',
          new Error(
            `Failed to install rapidkit-core after 3 attempts.\n` +
              `Error: ${errorMsg}\n\n` +
              `Possible solutions:\n` +
              `  1. Check your internet connection\n` +
              `  2. Try installing manually: cd ${path.basename(projectPath)} && ${getVenvPythonPath('.venv')} -m pip install rapidkit-core\n` +
              `  3. Use Poetry instead: npx workspai ${path.basename(projectPath)} --install-method=poetry`
          )
        );
      }
    }
  }
  spinner.succeed('RapidKit installed in project virtualenv');

  // Also install globally with pipx for CLI access
  try {
    const { checkRapidkitCoreAvailable } = await import('./core-bridge/pythonRapidkitExec.js');
    const isGloballyAvailable = await checkRapidkitCoreAvailable();

    if (!isGloballyAvailable && !testMode) {
      spinner.start('Checking optional global pipx installation');
      const pipx = await ensurePipxAvailable(spinner, true);
      try {
        spinner.start('Installing RapidKit globally with pipx for CLI access');
        await execaPipx(pipx, ['install', 'rapidkit-core']);
        spinner.succeed('RapidKit installed globally');
      } catch (pipxError) {
        // Not fatal - project virtualenv has it
        spinner.warn('Could not install globally (non-fatal, project virtualenv has RapidKit)');
        logger.debug(`pipx install failed: ${pipxError}`);
      }
    }
  } catch (checkError) {
    // Non-fatal - optional global install should never block workspace creation
    spinner.succeed('Skipped optional global pipx installation');
    logger.debug(`Global install check skipped: ${checkError}`);
  }
}

// Install RapidKit with pipx (global)
async function installWithPipx(
  projectPath: string,
  spinner: CliSpinnerHandle,
  testMode?: boolean,
  userConfig?: UserConfig,
  yes = false
) {
  if (!testMode) {
    try {
      const { checkRapidkitCoreVersionCompatible } =
        await import('./core-bridge/pythonRapidkitExec.js');
      const compatibility = await checkRapidkitCoreVersionCompatible();

      if (compatibility.isCompatible) {
        spinner.succeed(
          `RapidKit ${compatibility.installedVersion ?? ''} already compatible globally; skipping pipx installation`
        );
        await fsExtra.outputFile(
          path.join(projectPath, '.rapidkit-global'),
          `RapidKit already available globally (version ${compatibility.installedVersion ?? 'unknown'}) and satisfies expected constraint ${compatibility.expectedConstraint ?? 'n/a'}; workspace will reuse the existing installation\n`,
          'utf-8'
        );
        return;
      }

      if (compatibility.reason === 'constraint-missing') {
        spinner.warn(
          'Version-aware global reuse skipped: no explicit rapidkit-core version constraint found. Set RAPIDKIT_CORE_PYTHON_PACKAGE (example: RAPIDKIT_CORE_PYTHON_PACKAGE="rapidkit-core>=0.4.0,<0.9.0") to enable version-aware reuse. Proceeding with pipx install/upgrade.'
        );
      } else if (compatibility.reason === 'constraint-unsupported') {
        spinner.warn(
          'Version-aware global reuse skipped: RAPIDKIT_CORE_PYTHON_PACKAGE uses an unsupported spec (path/url/git). Use a version range instead (example: RAPIDKIT_CORE_PYTHON_PACKAGE="rapidkit-core==0.4.0" or "rapidkit-core>=0.4.0,<0.9.0"). Proceeding with pipx install/upgrade.'
        );
      }

      logger.debug(
        `Global RapidKit install is not reusable via version-aware policy (reason=${compatibility.reason}, installed=${compatibility.installedVersion ?? 'unknown'}, expected=${compatibility.expectedConstraint ?? 'none'}). Proceeding with pipx install/upgrade.`
      );
    } catch (checkError) {
      logger.debug(`Global RapidKit version-aware check failed before pipx install: ${checkError}`);
    }
  }

  const pipx = await ensurePipxAvailable(spinner, yes);

  spinner.start('Installing RapidKit globally with pipx');
  if (testMode) {
    // Test mode: Install from local path (configured via environment or config file)
    const localPath = getTestRapidKitPath(userConfig || {});
    if (!localPath) {
      throw new InstallationError(
        'Test mode installation',
        new Error(
          'No local RapidKit path configured. Set WORKSPAI_DEV_PATH (or legacy RAPIDKIT_DEV_PATH).'
        )
      );
    }
    logger.debug(`Installing from local path: ${localPath}`);
    spinner.text = 'Installing RapidKit from local path (test mode)';
    await execaPipx(pipx, ['install', '-e', localPath]);
  } else {
    // Production: Install from PyPI
    spinner.text = 'Installing RapidKit from PyPI';
    emitCliInstallProgress({
      status: 'started',
      message: 'Installing RapidKit from PyPI',
      installMethod: 'pipx',
    });
    try {
      await execaPipx(pipx, ['install', 'rapidkit-core']);
      emitCliInstallProgress({
        status: 'succeeded',
        message: 'RapidKit installed from PyPI',
        installMethod: 'pipx',
      });
    } catch (installError) {
      // If already installed, upgrade to ensure expected version/range compatibility.
      try {
        spinner.text = 'RapidKit already installed globally, upgrading to match expected version';
        await execaPipx(pipx, ['upgrade', 'rapidkit-core']);
        emitCliInstallProgress({
          status: 'succeeded',
          message: 'RapidKit upgraded from PyPI',
          installMethod: 'pipx',
        });
      } catch (_upgradeError) {
        logger.debug(
          `pipx install/upgrade failed: install=${installError}, upgrade=${_upgradeError}`
        );
        // pipx failed to install/upgrade - could be network, PyPI availability, etc.
        throw new RapidKitNotAvailableError();
      }
    }
  }
  spinner.succeed('RapidKit installed globally');

  // Create a simple marker file
  await fsExtra.outputFile(
    path.join(projectPath, '.rapidkit-global'),
    'RapidKit installed globally with pipx\n',
    'utf-8'
  );
}

// Register an existing directory as a Workspai workspace. Python Core is an
// optional runtime capability, not a prerequisite for workspace management.
export async function registerWorkspaceAtPath(
  workspacePath: string,
  options?: {
    skipGit?: boolean;
    /**
     * Explicitly install the optional Python engine while registering. Omit
     * this for the normal foundation-only workspace registration path.
     */
    installPythonEngine?: boolean;
    testMode?: boolean;
    userConfig?: UserConfig;
    yes?: boolean;
    installMethod?: InstallMethod;
    pythonVersion?: string;
    /** Bootstrap profile written into .workspai/workspace.json. */
    profile?: string;
  }
) {
  const {
    skipGit = false,
    installPythonEngine = false,
    testMode = false,
    userConfig = {},
    yes = false,
    installMethod,
    pythonVersion = '3.10',
  } = options || {};

  let resolvedMethod: InstallMethod = 'venv';
  if (installPythonEngine) {
    // Choose install method only when Python Core installation was explicitly
    // requested by the caller. Foundation-only registration must not probe the
    // host for Python package-management tools.
    const method: InstallMethod =
      (installMethod as InstallMethod) ||
      (userConfig.defaultInstallMethod as InstallMethod) ||
      (await (async (): Promise<InstallMethod> => {
        try {
          await execa('poetry', ['--version'], { timeout: 3000 });
          return 'poetry';
        } catch {
          logger.warn(
            'Poetry not found — auto-selecting venv. Pass --install-method poetry to override.'
          );
          return 'venv';
        }
      })());

    resolvedMethod = method === 'poetry' && !(await isPoetryAvailable()) ? 'venv' : method;
  }

  const spinner = createCliSpinner('Registering workspace', {
    component: 'create',
    phase: 'workspace.register',
  });
  const transaction = await beginExistingWorkspaceTransaction(workspacePath);

  try {
    const workspaceName = path.basename(workspacePath);
    const bootstrapMeta: WorkspaceBootstrapMeta | undefined = !installPythonEngine
      ? {
          bootstrapNote: 'python-engine-skipped',
          pythonEngine: 'skipped',
          pythonEngineReason: 'project-workspace-foundation',
        }
      : undefined;
    await writeWorkspaceMarker(
      workspacePath,
      workspaceName,
      resolvedMethod,
      installPythonEngine ? pythonVersion : undefined,
      bootstrapMeta
    );
    await writeWorkspaceGitignore(workspacePath);
    await writeWorkspaceFoundationFiles(
      workspacePath,
      workspaceName,
      resolvedMethod,
      installPythonEngine ? pythonVersion : undefined,
      options?.profile ?? 'minimal',
      bootstrapMeta
    );

    if (!installPythonEngine) {
      await writeWorkspaceLauncher(workspacePath, resolvedMethod, {
        pythonEngineSkipped: true,
      });
    } else if (resolvedMethod === 'poetry') {
      // Write pyproject.toml stub so installWithPoetry can skip poetry init + poetry add.
      await writePyprojectStub(workspacePath, workspaceName);
      await installWithPoetry(workspacePath, pythonVersion, spinner, testMode, userConfig, yes);
    } else if (resolvedMethod === 'venv') {
      await installWithVenv(workspacePath, pythonVersion, spinner, testMode, userConfig);
    } else {
      await installWithPipx(workspacePath, spinner, testMode, userConfig, yes);
    }

    if (installPythonEngine) {
      await writeWorkspaceLauncher(workspacePath, resolvedMethod);
    }

    spinner.succeed(
      installPythonEngine ? 'Workspace registered' : 'Workspace registered (Python engine skipped)'
    );

    await finalizeWorkspaceOnboarding(workspacePath, {
      workspaceName: path.basename(workspacePath),
      silent: testMode,
    });
    await commitLifecycleTransaction(transaction);

    if (!skipGit) {
      await initializeStandaloneGitRepository(
        workspacePath,
        spinner,
        'Initial commit: Workspai workspace'
      );
    }
  } catch (e) {
    spinner.fail('Failed to register workspace');
    return rollbackLifecycleTransaction(transaction, e);
  }
}

/**
 * Create a demo workspace with kit templates (no Python installation)
 */
async function createDemoWorkspace(
  projectPath: string,
  name: string,
  skipGit: boolean
): Promise<void> {
  const spinner = createCliSpinner('Creating demo workspace', {
    component: 'create',
    phase: 'workspace.demo',
  });

  try {
    // Create directory
    await fsExtra.ensureDir(projectPath);
    spinner.succeed('Directory created');

    // Create a simple CLI script for generating demo projects
    spinner.start('Setting up demo kit generator');

    const packageJsonContent = JSON.stringify(
      {
        name: `${name}-workspace`,
        version: '1.0.0',
        private: true,
        description: 'Workspai demo workspace',
        scripts: {
          generate: 'node generate-demo.js',
        },
      },
      null,
      2
    );

    await fsPromises.writeFile(path.join(projectPath, 'package.json'), packageJsonContent, 'utf-8');

    const generateScriptContent = `#!/usr/bin/env node
/**
 * Demo Kit Generator - Create FastAPI demo projects
 * 
 * This workspace contains bundled Workspai templates that you can use
 * to generate demo projects without installing Python RapidKit Core.
 * 
 * Usage:
 *   npm run generate <project-name>
 *   node generate-demo.js <project-name>
 * 
 * Example:
 *   npm run generate my-api
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const projectName = process.argv[2];

if (!projectName) {
  console.error('\\n❌ Please provide a project name');
  console.log('\\nUsage: npm run generate <project-name>\\n');
  console.log('Example: npm run generate my-api\\n');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    rl.question(\`\${question} (\${defaultValue}): \`, (answer) => {
      resolve(answer || defaultValue);
    });
  });
}

async function main() {
  const targetPath = path.join(process.cwd(), projectName);
  
  if (fs.existsSync(targetPath)) {
    console.error(\`\\n❌ Directory "\${projectName}" already exists\\n\`);
    process.exit(1);
  }

  console.log(\`\\n🚀 Creating FastAPI project: \${projectName}\\n\`);
  
  const snakeName = projectName.replace(/-/g, '_').toLowerCase();
  const project_name = await ask('Project name (snake_case)', snakeName);
    const author = await ask('Author name', process.env.USER || 'Workspai User');
    const description = await ask('Description', 'FastAPI service generated with Workspai');
  
  rl.close();

  // Create project structure
  const dirs = [
    '',
    'src',
    'src/routing',
    'src/modules',
    'tests',
    '.workspai'
  ];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(targetPath, dir), { recursive: true });
  }

  // Template files with content
  const files = {
    'src/__init__.py': '"""' + project_name + ' package."""\\n',
    'src/modules/__init__.py': '"""Modules package."""\\n',
    'tests/__init__.py': '"""Tests package."""\\n',
    'src/main.py': \`"""$\{project_name} application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routing import api_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan context manager for startup/shutdown events."""
    yield


app = FastAPI(
    title="$\{project_name}",
    description="$\{description}",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8001, reload=True)
\`,
    'src/routing/__init__.py': \`"""API routing configuration."""

from fastapi import APIRouter

from .health import router as health_router

api_router = APIRouter()

api_router.include_router(health_router)
\`,
    'src/routing/health.py': \`"""Health check endpoints."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/", summary="Health check")
async def heartbeat() -> dict[str, str]:
    """Return basic service heartbeat."""
    return {"status": "ok"}
\`,
    'src/cli.py': \`"""CLI commands for $\{project_name}."""

import subprocess
import sys
from pathlib import Path


def dev():
    """Start development server with hot reload."""
    print("🚀 Starting development server...")
    subprocess.run([
        sys.executable, "-m", "uvicorn",
        "src.main:app", "--reload",
        "--host", "0.0.0.0", "--port", "8000"
    ])


def start():
    """Start production server."""
    print("⚡ Starting production server...")
    subprocess.run([
        sys.executable, "-m", "uvicorn",
        "src.main:app",
        "--host", "0.0.0.0", "--port", "8000"
    ])


def test():
    """Run tests."""
    print("🧪 Running tests...")
    subprocess.run([sys.executable, "-m", "pytest", "-q"])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m src.cli <command>")
        print("Commands: dev, start, test")
        sys.exit(1)
    
    cmd = sys.argv[1]
    if cmd == "dev":
        dev()
    elif cmd == "start":
        start()
    elif cmd == "test":
        test()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
\`,
    'pyproject.toml': \`[tool.poetry]
name = "$\{project_name}"
version = "0.1.0"
description = "$\{description}"
authors = ["$\{author}"]
license = "MIT"
readme = "README.md"
package-mode = false

[tool.poetry.dependencies]
python = "^3.10"
fastapi = "^0.128.0"
uvicorn = {extras = ["standard"], version = "^0.40.0"}
pydantic = "^2.12.5"
pydantic-settings = "^2.12.0"

[tool.poetry.group.dev.dependencies]
pytest = "^9.0.2"
pytest-asyncio = "^1.3.0"
pytest-cov = "^7.0.0"
httpx = "^0.28.1"
black = "^25.12.0"
ruff = "^0.14.10"
mypy = "^1.19.1"

[tool.poetry.scripts]
dev = "src.cli:dev"
start = "src.cli:start"
test = "src.cli:test"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.black]
line-length = 100
target-version = ["py311"]
\`,
    'README.md': \`# $\{project_name}

$\{description}

## Quick start

\\\`\\\`\\\`bash
npx workspai init       # Install dependencies
npx workspai dev        # Start dev server
\\\`\\\`\\\`

## Available commands

\\\`\\\`\\\`bash
npx workspai init       # 🔧 Install dependencies
npx workspai dev        # 🚀 Start development server with hot reload
npx workspai start      # ⚡ Start production server
npx workspai test       # 🧪 Run tests
npx workspai help       # 📚 Show available commands
\\\`\\\`\\\`

## Project layout

\\\`\\\`\\\`
$\{project_name}/
├── src/
│   ├── main.py           # FastAPI application
│   ├── cli.py            # CLI commands
│   ├── routing/          # API routes
│   └── modules/          # Module system
├── tests/                # Test suite
├── pyproject.toml        # Poetry configuration
└── README.md
\\\`\\\`\\\`
\`,
    '.workspai/project.json': JSON.stringify({
      kit_name: "fastapi.standard",
      profile: "fastapi/standard",
      created_at: new Date().toISOString(),
      created_by: "workspai-cli-fallback",
      workspai_version: "npm-demo",
      rapidkit_version: "npm-demo"
    }, null, 2),
    '.workspai/cli.py': \`#!/usr/bin/env python3
"""RapidKit Core wrapper for demo projects."""

import subprocess
import sys
from pathlib import Path


def dev(port=8000, host="0.0.0.0"):
    """Start development server."""
    print("🚀 Starting development server with hot reload...")
    subprocess.run([
        sys.executable, "-m", "uvicorn",
        "src.main:app", "--reload",
        "--host", host, "--port", str(port)
    ])


def start(port=8000, host="0.0.0.0"):
    """Start production server."""
    print("⚡ Starting production server...")
    subprocess.run([
        sys.executable, "-m", "uvicorn",
        "src.main:app",
        "--host", host, "--port", str(port)
    ])


def init():
    """Install dependencies."""
    print("📦 Installing dependencies...")
    subprocess.run(["poetry", "install"])


def test():
    """Run tests."""
    print("🧪 Running tests...")
    subprocess.run([sys.executable, "-m", "pytest", "-q"])


def help_cmd():
    """Show help."""
    print("📚 Available commands:")
    print("  init   - Install dependencies")
    print("  dev    - Start dev server")
    print("  start  - Start production server")
    print("  test   - Run tests")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    cmds = {"dev": dev, "start": start, "init": init, "test": test, "help": help_cmd}
    cmds.get(cmd, help_cmd)()
\`,
    '.workspai/rapidkit': '#!/usr/bin/env bash\\n# Local RapidKit Core launcher for demo projects\\nset -euo pipefail\\nSCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\\nROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"\\ncd "$ROOT_DIR"\\n\\nif [ -f "pyproject.toml" ]; then\\n  if command -v poetry >/dev/null 2>&1; then\\n    exec poetry run python "$SCRIPT_DIR/cli.py" "$@"\\n  fi\\nfi\\n\\necho "Poetry not found. Install with: pip install poetry"\\nexit 1\\n',
    '.gitignore': \`# Python
__pycache__/
*.py[cod]
*.so
.Python
build/
dist/
*.egg-info/

# Virtual environments
.venv/
venv/

# IDEs
.vscode/
.idea/

# OS
.DS_Store

# Project
.env
.env.local
\`
  };

  for (const [filePath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(targetPath, filePath), content);
  }

  // Make scripts executable
  try {
    fs.chmodSync(path.join(targetPath, '.workspai/cli.py'), 0o755);
    fs.chmodSync(path.join(targetPath, '.workspai/rapidkit'), 0o755);
  } catch (e) {
    // Ignore on Windows
  }

  console.log(\`
✨ Demo project created successfully!

📂 Project: \${targetPath}

🚀 Get started:
  cd \${projectName}
  npx workspai init   # Install dependencies
  npx workspai dev    # Start dev server

📚 Available commands:
  npx workspai init   # 🔧 Install dependencies
  npx workspai dev    # 🚀 Start dev server with hot reload
  npx workspai start  # ⚡ Start production server
  npx workspai test   # 🧪 Run tests
  npx workspai help   # 📚 Show help

💡 For Python engine features: pipx install rapidkit-core
\`);
}

main().catch(console.error);
`;

    await fsPromises.writeFile(
      path.join(projectPath, 'generate-demo.js'),
      generateScriptContent,
      'utf-8'
    );

    // Make the script executable
    try {
      await execa('chmod', ['+x', path.join(projectPath, 'generate-demo.js')]);
    } catch {
      // Ignore if chmod fails (e.g., on Windows)
    }

    // Create README
    const readmeContent = `# Workspai Demo Workspace

Welcome to your Workspai demo workspace! This environment lets you generate FastAPI demo projects using bundled Workspai templates, without needing to install Python RapidKit Core.

## 🚀 Quick Start

### Generate Your First Demo Project

\`\`\`bash
# Generate a demo project:
node generate-demo.js my-api

# Navigate to the project:
cd my-api

# Install dependencies:
workspai init

# Run the development server:
workspai dev
\`\`\`

Your API will be available at \`http://localhost:8000\`

## 📦 Generate Multiple Projects

You can create multiple demo projects in this workspace:

\`\`\`bash
node generate-demo.js api-service
node generate-demo.js auth-service
node generate-demo.js data-service
\`\`\`

Each project is independent and has its own dependencies.

## 🎯 What's Included

Each generated demo project contains:

- **FastAPI Application** - Modern async web framework
- **Routing System** - Organized API routes
- **Module System** - Extensible module architecture
- **CLI Commands** - Built-in command system
- **Testing Setup** - pytest configuration
- **Poetry Configuration** - Dependency management

## 📚 Next Steps

1. **Explore the Generated Code** - Check out \`src/main.py\` and \`src/routing/\`
2. **Add Routes** - Create new endpoints in \`src/routing/\`
3. **Install RapidKit Core** - For Python engine features: \`pipx install rapidkit-core\`
4. **Read the Documentation** - Visit [Workspai Docs](https://workspai.dev/docs)

## ⚠️ Demo Mode Limitations

This is a demo workspace with:
- ✅ Pre-built FastAPI templates
- ✅ Project generation without Python RapidKit Core
- ❌ No Python RapidKit Core module commands (\`rapidkit add module\`)
- ❌ No interactive module system

For Python engine features, install RapidKit Core:

\`\`\`bash
pipx install rapidkit-core
\`\`\`

## 🛠️ Workspace Structure

\`\`\`
${name}/
  ├── generate-demo.js    # Demo project generator
  ├── README.md           # This file
  └── my-api/             # Your generated projects go here
\`\`\`

## 💡 Tips

- Run \`node generate-demo.js --help\` for more options (coming soon)
- Each project can have different configurations
- Demo projects are production-ready FastAPI applications
- You can copy and modify templates as needed

---

**Generated with Workspai** | [GitHub](https://github.com/chistiq/workspai)
`;

    await fsPromises.writeFile(path.join(projectPath, 'README.md'), readmeContent, 'utf-8');
    spinner.succeed('Demo workspace setup complete');

    // Git initialization
    if (!skipGit) {
      const existingGitRoot = await findContainingGitRoot(projectPath);
      if (existingGitRoot) {
        spinner.warn('Git initialization skipped because target is already inside a git worktree');
      } else {
        spinner.start('Initializing git repository');
        try {
          await execa('git', ['init'], { cwd: projectPath, env: buildCleanGitEnv() });
          await fsExtra.outputFile(
            path.join(projectPath, '.gitignore'),
            '# Dependencies\nnode_modules/\n\n# Generated projects\n*/\n!generate-demo.js\n!README.md\n\n# Python\n__pycache__/\n*.pyc\n.venv/\n.env\n',
            'utf-8'
          );
          await execa('git', ['add', '.'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa('git', ['commit', '-m', 'Initial commit: Demo workspace'], {
            cwd: projectPath,
            env: buildCleanGitEnv(),
          });
          spinner.succeed('Git repository initialized');
        } catch (_error) {
          spinner.warn('Could not initialize git repository');
        }
      }
    }

    // Success message
    console.log(chalk.green('\n✨ Demo workspace created successfully!\n'));
    console.log(chalk.cyan('📂 Location:'), chalk.white(projectPath));
    console.log(chalk.cyan('🚀 Get started:\n'));
    console.log(chalk.white(`   ${formatWorkspaceCdCommand(projectPath)}`));
    console.log(chalk.white('   node generate-demo.js my-api'));
    console.log(chalk.white('   cd my-api'));
    console.log(chalk.white('   workspai init'));
    console.log(chalk.white('   workspai dev'));
    console.log();
    console.log(chalk.yellow('💡 Note:'), 'This is a demo workspace. For Python engine features:');
    console.log(chalk.cyan('   pipx install rapidkit-core'));
    console.log();
  } catch (_error) {
    spinner.fail('Failed to create demo workspace');
    throw _error;
  }
}

/**
 * Show what would be created in dry-run mode
 */
async function showDryRun(
  projectPath: string,
  name: string,
  demoMode: boolean,
  userConfig: UserConfig,
  profileArg?: string,
  installMethodArg?: string,
  pythonVersionArg?: string,
  skipGit = false,
  skipPythonEngine = false
): Promise<void> {
  console.log(chalk.cyan('\n🔍 Dry-run mode - what would be created:\n'));
  console.log(chalk.white('📂 Workspace path:'), projectPath);
  console.log(chalk.white('📛 Name:'), chalk.cyan(name));

  if (demoMode) {
    console.log(chalk.white('📦 Type:'), 'Demo environment');
    console.log(chalk.white('\n📝 Files to create:'));
    console.log(chalk.gray('  - package.json'));
    console.log(chalk.gray('  - generate-demo.js (project generator)'));
    console.log(chalk.gray('  - README.md'));
    console.log(chalk.gray('  - .gitignore'));
    console.log(chalk.white('\n🎯 Capabilities:'));
    console.log(chalk.gray('  - Generate FastAPI/NestJS demo projects'));
    console.log(chalk.gray('  - No Python RapidKit installation required'));
    console.log(chalk.gray('  - Bundled templates'));
  } else {
    const profile = profileArg || 'minimal';
    const installMethod = installMethodArg || userConfig.defaultInstallMethod || 'poetry';
    const pythonVersion = pythonVersionArg || userConfig.pythonVersion || '3.10';

    const PYTHON_PROFILES = new Set(['python-only', 'polyglot', 'enterprise']);
    const isPythonProfile = PYTHON_PROFILES.has(profile);

    console.log(chalk.white('📦 Profile:'), chalk.cyan(profile));
    console.log(chalk.white('📝 Configuration:'));

    if (isPythonProfile) {
      console.log(chalk.gray(`  - Python version: ${pythonVersion}`));
      console.log(
        chalk.gray(
          `  - Python engine: ${skipPythonEngine ? 'Skipped' : `Install with ${installMethod}`}`
        )
      );
      console.log(chalk.gray(`  - Git init: ${skipGit ? 'No' : 'Yes'}`));
    } else {
      console.log(chalk.gray(`  - Python-free profile (no Python needed)`));
      console.log(chalk.gray(`  - Git init: ${skipGit ? 'No' : 'Yes'}`));
    }

    console.log(chalk.white('\n📋 Files to create:'));
    console.log(chalk.gray('  - .workspai-workspace (workspace marker)'));
    console.log(chalk.gray('  - .workspai/ (workspace config directory)'));
    console.log(chalk.gray('  - README.md'));
    console.log(chalk.gray('  - .gitignore'));
    if (isPythonProfile && !skipPythonEngine) {
      console.log(
        chalk.gray(
          `  - ${installMethod === 'poetry' ? 'pyproject.toml + poetry.lock' : '.venv/ (virtual environment)'}`
        )
      );
    }

    console.log(chalk.white('\n⚙️  Environment setup:'));
    if (isPythonProfile && skipPythonEngine) {
      console.log(chalk.gray(`  - Python engine setup skipped`));
    } else if (isPythonProfile) {
      if (installMethod === 'poetry') {
        console.log(
          chalk.gray(
            `  - Poetry virtual environment created (recommended, includes dependency management)`
          )
        );
      } else if (installMethod === 'venv') {
        console.log(chalk.gray(`  - Python venv created in .venv/ (standard, zero extra tools)`));
      } else {
        console.log(chalk.gray(`  - Global pipx install (isolated, not local to workspace)`));
      }
    }

    console.log(chalk.white('\n🚀 Next steps:'));
    console.log(chalk.gray(`  1. ${formatWorkspaceCdCommand(projectPath)}`));
    console.log(chalk.gray('  2. npx workspai create project'));
    console.log(chalk.gray('  3. npx workspai init'));
    console.log(chalk.gray('  4. npx workspai dev'));

    console.log(chalk.white('\n💡 Learn more:'));
    console.log(chalk.gray('  • Change profile later: workspai bootstrap --profile <profile>'));
    console.log(
      chalk.gray(
        '  • Profile options: minimal|java-only|python-only|node-only|go-only|dotnet-only|polyglot|enterprise'
      )
    );
    console.log(chalk.gray('  • Help: npx workspai --help'));
  }

  console.log(chalk.white('\n✨ To proceed: remove --dry-run flag\n'));
}
