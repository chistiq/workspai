import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveWorkspaceProject,
  createWorkspaceSnapshot,
  deleteWorkspaceProject,
  inspectWorkspaceSnapshot,
  listArchivedProjects,
  listWorkspaceSnapshots,
  restoreArchivedProject,
  restoreWorkspaceSnapshot,
} from '../workspace-snapshot.js';
import { writeProjectWorkspaceLink } from '../project-workspace-link.js';

describe('workspace-snapshot lifecycle', () => {
  let workspacePath: string;
  let originalCwd: string;
  let externalProjectPath: string | null;

  beforeEach(async () => {
    originalCwd = process.cwd();
    externalProjectPath = null;
    workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-snapshot-ws-'));
    await fsExtra.writeFile(path.join(workspacePath, '.rapidkit-workspace'), '{}');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'snapshot-workspace',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'orders', '.rapidkit', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });
    await fsExtra.writeFile(
      path.join(workspacePath, 'orders', 'package.json'),
      '{"name":"orders"}'
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (externalProjectPath && (await fsExtra.pathExists(externalProjectPath))) {
      await fsExtra.remove(externalProjectPath);
    }
    if (workspacePath && (await fsExtra.pathExists(workspacePath))) {
      await fsExtra.remove(workspacePath);
    }
  });

  it('creates, lists, and inspects snapshots from an adopted external project', async () => {
    externalProjectPath = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rapidkit-snapshot-adopted-')
    );
    await fsExtra.outputFile(path.join(workspacePath, '.workspai-workspace'), 'workspace\n');
    await fsExtra.outputJson(path.join(externalProjectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'external-service',
      runtime: 'go',
    });
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'snapshot-workspace', profile: 'polyglot' },
      projects: [
        {
          slug: 'external-service',
          relativePath: 'external/external-service',
          externalPath: externalProjectPath,
          relationship: 'adopted',
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
    await writeProjectWorkspaceLink({
      workspacePath,
      projectPath: externalProjectPath,
      projectName: 'external-service',
      relationship: 'adopted',
    });
    process.chdir(externalProjectPath);

    const created = await createWorkspaceSnapshot({ name: 'from-adopted-project' });
    expect(created.manifest.workspaceName).toBe('snapshot-workspace');
    expect(created.manifest.projects).toContainEqual({
      name: 'external-service',
      relativePath: 'external/external-service',
    });
    expect(
      await fsExtra.pathExists(
        path.join(created.snapshotPath, 'files', '.workspai', 'workspace.contract.json')
      )
    ).toBe(true);
    expect((await listWorkspaceSnapshots()).map((snapshot) => snapshot.name)).toContain(
      'from-adopted-project'
    );
    await expect(inspectWorkspaceSnapshot({ name: 'from-adopted-project' })).resolves.toMatchObject(
      { manifest: { name: 'from-adopted-project' } }
    );
  });

  it('creates and lists metadata snapshots without copying project source files', async () => {
    const result = await createWorkspaceSnapshot({
      workspacePath,
      name: 'before-release',
      reason: 'release gate',
    });

    expect(result.manifest.name).toBe('before-release');
    expect(result.manifest.mode).toBe('metadata');
    expect(result.manifest.projects).toEqual([
      {
        name: 'orders',
        relativePath: 'orders',
      },
    ]);
    expect(
      await fsExtra.pathExists(
        path.join(result.snapshotPath, 'files', '.workspai', 'workspace.json')
      )
    ).toBe(true);
    expect(
      await fsExtra.pathExists(
        path.join(result.snapshotPath, 'files', '.rapidkit', 'workspace.json')
      )
    ).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(result.snapshotPath, 'files', 'orders', 'package.json'))
    ).toBe(false);

    const snapshots = await listWorkspaceSnapshots({ workspacePath });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].name).toBe('before-release');

    const inspected = await inspectWorkspaceSnapshot({ workspacePath, name: 'before-release' });
    expect(inspected.estimatedFileCount).toBeGreaterThan(0);
    expect(inspected.estimatedBytes).toBeGreaterThan(0);
  });

  it('fails closed for duplicate or missing snapshots and ignores unrelated snapshot entries', async () => {
    expect(await listWorkspaceSnapshots({ workspacePath })).toEqual([]);
    await expect(inspectWorkspaceSnapshot({ workspacePath, name: 'missing' })).rejects.toThrow(
      'Snapshot not found: missing'
    );
    await expect(
      restoreWorkspaceSnapshot({ workspacePath, name: 'missing', dryRun: true })
    ).rejects.toThrow('Snapshot not found: missing');

    await createWorkspaceSnapshot({ workspacePath, name: 'duplicate' });
    await expect(createWorkspaceSnapshot({ workspacePath, name: 'duplicate' })).rejects.toThrow(
      'Snapshot already exists: duplicate'
    );
    const root = path.join(workspacePath, '.workspai', 'snapshots');
    await fsExtra.outputFile(path.join(root, 'README.txt'), 'manual notes');
    await fsExtra.ensureDir(path.join(root, 'manual-folder'));
    expect((await listWorkspaceSnapshots({ workspacePath })).map((entry) => entry.name)).toEqual([
      'duplicate',
    ]);
  });

  it('creates full snapshots without copying RapidKit operational history', async () => {
    await fsExtra.outputFile(
      path.join(workspacePath, '.rapidkit', 'snapshots', 'old', 'snapshot.json'),
      '{}'
    );
    await fsExtra.outputFile(
      path.join(workspacePath, '.rapidkit', 'archive', 'projects', 'old', 'rapidkit-archive.json'),
      '{}'
    );
    await fsExtra.outputFile(
      path.join(workspacePath, '.workspai', 'audit', 'events.jsonl'),
      '{"event":"old"}\n'
    );

    const result = await createWorkspaceSnapshot({
      workspacePath,
      name: 'full-before-upgrade',
      includeProjects: true,
      reason: 'full regression guard',
    });

    expect(result.manifest.mode).toBe('full');
    expect(
      await fsExtra.pathExists(path.join(result.snapshotPath, 'files', 'orders', 'package.json'))
    ).toBe(true);
    expect(
      await fsExtra.pathExists(
        path.join(result.snapshotPath, 'files', '.workspai', 'workspace.json')
      )
    ).toBe(true);
    expect(
      await fsExtra.pathExists(
        path.join(result.snapshotPath, 'files', '.rapidkit', 'workspace.json')
      )
    ).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(result.snapshotPath, 'files', '.rapidkit', 'snapshots'))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(result.snapshotPath, 'files', '.rapidkit', 'archive'))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(result.snapshotPath, 'files', '.workspai', 'audit'))
    ).toBe(false);
  });

  it('restores metadata snapshots only with force and creates a safety snapshot', async () => {
    await createWorkspaceSnapshot({ workspacePath, name: 'clean-config' });
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'broken-workspace',
    });

    await expect(restoreWorkspaceSnapshot({ workspacePath, name: 'clean-config' })).rejects.toThrow(
      /--force/
    );

    const dryRun = await restoreWorkspaceSnapshot({
      workspacePath,
      name: 'clean-config',
      dryRun: true,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.restoredPaths).toContain('.workspai');

    const restored = await restoreWorkspaceSnapshot({
      workspacePath,
      name: 'clean-config',
      force: true,
    });

    const workspaceJson = await fsExtra.readJson(
      path.join(workspacePath, '.workspai', 'workspace.json')
    );
    expect(workspaceJson.workspace_name).toBe('snapshot-workspace');
    expect(restored.safetySnapshotPath).toContain('pre-restore-clean-config');
  });

  it('archives projects with a safety snapshot and archive manifest', async () => {
    const result = await archiveWorkspaceProject({
      workspacePath,
      project: 'orders',
      reason: 'superseded by v2',
    });

    expect(result.action).toBe('archive');
    expect(result.dryRun).toBe(false);
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders'))).toBe(false);
    expect(result.archivePath).toBeTruthy();
    expect(result.manifestPath).toBeTruthy();
    expect(await fsExtra.pathExists(path.join(result.archivePath!, 'package.json'))).toBe(true);

    const manifest = await fsExtra.readJson(result.manifestPath!);
    expect(manifest.projectName).toBe('orders');
    expect(manifest.reason).toBe('superseded by v2');
    expect(result.safetySnapshotPath).toContain('pre-archive-orders');
    expect(
      await fsExtra.pathExists(
        path.join(result.safetySnapshotPath!, 'files', 'orders', 'package.json')
      )
    ).toBe(true);

    const archives = await listArchivedProjects({ workspacePath });
    expect(archives).toHaveLength(1);
    expect(archives[0].projectName).toBe('orders');
  });

  it('supports archive and restore planning without moving project bytes', async () => {
    expect(await listArchivedProjects({ workspacePath })).toEqual([]);
    const plannedArchive = await archiveWorkspaceProject({
      workspacePath,
      project: 'orders',
      dryRun: true,
      reason: 'planning',
    });
    expect(plannedArchive).toMatchObject({ action: 'archive', dryRun: true });
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders', 'package.json'))).toBe(true);

    const archived = await archiveWorkspaceProject({ workspacePath, project: 'orders' });
    const plannedRestore = await restoreArchivedProject({
      workspacePath,
      archive: archived.archivePath!,
      dryRun: true,
    });
    expect(plannedRestore).toMatchObject({ action: 'restore', dryRun: true });
    expect(await fsExtra.pathExists(archived.archivePath!)).toBe(true);
    await expect(
      restoreArchivedProject({ workspacePath, archive: 'missing-archive', dryRun: true })
    ).rejects.toThrow('Archived project not found');
  });

  it('resolves registered names independently of their directory basename for both dry-runs', async () => {
    const projectPath = path.join(workspacePath, 'orders');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai/imported-projects.json'), {
      version: 1,
      updatedAt: new Date().toISOString(),
      projects: [
        {
          name: 'service-alias',
          confidence: 'high',
          path: projectPath,
          relativePath: 'orders',
          stack: 'node',
          source: 'adopted-local',
          relationship: 'adopted',
          importedAt: new Date().toISOString(),
        },
      ],
    });
    for (const operation of [archiveWorkspaceProject, deleteWorkspaceProject]) {
      expect(
        await operation({ workspacePath, project: 'service-alias', dryRun: true })
      ).toMatchObject({ projectPath, dryRun: true });
    }
    expect(await fsExtra.pathExists(path.join(projectPath, 'package.json'))).toBe(true);
    const registryPath = path.join(workspacePath, '.workspai/imported-projects.json');
    const registry = await fsExtra.readJson(registryPath);
    await fsExtra.ensureDir(path.join(workspacePath, 'second-service'));
    registry.projects.push({
      ...registry.projects[0],
      path: path.join(workspacePath, 'second-service'),
      relativePath: 'second-service',
    });
    await fsExtra.writeJson(registryPath, registry);
    await expect(
      archiveWorkspaceProject({ workspacePath, project: 'service-alias', dryRun: true })
    ).rejects.toThrow('ambiguous');
  });

  it('rejects a directory symlink escaping the workspace even for a dry-run', async () => {
    const external = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'lifecycle-external-'));
    try {
      await fsExtra.ensureSymlink(external, path.join(workspacePath, 'escape'), 'junction');
      await expect(
        archiveWorkspaceProject({ workspacePath, project: 'escape', dryRun: true })
      ).rejects.toThrow('not a directory contained by the workspace');
    } finally {
      await fsExtra.remove(external);
    }
  });

  it('explains the lifecycle boundary for a registered external project', async () => {
    const externalPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-linked-project-'));
    try {
      await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'imported-projects.json'), {
        version: 1,
        updatedAt: new Date().toISOString(),
        projects: [
          {
            name: 'linked-sdk',
            path: externalPath,
            relativePath: 'external/linked-sdk',
            stack: 'unknown',
            confidence: 'low',
            source: 'adopted-local',
            relationship: 'adopted',
            importedAt: new Date().toISOString(),
          },
        ],
      });

      await expect(
        archiveWorkspaceProject({ workspacePath, project: 'linked-sdk', dryRun: true })
      ).rejects.toThrow(/linked external project.*Only managed projects/s);
    } finally {
      await fsExtra.remove(externalPath);
    }
  });

  it('refuses reserved archive manifest collisions without moving project data', async () => {
    await fsExtra.outputFile(
      path.join(workspacePath, 'orders', 'workspai-archive.json', 'sentinel.txt'),
      'keep me'
    );

    await expect(archiveWorkspaceProject({ workspacePath, project: 'orders' })).rejects.toThrow(
      /reserved archive manifest path/
    );
    expect(await fsExtra.readFile(path.join(workspacePath, 'orders', 'package.json'), 'utf8')).toBe(
      '{"name":"orders"}'
    );
    expect(
      await fsExtra.readFile(
        path.join(workspacePath, 'orders', 'workspai-archive.json', 'sentinel.txt'),
        'utf8'
      )
    ).toBe('keep me');
  });

  it('treats delete as archive by default and requires exact confirmation for permanent delete', async () => {
    const dryRun = await deleteWorkspaceProject({
      workspacePath,
      project: 'orders',
      dryRun: true,
    });
    expect(dryRun.action).toBe('archive');
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders'))).toBe(true);

    await expect(
      deleteWorkspaceProject({
        workspacePath,
        project: 'orders',
        permanent: true,
        confirm: 'wrong-name',
      })
    ).rejects.toThrow(/Permanent delete requires/);

    const deleted = await deleteWorkspaceProject({
      workspacePath,
      project: 'orders',
      permanent: true,
      confirm: 'orders',
    });

    expect(deleted.action).toBe('delete');
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders'))).toBe(false);
    expect(deleted.safetySnapshotPath).toContain('pre-delete-orders');
    expect(
      await fsExtra.pathExists(
        path.join(deleted.safetySnapshotPath!, 'files', 'orders', 'package.json')
      )
    ).toBe(true);

    const recovered = await restoreWorkspaceSnapshot({
      workspacePath,
      name: path.basename(deleted.safetySnapshotPath!),
      force: true,
    });
    expect(recovered.restoredPaths).toEqual(['orders']);
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders', 'package.json'))).toBe(true);
  });

  it('preserves an overwritten project as a selective recovery snapshot', async () => {
    const archived = await archiveWorkspaceProject({ workspacePath, project: 'orders' });
    await fsExtra.outputJson(path.join(workspacePath, 'orders', 'package.json'), {
      name: 'replacement-orders',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'orders', '.rapidkit', 'project.json'), {
      runtime: 'node',
    });

    const restored = await restoreArchivedProject({
      workspacePath,
      archive: archived.archivePath!,
      force: true,
    });

    expect((await fsExtra.readJson(path.join(workspacePath, 'orders', 'package.json'))).name).toBe(
      'orders'
    );
    expect(
      (
        await fsExtra.readJson(
          path.join(restored.safetySnapshotPath!, 'files', 'orders', 'package.json')
        )
      ).name
    ).toBe('replacement-orders');
  });

  it('restores full snapshots as an exact directory swap and retains the previous workspace', async () => {
    const snapshot = await createWorkspaceSnapshot({
      workspacePath,
      name: 'exact-full',
      includeProjects: true,
    });
    await fsExtra.outputFile(
      path.join(workspacePath, 'unexpected-after-snapshot.txt'),
      'remove me'
    );
    await fsExtra.outputJson(path.join(workspacePath, 'orders', 'package.json'), {
      name: 'mutated-orders',
    });

    const restored = await restoreWorkspaceSnapshot({
      workspacePath,
      name: snapshot.manifest.name,
      force: true,
    });

    expect(
      await fsExtra.pathExists(path.join(workspacePath, 'unexpected-after-snapshot.txt'))
    ).toBe(false);
    expect((await fsExtra.readJson(path.join(workspacePath, 'orders', 'package.json'))).name).toBe(
      'orders'
    );
    expect(restored.safetySnapshotPath).toBeTruthy();
    expect(
      await fsExtra.pathExists(
        path.join(restored.safetySnapshotPath!, 'unexpected-after-snapshot.txt')
      )
    ).toBe(true);
    await fsExtra.remove(restored.safetySnapshotPath!);
  });

  it('restores archived projects and writes audit events', async () => {
    const archived = await archiveWorkspaceProject({
      workspacePath,
      project: 'orders',
      reason: 'temporarily retired',
    });

    const restored = await restoreArchivedProject({
      workspacePath,
      archive: archived.archivePath!,
      reason: 'customer needs it again',
    });

    expect(restored.action).toBe('restore');
    expect(await fsExtra.pathExists(path.join(workspacePath, 'orders', 'package.json'))).toBe(true);
    expect(
      await fsExtra.pathExists(path.join(workspacePath, 'orders', 'workspai-archive.json'))
    ).toBe(false);
    expect(restored.manifestPath).toContain(path.join('.workspai', 'audit', 'restores'));
    expect(await fsExtra.pathExists(restored.manifestPath!)).toBe(true);
    expect(await fsExtra.pathExists(archived.archivePath!)).toBe(false);

    const rearchived = await archiveWorkspaceProject({
      workspacePath,
      project: 'orders',
      reason: 'archive again after restore',
    });
    expect(await fsExtra.pathExists(path.join(rearchived.archivePath!, 'package.json'))).toBe(true);

    const auditLog = await fsExtra.readFile(
      path.join(workspacePath, '.workspai', 'audit', 'events.jsonl'),
      'utf-8'
    );
    const events = auditLog
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string; status: string; reason?: string });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'project.archive',
          status: 'succeeded',
          reason: 'temporarily retired',
        }),
        expect.objectContaining({
          action: 'project.restore',
          status: 'succeeded',
          reason: 'customer needs it again',
        }),
      ])
    );
  });

  it('enforces workspace lifecycle policy for destructive operations', async () => {
    await fsExtra.outputFile(
      path.join(workspacePath, '.rapidkit', 'policies.yml'),
      [
        'require_reason_for_destructive_ops: true',
        'require_safety_snapshot_for_destructive_ops: true',
        'allow_permanent_delete: false',
        '',
      ].join('\n')
    );

    await expect(
      archiveWorkspaceProject({
        workspacePath,
        project: 'orders',
      })
    ).rejects.toThrow(/requires --reason/);

    await expect(
      deleteWorkspaceProject({
        workspacePath,
        project: 'orders',
        reason: 'cleanup',
        permanent: true,
        confirm: 'orders',
      })
    ).rejects.toThrow(/disabled by workspace policy/);

    const archived = await archiveWorkspaceProject({
      workspacePath,
      project: 'orders',
      reason: 'policy compliant archive',
    });

    expect(archived.action).toBe('archive');
  });
});
