import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readImportedProjectsRegistry } from '../imported-projects-registry';
import {
  getGlobalCommandCapabilities,
  handleAdoptCommand,
  handleImportCommand,
  NPM_ONLY_TOP_LEVEL_COMMANDS,
} from '../index';
import {
  WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
  WORKSPACE_SUBCOMMANDS,
} from '../utils/workspace-command-surface';
import {
  getLegacyWorkspaceRegistryDirectory,
  getWorkspaceRegistryDirectory,
} from '../utils/platform-capabilities';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await fs.rm(target, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }
});

describe('enterprise gap closures', () => {
  it('keeps global command inventory aligned with npm-only top-level commands', () => {
    const capabilities = getGlobalCommandCapabilities();
    const npmOwned = new Set(capabilities.commands.npmOwned);

    for (const command of NPM_ONLY_TOP_LEVEL_COMMANDS) {
      expect(npmOwned.has(command)).toBe(true);
    }
    expect(npmOwned.has('pipeline')).toBe(true);
    expect(npmOwned.has('create')).toBe(true);
    expect(npmOwned.has('project')).toBe(true);
    expect(capabilities.commands.coreBacked).not.toContain('create');
    expect(capabilities.commandMap.create).toMatchObject({
      owner: 'npm-wrapper',
      status: 'supported',
    });
  });

  it('publishes a versioned workspace intelligence capability surface for `commands --json`', () => {
    const capabilities = getGlobalCommandCapabilities();

    // Stable schema lets the extension consume capabilities instead of
    // regex-parsing `rapidkit --help` text.
    expect(capabilities.schemaVersion).toBe('rapidkit-command-capabilities-v1');
    expect(capabilities.workspace.command).toBe('workspace');
    expect(capabilities.workspace.subcommands).toEqual([...WORKSPACE_SUBCOMMANDS]);
    expect(capabilities.workspace.intelligenceSubcommands).toEqual([
      ...WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
    ]);

    // The legacy regex markers (workspace model/snapshot/verify/context) must all
    // be discoverable through the structured capability surface.
    for (const marker of ['model', 'snapshot', 'verify', 'context']) {
      expect(capabilities.workspace.intelligenceSubcommands).toContain(marker);
    }
  });

  it('syncs workspace contract after successful import', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-import-contract-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-import-source-'));
    tempDirs.push(workspaceRoot, sourceDir);

    await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
    await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
    await fs.writeJson(path.join(sourceDir, 'package.json'), {
      name: 'orders-api',
      dependencies: { express: '^4.19.2' },
    });

    const exitCode = await handleImportCommand(sourceDir, {
      workspace: workspaceRoot,
      name: 'orders-api',
      json: true,
    });

    expect(exitCode).toBe(0);
    const contractPath = path.join(workspaceRoot, '.workspai', 'workspace.contract.json');
    expect(await fs.pathExists(contractPath)).toBe(true);
    const contract = await fs.readJson(contractPath);
    expect(contract.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'orders-api',
          relativePath: 'orders-api',
        }),
      ])
    );
  });

  it('rolls back adoption metadata when workspace sync fails after adopt', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-adopt-rollback-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-adopt-source-'));
    tempDirs.push(workspaceRoot, sourceDir);

    await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
    await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
    await fs.writeJson(path.join(sourceDir, 'package.json'), {
      name: 'portal-web',
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
    });

    const previousFlag = process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL;
    process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL = '1';

    try {
      const exitCode = await handleAdoptCommand(sourceDir, {
        workspace: workspaceRoot,
        name: 'portal-web',
        json: true,
      });

      expect(exitCode).toBe(1);
      expect(await fs.pathExists(path.join(sourceDir, '.workspai', 'adopt.json'))).toBe(false);
      expect(await fs.pathExists(path.join(sourceDir, '.workspai', 'project.json'))).toBe(false);
      expect(await readImportedProjectsRegistry(workspaceRoot)).toEqual([]);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL;
      } else {
        process.env.RAPIDKIT_TEST_ADOPT_SYNC_FAIL = previousFlag;
      }
    }
  });

  it('restores the exact pre-adopt canonical files and leaves legacy-only metadata untouched', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-adopt-exact-rollback-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-adopt-legacy-source-'));
    tempDirs.push(workspaceRoot, sourceDir);

    await fs.ensureDir(path.join(workspaceRoot, '.workspai'));
    await fs.writeJson(path.join(workspaceRoot, '.workspai', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
    await fs.ensureDir(path.join(sourceDir, '.rapidkit'));
    await fs.ensureDir(path.join(sourceDir, '.workspai'));
    const legacyProjectBytes = Buffer.from('{"name":"legacy-portal","runtime":"node"}\n');
    const legacyAdoptBytes = Buffer.from('legacy adopt must remain\n');
    const canonicalAdoptBytes = Buffer.from('canonical adopt preimage\n');
    const canonicalReadinessBytes = Buffer.from('canonical readiness preimage\n');
    const registryBytes = Buffer.from('{"version":1,"updatedAt":"before","projects":[]}\n');
    await fs.writeFile(path.join(sourceDir, '.rapidkit', 'project.json'), legacyProjectBytes);
    await fs.writeFile(path.join(sourceDir, '.rapidkit', 'adopt.json'), legacyAdoptBytes);
    await fs.writeFile(path.join(sourceDir, '.workspai', 'adopt.json'), canonicalAdoptBytes);
    await fs.writeFile(
      path.join(sourceDir, '.workspai', 'adopt-readiness.json'),
      canonicalReadinessBytes
    );
    await fs.writeFile(
      path.join(workspaceRoot, '.workspai', 'imported-projects.json'),
      registryBytes
    );
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await handleAdoptCommand(
      sourceDir,
      { workspace: workspaceRoot, name: 'legacy-portal', json: true },
      { syncWorkspaceProjects: async () => Promise.reject(new Error('forced post-adopt failure')) }
    );

    expect(exitCode).toBe(1);
    expect(await fs.pathExists(path.join(sourceDir, '.workspai', 'project.json'))).toBe(false);
    expect(await fs.readFile(path.join(sourceDir, '.workspai', 'adopt.json'))).toEqual(
      canonicalAdoptBytes
    );
    expect(await fs.readFile(path.join(sourceDir, '.workspai', 'adopt-readiness.json'))).toEqual(
      canonicalReadinessBytes
    );
    expect(await fs.readFile(path.join(sourceDir, '.rapidkit', 'project.json'))).toEqual(
      legacyProjectBytes
    );
    expect(await fs.readFile(path.join(sourceDir, '.rapidkit', 'adopt.json'))).toEqual(
      legacyAdoptBytes
    );
    expect(
      await fs.readFile(path.join(workspaceRoot, '.workspai', 'imported-projects.json'))
    ).toEqual(registryBytes);
    const payload = JSON.parse(consoleLog.mock.calls.at(-1)?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      error:
        'Workspace sync failed after adopt and adoption metadata was rolled back: forced post-adopt failure',
    });
  });

  it('restores exact global and workspace preimages when import summary publication fails', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-import-transaction-home-'));
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-import-transaction-'));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-import-transaction-source-'));
    tempDirs.push(fakeHome, workspaceRoot, sourceDir);
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousFailure = process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH = '1';

    try {
      const metadataDirectory = path.join(workspaceRoot, '.workspai');
      await fs.ensureDir(metadataDirectory);
      await fs.writeJson(path.join(metadataDirectory, 'workspace.json'), {
        workspace_name: 'transaction-workspace',
      });
      await fs.writeFile(path.join(workspaceRoot, '.workspai-workspace'), '{}');
      await fs.writeJson(path.join(sourceDir, 'package.json'), {
        name: 'orders-api',
        dependencies: { express: '^4.19.2' },
      });

      const canonicalRegistryPath = path.join(getWorkspaceRegistryDirectory(), 'workspaces.json');
      const legacyRegistryPath = path.join(
        getLegacyWorkspaceRegistryDirectory(),
        'workspaces.json'
      );
      const contractPath = path.join(metadataDirectory, 'workspace.contract.json');
      const summaryPath = path.join(metadataDirectory, 'workspace-registry.v1.json');
      const importedRegistryPath = path.join(metadataDirectory, 'imported-projects.json');
      const canonicalRegistry = Buffer.from('{"workspaces":[]}\n');
      const legacyRegistry = Buffer.from('{\n  "workspaces": []\n}\n');
      const contract = Buffer.from('{"existing":"contract"}\n');
      const summary = Buffer.from('{"existing":"summary"}\n');
      const importedRegistry = Buffer.from('{"version":1,"updatedAt":"before","projects":[]}\n');
      await fs.outputFile(canonicalRegistryPath, canonicalRegistry);
      await fs.outputFile(legacyRegistryPath, legacyRegistry);
      await fs.writeFile(contractPath, contract);
      await fs.writeFile(summaryPath, summary);
      await fs.writeFile(importedRegistryPath, importedRegistry);

      const exitCode = await handleImportCommand(sourceDir, {
        workspace: workspaceRoot,
        name: 'orders-api',
        json: true,
      });

      expect(exitCode).toBe(1);
      expect(await fs.readFile(canonicalRegistryPath)).toEqual(canonicalRegistry);
      expect(await fs.readFile(legacyRegistryPath)).toEqual(legacyRegistry);
      expect(await fs.readFile(contractPath)).toEqual(contract);
      expect(await fs.readFile(summaryPath)).toEqual(summary);
      expect(await fs.readFile(importedRegistryPath)).toEqual(importedRegistry);
      expect(await fs.pathExists(path.join(workspaceRoot, 'orders-api'))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousFailure === undefined) {
        delete process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH;
      } else {
        process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH = previousFailure;
      }
    }
  });
});
