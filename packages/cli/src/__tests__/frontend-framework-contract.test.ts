import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectBackendFrameworkFromProject } from '../utils/backend-framework-contract';
import {
  buildFrontendProjectRegistryEntry,
  resolveFrontendGenerator,
  frontendCreateUsage,
} from '../frontend-project';
import { detectFrontendFrameworkFromProject } from '../utils/frontend-framework-contract';
import { resolveProjectCommandCapabilities } from '../utils/project-command-capabilities';

const tempDirs: string[] = [];

async function createTempProject(name: string): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `rk-frontend-contract-${name}-`));
  tempDirs.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await fs.remove(target);
    }
  }
});

describe('frontend-framework-contract', () => {
  it('keeps detected frontend frameworks aligned with official create generators', () => {
    expect(resolveFrontendGenerator('remix')).toMatchObject({
      kitId: 'frontend.remix',
      framework: 'remix',
      displayName: 'React Router',
    });
    expect(resolveFrontendGenerator('angular')).toMatchObject({
      kitId: 'frontend.angular',
      framework: 'angular',
      displayName: 'Angular',
    });
    expect(frontendCreateUsage()).toContain('remix');
    expect(frontendCreateUsage()).toContain('angular');
    expect(frontendCreateUsage('nextjs')).toBe(
      'workspai create project nextjs <name> [--output <dir>] [--skip-install] [--dry-run]'
    );
  });

  it('classifies frontend workspace membership for in-tree and out-of-tree projects', () => {
    const definition = resolveFrontendGenerator('nextjs');
    expect(definition).toBeTruthy();
    if (!definition) throw new Error('nextjs generator missing');

    const workspacePath = path.join(os.tmpdir(), 'workspace');
    const baseResult = {
      definition,
      projectName: 'web',
      dryRun: false,
      commandDisplay: 'npx create-next-app@latest web',
      commandExec: ['npx', '--yes', 'create-next-app@latest', 'web'],
    };

    expect(
      buildFrontendProjectRegistryEntry({
        workspacePath,
        result: {
          ...baseResult,
          projectPath: path.join(workspacePath, 'apps', 'web'),
        },
        importedAt: '2026-06-15T00:00:00.000Z',
      })
    ).toMatchObject({
      name: 'web',
      relativePath: 'apps/web',
      relationship: 'imported',
      source: 'local-folder',
      stack: 'nextjs',
      framework: 'nextjs',
      runtime: 'node',
      supportTier: 'extended',
      moduleSupport: false,
    });

    expect(
      buildFrontendProjectRegistryEntry({
        workspacePath,
        result: {
          ...baseResult,
          projectPath: path.join(os.tmpdir(), 'external-web'),
        },
        importedAt: '2026-06-15T00:00:00.000Z',
      })
    ).toMatchObject({
      relativePath: '../external-web',
      relationship: 'adopted',
      source: 'adopted-local',
    });
  });

  it('detects frontend frameworks before falling back to generic Node.js', async () => {
    const nextProject = await createTempProject('next');
    await fs.writeJson(path.join(nextProject, 'package.json'), {
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
      scripts: {
        dev: 'next dev',
        build: 'next build',
      },
    });

    expect(detectFrontendFrameworkFromProject(nextProject)).toMatchObject({
      key: 'nextjs',
      runtime: 'node',
      displayName: 'Next.js',
      importStack: 'nextjs',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(nextProject)).toMatchObject({
      key: 'nextjs',
      runtime: 'node',
      displayName: 'Next.js',
    });
  });

  it('detects common frontend framework families from package manifests and config files', async () => {
    const viteProject = await createTempProject('vite');
    await fs.writeJson(path.join(viteProject, 'package.json'), {
      devDependencies: {
        vite: '^6.0.0',
        react: '^19.0.0',
      },
    });

    const vanillaViteProject = await createTempProject('vanilla-vite');
    await fs.writeJson(path.join(vanillaViteProject, 'package.json'), {
      devDependencies: {
        vite: '^6.0.0',
      },
    });

    const angularProject = await createTempProject('angular');
    await fs.writeJson(path.join(angularProject, 'package.json'), {
      dependencies: {
        '@angular/core': '^20.0.0',
      },
    });
    await fs.writeJson(path.join(angularProject, 'angular.json'), {});

    const vueProject = await createTempProject('vue');
    await fs.writeJson(path.join(vueProject, 'package.json'), {
      dependencies: {
        vue: '^3.0.0',
      },
    });

    expect(detectFrontendFrameworkFromProject(viteProject)).toMatchObject({
      key: 'react',
      displayName: 'React',
      importStack: 'react',
    });
    expect(detectBackendFrameworkFromProject(viteProject)).toMatchObject({
      key: 'react',
      displayName: 'React',
      importStack: 'react',
    });
    expect(detectFrontendFrameworkFromProject(vanillaViteProject)).toMatchObject({
      key: 'vite',
      displayName: 'Vite',
    });
    expect(detectFrontendFrameworkFromProject(angularProject)).toMatchObject({
      key: 'angular',
      displayName: 'Angular',
    });
    expect(detectFrontendFrameworkFromProject(vueProject)).toMatchObject({
      key: 'vue',
      displayName: 'Vue',
    });
  });

  it('does not classify a Node library using Vitest as a Vite application', async () => {
    const libraryProject = await createTempProject('node-library-with-vitest');
    await fs.writeJson(path.join(libraryProject, 'package.json'), {
      name: '@acme/sdk',
      main: './dist/index.js',
      scripts: {
        build: 'tsx build.ts',
        test: 'vitest run',
      },
      devDependencies: {
        vitest: '^4.0.0',
      },
    });

    expect(detectFrontendFrameworkFromProject(libraryProject)).toMatchObject({
      key: 'unknown',
    });
    expect(detectBackendFrameworkFromProject(libraryProject)).toMatchObject({
      key: 'node',
      runtime: 'node',
    });
    expect(
      detectFrontendFrameworkFromProject(libraryProject, {
        framework: 'vite',
        kit_name: 'adopted.vite',
        adoption: { managed_by: 'workspai', mode: 'linked' },
      })
    ).toMatchObject({ key: 'unknown' });
  });

  it('keeps frontend command capabilities governed by package.json scripts', async () => {
    const projectPath = await createTempProject('next-capabilities');
    await fs.writeJson(path.join(projectPath, 'package.json'), {
      dependencies: {
        next: '^15.0.0',
      },
      scripts: {
        test: 'vitest',
        build: 'next build',
      },
    });
    await fs.ensureDir(path.join(projectPath, '.rapidkit'));
    await fs.writeJson(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: 'next-capabilities',
      runtime: 'node',
      framework: 'nextjs',
      module_support: false,
    });

    const capabilities = resolveProjectCommandCapabilities(projectPath);
    expect(capabilities).toMatchObject({
      runtime: 'node',
      framework: 'nextjs',
      frameworkDisplayName: 'Next.js',
      frameworkSupportTier: 'extended',
      runtimeSupportTier: 'extended',
    });
    expect(capabilities.supportedCommands).toContain('build');
    expect(capabilities.supportedCommands).toContain('test');
    expect(capabilities.supportedCommands).not.toContain('dev');
    expect(capabilities.unsupportedCommands).toContain('add');
  });
});
