import fs from 'fs-extra';
import { rm } from 'node:fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as frontendProject from '../frontend-project.js';
import * as index from '../index.js';
import { resolveFrontendGenerator } from '../frontend-project.js';
import { getWorkspaceRegistryDirectory } from '../utils/platform-capabilities.js';
import { normalizeRegistryPath } from '../utils/registry-path.js';

describe('frontend create registry', () => {
  let fakeHome: string;
  let cwdOutsideWorkspace: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'rapidkit-home-frontend-create-'));
    cwdOutsideWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'rapidkit-cwd-frontend-create-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    if (process.platform === 'win32') {
      process.env.APPDATA = fakeHome;
    }
    process.chdir(cwdOutsideWorkspace);
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
    process.chdir('/');
    await rm(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(cwdOutsideWorkspace, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }, 30_000);

  it('links orphan frontend projects to the managed default workspace registry', async () => {
    const definition = resolveFrontendGenerator('nextjs');
    expect(definition).toBeTruthy();
    if (!definition) {
      throw new Error('nextjs generator missing');
    }

    const projectPath = path.join(cwdOutsideWorkspace, 'orphan-next');
    await fs.ensureDir(projectPath);
    await fs.ensureDir(path.join(projectPath, '.workspai'));
    await fs.writeJson(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'orphan-next',
      runtime: 'node',
      framework: 'nextjs',
    });

    vi.spyOn(frontendProject, 'createFrontendProject').mockResolvedValue({
      definition,
      projectName: 'orphan-next',
      projectPath,
      dryRun: false,
      commandDisplay: 'npx create-next-app@latest orphan-next',
      commandExec: ['npx', '--yes', 'create-next-app@latest', 'orphan-next'],
    });

    const exitCode = await index.handleCreateOrFallback([
      'create',
      'project',
      'frontend.nextjs',
      'orphan-next',
    ]);

    expect(exitCode).toBe(0);

    const expectedWorkspacePath = path.join(fakeHome, '.workspai', 'workspaces', 'workspai');
    const registryPath = path.join(getWorkspaceRegistryDirectory(), 'workspaces.json');
    const registry = await fs.readJson(registryPath);

    expect(registry.workspaces).toEqual([
      expect.objectContaining({
        name: 'workspai',
        path: normalizeRegistryPath(expectedWorkspacePath),
        projects: [
          expect.objectContaining({
            name: 'orphan-next',
            path: normalizeRegistryPath(projectPath),
          }),
        ],
      }),
    ]);

    const importedRegistry = await fs.readJson(
      path.join(expectedWorkspacePath, '.workspai', 'imported-projects.json')
    );
    expect(importedRegistry.projects).toEqual([
      expect.objectContaining({
        name: 'orphan-next',
        path: projectPath,
        relationship: 'adopted',
        source: 'adopted-local',
        framework: 'nextjs',
      }),
    ]);
    expect(
      await fs.readJson(path.join(expectedWorkspacePath, '.workspai', 'workspace.json'))
    ).toMatchObject({
      profile: 'minimal',
      engine: { install_method: 'venv', python_version: null },
    });
    expect(await fs.readJson(path.join(projectPath, '.workspai', 'adopt.json'))).toMatchObject({
      mode: 'linked',
      policy: { moved_source: false, copied_source: false },
    });
  });

  it('removes the generated target when strict finalization fails', async () => {
    const definition = resolveFrontendGenerator('nextjs');
    expect(definition).toBeTruthy();
    if (!definition) throw new Error('nextjs generator missing');

    await fs.ensureDir(path.join(cwdOutsideWorkspace, '.workspai'));
    await fs.writeJson(path.join(cwdOutsideWorkspace, '.workspai', 'workspace.json'), {
      workspace_name: 'frontend-workspace',
    });
    await fs.writeFile(path.join(cwdOutsideWorkspace, '.workspai-workspace'), '{}');
    const projectPath = path.join(cwdOutsideWorkspace, 'failed-next');
    await fs.ensureDir(path.join(projectPath, '.workspai'));
    await fs.writeJson(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'failed-next',
      runtime: 'node',
      framework: 'nextjs',
    });
    vi.spyOn(frontendProject, 'createFrontendProject').mockResolvedValue({
      definition,
      projectName: 'failed-next',
      projectPath,
      dryRun: false,
      commandDisplay: 'npx create-next-app@latest failed-next',
      commandExec: ['npx', '--yes', 'create-next-app@latest', 'failed-next'],
    });
    const previousFailure = process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH;
    process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH = '1';

    try {
      const exitCode = await index.handleCreateOrFallback([
        'create',
        'project',
        'frontend.nextjs',
        'failed-next',
      ]);

      expect(exitCode).toBe(1);
      expect(await fs.pathExists(projectPath)).toBe(false);
    } finally {
      if (previousFailure === undefined) {
        delete process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH;
      } else {
        process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH = previousFailure;
      }
    }
  });
});
