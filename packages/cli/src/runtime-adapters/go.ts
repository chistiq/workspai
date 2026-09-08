import path from 'path';
import fs from 'fs';
import type { CommandResult, RuntimeAdapter } from './types.js';
import { isWindowsPlatform } from '../utils/platform-capabilities.js';
import { hasMakefileTarget } from '../utils/lifecycle-makefile.js';
import { resolveGoRunTarget } from '../utils/go-lifecycle.js';
import { workspaceMetadataCandidates } from '../utils/workspace-paths.js';

export type GoCommandRunner = (command: string, args: string[], cwd: string) => Promise<number>;

export class GoRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'go' as const;

  constructor(private readonly runCommand: GoCommandRunner) {}

  private async run(command: string, args: string[], cwd: string): Promise<CommandResult> {
    const exitCode = await this.runCommand(command, args, cwd);
    return { exitCode };
  }

  private async ensureGoInstalled(projectPath: string): Promise<CommandResult | null> {
    const probe = await this.run('go', ['version'], projectPath);
    if (probe.exitCode === 0) {
      return null;
    }

    return {
      exitCode: 1,
      message:
        'Go toolchain is not installed or not available on PATH. Install Go from https://go.dev/dl/ and retry.',
    };
  }

  private findWorkspaceRoot(startPath: string): string | null {
    let current = startPath;
    while (true) {
      if (
        fs.existsSync(path.join(current, '.workspai-workspace')) ||
        fs.existsSync(path.join(current, '.rapidkit-workspace'))
      )
        return current;
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

  private withGoCacheEnv<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    const mode = this.resolveDependencyMode(projectPath);
    const workspace = process.env.RAPIDKIT_WORKSPACE_PATH || this.findWorkspaceRoot(projectPath);
    const cacheBase =
      mode === 'shared-runtime-caches'
        ? path.join(workspace || projectPath, '.workspai', 'cache', 'go')
        : path.join(projectPath, '.workspai', 'cache', 'go');

    const originalGoModCache = process.env.GOMODCACHE;
    const originalGoCache = process.env.GOCACHE;

    process.env.GOMODCACHE = path.join(cacheBase, 'mod');
    process.env.GOCACHE = path.join(cacheBase, 'build');

    return fn().finally(() => {
      if (typeof originalGoModCache === 'undefined') delete process.env.GOMODCACHE;
      else process.env.GOMODCACHE = originalGoModCache;

      if (typeof originalGoCache === 'undefined') delete process.env.GOCACHE;
      else process.env.GOCACHE = originalGoCache;
    });
  }

  async checkPrereqs(): Promise<CommandResult> {
    return this.run('go', ['version'], process.cwd());
  }

  async warmSetupCache(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      try {
        if (process.env.GOMODCACHE) {
          fs.mkdirSync(process.env.GOMODCACHE, { recursive: true });
        }
        if (process.env.GOCACHE) {
          fs.mkdirSync(process.env.GOCACHE, { recursive: true });
        }
        return { exitCode: 0 };
      } catch {
        return { exitCode: 1, message: 'Failed to prepare Go cache directories' };
      }
    });
  }

  async initProject(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;
      return this.run('go', ['mod', 'tidy'], projectPath);
    });
  }

  async runDev(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, () => {
      return (async () => {
        const prereq = await this.ensureGoInstalled(projectPath);
        if (prereq) return prereq;

        const makefilePath = path.join(projectPath, 'Makefile');
        if (
          !isWindowsPlatform() &&
          fs.existsSync(makefilePath) &&
          hasMakefileTarget(projectPath, 'run')
        ) {
          return this.run('make', ['run'], projectPath);
        }
        const runTarget = resolveGoRunTarget(projectPath);
        if (!runTarget) {
          return {
            exitCode: 1,
            message:
              'No unambiguous Go run target was detected. Add a root main package, keep one cmd/<name>/main.go target, or declare a Makefile run target.',
          };
        }
        return this.run('go', ['run', runTarget], projectPath);
      })();
    });
  }

  async runTest(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;
      return this.run('go', ['test', './...'], projectPath);
    });
  }

  async runBuild(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;
      return this.run('go', ['build', '-buildvcs=false', './...'], projectPath);
    });
  }

  async runStart(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const binaryCandidates = isWindowsPlatform()
        ? [path.join(projectPath, 'server.exe'), path.join(projectPath, 'server')]
        : [path.join(projectPath, 'server')];

      const existingBinary = binaryCandidates.find((candidate) => fs.existsSync(candidate));
      if (existingBinary) {
        return this.run(existingBinary, [], projectPath);
      }

      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;

      const runTarget = resolveGoRunTarget(projectPath);
      if (!runTarget) {
        return {
          exitCode: 1,
          message:
            'No unambiguous Go start target was detected. Add a root main package, keep one cmd/<name>/main.go target, declare a Makefile run target, or provide the built server binary.',
        };
      }
      return this.run('go', ['run', runTarget], projectPath);
    });
  }

  async runLint(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;

      if (!isWindowsPlatform() && hasMakefileTarget(projectPath, 'lint')) {
        return this.run('make', ['lint'], projectPath);
      }

      const hasGolangci =
        fs.existsSync(path.join(projectPath, '.golangci.yml')) ||
        fs.existsSync(path.join(projectPath, '.golangci.yaml'));
      if (hasGolangci) {
        return this.run('golangci-lint', ['run', './...'], projectPath);
      }

      return {
        exitCode: 1,
        message:
          'No Go lint tooling detected. Add a Makefile lint target or .golangci.yml configuration.',
      };
    });
  }

  async runFormat(projectPath: string): Promise<CommandResult> {
    return this.withGoCacheEnv(projectPath, async () => {
      const prereq = await this.ensureGoInstalled(projectPath);
      if (prereq) return prereq;

      if (!isWindowsPlatform() && hasMakefileTarget(projectPath, 'fmt')) {
        return this.run('make', ['fmt'], projectPath);
      }
      if (!isWindowsPlatform() && hasMakefileTarget(projectPath, 'format')) {
        return this.run('make', ['format'], projectPath);
      }

      return this.run('go', ['fmt', './...'], projectPath);
    });
  }

  async doctorHints(_projectPath: string): Promise<string[]> {
    return [
      'Install Go from https://go.dev/dl/ if missing.',
      'Run go mod tidy when dependencies are out of sync.',
      'Use make run for hot-reload if Makefile exists.',
    ];
  }
}
