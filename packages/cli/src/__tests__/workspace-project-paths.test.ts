import path from 'path';
import os from 'os';
import fsExtra from 'fs-extra';
import { describe, expect, it } from 'vitest';

import {
  resolveWorkspaceProjectFilesystemPath,
  publishableWorkspaceProjectIdentity,
  resolveWorkspaceProjectPaths,
  workspaceProjectScopeIdentities,
} from '../utils/workspace-project-paths';

describe('resolveWorkspaceProjectPaths', () => {
  it('uses in-workspace relative paths for imported projects', () => {
    const workspacePath = '/tmp/workspace';
    const projectPath = path.join(workspacePath, 'orders-api');

    expect(
      resolveWorkspaceProjectPaths({
        workspacePath,
        projectPath,
        projectName: 'orders-api',
      })
    ).toEqual({
      relativePath: 'orders-api',
      contractRelativePath: 'orders-api',
      isExternal: false,
    });
  });

  it('uses external contract aliases for adopted projects outside the workspace tree', () => {
    const workspacePath = '/tmp/workspace';
    const projectPath = '/tmp/external-next-app';

    expect(
      resolveWorkspaceProjectPaths({
        workspacePath,
        projectPath,
        projectName: 'portal-web',
      })
    ).toEqual({
      relativePath: '../external-next-app',
      contractRelativePath: 'external/portal-web',
      isExternal: true,
    });
  });

  it('resolves portable external identities through the workspace contract', async () => {
    const workspacePath = path.join(os.tmpdir(), `workspai-project-paths-${process.pid}`);
    const projectPath = path.join(os.tmpdir(), `workspai-external-app-${process.pid}`);
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.ensureDir(projectPath);
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      kind: 'rapidkit.workspace.contract',
      schemaVersion: 1,
      workspace: { name: 'probe' },
      projects: [
        {
          slug: 'portal-web',
          relativePath: 'external/portal-web',
          externalPath: projectPath,
        },
      ],
    });

    try {
      expect(resolveWorkspaceProjectFilesystemPath(workspacePath, 'external/portal-web')).toBe(
        path.resolve(projectPath)
      );
      expect(resolveWorkspaceProjectFilesystemPath(workspacePath, '../still-legacy')).toBe(
        path.resolve(workspacePath, '../still-legacy')
      );
      expect(
        publishableWorkspaceProjectIdentity({
          workspacePath,
          projectPath,
          projectName: 'portal-web',
          declaredRelativePath: '../../../home/opendesxi/Documents/InWork/Reference/grpc',
        })
      ).toBe('external/portal-web');
      expect(
        workspaceProjectScopeIdentities({
          workspacePath,
          projectPath,
          declaredName: 'portal-web',
        })
      ).toEqual(
        expect.arrayContaining(['external/portal-web', 'portal-web', path.basename(projectPath)])
      );
    } finally {
      await fsExtra.remove(workspacePath);
      await fsExtra.remove(projectPath);
    }
  });

  it('resolves rewritten portable identities from leftover leaked contract relatives', async () => {
    const workspacePath = path.join(os.tmpdir(), `workspai-project-paths-leftover-${process.pid}`);
    const projectPath = path.join(os.tmpdir(), `workspai-leftover-app-${process.pid}`);
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.ensureDir(projectPath);
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      kind: 'rapidkit.workspace.contract',
      schemaVersion: 1,
      workspace: { name: 'probe' },
      projects: [
        {
          slug: 'portal-web',
          relativePath: '../leftover-app',
          externalPath: projectPath,
        },
      ],
    });

    try {
      expect(resolveWorkspaceProjectFilesystemPath(workspacePath, 'external/portal-web')).toBe(
        path.resolve(projectPath)
      );
    } finally {
      await fsExtra.remove(workspacePath);
      await fsExtra.remove(projectPath);
    }
  });
});
