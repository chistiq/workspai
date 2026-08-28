import path from 'path';
import os from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildWorkspaceModelCached } from '../workspace-model.js';
import {
  WORKSPACE_MODEL_CACHE_PATH,
  computeProjectSignatures,
  readWorkspaceModelCache,
} from '../workspace-model-cache.js';

const execFileAsync = promisify(execFile);
const gitExecutable = process.env.GIT_EXECUTABLE || 'git';

let workspacePath: string;

async function writeProject(name: string, pkg: Record<string, unknown>): Promise<void> {
  const dir = path.join(workspacePath, name);
  await fsExtra.ensureDir(dir);
  await fsExtra.writeJson(path.join(dir, 'package.json'), pkg, { spaces: 2 });
}

beforeEach(async () => {
  workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-model-cache-'));
  await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
  await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
    workspace_name: 'cache-fixture',
  });
  await writeProject('api', { name: 'api', version: '1.0.0' });
  await writeProject('web', { name: 'web', version: '1.0.0', dependencies: { api: '1.0.0' } });
});

afterEach(async () => {
  await fsExtra.remove(workspacePath);
});

describe('workspace model cache (1.15)', () => {
  it('reports disabled when cache is not requested', async () => {
    const result = await buildWorkspaceModelCached({ workspacePath });
    expect(result.cache).toBe('disabled');
    expect(await fsExtra.pathExists(path.join(workspacePath, WORKSPACE_MODEL_CACHE_PATH))).toBe(
      false
    );
  });

  it('misses on first run, then hits with an identical model when inputs are unchanged', async () => {
    const first = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(first.cache).toBe('miss');
    const cacheEnvelope = await readWorkspaceModelCache(workspacePath);
    expect(cacheEnvelope?.inputsHash).toBeTruthy();

    const second = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(second.cache).toBe('hit');
    // Cache hit returns the stored model byte-for-byte (including generatedAt).
    expect(JSON.stringify(second.model)).toBe(JSON.stringify(first.model));
  });

  it('invalidates the cache when a manifest changes', async () => {
    const first = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(first.cache).toBe('miss');

    await writeProject('web', {
      name: 'web',
      version: '2.0.0',
      dependencies: { api: '1.0.0', lodash: '^4.0.0' },
    });

    const second = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(second.cache).toBe('miss');
  });

  it('invalidates the cache when a suffix-based ecosystem manifest is added', async () => {
    await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect((await buildWorkspaceModelCached({ workspacePath, cache: true })).cache).toBe('hit');

    await fsExtra.outputFile(
      path.join(workspacePath, 'api', 'api.gemspec'),
      'Gem::Specification.new { |spec| spec.name = "api" }\n'
    );

    expect((await buildWorkspaceModelCached({ workspacePath, cache: true })).cache).toBe('miss');
  });

  it('invalidates the cache when a project is added', async () => {
    await buildWorkspaceModelCached({ workspacePath, cache: true });
    await writeProject('worker', { name: 'worker', version: '1.0.0' });
    const next = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(next.cache).toBe('miss');
  });

  it('tracks a project declared only by an external workspace contract path', async () => {
    const externalRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-external-cache-'));
    try {
      await fsExtra.writeJson(path.join(externalRoot, 'package.json'), {
        name: 'external-api',
        version: '1.0.0',
      });
      await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.contract.json'), {
        schemaVersion: 1,
        kind: 'rapidkit.workspace.contract',
        generatedAt: '2026-08-28T00:00:00.000Z',
        workspace: { name: 'cache-fixture' },
        projects: [
          {
            slug: 'external-api',
            relativePath: '../external-api',
            externalPath: externalRoot,
            modules: [],
            ports: [],
            contracts: {
              owns: [],
              apis: [],
              publishes: [],
              consumes: [],
              dependsOn: [],
              env: [],
            },
          },
        ],
      });

      const first = await buildWorkspaceModelCached({ workspacePath, cache: true });
      expect(first.cache).toBe('miss');
      expect(first.model.projects.some((project) => project.name === 'external-api')).toBe(true);
      expect((await buildWorkspaceModelCached({ workspacePath, cache: true })).cache).toBe('hit');

      await fsExtra.writeJson(path.join(externalRoot, 'package.json'), {
        name: 'external-api',
        version: '2.0.0',
      });
      expect((await buildWorkspaceModelCached({ workspacePath, cache: true })).cache).toBe('miss');
    } finally {
      await fsExtra.remove(externalRoot);
    }
  });

  it('rebuilds a legacy cache that lacks the canonical projectTopology field', async () => {
    await buildWorkspaceModelCached({ workspacePath, cache: true });
    const cachePath = path.join(workspacePath, WORKSPACE_MODEL_CACHE_PATH);
    const envelope = await fsExtra.readJson(cachePath);
    delete envelope.model.projectTopology;
    await fsExtra.writeJson(cachePath, envelope, { spaces: 2 });

    const next = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(next.cache).toBe('miss');
    expect(next.model.projectTopology).toEqual(next.model.graph);
  });

  it('rebuilds a cache produced by an older semantic producer revision', async () => {
    await buildWorkspaceModelCached({ workspacePath, cache: true });
    const cachePath = path.join(workspacePath, WORKSPACE_MODEL_CACHE_PATH);
    const envelope = await fsExtra.readJson(cachePath);
    envelope.producerRevision = 'workspace-model-producer.v1';
    await fsExtra.writeJson(cachePath, envelope, { spaces: 2 });

    const next = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(next.cache).toBe('miss');
    const refreshed = await readWorkspaceModelCache(workspacePath);
    expect(refreshed?.producerRevision).toBe('workspace-model-producer.v3');
  });

  it('uses Git content identity while detecting dirty and untracked polyglot source', async () => {
    await fsExtra.outputFile(path.join(workspacePath, 'api', 'app.rb'), 'class App; end\n');
    await execFileAsync(gitExecutable, ['init'], { cwd: workspacePath });
    await execFileAsync(gitExecutable, ['config', 'user.email', 'tests@workspai.dev'], {
      cwd: workspacePath,
    });
    await execFileAsync(gitExecutable, ['config', 'user.name', 'Workspai Tests'], {
      cwd: workspacePath,
    });
    await execFileAsync(gitExecutable, ['add', '.'], { cwd: workspacePath });
    await execFileAsync(gitExecutable, ['commit', '-m', 'fixture'], { cwd: workspacePath });

    const initial = await computeProjectSignatures(workspacePath, [
      path.join(workspacePath, 'api'),
    ]);
    await fsExtra.outputFile(
      path.join(workspacePath, 'api', 'app.rb'),
      'class App; def ready? = true; end\n'
    );
    const dirty = await computeProjectSignatures(workspacePath, [path.join(workspacePath, 'api')]);
    await fsExtra.outputFile(
      path.join(workspacePath, 'api', 'worker.go'),
      'package api\nfunc Ready() bool { return true }\n'
    );
    const untracked = await computeProjectSignatures(workspacePath, [
      path.join(workspacePath, 'api'),
    ]);

    expect(dirty.api).not.toBe(initial.api);
    expect(untracked.api).not.toBe(dirty.api);
  });
});
