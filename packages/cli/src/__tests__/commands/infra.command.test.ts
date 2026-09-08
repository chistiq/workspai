import { Command } from 'commander';
import fs from 'fs';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  registerInfraCommands,
  resolveInfraWorkspacePath,
  runDockerCompose,
} from '../../commands/infra.js';
import { buildInfraPlan, writeInfraArtifacts } from '../../utils/infra-plan.js';
import { INFRA_PLAN_RELATIVE_PATH, INFRA_PLAN_SCHEMA_VERSION } from '../../utils/infra-stack.js';
import { normalizeRegistryPath } from '../../utils/registry-path.js';
import { writeProjectWorkspaceLink } from '../../project-workspace-link.js';

const tempDirs: string[] = [];
const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

function normalizeTestPath(value: string): string {
  try {
    return fs.realpathSync.native(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

function composeInvocationArgs(cmd: string, args: string[]): string[] {
  if (cmd === 'docker-compose') {
    return args;
  }
  if (cmd === 'docker' && args[0] === 'compose') {
    return args.slice(1);
  }
  return args;
}

function expectDockerComposeCall(expectedArgs: string[], workspacePath: string): void {
  const expectedCwd = normalizeTestPath(workspacePath);
  const match = mockExeca.mock.calls.find(([cmd, args, options]) => {
    const invocationArgs = composeInvocationArgs(String(cmd), args as string[]);
    const isComposeCall =
      (cmd === 'docker' && args[0] === 'compose') ||
      (cmd === 'docker-compose' && invocationArgs.includes('-f'));

    return (
      isComposeCall &&
      expectedArgs.every((item) => invocationArgs.includes(item)) &&
      normalizeTestPath(String(options?.cwd ?? '')) === expectedCwd
    );
  });

  expect(match, `docker compose call with ${expectedArgs.join(' ')}`).toBeDefined();

  const invocationArgs = composeInvocationArgs(String(match![0]), match![1] as string[]);
  const composeFileArg = invocationArgs[invocationArgs.indexOf('-f') + 1];
  expect(composeFileArg).toMatch(/docker-compose\.yml$/);
  expect(String(composeFileArg).replace(/\\/g, '/')).toContain(
    '.workspai/infra/docker-compose.yml'
  );
}

async function createWorkspace(): Promise<string> {
  const dir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-infra-command-'));
  tempDirs.push(dir);

  await fsExtra.ensureDir(path.join(dir, '.rapidkit'));
  await fsExtra.writeJson(path.join(dir, '.rapidkit', 'workspace.json'), {
    workspace_name: 'infra-test',
  });

  const projectRoot = path.join(dir, 'api');
  await fsExtra.ensureDir(path.join(projectRoot, '.rapidkit'));
  await fsExtra.writeJson(path.join(projectRoot, '.rapidkit', 'project.json'), {
    slug: 'api',
    kit: 'fastapi.standard',
  });
  await fsExtra.writeJson(path.join(projectRoot, 'registry.json'), {
    installed_modules: [{ slug: 'free/cache/redis' }],
  });

  return dir;
}

describe('infra command', () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExeca.mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fsExtra.remove(dir);
    }
  });

  it('runs infra plan and writes artifacts from commander action', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const program = new Command();
    registerInfraCommands(program);

    await program.parseAsync(['node', 'rapidkit', 'infra', 'plan']);

    await expect(
      fsExtra.pathExists(path.join(workspacePath, '.workspai', 'infra', 'docker-compose.yml'))
    ).resolves.toBe(true);
    await expect(
      fsExtra.pathExists(path.join(workspacePath, '.workspai', 'reports', 'infra-plan.json'))
    ).resolves.toBe(true);
  });

  it('runs docker compose up with generated compose file', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker-compose' && args[0] === 'version') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: 'Started\n', stderr: '' };
    });

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'up', '--no-plan']);

    expectDockerComposeCall(['up', '-d'], workspacePath);
  });

  it('runs docker compose down with optional volume cleanup', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'down', '--volumes']);

    expectDockerComposeCall(['down', '-v'], workspacePath);
  });

  it('resolves workspace path explicitly or from cwd', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    expect(resolveInfraWorkspacePath()).toBe(normalizeRegistryPath(workspacePath));
    expect(resolveInfraWorkspacePath(workspacePath)).toBe(normalizeRegistryPath(workspacePath));
  });

  it('resolves the canonical workspace from an adopted external project', async () => {
    const workspacePath = await createWorkspace();
    const projectPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-infra-adopted-'));
    tempDirs.push(projectPath);
    await fsExtra.outputFile(path.join(workspacePath, '.workspai-workspace'), 'workspace\n');
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'external-api',
      runtime: 'node',
    });
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'infra-test', profile: 'polyglot' },
      projects: [
        {
          slug: 'external-api',
          relativePath: 'external/external-api',
          externalPath: projectPath,
          relationship: 'adopted',
          modules: [],
          ports: [],
          contracts: {
            owns: [],
            apis: [],
            publishes: [],
            consumes: [],
            dependsOn: [],
            env: [],
          },
        },
      ],
    });
    await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName: 'external-api',
      relationship: 'adopted',
    });
    process.chdir(projectPath);

    expect(resolveInfraWorkspacePath()).toBe(normalizeRegistryPath(workspacePath));
  });

  it('throws when workspace root cannot be resolved', () => {
    const outside = fsExtra.mkdtempSync(path.join(os.tmpdir(), 'rk-infra-outside-'));
    tempDirs.push(outside);
    process.chdir(outside);

    expect(() => resolveInfraWorkspacePath()).toThrow('Not inside a Workspai workspace');
  });

  it('runDockerCompose throws when compose file is missing', async () => {
    const workspacePath = await createWorkspace();

    await expect(runDockerCompose({ workspacePath, args: ['up', '-d'] })).rejects.toThrow(
      'Compose file not found'
    );
  });

  it('prints infra plan as JSON and supports dry-run mode', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const program = new Command();
    registerInfraCommands(program);

    const jsonLogs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      if (typeof value === 'string') {
        jsonLogs.push(value);
      }
    });

    await program.parseAsync(['node', 'rapidkit', 'infra', 'plan', '--json', '--dry-run']);

    const payload = JSON.parse(jsonLogs.join('\n'));
    expect(payload.schemaVersion).toBe(INFRA_PLAN_SCHEMA_VERSION);
    expect(payload.artifacts.dryRun).toBe(true);
    await expect(
      fsExtra.pathExists(path.join(workspacePath, '.rapidkit', 'infra', 'docker-compose.yml'))
    ).resolves.toBe(false);
  });

  it('prints verbose env scan details and override sources in plan summary', async () => {
    const workspacePath = await createWorkspace();
    const projectRoot = path.join(workspacePath, 'api');
    await fsExtra.writeFile(
      path.join(projectRoot, '.env.example'),
      'DATABASE_URL=\nSECRET_KEY=\n',
      'utf-8'
    );
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit', 'infra'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'infra', 'overrides.json'), {
      services: ['mailpit'],
    });
    process.chdir(workspacePath);

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'plan', '--verbose']);

    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(logs).toContain('Overrides:');
    expect(logs).toContain('mailpit');
    expect(logs).toContain('Detected from env vars (infra-mapped):');
    expect(logs).toContain('Other scanned env vars:');
  });

  it('runs infra up with --build and surfaces docker failure hints', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker' && args[0] === 'compose') {
        return { exitCode: 1, stdout: '', stderr: 'no space left on device' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'up', '--no-plan', '--build']);

    expectDockerComposeCall(['up', '-d', '--build'], workspacePath);
    const errorLogs = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(errorLogs).toContain('disk is full');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails infra up when the plan has no services', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const planPath = path.join(workspacePath, INFRA_PLAN_RELATIVE_PATH);
    await fsExtra.ensureDir(path.dirname(planPath));
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit', 'infra'));
    await fsExtra.writeJson(planPath, {
      schemaVersion: INFRA_PLAN_SCHEMA_VERSION,
      generatedAt: '2026-06-09T12:00:00.000Z',
      workspacePath,
      strategy: 'sidecar',
      composePath: '.rapidkit/infra/docker-compose.yml',
      envExamplePath: '.rapidkit/infra/.env.example',
      services: [],
      connectionEnv: {},
      sources: { modules: [], envVars: [], overrides: [] },
      warnings: ['No infrastructure services detected.'],
    });
    await fsExtra.writeFile(
      path.join(workspacePath, '.rapidkit', 'infra', 'docker-compose.yml'),
      'services: {}\n',
      'utf-8'
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'up', '--no-plan']);

    const errorLogs = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(errorLogs).toContain('Infra plan has no services');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('prints infra status json output from docker compose ps', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker' && args[0] === 'compose' && args.includes('ps')) {
        return {
          exitCode: 0,
          stdout: '{"Name":"workspai-postgres","State":"running"}\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const program = new Command();
    registerInfraCommands(program);

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    await program.parseAsync(['node', 'rapidkit', 'infra', 'status', '--json']);
    expect(stdoutChunks.join('')).toContain('workspai-postgres');
  });

  it('enforces strict infra status when containers are unhealthy', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker' && args[0] === 'compose' && args.includes('ps')) {
        return { exitCode: 0, stdout: 'workspai-postgres Restarting\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'status', '--strict']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shows guidance when infra status finds no running containers', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker' && args[0] === 'compose' && args.includes('ps')) {
        return { exitCode: 0, stdout: '\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'status']);

    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(logs).toContain('No running containers found for the infra stack.');
    expect(logs).toContain('npx workspai infra up');
  });

  it('exits when infra plan cannot resolve workspace root', async () => {
    const outside = fsExtra.mkdtempSync(path.join(os.tmpdir(), 'rk-infra-plan-outside-'));
    tempDirs.push(outside);
    process.chdir(outside);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'plan']);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('summarizes empty infra plans and writes artifacts on normal plan', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-infra-empty-'));
    tempDirs.push(workspacePath);
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'empty-infra',
    });
    const projectRoot = path.join(workspacePath, 'api');
    await fsExtra.ensureDir(path.join(projectRoot, '.rapidkit'));
    await fsExtra.writeJson(path.join(projectRoot, '.rapidkit', 'project.json'), {
      slug: 'api',
      kit: 'fastapi.standard',
    });
    process.chdir(workspacePath);

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'plan']);

    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(logs).toContain('No infrastructure services detected.');
    expect(logs).toContain('Artifacts written:');
  });

  it('propagates docker compose ps failures during status checks', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const plan = await buildInfraPlan({ workspacePath });
    await writeInfraArtifacts({ workspacePath, plan });

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        (args[0] === 'version' || (args[0] === 'compose' && args[1] === 'version'))
      ) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (cmd === 'docker' && args[0] === 'compose' && args.includes('ps')) {
        return { exitCode: 2, stdout: '', stderr: 'compose ps failed' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'status']);

    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrChunks.join('')).toContain('compose ps failed');
  });

  it('exits when infra status cannot resolve workspace root', async () => {
    const outside = fsExtra.mkdtempSync(path.join(os.tmpdir(), 'rk-infra-status-outside-'));
    tempDirs.push(outside);
    process.chdir(outside);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'status']);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when infra plan is missing for lifecycle commands', async () => {
    const workspacePath = await createWorkspace();
    process.chdir(workspacePath);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const program = new Command();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'rapidkit', 'infra', 'down']);

    const errorLogs = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0] ?? ''))
      .join('\n');
    expect(errorLogs).toContain('Infra plan not found');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
