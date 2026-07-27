import path from 'path';
import os from 'os';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildWorkspaceModelIncremental } from '../workspace-model.js';

let workspacePath: string;

async function writeProject(name: string, pkg: Record<string, unknown>): Promise<void> {
  const dir = path.join(workspacePath, name);
  await fsExtra.ensureDir(dir);
  await fsExtra.writeJson(path.join(dir, 'package.json'), pkg, { spaces: 2 });
}

async function writeSource(project: string, file: string, content: string): Promise<void> {
  const filePath = path.join(workspacePath, project, file);
  await fsExtra.ensureDir(path.dirname(filePath));
  await fsExtra.writeFile(filePath, content, 'utf8');
}

beforeEach(async () => {
  workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-model-incr-'));
  await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
  await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
    workspace_name: 'incremental-fixture',
  });
  await writeProject('api', { name: 'api', version: '1.0.0' });
  await writeProject('web', { name: 'web', version: '1.0.0', dependencies: { api: '1.0.0' } });
  await writeSource('web', 'src/index.js', "import './local';\n");
});

afterEach(async () => {
  await fsExtra.remove(workspacePath);
});

describe('workspace model incremental (1.16)', () => {
  it('builds full on first run, then reports unchanged with an identical model', async () => {
    const first = await buildWorkspaceModelIncremental({ workspacePath });
    expect(first.mode).toBe('full');

    const second = await buildWorkspaceModelIncremental({ workspacePath });
    expect(second.mode).toBe('unchanged');
    expect(JSON.stringify(second.model)).toBe(JSON.stringify(first.model));
  });

  it('does an incremental rebuild when one project content changes (no add/remove)', async () => {
    await buildWorkspaceModelIncremental({ workspacePath });

    // Change web's source only (no project add/remove, no manifest change).
    await writeSource('web', 'src/index.js', "import './local';\nconst x = 1;\n");

    const next = await buildWorkspaceModelIncremental({ workspacePath });
    expect(next.mode).toBe('incremental');
    // Graph still present and consistent.
    expect(next.model.projectTopology?.nodes.map((node) => node.id).sort()).toEqual(['api', 'web']);
    expect(next.model.graph).toEqual(next.model.projectTopology);
  });

  it('handles an added project incrementally (reuse unchanged models, full graph re-scan)', async () => {
    await buildWorkspaceModelIncremental({ workspacePath });
    await writeProject('worker', { name: 'worker', version: '1.0.0' });

    const next = await buildWorkspaceModelIncremental({ workspacePath });
    expect(next.mode).toBe('incremental');
    expect(next.model.projectTopology?.nodes.some((node) => node.id === 'worker')).toBe(true);
  });

  it('rebuilds fully when workspace-level files change', async () => {
    await buildWorkspaceModelIncremental({ workspacePath });
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'renamed-fixture',
    });

    const next = await buildWorkspaceModelIncremental({ workspacePath });
    expect(next.mode).toBe('full');
    expect(next.model.workspace.name).toBe('renamed-fixture');
  });

  it('rebuilds fully when a legacy cache lacks canonical projectTopology', async () => {
    await buildWorkspaceModelIncremental({ workspacePath });
    const cachePath = path.join(workspacePath, '.workspai', 'cache', 'workspace-model.v1.json');
    const envelope = await fsExtra.readJson(cachePath);
    delete envelope.model.projectTopology;
    await fsExtra.writeJson(cachePath, envelope, { spaces: 2 });

    const next = await buildWorkspaceModelIncremental({ workspacePath });
    expect(next.mode).toBe('full');
    expect(next.model.projectTopology).toEqual(next.model.graph);
  });

  it('preserves the package-dep edge after an incremental rebuild', async () => {
    const full = await buildWorkspaceModelIncremental({ workspacePath });
    const fullEdge = full.model.projectTopology?.edges.find(
      (edge) => edge.from === 'web' && edge.to === 'api' && edge.kind === 'package-dep'
    );
    expect(fullEdge).toBeTruthy();

    await writeSource('api', 'src/main.js', 'export const main = 1;\n');
    const incremental = await buildWorkspaceModelIncremental({ workspacePath });
    expect(incremental.mode).toBe('incremental');
    const edge = incremental.model.projectTopology?.edges.find(
      (item) => item.from === 'web' && item.to === 'api' && item.kind === 'package-dep'
    );
    expect(edge).toBeTruthy();
  });
});
