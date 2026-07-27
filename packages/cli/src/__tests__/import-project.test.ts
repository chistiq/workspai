import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { readImportedProjectsRegistry } from '../imported-projects-registry';
import { cleanupImportedProjectImport, importProjectIntoWorkspace } from '../import-project';
import { resolveProjectCommandCapabilities } from '../utils/project-command-capabilities';
import { syncWorkspaceContract } from '../utils/workspace-contract';

const createdPaths: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dirPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
  createdPaths.push(dirPath);
  return dirPath;
}

async function tryCreateDirectorySymlink(targetPath: string, linkPath: string): Promise<boolean> {
  try {
    await fsExtra.symlink(targetPath, linkPath, 'dir');
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['EACCES', 'EPERM', 'ENOSYS'].includes(String(error.code))
    ) {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();

  while (createdPaths.length > 0) {
    const target = createdPaths.pop();
    if (target) {
      await fsExtra.remove(target);
    }
  }
});

describe('import-project', () => {
  it('copies a local project into the workspace and writes imported-projects registry entry', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    await fsExtra.writeJson(path.join(sourcePath, 'package.json'), {
      name: 'edge-api',
      dependencies: {
        express: '^4.19.2',
      },
      scripts: {
        dev: 'node server.js',
        start: 'node server.js',
        test: 'node --test',
        build: 'node build.js',
      },
    });

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'edge-api',
    });

    expect(imported.name).toBe('edge-api');
    expect(imported.stack).toBe('express');
    expect(imported.runtime).toBe('node');
    expect(imported.framework).toBe('express');
    expect(imported.frameworkDisplayName).toBe('Express');
    expect(imported.supportTier).toBe('extended');
    expect(imported.moduleSupport).toBe(false);
    expect(imported.relativePath).toBe('edge-api');
    expect(await fsExtra.pathExists(path.join(imported.path, 'package.json'))).toBe(true);
    expect(await fsExtra.pathExists(imported.projectJsonPath)).toBe(true);
    expect(await fsExtra.pathExists(imported.importJsonPath)).toBe(true);
    expect(await fsExtra.pathExists(imported.importReadinessPath)).toBe(true);

    const projectJson = await fsExtra.readJson(imported.projectJsonPath);
    expect(projectJson).toMatchObject({
      name: 'edge-api',
      slug: 'edge-api',
      kind: 'backend',
      category: 'backend',
      runtime: 'node',
      framework: 'express',
      kit_name: 'imported.express',
      module_support: false,
      import: {
        managed_by: 'workspai',
        source_type: 'local-folder',
        relative_path: 'edge-api',
      },
    });
    expect(await fsExtra.pathExists(path.join(imported.path, '.workspai', 'project.json'))).toBe(
      true
    );

    const importJson = await fsExtra.readJson(imported.importJsonPath);
    expect(importJson).toMatchObject({
      kind: 'workspai.imported_project',
      source: {
        type: 'local-folder',
        name: 'edge-api',
      },
      project: {
        relative_path: 'edge-api',
        kind: 'backend',
        category: 'backend',
        module_support: false,
      },
      detection: {
        framework: 'express',
        framework_display_name: 'Express',
        runtime: 'node',
        kind: 'backend',
        category: 'backend',
      },
      policy: {
        copied_secrets: false,
        copied_dependency_caches: false,
        module_mutation_enabled: false,
      },
    });

    const readinessJson = await fsExtra.readJson(imported.importReadinessPath);
    expect(readinessJson).toMatchObject({
      kind: 'rapidkit.import_readiness',
      status: 'review',
      detection: {
        framework: 'express',
        frameworkDisplayName: 'Express',
        runtime: 'node',
        supportTier: 'extended',
      },
      commandSupport: {
        moduleCommands: false,
      },
    });
    expect(readinessJson.commandSupport.lifecycleCommands).toEqual(
      expect.arrayContaining(['help', 'init', 'dev'])
    );
    expect(readinessJson.commandSupport.unsupportedLifecycleCommands).not.toContain('dev');

    const registry = await readImportedProjectsRegistry(workspacePath);
    expect(registry).toEqual([
      expect.objectContaining({
        name: imported.name,
        path: imported.path,
        relativePath: 'edge-api',
        stack: 'express',
        runtime: 'node',
        framework: 'express',
        frameworkDisplayName: 'Express',
        supportTier: 'extended',
        moduleSupport: false,
        source: 'local-folder',
      }),
    ]);
  });

  it('copies local project sources without dependency caches or secret env files', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    await fsExtra.writeJson(path.join(sourcePath, 'package.json'), {
      name: 'safe-api',
      dependencies: {
        express: '^4.19.2',
      },
    });
    await fsExtra.writeFile(path.join(sourcePath, '.env'), 'SECRET=do-not-copy\n');
    await fsExtra.writeFile(path.join(sourcePath, '.env.local'), 'SECRET=do-not-copy\n');
    await fsExtra.writeFile(path.join(sourcePath, '.env.example'), 'SECRET=\n');
    await fsExtra.ensureDir(path.join(sourcePath, '.git'));
    await fsExtra.writeFile(path.join(sourcePath, '.git', 'config'), '[core]\n');
    await fsExtra.ensureDir(path.join(sourcePath, 'node_modules', 'leftpad'));
    await fsExtra.writeFile(path.join(sourcePath, 'node_modules', 'leftpad', 'index.js'), '');
    await fsExtra.ensureDir(path.join(sourcePath, 'dist'));
    await fsExtra.writeFile(path.join(sourcePath, 'dist', 'bundle.js'), '');
    await fsExtra.ensureDir(path.join(sourcePath, 'packages', 'shared'));
    await fsExtra.writeFile(path.join(sourcePath, 'packages', 'shared', 'index.ts'), 'export {}\n');
    await fsExtra.writeFile(path.join(sourcePath, 'server.key'), 'private-key\n');

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'safe-api',
    });

    expect(await fsExtra.pathExists(path.join(imported.path, 'package.json'))).toBe(true);
    expect(await fsExtra.pathExists(path.join(imported.path, '.env'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, '.env.local'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, '.env.example'))).toBe(true);
    expect(await fsExtra.pathExists(path.join(imported.path, '.git'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, 'node_modules'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, 'dist'))).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(imported.path, 'packages', 'shared', 'index.ts'))
    ).toBe(true);
    expect(await fsExtra.pathExists(path.join(imported.path, 'server.key'))).toBe(false);
  });

  for (const metadataDirectory of ['.workspai', '.rapidkit']) {
    it(`rejects a local source whose ${metadataDirectory} directory is a symlink`, async (context) => {
      const workspacePath = await makeTempDir('rapidkit-import-symlink-workspace-');
      const sourcePath = await makeTempDir('rapidkit-import-symlink-source-');
      const outsidePath = await makeTempDir('rapidkit-import-symlink-outside-');
      await fsExtra.writeFile(path.join(sourcePath, 'package.json'), '{}');
      await fsExtra.writeJson(path.join(outsidePath, 'project.json'), { name: 'outside-project' });
      if (
        !(await tryCreateDirectorySymlink(outsidePath, path.join(sourcePath, metadataDirectory)))
      ) {
        context.skip();
      }

      await expect(
        importProjectIntoWorkspace({
          workspacePath,
          source: sourcePath,
          name: 'unsafe-project',
        })
      ).rejects.toThrow('Project metadata directory must not be a symlink');

      await expect(fsExtra.readJson(path.join(outsidePath, 'project.json'))).resolves.toEqual({
        name: 'outside-project',
      });
      expect(await fsExtra.pathExists(path.join(workspacePath, 'unsafe-project'))).toBe(false);
    });
  }

  it('rejects a metadata symlink even when its target is inside the local source', async (context) => {
    const workspacePath = await makeTempDir('rapidkit-import-inside-symlink-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-inside-symlink-source-');
    const metadataTarget = path.join(sourcePath, 'metadata-target');
    await fsExtra.ensureDir(metadataTarget);
    if (!(await tryCreateDirectorySymlink(metadataTarget, path.join(sourcePath, '.workspai')))) {
      context.skip();
    }

    await expect(
      importProjectIntoWorkspace({
        workspacePath,
        source: sourcePath,
        name: 'unsafe-project',
      })
    ).rejects.toThrow('Project metadata directory must not be a symlink');
    expect(await fsExtra.pathExists(path.join(workspacePath, 'unsafe-project'))).toBe(false);
  });

  it('refuses rollback through a metadata symlink without removing its target', async (context) => {
    const workspacePath = await makeTempDir('rapidkit-import-cleanup-symlink-workspace-');
    const projectPath = path.join(workspacePath, 'unsafe-project');
    const outsidePath = await makeTempDir('rapidkit-import-cleanup-symlink-outside-');
    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeFile(path.join(outsidePath, 'sentinel.txt'), 'keep');
    if (!(await tryCreateDirectorySymlink(outsidePath, path.join(projectPath, '.workspai')))) {
      context.skip();
    }

    await expect(cleanupImportedProjectImport(workspacePath, projectPath)).rejects.toThrow(
      'Project metadata directory must not be a symlink'
    );
    await expect(fsExtra.readFile(path.join(outsidePath, 'sentinel.txt'), 'utf8')).resolves.toBe(
      'keep'
    );
    expect(await fsExtra.pathExists(projectPath)).toBe(true);
  });

  it('records a profile compatibility warning when importing a mismatched runtime', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-profile-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-fastapi-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'node-only',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.writeFile(path.join(sourcePath, 'requirements.txt'), 'fastapi\nuvicorn\n');

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'studio-api',
    });

    expect(imported.profileCompatibility).toMatchObject({
      ok: false,
      profile: 'node-only',
      recommendedProfile: 'polyglot',
      recommendedCommand: 'npx workspai bootstrap --profile polyglot',
      message: 'Project "studio-api" is Python, but workspace profile is "node-only".',
    });

    const importJson = await fsExtra.readJson(imported.importJsonPath);
    expect(importJson.policy.profile_compatibility).toMatchObject({
      ok: false,
      profile: 'node-only',
      recommended_profile: 'polyglot',
      recommended_command: 'npx workspai bootstrap --profile polyglot',
    });
  });

  it('detects observed Rust projects during import and routes them through profile compatibility', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-rust-profile-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-rust-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'node-only',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.writeFile(path.join(sourcePath, 'Cargo.toml'), '[dependencies]\naxum = "0.7"\n');

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'native-worker',
    });

    expect(imported).toMatchObject({
      runtime: 'rust',
      framework: 'axum',
      supportTier: 'extended',
    });
    expect(imported.profileCompatibility).toMatchObject({
      ok: false,
      recommendedProfile: 'polyglot',
      message: 'Project "native-worker" is Rust, but workspace profile is "node-only".',
    });
  });

  it('rolls back a mismatched import in strict profile policy mode', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-strict-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-strict-fastapi-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'node-only',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.writeFile(path.join(sourcePath, 'requirements.txt'), 'fastapi\n');

    await expect(
      importProjectIntoWorkspace({
        workspacePath,
        source: sourcePath,
        name: 'studio-api',
        profilePolicyMode: 'strict',
      })
    ).rejects.toThrow('Project "studio-api" is Python, but workspace profile is "node-only".');
    expect(await fsExtra.pathExists(path.join(workspacePath, 'studio-api'))).toBe(false);
  });

  it('warns when import makes a minimal workspace multi-runtime', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-minimal-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-minimal-fastapi-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'minimal',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    const existingNodeProject = path.join(workspacePath, 'portal-web');
    await fsExtra.ensureDir(path.join(existingNodeProject, '.workspai'));
    await fsExtra.writeJson(path.join(existingNodeProject, '.workspai', 'project.json'), {
      name: 'portal-web',
      runtime: 'node',
    });
    await fsExtra.writeFile(path.join(sourcePath, 'requirements.txt'), 'fastapi\n');

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'studio-api',
    });

    expect(imported.profileCompatibility).toMatchObject({
      ok: false,
      profile: 'minimal',
      recommendedProfile: 'polyglot',
      message: 'minimal profile mismatch: multiple runtimes detected [node, python].',
    });
  });

  it('imports ASP.NET Core projects as extended dotnet projects without module mutation', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-dotnet-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    await fsExtra.ensureDir(path.join(sourcePath, 'src', 'Api'));
    await fsExtra.writeFile(
      path.join(sourcePath, 'src', 'Api', 'Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" /></ItemGroup></Project>\n'
    );

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'billing-dotnet-api',
    });

    expect(imported.stack).toBe('dotnet');
    expect(imported.runtime).toBe('dotnet');
    expect(imported.framework).toBe('dotnet');
    expect(imported.frameworkDisplayName).toBe('ASP.NET Core');
    expect(imported.supportTier).toBe('extended');
    expect(imported.moduleSupport).toBe(false);

    const projectJson = await fsExtra.readJson(imported.projectJsonPath);
    expect(projectJson).toMatchObject({
      runtime: 'dotnet',
      framework: 'dotnet',
      kind: 'backend',
      category: 'backend',
      kit_name: 'imported.dotnet',
      module_support: false,
    });

    const readinessJson = await fsExtra.readJson(imported.importReadinessPath);
    expect(readinessJson).toMatchObject({
      kind: 'rapidkit.import_readiness',
      detection: {
        runtime: 'dotnet',
        framework: 'dotnet',
        supportTier: 'extended',
      },
      commandSupport: {
        moduleCommands: false,
      },
    });
  });

  it('imports extended ecosystem projects with only file-proven lifecycle support', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-laravel-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    await fsExtra.writeJson(path.join(sourcePath, 'composer.json'), {
      require: {
        'laravel/framework': '^11.0',
      },
    });
    await fsExtra.writeFile(path.join(sourcePath, '.env'), 'APP_KEY=secret\n');
    await fsExtra.writeFile(path.join(sourcePath, '.env.example'), 'APP_KEY=\n');
    await fsExtra.ensureDir(path.join(sourcePath, 'vendor', 'laravel'));
    await fsExtra.writeFile(path.join(sourcePath, 'vendor', 'laravel', 'framework.php'), '');

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'customer-portal',
    });

    expect(imported.stack).toBe('unknown');
    expect(imported.runtime).toBe('php');
    expect(imported.framework).toBe('laravel');
    expect(imported.frameworkDisplayName).toBe('Laravel');
    expect(imported.supportTier).toBe('extended');
    expect(imported.moduleSupport).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, '.env'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(imported.path, '.env.example'))).toBe(true);
    expect(await fsExtra.pathExists(path.join(imported.path, 'vendor'))).toBe(false);

    const importJsonText = await fsExtra.readFile(imported.importJsonPath, 'utf8');
    expect(importJsonText).not.toContain(sourcePath);

    const readinessJson = await fsExtra.readJson(imported.importReadinessPath);
    expect(readinessJson).toMatchObject({
      status: 'review',
      detection: {
        runtime: 'php',
        framework: 'laravel',
        frameworkDisplayName: 'Laravel',
        supportTier: 'extended',
      },
      commandSupport: {
        lifecycleCommands: ['help', 'init'],
        moduleCommands: false,
      },
    });
    expect(readinessJson.commandSupport.unsupportedLifecycleCommands).toEqual([
      'build',
      'dev',
      'format',
      'lint',
      'start',
      'test',
    ]);

    const capabilities = resolveProjectCommandCapabilities(imported.path);
    expect(capabilities.runtime).toBe('php');
    expect(capabilities.framework).toBe('laravel');
    expect(capabilities.frameworkSupportTier).toBe('extended');
    expect(capabilities.runtimeSupportTier).toBe('extended');
    expect(capabilities.commandMap.help).toMatchObject({ status: 'supported', owner: 'npm' });
    expect(capabilities.commandMap.dev).toMatchObject({ status: 'unsupported', owner: 'runtime' });
    expect(capabilities.commandMap.modules).toMatchObject({ status: 'unsupported', owner: 'none' });
  });

  it('makes imported projects discoverable by the workspace contract graph flow', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.writeJson(path.join(sourcePath, 'package.json'), {
      name: 'orders-api',
      dependencies: {
        express: '^4.19.2',
      },
    });

    await importProjectIntoWorkspace({
      workspacePath,
      source: sourcePath,
      name: 'orders-api',
    });

    const contractSync = await syncWorkspaceContract({
      workspacePath,
      now: new Date('2026-06-04T00:00:00.000Z'),
    });

    expect(contractSync.verification.status).toBe('passed');
    expect(contractSync.addedProjects).toEqual([]);
    expect(contractSync.contract.projects).toEqual([
      expect.objectContaining({
        slug: 'orders-api',
        relativePath: 'orders-api',
        runtime: 'node',
        framework: 'express',
        kit: 'imported.express',
      }),
    ]);
  });

  it('clones a git repository source and records the detected supported stack', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const destinationPath = args[args.length - 1];
      await fsExtra.ensureDir(destinationPath);
      await fsExtra.writeFile(
        path.join(destinationPath, 'go.mod'),
        'module github.com/example/api\n\nrequire github.com/gofiber/fiber/v2 v2.52.4\n'
      );
      return { exitCode: 0, stdout: '', stderr: '' } as never;
    });

    const imported = await importProjectIntoWorkspace({
      workspacePath,
      source: 'https://github.com/acme/checkout-api.git',
      sourceType: 'git-url',
    });

    expect(imported.name).toBe('checkout-api');
    expect(imported.stack).toBe('go');
    expect(execaMock).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', '--', 'https://github.com/acme/checkout-api.git', imported.path],
      expect.objectContaining({ timeout: 120000 })
    );

    const registry = await readImportedProjectsRegistry(workspacePath);
    expect(registry[0]).toEqual(
      expect.objectContaining({
        name: 'checkout-api',
        stack: 'go',
        source: 'git-url',
      })
    );
  });

  it('rolls back copied project contents when registry persistence fails', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    await fsExtra.writeJson(path.join(sourcePath, 'package.json'), {
      name: 'edge-api',
      dependencies: {
        express: '^4.19.2',
      },
    });

    vi.spyOn(fsExtra, 'writeJSON').mockRejectedValueOnce(new Error('registry write failed'));

    const destinationPath = path.join(workspacePath, 'edge-api');
    await expect(
      importProjectIntoWorkspace({
        workspacePath,
        source: sourcePath,
        name: 'edge-api',
      })
    ).rejects.toThrow('registry write failed');

    expect(await fsExtra.pathExists(destinationPath)).toBe(false);
    expect(await readImportedProjectsRegistry(workspacePath)).toEqual([]);
  });

  it('rolls back partially copied local projects when copy fails mid-import', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    const sourcePath = await makeTempDir('rapidkit-import-source-');

    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.writeJson(path.join(sourcePath, 'package.json'), {
      name: 'edge-api',
      dependencies: {
        express: '^4.19.2',
      },
    });

    const destinationPath = path.join(workspacePath, 'edge-api');
    vi.spyOn(fsExtra, 'copy').mockImplementationOnce(async () => {
      await fsExtra.ensureDir(destinationPath);
      await fsExtra.writeFile(path.join(destinationPath, 'partial.txt'), 'partial');
      throw new Error('copy failed');
    });

    await expect(
      importProjectIntoWorkspace({
        workspacePath,
        source: sourcePath,
        name: 'edge-api',
      })
    ).rejects.toThrow('copy failed');

    expect(await fsExtra.pathExists(destinationPath)).toBe(false);
    expect(await readImportedProjectsRegistry(workspacePath)).toEqual([]);
  });

  it('rolls back partially cloned git repositories when clone fails mid-import', async () => {
    const workspacePath = await makeTempDir('rapidkit-import-workspace-');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
    });
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');

    const destinationPath = path.join(workspacePath, 'checkout-api');
    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementationOnce(async (_cmd: string, args: string[]) => {
      const destination = args[args.length - 1];
      await fsExtra.ensureDir(destination);
      await fsExtra.writeFile(path.join(destination, 'partial.txt'), 'partial');
      throw new Error('clone failed');
    });

    await expect(
      importProjectIntoWorkspace({
        workspacePath,
        source: 'https://github.com/acme/checkout-api.git',
        sourceType: 'git-url',
      })
    ).rejects.toThrow('clone failed');

    expect(await fsExtra.pathExists(destinationPath)).toBe(false);
    expect(await readImportedProjectsRegistry(workspacePath)).toEqual([]);
  });
});
