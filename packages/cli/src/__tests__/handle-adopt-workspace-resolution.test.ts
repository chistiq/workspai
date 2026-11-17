import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as create from '../create.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import { handleAdoptCommand } from '../index.js';
import * as cliPrompts from '../cli-ui/index.js';
import { WORKSPACE_CONTRACT_PATH } from '../utils/workspace-contract.js';
import { resolveProjectWorkspaceSync } from '../project-workspace-link.js';
import { registerProjectInWorkspaceStrict } from '../workspace.js';
import { getWorkspaceRegistryDirectory } from '../utils/platform-capabilities.js';
import { normalizeRegistryPath } from '../utils/registry-path.js';

const tempDirs: string[] = [];

afterEach(async () => {
  // Release cwd/console/prompt spies before removing trees that the adoption
  // flow inspected. Windows may briefly retain directory handles after the
  // final filesystem read, so use Node's bounded EBUSY/EPERM retry support.
  // A persistent lock still rejects the cleanup and fails the test.
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 10 : 0,
      retryDelay: 100,
    });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeTempDirIn(root: string, prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeDirectoryAlias(target: string, suffix: string): Promise<string> {
  const alias = path.join(path.dirname(target), `${path.basename(target)}-${suffix}-alias`);
  await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  tempDirs.push(alias);
  return alias;
}

async function makeWorkspaceRoot(prefix: string): Promise<string> {
  const workspacePath = await makeTempDir(prefix);
  await fs.mkdir(path.join(workspacePath, '.workspai'), { recursive: true });
  await fs.writeFile(path.join(workspacePath, '.workspai-workspace'), '{}');
  await fs.writeFile(
    path.join(workspacePath, '.workspai', 'workspace.json'),
    JSON.stringify({ workspace_name: path.basename(workspacePath) })
  );
  return workspacePath;
}

describe('handleAdoptCommand workspace resolution', () => {
  it.each(['success', 'rollback'])(
    'recreates a deleted central workspace through adoption with transactional %s',
    async (scenario) => {
      const root = await makeTempDir('workspai-adopt-deleted-central-');
      const fakeHome = path.join(root, 'home');
      const source = path.join(root, 'source', 'demo');
      const workspace = path.join(fakeHome, '.workspai/workspaces/workspai');
      await fs.mkdir(source, { recursive: true });
      await fs.writeFile(path.join(source, 'package.json'), '{"name":"demo","version":"1.0.0"}');
      await fs.writeFile(path.join(source, 'index.js'), 'export const value = 1;\n');
      vi.stubEnv('HOME', fakeHome);
      vi.stubEnv('USERPROFILE', fakeHome);
      vi.stubEnv('RAPIDKIT_TEST_ADOPT_SYNC_FAIL', '');
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const cwd = process.cwd();
      process.chdir(source);
      try {
        expect(await handleAdoptCommand('.', { json: true })).toBe(0);
        await registerProjectInWorkspaceStrict(
          workspace,
          'not-restored',
          path.join(root, 'other-project')
        );
        const registryPath = path.join(getWorkspaceRegistryDirectory(), 'workspaces.json');
        const registryBefore = await fs.readFile(registryPath, 'utf8');
        const linkPath = path.join(source, '.workspai/workspace-link.local.json');
        const linkBefore = await fs.readFile(linkPath, 'utf8');
        await fs.rm(workspace, { recursive: true });
        expect(() =>
          resolveProjectWorkspaceSync({
            startPath: source,
            strict: true,
            requireProjectMembership: true,
          })
        ).toThrow();
        log.mockClear();
        expect(await handleAdoptCommand('.', { json: true, dryRun: true })).toBe(0);
        const preview = JSON.parse(log.mock.calls.at(-1)![0]);
        expect(preview).toMatchObject({
          workspacePath: workspace,
          workspaceResolution: 'default-auto',
          wouldCreateDefaultWorkspace: true,
        });
        await expect(fs.access(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await fs.readFile(linkPath, 'utf8')).toBe(linkBefore);
        expect(await fs.readFile(registryPath, 'utf8')).toBe(registryBefore);
        if (scenario === 'rollback') vi.stubEnv('RAPIDKIT_TEST_ADOPT_SYNC_FAIL', '1');
        log.mockClear();
        expect(await handleAdoptCommand('.', { json: true })).toBe(scenario === 'success' ? 0 : 1);
        if (scenario === 'success') {
          const result = JSON.parse(log.mock.calls.at(-1)![0]);
          expect(result).toMatchObject({
            defaultWorkspaceCreated: true,
            consumerArtifacts: { freshnessSealed: true },
          });
          expect(result.agentBootstrap.status).not.toBe('blocked');
          expect(
            resolveProjectWorkspaceSync({
              startPath: source,
              strict: true,
              requireProjectMembership: true,
            })
          ).toMatchObject({ workspacePath: workspace, source: 'local-link' });
          const contract = JSON.parse(
            await fs.readFile(path.join(workspace, WORKSPACE_CONTRACT_PATH), 'utf8')
          );
          expect(contract.projects.map((p: { slug: string }) => p.slug)).toEqual(['demo']);
          const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
          expect(
            registry.workspaces
              .find((w: { path: string }) => w.path === normalizeRegistryPath(workspace))
              ?.projects.map((p: { name: string }) => p.name)
          ).toEqual(['demo']);
        } else {
          await expect(fs.access(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await fs.readFile(linkPath, 'utf8')).toBe(linkBefore);
          expect(await fs.readFile(registryPath, 'utf8')).toBe(registryBefore);
        }
        expect(await fs.readFile(path.join(source, 'index.js'), 'utf8')).toBe(
          'export const value = 1;\n'
        );
      } finally {
        process.chdir(cwd);
      }
    },
    60_000
  );
  it('previews bootstrap of an explicit empty workspace before adopt', async () => {
    const root = await makeTempDir('rapidkit-handle-adopt-explicit-');
    const projectPath = path.join(root, 'my-project');
    const workspacePath = path.join(root, 'empty-workspace');
    await fs.mkdir(projectPath);
    await fs.mkdir(workspacePath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const registerSpy = vi.spyOn(create, 'registerWorkspaceAtPath').mockResolvedValue();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const exitCode = await handleAdoptCommand(
        projectPath,
        {
          workspace: workspacePath,
          json: true,
          dryRun: true,
        },
        {
          registerWorkspace: async () => undefined,
          registerProjectInWorkspace: async () => undefined,
          syncWorkspaceProjects: async () => undefined,
        }
      );

      expect(exitCode).toBe(0);
      expect(registerSpy).not.toHaveBeenCalled();
      const payload = JSON.parse(consoleLog.mock.calls[0]?.[0] as string) as {
        workspaceResolution: string;
        wouldBootstrapWorkspace: boolean;
      };
      expect(payload.workspaceResolution).toBe('explicit-bootstrap');
      expect(payload.wouldBootstrapWorkspace).toBe(true);
    } finally {
      registerSpy.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('prompts outside a workspace in interactive mode', async () => {
    const parent = await makeTempDir('rapidkit-handle-adopt-prompt-parent-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const promptSpy = vi
      .spyOn(cliPrompts, 'prompt')
      .mockResolvedValue({ workspaceMode: 'parent' } as never);
    const registerSpy = vi.spyOn(create, 'registerWorkspaceAtPath').mockResolvedValue();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });
    const previousCwd = process.cwd();
    process.chdir(projectPath);

    try {
      const exitCode = await handleAdoptCommand(
        projectPath,
        {
          dryRun: true,
        },
        {
          registerWorkspace: async () => undefined,
          registerProjectInWorkspace: async () => undefined,
          syncWorkspaceProjects: async () => undefined,
        }
      );

      expect(exitCode).toBe(0);
      expect(promptSpy).toHaveBeenCalled();
      expect(registerSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
      promptSpy.mockRestore();
      registerSpy.mockRestore();
      consoleLog.mockRestore();
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('does not prompt for parent bootstrap when the parent is not raw', async () => {
    const parent = await makeTempDir('rapidkit-handle-adopt-dirty-parent-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.mkdir(path.join(parent, 'another-project'));
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const promptSpy = vi.spyOn(cliPrompts, 'prompt');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => true,
    });
    const previousCwd = process.cwd();
    process.chdir(projectPath);

    try {
      const exitCode = await handleAdoptCommand(
        projectPath,
        {
          dryRun: true,
        },
        {
          registerWorkspace: async () => undefined,
          registerProjectInWorkspace: async () => undefined,
          syncWorkspaceProjects: async () => undefined,
        }
      );

      expect(exitCode).toBe(0);
      expect(promptSpy).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
      promptSpy.mockRestore();
      consoleLog.mockRestore();
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('keeps managed default behavior for non-interactive adopt outside a workspace', async () => {
    const fakeHome = await makeTempDir('rapidkit-handle-adopt-home-');
    const parent = await makeTempDir('rapidkit-handle-adopt-noninteractive-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const exitCode = await handleAdoptCommand(
        projectPath,
        {
          json: true,
          dryRun: true,
        },
        {
          registerWorkspace: async () => undefined,
          registerProjectInWorkspace: async () => undefined,
          syncWorkspaceProjects: async () => undefined,
        }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(consoleLog.mock.calls[0]?.[0] as string) as {
        workspaceResolution: string;
        wouldCreateDefaultWorkspace: boolean;
      };
      expect(payload.workspaceResolution).toBe('default-auto');
      expect(payload.wouldCreateDefaultWorkspace).toBe(true);
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      consoleLog.mockRestore();
    }
  });

  it('adopts into an existing nearest workspace without prompting', async () => {
    const workspacePath = await makeWorkspaceRoot('rapidkit-handle-adopt-nearest-');
    const projectPath = path.join(workspacePath, 'existing-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const promptSpy = vi.spyOn(cliPrompts, 'prompt');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousCwd = process.cwd();
    process.chdir(projectPath);

    try {
      const exitCode = await handleAdoptCommand(
        projectPath,
        {
          json: true,
          dryRun: true,
        },
        {
          registerWorkspace: async () => undefined,
          registerProjectInWorkspace: async () => undefined,
          syncWorkspaceProjects: async () => undefined,
        }
      );

      expect(exitCode).toBe(0);
      expect(promptSpy).not.toHaveBeenCalled();
      const payload = JSON.parse(consoleLog.mock.calls[0]?.[0] as string) as {
        workspaceResolution: string;
        workspacePath: string;
      };
      expect(payload.workspaceResolution).toBe('nearest');
      // macOS exposes /var as a symlink to /private/var. Adoption may return
      // the physical cwd spelling, so assert filesystem identity rather than
      // requiring one lexical alias of the same workspace.
      expect(await fs.realpath(payload.workspacePath)).toBe(await fs.realpath(workspacePath));
    } finally {
      process.chdir(previousCwd);
      promptSpy.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('resolves the source workspace when the caller starts elsewhere', async () => {
    const workspacePath = await makeWorkspaceRoot('workspai-handle-adopt-source-workspace-');
    const projectPath = path.join(workspacePath, 'existing-project');
    const unrelatedCwd = await makeTempDir('workspai-handle-adopt-unrelated-cwd-');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');
    const promptSpy = vi.spyOn(cliPrompts, 'prompt');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousCwd = process.cwd();
    process.chdir(unrelatedCwd);

    try {
      const exitCode = await handleAdoptCommand(projectPath, {
        json: true,
        dryRun: true,
      });
      expect(exitCode).toBe(0);
      expect(promptSpy).not.toHaveBeenCalled();
      const payload = JSON.parse(consoleLog.mock.calls[0]?.[0] as string) as {
        workspaceResolution: string;
        workspacePath: string;
      };
      expect(payload.workspaceResolution).toBe('nearest');
      expect(payload.workspacePath).toBe(workspacePath);
    } finally {
      process.chdir(previousCwd);
      promptSpy.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('bootstraps a raw parent and seals the complete adopt consumer loop', async () => {
    const fakeHome = await makeTempDir('workspai-handle-adopt-success-home-');
    const parentContainer = await makeTempDir('workspai-handle-adopt-success-root-');
    const workspacePath = path.join(parentContainer, 'my-workspace');
    const projectPath = path.join(workspacePath, 'my-project');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"my-project"}');
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    let exposeTty = true;
    const promptSpy = vi.spyOn(cliPrompts, 'prompt').mockImplementation(async () => {
      exposeTty = false;
      return { workspaceMode: 'parent' } as never;
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => exposeTty,
    });
    const previousCwd = process.cwd();
    process.chdir(projectPath);

    try {
      const exitCode = await handleAdoptCommand(projectPath, {});
      expect(exitCode, consoleLog.mock.calls.map(([value]) => String(value)).join('\n')).toBe(0);
      expect(promptSpy).toHaveBeenCalledOnce();
      expect(await fs.stat(path.join(workspacePath, '.workspai-workspace'))).toBeDefined();

      const contract = JSON.parse(
        await fs.readFile(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), 'utf8')
      ) as { projects: Array<{ relativePath: string; externalPath?: string }> };
      expect(contract.projects).toEqual([expect.objectContaining({ relativePath: 'my-project' })]);
      expect(contract.projects[0]?.externalPath).toBeUndefined();

      const model = JSON.parse(
        await fs.readFile(path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model), 'utf8')
      ) as { summary: { projectCount: number } };
      const graph = JSON.parse(
        await fs.readFile(
          path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
          'utf8'
        )
      ) as { entities: unknown[] };
      expect(model.summary.projectCount).toBe(1);
      expect(graph.entities.length).toBeGreaterThan(0);
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      promptSpy.mockRestore();
      consoleLog.mockRestore();
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  }, 60_000);

  it('rolls parent bootstrap back completely when adoption fails after registration', async () => {
    const fakeHome = await makeTempDir('workspai-handle-adopt-rollback-home-');
    const workspacePath = await makeTempDir('workspai-handle-adopt-rollback-parent-');
    const projectPath = path.join(workspacePath, 'my-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"my-project"}');
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousFailure = process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL = '1';
    let exposeTty = true;
    const promptSpy = vi.spyOn(cliPrompts, 'prompt').mockImplementation(async () => {
      exposeTty = false;
      return { workspaceMode: 'parent' } as never;
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      get: () => exposeTty,
    });
    const previousCwd = process.cwd();
    process.chdir(projectPath);

    try {
      const exitCode = await handleAdoptCommand(projectPath, {});
      expect(exitCode).toBe(1);
      expect(await fs.readdir(workspacePath)).toEqual(['my-project']);
      expect(await fs.readdir(projectPath)).toEqual(['package.json']);
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      if (previousFailure === undefined) delete process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL;
      else process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL = previousFailure;
      promptSpy.mockRestore();
      consoleLog.mockRestore();
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  }, 60_000);

  it('bootstraps an explicit empty workspace and adopts the external project into it', async () => {
    const physicalTempRoot = await makeTempDir('workspai-handle-adopt-explicit-parent-');
    const tempRoot =
      process.platform === 'win32'
        ? physicalTempRoot
        : await makeDirectoryAlias(physicalTempRoot, 'path');
    const fakeHome = await makeTempDirIn(tempRoot, 'workspai-handle-adopt-explicit-home-');
    const sourceRoot = await makeTempDirIn(tempRoot, 'workspai-handle-adopt-explicit-source-');
    const workspacePath = await makeTempDirIn(
      tempRoot,
      'workspai-handle-adopt-explicit-workspace-'
    );
    const projectPath = path.join(sourceRoot, 'my-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"my-project"}');
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const exitCode = await handleAdoptCommand(projectPath, {
        workspace: workspacePath,
        json: true,
      });
      expect(exitCode).toBe(0);

      const contract = JSON.parse(
        await fs.readFile(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), 'utf8')
      ) as { projects: Array<{ relativePath: string; externalPath?: string }> };
      expect(contract.projects).toEqual([
        expect.objectContaining({
          relativePath: 'external/my-project',
          externalPath: projectPath,
        }),
      ]);

      // A previous adoption can retain its local link after membership is
      // removed. Re-adoption must repair that exact destination transactionally.
      const contractPath = path.join(workspacePath, WORKSPACE_CONTRACT_PATH);
      const unregistered = JSON.parse(await fs.readFile(contractPath, 'utf8'));
      unregistered.projects = [];
      await fs.writeFile(contractPath, JSON.stringify(unregistered));
      const authoredPath = path.join(projectPath, 'AGENTS.md');
      await fs.appendFile(authoredPath, '\nKeep these authored repository rules.\n');
      for (const report of [
        'doctor-last-run.json',
        'analyze-last-run.json',
        'release-readiness-last-run.json',
      ]) {
        await fs.writeFile(
          path.join(workspacePath, '.workspai/reports', report),
          JSON.stringify({
            generatedAt: '2020-01-01T00:00:00.000Z',
            health: { errors: 0, warnings: 0 },
          })
        );
      }
      const previousCwd = process.cwd();
      process.chdir(projectPath);
      try {
        vi.stubEnv('RAPIDKIT_TEST_ADOPT_SYNC_FAIL', '1');
        expect(await handleAdoptCommand('.', { json: true })).toBe(1);
        expect(JSON.parse(await fs.readFile(contractPath, 'utf8')).projects).toEqual([]);
        expect(await fs.readFile(authoredPath, 'utf8')).toContain(
          'Keep these authored repository rules.'
        );
        vi.stubEnv('RAPIDKIT_TEST_ADOPT_SYNC_FAIL', '');
        expect(await handleAdoptCommand('.', { json: true })).toBe(0);
        expect(await handleAdoptCommand('.', { json: true })).toBe(0);
        expect(JSON.parse(await fs.readFile(contractPath, 'utf8')).projects).toHaveLength(1);
        expect(await fs.readFile(authoredPath, 'utf8')).toContain(
          'Keep these authored repository rules.'
        );
        const entry = JSON.parse(
          await fs.readFile(path.join(projectPath, '.workspai/agent-entry.v1.json'), 'utf8')
        );
        expect(entry.protocol.taskContextCommand).toContain('agent context');
        const model = JSON.parse(
          await fs.readFile(
            path.join(workspacePath, '.workspai/reports/workspace-model.json'),
            'utf8'
          )
        );
        expect(model.factFreshness.staleFacts).toBeGreaterThan(0);
      } finally {
        process.chdir(previousCwd);
        vi.unstubAllEnvs();
      }
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      consoleLog.mockRestore();
    }
  }, 60_000);
});
