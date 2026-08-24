import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { CommandResult, RuntimeAdapter } from './types.js';
import { detectBackendFrameworkFromProject } from '../utils/backend-framework-contract.js';
import {
  resolveNodeLifecycleScript,
  type NodeLifecycleCommand,
} from '../utils/node-lifecycle-scripts.js';
import { readRapidkitProjectJson } from '../utils/runtime-detection.js';
import {
  buildPackageRunnerSubprocessEnv,
  resolvePackageRunnerInvocation,
  shouldUseShellExecution,
} from '../utils/platform-capabilities.js';
import { workspaceMetadataCandidates } from '../utils/workspace-paths.js';

export type NodeCommandRunner = (command: string, args: string[], cwd: string) => Promise<number>;

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'node' as const;

  constructor(private readonly runCommand: NodeCommandRunner) {}

  private async run(command: string, args: string[], cwd: string): Promise<CommandResult> {
    const exitCode = await this.runCommand(command, args, cwd);
    return { exitCode };
  }

  private findWorkspaceRoot(startPath: string): string | null {
    let current = startPath;
    while (true) {
      if (
        fs.existsSync(path.join(current, '.workspai-workspace')) ||
        fs.existsSync(path.join(current, '.rapidkit-workspace'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private resolveDependencyMode(
    projectPath: string
  ): 'isolated' | 'shared-runtime-caches' | 'shared-node-deps' {
    const raw = process.env.RAPIDKIT_DEP_SHARING_MODE?.toLowerCase();
    if (raw === 'shared-runtime-caches' || raw === 'shared-node-deps' || raw === 'isolated') {
      return raw;
    }
    const workspace = this.findWorkspaceRoot(projectPath);
    if (!workspace) return 'isolated';

    const policyPath = workspaceMetadataCandidates(workspace, 'policies.yml').find((candidate) =>
      fs.existsSync(candidate)
    );
    if (!policyPath) return 'isolated';

    try {
      const policyRaw = fs.readFileSync(policyPath, 'utf-8');
      const match = policyRaw.match(/^\s*dependency_sharing_mode:\s*([a-zA-Z\-]+)\s*(?:#.*)?$/m);
      const value = match?.[1]?.toLowerCase();
      if (
        value === 'shared-runtime-caches' ||
        value === 'shared-node-deps' ||
        value === 'isolated'
      ) {
        return value;
      }
    } catch {
      // Fallback to isolated.
    }

    return 'isolated';
  }

  private withDependencyEnv<T>(
    projectPath: string,
    runtime: PackageManager,
    fn: () => Promise<T>
  ): Promise<T> {
    const mode = this.resolveDependencyMode(projectPath);
    const workspace = process.env.RAPIDKIT_WORKSPACE_PATH || this.findWorkspaceRoot(projectPath);
    const basePath =
      mode === 'isolated'
        ? path.join(projectPath, '.workspai', 'cache', 'node')
        : path.join(workspace || projectPath, '.workspai', 'cache', 'node');

    const originalNpmCache = process.env.npm_config_cache;
    const originalStoreDir = process.env.npm_config_store_dir;
    const originalBunCache = process.env.BUN_INSTALL_CACHE_DIR;
    const originalDependencyMode = process.env.RAPIDKIT_DEP_SHARING_MODE;
    const originalWorkspacePath = process.env.RAPIDKIT_WORKSPACE_PATH;

    process.env.RAPIDKIT_DEP_SHARING_MODE = mode;
    if (workspace) {
      process.env.RAPIDKIT_WORKSPACE_PATH = workspace;
    }

    if (runtime === 'bun') {
      process.env.BUN_INSTALL_CACHE_DIR = path.join(basePath, 'bun-cache');
    } else if (runtime === 'pnpm') {
      process.env.npm_config_store_dir = path.join(basePath, 'pnpm-store');
      process.env.npm_config_cache = path.join(basePath, 'pnpm-cache');
    } else if (runtime === 'yarn') {
      process.env.npm_config_cache = path.join(basePath, 'yarn-cache');
    } else {
      process.env.npm_config_cache = path.join(basePath, 'npm-cache');
    }

    return fn().finally(() => {
      if (typeof originalNpmCache === 'undefined') delete process.env.npm_config_cache;
      else process.env.npm_config_cache = originalNpmCache;

      if (typeof originalStoreDir === 'undefined') delete process.env.npm_config_store_dir;
      else process.env.npm_config_store_dir = originalStoreDir;

      if (typeof originalBunCache === 'undefined') delete process.env.BUN_INSTALL_CACHE_DIR;
      else process.env.BUN_INSTALL_CACHE_DIR = originalBunCache;

      if (typeof originalDependencyMode === 'undefined')
        delete process.env.RAPIDKIT_DEP_SHARING_MODE;
      else process.env.RAPIDKIT_DEP_SHARING_MODE = originalDependencyMode;

      if (typeof originalWorkspacePath === 'undefined') delete process.env.RAPIDKIT_WORKSPACE_PATH;
      else process.env.RAPIDKIT_WORKSPACE_PATH = originalWorkspacePath;
    });
  }

  private detectPackageManager(projectPath: string): PackageManager {
    if (
      fs.existsSync(path.join(projectPath, 'bun.lock')) ||
      fs.existsSync(path.join(projectPath, 'bun.lockb'))
    ) {
      return 'bun';
    }
    if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
    if (!this.commandAvailable('npm')) {
      if (this.commandAvailable('pnpm')) return 'pnpm';
      if (this.commandAvailable('yarn')) return 'yarn';
    }
    return 'npm';
  }

  private hasPinnedPackageManager(projectPath: string): boolean {
    return (
      fs.existsSync(path.join(projectPath, 'package-lock.json')) ||
      fs.existsSync(path.join(projectPath, 'bun.lock')) ||
      fs.existsSync(path.join(projectPath, 'bun.lockb')) ||
      fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml')) ||
      fs.existsSync(path.join(projectPath, 'yarn.lock'))
    );
  }

  private availablePackageManagers(projectPath: string): PackageManager[] {
    const preferred = this.detectPackageManager(projectPath);
    if (this.hasPinnedPackageManager(projectPath)) {
      return [preferred];
    }

    const candidates: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
    return [
      preferred,
      ...candidates.filter(
        (candidate) => candidate !== preferred && this.commandAvailable(candidate)
      ),
    ];
  }

  private commandAvailable(command: string): boolean {
    const invocation = resolvePackageRunnerInvocation(command);
    const result = spawnSync(invocation.command, [...invocation.prefixArgs, '--version'], {
      stdio: 'ignore',
      shell: shouldUseShellExecution(),
      env: buildPackageRunnerSubprocessEnv(),
    });
    return result.status === 0;
  }

  private scriptArgs(pm: PackageManager, scriptName: string): string[] {
    if (pm === 'npm') {
      return ['run-script', scriptName, '--foreground-scripts'];
    }

    // pnpm/yarn support `run` consistently across versions.
    return ['run', scriptName];
  }

  private async runScriptWithFallback(
    projectPath: string,
    scriptName: string
  ): Promise<CommandResult> {
    let lastResult: CommandResult = { exitCode: 1 };
    for (const pm of this.availablePackageManagers(projectPath)) {
      lastResult = await this.withDependencyEnv(projectPath, pm, () =>
        this.run(pm, this.scriptArgs(pm, scriptName), projectPath)
      );
      if (lastResult.exitCode === 0) {
        return lastResult;
      }
    }
    return lastResult;
  }

  private async runLifecycle(
    projectPath: string,
    command: NodeLifecycleCommand
  ): Promise<CommandResult> {
    const projectJson = readRapidkitProjectJson(projectPath);
    const detection = detectBackendFrameworkFromProject(projectPath, projectJson);
    const resolved = resolveNodeLifecycleScript(projectPath, command, {
      framework: detection.key,
    });
    if (!resolved) {
      return {
        exitCode: 1,
        message: `No npm script available for \`${command}\`. Add a "${command}" script to package.json.`,
      };
    }

    return this.runScriptWithFallback(projectPath, resolved.scriptName);
  }

  async checkPrereqs(): Promise<CommandResult> {
    return this.run('node', ['--version'], process.cwd());
  }

  async warmSetupCache(projectPath: string): Promise<CommandResult> {
    const pm = this.detectPackageManager(projectPath);
    return this.withDependencyEnv(projectPath, pm, async () => {
      try {
        if (process.env.npm_config_cache) {
          fs.mkdirSync(process.env.npm_config_cache, { recursive: true });
        }
        if (pm === 'pnpm' && process.env.npm_config_store_dir) {
          fs.mkdirSync(process.env.npm_config_store_dir, { recursive: true });
        }
        return { exitCode: 0 };
      } catch {
        return { exitCode: 1, message: 'Failed to prepare Node cache directories' };
      }
    });
  }

  async initProject(projectPath: string): Promise<CommandResult> {
    const pm = this.detectPackageManager(projectPath);
    const mode = this.resolveDependencyMode(projectPath);
    const installArgs =
      mode === 'shared-runtime-caches' || mode === 'shared-node-deps'
        ? ['install', '--prefer-offline']
        : ['install'];
    return this.withDependencyEnv(projectPath, pm, () => this.run(pm, installArgs, projectPath));
  }

  async runDev(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'dev');
  }

  async runTest(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'test');
  }

  async runBuild(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'build');
  }

  async runStart(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'start');
  }

  async runLint(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'lint');
  }

  async runFormat(projectPath: string): Promise<CommandResult> {
    return this.runLifecycle(projectPath, 'format');
  }

  async doctorHints(_projectPath: string): Promise<string[]> {
    return [
      'Install Node.js LTS and ensure node/npm are on PATH.',
      'Use lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock) for deterministic installs.',
      'Run install before dev/test/build if dependencies changed.',
    ];
  }
}
