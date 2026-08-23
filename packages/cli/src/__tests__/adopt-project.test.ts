import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  adoptProjectIntoWorkspace,
  captureAdoptProjectRollbackSnapshot,
  cleanupAdoptedProjectImport,
} from '../adopt-project';
import { readImportedProjectsRegistry } from '../imported-projects-registry';
import { buildWorkspaceModel } from '../workspace-model';
import { syncWorkspaceContract } from '../utils/workspace-contract';

const createdPaths: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dirPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
  createdPaths.push(dirPath);
  return dirPath;
}

async function makeWorkspace(): Promise<string> {
  const workspacePath = await makeTempDir('rapidkit-adopt-workspace-');
  await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
  await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
    workspace_name: 'demo-workspace',
  });
  await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
  return workspacePath;
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

describe('adopt-project', () => {
  it('adopts an existing local project without moving source files', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-source-');
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'portal-web',
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
      scripts: {
        dev: 'next dev',
        build: 'next build',
      },
    });

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      name: 'portal-web',
      now: new Date('2026-06-14T12:00:00.000Z'),
    });

    expect(adopted).toMatchObject({
      name: 'portal-web',
      path: projectPath,
      relationship: 'adopted',
      runtime: 'node',
      framework: 'nextjs',
      frameworkDisplayName: 'Next.js',
      wroteFiles: true,
    });
    expect(await fsExtra.pathExists(path.join(projectPath, 'package.json'))).toBe(true);
    expect(await fsExtra.pathExists(adopted.projectJsonPath)).toBe(true);
    expect(await fsExtra.pathExists(adopted.adoptJsonPath)).toBe(true);
    expect(await fsExtra.pathExists(adopted.adoptReadinessPath)).toBe(true);

    const projectJson = await fsExtra.readJson(adopted.projectJsonPath);
    expect(projectJson).toMatchObject({
      name: 'portal-web',
      runtime: 'node',
      framework: 'nextjs',
      kind: 'frontend',
      kit_name: 'adopted.nextjs',
      module_support: false,
      adoption: {
        managed_by: 'workspai',
        mode: 'linked',
        adopted_at: '2026-06-14T12:00:00.000Z',
      },
    });
    expect(await fsExtra.pathExists(path.join(projectPath, '.workspai', 'project.json'))).toBe(
      true
    );
    expect(await fsExtra.pathExists(path.join(projectPath, '.rapidkit', 'project.json'))).toBe(
      false
    );

    const adoptJson = await fsExtra.readJson(adopted.adoptJsonPath);
    expect(adoptJson).toMatchObject({
      kind: 'workspai.adopted_project',
      mode: 'linked',
      policy: {
        moved_source: false,
        copied_source: false,
      },
      detection: {
        framework: 'nextjs',
        runtime: 'node',
      },
    });

    const readiness = await fsExtra.readJson(adopted.adoptReadinessPath);
    expect(readiness).toMatchObject({
      kind: 'rapidkit.import_readiness',
      project: {
        kind: 'frontend',
        source: 'adopted-local',
      },
      detection: {
        framework: 'nextjs',
        runtime: 'node',
      },
    });

    const registry = await readImportedProjectsRegistry(workspacePath);
    expect(registry).toEqual([
      expect.objectContaining({
        name: 'portal-web',
        path: projectPath,
        relationship: 'adopted',
        source: 'adopted-local',
        framework: 'nextjs',
      }),
    ]);
  });

  it('refreshes Workspai-managed detection when a linked project is re-adopted', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-readopt-source-');
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'native-core',
      dependencies: { express: '^4.19.2' },
    });

    const first = await adoptProjectIntoWorkspace({ workspacePath, source: projectPath });
    expect(first).toMatchObject({ runtime: 'node', framework: 'express' });

    await fsExtra.remove(path.join(projectPath, 'package.json'));
    await fsExtra.outputFile(
      path.join(projectPath, 'CMakeLists.txt'),
      'project(native_core CXX)\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'core.cc'),
      'int core() { return 0; }\n'
    );

    const refreshed = await adoptProjectIntoWorkspace({ workspacePath, source: projectPath });
    expect(refreshed).toMatchObject({ runtime: 'cpp', framework: 'cpp', confidence: 'high' });
    expect(await fsExtra.readJson(refreshed.projectJsonPath)).toMatchObject({
      runtime: 'cpp',
      framework: 'cpp',
      kit: 'adopted.cpp',
      kit_name: 'adopted.cpp',
    });
  });

  it('previews adoption without writing metadata in dry-run mode', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-dry-source-');
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      dependencies: {
        express: '^4.19.2',
      },
    });

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      dryRun: true,
    });

    expect(adopted.wroteFiles).toBe(false);
    expect(adopted.effects).toMatchObject({
      schemaVersion: 'workspai.adopt-effects.v1',
      sourceMode: 'linked',
      sourceCodeModified: false,
      workspaceOperations: [
        'register-project',
        'sync-contract',
        'rebuild-model',
        'rebuild-graph',
        'sync-agent-grounding',
      ],
    });
    expect(adopted.effects.projectMetadataFiles).toContain('.workspai/workspace-link.local.json');
    expect(adopted.effects.projectMetadataFiles).toContain('.workspai/agent-entry.v1.json');
    expect(adopted.effects.repositoryControlFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.gitignore' }),
        expect.objectContaining({ path: 'AGENTS.md' }),
        expect.objectContaining({ path: 'CLAUDE.md' }),
        expect.objectContaining({ path: 'GEMINI.md' }),
        expect.objectContaining({ path: 'QWEN.md' }),
        expect.objectContaining({ path: '.amazonq/rules/workspai-agent-entry.md' }),
      ])
    );
    expect(await fsExtra.pathExists(adopted.projectJsonPath)).toBe(false);
    expect(await fsExtra.pathExists(adopted.adoptJsonPath)).toBe(false);
    expect(await readImportedProjectsRegistry(workspacePath)).toEqual([]);
  });

  it('records a profile compatibility warning when adopting a mismatched runtime', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'node-only',
    });
    const projectPath = await makeTempDir('rapidkit-adopt-fastapi-source-');
    await fsExtra.writeFile(path.join(projectPath, 'requirements.txt'), 'fastapi\nuvicorn\n');

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      name: 'studio-api',
    });

    expect(adopted.profileCompatibility).toMatchObject({
      ok: false,
      profile: 'node-only',
      recommendedProfile: 'polyglot',
      recommendedCommand: 'npx workspai bootstrap --profile polyglot',
      message: 'Project "studio-api" is Python, but workspace profile is "node-only".',
    });

    const adoptJson = await fsExtra.readJson(adopted.adoptJsonPath);
    expect(adoptJson.policy.profile_compatibility).toMatchObject({
      ok: false,
      profile: 'node-only',
      recommended_profile: 'polyglot',
      recommended_command: 'npx workspai bootstrap --profile polyglot',
    });
  });

  it('blocks mismatched adoption in strict profile policy mode', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'node-only',
    });
    const projectPath = await makeTempDir('rapidkit-adopt-strict-fastapi-source-');
    await fsExtra.writeFile(path.join(projectPath, 'requirements.txt'), 'fastapi\n');

    await expect(
      adoptProjectIntoWorkspace({
        workspacePath,
        source: projectPath,
        name: 'studio-api',
        profilePolicyMode: 'strict',
      })
    ).rejects.toThrow('Project "studio-api" is Python, but workspace profile is "node-only".');
  });

  it('warns when adoption makes a minimal workspace multi-runtime', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'minimal',
    });
    const existingNodeProject = path.join(workspacePath, 'portal-web');
    await fsExtra.ensureDir(path.join(existingNodeProject, '.workspai'));
    await fsExtra.writeJson(path.join(existingNodeProject, '.workspai', 'project.json'), {
      name: 'portal-web',
      runtime: 'node',
    });
    const projectPath = await makeTempDir('rapidkit-adopt-minimal-fastapi-source-');
    await fsExtra.writeFile(path.join(projectPath, 'requirements.txt'), 'fastapi\n');

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      name: 'studio-api',
    });

    expect(adopted.profileCompatibility).toMatchObject({
      ok: false,
      profile: 'minimal',
      recommendedProfile: 'polyglot',
      message: 'minimal profile mismatch: multiple runtimes detected [node, python].',
    });
  });

  it('persists the complete nested runtime composition for an adopted polyglot SDK', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'demo-workspace',
      profile: 'polyglot',
    });
    const projectPath = await makeTempDir('rapidkit-adopt-polyglot-sdk-');
    await fsExtra.outputFile(
      path.join(projectPath, 'dotnet', 'src', 'Sdk.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk" />\n'
    );
    await fsExtra.outputFile(path.join(projectPath, 'go', 'go.mod'), 'module example.test/sdk\n');
    await fsExtra.outputFile(
      path.join(projectPath, 'nodejs', 'package.json'),
      '{"name":"example-sdk","version":"1.0.0"}'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'python', 'pyproject.toml'),
      '[project]\nname="example-sdk"\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'rust', 'Cargo.toml'),
      '[package]\nname="example-sdk"\nversion="1.0.0"\n'
    );

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      name: 'polyglot-sdk',
    });

    expect(adopted.runtimeCandidates).toEqual(['dotnet', 'go', 'rust', 'node', 'python']);
    expect(adopted.profileCompatibility).toMatchObject({
      ok: true,
      profile: 'polyglot',
    });
    expect(adopted.profileCompatibility.runtimes).toEqual(
      expect.arrayContaining(['dotnet', 'go', 'node', 'python', 'rust'])
    );
    const projectJson = await fsExtra.readJson(adopted.projectJsonPath);
    const adoptJson = await fsExtra.readJson(adopted.adoptJsonPath);
    expect(projectJson.runtime_candidates).toEqual(adopted.runtimeCandidates);
    expect(projectJson.adoption.detection.runtime_candidates).toEqual(adopted.runtimeCandidates);
    expect(adoptJson.detection.runtime_candidates).toEqual(adopted.runtimeCandidates);
  });

  it('makes adopted projects visible to workspace model and contract sync', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-contract-source-');
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'orders-api',
      dependencies: {
        express: '^4.19.2',
      },
    });

    await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      name: 'orders-api',
    });

    const model = await buildWorkspaceModel({ workspacePath });
    expect(model.projects).toEqual([
      expect.objectContaining({
        name: 'orders-api',
        path: path.relative(workspacePath, projectPath).split(path.sep).join('/'),
        framework: 'express',
      }),
    ]);

    const contractSync = await syncWorkspaceContract({ workspacePath });
    expect(contractSync.addedProjects).toEqual([]);
    expect(contractSync.contract.projects).toEqual([
      expect.objectContaining({
        slug: 'orders-api',
        relativePath: 'external/orders-api',
        externalPath: projectPath,
        relationship: 'adopted',
        source: 'adopted-local',
        runtime: 'node',
        framework: 'express',
        kit: 'adopted.express',
      }),
    ]);
  });

  it('rejects adopting the workspace root as a project', async () => {
    const workspacePath = await makeWorkspace();

    await expect(
      adoptProjectIntoWorkspace({
        workspacePath,
        source: workspacePath,
      })
    ).rejects.toThrow('Adopt source cannot be the workspace root itself.');
  });

  it('fails closed when canonical authoritative project metadata is malformed', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-malformed-source-');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeFile(path.join(projectPath, '.workspai', 'project.json'), '{bad json');
    await fsExtra.writeJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'legacy-valid',
    });

    await expect(
      adoptProjectIntoWorkspace({ workspacePath, source: projectPath, dryRun: true })
    ).rejects.toThrow('Authoritative project metadata is malformed');
  });

  it('fails closed when legacy project metadata is authoritative and malformed', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-malformed-legacy-source-');
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeFile(path.join(projectPath, '.rapidkit', 'project.json'), '[]');

    await expect(
      adoptProjectIntoWorkspace({ workspacePath, source: projectPath, dryRun: true })
    ).rejects.toThrow('expected a JSON object');
    expect(await fsExtra.pathExists(path.join(projectPath, '.workspai', 'project.json'))).toBe(
      false
    );
  });

  it('restores exact canonical file preimages when an adoption metadata write fails', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-write-failure-source-');
    const canonicalDir = path.join(projectPath, '.workspai');
    const projectBytes = Buffer.from('{"name":"existing","custom":true}\n');
    const adoptBytes = Buffer.from('preexisting adopt bytes\n');
    const registryBytes = Buffer.from('{"version":1,"updatedAt":"before","projects":[]}\n');
    await fsExtra.ensureDir(canonicalDir);
    await fsExtra.writeFile(path.join(canonicalDir, 'project.json'), projectBytes);
    await fsExtra.writeFile(path.join(canonicalDir, 'adopt.json'), adoptBytes);
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.writeFile(
      path.join(workspacePath, '.workspai', 'imported-projects.json'),
      registryBytes
    );

    const originalWriteJson = fsExtra.writeJson;
    const readinessPath = path.join(canonicalDir, 'adopt-readiness.json');
    vi.spyOn(fsExtra, 'writeJson').mockImplementation((async (
      filePath: string,
      ...args: unknown[]
    ) => {
      if (path.resolve(filePath) === readinessPath) {
        throw new Error('forced readiness write failure');
      }
      return (originalWriteJson as (...params: unknown[]) => Promise<void>)(filePath, ...args);
    }) as typeof fsExtra.writeJson);

    await expect(adoptProjectIntoWorkspace({ workspacePath, source: projectPath })).rejects.toThrow(
      'forced readiness write failure'
    );
    expect(await fsExtra.readFile(path.join(canonicalDir, 'project.json'))).toEqual(projectBytes);
    expect(await fsExtra.readFile(path.join(canonicalDir, 'adopt.json'))).toEqual(adoptBytes);
    expect(await fsExtra.pathExists(readinessPath)).toBe(false);
    expect(
      await fsExtra.readFile(path.join(workspacePath, '.workspai', 'imported-projects.json'))
    ).toEqual(registryBytes);
  });

  it('restores exact canonical file preimages when registry upsert fails', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-registry-failure-source-');
    const canonicalDir = path.join(projectPath, '.workspai');
    const projectBytes = Buffer.from('{"name":"existing"}\n');
    const adoptBytes = Buffer.from('{"before":"adopt"}\n');
    const readinessBytes = Buffer.from('{"before":"readiness"}\n');
    const registryBytes = Buffer.from('{"version":1,"updatedAt":"before","projects":[]}\n');
    await fsExtra.ensureDir(canonicalDir);
    await fsExtra.writeFile(path.join(canonicalDir, 'project.json'), projectBytes);
    await fsExtra.writeFile(path.join(canonicalDir, 'adopt.json'), adoptBytes);
    await fsExtra.writeFile(path.join(canonicalDir, 'adopt-readiness.json'), readinessBytes);
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.writeFile(
      path.join(workspacePath, '.workspai', 'imported-projects.json'),
      registryBytes
    );
    vi.spyOn(fsExtra, 'writeJSON').mockRejectedValueOnce(new Error('forced registry failure'));

    await expect(adoptProjectIntoWorkspace({ workspacePath, source: projectPath })).rejects.toThrow(
      'forced registry failure'
    );
    expect(await fsExtra.readFile(path.join(canonicalDir, 'project.json'))).toEqual(projectBytes);
    expect(await fsExtra.readFile(path.join(canonicalDir, 'adopt.json'))).toEqual(adoptBytes);
    expect(await fsExtra.readFile(path.join(canonicalDir, 'adopt-readiness.json'))).toEqual(
      readinessBytes
    );
    expect(
      await fsExtra.readFile(path.join(workspacePath, '.workspai', 'imported-projects.json'))
    ).toEqual(registryBytes);
  });

  for (const metadataDirectory of ['.workspai', '.rapidkit']) {
    it(`rejects adoption when ${metadataDirectory} is a symlink before reading it`, async (context) => {
      const workspacePath = await makeWorkspace();
      const projectPath = await makeTempDir('rapidkit-adopt-symlink-source-');
      const outsidePath = await makeTempDir('rapidkit-adopt-symlink-outside-');
      await fsExtra.writeFile(path.join(projectPath, 'package.json'), '{}');
      await fsExtra.writeJson(path.join(outsidePath, 'project.json'), { name: 'outside-project' });
      if (
        !(await tryCreateDirectorySymlink(outsidePath, path.join(projectPath, metadataDirectory)))
      ) {
        context.skip();
      }

      await expect(
        adoptProjectIntoWorkspace({
          workspacePath,
          source: projectPath,
          dryRun: true,
        })
      ).rejects.toThrow('Project metadata directory must not be a symlink');

      await expect(fsExtra.readJson(path.join(outsidePath, 'project.json'))).resolves.toEqual({
        name: 'outside-project',
      });
      expect(await readImportedProjectsRegistry(workspacePath)).toEqual([]);
    });
  }

  it('preserves an authored AGENTS.md symlink while publishing portable grounding', async (context) => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-agents-symlink-');
    const authoredRules = '# Repository rules\n\nKeep this target untouched.\n';
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'symlinked-agents-project',
      version: '1.0.0',
    });
    await fsExtra.writeFile(path.join(projectPath, '.rules'), authoredRules);
    try {
      await fsExtra.symlink('.rules', path.join(projectPath, 'AGENTS.md'));
    } catch {
      context.skip();
      return;
    }

    const adopted = await adoptProjectIntoWorkspace({
      workspacePath,
      source: projectPath,
      projectGrounding: 'managed',
    });

    expect((await fsExtra.lstat(path.join(projectPath, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    expect(await fsExtra.readlink(path.join(projectPath, 'AGENTS.md'))).toBe('.rules');
    expect(await fsExtra.readFile(path.join(projectPath, '.rules'), 'utf8')).toBe(authoredRules);
    expect(
      await fsExtra.pathExists(path.join(projectPath, '.workspai', 'PROJECT-GROUNDING.md'))
    ).toBe(true);
    const snapshot = await captureAdoptProjectRollbackSnapshot(workspacePath, projectPath);
    expect(snapshot.files.find((file) => file.path.endsWith('AGENTS.md'))).toMatchObject({
      preserve: 'symbolic-link',
    });
    await cleanupAdoptedProjectImport(workspacePath, projectPath, snapshot);
    expect((await fsExtra.lstat(path.join(projectPath, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    expect(adopted.effects.repositoryControlFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'AGENTS.md',
          condition: expect.stringContaining('symbolic'),
        }),
      ])
    );
  });

  it('refuses adoption cleanup through a metadata symlink without changing its target', async (context) => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-cleanup-symlink-source-');
    const outsidePath = await makeTempDir('rapidkit-adopt-cleanup-symlink-outside-');
    const outsideProjectJson = { name: 'outside-project', untouched: true };
    await fsExtra.writeJson(path.join(outsidePath, 'project.json'), outsideProjectJson);
    await fsExtra.writeJson(path.join(outsidePath, 'adopt.json'), { untouched: true });
    if (!(await tryCreateDirectorySymlink(outsidePath, path.join(projectPath, '.workspai')))) {
      context.skip();
    }

    await expect(
      cleanupAdoptedProjectImport(workspacePath, projectPath, {
        workspacePath,
        projectPath,
        files: [],
      })
    ).rejects.toThrow('Project metadata directory must not be a symlink');
    await expect(fsExtra.readJson(path.join(outsidePath, 'project.json'))).resolves.toEqual(
      outsideProjectJson
    );
    await expect(fsExtra.readJson(path.join(outsidePath, 'adopt.json'))).resolves.toEqual({
      untouched: true,
    });
  });

  it('restores exact canonical bytes without altering legacy metadata', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await makeTempDir('rapidkit-adopt-rollback-source-');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    const canonicalProjectBytes = Buffer.from('{"name":"external-api"}\n\n');
    const legacyProjectBytes = Buffer.from('{"name":"legacy-api"}\n');
    await fsExtra.writeFile(
      path.join(projectPath, '.workspai', 'project.json'),
      canonicalProjectBytes
    );
    await fsExtra.writeFile(
      path.join(projectPath, '.rapidkit', 'project.json'),
      legacyProjectBytes
    );
    const snapshot = await captureAdoptProjectRollbackSnapshot(workspacePath, projectPath);
    await fsExtra.writeFile(path.join(projectPath, '.workspai', 'project.json'), 'changed');
    await fsExtra.writeFile(path.join(projectPath, '.workspai', 'adopt.json'), 'created');
    await fsExtra.writeFile(path.join(projectPath, '.workspai', 'agent-entry.v1.json'), 'created');
    await fsExtra.writeFile(path.join(projectPath, 'CLAUDE.md'), 'created');
    await fsExtra.ensureDir(path.join(projectPath, '.amazonq', 'rules'));
    await fsExtra.writeFile(
      path.join(projectPath, '.amazonq', 'rules', 'workspai-agent-entry.md'),
      'created'
    );

    await cleanupAdoptedProjectImport(workspacePath, projectPath, snapshot);

    expect(await fsExtra.readFile(path.join(projectPath, '.workspai', 'project.json'))).toEqual(
      canonicalProjectBytes
    );
    expect(await fsExtra.pathExists(path.join(projectPath, '.workspai', 'adopt.json'))).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(projectPath, '.workspai', 'agent-entry.v1.json'))
    ).toBe(false);
    expect(await fsExtra.pathExists(path.join(projectPath, 'CLAUDE.md'))).toBe(false);
    expect(await fsExtra.pathExists(path.join(projectPath, '.amazonq'))).toBe(false);
    expect(await fsExtra.readFile(path.join(projectPath, '.rapidkit', 'project.json'))).toEqual(
      legacyProjectBytes
    );
  });
});
