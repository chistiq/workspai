/**
 * Tests for CLI entry point (index.ts)
 * Tests command parsing, option handling, and workflow orchestration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import os from 'os';
import { spawnSync } from 'child_process';

import { handleAdoptCommand, handleImportCommand } from '../index';
import { ensureDistBuilt } from './helpers/dist';
import { WORKSPACE_SUBCOMMANDS } from '../utils/workspace-command-surface';
import { buildCleanGitEnv } from '../utils/git-worktree';

interface CliExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  reject?: boolean;
}

interface CliExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execa(
  command: string,
  args: string[] = [],
  options: CliExecOptions = {}
): Promise<CliExecResult> {
  const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rapidkit-cli-test-'));
  const stdoutPath = path.join(captureDir, 'stdout.log');
  const stderrPath = path.join(captureDir, 'stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');

  try {
    const child = spawnSync(command, args, {
      cwd: options.cwd,
      env: buildCleanGitEnv(options.env ?? process.env),
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });

    const result = {
      stdout: await fs.readFile(stdoutPath, 'utf-8'),
      stderr: await fs.readFile(stderrPath, 'utf-8'),
      exitCode: child.status ?? (child.error ? 1 : 0),
    };

    if ((child.error || result.exitCode !== 0) && options.reject !== false) {
      const message = [
        `Command failed: ${command}`,
        `exitCode: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      throw Object.assign(child.error ?? new Error(message), result);
    }

    return result;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    await fs.remove(captureDir);
  }
}

const CLI_PATH = ensureDistBuilt('CLI entry point tests');
let TEST_DIR: string;

describe('CLI Entry Point', () => {
  beforeEach(async () => {
    TEST_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-cli-index-test-'));
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  describe('Version and Help', () => {
    it('should display version with --version flag', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--version']);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 15000);

    it('should display version with -V flag', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '-V']);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    }, 15000);

    it('should display help with --help flag', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help']);

      // CLI identity
      expect(stdout).toContain('Workspai');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Open-Source Workspace Intelligence for Software Systems');
      expect(stdout).toContain('Workspace Lifecycle');
      expect(stdout).toContain('Workspace Intelligence');
      expect(stdout).toContain('One workspace. One truth. Humans and AI aligned.');

      // Core sections
      expect(stdout).toContain('Find the right command');
      expect(stdout).toContain('Canonical Workspace Model');
      expect(stdout).toContain('Evidence-backed Knowledge Graph');

      // Known commands
      expect(stdout).toContain('workspai create');
      expect(stdout).toContain('workspai import <path|git-url>');
      expect(stdout).toContain('workspai adopt .');
      expect(stdout).toContain('workspai workspace intelligence run');
      expect(stdout).toContain('workspai project coverage');
      expect(stdout).toContain('workspai commands --json');
      expect(stdout).toContain('mirror [status|sync|verify|rotate]');
      expect(stdout).toContain('cache [status|clear|prune|repair]');

      // Legacy options should remain hidden from option list
      expect(stdout).not.toContain('Legacy (shown because RAPIDKIT_SHOW_LEGACY=1):');

      // Clarification note must be visible in help text
      expect(stdout).toContain(
        '--skip-install              npm fast-path for lock/dependency steps'
      );
      expect(stdout).toContain(
        '--skip-essentials           core flag for skipping essential module installation'
      );
    }, 15000);

    it('should show legacy flags when legacy env is enabled', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help'], {
        env: { ...process.env, RAPIDKIT_SHOW_LEGACY: '1' },
      });

      expect(stdout).toContain('Legacy (shown because RAPIDKIT_SHOW_LEGACY=1):');
      expect(stdout).toContain('npx workspai my-project --template fastapi');
      expect(stdout).not.toContain(
        'Tip: set RAPIDKIT_SHOW_LEGACY=1 to show legacy template flags in help.'
      );
      expect(stdout).toContain(
        '--skip-essentials           core flag for skipping essential module installation'
      );
    });

    it('should display the same help output with -h flag', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '-h']);

      expect(stdout).toContain('Workspai');
      expect(stdout).toContain('Workspace Lifecycle');
      expect(stdout).toContain('Find the right command');
      expect(stdout).toContain('npx workspai workspace --help');
    });

    it('should keep workspace help command variants aligned with supported actions', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help']);

      expect(stdout).toContain('npx workspai mirror [status|sync|verify|rotate]');
      expect(stdout).toContain('npx workspai cache [status|clear|prune|repair]');
    });

    it('should render contract-backed help for individual workspace actions', async () => {
      const impact = await execa('node', [CLI_PATH, 'workspace', 'impact', '--help']);
      expect(impact.stdout).toContain(
        'Calculate the evidence-backed blast radius of the current model change.'
      );
      expect(impact.stdout).toContain(
        'Usage:\n  workspai workspace impact --from <diff> [--scope <scope>] [--strict] [--json]'
      );
      expect(impact.stdout).toContain(
        'Evidence:\n  .workspai/reports/workspace-impact-last-run.json'
      );
      expect(impact.stdout).not.toContain('Workspace actions:');

      const diff = await execa('node', [CLI_PATH, 'workspace', 'diff', '--help']);
      expect(diff.stdout).toContain(
        'Usage:\n  workspai workspace diff --from <snapshot-or-model|git[:ref]> [--strict] [--json]'
      );
      expect(diff.stdout).not.toContain('workspai workspace diff --json');

      const graph = await execa('node', [CLI_PATH, 'workspace', 'graph', '--help']);
      expect(graph.stdout).toContain(
        'emit | explain | entities | search | evidence | path | overlay | benchmark | dot | mermaid | jsonld | graphml | gexf'
      );
      expect(graph.stdout).toContain('workspai workspace graph [mode] [query|from] [to] [--json]');
    });

    it('should keep root help focused while preserving command discovery', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help']);
      const block = stdout.match(/Find the right command[\s\S]*?Flags clarification:/);

      expect(block?.[0].replace(/\r/g, '')).toMatchInlineSnapshot(`
        "Find the right command
        ──────────────────────────────────────────────

          npx workspai create --help                                           Creation, adoption, import, and supported kits
          npx workspai workspace --help                                        Model, graph, evidence, operations, and governance
          npx workspai doctor --help                                           Project and workspace diagnosis
          npx workspai commands --json                                         Complete machine-readable command inventory
          npx workspai mirror [status|sync|verify|rotate]                      Registry mirror management
          npx workspai cache [status|clear|prune|repair]                       Package cache management

        Flags clarification:"
      `);
    });

    it('should render identical output for no-arg, --help, and help at root', async () => {
      const noArg = await execa('node', [CLI_PATH]);
      const withHelp = await execa('node', [CLI_PATH, '--help']);
      const withHelpCommand = await execa('node', [CLI_PATH, 'help']);

      expect(noArg.stdout.replace(/\r/g, '')).toBe(withHelp.stdout.replace(/\r/g, ''));
      expect(noArg.stdout.replace(/\r/g, '')).toBe(withHelpCommand.stdout.replace(/\r/g, ''));
    }, 20000);
  });

  describe('Autopilot Command (CLI Entrypoint)', () => {
    it('should reject unknown autopilot action from CLI entrypoint', async () => {
      const result = await execa('node', [CLI_PATH, 'autopilot', 'unknown'], {
        cwd: TEST_DIR,
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Unknown autopilot action: unknown');
      expect(result.stdout).toContain('Available: release');
    }, 15000);

    it('should reject invalid autopilot mode from CLI entrypoint', async () => {
      const result = await execa('node', [CLI_PATH, 'autopilot', 'release', '--mode', 'invalid'], {
        cwd: TEST_DIR,
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Invalid autopilot mode: invalid');
      expect(result.stdout).toContain('Allowed modes: audit | safe-fix | enforce');
    }, 15000);
  });

  describe('Dry-run Mode', () => {
    it('should show what would be created in FastAPI template dry-run mode', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-project', '--template', 'fastapi', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Dry-run mode');
      expect(stdout).toContain('test-project');
      expect(stdout).toMatch(/fastapi/i);

      // Should not create any files
      const projectPath = path.join(TEST_DIR, 'test-project');
      expect(await fs.pathExists(projectPath)).toBe(false);
    }, 15000);

    it('should show what would be created in NestJS template dry-run mode', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-project', '--template', 'nestjs', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Dry-run mode');
      expect(stdout).toContain('test-project');
      expect(stdout).toMatch(/nestjs/i);

      // Should not create any files
      const projectPath = path.join(TEST_DIR, 'test-project');
      expect(await fs.pathExists(projectPath)).toBe(false);
    }, 15000);

    it('should show what would be created in workspace dry-run mode', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-workspace', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Dry-run mode');
      expect(stdout).toContain('test-workspace');
      expect(stdout).toMatch(/workspace/i);

      // Should not create any files
      const workspacePath = path.join(TEST_DIR, 'test-workspace');
      expect(await fs.pathExists(workspacePath)).toBe(false);
    });
  });

  describe('Debug Mode', () => {
    it('should enable debug logging with --debug flag', async () => {
      const { stdout } = await execa(
        'node',
        [
          CLI_PATH,
          'test-project',
          '--template',
          'fastapi',
          '--dry-run',
          '--debug',
          '--no-update-check',
        ],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Debug mode enabled');
    });
  });

  describe('Template Mode (--template)', () => {
    it('should validate project name in template mode', async () => {
      try {
        await execa(
          'node',
          [CLI_PATH, 'Invalid-Name!', '--template', 'fastapi', '--dry-run', '--no-update-check'],
          { cwd: TEST_DIR }
        );
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        // Check for validation error message
        const output = error.stdout || error.stderr;
        expect(output).toMatch(/validation|lowercase|capital|special|URL-friendly/i);
      }
    });

    it('should accept fastapi template', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-api', '--template', 'fastapi', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toMatch(/fastapi/i);
    });

    it('should accept nestjs template', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-api', '--template', 'nestjs', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toMatch(/nestjs/i);
    });

    it('should use short flag -t for template', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-api', '-t', 'fastapi', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toMatch(/fastapi/i);
    });
  });

  describe('Workspace Mode (no --template)', () => {
    it('should validate workspace name', async () => {
      try {
        await execa('node', [CLI_PATH, 'Invalid Name!', '--dry-run', '--no-update-check'], {
          cwd: TEST_DIR,
        });
        expect.fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });

    it('should create workspace without --template flag', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-ws', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toMatch(/workspace/i);
    });
  });

  describe('Option Combinations', () => {
    it('should handle --skip-git option', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-ws', '--skip-git', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Dry-run mode');
    });

    it('should handle --skip-install option for NestJS', async () => {
      const { stdout } = await execa(
        'node',
        [
          CLI_PATH,
          'test-api',
          '--template',
          'nestjs',
          '--skip-install',
          '--dry-run',
          '--no-update-check',
        ],
        { cwd: TEST_DIR }
      );

      expect(stdout).toMatch(/nestjs/i);
    });

    it('should handle --no-update-check option', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--version', '--no-update-check'], {
        cwd: TEST_DIR,
      });

      // Should still show version
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should handle multiple flags together', async () => {
      const { stdout } = await execa(
        'node',
        [
          CLI_PATH,
          'test-proj',
          '--template',
          'fastapi',
          '--debug',
          '--dry-run',
          '--no-update-check',
        ],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Debug mode enabled');
      expect(stdout).toContain('Dry-run mode');
    });
  });

  describe('Error Handling', () => {
    it('routes Doctor policy profiles to Doctor instead of the root workspace profile option', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'doctor-policy-profile-'));
      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeFile(
        path.join(workspaceRoot, '.workspai-workspace'),
        `${JSON.stringify({
          schemaVersion: 'workspai-workspace-marker-v1',
          workspace_name: 'doctor-policy-workspace',
          profile: 'minimal',
        })}\n`
      );
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'doctor-policy-workspace',
        profile: 'minimal',
      });

      const result = await execa(
        'node',
        [
          CLI_PATH,
          'doctor',
          'workspace',
          '--workspace',
          workspaceRoot,
          '--profile',
          'enterprise-strict',
          '--json',
        ],
        {
          cwd: workspaceRoot,
          reject: false,
        }
      );

      expect([0, 1, 2]).toContain(result.exitCode);
      expect(JSON.parse(result.stdout).policyProfile).toMatchObject({
        name: 'enterprise-strict',
      });
    }, 30_000);

    it('should roll back imported files when workspace sync fails after import', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-import-fail-'));
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-import-fail-'));

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'demo-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'orders-api',
        dependencies: {
          express: '^4.19.2',
        },
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const exitCode = await handleImportCommand(
          sourceDir,
          {
            workspace: workspaceRoot,
            name: 'orders-api',
            json: true,
          },
          {
            syncWorkspaceProjects: async () => {
              throw new Error('sync failed');
            },
          }
        );

        expect(exitCode).toBe(1);
        expect(await fs.pathExists(path.join(workspaceRoot, 'orders-api'))).toBe(false);

        expect(
          await fs.pathExists(path.join(workspaceRoot, '.workspai', 'imported-projects.json'))
        ).toBe(false);
        expect(consoleLog).toHaveBeenCalledWith(
          JSON.stringify(
            {
              error:
                'Workspace sync failed after import and the imported project was rolled back: sync failed',
            },
            null,
            2
          )
        );
      } finally {
        consoleLog.mockRestore();
        await fs.remove(workspaceRoot);
        await fs.remove(sourceDir);
      }
    });

    it('should import a local project through the CLI wrapper and emit registry JSON', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-import-'));
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-import-'));

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'demo-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'orders-api',
        dependencies: {
          express: '^4.19.2',
        },
      });

      try {
        const { stdout, exitCode } = await execa('node', [
          CLI_PATH,
          'import',
          sourceDir,
          '--workspace',
          workspaceRoot,
          '--name',
          'orders-api',
          '--json',
        ]);

        expect(exitCode).toBe(0);

        const payload = JSON.parse(stdout) as {
          workspacePath: string;
          plan: {
            action: string;
            mode: string;
            ownership: string;
            registration: string;
          };
          importedProject: { name: string; stack: string; source: string; path: string };
        };

        expect(payload.workspacePath).toBe(workspaceRoot);
        expect(payload.plan).toMatchObject({
          action: 'import-project',
          mode: 'copy',
          ownership: 'workspace-owned',
          registration: 'project',
        });
        expect(payload.importedProject).toMatchObject({
          name: 'orders-api',
          stack: 'express',
          source: 'local-folder',
        });
        expect(await fs.pathExists(path.join(payload.importedProject.path, 'package.json'))).toBe(
          true
        );

        const registry = await fs.readJson(
          path.join(workspaceRoot, '.workspai', 'imported-projects.json')
        );
        expect(registry.projects).toEqual([
          expect.objectContaining({
            name: 'orders-api',
            stack: 'express',
            source: 'local-folder',
          }),
        ]);
      } finally {
        await fs.remove(workspaceRoot);
        await fs.remove(sourceDir);
      }
    }, 20000);

    it('should adopt a local frontend project through the CLI wrapper and keep it linked in place', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-adopt-'));
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-adopt-next-'));

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'demo-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        private: true,
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
        },
        scripts: {
          dev: 'next dev',
          build: 'next build',
        },
      });

      try {
        const { stdout, exitCode } = await execa('node', [
          CLI_PATH,
          'adopt',
          sourceDir,
          '--workspace',
          workspaceRoot,
          '--name',
          'web',
          '--json',
        ]);

        expect(exitCode).toBe(0);

        const payload = JSON.parse(stdout) as {
          workspacePath: string;
          workspaceResolution: string;
          plan: {
            action: string;
            mode: string;
            ownership: string;
            registration: string;
          };
          adoptedProject: {
            name: string;
            path: string;
            relationship: string;
            stack: string;
            framework: string;
            frameworkDisplayName: string;
            source?: string;
          };
        };

        expect(payload.workspacePath).toBe(workspaceRoot);
        expect(payload.workspaceResolution).toBe('explicit');
        expect(payload.plan).toMatchObject({
          action: 'adopt-project',
          mode: 'link',
          ownership: 'external',
          registration: 'project',
        });
        expect(payload.adoptedProject).toMatchObject({
          name: 'web',
          path: sourceDir,
          relationship: 'adopted',
          stack: 'nextjs',
          framework: 'nextjs',
          frameworkDisplayName: 'Next.js',
        });
        expect(await fs.pathExists(path.join(sourceDir, '.workspai', 'adopt.json'))).toBe(true);
        expect(await fs.pathExists(path.join(workspaceRoot, 'web'))).toBe(false);

        const registry = await fs.readJson(
          path.join(workspaceRoot, '.workspai', 'imported-projects.json')
        );
        expect(registry.projects).toEqual([
          expect.objectContaining({
            name: 'web',
            path: sourceDir,
            relationship: 'adopted',
            source: 'adopted-local',
            stack: 'nextjs',
          }),
        ]);
      } finally {
        await fs.remove(workspaceRoot);
        await fs.remove(sourceDir);
      }
    }, 20000);

    it('should register the workspace before registering an adopted project', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-adopt-register-'));
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-adopt-register-'));
      const calls: string[] = [];

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'default-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        private: true,
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
        },
      });

      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        const exitCode = await handleAdoptCommand(
          sourceDir,
          {
            workspace: workspaceRoot,
            name: 'web',
            json: true,
          },
          {
            registerWorkspace: async (nextWorkspacePath, workspaceName) => {
              calls.push(`workspace:${workspaceName}:${nextWorkspacePath}`);
            },
            registerProjectInWorkspace: async (nextWorkspacePath, projectName, projectPath) => {
              calls.push(`project:${projectName}:${projectPath}:${nextWorkspacePath}`);
            },
            syncWorkspaceProjects: async (nextWorkspacePath) => {
              calls.push(`sync:${nextWorkspacePath}`);
            },
          }
        );

        expect(exitCode).toBe(0);
        expect(calls).toEqual([
          `workspace:${path.basename(workspaceRoot)}:${workspaceRoot}`,
          `project:web:${sourceDir}:${workspaceRoot}`,
          `sync:${workspaceRoot}`,
        ]);
        expect(await fs.pathExists(path.join(sourceDir, '.workspai', 'adopt.json'))).toBe(true);

        const payload = JSON.parse(consoleLog.mock.calls[0]?.[0] as string) as {
          adoptedProject: { name: string; path: string; stack: string };
          projectWorkspaceCommand: string;
          commandsResolveWorkspaceFromProject: boolean;
        };
        expect(payload.projectWorkspaceCommand).toBe(
          'npx workspai project workspace status --json'
        );
        expect(payload.commandsResolveWorkspaceFromProject).toBe(true);
        expect(payload.adoptedProject).toMatchObject({
          name: 'web',
          path: sourceDir,
          stack: 'nextjs',
        });
      } finally {
        consoleLog.mockRestore();
        await fs.remove(workspaceRoot);
        await fs.remove(sourceDir);
      }
    });

    it('should import a git repository through the CLI wrapper with --git', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-import-git-'));
      const gitSource = await fs.mkdtemp(path.join(TEST_DIR, 'source-import-git-'));

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'demo-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(gitSource, 'package.json'), {
        name: 'git-orders-api',
        dependencies: {
          express: '^4.19.2',
        },
      });
      await fs.writeFile(path.join(gitSource, 'README.md'), '# git import\n');
      await execa('git', ['init'], { cwd: gitSource });
      await execa('git', ['config', 'user.email', 'rapidkit@example.com'], { cwd: gitSource });
      await execa('git', ['config', 'user.name', 'RapidKit Test'], { cwd: gitSource });
      await execa('git', ['add', '.'], { cwd: gitSource });
      await execa('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], {
        cwd: gitSource,
      });

      try {
        const { stdout, exitCode } = await execa(
          'node',
          [
            CLI_PATH,
            'import',
            gitSource,
            '--git',
            '--workspace',
            workspaceRoot,
            '--name',
            'git-orders-api',
            '--json',
          ],
          {
            env: {
              ...process.env,
              WORKSPAI_DEBUG_ARGS: '1',
            },
          }
        );

        expect(exitCode).toBe(0);

        const payload = JSON.parse(stdout) as {
          workspacePath: string;
          importedProject: { name: string; stack: string; source: string; path: string };
        };

        expect(payload.workspacePath).toBe(workspaceRoot);
        expect(payload.importedProject).toMatchObject({
          name: 'git-orders-api',
          stack: 'express',
          source: 'git-url',
        });
        expect(await fs.pathExists(path.join(payload.importedProject.path, '.git'))).toBe(true);
      } finally {
        await fs.remove(workspaceRoot);
        await fs.remove(gitSource);
      }
    }, 20000);

    it('should honor --output for workspace export archives', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-export-'));
      const archivePath = path.join(TEST_DIR, 'custom-workspace-export.zip');

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'export-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# export workspace\n');

      const { stdout, exitCode } = await execa(
        'node',
        [CLI_PATH, 'workspace', 'export', '--output', archivePath, '--json'],
        { cwd: workspaceRoot }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout) as { archivePath: string };
      expect(payload.archivePath).toBe(archivePath);
      expect(await fs.pathExists(archivePath)).toBe(true);
    }, 20000);

    it('should auto-create or reuse the default workspace when import runs outside any workspace', async () => {
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'rapidkit-home-import-default-'));
      const cwdOutsideWorkspace = await fs.mkdtemp(
        path.join(os.tmpdir(), 'rapidkit-cwd-import-default-')
      );
      const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rapidkit-source-import-default-'));

      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'default-orders-api',
        dependencies: {
          express: '^4.19.2',
        },
      });

      try {
        const { stdout, exitCode } = await execa(
          'node',
          [CLI_PATH, 'import', sourceDir, '--name', 'default-orders-api', '--json'],
          {
            cwd: cwdOutsideWorkspace,
            env: {
              ...process.env,
              HOME: fakeHome,
              USERPROFILE: fakeHome,
            },
          }
        );

        expect(exitCode).toBe(0);

        const expectedWorkspacePath = path.join(fakeHome, '.workspai', 'workspaces', 'workspai');
        const payload = JSON.parse(stdout) as {
          workspacePath: string;
          workspaceResolution: string;
          defaultWorkspaceCreated: boolean;
          projectWorkspaceCommand: string;
          commandsResolveWorkspaceFromProject: boolean;
          importedProject: { name: string; stack: string; source: string; path: string };
        };

        expect(payload.workspacePath).toBe(expectedWorkspacePath);
        expect(payload.workspaceResolution).toBe('default-auto');
        expect(payload.defaultWorkspaceCreated).toBe(true);
        expect(payload.projectWorkspaceCommand).toBe(
          'npx workspai project workspace status --json'
        );
        expect(payload.commandsResolveWorkspaceFromProject).toBe(true);
        expect(payload.importedProject).toMatchObject({
          name: 'default-orders-api',
          stack: 'express',
          source: 'local-folder',
        });
        expect(await fs.pathExists(path.join(expectedWorkspacePath, '.workspai-workspace'))).toBe(
          true
        );
        expect(
          await fs.pathExists(path.join(expectedWorkspacePath, '.workspai', 'workspace.json'))
        ).toBe(true);
        expect(
          await fs.readJson(path.join(expectedWorkspacePath, '.workspai', 'workspace.json'))
        ).toMatchObject({ profile: 'minimal' });
      } finally {
        await fs.remove(fakeHome);
        await fs.remove(cwdOutsideWorkspace);
        await fs.remove(sourceDir);
      }
    }, 60_000);

    it('should not silently fall back when an explicit workspace path is invalid', async () => {
      const fakeHome = await fs.mkdtemp(path.join(TEST_DIR, 'home-import-explicit-'));
      const cwdOutsideWorkspace = await fs.mkdtemp(path.join(TEST_DIR, 'cwd-import-explicit-'));
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-import-explicit-'));
      const invalidWorkspace = path.join(cwdOutsideWorkspace, 'not-a-workspace');

      await fs.ensureDir(invalidWorkspace);
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'explicit-orders-api',
        dependencies: {
          express: '^4.19.2',
        },
      });

      try {
        await execa(
          'node',
          [CLI_PATH, 'import', sourceDir, '--workspace', invalidWorkspace, '--json'],
          {
            cwd: cwdOutsideWorkspace,
            env: {
              ...process.env,
              HOME: fakeHome,
            },
            reject: false,
          }
        ).then(({ stdout, exitCode }) => {
          expect(exitCode).toBe(1);
          const payload = JSON.parse(stdout) as { error: string };
          expect(payload.error).toContain('Workspace path is not a valid Workspai workspace');
        });

        expect(
          await fs.pathExists(path.join(fakeHome, '.workspai', 'workspaces', 'workspai'))
        ).toBe(false);
      } finally {
        await fs.remove(fakeHome);
        await fs.remove(cwdOutsideWorkspace);
        await fs.remove(sourceDir);
      }
    }, 20000);

    it('should roll back imported local project via dist CLI when sync fails by injected test hook', async () => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(TEST_DIR, 'workspace-import-injected-fail-')
      );
      const sourceDir = await fs.mkdtemp(path.join(TEST_DIR, 'source-import-injected-fail-'));

      await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
      await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
        workspace_name: 'demo-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'orders-api-injected-fail',
        dependencies: {
          express: '^4.19.2',
        },
      });

      try {
        const { stdout, exitCode } = await execa(
          'node',
          [
            CLI_PATH,
            'import',
            sourceDir,
            '--workspace',
            workspaceRoot,
            '--name',
            'orders-api-injected-fail',
            '--json',
          ],
          {
            reject: false,
            env: {
              ...process.env,
              RAPIDKIT_TEST_IMPORT_SYNC_FAIL: '1',
            },
          }
        );

        expect(exitCode).toBe(1);
        const payload = JSON.parse(stdout) as { error: string };
        expect(payload.error).toContain(
          'Workspace sync failed after import and the imported project was rolled back'
        );
        expect(payload.error).toContain(
          'forced sync failure for command-level import rollback test'
        );

        expect(await fs.pathExists(path.join(workspaceRoot, 'orders-api-injected-fail'))).toBe(
          false
        );

        expect(
          await fs.pathExists(path.join(workspaceRoot, '.workspai', 'imported-projects.json'))
        ).toBe(false);
      } finally {
        await fs.remove(workspaceRoot);
        await fs.remove(sourceDir);
      }
    }, 20000);

    it('should route workspace-root init through the same full-init flow without misreading flags', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-root-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      try {
        const { stdout, stderr, exitCode } = await execa(
          'node',
          [CLI_PATH, 'init', '--no-update-check'],
          { cwd: workspaceRoot }
        );

        expect(exitCode).toBe(0);
        const output = `${stdout || ''}\n${stderr || ''}`;
        expect(output).toContain('workspace root');
        expect(output).toContain('same full-init flow');
        expect(output).toContain('Workspace run (init)');
        expect(output).not.toContain('No such option: --no-update-check');
      } finally {
        await fs.remove(workspaceRoot);
      }
    }, 30000);

    it('should redirect workspace init to workspace run init with a hint', async () => {
      const nonWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-non-workspace-'));

      try {
        await execa('node', [CLI_PATH, 'workspace', 'init'], {
          cwd: nonWorkspaceRoot,
        });
        expect.fail('Should have thrown because test dir is not a workspace');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const output = `${error.stdout || ''}\n${error.stderr || ''}`;
        expect(output).toContain('workspace init');
        expect(output).toContain('workspace run init');
        expect(output).not.toContain('Unknown workspace action: init');
      } finally {
        await fs.remove(nonWorkspaceRoot);
      }
    });

    it('resolves workspace root for workspace run init when called from a nested directory', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-root-nested-'));
      const nestedDir = path.join(workspaceRoot, 'my-nest-services');
      await fs.ensureDir(nestedDir);
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      try {
        const { stdout, exitCode } = await execa('node', [CLI_PATH, 'workspace', 'run', 'init'], {
          cwd: nestedDir,
        });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Using workspace root');
        expect(stdout).toContain(workspaceRoot);
        expect(stdout).toContain('Workspace run (init)');
      } finally {
        await fs.remove(workspaceRoot);
      }
    });

    it('resolves workspace root for workspace init when called from a nested directory', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-root-nested-init-'));
      const nestedDir = path.join(workspaceRoot, 'my-nest-services');
      await fs.ensureDir(nestedDir);
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      try {
        const { stdout, exitCode } = await execa('node', [CLI_PATH, 'workspace', 'init'], {
          cwd: nestedDir,
        });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Using workspace root');
        expect(stdout).toContain(workspaceRoot);
        expect(stdout).toContain('workspace init is an alias');
      } finally {
        await fs.remove(workspaceRoot);
      }
    });

    it('emits a single JSON document for workspace init --json', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-init-json-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      try {
        const { stdout, exitCode } = await execa(
          'node',
          [CLI_PATH, 'workspace', 'init', '--json', '--no-gates'],
          { cwd: workspaceRoot }
        );
        expect(exitCode).toBe(0);
        expect(() => JSON.parse(stdout)).not.toThrow();
        expect(JSON.parse(stdout)).toMatchObject({ stage: 'init' });
      } finally {
        await fs.remove(workspaceRoot);
      }
    });

    it('uses the fleet-size worker default when parallel mode omits max-workers', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-workers-default-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');
      for (const name of ['api-a', 'api-b', 'api-c']) {
        await fs.outputJson(path.join(workspaceRoot, name, 'package.json'), {
          name,
          scripts: { test: 'node --version' },
        });
        await fs.outputJson(path.join(workspaceRoot, name, '.workspai', 'project.json'), {
          name,
          runtime: 'node',
          kit_name: 'vite-react',
        });
        await fs.outputJson(path.join(workspaceRoot, name, '.workspai', 'context.json'), {
          engine: 'npm',
          runtime: 'node',
          commands: {
            // Exercise the real parallel fleet scheduler without nesting
            // Workspai -> npm -> Node subprocess chains under the full test pool.
            test: 'node --version',
          },
        });
      }

      const result = await execa(
        'node',
        [CLI_PATH, 'workspace', 'run', 'test', '--parallel', '--json', '--no-gates'],
        { cwd: workspaceRoot }
      );
      expect(JSON.parse(result.stdout)).toMatchObject({
        options: { parallel: true, maxWorkers: 3 },
        summary: { selectedCount: 3 },
      });
    }, 30000);

    it('rejects invalid max-workers with a structured JSON error', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-workers-invalid-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const result = await execa(
        'node',
        [CLI_PATH, 'workspace', 'run', 'test', '--max-workers', '0', '--json', '--no-gates'],
        { cwd: workspaceRoot, reject: false }
      );
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 'workspai-cli-operation-result-v1',
        operation: 'workspace run test',
        status: 'error',
        error: { code: 'cli.option.max-workers.invalid' },
      });
    });

    it('rejects workspace flags that are valid globally but meaningless for the selected action', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-flag-capability-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const result = await execa('node', [CLI_PATH, 'workspace', 'model', '--parallel', '--json'], {
        cwd: workspaceRoot,
        reject: false,
      });
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 'workspai-cli-operation-result-v1',
        operation: 'workspace model',
        status: 'error',
        exitCode: 2,
        error: { code: 'workspace.option.unsupported' },
        context: { action: 'model', unsupportedFlags: ['--parallel'] },
      });
    });

    it('allows workspace intelligence evidence flags on impact and verify actions', async () => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(TEST_DIR, 'workspace-intelligence-flag-capability-')
      );
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const impact = await execa(
        'node',
        [
          CLI_PATH,
          'workspace',
          'impact',
          '--include-paths',
          '--include-evidence',
          '--scan-depth',
          '2',
          '--json',
        ],
        { cwd: workspaceRoot, reject: false }
      );
      expect(impact.exitCode).toBe(1);
      expect(JSON.parse(impact.stdout)).toMatchObject({
        operation: 'workspace impact',
        error: { code: 'workspace.impact.from.required' },
      });

      const verify = await execa(
        'node',
        [
          CLI_PATH,
          'workspace',
          'verify',
          '--include-paths',
          '--include-evidence',
          '--scan-depth',
          '2',
          '--json',
        ],
        { cwd: workspaceRoot, reject: false }
      );
      expect(verify.exitCode).not.toBe(2);
      expect(verify.stdout).not.toContain('workspace.option.unsupported');
    });

    it('allows documented graph query and overlay flags', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-graph-flags-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const search = await execa(
        'node',
        [CLI_PATH, 'workspace', 'graph', 'search', 'project', '--limit', '1', '--json'],
        { cwd: workspaceRoot, reject: false }
      );
      expect(search.stdout).not.toContain('workspace.option.unsupported');

      const overlay = await execa(
        'node',
        [CLI_PATH, 'workspace', 'graph', 'overlay', '--from', 'missing-graph.json', '--json'],
        { cwd: workspaceRoot, reject: false }
      );
      expect(overlay.stdout).not.toContain('workspace.option.unsupported');
    });

    it('writes dependency graph renderers to --output with a structured receipt', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'workspace-graph-renderers-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      for (const mode of ['dot', 'mermaid'] as const) {
        const outputPath = path.join(workspaceRoot, `workspace-graph.${mode}`);
        const result = await execa(
          'node',
          [CLI_PATH, 'workspace', 'graph', mode, '--output', outputPath, '--json'],
          { cwd: workspaceRoot, reject: false }
        );

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          schemaVersion: 'workspai-cli-operation-result-v1',
          operation: `workspace graph ${mode}`,
          status: 'success',
          outputPath,
          artifact: { format: mode, nodeCount: 0, edgeCount: 0 },
        });
        const rendered = await fs.readFile(outputPath, 'utf8');
        expect(rendered).toContain(mode === 'dot' ? 'digraph workspace' : 'flowchart LR');
      }
    });

    it('honors pipeline --no-agent-sync at the CLI boundary', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'pipeline-no-agent-sync-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const result = await execa(
        'node',
        [CLI_PATH, 'pipeline', '--json', '--skip-analyze', '--skip-autopilot', '--no-agent-sync'],
        { cwd: workspaceRoot, reject: false }
      );

      expect([0, 1, 2]).toContain(result.exitCode);
      const payload = JSON.parse(result.stdout);
      expect(payload.agentGrounding).toBeUndefined();
      expect(await fs.pathExists(path.join(workspaceRoot, 'AGENTS.md'))).toBe(false);
      expect(await fs.pathExists(path.join(workspaceRoot, '.workspai/reports/INDEX.json'))).toBe(
        false
      );
    }, 30000);

    it('accepts --workspace on release readiness checks', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(TEST_DIR, 'readiness-workspace-option-'));
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '');

      const result = await execa(
        'node',
        [CLI_PATH, 'readiness', '--workspace', workspaceRoot, '--json', '--skip-verify'],
        { reject: false }
      );

      expect([0, 1, 2]).toContain(result.exitCode);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 'release-readiness-v1',
        workspacePath: workspaceRoot,
      });
      expect(await fs.pathExists(path.join(workspaceRoot, '.workspai/reports'))).toBe(true);
    }, 30000);

    it('should list workspace init in unknown workspace action help', async () => {
      try {
        await execa('node', [CLI_PATH, 'workspace', 'unknown-action']);
        expect.fail('Should have thrown for unknown workspace action');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const output = `${error.stdout || ''}\n${error.stderr || ''}`;
        expect(output).toContain('Unknown workspace action: unknown-action');
        // Pin against the canonical workspace command surface (single source of truth).
        expect(output).toContain(`Available: ${WORKSPACE_SUBCOMMANDS.join(', ')}`);
      }
    });

    it('emits a structured JSON error when a workspace root is required', async () => {
      const nonWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-no-root-json-'));
      try {
        const result = await execa('node', [CLI_PATH, 'workspace', 'model', '--json'], {
          cwd: nonWorkspaceRoot,
          reject: false,
        });
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          schemaVersion: 'workspai-cli-operation-result-v1',
          operation: 'workspace model',
          status: 'error',
          error: { code: 'project.workspace.unlinked' },
        });
      } finally {
        await fs.remove(nonWorkspaceRoot);
      }
    });

    it('emits a structured JSON error for an unknown workspace action', async () => {
      const result = await execa('node', [CLI_PATH, 'workspace', 'unknown-action', '--json'], {
        reject: false,
      });
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 'workspai-cli-operation-result-v1',
        operation: 'workspace unknown-action',
        status: 'error',
        error: { code: 'workspace.action.unknown' },
      });
    });

    it('keeps workspace import and hydrate input errors on their own contracts', async () => {
      const imported = await execa('node', [CLI_PATH, 'workspace', 'import', '--json'], {
        reject: false,
      });
      expect(imported.exitCode).toBe(1);
      expect(JSON.parse(imported.stdout)).toMatchObject({
        schemaVersion: 'workspai-cli-operation-result-v1',
        operation: 'workspace import',
        status: 'error',
        error: { code: 'workspace.import.input-required' },
      });

      const hydrated = await execa('node', [CLI_PATH, 'workspace', 'hydrate', '--json'], {
        reject: false,
      });
      expect(hydrated.exitCode).toBe(1);
      expect(JSON.parse(hydrated.stdout)).toMatchObject({
        schemaVersion: 'workspai-workspace-archive-operation-result-v1',
        operation: 'hydrate',
        status: 'error',
        error: { code: 'workspace.hydrate.input-required' },
      });
    });

    it('should handle invalid project names gracefully', async () => {
      try {
        await execa(
          'node',
          [CLI_PATH, '123invalid', '--template', 'fastapi', '--dry-run', '--no-update-check'],
          { cwd: TEST_DIR }
        );
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });

    it('should handle special characters in names', async () => {
      try {
        await execa(
          'node',
          [CLI_PATH, 'test@project!', '--template', 'fastapi', '--dry-run', '--no-update-check'],
          { cwd: TEST_DIR }
        );
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });

    it('should handle uppercase in names', async () => {
      try {
        await execa(
          'node',
          [CLI_PATH, 'TestProject', '--template', 'fastapi', '--dry-run', '--no-update-check'],
          { cwd: TEST_DIR }
        );
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });
  });

  describe('Welcome Message', () => {
    it('should display welcome message', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-ws', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Workspai');
    });
  });

  describe('Update Checker', () => {
    it('should skip update check with --no-update-check', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--version', '--no-update-check'], {
        cwd: TEST_DIR,
      });

      // Should not contain update check messages
      expect(stdout).not.toContain('Checking for updates');
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Config Loading', () => {
    it('should load user config in debug mode', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'test-ws', '--dry-run', '--debug', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('Debug mode enabled');
    });
  });

  describe('Path Resolution', () => {
    it('should resolve project path correctly in template mode', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-test-project', '--template', 'fastapi', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('my-test-project');
    });

    it('should reject relative paths with dots', async () => {
      try {
        await execa(
          'node',
          [CLI_PATH, './test-project', '--template', 'fastapi', '--dry-run', '--no-update-check'],
          { cwd: TEST_DIR }
        );
        expect.fail('Should reject path starting with dot');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const output = error.stdout || error.stderr;
        expect(output).toMatch(/cannot start with|URL-friendly/);
      }
    });
  });

  describe('Command Name', () => {
    it('should use "workspai" as the canonical command name', async () => {
      const { stdout } = await execa('node', [CLI_PATH, '--help']);

      expect(stdout).toContain('Workspai');
      expect(stdout).toContain('npx workspai');
      expect(stdout).not.toContain('npx rapidkit');
    });
  });

  describe('Argument Parsing', () => {
    it('should accept directory name as positional argument', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-custom-name', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('my-custom-name');
    });

    it('should handle kebab-case directory names', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-test-workspace', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('my-test-workspace');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long valid names', async () => {
      const longName = 'my-very-long-project-name-that-is-still-valid';
      const { stdout } = await execa(
        'node',
        [CLI_PATH, longName, '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain(longName);
    });

    it('should handle minimum valid name length (2 chars)', async () => {
      const { stdout } = await execa('node', [CLI_PATH, 'ab', '--dry-run', '--no-update-check'], {
        cwd: TEST_DIR,
      });

      expect(stdout).toContain('Dry-run mode');
    });

    it('should reject single character names', async () => {
      try {
        await execa('node', [CLI_PATH, 'a', '--dry-run', '--no-update-check'], {
          cwd: TEST_DIR,
        });
        expect.fail('Should reject single character name');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
        const output = error.stdout || error.stderr;
        expect(output).toContain('at least 2 characters');
      }
    });

    it('should reject names starting with numbers', async () => {
      try {
        await execa('node', [CLI_PATH, '1project', '--dry-run', '--no-update-check'], {
          cwd: TEST_DIR,
        });
        expect.fail('Should reject name starting with number');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });

    it('should reject names with spaces', async () => {
      try {
        await execa('node', [CLI_PATH, 'my project', '--dry-run', '--no-update-check'], {
          cwd: TEST_DIR,
        });
        expect.fail('Should reject name with spaces');
      } catch (error: any) {
        expect(error.exitCode).toBe(1);
      }
    });

    it('should accept names with hyphens', async () => {
      const { stdout } = await execa(
        'node',
        [CLI_PATH, 'my-project', '--dry-run', '--no-update-check'],
        { cwd: TEST_DIR }
      );

      expect(stdout).toContain('my-project');
    });
  });
});
