import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fsExtra from 'fs-extra';

import * as create from '../create.js';
import * as index from '../index.js';
import {
  generateModelGatewayProject,
  listModelGatewayProjectKits,
} from '../model-gateways/project-kits.js';
import { getDefaultPythonCommand } from '../utils/platform-capabilities.js';
import { buildCleanGitEnv } from '../utils/git-worktree.js';

const roots: string[] = [];
const NPM_INSTALL_TIMEOUT_MS = 240_000;

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(path.resolve(root), {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 10 : 0,
      retryDelay: 100,
    });
  }
});

function isolatedRegistryEnv(cacheRoot: string): NodeJS.ProcessEnv {
  const env = { ...buildCleanGitEnv(process.env), CI: '1' };
  delete env.OPENROUTER_API_KEY;
  delete env.OPENROUTER_MODEL;
  env.npm_config_cache = path.join(cacheRoot, 'npm');
  env.NPM_CONFIG_CACHE = path.join(cacheRoot, 'npm');
  env.PIP_CACHE_DIR = path.join(cacheRoot, 'pip');
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  cacheRoot?: string
): string {
  const env = cacheRoot
    ? isolatedRegistryEnv(cacheRoot)
    : { ...buildCleanGitEnv(process.env), CI: '1' };
  delete env.OPENROUTER_API_KEY;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.error)})\n${output}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${output}`);
  }
  return output;
}

function runExpectFailure(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
  cacheRoot?: string
): string {
  const env = cacheRoot
    ? isolatedRegistryEnv(cacheRoot)
    : { ...buildCleanGitEnv(process.env), CI: '1' };
  delete env.OPENROUTER_API_KEY;
  delete env.OPENROUTER_MODEL;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    throw new Error(`${command} ${args.join(' ')} hung after ${timeoutMs}ms\n${output}`);
  }
  if (result.status === 0) {
    throw new Error(`${command} ${args.join(' ')} unexpectedly succeeded\n${output}`);
  }
  return output;
}

function npmCommand(): { command: string; prefix: string[] } {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return { command: process.execPath, prefix: [npmExecPath] };
  }
  return { command: 'npm', prefix: [] };
}

describe('generated OpenRouter gateway projects', () => {
  it('installs and verifies the TypeScript starter without a live API key', async () => {
    const kit = listModelGatewayProjectKits().find(
      (entry) => entry.id === 'gateway.openrouter.typescript'
    );
    if (!kit) throw new Error('missing TypeScript gateway kit');
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-ts-'));
    const cacheRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-npm-'));
    roots.push(root, cacheRoot);
    await generateModelGatewayProject({
      projectPath: root,
      projectName: 'openrouter-ts-gateway',
      kit,
    });
    const npm = npmCommand();
    run(npm.command, [...npm.prefix, 'install'], root, NPM_INSTALL_TIMEOUT_MS, cacheRoot);
    run(npm.command, [...npm.prefix, 'run', 'typecheck'], root, 120_000, cacheRoot);
    run(npm.command, [...npm.prefix, 'run', 'build'], root, 120_000, cacheRoot);
    const testOutput = run(npm.command, [...npm.prefix, 'test'], root, 120_000, cacheRoot);
    expect(testOutput.toLowerCase()).not.toContain('sk-or-live');
    const smoke = run(npm.command, [...npm.prefix, 'run', 'smoke'], root, 120_000, cacheRoot);
    expect(smoke).toMatch(/smoke-ok|smoke/);
    const startFailure = runExpectFailure(
      npm.command,
      [...npm.prefix, 'start'],
      root,
      60_000,
      cacheRoot
    );
    expect(startFailure).toMatch(/OPENROUTER_API_KEY|OPENROUTER_MODEL/);
    expect(startFailure.toLowerCase()).not.toContain('sk-or-live');
  }, 420_000);

  it('installs and verifies the Python starter without a live API key', async () => {
    const kit = listModelGatewayProjectKits().find(
      (entry) => entry.id === 'gateway.openrouter.python'
    );
    if (!kit) throw new Error('missing Python gateway kit');
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-py-'));
    const cacheRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-pip-'));
    roots.push(root, cacheRoot);
    await generateModelGatewayProject({
      projectPath: root,
      projectName: 'openrouter-py-gateway',
      kit,
    });
    const python = getDefaultPythonCommand();
    const venvPython =
      process.platform === 'win32'
        ? path.join(root, '.venv', 'Scripts', 'python.exe')
        : path.join(root, '.venv', 'bin', 'python');
    run(python, ['-m', 'venv', '.venv'], root, 120_000, cacheRoot);
    run(venvPython, ['-m', 'pip', 'install', '-e', '.'], root, 180_000, cacheRoot);
    run(venvPython, ['-m', 'compileall', '.'], root, 60_000, cacheRoot);
    run(venvPython, ['-m', 'unittest', 'discover', '-s', 'tests'], root, 120_000, cacheRoot);
    const smoke = run(venvPython, ['main.py', '--smoke'], root, 60_000, cacheRoot);
    expect(smoke).toMatch(/smoke-ok|smoke/);
    const startFailure = runExpectFailure(venvPython, ['main.py'], root, 30_000, cacheRoot);
    expect(startFailure).toMatch(/OPENROUTER_API_KEY|OPENROUTER_MODEL/);
    const startBin =
      process.platform === 'win32'
        ? path.join(root, '.venv', 'Scripts', 'start.exe')
        : path.join(root, '.venv', 'bin', 'start');
    const otherCwd = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-other-'));
    roots.push(otherCwd);
    const consoleSmoke = run(startBin, ['--smoke'], otherCwd, 60_000, cacheRoot);
    expect(consoleSmoke).toMatch(/smoke-ok|smoke/);
  }, 240_000);

  it('keeps earlier gateway projects valid after creating the next kit in one workspace', async () => {
    const parent = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-ws-'));
    roots.push(parent);
    await create.createProject('gateway-e2e', {
      parentDirectory: parent,
      profile: 'minimal',
      skipPythonEngine: true,
      skipGit: true,
      yes: true,
    });
    const workspacePath = path.join(parent, 'gateway-e2e');
    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    try {
      expect(
        await index.handleCreateOrFallback([
          'create',
          'project',
          'gateway.openrouter.typescript',
          'first-gateway',
          '--skip-git',
          '--yes',
        ])
      ).toBe(0);
      expect(
        await index.handleCreateOrFallback([
          'create',
          'project',
          'gateway.openrouter.python',
          'second-gateway',
          '--skip-git',
          '--yes',
        ])
      ).toBe(0);
      expect(
        await fsExtra.pathExists(path.join(workspacePath, 'first-gateway', 'package.json'))
      ).toBe(true);
      expect(
        await fsExtra.pathExists(path.join(workspacePath, 'second-gateway', 'pyproject.toml'))
      ).toBe(true);
      const model = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json')
      );
      expect(model.projects.map((project: { name?: string }) => project.name).sort()).toEqual([
        'first-gateway',
        'second-gateway',
      ]);
      expect(model.projects.every((project: { kind?: string }) => project.kind === 'gateway')).toBe(
        true
      );
      expect(
        model.projects.map(
          (project: {
            name?: string;
            framework?: string;
            frameworkDisplayName?: string;
            runtime?: string;
          }) => ({
            name: project.name,
            framework: project.framework,
            frameworkDisplayName: project.frameworkDisplayName,
            runtime: project.runtime,
          })
        )
      ).toEqual(
        expect.arrayContaining([
          {
            name: 'first-gateway',
            framework: 'openrouter',
            frameworkDisplayName: 'OpenRouter',
            runtime: 'node',
          },
          {
            name: 'second-gateway',
            framework: 'openrouter',
            frameworkDisplayName: 'OpenRouter',
            runtime: 'python',
          },
        ])
      );

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map((value) => String(value)).join(' '));
      });
      try {
        const { runDoctor } = await import('../doctor.js');
        await runDoctor({ workspace: true, json: true });
      } finally {
        logSpy.mockRestore();
      }
      const doctorLine = logs.find((line) => line.trim().startsWith('{'));
      expect(doctorLine).toBeTruthy();
      const doctor = JSON.parse(doctorLine ?? '{}') as {
        projects?: Array<{
          name?: string;
          framework?: string;
          projectKind?: string;
          projectArchetype?: string;
          runtimeFamily?: string;
          issues?: string[];
        }>;
      };
      const byName = new Map((doctor.projects ?? []).map((project) => [project.name, project]));
      expect(byName.get('first-gateway')).toMatchObject({
        framework: 'OpenRouter',
        projectKind: 'gateway',
        projectArchetype: 'service',
        runtimeFamily: 'node',
      });
      expect(byName.get('second-gateway')).toMatchObject({
        framework: 'OpenRouter',
        projectKind: 'gateway',
        projectArchetype: 'service',
        runtimeFamily: 'python',
      });
      expect(byName.get('second-gateway')?.issues ?? []).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/src\/__init__\.py/)])
      );
    } finally {
      process.chdir(previousCwd);
    }
  }, 180_000);

  it('creates and verifies a TypeScript gateway in a path that contains spaces', async () => {
    const kit = listModelGatewayProjectKits().find(
      (entry) => entry.id === 'gateway.openrouter.typescript'
    );
    if (!kit) throw new Error('missing TypeScript gateway kit');
    const parent = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai or ts '));
    const cacheRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-npm-space-'));
    roots.push(parent, cacheRoot);
    const root = path.join(parent, 'open router gateway');
    await generateModelGatewayProject({
      projectPath: root,
      projectName: 'openrouter-ts-gateway',
      kit,
    });
    const npm = npmCommand();
    run(npm.command, [...npm.prefix, 'install'], root, 120_000, cacheRoot);
    const smoke = run(npm.command, [...npm.prefix, 'run', 'smoke'], root, 120_000, cacheRoot);
    expect(smoke).toMatch(/smoke-ok|smoke/);
  }, 180_000);
});
