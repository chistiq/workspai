import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateRustAxumKit } from '../generators/rust-axum.js';
import {
  __test__ as officialProjectTestApi,
  createOfficialProject,
  listOfficialProjectGenerators,
  resolveOfficialProjectGenerator,
} from '../official-project.js';
import { getRuntimeAdapter } from '../runtime-adapters/index.js';
import {
  categorizeWorkspaceProjectKind,
  inferWorkspaceProjectKind,
} from '../utils/project-kind.js';
import { listAvailableRuntimeLifecycleCommands } from '../utils/runtime-lifecycle-probes.js';

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('project taxonomy and expanded kit families', () => {
  it('keeps backend, frontend, desktop, and extension as first-class categories', () => {
    expect(categorizeWorkspaceProjectKind('backend')).toBe('backend');
    expect(categorizeWorkspaceProjectKind('frontend')).toBe('frontend');
    expect(categorizeWorkspaceProjectKind('desktop')).toBe('desktop');
    expect(categorizeWorkspaceProjectKind('extension')).toBe('extension');
    expect(categorizeWorkspaceProjectKind('service')).toBe('backend');
  });

  it('detects desktop and extension projects from ecosystem-owned markers', async () => {
    const tauri = await tempRoot('workspai-tauri-kind-');
    await fsExtra.outputJson(path.join(tauri, 'package.json'), {
      dependencies: { '@tauri-apps/api': '^2.0.0' },
    });
    await fsExtra.outputJson(path.join(tauri, 'src-tauri', 'tauri.conf.json'), {});
    expect(await inferWorkspaceProjectKind(tauri)).toBe('desktop');

    const extension = await tempRoot('workspai-extension-kind-');
    await fsExtra.outputJson(path.join(extension, 'package.json'), {
      publisher: 'example',
      engines: { vscode: '^1.90.0' },
      contributes: { commands: [] },
    });
    expect(await inferWorkspaceProjectKind(extension)).toBe('extension');
  });

  it('publishes deterministic official plans for every external generator', async () => {
    const root = await tempRoot('workspai-official-plan-');
    const definitions = listOfficialProjectGenerators();
    expect(definitions.map((item) => item.kitId).sort()).toEqual([
      'desktop.electron',
      'desktop.tauri',
      'extension.vscode',
      'php.laravel',
    ]);

    for (const definition of definitions) {
      expect(definition.versionPolicy).toBe('latest-stable');
      const result = await createOfficialProject([
        'create',
        'project',
        definition.kitId,
        `${definition.id}-sample`,
        '--output',
        root,
        '--dry-run',
      ]);
      expect(result.dryRun).toBe(true);
      expect(result.definition.category).toBe(
        definition.id === 'laravel'
          ? 'backend'
          : definition.id === 'vscode-extension'
            ? 'extension'
            : 'desktop'
      );
      expect(resolveOfficialProjectGenerator(definition.kitId)).toBe(definition);
      expect(await fsExtra.pathExists(result.projectPath)).toBe(false);
    }

    const electron = resolveOfficialProjectGenerator('desktop.electron');
    expect(electron?.commandExec('nova-desktop', { skipGit: false, skipInstall: false })).toEqual({
      command: 'npx',
      args: ['--yes', 'create-electron-app@latest', 'nova-desktop', '--template=vite-typescript'],
    });

    const vscode = resolveOfficialProjectGenerator('extension.vscode');
    expect(
      vscode?.commandExec('nova-extension', { skipGit: false, skipInstall: false }).args
    ).toEqual(expect.arrayContaining(['yo@latest', 'generator-code@latest']));

    const laravel = resolveOfficialProjectGenerator('php.laravel');
    expect(laravel?.commandExec('nova-api', { skipGit: false, skipInstall: false }).args).toContain(
      '--stability=stable'
    );
  });

  it('writes portable project ownership metadata for every official generator family', async () => {
    const root = await tempRoot('workspai-official-metadata-');

    for (const definition of listOfficialProjectGenerators()) {
      const projectPath = path.join(root, definition.id);
      await fsExtra.ensureDir(projectPath);
      await officialProjectTestApi.writeOfficialProjectMetadata({
        definition,
        projectName: definition.id,
        projectPath,
        commandDisplay: `official ${definition.id}`,
        commandExec: ['official', definition.id],
        flags: { skipGit: true, skipInstall: false },
      });

      const metadata = await fsExtra.readJson(path.join(projectPath, '.workspai', 'project.json'));
      expect(metadata).toMatchObject({
        name: definition.id,
        kind: definition.kind,
        category: definition.category,
        runtime: definition.runtime,
        runtime_candidates: definition.runtimeCandidates,
        framework: definition.framework,
        kit: definition.kitId,
        engine: 'npm',
        version_policy: 'latest-stable',
        generator: {
          version_policy: 'latest-stable',
          version_evidence: {
            policy: 'latest-stable',
            host: {
              node: process.versions.node,
              platform: process.platform,
              arch: process.arch,
            },
          },
        },
      });
      expect(await inferWorkspaceProjectKind(projectPath, metadata)).toBe(definition.kind);
    }
  });

  it('fails before generation when a required official tool is unavailable', async () => {
    const definition = resolveOfficialProjectGenerator('desktop.tauri');
    expect(definition).not.toBeNull();

    await expect(
      officialProjectTestApi.assertOfficialGeneratorToolSupport(
        {
          ...definition!,
          requiredTools: [
            {
              command: 'workspai-tool-that-does-not-exist',
              args: ['--version'],
              label: 'Unavailable fixture tool',
              guidance: 'Install the fixture tool.',
            },
          ],
        },
        { skipGit: false, skipInstall: false }
      )
    ).rejects.toThrow(/Unavailable fixture tool/);
  });

  it('fails early with actionable Node guidance when the latest VS Code generator drifts', () => {
    const definition = resolveOfficialProjectGenerator('extension.vscode');
    expect(definition?.nodeSupport?.requirement).toBe('^22.22.2 || ^24.15.0 || >=26.0.0');

    expect(() =>
      officialProjectTestApi.assertOfficialGeneratorNodeSupport(definition!, '24.13.0')
    ).toThrow(/24\.15\.0/);
    expect(() =>
      officialProjectTestApi.assertOfficialGeneratorNodeSupport(definition!, '22.22.2')
    ).not.toThrow();
    expect(() =>
      officialProjectTestApi.assertOfficialGeneratorNodeSupport(definition!, '24.15.0')
    ).not.toThrow();
    expect(() =>
      officialProjectTestApi.assertOfficialGeneratorNodeSupport(definition!, '26.0.0')
    ).not.toThrow();
    expect(() =>
      officialProjectTestApi.assertOfficialGeneratorNodeSupport(definition!, '23.9.0')
    ).toThrow(/requires Node\.js/);
  });

  it('records declared and lock-resolved upstream versions in official create evidence', async () => {
    const root = await tempRoot('workspai-official-version-evidence-');
    const definition = resolveOfficialProjectGenerator('desktop.electron');
    expect(definition).not.toBeNull();
    await fsExtra.outputJson(path.join(root, 'package.json'), {
      devDependencies: {
        electron: '^40.0.0',
        '@electron-forge/cli': '^7.10.0',
      },
    });
    await fsExtra.outputJson(path.join(root, 'package-lock.json'), {
      packages: {
        'node_modules/electron': { version: '40.1.2' },
        'node_modules/@electron-forge/cli': { version: '7.10.2' },
      },
    });

    await officialProjectTestApi.writeOfficialProjectMetadata({
      definition: definition!,
      projectName: 'nova-desktop',
      projectPath: root,
      commandDisplay: 'npx create-electron-app@latest nova-desktop',
      commandExec: ['npx', 'create-electron-app@latest', 'nova-desktop'],
      flags: { skipGit: false, skipInstall: false },
    });

    const metadata = await fsExtra.readJson(path.join(root, '.workspai', 'project.json'));
    expect(metadata.generator.version_evidence).toMatchObject({
      policy: 'latest-stable',
      requested_channel: 'latest',
      declared: {
        'npm:@electron-forge/cli': '^7.10.0',
        'npm:electron': '^40.0.0',
      },
      resolved: {
        'npm:@electron-forge/cli': '7.10.2',
        'npm:electron': '40.1.2',
      },
    });
  });

  it('generates an Axum project with canonical metadata and lifecycle surfaces', async () => {
    const root = await tempRoot('workspai-axum-kit-');
    const project = path.join(root, 'orders-api');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await generateRustAxumKit(project, {
      project_name: 'orders-api',
      skipGit: true,
      skipInstall: true,
    });

    const metadata = await fsExtra.readJson(path.join(project, '.workspai', 'project.json'));
    expect(metadata).toMatchObject({
      kind: 'backend',
      category: 'backend',
      runtime: 'rust',
      framework: 'axum',
      kit: 'rust.axum',
    });
    expect(await inferWorkspaceProjectKind(project, metadata)).toBe('backend');
    expect(listAvailableRuntimeLifecycleCommands(project, 'rust', 'axum')).toEqual([
      'init',
      'dev',
      'start',
      'build',
      'test',
      'lint',
      'format',
    ]);
  });

  it('executes Rust and PHP lifecycle contracts through dedicated adapters', async () => {
    const run = vi.fn(async () => 0);
    const rustRoot = await tempRoot('workspai-rust-adapter-');
    await fsExtra.outputFile(path.join(rustRoot, 'Cargo.toml'), '[package]\nname = "sample"\n');
    const rust = getRuntimeAdapter('rust', { runCommandInCwd: run, runCoreRapidkit: vi.fn() });
    await rust.runTest(rustRoot);
    expect(run).toHaveBeenCalledWith('cargo', ['test', '--all-targets'], rustRoot);

    const phpRoot = await tempRoot('workspai-php-adapter-');
    await fsExtra.outputJson(path.join(phpRoot, 'composer.json'), { scripts: { lint: 'phpstan' } });
    await fsExtra.outputFile(path.join(phpRoot, 'artisan'), '');
    const php = getRuntimeAdapter('php', { runCommandInCwd: run, runCoreRapidkit: vi.fn() });
    await php.runTest(phpRoot);
    await php.runLint?.(phpRoot);
    expect(run).toHaveBeenCalledWith('php', ['artisan', 'test'], phpRoot);
    expect(run).toHaveBeenCalledWith('composer', ['run-script', 'lint'], phpRoot);
  });
});
