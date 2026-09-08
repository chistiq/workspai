import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAdoptOutsideWorkspacePromptChoices,
  defaultAdoptOutsideWorkspacePromptIndex,
  resolveExplicitAdoptWorkspaceTarget,
  resolveOutsideWorkspaceAdoptTarget,
} from '../adopt-workspace-resolution.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('resolveExplicitAdoptWorkspaceTarget', () => {
  it('bootstraps an eligible workspace path during adopt', async () => {
    const parent = await makeTempDir('rapidkit-adopt-explicit-parent-');
    const workspacePath = path.join(parent, 'empty-workspace');
    await fs.mkdir(workspacePath);

    const resolution = await resolveExplicitAdoptWorkspaceTarget(workspacePath, { dryRun: true });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.result).toMatchObject({
      workspacePath,
      resolution: 'explicit-bootstrap',
      willBootstrapWorkspace: false,
      bootstrapTargetPath: workspacePath,
    });
  });

  it('rejects a dirty explicit workspace path', async () => {
    const parent = await makeTempDir('rapidkit-adopt-explicit-dirty-');
    await fs.writeFile(path.join(parent, 'notes.txt'), 'not allowed');

    const resolution = await resolveExplicitAdoptWorkspaceTarget(parent, { dryRun: true });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.code).toBe('workspace.adopt.target-not-clean');
  });
});

describe('resolveOutsideWorkspaceAdoptTarget', () => {
  it('offers only managed-default and safe parent ownership', () => {
    expect(buildAdoptOutsideWorkspacePromptChoices()).toEqual([
      {
        name: 'Link it to the managed default workspace',
        value: 'managed',
      },
      {
        name: 'Turn the parent folder into a workspace (recommended)',
        value: 'parent',
      },
    ]);
    expect(defaultAdoptOutsideWorkspacePromptIndex()).toBe(1);
  });

  it('resolves parent bootstrap for sibling projects', async () => {
    const parent = await makeTempDir('rapidkit-adopt-parent-bootstrap-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, 'package.json'), '{"name":"demo"}');

    const resolution = await resolveOutsideWorkspaceAdoptTarget({
      sourcePath: projectPath,
      outsideWorkspaceMode: 'parent',
      dryRun: true,
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.result).toMatchObject({
      workspacePath: parent,
      resolution: 'parent-bootstrap',
      bootstrapTargetPath: parent,
    });
  });

  it('falls back to managed default workspace when requested', async () => {
    const parent = await makeTempDir('rapidkit-adopt-managed-default-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);

    const resolution = await resolveOutsideWorkspaceAdoptTarget({
      sourcePath: projectPath,
      outsideWorkspaceMode: 'managed',
      dryRun: true,
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.result.resolution).toBe('default-auto');
    expect(resolution.result.usedDefaultWorkspace).toBe(true);
  });

  it('rejects parent bootstrap when the parent is not a raw single-project container', async () => {
    const parent = await makeTempDir('rapidkit-adopt-parent-dirty-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.mkdir(path.join(parent, 'another-project'));

    const resolution = await resolveOutsideWorkspaceAdoptTarget({
      sourcePath: projectPath,
      outsideWorkspaceMode: 'parent',
      dryRun: true,
    });

    expect(resolution).toMatchObject({
      ok: false,
      code: 'workspace.adopt.parent-not-clean',
    });
  });
});
