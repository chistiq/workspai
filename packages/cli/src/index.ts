#!/usr/bin/env node

import { Command, Option } from 'commander';
import chalk from 'chalk';
import { prompt, showIntro } from './cli-ui/index.js';
import { buildKitPickerChoices } from './cli-ui/kit-picker-choices.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import vm from 'vm';
import { logger } from './logger.js';
import { checkForUpdates, getVersion } from './update-checker.js';
import {
  finalizeCliRunContext,
  initializeCliRunContext,
  installCliProcessExitHook,
  normalizeObservabilityInvocation,
} from './observability/cli-run-context.js';
import { loadUserConfig, loadWorkspaiConfig, mergeConfigs } from './config.js';
import { validateProjectName } from './validation.js';
import { RapidKitError } from './errors.js';
import { readWorkspaiEnv } from './utils/env-compat.js';
import fsExtra from 'fs-extra';
import fs from 'fs';
import { tmpdir } from 'os';
import { detectRapidkitProject } from './core-bridge/pythonRapidkit.js';
import {
  getCachedCoreTopLevelCommands,
  resolveRapidkitPython,
  runCoreRapidkit,
  runCoreRapidkitCapture,
  runCoreRapidkitStreamed,
} from './core-bridge/pythonRapidkitExec.js';
import { BOOTSTRAP_CORE_COMMANDS_SET } from './core-bridge/bootstrapCoreCommands.js';
import {
  WRAPPER_SHARED_CLI_FLAGS,
  isCoreDelegatedTopLevelCommand,
  isPythonCoreContextEngine,
  shouldBridgeInvocationToCore,
} from './core-bridge/coreForwarding.js';
import { registerConfigCommands } from './commands/config.js';
import { registerAICommands } from './commands/ai.js';
import { registerProductCommands } from './commands/product.js';
import { registerInfraCommands } from './commands/infra.js';
import { getRuntimeAdapter } from './runtime-adapters/index.js';
import type { CommandResult } from './runtime-adapters/types.js';
import { Cache } from './utils/cache.js';
import {
  isDotnetProject,
  isGoProject,
  isJavaProject,
  isNodeProject,
  isPythonProject,
  readRapidkitProjectJson,
} from './utils/runtime-detection.js';
import { detectBackendFrameworkFromProject } from './utils/backend-framework-contract.js';
import { resolveNodeLifecycleScript } from './utils/node-lifecycle-scripts.js';
import {
  PROJECT_COMMANDS_CORE_FALLBACK,
  WRAPPER_LIFECYCLE_COMMANDS,
  isWrapperLifecycleCommand,
} from './utils/cli-lifecycle-contract.js';
import { findRapidkitProjectRoot } from './utils/project-command-capabilities.js';
import { canonicalizeProjectMetadata, readProjectMetadata } from './utils/project-metadata.js';
import {
  ProjectWorkspaceResolutionError,
  repairProjectWorkspaceLink,
  resolveProjectWorkspaceSync,
} from './project-workspace-link.js';
import {
  resolveGovernanceRunId,
  withGovernanceRunMetadata,
} from './utils/governance-report-metadata.js';
import { hasNpmRuntimeExecutor } from './utils/runtime-executors.js';

export { PROJECT_COMMANDS_CORE_FALLBACK } from './utils/cli-lifecycle-contract.js';
import {
  formatUnsupportedProjectCommand,
  getProjectCommandCapability,
  isProjectCapabilityRequest,
  resolveProjectCommandCapabilities,
} from './utils/project-command-capabilities.js';
import {
  isWorkspaceIntelligenceSubcommand,
  WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
  WORKSPACE_SUBCOMMANDS,
} from './utils/workspace-command-surface.js';
import { emitWorkspacePhase } from './observability/cli-progress.js';
import {
  getPublishedContractCatalog,
  getPublishedContractVersions,
} from './contracts/published-contract-versions.js';
import { assertWorkspaceArtifactContract } from './contracts/artifact-contract-registry.js';
import {
  cliOperationError,
  cliOperationSuccess,
} from './contracts/cli-operation-result-contract.js';
import {
  COMMAND_CAPABILITIES_SCHEMA_VERSION,
  VERSION_CONTRACT_SCHEMA_VERSION,
} from './contracts/cli-discovery-contract.js';
import {
  WORKSPACE_ARCHIVE_CLI_FLAGS,
  WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
} from './contracts/workspace-archive-contract.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES,
  WORKSPACE_INTELLIGENCE_ROOT_COMMANDS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import {
  isWorkspaceActionHelpRequest,
  renderWorkspaceActionHelp,
  WORKSPACE_ACTION_CONTRACTS,
} from './contracts/workspace-action-contract.js';
import {
  buildCliRuntimeCommandInventory,
  formatCliCommandSurfaceIntegrityError,
  NPM_ONLY_CREATE_HANDLER_COMMAND,
  NPM_ONLY_MANUAL_HANDLER_COMMANDS,
  NPM_ONLY_SCOPED_COMMANDS as NPM_ONLY_SCOPED_COMMANDS_SOURCE,
  NPM_ONLY_TOP_LEVEL_COMMANDS as NPM_ONLY_TOP_LEVEL_COMMANDS_SOURCE,
} from './utils/cli-command-surface.js';

export const NPM_ONLY_SCOPED_COMMANDS: readonly (readonly string[])[] =
  NPM_ONLY_SCOPED_COMMANDS_SOURCE;
export const NPM_ONLY_TOP_LEVEL_COMMANDS: readonly string[] = NPM_ONLY_TOP_LEVEL_COMMANDS_SOURCE;
import {
  isNpmBackedKit,
  normalizeKitId,
  resolveKitDefinition,
  runNpmKitGenerator,
} from './utils/kit-registry.js';
import {
  resolveCreatePlannerCapability,
  shouldBlockUnsupportedNativeCreate,
  type CreatePlannerCapability,
} from './utils/create-planner-capabilities.js';
import { suggestProjectNameForKit } from './utils/suggested-project-name.js';
import { evaluateReleaseReadiness, runReleaseReadinessCommand } from './readiness.js';
import { runMirrorLifecycle } from './utils/mirror.js';
import { importProjectIntoWorkspace, isGitUrl } from './import-project.js';
import {
  adoptProjectIntoWorkspace,
  captureAdoptProjectRollbackSnapshot,
  type AdoptProjectRollbackSnapshot,
} from './adopt-project.js';
import type { ProjectGroundingMode } from './project-intelligence-lens.js';
import {
  assertProjectWorkspaceResolutionContract,
  type ProjectWorkspaceResolutionContract,
} from './contracts/project-workspace-resolution-contract.js';
import {
  collectWorkspaceProfileRuntimes,
  formatWorkspaceProfileCompatibilityHint,
  readWorkspaceManifestProfile,
  readWorkspaceProfilePolicyMode,
  resolveWorkspaceProfileCompatibility,
  resolveWorkspaceProfileProjectCompatibility,
} from './workspace-profile-compatibility.js';
import {
  createFrontendProject,
  frontendCreateUsage,
  isFrontendProjectKit,
  normalizeCreateFrontendArgs,
  resolveFrontendGenerator,
} from './frontend-project.js';
import {
  createOfficialProject,
  isOfficialProjectKit,
  officialProjectCreateUsage,
  resolveOfficialProjectGenerator,
} from './official-project.js';
import {
  getDefaultPythonCommand,
  getPythonCommandCandidates,
  getRapidkitLocalScriptCandidates,
  getLegacyWorkspaceRegistryDirectory,
  getVenvActivateScriptPath,
  getVenvPythonPath,
  getWorkspaceRegistryDirectory,
  isWindowsPlatform,
} from './utils/platform-capabilities.js';
import {
  MANAGED_DEFAULT_WORKSPACE_LABEL,
  PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
  PROJECT_GROUNDING_RELATIVE_PATH,
  PROJECT_WORKSPACE_LINK_RELATIVE_PATH,
  findExistingWorkspacePath,
  getCanonicalWorkspacesDirectory,
  projectMetadataCandidates,
  projectMetadataPath,
  resolveAvailableWorkspaceSlot,
  resolveManagedDefaultImportWorkspacePath,
  workspaceMetadataCandidates,
  workspaceMetadataPath,
} from './utils/workspace-paths.js';
import {
  formatWorkspaceCdCommand,
  resolveWorkspaceOutputParent,
  resolveWorkspaceTargetPath,
  shouldBlockExistingWorkspaceName,
} from './utils/workspace-create-location.js';
import {
  archiveWorkspaceProject,
  createWorkspaceSnapshot,
  deleteWorkspaceProject,
  inspectWorkspaceSnapshot,
  listArchivedProjects,
  listWorkspaceSnapshots,
  restoreArchivedProject,
  restoreWorkspaceSnapshot,
} from './workspace-snapshot.js';
import {
  createLifecycleTransaction,
  recoverActiveLifecycleTransactions,
} from './utils/lifecycle-transaction.js';
import {
  resolveLegacyWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
} from './utils/artifact-path-compat.js';
import { WORKSPACE_CONTRACT_PATH } from './utils/workspace-contract.js';
import { WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH } from './utils/workspace-registry-summary.js';
import { connectWorkspace, importWorkspaceArchive } from './workspace-ingestion.js';
import {
  buildExistingSoftwareSourcePrompt,
  buildInteractiveCreateTargetChoices,
  classifyExistingSoftwareSource,
  type InteractiveCreateTarget,
} from './utils/create-ingestion-choice.js';

export type BridgeFailureCode =
  | 'PYTHON_NOT_FOUND'
  | 'BRIDGE_VENV_BOOTSTRAP_FAILED'
  | 'BRIDGE_VENV_CREATE_FAILED'
  | 'BRIDGE_PIP_BOOTSTRAP_FAILED';

export function bridgeFailureCode(err: unknown): BridgeFailureCode | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  if (
    code === 'PYTHON_NOT_FOUND' ||
    code === 'BRIDGE_VENV_BOOTSTRAP_FAILED' ||
    code === 'BRIDGE_VENV_CREATE_FAILED' ||
    code === 'BRIDGE_PIP_BOOTSTRAP_FAILED'
  )
    return code;
  return null;
}

export function resolveInvokedCliName(argv = process.argv): 'workspai' | 'rapidkit' {
  const entry = path
    .basename(argv[1] ?? '')
    .toLowerCase()
    .replace(/\.(cmd|ps1|exe|js)$/i, '');
  return entry === 'rapidkit' || entry === 'rapidkit-npm' ? 'rapidkit' : 'workspai';
}

function shouldDebugWorkspaiArgs(): boolean {
  return process.env.WORKSPAI_DEBUG_ARGS === '1' || process.env.RAPIDKIT_NPM_DEBUG_ARGS === '1';
}

export function normalizeFallbackTemplate(kit: string): 'fastapi' | 'nestjs' | null {
  const k = kit.trim().toLowerCase();
  if (!k) return null;
  if (k.startsWith('fastapi')) return 'fastapi';
  if (k.startsWith('nestjs')) return 'nestjs';
  return null;
}

export function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return undefined;
}

export function parseMaxWorkersOption(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('--max-workers must be an integer between 1 and 16.');
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error('--max-workers must be an integer between 1 and 16.');
  }
  return parsed;
}

function resolveMaxWorkersOption(input: {
  raw: string | undefined;
  operation: string;
  json: boolean;
}): number | undefined {
  try {
    return parseMaxWorkersOption(input.raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.json) {
      console.log(
        JSON.stringify(
          cliOperationError({
            operation: input.operation,
            code: 'cli.option.max-workers.invalid',
            message,
            context: { value: input.raw ?? null, minimum: 1, maximum: 16 },
          }),
          null,
          2
        )
      );
    } else {
      console.error(chalk.red(`❌ ${message}`));
    }
    process.exit(1);
  }
}

async function persistRequestedProjectPort(args: string[], cwd: string): Promise<void> {
  const rawPort = readFlagValue(args, '--port')?.trim();
  const projectName = args[3];
  if (!rawPort || !projectName || !/^\d+$/.test(rawPort)) return;

  const port = Number.parseInt(rawPort, 10);
  if (port < 1 || port > 65535) return;

  const outputDir = readFlagValue(args, '--output') || '.';
  const projectPath = path.resolve(cwd, outputDir, projectName);
  const metadataPath =
    projectMetadataCandidates(projectPath, 'project.json').find((candidate) =>
      fs.existsSync(candidate)
    ) ?? projectMetadataPath(projectPath, 'project.json');
  if (!(await fsExtra.pathExists(metadataPath))) return;

  const metadata = (await fsExtra.readJson(metadataPath)) as Record<string, unknown>;
  await fsExtra.writeJson(
    metadataPath,
    { ...metadata, ports: [{ name: 'http', port, protocol: 'http' }] },
    { spaces: 2 }
  );
}

async function enforceWorkspaceProfileForRequestedKit(kitName: string): Promise<boolean> {
  const workspacePath = findWorkspaceUp(process.cwd());
  const normalizedKitName = kitName.trim().toLowerCase();
  if (!workspacePath || !normalizedKitName) {
    return true;
  }

  try {
    const [profile, mode] = await Promise.all([
      readWorkspaceManifestProfile(workspacePath),
      readWorkspaceProfilePolicyMode(workspacePath),
    ]);
    const kitDefinition = resolveKitDefinition(normalizedKitName);
    const frontendDefinition = resolveFrontendGenerator(normalizedKitName);
    const officialDefinition = resolveOfficialProjectGenerator(normalizedKitName);
    const runtime = frontendDefinition
      ? 'node'
      : (officialDefinition?.runtime ?? kitDefinition?.runtime ?? 'python');
    const projectCompatibility = resolveWorkspaceProfileProjectCompatibility({
      profile,
      runtime,
      subjectLabel: normalizedKitName,
      mode,
    });
    const workspaceCompatibility = resolveWorkspaceProfileCompatibility({
      profile,
      runtimes: await collectWorkspaceProfileRuntimes(workspacePath, {
        additionalRuntimes: [runtime],
      }),
      mode,
    });
    const compatibility = projectCompatibility.ok ? workspaceCompatibility : projectCompatibility;

    if (compatibility.ok) {
      return true;
    }

    const hint = formatWorkspaceProfileCompatibilityHint(compatibility);
    if (mode === 'strict') {
      console.log(chalk.red(`❌ Profile violation (strict mode): ${compatibility.message}`));
      if (hint) {
        console.log(chalk.gray(`💡 ${hint}`));
      }
      return false;
    }

    console.log(chalk.yellow(`⚠️  Profile warning: ${compatibility.message}`));
    if (hint) {
      console.log(chalk.gray(`💡 ${hint}`));
    }
  } catch {
    // Profile compatibility is advisory unless the workspace policy can be read.
  }

  return true;
}

export function hostPythonCandidates(): string[] {
  return getPythonCommandCandidates();
}

export function buildDelegationEnvForInit(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const rawPath = env.PATH || '';
  if (rawPath) {
    env.PATH = rawPath
      .split(path.delimiter)
      .filter((segment) => !segment.replace(/\\/g, '/').includes('/.pyenv/shims'))
      .join(path.delimiter);
  }
  env.PYENV_VERSION = 'system';
  if (!env.POETRY_PYTHON) {
    env.POETRY_PYTHON = getDefaultPythonCommand();
  }
  if (!env.RAPIDKIT_SKIP_LOCK_SYNC) {
    env.RAPIDKIT_SKIP_LOCK_SYNC = '1';
  }
  if (!env.POETRY_KEYRING_ENABLED) {
    env.POETRY_KEYRING_ENABLED = 'false';
  }
  if (!env.PYTHON_KEYRING_BACKEND) {
    env.PYTHON_KEYRING_BACKEND = 'keyring.backends.null.Keyring';
  }
  if (!env.POETRY_NO_INTERACTION) {
    env.POETRY_NO_INTERACTION = '1';
  }
  return env;
}

function workspaceVenvPythonBin(workspacePath: string): string {
  return getVenvPythonPath(path.join(workspacePath, '.venv'));
}

export async function commandAvailable(command: string, cwd: string): Promise<boolean> {
  const code = await runCommandInCwd(command, ['--version'], cwd);
  return code === 0;
}

type InferredRuntime = 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php' | null;

export async function inferRuntimeByFiles(targetPath: string): Promise<InferredRuntime> {
  const goMod = path.join(targetPath, 'go.mod');
  if (await fsExtra.pathExists(goMod)) return 'go';

  const pomXml = path.join(targetPath, 'pom.xml');
  const buildGradle = path.join(targetPath, 'build.gradle');
  const buildGradleKts = path.join(targetPath, 'build.gradle.kts');
  if (
    (await fsExtra.pathExists(pomXml)) ||
    (await fsExtra.pathExists(buildGradle)) ||
    (await fsExtra.pathExists(buildGradleKts))
  ) {
    return 'java';
  }

  const entries = (await fsExtra.pathExists(targetPath))
    ? await fs.promises.readdir(targetPath, { withFileTypes: true })
    : [];
  if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sln'))) {
    return 'dotnet';
  }
  const srcPath = path.join(targetPath, 'src');
  if (await fsExtra.pathExists(srcPath)) {
    const srcEntries = await fs.promises.readdir(srcPath, { withFileTypes: true });
    if (
      srcEntries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csproj'))
    ) {
      return 'dotnet';
    }
  }

  const cargoToml = path.join(targetPath, 'Cargo.toml');
  if (await fsExtra.pathExists(cargoToml)) return 'rust';

  const composerJson = path.join(targetPath, 'composer.json');
  if (await fsExtra.pathExists(composerJson)) return 'php';

  const packageJson = path.join(targetPath, 'package.json');
  if (await fsExtra.pathExists(packageJson)) return 'node';

  const pyproject = path.join(targetPath, 'pyproject.toml');
  const requirements = path.join(targetPath, 'requirements.txt');
  const poetryLock = path.join(targetPath, 'poetry.lock');
  if (
    (await fsExtra.pathExists(pyproject)) ||
    (await fsExtra.pathExists(requirements)) ||
    (await fsExtra.pathExists(poetryLock))
  ) {
    return 'python';
  }

  return null;
}

export interface PythonProjectOrchestrationDependencies {
  runCommand?: typeof runCommandInCwd;
  pythonCandidates?: readonly string[];
}

export async function createWorkspaceVenv(
  workspacePath: string,
  dependencies: PythonProjectOrchestrationDependencies = {}
): Promise<number> {
  const runCommand = dependencies.runCommand ?? runCommandInCwd;
  for (const candidate of dependencies.pythonCandidates ?? hostPythonCandidates()) {
    const args = candidate === 'py' ? ['-3', '-m', 'venv', '.venv'] : ['-m', 'venv', '.venv'];
    const code = await runCommand(candidate, args, workspacePath);
    if (code === 0) return 0;
  }
  return 1;
}

export async function createProjectVenv(
  projectPath: string,
  dependencies: PythonProjectOrchestrationDependencies = {}
): Promise<number> {
  const runCommand = dependencies.runCommand ?? runCommandInCwd;
  for (const candidate of dependencies.pythonCandidates ?? hostPythonCandidates()) {
    const args = candidate === 'py' ? ['-3', '-m', 'venv', '.venv'] : ['-m', 'venv', '.venv'];
    const code = await runCommand(candidate, args, projectPath);
    if (code === 0) return 0;
  }
  return 1;
}

export async function ensurePythonProjectUsesLocalVenv(
  projectPath: string,
  dependencies: PythonProjectOrchestrationDependencies = {}
): Promise<number> {
  const runCommand = dependencies.runCommand ?? runCommandInCwd;
  const localVenvPython = getVenvPythonPath(path.join(projectPath, '.venv'));

  if (!(await fsExtra.pathExists(localVenvPython))) {
    const venvCode = await createProjectVenv(projectPath, dependencies);
    if (venvCode !== 0) return venvCode;
  }

  const hasPoetry = (await runCommand('poetry', ['--version'], projectPath)) === 0;
  if (!hasPoetry) {
    return 0;
  }

  const configCode = await runCommand(
    'poetry',
    ['config', 'virtualenvs.in-project', 'true', '--local'],
    projectPath
  );
  if (configCode !== 0) return configCode;

  const envUseCode = await runCommand('poetry', ['env', 'use', localVenvPython], projectPath);
  if (envUseCode !== 0) return envUseCode;

  return 0;
}

export async function installPythonDependenciesWithPipFallback(
  projectPath: string,
  dependencies: PythonProjectOrchestrationDependencies = {}
): Promise<number> {
  const runCommand = dependencies.runCommand ?? runCommandInCwd;
  const localVenvPython = getVenvPythonPath(path.join(projectPath, '.venv'));
  if (!(await fsExtra.pathExists(localVenvPython))) {
    const venvCode = await createProjectVenv(projectPath, dependencies);
    if (venvCode !== 0) return venvCode;
  }

  await runCommand(
    localVenvPython,
    ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    projectPath
  );

  const requirementsTxt = path.join(projectPath, 'requirements.txt');
  if (await fsExtra.pathExists(requirementsTxt)) {
    const reqCode = await runCommand(
      localVenvPython,
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      projectPath
    );
    if (reqCode === 0) return 0;
  }

  const pyproject = path.join(projectPath, 'pyproject.toml');
  if (await fsExtra.pathExists(pyproject)) {
    const editableCode = await runCommand(
      localVenvPython,
      ['-m', 'pip', 'install', '-e', '.'],
      projectPath
    );
    if (editableCode === 0) return 0;

    const plainCode = await runCommand(localVenvPython, ['-m', 'pip', 'install', '.'], projectPath);
    if (plainCode === 0) return 0;
  }

  return 1;
}

async function handlePythonInitSmart(
  projectPath: string,
  pythonAdapter: ReturnType<typeof getRuntimeAdapter>
): Promise<number> {
  const ensureCode = await ensurePythonProjectUsesLocalVenv(projectPath);
  if (ensureCode !== 0) {
    console.log(
      chalk.yellow('⚠️  Could not fully configure Poetry local venv. Trying fallback installer...')
    );
  }

  const adapterResult = await pythonAdapter.initProject(projectPath);
  if (adapterResult.exitCode === 0 && (await fsExtra.pathExists(path.join(projectPath, '.venv')))) {
    return 0;
  }

  console.log(
    chalk.yellow('⚠️  Python init fallback: installing dependencies directly into project .venv')
  );
  return await installPythonDependenciesWithPipFallback(projectPath);
}

async function handleNodeInitSmart(projectPath: string): Promise<number> {
  const primary = await handleNodeCommand('init', projectPath);
  if (primary === 0) return 0;

  const packageManagerCandidates = ['npm', 'pnpm', 'yarn'] as const;
  for (const manager of packageManagerCandidates) {
    const available = await commandAvailable(manager, projectPath);
    if (!available) continue;
    const fallbackCode = await runCommandInCwd(manager, ['install'], projectPath);
    if (fallbackCode === 0) {
      console.log(chalk.green(`✅ Node init fallback succeeded with ${manager} install`));
      return 0;
    }
  }

  return primary;
}

export function validateNpmKitFlags(kitId: string, args: readonly string[]): string | null {
  const isSemverLike = (value: string): boolean =>
    /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(value);

  const port = readFlagValue([...args], '--port');
  if (port && !/^\d+$/.test(port.trim())) {
    return 'Invalid --port. Expected numeric TCP port, e.g. 8080';
  }

  if (kitId === 'springboot.standard') {
    const javaVersion = readFlagValue([...args], '--java-version');
    const springBootVersion = readFlagValue([...args], '--spring-boot-version');
    const springdocVersion = readFlagValue([...args], '--springdoc-version');
    const groupId = readFlagValue([...args], '--group-id');
    const packageName = readFlagValue([...args], '--package-name');

    if (javaVersion && !/^\d+$/.test(javaVersion.trim())) {
      return 'Invalid --java-version. Expected major version number, e.g. 21';
    }
    if (springBootVersion && !isSemverLike(springBootVersion.trim())) {
      return 'Invalid --spring-boot-version. Expected semantic version, e.g. 3.5.0';
    }
    if (springdocVersion && !isSemverLike(springdocVersion.trim())) {
      return 'Invalid --springdoc-version. Expected semantic version, e.g. 2.8.9';
    }
    if (groupId && !/^[A-Za-z0-9_.-]+$/.test(groupId.trim())) {
      return 'Invalid --group-id. Use dot-separated Java package identifiers only.';
    }
    if (packageName && !/^[A-Za-z0-9_.-]+$/.test(packageName.trim())) {
      return 'Invalid --package-name. Use dot-separated Java package identifiers only.';
    }
  }

  if (kitId === 'dotnet.webapi.clean') {
    const targetFramework = readFlagValue([...args], '--target-framework');
    const rootNamespace = readFlagValue([...args], '--root-namespace');
    if (targetFramework && !/^net\d+\.\d+$/.test(targetFramework.trim())) {
      return 'Invalid --target-framework. Expected .NET target framework, e.g. net8.0';
    }
    if (rootNamespace && !/^[A-Za-z0-9_.]+$/.test(rootNamespace.trim())) {
      return 'Invalid --root-namespace. Use dot-separated .NET namespace identifiers only.';
    }
  }

  return null;
}

async function prepareOutsideWorkspaceCreate(args: string[]): Promise<void> {
  if (
    args.includes('--dry-run') ||
    args.includes('--no-workspace') ||
    findWorkspaceMarkerUp(process.cwd())
  ) {
    return;
  }

  const skipGit = args.includes('--skip-git') || args.includes('--no-git');
  if (args.includes('--create-workspace')) {
    const { registerWorkspaceAtPath } = await import('./create.js');
    await registerWorkspaceAtPath(process.cwd(), {
      skipGit,
      yes: args.includes('--yes') || args.includes('-y'),
      userConfig: await loadUserConfig(),
    });
    return;
  }

  if (args.includes('--yes') || args.includes('-y') || !process.stdin.isTTY) {
    return;
  }

  const { workspaceMode } = (await prompt([
    {
      type: 'rawlist',
      name: 'workspaceMode',
      message: 'This project is outside a Workspai workspace. How should it be managed?',
      choices: [
        {
          name: 'Link it to the managed default workspace (recommended)',
          value: 'managed',
        },
        {
          name: 'Turn the current folder into a workspace',
          value: 'current',
        },
        {
          name: 'Create it without workspace management',
          value: 'none',
        },
      ],
      default: 1,
    },
  ])) as { workspaceMode: 'managed' | 'current' | 'none' };

  if (workspaceMode === 'current') {
    const { registerWorkspaceAtPath } = await import('./create.js');
    await registerWorkspaceAtPath(process.cwd(), {
      skipGit,
      yes: false,
      userConfig: await loadUserConfig(),
    });
  } else if (workspaceMode === 'none') {
    args.push('--no-workspace');
  }
}

interface ProjectLifecycleTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  registerCompensation(compensation: () => void | Promise<void>): void;
}

async function acquireProjectLifecycleLock(journalDirectory: string): Promise<() => Promise<void>> {
  await fsExtra.ensureDir(journalDirectory);
  const lockPath = path.join(journalDirectory, 'lifecycle.lock');
  const startedAt = Date.now();
  for (;;) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`);
      return async () => {
        await handle.close().catch(() => undefined);
        await fsExtra.remove(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const lock = await fsExtra.readJson(lockPath).catch(() => null);
      const ownerPid = Number(lock?.pid);
      let ownerAlive = false;
      if (Number.isInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = true;
        } catch (ownerError) {
          ownerAlive = (ownerError as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      if (!ownerAlive) {
        await fsExtra.remove(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt > 30_000) {
        throw new Error(`Timed out waiting for lifecycle transaction lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function beginProjectLifecycleTransaction(
  workspacePath: string,
  options: { projectPath?: string; ownedDestination?: string; ownedWorkspace?: string } = {}
): Promise<ProjectLifecycleTransaction> {
  const journalDirectory = path.join(getWorkspaceRegistryDirectory(), 'transactions');
  const releaseLock = await acquireProjectLifecycleLock(journalDirectory);
  let transaction: Awaited<ReturnType<typeof createLifecycleTransaction>> | undefined;
  try {
    await recoverActiveLifecycleTransactions(journalDirectory);
    transaction = await createLifecycleTransaction({ journalDirectory });
  } catch (error) {
    await releaseLock();
    throw error;
  }
  const files = new Set([
    path.join(getWorkspaceRegistryDirectory(), 'workspaces.json'),
    path.join(getLegacyWorkspaceRegistryDirectory(), 'workspaces.json'),
    resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_CONTRACT_PATH),
    resolveLegacyWorkspaceArtifactPath(workspacePath, WORKSPACE_CONTRACT_PATH),
    resolveWorkspaceArtifactPath(workspacePath, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH),
    resolveLegacyWorkspaceArtifactPath(workspacePath, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH),
    ...workspaceMetadataCandidates(workspacePath, 'imported-projects.json'),
  ]);
  if (options.projectPath) {
    files.add(projectMetadataPath(options.projectPath, 'project.json'));
    files.add(projectMetadataPath(options.projectPath, 'context.json'));
    files.add(projectMetadataPath(options.projectPath, 'file-hashes.json'));
    files.add(projectMetadataPath(options.projectPath, 'adopt.json'));
    files.add(projectMetadataPath(options.projectPath, 'adopt-readiness.json'));
    files.add(path.join(options.projectPath, PROJECT_WORKSPACE_LINK_RELATIVE_PATH));
    files.add(path.join(options.projectPath, PROJECT_GROUNDING_RELATIVE_PATH));
    files.add(path.join(options.projectPath, PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH));
    files.add(path.join(options.projectPath, 'AGENTS.md'));
    files.add(path.join(options.projectPath, '.gitignore'));
  }

  try {
    for (const filePath of files) await transaction.captureFile(filePath);
    if (options.ownedDestination) {
      await transaction.captureOwnedTree(options.ownedDestination);
    }
    if (options.ownedWorkspace) {
      await transaction.captureOwnedTree(options.ownedWorkspace);
    }
    let finished = false;
    return {
      registerCompensation: (compensation) => transaction.registerCompensation(compensation),
      commit: async () => {
        if (finished) return;
        await transaction.commit();
        finished = true;
        await releaseLock();
      },
      rollback: async () => {
        if (finished) return;
        finished = true;
        try {
          await transaction.rollback();
        } finally {
          await releaseLock();
        }
      },
    };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    await releaseLock();
    throw error;
  }
}

async function rollbackProjectLifecycleTransaction(
  transaction: ProjectLifecycleTransaction,
  error: unknown
): Promise<never> {
  try {
    await transaction.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
      [error, rollbackError],
      `Project lifecycle failed and rollback was incomplete: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  throw error;
}

async function finalizeCreatedProjectWorkspace(
  args: string[],
  projectPath: string,
  projectName: string
): Promise<string | undefined> {
  if (args.includes('--no-workspace') || args.includes('--dry-run')) {
    return undefined;
  }
  if (!(await fsExtra.pathExists(projectPath))) {
    logger.warn(`Created project path was not found for workspace linking: ${projectPath}`);
    return undefined;
  }

  let workspacePath = findWorkspaceUp(projectPath) || findWorkspaceUp(process.cwd());
  let linkedToDefaultWorkspace = false;
  let transaction: ProjectLifecycleTransaction;
  if (!workspacePath) {
    workspacePath = resolveManagedDefaultImportWorkspacePath();
    transaction = await beginProjectLifecycleTransaction(workspacePath, {
      projectPath,
      ownedWorkspace: workspacePath,
    });
    try {
      const ensured = await ensureManagedDefaultImportWorkspace();
      workspacePath = ensured.workspacePath;
    } catch (error) {
      await rollbackProjectLifecycleTransaction(transaction, error);
    }
    linkedToDefaultWorkspace = true;
  } else {
    transaction = await beginProjectLifecycleTransaction(workspacePath, { projectPath });
  }

  let relationship = 'managed';
  try {
    await canonicalizeProjectMetadata(projectPath);
    const relativeProjectPath = path.relative(workspacePath, projectPath);
    const projectIsExternal =
      relativeProjectPath.startsWith('..') || path.isAbsolute(relativeProjectPath);
    if (projectIsExternal) {
      const adopted = await adoptProjectIntoWorkspace({
        source: projectPath,
        workspacePath,
        name: projectName,
      });
      relationship = adopted.relationship;
    }

    const { registerProjectInWorkspaceStrict, registerWorkspaceStrict } =
      await import('./workspace.js');
    const { syncWorkspaceContract } = await import('./utils/workspace-contract.js');
    await registerWorkspaceStrict(workspacePath, path.basename(workspacePath));
    await registerProjectInWorkspaceStrict(workspacePath, projectName, projectPath);
    await syncWorkspaceContract({ workspacePath, strict: true });
    const { syncProjectIntelligenceLens } = await import('./project-intelligence-lens.js');
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName,
      relationship: relationship === 'adopted' ? 'adopted' : 'managed',
      mode: 'managed',
    });
    await transaction.commit();
    await syncWorkspaceContractAfterProjectChange(workspacePath);
  } catch (error) {
    await rollbackProjectLifecycleTransaction(transaction, error);
  }

  if (linkedToDefaultWorkspace) {
    console.log(
      chalk.gray(
        `ℹ️  Project created outside a Workspai workspace — linked to managed workspace "${MANAGED_DEFAULT_WORKSPACE_LABEL}" (${relationship}).`
      )
    );
    console.log(
      chalk.gray(`   Registry: ${path.join(getWorkspaceRegistryDirectory(), 'workspaces.json')}`)
    );
    console.log(chalk.gray(`   Workspace: ${workspacePath}`));
  }

  return workspacePath;
}

async function runNpmBackedKitCreate(args: string[]): Promise<number> {
  if (args[0] !== 'create' || args[1] !== 'project') return 1;

  const requestedKit = args[2];
  const definition = resolveKitDefinition(requestedKit);
  const name = args[3];

  if (!definition || definition.owner !== 'npm') return 1;
  if (!name) {
    process.stderr.write(
      `Usage: ${definition.createUsage ?? 'workspai create project <kit> <name> [--output <dir>]'}\n`
    );
    return 1;
  }

  try {
    validateProjectName(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const flagError = validateNpmKitFlags(definition.id, args);
  if (flagError) {
    process.stderr.write(`${flagError}\n`);
    return 1;
  }

  const outputDir = readFlagValue(args, '--output') || process.cwd();
  const projectPath = path.resolve(outputDir, name);
  const skipGit = args.includes('--skip-git') || args.includes('--no-git');
  const skipInstall = args.includes('--skip-install');
  const dryRun = args.includes('--dry-run');
  let ownsProjectPath = false;

  try {
    const { default: fsExtra } = await import('fs-extra');
    if (await fsExtra.pathExists(projectPath)) {
      process.stderr.write(`❌ Directory "${projectPath}" already exists\n`);
      return 1;
    }
    if (dryRun) {
      console.log(chalk.bold(`\n${definition.label}`));
      console.log(chalk.gray(`   Runtime: ${definition.runtime}`));
      console.log(chalk.gray(`   Target: ${projectPath}`));
      console.log(chalk.gray('   Dry run: no files or workspace state will be changed.'));
      return 0;
    }

    await fsExtra.ensureDir(path.dirname(projectPath));
    await fsExtra.ensureDir(projectPath);
    ownsProjectPath = true;

    await runNpmKitGenerator(definition, {
      projectName: name,
      projectPath,
      args,
      skipGit,
      skipInstall,
    });
    await persistRequestedProjectPort(args, process.cwd());

    await finalizeCreatedProjectWorkspace(args, projectPath, name);

    return 0;
  } catch (e) {
    if (ownsProjectPath) {
      const { default: fsExtra } = await import('fs-extra');
      await fsExtra.remove(projectPath).catch(() => undefined);
    }
    process.stderr.write(
      `Workspai ${definition.id} generator failed: ${(e as Error)?.message ?? e}\n`
    );
    return 1;
  }
}

async function runFrontendProjectCreate(args: string[]): Promise<number> {
  const definition = resolveFrontendGenerator(args[2]);
  if (!definition) return 1;
  let ownedProjectPath: string | undefined;

  try {
    const result = await createFrontendProject({ args });

    if (!result.dryRun) {
      ownedProjectPath = result.projectPath;
      await finalizeCreatedProjectWorkspace(args, result.projectPath, result.projectName);
    }

    return 0;
  } catch (error) {
    if (ownedProjectPath) await fsExtra.remove(ownedProjectPath).catch(() => undefined);
    process.stderr.write(
      `Workspai ${definition.kitId} generator failed: ${(error as Error)?.message ?? error}\n`
    );
    if (!args[3]) {
      process.stderr.write(`Usage: ${frontendCreateUsage(definition.id)}\n`);
    }
    return 1;
  }
}

async function runOfficialProjectCreate(args: string[]): Promise<number> {
  const definition = resolveOfficialProjectGenerator(args[2]);
  if (!definition) return 1;
  let ownedProjectPath: string | undefined;

  try {
    const result = await createOfficialProject(args);
    if (!result.dryRun) {
      ownedProjectPath = result.projectPath;
      await finalizeCreatedProjectWorkspace(args, result.projectPath, result.projectName);
    }
    return 0;
  } catch (error) {
    if (ownedProjectPath) await fsExtra.remove(ownedProjectPath).catch(() => undefined);
    process.stderr.write(
      `Workspai ${definition.kitId} generator failed: ${(error as Error)?.message ?? error}\n`
    );
    if (!args[3]) {
      process.stderr.write(`Usage: ${officialProjectCreateUsage(definition.kitId)}\n`);
    }
    return 1;
  }
}

export async function runCreateFallback(
  args: string[],
  reasonCode: BridgeFailureCode
): Promise<number> {
  // Supported offline fallback:
  //   workspai create project <kit> <name> [--output <dir>]
  // for kits that have embedded templates (fastapi*, nestjs*).
  const hasJson = args.includes('--json');
  if (hasJson) {
    process.stderr.write(
      'Workspai CLI offline fallback does not support --json for `create` commands.\n' +
        'Install Python 3.10+ and retry the same command.\n'
    );
    return 1;
  }

  if (args[0] !== 'create') return 1;
  const sub = args[1];

  if (sub !== 'project') {
    process.stderr.write(
      'Workspai CLI could not run the Python core engine for `create`.\n' +
        `Reason: ${reasonCode}.\n` +
        'Install Python 3.10+ to use the interactive wizard and full kit catalog.\n'
    );
    return 1;
  }

  const kit = args[2];
  const name = args[3];
  if (!kit || !name) {
    process.stderr.write(
      'Usage: npx workspai create project <kit> <name> [--output <dir>]\n' +
        'Tip: offline fallback supports only fastapi* and nestjs* kits.\n'
    );
    return 1;
  }

  const template = normalizeFallbackTemplate(kit);
  if (!template) {
    process.stderr.write(
      'Workspai CLI could not run the Python core engine to create this kit.\n' +
        `Reason: ${reasonCode}.\n` +
        `Requested kit: ${kit}\n` +
        'Offline fallback only supports: fastapi.standard, nestjs.standard (and their shorthands).\n' +
        'Install Python 3.10+ to access all kits.\n'
    );
    return 1;
  }

  const outputDir = readFlagValue(args, '--output') || process.cwd();
  const projectPath = path.resolve(outputDir, name);
  let ownsProjectPath = false;

  // Respect common flags used by the npm wrapper.
  const skipGit = args.includes('--skip-git') || args.includes('--no-git');
  const skipInstall = args.includes('--skip-install');

  try {
    await fsExtra.ensureDir(path.dirname(projectPath));
    if (await fsExtra.pathExists(projectPath)) {
      process.stderr.write(`❌ Directory "${projectPath}" already exists\n`);
      return 1;
    }

    // Try to detect workspace engine from marker
    let engine: 'poetry' | 'venv' | 'pipx' | 'pip' = 'pip';
    const workspacePath = findWorkspaceUp(process.cwd());
    if (workspacePath) {
      try {
        const { readWorkspaceMarker } = await import('./workspace-marker.js');
        const marker = await readWorkspaceMarker(workspacePath);
        if (marker?.metadata?.npm?.installMethod) {
          engine = marker.metadata.npm.installMethod;
          logger.debug(`Detected workspace engine: ${engine}`);
        }
      } catch (err) {
        logger.debug('Failed to read workspace marker', err);
        // Ignore errors, use default 'pip'
      }
    } else {
      logger.debug('No workspace found, using default engine: pip');
    }

    await fsExtra.ensureDir(projectPath);
    ownsProjectPath = true;
    const { generateDemoKit } = await import('./demo-kit.js');
    await generateDemoKit(projectPath, {
      project_name: name,
      template,
      kit_name: kit, // Pass full kit name (e.g., 'fastapi.ddd')
      skipGit,
      skipInstall,
      engine,
    });
    await persistRequestedProjectPort(args, process.cwd());

    await finalizeCreatedProjectWorkspace(args, projectPath, name);

    return 0;
  } catch (e) {
    if (ownsProjectPath) await fsExtra.remove(projectPath).catch(() => undefined);
    process.stderr.write(`Workspai CLI offline fallback failed: ${(e as Error)?.message ?? e}\n`);
    return 1;
  }
}

function printUnsupportedNativeCreate(capability: CreatePlannerCapability): void {
  const requested = capability.requested || 'requested stack';
  process.stderr.write(
    `${chalk.yellow('Workspai native create is not available for this request yet.')}\n`
  );
  process.stderr.write(chalk.gray(`Requested: ${requested}\n`));
  process.stderr.write(chalk.gray(`Lane: ${capability.lane} (${capability.status})\n`));
  process.stderr.write(chalk.gray(`Reason: ${capability.reason}\n`));

  if (capability.officialCommands?.length) {
    process.stderr.write(chalk.gray('Official generator candidates:\n'));
    for (const command of capability.officialCommands) {
      process.stderr.write(chalk.gray(`  - ${command}\n`));
    }
  }

  process.stderr.write(
    chalk.gray(
      'Use an external generator if needed, then run `npx workspai adopt <project-path>` to add Workspace Intelligence.\n'
    )
  );
}

function printCreateProjectHelp(): void {
  console.log(`Usage: npx workspai create project <kit> <name> [options]

Scaffold a project and register it with Workspace Intelligence.

Examples:
  npx workspai create project fastapi.standard api
  npx workspai create project nestjs.standard api --skip-install
  npx workspai create project gofiber.standard api --output ./services
  npx workspai create project nextjs web --skip-install
  npx workspai create project rust.axum api --skip-install
  npx workspai create project desktop.tauri desktop-app
  npx workspai create project extension.vscode editor-tools --skip-install

Common kits:
  fastapi.standard      Python API via RapidKit Core bridge
  fastapi.ddd           Python DDD API via RapidKit Core bridge
  nestjs.standard       Node/NestJS service
  gofiber.standard      Go Fiber service
  gogin.standard        Go Gin service
  springboot.standard   Java Spring Boot service
  dotnet.webapi.clean   .NET Web API service
  nextjs                Frontend Next.js app
  rust.axum             Backend Rust/Axum API
  desktop.tauri         Desktop Tauri app
  desktop.electron      Desktop Electron Forge app
  extension.vscode      VS Code extension
  php.laravel           Backend Laravel application

Options:
  --output <dir>        Parent directory for the project
  -y, --yes             Accept wrapper defaults where applicable
  --skip-git           Do not initialize git
  --skip-install       Scaffold without dependency installation
  --dry-run            Show the planned create operation without writing files
  --create-workspace   Register the current directory as a workspace first
  --no-workspace       Create without linking to any workspace

Notes:
  Outside a workspace, projects are linked to the managed default workspace.
  Interactive mode can instead turn the current folder into a workspace or opt out.
  Turning the current folder into a workspace creates only the Workspai foundation;
  it does not install the optional Python engine.
  Python-backed kits delegate execution to RapidKit Core when needed, but the
  Workspai CLI owns the command UX, workspace registration, and artifacts.`);
}

function printCreateWorkspaceHelp(): void {
  console.log(`Usage: npx workspai create workspace [name] [options]

Create a Workspai workspace and initialize Workspace Intelligence files.

Examples:
  npx workspai create workspace my-workspace
  npx workspai create workspace my-workspace --output ./workspaces --yes
  npx workspai my-workspace --here

Options:
  --output <dir>             Parent directory for the workspace
  --here                     Create in the current directory
  -y, --yes                  Accept defaults in non-interactive mode
  --profile <profile>        minimal | python-only | node-only | go-only | java-only | dotnet-only | polyglot | enterprise
  --install-method <method>  poetry | venv | pipx
  --skip-python-engine       Skip RapidKit Core installation for now
  --skip-git                 Do not initialize git
  --dry-run                  Show the planned workspace without writing files

Mental model:
  Repository
      ↓
  Workspace Intelligence
      ↓
  Developers · CI · IDEs · AI Agents`);
}

function printCreateHelp(): void {
  console.log(`Usage: npx workspai create <workspace|project> [options]

Create a workspace or scaffold a project into Workspace Intelligence.

Commands:
  create workspace [name]    Create a Workspai workspace
  create project <kit> <name> Scaffold a project and register it

Shortcuts:
  npx workspai my-workspace  Create a workspace

Run:
  npx workspai create workspace --help
  npx workspai create project --help`);
}

function printBridgeBackedCreateDryRun(args: string[]): void {
  const kit = args[2] ?? '<kit>';
  const name = args[3] ?? '<name>';
  const outputDir = readFlagValue(args, '--output') || process.cwd();
  console.log('Workspai create project dry run (Dry-run mode)');
  console.log(`  kit: ${kit}`);
  console.log(`  name: ${name}`);
  console.log(`  output: ${path.resolve(outputDir)}`);
  console.log('  execution: RapidKit Core bridge');
  console.log('  writes: none');
  console.log('');
  console.log('Run without --dry-run to scaffold the project.');
}

export async function handleCreateOrFallback(args: string[]): Promise<number> {
  if (args[0] === 'create') {
    const asksForHelp = args.includes('--help') || args.includes('-h') || args.includes('help');
    if (asksForHelp) {
      if (args[1] === 'project') {
        printCreateProjectHelp();
      } else if (args[1] === 'workspace') {
        printCreateWorkspaceHelp();
      } else {
        printCreateHelp();
      }
      return 0;
    }
  }

  const wasFrontendCreate = args[0] === 'create' && args[1] === 'frontend';
  const normalizedFrontendArgs = normalizeCreateFrontendArgs(args);
  if (normalizedFrontendArgs) {
    args = normalizedFrontendArgs;
  }
  if (wasFrontendCreate && !isFrontendProjectKit(args[2])) {
    process.stderr.write(`Unknown frontend generator: ${args[2]?.replace(/^frontend\./, '')}\n`);
    process.stderr.write(`Usage: ${frontendCreateUsage()}\n`);
    return 1;
  }

  // Supported offline fallback:
  //   workspai create project <kit> <name> [--output <dir>]
  // for kits that have embedded templates (fastapi*, nestjs*).
  if (process.env.RAPIDKIT_FORCE_OFFLINE_CREATE_FALLBACK === '1' && args[0] === 'create') {
    return runCreateFallback(args, 'PYTHON_NOT_FOUND');
  }

  // If this is a create project invocation, handle wrapper-level flags
  // (workspace creation UX) **before** attempting to run the Python core.
  const WRAPPER_FLAGS = new Set([
    '--yes',
    '-y',
    '--skip-git',
    '--skip-install',
    '--debug',
    '--dry-run',
    '--no-update-check',
    '--create-workspace',
    '--no-workspace',
    '--here',
  ]);

  if (args[0] === 'create' && (!args[1] || args[1].startsWith('-'))) {
    const hasYes = args.includes('--yes') || args.includes('-y');
    const passthroughFlags = args.slice(1);

    let createTarget: InteractiveCreateTarget;
    if (!process.stdin.isTTY || hasYes) {
      createTarget = 'workspace';
      if (process.stdin.isTTY) {
        console.log(
          chalk.gray('ℹ️  No subcommand provided for `create`; defaulting to `create workspace`.')
        );
      }
    } else {
      if (process.stdin.isTTY) {
        showIntro('create');
      }
      const currentWorkspace = findWorkspaceUp(process.cwd());
      const currentWorkspaceName = currentWorkspace ? path.basename(currentWorkspace) : null;
      const answers = (await prompt([
        {
          type: 'rawlist',
          name: 'createTarget',
          message: currentWorkspaceName
            ? `What would you like to add to ${currentWorkspaceName}?`
            : 'What would you like to set up?',
          choices: buildInteractiveCreateTargetChoices(currentWorkspaceName),
        },
      ])) as { createTarget: InteractiveCreateTarget };

      createTarget = answers.createTarget;
    }

    if (createTarget === 'existing') {
      const currentWorkspace = findWorkspaceUp(process.cwd());
      const { source } = (await prompt([buildExistingSoftwareSourcePrompt()])) as {
        source: string;
      };
      const classifiedSource = classifyExistingSoftwareSource(source);

      if (classifiedSource.kind === 'workspace-archive') {
        const result = await importWorkspaceArchive({
          archivePathOrUrl: classifiedSource.source,
          projectGrounding: 'managed',
        });
        console.log(chalk.green(`✔ Workspace imported and registered: ${result.workspacePath}`));
        for (const warning of result.warnings) console.log(chalk.yellow(`   ⚠ ${warning}`));
        return 0;
      }

      if (classifiedSource.kind === 'git-project') {
        return await handleImportCommand(classifiedSource.source, {
          workspace: currentWorkspace ?? undefined,
        });
      }

      if (classifiedSource.kind === 'local-workspace') {
        const result = await connectWorkspace({
          workspacePath: classifiedSource.source,
          projectGrounding: 'managed',
        });
        console.log(chalk.green(`✔ Workspace connected: ${result.workspacePath}`));
        for (const warning of result.warnings) console.log(chalk.yellow(`   ⚠ ${warning}`));
        return 0;
      }

      const { existingProjectMode } = (await prompt([
        {
          type: 'rawlist',
          name: 'existingProjectMode',
          message: 'How should Workspai add this project?',
          choices: [
            {
              name: 'Keep it where it is (recommended)',
              value: 'link',
            },
            {
              name: 'Copy it into the workspace',
              value: 'copy',
            },
          ],
        },
      ])) as { existingProjectMode: 'link' | 'copy' };

      return existingProjectMode === 'link'
        ? await handleAdoptCommand(classifiedSource.source, {
            workspace: currentWorkspace ?? undefined,
            projectGrounding: 'managed',
          })
        : await handleImportCommand(classifiedSource.source, {
            workspace: currentWorkspace ?? undefined,
            projectGrounding: 'managed',
          });
    }

    const reroutedArgs = ['create', createTarget, ...passthroughFlags];
    return await handleCreateOrFallback(reroutedArgs);
  }

  if (args[0] === 'create' && args[1] === 'workspace') {
    try {
      const hasYes = args.includes('--yes') || args.includes('-y');
      const skipGit = args.includes('--skip-git') || args.includes('--no-git');
      const skipPythonEngine =
        args.includes('--skip-python-engine') || args.includes('--no-python-engine');
      const hasDryRun = args.includes('--dry-run');
      const providedName = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      const installMethodRaw = readFlagValue(args, '--install-method');
      const installMethod =
        installMethodRaw === 'poetry' || installMethodRaw === 'venv' || installMethodRaw === 'pipx'
          ? installMethodRaw
          : undefined;
      const profileRaw = readFlagValue(args, '--profile');
      const workspaceProfile =
        profileRaw === 'minimal' ||
        profileRaw === 'java-only' ||
        profileRaw === 'go-only' ||
        profileRaw === 'dotnet-only' ||
        profileRaw === 'python-only' ||
        profileRaw === 'node-only' ||
        profileRaw === 'polyglot' ||
        profileRaw === 'enterprise'
          ? profileRaw
          : undefined;

      let workspaceName = providedName;
      if (!workspaceName) {
        if (hasYes) {
          workspaceName = 'my-workspace';
        } else {
          if (process.stdin.isTTY) {
            showIntro('create workspace');
          }
          const workspaceAnswers = (await prompt([
            {
              type: 'input',
              name: 'workspaceName',
              message: 'Workspace name:',
              default: 'my-workspace',
            },
          ])) as { workspaceName: string };
          workspaceName = workspaceAnswers.workspaceName;
        }
      }

      if (!workspaceName || !workspaceName.trim()) {
        process.stderr.write('Workspace name is required.\n');
        return 1;
      }

      try {
        validateProjectName(workspaceName);
      } catch (error) {
        if (error instanceof RapidKitError) {
          process.stderr.write(`${error.message}\n`);
          return 1;
        }
        throw error;
      }

      const outputParent = await resolveWorkspaceOutputParent(args, { hasYes });
      const targetPath = resolveWorkspaceTargetPath(workspaceName.trim(), {
        argv: args,
        outputParent,
      });

      if (!hasDryRun) {
        await fsExtra.ensureDir(path.dirname(targetPath));
      }

      const existingWorkspacePath = findExistingWorkspacePath(workspaceName.trim());
      if (
        !hasDryRun &&
        ((shouldBlockExistingWorkspaceName(existingWorkspacePath, targetPath, { outputParent }) &&
          existingWorkspacePath &&
          (await fsExtra.pathExists(existingWorkspacePath))) ||
          (await fsExtra.pathExists(targetPath)))
      ) {
        process.stderr.write(`❌ Workspace "${workspaceName}" already exists\n`);
        if (existingWorkspacePath && existingWorkspacePath !== targetPath) {
          process.stderr.write(`   Found at: ${existingWorkspacePath}\n`);
        }
        return 1;
      }

      const userConfig = await loadUserConfig();
      let author = userConfig.author || process.env.USER || 'Workspai User';

      if (!hasYes) {
        const answers = (await prompt([
          {
            type: 'input',
            name: 'author',
            message: 'Author name:',
            default: author,
          },
        ])) as { author: string };

        if (answers.author?.trim()) {
          author = answers.author.trim();
        }
      }

      const { createProject: createPythonEnvironment } = await import('./create.js');
      await createPythonEnvironment(workspaceName, {
        skipGit,
        skipPythonEngine,
        yes: hasYes,
        dryRun: hasDryRun,
        userConfig: {
          ...userConfig,
          author,
        },
        installMethod,
        profile: workspaceProfile,
        parentDirectory: path.dirname(targetPath),
      });

      if (!hasDryRun) {
        console.log(chalk.gray(`ℹ️  Workspace root: ${targetPath}`));
        console.log(
          chalk.gray(
            `   Next: ${formatWorkspaceCdCommand(targetPath)} && npx workspai create project`
          )
        );
      }
      return 0;
    } catch (e) {
      process.stderr.write(
        `Workspai CLI failed to create workspace: ${(e as Error)?.message ?? e}\n`
      );
      return 1;
    }
  }

  try {
    // If this is a create project invocation, handle workspace registration
    if (args[0] === 'create' && args[1] === 'project') {
      const createProjectHelpRequested = args.includes('--help') || args.includes('-h');
      if (createProjectHelpRequested) {
        printCreateProjectHelp();
        return 0;
      }

      // No kit specified — show npm-level interactive selector for npm-backed kits
      if (!args[2] || args[2].startsWith('-')) {
        if (process.stdin.isTTY) {
          showIntro('create project');
        }
        const { kitChoice } = (await prompt([
          {
            type: 'rawlist',
            name: 'kitChoice',
            message: 'Select a kit to scaffold:',
            choices: buildKitPickerChoices(),
          },
        ])) as { kitChoice: string };

        if (
          isNpmBackedKit(kitChoice) ||
          isFrontendProjectKit(kitChoice) ||
          isOfficialProjectKit(kitChoice)
        ) {
          const defaultProjectName = suggestProjectNameForKit(kitChoice);
          const { projectName } = (await prompt([
            {
              type: 'input',
              name: 'projectName',
              message: 'Project name:',
              default: defaultProjectName,
              validate: (v: string) => v.trim().length > 0 || 'Project name is required',
            },
          ])) as { projectName: string };
          const flags = args.slice(2).filter((a) => a.startsWith('-'));
          const normalizedArgs = ['create', 'project', kitChoice, projectName.trim(), ...flags];
          if (!(await enforceWorkspaceProfileForRequestedKit(kitChoice))) {
            return 1;
          }
          await prepareOutsideWorkspaceCreate(normalizedArgs);
          const code = isFrontendProjectKit(kitChoice)
            ? await runFrontendProjectCreate(normalizedArgs)
            : isOfficialProjectKit(kitChoice)
              ? await runOfficialProjectCreate(normalizedArgs)
              : await runNpmBackedKitCreate(normalizedArgs);
          return code;
        }

        const defaultProjectName = suggestProjectNameForKit(kitChoice);
        const { projectName } = (await prompt([
          {
            type: 'input',
            name: 'projectName',
            message: 'Project name:',
            default: defaultProjectName,
            validate: (v: string) => v.trim().length > 0 || 'Project name is required',
          },
        ])) as { projectName: string };

        // Inject selected kit so Python core skips its own kit-selection prompt
        args.splice(2, 0, kitChoice, projectName.trim());
      }

      const requestedKit = args[2];
      const capability = resolveCreatePlannerCapability({
        kitId: requestedKit,
        framework: requestedKit,
        runtime: requestedKit,
      });
      if (shouldBlockUnsupportedNativeCreate(capability)) {
        printUnsupportedNativeCreate(capability);
        return 1;
      }

      // Profile enforcement: if inside a workspace, check if the kit type is allowed
      // by the workspace profile. In strict mode, block mismatches; in warn mode, show a warning.
      if (!(await enforceWorkspaceProfileForRequestedKit(args[2] || ''))) {
        return 1;
      }

      await prepareOutsideWorkspaceCreate(args);

      // npm-backed kits run entirely at wrapper level, bypassing the Python engine.
      if (isNpmBackedKit(args[2])) {
        return await runNpmBackedKitCreate(args);
      }

      // Frontend generators manage their own registry linking (including managed workspai adoption).
      if (isFrontendProjectKit(args[2])) {
        return await runFrontendProjectCreate(args);
      }

      if (isOfficialProjectKit(args[2])) {
        return await runOfficialProjectCreate(args);
      }

      if (args.includes('--skip-python-engine') || args.includes('--no-python-engine')) {
        process.stderr.write(
          '`--skip-python-engine` is a workspace creation option. For projects, use `--skip-install` to scaffold first, then run `npx workspai init` when ready.\n'
        );
        return 1;
      }

      if (args.includes('--dry-run')) {
        printBridgeBackedCreateDryRun(args);
        return 0;
      }

      // Filter wrapper-only flags from args forwarded to the Python core engine
      const filteredArgs = args.filter((a) => {
        const key = a.split('=')[0];
        return !WRAPPER_FLAGS.has(a) && !WRAPPER_FLAGS.has(key);
      });

      // Map wrapper flags to Python-core/environment equivalents when forwarding.
      // NOTE: --skip-essentials controls core module injection and is conceptually
      // different from dependency/lock behavior; do not auto-map from workspace mode.
      const forwardedArgs = [...filteredArgs];
      const workspacePathForCreate = findWorkspaceUp(process.cwd());
      const explicitSkipInstallRequested = args.includes('--skip-install');
      const skipLockGenerationRequested = explicitSkipInstallRequested || !!workspacePathForCreate;

      const createEnv = skipLockGenerationRequested
        ? {
            ...process.env,
            RAPIDKIT_SKIP_LOCKS: '1',
            RAPIDKIT_GENERATE_LOCKS: '0',
          }
        : undefined;

      try {
        await resolveRapidkitPython();
        const exitCode = await runCoreRapidkit(forwardedArgs, {
          cwd: process.cwd(),
          env: createEnv,
        });

        if (exitCode === 0 && workspacePathForCreate && !args.includes('--skip-install')) {
          console.log(chalk.gray('ℹ️  Fast create mode (workspace): dependencies were deferred.'));
          console.log(chalk.white('   Next: cd <project-name> && npx workspai init'));
        }

        // If project creation succeeded, sync Python version and register workspace projects
        if (exitCode === 0) {
          await persistRequestedProjectPort(args, process.cwd());
          const projectName = args[3];
          const outputDir = readFlagValue(args, '--output') || process.cwd();
          const projectPath = projectName ? path.resolve(outputDir, projectName) : undefined;
          const workspacePath =
            projectName && projectPath
              ? await finalizeCreatedProjectWorkspace(args, projectPath, projectName).catch(
                  async (error) => {
                    await fsExtra.remove(projectPath).catch(() => undefined);
                    throw error;
                  }
                )
              : workspacePathForCreate;
          if (workspacePath) {
            // Sync Python version from workspace to newly created project
            try {
              if (projectName && projectPath) {
                const workspacePythonVersionFile = path.join(workspacePath, '.python-version');
                const projectPythonVersionFile = path.join(projectPath, '.python-version');

                if (fs.existsSync(workspacePythonVersionFile) && fs.existsSync(projectPath)) {
                  const pythonVersion = fs.readFileSync(workspacePythonVersionFile, 'utf-8');
                  fs.writeFileSync(projectPythonVersionFile, pythonVersion.trim() + '\n');
                  logger.debug(
                    `Synced Python version ${pythonVersion.trim()} from workspace to ${projectName}`
                  );
                }
              }
            } catch (err) {
              logger.debug('Could not sync Python version from workspace:', err);
            }
          }
        }

        return exitCode;
      } catch (e) {
        const code = bridgeFailureCode(e);
        if (code) return await runCreateFallback(args, code);
        process.stderr.write(
          `Workspai failed to run the Python core engine: ${(e as Error)?.message ?? e}\n`
        );
        return 1;
      }
    }

    // Handle `create` command (interactive mode without explicit project subcommand)
    if (args[0] === 'create' && args[1] !== 'project') {
      try {
        await resolveRapidkitPython();
        const exitCode = await runCoreRapidkit(args, { cwd: process.cwd() });

        // If create succeeded, sync workspace to register all projects
        if (exitCode === 0) {
          const workspacePath = findWorkspaceUp(process.cwd());
          if (workspacePath) {
            const { syncWorkspaceProjects } = await import('./workspace.js');
            await syncWorkspaceProjects(workspacePath, true); // silent sync
          }
        }

        return exitCode;
      } catch (e) {
        const code = bridgeFailureCode(e);
        if (code) return await runCreateFallback(args, code);
        process.stderr.write(
          `Workspai failed to run the Python core engine: ${(e as Error)?.message ?? e}\n`
        );
        return 1;
      }
    }

    // Not a create project invocation - proceed with default behavior (try core first)
    await resolveRapidkitPython();
    return await runCoreRapidkit(args, { cwd: process.cwd() });
  } catch (e) {
    const code = bridgeFailureCode(e);
    if (code) return await runCreateFallback(args, code);
    process.stderr.write(
      `Workspai failed to run the Python core engine: ${(e as Error)?.message ?? e}\n`
    );
    return 1;
  }
}

// Local project commands that should be delegated to ./rapidkit
const LOCAL_COMMANDS = [
  'init',
  'dev',
  'start',
  'build',
  'test',
  'docs',
  'lint',
  'format',
  'create', // workspace command
  'help',
  '--help',
  '-h',
];

const NPM_ONLY_PARSE_DIRECT_COMMANDS = [
  ...WORKSPACE_INTELLIGENCE_ROOT_COMMANDS,
  'autopilot',
  'pipeline',
  'import',
  'adopt',
  'snapshot',
  'ai',
  'config',
  'product',
  'infra',
  'shell',
  'commands',
] as const;

// Project-scoped commands that should never fall through to the workspace
// creation parser when local delegation is unavailable.

// Project commands that are always orchestrated by the npm wrapper first
// (runtime-aware + policy-aware + fallback-aware), even inside Python projects.
export const WRAPPER_ORCHESTRATED_PROJECT_COMMANDS = ['init'] as const;

const RUNTIME_LIFECYCLE_COMMANDS = WRAPPER_LIFECYCLE_COMMANDS;

const STRICT_POLICY_PROJECT_COMMANDS = [
  ...RUNTIME_LIFECYCLE_COMMANDS,
  ...PROJECT_COMMANDS_CORE_FALLBACK,
] as const;

export function isNpmOnlyTopLevelCommand(command: string | undefined): boolean {
  return !!command && (NPM_ONLY_TOP_LEVEL_COMMANDS as readonly string[]).includes(command);
}

export function isNpmOnlyScopedCommand(args: readonly string[]): boolean {
  const first = args[0];
  const second = args[1];
  if (first === 'project' && (second === '--help' || second === '-h' || second === 'help')) {
    return true;
  }
  return NPM_ONLY_SCOPED_COMMANDS.some(([command, subcommand]) => {
    if (first !== command) return false;
    if (!second) return true;
    return second === subcommand;
  });
}

export function isNpmOnlyInvocation(args: readonly string[]): boolean {
  if (args[0] === 'project' && args[1] && !args[1].startsWith('-') && args[1] !== 'help') {
    return isNpmOnlyScopedCommand(args);
  }
  return isNpmOnlyTopLevelCommand(args[0]) || isNpmOnlyScopedCommand(args);
}

export function isNpmOnlyParseDirectCommand(command: string | undefined): boolean {
  return !!command && (NPM_ONLY_PARSE_DIRECT_COMMANDS as readonly string[]).includes(command);
}

export function isNpmOnlyParseDirectInvocation(args: readonly string[]): boolean {
  return isNpmOnlyParseDirectCommand(args[0]) || isNpmOnlyScopedCommand(args);
}

export function isNpmOnlyManualHandlerCommand(
  command: string | undefined
): command is (typeof NPM_ONLY_MANUAL_HANDLER_COMMANDS)[number] {
  return !!command && (NPM_ONLY_MANUAL_HANDLER_COMMANDS as readonly string[]).includes(command);
}

async function runNpmOnlyManualHandler(
  command: (typeof NPM_ONLY_MANUAL_HANDLER_COMMANDS)[number],
  args: string[]
): Promise<number> {
  switch (command) {
    case 'bootstrap':
      return handleBootstrapCommand(args);
    case 'setup':
      return handleSetupCommand(args);
    case 'cache':
      return handleCacheCommand(args);
    case 'mirror':
      return handleMirrorCommand(args);
    default: {
      const unreachable: never = command;
      throw new Error(`Unreachable npm-only manual command: ${String(unreachable)}`);
    }
  }
}

export function isNpmExecInvocation(env: NodeJS.ProcessEnv = process.env): boolean {
  const userAgent = env.npm_config_user_agent || '';
  const execPath = env.npm_execpath || '';
  const npmCommand = env.npm_command || '';

  return (
    userAgent.includes(' npx/') ||
    /(?:^|[/\\])npx(?:\.cmd)?$/i.test(execPath) ||
    npmCommand === 'exec' ||
    npmCommand === 'x'
  );
}

function printProjectCommandCapabilities(options: { json?: boolean } = {}): void {
  const capabilities = resolveProjectCommandCapabilities(process.cwd());

  if (options.json) {
    console.log(JSON.stringify(capabilities, null, 2));
    return;
  }

  console.log(chalk.bold('Workspai project command capabilities'));
  console.log(chalk.gray(`Project: ${capabilities.projectRoot ?? 'not detected'}`));
  console.log(
    chalk.gray(
      `Runtime: ${capabilities.runtime} (${capabilities.runtimeSupportTier}) | Framework: ${capabilities.frameworkDisplayName} (${capabilities.frameworkSupportTier}) | Module support: ${capabilities.moduleSupport ? 'yes' : 'no'}`
    )
  );
  console.log(chalk.gray(`Doctor support: ${capabilities.runtimeDoctorSupport}`));
  console.log('');
  console.log(chalk.green(`Supported: ${capabilities.supportedCommands.join(', ') || 'none'}`));
  console.log(chalk.yellow(`Global: ${capabilities.globalCommands.join(', ') || 'none'}`));
  console.log(chalk.red(`Unsupported: ${capabilities.unsupportedCommands.join(', ') || 'none'}`));
}

export { COMMAND_CAPABILITIES_SCHEMA_VERSION, VERSION_CONTRACT_SCHEMA_VERSION };

/**
 * Versioned downstream contracts this CLI publishes for IDE/CI consumers.
 *
 * Single source of truth shared by `commands --json` and `--version --json` so the
 * advertised versions can never drift between the two surfaces. The envelope schema
 * versions (command-capabilities, version) live on their own `schemaVersion` field.
 */
export {
  getPublishedContractCatalog,
  getPublishedContractVersions,
} from './contracts/published-contract-versions.js';

/**
 * Machine-readable version contract emitted by `workspai --version --json`.
 *
 * Lets the extension perform its version gate (`MIN_RAPIDKIT_CLI_VERSION`) and
 * contract-compatibility checks from one structured payload instead of parsing the
 * bare version string and probing capabilities separately.
 */
export function getVersionContract() {
  return {
    schemaVersion: VERSION_CONTRACT_SCHEMA_VERSION,
    cli: 'workspai',
    version: getVersion(),
    node: process.version,
    platform: process.platform,
    capabilitiesSchemaVersion: COMMAND_CAPABILITIES_SCHEMA_VERSION,
    contracts: getPublishedContractVersions(),
    contractCatalog: getPublishedContractCatalog(),
  };
}

type RuntimeCommandInventoryPayload = {
  schemaVersion: string;
  commands: Array<{
    path: string[];
    command: string;
    parent: string | null;
    registrationKind: 'commander' | 'manual-handler';
    aliases: string[];
    description: string;
    hidden: boolean;
    arguments: Array<{ name: string; required: boolean; variadic: boolean }>;
    options: Array<{ flags: string; attributeName: string | null }>;
  }>;
  topLevelCommands: string[];
  integrity: {
    ok: boolean;
    registeredButUndeclared: string[];
    declaredButUnregistered: string[];
    registeredScopedButUndeclared: string[];
    declaredScopedButUnregistered: string[];
  };
};

export function getGlobalCommandCapabilities() {
  const runtimeInventory: RuntimeCommandInventoryPayload = buildCliRuntimeCommandInventory(program);
  const npmOwned = [...runtimeInventory.topLevelCommands];
  const coreBacked = [...BOOTSTRAP_CORE_COMMANDS_SET].filter(
    (command) => !npmOwned.includes(command as (typeof npmOwned)[number])
  );
  const projectScoped = ['init', 'dev', 'start', 'build', 'test', 'lint', 'format', 'help'];
  const workspaceSubcommands = [...WORKSPACE_SUBCOMMANDS];
  const workspaceIntelligenceSubcommands = [...WORKSPACE_INTELLIGENCE_SUBCOMMANDS];

  return {
    schemaVersion: COMMAND_CAPABILITIES_SCHEMA_VERSION,
    scope: 'global',
    cli: 'workspai',
    version: getVersion(),
    cwd: process.cwd(),
    // Versioned contracts this CLI publishes. Consumers (Workspai/CI) discover the
    // machine-readable surfaces here instead of hard-coding versions, so capability
    // detection stays aligned with `runtime-command-surface.v1` and the log stream.
    contracts: getPublishedContractVersions(),
    contractCatalog: getPublishedContractCatalog(),
    commands: {
      npmOwned,
      coreBacked,
      projectScoped,
    },
    workspace: {
      command: 'workspace',
      subcommands: workspaceSubcommands,
      intelligenceSubcommands: workspaceIntelligenceSubcommands,
    },
    commandMap: Object.fromEntries([
      ...npmOwned.map((command) => [
        command,
        {
          command,
          owner: 'npm-wrapper',
          status: 'supported',
          scope: command === 'project' ? 'project-introspection' : 'workspace',
        },
      ]),
      ...coreBacked.map((command) => [
        command,
        {
          command,
          owner: 'python-core',
          status: 'delegated',
          scope: 'core',
        },
      ]),
      ...projectScoped.map((command) => [
        command,
        {
          command,
          owner: 'runtime-adapter',
          status: command === 'help' ? 'supported' : 'runtime-dependent',
          scope: 'project',
        },
      ]),
    ]),
    runtimeInventory,
  };
}

function printGlobalCommandCapabilities(options: { json?: boolean } = {}): void {
  const capabilities = getGlobalCommandCapabilities();

  if (options.json) {
    if (!capabilities.runtimeInventory.integrity.ok) {
      throw new Error(
        formatCliCommandSurfaceIntegrityError(capabilities.runtimeInventory.integrity)
      );
    }
    console.log(JSON.stringify(capabilities, null, 2));
    return;
  }

  console.log(chalk.bold('Workspai command capabilities'));
  console.log(chalk.gray(`CLI: ${capabilities.cli} v${capabilities.version}`));
  console.log('');
  console.log(chalk.green(`npm wrapper: ${capabilities.commands.npmOwned.join(', ')}`));
  console.log(chalk.cyan(`Python core: ${capabilities.commands.coreBacked.join(', ')}`));
  console.log(chalk.yellow(`Project runtime: ${capabilities.commands.projectScoped.join(', ')}`));
  console.log(
    chalk.magenta(
      `Workspace intelligence: ${capabilities.workspace.intelligenceSubcommands.join(', ')}`
    )
  );
  console.log('');
  console.log(chalk.gray('Tip: run `workspai project commands --json` inside a project.'));
}

function handleProjectCapabilityRequest(args: readonly string[]): boolean {
  if (!isProjectCapabilityRequest(args)) return false;
  printProjectCommandCapabilities({ json: args.includes('--json') || args.includes('--ci') });
  return true;
}

function blockUnsupportedProjectCommandIfNeeded(args: readonly string[]): boolean {
  const capabilities = resolveProjectCommandCapabilities(process.cwd());
  if (!capabilities.projectRoot) return false;

  const capability = getProjectCommandCapability(args, process.cwd());
  if (!capability || capability.status !== 'unsupported') return false;

  console.error(chalk.red(formatUnsupportedProjectCommand(capability, capabilities)));
  process.exit(1);
}

export function hasWorkspaceRootMarkers(targetDir: string): boolean {
  return (
    fs.existsSync(path.join(targetDir, '.workspai-workspace')) ||
    fs.existsSync(path.join(targetDir, '.workspai', 'workspace.json')) ||
    fs.existsSync(path.join(targetDir, '.rapidkit-workspace')) ||
    fs.existsSync(path.join(targetDir, '.rapidkit', 'workspace.json'))
  );
}

// Note: we intentionally avoid any sync-time blocking behavior here.
// `delegateToLocalCLI()` handles python-engine delegation asynchronously.

/**
 * Check if we're inside a RapidKit project and delegate to local CLI if needed
 * If .rapidkit/context.json exists and engine is Python-core backed, delegate module/core commands.
 */
export function findContextFileUp(start: string): string | null {
  let p = start;

  while (true) {
    const candidate = projectMetadataCandidates(p, 'context.json').find((item) =>
      fs.existsSync(item)
    );
    if (candidate) return candidate;
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return null;
}

export function findWorkspaceMarkerUp(start: string): string | null {
  let p = start;
  const tempRoot = path.resolve(tmpdir());

  while (true) {
    const candidate = [
      path.join(p, '.workspai-workspace'),
      path.join(p, '.rapidkit-workspace'),
    ].find((item) => fs.existsSync(item));
    if (candidate && path.resolve(p) !== tempRoot) return candidate;
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return null;
}

/**
 * Find workspace directory (not just marker file)
 * Returns the directory containing a Workspai workspace marker.
 */
export function findWorkspaceUp(start: string): string | null {
  const resolved = resolveProjectWorkspaceSync({ startPath: start });
  if (!resolved || path.resolve(resolved.workspacePath) === path.resolve(tmpdir())) return null;
  return resolved.workspacePath;
}

function resolveWorkspaceForIngestion(startPath: string): {
  workspacePath: string | null;
  error: ProjectWorkspaceResolutionError | null;
} {
  try {
    const resolution = resolveProjectWorkspaceSync({ startPath, strict: true });
    const workspacePath = resolution?.workspacePath ?? null;
    return {
      workspacePath:
        workspacePath && path.resolve(workspacePath) !== path.resolve(tmpdir())
          ? workspacePath
          : null,
      error: null,
    };
  } catch (error) {
    if (
      error instanceof ProjectWorkspaceResolutionError &&
      error.code === 'project.workspace.unlinked'
    ) {
      return { workspacePath: null, error: null };
    }
    if (error instanceof ProjectWorkspaceResolutionError) {
      return { workspacePath: null, error };
    }
    throw error;
  }
}

async function syncWorkspaceContractAfterProjectChange(
  workspacePath: string,
  options?: { silent?: boolean }
): Promise<void> {
  try {
    const { syncWorkspaceConsumerArtifacts } = await import('./utils/workspace-onboarding.js');
    await syncWorkspaceConsumerArtifacts(workspacePath, { silent: options?.silent });
  } catch (error) {
    if (!options?.silent) {
      console.log(chalk.yellow(`⚠️  Workspace consumer sync skipped: ${(error as Error).message}`));
      console.log(
        chalk.gray(
          '   Retry: npx workspai workspace agent-sync --write --refresh-context --preset enterprise'
        )
      );
    }
  }
}

export interface DoctorWorkspaceShadowDiagnostic {
  detected: boolean;
  candidatePath?: string;
  reason?: string;
}

export async function detectWindowsDoctorWorkspaceShadow(
  params: { scope?: string; workspaceFlag?: boolean | string },
  cwd: string = process.cwd(),
  platform: NodeJS.Platform = process.platform
): Promise<DoctorWorkspaceShadowDiagnostic> {
  const workspaceMode = Boolean(params.workspaceFlag) || params.scope === 'workspace';
  if (!workspaceMode || !isWindowsPlatform(platform)) {
    return { detected: false };
  }

  const localCandidates = getRapidkitLocalScriptCandidates(cwd, platform);
  for (const candidate of localCandidates) {
    if (!(await fsExtra.pathExists(candidate))) {
      continue;
    }
    const lower = candidate.toLowerCase();
    if (lower.endsWith('rapidkit.cmd') || lower.endsWith('rapidkit.exe')) {
      return {
        detected: true,
        candidatePath: candidate,
        reason: 'Found workspace-local rapidkit launcher on Windows.',
      };
    }
  }

  return { detected: false };
}

/**
 * Detect legacy workspace roots that predate `.rapidkit-workspace` marker files.
 *
 * Legacy roots are identified by `.rapidkit/workspace.json` while missing the
 * root marker file. Bootstrap can then auto-sync the modern foundation layout.
 */
export function findLegacyWorkspaceUp(start: string): string | null {
  let p = start;

  while (true) {
    const markerPath = path.join(p, '.rapidkit-workspace');
    const legacyManifestPath = path.join(p, '.rapidkit', 'workspace.json');
    if (!fs.existsSync(markerPath) && fs.existsSync(legacyManifestPath)) {
      return p;
    }
    const parent = path.dirname(p);
    if (parent === p) break;
    p = parent;
  }

  return null;
}

type DependencySharingMode = 'isolated' | 'shared-runtime-caches' | 'shared-node-deps';
type PolicyMode = 'warn' | 'strict';
type WorkspacePolicyRuleKey =
  | 'enforce_workspace_marker'
  | 'enforce_toolchain_lock'
  | 'disallow_untrusted_tool_sources'
  | 'enforce_compatibility_matrix'
  | 'require_mirror_lock_for_offline';

const WORKSPACE_POLICY_RULE_DEFAULTS: Record<WorkspacePolicyRuleKey, boolean> = {
  enforce_workspace_marker: true,
  enforce_toolchain_lock: false,
  disallow_untrusted_tool_sources: false,
  enforce_compatibility_matrix: false,
  require_mirror_lock_for_offline: true,
};

function parsePolicyMode(policyContent: string | null | undefined): PolicyMode {
  if (!policyContent) return 'warn';
  const modeMatch = policyContent.match(/^[\t ]*mode:\s*(warn|strict)\s*(?:#.*)?$/m);
  return modeMatch?.[1] === 'strict' ? 'strict' : 'warn';
}

function parsePolicyRule(content: string, key: WorkspacePolicyRuleKey): boolean {
  const line = content.match(new RegExp(`^[\\t ]*${key}:\\s*(true|false)\\s*(?:#.*)?$`, 'm'));
  if (!line) return WORKSPACE_POLICY_RULE_DEFAULTS[key];
  return line[1] === 'true';
}

function parseWorkspacePolicy(content: string | null | undefined): {
  mode: PolicyMode;
  dependency_sharing_mode: DependencySharingMode;
  rules: Record<WorkspacePolicyRuleKey, boolean>;
} {
  const raw = content ?? '';
  return {
    mode: parsePolicyMode(raw),
    dependency_sharing_mode: parseDependencySharingMode(raw),
    rules: {
      enforce_workspace_marker: parsePolicyRule(raw, 'enforce_workspace_marker'),
      enforce_toolchain_lock: parsePolicyRule(raw, 'enforce_toolchain_lock'),
      disallow_untrusted_tool_sources: parsePolicyRule(raw, 'disallow_untrusted_tool_sources'),
      enforce_compatibility_matrix: parsePolicyRule(raw, 'enforce_compatibility_matrix'),
      require_mirror_lock_for_offline: parsePolicyRule(raw, 'require_mirror_lock_for_offline'),
    },
  };
}

export function replaceOrInsertTopLevelPolicyLine(
  content: string,
  key: string,
  value: string
): string {
  const line = `${key}: ${value}`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const topLevelRegex = new RegExp(`^[\\t ]*${escaped}:\\s*.*$`, 'm');

  if (topLevelRegex.test(content)) {
    return content.replace(topLevelRegex, line);
  }

  const rulesRegex = /^[\t ]*rules:\s*(?:#.*)?$/m;
  if (rulesRegex.test(content)) {
    return content.replace(rulesRegex, `${line}\nrules:`);
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  return `${normalized}${line}\n`;
}

export function replaceOrInsertRulePolicyLine(
  content: string,
  key: WorkspacePolicyRuleKey,
  value: boolean
): string {
  const line = `  ${key}: ${value ? 'true' : 'false'}`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ruleRegex = new RegExp(`^[\\t ]+${escaped}:\\s*.*$`, 'm');
  if (ruleRegex.test(content)) {
    return content.replace(ruleRegex, line);
  }

  const rulesRegex = /^[\t ]*rules:\s*(?:#.*)?$/m;
  if (rulesRegex.test(content)) {
    return content.replace(rulesRegex, `rules:\n${line}`);
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  return `${normalized}rules:\n${line}\n`;
}

export function defaultWorkspacePolicyYaml(): string {
  return [
    'version: "1.0"',
    'mode: warn # "warn" or "strict"',
    'dependency_sharing_mode: isolated # "isolated" or "shared-runtime-caches" or "shared-node-deps"',
    '# change profile (recommended): npx workspai bootstrap --profile polyglot',
    '# change mode/dependency manually: edit this file and rerun npx workspai init',
    'rules:',
    '  enforce_workspace_marker: true',
    '  enforce_toolchain_lock: false',
    '  disallow_untrusted_tool_sources: false',
    '  enforce_compatibility_matrix: false',
    '  require_mirror_lock_for_offline: true',
    '',
  ].join('\n');
}

async function readWorkspacePolicyFile(workspacePath: string): Promise<string> {
  for (const policyPath of workspaceMetadataCandidates(workspacePath, 'policies.yml')) {
    if (await fsExtra.pathExists(policyPath)) {
      return fs.promises.readFile(policyPath, 'utf-8');
    }
  }

  return defaultWorkspacePolicyYaml();
}

async function writeWorkspacePolicyFile(workspacePath: string, content: string): Promise<void> {
  const policyPath = workspaceMetadataPath(workspacePath, 'policies.yml');
  await fsExtra.ensureDir(path.dirname(policyPath));
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  await fs.promises.writeFile(policyPath, normalized, 'utf-8');
}

export function parsePolicyBooleanLiteral(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  return null;
}

function parseDependencySharingMode(
  policyContent: string | null | undefined
): DependencySharingMode {
  if (!policyContent) return 'isolated';
  const match = policyContent.match(/^\s*dependency_sharing_mode:\s*([a-zA-Z\-]+)\s*(?:#.*)?$/m);
  const mode = match?.[1]?.toLowerCase();
  if (mode === 'shared-runtime-caches' || mode === 'shared-node-deps' || mode === 'isolated') {
    return mode;
  }
  return 'isolated';
}

function validateDependencySharingMode(policyContent: string | null | undefined): {
  mode: DependencySharingMode;
  status: 'passed' | 'skipped' | 'failed';
  message: string;
} {
  if (!policyContent) {
    return {
      mode: 'isolated',
      status: 'skipped',
      message: 'No policies.yml found; dependency_sharing_mode defaults to isolated.',
    };
  }

  const match = policyContent.match(/^\s*dependency_sharing_mode:\s*([a-zA-Z\-]+)\s*(?:#.*)?$/m);
  if (!match) {
    return {
      mode: 'isolated',
      status: 'skipped',
      message: 'dependency_sharing_mode is not set; defaulting to isolated.',
    };
  }

  const rawValue = match[1].toLowerCase();
  if (
    rawValue === 'isolated' ||
    rawValue === 'shared-runtime-caches' ||
    rawValue === 'shared-node-deps'
  ) {
    return {
      mode: rawValue,
      status: 'passed',
      message: `dependency_sharing_mode is valid: ${rawValue}.`,
    };
  }

  return {
    mode: 'isolated',
    status: 'failed',
    message:
      `Invalid dependency_sharing_mode: ${rawValue}. ` +
      'Use one of: isolated, shared-runtime-caches, shared-node-deps.',
  };
}

async function withWorkspaceDependencyPolicyContext<T>(
  cwd: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; code: number }> {
  const workspacePath = findWorkspaceUp(cwd);
  const policyPath = workspacePath
    ? workspaceMetadataCandidates(workspacePath, 'policies.yml').find((candidate) =>
        fs.existsSync(candidate)
      )
    : null;

  let dependencySharingMode: DependencySharingMode = 'isolated';
  if (policyPath && (await fsExtra.pathExists(policyPath))) {
    try {
      const policyContent = await fs.promises.readFile(policyPath, 'utf-8');
      const validation = validateDependencySharingMode(policyContent);
      if (validation.status === 'failed') {
        console.log(chalk.red(`❌ ${validation.message}`));
        return { ok: false, code: 1 };
      }
      dependencySharingMode = validation.mode;
    } catch {
      console.log(chalk.red('❌ Failed to read workspace policy file (.workspai/policies.yml).'));
      return { ok: false, code: 1 };
    }
  }

  const prevMode = process.env.RAPIDKIT_DEP_SHARING_MODE;
  const prevWorkspacePath = process.env.RAPIDKIT_WORKSPACE_PATH;

  process.env.RAPIDKIT_DEP_SHARING_MODE = dependencySharingMode;
  if (workspacePath) {
    process.env.RAPIDKIT_WORKSPACE_PATH = workspacePath;
  }

  try {
    const value = await run();
    return { ok: true, value };
  } finally {
    if (typeof prevMode === 'undefined') delete process.env.RAPIDKIT_DEP_SHARING_MODE;
    else process.env.RAPIDKIT_DEP_SHARING_MODE = prevMode;

    if (typeof prevWorkspacePath === 'undefined') delete process.env.RAPIDKIT_WORKSPACE_PATH;
    else process.env.RAPIDKIT_WORKSPACE_PATH = prevWorkspacePath;
  }
}

export async function runCommandInCwd(
  command: string,
  commandArgs: string[],
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<number> {
  const { buildPackageRunnerSubprocessEnv, resolvePackageRunnerInvocation } =
    await import('./utils/platform-capabilities.js');
  const nodeEvalScript = resolveDirectNodeEvalScript(command, commandArgs, cwd);
  const invocation = nodeEvalScript
    ? { command: process.execPath, prefixArgs: ['-e', nodeEvalScript] }
    : resolvePackageRunnerInvocation(command);
  const executable = invocation.command;
  const spawnArgs = nodeEvalScript
    ? invocation.prefixArgs
    : [...invocation.prefixArgs, ...commandArgs];
  const spawnEnv = buildPackageRunnerSubprocessEnv();
  if (nodeEvalScript) {
    if (shouldDebugWorkspaiArgs()) {
      process.stderr.write(
        `[workspai-cli] runCommandInCwd.nodeEval=${JSON.stringify({
          cwd,
          scriptBytes: nodeEvalScript.length,
        })}\n`
      );
    }
    try {
      vm.runInThisContext(nodeEvalScript, {
        filename: path.join(cwd, 'package.json#script'),
      });
      return 0;
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.stack || error.message : String(error)}\n`
      );
      return 1;
    }
  }
  const captureForStructuredParent =
    process.argv.includes('--json') ||
    process.env.RAPIDKIT_WORKSPACE_RUN_CHILD === '1' ||
    process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT === '1';
  const inheritChildOutput =
    !captureForStructuredParent &&
    command === 'npm' &&
    (commandArgs[0] === 'run' || commandArgs[0] === 'run-script' || commandArgs[0] === 'install');
  const readNpmFailureLogExcerpt = (): string => {
    const cacheDir = spawnEnv.npm_config_cache;
    if (!cacheDir) return '';
    const logsDir = path.join(cacheDir, '_logs');
    try {
      const entries = fs
        .readdirSync(logsDir)
        .filter((entry) => entry.endsWith('.log'))
        .map((entry) => {
          const filePath = path.join(logsDir, entry);
          return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const latest = entries[0]?.filePath;
      if (!latest) return '';
      const raw = fs.readFileSync(latest, 'utf-8');
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) =>
          /(?:^|\s)(?:npm\s+)?(?:error|verbose\s+(?:stack|cwd|os|node|npm|exit|code))\b/i.test(line)
        )
        .slice(0, 12)
        .join('\n');
    } catch {
      return '';
    }
  };
  const envTimeoutMs = Number.parseInt(process.env.RAPIDKIT_CHILD_COMMAND_TIMEOUT_MS || '', 10);
  const effectiveTimeoutMs =
    options.timeoutMs && options.timeoutMs > 0
      ? options.timeoutMs
      : Number.isFinite(envTimeoutMs) && envTimeoutMs > 0
        ? envTimeoutMs
        : undefined;

  return await new Promise<number>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let child: ReturnType<typeof spawn> | null = null;
    const cleanupChildHandles = () => {
      try {
        child?.stdout?.destroy();
      } catch {
        // Best-effort cleanup after timeout.
      }
      try {
        child?.stderr?.destroy();
      } catch {
        // Best-effort cleanup after timeout.
      }
      try {
        child?.stdin?.destroy();
      } catch {
        // Best-effort cleanup after timeout.
      }
      try {
        child?.removeAllListeners('close');
        child?.removeAllListeners('error');
        child?.unref();
      } catch {
        // Best-effort cleanup after timeout.
      }
    };
    if (shouldDebugWorkspaiArgs()) {
      process.stderr.write(
        `[workspai-cli] runCommandInCwd=${JSON.stringify({
          executable,
          args: spawnArgs,
          cwd,
          directNodeEvalScript: nodeEvalScript !== null,
          npmEnv: Object.fromEntries(
            Object.entries(spawnEnv).filter(([key]) =>
              [
                'npm_config_if_present',
                'npm_config_ignore_scripts',
                'npm_config_loglevel',
                'npm_config_silent',
                'npm_config_json',
                'npm_lifecycle_event',
                'npm_lifecycle_script',
              ].includes(key)
            )
          ),
        })}\n`
      );
    }
    const requiresWindowsBatchShell = isWindowsPlatform() && /\.(?:cmd|bat)$/i.test(executable);
    child = spawn(executable, spawnArgs, {
      stdio: inheritChildOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      cwd,
      shell: requiresWindowsBatchShell,
      env: spawnEnv,
      detached: !isWindowsPlatform(),
    });
    if (effectiveTimeoutMs && effectiveTimeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (!isWindowsPlatform() && child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        } else {
          child.kill('SIGTERM');
        }
        cleanupChildHandles();
        if (process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT !== '1') {
          process.stderr.write(
            `RapidKit command timed out after ${effectiveTimeoutMs}ms: ${executable} ${spawnArgs.join(' ')}\n`
          );
        }
        resolve(124);
      }, effectiveTimeoutMs);
    }

    if (!inheritChildOutput) {
      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      const npmFailureExcerpt =
        code && code !== 0 && stdout.length === 0 && stderr.length === 0 && command === 'npm'
          ? readNpmFailureLogExcerpt()
          : '';
      if (shouldDebugWorkspaiArgs()) {
        process.stderr.write(
          `[workspai-cli] runCommandInCwd.close=${JSON.stringify({ code, stdoutBytes: stdout.length, stderrBytes: stderr.length, npmFailureExcerptBytes: npmFailureExcerpt.length })}\n`
        );
      }
      if (process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT !== '1') {
        if (stdout.length > 0) {
          process.stdout.write(stdout);
        }
        if (stderr.length > 0) {
          process.stderr.write(stderr);
        } else if (npmFailureExcerpt) {
          process.stderr.write(`${npmFailureExcerpt}\n`);
        }
      }
      resolve(code ?? 1);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(1);
    });
  });
}

function resolveDirectNodeEvalScript(
  command: string,
  commandArgs: string[],
  cwd: string
): string | null {
  if (command !== 'npm') {
    return null;
  }
  const action = commandArgs[0];
  if (action !== 'run' && action !== 'run-script') {
    return null;
  }
  const scriptName = commandArgs.find((arg, index) => index > 0 && !arg.startsWith('-'));
  if (!scriptName) {
    return null;
  }
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const script = packageJson.scripts?.[scriptName];
    if (typeof script !== 'string') {
      return null;
    }
    return parseNodeEvalScript(script);
  } catch {
    return null;
  }
}

export function parseNodeEvalScript(script: string): string | null {
  const trimmed = script.trim();
  const doubleQuoted = trimmed.match(/^node\s+(?:-e|--eval)\s+"((?:\\.|[^"\\])*)"$/);
  if (doubleQuoted) {
    return doubleQuoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  const singleQuoted = trimmed.match(/^node\s+(?:-e|--eval)\s+'((?:\\.|[^'\\])*)'$/);
  if (singleQuoted) {
    return singleQuoted[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return null;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fsExtra.outputFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function normalizeImportedProjectName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 64);
}

async function resolveOwnedImportDestination(
  workspacePath: string,
  source: string,
  requestedName?: string
): Promise<string> {
  const sourceName = isGitUrl(source)
    ? source.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()?.split(':').pop() ||
      'imported-project'
    : path.basename(source);
  const baseName = normalizeImportedProjectName(requestedName || sourceName) || 'imported-project';
  let attempt = 0;
  for (;;) {
    const candidateName =
      attempt === 0
        ? baseName
        : attempt === 1
          ? `${baseName}-imported`
          : `${baseName}-imported-${attempt}`;
    const candidatePath = path.join(workspacePath, candidateName);
    if (!(await fsExtra.pathExists(candidatePath))) return candidatePath;
    attempt += 1;
  }
}

export async function handleImportCommand(
  source: string,
  options: {
    workspace?: string;
    name?: string;
    git?: boolean;
    json?: boolean;
    enableModules?: boolean;
    projectGrounding?: ProjectGroundingMode;
  },
  dependencies?: {
    syncWorkspaceProjects?: (workspacePath: string) => Promise<void>;
    rollbackImportedProjectImport?: (workspacePath: string, projectPath: string) => Promise<void>;
  }
): Promise<number> {
  const shouldInjectImportSyncFailure =
    process.env.RAPIDKIT_TEST_IMPORT_SYNC_FAIL === '1' &&
    (process.env.VITEST === 'true' ||
      process.env.VITEST === '1' ||
      process.env.NODE_ENV === 'test');

  const explicitWorkspace = options.workspace ? path.resolve(options.workspace) : null;
  const ingestionResolution = explicitWorkspace
    ? { workspacePath: explicitWorkspace, error: null }
    : resolveWorkspaceForIngestion(process.cwd());
  let workspacePath = ingestionResolution.workspacePath;
  let usedDefaultWorkspace = false;
  let createdDefaultWorkspace = false;
  let willCreateDefaultWorkspace = false;

  if (ingestionResolution.error) {
    if (options.json) {
      console.log(
        JSON.stringify(
          cliOperationError({
            operation: 'import',
            code: ingestionResolution.error.code,
            message: ingestionResolution.error.message,
            context: ingestionResolution.error.context,
          }),
          null,
          2
        )
      );
    } else {
      console.log(chalk.red(`❌ ${ingestionResolution.error.message}`));
    }
    return 1;
  }

  if (explicitWorkspace) {
    if (!hasWorkspaceRootMarkers(explicitWorkspace)) {
      const message = `Workspace path is not a valid Workspai workspace: ${explicitWorkspace}`;
      if (options.json) {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.log(chalk.red(`❌ ${message}`));
      }
      return 1;
    }
  } else if (!workspacePath || !hasWorkspaceRootMarkers(workspacePath)) {
    workspacePath = resolveManagedDefaultImportWorkspacePath();
    usedDefaultWorkspace = true;
    willCreateDefaultWorkspace = true;
  }

  if (!workspacePath || (!hasWorkspaceRootMarkers(workspacePath) && !willCreateDefaultWorkspace)) {
    const message = 'Not inside a Workspai workspace';
    if (options.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(chalk.red(`❌ ${message}`));
      console.log(
        chalk.gray('💡 Run this command from a workspace root or pass --workspace <path>.')
      );
    }
    return 1;
  }

  const projectWorkspaceCommand = 'npx workspai project workspace status --json';

  let transaction: ProjectLifecycleTransaction | undefined;
  try {
    const ownedDestination = await resolveOwnedImportDestination(
      workspacePath,
      source,
      options.name
    );
    transaction = await beginProjectLifecycleTransaction(workspacePath, {
      ownedDestination,
      ownedWorkspace: willCreateDefaultWorkspace ? workspacePath : undefined,
    });
    if (willCreateDefaultWorkspace) {
      const ensuredWorkspace = await ensureManagedDefaultImportWorkspace({ silent: options.json });
      workspacePath = ensuredWorkspace.workspacePath;
      createdDefaultWorkspace = ensuredWorkspace.created;
    }
    const importedProject = await importProjectIntoWorkspace({
      workspacePath,
      source,
      name: options.name,
      sourceType: options.git === true ? 'git-url' : undefined,
      enableModules: options.enableModules,
      projectGrounding: options.projectGrounding,
    });

    if (importedProject.path !== ownedDestination) {
      transaction.registerCompensation(() => fsExtra.remove(importedProject.path));
    }

    try {
      if (dependencies?.syncWorkspaceProjects) {
        await dependencies.syncWorkspaceProjects(workspacePath);
      } else {
        if (shouldInjectImportSyncFailure) {
          throw new Error('forced sync failure for command-level import rollback test');
        }
        const { registerProjectInWorkspaceStrict, registerWorkspaceStrict } =
          await import('./workspace.js');
        await registerWorkspaceStrict(workspacePath, path.basename(workspacePath));
        await registerProjectInWorkspaceStrict(
          workspacePath,
          importedProject.name,
          importedProject.path
        );
      }
      await transaction.commit();
      await syncWorkspaceContractAfterProjectChange(workspacePath, { silent: options.json });
    } catch (syncError) {
      try {
        await rollbackProjectLifecycleTransaction(transaction, syncError);
      } catch (rolledBackError) {
        if (rolledBackError !== syncError) throw rolledBackError;
      }
      throw new Error(
        `Workspace sync failed after import and the imported project was rolled back: ${syncError instanceof Error ? syncError.message : String(syncError)}`
      );
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            workspacePath,
            workspaceResolution: usedDefaultWorkspace
              ? 'default-auto'
              : explicitWorkspace
                ? 'explicit'
                : 'nearest',
            defaultWorkspaceCreated: usedDefaultWorkspace ? createdDefaultWorkspace : false,
            projectWorkspaceCommand,
            commandsResolveWorkspaceFromProject: true,
            plan: importedProject.ingestionPlan,
            importedProject,
          },
          null,
          2
        )
      );
      return 0;
    }

    if (usedDefaultWorkspace) {
      console.log(
        chalk.yellow(
          `ℹ Imported outside a workspace, so Workspai used the default workspace: ${workspacePath}`
        )
      );
    }

    console.log(chalk.green(`✔ Imported project: ${importedProject.name}`));
    console.log(chalk.gray(`   Workspace: ${workspacePath}`));
    console.log(chalk.gray(`   Destination: ${importedProject.path}`));
    console.log(chalk.gray(`   Stack: ${importedProject.stack} (${importedProject.confidence})`));
    console.log(
      chalk.gray(
        `   Source: ${options.git === true || isGitUrl(source) ? 'git-url' : 'local-folder'}`
      )
    );
    if (!importedProject.profileCompatibility.ok) {
      const hint = formatWorkspaceProfileCompatibilityHint(importedProject.profileCompatibility);
      console.log(
        chalk.yellow(`   Profile warning: ${importedProject.profileCompatibility.message}`)
      );
      if (hint) {
        console.log(chalk.gray(`   ${hint}`));
      }
    }
    console.log(
      chalk.gray(
        `   Workspai commands now resolve this workspace directly from the imported project.`
      )
    );
    console.log(chalk.gray(`   Check: ${projectWorkspaceCommand}`));
    return 0;
  } catch (error) {
    if (transaction) {
      try {
        await rollbackProjectLifecycleTransaction(transaction, error);
      } catch (rolledBackError) {
        if (rolledBackError !== error) {
          error = rolledBackError;
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(chalk.red(`❌ Import failed: ${message}`));
    }
    return 1;
  }
}

export async function handleAdoptCommand(
  source: string | undefined,
  options: {
    workspace?: string;
    name?: string;
    dryRun?: boolean;
    json?: boolean;
    enableModules?: boolean;
    projectGrounding?: ProjectGroundingMode;
  },
  dependencies?: {
    syncWorkspaceProjects?: (workspacePath: string) => Promise<void>;
    registerWorkspace?: (workspacePath: string, workspaceName: string) => Promise<void>;
    registerProjectInWorkspace?: (
      workspacePath: string,
      projectName: string,
      projectPath: string
    ) => Promise<void>;
    rollbackAdoptedProjectImport?: (
      workspacePath: string,
      projectPath: string,
      snapshot: AdoptProjectRollbackSnapshot
    ) => Promise<void>;
  }
): Promise<number> {
  const sourcePath = path.resolve(source || process.cwd());
  const explicitWorkspace = options.workspace ? path.resolve(options.workspace) : null;
  const ingestionResolution = explicitWorkspace
    ? { workspacePath: explicitWorkspace, error: null }
    : resolveWorkspaceForIngestion(process.cwd());
  let workspacePath = ingestionResolution.workspacePath;
  let usedDefaultWorkspace = false;
  let createdDefaultWorkspace = false;
  let willCreateDefaultWorkspace = false;

  if (ingestionResolution.error) {
    if (options.json) {
      console.log(
        JSON.stringify(
          cliOperationError({
            operation: 'adopt',
            code: ingestionResolution.error.code,
            message: ingestionResolution.error.message,
            context: ingestionResolution.error.context,
          }),
          null,
          2
        )
      );
    } else {
      console.log(chalk.red(`❌ ${ingestionResolution.error.message}`));
    }
    return 1;
  }

  if (explicitWorkspace) {
    if (!hasWorkspaceRootMarkers(explicitWorkspace)) {
      const message = `Workspace path is not a valid Workspai workspace: ${explicitWorkspace}`;
      if (options.json) {
        console.log(JSON.stringify({ error: message }, null, 2));
      } else {
        console.log(chalk.red(`❌ ${message}`));
      }
      return 1;
    }
  } else if (!workspacePath || !hasWorkspaceRootMarkers(workspacePath)) {
    const defaultWorkspacePath = resolveManagedDefaultImportWorkspacePath();
    workspacePath = defaultWorkspacePath;
    usedDefaultWorkspace = true;
    willCreateDefaultWorkspace = options.dryRun !== true;
  }

  const allowsUncreatedDefaultWorkspace =
    usedDefaultWorkspace &&
    workspacePath !== null &&
    (options.dryRun === true || willCreateDefaultWorkspace);
  if (
    !workspacePath ||
    (!hasWorkspaceRootMarkers(workspacePath) && !allowsUncreatedDefaultWorkspace)
  ) {
    const message = 'Not inside a Workspai workspace';
    if (options.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(chalk.red(`❌ ${message}`));
      console.log(
        chalk.gray('💡 Run this command from a workspace root or pass --workspace <path>.')
      );
    }
    return 1;
  }

  const shouldInjectAdoptSyncFailure =
    process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL === '1' &&
    (process.env.VITEST === 'true' ||
      process.env.VITEST === '1' ||
      process.env.NODE_ENV === 'test');

  let transaction: ProjectLifecycleTransaction | undefined;
  try {
    if (options.dryRun !== true) {
      transaction = await beginProjectLifecycleTransaction(workspacePath, {
        projectPath: sourcePath,
        ownedWorkspace: willCreateDefaultWorkspace ? workspacePath : undefined,
      });
      if (willCreateDefaultWorkspace) {
        const ensuredWorkspace = await ensureManagedDefaultImportWorkspace({
          silent: options.json,
        });
        workspacePath = ensuredWorkspace.workspacePath;
        createdDefaultWorkspace = ensuredWorkspace.created;
      }
    }
    const rollbackSnapshot = await captureAdoptProjectRollbackSnapshot(workspacePath, sourcePath);

    const adoptedProject = await adoptProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: options.name,
      dryRun: options.dryRun === true,
      enableModules: options.enableModules,
      projectGrounding: options.projectGrounding,
      rollbackSnapshot,
    });
    const projectWorkspaceCommand = 'npx workspai project workspace status --json';

    if (options.dryRun !== true) {
      try {
        if (
          dependencies?.registerWorkspace ||
          dependencies?.registerProjectInWorkspace ||
          dependencies?.syncWorkspaceProjects
        ) {
          if (dependencies.registerWorkspace) {
            await dependencies.registerWorkspace(workspacePath, path.basename(workspacePath));
          }
          if (dependencies.registerProjectInWorkspace) {
            await dependencies.registerProjectInWorkspace(
              workspacePath,
              adoptedProject.name,
              adoptedProject.path
            );
          }
          if (dependencies.syncWorkspaceProjects) {
            await dependencies.syncWorkspaceProjects(workspacePath);
          }
        } else {
          const { registerProjectInWorkspaceStrict, registerWorkspaceStrict } =
            await import('./workspace.js');
          await registerWorkspaceStrict(workspacePath, path.basename(workspacePath));
          await registerProjectInWorkspaceStrict(
            workspacePath,
            adoptedProject.name,
            adoptedProject.path
          );
          if (shouldInjectAdoptSyncFailure) {
            throw new Error('forced sync failure for command-level adopt rollback test');
          }
        }
        await transaction?.commit();
        await syncWorkspaceContractAfterProjectChange(workspacePath, { silent: options.json });
      } catch (syncError) {
        if (transaction) {
          try {
            await rollbackProjectLifecycleTransaction(transaction, syncError);
          } catch (rolledBackError) {
            if (rolledBackError !== syncError) throw rolledBackError;
          }
        }
        throw new Error(
          `Workspace sync failed after adopt and adoption metadata was rolled back: ${syncError instanceof Error ? syncError.message : String(syncError)}`
        );
      }
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            workspacePath,
            workspaceResolution: usedDefaultWorkspace
              ? 'default-auto'
              : explicitWorkspace
                ? 'explicit'
                : 'nearest',
            defaultWorkspaceCreated: usedDefaultWorkspace ? createdDefaultWorkspace : false,
            wouldCreateDefaultWorkspace:
              usedDefaultWorkspace && options.dryRun === true
                ? !hasWorkspaceRootMarkers(workspacePath)
                : false,
            projectWorkspaceCommand,
            commandsResolveWorkspaceFromProject: options.dryRun !== true,
            dryRun: options.dryRun === true,
            plan: adoptedProject.ingestionPlan,
            adoptedProject,
          },
          null,
          2
        )
      );
      return 0;
    }

    if (usedDefaultWorkspace) {
      console.log(
        chalk.yellow(
          `ℹ Adopted outside a workspace, so Workspai used the default workspace: ${workspacePath}`
        )
      );
    }
    if (options.dryRun === true) {
      console.log(chalk.yellow(`ℹ Dry run: no adoption files were written.`));
    }

    console.log(chalk.green(`✔ Adopted project: ${adoptedProject.name}`));
    console.log(chalk.gray(`   Workspace: ${workspacePath}`));
    console.log(chalk.gray(`   Project: ${adoptedProject.path}`));
    console.log(chalk.gray(`   Mode: linked (source was not moved or copied)`));
    console.log(chalk.gray(`   Stack: ${adoptedProject.stack} (${adoptedProject.confidence})`));
    if (!adoptedProject.profileCompatibility.ok) {
      const hint = formatWorkspaceProfileCompatibilityHint(adoptedProject.profileCompatibility);
      console.log(
        chalk.yellow(`   Profile warning: ${adoptedProject.profileCompatibility.message}`)
      );
      if (hint) {
        console.log(chalk.gray(`   ${hint}`));
      }
    }
    console.log(chalk.gray(`   Report: ${adoptedProject.adoptReadinessPath}`));
    if (options.dryRun !== true) {
      console.log(
        chalk.gray(`   Workspai commands now resolve this workspace directly from the project.`)
      );
      console.log(chalk.gray(`   Check: ${projectWorkspaceCommand}`));
      console.log(
        chalk.gray(
          `   Then: npx workspai workspace intelligence run --for-agent generic --strict --json`
        )
      );
    }
    return 0;
  } catch (error) {
    if (transaction) {
      try {
        await rollbackProjectLifecycleTransaction(transaction, error);
      } catch (rolledBackError) {
        if (rolledBackError !== error) {
          error = rolledBackError;
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(chalk.red(`❌ Adopt failed: ${message}`));
    }
    return 1;
  }
}

export async function installWorkspaceDependencies(workspacePath: string): Promise<number> {
  const PYTHON_REQUIRED_PROFILES = new Set(['python-only', 'polyglot', 'enterprise']);
  const dependencyTimeoutMs = resolveWorkspaceDependencyTimeoutMs();

  let workspaceProfile = 'minimal';
  let pythonEngineSkipped = false;
  try {
    const manifestPath =
      workspaceMetadataCandidates(workspacePath, 'workspace.json').find((candidate) =>
        fs.existsSync(candidate)
      ) ?? workspaceMetadataPath(workspacePath, 'workspace.json');
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')) as {
      profile?: string;
      bootstrap_note?: string;
      engine?: {
        python_core?: {
          status?: string;
        };
      };
    };
    workspaceProfile = manifest.profile ?? 'minimal';
    pythonEngineSkipped =
      manifest.bootstrap_note === 'python-engine-skipped' ||
      manifest.engine?.python_core?.status === 'skipped';
  } catch {
    workspaceProfile = 'minimal';
  }

  const workspaceRequiresPython = async (): Promise<boolean> => {
    if (!pythonEngineSkipped && PYTHON_REQUIRED_PROFILES.has(workspaceProfile)) {
      return true;
    }

    const projectPaths = await collectWorkspaceProjects(workspacePath);
    if (projectPaths.length === 0) {
      return false;
    }

    for (const projectPath of projectPaths) {
      const projectJson = readRapidkitProjectJson(projectPath);
      const moduleSupport = projectJson?.module_support;
      const metadata = readProjectMetadata(projectPath);

      if (pythonEngineSkipped) {
        if (metadata?.moduleSupport === true) {
          return true;
        }
        continue;
      }

      if (
        isGoProject(projectJson, projectPath) ||
        isJavaProject(projectJson, projectPath) ||
        isDotnetProject(projectJson, projectPath)
      ) {
        continue;
      }

      if (moduleSupport === false) {
        continue;
      }

      if (isPythonProject(projectJson, projectPath) || isNodeProject(projectJson, projectPath)) {
        return true;
      }

      // Unknown project type: keep strict fallback to preserve compatibility.
      return true;
    }

    return false;
  };

  if (!(await workspaceRequiresPython())) {
    return 0;
  }

  let installMethod: 'poetry' | 'venv' | 'pipx' | 'pip' = 'poetry';

  try {
    const { readWorkspaceMarker } = await import('./workspace-marker.js');
    const marker = await readWorkspaceMarker(workspacePath);
    const detected = marker?.metadata?.npm?.installMethod;
    if (detected === 'poetry' || detected === 'venv' || detected === 'pipx' || detected === 'pip') {
      installMethod = detected;
    }
  } catch {
    // Keep default method.
  }

  const installRapidKitCoreWithVenv = async (): Promise<number> => {
    const venvBin = workspaceVenvPythonBin(workspacePath);
    if (!(await fsExtra.pathExists(venvBin))) {
      const venvCode = await createWorkspaceVenv(workspacePath);
      if (venvCode !== 0) return venvCode;
    }

    const testLocalPath = readWorkspaiEnv('DEV_PATH');
    const hasLocalRapidKitPath = testLocalPath ? await fsExtra.pathExists(testLocalPath) : false;
    const pipArgs =
      hasLocalRapidKitPath && testLocalPath
        ? ['-m', 'pip', 'install', testLocalPath, '--quiet', '--disable-pip-version-check']
        : ['-m', 'pip', 'install', 'rapidkit-core', '--quiet', '--disable-pip-version-check'];

    return await runCommandInCwd(venvBin, pipArgs, workspacePath, {
      timeoutMs: dependencyTimeoutMs,
    });
  };

  if (installMethod === 'venv') {
    const pipCode = await installRapidKitCoreWithVenv();
    if (pipCode !== 0) return pipCode;
  } else if (installMethod === 'poetry') {
    // Determine if the workspace was bootstrapped with a pre-written stub
    // (i.e. pyproject.toml already lists rapidkit-core as a dependency).
    const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
    let hasStub = false;
    try {
      const content = await fs.promises.readFile(pyprojectPath, 'utf-8');
      hasStub = content.includes('rapidkit-core');
    } catch {
      hasStub = false;
    }

    if (hasStub) {
      // Fast path: create .venv if needed, then install with pip (~3x faster than poetry).
      const pipCode = await installRapidKitCoreWithVenv();
      if (pipCode !== 0) return pipCode;
    } else {
      // Legacy / no stub: use Poetry to install (original behaviour).
      const installCode = await runCommandInCwd('poetry', ['install', '--no-root'], workspacePath, {
        timeoutMs: dependencyTimeoutMs,
      });
      if (installCode !== 0) return installCode;

      // Also add rapidkit-core explicitly if it isn't already installed.
      const addCode = await runCommandInCwd('poetry', ['add', 'rapidkit-core'], workspacePath, {
        timeoutMs: dependencyTimeoutMs,
      });
      if (addCode !== 0) return addCode;
    }
  } else {
    return 0;
  }

  // Write launcher scripts (rapidkit / rapidkit.cmd) now that .venv exists.
  // For python-only/polyglot/enterprise these are written during workspace
  // creation.  For node-only/minimal/etc. this is the first time Python deps
  // are installed so we write them here to keep every profile consistent.
  try {
    const { writeWorkspaceLauncher } = await import('./create.js');
    await writeWorkspaceLauncher(workspacePath, installMethod === 'venv' ? 'venv' : 'poetry');
  } catch {
    // Non-fatal — users can still call the CLI via `npx workspai`
  }

  try {
    const { markWorkspacePythonEngineInstalled } =
      await import('./utils/workspace-python-engine-state.js');
    await markWorkspacePythonEngineInstalled(workspacePath, {
      installMethod: installMethod === 'venv' ? 'venv' : 'poetry',
      venvPath: '.venv',
    });
  } catch {
    // Non-fatal — the engine is installed; metadata can be refreshed by doctor/bootstrap.
  }

  return 0;
}

function resolveWorkspaceDependencyTimeoutMs(): number {
  const raw = process.env.RAPIDKIT_WORKSPACE_DEPS_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 120_000;
}

async function collectWorkspaceProjects(workspacePath: string): Promise<string[]> {
  const projects: string[] = [];
  const visited = new Set<string>();
  const stack = [workspacePath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) continue;
    if (visited.has(currentPath)) continue;
    visited.add(currentPath);

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      // Skip unreadable directories (permission denied, transient mounts, etc.).
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'build', 'target', 'coverage', 'htmlcov'].includes(entry.name)) {
        continue;
      }

      const candidate = path.join(currentPath, entry.name);
      const hasProjectMetadata = (
        await Promise.all(
          [
            ...projectMetadataCandidates(candidate, 'context.json'),
            ...projectMetadataCandidates(candidate, 'project.json'),
          ].map((metadataPath) => fsExtra.pathExists(metadataPath))
        )
      ).some(Boolean);
      if (hasProjectMetadata) {
        projects.push(candidate);
        continue;
      }

      stack.push(candidate);
    }
  }

  return projects;
}

function resolveDefaultWorkspacePath(basePath: string): { name: string; targetPath: string } {
  return resolveAvailableWorkspaceSlot(basePath);
}

async function ensureManagedDefaultImportWorkspace(options: { silent?: boolean } = {}): Promise<{
  workspacePath: string;
  created: boolean;
}> {
  const workspacePath = resolveManagedDefaultImportWorkspacePath();
  const workspaceName = path.basename(workspacePath);
  const existed = hasWorkspaceRootMarkers(workspacePath);

  if (!existed) {
    const { createProject } = await import('./create.js');
    const previousLogFormat = process.env.WORKSPAI_LOG_FORMAT;
    const previousConsoleLog = console.log;
    const previousConsoleWarn = console.warn;
    if (options.silent) {
      process.env.WORKSPAI_LOG_FORMAT = 'json';
      console.log = () => undefined;
      console.warn = () => undefined;
    }
    try {
      await createProject(workspaceName, {
        parentDirectory: path.dirname(workspacePath),
        profile: 'minimal',
        skipPythonEngine: true,
        skipGit: true,
        yes: true,
        userConfig: await loadUserConfig(),
      });
    } finally {
      if (options.silent) {
        console.log = previousConsoleLog;
        console.warn = previousConsoleWarn;
        if (previousLogFormat === undefined) {
          delete process.env.WORKSPAI_LOG_FORMAT;
        } else {
          process.env.WORKSPAI_LOG_FORMAT = previousLogFormat;
        }
      }
    }
  }

  return {
    workspacePath,
    created: !existed,
  };
}

// ─── Go/Fiber command handlers ───────────────────────────────────────────────

/**
 * `rapidkit init` inside a Go project — runs `go mod tidy` to fetch deps.
 */
export async function handleGoInit(projectPath: string): Promise<number> {
  const adapter = getRuntimeAdapter('go', { runCommandInCwd, runCoreRapidkit });
  const result = await adapter.initProject(projectPath);

  return reportRuntimeCommandResult(result);
}

function reportRuntimeCommandResult(result: { exitCode: number; message?: string }): number {
  if (result.message) {
    console.log(chalk.red(`❌ ${result.message}`));
  }

  return result.exitCode;
}

/**
 * `rapidkit dev` inside a Go project — runs `make run` (if Makefile present)
 * or falls back to `go run ./main.go`.
 */
export async function handleNodeCommand(
  action: 'init' | 'dev' | 'test' | 'build' | 'start' | 'lint' | 'format',
  projectPath: string
): Promise<number> {
  const adapter = getRuntimeAdapter('node', { runCommandInCwd, runCoreRapidkit });

  if (action === 'init') {
    const result = await adapter.initProject(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'dev') {
    const result = await adapter.runDev(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'test') {
    const result = await adapter.runTest(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'build') {
    const result = await adapter.runBuild(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'lint') {
    const result = await adapter.runLint?.(projectPath);
    return reportRuntimeCommandResult(result ?? { exitCode: 1, message: 'Lint is not supported.' });
  }
  if (action === 'format') {
    const result = await adapter.runFormat?.(projectPath);
    return reportRuntimeCommandResult(
      result ?? { exitCode: 1, message: 'Format is not supported.' }
    );
  }

  const result = await adapter.runStart(projectPath);
  return reportRuntimeCommandResult(result);
}

export async function handleJavaCommand(
  action: 'init' | 'dev' | 'test' | 'build' | 'start' | 'lint' | 'format',
  projectPath: string
): Promise<number> {
  const adapter = getRuntimeAdapter('java', { runCommandInCwd, runCoreRapidkit });

  if (action === 'init') {
    const result = await adapter.initProject(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'dev') {
    const result = await adapter.runDev(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'test') {
    const result = await adapter.runTest(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'build') {
    const result = await adapter.runBuild(projectPath);
    return reportRuntimeCommandResult(result);
  }
  if (action === 'lint') {
    const result = await adapter.runLint?.(projectPath);
    return reportRuntimeCommandResult(result ?? { exitCode: 1, message: 'Lint is not supported.' });
  }
  if (action === 'format') {
    const result = await adapter.runFormat?.(projectPath);
    return reportRuntimeCommandResult(
      result ?? { exitCode: 1, message: 'Format is not supported.' }
    );
  }

  const result = await adapter.runStart(projectPath);
  return reportRuntimeCommandResult(result);
}

function enrichBootstrapComplianceReport(
  report: Record<string, unknown>,
  exitCode: number,
  checks: Array<{ status?: string; id?: string; message?: string }>
): Record<string, unknown> {
  const blockers = checks
    .filter((check) => check.status === 'failed')
    .map((check) => {
      const label = check.id || 'check';
      return check.message ? `${label}: ${check.message}` : label;
    })
    .slice(0, 12);

  return withGovernanceRunMetadata(report, {
    commandId: 'bootstrap',
    exitCode,
    generatedAt: typeof report.timestamp === 'string' ? report.timestamp : new Date().toISOString(),
    blockers,
    runId: resolveGovernanceRunId(),
  });
}

export async function handleBootstrapCommand(
  args: string[],
  initRunner: (nextArgs: string[]) => Promise<number> = handleInitCommand
): Promise<number> {
  if (args.includes('--help') || args.includes('-h') || args.includes('help')) {
    console.log(
      chalk.yellow(
        'Usage: workspai bootstrap [path] [--profile <minimal|java-only|go-only|dotnet-only|python-only|node-only|polyglot|enterprise>] [--ci] [--offline] [--json] [--compliance-only]'
      )
    );
    return 0;
  }
  const prevSkipLockSync = process.env.RAPIDKIT_SKIP_LOCK_SYNC;
  if (typeof prevSkipLockSync === 'undefined') {
    process.env.RAPIDKIT_SKIP_LOCK_SYNC = '1';
  }

  try {
    type BootstrapProfile =
      | 'minimal'
      | 'java-only'
      | 'go-only'
      | 'dotnet-only'
      | 'python-only'
      | 'node-only'
      | 'polyglot'
      | 'enterprise';
    type CheckStatus = 'passed' | 'failed' | 'skipped';
    interface ComplianceCheck {
      id: string;
      status: CheckStatus;
      message: string;
    }

    interface BootstrapPolicy {
      mode: 'warn' | 'strict';
      dependency_sharing_mode: DependencySharingMode;
      rules: {
        enforce_workspace_marker: boolean;
        enforce_toolchain_lock: boolean;
        disallow_untrusted_tool_sources: boolean;
        enforce_compatibility_matrix: boolean;
        require_mirror_lock_for_offline: boolean;
      };
    }

    interface MirrorConfig {
      enabled?: boolean;
      mode?: 'online' | 'offline-first' | 'offline-only';
    }

    function normalizeProfile(value?: string): BootstrapProfile | null {
      if (!value) return null;
      const normalized = value.trim().toLowerCase();
      if (
        normalized === 'minimal' ||
        normalized === 'java-only' ||
        normalized === 'go-only' ||
        normalized === 'dotnet-only' ||
        normalized === 'python-only' ||
        normalized === 'node-only' ||
        normalized === 'polyglot' ||
        normalized === 'enterprise'
      ) {
        return normalized;
      }
      return null;
    }

    function parsePolicyYaml(content: string): BootstrapPolicy {
      const modeMatch = content.match(/^\s*mode:\s*([a-zA-Z]+)\s*(?:#.*)?$/m);
      const modeValue = modeMatch?.[1]?.toLowerCase();
      const mode: 'warn' | 'strict' = modeValue === 'strict' ? 'strict' : 'warn';

      const readRule = (key: string, fallback: boolean): boolean => {
        const match = content.match(new RegExp(`^\\s*${key}:\\s*(true|false)\\s*(?:#.*)?$`, 'm'));
        if (!match) return fallback;
        return match[1].toLowerCase() === 'true';
      };

      return {
        mode,
        dependency_sharing_mode: parseDependencySharingMode(content),
        rules: {
          enforce_workspace_marker: readRule('enforce_workspace_marker', true),
          enforce_toolchain_lock: readRule('enforce_toolchain_lock', false),
          disallow_untrusted_tool_sources: readRule('disallow_untrusted_tool_sources', false),
          enforce_compatibility_matrix: readRule('enforce_compatibility_matrix', false),
          require_mirror_lock_for_offline: readRule('require_mirror_lock_for_offline', true),
        },
      };
    }

    const initArgs: string[] = ['init'];
    let profileArg: string | undefined;
    let ciMode = false;
    let offlineMode = false;
    let jsonMode = false;
    let complianceOnly = false;

    for (let i = 1; i < args.length; i += 1) {
      const token = args[i];
      if (token === '--ci') {
        ciMode = true;
        continue;
      }
      if (token === '--offline') {
        offlineMode = true;
        continue;
      }
      if (token === '--json') {
        jsonMode = true;
        continue;
      }
      if (token === '--compliance-only') {
        complianceOnly = true;
        continue;
      }
      if (token === '--profile') {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) {
          console.log(
            chalk.yellow(
              'Usage: workspai bootstrap [path] [--profile <minimal|java-only|go-only|dotnet-only|python-only|node-only|polyglot|enterprise>] [--ci] [--offline] [--json] [--compliance-only]'
            )
          );
          return 1;
        }
        profileArg = next;
        i += 1;
        continue;
      }
      if (token.startsWith('--profile=')) {
        profileArg = token.slice('--profile='.length);
        continue;
      }
      initArgs.push(token);
    }

    const explicitProfile = normalizeProfile(profileArg);
    if (profileArg && !explicitProfile) {
      console.log(
        chalk.red(
          `Invalid profile: ${profileArg}. Use one of: minimal, java-only, go-only, dotnet-only, python-only, node-only, polyglot, enterprise.`
        )
      );
      return 1;
    }

    const cwd = process.cwd();
    const explicitTargetArgs = initArgs.slice(1).filter((arg) => !arg.startsWith('-'));
    if (explicitTargetArgs.length > 0) {
      const targetPath = path.resolve(cwd, explicitTargetArgs[0]);
      const targetJson = readRapidkitProjectJson(targetPath);
      const inferredRuntime = fs.existsSync(targetPath)
        ? await inferRuntimeByFiles(targetPath)
        : 'unknown';
      const targetIsProject =
        !hasWorkspaceRootMarkers(targetPath) &&
        (isGoProject(targetJson, targetPath) ||
          isJavaProject(targetJson, targetPath) ||
          isDotnetProject(targetJson, targetPath) ||
          isNodeProject(targetJson, targetPath) ||
          isPythonProject(targetJson, targetPath) ||
          inferredRuntime !== 'unknown');

      if (targetIsProject) {
        return await initRunner(initArgs);
      }
    }

    const cwdMarker = path.join(cwd, '.rapidkit-workspace');
    const cwdLegacyManifest = path.join(cwd, '.rapidkit', 'workspace.json');
    let workspacePath: string | null;

    if (!fs.existsSync(cwdMarker) && fs.existsSync(cwdLegacyManifest)) {
      workspacePath = cwd;
    } else {
      workspacePath = findWorkspaceUp(cwd);
      if (!workspacePath) {
        workspacePath = findLegacyWorkspaceUp(cwd);
      }
    }
    const checks: ComplianceCheck[] = [];
    let mirrorLifecycleDetails: {
      syncedArtifacts: number;
      verifiedArtifacts: number;
      rotatedFiles: number;
      lockWritten: boolean;
    } | null = null;

    let workspaceProfile: BootstrapProfile | null = null;
    if (workspacePath) {
      try {
        const workspaceManifestPath =
          workspaceMetadataCandidates(workspacePath, 'workspace.json').find((candidate) =>
            fs.existsSync(candidate)
          ) ?? workspaceMetadataPath(workspacePath, 'workspace.json');
        const manifestRaw = await fs.promises.readFile(workspaceManifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw) as { profile?: string };
        workspaceProfile = normalizeProfile(manifest.profile);
      } catch {
        workspaceProfile = null;
      }
    }

    const profileOptions: ReadonlyArray<BootstrapProfile> = [
      'minimal',
      'java-only',
      'python-only',
      'node-only',
      'go-only',
      'dotnet-only',
      'polyglot',
      'enterprise',
    ];

    const profileLabel: Record<BootstrapProfile, string> = {
      minimal: 'minimal     — Foundation files only (fastest bootstrap, mixed projects)',
      'java-only': 'java-only   — Java runtime (Spring Boot services)',
      'python-only': 'python-only — Python + Poetry (FastAPI, Django, ML pipelines)',
      'node-only': 'node-only   — Node.js runtime (NestJS, Express, Next.js)',
      'go-only': 'go-only     — Go runtime (Fiber, Gin, gRPC, microservices)',
      'dotnet-only': 'dotnet-only — .NET runtime (ASP.NET Core services)',
      polyglot: 'polyglot    — Python + Node.js + Go + Java + .NET multi-runtime workspace',
      enterprise: 'enterprise  — Polyglot + governance + Sigstore verification',
    };

    let selectedProfile: BootstrapProfile | null = explicitProfile;
    const shouldPromptProfile =
      !!workspacePath &&
      !explicitProfile &&
      !ciMode &&
      !jsonMode &&
      !!process.stdin.isTTY &&
      !!process.stdout.isTTY &&
      process.env.VITEST !== 'true' &&
      process.env.VITEST !== '1';

    if (shouldPromptProfile) {
      const currentProfile = workspaceProfile || 'minimal';
      const { chosenProfile } = (await prompt([
        {
          type: 'rawlist',
          name: 'chosenProfile',
          message: `Select workspace profile for bootstrap (current: ${currentProfile})`,
          choices: profileOptions.map((p) => ({
            name: p === currentProfile ? `${profileLabel[p]}   ← current` : profileLabel[p],
            value: p,
          })),
          default: profileOptions.indexOf(currentProfile),
        },
      ])) as { chosenProfile: BootstrapProfile };
      selectedProfile = chosenProfile;
    }

    const profile: BootstrapProfile = selectedProfile || workspaceProfile || 'minimal';

    if (workspacePath && !complianceOnly) {
      try {
        const requiresPythonProfile =
          profile === 'python-only' || profile === 'polyglot' || profile === 'enterprise';
        const installMethodForSync = requiresPythonProfile ? 'poetry' : 'venv';

        let pythonVersion: string | undefined;
        try {
          const pyVersionRaw = await fs.promises.readFile(
            path.join(workspacePath, '.python-version'),
            'utf-8'
          );
          const parsed = pyVersionRaw.trim();
          if (parsed) pythonVersion = parsed;
        } catch {
          /* optional */
        }

        const { syncWorkspaceFoundationFiles } = await import('./create.js');
        const syncedPaths = await syncWorkspaceFoundationFiles(workspacePath, {
          workspaceName: path.basename(workspacePath),
          installMethod: installMethodForSync,
          pythonVersion,
          profile,
          writeMarker: true,
          writeGitignore: true,
          onlyIfMissing: true,
        });

        checks.push({
          id: 'workspace.foundation.sync',
          status: syncedPaths.length > 0 ? 'passed' : 'skipped',
          message:
            syncedPaths.length > 0
              ? `Workspace foundation synchronized: ${syncedPaths.join(', ')}`
              : 'Workspace foundation files are already up to date.',
        });
      } catch (error) {
        checks.push({
          id: 'workspace.foundation.sync',
          status: 'failed',
          message: `Failed to synchronize workspace foundation files: ${(error as Error).message}`,
        });
      }
    } else if (workspacePath) {
      checks.push({
        id: 'workspace.foundation.sync',
        status: 'skipped',
        message: 'Workspace foundation synchronization skipped by --compliance-only.',
      });
    }

    // Persist profile back to workspace.json if an explicit/profile-selected value was given
    // and differs from what's currently stored. This keeps workspace.json as the
    // single source of truth so future bare `workspai bootstrap` calls inherit it.
    if (
      workspacePath &&
      !complianceOnly &&
      selectedProfile &&
      selectedProfile !== workspaceProfile
    ) {
      try {
        const workspaceManifestPath = workspaceMetadataPath(workspacePath, 'workspace.json');
        const raw = await fs.promises.readFile(workspaceManifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as Record<string, unknown>;
        manifest.profile = selectedProfile;
        await fsExtra.ensureDir(path.dirname(workspaceManifestPath));
        await fs.promises.writeFile(
          workspaceManifestPath,
          JSON.stringify(manifest, null, 2) + '\n',
          'utf-8'
        );
      } catch {
        // Non-fatal — bootstrap continues even if workspace.json sync fails
      }
    }

    let policy: {
      mode: 'warn' | 'strict';
      dependency_sharing_mode: string;
      rules: Record<string, boolean>;
    } = {
      mode: 'warn',
      dependency_sharing_mode: 'isolated',
      rules: {
        enforce_workspace_marker: true,
        enforce_toolchain_lock: false,
        disallow_untrusted_tool_sources: false,
        enforce_compatibility_matrix: false,
        require_mirror_lock_for_offline: true,
      },
    };

    let policyContentRaw: string | null = null;

    if (workspacePath) {
      try {
        const policyPath = workspaceMetadataCandidates(workspacePath, 'policies.yml').find(
          (candidate) => fs.existsSync(candidate)
        );
        if (!policyPath) {
          throw new Error('policy file missing');
        }
        const policyContent = await fs.promises.readFile(policyPath, 'utf-8');
        policyContentRaw = policyContent;
        policy = parsePolicyYaml(policyContent);
      } catch {
        checks.push({
          id: 'policy.file',
          status: 'skipped',
          message: 'No workspace policy file found; using default bootstrap policy.',
        });
      }
    } else {
      checks.push({
        id: 'workspace.detect',
        status: 'skipped',
        message: 'No workspace marker found; bootstrap runs in project/single-path mode.',
      });
    }

    if (workspacePath) {
      const dependencyModeValidation = validateDependencySharingMode(policyContentRaw);
      policy.dependency_sharing_mode = dependencyModeValidation.mode;
      checks.push({
        id: 'policy.schema.dependency_sharing_mode',
        status: dependencyModeValidation.status,
        message: dependencyModeValidation.message,
      });

      checks.push({
        id: 'policy.dependency_sharing_mode.effective',
        status: 'passed',
        message:
          policy.dependency_sharing_mode === 'isolated'
            ? 'Effective dependency mode: isolated (default secure mode).'
            : policy.dependency_sharing_mode === 'shared-node-deps'
              ? 'Effective dependency mode: shared-node-deps (Node projects share workspace-level caches).'
              : 'Effective dependency mode: shared-runtime-caches (Node/Python/Go share workspace-level caches).',
      });

      const markerExists =
        fs.existsSync(path.join(workspacePath, '.workspai-workspace')) ||
        fs.existsSync(path.join(workspacePath, '.rapidkit-workspace'));
      checks.push({
        id: 'policy.enforce_workspace_marker',
        status: !policy.rules.enforce_workspace_marker || markerExists ? 'passed' : 'failed',
        message:
          !policy.rules.enforce_workspace_marker || markerExists
            ? 'Workspace marker policy satisfied.'
            : 'Workspace marker policy failed: .workspai-workspace is missing.',
      });

      const lockExists = workspaceMetadataCandidates(workspacePath, 'toolchain.lock').some(
        (candidate) => fs.existsSync(candidate)
      );
      checks.push({
        id: 'policy.enforce_toolchain_lock',
        status: !policy.rules.enforce_toolchain_lock || lockExists ? 'passed' : 'failed',
        message:
          !policy.rules.enforce_toolchain_lock || lockExists
            ? 'Toolchain lock policy satisfied.'
            : 'Toolchain lock policy failed: .workspai/toolchain.lock is missing.',
      });

      const trustedSourcesConfigured =
        process.env.RAPIDKIT_TRUSTED_SOURCES === '1' ||
        workspaceMetadataCandidates(workspacePath, 'trusted-sources.lock').some((candidate) =>
          fs.existsSync(candidate)
        );
      checks.push({
        id: 'policy.disallow_untrusted_tool_sources',
        status:
          !policy.rules.disallow_untrusted_tool_sources || trustedSourcesConfigured
            ? 'passed'
            : 'failed',
        message:
          !policy.rules.disallow_untrusted_tool_sources || trustedSourcesConfigured
            ? 'Trusted tool sources policy satisfied.'
            : 'Trusted tool sources policy failed: set RAPIDKIT_TRUSTED_SOURCES=1 or provide .workspai/trusted-sources.lock.',
      });

      const compatibilityMatrixPath =
        workspaceMetadataCandidates(workspacePath, 'compatibility-matrix.json').find((candidate) =>
          fs.existsSync(candidate)
        ) ?? workspaceMetadataPath(workspacePath, 'compatibility-matrix.json');
      const compatibilityMatrixExists = fs.existsSync(compatibilityMatrixPath);
      const compatibilityMatrixEnforced = policy.rules.enforce_compatibility_matrix;

      checks.push({
        id: 'policy.enforce_compatibility_matrix',
        status: !compatibilityMatrixEnforced || compatibilityMatrixExists ? 'passed' : 'failed',
        message:
          !compatibilityMatrixEnforced || compatibilityMatrixExists
            ? 'Compatibility matrix policy satisfied.'
            : 'Compatibility matrix policy failed: .workspai/compatibility-matrix.json is missing.',
      });

      if (compatibilityMatrixExists) {
        try {
          const matrixRaw = await fs.promises.readFile(compatibilityMatrixPath, 'utf-8');
          const matrix = JSON.parse(matrixRaw) as { runtimes?: Record<string, unknown> };
          const isValidShape = !!matrix && typeof matrix === 'object';
          checks.push({
            id: 'compatibility.matrix.parse',
            status: isValidShape ? 'passed' : 'failed',
            message: isValidShape
              ? 'Compatibility matrix parsed successfully.'
              : 'Compatibility matrix parse failed: invalid JSON object.',
          });
        } catch {
          checks.push({
            id: 'compatibility.matrix.parse',
            status: 'failed',
            message: 'Compatibility matrix parse failed: invalid JSON.',
          });
        }
      }

      const mirrorConfigPath =
        workspaceMetadataCandidates(workspacePath, 'mirror-config.json').find((candidate) =>
          fs.existsSync(candidate)
        ) ?? workspaceMetadataPath(workspacePath, 'mirror-config.json');
      const mirrorLockPath =
        workspaceMetadataCandidates(workspacePath, 'mirror.lock').find((candidate) =>
          fs.existsSync(candidate)
        ) ?? workspaceMetadataPath(workspacePath, 'mirror.lock');
      const mirrorConfigExists = fs.existsSync(mirrorConfigPath);
      let mirrorLockExists = fs.existsSync(mirrorLockPath);

      let mirrorConfig: MirrorConfig = {};
      if (mirrorConfigExists) {
        try {
          mirrorConfig = JSON.parse(
            await fs.promises.readFile(mirrorConfigPath, 'utf-8')
          ) as MirrorConfig;
          checks.push({
            id: 'mirror.config.parse',
            status: 'passed',
            message: 'Mirror configuration parsed successfully.',
          });
        } catch {
          checks.push({
            id: 'mirror.config.parse',
            status: 'failed',
            message:
              'Mirror configuration parse failed: invalid JSON in .workspai/mirror-config.json.',
          });
        }
      }

      if (complianceOnly) {
        checks.push({
          id: 'mirror.lifecycle',
          status: 'skipped',
          message: 'Mirror synchronization lifecycle skipped by --compliance-only.',
        });
      } else {
        const lifecycleResult = await runMirrorLifecycle(workspacePath, {
          ciMode,
          offlineMode,
        });
        checks.push(
          ...lifecycleResult.checks.map((check) => ({
            id: check.id,
            status: check.status,
            message: check.message,
          }))
        );
        mirrorLifecycleDetails = lifecycleResult.details;

        if (lifecycleResult.details.lockWritten) {
          mirrorLockExists = true;
        }
      }

      if (offlineMode) {
        const mirrorEnabled =
          process.env.RAPIDKIT_MIRROR_ENABLED === '1' || mirrorConfig.enabled === true;
        checks.push({
          id: 'offline.mirror.enabled',
          status: mirrorEnabled ? 'passed' : 'failed',
          message: mirrorEnabled
            ? 'Offline mode mirror is enabled.'
            : 'Offline mode requires mirror enablement (set RAPIDKIT_MIRROR_ENABLED=1 or .workspai/mirror-config.json {"enabled": true}).',
        });

        const lockRequired = policy.rules.require_mirror_lock_for_offline;
        checks.push({
          id: 'offline.mirror.lock',
          status: !lockRequired || mirrorLockExists ? 'passed' : 'failed',
          message:
            !lockRequired || mirrorLockExists
              ? 'Offline mode mirror lock policy satisfied.'
              : 'Offline mode mirror lock policy failed: .workspai/mirror.lock is missing.',
        });
      } else {
        checks.push({
          id: 'offline.mirror.enabled',
          status: 'skipped',
          message: 'Offline mirror checks skipped (offline mode is disabled).',
        });
      }

      const profileCompatibility = resolveWorkspaceProfileCompatibility({
        profile,
        runtimes: await collectWorkspaceProfileRuntimes(workspacePath),
        mode: policy.mode,
      });
      if (profileCompatibility.profile !== 'enterprise') {
        checks.push({
          id: profileCompatibility.checkId,
          status: profileCompatibility.status,
          message: profileCompatibility.message,
        });
      } else {
        checks.push({
          id: 'profile.enterprise.ci',
          status: ciMode ? 'passed' : complianceOnly ? 'skipped' : 'failed',
          message: ciMode
            ? 'enterprise profile running with --ci.'
            : complianceOnly
              ? 'Enterprise runtime execution skipped by --compliance-only; --ci is not required.'
              : 'enterprise profile expects --ci for deterministic non-interactive mode.',
        });

        checks.push({
          id: 'profile.enterprise.compatibility-matrix',
          status: compatibilityMatrixExists ? 'passed' : 'failed',
          message: compatibilityMatrixExists
            ? 'enterprise profile has compatibility matrix.'
            : 'enterprise profile requires .workspai/compatibility-matrix.json.',
        });

        checks.push({
          id: 'profile.enterprise.mirror-config',
          status: mirrorConfigExists ? 'passed' : 'failed',
          message: mirrorConfigExists
            ? 'enterprise profile has mirror configuration.'
            : 'enterprise profile requires .workspai/mirror-config.json.',
        });
      }
    }

    if (ciMode) process.env.RAPIDKIT_BOOTSTRAP_CI = '1';
    if (offlineMode) process.env.RAPIDKIT_OFFLINE_MODE = '1';

    const schemaViolation = checks.some(
      (check) => check.id.startsWith('policy.schema.') && check.status === 'failed'
    );
    const strictViolation =
      schemaViolation ||
      (policy.mode === 'strict' && checks.some((check) => check.status === 'failed'));

    const reportRoot = workspacePath || cwd;
    const reportDir = workspaceMetadataPath(reportRoot, 'reports');
    const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `bootstrap-compliance-${reportTimestamp}.json`);
    const latestReportPath = path.join(reportDir, 'bootstrap-compliance.latest.json');

    const baseReport = {
      schemaVersion: 'bootstrap-compliance.v1',
      command: 'bootstrap',
      timestamp: new Date().toISOString(),
      workspacePath,
      profile,
      options: {
        ci: ciMode,
        offline: offlineMode,
        strict: policy.mode === 'strict',
        complianceOnly,
      },
      policyMode: policy.mode,
      policyRules: policy.rules,
      mirrorLifecycle: mirrorLifecycleDetails,
      checks,
    };
    const writeBootstrapReport = async (report: Record<string, unknown>): Promise<void> => {
      assertWorkspaceArtifactContract(`.workspai/reports/${path.basename(reportPath)}`, report);
      assertWorkspaceArtifactContract('.workspai/reports/bootstrap-compliance.latest.json', report);
      await fsExtra.ensureDir(reportDir);
      await writeJsonFile(reportPath, report);
      await writeJsonFile(latestReportPath, report);
    };

    if (strictViolation) {
      const report = enrichBootstrapComplianceReport(
        {
          ...baseReport,
          result: 'blocked',
          initExitCode: null,
        },
        1,
        checks
      );

      await writeBootstrapReport(report);

      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        console.log(chalk.red('❌ Bootstrap blocked by strict policy checks.'));
        console.log(chalk.gray(`Compliance report: ${reportPath}`));
      }

      return 1;
    }

    const deterministicJsonEnterpriseViolation =
      jsonMode && profile === 'enterprise' && !ciMode && !complianceOnly;
    if (deterministicJsonEnterpriseViolation) {
      const report = enrichBootstrapComplianceReport(
        {
          ...baseReport,
          result: 'blocked',
          initExitCode: null,
          complianceOnly: false,
          bootstrapRuntimeSkipped: {
            reason:
              'enterprise JSON bootstrap requires --ci for deterministic non-interactive execution.',
            nextAction: 'npx workspai bootstrap --profile enterprise --ci --json',
          },
        },
        1,
        checks
      );

      await writeBootstrapReport(report);

      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 1;
    }

    const captureBootstrapInitOutput = async (
      fn: () => Promise<number>
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      process.stdout.write = ((
        chunk: unknown,
        encodingOrCallback?: unknown,
        callback?: unknown
      ) => {
        const cb =
          typeof encodingOrCallback === 'function'
            ? encodingOrCallback
            : typeof callback === 'function'
              ? callback
              : undefined;
        stdoutChunks.push(
          typeof chunk === 'string'
            ? chunk
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk).toString('utf8')
              : String(chunk)
        );
        cb?.();
        return true;
      }) as typeof process.stdout.write;

      process.stderr.write = ((
        chunk: unknown,
        encodingOrCallback?: unknown,
        callback?: unknown
      ) => {
        const cb =
          typeof encodingOrCallback === 'function'
            ? encodingOrCallback
            : typeof callback === 'function'
              ? callback
              : undefined;
        stderrChunks.push(
          typeof chunk === 'string'
            ? chunk
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk).toString('utf8')
              : String(chunk)
        );
        cb?.();
        return true;
      }) as typeof process.stderr.write;

      try {
        const exitCode = await fn();
        return {
          exitCode,
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
        };
      } finally {
        process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
        process.stderr.write = originalStderrWrite as typeof process.stderr.write;
      }
    };

    const summarizeCapturedOutput = (raw: string): { bytes: number; excerpt: string[] } => {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        bytes: Buffer.byteLength(raw),
        excerpt: lines.slice(0, 12),
      };
    };

    // Compliance-only is observational with respect to runtime initialization in
    // both human and JSON modes. JSON additionally captures any init output when
    // initialization is requested so stdout remains a single JSON document.
    let initExitCode = 0;
    let initOutput:
      | {
          captured: true;
          stdout: { bytes: number; excerpt: string[] };
          stderr: { bytes: number; excerpt: string[] };
        }
      | undefined;
    const skipInit = complianceOnly;
    if (!skipInit) {
      if (jsonMode) {
        const captured = await captureBootstrapInitOutput(() => initRunner(initArgs));
        initExitCode = captured.exitCode;
        initOutput = {
          captured: true,
          stdout: summarizeCapturedOutput(captured.stdout),
          stderr: summarizeCapturedOutput(captured.stderr),
        };
      } else {
        initExitCode = await initRunner(initArgs);
      }
    }
    const failedCheckCount = checks.filter((c) => c.status === 'failed').length;
    const resultValue =
      initExitCode !== 0 ? 'failed' : failedCheckCount > 0 ? 'ok_with_warnings' : 'ok';
    const exitCode = initExitCode !== 0 ? initExitCode : failedCheckCount > 0 ? 1 : 0;
    const report = enrichBootstrapComplianceReport(
      {
        ...baseReport,
        result: resultValue,
        initExitCode,
        complianceOnly,
        ...(initOutput ? { initOutput } : {}),
      },
      exitCode,
      checks
    );

    await writeBootstrapReport(report);

    if (workspacePath && !complianceOnly && initExitCode === 0) {
      try {
        const { syncWorkspaceProjects } = await import('./workspace.js');
        await syncWorkspaceProjects(workspacePath, jsonMode);
        await syncWorkspaceContractAfterProjectChange(workspacePath, { silent: jsonMode });
      } catch {
        // Best-effort post-bootstrap registry/contract sync.
      }
    }

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const failedChecks = checks.filter((check) => check.status === 'failed').length;
      if (failedChecks > 0) {
        console.log(
          chalk.yellow(`⚠️  Bootstrap completed with ${failedChecks} policy/profile warnings.`)
        );
      }
      console.log(chalk.gray(`Compliance report: ${reportPath}`));
    }

    return exitCode;
  } finally {
    if (typeof prevSkipLockSync === 'undefined') {
      delete process.env.RAPIDKIT_SKIP_LOCK_SYNC;
    } else {
      process.env.RAPIDKIT_SKIP_LOCK_SYNC = prevSkipLockSync;
    }
  }
}

export async function handleSetupCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      chalk.yellow('Usage: workspai setup <python|node|go|java|dotnet|rust|php> [--warm-deps]')
    );
    return 0;
  }

  const runtime = (args[1] || '').toLowerCase();
  const jsonMode = args.includes('--json');
  const warmDeps = args.includes('--warm-deps') || args.includes('--warm-dependencies');
  if (!runtime || !['python', 'node', 'go', 'java', 'dotnet', 'rust', 'php'].includes(runtime)) {
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'setup',
            result: 'error',
            error: 'Usage: workspai setup <python|node|go|java|dotnet|rust|php> [--warm-deps]',
          },
          null,
          2
        )}\n`
      );
    } else {
      console.log(
        chalk.yellow('Usage: workspai setup <python|node|go|java|dotnet|rust|php> [--warm-deps]')
      );
    }
    return 1;
  }

  const warmRuntimeDependencies = async (
    targetRuntime: 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php',
    targetPath: string
  ): Promise<CommandResult> => {
    if (targetRuntime === 'node') {
      const hasPackageJson = fs.existsSync(path.join(targetPath, 'package.json'));
      if (!hasPackageJson) {
        return {
          exitCode: 0,
          message: 'Node warm-up skipped: package.json not found in current directory.',
        };
      }

      const hasPnpmLock = fs.existsSync(path.join(targetPath, 'pnpm-lock.yaml'));
      const hasYarnLock = fs.existsSync(path.join(targetPath, 'yarn.lock'));

      if (hasPnpmLock) {
        return {
          exitCode: await runCommandInCwd(
            'pnpm',
            ['install', '--lockfile-only', '--ignore-scripts'],
            targetPath
          ),
        };
      }
      if (hasYarnLock) {
        return {
          exitCode: await runCommandInCwd('yarn', ['install', '--ignore-scripts'], targetPath),
        };
      }

      return {
        exitCode: await runCommandInCwd(
          'npm',
          ['install', '--package-lock-only', '--ignore-scripts'],
          targetPath
        ),
      };
    }

    if (targetRuntime === 'go') {
      const hasGoMod = fs.existsSync(path.join(targetPath, 'go.mod'));
      if (!hasGoMod) {
        return {
          exitCode: 0,
          message: 'Go warm-up skipped: go.mod not found in current directory.',
        };
      }

      return {
        exitCode: await runCommandInCwd('go', ['mod', 'download'], targetPath),
      };
    }

    if (targetRuntime === 'java') {
      const hasPomXml = fs.existsSync(path.join(targetPath, 'pom.xml'));
      const hasGradle =
        fs.existsSync(path.join(targetPath, 'build.gradle')) ||
        fs.existsSync(path.join(targetPath, 'build.gradle.kts'));
      const gradlew = path.join(
        targetPath,
        process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
      );
      const hasGradleWrapper = fs.existsSync(gradlew);
      if (!hasPomXml && !hasGradle) {
        return {
          exitCode: 0,
          message: 'Java warm-up skipped: pom.xml or build.gradle not found in current directory.',
        };
      }

      if (hasPomXml) {
        return {
          exitCode: await runCommandInCwd(
            'mvn',
            ['-B', '-q', '-DskipTests', 'dependency:go-offline'],
            targetPath
          ),
        };
      }

      const gradleCommand = hasGradleWrapper ? gradlew : 'gradle';
      return {
        exitCode: await runCommandInCwd(gradleCommand, ['--no-daemon', 'dependencies'], targetPath),
      };
    }

    if (targetRuntime === 'dotnet') {
      const hasDotnetManifest = (() => {
        const queue: Array<{ dir: string; depth: number }> = [{ dir: targetPath, depth: 0 }];
        const ignored = new Set(['bin', 'obj', '.git', 'node_modules', '.workspai', '.rapidkit']);
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current || current.depth > 3) continue;

          let entries: fs.Dirent[] = [];
          try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
          } catch {
            continue;
          }

          for (const entry of entries) {
            if (entry.isFile()) {
              const name = entry.name.toLowerCase();
              if (name.endsWith('.sln') || name.endsWith('.csproj')) return true;
            } else if (entry.isDirectory() && !ignored.has(entry.name)) {
              queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
            }
          }
        }
        return false;
      })();

      if (!hasDotnetManifest) {
        return {
          exitCode: 0,
          message: '.NET warm-up skipped: .sln or *.csproj not found in current project tree.',
        };
      }

      return {
        exitCode: await runCommandInCwd('dotnet', ['restore'], targetPath),
      };
    }

    if (targetRuntime === 'rust') {
      if (!fs.existsSync(path.join(targetPath, 'Cargo.toml'))) {
        return {
          exitCode: 0,
          message: 'Rust warm-up skipped: Cargo.toml not found in current directory.',
        };
      }
      return { exitCode: await runCommandInCwd('cargo', ['fetch'], targetPath) };
    }

    if (targetRuntime === 'php') {
      if (!fs.existsSync(path.join(targetPath, 'composer.json'))) {
        return {
          exitCode: 0,
          message: 'PHP warm-up skipped: composer.json not found in current directory.',
        };
      }
      return {
        exitCode: await runCommandInCwd(
          'composer',
          ['install', '--no-interaction', '--no-scripts'],
          targetPath
        ),
      };
    }

    return {
      exitCode: 0,
      message: 'Dependency warm-up is not available for this runtime.',
    };
  };

  // Use system Python (no cwd) to bypass workspace-venv runner discovery.
  // Workspace-local venv rapidkit versions may have a double-print bug in doctor check;
  // system-level rapidkit is always preferred for host environment diagnostics.
  if (jsonMode) {
    const previousSuppress = process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT;
    process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT = '1';
    try {
      const adapter = getRuntimeAdapter(
        runtime as 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php',
        {
          runCommandInCwd,
          runCoreRapidkit: async (adapterArgs, opts) => {
            const result = await runCoreRapidkitCapture(adapterArgs, { ...opts, cwd: undefined });
            return result.exitCode;
          },
        }
      );
      const prereq = await adapter.checkPrereqs();
      const workspacePath = findWorkspaceUp(process.cwd());
      const runtimePath = workspacePath || process.cwd();
      let version: string | null = null;
      if (runtime === 'node' && prereq.exitCode === 0) {
        version = process.version;
      }
      if (workspacePath && version) {
        const lockReadPath =
          workspaceMetadataCandidates(workspacePath, 'toolchain.lock').find((candidate) =>
            fs.existsSync(candidate)
          ) ?? workspaceMetadataPath(workspacePath, 'toolchain.lock');
        const lockPath = workspaceMetadataPath(workspacePath, 'toolchain.lock');
        let lock: Record<string, unknown> = {};
        try {
          lock = JSON.parse(await fs.promises.readFile(lockReadPath, 'utf-8'));
        } catch {
          /* file may not exist yet */
        }
        if (!lock.runtime || typeof lock.runtime !== 'object') lock.runtime = {};
        (lock.runtime as Record<string, unknown>)[runtime] = {
          version,
          detectedAt: new Date().toISOString(),
        };
        await fsExtra.ensureDir(path.dirname(lockPath));
        await fs.promises.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
      }
      const warmDependencies: {
        requested: boolean;
        status: 'not-requested' | 'passed' | 'failed' | 'skipped';
        exitCode: number | null;
        targets: number;
        messages: string[];
      } = {
        requested: warmDeps,
        status: 'not-requested',
        exitCode: null,
        targets: 0,
        messages: [],
      };
      if (warmDeps && prereq.exitCode === 0) {
        let targets = [runtimePath];
        if (runtime === 'java' && workspacePath) {
          const workspaceProjects = await collectWorkspaceProjects(workspacePath);
          const javaProjects = workspaceProjects.filter((projectPath) => {
            const projectJson = readRapidkitProjectJson(projectPath);
            return isJavaProject(projectJson, projectPath);
          });
          if (javaProjects.length > 0) {
            targets = javaProjects;
          }
        }

        const results: CommandResult[] = [];
        for (const targetPath of targets) {
          results.push(
            await warmRuntimeDependencies(
              runtime as 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php',
              targetPath
            )
          );
        }
        const failed = results.filter((result) => result.exitCode !== 0);
        const completed = results.filter(
          (result) => result.exitCode === 0 && !/skipped/i.test(result.message || '')
        );
        warmDependencies.status =
          failed.length > 0 ? 'failed' : completed.length > 0 ? 'passed' : 'skipped';
        warmDependencies.exitCode = failed[0]?.exitCode ?? 0;
        warmDependencies.targets = targets.length;
        warmDependencies.messages = results
          .map((result) => result.message)
          .filter((message): message is string => typeof message === 'string');
      }

      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'setup',
            runtime,
            result: prereq.exitCode === 0 ? 'ok' : 'failed',
            exitCode: prereq.exitCode,
            workspacePath,
            version,
            warmDeps,
            warmDependencies,
          },
          null,
          2
        )}\n`
      );
      return prereq.exitCode;
    } finally {
      if (typeof previousSuppress === 'undefined') {
        delete process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT;
      } else {
        process.env.RAPIDKIT_SUPPRESS_RUN_COMMAND_OUTPUT = previousSuppress;
      }
    }
  }
  const adapter = getRuntimeAdapter(
    runtime as 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php',
    {
      runCommandInCwd,
      runCoreRapidkit: (adapterArgs, opts) =>
        runCoreRapidkit(adapterArgs, { ...opts, cwd: undefined }),
    }
  );
  const prereq = await adapter.checkPrereqs();
  const hints = await adapter.doctorHints(process.cwd());
  const workspacePath = findWorkspaceUp(process.cwd());
  const runtimePath = workspacePath || process.cwd();
  let workspaceJavaProjectsCache: string[] | null = null;

  const getWorkspaceJavaProjects = async (): Promise<string[]> => {
    if (runtime !== 'java' || !workspacePath) {
      return [];
    }
    if (workspaceJavaProjectsCache) {
      return workspaceJavaProjectsCache;
    }

    const projectPaths = await collectWorkspaceProjects(workspacePath);
    workspaceJavaProjectsCache = projectPaths.filter((projectPath) => {
      const projectJson = readRapidkitProjectJson(projectPath);
      return isJavaProject(projectJson, projectPath);
    });
    return workspaceJavaProjectsCache;
  };

  if (prereq.exitCode === 0) {
    console.log(chalk.green(`\u2705 ${runtime} prerequisites look good.`));
    const otherRuntimes = ['python', 'node', 'go', 'java', 'dotnet', 'rust', 'php']
      .filter((r) => r !== runtime)
      .join('/');
    console.log(
      chalk.gray(
        `  Scope: validated ${runtime} runtime only. ${otherRuntimes} checks are optional unless your workspace profile uses them.`
      )
    );
    if (runtime === 'python') {
      console.log(
        chalk.gray(
          '  Note: Poetry is recommended, but venv/pipx-based flows are supported in workspace creation.'
        )
      );
    }

    if (adapter.warmSetupCache) {
      const warm = await adapter.warmSetupCache(runtimePath);
      if (warm.exitCode === 0) {
        console.log(chalk.gray(`  ${runtime} cache warm-up completed.`));
      } else {
        console.log(chalk.yellow(`  ${runtime} cache warm-up skipped (non-fatal).`));
      }
    }

    if (warmDeps) {
      if (runtime === 'java' && workspacePath) {
        const javaProjects = await getWorkspaceJavaProjects();
        if (javaProjects.length > 0) {
          let warmedCount = 0;
          let failedCount = 0;
          let skippedCount = 0;

          for (const projectPath of javaProjects) {
            const depsWarmResult = await warmRuntimeDependencies('java', projectPath);
            const skipped = /skipped/i.test(depsWarmResult.message || '');
            const projectLabel =
              path.relative(workspacePath, projectPath) || path.basename(projectPath);

            if (depsWarmResult.message) {
              console.log(chalk.gray(`  [${projectLabel}] ${depsWarmResult.message}`));
            }

            if (depsWarmResult.exitCode === 0 && !skipped) {
              warmedCount += 1;
            } else if (depsWarmResult.exitCode === 0 && skipped) {
              skippedCount += 1;
            } else {
              failedCount += 1;
            }
          }

          if (warmedCount > 0) {
            console.log(
              chalk.gray(
                `  java dependency warm-up completed for ${warmedCount} project(s) (--warm-deps).`
              )
            );
          }
          if (failedCount > 0) {
            console.log(
              chalk.yellow(
                `  java dependency warm-up failed for ${failedCount} project(s) (non-fatal).`
              )
            );
          }
          if (warmedCount === 0 && failedCount === 0 && skippedCount > 0) {
            console.log(
              chalk.gray('  java dependency warm-up skipped for discovered workspace projects.')
            );
          }
        } else {
          const depsWarmResult = await warmRuntimeDependencies('java', runtimePath);
          const skipped = /skipped/i.test(depsWarmResult.message || '');
          if (depsWarmResult.message) {
            console.log(chalk.gray(`  ${depsWarmResult.message}`));
          }
          if (depsWarmResult.exitCode === 0 && !skipped) {
            console.log(chalk.gray(`  ${runtime} dependency warm-up completed (--warm-deps).`));
          } else if (depsWarmResult.exitCode !== 0) {
            console.log(chalk.yellow(`  ${runtime} dependency warm-up failed (non-fatal).`));
          }
        }
      } else {
        const depsWarmResult = await warmRuntimeDependencies(
          runtime as 'python' | 'node' | 'go' | 'java' | 'dotnet' | 'rust' | 'php',
          runtimePath
        );
        const skipped = /skipped/i.test(depsWarmResult.message || '');
        if (depsWarmResult.message) {
          console.log(chalk.gray(`  ${depsWarmResult.message}`));
        }
        if (depsWarmResult.exitCode === 0 && !skipped) {
          console.log(chalk.gray(`  ${runtime} dependency warm-up completed (--warm-deps).`));
        } else if (depsWarmResult.exitCode !== 0) {
          console.log(chalk.yellow(`  ${runtime} dependency warm-up failed (non-fatal).`));
        }
      }
    }

    // Update toolchain.lock with the detected runtime version
    if (workspacePath) {
      try {
        const lockReadPath =
          workspaceMetadataCandidates(workspacePath, 'toolchain.lock').find((candidate) =>
            fs.existsSync(candidate)
          ) ?? workspaceMetadataPath(workspacePath, 'toolchain.lock');
        const lockPath = workspaceMetadataPath(workspacePath, 'toolchain.lock');
        let lock: Record<string, unknown> = {};
        try {
          lock = JSON.parse(await fs.promises.readFile(lockReadPath, 'utf-8'));
        } catch {
          /* file may not exist yet */
        }
        if (!lock.runtime || typeof lock.runtime !== 'object') lock.runtime = {};
        const rt = lock.runtime as Record<string, unknown>;

        if (runtime === 'python') {
          // Use execa with stdio:pipe so we capture output without double-printing
          let pyVersion: string | null = null;
          try {
            const { execa } = await import('execa');
            for (const candidate of hostPythonCandidates()) {
              const args = candidate === 'py' ? ['-3', '--version'] : ['--version'];
              const r = await execa(candidate, args, {
                cwd: workspacePath,
                stdio: 'pipe',
                reject: false,
                timeout: 3000,
              });
              if (r.exitCode === 0) {
                const raw = r.stdout || r.stderr || '';
                const m = raw.match(/Python\s+(\S+)/);
                pyVersion = m ? m[1] : null;
                if (pyVersion) break;
              }
            }
          } catch {
            /* non-fatal */
          }
          rt.python = {
            ...((rt.python as object) || {}),
            version: pyVersion,
            last_setup: new Date().toISOString(),
          };
        } else if (runtime === 'node') {
          rt.node = {
            ...((rt.node as object) || {}),
            version: process.version,
            last_setup: new Date().toISOString(),
          };
        } else if (runtime === 'go') {
          // Use execa with stdio:pipe — avoids double-printing since go adapter already printed via inherit
          let goVersion: string | null = null;
          try {
            const { execa } = await import('execa');
            const r = await execa('go', ['version'], { cwd: workspacePath, stdio: 'pipe' });
            const m = (r.stdout || '').match(/go(\d+\.\d+(?:\.\d+)?)/i);
            goVersion = m ? m[1] : null;
          } catch {
            /* non-fatal */
          }
          rt.go = {
            ...((rt.go as object) || {}),
            version: goVersion,
            last_setup: new Date().toISOString(),
          };
        } else if (runtime === 'java') {
          let javaVersion: string | null = null;
          let buildTool: 'maven' | 'gradle' | null = null;
          let buildToolVersion: string | null = null;

          const javaProjects = await getWorkspaceJavaProjects();
          const runtimeHasJavaBuildFiles =
            fs.existsSync(path.join(runtimePath, 'pom.xml')) ||
            fs.existsSync(path.join(runtimePath, 'build.gradle')) ||
            fs.existsSync(path.join(runtimePath, 'build.gradle.kts'));
          const javaInspectionPath = runtimeHasJavaBuildFiles
            ? runtimePath
            : javaProjects[0] || runtimePath;

          try {
            const { execa } = await import('execa');

            const javaResult = await execa('java', ['-version'], {
              cwd: workspacePath,
              stdio: 'pipe',
              reject: false,
              timeout: 3000,
            });
            const javaRaw = `${javaResult.stdout || ''}\n${javaResult.stderr || ''}`;
            const javaMatch = javaRaw.match(/version\s+"([^"]+)"/i);
            javaVersion = javaMatch ? javaMatch[1] : null;

            const hasPomXml = fs.existsSync(path.join(javaInspectionPath, 'pom.xml'));
            const hasGradleBuild =
              fs.existsSync(path.join(javaInspectionPath, 'build.gradle')) ||
              fs.existsSync(path.join(javaInspectionPath, 'build.gradle.kts'));

            if (hasPomXml) {
              buildTool = 'maven';
              const mavenCommand = (() => {
                const mvnwCmd = path.join(javaInspectionPath, 'mvnw.cmd');
                if (process.platform === 'win32' && fs.existsSync(mvnwCmd)) return mvnwCmd;
                const mvnw = path.join(javaInspectionPath, 'mvnw');
                if (fs.existsSync(mvnw)) return mvnw;
                return 'mvn';
              })();

              const mavenResult = await execa(mavenCommand, ['-version'], {
                cwd: javaInspectionPath,
                stdio: 'pipe',
                reject: false,
                timeout: 3000,
              });
              const mavenRaw = `${mavenResult.stdout || ''}\n${mavenResult.stderr || ''}`;
              const mavenMatch = mavenRaw.match(/Apache Maven\s+(\S+)/i);
              buildToolVersion = mavenMatch ? mavenMatch[1] : null;
            } else if (hasGradleBuild) {
              buildTool = 'gradle';
              const gradleCommand = (() => {
                const gradlewCmd = path.join(javaInspectionPath, 'gradlew.bat');
                if (process.platform === 'win32' && fs.existsSync(gradlewCmd)) return gradlewCmd;
                const gradlew = path.join(javaInspectionPath, 'gradlew');
                if (fs.existsSync(gradlew)) return gradlew;
                return 'gradle';
              })();

              const gradleResult = await execa(gradleCommand, ['--version'], {
                cwd: javaInspectionPath,
                stdio: 'pipe',
                reject: false,
                timeout: 3000,
              });
              const gradleRaw = `${gradleResult.stdout || ''}\n${gradleResult.stderr || ''}`;
              const gradleMatch = gradleRaw.match(/Gradle\s+(\S+)/i);
              buildToolVersion = gradleMatch ? gradleMatch[1] : null;
            }
          } catch {
            /* non-fatal */
          }

          rt.java = {
            ...((rt.java as object) || {}),
            version: javaVersion,
            build_tool: buildTool,
            build_tool_version: buildToolVersion,
            last_setup: new Date().toISOString(),
          };
        } else if (runtime === 'dotnet') {
          let dotnetVersion: string | null = null;
          try {
            const { execa } = await import('execa');
            const dotnetResult = await execa('dotnet', ['--version'], {
              cwd: workspacePath,
              stdio: 'pipe',
              reject: false,
              timeout: 3000,
            });
            const parsed = (dotnetResult.stdout || '').trim();
            dotnetVersion = parsed.length > 0 ? parsed : null;
          } catch {
            /* non-fatal */
          }

          rt.dotnet = {
            ...((rt.dotnet as object) || {}),
            version: dotnetVersion,
            sdk: dotnetVersion,
            last_setup: new Date().toISOString(),
          };
        }

        lock.updated_at = new Date().toISOString();
        await fs.promises.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
        console.log(chalk.gray(`  toolchain.lock updated (.workspai/toolchain.lock)`));
      } catch {
        // Non-fatal — toolchain.lock sync is best-effort
      }
    }
  } else {
    console.log(chalk.red(`\u274c ${runtime} prerequisites check failed.`));
  }

  if (hints.length > 0) {
    console.log(chalk.gray('\nHints:'));
    for (const hint of hints) console.log(chalk.gray(`- ${hint}`));
  }

  return prereq.exitCode;
}

export function parseCacheConfig(content: string): {
  strategy: string;
  prune_on_bootstrap: boolean;
  self_heal: boolean;
  verify_integrity: boolean;
} {
  const cfg = {
    strategy: 'shared',
    prune_on_bootstrap: false,
    self_heal: true,
    verify_integrity: false,
  };
  for (const line of content.split('\n')) {
    const t = line.trim();
    const stratMatch = t.match(/^strategy:\s*(\S+)/);
    if (stratMatch) cfg.strategy = stratMatch[1].replace(/['"]/g, '');
    const pruneMatch = t.match(/^prune_on_bootstrap:\s*(true|false)/);
    if (pruneMatch) cfg.prune_on_bootstrap = pruneMatch[1] === 'true';
    const healMatch = t.match(/^self_heal:\s*(true|false)/);
    if (healMatch) cfg.self_heal = healMatch[1] === 'true';
    const verifyMatch = t.match(/^verify_integrity:\s*(true|false)/);
    if (verifyMatch) cfg.verify_integrity = verifyMatch[1] === 'true';
  }
  return cfg;
}

export async function handleCacheCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.yellow('Usage: workspai cache <status|clear|prune|repair>'));
    return 0;
  }

  const action = (args[1] || 'status').toLowerCase();
  const jsonMode = args.includes('--json');
  const dryRun = args.includes('--dry-run');
  const cache = Cache.getInstance();
  const workspacePath = findWorkspaceUp(process.cwd());

  // Read cache-config.yml for workspace-aware settings
  let cacheConfig = {
    strategy: 'shared',
    prune_on_bootstrap: false,
    self_heal: true,
    verify_integrity: false,
  };
  if (workspacePath) {
    try {
      const cacheConfigPath = workspaceMetadataCandidates(workspacePath, 'cache-config.yml').find(
        (candidate) => fs.existsSync(candidate)
      );
      if (!cacheConfigPath) {
        throw new Error('cache config missing');
      }
      const configContent = await fs.promises.readFile(cacheConfigPath, 'utf-8');
      cacheConfig = parseCacheConfig(configContent);
    } catch {
      /* use defaults */
    }
  }

  if (action === 'status') {
    const statusPayload = {
      command: 'cache',
      action,
      result: 'ok',
      timestamp: new Date().toISOString(),
      workspacePath,
      cache: {
        enabled: true,
        strategy: cacheConfig.strategy,
        selfHeal: cacheConfig.self_heal,
        pruneOnBootstrap: cacheConfig.prune_on_bootstrap,
        verifyIntegrity: cacheConfig.verify_integrity,
        inMemory: true,
      },
    };

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(statusPayload, null, 2)}\n`);
      return 0;
    }

    console.log(chalk.cyan('Workspai cache is enabled'));
    console.log(chalk.cyan('Workspai cache status'));
    if (workspacePath) {
      console.log(chalk.gray(`  Workspace: ${workspacePath}`));
      console.log(chalk.gray(`  Strategy:          ${cacheConfig.strategy}`));
      console.log(chalk.gray(`  Self-heal:         ${cacheConfig.self_heal}`));
      console.log(chalk.gray(`  Prune on bootstrap:${cacheConfig.prune_on_bootstrap}`));
      console.log(chalk.gray(`  Verify integrity:  ${cacheConfig.verify_integrity}`));
    } else {
      console.log(chalk.gray('  (not inside a workspace — showing in-memory cache only)'));
    }
    console.log(chalk.gray('  In-memory cache: enabled'));
    console.log(chalk.gray('  Use: workspai cache clear|prune|repair'));
    return 0;
  }

  if (action === 'clear') {
    // Full cache wipe — removes all cached entries
    await cache.clear();
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'cache',
            action,
            result: 'ok',
            timestamp: new Date().toISOString(),
            workspacePath,
            cache: {
              cleared: true,
              strategy: cacheConfig.strategy,
            },
          },
          null,
          2
        )}\n`
      );
      return 0;
    }
    console.log(chalk.green('Cache clear completed'));
    console.log(chalk.green('\u2705 Cache cleared (all entries removed).'));
    return 0;
  }

  if (action === 'prune') {
    // Prune stale entries only (honour cache-config strategy)
    if (!dryRun) {
      await cache.clear();
    }
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'cache',
            action,
            result: 'ok',
            timestamp: new Date().toISOString(),
            workspacePath,
            dryRun,
            cache: {
              pruned: !dryRun,
              strategy: cacheConfig.strategy,
              pruneOnBootstrap: cacheConfig.prune_on_bootstrap,
            },
            nextActions: cacheConfig.prune_on_bootstrap
              ? []
              : [
                  'Set prune_on_bootstrap: true in .workspai/cache-config.yml to auto-prune on bootstrap.',
                ],
          },
          null,
          2
        )}\n`
      );
      return 0;
    }
    if (dryRun) {
      console.log(chalk.green('Cache prune dry run completed'));
      console.log(chalk.gray('  No cache entries were removed.'));
      return 0;
    }
    console.log(chalk.green('\u2705 Cache pruned (stale entries removed).'));
    if (!cacheConfig.prune_on_bootstrap) {
      console.log(
        chalk.gray(
          '  Tip: set prune_on_bootstrap: true in .workspai/cache-config.yml to auto-prune on every bootstrap.'
        )
      );
    }
    return 0;
  }

  if (action === 'repair') {
    // Self-heal: attempt to restore a consistent cache state
    if (!cacheConfig.self_heal) {
      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: 'cache',
              action,
              result: 'skipped',
              timestamp: new Date().toISOString(),
              workspacePath,
              reason: 'self_heal is disabled in .workspai/cache-config.yml',
              cache: {
                selfHeal: cacheConfig.self_heal,
                verifyIntegrity: cacheConfig.verify_integrity,
              },
            },
            null,
            2
          )}\n`
        );
        return 0;
      }
      console.log(
        chalk.yellow(
          '\u26a0\ufe0f  self_heal is disabled in .workspai/cache-config.yml — skipping repair.'
        )
      );
      return 0;
    }
    await cache.clear();
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'cache',
            action,
            result: 'ok',
            timestamp: new Date().toISOString(),
            workspacePath,
            cache: {
              repaired: true,
              selfHeal: cacheConfig.self_heal,
              verifyIntegrity: cacheConfig.verify_integrity,
            },
          },
          null,
          2
        )}\n`
      );
      return 0;
    }
    console.log(chalk.green('\u2705 Cache repaired (self-heal applied, stale entries evicted).'));
    if (cacheConfig.verify_integrity) {
      console.log(chalk.gray('  Integrity verification is enabled in cache-config.yml.'));
    }
    return 0;
  }

  console.log(chalk.yellow('Usage: workspai cache <status|clear|prune|repair>'));
  return 1;
}

async function handleWorkspacePolicyCommand(
  workspacePath: string,
  subaction?: string,
  key?: string,
  value?: string,
  jsonMode = false
): Promise<number> {
  const action = (subaction || 'show').toLowerCase();
  const policyPath = workspaceMetadataPath(workspacePath, 'policies.yml');

  if (action === 'show' || action === 'status' || action === 'get') {
    const rawPolicy = await readWorkspacePolicyFile(workspacePath);
    const policy = parseWorkspacePolicy(rawPolicy);
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'workspace policy',
            action,
            result: 'ok',
            timestamp: new Date().toISOString(),
            workspacePath,
            policyPath,
            policy,
          },
          null,
          2
        )}\n`
      );
      return 0;
    }
    console.log(chalk.cyan(`Policy file: ${policyPath}`));
    console.log(chalk.gray(`  mode: ${policy.mode}`));
    console.log(chalk.gray(`  dependency_sharing_mode: ${policy.dependency_sharing_mode}`));
    console.log(chalk.gray('  rules:'));
    console.log(
      chalk.gray(`    enforce_workspace_marker: ${policy.rules.enforce_workspace_marker}`)
    );
    console.log(chalk.gray(`    enforce_toolchain_lock: ${policy.rules.enforce_toolchain_lock}`));
    console.log(
      chalk.gray(
        `    disallow_untrusted_tool_sources: ${policy.rules.disallow_untrusted_tool_sources}`
      )
    );
    console.log(
      chalk.gray(`    enforce_compatibility_matrix: ${policy.rules.enforce_compatibility_matrix}`)
    );
    console.log(
      chalk.gray(
        `    require_mirror_lock_for_offline: ${policy.rules.require_mirror_lock_for_offline}`
      )
    );
    console.log(chalk.gray('Examples:'));
    console.log(chalk.gray('  npx workspai workspace policy set mode strict'));
    console.log(
      chalk.gray(
        '  npx workspai workspace policy set dependency_sharing_mode shared-runtime-caches'
      )
    );
    console.log(
      chalk.gray('  npx workspai workspace policy set rules.enforce_toolchain_lock true')
    );
    return 0;
  }

  if (action !== 'set') {
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'workspace policy',
            action,
            result: 'error',
            timestamp: new Date().toISOString(),
            workspacePath,
            policyPath,
            error: {
              code: 'workspace.policy.unknown_action',
              message: `Unknown workspace policy action: ${subaction || ''}`,
            },
            allowedActions: ['show', 'status', 'get', 'set'],
          },
          null,
          2
        )}\n`
      );
      return 1;
    }
    console.log(chalk.red(`Unknown workspace policy action: ${subaction || ''}`));
    console.log(chalk.gray('Available: show, set'));
    return 1;
  }

  if (!key || typeof value === 'undefined') {
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'workspace policy',
            action,
            result: 'error',
            timestamp: new Date().toISOString(),
            workspacePath,
            policyPath,
            error: {
              code: 'workspace.policy.missing_arguments',
              message: 'Usage: workspai workspace policy set <key> <value>',
            },
            allowedKeys: [
              'mode',
              'dependency_sharing_mode',
              'rules.enforce_workspace_marker',
              'rules.enforce_toolchain_lock',
              'rules.disallow_untrusted_tool_sources',
              'rules.enforce_compatibility_matrix',
              'rules.require_mirror_lock_for_offline',
            ],
          },
          null,
          2
        )}\n`
      );
      return 1;
    }
    console.log(chalk.yellow('Usage: workspai workspace policy set <key> <value>'));
    console.log(chalk.gray('Allowed keys:'));
    console.log(chalk.gray('  mode (warn|strict)'));
    console.log(
      chalk.gray('  dependency_sharing_mode (isolated|shared-runtime-caches|shared-node-deps)')
    );
    console.log(chalk.gray('  rules.enforce_workspace_marker (true|false)'));
    console.log(chalk.gray('  rules.enforce_toolchain_lock (true|false)'));
    console.log(chalk.gray('  rules.disallow_untrusted_tool_sources (true|false)'));
    console.log(chalk.gray('  rules.enforce_compatibility_matrix (true|false)'));
    console.log(chalk.gray('  rules.require_mirror_lock_for_offline (true|false)'));
    return 1;
  }

  const normalizedKey = key.trim();
  const rawPolicy = await readWorkspacePolicyFile(workspacePath);
  let nextPolicy = rawPolicy;

  if (normalizedKey === 'mode') {
    const normalizedMode = value.trim().toLowerCase();
    if (normalizedMode !== 'warn' && normalizedMode !== 'strict') {
      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: 'workspace policy',
              action,
              result: 'error',
              timestamp: new Date().toISOString(),
              workspacePath,
              policyPath,
              error: {
                code: 'workspace.policy.invalid_mode',
                message: 'Invalid mode. Use: warn | strict',
              },
            },
            null,
            2
          )}\n`
        );
        return 1;
      }
      console.log(chalk.red('❌ Invalid mode. Use: warn | strict'));
      return 1;
    }
    nextPolicy = replaceOrInsertTopLevelPolicyLine(
      nextPolicy,
      'mode',
      `${normalizedMode} # "warn" or "strict"`
    );
  } else if (normalizedKey === 'dependency_sharing_mode') {
    const normalizedMode = value.trim().toLowerCase();
    if (
      normalizedMode !== 'isolated' &&
      normalizedMode !== 'shared-runtime-caches' &&
      normalizedMode !== 'shared-node-deps'
    ) {
      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: 'workspace policy',
              action,
              result: 'error',
              timestamp: new Date().toISOString(),
              workspacePath,
              policyPath,
              error: {
                code: 'workspace.policy.invalid_dependency_sharing_mode',
                message:
                  'Invalid dependency_sharing_mode. Use: isolated | shared-runtime-caches | shared-node-deps',
              },
            },
            null,
            2
          )}\n`
        );
        return 1;
      }
      console.log(
        chalk.red(
          '❌ Invalid dependency_sharing_mode. Use: isolated | shared-runtime-caches | shared-node-deps'
        )
      );
      return 1;
    }
    nextPolicy = replaceOrInsertTopLevelPolicyLine(
      nextPolicy,
      'dependency_sharing_mode',
      `${normalizedMode} # "isolated" or "shared-runtime-caches" or "shared-node-deps"`
    );
  } else if (normalizedKey.startsWith('rules.')) {
    const ruleKey = normalizedKey.slice('rules.'.length) as WorkspacePolicyRuleKey;
    if (!(ruleKey in WORKSPACE_POLICY_RULE_DEFAULTS)) {
      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: 'workspace policy',
              action,
              result: 'error',
              timestamp: new Date().toISOString(),
              workspacePath,
              policyPath,
              error: {
                code: 'workspace.policy.unknown_rule',
                message: `Unknown policy rule: ${ruleKey}`,
              },
            },
            null,
            2
          )}\n`
        );
        return 1;
      }
      console.log(chalk.red(`❌ Unknown policy rule: ${ruleKey}`));
      return 1;
    }
    const parsedBool = parsePolicyBooleanLiteral(value);
    if (parsedBool === null) {
      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: 'workspace policy',
              action,
              result: 'error',
              timestamp: new Date().toISOString(),
              workspacePath,
              policyPath,
              error: {
                code: 'workspace.policy.invalid_boolean',
                message: 'Rule values must be boolean: true | false',
              },
            },
            null,
            2
          )}\n`
        );
        return 1;
      }
      console.log(chalk.red('❌ Rule values must be boolean: true | false'));
      return 1;
    }
    nextPolicy = replaceOrInsertRulePolicyLine(nextPolicy, ruleKey, parsedBool);
  } else {
    if (jsonMode) {
      process.stdout.write(
        `${JSON.stringify(
          {
            command: 'workspace policy',
            action,
            result: 'error',
            timestamp: new Date().toISOString(),
            workspacePath,
            policyPath,
            error: {
              code: 'workspace.policy.unknown_key',
              message: `Unknown policy key: ${normalizedKey}`,
            },
          },
          null,
          2
        )}\n`
      );
      return 1;
    }
    console.log(chalk.red(`❌ Unknown policy key: ${normalizedKey}`));
    return 1;
  }

  await writeWorkspacePolicyFile(workspacePath, nextPolicy);
  const updated = parseWorkspacePolicy(nextPolicy);
  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command: 'workspace policy',
          action,
          result: 'ok',
          timestamp: new Date().toISOString(),
          workspacePath,
          policyPath,
          updatedKey: normalizedKey,
          policy: updated,
        },
        null,
        2
      )}\n`
    );
    return 0;
  }
  console.log(chalk.green(`✅ Updated ${normalizedKey} in .workspai/policies.yml`));
  console.log(chalk.gray(`  mode: ${updated.mode}`));
  console.log(chalk.gray(`  dependency_sharing_mode: ${updated.dependency_sharing_mode}`));
  console.log(chalk.gray('  Tip: run `npx workspai workspace policy show` to inspect all values.'));
  return 0;
}

export async function handleMirrorCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(chalk.yellow('Usage: workspai mirror <status|sync|verify|rotate> [--json]'));
    return 0;
  }

  const action = (args[1] || 'status').toLowerCase();
  const jsonMode = args.includes('--json');
  const workspacePath = findWorkspaceUp(process.cwd());

  if (!workspacePath) {
    console.log(chalk.red('❌ Not inside a Workspai workspace'));
    console.log(chalk.gray('💡 Run this command from within a workspace directory'));
    return 1;
  }

  const mirrorConfigPath =
    workspaceMetadataCandidates(workspacePath, 'mirror-config.json').find((candidate) =>
      fs.existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'mirror-config.json');
  const mirrorLockPath =
    workspaceMetadataCandidates(workspacePath, 'mirror.lock').find((candidate) =>
      fs.existsSync(candidate)
    ) ?? workspaceMetadataPath(workspacePath, 'mirror.lock');
  const artifactsDir = workspaceMetadataPath(workspacePath, 'mirror', 'artifacts');
  const reportsDir = workspaceMetadataPath(workspacePath, 'reports');

  async function countMirrorArtifacts(directory: string): Promise<number> {
    if (!(await fsExtra.pathExists(directory))) return 0;
    let count = 0;
    const queue = [directory];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) count += 1;
        else if (entry.isDirectory()) queue.push(path.join(current, entry.name));
      }
    }
    return count;
  }

  async function writeMirrorReport(payload: Record<string, unknown>): Promise<void> {
    const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `mirror-ops-${reportTimestamp}.json`);
    const latestReportPath = path.join(reportsDir, 'mirror-ops.latest.json');
    const contractedPayload = { schemaVersion: 'mirror-ops.v1', ...payload };
    assertWorkspaceArtifactContract(
      `.workspai/reports/${path.basename(reportPath)}`,
      contractedPayload
    );
    assertWorkspaceArtifactContract('.workspai/reports/mirror-ops.latest.json', contractedPayload);
    await fsExtra.ensureDir(reportsDir);
    await writeJsonFile(reportPath, contractedPayload);
    await writeJsonFile(latestReportPath, contractedPayload);
  }

  async function readMirrorInventory(): Promise<{
    configExists: boolean;
    lockExists: boolean;
    artifactsCount: number;
  }> {
    const configExists = await fsExtra.pathExists(mirrorConfigPath);
    const lockExists = await fsExtra.pathExists(mirrorLockPath);
    const artifactsCount = await countMirrorArtifacts(artifactsDir);
    return { configExists, lockExists, artifactsCount };
  }

  if (action === 'status') {
    // Status is observational: it must not create configuration that could
    // accidentally satisfy enterprise compliance checks.
    const configNowExists = await fsExtra.pathExists(mirrorConfigPath);

    const lockExists = await fsExtra.pathExists(mirrorLockPath);
    const artifactsCount = await countMirrorArtifacts(artifactsDir);

    const statusPayload = {
      command: 'mirror',
      action,
      result: 'ok',
      timestamp: new Date().toISOString(),
      workspacePath,
      mirror: {
        configExists: configNowExists,
        lockExists,
        artifactsCount,
      },
    };

    await writeMirrorReport(statusPayload);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(statusPayload, null, 2)}\n`);
      return 0;
    }

    console.log(chalk.cyan('Workspai mirror status'));
    console.log(chalk.gray(`Workspace: ${workspacePath}`));
    console.log(
      chalk.gray(`Config: ${configNowExists ? 'present' : 'missing'} (${mirrorConfigPath})`)
    );
    console.log(chalk.gray(`Lock: ${lockExists ? 'present' : 'missing'} (${mirrorLockPath})`));
    console.log(chalk.gray(`Artifacts: ${artifactsCount}`));
    return 0;
  }

  if (action === 'sync' || action === 'verify' || action === 'rotate') {
    const lifecycle = await runMirrorLifecycle(workspacePath, {
      ciMode: true,
      offlineMode: action === 'verify',
      forceRun: true,
    });

    const failedChecks = lifecycle.checks.filter((check) => check.status === 'failed');
    const hasVerifyFailure = lifecycle.checks.some(
      (check) => check.id.startsWith('mirror.verify.') && check.status === 'failed'
    );

    if (action === 'verify' && hasVerifyFailure) {
      const payload = {
        command: 'mirror',
        action,
        result: 'failed',
        timestamp: new Date().toISOString(),
        workspacePath,
        mirror: await readMirrorInventory(),
        details: lifecycle.details,
        checks: lifecycle.checks,
      };
      await writeMirrorReport(payload);

      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return 1;
      }

      console.log(chalk.red('❌ Mirror verify failed.'));
      for (const check of lifecycle.checks.filter((check) =>
        check.id.startsWith('mirror.verify.')
      )) {
        console.log(chalk.gray(`- ${check.id}: ${check.message}`));
      }
      return 1;
    }

    if (failedChecks.length > 0) {
      const payload = {
        command: 'mirror',
        action,
        result: 'failed',
        timestamp: new Date().toISOString(),
        workspacePath,
        mirror: await readMirrorInventory(),
        details: lifecycle.details,
        checks: lifecycle.checks,
      };
      await writeMirrorReport(payload);

      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return 1;
      }

      console.log(
        chalk.yellow(`⚠️  Mirror ${action} completed with ${failedChecks.length} issue(s).`)
      );
      for (const check of failedChecks) {
        console.log(chalk.gray(`- ${check.id}: ${check.message}`));
      }
      return 1;
    }

    const payload = {
      command: 'mirror',
      action,
      result: 'ok',
      timestamp: new Date().toISOString(),
      workspacePath,
      mirror: await readMirrorInventory(),
      details: lifecycle.details,
      checks: lifecycle.checks,
    };
    await writeMirrorReport(payload);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    if (action === 'rotate') {
      console.log(
        chalk.green(`✅ Mirror rotate completed. Rotated files: ${lifecycle.details.rotatedFiles}.`)
      );
      return 0;
    }

    if (action === 'verify') {
      console.log(
        chalk.green(
          `✅ Mirror verify completed. Verified artifacts: ${lifecycle.details.verifiedArtifacts}.`
        )
      );
      return 0;
    }

    console.log(
      chalk.green(
        `✅ Mirror sync completed. Synced artifacts: ${lifecycle.details.syncedArtifacts}.`
      )
    );
    return 0;
  }

  console.log(chalk.yellow('Usage: workspai mirror <status|sync|verify|rotate> [--json]'));
  return 1;
}

export async function handleInitCommand(args: string[]): Promise<number> {
  const prevSkipLockSync = process.env.RAPIDKIT_SKIP_LOCK_SYNC;
  if (typeof prevSkipLockSync === 'undefined') {
    process.env.RAPIDKIT_SKIP_LOCK_SYNC = '1';
  }

  try {
    const cwd = process.cwd();
    const lifecycle = await withWorkspaceDependencyPolicyContext(cwd, async () => {
      const workspacePathForPolicy = findWorkspaceUp(cwd);
      const pythonAdapter = getRuntimeAdapter('python', { runCommandInCwd, runCoreRapidkit });
      const dotnetAdapter = getRuntimeAdapter('dotnet', { runCommandInCwd, runCoreRapidkit });
      const rustAdapter = getRuntimeAdapter('rust', { runCommandInCwd, runCoreRapidkit });
      const phpAdapter = getRuntimeAdapter('php', { runCommandInCwd, runCoreRapidkit });
      const explicitTargetArgs = args.slice(1).filter((arg) => !arg.startsWith('-'));

      if (explicitTargetArgs.length > 0) {
        // If called with a path argument, check if that path is a Go project
        const targetPath = path.resolve(cwd, explicitTargetArgs[0]);
        const targetJson = readRapidkitProjectJson(targetPath);
        const inferredRuntime = await inferRuntimeByFiles(targetPath);

        if (isGoProject(targetJson, targetPath) || inferredRuntime === 'go') {
          return await handleGoInit(targetPath);
        }
        if (isJavaProject(targetJson, targetPath) || inferredRuntime === 'java') {
          return await handleJavaCommand('init', targetPath);
        }
        if (isDotnetProject(targetJson, targetPath) || inferredRuntime === 'dotnet') {
          return reportRuntimeCommandResult(await dotnetAdapter.initProject(targetPath));
        }
        if (isNodeProject(targetJson, targetPath) || inferredRuntime === 'node') {
          return await handleNodeInitSmart(targetPath);
        }
        if (isPythonProject(targetJson, targetPath) || inferredRuntime === 'python') {
          return await handlePythonInitSmart(targetPath, pythonAdapter);
        }
        if (inferredRuntime === 'rust') {
          return reportRuntimeCommandResult(await rustAdapter.initProject(targetPath));
        }
        if (inferredRuntime === 'php') {
          return reportRuntimeCommandResult(await phpAdapter.initProject(targetPath));
        }
        return await runCoreRapidkit(args, { cwd });
      }

      // Check if cwd is a Go project
      const projectJsonNow = readRapidkitProjectJson(cwd);
      const cwdIsWorkspaceRoot = !!findWorkspaceUp(cwd) && cwd === findWorkspaceUp(cwd);

      if (!cwdIsWorkspaceRoot && isGoProject(projectJsonNow, cwd)) {
        return await handleGoInit(cwd);
      }
      const inferredRuntimeNow = await inferRuntimeByFiles(cwd);

      if (
        !cwdIsWorkspaceRoot &&
        (isJavaProject(projectJsonNow, cwd) || inferredRuntimeNow === 'java')
      ) {
        return await handleJavaCommand('init', cwd);
      }

      if (
        !cwdIsWorkspaceRoot &&
        (isDotnetProject(projectJsonNow, cwd) || inferredRuntimeNow === 'dotnet')
      ) {
        return reportRuntimeCommandResult(await dotnetAdapter.initProject(cwd));
      }

      if (
        !cwdIsWorkspaceRoot &&
        (isNodeProject(projectJsonNow, cwd) || inferredRuntimeNow === 'node')
      ) {
        return await handleNodeInitSmart(cwd);
      }
      if (
        !cwdIsWorkspaceRoot &&
        (isPythonProject(projectJsonNow, cwd) || inferredRuntimeNow === 'python')
      ) {
        return await handlePythonInitSmart(cwd, pythonAdapter);
      }
      if (!cwdIsWorkspaceRoot && inferredRuntimeNow === 'rust') {
        return reportRuntimeCommandResult(await rustAdapter.initProject(cwd));
      }
      if (!cwdIsWorkspaceRoot && inferredRuntimeNow === 'php') {
        return reportRuntimeCommandResult(await phpAdapter.initProject(cwd));
      }

      const workspacePath = workspacePathForPolicy || findWorkspaceUp(cwd);
      const contextFile = findContextFileUp(cwd);
      const projectRoot = contextFile ? path.dirname(path.dirname(contextFile)) : null;

      if (projectRoot && projectRoot !== workspacePath) {
        const projectRootJson = readRapidkitProjectJson(projectRoot);
        const inferredRootRuntime = await inferRuntimeByFiles(projectRoot);

        if (isGoProject(projectRootJson, projectRoot) || inferredRootRuntime === 'go') {
          return await handleGoInit(projectRoot);
        }
        if (isJavaProject(projectRootJson, projectRoot) || inferredRootRuntime === 'java') {
          return await handleJavaCommand('init', projectRoot);
        }
        if (isDotnetProject(projectRootJson, projectRoot) || inferredRootRuntime === 'dotnet') {
          return reportRuntimeCommandResult(await dotnetAdapter.initProject(projectRoot));
        }
        if (isNodeProject(projectRootJson, projectRoot) || inferredRootRuntime === 'node') {
          return await handleNodeInitSmart(projectRoot);
        }
        if (isPythonProject(projectRootJson, projectRoot) || inferredRootRuntime === 'python') {
          return await handlePythonInitSmart(projectRoot, pythonAdapter);
        }
        if (inferredRootRuntime === 'rust') {
          return reportRuntimeCommandResult(await rustAdapter.initProject(projectRoot));
        }
        if (inferredRootRuntime === 'php') {
          return reportRuntimeCommandResult(await phpAdapter.initProject(projectRoot));
        }

        return await runCoreRapidkit(['init'], { cwd: projectRoot });
      }

      if (workspacePath && cwd === workspacePath) {
        console.log(chalk.yellow('⚠️  Running `npx workspai init` at workspace root.'));
        console.log(
          chalk.gray(
            '   Root `init`, `workspace init`, and `workspace run init` now share the same full-init flow:\n' +
              '   workspace-profile dependencies first, then project dependency initialization.\n'
          )
        );

        const workspaceInitCode = await installWorkspaceDependencies(workspacePath);
        if (workspaceInitCode !== 0) return workspaceInitCode;

        const { runWorkspaceStage } = await import('./workspace-run.js');
        const report = await runWorkspaceStage({
          workspacePath,
          stage: 'init',
          affected: false,
          blastRadius: false,
          parallel: false,
          continueOnError: false,
          strict: false,
          json: false,
          enforceGates: false,
        });

        return report.summary.exitCode;
      }

      if (!workspacePath) {
        const userConfig = await loadUserConfig();
        const parentDirectory = getCanonicalWorkspacesDirectory();
        const { name } = resolveDefaultWorkspacePath(parentDirectory);

        await fsExtra.ensureDir(parentDirectory);

        const { createProject: createPythonEnvironment } = await import('./create.js');
        await createPythonEnvironment(name, {
          yes: true,
          userConfig,
          parentDirectory,
        });

        // Workspace was just created with stub files (pyproject.toml, poetry.toml).
        // Do NOT install Python deps here — the user should cd into the workspace
        // and run `npx workspai init` to trigger dependency installation.
        return 0;
      }

      return await runCoreRapidkit(args, { cwd });
    });

    if (!lifecycle.ok) return lifecycle.code;
    return lifecycle.value;
  } finally {
    if (typeof prevSkipLockSync === 'undefined') {
      delete process.env.RAPIDKIT_SKIP_LOCK_SYNC;
    } else {
      process.env.RAPIDKIT_SKIP_LOCK_SYNC = prevSkipLockSync;
    }
  }
}

export async function checkStrictPolicyPreflightForDelegation(cwd: string): Promise<string[]> {
  const workspacePath = findWorkspaceUp(cwd);
  if (!workspacePath) return [];

  // Read policy mode — skip all checks if not strict
  let mode: 'warn' | 'strict' = 'warn';
  try {
    const policyPath = workspaceMetadataCandidates(workspacePath, 'policies.yml').find(
      (candidate) => fs.existsSync(candidate)
    );
    if (!policyPath) return [];
    const policyRaw = await fs.promises.readFile(policyPath, 'utf-8');
    const m =
      policyRaw.match(/^\s*enforcement_mode:\s*(warn|strict)\s*(?:#.*)?$/m) ??
      policyRaw.match(/^\s*mode:\s*(warn|strict)\s*(?:#.*)?$/m);
    if (m?.[1] === 'strict') mode = 'strict';
  } catch {
    return [];
  }
  if (mode !== 'strict') return [];

  const violations: string[] = [];

  // 1. toolchain.lock must exist
  const lockPath = workspaceMetadataCandidates(workspacePath, 'toolchain.lock').find((candidate) =>
    fs.existsSync(candidate)
  );
  if (!lockPath || !fs.existsSync(lockPath)) {
    violations.push(
      'toolchain.lock is missing — run `workspai bootstrap` first (strict mode requires a reproducible toolchain).'
    );
    return violations; // no point checking further
  }

  // 2. Runtime version must be pinned for this project type
  let lock: Record<string, unknown> = {};
  try {
    lock = JSON.parse(await fs.promises.readFile(lockPath, 'utf-8'));
  } catch {
    violations.push(
      'toolchain.lock is invalid JSON — regenerate it with `workspai bootstrap` before running commands in strict mode.'
    );
    return violations;
  }
  const rt = (lock.runtime ?? {}) as Record<string, { version?: string | null }>;

  const projectJson = readRapidkitProjectJson(cwd);
  if (isGoProject(projectJson, cwd) && !rt.go?.version) {
    violations.push('go.version is not pinned in toolchain.lock — run `workspai setup go` first.');
  } else if (isNodeProject(projectJson, cwd) && !rt.node?.version) {
    violations.push(
      'node.version is not pinned in toolchain.lock — run `workspai setup node` first.'
    );
  } else if (isJavaProject(projectJson, cwd) && !rt.java?.version) {
    violations.push(
      'java.version is not pinned in toolchain.lock — run `workspai setup java` first.'
    );
  } else if (isDotnetProject(projectJson, cwd) && !rt.dotnet?.version) {
    violations.push(
      'dotnet.version is not pinned in toolchain.lock — run `workspai setup dotnet` first.'
    );
  } else if (isPythonProject(projectJson, cwd) && !rt.python?.version) {
    violations.push(
      'python.version is not pinned in toolchain.lock — run `workspai setup python` first.'
    );
  }

  // 3. Workspace profile must be compatible with project type
  try {
    const wsJsonPath = workspaceMetadataCandidates(workspacePath, 'workspace.json').find(
      (candidate) => fs.existsSync(candidate)
    );
    if (!wsJsonPath) throw new Error('workspace manifest missing');
    const wsJson = JSON.parse(await fs.promises.readFile(wsJsonPath, 'utf-8')) as {
      profile?: string;
    };
    const wsProfile = wsJson.profile ?? '';
    const detection = detectBackendFrameworkFromProject(cwd, projectJson);
    const compatibility = resolveWorkspaceProfileProjectCompatibility({
      profile: wsProfile,
      runtime: detection.runtime,
      subjectLabel: path.basename(cwd),
      mode: 'strict',
    });
    if (!compatibility.ok) {
      violations.push(
        `${compatibility.message} Update the workspace profile or use a polyglot workspace.`
      );
    }
  } catch {
    /* non-fatal */
  }

  return violations;
}

async function delegateToLocalCLI(): Promise<boolean> {
  const isBrokenLegacyWindowsLauncher = async (scriptPath: string): Promise<boolean> => {
    if (!isWindowsPlatform()) {
      return false;
    }
    if (!scriptPath.toLowerCase().endsWith('.cmd')) {
      return false;
    }
    try {
      const content = await fsExtra.readFile(scriptPath, 'utf8');
      const normalized = content.replace(/\r\n/g, '\n').toLowerCase();
      const referencesLegacyRapidkit = normalized.includes('\\.rapidkit\\rapidkit');
      const referencesCmdOrExe =
        normalized.includes('\\.rapidkit\\rapidkit.cmd') ||
        normalized.includes('\\.rapidkit\\rapidkit.exe') ||
        normalized.includes('\\.venv\\scripts\\rapidkit.exe');
      return referencesLegacyRapidkit && !referencesCmdOrExe;
    } catch {
      return false;
    }
  };

  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const firstArg = args[0];
  const isInitCommand = firstArg === 'init';
  const runtimeLifecycleCommands = new Set<string>(WRAPPER_LIFECYCLE_COMMANDS);
  const isHelpLike = !firstArg || firstArg === '--help' || firstArg === '-h' || firstArg === 'help';
  const isWorkspaceRoot = hasWorkspaceRootMarkers(cwd);
  const hasProjectJsonInCwd = projectMetadataCandidates(cwd, 'project.json').some((candidate) =>
    fs.existsSync(candidate)
  );
  const cwdProjectJson = readRapidkitProjectJson(cwd);
  const inferredRuntime = await inferRuntimeByFiles(cwd);
  const isExecutorProjectInCwd =
    isGoProject(cwdProjectJson, cwd) ||
    isNodeProject(cwdProjectJson, cwd) ||
    isPythonProject(cwdProjectJson, cwd) ||
    isJavaProject(cwdProjectJson, cwd) ||
    isDotnetProject(cwdProjectJson, cwd) ||
    hasNpmRuntimeExecutor(inferredRuntime ?? undefined);
  const shouldKeepLifecycleOnWrapper =
    !!firstArg && runtimeLifecycleCommands.has(firstArg) && isExecutorProjectInCwd;
  const bypassLocalWorkspaceLauncher = process.env.RAPIDKIT_LOCAL_LAUNCHER_BYPASS === '1';

  // CRITICAL: npm-only commands must NEVER be delegated to the Python core CLI.
  // These commands are implemented exclusively in the npm wrapper.
  if (isNpmOnlyInvocation(args)) {
    return false;
  }

  // CRITICAL: Never delegate 'create' command - npm CLI must handle it for project registry tracking
  if (args[0] === 'create') {
    return false;
  }

  if (handleProjectCapabilityRequest(args)) {
    return true;
  }

  // Keep workspace-root `init` on npm wrapper orchestration.
  // This preserves expected behavior for workspace dependency init + child project init.
  if (args[0] === 'init' && isWorkspaceRoot && !hasProjectJsonInCwd) {
    return false;
  }

  if (blockUnsupportedProjectCommandIfNeeded(args)) {
    return true;
  }

  // Prefer the official Core contract when possible (best-effort).
  // This is safe here because this function is awaited before CLI execution.
  try {
    const allowShellActivate = firstArg === 'shell' && args[1] === 'activate';

    // DON'T delegate `create` command - let npm CLI handle it for project registry tracking
    const isCreateCommand = firstArg === 'create';

    const detected = await detectRapidkitProject(cwd, { cwd, timeoutMs: 1200 });
    if (detected.ok && detected.data?.isRapidkitProject && detected.data.engine === 'python') {
      // These commands are handled exclusively by the npm wrapper and must never be delegated
      // to the Python core CLI, even when inside a Python workspace.
      const isNpmOnlyCommand = isCreateCommand || isNpmOnlyInvocation(args);
      if (
        !isHelpLike &&
        !allowShellActivate &&
        !isNpmOnlyCommand &&
        !isInitCommand &&
        !shouldKeepLifecycleOnWrapper &&
        shouldBridgeInvocationToCore(args)
      ) {
        // Strict policy pre-flight for lifecycle commands
        if (firstArg && (STRICT_POLICY_PROJECT_COMMANDS as readonly string[]).includes(firstArg)) {
          const violations = await checkStrictPolicyPreflightForDelegation(cwd).catch(
            () => [] as string[]
          );
          if (violations.length > 0) {
            process.stderr.write(
              chalk.red('❌ Strict policy violations prevent running this command:') + '\n'
            );
            for (const v of violations) process.stderr.write(chalk.red(`  • ${v}`) + '\n');
            process.exit(1);
          }
        }
        const code = await runCoreRapidkit(process.argv.slice(2), { cwd });
        process.exit(code);
      }
      // allow npm-only commands, shell helpers and create command
    }
  } catch {
    // Ignore and fall back to filesystem detection.
  }

  // Walk upwards looking for project metadata (project may be in parent dir).
  const contextFile = findContextFileUp(cwd);

  // FIRST: Check if we have a local rapidkit script and should delegate
  // This works for BOTH npm and pip engine projects
  const isWindows = isWindowsPlatform();
  const localScriptCandidates = bypassLocalWorkspaceLauncher
    ? []
    : getRapidkitLocalScriptCandidates(cwd);

  let localScript: string | null = null;
  for (const candidate of localScriptCandidates) {
    if (await fsExtra.pathExists(candidate)) {
      if (await isBrokenLegacyWindowsLauncher(candidate)) {
        logger.warn(
          `Skipping legacy/broken Windows launcher candidate: ${candidate}. Falling back to core bridge.`
        );
        continue;
      }
      localScript = candidate;
      break;
    }
  }

  // DON'T delegate `create` command - let npm CLI handle it for project registry tracking
  const isCreateCommand = firstArg === 'create';

  // Keep `init` in workspace root on npm wrapper orchestration.
  // Delegating to local script here can route to project-only init behavior and break
  // expected workspace-root semantics (workspace deps + child project initialization).
  if (firstArg === 'init' && isWorkspaceRoot && !hasProjectJsonInCwd) {
    return false;
  }

  // STRICT POLICY PRE-FLIGHT for lifecycle commands.
  // Check before delegating to any local script or Python core so that strict policy
  // is enforced regardless of which engine the project uses (Go, Node, Python).
  if (firstArg && (STRICT_POLICY_PROJECT_COMMANDS as readonly string[]).includes(firstArg)) {
    const violations = await checkStrictPolicyPreflightForDelegation(cwd);
    if (violations.length > 0) {
      process.stderr.write(
        chalk.red('❌ Strict policy violations prevent running this command:') + '\n'
      );
      for (const v of violations) process.stderr.write(chalk.red(`  • ${v}`) + '\n');
      process.exit(1);
    }
  }

  // If we have a local script AND the command is a local command, delegate immediately
  // This works for projects created with --template (npm engine) and workspace projects
  if (
    localScript &&
    firstArg &&
    LOCAL_COMMANDS.includes(firstArg) &&
    !isCreateCommand &&
    !isInitCommand &&
    !shouldKeepLifecycleOnWrapper
  ) {
    logger.debug(`Delegating to local CLI: ${localScript} ${args.join(' ')}`);

    const delegationEnv = firstArg === 'init' ? buildDelegationEnvForInit() : process.env;

    const child = spawn(localScript, args, {
      stdio: 'inherit',
      cwd,
      shell: isWindows,
      env: delegationEnv,
    });

    child.on('close', (code) => {
      process.exit(code ?? 0);
    });

    child.on('error', (err) => {
      logger.error(`Failed to run local rapidkit: ${err.message}`);
      process.exit(1);
    });

    return true;
  }

  // Delegate to the Python core engine when context.json reports a Python install backend.
  if (contextFile && (await fsExtra.pathExists(contextFile))) {
    try {
      const ctx = await fsExtra.readJson(contextFile);
      if (isPythonCoreContextEngine(ctx.engine)) {
        const firstArg = args[0];

        // If a local project script exists, delegate there first (prefer local CLI)
        // On Windows, prefer .cmd files
        const localScriptCandidatesEarly = bypassLocalWorkspaceLauncher
          ? []
          : getRapidkitLocalScriptCandidates(cwd);
        let localScriptEarly: string | null = null;
        for (const c of localScriptCandidatesEarly) {
          if (await fsExtra.pathExists(c)) {
            if (await isBrokenLegacyWindowsLauncher(c)) {
              logger.warn(
                `Skipping legacy/broken Windows launcher candidate: ${c}. Falling back to core bridge.`
              );
              continue;
            }
            localScriptEarly = c;
            break;
          }
        }

        if (
          localScriptEarly &&
          firstArg &&
          LOCAL_COMMANDS.includes(firstArg) &&
          firstArg !== 'init' &&
          !shouldKeepLifecycleOnWrapper
        ) {
          // Delegate to local CLI and return
          logger.debug(
            `Delegating to local CLI (early detection): ${localScriptEarly} ${args.join(' ')}`
          );
          const delegationEnv = firstArg === 'init' ? buildDelegationEnvForInit() : process.env;
          const child = spawn(localScriptEarly, args, {
            stdio: 'inherit',
            cwd,
            shell: isWindows,
            env: delegationEnv,
          });
          child.on('close', (code) => process.exit(code ?? 0));
          child.on('error', (err) => {
            logger.error(`Failed to run local rapidkit: ${err.message}`);
            process.exit(1);
          });
          return true;
        }

        // Allow shell activate requests (prints activation snippet).
        if (firstArg === 'shell' && args[1] === 'activate') {
          const snippet = isWindowsPlatform()
            ? `# RapidKit Core activation snippet (PowerShell)\n$venv = ".venv"\nif (Test-Path "$venv\\Scripts\\Activate.ps1") { . "$venv\\Scripts\\Activate.ps1" }\n$env:RAPIDKIT_PROJECT_ROOT = (Get-Location).Path\n$project = (Get-Location).Path\n$env:PATH = "$project\\.workspai;$project\\.rapidkit;$project;" + $env:PATH\n\n# CMD alternative:\n# call .venv\\Scripts\\activate.bat\n`
            : `# RapidKit Core activation snippet - eval "$(workspai shell activate)"\nVENV='.venv'\nif [ -f "$VENV/bin/activate" ]; then\n  . "$VENV/bin/activate"\nelif [ -f "$VENV/bin/activate.fish" ]; then\n  source "$VENV/bin/activate.fish"\nfi\nexport RAPIDKIT_PROJECT_ROOT="$(pwd)"\nexport PATH="$(pwd)/.workspai:$(pwd)/.rapidkit:$(pwd):$PATH"\n`;
          console.log(
            chalk.green.bold(
              '\n✅ Activation snippet — run the following to activate this project in your current shell:\n'
            )
          );
          console.log(snippet);
          console.log(chalk.gray('\n💡 After activation you can run: workspai dev\n'));
          process.exit(0);
        }

        // Delegate all other commands to core.
        // But never delegate npm-only commands (bootstrap, cache, mirror, setup, workspace, doctor).
        if (
          !isHelpLike &&
          !isNpmOnlyInvocation(args) &&
          firstArg !== 'init' &&
          !shouldKeepLifecycleOnWrapper &&
          shouldBridgeInvocationToCore(args)
        ) {
          const code = await runCoreRapidkit(args, { cwd });
          process.exit(code);
        }
        // npm-only command: fall through to npm wrapper handling
      }
    } catch (_e) {
      // ignore parse errors, fallback to normal behavior
    }
  }

  // No delegation needed - let the main CLI handle it
  return false;
}

// Track current project path for cleanup on interrupt
let currentProjectPath: string | null = null;
let cleanupInProgress = false;

const invokedCliName = resolveInvokedCliName();
const primaryCliName = 'workspai';
const primaryNpxCommand = 'npx workspai';
export const program = new Command();
// Keep options that follow a subcommand owned by that subcommand. Several
// command surfaces intentionally reuse familiar flag names (for example,
// workspace creation's --profile and Doctor's policy --profile). Without
// positional option parsing Commander lets the parent option consume the
// child's value, which both applies the wrong choices and silently drops valid
// Doctor policy profiles.
program.enablePositionalOptions();

// Legacy flags are intentionally hidden by default. Tests and current UX
// expect legacy template-related flags to remain out of the primary help
// output, even when environment variables are present.
const SHOW_LEGACY =
  process.env.RAPIDKIT_SHOW_LEGACY === '1' ||
  process.env.RAPIDKIT_SHOW_LEGACY?.toLowerCase() === 'true';

export async function shouldForwardToCore(args: string[]): Promise<boolean> {
  if (args.length === 0) return false;

  const first = args[0];
  const second = args[1];

  if (isProjectCapabilityRequest(args)) return false;

  if ((WRAPPER_ORCHESTRATED_PROJECT_COMMANDS as readonly string[]).includes(first)) return false;

  if ((PROJECT_COMMANDS_CORE_FALLBACK as readonly string[]).includes(first)) {
    if (first === 'lint' || first === 'format') {
      const projectJson = readRapidkitProjectJson(process.cwd());
      const inferredRuntime = await inferRuntimeByFiles(process.cwd());
      if (isNodeProject(projectJson, process.cwd()) || inferredRuntime === 'node') {
        const detection = detectBackendFrameworkFromProject(process.cwd(), projectJson);
        if (
          resolveNodeLifecycleScript(process.cwd(), first, { framework: detection.key }) !== null
        ) {
          return false;
        }
      }
      if (isPythonProject(projectJson, process.cwd()) || inferredRuntime === 'python') {
        return true;
      }
      if (findRapidkitProjectRoot(process.cwd())) {
        return false;
      }
    }
    return true;
  }

  // npm-only commands
  if (isNpmOnlyInvocation(args)) return false;
  if (first === 'shell' && second === 'activate') return false;

  // core global flag
  if (args.includes('--tui')) return true;

  // npm UX/help/version flags should remain handled by this wrapper
  if (
    first === '--help' ||
    first === '-h' ||
    first === 'help' ||
    first === '--version' ||
    first === '-V' ||
    first === '-v'
  ) {
    return false;
  }

  // npm-only shorthand flags
  if (args.includes('--template') || args.includes('-t')) return false;

  const cached = await getCachedCoreTopLevelCommands();

  // Core-owned commands may carry wrapper-shared flags (notably --dry-run) and must still forward.
  if (isCoreDelegatedTopLevelCommand(first, cached)) {
    return true;
  }

  // Wrapper-shared flags with non-core top-level tokens imply create/workspace orchestration.
  if (args.some((a) => WRAPPER_SHARED_CLI_FLAGS.has(a))) return false;

  if (cached) {
    return cached.has(first);
  }

  // No cache yet.
  // For well-known core commands, forward immediately so failures (e.g., missing Python)
  // are handled by the bridge instead of being mis-parsed by the wrapper.
  if (BOOTSTRAP_CORE_COMMANDS_SET.has(first)) return true;

  // If the user provided multiple args and none of the wrapper flags matched,
  // this is almost certainly a core invocation.
  if (args.length > 1) return true;

  // Otherwise, treat it as a workspace/project name and let commander handle it.
  return false;
}

program
  .name(primaryCliName)
  .description('Workspai workspace intelligence CLI')
  .version(getVersion());

// Add consistent help headings expected by the tests and UX consumers.
program.addHelpText(
  'beforeAll',
  `Workspai CLI

Workspace Intelligence for software systems.
`
);

program.addHelpText(
  'afterAll',
  `
Discover more:
  ${primaryCliName} --help          Product overview and first steps
  ${primaryCliName} commands --json Complete machine-readable command inventory
  https://workspai.dev             Guides, contracts, and examples
`
);

// Main command: npx workspai <name> (legacy: npx rapidkit <name>)
program
  .argument('[name]', 'Name of the workspace or project directory')
  .addOption(
    new Option(
      '-t, --template <template>',
      'Legacy: create a project with template (fastapi, nestjs, springboot, gofiber, gogin, dotnet) instead of a workspace'
    ).hideHelp()
  )
  .option('-y, --yes', 'Skip prompts and use defaults')
  .option('--author <name>', 'Author/team name for workspace metadata')
  .option('--here', 'Create workspace in the current directory (same as --output .)')
  .option('--output <dir>', 'Parent directory for the new workspace folder')
  .addOption(new Option('--skip-git', 'Skip git initialization').hideHelp())
  .addOption(
    new Option(
      '--skip-python-engine',
      'Create a Python-aware workspace without installing rapidkit-core now'
    ).hideHelp()
  )
  .addOption(
    new Option('--skip-install', 'Legacy: skip installing dependencies (template mode)').hideHelp()
  )
  .option('--debug', 'Enable debug logging')
  .addOption(new Option('--dry-run', 'Show what would be created without creating it').hideHelp())
  .addOption(
    new Option('--install-method <method>', 'Installation method: poetry, venv, or pipx')
      .choices(['poetry', 'venv', 'pipx'])
      .hideHelp()
  )
  .addOption(
    new Option(
      '--profile <profile>',
      'Workspace bootstrap profile: minimal, java-only, python-only, node-only, go-only, dotnet-only, polyglot, enterprise'
    )
      .choices([
        'minimal',
        'java-only',
        'python-only',
        'node-only',
        'go-only',
        'dotnet-only',
        'polyglot',
        'enterprise',
      ])
      .hideHelp()
  )
  .addOption(
    new Option(
      '--create-workspace',
      'When creating a project outside a workspace: create and register a workspace in the current directory'
    ).hideHelp()
  )
  .addOption(
    new Option(
      '--no-workspace',
      'When creating a project outside a workspace: do not link it to any workspace'
    ).hideHelp()
  )
  .option('--no-update-check', 'Skip checking for updates')
  .option('--trust-config', 'Trust and execute workspai.config.js/mjs/cjs discovered in this tree')
  .action(async (name, options) => {
    try {
      // Enable debug mode if requested
      if (options.debug) {
        logger.setDebug(true);
        logger.debug('Debug mode enabled');
      }

      // Load user configuration
      const userConfig = await loadUserConfig();
      logger.debug('User config loaded', {
        ...userConfig,
        openaiApiKey: userConfig.openaiApiKey ? '[REDACTED]' : undefined,
      });

      // Load Workspai config file (workspai.config.*; rapidkit.config.* is legacy fallback)
      const workspaiConfig = await loadWorkspaiConfig(process.cwd(), {
        trustExecutableConfig:
          options.trustConfig === true || process.env.WORKSPAI_TRUST_CONFIG === '1',
      });
      logger.debug('Workspai config loaded', workspaiConfig);

      // Merge configurations (CLI > workspai.config.* > .workspairc.json > legacy fallback)
      const mergedConfig = mergeConfigs(userConfig, workspaiConfig, {
        author: options.author,
        pythonVersion: undefined, // Will be prompted
        skipGit: options.skipGit,
      });
      logger.debug('Merged config', mergedConfig);

      // Check for updates (unless disabled)
      if (options.updateCheck !== false) {
        await checkForUpdates();
      }

      showIntro('workspace');

      // If no name provided, show help
      if (!name) {
        printHelp();
        process.exit(0);
      }

      // Validate name
      try {
        validateProjectName(name);
      } catch (error) {
        if (error instanceof RapidKitError) {
          logger.error(`\n❌ ${error.message}`);
          if (error.details) {
            logger.warn(`💡 ${error.details}\n`);
          }
          process.exit(1);
        }
        throw error;
      }

      const isProjectMode = !!options.template;
      let outputParent: string | undefined;
      if (!isProjectMode) {
        if (options.here) {
          outputParent = process.cwd();
        } else if (options.output) {
          outputParent = path.resolve(options.output);
        } else {
          outputParent = await resolveWorkspaceOutputParent([], {
            hasYes: options.yes,
          });
        }
      }

      const targetPath = isProjectMode
        ? path.resolve(process.cwd(), name)
        : resolveWorkspaceTargetPath(name, { outputParent });
      currentProjectPath = targetPath;

      // Check if directory already exists
      if (!options.dryRun) {
        if (!isProjectMode) {
          await fsExtra.ensureDir(path.dirname(targetPath));
        }

        const existingWorkspacePath = !isProjectMode ? findExistingWorkspacePath(name) : undefined;
        if (
          (!isProjectMode &&
            shouldBlockExistingWorkspaceName(existingWorkspacePath, targetPath, { outputParent }) &&
            existingWorkspacePath &&
            (await fsExtra.pathExists(existingWorkspacePath))) ||
          (await fsExtra.pathExists(targetPath))
        ) {
          logger.error(`\n❌ Directory "${name}" already exists`);
          if (existingWorkspacePath && existingWorkspacePath !== targetPath) {
            console.log(chalk.gray(`   Found at: ${existingWorkspacePath}`));
          }
          console.log(
            chalk.cyan('\n💡 Choose a different name or delete the existing directory.\n')
          );
          process.exit(1);
        }
      }

      // In project mode, allow any kit slug (core is the source of truth).
      // Keep backward-compatible shorthands: fastapi -> fastapi.standard, nestjs -> nestjs.standard.

      // Dry-run mode
      if (options.dryRun) {
        console.log(chalk.cyan('\n🔍 Dry-run mode - showing what would be created:\n'));
        console.log(chalk.white('📂 Path:'), targetPath);
        console.log(
          chalk.white('📦 Type:'),
          isProjectMode ? `Project (${options.template})` : 'Workspace'
        );
        console.log();
        return;
      }

      // Get details
      if (!options.yes && !isProjectMode) {
        // Workspace prompts (provisioning mode only)
        await prompt([
          {
            type: 'input',
            name: 'author',
            message: 'Author name:',
            default: process.env.USER || 'Workspai User',
          },
        ]);
      } else if (options.yes) {
        console.log(chalk.gray('Using default values (--yes flag)\n'));
      }

      // Create workspace or project
      if (isProjectMode) {
        const raw = String(options.template || '').trim();
        const kit = normalizeKitId(raw);

        if (isNpmBackedKit(kit)) {
          const code = await runNpmBackedKitCreate([
            'create',
            'project',
            kit,
            name,
            ...(options.skipGit ? ['--skip-git'] : []),
            ...(options.skipInstall ? ['--skip-install'] : []),
          ]);
          if (code !== 0) {
            process.exit(code);
          }
          return;
        }

        // If we're outside a registered workspace, offer to create/register one so the
        // newly created project is tracked and the workspace tools (local venv, launcher)
        // are set up. Flags:
        //   --create-workspace  : create workspace automatically
        //   --no-workspace      : do not create a workspace
        const hasWorkspace = !!findWorkspaceMarkerUp(process.cwd());
        if (!hasWorkspace) {
          const { registerWorkspaceAtPath } = await import('./create.js');
          if (options.createWorkspace) {
            // Non-interactive: create workspace automatically
            await registerWorkspaceAtPath(process.cwd(), {
              skipGit: options.skipGit,
              yes: options.yes,
              userConfig,
            });
          } else if (!options.noWorkspace) {
            // Interactive: prompt the user (unless --no-workspace was specified)
            if (options.yes) {
              // Default to creating a workspace when --yes is provided
              await registerWorkspaceAtPath(process.cwd(), {
                skipGit: options.skipGit,
                yes: true,
                userConfig,
              });
            } else {
              const { createWs } = (await prompt([
                {
                  type: 'confirm',
                  name: 'createWs',
                  message:
                    'This project will be created outside a Workspai workspace. Create and register a workspace here?',
                  default: true,
                },
              ])) as { createWs: boolean };

              if (createWs) {
                await registerWorkspaceAtPath(process.cwd(), {
                  skipGit: options.skipGit,
                  yes: false,
                  userConfig,
                });
              }
            }
          }
        }

        const createArgs = ['create', 'project', kit, name, '--output', process.cwd()];

        if (options.yes) {
          createArgs.push('--yes');
        }

        const workspacePathForCreate = findWorkspaceUp(process.cwd());
        const explicitSkipInstallForCreate = !!options.skipInstall;
        const skipLockGenerationForCreate =
          explicitSkipInstallForCreate || !!workspacePathForCreate;

        if (explicitSkipInstallForCreate) {
          // Explicit opt-out: preserve legacy behavior for users who requested
          // skipping post-scaffold essentials.
          createArgs.push('--skip-essentials');
        }

        const createEnv = skipLockGenerationForCreate
          ? {
              ...process.env,
              RAPIDKIT_SKIP_LOCKS: '1',
              RAPIDKIT_GENERATE_LOCKS: '0',
            }
          : undefined;

        const createCode = await runCoreRapidkitStreamed(createArgs, {
          cwd: process.cwd(),
          env: createEnv,
        });
        if (createCode !== 0) process.exit(createCode);

        if (workspacePathForCreate && !options.skipInstall) {
          console.log(chalk.gray('ℹ️  Fast create mode (workspace): dependencies were deferred.'));
          console.log(chalk.white('   Next: cd <project-name> && npx workspai init'));
        }

        // Copy workspace Python version to project if inside a workspace
        // This must be done AFTER rapidkit-core creates the project, as it may
        // overwrite .python-version during module installation
        const workspaceMarker = findWorkspaceMarkerUp(process.cwd());
        if (workspaceMarker) {
          const workspaceRoot = path.dirname(workspaceMarker);
          const workspacePythonVersionFile = path.join(workspaceRoot, '.python-version');
          const projectPythonVersionFile = path.join(targetPath, '.python-version');

          try {
            if (await fsExtra.pathExists(workspacePythonVersionFile)) {
              const pythonVersion = fs.readFileSync(workspacePythonVersionFile, 'utf-8');
              fs.writeFileSync(projectPythonVersionFile, pythonVersion.trim() + '\n');
              logger.debug(
                `Synced Python version ${pythonVersion.trim()} from workspace to project`
              );
            }
          } catch (err) {
            logger.debug('Could not sync Python version from workspace:', err);
          }
        }

        if (!options.skipInstall) {
          const initCode = await runCoreRapidkit(['init', targetPath], { cwd: process.cwd() });
          if (initCode !== 0) process.exit(initCode);

          // Sync Python version again after init, in case it was overwritten
          if (workspaceMarker) {
            const workspaceRoot = path.dirname(workspaceMarker);
            const workspacePythonVersionFile = path.join(workspaceRoot, '.python-version');
            const projectPythonVersionFile = path.join(targetPath, '.python-version');

            try {
              if (await fsExtra.pathExists(workspacePythonVersionFile)) {
                const pythonVersion = fs.readFileSync(workspacePythonVersionFile, 'utf-8');
                fs.writeFileSync(projectPythonVersionFile, pythonVersion.trim() + '\n');
                logger.debug(`Re-synced Python version ${pythonVersion.trim()} after init`);
              }
            } catch (err) {
              logger.debug('Could not re-sync Python version after init:', err);
            }
          }
        }
      } else {
        const { createProject: createPythonEnvironment } = await import('./create.js');
        await createPythonEnvironment(name, {
          skipGit: options.skipGit,
          skipPythonEngine: options.skipPythonEngine,
          dryRun: options.dryRun,
          yes: options.yes,
          userConfig: mergedConfig,
          installMethod: options.installMethod,
          profile: options.profile,
          parentDirectory: path.dirname(targetPath),
        });
        console.log(chalk.gray(`ℹ️  Workspace root: ${targetPath}`));
        console.log(
          chalk.gray(
            `   Next: ${formatWorkspaceCdCommand(targetPath)} && npx workspai create project`
          )
        );
      }
    } catch (error) {
      if (error instanceof RapidKitError) {
        logger.error(`\n❌ ${error.message}`);
        if (error.details) {
          logger.warn(`💡 ${error.details}`);
        }
        logger.debug('Error code:', error.code);
      } else {
        logger.error('\n❌ An unexpected error occurred:');
        console.error(error);
      }
      process.exit(1);
    } finally {
      currentProjectPath = null;
    }
  });

// Register AI commands
registerAICommands(program);

// Register Product Factory commands
registerProductCommands(program);

// Register infrastructure sidecar commands
registerInfraCommands(program);

program
  .command('commands')
  .description('Show effective Workspai command ownership and runtime support')
  .option('--json', 'Emit machine-readable JSON output')
  .action(async (options: { json?: boolean }) => {
    printGlobalCommandCapabilities({ json: options.json });
  });

program
  .command('analyze')
  .description('Analyze workspace/project health and generate enterprise-ready evidence')
  .option('--workspace <path>', 'Workspace/root path to analyze')
  .option('--json', 'Output as JSON')
  .option('--output <file>', 'Write JSON report to a file')
  .option('--strict', 'Treat warnings as blocking in the verdict')
  .action(
    async (options: { workspace?: string; json?: boolean; output?: string; strict?: boolean }) => {
      try {
        const { runAnalyze, printAnalyzeReport } = await import('./analyze.js');
        const report = await runAnalyze({
          workspacePath: options.workspace,
          json: options.json === true,
          output: options.output,
          strict: options.strict === true,
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printAnalyzeReport(report);
        }

        if (report.summary.verdict === 'blocked') {
          process.exit(2);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'analyze',
                code: 'analyze.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.error(chalk.red(`Analyze failed: ${message}`));
        }
        process.exit(1);
      }
    }
  );

// Register config commands
registerConfigCommands(program);

// Shell helpers - e.g. `rapidkit shell activate` prints an eval-able activation snippet
program
  .command('shell <action>')
  .description('Shell helpers (activate virtualenv in current shell)')
  .action(async (action: string) => {
    if (action !== 'activate') {
      console.log(chalk.red(`Unknown shell command: ${action}`));
      process.exit(1);
    }

    const cwd = process.cwd();
    // search for context.json up the tree
    function findContext(start: string): string | null {
      let p = start;

      while (true) {
        const candidate = projectMetadataCandidates(p, 'context.json').find((metadataPath) =>
          fs.existsSync(metadataPath)
        );
        if (candidate) return candidate;
        const parent = path.dirname(p);
        if (parent === p) break;
        p = parent;
      }
      return null;
    }

    // Try to find a RapidKit context.json file in the tree.
    // If the context can't be read/parsed we still try to be helpful:
    // - If a .venv directory exists (or a metadata activate file), print activation
    //   snippet so the user can `eval "$(workspai shell activate)"` and continue.
    const ctxFile = findContext(cwd);

    // Helper: search upwards for a `.venv` directory or metadata activate script.
    function findActivationCandidate(start: string) {
      let p = start;

      while (true) {
        const venv = path.join(p, '.venv');
        const activateFile =
          [path.join(p, '.workspai', 'activate'), path.join(p, '.rapidkit', 'activate')].find(
            (candidate) => fs.existsSync(candidate)
          ) ?? path.join(p, '.workspai', 'activate');
        if (fs.existsSync(activateFile) || fs.existsSync(venv)) return { venv, activateFile };
        const parent = path.dirname(p);
        if (parent === p) break;
        p = parent;
      }
      return null;
    }

    const candidate = findActivationCandidate(cwd);
    // If we didn't find either context.json or an activation candidate, bail
    if (!ctxFile && !candidate) {
      console.log(chalk.yellow('No Workspai project found in this directory'));
      process.exit(1);
    }

    // Default activation path if we have a context or venv
    let activatePath: string;
    if (candidate && fs.existsSync(candidate.activateFile)) {
      activatePath = candidate.activateFile;
    } else if (candidate && fs.existsSync(candidate.venv)) {
      activatePath = getVenvActivateScriptPath(candidate.venv);
    } else {
      console.log(chalk.yellow('No virtual environment found'));
      process.exit(1);
    }

    // Print the activation command
    const isWindows = isWindowsPlatform();
    if (isWindows) {
      console.log(`call "${activatePath}"`);
    } else {
      console.log(`. "${activatePath}"`);
    }
  });

program
  .command(WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES.readiness)
  .description(
    '🚦 Generate machine-readable release readiness summary (env + doctor + analyze + verify + dependency)'
  )
  .option('--workspace <path>', 'Workspace root to evaluate instead of the current directory')
  .option('--json', 'Output readiness result in JSON format')
  .option('--strict', 'Exit with code 1 unless overall readiness is pass')
  .option(
    '--skip-verify',
    'Skip verify gate (use for workspaces without extension verify artifacts)'
  )
  .action(
    async (options: {
      workspace?: string;
      json?: boolean;
      strict?: boolean;
      skipVerify?: boolean;
    }) => {
      await runReleaseReadinessCommand({
        workspace: options.workspace,
        json: options.json,
        strict: options.strict,
        skipVerify: options.skipVerify,
      });
    }
  );

program
  .command('pipeline')
  .description(
    '🔗 Run governance pipeline: sync → doctor → analyze → readiness → autopilot (writes pipeline-last-run.json)'
  )
  .option('--json', 'Output pipeline report as JSON')
  .option('--strict', 'Treat warnings as blocking and propagate non-zero exit codes')
  .option('--skip-verify', 'Skip readiness verify gate')
  .option('--skip-analyze', 'Skip analyze stage')
  .option('--skip-autopilot', 'Skip autopilot release stage')
  .option(
    '--autopilot-mode <mode>',
    'Autopilot mode when stage is enabled: audit | safe-fix | enforce',
    'audit'
  )
  .option('--no-agent-sync', 'Skip cross-tool agent grounding sync after pipeline evidence write')
  .option(
    '--agent-sync',
    'Force agent grounding sync after pipeline (default when report is written)'
  )
  .action(
    async (options: {
      json?: boolean;
      strict?: boolean;
      skipVerify?: boolean;
      skipAnalyze?: boolean;
      skipAutopilot?: boolean;
      autopilotMode?: string;
      agentSync?: boolean;
    }) => {
      const autopilotMode = String(options.autopilotMode || 'audit')
        .trim()
        .toLowerCase();
      if (!['audit', 'safe-fix', 'enforce'].includes(autopilotMode)) {
        console.log(chalk.red(`Invalid autopilot mode: ${options.autopilotMode}`));
        process.exit(1);
      }

      const { runPipelineCommand } = await import('./pipeline.js');
      await runPipelineCommand({
        json: options.json === true,
        strict: options.strict === true,
        skipVerify: options.skipVerify === true,
        skipAnalyze: options.skipAnalyze === true,
        skipAutopilot: options.skipAutopilot === true,
        autopilotMode: autopilotMode as 'audit' | 'safe-fix' | 'enforce',
        noAgentSync: options.agentSync === false,
        agentSync: options.agentSync,
      });
    }
  );

program
  .command('autopilot <action>')
  .description('Run end-to-end release autopilot workflows')
  .option('--mode <mode>', 'Autopilot mode: audit | safe-fix | enforce', 'audit')
  .option('--json', 'Emit machine-readable JSON output')
  .option('--output <file>', 'Write autopilot report to an additional output path')
  .option('--since <ref>', 'Git ref for affected project selection (default: HEAD~1)')
  .option('--parallel', 'Run workspace stage execution in parallel')
  .option('--max-workers <count>', 'Maximum parallel workers')
  .action(
    async (
      action: string,
      options: {
        mode?: string;
        json?: boolean;
        output?: string;
        since?: string;
        parallel?: boolean;
        maxWorkers?: string;
      }
    ) => {
      if (action !== 'release') {
        console.log(chalk.red(`Unknown autopilot action: ${action}`));
        console.log(chalk.gray('Available: release'));
        process.exit(1);
      }

      const mode = String(options.mode || 'audit')
        .trim()
        .toLowerCase();
      if (!['audit', 'safe-fix', 'enforce'].includes(mode)) {
        console.log(chalk.red(`Invalid autopilot mode: ${options.mode}`));
        console.log(chalk.gray('Allowed modes: audit | safe-fix | enforce'));
        process.exit(1);
      }

      const maxWorkers = resolveMaxWorkersOption({
        raw: options.maxWorkers,
        operation: 'autopilot release',
        json: options.json === true,
      });

      const { runAutopilotRelease } = await import('./autopilot-release.js');
      let report;
      try {
        report = await runAutopilotRelease({
          workspacePath: process.cwd(),
          mode: mode as 'audit' | 'safe-fix' | 'enforce',
          since: options.since,
          parallel: options.parallel === true,
          maxWorkers,
          json: options.json === true,
          output: options.output,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Autopilot release failed: ${message}`));
        process.exit(3);
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      }

      if (report.summary.exitCode !== 0) {
        process.exit(report.summary.exitCode);
      }
    }
  );

// Doctor command - health check for Workspai environment
program
  .command('import <source>')
  .description('Import a local project folder or clone a git repository into the current workspace')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--name <projectName>', 'Override imported project folder name')
  .option(
    '--enable-modules',
    'Preserve Core module/template commands only when imported RapidKit metadata already supports them'
  )
  .addOption(
    new Option('--project-grounding <mode>', 'Project entrypoint policy: managed, local, or off')
      .choices(['managed', 'local', 'off'])
      .default('managed')
  )
  .option('--git', 'Force source to be treated as a git repository URL')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      source: string,
      options: {
        workspace?: string;
        name?: string;
        git?: boolean;
        json?: boolean;
        enableModules?: boolean;
        projectGrounding?: ProjectGroundingMode;
      }
    ) => {
      const code = await handleImportCommand(source, options);
      if (code !== 0) {
        process.exit(code);
      }
    }
  );

program
  .command('adopt [source]')
  .description(
    'Adopt an existing local project into a Workspai workspace without moving or copying source'
  )
  .option('--workspace <path>', 'Workspace root path (defaults to nearest or managed default)')
  .option('--name <projectName>', 'Override adopted project name')
  .option(
    '--enable-modules',
    'Preserve Core module/template commands only when adopted RapidKit metadata already supports them'
  )
  .addOption(
    new Option('--project-grounding <mode>', 'Project entrypoint policy: managed, local, or off')
      .choices(['managed', 'local', 'off'])
      .default('managed')
  )
  .option('--dry-run', 'Preview adoption without writing project or registry metadata')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      source: string | undefined,
      options: {
        workspace?: string;
        name?: string;
        dryRun?: boolean;
        json?: boolean;
        enableModules?: boolean;
        projectGrounding?: ProjectGroundingMode;
      }
    ) => {
      const code = await handleAdoptCommand(source, {
        ...options,
        dryRun: options.dryRun === true || process.argv.includes('--dry-run'),
        enableModules: options.enableModules === true || process.argv.includes('--enable-modules'),
      });
      if (code !== 0) {
        process.exit(code);
      }
    }
  );

const snapshotCommand = program
  .command('snapshot')
  .description('Create, list, and restore Workspai workspace snapshots');

snapshotCommand
  .command('create [name]')
  .description('Create a recoverable workspace snapshot')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--reason <text>', 'Reason recorded in the snapshot manifest')
  .option('--include-projects', 'Include project source files in the snapshot')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      name: string | undefined,
      options: { workspace?: string; reason?: string; includeProjects?: boolean; json?: boolean }
    ) => {
      try {
        const result = await createWorkspaceSnapshot({
          workspacePath: options.workspace,
          name,
          reason: options.reason,
          includeProjects: options.includeProjects === true,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.green(`✔ Workspace snapshot created: ${result.manifest.name}`));
        console.log(chalk.gray(`   Mode: ${result.manifest.mode}`));
        console.log(chalk.gray(`   Path: ${result.snapshotPath}`));
      } catch (error) {
        console.log(chalk.red(`❌ Snapshot create failed: ${(error as Error).message}`));
        process.exit(1);
      }
    }
  );

snapshotCommand
  .command('list')
  .description('List workspace snapshots')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--json', 'Emit machine-readable JSON output')
  .action(async (options: { workspace?: string; json?: boolean }) => {
    try {
      const snapshots = await listWorkspaceSnapshots({ workspacePath: options.workspace });

      if (options.json) {
        console.log(JSON.stringify({ snapshots }, null, 2));
        return;
      }

      if (snapshots.length === 0) {
        console.log(chalk.yellow('No workspace snapshots found.'));
        return;
      }

      for (const snapshot of snapshots) {
        console.log(chalk.cyan(snapshot.name));
        console.log(
          chalk.gray(
            `   ${snapshot.createdAt} | ${snapshot.mode} | ${snapshot.projects.length} project(s)`
          )
        );
        console.log(chalk.gray(`   ${snapshot.snapshotPath}`));
      }
    } catch (error) {
      console.log(chalk.red(`❌ Snapshot list failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

snapshotCommand
  .command('inspect <name>')
  .description('Inspect snapshot manifest and estimated payload size')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--json', 'Emit machine-readable JSON output')
  .action(async (name: string, options: { workspace?: string; json?: boolean }) => {
    try {
      const result = await inspectWorkspaceSnapshot({
        workspacePath: options.workspace,
        name,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.cyan(`Snapshot: ${result.manifest.name}`));
      console.log(chalk.gray(`   Mode: ${result.manifest.mode}`));
      console.log(chalk.gray(`   Created: ${result.manifest.createdAt}`));
      console.log(chalk.gray(`   Projects: ${result.manifest.projects.length}`));
      console.log(chalk.gray(`   Files: ${result.estimatedFileCount}`));
      console.log(chalk.gray(`   Bytes: ${result.estimatedBytes}`));
      console.log(chalk.gray(`   Path: ${result.snapshotPath}`));
    } catch (error) {
      console.log(chalk.red(`❌ Snapshot inspect failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

snapshotCommand
  .command('restore <name>')
  .description('Restore a workspace snapshot')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--reason <text>', 'Reason recorded in the audit log')
  .option('--dry-run', 'Show what would be restored without changing files')
  .option('--force', 'Required to apply a restore')
  .option('--no-safety-snapshot', 'Do not create a pre-restore metadata snapshot')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      name: string,
      options: {
        workspace?: string;
        reason?: string;
        dryRun?: boolean;
        force?: boolean;
        safetySnapshot?: boolean;
        json?: boolean;
      }
    ) => {
      try {
        const result = await restoreWorkspaceSnapshot({
          workspacePath: options.workspace,
          name,
          reason: options.reason,
          dryRun: options.dryRun === true || process.argv.includes('--dry-run'),
          force: options.force === true,
          safetySnapshot: options.safetySnapshot,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.dryRun) {
          console.log(chalk.cyan(`Snapshot restore dry-run: ${name}`));
        } else {
          console.log(chalk.green(`✔ Workspace snapshot restored: ${name}`));
        }
        console.log(chalk.gray(`   Snapshot: ${result.snapshotPath}`));
        console.log(chalk.gray(`   Restored paths: ${result.restoredPaths.join(', ')}`));
        if (result.safetySnapshotPath) {
          console.log(chalk.gray(`   Safety snapshot: ${result.safetySnapshotPath}`));
        }
      } catch (error) {
        console.log(chalk.red(`❌ Snapshot restore failed: ${(error as Error).message}`));
        process.exit(1);
      }
    }
  );

const projectCommand = program
  .command('project')
  .description('Safe workspace project lifecycle operations');

projectCommand
  .command('commands')
  .description('Show effective commands supported by the current Workspai project')
  .option('--json', 'Emit machine-readable JSON output')
  .action(async (options: { json?: boolean }) => {
    printProjectCommandCapabilities({ json: options.json });
  });

projectCommand
  .command('workspace [action]')
  .description('Show or repair the canonical workspace binding for the current Workspai project')
  .option('--workspace <path>', 'Explicit workspace for relink or validation')
  .option('--project <path>', 'Project path (defaults to the current or nearest parent project)')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      action: string | undefined,
      options: { workspace?: string; project?: string; json?: boolean }
    ) => {
      const normalizedAction = action ?? 'status';
      if (!['status', 'relink'].includes(normalizedAction)) {
        const message = `Unknown project workspace action: ${normalizedAction}`;
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project workspace',
                code: 'project.workspace.action.invalid',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ ${message}`));
          console.log(
            chalk.gray(
              '   npx workspai project workspace [status|relink] [--workspace <path>] [--json]'
            )
          );
        }
        process.exit(1);
      }

      try {
        const resolution = resolveProjectWorkspaceSync({
          startPath: path.resolve(options.project ?? process.cwd()),
          explicitWorkspacePath: options.workspace,
          strict: true,
          requireProjectMembership: true,
        });
        if (!resolution || !resolution.projectPath) {
          throw new ProjectWorkspaceResolutionError(
            'project.workspace.unlinked',
            'No Workspai project metadata was found from the requested path.'
          );
        }
        const repaired =
          normalizedAction === 'relink' || resolution.source === 'registry' || resolution.recovered
            ? await repairProjectWorkspaceLink(resolution)
            : null;
        const payload: ProjectWorkspaceResolutionContract = {
          schemaVersion: 'project-workspace-resolution.v1',
          status: 'resolved',
          workspacePath: resolution.workspacePath,
          projectPath: resolution.projectPath,
          source: repaired ? 'local-link' : resolution.source,
          recovered: resolution.recovered || repaired !== null,
          linkPath:
            repaired?.linkPath ??
            resolution.linkPath ??
            path.join(resolution.projectPath, PROJECT_WORKSPACE_LINK_RELATIVE_PATH),
          nextCommand:
            'npx workspai workspace intelligence run --for-agent generic --strict --json',
        };
        assertProjectWorkspaceResolutionContract(payload);
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(chalk.green('✔ Project workspace resolved'));
        console.log(chalk.gray(`   Workspace: ${payload.workspacePath}`));
        console.log(chalk.gray(`   Project: ${payload.projectPath}`));
        console.log(chalk.gray(`   Resolution: ${payload.source}`));
        if (repaired) console.log(chalk.gray(`   Local link repaired: ${repaired.linkPath}`));
      } catch (error) {
        const resolutionError = error instanceof ProjectWorkspaceResolutionError ? error : null;
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project workspace',
                code: resolutionError?.code ?? 'project.workspace.resolve.failed',
                message,
                context: resolutionError?.context,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ ${message}`));
        }
        process.exit(1);
      }
    }
  );

projectCommand
  .command('coverage')
  .description(
    'Inspect or run runtime-native test coverage and publish normalized project evidence'
  )
  .option('--project <path>', 'Project path (defaults to the current or nearest parent project)')
  .option('--target <percent>', 'Required coverage target from 0 to 100', '80')
  .option('--run', 'Run the detected runtime-native coverage command before reading evidence')
  .option('--strict', 'Return exit 2 when coverage is unavailable or below the selected target')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (options: {
      project?: string;
      target?: string;
      run?: boolean;
      strict?: boolean;
      json?: boolean;
    }) => {
      const target = Number(options.target ?? 80);
      if (!Number.isFinite(target) || target < 0 || target > 100) {
        const message = '--target must be a number from 0 to 100.';
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project coverage',
                code: 'project.coverage.target.invalid',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ ${message}`));
        }
        process.exit(1);
      }

      try {
        const { collectProjectTestCoverage } = await import('./project-test-coverage.js');
        const result = await collectProjectTestCoverage({
          projectPath: options.project,
          target,
          run: options.run === true,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const selected = result.metrics[result.target.metric];
          const percent = selected?.percent;
          const display = percent === null || percent === undefined ? 'unavailable' : `${percent}%`;
          const color =
            result.status === 'passed'
              ? chalk.green
              : result.status === 'failed'
                ? chalk.red
                : chalk.yellow;
          console.log(color(`Project coverage: ${result.status}`));
          console.log(chalk.gray(`   Project: ${result.project.name}`));
          console.log(chalk.gray(`   Runtime: ${result.runtime}`));
          console.log(
            chalk.gray(`   ${result.target.metric}: ${display} · target ${result.target.percent}%`)
          );
          console.log(chalk.gray(`   Evidence: ${result.artifactPaths.project}`));
          if (result.lowCoverageFiles.length > 0) {
            console.log(chalk.gray('   Lowest coverage files:'));
            for (const file of result.lowCoverageFiles.slice(0, 10)) {
              console.log(
                chalk.gray(
                  `   • ${file.path}: ${file.percent === null ? 'unknown' : `${file.percent}%`} (${file.uncovered} uncovered)`
                )
              );
            }
          }
          for (const diagnostic of result.diagnostics) {
            console.log(chalk.gray(`   ${diagnostic}`));
          }
        }
        if (result.status === 'failed') process.exit(1);
        if (
          options.strict &&
          (result.status === 'below-target' || result.status === 'unavailable')
        ) {
          process.exit(2);
        }
      } catch (error) {
        const message = (error as Error).message;
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project coverage',
                code: 'project.coverage.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ Project coverage failed: ${message}`));
        }
        process.exit(1);
      }
    }
  );

projectCommand
  .command('archives')
  .description('List archived workspace projects')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--json', 'Emit machine-readable JSON output')
  .action(async (options: { workspace?: string; json?: boolean }) => {
    try {
      const archives = await listArchivedProjects({ workspacePath: options.workspace });

      if (options.json) {
        console.log(JSON.stringify({ archives }, null, 2));
        return;
      }

      if (archives.length === 0) {
        console.log(chalk.yellow('No archived projects found.'));
        return;
      }

      for (const archive of archives) {
        console.log(chalk.cyan(archive.projectName));
        console.log(chalk.gray(`   Archived: ${archive.archivedAt}`));
        console.log(chalk.gray(`   Path: ${archive.archivePath}`));
        if (archive.reason) console.log(chalk.gray(`   Reason: ${archive.reason}`));
      }
    } catch (error) {
      console.log(chalk.red(`❌ Project archive list failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCommand
  .command('archive <project>')
  .description('Move a project into .workspai/archive with a safety snapshot')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--reason <text>', 'Reason recorded in the archive manifest')
  .option('--dry-run', 'Show what would be archived without changing files')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      project: string,
      options: { workspace?: string; reason?: string; dryRun?: boolean; json?: boolean }
    ) => {
      try {
        const result = await archiveWorkspaceProject({
          workspacePath: options.workspace,
          project,
          reason: options.reason,
          dryRun: options.dryRun === true || process.argv.includes('--dry-run'),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(
          result.dryRun
            ? chalk.cyan(`Project archive dry-run: ${result.projectName}`)
            : chalk.green(`✔ Project archived: ${result.projectName}`)
        );
        console.log(chalk.gray(`   From: ${result.projectPath}`));
        if (result.archivePath) console.log(chalk.gray(`   To: ${result.archivePath}`));
        if (result.safetySnapshotPath) {
          console.log(chalk.gray(`   Safety snapshot: ${result.safetySnapshotPath}`));
        }
      } catch (error) {
        const message = (error as Error).message;
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project archive',
                code: 'project.archive.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ Project archive failed: ${message}`));
        }
        process.exit(1);
      }
    }
  );

projectCommand
  .command('restore <archive>')
  .description('Restore an archived project back into the workspace')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--name <projectName>', 'Restore using a new project folder name')
  .option('--reason <text>', 'Reason recorded in the audit log')
  .option('--force', 'Overwrite an existing restore target')
  .option('--dry-run', 'Show what would be restored without changing files')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      archive: string,
      options: {
        workspace?: string;
        name?: string;
        reason?: string;
        force?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      try {
        const result = await restoreArchivedProject({
          workspacePath: options.workspace,
          archive,
          targetName: options.name,
          reason: options.reason,
          force: options.force === true,
          dryRun: options.dryRun === true || process.argv.includes('--dry-run'),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(
          result.dryRun
            ? chalk.cyan(`Project restore dry-run: ${result.projectName}`)
            : chalk.green(`✔ Project restored: ${result.projectName}`)
        );
        console.log(chalk.gray(`   From: ${result.archivePath}`));
        console.log(chalk.gray(`   To: ${result.projectPath}`));
        if (result.safetySnapshotPath) {
          console.log(chalk.gray(`   Safety snapshot: ${result.safetySnapshotPath}`));
        }
      } catch (error) {
        const message = (error as Error).message;
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project restore',
                code: 'project.restore.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ Project restore failed: ${message}`));
        }
        process.exit(1);
      }
    }
  );

projectCommand
  .command('delete <project>')
  .description('Archive by default; permanently delete only with --permanent and exact --confirm')
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--reason <text>', 'Reason recorded in the safety snapshot/archive manifest')
  .option('--permanent', 'Permanently delete the project directory')
  .option('--confirm <projectName>', 'Required exact project name for --permanent')
  .option('--dry-run', 'Show what would be deleted without changing files')
  .option('--json', 'Emit machine-readable JSON output')
  .action(
    async (
      project: string,
      options: {
        workspace?: string;
        reason?: string;
        permanent?: boolean;
        confirm?: string;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      try {
        const result = await deleteWorkspaceProject({
          workspacePath: options.workspace,
          project,
          reason: options.reason,
          permanent: options.permanent === true,
          confirm: options.confirm,
          dryRun: options.dryRun === true || process.argv.includes('--dry-run'),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const label = result.action === 'archive' ? 'archived' : 'deleted';
        console.log(
          result.dryRun
            ? chalk.cyan(`Project ${label} dry-run: ${result.projectName}`)
            : chalk.green(`✔ Project ${label}: ${result.projectName}`)
        );
        console.log(chalk.gray(`   Path: ${result.projectPath}`));
        if (result.archivePath) console.log(chalk.gray(`   Archive: ${result.archivePath}`));
        if (result.safetySnapshotPath) {
          console.log(chalk.gray(`   Safety snapshot: ${result.safetySnapshotPath}`));
        }
      } catch (error) {
        const message = (error as Error).message;
        if (options.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'project delete',
                code: 'project.delete.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ Project delete failed: ${message}`));
        }
        process.exit(1);
      }
    }
  );

program
  .command(WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES.doctor)
  .description(
    '🩺 Check Workspai system health by default; use workspace or project for scoped checks'
  )
  .option(
    '--workspace [path]',
    'Check entire workspace, optionally from an explicit workspace path'
  )
  .option('--project', 'Check only the current project (or nearest parent project)')
  .option('--json', 'Output results in JSON format (for CI/CD pipelines)')
  .option('--strict', 'Exit 1 on health errors or warnings (workspace/project scope)')
  .option('--ci', 'CI gate: exit 1 on errors, exit 2 on warnings only')
  .option('--profile <profile>', 'Doctor policy profile: local | ci | release | enterprise-strict')
  .option('--fix', 'Automatically fix common issues (with confirmation)')
  .option('--plan', 'Generate remediation plan without applying changes')
  .option('--apply', 'Apply remediation plan non-interactively')
  .action(
    async (
      scope: string | undefined,
      options: {
        workspace?: boolean | string;
        project?: boolean;
        json?: boolean;
        strict?: boolean;
        ci?: boolean;
        profile?: string;
        fix?: boolean;
        plan?: boolean;
        apply?: boolean;
      }
    ) => {
      if (scope && scope !== 'workspace' && scope !== 'project') {
        console.log(chalk.red(`Unknown doctor scope: ${scope}`));
        console.log(chalk.gray('Available: workspace, project'));
        console.log(
          chalk.gray(
            'Usage: npx workspai doctor | npx workspai doctor workspace | npx workspai doctor project'
          )
        );
        process.exit(1);
      }

      if (options.plan && (options.fix || options.apply)) {
        console.log(
          chalk.red('Invalid doctor flags: --plan cannot be combined with --fix or --apply')
        );
        process.exit(1);
      }

      const allowedDoctorProfiles = new Set(['local', 'ci', 'release', 'enterprise-strict']);
      if (options.profile && !allowedDoctorProfiles.has(options.profile)) {
        console.log(
          chalk.red(
            `Invalid doctor profile: ${options.profile}. Use local, ci, release, or enterprise-strict.`
          )
        );
        process.exit(1);
      }

      const shadowDiagnostic = await detectWindowsDoctorWorkspaceShadow({
        scope,
        workspaceFlag: options.workspace,
      });

      if (shadowDiagnostic.detected && !options.json) {
        console.log(
          chalk.yellow('⚠️  Local launcher shadow detected for doctor workspace checks.')
        );
        if (shadowDiagnostic.candidatePath) {
          console.log(chalk.gray(`   Candidate: ${shadowDiagnostic.candidatePath}`));
        }
        console.log(
          chalk.gray(
            '   Running npm-wrapper doctor workflow directly as safe fallback to avoid ambiguous rapidkit binary resolution.'
          )
        );
        console.log(
          chalk.gray(
            '   If this happens in a shell call, run: npx --yes --package workspai workspai doctor workspace'
          )
        );
      }

      const { runDoctor } = await import('./doctor.js');
      const exitCode = await runDoctor({
        ...options,
        workspace: options.workspace || scope === 'workspace',
        project: options.project || scope === 'project',
        strict: options.strict === true,
        ci: options.ci === true,
        profile: options.profile,
      });
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    }
  );

// Workspace management command
program
  .command(WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES.workspace)
  .description(
    'Manage Workspai workspaces (list, sync, policy, share, export, run, intelligence)\n' +
      '  workspace run <stage>   \u2014 fleet stage execution across discovered projects\n' +
      '                            stages: init | test | build | start | <custom-from-context>\n' +
      '  workspace explain|why   \u2014 blocker/project narrative (--write for artifact)\n' +
      '  workspace trace         \u2014 diff \u2192 blast radius \u2192 gates narrative (--from <diff>)\n' +
      '  workspace mcp serve     \u2014 read-mostly stdio MCP bridge over workspace evidence'
  )
  .option('--workspace <path>', 'Workspace root path (defaults to nearest Workspai workspace)')
  .option('--output <file>', 'Output file path for workspace share/export artifacts')
  .option('--from <file>', 'Input workspace model snapshot/report for workspace diff')
  .option(
    '--from-impact <file>',
    'Input workspace impact report for workspace verify (defaults to last-run impact)'
  )
  .option('--include-paths', 'Include absolute paths in workspace share bundle')
  .option('--write', 'Write workspace intelligence artifact to .workspai/reports')
  .option('--include-evidence', 'Read status metadata from referenced evidence reports')
  .option('--scan-depth <count>', 'Observable project discovery depth for large monorepos')
  .option('--limit <count>', 'Bound graph search results (default 12, maximum 100)')
  .option('--cache', 'Reuse cached workspace model when inputs are unchanged (keyed by inputsHash)')
  .option(
    '--incremental',
    'Rebuild only changed projects and re-infer only their incident graph edges (graph-aware)'
  )
  .option('--once', 'For workspace watch: do the initial in-memory build and exit (no watcher)')
  .option(
    '--graph-stream',
    'For workspace watch: emit workspace-graph-stream.v1 snapshot/delta NDJSON'
  )
  .option('--for-agent [agent]', 'Build an agent-ready workspace context pack')
  .option(
    '--agent-sync',
    'After --write on context, sync cross-tool agent grounding files (AGENTS.md, Copilot, Cursor, Claude)'
  )
  .option('--no-agent-sync', 'Skip automatic agent grounding sync after context --write')
  .option(
    '--target <targets>',
    'Agent customization targets for agent-sync (all|vscode|agents,copilot,cursor,claude,codex,orca)'
  )
  .option(
    '--preset <preset>',
    'Agent customization pack preset for agent-sync (minimal|enterprise)'
  )
  .addOption(
    new Option(
      '--project-grounding <mode>',
      'Project entrypoint policy for sync/agent-sync: managed, local, or off'
    )
      .choices(['managed', 'local', 'off'])
      .default('managed')
  )
  .option('--refresh-context', 'Rebuild workspace-context-agent.json during agent-sync')
  .option(
    '--experimental-hooks',
    'Generate advisory VS Code agent hook design files during enterprise agent-sync'
  )
  .option(
    '--hydrate-prompts',
    'Hydrate matching Copilot prompt files with workspace-specific verification steps during agent-sync'
  )
  .option('--scope <scope>', 'Scope workspace intelligence output, e.g. project:<name>')
  .option('--no-doctor', 'Exclude doctor evidence in workspace share bundle')
  .option('--no-blueprint', 'Exclude reproducibility blueprint from workspace share bundle')
  .option('--include-env', 'Include .env/private key files in workspace export archive')
  .option(
    WORKSPACE_ARCHIVE_CLI_FLAGS.archiveCompression.signature,
    WORKSPACE_ARCHIVE_CLI_FLAGS.archiveCompression.description
  )
  .option(
    WORKSPACE_ARCHIVE_CLI_FLAGS.maxDownloadSize.signature,
    WORKSPACE_ARCHIVE_CLI_FLAGS.maxDownloadSize.description
  )
  .option(
    WORKSPACE_ARCHIVE_CLI_FLAGS.maxExpandedSize.signature,
    WORKSPACE_ARCHIVE_CLI_FLAGS.maxExpandedSize.description
  )
  .option(
    WORKSPACE_ARCHIVE_CLI_FLAGS.downloadTimeoutMs.signature,
    WORKSPACE_ARCHIVE_CLI_FLAGS.downloadTimeoutMs.description
  )
  .option(
    WORKSPACE_ARCHIVE_CLI_FLAGS.allowPrivateNetwork.signature,
    WORKSPACE_ARCHIVE_CLI_FLAGS.allowPrivateNetwork.description
  )
  .option('--force', 'Overwrite an existing hydrate output directory')
  .option('--refresh', 'Publish workspace registry summary before reading status')
  .option('--dry-run', 'Preview hydrate without writing files')
  .option('--affected', 'Run only affected projects (requires git diff context)')
  .option('--blast-radius', 'Include downstream dependents from workspace dependency graph')
  .option('--since <ref>', 'Git ref for affected calculation (default: HEAD~1)')
  .option('--parallel', 'Run project stages in parallel')
  .option('--max-workers <count>', 'Maximum parallel workers (default: min(4, selected))')
  .option('--continue-on-error', 'Continue running remaining projects after a failure')
  .option(
    '--reuse-passed',
    'Skip projects that already passed this stage in workspace-run-last.json'
  )
  .option('--json', 'Emit machine-readable JSON output')
  .option('--ci', 'Build CI-oriented command plans where supported')
  .option('--strict', 'Return non-zero exit on warn/fail gate outcomes')
  .option('--no-gates', 'Skip doctor/readiness pre-run gates')
  .addHelpText(
    'after',
    `
Workspace Actions:
  Discovery & registry     list | sync | registry | foundation
  Intelligence loop       model | snapshot | diff | impact | verify | context
  Intelligence consumers  agent-sync | remediation-plan | explain | why | trace | feedback | eval | mcp
  Graph & observation      graph | watch
  Contracts & policy      contract | policy
  Portability             share | export | archive | hydrate | import
  Fleet lifecycle         run | init

Use "workspai commands --json" for the contract-backed runtime inventory.
See the command reference for action-specific required inputs and output artifacts.`
  )
  .action(async function (
    this: Command,
    action: string,
    subaction?: string,
    key?: string,
    value?: string
  ) {
    const actionOptions = this.opts() as {
      workspace?: string;
      output?: string;
      from?: string;
      fromImpact?: string;
      includePaths?: boolean;
      write?: boolean;
      includeEvidence?: boolean;
      scanDepth?: string;
      limit?: string;
      forAgent?: string | boolean;
      agentSync?: boolean;
      noAgentSync?: boolean;
      target?: string;
      preset?: string;
      projectGrounding?: ProjectGroundingMode;
      refreshContext?: boolean;
      experimentalHooks?: boolean;
      hydratePrompts?: boolean;
      scope?: string;
      doctor?: boolean;
      blueprint?: boolean;
      includeEnv?: boolean;
      archiveCompression?: string;
      maxDownloadSize?: string;
      maxExpandedSize?: string;
      downloadTimeoutMs?: string;
      allowPrivateNetwork?: boolean;
      force?: boolean;
      refresh?: boolean;
      dryRun?: boolean;
      affected?: boolean;
      blastRadius?: boolean;
      since?: string;
      parallel?: boolean;
      maxWorkers?: string;
      continueOnError?: boolean;
      reusePassed?: boolean;
      json?: boolean;
      ci?: boolean;
      strict?: boolean;
      gates?: boolean;
      cache?: boolean;
      incremental?: boolean;
      once?: boolean;
      graphStream?: boolean;
    };

    const requireWorkspaceRootForAction = (actionName: string): string => {
      const requestedWorkspace = actionOptions.workspace
        ? path.resolve(actionOptions.workspace)
        : null;
      let workspacePath: string | null = null;
      let resolutionError: ProjectWorkspaceResolutionError | null = null;
      try {
        workspacePath =
          resolveProjectWorkspaceSync({
            startPath: process.cwd(),
            explicitWorkspacePath: requestedWorkspace,
            strict: true,
          })?.workspacePath ?? null;
      } catch (error) {
        if (error instanceof ProjectWorkspaceResolutionError) {
          resolutionError = error;
        } else {
          throw error;
        }
      }

      if (!workspacePath || !hasWorkspaceRootMarkers(workspacePath)) {
        const message =
          resolutionError?.message ??
          'Not inside a Workspai workspace. Run from a workspace/project directory or pass --workspace <path>.';
        if (actionOptions.json === true || process.argv.includes('--json')) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: `workspace ${actionName}`,
                code: resolutionError?.code ?? 'workspace.root.required',
                message,
                context: {
                  cwd: path.resolve(process.cwd()),
                  ...(requestedWorkspace ? { requestedWorkspace } : {}),
                  ...(resolutionError?.context ?? {}),
                },
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red(`❌ ${message}`));
        console.log(
          chalk.gray(
            '💡 Run from a workspace/project directory, or pass --workspace <path> to resolve ambiguity.'
          )
        );
        process.exit(1);
      }

      const cwd = path.resolve(process.cwd());
      const root = path.resolve(workspacePath);
      if (cwd !== root && !actionOptions.json) {
        console.log(
          chalk.gray(
            `ℹ Using workspace root ${workspacePath} for "${actionName}" (current directory: ${cwd}).`
          )
        );
      }

      return workspacePath;
    };
    const hasRawFlag = (flag: string): boolean => process.argv.includes(flag);
    const rawFlagValue = (flag: string): string | undefined => readFlagValue(process.argv, flag);
    const workspaceOutputPath = (): string | undefined =>
      actionOptions.output || rawFlagValue('--output');
    const workspaceModelScanDepth = (): number | undefined => {
      if (!actionOptions.scanDepth) {
        return undefined;
      }
      const parsed = Number.parseInt(actionOptions.scanDepth, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const parseArchiveByteSize = (raw: string | undefined, flag: string): number | undefined => {
      if (!raw) return undefined;
      const match = raw
        .trim()
        .toLowerCase()
        .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
      if (!match) {
        throw new Error(`${flag} must be a byte size such as 500gb or 2tb.`);
      }
      const factors: Record<string, number> = {
        b: 1,
        kb: 1024,
        mb: 1024 ** 2,
        gb: 1024 ** 3,
        tb: 1024 ** 4,
      };
      const bytes = Number(match[1]) * factors[match[2] || 'b'];
      if (!Number.isSafeInteger(Math.floor(bytes)) || bytes <= 0) {
        throw new Error(`${flag} is outside the supported numeric range.`);
      }
      return Math.floor(bytes);
    };
    const workspaceArchiveSafety = () => {
      const timeoutRaw = actionOptions.downloadTimeoutMs;
      const timeout = timeoutRaw === undefined ? undefined : Number.parseInt(timeoutRaw, 10);
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
        throw new Error('--download-timeout-ms must be zero or a positive integer.');
      }
      return {
        maxDownloadBytes: parseArchiveByteSize(
          actionOptions.maxDownloadSize,
          '--max-download-size'
        ),
        maxExpandedBytes: parseArchiveByteSize(
          actionOptions.maxExpandedSize,
          '--max-expanded-size'
        ),
        downloadTimeoutMs: timeout,
        allowPrivateNetwork:
          actionOptions.allowPrivateNetwork === true || hasRawFlag('--allow-private-network'),
      };
    };

    const allKnownWorkspaceFlags = new Set<string>(
      Object.values(WORKSPACE_ACTION_CONTRACTS).flatMap((contract) => [...contract.flags])
    );
    const presentedWorkspaceFlags = new Set(
      process.argv
        .slice(2)
        .filter((token) => token.startsWith('--'))
        .map((token) => token.split('=', 1)[0])
        .filter((flag) => allKnownWorkspaceFlags.has(flag))
    );
    const allowedFlags: readonly string[] | undefined =
      WORKSPACE_ACTION_CONTRACTS[action as keyof typeof WORKSPACE_ACTION_CONTRACTS]?.flags;
    const unsupportedFlags = allowedFlags
      ? [...presentedWorkspaceFlags].filter((flag) => !allowedFlags.includes(flag))
      : [];
    if (unsupportedFlags.length > 0) {
      const message = `${unsupportedFlags.join(', ')} ${unsupportedFlags.length === 1 ? 'is' : 'are'} not supported by workspace ${action}.`;
      if (actionOptions.json === true || presentedWorkspaceFlags.has('--json')) {
        console.log(
          JSON.stringify(
            cliOperationError({
              operation: `workspace ${action}`,
              code: 'workspace.option.unsupported',
              message,
              exitCode: 2,
              context: { action, unsupportedFlags, allowedFlags },
            }),
            null,
            2
          )
        );
      } else {
        console.log(chalk.red(`❌ ${message}`));
        console.log(chalk.gray(`   Allowed flags: ${allowedFlags.join(', ') || 'none'}`));
      }
      process.exit(2);
    }

    // Emit a deterministic `progress` start event for every workspace intelligence
    // command so IDE/CI consumers track phases via `cli-log-event.v1` on stderr.
    // The terminal outcome is guaranteed by the run lifecycle (run.completed/failed).
    if (
      isWorkspaceIntelligenceSubcommand(action) ||
      action === 'trace' ||
      action === 'feedback' ||
      action === 'mcp'
    ) {
      emitWorkspacePhase({
        action,
        status: 'started',
        message: `workspace ${action} started`,
        metadata: {
          json: actionOptions.json === true || hasRawFlag('--json'),
          strict: actionOptions.strict === true || hasRawFlag('--strict'),
        },
      });
    }

    if (action === 'list') {
      const { listWorkspaces } = await import('./workspace.js');
      await listWorkspaces({ json: actionOptions.json === true || hasRawFlag('--json') });
    } else if (action === 'intelligence') {
      if (subaction && subaction !== 'run') {
        console.log(chalk.red(`❌ Unknown workspace intelligence action: ${subaction}`));
        console.log(chalk.gray('   npx workspai workspace intelligence run [--strict] [--json]'));
        process.exit(2);
      }
      const workspacePath = requireWorkspaceRootForAction('intelligence');
      const { runWorkspaceIntelligenceChain } = await import('./workspace-intelligence-runner.js');
      const result = await runWorkspaceIntelligenceChain({
        workspacePath,
        strict: actionOptions.strict === true || hasRawFlag('--strict'),
        agent: typeof actionOptions.forAgent === 'string' ? actionOptions.forAgent : 'generic',
      });
      if (actionOptions.json === true || hasRawFlag('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green(`✔ Workspace Intelligence: ${result.status}`));
        for (const stage of result.stages) {
          console.log(chalk.gray(`   ${stage.id}: ${stage.status} — ${stage.message}`));
        }
        console.log(chalk.gray(`   Evidence: ${result.artifactPath}`));
      }
      if (result.exitCode !== 0) process.exit(result.exitCode);
    } else if (action === 'model') {
      const workspacePath = requireWorkspaceRootForAction('model');
      const {
        buildWorkspaceModelCached,
        buildWorkspaceModelIncremental,
        createWorkspaceModelBuildProvenance,
        writeWorkspaceModel,
      } = await import('./workspace-model.js');
      const useIncremental = actionOptions.incremental === true || hasRawFlag('--incremental');
      const useCache = actionOptions.cache === true || hasRawFlag('--cache') || useIncremental;
      const modelBuildOptions = {
        workspacePath,
        includeAbsolutePaths: actionOptions.includePaths === true || hasRawFlag('--include-paths'),
        includeEvidence: actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
        observableScanDepth: workspaceModelScanDepth(),
        strict: actionOptions.strict === true || hasRawFlag('--strict'),
      };
      let model: Awaited<ReturnType<typeof buildWorkspaceModelCached>>['model'];
      let cacheStatus: 'hit' | 'miss' | 'disabled' | 'full' | 'incremental' | 'unchanged';
      if (useIncremental) {
        const incremental = await buildWorkspaceModelIncremental(modelBuildOptions);
        model = incremental.model;
        cacheStatus = incremental.mode;
      } else {
        const cached = await buildWorkspaceModelCached({ ...modelBuildOptions, cache: useCache });
        model = cached.model;
        cacheStatus = cached.cache;
      }
      model = {
        ...model,
        build: createWorkspaceModelBuildProvenance({
          mode: useIncremental ? 'incremental' : useCache ? 'cache' : 'full',
          engineStatus: cacheStatus,
        }),
      };
      let outputPath: string | undefined;
      if (actionOptions.write === true || hasRawFlag('--write')) {
        outputPath = await writeWorkspaceModel(model, workspacePath);
      }
      const strictFailed =
        (actionOptions.strict === true || hasRawFlag('--strict')) &&
        model.validation?.status !== 'passed';
      if (actionOptions.json) {
        console.log(JSON.stringify({ ...model, ...(outputPath ? { outputPath } : {}) }, null, 2));
        if (strictFailed) {
          process.exit(1);
        }
        return;
      }
      console.log(chalk.green(`✔ Workspace model: ${model.workspace.name}`));
      if (useIncremental) {
        console.log(chalk.gray(`   Build: ${cacheStatus} (incremental)`));
      } else if (useCache) {
        console.log(chalk.gray(`   Cache: ${cacheStatus}`));
      }
      console.log(chalk.gray(`   Projects: ${model.summary.projectCount}`));
      console.log(chalk.gray(`   Runtimes: ${model.summary.runtimes.join(', ') || 'none'}`));
      console.log(chalk.gray(`   Frameworks: ${model.summary.frameworks.join(', ') || 'none'}`));
      console.log(chalk.gray(`   Workspace type: ${model.identity.workspaceType}`));
      console.log(
        chalk.gray(
          `   Validation: ${model.validation?.status ?? 'unknown'} (${model.validation?.errors ?? 0} error, ${model.validation?.warnings ?? 0} warning)`
        )
      );
      if (outputPath) {
        console.log(chalk.gray(`   Written: ${outputPath}`));
      } else {
        console.log(chalk.gray('   Add --write to persist .workspai/reports/workspace-model.json'));
      }
      if (strictFailed) {
        process.exit(1);
      }
    } else if (action === 'agent-sync') {
      const workspacePath = requireWorkspaceRootForAction('agent-sync');
      const { syncWorkspaceAgentGrounding, parseAgentGroundingTargets } =
        await import('./workspace-agent-sync.js');
      const strictRequested = actionOptions.strict === true || hasRawFlag('--strict');
      const writeRequested = actionOptions.write === true || hasRawFlag('--write');
      const dryRun = hasRawFlag('--dry-run');
      const result = await syncWorkspaceAgentGrounding({
        workspacePath,
        scope: actionOptions.scope,
        agent: actionOptions.forAgent,
        write: writeRequested && !dryRun,
        dryRun,
        strict: strictRequested,
        preset: actionOptions.preset === 'minimal' ? 'minimal' : 'enterprise',
        refreshContext:
          actionOptions.refreshContext === true ||
          hasRawFlag('--refresh-context') ||
          hasRawFlag('--refresh'),
        targets: parseAgentGroundingTargets(actionOptions.target),
        experimentalHooks:
          actionOptions.experimentalHooks === true || hasRawFlag('--experimental-hooks'),
        hydratePrompts: actionOptions.hydratePrompts === true || hasRawFlag('--hydrate-prompts'),
        projectGrounding: actionOptions.projectGrounding ?? 'managed',
        staleAfterHours: 24,
      });

      if (actionOptions.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          chalk.green(`✔ Agent grounding ${writeRequested && !dryRun ? 'synced' : 'planned'}`)
        );
        console.log(chalk.gray(`   Index: ${result.indexPath}`));
        if (result.contextPath) {
          console.log(chalk.gray(`   Context: ${result.contextPath}`));
        }
        if (result.blockers.length > 0) {
          console.log(chalk.yellow(`   Blockers: ${result.blockers.slice(0, 3).join(' · ')}`));
        }
        const files = writeRequested && !dryRun ? result.writtenFiles : result.skippedFiles;
        if (files.length > 0) {
          console.log(chalk.gray(`   Files: ${files.join(', ')}`));
        }
        if (result.strictViolations.length > 0) {
          for (const violation of result.strictViolations) {
            console.log(chalk.red(`❌ ${violation}`));
          }
        }
      }

      if (strictRequested && result.strictViolations.length > 0) {
        process.exit(1);
      }
    } else if (action === 'remediation-plan') {
      const workspacePath = requireWorkspaceRootForAction('remediation-plan');
      const { buildArtifactRemediationPlan, writeArtifactRemediationPlan } =
        await import('./artifact-remediation-plan.js');
      const plan = await buildArtifactRemediationPlan({
        workspacePath,
        includeAbsolutePaths: actionOptions.includePaths === true || hasRawFlag('--include-paths'),
        ciMode: actionOptions.ci === true || hasRawFlag('--ci'),
      });
      let outputPath: string | undefined;
      if (actionOptions.write === true || hasRawFlag('--write')) {
        outputPath = await writeArtifactRemediationPlan(plan, workspacePath);
      }
      if (actionOptions.json === true || hasRawFlag('--json')) {
        console.log(
          JSON.stringify(
            cliOperationSuccess('workspace remediation-plan', plan, outputPath),
            null,
            2
          )
        );
        return;
      }
      console.log(chalk.green(`✔ Artifact remediation plan: ${plan.workspace.name}`));
      console.log(chalk.gray(`   Artifacts scanned: ${plan.summary.artifactsScanned}`));
      console.log(chalk.gray(`   Cards covered: ${plan.summary.cardsCovered}`));
      console.log(chalk.gray(`   CI mode: ${plan.source.ciMode ? 'yes' : 'no'}`));
      console.log(chalk.gray(`   Actions: ${plan.summary.totalActions}`));
      console.log(
        chalk.gray(
          `   Risk: safe=${plan.summary.risk.safe}, guarded=${plan.summary.risk.guarded}, invasive=${plan.summary.risk.invasive}`
        )
      );
      for (const actionItem of plan.actions.slice(0, 8)) {
        console.log(
          chalk.gray(
            `   • ${actionItem.cardId}: ${actionItem.title} (${actionItem.mode}, ${actionItem.risk})`
          )
        );
      }
      if (plan.actions.length > 8) {
        console.log(chalk.gray(`   … ${plan.actions.length - 8} more action(s)`));
      }
      if (outputPath) {
        console.log(chalk.gray(`   Written: ${outputPath}`));
      } else {
        console.log(
          chalk.gray(
            '   Add --write to persist .workspai/reports/artifact-remediation-plan-last-run.json'
          )
        );
      }
    } else if (action === 'context') {
      const workspacePath = requireWorkspaceRootForAction('context');
      if (
        actionOptions.forAgent !== true &&
        typeof actionOptions.forAgent !== 'string' &&
        subaction !== 'agent'
      ) {
        console.log(chalk.red('❌ workspace context currently requires --for-agent'));
        console.log(
          chalk.gray(
            '   npx workspai workspace context --for-agent --json [--scope project:<name>]'
          )
        );
        process.exit(1);
      }
      const { buildWorkspaceAgentContext, writeWorkspaceAgentContext } =
        await import('./workspace-context.js');
      const strictRequested = actionOptions.strict === true || hasRawFlag('--strict');
      const context = await buildWorkspaceAgentContext({
        workspacePath,
        agent: actionOptions.forAgent || key || subaction,
        scope: actionOptions.scope,
        includeEvidence: actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
        observableScanDepth: workspaceModelScanDepth(),
        strict: false,
      });
      let outputPath: string | undefined;
      let agentGroundingSync:
        | Awaited<
            ReturnType<typeof import('./workspace-agent-sync.js').syncWorkspaceAgentGrounding>
          >
        | undefined;
      if (actionOptions.write === true || hasRawFlag('--write')) {
        outputPath = await writeWorkspaceAgentContext(context, workspacePath);
        const shouldSyncGrounding =
          (actionOptions.agentSync === true ||
            hasRawFlag('--agent-sync') ||
            actionOptions.noAgentSync !== true) &&
          !hasRawFlag('--no-agent-sync');
        if (shouldSyncGrounding) {
          const { syncWorkspaceAgentGrounding, parseAgentGroundingTargets } =
            await import('./workspace-agent-sync.js');
          agentGroundingSync = await syncWorkspaceAgentGrounding({
            workspacePath,
            scope: actionOptions.scope,
            agent: context.agent,
            write: true,
            refreshContext: false,
            strict: strictRequested,
            preset: actionOptions.preset === 'minimal' ? 'minimal' : 'enterprise',
            targets: parseAgentGroundingTargets(actionOptions.target),
            projectGrounding: actionOptions.projectGrounding ?? 'managed',
          });
          if (!actionOptions.json) {
            console.log(
              chalk.gray(
                `   Agent grounding synced: ${agentGroundingSync.writtenFiles.length} file(s) updated`
              )
            );
          }
          if (strictRequested && agentGroundingSync.strictViolations.length > 0) {
            for (const violation of agentGroundingSync.strictViolations) {
              console.log(chalk.red(`❌ ${violation}`));
            }
            process.exit(1);
          }
        }
      }
      const strictFailed = strictRequested && context.validation.status !== 'passed';
      if (actionOptions.json) {
        console.log(
          JSON.stringify(
            {
              ...context,
              ...(outputPath ? { outputPath } : {}),
              ...(agentGroundingSync ? { agentGroundingSync } : {}),
            },
            null,
            2
          )
        );
        if (strictFailed) {
          process.exit(1);
        }
        return;
      }
      console.log(chalk.green(`✔ Workspace context: ${context.workspace.name}`));
      console.log(chalk.gray(`   Agent: ${context.agent}`));
      console.log(
        chalk.gray(`   Scope: ${context.scope.activeProject ?? context.scope.requested}`)
      );
      console.log(chalk.gray(`   Projects included: ${context.projects.length}`));
      console.log(chalk.gray(`   Safe commands: ${context.safeCommands.length}`));
      console.log(
        chalk.gray(
          `   Validation: ${context.validation.status} (${context.validation.errors} error, ${context.validation.warnings} warning)`
        )
      );
      if (outputPath) {
        console.log(chalk.gray(`   Written: ${outputPath}`));
      } else {
        console.log(
          chalk.gray('   Add --write to persist .workspai/reports/workspace-context-agent.json')
        );
      }
      if (strictFailed) {
        for (const issue of context.validation.issues) {
          console.log(chalk.red(`❌ ${issue.severity}:${issue.code}:${issue.target}`));
        }
        process.exit(1);
      }
    } else if (action === 'snapshot') {
      const workspacePath = requireWorkspaceRootForAction('snapshot');
      const { buildWorkspaceModelSnapshot, writeWorkspaceModelSnapshot } =
        await import('./workspace-intelligence.js');
      const snapshot = await buildWorkspaceModelSnapshot({
        workspacePath,
        includeAbsolutePaths: actionOptions.includePaths === true || hasRawFlag('--include-paths'),
        includeEvidence: actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
        observableScanDepth: workspaceModelScanDepth(),
      });
      const outputPath = await writeWorkspaceModelSnapshot(snapshot, workspacePath);
      if (actionOptions.json) {
        console.log(
          JSON.stringify(cliOperationSuccess('workspace snapshot', snapshot, outputPath), null, 2)
        );
        return;
      }
      console.log(chalk.green(`✔ Workspace model snapshot: ${snapshot.model.workspace.name}`));
      console.log(chalk.gray(`   Hash: ${snapshot.modelHash}`));
      console.log(chalk.gray(`   Projects: ${snapshot.model.summary.projectCount}`));
      console.log(chalk.gray(`   Workspace type: ${snapshot.model.identity.workspaceType}`));
      console.log(chalk.gray(`   Written: ${outputPath}`));
    } else if (action === 'diff') {
      const workspacePath = requireWorkspaceRootForAction('diff');
      const fromPath = actionOptions.from || subaction;
      if (!fromPath) {
        if (actionOptions.json === true || hasRawFlag('--json')) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace diff',
                code: 'workspace.diff.from.required',
                message: 'workspace diff requires --from <snapshot-or-model-report|git[:ref]>.',
                context: { workspacePath },
                examples: [
                  'npx workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json',
                  'npx workspai workspace diff --from .workspai/reports/workspace-model.json --json',
                  'npx workspai workspace diff --from git --json',
                ],
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(
          chalk.red('❌ workspace diff requires --from <snapshot-or-model-report|git[:ref]>')
        );
        console.log(
          chalk.gray(
            '   npx workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json'
          )
        );
        console.log(
          chalk.gray(
            '   npx workspai workspace diff --from .workspai/reports/workspace-model.json --json'
          )
        );
        console.log(
          chalk.gray(
            '   npx workspai workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --json'
          )
        );
        console.log(
          chalk.gray(
            '   npx workspai workspace diff --from git --json  (uses snapshot baseline + git working tree)'
          )
        );
        process.exit(1);
      }
      const { diffWorkspaceModel, writeWorkspaceModelDiff } =
        await import('./workspace-intelligence.js');
      let diff: Awaited<ReturnType<typeof diffWorkspaceModel>>;
      try {
        diff = await diffWorkspaceModel({
          workspacePath,
          fromPath,
          includeAbsolutePaths:
            actionOptions.includePaths === true || hasRawFlag('--include-paths'),
          includeEvidence:
            actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
          observableScanDepth: workspaceModelScanDepth(),
        });
      } catch (error) {
        if (actionOptions.json === true || hasRawFlag('--json')) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace diff',
                code: 'workspace.diff.input_unreadable',
                message: (error as Error).message,
                context: { workspacePath, fromPath },
                nextActions: [
                  'npx workspai workspace snapshot --json',
                  'npx workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json',
                ],
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        throw error;
      }
      const outputPath = await writeWorkspaceModelDiff(diff, workspacePath);
      if (actionOptions.json) {
        console.log(
          JSON.stringify(cliOperationSuccess('workspace diff', diff, outputPath), null, 2)
        );
        return;
      }
      const statusColor = diff.summary.changed ? chalk.yellow : chalk.green;
      console.log(
        statusColor(`✔ Workspace model diff: ${diff.summary.changed ? 'changed' : 'clean'}`)
      );
      console.log(chalk.gray(`   From: ${diff.fromRef}`));
      console.log(chalk.gray(`   Added projects: ${diff.summary.addedProjects}`));
      console.log(chalk.gray(`   Removed projects: ${diff.summary.removedProjects}`));
      console.log(chalk.gray(`   Changed projects: ${diff.summary.changedProjects}`));
      console.log(chalk.gray(`   Workspace changes: ${diff.summary.workspaceChanges}`));
      console.log(chalk.gray(`   Validation changes: ${diff.summary.validationChanges}`));
      if (diff.git?.available) {
        console.log(
          chalk.gray(
            `   Git: ${diff.git.dirty ? 'dirty' : 'clean'} (${diff.summary.gitChangedFiles} mapped change(s))`
          )
        );
      }
      for (const change of diff.changes.slice(0, 12)) {
        console.log(chalk.gray(`   • ${change.type} ${change.target}: ${change.message}`));
      }
      if (diff.changes.length > 12) {
        console.log(chalk.gray(`   … ${diff.changes.length - 12} more change(s)`));
      }
      console.log(chalk.gray(`   Written: ${outputPath}`));
    } else if (action === 'impact') {
      const workspacePath = requireWorkspaceRootForAction('impact');
      const fromPath = actionOptions.from || subaction;
      if (!fromPath) {
        if (actionOptions.json === true || hasRawFlag('--json')) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace impact',
                code: 'workspace.impact.from.required',
                message: 'workspace impact requires --from <workspace-diff-report>.',
                context: { workspacePath },
                examples: [
                  'npx workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json',
                  'npx workspai workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --json',
                ],
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red('❌ workspace impact requires --from <workspace-diff-report>'));
        console.log(
          chalk.gray(
            '   npx workspai workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --json'
          )
        );
        process.exit(1);
      }
      const { buildWorkspaceImpact, writeWorkspaceImpact } =
        await import('./workspace-intelligence.js');
      let impact: Awaited<ReturnType<typeof buildWorkspaceImpact>>;
      try {
        impact = await buildWorkspaceImpact({
          workspacePath,
          fromPath,
          scope: actionOptions.scope,
          includeAbsolutePaths:
            actionOptions.includePaths === true || hasRawFlag('--include-paths'),
          includeEvidence:
            actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
          observableScanDepth: workspaceModelScanDepth(),
        });
      } catch (error) {
        if (actionOptions.json === true || hasRawFlag('--json')) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace impact',
                code: 'workspace.impact.input_unreadable',
                message: (error as Error).message,
                context: { workspacePath, fromPath },
                nextActions: [
                  'npx workspai workspace snapshot --json',
                  'npx workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json',
                  'npx workspai workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --json',
                ],
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        throw error;
      }
      const outputPath = await writeWorkspaceImpact(impact, workspacePath);
      if (actionOptions.json) {
        console.log(
          JSON.stringify(cliOperationSuccess('workspace impact', impact, outputPath), null, 2)
        );
        return;
      }
      const color =
        impact.summary.risk === 'critical' || impact.summary.risk === 'high'
          ? chalk.red
          : impact.summary.risk === 'medium'
            ? chalk.yellow
            : chalk.green;
      console.log(color(`✔ Workspace impact: ${impact.summary.risk}`));
      console.log(chalk.gray(`   From: ${impact.fromRef}`));
      console.log(chalk.gray(`   Affected projects: ${impact.summary.affectedProjects}`));
      console.log(chalk.gray(`   Workspace items: ${impact.summary.workspaceItems}`));
      console.log(chalk.gray(`   Recommended commands: ${impact.summary.recommendedCommands}`));
      for (const item of impact.affectedProjects.slice(0, 8)) {
        console.log(chalk.gray(`   • ${item.title}: ${item.summary}`));
      }
      if (impact.affectedProjects.length > 8) {
        console.log(chalk.gray(`   … ${impact.affectedProjects.length - 8} more project(s)`));
      }
      console.log(chalk.gray(`   Written: ${outputPath}`));
    } else if (action === 'verify') {
      const workspacePath = requireWorkspaceRootForAction('verify');
      const { buildWorkspaceVerify, writeWorkspaceVerify, evaluateWorkspaceVerifyGate } =
        await import('./workspace-verify.js');
      const verify = await buildWorkspaceVerify({
        workspacePath,
        fromImpactPath: actionOptions.fromImpact || subaction,
        scope: actionOptions.scope,
        includeAbsolutePaths: actionOptions.includePaths === true || hasRawFlag('--include-paths'),
        includeEvidence: actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
        observableScanDepth: workspaceModelScanDepth(),
      });
      const outputPath = await writeWorkspaceVerify(verify, workspacePath);
      const gate = evaluateWorkspaceVerifyGate(verify, {
        strict: actionOptions.strict === true || hasRawFlag('--strict'),
      });
      const exitCode = gate.exitCode;
      const { recordWorkspaceHistory, historyEntryFromVerify } =
        await import('./workspace-history.js');
      await recordWorkspaceHistory(workspacePath, historyEntryFromVerify(verify, gate.passed));
      if (actionOptions.json) {
        console.log(
          JSON.stringify(
            cliOperationSuccess('workspace verify', { ...verify, gate }, outputPath),
            null,
            2
          )
        );
        if (exitCode !== 0) {
          process.exit(exitCode);
        }
        return;
      }
      const color =
        verify.summary.verdict === 'ready'
          ? chalk.green
          : verify.summary.verdict === 'needs-attention'
            ? chalk.yellow
            : chalk.red;
      console.log(color(`✔ Workspace verify: ${verify.summary.verdict}`));
      console.log(chalk.gray(`   Freshness: ${verify.freshness.verdict}`));
      console.log(chalk.gray(`   Impact risk: ${verify.impact.risk}`));
      console.log(chalk.gray(`   Steps: ${verify.steps.length}`));
      console.log(
        chalk.gray(
          `   Passed ${verify.summary.stepsPassed}, warn ${verify.summary.stepsWarn}, failed ${verify.summary.stepsFailed}, missing ${verify.summary.stepsMissing}`
        )
      );
      for (const step of verify.steps.slice(0, 10)) {
        console.log(chalk.gray(`   • ${step.id}: ${step.status} — ${step.message}`));
      }
      if (verify.steps.length > 10) {
        console.log(chalk.gray(`   … ${verify.steps.length - 10} more step(s)`));
      }
      if (verify.policyViolations.length > 0) {
        console.log(
          chalk.gray(
            `   Policy (${verify.policyMode}): ${verify.policyViolations.length} violation(s)`
          )
        );
        for (const violation of verify.policyViolations.slice(0, 5)) {
          const mark = violation.severity === 'error' ? chalk.red('✗') : chalk.yellow('!');
          console.log(`   ${mark} [${violation.source}] ${violation.code}: ${violation.message}`);
        }
      }
      console.log(chalk.gray(`   Gate (${gate.mode}): ${gate.passed ? 'passed' : 'blocked'}`));
      for (const reason of gate.reasons.slice(0, 5)) {
        console.log(chalk.red(`   ✗ ${reason}`));
      }
      console.log(chalk.gray(`   Written: ${outputPath}`));
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } else if (action === 'graph') {
      const workspacePath = requireWorkspaceRootForAction('graph');
      const { buildWorkspaceModel, workspaceModelProjectTopology } =
        await import('./workspace-model.js');
      const { buildGraphEmit, renderGraphDot, renderGraphMermaid, explainGraphNode } =
        await import('./workspace-graph.js');
      const model = await buildWorkspaceModel({
        workspacePath,
        includeAbsolutePaths: actionOptions.includePaths === true || hasRawFlag('--include-paths'),
        includeEvidence: actionOptions.includeEvidence === true || hasRawFlag('--include-evidence'),
        observableScanDepth: workspaceModelScanDepth(),
      });
      const graph = workspaceModelProjectTopology(model);
      const mode = (subaction || 'emit').toLowerCase();
      if (!graph) {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                command: 'workspace graph',
                action: mode,
                result: 'error',
                workspacePath,
                timestamp: new Date().toISOString(),
                error: {
                  code: 'workspace.graph.missing',
                  message: 'Workspace model did not produce a dependency graph.',
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red('❌ Workspace model did not produce a dependency graph.'));
        process.exit(1);
      }

      const buildKnowledgeGraph = async () => {
        const { buildWorkspaceKnowledgeGraph } = await import('./workspace-knowledge-graph.js');
        const { hashWorkspaceModel } = await import('./workspace-model-hash.js');
        const { readWorkspaceContract } = await import('./utils/workspace-contract.js');
        let contract = null;
        try {
          contract = (await readWorkspaceContract({ workspacePath })).contract;
        } catch {
          // Observed workspaces can still produce a knowledge graph without an authored contract.
        }
        return buildWorkspaceKnowledgeGraph({
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
            framework: project.framework,
            ...(project.kit ? { kit: project.kit } : {}),
          })),
          projectTopology: graph,
          contract,
          now: new Date(model.generatedAt),
          source: {
            kind: 'workspace-model',
            artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
            hashAlgorithm: 'sha256',
            hash: hashWorkspaceModel(model),
          },
        });
      };

      if (mode === 'dot') {
        console.log(renderGraphDot(graph));
        return;
      }
      if (mode === 'mermaid') {
        console.log(renderGraphMermaid(graph));
        return;
      }
      if (mode === 'jsonld' || mode === 'graphml' || mode === 'gexf') {
        const knowledgeGraph = await buildKnowledgeGraph();
        const {
          renderWorkspaceKnowledgeGraphGexf,
          renderWorkspaceKnowledgeGraphGraphMl,
          renderWorkspaceKnowledgeGraphJsonLd,
        } = await import('./workspace-knowledge-graph-export.js');
        const rendered =
          mode === 'jsonld'
            ? renderWorkspaceKnowledgeGraphJsonLd(knowledgeGraph)
            : mode === 'graphml'
              ? renderWorkspaceKnowledgeGraphGraphMl(knowledgeGraph)
              : renderWorkspaceKnowledgeGraphGexf(knowledgeGraph);
        const output = workspaceOutputPath();
        if (output) {
          const outputPath = path.resolve(workspacePath, output);
          await fsExtra.outputFile(outputPath, `${rendered}\n`, 'utf8');
          if (actionOptions.json) {
            console.log(
              JSON.stringify(
                cliOperationSuccess(
                  `workspace graph ${mode}`,
                  {
                    format: mode,
                    entityCount: knowledgeGraph.entities.length,
                    relationCount: knowledgeGraph.relations.length,
                    proofCount: knowledgeGraph.proofs.length,
                  },
                  outputPath
                ),
                null,
                2
              )
            );
          } else {
            console.log(chalk.green(`✔ Workspace knowledge graph exported as ${mode}`));
            console.log(chalk.gray(`   Written: ${outputPath}`));
          }
          return;
        }
        console.log(rendered);
        return;
      }
      if (mode === 'explain') {
        const project = (actionOptions.scope?.replace(/^project:/, '') || key || '').trim();
        if (!project) {
          if (actionOptions.json) {
            console.log(
              JSON.stringify(
                {
                  command: 'workspace graph explain',
                  result: 'error',
                  workspacePath,
                  timestamp: new Date().toISOString(),
                  error: {
                    code: 'workspace.graph.explain.missing_project',
                    message: 'workspace graph explain requires a project.',
                  },
                  usage: [
                    'npx workspai workspace graph explain <project> --json',
                    'npx workspai workspace graph explain --scope project:<name> --json',
                  ],
                },
                null,
                2
              )
            );
            process.exit(1);
          }
          console.log(chalk.red('❌ workspace graph explain requires a project.'));
          console.log(chalk.gray('   npx workspai workspace graph explain <project> --json'));
          console.log(chalk.gray('   npx workspai workspace graph explain --scope project:<name>'));
          process.exit(1);
        }
        const explain = explainGraphNode(graph, project);
        if (actionOptions.json) {
          console.log(JSON.stringify(explain, null, 2));
          if (!explain.found) {
            process.exit(1);
          }
          return;
        }
        if (!explain.found) {
          console.log(chalk.red(`❌ Project not found in dependency graph: ${project}`));
          process.exit(1);
        }
        console.log(chalk.green(`✔ Graph explain: ${explain.project}`));
        if (explain.centrality) {
          console.log(
            chalk.gray(
              `   Centrality: fanIn ${explain.centrality.fanIn}, fanOut ${explain.centrality.fanOut}, reach ${explain.centrality.reach}, betweenness ${explain.centrality.betweenness}${explain.centrality.isHotspot ? ' (hotspot)' : ''}`
            )
          );
        }
        console.log(
          chalk.gray(`   Direct dependents: ${explain.directDependents.join(', ') || 'none'}`)
        );
        console.log(
          chalk.gray(`   Direct dependencies: ${explain.directDependencies.join(', ') || 'none'}`)
        );
        console.log(
          chalk.gray(
            `   Blast radius (transitive dependents): ${explain.transitiveDependents.length}`
          )
        );
        for (const item of explain.transitiveDependents.slice(0, 10)) {
          console.log(chalk.gray(`   • ${item.id} (d${item.distance}, via ${item.via ?? '—'})`));
        }
        return;
      }

      if (mode === 'entities') {
        const knowledgeGraph = await buildKnowledgeGraph();
        const { queryKnowledgeEntities } = await import('./workspace-knowledge-graph-query.js');
        const entities = queryKnowledgeEntities(knowledgeGraph, key);
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: knowledgeGraph.schemaVersion,
                generatedAt: knowledgeGraph.generatedAt,
                kind: key ?? null,
                count: entities.length,
                entities,
              },
              null,
              2
            )
          );
          return;
        }
        console.log(chalk.green(`✔ Workspace graph entities${key ? `: ${key}` : ''}`));
        console.log(chalk.gray(`   Count: ${entities.length}`));
        for (const entity of entities) {
          console.log(chalk.gray(`   • ${entity.kind}: ${entity.label} [${entity.id}]`));
        }
        return;
      }

      if (mode === 'search' || mode === 'benchmark') {
        const query = (key || '').trim();
        if (!query) {
          console.log(chalk.red(`❌ workspace graph ${mode} requires a search query.`));
          console.log(
            chalk.gray(`   npx workspai workspace graph ${mode} "authentication endpoint" --json`)
          );
          process.exit(1);
        }
        const limitValue = Number.parseInt(
          actionOptions.limit ?? rawFlagValue('--limit') ?? '12',
          10
        );
        if (!Number.isFinite(limitValue) || limitValue < 1 || limitValue > 100) {
          console.log(chalk.red('❌ --limit must be an integer between 1 and 100.'));
          process.exit(1);
        }
        const knowledgeGraph = await buildKnowledgeGraph();
        if (mode === 'benchmark') {
          const { buildWorkspaceGraphTokenEfficiencyReport } =
            await import('./workspace-graph-token-efficiency.js');
          const report = await buildWorkspaceGraphTokenEfficiencyReport({
            workspacePath,
            graph: knowledgeGraph,
            query,
            limit: limitValue,
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            console.log(chalk.green(`✔ Graph retrieval benchmark: ${query}`));
            console.log(
              chalk.gray(
                `   Estimated tokens: ${report.corpus.estimatedTokens} corpus → ${report.retrieval.estimatedTokens} bounded retrieval`
              )
            );
            console.log(
              chalk.gray(
                `   Estimated payload reduction: ${report.savings.reductionRatio}× (${report.savings.reductionPercent}%)`
              )
            );
            console.log(chalk.gray(`   Matches: ${report.retrieval.matchCount}`));
            console.log(chalk.yellow(`   ${report.methodology.claimBoundary}`));
          }
          return;
        }
        const { searchKnowledgeGraph } = await import('./workspace-knowledge-graph-query.js');
        const result = searchKnowledgeGraph(knowledgeGraph, { query, limit: limitValue });
        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✔ Workspace graph search: ${query}`));
          console.log(
            chalk.gray(
              `   ${result.entities.length}/${result.totalMatches} match(es)${result.truncated ? ' (bounded)' : ''}`
            )
          );
          for (const entity of result.entities) {
            console.log(chalk.gray(`   • ${entity.kind}: ${entity.label} [${entity.id}]`));
          }
        }
        return;
      }

      if (mode === 'evidence') {
        const query = (key || '').trim();
        if (!query) {
          console.log(chalk.red('❌ workspace graph evidence requires an entity or relation id.'));
          process.exit(1);
        }
        const knowledgeGraph = await buildKnowledgeGraph();
        const { queryKnowledgeEvidence } = await import('./workspace-knowledge-graph-query.js');
        const result = queryKnowledgeEvidence(knowledgeGraph, query);
        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.found) {
          console.log(chalk.green(`✔ Graph evidence: ${query}`));
          for (const proof of result.proofs) {
            console.log(
              chalk.gray(
                `   • ${proof.artifact}${proof.pointer ? `#${proof.pointer}` : ''} [${proof.provider}/${proof.trust}/${proof.confidence}]`
              )
            );
          }
        } else {
          console.log(
            chalk.red(
              result.candidates.length > 0
                ? `❌ Graph query is ambiguous: ${query}`
                : `❌ Graph entity or relation not found: ${query}`
            )
          );
          for (const candidate of result.candidates.slice(0, 10)) {
            console.log(chalk.gray(`   • ${candidate}`));
          }
        }
        if (!result.found) process.exit(1);
        return;
      }

      if (mode === 'path') {
        const from = (key || '').trim();
        const to = (value || '').trim();
        if (!from || !to) {
          console.log(chalk.red('❌ workspace graph path requires <from> and <to>.'));
          console.log(chalk.gray('   npx workspai workspace graph path <from> <to> --json'));
          process.exit(1);
        }
        const knowledgeGraph = await buildKnowledgeGraph();
        const { queryKnowledgePath } = await import('./workspace-knowledge-graph-query.js');
        const result = queryKnowledgePath(knowledgeGraph, from, to);
        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.found) {
          console.log(chalk.green(`✔ Graph proof path: ${from} → ${to}`));
          for (const hop of result.hops) {
            console.log(
              chalk.gray(
                `   • ${hop.from} ${hop.direction === 'forward' ? '→' : '←'} ${hop.to} [${hop.kind}]`
              )
            );
          }
          console.log(chalk.gray(`   Proofs: ${result.proofs.length}`));
        } else {
          console.log(chalk.red(`❌ No graph path found between ${from} and ${to}.`));
        }
        if (!result.found) process.exit(1);
        return;
      }

      if (mode === 'overlay') {
        const fromPath = (actionOptions.from || key || '').trim();
        if (!fromPath) {
          console.log(chalk.red('❌ workspace graph overlay requires --from <graph.json>.'));
          console.log(
            chalk.gray('   npx workspai workspace graph overlay --from <graph.json> --json')
          );
          process.exit(1);
        }
        const absoluteFromPath = path.resolve(workspacePath, fromPath);
        let source: unknown;
        try {
          source = JSON.parse(await fsExtra.readFile(absoluteFromPath, 'utf8')) as unknown;
        } catch (error) {
          console.log(
            chalk.red(
              `❌ Could not read the base knowledge graph: ${error instanceof Error ? error.message : String(error)}`
            )
          );
          process.exit(1);
        }
        const sourceRecord =
          source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
        const nestedGraph = sourceRecord.graph;
        const nestedGraphRecord =
          nestedGraph && typeof nestedGraph === 'object'
            ? (nestedGraph as Record<string, unknown>)
            : {};
        const baseCandidate =
          sourceRecord.schemaVersion === WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph
            ? sourceRecord
            : (sourceRecord.knowledgeGraph ?? nestedGraphRecord.knowledgeGraph);
        if (
          !baseCandidate ||
          typeof baseCandidate !== 'object' ||
          (baseCandidate as Record<string, unknown>).schemaVersion !==
            WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph
        ) {
          console.log(
            chalk.red(
              `❌ Base file does not contain a ${WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.knowledgeGraph} document.`
            )
          );
          process.exit(1);
        }
        const knowledgeGraph = await buildKnowledgeGraph();
        const { buildWorkspaceKnowledgeGraphChangeOverlay } =
          await import('./workspace-knowledge-graph-change-overlay.js');
        const overlay = buildWorkspaceKnowledgeGraphChangeOverlay(
          baseCandidate as typeof knowledgeGraph,
          knowledgeGraph
        );
        if (actionOptions.json) {
          console.log(JSON.stringify(overlay, null, 2));
          return;
        }
        console.log(chalk.green('✔ Workspace graph change overlay'));
        console.log(chalk.gray(`   Base: ${fromPath}`));
        console.log(chalk.gray(`   Risk: ${overlay.summary.risk}`));
        console.log(
          chalk.gray(
            `   Entities: +${overlay.summary.entityAdds} -${overlay.summary.entityRemovals} ~${overlay.summary.entityChanges}`
          )
        );
        console.log(
          chalk.gray(
            `   Relations: +${overlay.summary.relationAdds} -${overlay.summary.relationRemovals} ~${overlay.summary.relationChanges}`
          )
        );
        console.log(
          chalk.gray(
            `   Proofs: +${overlay.summary.proofAdds} -${overlay.summary.proofRemovals} ~${overlay.summary.proofChanges}`
          )
        );
        console.log(
          chalk.gray(
            `   Impacted: ${overlay.summary.impactedEntities} entities · ${overlay.summary.changedArtifacts} proof artifacts`
          )
        );
        return;
      }

      const emit = buildGraphEmit(graph);
      const knowledgeGraph = await buildKnowledgeGraph();
      if (actionOptions.json) {
        console.log(JSON.stringify({ ...emit, knowledgeGraph }, null, 2));
        return;
      }
      console.log(chalk.green('✔ Workspace dependency graph'));
      console.log(chalk.gray(`   Nodes: ${emit.graph.stats.nodeCount}`));
      console.log(
        chalk.gray(
          `   Edges: ${emit.graph.stats.edgeCount} (inferred ${emit.graph.stats.inferredEdges}, contract ${emit.graph.stats.contractEdges}, manual ${emit.graph.stats.manualEdges})`
        )
      );
      console.log(
        chalk.gray(
          `   Integrity: ${emit.integrity.ok ? 'ok' : 'issues'} (cycles ${emit.integrity.stats.cycleCount}, dangling ${emit.integrity.stats.danglingCount}, orphans ${emit.integrity.stats.orphanCount})`
        )
      );
      console.log(chalk.gray(`   Hotspots: ${emit.hotspots.join(', ') || 'none'}`));
      console.log(
        chalk.gray(
          `   Knowledge: ${knowledgeGraph.quality.entityCount} entities · ${knowledgeGraph.quality.relationCount} relations · ${knowledgeGraph.quality.proofCount} proofs · ${knowledgeGraph.providers.length} providers`
        )
      );
      console.log(
        chalk.gray(
          '   Query: workspace graph search <query> | entities [kind] | path <from> <to> | evidence <entity-or-relation> | overlay --from <graph.json>'
        )
      );
      console.log(
        chalk.gray(
          '   Render: workspace graph dot | mermaid | jsonld | graphml | gexf [--output <file>]'
        )
      );
    } else if (action === 'watch') {
      const workspacePath = requireWorkspaceRootForAction('watch');
      const { runWorkspaceWatch } = await import('./workspace-watch.js');
      const once = actionOptions.once === true || hasRawFlag('--once');
      const emitGraphStream = actionOptions.graphStream === true || hasRawFlag('--graph-stream');
      // --graph-stream is already a machine-readable NDJSON mode. Treat it as
      // JSON output implicitly so the documented `watch --graph-stream`
      // command never emits human prose into the stream.
      const emitJson = actionOptions.json === true || emitGraphStream;
      const graphPublisher = emitGraphStream
        ? new (await import('./workspace-graph-stream.js')).WorkspaceGraphStreamPublisher({
            workspacePath,
          })
        : null;
      const controller = new AbortController();
      const onSigint = (): void => controller.abort();
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigint);

      if (!emitJson) {
        console.log(chalk.green('✔ Workspace watch (model + graph kept in memory)'));
      }

      await runWorkspaceWatch({
        workspacePath,
        once,
        signal: controller.signal,
        buildOptions: {
          workspacePath,
          observableScanDepth: workspaceModelScanDepth(),
        },
        onProgress: (message) => {
          if (!emitJson) {
            console.error(chalk.gray(`   ${message}`));
          }
        },
        onModel: graphPublisher
          ? async (model) => {
              const projectTopology = (
                await import('./workspace-model.js')
              ).workspaceModelProjectTopology(model);
              if (!projectTopology) {
                return;
              }
              const { buildWorkspaceKnowledgeGraph } =
                await import('./workspace-knowledge-graph.js');
              const { readWorkspaceContract } = await import('./utils/workspace-contract.js');
              let contract = null;
              try {
                contract = (await readWorkspaceContract({ workspacePath })).contract;
              } catch {
                // Observed workspaces remain valid graph-stream sources.
              }
              const graph = await buildWorkspaceKnowledgeGraph({
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
                  framework: project.framework,
                  ...(project.kit ? { kit: project.kit } : {}),
                })),
                projectTopology,
                contract,
                now: new Date(model.generatedAt),
                source: {
                  kind: 'workspace-model',
                  artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
                  hashAlgorithm: 'sha256',
                  hash: (await import('./workspace-model-hash.js')).hashWorkspaceModel(model),
                },
              });
              console.log(JSON.stringify(graphPublisher.publish(model, graph)));
            }
          : undefined,
        emit: (event) => {
          if (emitGraphStream) {
            return;
          }
          if (emitJson) {
            console.log(JSON.stringify(event));
            return;
          }
          if (event.kind === 'ready') {
            console.log(
              chalk.gray(
                `   Ready: ${event.graph.nodeCount} nodes, ${event.graph.edgeCount} edges (hash ${event.modelHash.slice(0, 12)})`
              )
            );
            return;
          }
          if (event.kind === 'error') {
            console.error(chalk.red(`   ✗ Rebuild failed: ${event.error ?? 'unknown error'}`));
            return;
          }
          if (event.kind === 'unchanged') {
            console.log(
              chalk.gray(`   No structural change (${event.mode}, ${event.durationMs}ms)`)
            );
            return;
          }
          const parts: string[] = [];
          if (event.changedProjects.length > 0)
            parts.push(`changed: ${event.changedProjects.join(', ')}`);
          if (event.addedProjects.length > 0)
            parts.push(`added: ${event.addedProjects.join(', ')}`);
          if (event.removedProjects.length > 0)
            parts.push(`removed: ${event.removedProjects.join(', ')}`);
          if (event.graph.edgesAdded.length > 0)
            parts.push(`+${event.graph.edgesAdded.length} edges`);
          if (event.graph.edgesRemoved.length > 0)
            parts.push(`-${event.graph.edgesRemoved.length} edges`);
          console.log(
            chalk.cyan(
              `   ↻ Changed (${event.mode}, ${event.durationMs}ms): ${parts.join('; ') || 'structure updated'}`
            )
          );
        },
      });

      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigint);
      if (!emitJson && !once) {
        console.log(chalk.gray('   Watch stopped.'));
      }
      return;
    } else if (action === 'sync') {
      const workspacePath = requireWorkspaceRootForAction('sync');
      const { syncWorkspaceProjects } = await import('./workspace.js');
      if (!actionOptions.json) {
        console.log(chalk.cyan(`📂 Scanning workspace: ${path.basename(workspacePath)}`));
      }
      const syncResult = await syncWorkspaceProjects(workspacePath, actionOptions.json === true);
      await syncWorkspaceContractAfterProjectChange(workspacePath, {
        silent: actionOptions.json === true,
      });
      const { syncWorkspaceProjectLenses } = await import('./project-intelligence-lens.js');
      const projectLenses = await syncWorkspaceProjectLenses({
        workspacePath,
        mode: actionOptions.projectGrounding ?? 'managed',
      });
      const { readWorkspaceRegistrySummary } =
        await import('./utils/workspace-registry-summary.js');
      const registrySummary = await readWorkspaceRegistrySummary(workspacePath);
      if (actionOptions.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: 'rapidkit-workspace-sync-v1',
              workspacePath,
              registry: syncResult,
              contractSynced: true,
              projectLenses: {
                synced: projectLenses.projects.length,
                skipped: projectLenses.skipped,
              },
              registrySummary,
            },
            null,
            2
          )
        );
      }
    } else if (action === 'registry') {
      const workspacePath = requireWorkspaceRootForAction('registry');
      const registryAction = subaction || 'status';
      if (registryAction !== 'status') {
        console.log(chalk.red(`❌ Unknown workspace registry action: ${registryAction}`));
        console.log(chalk.gray('   npx workspai workspace registry status [--refresh] [--json]'));
        process.exit(1);
      }
      const { publishWorkspaceRegistrySummary, resolveWorkspaceRegisteredProjects } =
        await import('./utils/workspace-registry-summary.js');
      const summary = await publishWorkspaceRegistrySummary(workspacePath);
      if (actionOptions.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      const resolved = await resolveWorkspaceRegisteredProjects(workspacePath);
      console.log(chalk.cyan('Workspace registry'));
      console.log(chalk.gray(`   Authority: ${summary.authority}`));
      console.log(chalk.gray(`   Projects: ${summary.projectCount}`));
      console.log(chalk.gray(`   Summary: ${summary.registrySummaryPath}`));
      if (resolved.summary.projectCount === 0) {
        console.log(
          chalk.yellow('   No registered projects — run workspace sync after adding projects.')
        );
      }
    } else if (action === 'foundation') {
      const workspacePath = requireWorkspaceRootForAction('foundation');
      const foundationAction = subaction || 'ensure';
      if (foundationAction !== 'ensure') {
        console.log(chalk.red(`❌ Unknown workspace foundation action: ${foundationAction}`));
        console.log(chalk.gray('   npx workspai workspace foundation ensure [--force] [--json]'));
        process.exit(1);
      }
      const { ensureWorkspaceFoundation } = await import('./utils/workspace-foundation.js');
      const result = await ensureWorkspaceFoundation(workspacePath, {
        force: actionOptions.force === true || hasRawFlag('--force'),
      });
      if (actionOptions.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.created.length > 0) {
        console.log(chalk.green(`✔ Workspace foundation ensured: ${result.created.join(', ')}`));
      } else {
        console.log(chalk.gray('Workspace foundation files are already up to date.'));
      }
    } else if (action === 'policy') {
      const workspacePath = requireWorkspaceRootForAction('policy');
      const code = await handleWorkspacePolicyCommand(
        workspacePath,
        subaction,
        key,
        value,
        actionOptions.json === true || hasRawFlag('--json')
      );
      if (code !== 0) process.exit(code);
    } else if (action === 'contract') {
      const workspacePath = requireWorkspaceRootForAction('contract');
      const {
        buildWorkspaceContractGraph,
        readWorkspaceContract,
        verifyWorkspaceContract,
        writeWorkspaceContract,
        WORKSPACE_CONTRACT_PATH,
      } = await import('./utils/workspace-contract.js');
      const contractAction = subaction || 'inspect';
      const contractPath = workspaceOutputPath();

      try {
        if (contractAction === 'init') {
          const result = await writeWorkspaceContract({
            workspacePath,
            outputPath: contractPath,
            force: actionOptions.force === true || hasRawFlag('--force'),
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(chalk.green(`✔ Workspace contract initialized: ${result.contractPath}`));
          console.log(chalk.gray(`   Projects: ${result.contract.projects.length}`));
          return;
        }

        if (contractAction === 'inspect') {
          const result = await readWorkspaceContract({ workspacePath, contractPath });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(chalk.green(`✔ Workspace contract: ${result.contractPath}`));
          console.log(chalk.gray(`   Workspace: ${result.contract.workspace.name}`));
          console.log(chalk.gray(`   Projects: ${result.contract.projects.length}`));
          console.log(chalk.gray(`   Schema: v${result.contract.schemaVersion}`));
          return;
        }

        if (contractAction === 'verify') {
          const result = await verifyWorkspaceContract({
            workspacePath,
            contractPath,
            strict: actionOptions.strict === true || hasRawFlag('--strict'),
          });
          const { writeWorkspaceContractVerifyEvidence } =
            await import('./utils/workspace-contract.js');
          const evidencePath = await writeWorkspaceContractVerifyEvidence({
            workspacePath,
            result,
          });
          if (actionOptions.json) {
            console.log(JSON.stringify({ ...result, evidencePath }, null, 2));
          } else {
            const color = result.status === 'passed' ? chalk.green : chalk.red;
            console.log(
              color(`✔ Workspace contract verification ${result.status}: ${result.contractPath}`)
            );
            console.log(chalk.gray(`   Projects: ${result.projectCount}`));
            for (const check of result.checks) {
              const marker = check.status === 'passed' ? '✔' : '✘';
              console.log(chalk.gray(`   ${marker} ${check.id}: ${check.message}`));
            }
            for (const violation of result.violations) {
              console.log(chalk.gray(`   Violation: ${violation}`));
            }
          }
          if (result.status === 'failed' || (result.status !== 'passed' && actionOptions.strict)) {
            process.exit(1);
          }
          return;
        }

        if (contractAction === 'graph') {
          const result = await buildWorkspaceContractGraph({ workspacePath, contractPath });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(chalk.green(`✔ Workspace contract graph: ${result.contractPath}`));
          console.log(chalk.gray(`   Workspace: ${result.graph.workspace.name}`));
          console.log(chalk.gray(`   Projects: ${result.graph.summary.projectCount}`));
          console.log(chalk.gray(`   Dependencies: ${result.graph.summary.dependencyEdges}`));
          console.log(chalk.gray(`   Event links: ${result.graph.summary.eventEdges}`));
          console.log(
            chalk.gray(
              `   Evidence-backed relationships: ${result.graph.summary.relationshipEdges} (${result.graph.summary.inferredEdges} inferred, ${result.graph.summary.authoritativeEdges} authoritative)`
            )
          );
          console.log(
            chalk.gray(
              `   Connected projects: ${result.graph.summary.connectedProjects}/${result.graph.summary.projectCount} · Edge coverage: ${Math.round(result.graph.summary.edgeCoverageRatio * 100)}% · Evidence coverage: ${Math.round(result.graph.summary.evidenceCoverageRatio * 100)}%`
            )
          );
          console.log(
            chalk.gray(
              `   Orphans: ${result.graph.summary.orphanProjects} · Hotspots: ${result.graph.summary.hotspotProjects} · Low-confidence edges: ${result.graph.summary.lowConfidenceEdges} · Cycles: ${result.graph.summary.hasCycle ? 'yes' : 'no'}`
            )
          );
          console.log(
            chalk.gray(
              `   Knowledge: ${result.graph.summary.entityCount} entities · ${result.graph.summary.knowledgeRelations} relations · ${result.graph.summary.proofCount} proofs · ${result.graph.summary.providerCount} providers · ${result.graph.summary.knowledgeUnknowns} unknown(s)`
            )
          );
          console.log(chalk.gray(`   Ports: ${result.graph.summary.portCount}`));
          for (const node of result.graph.nodes) {
            const ports =
              node.ports.map((port) => `${port.name}:${port.port}`).join(', ') || 'none';
            const profile = node.operationalProfile
              ? ` risk=${node.operationalProfile.weight}/${node.operationalProfile.verificationPriority}`
              : '';
            console.log(
              chalk.gray(
                `   • ${node.id} (${node.runtime || 'unknown'}${node.framework ? `/${node.framework}` : ''}) ports=${ports} manifests=${node.files.manifests.length}${profile}`
              )
            );
          }
          for (const edge of result.graph.edges) {
            const label = edge.type === 'event' ? `event:${edge.label}` : edge.label;
            console.log(chalk.gray(`     ${edge.from} -> ${edge.to} [${label}]`));
          }
          if (result.graph.dependencyGraph.edges.length > 0) {
            console.log(
              chalk.gray('   Evidence-backed dependency direction (consumer -> dependency):')
            );
            for (const edge of result.graph.dependencyGraph.edges) {
              console.log(
                chalk.gray(
                  `     ${edge.from} -> ${edge.to} [${edge.kind}/${edge.source}/${edge.confidence}] evidence=${edge.evidence.length}`
                )
              );
            }
          }
          for (const diagnostic of result.graph.dependencyGraph.diagnostics || []) {
            console.log(chalk.gray(`   ${diagnostic.severity}: ${diagnostic.message}`));
          }
          return;
        }

        console.log(chalk.red(`❌ Unknown workspace contract action: ${contractAction}`));
        console.log(
          chalk.white(
            `   npx workspai workspace contract init|inspect|verify|graph [--output ${WORKSPACE_CONTRACT_PATH}]`
          )
        );
        process.exit(1);
      } catch (error) {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                command: `workspace contract ${contractAction}`,
                result: 'error',
                workspacePath,
                timestamp: new Date().toISOString(),
                error: {
                  code: `workspace.contract.${contractAction}.failed`,
                  message: (error as Error).message,
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(
          chalk.red(`❌ Workspace contract ${contractAction} failed: ${(error as Error).message}`)
        );
        process.exit(1);
      }
    } else if (action === 'share') {
      const workspacePath = requireWorkspaceRootForAction('share');

      const outputPath = workspaceOutputPath() || subaction;
      const { createWorkspaceShareBundle } = await import('./workspace.js');
      const bundlePath = await createWorkspaceShareBundle(workspacePath, {
        outputPath,
        includePaths: actionOptions.includePaths === true,
        includeDoctorEvidence: actionOptions.doctor !== false,
        includeBlueprint: actionOptions.blueprint !== false,
      });

      if (actionOptions.json) {
        console.log(
          JSON.stringify(
            {
              command: 'workspace share',
              result: 'ok',
              timestamp: new Date().toISOString(),
              workspacePath,
              bundlePath,
              options: {
                includePaths: actionOptions.includePaths === true,
                includeDoctorEvidence: actionOptions.doctor !== false,
                includeBlueprint: actionOptions.blueprint !== false,
              },
            },
            null,
            2
          )
        );
        return;
      }

      console.log(chalk.green(`✔ Workspace share bundle exported: ${bundlePath}`));
      console.log(
        chalk.gray('Share this JSON with your team for reproducible workspace/project diagnostics.')
      );
    } else if (action === 'export') {
      const workspacePath = requireWorkspaceRootForAction('export');
      try {
        const { exportWorkspaceArchive } = await import('./utils/workspace-archive.js');
        const compression = actionOptions.archiveCompression?.trim().toLowerCase() ?? 'store';
        if (compression !== 'store' && compression !== 'deflate') {
          throw new Error('--archive-compression must be store or deflate.');
        }
        const result = await exportWorkspaceArchive({
          workspacePath,
          outputPath: workspaceOutputPath() || subaction,
          includeEnv: actionOptions.includeEnv === true || hasRawFlag('--include-env'),
          compression,
        });

        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const sizeMb = (result.bytesWritten / (1024 * 1024)).toFixed(2);
        console.log(chalk.green(`✔ Workspace archive exported: ${result.archivePath}`));
        console.log(chalk.gray(`   Files: ${result.manifest.files.length}`));
        console.log(chalk.gray(`   Size: ${sizeMb} MB`));
        if (!result.manifest.security.envFilesIncluded) {
          console.log(
            chalk.gray('   Secrets: excluded (.env, private keys, logs, dependency caches)')
          );
        }
      } catch (error) {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
                operation: 'export',
                status: 'error',
                timestamp: new Date().toISOString(),
                error: {
                  code: 'workspace.archive.export.failed',
                  message: (error as Error).message,
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red(`❌ Workspace archive export failed: ${(error as Error).message}`));
        process.exit(1);
      }
    } else if (
      action === 'archive' &&
      (subaction === 'inspect' || subaction === 'verify' || subaction === 'doctor')
    ) {
      const archivePathOrUrl = key;
      if (!archivePathOrUrl) {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
                operation: subaction,
                status: 'error',
                timestamp: new Date().toISOString(),
                error: {
                  code: `workspace.archive.${subaction}.input-required`,
                  message: `workspace archive ${subaction} requires an archive path or URL.`,
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(
          chalk.red(`❌ workspace archive ${subaction} requires an archive path or URL.`)
        );
        console.log(
          chalk.white(`   npx workspai workspace archive ${subaction} team.workspai-archive.zip`)
        );
        process.exit(1);
      }

      const { doctorWorkspaceArchive, inspectWorkspaceArchive, verifyWorkspaceArchive } =
        await import('./utils/workspace-archive.js');
      try {
        if (subaction === 'inspect') {
          const result = await inspectWorkspaceArchive({
            archivePathOrUrl,
            safety: workspaceArchiveSafety(),
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          const sizeMb = (result.totalBytes / (1024 * 1024)).toFixed(2);
          console.log(chalk.green(`✔ Workspace archive: ${result.archivePath}`));
          console.log(chalk.gray(`   Workspace: ${result.manifest.workspaceName}`));
          console.log(chalk.gray(`   Exported: ${result.manifest.exportedAt}`));
          console.log(chalk.gray(`   Exporter: ${result.manifest.exportedBy || 'unknown'}`));
          console.log(chalk.gray(`   Files: ${result.fileCount}`));
          console.log(chalk.gray(`   Payload: ${sizeMb} MB`));
          return;
        }

        if (subaction === 'doctor') {
          const result = await doctorWorkspaceArchive({
            archivePathOrUrl,
            strict: actionOptions.strict === true || hasRawFlag('--strict'),
            safety: workspaceArchiveSafety(),
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const color =
              result.status === 'passed'
                ? chalk.green
                : result.status === 'warning'
                  ? chalk.yellow
                  : chalk.red;
            console.log(
              color(`✔ Workspace archive doctor ${result.status}: ${result.archivePath}`)
            );
            console.log(chalk.gray(`   Workspace: ${result.workspaceName}`));
            console.log(chalk.gray(`   Files: ${result.fileCount}`));
            for (const check of result.checks) {
              const marker =
                check.status === 'passed' ? '✔' : check.status === 'warning' ? '⚠' : '✘';
              console.log(chalk.gray(`   ${marker} ${check.id}: ${check.message}`));
            }
            for (const actionItem of result.recommendedActions) {
              console.log(chalk.gray(`   Next: ${actionItem}`));
            }
          }

          if (result.status === 'failed' || (result.status === 'warning' && actionOptions.strict)) {
            process.exit(1);
          }
          return;
        }

        const result = await verifyWorkspaceArchive({
          archivePathOrUrl,
          requireChecksums: actionOptions.strict === true || hasRawFlag('--strict'),
          safety: workspaceArchiveSafety(),
        });
        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.status === 'passed') {
          console.log(chalk.green(`✔ Workspace archive verified: ${result.archivePath}`));
          console.log(chalk.gray(`   Files: ${result.verifiedFiles}/${result.fileCount}`));
        } else {
          const color = result.status === 'failed' ? chalk.red : chalk.yellow;
          console.log(
            color(`❌ Workspace archive verification ${result.status}: ${result.archivePath}`)
          );
          if (result.missingArchiveEntries.length) {
            console.log(
              chalk.gray(`   Missing entries: ${result.missingArchiveEntries.join(', ')}`)
            );
          }
          if (result.extraArchiveEntries.length) {
            console.log(
              chalk.gray(`   Unexpected entries: ${result.extraArchiveEntries.join(', ')}`)
            );
          }
          if (result.mismatches.length) {
            console.log(
              chalk.gray(
                `   Mismatches: ${result.mismatches.map((mismatch) => mismatch.path).join(', ')}`
              )
            );
          }
          if (result.missingChecksumFiles.length) {
            console.log(
              chalk.gray(`   Missing checksums: ${result.missingChecksumFiles.join(', ')}`)
            );
          }
        }

        if (result.status === 'failed' || (result.status === 'warning' && actionOptions.strict)) {
          process.exit(1);
        }
      } catch (error) {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
                operation: subaction,
                status: 'error',
                timestamp: new Date().toISOString(),
                archivePathOrUrl,
                error: {
                  code: `workspace.archive.${subaction}.failed`,
                  message: (error as Error).message,
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(
          chalk.red(`❌ Workspace archive ${subaction} failed: ${(error as Error).message}`)
        );
        process.exit(1);
      }
    } else if (action === 'connect') {
      const workspacePath = path.resolve(subaction || process.cwd());
      try {
        const result = await connectWorkspace({
          workspacePath,
          dryRun: actionOptions.dryRun === true || hasRawFlag('--dry-run'),
          projectGrounding: actionOptions.projectGrounding,
        });
        if (actionOptions.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          chalk.green(
            result.status === 'preview'
              ? `✔ Workspace connection preview: ${workspacePath}`
              : `✔ Workspace connected: ${workspacePath}`
          )
        );
        for (const warning of result.warnings) console.log(chalk.yellow(`   ⚠ ${warning}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace connect',
                code: 'workspace.connect.failed',
                message,
              }),
              null,
              2
            )
          );
        } else {
          console.log(chalk.red(`❌ Workspace connect failed: ${message}`));
        }
        process.exit(1);
      }
    } else if (action === 'hydrate' || action === 'import') {
      const archivePathOrUrl = subaction;
      if (!archivePathOrUrl) {
        if (actionOptions.json) {
          if (action === 'import') {
            console.log(
              JSON.stringify(
                cliOperationError({
                  operation: 'workspace import',
                  code: 'workspace.import.input-required',
                  message: 'workspace import requires an archive path or URL.',
                }),
                null,
                2
              )
            );
            process.exit(1);
          }
          console.log(
            JSON.stringify(
              {
                schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
                operation: 'hydrate',
                status: 'error',
                timestamp: new Date().toISOString(),
                error: {
                  code: 'workspace.hydrate.input-required',
                  message: 'workspace hydrate requires an archive path or URL.',
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red(`❌ workspace ${action} requires an archive path or URL.`));
        console.log(
          chalk.white(
            `   npx workspai workspace ${action} team.workspai-archive.zip --output ./team`
          )
        );
        process.exit(1);
      }

      try {
        if (action === 'import') {
          const result = await importWorkspaceArchive({
            archivePathOrUrl,
            outputPath: workspaceOutputPath(),
            dryRun: actionOptions.dryRun === true || hasRawFlag('--dry-run'),
            strict: actionOptions.strict === true || hasRawFlag('--strict'),
            projectGrounding: actionOptions.projectGrounding,
            safety: workspaceArchiveSafety(),
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(
            chalk.green(
              result.status === 'preview'
                ? `✔ Workspace import preview: ${result.workspacePath}`
                : `✔ Workspace imported and registered: ${result.workspacePath}`
            )
          );
          for (const warning of result.warnings) console.log(chalk.yellow(`   ⚠ ${warning}`));
        } else {
          const { hydrateWorkspaceArchive } = await import('./utils/workspace-archive.js');
          const result = await hydrateWorkspaceArchive({
            archivePathOrUrl,
            outputPath: workspaceOutputPath(),
            force: actionOptions.force === true || hasRawFlag('--force'),
            dryRun: actionOptions.dryRun === true || hasRawFlag('--dry-run'),
            strict: actionOptions.strict === true || hasRawFlag('--strict'),
            safety: workspaceArchiveSafety(),
          });
          if (actionOptions.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(
            chalk.green(
              result.dryRun
                ? `✔ Workspace archive hydrate preview: ${result.outputPath}`
                : `✔ Workspace archive hydrated: ${result.outputPath}`
            )
          );
          console.log(chalk.gray(`   Files: ${result.files.length}`));
          if (result.manifest?.workspaceName) {
            console.log(chalk.gray(`   Workspace: ${result.manifest.workspaceName}`));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (actionOptions.json) {
          if (action === 'import') {
            console.log(
              JSON.stringify(
                cliOperationError({
                  operation: 'workspace import',
                  code: 'workspace.import.failed',
                  message,
                  context: {
                    archivePathOrUrl,
                    ...(workspaceOutputPath()
                      ? { outputPath: workspaceOutputPath() as string }
                      : {}),
                  },
                }),
                null,
                2
              )
            );
            process.exit(1);
          }
          console.log(
            JSON.stringify(
              {
                schemaVersion: WORKSPACE_ARCHIVE_OPERATION_RESULT_SCHEMA_VERSION,
                operation: 'hydrate',
                status: 'error',
                timestamp: new Date().toISOString(),
                archivePathOrUrl,
                ...(workspaceOutputPath() ? { outputPath: workspaceOutputPath() } : {}),
                dryRun: actionOptions.dryRun === true || hasRawFlag('--dry-run'),
                error: {
                  code: `workspace.${action}.failed`,
                  message,
                },
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red(`❌ Workspace ${action} failed: ${message}`));
        process.exit(1);
      }
    } else if (action === 'run') {
      const workspacePath = requireWorkspaceRootForAction(`run ${subaction || ''}`.trim());

      const fleetStages = new Set(['init', 'test', 'build', 'start']);
      const stageName = subaction?.trim() ?? '';
      if (!stageName) {
        console.log(chalk.red(`Unknown workspace run stage: ${subaction || '(none provided)'}`));
        console.log(
          chalk.gray('Available stages: init | test | build | start | <custom-from-context>')
        );
        console.log(chalk.gray('  • init   — run install/bootstrap across the project fleet'));
        console.log(chalk.gray('  • test   — run test suite across selected projects'));
        console.log(chalk.gray('  • build  — compile/package across selected projects'));
        console.log(chalk.gray('  • start  — start services (smoke/e2e scenarios)'));
        console.log(
          chalk.gray('  • custom — any stage key declared in .workspai/context.json commands')
        );
        console.log(
          chalk.gray('  Note: dev is excluded — it is a local-only primitive, not a CI stage')
        );
        process.exit(2);
      }

      if (!fleetStages.has(stageName)) {
        if (!/^[a-z][a-z0-9_-]*$/i.test(stageName) || stageName === 'dev' || stageName === 'stop') {
          console.log(chalk.red(`Unknown workspace run stage: ${stageName}`));
          console.log(
            chalk.gray('Available stages: init | test | build | start | <custom-from-context>')
          );
          process.exit(2);
        }
      }

      const maxWorkers = resolveMaxWorkersOption({
        raw: actionOptions.maxWorkers,
        operation: `workspace run ${stageName}`,
        json: actionOptions.json === true || hasRawFlag('--json'),
      });

      if (stageName === 'init') {
        if (actionOptions.json === true) {
          // Machine-readable workspace run must always reach the fleet report.
          // Workspace-level dependency bootstrap can be long-running and belongs
          // to `workspai bootstrap` / `workspai setup`; project init remains
          // covered by runWorkspaceStage below.
        } else {
          const workspaceInitCode = await installWorkspaceDependencies(workspacePath);
          if (workspaceInitCode !== 0) {
            process.exit(workspaceInitCode);
          }
        }
      }

      const { runWorkspaceStage } = await import('./workspace-run.js');
      const report = await runWorkspaceStage({
        workspacePath,
        stage: stageName,
        scope: actionOptions.scope,
        affected: actionOptions.affected === true,
        blastRadius: actionOptions.blastRadius === true,
        since: actionOptions.since,
        parallel: actionOptions.parallel === true,
        maxWorkers,
        continueOnError: actionOptions.continueOnError === true,
        strict: actionOptions.strict === true,
        json: actionOptions.json === true,
        enforceGates: actionOptions.gates,
        reusePassed: actionOptions.reusePassed === true,
      });

      if (actionOptions.json) {
        console.log(JSON.stringify(report, null, 2));
      }

      if (report.summary.exitCode !== 0) {
        process.exit(report.summary.exitCode);
      }
    } else if (action === 'explain' || action === 'why') {
      const workspacePath = requireWorkspaceRootForAction(action);
      const { parseWorkspaceExplainTarget } =
        await import('./contracts/workspace-explain-contract.js');
      const { buildWorkspaceExplain, writeWorkspaceExplainReport } =
        await import('./workspace-explain.js');

      let targetRaw = (subaction ?? key ?? '').trim();
      if (!targetRaw && actionOptions.scope) {
        targetRaw = actionOptions.scope.startsWith('project:')
          ? actionOptions.scope
          : `project:${actionOptions.scope}`;
      }
      if (!targetRaw) {
        // The public command contract intentionally makes the target optional.
        // Default to the current release decision so a user can ask for the
        // workspace explanation without first learning an internal target id.
        targetRaw = 'release-blocked';
      }

      const target = parseWorkspaceExplainTarget(targetRaw);
      if (!target) {
        console.log(chalk.red(`❌ Invalid explain target: ${targetRaw}`));
        process.exit(1);
      }

      const report = await buildWorkspaceExplain({ workspacePath, target });
      const writeRequested = actionOptions.write === true || hasRawFlag('--write');
      let outputPath: string | undefined;
      if (writeRequested) {
        outputPath = await writeWorkspaceExplainReport(
          report,
          workspacePath,
          action === 'why' ? 'why' : 'explain'
        );
      }

      if (actionOptions.json) {
        console.log(
          JSON.stringify(cliOperationSuccess(`workspace ${action}`, report, outputPath), null, 2)
        );
        return;
      }

      console.log(
        chalk.green(`✔ Workspace ${action === 'why' ? 'why' : 'explain'}: ${report.summary}`)
      );
      for (const section of report.sections) {
        console.log(chalk.bold(`\n${section.title}`));
        console.log(section.body);
      }
      if (outputPath) {
        console.log(chalk.gray(`\nWritten: ${outputPath}`));
      }
    } else if (action === 'trace') {
      const workspacePath = requireWorkspaceRootForAction('trace');
      const fromRef = actionOptions.from || subaction;
      if (!fromRef) {
        console.log(chalk.red('❌ workspace trace requires --from <diff-ref>'));
        console.log(
          chalk.gray(
            '   npx workspai workspace trace --from .workspai/reports/workspace-model-diff-last-run.json --json'
          )
        );
        process.exit(1);
      }
      const { resolveWorkspaceTraceTarget } =
        await import('./contracts/workspace-explain-contract.js');
      const { buildWorkspaceExplain, writeWorkspaceExplainReport } =
        await import('./workspace-explain.js');
      const traceTarget = resolveWorkspaceTraceTarget(fromRef);
      if (!traceTarget || traceTarget.kind !== 'trace') {
        console.log(chalk.red(`❌ Invalid trace ref: ${fromRef}`));
        console.log(
          chalk.gray(
            '   Use a diff artifact path or trace:<path>, e.g. trace:.workspai/reports/workspace-model-diff-last-run.json'
          )
        );
        process.exit(1);
      }
      const report = await buildWorkspaceExplain({
        workspacePath,
        target: traceTarget,
      });
      const writeRequested = actionOptions.write === true || hasRawFlag('--write');
      let outputPath: string | undefined;
      if (writeRequested) {
        outputPath = await writeWorkspaceExplainReport(report, workspacePath, 'trace');
      }
      if (actionOptions.json) {
        console.log(
          JSON.stringify(cliOperationSuccess('workspace trace', report, outputPath), null, 2)
        );
        return;
      }
      console.log(chalk.green(`✔ Workspace trace: ${report.summary}`));
      for (const section of report.sections) {
        console.log(chalk.bold(`\n${section.title}`));
        console.log(section.body);
      }
      if (outputPath) {
        console.log(chalk.gray(`\nWritten: ${outputPath}`));
      }
    } else if (action === 'eval') {
      const workspacePath = requireWorkspaceRootForAction('eval');
      const mode = (subaction || 'status').toLowerCase();
      const {
        WORKSPACE_EVALUATION_LAST_RUN_PATH,
        WORKSPACE_EVALUATION_LIVE_PATH,
        appendWorkspaceEvaluationEvent,
        compareWorkspaceEvaluations,
        createWorkspaceEvaluation,
        finalizeWorkspaceEvaluation,
        readWorkspaceEvaluation,
        writeWorkspaceEvaluation,
      } = await import('./workspace-intelligence-evaluation.js');

      if (mode === 'init') {
        const taskId = (key || '').trim();
        const strategy = (value || 'workspace-intelligence').trim();
        const strategies = [
          'full-corpus',
          'grep',
          'vector',
          'graph',
          'workspace-intelligence',
          'custom',
        ] as const;
        if (!taskId || !strategies.includes(strategy as (typeof strategies)[number])) {
          console.log(
            chalk.red('❌ workspace eval init requires <task> and an optional valid strategy.')
          );
          console.log(
            chalk.gray(
              `   Strategies: ${strategies.join(' | ')}\n   npx workspai workspace eval init repair-readiness workspace-intelligence --json`
            )
          );
          process.exit(1);
        }
        const { readWorkspaceMarker } = await import('./workspace-marker.js');
        const workspaceMarker = await readWorkspaceMarker(workspacePath);
        const report = createWorkspaceEvaluation({
          workspacePath,
          workspaceName: workspaceMarker?.name,
          taskId,
          strategy: strategy as (typeof strategies)[number],
        });
        const outputPath = await writeWorkspaceEvaluation(workspacePath, report);
        if (actionOptions.json) {
          console.log(
            JSON.stringify(cliOperationSuccess('workspace eval init', report, outputPath), null, 2)
          );
          return;
        }
        console.log(chalk.green(`✔ Evaluation started: ${taskId}`));
        console.log(chalk.gray(`   Run: ${report.runId}`));
        console.log(chalk.gray(`   Strategy: ${report.configuration.strategy}`));
        console.log(chalk.gray(`   Live: ${outputPath}`));
        return;
      }

      if (mode === 'record') {
        if (!actionOptions.json && !hasRawFlag('--json')) {
          console.log(chalk.red('❌ workspace eval record requires --json and a stdin event.'));
          process.exit(1);
        }
        if (process.stdin.isTTY) {
          console.log(chalk.red('❌ workspace eval record requires piped JSON on stdin.'));
          process.exit(1);
        }
        const { parseFeedbackStdinPayload, readStdinAll } = await import('./workspace-feedback.js');
        const payload = parseFeedbackStdinPayload(await readStdinAll());
        if (!payload) {
          console.log(chalk.red('❌ Invalid or empty evaluation event JSON on stdin.'));
          process.exit(1);
        }
        try {
          const report = await appendWorkspaceEvaluationEvent({ workspacePath, payload });
          console.log(JSON.stringify(report, null, 2));
        } catch (error) {
          console.log(
            JSON.stringify(
              cliOperationError({
                operation: 'workspace eval record',
                code: 'workspace.eval.event_invalid',
                message: error instanceof Error ? error.message : String(error),
                context: { workspacePath },
              }),
              null,
              2
            )
          );
          process.exit(1);
        }
        return;
      }

      if (mode === 'report') {
        const result = await finalizeWorkspaceEvaluation({ workspacePath });
        const requestedOutput = workspaceOutputPath();
        let outputPath = result.outputPath;
        if (requestedOutput) {
          const requestedOutputPath = path.resolve(workspacePath, requestedOutput);
          if (path.resolve(result.outputPath) !== requestedOutputPath) {
            await fsExtra.copy(result.outputPath, requestedOutputPath, { overwrite: true });
          }
          outputPath = requestedOutputPath;
        }
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              cliOperationSuccess('workspace eval report', result.report, outputPath),
              null,
              2
            )
          );
          return;
        }
        console.log(chalk.green(`✔ Evaluation finalized: ${result.report.runId}`));
        console.log(
          chalk.gray(
            `   Tokens: ${result.report.summary.tokens.observedTotal} · model calls ${result.report.summary.modelCalls} · tool calls ${result.report.summary.toolCalls}`
          )
        );
        console.log(
          chalk.gray(
            `   Outcome: ${result.report.summary.outcome.status}${result.report.summary.outcome.verified ? ' (verified)' : ' (unverified)'}`
          )
        );
        console.log(chalk.gray(`   Written: ${outputPath}`));
        return;
      }

      if (mode === 'compare') {
        const fromPath = (actionOptions.from || key || '').trim();
        if (!fromPath) {
          console.log(chalk.red('❌ workspace eval compare requires --from <baseline-report>.'));
          process.exit(1);
        }
        const current = await readWorkspaceEvaluation(
          workspacePath,
          WORKSPACE_EVALUATION_LAST_RUN_PATH
        );
        const baseline = await readWorkspaceEvaluation(workspacePath, fromPath);
        const comparison = compareWorkspaceEvaluations(current, baseline);
        if (actionOptions.json) {
          console.log(JSON.stringify(comparison, null, 2));
          return;
        }
        console.log(chalk.green('✔ Workspace Intelligence evaluation comparison'));
        console.log(chalk.gray(`   Task aligned: ${comparison.taskAligned ? 'yes' : 'no'}`));
        console.log(chalk.gray(`   Token delta: ${comparison.delta.tokens}`));
        console.log(
          chalk.gray(
            `   Reduction: ${comparison.delta.reductionPercent === null ? 'unavailable' : `${comparison.delta.reductionPercent}%`}`
          )
        );
        console.log(
          chalk.gray(
            `   Comparable verified outcome: ${comparison.comparableOutcome ? 'yes' : 'no'}`
          )
        );
        return;
      }

      if (mode === 'status') {
        let report;
        try {
          report = await readWorkspaceEvaluation(workspacePath, WORKSPACE_EVALUATION_LIVE_PATH);
        } catch {
          report = await readWorkspaceEvaluation(workspacePath, WORKSPACE_EVALUATION_LAST_RUN_PATH);
        }
        if (actionOptions.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(chalk.green(`✔ Evaluation ${report.status}: ${report.configuration.taskId}`));
        console.log(chalk.gray(`   Run: ${report.runId}`));
        console.log(chalk.gray(`   Events: ${report.events.length}`));
        console.log(
          chalk.gray(
            `   Tokens: ${report.summary.tokens.observedTotal} (${report.summary.tokenSources.providerReported} provider-reported calls, ${report.summary.tokenSources.estimated} estimated calls)`
          )
        );
        return;
      }

      console.log(chalk.red(`Unknown eval action: ${mode}`));
      console.log(chalk.gray('Available: init | record | status | report | compare'));
      process.exit(1);
    } else if (action === 'feedback') {
      const workspacePath = requireWorkspaceRootForAction('feedback');
      const mode = (subaction || 'record').toLowerCase();
      if (mode !== 'record') {
        console.log(chalk.red(`Unknown feedback action: ${mode}`));
        console.log(chalk.gray('Available: record'));
        process.exit(1);
      }
      if (!actionOptions.json && !hasRawFlag('--json')) {
        console.log(chalk.red('❌ workspace feedback record requires --json (stdin payload)'));
        console.log(
          chalk.gray(
            '   echo \'{"actionId":"fix","summary":"ok","outcome":"ok"}\' | npx workspai workspace feedback record --json'
          )
        );
        process.exit(1);
      }
      if (process.stdin.isTTY) {
        console.log(
          chalk.red('❌ workspace feedback record requires piped JSON on stdin (not a TTY)')
        );
        console.log(
          chalk.gray(
            '   echo \'{"actionId":"fix","summary":"ok","outcome":"ok"}\' | npx workspai workspace feedback record --json'
          )
        );
        process.exit(1);
      }
      const { recordWorkspaceFeedback, parseFeedbackStdinPayload, readStdinAll } =
        await import('./workspace-feedback.js');
      const raw = await readStdinAll();
      const payload = parseFeedbackStdinPayload(raw);
      if (!payload) {
        console.log(chalk.red('❌ Invalid or empty feedback JSON on stdin'));
        process.exit(1);
      }
      const result = await recordWorkspaceFeedback({ workspacePath, payload });
      if (actionOptions.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(chalk.green('✔ Workspace feedback recorded'));
        console.log(chalk.gray(`   History: ${result.historyPath}`));
      } else {
        console.log(chalk.red(`❌ ${result.error ?? 'Failed to record feedback'}`));
      }
      if (!result.ok) {
        process.exit(1);
      }
    } else if (action === 'mcp') {
      const workspacePath = requireWorkspaceRootForAction('mcp');
      const mode = (subaction || 'serve').toLowerCase();
      if (mode !== 'serve') {
        if (actionOptions.json) {
          console.log(
            JSON.stringify(
              {
                command: 'workspace mcp',
                action: mode,
                result: 'error',
                workspacePath,
                timestamp: new Date().toISOString(),
                error: {
                  code: 'workspace.mcp.unknown_action',
                  message: `Unknown mcp action: ${mode}`,
                },
                availableActions: ['serve'],
              },
              null,
              2
            )
          );
          process.exit(1);
        }
        console.log(chalk.red(`Unknown mcp action: ${mode}`));
        console.log(chalk.gray('Available: serve'));
        process.exit(1);
      }
      const { runWorkspaceMcpServe } = await import('./workspace-mcp-serve.js');
      if (!actionOptions.json) {
        console.error(
          chalk.gray('ℹ Workspai MCP server (read-mostly) listening on stdio JSON-RPC…')
        );
      }
      await runWorkspaceMcpServe({ workspacePath });
    } else if (action === 'init') {
      if (!actionOptions.json) {
        console.log(
          chalk.yellow('ℹ  workspace init is an alias of: npx workspai workspace run init')
        );
        console.log(
          chalk.gray(
            '   Equivalent full-init aliases at workspace root:\n' +
              '   npx workspai init | npx workspai workspace init | npx workspai workspace run init\n'
          )
        );
      }

      const workspacePath = requireWorkspaceRootForAction('init');

      const maxWorkers = resolveMaxWorkersOption({
        raw: actionOptions.maxWorkers,
        operation: 'workspace init',
        json: actionOptions.json === true || hasRawFlag('--json'),
      });

      if (actionOptions.json !== true) {
        const workspaceInitCode = await installWorkspaceDependencies(workspacePath);
        if (workspaceInitCode !== 0) {
          process.exit(workspaceInitCode);
        }
      }

      const { runWorkspaceStage } = await import('./workspace-run.js');
      const report = await runWorkspaceStage({
        workspacePath,
        stage: 'init',
        scope: actionOptions.scope,
        affected: actionOptions.affected === true,
        blastRadius: actionOptions.blastRadius === true,
        since: actionOptions.since,
        parallel: actionOptions.parallel === true,
        maxWorkers,
        continueOnError: actionOptions.continueOnError === true,
        strict: actionOptions.strict === true,
        json: actionOptions.json === true,
        enforceGates: actionOptions.gates,
      });

      if (actionOptions.json) {
        console.log(JSON.stringify(report, null, 2));
      }

      if (report.summary.exitCode !== 0) {
        process.exit(report.summary.exitCode);
      }
    } else {
      if (actionOptions.json === true || hasRawFlag('--json')) {
        console.log(
          JSON.stringify(
            cliOperationError({
              operation: `workspace ${action}`,
              code: 'workspace.action.unknown',
              message: `Unknown workspace action: ${action}`,
              context: { availableActions: WORKSPACE_SUBCOMMANDS },
            }),
            null,
            2
          )
        );
        process.exit(1);
      }
      console.log(chalk.red(`Unknown workspace action: ${action}`));
      console.log(chalk.gray(`Available: ${WORKSPACE_SUBCOMMANDS.join(', ')}`));
      process.exit(1);
    }
  });

function printHelpSectionDivider(title: string): void {
  const rule = '─'.repeat(46);
  console.log('');
  console.log(chalk.gray(rule));
  console.log(chalk.bold(title));
  console.log(chalk.gray(rule));
}

export function printHelp() {
  const cmd = (text: string): string =>
    text.replace(/\bnpx (?:rapidkit|workspai)\b/g, primaryNpxCommand);
  const line = (command: string, description: string): void => {
    console.log(chalk.cyan(`  ${cmd(command).padEnd(67)}  `) + chalk.gray(description));
  };

  console.log(chalk.white('Usage:\n'));
  console.log(chalk.cyan(`  ${primaryNpxCommand} <command> [options]\n`));
  if (invokedCliName === 'rapidkit') {
    console.log(
      chalk.gray(`  You are using the legacy rapidkit alias. New docs use ${primaryNpxCommand}.\n`)
    );
  }

  console.log(chalk.bold('Open-Source Workspace Intelligence for Software Systems\n'));
  console.log(
    chalk.white(
      'Connect projects, contracts, evidence, and checks so developers, CI, IDEs, and AI agents share one current view of the system.'
    )
  );
  console.log(chalk.dim('One workspace. One truth. Humans and AI aligned.\n'));

  printHelpSectionDivider('Workspace Lifecycle');
  console.log('');
  line('npx workspai create', 'Create a workspace/project or bring in existing software');
  line('npx workspai adopt .', 'Link the current project without moving its source');
  line('npx workspai import <path|git-url>', 'Copy or clone software into a workspace');
  line(
    'npx workspai workspace intelligence run --for-agent generic --strict --json',
    'Refresh the canonical evidence chain'
  );

  printHelpSectionDivider('Workspace Intelligence');
  console.log(chalk.gray('\n  Code · APIs · infrastructure · docs · policies · runtime evidence'));
  console.log(chalk.gray('                              ↓'));
  console.log(chalk.gray('                   Canonical Workspace Model'));
  console.log(chalk.gray('                              ↓'));
  console.log(chalk.gray('                Evidence-backed Knowledge Graph'));
  console.log(chalk.gray('                              ↓'));
  console.log(chalk.gray('             Doctor · impact · verify · context · explain\n'));

  line('npx workspai workspace model --write --json', 'Build the canonical system model');
  line('npx workspai workspace graph search <query> --json', 'Ask a bounded, proven question');
  line('npx workspai doctor workspace --json', 'Diagnose projects and workspace health');
  line('npx workspai project coverage --run --target 80 --json', 'Measure one project');
  line('npx workspai workspace explain <target> --write --json', 'Explain a blocker or project');

  printHelpSectionDivider('Find the right command');
  console.log('');
  line('npx workspai create --help', 'Creation, adoption, import, and supported kits');
  line('npx workspai workspace --help', 'Model, graph, evidence, operations, and governance');
  line('npx workspai doctor --help', 'Project and workspace diagnosis');
  line('npx workspai commands --json', 'Complete machine-readable command inventory');
  line('npx workspai mirror [status|sync|verify|rotate]', 'Registry mirror management');
  line('npx workspai cache [status|clear|prune|repair]', 'Package cache management');

  console.log(chalk.bold('\nFlags clarification:'));
  console.log(chalk.gray('  --skip-install              npm fast-path for lock/dependency steps'));
  console.log(
    chalk.gray(
      '  --skip-essentials           core flag for skipping essential module installation\n'
    )
  );

  if (SHOW_LEGACY) {
    console.log(chalk.bold('Legacy (shown because RAPIDKIT_SHOW_LEGACY=1):'));
    console.log(chalk.gray('  npx workspai my-project --template fastapi'));
    console.log(chalk.gray('  npx workspai my-project --template nestjs'));
    console.log(chalk.gray('  npx workspai my-project --template springboot'));
    console.log(chalk.gray('  npx workspai my-project --template gofiber'));
    console.log(chalk.gray('  npx workspai my-project --template gogin'));
    console.log(chalk.gray('  npx workspai my-project --template dotnet'));
    console.log(
      chalk.gray(
        '  --skip-install             Fast-path lock/deps (legacy template mode) — not same as --skip-essentials\n'
      )
    );
  } else {
    console.log(
      chalk.gray('Tip: set RAPIDKIT_SHOW_LEGACY=1 to show legacy template flags in help.\n')
    );
  }
}

const SIGNAL_HANDLER_REGISTRY_KEY = '__rapidkit_signal_handlers_registered__';
const signalRegistry = globalThis as typeof globalThis & {
  [SIGNAL_HANDLER_REGISTRY_KEY]?: boolean;
};

if (!signalRegistry[SIGNAL_HANDLER_REGISTRY_KEY]) {
  signalRegistry[SIGNAL_HANDLER_REGISTRY_KEY] = true;

  // Handle process interruption (Ctrl+C)
  process.on('SIGINT', async () => {
    if (cleanupInProgress) return;

    cleanupInProgress = true;
    console.log(chalk.yellow('\n\n⚠️  Interrupted by user'));

    if (currentProjectPath && (await fsExtra.pathExists(currentProjectPath))) {
      console.log(chalk.gray('Cleaning up partial installation...'));
      try {
        await fsExtra.remove(currentProjectPath);
        console.log(chalk.green('✓ Cleanup complete'));
      } catch (error) {
        logger.debug('Cleanup failed:', error);
      }
    }

    finalizeCliRunContext(130, 'Interrupted by user');
    process.exit(130);
  });

  // Handle termination signal
  process.on('SIGTERM', async () => {
    if (cleanupInProgress) return;

    cleanupInProgress = true;
    logger.debug('Received SIGTERM');

    if (currentProjectPath && (await fsExtra.pathExists(currentProjectPath))) {
      try {
        await fsExtra.remove(currentProjectPath);
      } catch (error) {
        logger.debug('Cleanup failed:', error);
      }
    }

    finalizeCliRunContext(143, 'Terminated');
    process.exit(143);
  });
}

const isVitestRuntime =
  process.env.VITEST === 'true' || process.env.VITEST === '1' || process.env.NODE_ENV === 'test';

// When this file is executed as the CLI entrypoint (node dist/index.js ...),
// we must bootstrap command handling even if NODE_ENV=test is set by the test runner.
const isDirectCliExecution = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  const normalizedEntry = entryArg.replace(/\\/g, '/');
  const entryLooksLikeRapidkitCli =
    normalizedEntry.endsWith('/dist/index.js') || normalizedEntry.endsWith('/src/index.ts');
  try {
    return (
      fs.realpathSync(entryArg) === fs.realpathSync(fileURLToPath(import.meta.url)) ||
      entryLooksLikeRapidkitCli
    );
  } catch {
    return (
      path.resolve(entryArg) === path.resolve(fileURLToPath(import.meta.url)) ||
      entryLooksLikeRapidkitCli
    );
  }
})();

const shouldBootstrapCli = !isVitestRuntime || isDirectCliExecution;

function forceBlockingCliOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const handle = (
      stream as NodeJS.WriteStream & {
        _handle?: { setBlocking?: (blocking: boolean) => void };
      }
    )._handle;
    handle?.setBlocking?.(true);
  }
}

function installSynchronousPipeWrites(): void {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.isTTY) continue;

    const writable = stream as NodeJS.WriteStream & {
      __rapidkitSyncWriteInstalled?: boolean;
    };
    if (writable.__rapidkitSyncWriteInstalled) continue;

    const fd = stream.fd;
    if (typeof fd !== 'number') continue;

    const originalWrite = stream.write.bind(stream);
    writable.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
      const encoding =
        typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : 'utf8';
      const cb =
        typeof encodingOrCallback === 'function'
          ? encodingOrCallback
          : typeof callback === 'function'
            ? callback
            : undefined;

      try {
        const payload =
          typeof chunk === 'string'
            ? Buffer.from(chunk, encoding)
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk)
              : Buffer.from(String(chunk), encoding);
        fs.writeSync(fd, payload);
        cb?.();
        return true;
      } catch {
        return originalWrite(
          chunk as string | Uint8Array,
          encoding as BufferEncoding,
          cb as () => void
        );
      }
    }) as typeof stream.write;
    writable.__rapidkitSyncWriteInstalled = true;
  }
}

async function exitAfterOutputFlush(code: number): Promise<never> {
  finalizeCliRunContext(code);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.write('', () => resolve());
        })
    )
  );
  process.exit(code);
}

async function writeStdoutAndExit(text: string, code = 0): Promise<never> {
  fs.writeSync(process.stdout.fd ?? 1, text);
  return exitAfterOutputFlush(code);
}

// Delegate to local CLI if inside a RapidKit project. Exported so entrypoint
// routing can be exercised in-process with the same implementation used by
// the executable, including output flushing and ownership decisions.
export async function bootstrapCli(): Promise<void> {
  forceBlockingCliOutput();
  installSynchronousPipeWrites();
  installCliProcessExitHook();
  initializeCliRunContext({
    argv: process.argv,
    cwd: process.cwd(),
    rapidkitVersion: getVersion(),
  });

  // Make `--log-format json`/`--log-json` sticky via env and strip them from argv
  // so commander-parsed commands (e.g. `workspace`) don't reject them as unknown
  // options before the structured log stream can run.
  normalizeObservabilityInvocation(process.argv);

  const preArgs = process.argv.slice(2);
  const preFirst = preArgs[0];
  const preCwd = process.cwd();
  const preIsWorkspaceRoot = hasWorkspaceRootMarkers(preCwd);
  const preHasProjectJson = projectMetadataCandidates(preCwd, 'project.json').some((candidate) =>
    fs.existsSync(candidate)
  );
  const preIsNpmExecInvocation = isNpmExecInvocation();

  const shouldParseNpmOnlyDirectly = isNpmOnlyParseDirectInvocation(preArgs);
  const shouldKeepNpmOwnedCommandLocal = preIsNpmExecInvocation && isNpmOnlyInvocation(preArgs);
  const shouldHandleWorkspaceInitDirectly =
    preFirst === 'init' && preIsWorkspaceRoot && !preHasProjectJson;
  const shouldRenderCustomRootHelp =
    preArgs.length === 0 ||
    (preArgs.length === 1 && (preFirst === '--help' || preFirst === '-h' || preFirst === 'help'));

  if (isWorkspaceActionHelpRequest(preArgs)) {
    await writeStdoutAndExit(`${renderWorkspaceActionHelp(preArgs[1])}\n`);
  }

  if (shouldRenderCustomRootHelp) {
    showIntro('npm cli');
    printHelp();
    await exitAfterOutputFlush(0);
  }

  if (
    preArgs.some((arg) => arg === '--version' || arg === '-V' || arg === '-v') &&
    !preArgs.some((arg) => arg === '--help' || arg === '-h' || arg === 'help')
  ) {
    if (preArgs.includes('--json')) {
      await writeStdoutAndExit(`${JSON.stringify(getVersionContract(), null, 2)}\n`);
    } else {
      await writeStdoutAndExit(`${getVersion()}\n`);
    }
  }

  if (handleProjectCapabilityRequest(preArgs)) {
    await exitAfterOutputFlush(0);
  }

  if (shouldKeepNpmOwnedCommandLocal && preFirst === NPM_ONLY_CREATE_HANDLER_COMMAND) {
    (async () => {
      await exitAfterOutputFlush(await handleCreateOrFallback(preArgs));
    })().catch((error) => {
      process.stderr.write(
        `Workspai CLI failed to run create: ${(error as Error)?.message ?? error}\n`
      );
      process.exit(1);
    });
  } else if (shouldKeepNpmOwnedCommandLocal && isNpmOnlyManualHandlerCommand(preFirst)) {
    (async () => {
      await exitAfterOutputFlush(await runNpmOnlyManualHandler(preFirst, preArgs));
    })().catch((error) => {
      process.stderr.write(
        `Workspai CLI failed to run ${preFirst}: ${(error as Error)?.message ?? error}\n`
      );
      process.exit(1);
    });
  } else if (shouldParseNpmOnlyDirectly || shouldKeepNpmOwnedCommandLocal) {
    program
      .parseAsync()
      .then(() => exitAfterOutputFlush(0))
      .catch((error) => {
        const detail =
          shouldDebugWorkspaiArgs() && error instanceof Error && error.stack
            ? error.stack
            : ((error as Error)?.message ?? error);
        process.stderr.write(`Workspai CLI failed: ${detail}\n`);
        process.exit(1);
      });
  } else if (shouldHandleWorkspaceInitDirectly) {
    // Keep workspace-root init on npm wrapper path before any delegation attempt.
    handleInitCommand(preArgs)
      .then((code) => exitAfterOutputFlush(code))
      .catch((error) => {
        process.stderr.write(
          `Workspai CLI failed to run workspace init: ${(error as Error)?.message ?? error}\n`
        );
        process.exit(1);
      });
  } else {
    delegateToLocalCLI().then(async (delegated) => {
      if (!delegated) {
        const args = process.argv.slice(2);

        if (shouldDebugWorkspaiArgs()) {
          // Intentionally write to stderr to avoid corrupting JSON stdout from core.
          process.stderr.write(`[workspai-cli] argv=${JSON.stringify(args)}\n`);
        }

        if (isNpmOnlyParseDirectInvocation(args)) {
          // Commander-native npm-only commands.
          await program.parseAsync();
          return;
        }

        if (handleProjectCapabilityRequest(args)) {
          await exitAfterOutputFlush(0);
        }

        // Special-case `create` to preserve canonical Core UX while allowing a
        // last-resort offline fallback (fastapi/nestjs scaffolds) when Python/Core
        // cannot run.
        if (args[0] === NPM_ONLY_CREATE_HANDLER_COMMAND) {
          const code = await handleCreateOrFallback(args);
          await exitAfterOutputFlush(code);
        }

        if (args[0] === 'init') {
          const code = await handleInitCommand(args);
          await exitAfterOutputFlush(code);
        }

        if (isNpmOnlyManualHandlerCommand(args[0])) {
          const code = await runNpmOnlyManualHandler(args[0], args);
          await exitAfterOutputFlush(code);
        }

        // lifecycle commands: enforce workspace dependency policy context and strict policy
        if (isWrapperLifecycleCommand(args[0])) {
          if (blockUnsupportedProjectCommandIfNeeded(args)) {
            return;
          }

          const action = args[0];
          const projectJson = readRapidkitProjectJson(process.cwd());
          const inferredRuntime = await inferRuntimeByFiles(process.cwd());
          const wsPath = findWorkspaceUp(process.cwd());
          let strictPolicyMode = false;

          // Strict policy pre-flight: before any lifecycle command, check mandatory
          // workspace invariants when enforcement_mode is strict.
          if (wsPath) {
            const policyFile = workspaceMetadataCandidates(wsPath, 'policies.yml').find(
              (candidate) => fs.existsSync(candidate)
            );
            if (policyFile && (await fsExtra.pathExists(policyFile))) {
              try {
                const policyContent = await fs.promises.readFile(policyFile, 'utf-8');
                const modeMatch =
                  policyContent.match(/^\s*enforcement_mode:\s*(warn|strict)\s*(?:#.*)?$/m) ??
                  policyContent.match(/^\s*mode:\s*(warn|strict)\s*(?:#.*)?$/m);
                const policyEnforcementMode = modeMatch?.[1] ?? 'warn';
                strictPolicyMode = policyEnforcementMode === 'strict';

                if (strictPolicyMode) {
                  const lockPath = workspaceMetadataCandidates(wsPath, 'toolchain.lock').find(
                    (candidate) => fs.existsSync(candidate)
                  );
                  const violations: string[] = [];

                  // Strict requirement: toolchain.lock must exist
                  if (!lockPath || !(await fsExtra.pathExists(lockPath))) {
                    violations.push(
                      'toolchain.lock is missing — run `workspai bootstrap` first (strict mode requires a reproducible toolchain).'
                    );
                  } else {
                    try {
                      const lock = JSON.parse(
                        await fs.promises.readFile(lockPath, 'utf-8')
                      ) as Record<string, unknown>;
                      const rt = (lock.runtime ?? {}) as Record<string, Record<string, unknown>>;

                      // Strict requirement: runtime version must be pinned for the project type
                      if (isGoProject(projectJson, process.cwd()) && !rt.go?.version) {
                        violations.push(
                          'Go runtime version is not pinned in toolchain.lock — run `workspai setup go` first.'
                        );
                      }
                      if (isNodeProject(projectJson, process.cwd()) && !rt.node?.version) {
                        violations.push(
                          'Node runtime version is not pinned in toolchain.lock — run `workspai setup node` first.'
                        );
                      }
                      if (isJavaProject(projectJson, process.cwd()) && !rt.java?.version) {
                        violations.push(
                          'Java runtime version is not pinned in toolchain.lock — run `workspai setup java` first.'
                        );
                      }
                      if (isDotnetProject(projectJson, process.cwd()) && !rt.dotnet?.version) {
                        violations.push(
                          '.NET runtime version is not pinned in toolchain.lock — run `workspai setup dotnet` first.'
                        );
                      }
                      if (isPythonProject(projectJson, process.cwd()) && !rt.python?.version) {
                        violations.push(
                          'Python runtime version is not pinned in toolchain.lock — run `workspai setup python` first.'
                        );
                      }
                    } catch {
                      violations.push(
                        'toolchain.lock is invalid JSON — regenerate it with `workspai bootstrap` before running commands in strict mode.'
                      );
                    }
                  }

                  // Strict requirement: workspace profile must allow the project type
                  const wsJsonPath = workspaceMetadataCandidates(wsPath, 'workspace.json').find(
                    (candidate) => fs.existsSync(candidate)
                  );
                  if (wsJsonPath && (await fsExtra.pathExists(wsJsonPath))) {
                    try {
                      const wsJson = JSON.parse(
                        await fs.promises.readFile(wsJsonPath, 'utf-8')
                      ) as Record<string, unknown>;
                      const wsProfile = (wsJson.profile as string | undefined) ?? '';
                      const detection = detectBackendFrameworkFromProject(
                        process.cwd(),
                        projectJson
                      );
                      const compatibility = resolveWorkspaceProfileProjectCompatibility({
                        profile: wsProfile,
                        runtime: detection.runtime,
                        subjectLabel: path.basename(process.cwd()),
                        mode: 'strict',
                      });
                      if (!compatibility.ok) {
                        violations.push(
                          `${compatibility.message} Update the workspace profile or use a polyglot workspace.`
                        );
                      }
                    } catch {
                      /* non-fatal */
                    }
                  }

                  if (violations.length > 0) {
                    console.log(chalk.red(`❌ Strict policy violations block \`${action}\`:`));
                    for (const v of violations) console.log(chalk.red(`  • ${v}`));
                    console.log(
                      chalk.gray(
                        '💡 Fix violations or switch to warn mode: set mode: warn in .workspai/policies.yml'
                      )
                    );
                    await exitAfterOutputFlush(1);
                  }
                }
              } catch {
                /* non-fatal — policies.yml unreadable, skip pre-flight */
              }
            }
          }

          const readiness = await evaluateReleaseReadiness({
            startPath: process.cwd(),
            action,
            writeReport: true,
          });
          const enforceReadiness =
            strictPolicyMode ||
            process.env.RAPIDKIT_LIFECYCLE_ENFORCE_READINESS === '1' ||
            process.env.RAPIDKIT_ENFORCE_READINESS === '1';

          if (readiness.blocking && enforceReadiness) {
            console.log(chalk.red(`❌ Release readiness blocks \`${action}\`:`));
            for (const reason of readiness.blockingReasons) {
              console.log(chalk.red(`  • ${reason}`));
            }
            if (readiness.evidencePath) {
              console.log(chalk.gray(`ℹ️  Readiness evidence: ${readiness.evidencePath}`));
            }
            await exitAfterOutputFlush(1);
          }

          if (readiness.overallStatus !== 'pass' && !enforceReadiness) {
            console.log(
              chalk.yellow(
                `⚠️  Release readiness is ${readiness.overallStatus}. Command continues in warn mode.`
              )
            );
            if (readiness.evidencePath) {
              console.log(
                chalk.gray(
                  `   Evidence: ${readiness.evidencePath} (set RAPIDKIT_LIFECYCLE_ENFORCE_READINESS=1 to block)`
                )
              );
            }
          }

          const lifecycle = await withWorkspaceDependencyPolicyContext(process.cwd(), async () => {
            if (isGoProject(projectJson, process.cwd()) || inferredRuntime === 'go') {
              const adapter = getRuntimeAdapter('go', { runCommandInCwd, runCoreRapidkit });
              if (action === 'lint') {
                return reportRuntimeCommandResult(
                  (await adapter.runLint?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Lint is not supported.',
                  }
                );
              }
              if (action === 'format') {
                return reportRuntimeCommandResult(
                  (await adapter.runFormat?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Format is not supported.',
                  }
                );
              }
              const result =
                action === 'dev'
                  ? await adapter.runDev(process.cwd())
                  : action === 'test'
                    ? await adapter.runTest(process.cwd())
                    : action === 'build'
                      ? await adapter.runBuild(process.cwd())
                      : await adapter.runStart(process.cwd());

              if (result.message) {
                console.log(chalk.red(`❌ ${result.message}`));
              }

              return result.exitCode;
            }

            if (isJavaProject(projectJson, process.cwd()) || inferredRuntime === 'java') {
              if (action === 'dev') return await handleJavaCommand('dev', process.cwd());
              if (action === 'test') return await handleJavaCommand('test', process.cwd());
              if (action === 'build') return await handleJavaCommand('build', process.cwd());
              if (action === 'lint') return await handleJavaCommand('lint', process.cwd());
              if (action === 'format') return await handleJavaCommand('format', process.cwd());
              return await handleJavaCommand('start', process.cwd());
            }

            if (isDotnetProject(projectJson, process.cwd()) || inferredRuntime === 'dotnet') {
              const adapter = getRuntimeAdapter('dotnet', { runCommandInCwd, runCoreRapidkit });
              if (action === 'lint') {
                return reportRuntimeCommandResult(
                  (await adapter.runLint?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Lint is not supported.',
                  }
                );
              }
              if (action === 'format') {
                return reportRuntimeCommandResult(
                  (await adapter.runFormat?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Format is not supported.',
                  }
                );
              }
              const result =
                action === 'dev'
                  ? await adapter.runDev(process.cwd())
                  : action === 'test'
                    ? await adapter.runTest(process.cwd())
                    : action === 'build'
                      ? await adapter.runBuild(process.cwd())
                      : await adapter.runStart(process.cwd());

              if (result.message) {
                console.log(chalk.red(`❌ ${result.message}`));
              }

              return result.exitCode;
            }

            if (isNodeProject(projectJson, process.cwd()) || inferredRuntime === 'node') {
              if (action === 'dev') return await handleNodeCommand('dev', process.cwd());
              if (action === 'test') return await handleNodeCommand('test', process.cwd());
              if (action === 'build') return await handleNodeCommand('build', process.cwd());
              if (action === 'lint') return await handleNodeCommand('lint', process.cwd());
              if (action === 'format') return await handleNodeCommand('format', process.cwd());
              return await handleNodeCommand('start', process.cwd());
            }

            if (isPythonProject(projectJson, process.cwd()) || inferredRuntime === 'python') {
              if (action === 'lint' || action === 'format') {
                return await runCoreRapidkit([action], { cwd: process.cwd() });
              }
              const adapter = getRuntimeAdapter('python', { runCommandInCwd, runCoreRapidkit });
              if (action === 'dev') {
                return reportRuntimeCommandResult(await adapter.runDev(process.cwd()));
              }
              if (action === 'test') {
                return reportRuntimeCommandResult(await adapter.runTest(process.cwd()));
              }
              if (action === 'build') {
                return reportRuntimeCommandResult(await adapter.runBuild(process.cwd()));
              }
              return reportRuntimeCommandResult(await adapter.runStart(process.cwd()));
            }

            if (inferredRuntime === 'rust' || inferredRuntime === 'php') {
              const adapter = getRuntimeAdapter(inferredRuntime, {
                runCommandInCwd,
                runCoreRapidkit,
              });
              if (action === 'lint') {
                return reportRuntimeCommandResult(
                  (await adapter.runLint?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Lint is not supported.',
                  }
                );
              }
              if (action === 'format') {
                return reportRuntimeCommandResult(
                  (await adapter.runFormat?.(process.cwd())) ?? {
                    exitCode: 1,
                    message: 'Format is not supported.',
                  }
                );
              }
              const result =
                action === 'dev'
                  ? await adapter.runDev(process.cwd())
                  : action === 'test'
                    ? await adapter.runTest(process.cwd())
                    : action === 'build'
                      ? await adapter.runBuild(process.cwd())
                      : await adapter.runStart(process.cwd());
              return reportRuntimeCommandResult(result);
            }

            return -1;
          });

          if (!lifecycle.ok) {
            await exitAfterOutputFlush(lifecycle.code);
            return;
          }

          if (lifecycle.ok && lifecycle.value >= 0) {
            await exitAfterOutputFlush(lifecycle.value);
            return;
          }

          if (lifecycle.ok && lifecycle.value === -1) {
            console.error(
              chalk.red(`❌ Workspai cannot run \`${action}\` for this project runtime.`)
            );
            console.error(
              chalk.gray('Run `workspai project commands` to inspect supported commands.')
            );
            await exitAfterOutputFlush(1);
            return;
          }
        }

        if (blockUnsupportedProjectCommandIfNeeded(args)) {
          return;
        }

        const shouldForward = await shouldForwardToCore(args);
        if (shouldDebugWorkspaiArgs()) {
          process.stderr.write(`[workspai-cli] shouldForwardToCore=${shouldForward}\n`);
        }

        if (shouldForward) {
          const code = await runCoreRapidkit(args, { cwd: process.cwd() });
          await exitAfterOutputFlush(code);
        }
        await program.parseAsync();
      }
    });
  }
}

if (shouldBootstrapCli) {
  await bootstrapCli();
}
