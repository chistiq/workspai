import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listSupportedNodeLifecycleCommands,
  resolveNodeLifecycleScript,
} from '../utils/node-lifecycle-scripts';
import { buildProjectAwareRuntimeCommandSupport } from '../utils/runtime-lifecycle-probes';
import { getFrontendLifecycleScriptCandidates } from '../utils/frontend-framework-contract';

const tempDirs: string[] = [];

async function createTempProject(
  name: string,
  scripts: Record<string, string> = {}
): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `rk-node-lifecycle-${name}-`));
  tempDirs.push(projectPath);
  await fs.writeJson(path.join(projectPath, 'package.json'), { scripts }, { spaces: 2 });
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

describe('node-lifecycle-scripts', () => {
  it('resolves direct package.json script names first', async () => {
    const projectPath = await createTempProject('direct', {
      dev: 'next dev',
      build: 'next build',
    });

    expect(resolveNodeLifecycleScript(projectPath, 'dev', { framework: 'nextjs' })).toMatchObject({
      scriptName: 'dev',
      source: 'package.json',
    });
  });

  it('maps vite preview to start when start script is missing', async () => {
    const projectPath = await createTempProject('vite-preview', {
      dev: 'vite',
      preview: 'vite preview',
      build: 'vite build',
    });

    expect(resolveNodeLifecycleScript(projectPath, 'start', { framework: 'vite' })).toMatchObject({
      scriptName: 'preview',
      source: 'framework-candidate',
    });
  });

  it('maps create-react-app start script to dev', async () => {
    const projectPath = await createTempProject('cra', {
      start: 'react-scripts start',
      build: 'react-scripts build',
    });

    expect(resolveNodeLifecycleScript(projectPath, 'dev', { framework: 'react' })).toMatchObject({
      scriptName: 'start',
      source: 'framework-candidate',
    });
  });

  it('falls back to nestjs start:dev for dev when dev script is missing', async () => {
    const projectPath = await createTempProject('nestjs', {
      'start:dev': 'nest start --watch',
      build: 'nest build',
      test: 'jest',
    });

    expect(resolveNodeLifecycleScript(projectPath, 'dev', { framework: 'nestjs' })).toMatchObject({
      scriptName: 'start:dev',
      source: 'framework-candidate',
    });
  });

  it('maps established monorepo lifecycle aliases without requiring wrapper scripts', async () => {
    const projectPath = await createTempProject('monorepo-aliases', {
      watch: 'npm-run-all --parallel watch:*',
      compile: 'gulp compile',
      eslint: 'node build/eslint.js',
    });

    expect(resolveNodeLifecycleScript(projectPath, 'dev')).toMatchObject({
      scriptName: 'watch',
      source: 'generic-candidate',
    });
    expect(resolveNodeLifecycleScript(projectPath, 'build')).toMatchObject({
      scriptName: 'compile',
      source: 'generic-candidate',
    });
    expect(resolveNodeLifecycleScript(projectPath, 'lint')).toMatchObject({
      scriptName: 'eslint',
      source: 'generic-candidate',
    });
  });

  it('lists only commands with resolvable scripts', async () => {
    const projectPath = await createTempProject('partial', {
      dev: 'next dev',
      build: 'next build',
    });

    expect(listSupportedNodeLifecycleCommands(projectPath, { framework: 'nextjs' })).toEqual([
      'dev',
      'build',
    ]);
  });

  it('builds project-aware runtime command support from package scripts', async () => {
    const projectPath = await createTempProject('capabilities', {
      dev: 'astro dev',
      build: 'astro build',
      lint: 'eslint .',
    });

    const support = buildProjectAwareRuntimeCommandSupport({
      runtime: 'node',
      moduleSupport: false,
      projectPath,
      framework: 'astro',
    });

    expect(support.lifecycleCommands).toEqual(['build', 'dev', 'help', 'init', 'lint']);
    expect(support.unsupportedLifecycleCommands).toEqual(['format', 'start', 'test']);
  });
});

describe('frontend lifecycle script candidates', () => {
  it('exposes framework-specific lifecycle script candidates', () => {
    expect(getFrontendLifecycleScriptCandidates('vite', 'start')).toEqual(['preview', 'start']);
    expect(getFrontendLifecycleScriptCandidates('angular', 'dev')).toEqual(['start', 'serve']);
  });
});
