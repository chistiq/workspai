import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { syncWorkspaceFoundationFiles } from '../create.js';
import { runDoctor } from '../doctor.js';
import { getVenvPythonPath } from '../utils/platform-capabilities.js';
import {
  bootstrapCli,
  bridgeFailureCode,
  buildDelegationEnvForInit,
  checkStrictPolicyPreflightForDelegation,
  commandAvailable,
  createProjectVenv,
  createWorkspaceVenv,
  defaultWorkspacePolicyYaml,
  handleBootstrapCommand,
  handleCacheCommand,
  handleCreateOrFallback,
  handleGoInit,
  handleInitCommand,
  handleJavaCommand,
  handleMirrorCommand,
  handleNodeCommand,
  handleSetupCommand,
  hostPythonCandidates,
  inferRuntimeByFiles,
  installPythonDependenciesWithPipFallback,
  isNpmOnlyManualHandlerCommand,
  isNpmOnlyParseDirectCommand,
  isNpmOnlyParseDirectInvocation,
  ensurePythonProjectUsesLocalVenv,
  findContextFileUp,
  findLegacyWorkspaceUp,
  findWorkspaceMarkerUp,
  findWorkspaceUp,
  hasWorkspaceRootMarkers,
  isNpmOnlyInvocation,
  isNpmOnlyScopedCommand,
  isNpmOnlyTopLevelCommand,
  normalizeFallbackTemplate,
  parseCacheConfig,
  parseMaxWorkersOption,
  parseNodeEvalScript,
  parsePolicyBooleanLiteral,
  printHelp,
  program,
  readFlagValue,
  replaceOrInsertRulePolicyLine,
  replaceOrInsertTopLevelPolicyLine,
  resolveInvokedCliName,
  runCommandInCwd,
  runCreateFallback,
  validateNpmKitFlags,
} from '../index.js';
import {
  createWorkspace,
  createProject as createStandaloneProject,
  listWorkspaces,
  registerWorkspaceStrict,
} from '../workspace.js';

const temporaryDirectories: string[] = [];

function resetProgramOptionState(command: Command = program): void {
  for (const option of command.options) {
    command.setOptionValueWithSource(option.attributeName(), option.defaultValue, 'default');
  }
  for (const child of command.commands) {
    resetProgramOptionState(child);
  }
}

async function createWorkspaceFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-index-coverage-'));
  temporaryDirectories.push(root);
  const metadata = path.join(root, '.workspai');
  const project = path.join(root, 'api');
  await fs.mkdir(path.join(metadata, 'reports'), { recursive: true });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.workspai-workspace'),
    `${JSON.stringify({ signature: 'RAPIDKIT_WORKSPACE', name: 'coverage-workspace' }, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(metadata, 'workspace.json'),
    `${JSON.stringify(
      {
        schema_version: '1.0',
        workspace_name: 'coverage-workspace',
        profile: 'polyglot',
        engine: { install_method: 'venv', python_version: '3.10' },
      },
      null,
      2
    )}\n`
  );
  await fs.writeFile(
    path.join(metadata, 'toolchain.lock'),
    `${JSON.stringify(
      { schema_version: '1.0', runtime: { node: { version: process.version } } },
      null,
      2
    )}\n`
  );
  await fs.writeFile(
    path.join(metadata, 'policies.yml'),
    'schema_version: "1.0"\nenforcement_mode: warn\ndependency_mode: online\n'
  );
  await fs.writeFile(
    path.join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'api',
        version: '1.0.0',
        scripts: { test: 'node --test', build: 'node -e "process.exit(0)"' },
      },
      null,
      2
    )}\n`
  );
  await fs.writeFile(path.join(project, 'src', 'index.ts'), 'export const api = true;\n');
  await fs.mkdir(path.join(project, '.workspai'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.workspai', 'project.json'),
    `${JSON.stringify(
      {
        schema_version: '1.0',
        name: 'api',
        runtime: 'node',
        framework: 'nestjs',
        relationship: 'managed',
      },
      null,
      2
    )}\n`
  );
  return root;
}

async function runWorkspaceCommand(root: string, args: string[]): Promise<void> {
  resetProgramOptionState();
  process.argv = ['node', 'workspai', 'workspace', ...args];
  await program.parseAsync(['workspace', ...args], { from: 'user' });
}

async function runWorkspaceCommandExpectExit(
  root: string,
  args: string[],
  exitCode: number
): Promise<void> {
  await expect(runWorkspaceCommand(root, args)).rejects.toThrow(
    `process.exit unexpectedly called with "${exitCode}"`
  );
}

async function runTopLevelCommand(args: string[]): Promise<void> {
  resetProgramOptionState();
  process.argv = ['node', 'workspai', ...args];
  await program.parseAsync(args, { from: 'user' });
}

async function runTopLevelCommandExpectExit(args: string[], exitCode: number): Promise<void> {
  await expect(runTopLevelCommand(args)).rejects.toThrow(
    `process.exit unexpectedly called with "${exitCode}"`
  );
}

async function runTopLevelCommandAllowExit(args: string[], exitCodes: number[]): Promise<void> {
  try {
    await runTopLevelCommand(args);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(exitCodes.some((code) => (error as Error).message.includes(`"${code}"`))).toBe(true);
  }
}

