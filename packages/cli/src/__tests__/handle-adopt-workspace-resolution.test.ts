import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as create from '../create.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import { handleAdoptCommand } from '../index.js';
import * as cliPrompts from '../cli-ui/index.js';
import { WORKSPACE_CONTRACT_PATH } from '../utils/workspace-contract.js';

const tempDirs: string[] = [];

afterEach(async () => {
  // Release cwd/console/prompt spies before removing trees that the adoption
  // flow inspected. Windows may briefly retain directory handles after the
  // final filesystem read, so use Node's bounded EBUSY/EPERM retry support.
  // A persistent lock still rejects the cleanup and fails the test.
  vi.restoreAllMocks();
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
    const fakeHome = await makeTempDir('workspai-handle-adopt-explicit-home-');
    const sourceRoot = await makeTempDir('workspai-handle-adopt-explicit-source-');
    const projectPath = path.join(sourceRoot, 'my-project');
    const workspacePath = await makeTempDir('workspai-handle-adopt-explicit-workspace-');
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
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      consoleLog.mockRestore();
    }
  }, 60_000);
});
