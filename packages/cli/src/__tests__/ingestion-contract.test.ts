import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ADOPT_EFFECTS_SCHEMA_VERSION,
  buildAdoptEffectsSchema,
  buildIngestionPlan,
  buildIngestionPlanSchema,
  buildIngestionResultSchema,
  INGESTION_PLAN_SCHEMA_VERSION,
  INGESTION_RESULT_SCHEMA_VERSION,
} from '../contracts/ingestion-contract.js';
import { exportWorkspaceArchive } from '../utils/workspace-archive.js';
import { connectWorkspace, importWorkspaceArchive } from '../workspace-ingestion.js';
import { registerProjectInWorkspaceStrict, registerWorkspaceStrict } from '../workspace.js';
import { normalizeRegistryPath } from '../utils/registry-path.js';

const cleanup: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => fsExtra.remove(item)));
});

describe('canonical ingestion contract', () => {
  it('expresses resource, materialization, ownership, and registration independently', () => {
    const plan = buildIngestionPlan({
      action: 'adopt-project',
      resourceKind: 'project',
      sourceKind: 'local-folder',
      mode: 'link',
      ownership: 'external',
      registration: 'project',
      source: '/source/project',
      targetWorkspace: '/workspace',
      projectGrounding: 'managed',
    });

    expect(plan.schemaVersion).toBe(INGESTION_PLAN_SCHEMA_VERSION);
    expect(plan.action).toBe('adopt-project');
    expect(buildIngestionPlanSchema().properties.mode.enum).toEqual([
      'link',
      'copy',
      'clone',
      'hydrate',
    ]);
    expect(buildIngestionResultSchema().properties.schemaVersion.const).toBe(
      INGESTION_RESULT_SCHEMA_VERSION
    );
    expect(buildAdoptEffectsSchema().properties.schemaVersion.const).toBe(
      ADOPT_EFFECTS_SCHEMA_VERSION
    );
  });

  it('previews connecting an existing workspace without mutating it', async () => {
    const workspacePath = await temporaryDirectory('workspai-connect-preview-');
    await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'existing',
    });

    const result = await connectWorkspace({ workspacePath, dryRun: true });

    expect(result).toMatchObject({
      status: 'preview',
      workspacePath,
      registered: false,
      verified: true,
      plan: {
        resourceKind: 'workspace',
        sourceKind: 'local-folder',
        mode: 'link',
        registration: 'workspace',
      },
    });
    expect(await fsExtra.pathExists(path.join(workspacePath, '.workspai'))).toBe(false);
  });

  it.runIf(process.platform !== 'win32')(
    'refuses to connect through a workspace metadata symlink',
    async () => {
      const workspacePath = await temporaryDirectory('workspai-connect-symlink-');
      const outside = await temporaryDirectory('workspai-connect-symlink-target-');
      await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
        signature: 'WORKSPAI_WORKSPACE',
        name: 'unsafe',
      });
      await fsExtra.symlink(outside, path.join(workspacePath, '.workspai'), 'dir');

      await expect(connectWorkspace({ workspacePath, dryRun: true })).rejects.toThrow(
        'Workspace metadata directory must not be a symlink'
      );
    }
  );

  it('rolls back a newly-added registry entry when workspace reconciliation fails', async () => {
    const workspacePath = await temporaryDirectory('workspai-connect-rollback-');
    const isolatedHome = await temporaryDirectory('workspai-connect-rollback-home-');
    await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'broken-existing',
    });
    await fsExtra.outputFile(
      path.join(workspacePath, '.workspai', 'workspace.contract.json'),
      '{ invalid json'
    );

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      await expect(connectWorkspace({ workspacePath })).rejects.toThrow();
      const registry = await fsExtra.readJson(
        path.join(isolatedHome, '.workspai', 'workspaces.json')
      );
      expect(registry.workspaces).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: workspacePath })])
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it('restores an existing registry entry exactly when workspace reconciliation fails', async () => {
    const workspacePath = await temporaryDirectory('workspai-connect-restore-');
    const externalProject = await temporaryDirectory('workspai-connect-restore-project-');
    const isolatedHome = await temporaryDirectory('workspai-connect-restore-home-');
    await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'broken-existing',
    });

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      await registerWorkspaceStrict(workspacePath, 'custom-registry-name');
      await registerProjectInWorkspaceStrict(workspacePath, 'external-api', externalProject);
      const registryPath = path.join(isolatedHome, '.workspai', 'workspaces.json');
      const before = await fsExtra.readJson(registryPath);
      await fsExtra.outputFile(
        path.join(workspacePath, '.workspai', 'workspace.contract.json'),
        '{ invalid json'
      );

      await expect(connectWorkspace({ workspacePath })).rejects.toThrow();
      expect(await fsExtra.readJson(registryPath)).toEqual(before);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it('previews archive import as hydrate plus workspace registration', async () => {
    const source = await temporaryDirectory('workspai-import-preview-source-');
    const outputRoot = await temporaryDirectory('workspai-import-preview-output-');
    const archivePath = path.join(outputRoot, 'workspace.workspai-archive.zip');
    const destination = path.join(outputRoot, 'imported');
    await fsExtra.writeJson(path.join(source, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'portable',
    });
    await fsExtra.outputFile(path.join(source, 'api', 'main.ts'), 'export {};');
    await exportWorkspaceArchive({ workspacePath: source, outputPath: archivePath });

    const result = await importWorkspaceArchive({
      archivePathOrUrl: archivePath,
      outputPath: destination,
      dryRun: true,
      strict: true,
    });

    expect(result).toMatchObject({
      status: 'preview',
      workspacePath: destination,
      registered: false,
      verified: true,
      plan: {
        resourceKind: 'workspace',
        sourceKind: 'archive',
        mode: 'hydrate',
        registration: 'workspace',
      },
    });
    expect(await fsExtra.pathExists(destination)).toBe(false);
  });

  it('imports an archive, rebuilds portable workspace state, and registers the result', async () => {
    const source = await temporaryDirectory('workspai-import-source-');
    const outputRoot = await temporaryDirectory('workspai-import-output-');
    const isolatedHome = await temporaryDirectory('workspai-import-home-');
    const archivePath = path.join(outputRoot, 'portable.workspai-archive.zip');
    const destination = path.join(outputRoot, 'imported');
    const projectPath = path.join(source, 'api');
    await fsExtra.writeJson(path.join(source, '.workspai-workspace'), {
      signature: 'WORKSPAI_WORKSPACE',
      name: 'portable',
    });
    await fsExtra.outputJson(path.join(source, '.workspai', 'workspace.json'), {
      schema_version: '1.0',
      workspace_name: 'portable',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'api',
      slug: 'api',
      runtime: 'node',
      framework: 'nestjs',
      kind: 'backend',
      modules: [],
      contracts: {
        owns: [],
        apis: [],
        publishes: [],
        consumes: [],
        dependsOn: [],
        env: [],
      },
    });
    await fsExtra.outputJson(path.join(source, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-07-27T00:00:00.000Z',
      workspace: { name: 'portable', profile: 'polyglot' },
      projects: [
        {
          slug: 'api',
          relativePath: 'api',
          source: 'workspace',
          runtime: 'node',
          framework: 'nestjs',
          modules: [],
          ports: [{ name: 'http', port: 4300, protocol: 'http' }],
          contracts: {
            owns: ['billing'],
            apis: [{ name: 'billing', basePath: '/billing' }],
            publishes: ['invoice.created'],
            consumes: [],
            dependsOn: [],
            env: ['DATABASE_URL'],
          },
        },
      ],
    });
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'workspace-link.local.json'), {
      workspacePath: '/private/source-machine/portable',
    });
    await exportWorkspaceArchive({ workspacePath: source, outputPath: archivePath });

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      const result = await importWorkspaceArchive({
        archivePathOrUrl: archivePath,
        outputPath: destination,
        strict: true,
        projectGrounding: 'off',
      });

      expect(result).toMatchObject({
        status: 'passed',
        workspacePath: destination,
        registered: true,
        verified: true,
        plan: {
          action: 'import-workspace',
          resourceKind: 'workspace',
          mode: 'hydrate',
        },
      });
      expect(await fsExtra.pathExists(path.join(destination, '.workspai-workspace'))).toBe(true);
      expect(
        await fsExtra.pathExists(path.join(destination, '.workspai', 'workspace.contract.json'))
      ).toBe(true);
      const importedContract = await fsExtra.readJson(
        path.join(destination, '.workspai', 'workspace.contract.json')
      );
      expect(importedContract.projects).toEqual([
        expect.objectContaining({
          slug: 'api',
          ports: [{ name: 'http', port: 4300, protocol: 'http' }],
          contracts: expect.objectContaining({
            owns: ['billing'],
            publishes: ['invoice.created'],
          }),
        }),
      ]);
      const rebuiltLink = await fsExtra.readJson(
        path.join(destination, 'api', '.workspai', 'workspace-link.local.json')
      );
      expect(rebuiltLink).toMatchObject({
        workspace: { root: destination },
        project: { name: 'api' },
      });
      expect(JSON.stringify(rebuiltLink)).not.toContain('/private/source-machine');
      const registry = await fsExtra.readJson(
        path.join(isolatedHome, '.workspai', 'workspaces.json')
      );
      expect(registry.workspaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: normalizeRegistryPath(destination) }),
        ])
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });
});