describe.sequential('in-process workspace Commander coverage', () => {
  let root: string;
  let originalCwd: string;
  let originalArgv: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    root = await createWorkspaceFixture();
    originalCwd = process.cwd();
    originalArgv = [...process.argv];
    process.chdir(root);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }, 60_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await Promise.all(
      temporaryDirectories.map((directory) =>
        fs.rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        })
      )
    );
  });

  it('executes the canonical evidence-producing command chain through Commander', async () => {
    await runWorkspaceCommand(root, ['sync', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, [
      'model',
      '--workspace',
      root,
      '--json',
      '--write',
      '--include-evidence',
      '--cache',
    ]);
    await runWorkspaceCommand(root, ['snapshot', '--workspace', root, '--json']);

    const snapshot = path.join(root, '.workspai', 'reports', 'workspace-model-snapshot.json');
    await runWorkspaceCommand(root, [
      'diff',
      '--workspace',
      root,
      '--from',
      snapshot,
      '--json',
      '--include-evidence',
    ]);
    const diff = path.join(root, '.workspai', 'reports', 'workspace-model-diff-last-run.json');
    await runWorkspaceCommand(root, [
      'impact',
      '--workspace',
      root,
      '--from',
      diff,
      '--json',
      '--include-evidence',
    ]);
    const impact = path.join(root, '.workspai', 'reports', 'workspace-impact-last-run.json');
    await runWorkspaceCommandExpectExit(
      root,
      ['verify', '--workspace', root, '--from-impact', impact, '--json'],
      2
    );
    await runWorkspaceCommand(root, [
      'context',
      '--workspace',
      root,
      '--json',
      '--write',
      '--include-evidence',
      '--for-agent',
      'codex',
      '--no-agent-sync',
    ]);
    await runWorkspaceCommand(root, ['remediation-plan', '--workspace', root, '--json', '--write']);

    for (const artifact of [
      'workspace-model.json',
      'workspace-model-snapshot.json',
      'workspace-model-diff-last-run.json',
      'workspace-impact-last-run.json',
      'workspace-verify-last-run.json',
      'workspace-context-agent.json',
      'artifact-remediation-plan-last-run.json',
    ]) {
      await expect(
        fs.access(path.join(root, '.workspai', 'reports', artifact))
      ).resolves.toBeUndefined();
    }
  }, 60_000);

  it('executes workspace governance, registry, graph, and explanation callbacks', async () => {
    await runWorkspaceCommand(root, ['list', '--json']);
    await runWorkspaceCommand(root, ['list']);
    await runWorkspaceCommand(root, [
      'registry',
      'status',
      '--workspace',
      root,
      '--json',
      '--refresh',
    ]);
    await runWorkspaceCommand(root, ['foundation', 'ensure', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, ['policy', 'show', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, [
      'policy',
      'set',
      'mode',
      'strict',
      '--workspace',
      root,
      '--json',
    ]);
    await runWorkspaceCommand(root, [
      'policy',
      'set',
      'dependency_sharing_mode',
      'shared-runtime-caches',
      '--workspace',
      root,
    ]);
    await runWorkspaceCommand(root, [
      'policy',
      'set',
      'rules.enforce_toolchain_lock',
      'true',
      '--workspace',
      root,
      '--json',
    ]);
    await runWorkspaceCommand(root, [
      'policy',
      'set',
      'mode',
      'warn',
      '--workspace',
      root,
      '--json',
    ]);
    await runWorkspaceCommand(root, ['contract', 'init', '--workspace', root, '--json', '--force']);
    await runWorkspaceCommand(root, ['contract', 'verify', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, ['contract', 'graph', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, ['graph', 'emit', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, [
      'explain',
      'release-blocked',
      '--workspace',
      root,
      '--json',
      '--write',
    ]);
    await runWorkspaceCommand(root, ['agent-sync', '--workspace', root, '--json', '--dry-run']);
    await runWorkspaceCommand(root, ['watch', '--workspace', root, '--json', '--once']);

    expect(logSpy).toHaveBeenCalled();
  }, 60_000);

  it('executes human renderers, archives, fleet runs, and guarded error branches', async () => {
    await runWorkspaceCommand(root, ['model', '--workspace', root, '--incremental', '--write']);
    await runWorkspaceCommand(root, ['snapshot', '--workspace', root]);
    const snapshot = path.join(root, '.workspai', 'reports', 'workspace-model-snapshot.json');
    await runWorkspaceCommand(root, ['diff', '--workspace', root, '--from', snapshot]);
    const diff = path.join(root, '.workspai', 'reports', 'workspace-model-diff-last-run.json');
    await runWorkspaceCommand(root, ['impact', '--workspace', root, '--from', diff]);
    const impact = path.join(root, '.workspai', 'reports', 'workspace-impact-last-run.json');
    await runWorkspaceCommandExpectExit(
      root,
      ['verify', '--workspace', root, '--from-impact', impact],
      2
    );
    await runWorkspaceCommand(root, [
      'context',
      '--workspace',
      root,
      '--for-agent',
      'codex',
      '--write',
      '--no-agent-sync',
    ]);
    await runWorkspaceCommand(root, ['remediation-plan', '--workspace', root, '--write']);
    await runWorkspaceCommand(root, ['registry', 'status', '--workspace', root]);
    await runWorkspaceCommand(root, ['foundation', 'ensure', '--workspace', root]);
    await runWorkspaceCommand(root, ['policy', 'show', '--workspace', root]);
    await runWorkspaceCommand(root, ['contract', 'inspect', '--workspace', root]);
    await runWorkspaceCommand(root, ['contract', 'verify', '--workspace', root]);
    await runWorkspaceCommand(root, ['contract', 'graph', '--workspace', root]);
    await runWorkspaceCommand(root, ['graph', 'emit', '--workspace', root]);
    await runWorkspaceCommand(root, ['graph', 'dot', '--workspace', root]);
    await runWorkspaceCommand(root, ['graph', 'mermaid', '--workspace', root]);
    await runWorkspaceCommand(root, ['graph', 'explain', 'api', '--workspace', root]);
    await runWorkspaceCommand(root, ['graph', 'explain', 'api', '--workspace', root, '--json']);
    await runWorkspaceCommand(root, ['watch', '--workspace', root, '--once']);
    await runWorkspaceCommand(root, ['watch', '--workspace', root, '--once', '--graph-stream']);
    await runWorkspaceCommand(root, ['sync', '--workspace', root]);
    await runWorkspaceCommand(root, ['explain', 'release-blocked', '--workspace', root, '--write']);
    await runWorkspaceCommand(root, ['explain', '--workspace', root, '--write', '--json']);
    await runWorkspaceCommand(root, ['trace', '--workspace', root, '--from', diff, '--write']);
    await runWorkspaceCommand(root, ['agent-sync', '--workspace', root, '--dry-run']);

    const sharePath = path.join(root, 'workspace-share.json');
    await runWorkspaceCommand(root, [
      'share',
      '--workspace',
      root,
      '--output',
      sharePath,
      '--json',
    ]);
    await expect(fs.access(sharePath)).resolves.toBeUndefined();

    const archivePath = path.join(root, 'workspace.zip');
    await runWorkspaceCommand(root, [
      'export',
      '--workspace',
      root,
      '--output',
      archivePath,
      '--json',
    ]);
    await runWorkspaceCommand(root, ['archive', 'inspect', archivePath, '--json']);
    await runWorkspaceCommand(root, ['archive', 'verify', archivePath, '--json']);
    await runWorkspaceCommand(root, ['archive', 'doctor', archivePath, '--json']);
    await runWorkspaceCommand(root, ['archive', 'inspect', archivePath]);
    await runWorkspaceCommand(root, ['archive', 'verify', archivePath]);
    await runWorkspaceCommand(root, ['archive', 'doctor', archivePath]);
    await runWorkspaceCommand(root, [
      'hydrate',
      archivePath,
      '--output',
      path.join(root, 'hydrated'),
      '--dry-run',
      '--json',
    ]);
    await runWorkspaceCommand(root, [
      'run',
      'build',
      '--workspace',
      root,
      '--json',
      '--continue-on-error',
    ]);

    await runWorkspaceCommandExpectExit(root, ['run', 'dev', '--workspace', root], 2);
    await runWorkspaceCommandExpectExit(root, ['feedback', 'unknown', '--workspace', root], 1);
    await runWorkspaceCommandExpectExit(root, ['mcp', 'unknown', '--workspace', root, '--json'], 1);
    await runWorkspaceCommandExpectExit(root, ['hydrate', '--workspace', root, '--json'], 2);
    await runWorkspaceCommandExpectExit(root, ['contract', 'unknown', '--workspace', root], 1);
    await runWorkspaceCommandExpectExit(root, ['registry', 'unknown', '--workspace', root], 1);
    await runWorkspaceCommandExpectExit(root, ['foundation', 'unknown', '--workspace', root], 1);
    await runWorkspaceCommandExpectExit(
      root,
      ['policy', 'set', 'mode', 'invalid', '--workspace', root],
      1
    );
    await runWorkspaceCommandExpectExit(
      root,
      ['policy', 'set', 'rules.enforce_toolchain_lock', 'maybe', '--workspace', root],
      1
    );
    await runWorkspaceCommandExpectExit(root, ['policy', 'unknown', '--workspace', root], 1);
    await runWorkspaceCommandExpectExit(
      root,
      ['graph', 'explain', 'missing', '--workspace', root, '--json'],
      1
    );
    await runWorkspaceCommandExpectExit(root, ['archive', 'inspect', '--workspace', root], 2);
    await runWorkspaceCommandExpectExit(root, ['unknown', '--workspace', root, '--json'], 1);
  }, 60_000);

  it('executes top-level dry-run and workspace creation callbacks', async () => {
    const workspaceOutput = await fs.mkdtemp(
      path.join(os.tmpdir(), 'workspai-index-workspace-create-')
    );
    temporaryDirectories.push(workspaceOutput);
    await runTopLevelCommand([
      'coverage-dry-run',
      '--dry-run',
      '--yes',
      '--no-update-check',
      '--output',
      workspaceOutput,
    ]);
    await runTopLevelCommand([
      'legacy-workspace-coverage',
      '--yes',
      '--skip-git',
      '--skip-python-engine',
      '--no-update-check',
      '--output',
      workspaceOutput,
    ]);
  }, 30_000);

  it('executes top-level project creation callbacks', async () => {
    await runTopLevelCommand([
      'legacy-go-coverage',
      '--template',
      'gofiber.standard',
      '--yes',
      '--skip-git',
      '--skip-install',
      '--no-workspace',
      '--no-update-check',
    ]);
  }, 30_000);

  it('executes top-level discovery, help, configuration, and AI callbacks', async () => {
    await runTopLevelCommand(['commands', '--json']);
    await runTopLevelCommand(['commands']);
    printHelp();
    process.chdir(path.join(root, 'api'));
    printHelp();
    process.chdir(root);
    await runTopLevelCommand(['config', 'show']);
    await runTopLevelCommand(['ai', 'info']);
    await runTopLevelCommand(['ai', 'recommend', 'authentication api', '--number', '3', '--json']);
  }, 30_000);

  it('executes top-level infrastructure and governance callbacks', async () => {
    await runTopLevelCommand(['infra', 'plan', '--json']);
    await runTopLevelCommandAllowExit(['infra', 'status', '--json'], [1]);
    await runTopLevelCommand(['analyze', '--workspace', root, '--json']);
    await runTopLevelCommand(['readiness', '--workspace', root, '--json', '--skip-verify']);
  }, 30_000);

  it('executes top-level doctor profiles and shell callbacks', async () => {
    await runTopLevelCommandAllowExit(['doctor', 'workspace', '--workspace', root, '--json'], [1]);
    for (const profile of ['local', 'ci', 'release', 'enterprise-strict']) {
      await runTopLevelCommandAllowExit(
        ['doctor', 'workspace', '--workspace', root, '--json', '--profile', profile],
        [1, 2]
      );
    }
    await runTopLevelCommandAllowExit(
      ['doctor', 'workspace', '--workspace', root, '--json', '--plan'],
      [1, 2]
    );
    await runTopLevelCommandAllowExit(['doctor', '--json'], [1]);
    process.chdir(path.join(root, 'api'));
    await runTopLevelCommandAllowExit(['doctor', 'project', '--json'], [1]);
    process.chdir(root);
    await runTopLevelCommandExpectExit(['shell', 'unknown'], 1);
    await runTopLevelCommandExpectExit(['shell', 'activate'], 1);

    const venvActivate = path.join(root, '.venv', 'bin', 'activate');
    await fs.mkdir(path.dirname(venvActivate), { recursive: true });
    await fs.writeFile(venvActivate, '# fixture\n');
    await runTopLevelCommand(['shell', 'activate']);
  }, 60_000);

  it('executes top-level snapshot, project lifecycle, and validation callbacks', async () => {
    await runTopLevelCommand([
      'snapshot',
      'create',
      'coverage-snapshot',
      '--workspace',
      root,
      '--json',
    ]);
    await runTopLevelCommand(['snapshot', 'list', '--workspace', root, '--json']);
    await runTopLevelCommand(['snapshot', 'list', '--workspace', root]);
    await runTopLevelCommand([
      'snapshot',
      'inspect',
      'coverage-snapshot',
      '--workspace',
      root,
      '--json',
    ]);
    await runTopLevelCommand(['snapshot', 'inspect', 'coverage-snapshot', '--workspace', root]);
    await runTopLevelCommand([
      'snapshot',
      'restore',
      'coverage-snapshot',
      '--workspace',
      root,
      '--dry-run',
      '--json',
    ]);
    await runTopLevelCommand([
      'snapshot',
      'restore',
      'coverage-snapshot',
      '--workspace',
      root,
      '--dry-run',
    ]);

    await runTopLevelCommand(['project', 'commands', '--json']);
    await runTopLevelCommand(['project', 'archives', '--workspace', root, '--json']);
    await runTopLevelCommand(['project', 'archives', '--workspace', root]);
    await runTopLevelCommand([
      'project',
      'archive',
      'api',
      '--workspace',
      root,
      '--dry-run',
      '--json',
    ]);
    await runTopLevelCommand(['project', 'archive', 'api', '--workspace', root, '--dry-run']);
    await runTopLevelCommand([
      'project',
      'delete',
      'api',
      '--workspace',
      root,
      '--dry-run',
      '--json',
    ]);
    await runTopLevelCommand(['project', 'delete', 'api', '--workspace', root, '--dry-run']);

    await runTopLevelCommandExpectExit(['doctor', 'invalid'], 1);
    await runTopLevelCommandExpectExit(['doctor', '--plan', '--fix'], 1);
    await runTopLevelCommandExpectExit(['doctor', '--profile', 'invalid'], 1);
    await runTopLevelCommandExpectExit(
      ['project', 'restore', 'missing-archive', '--workspace', root, '--json'],
      1
    );
    await runTopLevelCommandExpectExit(
      ['snapshot', 'inspect', 'missing-snapshot', '--workspace', root],
      1
    );
    await runTopLevelCommandExpectExit(['autopilot', 'invalid'], 1);
    await runTopLevelCommandExpectExit(['autopilot', 'release', '--mode', 'invalid'], 1);
    await runTopLevelCommandExpectExit(['pipeline', '--autopilot-mode', 'invalid'], 1);
  }, 60_000);

  it('covers deterministic CLI routing and policy parsers at their boundaries', () => {
    expect(normalizeFallbackTemplate(' fastapi.enterprise ')).toBe('fastapi');
    expect(normalizeFallbackTemplate('NESTJS.standard')).toBe('nestjs');
    expect(normalizeFallbackTemplate('')).toBeNull();
    expect(normalizeFallbackTemplate('springboot')).toBeNull();

    expect(isNpmOnlyParseDirectCommand('workspace')).toBe(true);
    expect(isNpmOnlyParseDirectCommand(undefined)).toBe(false);
    expect(isNpmOnlyParseDirectInvocation(['project', '--help'])).toBe(true);
    expect(isNpmOnlyParseDirectInvocation(['not-owned'])).toBe(false);
    expect(isNpmOnlyManualHandlerCommand('cache')).toBe(true);
    expect(isNpmOnlyManualHandlerCommand('workspace')).toBe(false);

    const baseline = defaultWorkspacePolicyYaml();
    expect(replaceOrInsertTopLevelPolicyLine(baseline, 'mode', 'strict')).toContain('mode: strict');
    expect(replaceOrInsertTopLevelPolicyLine('rules:\n', 'mode', 'warn')).toBe(
      'mode: warn\nrules:'
    );
    expect(replaceOrInsertTopLevelPolicyLine('version: "1"', 'mode', 'warn')).toContain(
      'mode: warn'
    );
    expect(replaceOrInsertRulePolicyLine(baseline, 'enforce_toolchain_lock', true)).toContain(
      'enforce_toolchain_lock: true'
    );
    expect(replaceOrInsertRulePolicyLine('rules:\n', 'enforce_toolchain_lock', true)).toContain(
      '  enforce_toolchain_lock: true'
    );
    expect(replaceOrInsertRulePolicyLine('mode: warn', 'enforce_toolchain_lock', false)).toContain(
      'rules:\n  enforce_toolchain_lock: false'
    );

    expect(parsePolicyBooleanLiteral(' ON ')).toBe(true);
    expect(parsePolicyBooleanLiteral('0')).toBe(false);
    expect(parsePolicyBooleanLiteral('maybe')).toBeNull();
    expect(parseNodeEvalScript('node -e "console.log(\\"ok\\")"')).toBe('console.log("ok")');
    expect(parseNodeEvalScript("node --eval 'console.log(\\'ok\\')'")).toBe("console.log('ok')");
    expect(parseNodeEvalScript('npm test')).toBeNull();
    expect(
      parseCacheConfig(
        'strategy: "isolated"\nprune_on_bootstrap: true\nself_heal: false\nverify_integrity: true\n'
      )
    ).toEqual({
      strategy: 'isolated',
      prune_on_bootstrap: true,
      self_heal: false,
      verify_integrity: true,
    });
  });

  it('covers CLI identity, flag, worker, bridge, environment, and runtime inference boundaries', async () => {
    expect(resolveInvokedCliName(['node', '/bin/rapidkit.cmd'])).toBe('rapidkit');
    expect(resolveInvokedCliName(['node', '/bin/rapidkit-npm.ps1'])).toBe('rapidkit');
    expect(resolveInvokedCliName(['node', '/bin/workspai.js'])).toBe('workspai');
    expect(readFlagValue(['--port', '8080'], '--port')).toBe('8080');
    expect(readFlagValue(['--port=9090'], '--port')).toBe('9090');
    expect(readFlagValue(['--port'], '--port')).toBeUndefined();
    expect(parseMaxWorkersOption(undefined)).toBeUndefined();
    expect(parseMaxWorkersOption('  ')).toBeUndefined();
    expect(parseMaxWorkersOption('1')).toBe(1);
    expect(parseMaxWorkersOption('16')).toBe(16);
    for (const invalid of ['x', '0', '17', '1.5', '999999999999999999999']) {
      expect(() => parseMaxWorkersOption(invalid)).toThrow('between 1 and 16');
    }
    expect(bridgeFailureCode(null)).toBeNull();
    expect(bridgeFailureCode({ code: 'PYTHON_NOT_FOUND' })).toBe('PYTHON_NOT_FOUND');
    expect(bridgeFailureCode({ code: 'BRIDGE_VENV_BOOTSTRAP_FAILED' })).toBe(
      'BRIDGE_VENV_BOOTSTRAP_FAILED'
    );
    expect(bridgeFailureCode({ code: 'BRIDGE_VENV_CREATE_FAILED' })).toBe(
      'BRIDGE_VENV_CREATE_FAILED'
    );
    expect(bridgeFailureCode({ code: 'BRIDGE_PIP_BOOTSTRAP_FAILED' })).toBe(
      'BRIDGE_PIP_BOOTSTRAP_FAILED'
    );
    expect(bridgeFailureCode({ code: 'OTHER' })).toBeNull();

    const originalPath = process.env.PATH;
    const delegatedKeys = [
      'POETRY_PYTHON',
      'RAPIDKIT_SKIP_LOCK_SYNC',
      'POETRY_KEYRING_ENABLED',
      'PYTHON_KEYRING_BACKEND',
      'POETRY_NO_INTERACTION',
    ] as const;
    const originalDelegatedEnv = Object.fromEntries(
      delegatedKeys.map((key) => [key, process.env[key]])
    );
    process.env.PATH = ['/tools/bin', '/fixture/.pyenv/shims', '/usr/bin'].join(path.delimiter);
    delete process.env.POETRY_PYTHON;
    delete process.env.RAPIDKIT_SKIP_LOCK_SYNC;
    delete process.env.POETRY_KEYRING_ENABLED;
    delete process.env.PYTHON_KEYRING_BACKEND;
    delete process.env.POETRY_NO_INTERACTION;
    const env = buildDelegationEnvForInit();
    expect(env.PATH).not.toContain('.pyenv/shims');
    expect(env.PYENV_VERSION).toBe('system');
    expect(env.RAPIDKIT_SKIP_LOCK_SYNC).toBe('1');
    expect(env.POETRY_KEYRING_ENABLED).toBe('false');
    expect(env.POETRY_NO_INTERACTION).toBe('1');
    process.env.PATH = originalPath;
    for (const key of delegatedKeys) {
      const value = originalDelegatedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-runtime-inference-'));
    temporaryDirectories.push(runtimeRoot);
    expect(await inferRuntimeByFiles(path.join(runtimeRoot, 'missing'))).toBeNull();
    await fs.writeFile(path.join(runtimeRoot, 'requirements.txt'), 'fastapi\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('python');
    await fs.writeFile(path.join(runtimeRoot, 'package.json'), '{}\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('node');
    await fs.writeFile(path.join(runtimeRoot, 'example.sln'), '\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('dotnet');
    await fs.writeFile(path.join(runtimeRoot, 'pom.xml'), '<project/>\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('java');
    await fs.writeFile(path.join(runtimeRoot, 'go.mod'), 'module example.com/test\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('go');
    await Promise.all(
      ['go.mod', 'pom.xml', 'example.sln', 'package.json', 'requirements.txt'].map((fileName) =>
        fs.rm(path.join(runtimeRoot, fileName), { force: true })
      )
    );
    await fs.writeFile(path.join(runtimeRoot, 'Cargo.toml'), '[package]\nname = "sample"\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('rust');
    await fs.rm(path.join(runtimeRoot, 'Cargo.toml'), { force: true });
    await fs.writeFile(path.join(runtimeRoot, 'composer.json'), '{}\n');
    expect(await inferRuntimeByFiles(runtimeRoot)).toBe('php');
  });

  it('executes Python venv and pip fallback orchestration against deterministic tool shims', async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-python-orchestration-'));
    temporaryDirectories.push(fixture);
    const project = path.join(fixture, 'project');
    await fs.mkdir(project, { recursive: true });
    let poetryAvailable = false;
    const runCommand = vi.fn(
      async (command: string, args: string[], cwd: string): Promise<number> => {
        if (args.includes('venv')) {
          const interpreter = getVenvPythonPath(path.join(cwd, '.venv'));
          await fs.mkdir(path.dirname(interpreter), { recursive: true });
          await fs.writeFile(interpreter, 'deterministic test interpreter');
          return 0;
        }
        if (command === 'poetry' && args[0] === '--version') {
          return poetryAvailable ? 0 : 1;
        }
        return 0;
      }
    );
    const dependencies = { runCommand, pythonCandidates: ['fixture-python'] };

    expect(hostPythonCandidates().length).toBeGreaterThan(0);
    expect(await commandAvailable(process.execPath, project)).toBe(true);
    expect(await commandAvailable('missing-workspai-command', project)).toBe(false);
    expect(await createWorkspaceVenv(project, dependencies)).toBe(0);
    await fs.rm(path.join(project, '.venv'), { recursive: true, force: true });
    expect(await createProjectVenv(project, dependencies)).toBe(0);
    expect(await ensurePythonProjectUsesLocalVenv(project, dependencies)).toBe(0);

    await fs.writeFile(path.join(project, 'requirements.txt'), 'fixture==1.0\n');
    expect(await installPythonDependenciesWithPipFallback(project, dependencies)).toBe(0);
    await fs.rm(path.join(project, 'requirements.txt'));
    await fs.writeFile(path.join(project, 'pyproject.toml'), '[project]\nname="fixture"\n');
    expect(await installPythonDependenciesWithPipFallback(project, dependencies)).toBe(0);

    poetryAvailable = true;
    expect(await ensurePythonProjectUsesLocalVenv(project, dependencies)).toBe(0);
    expect(runCommand).toHaveBeenCalledWith(
      'poetry',
      ['env', 'use', getVenvPythonPath(path.join(project, '.venv'))],
      project
    );
  }, 30_000);

  it('covers npm ownership and upward workspace discovery routing', async () => {
    for (const command of ['workspace', 'doctor', 'snapshot', 'commands']) {
      expect(isNpmOnlyTopLevelCommand(command)).toBe(true);
      expect(isNpmOnlyInvocation([command])).toBe(true);
    }
    expect(isNpmOnlyTopLevelCommand(undefined)).toBe(false);
    expect(isNpmOnlyTopLevelCommand('unknown')).toBe(false);
    expect(isNpmOnlyScopedCommand(['project'])).toBe(true);
    expect(isNpmOnlyScopedCommand(['project', '--help'])).toBe(true);
    expect(isNpmOnlyScopedCommand(['project', 'help'])).toBe(true);
    expect(isNpmOnlyScopedCommand(['project', 'unknown'])).toBe(false);
    expect(isNpmOnlyInvocation(['unknown'])).toBe(false);

    const discoveryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-discovery-routing-'));
    temporaryDirectories.push(discoveryRoot);
    const nested = path.join(discoveryRoot, 'a', 'b');
    await fs.mkdir(path.join(discoveryRoot, '.workspai'), { recursive: true });
    await fs.mkdir(path.join(nested, '.workspai'), { recursive: true });
    await fs.writeFile(path.join(discoveryRoot, '.workspai-workspace'), '{}\n');
    await fs.writeFile(path.join(nested, '.workspai', 'context.json'), '{}\n');
    expect(hasWorkspaceRootMarkers(discoveryRoot)).toBe(true);
    expect(hasWorkspaceRootMarkers(nested)).toBe(false);
    expect(findWorkspaceUp(nested)).toBe(discoveryRoot);
    expect(findWorkspaceMarkerUp(nested)).toBe(path.join(discoveryRoot, '.workspai-workspace'));
    expect(findContextFileUp(nested)).toBe(path.join(nested, '.workspai', 'context.json'));
    const missing = path.join(os.tmpdir(), 'definitely-missing-workspai');
    expect(findWorkspaceUp(missing)).toBeNull();
    expect(findContextFileUp(missing)).toBeNull();

    const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-legacy-routing-'));
    temporaryDirectories.push(legacyRoot);
    const legacyNested = path.join(legacyRoot, 'nested');
    await fs.mkdir(path.join(legacyRoot, '.rapidkit'), { recursive: true });
    await fs.mkdir(legacyNested);
    await fs.writeFile(path.join(legacyRoot, '.rapidkit', 'workspace.json'), '{}\n');
    expect(findLegacyWorkspaceUp(legacyNested)).toBe(legacyRoot);
    await fs.writeFile(path.join(legacyRoot, '.rapidkit-workspace'), '{}\n');
    expect(findLegacyWorkspaceUp(legacyNested)).toBeNull();
  });

  it('covers subprocess success, failure, stderr capture, and timeout cleanup', async () => {
    expect(await runCommandInCwd('sh', ['-c', 'printf success'], root)).toBe(0);
    expect(await runCommandInCwd('sh', ['-c', 'printf failure >&2; exit 7'], root)).toBe(7);
    expect(await runCommandInCwd('definitely-missing-workspai-command', [], root)).toBe(1);
    expect(
      await runCommandInCwd('sh', ['-c', 'while :; do :; done'], root, { timeoutMs: 20 })
    ).toBe(124);
  }, 10_000);

  it('creates both standalone project template families through the workspace API', async () => {
    const fastapiPath = path.join(root, 'standalone-fastapi');
    const nestPath = path.join(root, 'standalone-nest');

    await createStandaloneProject(fastapiPath, {
      name: 'Standalone_FastAPI',
      template: 'fastapi',
      author: 'Coverage',
      skipGit: true,
      skipInstall: true,
    });
    await createStandaloneProject(nestPath, {
      name: 'Standalone_Nest',
      template: 'nestjs',
      author: 'Coverage',
      package_manager: 'npm',
      skipGit: true,
      skipInstall: true,
    });

    await expect(fs.access(path.join(fastapiPath, 'pyproject.toml'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(nestPath, 'package.json'))).resolves.toBeUndefined();
  });

  it('registers and renders workspace registry state in JSON and human formats', async () => {
    await registerWorkspaceStrict(root, 'coverage-workspace');
    await listWorkspaces({ json: true });
    await listWorkspaces();

    const missingWorkspace = path.join(root, 'removed-workspace');
    await fs.mkdir(missingWorkspace, { recursive: true });
    await registerWorkspaceStrict(missingWorkspace, 'removed-workspace');
    await fs.rm(missingWorkspace, { recursive: true, force: true });
    await listWorkspaces({ json: true });
    await listWorkspaces();

    expect(logSpy).toHaveBeenCalled();
  });

  it('creates a complete standalone workspace through the workspace API', async () => {
    const workspacePath = path.join(root, 'standalone-workspace');
    await createWorkspace(workspacePath, {
      name: 'standalone-workspace',
      author: 'Coverage',
      skipGit: true,
    });

    for (const relativePath of [
      '.workspai/config.json',
      '.workspai/workspace.json',
      '.workspai/policies.yml',
      'rapidkit',
      'rapidkit.cmd',
      'README.md',
    ]) {
      await expect(fs.access(path.join(workspacePath, relativePath))).resolves.toBeUndefined();
    }
  });

  it('executes manual command handlers across help, status, and validation paths', async () => {
    await expect(handleCreateOrFallback(['create', '--help'])).resolves.toBe(0);
    await expect(handleCreateOrFallback(['create', 'project', '--help'])).resolves.toBe(0);
    await expect(handleCreateOrFallback(['create', 'workspace', '--help'])).resolves.toBe(0);
    await expect(
      handleCreateOrFallback([
        'create',
        'project',
        'fastapi.standard',
        'dry-run-api',
        '--output',
        root,
        '--dry-run',
      ])
    ).resolves.toBe(0);
    for (const [kit, name] of [
      ['gofiber.standard', 'direct-fiber'],
      ['gogin.standard', 'direct-gin'],
      ['springboot.standard', 'direct-spring'],
      ['dotnet.webapi.clean', 'direct-dotnet'],
    ]) {
      await expect(
        handleCreateOrFallback([
          'create',
          'project',
          kit,
          name,
          '--output',
          root,
          '--skip-git',
          '--skip-install',
          '--no-workspace',
          '--yes',
        ])
      ).resolves.toBe(0);
    }
    await expect(handleBootstrapCommand(['bootstrap', '--help'])).resolves.toBe(0);
    await expect(handleBootstrapCommand(['bootstrap', '--profile', 'invalid'])).resolves.toBe(1);
    for (const profile of [
      'minimal',
      'python-only',
      'node-only',
      'go-only',
      'java-only',
      'dotnet-only',
      'polyglot',
      'enterprise',
    ]) {
      await expect(
        handleBootstrapCommand(['bootstrap', '--profile', profile, '--compliance-only', '--json'])
      ).resolves.toBeTypeOf('number');
    }
    await expect(
      handleBootstrapCommand(['bootstrap', '--profile=minimal', '--json'], async () => 0)
    ).resolves.toBeTypeOf('number');
    await expect(
      handleBootstrapCommand(['bootstrap', '--profile=enterprise', '--json'], async () => 0)
    ).resolves.toBeTypeOf('number');
    await expect(
      handleBootstrapCommand(['bootstrap', '--profile=minimal', '--compliance-only'], async () => 0)
    ).resolves.toBeTypeOf('number');
    const setupRunner = async () => 0;
    await expect(handleSetupCommand(['setup', '--help'], setupRunner)).resolves.toBe(0);
    await expect(handleSetupCommand(['setup', 'unknown'], setupRunner)).resolves.toBe(1);
    await expect(handleSetupCommand(['setup', 'node', '--json'], setupRunner)).resolves.toBeTypeOf(
      'number'
    );
    await expect(handleSetupCommand(['setup', 'go', '--json'], setupRunner)).resolves.toBeTypeOf(
      'number'
    );
    await expect(handleSetupCommand(['setup', 'java', '--json'], setupRunner)).resolves.toBeTypeOf(
      'number'
    );
    await expect(
      handleSetupCommand(['setup', 'dotnet', '--json'], setupRunner)
    ).resolves.toBeTypeOf('number');
    await expect(handleSetupCommand(['setup', 'node'], setupRunner)).resolves.toBeTypeOf('number');
    await expect(handleSetupCommand(['setup', 'go'], setupRunner)).resolves.toBeTypeOf('number');
    await expect(handleSetupCommand(['setup', 'java'], setupRunner)).resolves.toBeTypeOf('number');
    await expect(handleSetupCommand(['setup', 'dotnet'], setupRunner)).resolves.toBeTypeOf(
      'number'
    );
    await expect(
      handleSetupCommand(['setup', 'node', '--json', '--warm-deps'], setupRunner)
    ).resolves.toBeTypeOf('number');
    await expect(
      handleSetupCommand(['setup', 'go', '--json', '--warm-deps'], setupRunner)
    ).resolves.toBeTypeOf('number');
    await expect(
      handleSetupCommand(['setup', 'java', '--json', '--warm-deps'], setupRunner)
    ).resolves.toBeTypeOf('number');
    await expect(
      handleSetupCommand(['setup', 'dotnet', '--json', '--warm-deps'], setupRunner)
    ).resolves.toBeTypeOf('number');
    process.chdir(path.join(root, 'api'));
    await expect(
      handleSetupCommand(['setup', 'node', '--json', '--warm-deps'], setupRunner)
    ).resolves.toBeTypeOf('number');
    await expect(handleInitCommand(['init'])).resolves.toBe(0);
    process.chdir(root);

    await expect(handleCacheCommand(['cache', '--help'])).resolves.toBe(0);
    await expect(handleCacheCommand(['cache', 'status', '--json'])).resolves.toBe(0);
    await expect(handleCacheCommand(['cache', 'status'])).resolves.toBe(0);
    await expect(handleCacheCommand(['cache', 'unknown'])).resolves.toBe(1);

    await expect(handleMirrorCommand(['mirror', '--help'])).resolves.toBe(0);
    await expect(handleMirrorCommand(['mirror', 'status', '--json'])).resolves.toBe(0);
    await expect(handleMirrorCommand(['mirror', 'status'])).resolves.toBe(0);
    await expect(handleMirrorCommand(['mirror', 'unknown'])).resolves.toBe(1);
  }, 60_000);

  it('runs executable bootstrap routing for help and version contracts', async () => {
    const stdoutTty = process.stdout.isTTY;
    const stderrTty = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
    try {
      process.argv = ['node', 'workspai', '--help'];
      await expect(bootstrapCli()).rejects.toThrow('process.exit unexpectedly called with "0"');

      process.argv = ['node', 'workspai', '--version', '--json'];
      await expect(bootstrapCli()).rejects.toThrow('process.exit unexpectedly called with "0"');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: stdoutTty,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        configurable: true,
        value: stderrTty,
      });
      process.argv = ['node', 'workspai'];
    }
  });

  it('materializes workspace foundations for every runtime policy family', async () => {
    for (const profile of [
      'minimal',
      'python-only',
      'node-only',
      'go-only',
      'java-only',
      'dotnet-only',
      'polyglot',
      'enterprise',
    ]) {
      const workspacePath = path.join(root, `foundation-${profile}`);
      await fs.mkdir(workspacePath, { recursive: true });
      const written = await syncWorkspaceFoundationFiles(workspacePath, {
        workspaceName: `foundation-${profile}`,
        installMethod: profile === 'python-only' ? 'poetry' : 'venv',
        pythonVersion: '3.10',
        profile,
        writeMarker: true,
        writeGitignore: true,
        onlyIfMissing: false,
      });
      expect(written.length).toBeGreaterThan(0);
      await expect(
        fs.access(path.join(workspacePath, '.workspai', 'workspace.json'))
      ).resolves.toBeUndefined();
    }
  });

  it('executes doctor remediation apply mode directly against the fixture', async () => {
    // Use an isolated fixture. The suite's shared root intentionally accumulates
    // generated projects from earlier coverage scenarios; applying remediation
    // to that ever-growing root makes this test order-dependent and can launch
    // dozens of unrelated package-manager fixes under full-suite coverage.
    const doctorRoot = await createWorkspaceFixture();
    await fs.rm(path.join(doctorRoot, 'api'), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    const code = await runDoctor({ workspace: doctorRoot, json: true, apply: true, quiet: true });
    expect([0, 1, 2]).toContain(code);
  }, 60_000);

  it('enforces strict delegation policy for missing, invalid, incompatible, and valid locks', async () => {
    const policyPath = path.join(root, '.workspai', 'policies.yml');
    const lockPath = path.join(root, '.workspai', 'toolchain.lock');
    const manifestPath = path.join(root, '.workspai', 'workspace.json');
    const projectPath = path.join(root, 'api');

    await fs.writeFile(policyPath, 'mode: warn\n');
    await expect(checkStrictPolicyPreflightForDelegation(projectPath)).resolves.toEqual([]);

    await fs.writeFile(policyPath, 'mode: strict\n');
    await fs.rm(lockPath, { force: true });
    expect(await checkStrictPolicyPreflightForDelegation(projectPath)).toContain(
      'toolchain.lock is missing — run `workspai bootstrap` first (strict mode requires a reproducible toolchain).'
    );

    await fs.writeFile(lockPath, '{invalid');
    expect((await checkStrictPolicyPreflightForDelegation(projectPath))[0]).toContain(
      'toolchain.lock is invalid JSON'
    );

    await fs.writeFile(lockPath, `${JSON.stringify({ runtime: {} }, null, 2)}\n`);
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({ profile: 'python-only', workspace_name: 'coverage-workspace' }, null, 2)}\n`
    );
    const incompatible = await checkStrictPolicyPreflightForDelegation(projectPath);
    expect(incompatible.some((message) => message.includes('node.version'))).toBe(true);
    expect(incompatible.some((message) => message.includes('profile'))).toBe(true);

    await fs.writeFile(
      lockPath,
      `${JSON.stringify({ runtime: { node: { version: process.version } } }, null, 2)}\n`
    );
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({ profile: 'polyglot', workspace_name: 'coverage-workspace' }, null, 2)}\n`
    );
    await expect(checkStrictPolicyPreflightForDelegation(projectPath)).resolves.toEqual([]);
  });

  it('executes offline create fallback validation and both embedded generators', async () => {
    await expect(runCreateFallback(['create', '--json'], 'PYTHON_NOT_FOUND')).resolves.toBe(1);
    await expect(runCreateFallback(['other'], 'PYTHON_NOT_FOUND')).resolves.toBe(1);
    await expect(runCreateFallback(['create', 'workspace'], 'PYTHON_NOT_FOUND')).resolves.toBe(1);
    await expect(runCreateFallback(['create', 'project'], 'PYTHON_NOT_FOUND')).resolves.toBe(1);
    await expect(
      runCreateFallback(
        ['create', 'project', 'springboot.standard', 'unsupported'],
        'PYTHON_NOT_FOUND'
      )
    ).resolves.toBe(1);

    for (const [kit, name] of [
      ['fastapi.standard', 'fallback-fastapi'],
      ['nestjs.standard', 'fallback-nest'],
    ]) {
      await expect(
        runCreateFallback(
          [
            'create',
            'project',
            kit,
            name,
            '--output',
            root,
            '--skip-git',
            '--skip-install',
            '--no-workspace',
          ],
          'PYTHON_NOT_FOUND'
        )
      ).resolves.toBe(0);
      await expect(fs.access(path.join(root, name))).resolves.toBeUndefined();
      await expect(
        runCreateFallback(['create', 'project', kit, name, '--output', root], 'PYTHON_NOT_FOUND')
      ).resolves.toBe(1);
    }

    await expect(
      runCreateFallback(
        [
          'create',
          'project',
          'fastapi.standard',
          'fallback-managed',
          '--output',
          root,
          '--skip-git',
          '--skip-install',
          '--yes',
        ],
        'PYTHON_NOT_FOUND'
      )
    ).resolves.toBe(0);
    await expect(
      fs.access(path.join(root, 'fallback-managed', '.workspai', 'project.json'))
    ).resolves.toBeUndefined();
  });

  it('validates every npm-backed kit option contract', () => {
    const invalidCases: Array<[string, string[], string]> = [
      ['gofiber.standard', ['--port', 'abc'], 'Invalid --port'],
      ['springboot.standard', ['--java-version', 'latest'], 'Invalid --java-version'],
      ['springboot.standard', ['--spring-boot-version', 'latest'], 'Invalid --spring-boot-version'],
      ['springboot.standard', ['--springdoc-version', 'latest'], 'Invalid --springdoc-version'],
      ['springboot.standard', ['--group-id', 'bad/group'], 'Invalid --group-id'],
      ['springboot.standard', ['--package-name', 'bad/package'], 'Invalid --package-name'],
      ['dotnet.webapi.clean', ['--target-framework', '8'], 'Invalid --target-framework'],
      ['dotnet.webapi.clean', ['--root-namespace', 'bad-name'], 'Invalid --root-namespace'],
    ];
    for (const [kit, args, message] of invalidCases) {
      expect(validateNpmKitFlags(kit, args)).toContain(message);
    }
    expect(
      validateNpmKitFlags('springboot.standard', [
        '--port',
        '8080',
        '--java-version',
        '21',
        '--spring-boot-version',
        '3.5.0',
        '--springdoc-version',
        '2.8.9',
        '--group-id',
        'com.example',
        '--package-name',
        'com.example.api',
      ])
    ).toBeNull();
    expect(
      validateNpmKitFlags('dotnet.webapi.clean', [
        '--target-framework',
        'net8.0',
        '--root-namespace',
        'Example.Api',
      ])
    ).toBeNull();
  });

  it('executes every Node lifecycle action through the wrapper adapter', async () => {
    const projectPath = path.join(root, 'api');
    await fs.writeFile(
      path.join(projectPath, 'package.json'),
      `${JSON.stringify(
        {
          name: 'api',
          version: '1.0.0',
          scripts: Object.fromEntries(
            ['dev', 'test', 'build', 'start', 'lint', 'format'].map((name) => [
              name,
              'node -e "void 0"',
            ])
          ),
        },
        null,
        2
      )}\n`
    );
    const results: number[] = [];
    for (const action of ['dev', 'test', 'build', 'start', 'lint', 'format'] as const) {
      results.push(await handleNodeCommand(action, projectPath));
    }
    expect(results.every((code) => Number.isInteger(code))).toBe(true);
    expect(results.every((code) => code === 0 || code === 1)).toBe(true);
  }, 60_000);

  it('executes recoverable import, adopt, snapshot, archive, restore, and delete lifecycles', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-import-source-'));
    temporaryDirectories.push(sourceRoot);
    await fs.mkdir(path.join(sourceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, 'package.json'),
      `${JSON.stringify({ name: 'import-source', version: '1.0.0' }, null, 2)}\n`
    );
    await fs.writeFile(path.join(sourceRoot, 'src', 'index.js'), 'export const imported = true;\n');

    await runTopLevelCommand([
      'adopt',
      sourceRoot,
      '--workspace',
      root,
      '--name',
      'adopt-preview',
      '--dry-run',
      '--json',
    ]);
    await runTopLevelCommand([
      'import',
      sourceRoot,
      '--workspace',
      root,
      '--name',
      'imported-app',
      '--json',
    ]);
    await expect(fs.stat(path.join(root, 'imported-app', 'package.json'))).resolves.toBeDefined();

    await fs.writeFile(path.join(root, 'lifecycle.txt'), 'before\n');
    await runTopLevelCommand([
      'snapshot',
      'create',
      'recoverable-state',
      '--workspace',
      root,
      '--reason',
      'coverage lifecycle',
      '--include-projects',
    ]);
    await fs.writeFile(path.join(root, 'lifecycle.txt'), 'after\n');
    process.chdir(os.tmpdir());
    await runTopLevelCommand([
      'snapshot',
      'restore',
      'recoverable-state',
      '--workspace',
      root,
      '--reason',
      'coverage restore',
      '--force',
    ]);
    process.chdir(root);

    await runTopLevelCommand([
      'project',
      'archive',
      'imported-app',
      '--workspace',
      root,
      '--reason',
      'coverage archive',
      '--json',
    ]);
    const archiveEntries = await fs.readdir(path.join(root, '.workspai', 'archive', 'projects'));
    const archiveName = archiveEntries.find((entry) => entry.includes('imported-app'));
    expect(archiveName).toBeTruthy();
    await runTopLevelCommand(['project', 'restore', archiveName!, '--workspace', root, '--force']);
    await runTopLevelCommand([
      'project',
      'delete',
      'imported-app',
      '--workspace',
      root,
      '--reason',
      'coverage delete',
      '--json',
    ]);
    await expect(fs.stat(path.join(root, 'imported-app'))).rejects.toThrow();
  }, 60_000);

  it('copies a finalized evaluation to the requested output and reports that path', async () => {
    await runWorkspaceCommand(root, [
      'eval',
      'init',
      'custom-output-contract',
      'workspace-intelligence',
      '--json',
    ]);
    const relativeOutput = '.workspai/reports/custom-evaluation.json';
    logSpy.mockClear();

    await runWorkspaceCommand(root, ['eval', 'report', '--output', relativeOutput, '--json']);

    const expectedOutput = path.join(root, relativeOutput);
    await expect(fs.stat(expectedOutput)).resolves.toBeDefined();
    const jsonOutput = logSpy.mock.calls
      .map(([value]) => String(value))
      .find((value) => value.includes('"operation": "workspace eval report"'));
    expect(jsonOutput).toBeTruthy();
    const payload = JSON.parse(jsonOutput!) as { outputPath?: unknown };
    expect(payload.outputPath).toEqual(expect.any(String));

    // Windows may expose the same temp directory through both its long name
    // (RunnerAdmin) and its 8.3 alias (RUNNER~1). String normalization cannot
    // make those representations equal, so assert the actual filesystem
    // identity promised by this contract.
    const [reportedStat, expectedStat] = await Promise.all([
      fs.stat(payload.outputPath as string, { bigint: true }),
      fs.stat(expectedOutput, { bigint: true }),
    ]);
    expect({ dev: reportedStat.dev, ino: reportedStat.ino }).toEqual({
      dev: expectedStat.dev,
      ino: expectedStat.ino,
    });
  });

  it('audits a heterogeneous enterprise workspace across every supported runtime', async () => {
    const fixtures = [
      {
        name: 'python-service',
        runtime: 'python',
        framework: 'fastapi',
        files: {
          'pyproject.toml': '[project]\nname = "python-service"\nversion = "1.0.0"\n',
          'requirements.txt': 'fastapi>=0.100\n',
          'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
        },
      },
      {
        name: 'go-service',
        runtime: 'go',
        framework: 'fiber',
        files: {
          'go.mod': 'module example.com/go-service\n\ngo 1.22\n',
          'main.go': 'package main\nfunc main() {}\n',
        },
      },
      {
        name: 'java-service',
        runtime: 'java',
        framework: 'springboot',
        files: {
          'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>\n',
          'src/main/java/App.java': 'class App {}\n',
        },
      },
      {
        name: 'dotnet-service',
        runtime: 'dotnet',
        framework: 'aspnetcore',
        files: {
          'dotnet-service.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n',
          'Program.cs': 'var builder = WebApplication.CreateBuilder(args);\n',
        },
      },
    ] as const;

    for (const fixture of fixtures) {
      const projectRoot = path.join(root, fixture.name);
      await fs.mkdir(path.join(projectRoot, '.workspai'), { recursive: true });
      await fs.writeFile(
        path.join(projectRoot, '.workspai', 'project.json'),
        `${JSON.stringify(
          {
            schema_version: '1.0',
            name: fixture.name,
            runtime: fixture.runtime,
            framework: fixture.framework,
            relationship: 'managed',
          },
          null,
          2
        )}\n`
      );
      for (const [relativePath, content] of Object.entries(fixture.files)) {
        const target = path.join(projectRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }
      await fs.writeFile(path.join(projectRoot, '.env.example'), 'PORT=8080\n');
      await fs.writeFile(path.join(projectRoot, 'Dockerfile'), 'FROM scratch\n');
    }

    for (const profile of ['local', 'ci', 'release', 'enterprise-strict']) {
      const exitCode = await runDoctor({ workspace: root, json: true, profile });
      expect([0, 1, 2]).toContain(exitCode);
    }
    const planCode = await runDoctor({ workspace: root, json: true, plan: true });
    expect([0, 1, 2]).toContain(planCode);

    const javaRoot = path.join(root, 'java-service');
    const mavenWrapper = path.join(javaRoot, 'mvnw');
    await fs.writeFile(mavenWrapper, '#!/bin/sh\nexit 0\n');
    await fs.chmod(mavenWrapper, 0o755);
    await fs.writeFile(
      path.join(javaRoot, 'pom.xml'),
      '<project><build><plugins><plugin>spotless-maven-plugin</plugin></plugins></build></project>\n'
    );
    const javaResults: number[] = [];
    for (const action of ['init', 'dev', 'test', 'build', 'start', 'lint', 'format'] as const) {
      javaResults.push(await handleJavaCommand(action, javaRoot));
    }
    expect(javaResults.every((code) => code === 0 || code === 1)).toBe(true);

    expect([0, 1]).toContain(await handleGoInit(path.join(root, 'go-service')));
  }, 60_000);
});
