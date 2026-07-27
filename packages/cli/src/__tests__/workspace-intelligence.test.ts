import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkspaceImpact,
  buildWorkspaceModelSnapshot,
  diffWorkspaceModel,
  migrateLegacyWorkspaceModelSnapshot,
  WORKSPACE_IMPACT_REPORT_PATH,
  WORKSPACE_MODEL_DIFF_REPORT_PATH,
  WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
  WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
  writeWorkspaceImpact,
  writeWorkspaceModelDiff,
  writeWorkspaceModelSnapshot,
} from '../workspace-intelligence.js';
import { WORKSPACE_MODEL_REPORT_PATH, WORKSPACE_MODEL_SCHEMA_VERSION } from '../workspace-model.js';
import { hashLegacyWorkspaceModelV1 } from '../workspace-model-hash.js';

describe('workspace intelligence snapshots and diffs', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fsExtra.remove(dir);
    }
  });

  it('creates and writes a model snapshot artifact', async () => {
    const workspacePath = await makeTempDir('rk-intel-snapshot-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'intel-platform',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const snapshot = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const outputPath = await writeWorkspaceModelSnapshot(snapshot, workspacePath);

    expect(snapshot.schemaVersion).toBe('workspace-model-snapshot.v1');
    expect(snapshot.modelHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.model.projects.map((project) => project.name)).toEqual(['api']);
    expect(outputPath).toBe(path.join(workspacePath, WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH));
    expect(await fsExtra.pathExists(outputPath)).toBe(true);
  });

  it('authenticates and migrates a legacy graph-only snapshot without losing its baseline', async () => {
    const workspacePath = await makeTempDir('rk-intel-legacy-snapshot-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });
    const current = await buildWorkspaceModelSnapshot({ workspacePath });
    const legacyModel = { ...current.model, projectTopology: undefined };
    const legacy = {
      ...current,
      model: legacyModel,
      modelHash: hashLegacyWorkspaceModelV1(legacyModel),
    };

    const migrated = migrateLegacyWorkspaceModelSnapshot(legacy);

    expect(migrated?.model.projectTopology).toEqual(current.model.graph);
    expect(migrated?.model.graph).toEqual(migrated?.model.projectTopology);
    expect(migrated?.generatedAt).toBe(legacy.generatedAt);
    expect(
      migrateLegacyWorkspaceModelSnapshot({ ...legacy, modelHash: '0'.repeat(64) })
    ).toBeNull();
  });

  it('diffs the current model against a previous snapshot', async () => {
    const workspacePath = await makeTempDir('rk-intel-diff-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'intel-platform',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);

    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
      scripts: {
        build: 'next build',
      },
    });

    const diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: beforePath,
      now: new Date('2026-06-14T00:01:00.000Z'),
    });
    const outputPath = await writeWorkspaceModelDiff(diff, workspacePath);

    expect(diff.schemaVersion).toBe('workspace-model-diff.v1');
    expect(diff.summary.changed).toBe(true);
    expect(diff.summary.addedProjects).toBe(1);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'project.added',
          target: 'web',
        }),
        expect.objectContaining({
          type: 'workspace.changed',
          target: 'identity.workspaceType',
        }),
      ])
    );
    expect(outputPath).toBe(path.join(workspacePath, WORKSPACE_MODEL_DIFF_REPORT_PATH));
  });

  it('reports no changes when comparing equivalent models', async () => {
    const workspacePath = await makeTempDir('rk-intel-no-diff-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);
    const diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: beforePath,
      now: new Date('2026-06-14T00:01:00.000Z'),
    });

    expect(diff.summary.changed).toBe(false);
    expect(diff.changes).toEqual([]);
  });

  it('converts model diff into workspace impact and verification commands', async () => {
    const workspacePath = await makeTempDir('rk-intel-impact-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);

    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
      scripts: {
        build: 'next build',
        test: 'vitest run',
      },
    });

    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: beforePath,
      now: new Date('2026-06-14T00:02:00.000Z'),
    });
    const outputPath = await writeWorkspaceImpact(impact, workspacePath);

    expect(impact.schemaVersion).toBe('workspace-impact.v1');
    expect(impact.summary.changed).toBe(true);
    expect(impact.summary.risk).toBe('medium');
    expect(impact.affectedProjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'web',
          risk: 'medium',
          project: expect.objectContaining({
            name: 'web',
            kind: 'frontend',
          }),
        }),
      ])
    );
    const webImpact = impact.affectedProjects.find((item) => item.target === 'web');
    expect(webImpact?.verification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: 'npx workspai workspace run test --scope project:web --json',
          execute:
            'npx --yes --package workspai workspai workspace run test --scope project:web --json',
          required: true,
        }),
      ])
    );
    expect(impact.verificationPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: 'npx workspai doctor workspace --json',
        }),
        expect.objectContaining({
          display: 'npx workspai workspace run test --scope project:web --json',
        }),
        expect.objectContaining({
          display: 'npx workspai workspace run build --scope project:web --json',
        }),
      ])
    );
    expect(impact.agentBrief.unsafeAssumptions.join('\n')).toContain(
      'Do not infer test/build success'
    );
    expect(outputPath).toBe(path.join(workspacePath, WORKSPACE_IMPACT_REPORT_PATH));
  });

  it('builds workspace impact directly from a written diff report', async () => {
    const workspacePath = await makeTempDir('rk-intel-impact-from-diff-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);

    await fsExtra.outputJson(path.join(workspacePath, 'apps', 'web', 'package.json'), {
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
      scripts: {
        build: 'next build',
      },
    });

    const diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: beforePath,
      now: new Date('2026-06-14T00:01:00.000Z'),
    });
    const diffPath = await writeWorkspaceModelDiff(diff, workspacePath);

    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: diffPath,
      scope: 'project:WEB',
      now: new Date('2026-06-14T00:02:00.000Z'),
    });

    expect(impact.diff.fromHash).toBe(diff.fromHash);
    expect(impact.diff.toHash).toBe(diff.toHash);
    expect(impact.affectedProjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'apps/web',
          project: expect.objectContaining({
            name: 'web',
            kind: 'frontend',
          }),
        }),
      ])
    );
    const webImpact = impact.affectedProjects.find((item) => item.target === 'apps/web');
    expect(webImpact?.verification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: 'npx workspai workspace run build --scope project:web --json',
          required: true,
        }),
      ])
    );
    expect(impact.verificationPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: 'npx workspai doctor workspace --json',
        }),
        expect.objectContaining({
          display: 'npx workspai workspace run build --scope project:web --json',
        }),
      ])
    );
    expect(impact.verificationPlan).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display: 'npx workspai workspace run test --scope project:web --json',
        }),
      ])
    );
  });

  it('honors project scope when building impact', async () => {
    const workspacePath = await makeTempDir('rk-intel-impact-scope-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({ workspacePath });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);
    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: { next: '^15.0.0' },
    });

    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: beforePath,
      scope: 'project:api',
    });

    expect(impact.summary.changed).toBe(true);
    expect(impact.affectedProjects).toEqual([]);
    expect(impact.workspaceImpact.length).toBeGreaterThan(0);
  });

  it('reports clean impact for equivalent models', async () => {
    const workspacePath = await makeTempDir('rk-intel-impact-clean-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });
    const before = await buildWorkspaceModelSnapshot({ workspacePath });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);

    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: beforePath,
    });

    expect(impact.summary).toMatchObject({
      changed: false,
      risk: 'none',
      affectedProjects: 0,
      workspaceItems: 0,
    });
    expect(impact.verificationPlan).toEqual([]);
  });

  it('maps git working tree changes to projects when diffing from git', async () => {
    const workspacePath = await makeTempDir('rk-intel-git-diff-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    const beforePath = await writeWorkspaceModelSnapshot(before, workspacePath);

    const diff = await diffWorkspaceModel({
      workspacePath,
      fromPath: 'git',
      now: new Date('2026-06-14T00:02:00.000Z'),
      gitObservation: {
        available: true,
        branch: 'main',
        commit: 'abc123',
        ref: 'HEAD',
        dirty: true,
        changedFiles: ['api/main.py'],
        untrackedFiles: ['api/new-route.py'],
        deletedFiles: [],
      },
    });

    expect(diff.fromRef).toBe('git:HEAD');
    expect(diff.git?.available).toBe(true);
    expect(diff.git?.dirty).toBe(true);
    expect(diff.summary.gitChangedFiles).toBe(2);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'git.file.changed',
          target: 'git:api/main.py',
        }),
        expect.objectContaining({
          type: 'git.untracked',
          target: 'git:api/new-route.py',
        }),
      ])
    );

    const cleanDiff = await diffWorkspaceModel({
      workspacePath,
      fromPath: beforePath,
      includeGitObservation: false,
      now: new Date('2026-06-14T00:03:00.000Z'),
    });
    expect(cleanDiff.summary.changed).toBe(false);
  });

  it('softens impact risk for empty workspaces with bootstrap-only git noise', async () => {
    const workspacePath = await makeTempDir('rk-intel-empty-polyglot-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'empty-polyglot',
      profile: 'polyglot',
    });

    const before = await buildWorkspaceModelSnapshot({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });
    await writeWorkspaceModelSnapshot(before, workspacePath);
    await fsExtra.writeFile(path.join(workspacePath, 'README.md'), '# notes\n', 'utf-8');

    const impact = await buildWorkspaceImpact({
      workspacePath,
      fromPath: 'git',
      now: new Date('2026-06-14T00:02:00.000Z'),
      gitObservation: {
        available: true,
        branch: 'main',
        commit: 'abc123',
        ref: 'HEAD',
        dirty: true,
        changedFiles: [],
        untrackedFiles: ['README.md'],
        deletedFiles: [],
      },
    });

    expect(impact.summary.changed).toBe(true);
    expect(impact.summary.affectedProjects).toBe(0);
    expect(impact.summary.risk).toBe('low');
  });

  it('rejects diff reports as workspace diff baselines with actionable guidance', async () => {
    const workspacePath = await makeTempDir('rk-intel-diff-from-diff-');
    const diffPath = path.join(workspacePath, WORKSPACE_MODEL_DIFF_REPORT_PATH);
    await fsExtra.ensureDir(path.dirname(diffPath));
    await fsExtra.writeJson(diffPath, {
      schemaVersion: WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
      generatedAt: '2026-06-14T00:00:00.000Z',
      fromRef: '.workspai/reports/workspace-model-snapshot.json',
      toRef: WORKSPACE_MODEL_REPORT_PATH,
      fromHash: 'abc',
      toHash: 'def',
      summary: {
        changed: false,
        addedProjects: 0,
        removedProjects: 0,
        changedProjects: 0,
        workspaceChanges: 0,
        validationChanges: 0,
        gitChangedFiles: 0,
      },
      git: { available: false, dirty: false, changedFiles: 0, untrackedFiles: 0, deletedFiles: 0 },
      changes: [],
      currentModel: {
        schemaVersion: WORKSPACE_MODEL_SCHEMA_VERSION,
        generatedAt: '2026-06-14T00:00:00.000Z',
        workspace: { path: workspacePath, name: 'ws' },
        identity: { workspaceType: 'empty' },
        summary: { projectCount: 0 },
        projects: [],
        validation: { status: 'passed', issues: [] },
      },
    });

    await expect(
      diffWorkspaceModel({
        workspacePath,
        fromPath: WORKSPACE_MODEL_DIFF_REPORT_PATH,
      })
    ).rejects.toThrow(/workspace impact --from/);
  });
});
