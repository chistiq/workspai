import path from 'path';
import os from 'os';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildWorkspaceModelCached } from '../workspace-model.js';
import { WORKSPACE_MODEL_CACHE_PATH, readWorkspaceModelCache } from '../workspace-model-cache.js';

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

  it('invalidates the cache when a project is added', async () => {
    await buildWorkspaceModelCached({ workspacePath, cache: true });
    await writeProject('worker', { name: 'worker', version: '1.0.0' });
    const next = await buildWorkspaceModelCached({ workspacePath, cache: true });
    expect(next.cache).toBe('miss');
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
});
