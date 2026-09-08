import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assessWorkspaceBootstrapEligibility } from '../utils/workspace-bootstrap-eligibility.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('assessWorkspaceBootstrapEligibility', () => {
  it('accepts an empty explicit workspace target', async () => {
    const target = await makeTempDir('workspai-bootstrap-empty-');
    await expect(assessWorkspaceBootstrapEligibility(target)).resolves.toEqual({
      status: 'eligible',
      reason: 'empty',
    });
  });

  it('accepts a parent containing only the project being adopted', async () => {
    const parent = await makeTempDir('workspai-bootstrap-parent-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);

    await expect(
      assessWorkspaceBootstrapEligibility(parent, { containedProjectPath: projectPath })
    ).resolves.toEqual({
      status: 'eligible',
      reason: 'single-project-container',
    });
  });

  it('does not treat a non-empty explicit workspace target as clean', async () => {
    const target = await makeTempDir('workspai-bootstrap-explicit-nonempty-');
    await fs.mkdir(path.join(target, 'my-project'));

    await expect(assessWorkspaceBootstrapEligibility(target)).resolves.toMatchObject({
      status: 'not-clean',
      conflicts: ['my-project/'],
    });
  });

  it('rejects a parent containing siblings or root files', async () => {
    const parent = await makeTempDir('workspai-bootstrap-dirty-parent-');
    const projectPath = path.join(parent, 'my-project');
    await fs.mkdir(projectPath);
    await fs.mkdir(path.join(parent, 'other-project'));
    await fs.writeFile(path.join(parent, '.gitignore'), 'keep-me\n');

    const assessment = await assessWorkspaceBootstrapEligibility(parent, {
      containedProjectPath: projectPath,
    });
    expect(assessment).toMatchObject({ status: 'not-clean' });
    if (assessment.status !== 'not-clean') return;
    expect(assessment.conflicts).toEqual(['.gitignore', 'my-project/', 'other-project/']);
  });

  it('accepts an existing canonical workspace regardless of its projects', async () => {
    const target = await makeTempDir('workspai-bootstrap-existing-');
    await fs.writeFile(path.join(target, '.workspai-workspace'), '{}');
    await fs.mkdir(path.join(target, 'my-project'));

    await expect(assessWorkspaceBootstrapEligibility(target)).resolves.toEqual({
      status: 'valid-workspace',
    });
  });

  it('rejects a symbolic-link target before trusting workspace markers', async () => {
    const realWorkspace = await makeTempDir('workspai-bootstrap-real-');
    await fs.writeFile(path.join(realWorkspace, '.workspai-workspace'), '{}');
    const linkParent = await makeTempDir('workspai-bootstrap-link-parent-');
    const linkPath = path.join(linkParent, 'workspace-link');
    await fs.symlink(realWorkspace, linkPath, 'dir');

    await expect(assessWorkspaceBootstrapEligibility(linkPath)).resolves.toEqual({
      status: 'not-clean',
      conflicts: ['path is a symbolic link'],
    });
  });
});
