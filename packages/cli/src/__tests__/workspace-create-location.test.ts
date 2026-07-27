import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { describe, expect, it } from 'vitest';

import {
  assertIndependentWorkspaceTarget,
  buildWorkspaceCreateLocationChoices,
  formatWorkspaceCdCommand,
  resolveWorkspaceOutputParent,
  resolveWorkspaceParentFromArgs,
  resolveWorkspaceTargetPath,
  shouldBlockExistingWorkspaceName,
} from '../utils/workspace-create-location.js';
import { getCanonicalWorkspacesDirectory } from '../utils/workspace-paths.js';

describe('workspace-create-location', () => {
  it('resolves --here to the current working directory', () => {
    expect(resolveWorkspaceParentFromArgs(['create', 'workspace', '--here'], '/tmp/tests')).toBe(
      path.resolve('/tmp/tests')
    );
  });

  it('resolves --output to an explicit parent directory', () => {
    expect(
      resolveWorkspaceParentFromArgs(
        ['create', 'workspace', 'my-ws', '--output', '/tmp/custom'],
        '/tmp/tests'
      )
    ).toBe(path.resolve('/tmp/custom'));
  });

  it('builds managed and custom workspace target paths', () => {
    const homeDir = '/home/test-user';
    const expectedManaged = path.join(getCanonicalWorkspacesDirectory(homeDir), 'my-ws');
    expect(
      resolveWorkspaceTargetPath('my-ws', {
        argv: ['create', 'workspace', 'my-ws'],
        homeDir,
      })
    ).toBe(expectedManaged);

    const expectedCustom = path.resolve('/tmp/custom', 'my-ws');
    expect(
      resolveWorkspaceTargetPath('my-ws', {
        outputParent: '/tmp/custom',
      })
    ).toBe(expectedCustom);
  });

  it('formats cd commands with relative paths when possible', () => {
    const relativeCmd = formatWorkspaceCdCommand(
      path.join('/tmp/tests', 'my-workspace'),
      '/tmp/tests'
    );
    expect(relativeCmd).toBe('cd my-workspace');

    const absoluteCmd = formatWorkspaceCdCommand(
      path.join('/home/test-user/.workspai/workspaces', 'my-ws'),
      '/tmp/tests'
    );
    // On different platforms, paths are formatted differently, so just verify structure
    expect(absoluteCmd).toMatch(/^cd /);
    expect(absoluteCmd).toContain('my-ws');
  });

  it('defaults to managed home when --yes is set without location flags', async () => {
    const parent = await resolveWorkspaceOutputParent(['create', 'workspace', '--yes'], {
      interactive: false,
      homeDir: os.homedir(),
    });
    expect(parent).toBeUndefined();
  });

  it('does not offer the current directory while already inside a workspace', async () => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-create-location-'));
    const workspacePath = path.join(testRoot, 'current-workspace');
    const projectPath = path.join(workspacePath, 'project');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, '.workspai-workspace'),
      JSON.stringify({ signature: 'WORKSPAI_WORKSPACE', name: 'current-workspace' })
    );

    try {
      await expect(
        buildWorkspaceCreateLocationChoices(projectPath, '/home/test-user')
      ).resolves.toEqual([
        {
          value: 'managed',
          label: 'Managed home',
          hint: path.join('/home/test-user', '.workspai', 'workspaces'),
        },
      ]);
      await expect(
        resolveWorkspaceOutputParent(['create', 'workspace'], {
          cwd: projectPath,
          homeDir: '/home/test-user',
          interactive: true,
        })
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(testRoot, { recursive: true, force: true });
    }
  });

  it('rejects a workspace target nested below another workspace boundary', async () => {
    const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-nested-target-'));
    const workspacePath = path.join(testRoot, 'parent-workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, '.workspai-workspace'),
      JSON.stringify({ signature: 'WORKSPAI_WORKSPACE', name: 'parent-workspace' })
    );

    try {
      await expect(
        assertIndependentWorkspaceTarget(path.join(workspacePath, 'nested-workspace'))
      ).rejects.toThrow(/Workspai workspaces cannot be nested/);
      await expect(
        assertIndependentWorkspaceTarget(path.join(testRoot, 'sibling-workspace'))
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(testRoot, { recursive: true, force: true });
    }
  });

  it('does not block same-name workspaces in another parent when output parent is explicit', () => {
    expect(
      shouldBlockExistingWorkspaceName(
        '/home/test-user/.workspai/workspaces/my-workspace',
        '/tmp/tests/my-workspace',
        { outputParent: '/tmp/tests' }
      )
    ).toBe(false);
  });

  it('keeps managed-home duplicate protection when output parent is implicit', () => {
    expect(
      shouldBlockExistingWorkspaceName(
        '/home/test-user/.workspai/workspaces/my-workspace',
        '/home/test-user/.workspai/workspaces/my-workspace-2'
      )
    ).toBe(true);
  });

  it('always blocks when the existing workspace path is the target path', () => {
    expect(
      shouldBlockExistingWorkspaceName('/tmp/tests/my-workspace', '/tmp/tests/my-workspace', {
        outputParent: '/tmp/tests',
      })
    ).toBe(true);
  });
});
