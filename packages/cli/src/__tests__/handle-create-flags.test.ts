import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as index from '../index.js';
import * as create from '../create.js';
import * as coreExec from '../core-bridge/pythonRapidkitExec.js';
import * as fsExtra from 'fs-extra';
import * as fs from 'fs';
import os from 'os';
import path from 'path';
import * as cliPrompts from '../cli-ui/prompts.js';
import * as frontendProject from '../frontend-project.js';

describe('handleCreateOrFallback - wrapper flags handling', () => {
  let tmpDir: string;
  let resolvedTmpDir: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpDir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-test-'));
    // Normalize path to handle macOS /var -> /private/var symlinks
    resolvedTmpDir = fs.realpathSync(tmpDir);
    process.chdir(tmpDir);
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    try {
      process.chdir('/');
      await fsExtra.remove(tmpDir);
    } catch (_e) {
      // ignore
    }
  });

  it('creates workspace when --create-workspace flag provided and filters flags forwarded to core', async () => {
    const registerSpy = vi.spyOn(create, 'registerWorkspaceAtPath').mockResolvedValue();
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const args = ['create', 'project', 'fastapi.standard', 'demo', '--create-workspace', '--yes'];
    const code = await index.handleCreateOrFallback(args);
    expect(registerSpy).toHaveBeenCalledWith(process.cwd(), expect.objectContaining({ yes: true }));
    expect(resolveSpy).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalled();

    const forwarded = runSpy.mock.calls[0][0] as string[];
    expect(forwarded).toContain('create');
    expect(forwarded).toContain('project');
    expect(forwarded).toContain('fastapi.standard');
    expect(forwarded).toContain('demo');
    expect(forwarded).not.toContain('--create-workspace');
    expect(forwarded).not.toContain('--yes');
    expect(code).toBe(0);
  });

  it('prints Workspai-owned create project help without invoking Python core', async () => {
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await index.handleCreateOrFallback(['create', 'project', '--help']);

    expect(code).toBe(0);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Usage: npx workspai create project');
    expect(output).not.toContain('Usage: rapidkit create project');
  });

  it('preserves Python-core --output while filtering wrapper-only create project flags', async () => {
    const registerSpy = vi.spyOn(create, 'registerWorkspaceAtPath').mockResolvedValue();
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const code = await index.handleCreateOrFallback([
      'create',
      'project',
      'fastapi.standard',
      'demo',
      '--output',
      'services',
      '--skip-git',
      '--skip-install',
      '--no-workspace',
      '--yes',
    ]);

    expect(code).toBe(0);
    expect(registerSpy).not.toHaveBeenCalled();
    expect(resolveSpy).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalled();

    const forwarded = runSpy.mock.calls[0][0] as string[];
    expect(forwarded).toEqual([
      'create',
      'project',
      'fastapi.standard',
      'demo',
      '--output',
      'services',
    ]);
  });

  it('keeps bridge-backed create project dry-run inside the npm wrapper', async () => {
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await index.handleCreateOrFallback([
      'create',
      'project',
      'fastapi.standard',
      'demo',
      '--dry-run',
      '--output',
      'services',
      '--no-workspace',
    ]);

    expect(code).toBe(0);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Workspai create project dry run');
    expect(output).toContain('writes: none');
  });

  it('rejects project-level --skip-python-engine before Python core forwarding', async () => {
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await index.handleCreateOrFallback([
      'create',
      'project',
      'fastapi.standard',
      'demo',
      '--skip-python-engine',
    ]);

    expect(code).toBe(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.map((call) => String(call[0])).join('')).toContain(
      'workspace creation option'
    );
  });

  it('offers one workspace-management choice outside a workspace and respects opt-out', async () => {
    const promptSpy = vi.spyOn(cliPrompts, 'prompt').mockResolvedValue({ workspaceMode: 'none' });
    const registerSpy = vi.spyOn(create, 'registerWorkspaceAtPath').mockResolvedValue();
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });

    try {
      const args = ['create', 'project', 'fastapi.standard', 'demo'];
      const code = await index.handleCreateOrFallback(args);

      expect(promptSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'workspaceMode',
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'managed' }),
            expect.objectContaining({ value: 'current' }),
            expect.objectContaining({ value: 'none' }),
          ]),
        }),
      ]);
      expect(registerSpy).not.toHaveBeenCalled();
      expect(resolveSpy).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalled();

      const forwarded = runSpy.mock.calls[0][0] as string[];
      expect(forwarded).toEqual(['create', 'project', 'fastapi.standard', 'demo']);
      expect(args).toContain('--no-workspace');
      expect(code).toBe(0);
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('links successful Python-backed creates to an accurate managed default workspace', async () => {
    vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    vi.spyOn(coreExec, 'runCoreRapidkit').mockImplementation(async (forwardedArgs) => {
      const projectName = forwardedArgs[3];
      const projectPath = path.join(tmpDir, projectName);
      await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
      await fsExtra.writeJson(path.join(projectPath, '.workspai', 'project.json'), {
        name: projectName,
        kit_name: 'fastapi.standard',
        runtime: 'python',
        framework: 'fastapi',
      });
      await fsExtra.writeFile(
        path.join(projectPath, 'pyproject.toml'),
        '[project]\nname = "api"\n'
      );
      return 0 as any;
    });

    const code = await index.handleCreateOrFallback([
      'create',
      'project',
      'fastapi.standard',
      'managed-api',
      '--yes',
      '--skip-git',
    ]);

    expect(code).toBe(0);
    const projectPath = path.join(tmpDir, 'managed-api');
    const workspacePath = path.join(tmpDir, '.workspai', 'workspaces', 'workspai');
    expect(
      await fsExtra.readJson(path.join(workspacePath, '.workspai', 'workspace.json'))
    ).toMatchObject({
      profile: 'minimal',
      engine: { install_method: 'venv', python_version: null },
    });
    expect(await fsExtra.readJson(path.join(projectPath, '.workspai', 'adopt.json'))).toMatchObject(
      {
        mode: 'linked',
        workspace: { path: workspacePath },
        policy: { moved_source: false, copied_source: false },
      }
    );
  });

  it('routes `create` without subcommand to workspace flow in non-interactive mode', async () => {
    const createWsSpy = vi.spyOn(create, 'createProject').mockResolvedValue(undefined as never);
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => false,
    });

    try {
      const code = await index.handleCreateOrFallback(['create', '--yes']);
      expect(code).toBe(0);
      expect(createWsSpy).toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      }
    }
  });

  it('prompts for target on `create` and supports choosing project', async () => {
    vi.spyOn(cliPrompts, 'prompt')
      .mockResolvedValueOnce({ createTarget: 'project' })
      .mockResolvedValueOnce({ kitChoice: 'fastapi.standard' })
      .mockResolvedValueOnce({ projectName: 'demo' });

    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });

    try {
      const code = await index.handleCreateOrFallback(['create', '--no-workspace']);
      expect(code).toBe(0);
      expect(resolveSpy).toHaveBeenCalled();
      expect(runSpy).toHaveBeenCalled();

      const forwarded = runSpy.mock.calls[0][0] as string[];
      expect(forwarded).toEqual(['create', 'project', 'fastapi.standard', 'demo']);
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      }
    }
  });

  it('blocks planned official handoff ecosystems before core delegation', async () => {
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await index.handleCreateOrFallback([
      'create',
      'project',
      'wordpress',
      'marketing-site',
    ]);

    expect(code).toBe(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.map((call) => String(call[0])).join('')).toContain('official');
    expect(stderrSpy.mock.calls.map((call) => String(call[0])).join('')).toContain(
      'npx workspai adopt <project-path>'
    );
  });

  it('routes generic non-native runtimes to existing instead of guessing a native kit', async () => {
    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await index.handleCreateOrFallback(['create', 'project', 'php', 'portal']);

    expect(code).toBe(1);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.map((call) => String(call[0])).join('')).toContain('existing');
  });

  it('prompts for target on `create` and supports choosing workspace', async () => {
    vi.spyOn(cliPrompts, 'prompt')
      .mockResolvedValueOnce({ createTarget: 'workspace' })
      .mockResolvedValueOnce({ workspaceName: 'my-workspace' })
      .mockResolvedValueOnce({ location: 'managed' })
      .mockResolvedValueOnce({ author: 'RapidKit User' });

    const createWsSpy = vi.spyOn(create, 'createProject').mockResolvedValue(undefined as never);
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });

    try {
      const code = await index.handleCreateOrFallback(['create']);
      expect(code).toBe(0);
      expect(createWsSpy).toHaveBeenCalledWith(
        'my-workspace',
        expect.objectContaining({
          dryRun: false,
          profile: undefined,
          yes: false,
          parentDirectory: path.join(tmpDir, '.workspai', 'workspaces'),
        })
      );
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      }
    }
  });

  it('creates workspace in cwd when --here is provided', async () => {
    const createWsSpy = vi.spyOn(create, 'createProject').mockResolvedValue(undefined as never);
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const code = await index.handleCreateOrFallback([
      'create',
      'workspace',
      'local-ws',
      '--here',
      '--yes',
    ]);

    expect(code).toBe(0);
    // Verify the call was made with the correct arguments
    const callArgs = createWsSpy.mock.calls[0];
    expect(callArgs[0]).toBe('local-ws');
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1]?.yes).toBe(true);
    // Check that parentDirectory resolves to the same path (handles macOS /var -> /private/var symlinks)
    expect(path.resolve(callArgs[1]?.parentDirectory as string)).toBe(resolvedTmpDir);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['gofiber.standard', 'fiber-api', 'go'],
    ['gogin.standard', 'gin-api', 'go'],
    ['springboot.standard', 'spring-api', 'java'],
    ['dotnet.webapi.clean', 'dotnet-api', 'dotnet'],
  ])(
    'creates npm-owned %s projects without invoking Python core',
    async (kit, projectName, expectedRuntime) => {
      const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
      const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

      const code = await index.handleCreateOrFallback([
        'create',
        'project',
        kit,
        projectName,
        '--yes',
        '--skip-git',
        '--skip-install',
      ]);

      expect(code).toBe(0);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();

      const projectRoot = path.join(tmpDir, projectName);
      expect(await fsExtra.pathExists(projectRoot)).toBe(true);
      const projectJson = await fsExtra.readJson(
        path.join(projectRoot, '.workspai', 'project.json')
      );
      expect(projectJson.kit_name).toBe(kit);
      expect(projectJson.runtime).toBe(expectedRuntime);
      const managedWorkspace = path.join(tmpDir, '.workspai', 'workspaces', 'workspai');
      const workspaceManifest = await fsExtra.readJson(
        path.join(managedWorkspace, '.workspai', 'workspace.json')
      );
      expect(workspaceManifest).toMatchObject({
        profile: 'minimal',
        engine: { install_method: 'venv', python_version: null },
      });
      const adoptMetadata = await fsExtra.readJson(
        path.join(projectRoot, '.workspai', 'adopt.json')
      );
      expect(adoptMetadata).toMatchObject({
        mode: 'linked',
        policy: { moved_source: false, copied_source: false },
      });
    },
    30000
  );

  it.each(['gofiber.standard', 'gogin.standard', 'springboot.standard', 'dotnet.webapi.clean'])(
    'keeps npm-owned %s dry runs read-only',
    async (kit) => {
      const projectName = `dry-${kit.split('.')[0]}`;
      const code = await index.handleCreateOrFallback([
        'create',
        'project',
        kit,
        projectName,
        '--dry-run',
      ]);

      expect(code).toBe(0);
      expect(await fsExtra.pathExists(path.join(tmpDir, projectName))).toBe(false);
      expect(await fsExtra.pathExists(path.join(tmpDir, '.workspai'))).toBe(false);
    }
  );

  it('uses npm-owned generators when interactive project selection chooses Go or Java kits', async () => {
    const promptSpy = vi
      .spyOn(cliPrompts, 'prompt')
      .mockResolvedValueOnce({ createTarget: 'project' })
      .mockResolvedValueOnce({ kitChoice: 'gogin.standard' })
      .mockResolvedValueOnce({ projectName: 'interactive-gin-api' })
      .mockResolvedValueOnce({ workspaceMode: 'none' });

    const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });

    try {
      const code = await index.handleCreateOrFallback(['create', '--skip-git', '--skip-install']);
      expect(code).toBe(0);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();

      const projectJson = await fsExtra.readJson(
        path.join(tmpDir, 'interactive-gin-api', '.workspai', 'project.json')
      );
      expect(projectJson.kit_name).toBe('gogin.standard');
      expect(projectJson.runtime).toBe('go');
      expect(promptSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'workspaceMode',
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'managed' }),
            expect.objectContaining({ value: 'current' }),
            expect.objectContaining({ value: 'none' }),
          ]),
        }),
      ]);
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      }
    }
  }, 30000);

  it('asks how to manage the workspace before an interactive frontend scaffold', async () => {
    const definition = frontendProject.resolveFrontendGenerator('nextjs');
    expect(definition).toBeTruthy();
    if (!definition) {
      throw new Error('nextjs generator missing');
    }

    const promptSpy = vi
      .spyOn(cliPrompts, 'prompt')
      .mockResolvedValueOnce({ createTarget: 'project' })
      .mockResolvedValueOnce({ kitChoice: 'frontend.nextjs' })
      .mockResolvedValueOnce({ projectName: 'interactive-next-app' })
      .mockResolvedValueOnce({ workspaceMode: 'none' });
    const createSpy = vi.spyOn(frontendProject, 'createFrontendProject').mockResolvedValue({
      definition,
      projectName: 'interactive-next-app',
      projectPath: path.join(tmpDir, 'interactive-next-app'),
      dryRun: false,
      commandDisplay: 'npx create-next-app@latest interactive-next-app',
      commandExec: ['npx', '--yes', 'create-next-app@latest', 'interactive-next-app'],
    });
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });

    try {
      const code = await index.handleCreateOrFallback(['create']);

      expect(code).toBe(0);
      expect(createSpy).toHaveBeenCalledWith({
        args: expect.arrayContaining([
          'create',
          'project',
          'frontend.nextjs',
          'interactive-next-app',
          '--no-workspace',
        ]),
      });
      expect(promptSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'workspaceMode',
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'managed' }),
            expect.objectContaining({ value: 'current' }),
            expect.objectContaining({ value: 'none' }),
          ]),
        }),
      ]);
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('rejects invalid project names for npm-level generators before filesystem writes', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const springCode = await index.handleCreateOrFallback([
      'create',
      'project',
      'springboot.standard',
      'bad/name',
    ]);
    const goCode = await index.handleCreateOrFallback([
      'create',
      'project',
      'gofiber.standard',
      'bad/name',
    ]);

    expect(springCode).toBe(1);
    expect(goCode).toBe(1);
    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it.each([
    ['create frontend nextjs', ['create', 'frontend', 'nextjs', 'my-web']],
    ['create project frontend.nextjs', ['create', 'project', 'frontend.nextjs', 'my-web']],
  ])(
    'routes %s to the frontend generator contract without Python core',
    async (_label, baseArgs) => {
      const resolveSpy = vi.spyOn(coreExec, 'resolveRapidkitPython').mockResolvedValue();
      const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

      const code = await index.handleCreateOrFallback([
        ...baseArgs,
        '--dry-run',
        '--no-workspace',
        '--skip-install',
      ]);

      expect(code).toBe(0);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(runSpy).not.toHaveBeenCalled();
      expect(await fsExtra.pathExists(path.join(tmpDir, 'my-web'))).toBe(false);
    }
  );

  it('rejects unknown frontend generators before core forwarding', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runSpy = vi.spyOn(coreExec, 'runCoreRapidkit').mockResolvedValue(0 as any);

    const code = await index.handleCreateOrFallback([
      'create',
      'frontend',
      'unknown-stack',
      'my-web',
      '--dry-run',
      '--no-workspace',
    ]);

    expect(code).toBe(1);
    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown frontend generator'));
  });
});
