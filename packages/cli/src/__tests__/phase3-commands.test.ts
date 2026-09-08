import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import { createHash, createSign, generateKeyPairSync } from 'crypto';
import { createServer } from 'http';
import type { AddressInfo } from 'net';

const adapterCheckPrereqs = vi.fn();
const adapterDoctorHints = vi.fn();
const getRuntimeAdapterMock = vi.fn();
const areRuntimeAdaptersEnabledMock = vi.fn();
const cacheClearMock = vi.fn();
const PHASE3_COMMAND_TIMEOUT_MS = process.platform === 'win32' ? 60_000 : 15_000;

vi.mock('../runtime-adapters/index.js', () => ({
  getRuntimeAdapter: getRuntimeAdapterMock,
  areRuntimeAdaptersEnabled: areRuntimeAdaptersEnabledMock,
}));

vi.mock('../utils/cache.js', () => ({
  Cache: {
    getInstance: vi.fn(() => ({
      clear: cacheClearMock,
    })),
  },
}));

describe('Phase 3 command contract handlers', () => {
  let originalCwd = process.cwd();

  const cleanupWorkspaceDir = async (workspaceRoot: string): Promise<void> => {
    const cwd = process.cwd();
    if (cwd === workspaceRoot || cwd.startsWith(`${workspaceRoot}${path.sep}`)) {
      process.chdir(originalCwd);
    }
    await rm(workspaceRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    vi.resetModules();
    vi.clearAllMocks();

    areRuntimeAdaptersEnabledMock.mockReturnValue(false);
    getRuntimeAdapterMock.mockReturnValue({
      checkPrereqs: adapterCheckPrereqs,
      doctorHints: adapterDoctorHints,
    });

    adapterCheckPrereqs.mockResolvedValue({ exitCode: 0 });
    adapterDoctorHints.mockResolvedValue([]);
    cacheClearMock.mockResolvedValue(undefined);

    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    delete process.env.RAPIDKIT_ENABLE_RUNTIME_ADAPTERS;
    delete process.env.RAPIDKIT_BOOTSTRAP_CI;
    delete process.env.RAPIDKIT_OFFLINE_MODE;
    delete process.env.RAPIDKIT_SIGSTORE_MOCK;
    delete process.env.RAPIDKIT_ENV;
  });

  describe('bootstrap', { timeout: PHASE3_COMMAND_TIMEOUT_MS }, () => {
    let stdinIsTty: PropertyDescriptor | undefined;
    let stdoutIsTty: PropertyDescriptor | undefined;

    beforeEach(() => {
      stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        get: () => false,
      });
    });

    afterEach(() => {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
      if (stdoutIsTty) {
        Object.defineProperty(process.stdout, 'isTTY', stdoutIsTty);
      } else {
        delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
      }
    });

    it('renders help without invoking workspace initialization', async () => {
      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);

      const code = await index.handleBootstrapCommand(['bootstrap', '--help'], initRunner);

      expect(code).toBe(0);
      expect(initRunner).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Usage: workspai bootstrap')
      );
    });

    it('never invokes runtime initialization in compliance-only mode', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-compliance-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'enterprise' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        ['version: "1.0"', 'mode: warn', 'rules:', '  enforce_workspace_marker: true', ''].join(
          '\n'
        ),
        'utf-8'
      );
      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);

      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=enterprise', '--compliance-only'],
        initRunner
      );

      expect(code).toBe(1);
      expect(initRunner).not.toHaveBeenCalled();
      const report = (await fsExtra.readJson(
        path.join(workspaiDir, 'reports', 'bootstrap-compliance.latest.json')
      )) as {
        complianceOnly?: boolean;
        checks?: Array<{ id: string; status: string }>;
      };
      expect(report.complianceOnly).toBe(true);
      expect(report.checks).toContainEqual({
        id: 'profile.enterprise.ci',
        status: 'skipped',
        message: expect.any(String),
      });

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('rewrites bootstrap command to init and preserves trailing args', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-init-args-'));
      const projectDir = path.join(workspaceRoot, 'apps', 'api');
      await mkdir(path.join(projectDir, '.workspai'), { recursive: true });
      await writeFile(path.join(projectDir, 'package.json'), '{"name":"api"}', 'utf-8');
      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);

      const code = await index.handleBootstrapCommand(['bootstrap', './apps/api'], initRunner);

      expect(initRunner).toHaveBeenCalledWith(['init', './apps/api']);
      expect(code).toBe(0);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('propagates init runner exit code', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-exit-code-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'minimal' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: warn',
          'rules:',
          '  enforce_workspace_marker: false',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );
      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(1);

      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile', 'minimal'],
        initRunner
      );

      expect(code).toBe(1);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('auto-syncs missing workspace foundation files for legacy workspaces', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-legacy-sync-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'polyglot' }, null, 2),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile', 'polyglot'],
        initRunner
      );

      expect(code).toBe(0);
      expect(initRunner).toHaveBeenCalled();

      const fsExtra = await import('fs-extra');
      await expect(
        fsExtra.pathExists(path.join(workspaceRoot, '.workspai-workspace'))
      ).resolves.toBe(true);
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'toolchain.lock'))).resolves.toBe(
        true
      );
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'policies.yml'))).resolves.toBe(true);
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'cache-config.yml'))).resolves.toBe(
        true
      );

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('auto-heals missing lock in strict mode before running bootstrap', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-strict-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'minimal' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(['bootstrap'], initRunner);

      expect(code).toBe(0);
      expect(initRunner).toHaveBeenCalled();

      const fsExtra = await import('fs-extra');
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'toolchain.lock'))).resolves.toBe(
        true
      );
      const latestReport = path.join(
        workspaceRoot,
        '.workspai',
        'reports',
        'bootstrap-compliance.latest.json'
      );
      await expect(fsExtra.pathExists(latestReport)).resolves.toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('fails fast when dependency_sharing_mode policy value is invalid', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-policy-schema-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'minimal' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: warn',
          'dependency_sharing_mode: super-shared',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(['bootstrap'], initRunner);

      expect(code).toBe(1);
      expect(initRunner).not.toHaveBeenCalled();

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('forwards bootstrap path args and writes compliance report on success', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-report-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'polyglot' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: warn',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', './apps/api', '--ci', '--offline', '--profile=polyglot'],
        initRunner
      );

      expect(code).toBe(1);
      expect(initRunner).toHaveBeenCalledWith(['init', './apps/api']);
      expect(process.env.RAPIDKIT_BOOTSTRAP_CI).toBe('1');
      expect(process.env.RAPIDKIT_OFFLINE_MODE).toBe('1');

      const fsExtra = await import('fs-extra');
      const latestReport = path.join(
        workspaceRoot,
        '.workspai',
        'reports',
        'bootstrap-compliance.latest.json'
      );
      await expect(fsExtra.pathExists(latestReport)).resolves.toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('passes strict java-only bootstrap for Java projects', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-java-only-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const javaProjectDir = path.join(workspaceRoot, 'services', 'orders-api');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(path.join(javaProjectDir, '.workspai'), { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'java-only' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );
      await writeFile(
        path.join(javaProjectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'java', kit_name: 'springboot.standard' }, null, 2),
        'utf-8'
      );
      await writeFile(path.join(javaProjectDir, 'pom.xml'), '<project />', 'utf-8');

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=java-only'],
        initRunner
      );

      expect(code).toBe(0);
      expect(initRunner).toHaveBeenCalledWith(['init']);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('passes strict dotnet-only bootstrap for ASP.NET Core projects', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-dotnet-only-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const dotnetProjectDir = path.join(workspaceRoot, 'services', 'orders-api');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(path.join(dotnetProjectDir, '.workspai'), { recursive: true });
      await mkdir(path.join(dotnetProjectDir, 'src'), { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'dotnet-only' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );
      await writeFile(
        path.join(dotnetProjectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'dotnet', kit_name: 'dotnet.webapi.clean' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(dotnetProjectDir, 'src', 'orders-api.csproj'),
        '<Project />',
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=dotnet-only'],
        initRunner
      );

      expect(code).toBe(0);
      expect(initRunner).toHaveBeenCalledWith(['init']);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('blocks strict java-only bootstrap when non-Java projects are discovered', async () => {
      const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), 'rapidkit-bootstrap-java-only-fail-')
      );
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const nodeProjectDir = path.join(workspaceRoot, 'apps', 'node-api');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(path.join(nodeProjectDir, '.workspai'), { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'java-only' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '',
        ].join('\n'),
        'utf-8'
      );
      await writeFile(
        path.join(nodeProjectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(nodeProjectDir, 'package.json'),
        JSON.stringify({ name: 'node-api' }),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=java-only'],
        initRunner
      );

      expect(code).toBe(1);
      expect(initRunner).not.toHaveBeenCalled();

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('blocks strict offline bootstrap when mirror requirements are missing', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-offline-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'enterprise' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: false',
          '  disallow_untrusted_tool_sources: false',
          '  enforce_compatibility_matrix: false',
          '  require_mirror_lock_for_offline: true',
          '',
        ].join('\n'),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=enterprise', '--ci', '--offline'],
        initRunner
      );

      expect(code).toBe(1);
      expect(initRunner).not.toHaveBeenCalled();

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('passes strict enterprise bootstrap when mirror and compatibility artifacts exist', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-bootstrap-enterprise-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const mirrorSourceDir = path.join(workspaceRoot, 'mirror-source');
      const artifactSource = path.join(mirrorSourceDir, 'rapidkit-core.whl');
      const artifactContent = 'rapidkit-core-binary-content';
      const artifactSha256 = createHash('sha256').update(artifactContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(mirrorSourceDir, { recursive: true });
      await writeFile(artifactSource, artifactContent, 'utf-8');
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(path.join(workspaiDir, 'toolchain.lock'), '{}', 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'workspace.json'),
        JSON.stringify({ profile: 'enterprise' }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '  disallow_untrusted_tool_sources: false',
          '  enforce_compatibility_matrix: true',
          '  require_mirror_lock_for_offline: true',
          '',
        ].join('\n'),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'compatibility-matrix.json'),
        JSON.stringify({ runtimes: { node: { major: 20 } } }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-only',
            artifacts: [
              {
                id: 'rapidkit-core-wheel',
                source: path.relative(workspaceRoot, artifactSource),
                target: 'rapidkit-core/rapidkit-core.whl',
                sha256: artifactSha256,
                required: true,
              },
            ],
            retention: {
              keepLast: 10,
            },
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);

      const index = await import('../index.js');
      const initRunner = vi.fn().mockResolvedValue(0);
      const code = await index.handleBootstrapCommand(
        ['bootstrap', '--profile=enterprise', '--ci', '--offline'],
        initRunner
      );

      expect(code).toBe(0);
      expect(initRunner).toHaveBeenCalledWith(['init']);

      const fsExtra = await import('fs-extra');
      const mirrorLockPath = path.join(workspaiDir, 'mirror.lock');
      await expect(fsExtra.pathExists(mirrorLockPath)).resolves.toBe(true);

      const lockRaw = await fsExtra.readFile(mirrorLockPath, 'utf-8');
      const lockData = JSON.parse(lockRaw) as {
        artifacts?: Array<{ id: string; sha256: string }>;
      };
      expect(Array.isArray(lockData.artifacts)).toBe(true);
      expect(lockData.artifacts?.some((artifact) => artifact.id === 'rapidkit-core-wheel')).toBe(
        true
      );

      await cleanupWorkspaceDir(workspaceRoot);
    });
  });

  describe('setup', () => {
    it('returns usage error for unsupported runtime', async () => {
      const index = await import('../index.js');

      const code = await index.handleSetupCommand(['setup', 'ruby']);

      expect(code).toBe(1);
      expect(getRuntimeAdapterMock).not.toHaveBeenCalled();
    });

    it('runs setup even when runtime adapters flag is disabled', async () => {
      const index = await import('../index.js');
      areRuntimeAdaptersEnabledMock.mockReturnValue(false);
      adapterCheckPrereqs.mockResolvedValue({ exitCode: 0 });
      adapterDoctorHints.mockResolvedValue([]);

      const code = await index.handleSetupCommand(['setup', 'python']);

      expect(code).toBe(0);
      expect(getRuntimeAdapterMock).toHaveBeenCalledWith('python', expect.any(Object));
    });

    it('runs prereq checks and returns adapter exit code when enabled', async () => {
      const index = await import('../index.js');
      areRuntimeAdaptersEnabledMock.mockReturnValue(true);
      adapterCheckPrereqs.mockResolvedValue({ exitCode: 2 });
      adapterDoctorHints.mockResolvedValue(['Install runtime']);

      const code = await index.handleSetupCommand(['setup', 'node']);

      expect(getRuntimeAdapterMock).toHaveBeenCalledWith('node', expect.any(Object));
      expect(adapterCheckPrereqs).toHaveBeenCalledTimes(1);
      expect(adapterDoctorHints).toHaveBeenCalledWith(process.cwd());
      expect(code).toBe(2);
    });

    it('routes java setup to java runtime adapter', async () => {
      const index = await import('../index.js');
      areRuntimeAdaptersEnabledMock.mockReturnValue(true);
      adapterCheckPrereqs.mockResolvedValue({ exitCode: 0 });
      adapterDoctorHints.mockResolvedValue([]);

      const code = await index.handleSetupCommand(['setup', 'java']);

      expect(code).toBe(0);
      expect(getRuntimeAdapterMock).toHaveBeenCalledWith('java', expect.any(Object));
    });

    it('routes dotnet setup to dotnet runtime adapter', async () => {
      const index = await import('../index.js');
      areRuntimeAdaptersEnabledMock.mockReturnValue(true);
      adapterCheckPrereqs.mockResolvedValue({ exitCode: 0 });
      adapterDoctorHints.mockResolvedValue([]);

      const code = await index.handleSetupCommand(['setup', 'dotnet']);

      expect(code).toBe(0);
      expect(getRuntimeAdapterMock).toHaveBeenCalledWith('dotnet', expect.any(Object));
    });
  });

  describe('cache', () => {
    it('shows status by default', async () => {
      const index = await import('../index.js');

      const code = await index.handleCacheCommand(['cache']);

      expect(code).toBe(0);
      expect(cacheClearMock).not.toHaveBeenCalled();
    });

    it('clears cache for clear/prune/repair actions', async () => {
      const index = await import('../index.js');

      const clearCode = await index.handleCacheCommand(['cache', 'clear']);
      const pruneCode = await index.handleCacheCommand(['cache', 'prune']);
      const repairCode = await index.handleCacheCommand(['cache', 'repair']);

      expect(clearCode).toBe(0);
      expect(pruneCode).toBe(0);
      expect(repairCode).toBe(0);
      expect(cacheClearMock).toHaveBeenCalledTimes(3);
    });

    it('returns usage error for unsupported action', async () => {
      const index = await import('../index.js');

      const code = await index.handleCacheCommand(['cache', 'unknown']);

      expect(code).toBe(1);
      expect(cacheClearMock).not.toHaveBeenCalled();
    });
  });

  describe('mirror', () => {
    it('shows mirror status inside workspace', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-status-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');

      process.chdir(workspaceRoot);
      const index = await import('../index.js');

      const code = await index.handleMirrorCommand(['mirror', 'status']);

      expect(code).toBe(0);
      const fsExtra = await import('fs-extra');
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'mirror-config.json'))).resolves.toBe(
        false
      );
      await expect(
        fsExtra.pathExists(path.join(workspaiDir, 'reports', 'mirror-ops.latest.json'))
      ).resolves.toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('outputs JSON for mirror status when --json is provided', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-status-json-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const code = await index.handleMirrorCommand(['mirror', 'status', '--json']);

      expect(code).toBe(0);
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
      const parsed = JSON.parse(output) as { command: string; action: string; result: string };
      expect(parsed.command).toBe('mirror');
      expect(parsed.action).toBe('status');
      expect(parsed.result).toBe('ok');

      stdoutSpy.mockRestore();
      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('runs mirror sync lifecycle and writes lock', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-sync-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'mirror-source');
      const sourceFile = path.join(sourceDir, 'artifact.tgz');
      const sourceContent = 'mirror-artifact-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            artifacts: [
              {
                id: 'artifact-1',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'pkg/artifact.tgz',
                sha256: sourceSha,
                required: true,
              },
            ],
            retention: { keepLast: 5 },
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');

      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      await expect(fsExtra.pathExists(path.join(workspaiDir, 'mirror.lock'))).resolves.toBe(true);
      await expect(
        fsExtra.pathExists(path.join(workspaiDir, 'reports', 'mirror-ops.latest.json'))
      ).resolves.toBe(true);

      const mirrorReport = JSON.parse(
        await fsExtra.readFile(path.join(workspaiDir, 'reports', 'mirror-ops.latest.json'), 'utf-8')
      ) as {
        mirror?: { configExists: boolean; lockExists: boolean; artifactsCount: number };
      };
      expect(mirrorReport.mirror).toMatchObject({
        configExists: true,
        lockExists: true,
      });
      expect(typeof mirrorReport.mirror?.artifactsCount).toBe('number');

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('prefetches remote mirror artifact with checksum pinning', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-prefetch-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const content = 'prefetched-artifact-content';
      const sha = createHash('sha256').update(content).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(path.join(workspaiDir, 'trusted-sources.lock'), 'localhost\n', 'utf-8');

      const server = createServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(content);
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as AddressInfo;
      const artifactUrl = `http://localhost:${address.port}/artifact.bin`;

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            artifacts: [
              {
                id: 'remote-artifact',
                url: artifactUrl,
                target: 'prefetch/artifact.bin',
                sha256: sha,
                required: true,
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);

      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      const prefetchedFile = path.join(
        workspaiDir,
        'mirror',
        'artifacts',
        'prefetch',
        'artifact.bin'
      );
      await expect(fsExtra.pathExists(prefetchedFile)).resolves.toBe(true);

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await cleanupWorkspaceDir(workspaceRoot);
    }, 15_000);

    it('retries prefetch and records provenance attempts', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-prefetch-retry-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const content = 'prefetch-retry-content';
      const sha = createHash('sha256').update(content).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(path.join(workspaiDir, 'trusted-sources.lock'), 'localhost\n', 'utf-8');

      let requestCount = 0;
      const server = createServer((_req, res) => {
        requestCount += 1;
        if (requestCount === 1) {
          res.statusCode = 503;
          res.end('temporary-failure');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(content);
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as AddressInfo;
      const artifactUrl = `http://localhost:${address.port}/artifact-retry.bin`;

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            prefetch: {
              retries: 2,
              backoffMs: 5,
              timeoutMs: 2000,
            },
            artifacts: [
              {
                id: 'remote-retry-artifact',
                url: artifactUrl,
                target: 'prefetch-retry/artifact.bin',
                sha256: sha,
                required: true,
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);

      expect(code).toBe(0);
      expect(requestCount).toBeGreaterThanOrEqual(2);

      const fsExtra = await import('fs-extra');
      const lockRaw = await fsExtra.readFile(path.join(workspaiDir, 'mirror.lock'), 'utf-8');
      const lock = JSON.parse(lockRaw) as {
        artifacts?: Array<{
          id: string;
          provenance?: { attempts?: number; sourceType?: string };
        }>;
      };

      const entry = lock.artifacts?.find((artifact) => artifact.id === 'remote-retry-artifact');
      expect(entry).toBeTruthy();
      expect(entry?.provenance?.sourceType).toBe('url');
      expect((entry?.provenance?.attempts || 0) >= 2).toBe(true);

      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await cleanupWorkspaceDir(workspaceRoot);
    }, 15_000);

    it('verifies cryptographic attestation for mirrored artifact', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-attest-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'attest-source');
      const sourceFile = path.join(sourceDir, 'artifact-attested.bin');
      const sourceContent = 'attested-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const signature = signer.sign(privateKey).toString('base64');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: { requireAttestation: true },
            artifacts: [
              {
                id: 'attested-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'attested/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  algorithm: 'sha256',
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      const lockRaw = await fsExtra.readFile(path.join(workspaiDir, 'mirror.lock'), 'utf-8');
      const lock = JSON.parse(lockRaw) as {
        artifacts?: Array<{ id: string; attestation?: { detached?: { verified?: boolean } } }>;
      };
      const entry = lock.artifacts?.find((artifact) => artifact.id === 'attested-artifact');
      expect(entry?.attestation?.detached?.verified).toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('fails when attestation is required but missing', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-attest-required-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'attest-required-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'no-attestation-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: { requireAttestation: true },
            artifacts: [
              {
                id: 'unsigned-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'unsigned/artifact.bin',
                sha256: sourceSha,
                required: true,
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(1);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('verifies Sigstore attestation via cosign integration path (mocked)', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-mirror-sigstore-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'sigstore-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'sigstore-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(path.join(workspaiDir, 'artifact.sig'), 'dummy-signature', 'utf-8');

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: { requireSigstore: true, requireTransparencyLog: true },
            artifacts: [
              {
                id: 'sigstore-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'sigstore/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: Buffer.from('detached').toString('base64'),
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/artifact.sig',
                    identity: 'release@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      // Detached attestation inputs (valid) for existing checks
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      const configRaw = await (
        await import('fs-extra')
      ).readFile(path.join(workspaiDir, 'mirror-config.json'), 'utf-8');
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const artifacts = config.artifacts as Array<Record<string, unknown>>;
      const attestation = artifacts[0].attestation as Record<string, unknown>;
      attestation.signature = detachedSignature;
      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(config, null, 2),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      const lockRaw = await fsExtra.readFile(path.join(workspaiDir, 'mirror.lock'), 'utf-8');
      const lock = JSON.parse(lockRaw) as {
        artifacts?: Array<{
          id: string;
          attestation?: { sigstore?: { verified?: boolean; tlogVerified?: boolean } };
        }>;
      };
      const entry = lock.artifacts?.find((artifact) => artifact.id === 'sigstore-artifact');
      expect(entry?.attestation?.sigstore?.verified).toBe(true);
      expect(entry?.attestation?.sigstore?.tlogVerified).toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('fails when Sigstore is required but missing', async () => {
      const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), 'rapidkit-mirror-sigstore-required-')
      );
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'sigstore-required-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'sigstore-required-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: { requireSigstore: true },
            artifacts: [
              {
                id: 'unsigned-sigstore-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'sigstore-required/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: Buffer.from('placeholder').toString('base64'),
                  publicKeyPath: '.workspai/nonexistent.pem',
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(1);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('passes Sigstore governance allowlists in prod environment', async () => {
      const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), 'rapidkit-mirror-sigstore-policy-pass-')
      );
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'sigstore-policy-pass-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'sigstore-policy-pass-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );
      await writeFile(path.join(workspaiDir, 'artifact.sig'), 'dummy-signature', 'utf-8');

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSigstore: true,
              governance: {
                policies: {
                  prod: {
                    allowedIdentities: ['release@getrapidkit.dev'],
                    allowedIssuers: ['https://token.actions.githubusercontent.com'],
                    allowedRekorUrls: ['https://rekor.sigstore.dev'],
                    requireTransparencyLog: true,
                  },
                },
              },
            },
            artifacts: [
              {
                id: 'sigstore-policy-pass-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'sigstore-policy-pass/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: detachedSignature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/artifact.sig',
                    identity: 'release@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                    rekorUrl: 'https://rekor.sigstore.dev',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.env.RAPIDKIT_ENV = 'prod';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('fails Sigstore governance allowlists in prod environment', async () => {
      const workspaceRoot = await mkdtemp(
        path.join(tmpdir(), 'rapidkit-mirror-sigstore-policy-fail-')
      );
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'sigstore-policy-fail-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'sigstore-policy-fail-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );
      await writeFile(path.join(workspaiDir, 'artifact.sig'), 'dummy-signature', 'utf-8');

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSigstore: true,
              governance: {
                policies: {
                  prod: {
                    allowedIdentities: ['release@getrapidkit.dev'],
                    allowedIssuers: ['https://token.actions.githubusercontent.com'],
                  },
                },
              },
            },
            artifacts: [
              {
                id: 'sigstore-policy-fail-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'sigstore-policy-fail/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: detachedSignature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/artifact.sig',
                    identity: 'intruder@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.env.RAPIDKIT_ENV = 'prod';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(1);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('accepts verified signed governance bundle and enforces its policy', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-governance-bundle-pass-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'governance-bundle-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'governance-bundle-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      await writeFile(path.join(workspaiDir, 'sigstore.sig'), 'dummy-signature', 'utf-8');

      const governancePayload = {
        policies: {
          prod: {
            allowedIdentities: ['release@getrapidkit.dev'],
            allowedIssuers: ['https://token.actions.githubusercontent.com'],
            allowedRekorUrls: ['https://rekor.sigstore.dev'],
            requireTransparencyLog: true,
          },
        },
      };
      const governanceRaw = JSON.stringify(governancePayload, null, 2);
      const governancePath = path.join(workspaiDir, 'governance-policy.json');
      await writeFile(governancePath, governanceRaw, 'utf-8');

      const governanceSigner = createSign('sha256');
      governanceSigner.update(governanceRaw);
      governanceSigner.end();
      const governanceSignature = governanceSigner.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'governance-policy.sig'),
        governanceSignature,
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'governance-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      const { privateKey: detachedPriv, publicKey: detachedPub } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(detachedPriv).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        detachedPub.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSigstore: true,
              requireSignedGovernance: true,
              governanceBundle: {
                policyPath: '.workspai/governance-policy.json',
                signaturePath: '.workspai/governance-policy.sig',
                publicKeyPath: '.workspai/governance-public.pem',
                algorithm: 'sha256',
              },
            },
            artifacts: [
              {
                id: 'governance-bundle-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'governance-bundle/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: detachedSignature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/sigstore.sig',
                    identity: 'release@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                    rekorUrl: 'https://rekor.sigstore.dev',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.env.RAPIDKIT_ENV = 'prod';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      await expect(
        fsExtra.pathExists(path.join(workspaiDir, 'reports', 'transparency-evidence.latest.json'))
      ).resolves.toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('blocks when signed governance bundle is required but signature is invalid', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-governance-bundle-fail-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'governance-bundle-fail-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'governance-bundle-fail-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(
        path.join(workspaiDir, 'governance-policy.json'),
        JSON.stringify({ policies: { prod: {} } }, null, 2),
        'utf-8'
      );
      await writeFile(
        path.join(workspaiDir, 'governance-policy.sig'),
        'invalid-signature',
        'utf-8'
      );

      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      await writeFile(
        path.join(workspaiDir, 'governance-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSignedGovernance: true,
              governanceBundle: {
                policyPath: '.workspai/governance-policy.json',
                signaturePath: '.workspai/governance-policy.sig',
                publicKeyPath: '.workspai/governance-public.pem',
              },
            },
            artifacts: [
              {
                id: 'governance-fail-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'governance-fail/artifact.bin',
                sha256: sourceSha,
                required: true,
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(1);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('exports transparency evidence to file sink', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-evidence-file-sink-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'evidence-file-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'evidence-file-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(path.join(workspaiDir, 'artifact.sig'), 'dummy-signature', 'utf-8');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSigstore: true,
              evidenceExport: {
                enabled: true,
                target: 'file',
                filePath: '.workspai/reports/siem-evidence.ndjson',
                failOnError: true,
              },
            },
            artifacts: [
              {
                id: 'evidence-file-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'evidence-file/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: detachedSignature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/artifact.sig',
                    identity: 'release@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);

      const fsExtra = await import('fs-extra');
      const sinkPath = path.join(workspaceRoot, '.workspai', 'reports', 'siem-evidence.ndjson');
      await expect(fsExtra.pathExists(sinkPath)).resolves.toBe(true);

      await cleanupWorkspaceDir(workspaceRoot);
    });

    it('exports transparency evidence to HTTP webhook sink', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-evidence-http-sink-'));
      const workspaiDir = path.join(workspaceRoot, '.workspai');
      const sourceDir = path.join(workspaceRoot, 'evidence-http-source');
      const sourceFile = path.join(sourceDir, 'artifact.bin');
      const sourceContent = 'evidence-http-content';
      const sourceSha = createHash('sha256').update(sourceContent).digest('hex');

      await mkdir(workspaiDir, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}', 'utf-8');
      await writeFile(sourceFile, sourceContent, 'utf-8');
      await writeFile(path.join(workspaiDir, 'artifact.sig'), 'dummy-signature', 'utf-8');

      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const signer = createSign('sha256');
      signer.update(Buffer.from(sourceContent, 'utf-8'));
      signer.end();
      const detachedSignature = signer.sign(privateKey).toString('base64');
      await writeFile(
        path.join(workspaiDir, 'mirror-public.pem'),
        publicKey.export({ type: 'spki', format: 'pem' }),
        'utf-8'
      );

      let received = false;
      const webhook = createServer((req, res) => {
        if (req.method === 'POST') {
          received = true;
        }
        req.resume();
        res.statusCode = 200;
        res.end('ok');
      });

      await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', () => resolve()));
      const address = webhook.address() as AddressInfo;
      const endpoint = `http://127.0.0.1:${address.port}/siem`;

      await writeFile(
        path.join(workspaiDir, 'mirror-config.json'),
        JSON.stringify(
          {
            enabled: true,
            mode: 'offline-first',
            security: {
              requireSigstore: true,
              evidenceExport: {
                enabled: true,
                target: 'http',
                endpoint,
                failOnError: true,
                timeoutMs: 3000,
              },
            },
            artifacts: [
              {
                id: 'evidence-http-artifact',
                source: path.relative(workspaceRoot, sourceFile),
                target: 'evidence-http/artifact.bin',
                sha256: sourceSha,
                required: true,
                attestation: {
                  signature: detachedSignature,
                  publicKeyPath: '.workspai/mirror-public.pem',
                  sigstore: {
                    signaturePath: '.workspai/artifact.sig',
                    identity: 'release@getrapidkit.dev',
                    issuer: 'https://token.actions.githubusercontent.com',
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      process.env.RAPIDKIT_SIGSTORE_MOCK = 'success';
      process.chdir(workspaceRoot);
      const index = await import('../index.js');
      const code = await index.handleMirrorCommand(['mirror', 'sync']);
      expect(code).toBe(0);
      expect(received).toBe(true);

      await new Promise<void>((resolve, reject) =>
        webhook.close((error) => (error ? reject(error) : resolve()))
      );
      await cleanupWorkspaceDir(workspaceRoot);
    }, 15_000);
  });

  describe('core forwarding boundary', () => {
    it('keeps npm-only commands local and never forwards to core', async () => {
      const index = await import('../index.js');

      for (const command of index.NPM_ONLY_TOP_LEVEL_COMMANDS) {
        await expect(index.shouldForwardToCore([command])).resolves.toBe(false);
      }

      await expect(index.shouldForwardToCore(['bootstrap'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['setup', 'python'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['cache', 'status'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['mirror', 'status'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['doctor', 'workspace'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['workspace', 'list'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['project'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['project', '--help'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['project', 'archive', 'api'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['project', 'delete', 'api'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['project', 'commands', '--json'])).resolves.toBe(
        false
      );
      await expect(index.shouldForwardToCore(['commands', '--scope', 'project'])).resolves.toBe(
        false
      );
      await expect(index.shouldForwardToCore(['project', 'detect', '--json'])).resolves.toBe(true);
      await expect(index.shouldForwardToCore(['shell', 'activate'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['ai'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['config'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['init'])).resolves.toBe(false);

      for (const command of index.WRAPPER_ORCHESTRATED_PROJECT_COMMANDS) {
        await expect(index.shouldForwardToCore([command])).resolves.toBe(false);
      }

      // lint/format stay on npm wrapper when cwd has resolvable Node scripts (this repo does).
      await expect(index.shouldForwardToCore(['lint'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['format'])).resolves.toBe(false);
      await expect(index.shouldForwardToCore(['docs'])).resolves.toBe(true);
    });

    it('forwards module lifecycle commands with wrapper-shared --dry-run to core', async () => {
      const index = await import('../index.js');

      await expect(
        index.shouldForwardToCore(['rollback', 'module', 'free/core/health', '--dry-run'])
      ).resolves.toBe(true);
      await expect(
        index.shouldForwardToCore(['uninstall', 'module', 'free/core/health', '--dry-run'])
      ).resolves.toBe(true);
      await expect(
        index.shouldForwardToCore(['upgrade', 'module', 'free/core/health', '--dry-run'])
      ).resolves.toBe(true);
    });

    it('does not forward bare workspace dry-run names to core', async () => {
      const index = await import('../index.js');
      await expect(index.shouldForwardToCore(['my-workspace', '--dry-run'])).resolves.toBe(false);
    });

    it('detects npm/npx execution context so npm-owned commands stay local', async () => {
      const index = await import('../index.js');

      expect(
        index.isNpmExecInvocation({
          npm_config_user_agent: 'npm/10.8.2 node/v20.19.6 win32 x64 workspaces/false',
          npm_command: 'exec',
        })
      ).toBe(true);

      expect(
        index.isNpmExecInvocation({
          npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js',
          npm_command: 'x',
        })
      ).toBe(true);

      expect(index.isNpmExecInvocation({})).toBe(false);
    });
  });

  describe('cross-platform doctor workspace shadow hardening', () => {
    it('detects local rapidkit.cmd launcher for workspace doctor mode on Windows', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-shadow-'));
      try {
        await writeFile(path.join(workspaceRoot, 'rapidkit.cmd'), '@echo off\n', 'utf-8');
        const index = await import('../index.js');

        const diagnostic = await index.detectWindowsDoctorWorkspaceShadow(
          { scope: 'workspace', workspaceFlag: false },
          workspaceRoot,
          'win32'
        );

        expect(diagnostic.detected).toBe(true);
        expect(diagnostic.candidatePath?.toLowerCase()).toContain('rapidkit.cmd');
      } finally {
        await cleanupWorkspaceDir(workspaceRoot);
      }
    });

    it('does not flag local rapidkit bash launcher for workspace doctor mode on Linux', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-shadow-'));
      try {
        await writeFile(
          path.join(workspaceRoot, 'rapidkit'),
          '#!/usr/bin/env bash\nexec poetry run "$@"\n',
          'utf-8'
        );
        const index = await import('../index.js');

        const diagnostic = await index.detectWindowsDoctorWorkspaceShadow(
          { scope: 'workspace', workspaceFlag: false },
          workspaceRoot,
          'linux'
        );

        expect(diagnostic.detected).toBe(false);
      } finally {
        await cleanupWorkspaceDir(workspaceRoot);
      }
    });

    it('does not flag .workspai/rapidkit bash launcher for workspace doctor mode on Linux', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-shadow-'));
      try {
        const workspaiDir = path.join(workspaceRoot, '.workspai');
        await fsExtra.ensureDir(workspaiDir);
        await writeFile(
          path.join(workspaiDir, 'rapidkit'),
          '#!/usr/bin/env bash\nexec poetry run "$@"\n',
          'utf-8'
        );
        const index = await import('../index.js');

        const diagnostic = await index.detectWindowsDoctorWorkspaceShadow(
          { scope: 'workspace', workspaceFlag: false },
          workspaceRoot,
          'linux'
        );

        expect(diagnostic.detected).toBe(false);
      } finally {
        await cleanupWorkspaceDir(workspaceRoot);
      }
    });

    it('does not detect shadow for non-workspace doctor mode', async () => {
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'rapidkit-shadow-'));
      try {
        await writeFile(path.join(workspaceRoot, 'rapidkit.cmd'), '@echo off\n', 'utf-8');
        const index = await import('../index.js');

        const diagnostic = await index.detectWindowsDoctorWorkspaceShadow(
          { scope: undefined, workspaceFlag: false },
          workspaceRoot,
          'win32'
        );

        expect(diagnostic.detected).toBe(false);
      } finally {
        await cleanupWorkspaceDir(workspaceRoot);
      }
    });
  });
});
