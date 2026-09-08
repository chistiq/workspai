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

  it('reclassifies managed metadata when a newly supported root manifest appears', async () => {
    const rubyProject = path.join(workspacePath, 'ruby-library');
    await fsExtra.outputJson(path.join(rubyProject, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'ruby-library',
      runtime: 'unknown',
      framework: 'unknown',
      import: { managed_by: 'workspai', source_type: 'local-folder' },
    });
    const first = await buildWorkspaceModelIncremental({ workspacePath });
    expect(first.model.projects.find((project) => project.name === 'ruby-library')?.runtime).toBe(
      'unknown'
    );

    await fsExtra.outputFile(
      path.join(rubyProject, 'ruby-library.gemspec'),
      'Gem::Specification.new { |spec| spec.name = "ruby-library" }\n'
    );
    const next = await buildWorkspaceModelIncremental({ workspacePath });

    expect(next.mode).toBe('incremental');
    expect(next.model.projects.find((project) => project.name === 'ruby-library')).toMatchObject({
      runtime: 'ruby',
      framework: 'ruby',
    });
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

  it('incrementally rebuilds when source changes in a contract-only external project', async () => {
    const externalRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-external-incr-'));
    try {
      await fsExtra.writeJson(path.join(externalRoot, 'package.json'), {
        name: 'external-worker',
        version: '1.0.0',
      });
      await fsExtra.outputFile(
        path.join(externalRoot, 'src', 'worker.ts'),
        'export const v = 1;\n'
      );
      await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'workspace.contract.json'), {
        schemaVersion: 1,
        kind: 'rapidkit.workspace.contract',
        generatedAt: '2026-08-28T00:00:00.000Z',
        workspace: { name: 'incremental-fixture' },
        projects: [
          {
            slug: 'external-worker',
            relativePath: '../external-worker',
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

      const first = await buildWorkspaceModelIncremental({ workspacePath });
      expect(first.mode).toBe('full');
      expect(first.model.projects.some((project) => project.name === 'external-worker')).toBe(true);
      expect((await buildWorkspaceModelIncremental({ workspacePath })).mode).toBe('unchanged');

      await fsExtra.outputFile(
        path.join(externalRoot, 'src', 'worker.ts'),
        'export const v = 2;\n'
      );
      expect((await buildWorkspaceModelIncremental({ workspacePath })).mode).toBe('incremental');
    } finally {
      await fsExtra.remove(externalRoot);
    }
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
