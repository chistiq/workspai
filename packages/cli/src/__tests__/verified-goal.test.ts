import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  planVerifiedGoal,
  readVerifiedGoal,
  VERIFIED_GOAL_LAST_RUN_REPORT_PATH,
  verifyVerifiedGoal,
} from '../verified-goal.js';

const roots: string[] = [];

async function workspaceFixture(): Promise<string> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-goal-'));
  roots.push(workspacePath);
  await fsExtra.writeJson(path.join(workspacePath, '.workspai-workspace'), {
    name: path.basename(workspacePath),
    profile: 'polyglot',
  });
  await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
  return workspacePath;
}

async function registerProject(
  workspacePath: string,
  input: { name: string; relativePath: string; runtime?: string; framework?: string }
): Promise<void> {
  await fsExtra.ensureDir(path.join(workspacePath, input.relativePath));
  await fsExtra.writeJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-07-30T00:00:00.000Z',
    workspace: { name: path.basename(workspacePath), profile: 'polyglot' },
    projects: [
      {
        slug: input.name,
        relativePath: input.relativePath,
        runtime: input.runtime ?? 'node',
        framework: input.framework ?? 'node',
        kit: input.framework ?? 'node',
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
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('verified engineering goals', () => {
  it('plans and deterministically resumes the same release goal', async () => {
    const workspacePath = await workspaceFixture();
    const first = await planVerifiedGoal({
      workspacePath,
      kind: 'release-readiness',
    });
    const second = await planVerifiedGoal({
      workspacePath,
      kind: 'release-readiness',
    });

    expect(first.goal.id).toBe(second.goal.id);
    expect(first.resumed).toBe(false);
    expect(second.resumed).toBe(true);
    expect(first.status.state).toBe('planned');
    expect(await fsExtra.pathExists(first.goal.artifactPaths.goal)).toBe(true);
    expect(
      await fsExtra.pathExists(path.join(workspacePath, VERIFIED_GOAL_LAST_RUN_REPORT_PATH))
    ).toBe(true);
  });

  it('keeps safe dependency constraints in the durable contract', async () => {
    const workspacePath = await workspaceFixture();
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        schemaVersion: 'doctor-workspace-evidence-v1',
        generatedAt: new Date().toISOString(),
        projects: [
          {
            name: 'api',
            path: path.join(workspacePath, 'api'),
            dependencyAudit: {
              generatedAt: new Date().toISOString(),
              status: 'vulnerable',
              blockingFindingCount: 3,
              findingCount: 3,
            },
          },
        ],
      }
    );

    const result = await planVerifiedGoal({
      workspacePath,
      kind: 'dependency-security',
    });

    expect(result.goal.constraints).toMatchObject({
      allowBreakingChanges: false,
      allowForce: false,
      requireBuild: true,
      requireTests: true,
    });
    expect(result.goal.baseline).toMatchObject({
      value: 3,
      target: 0,
      status: 'unsatisfied',
    });
  });

  it('captures nested monorepo manifests while excluding generated dependency trees', async () => {
    const workspacePath = await workspaceFixture();
    await registerProject(workspacePath, { name: 'platform', relativePath: 'platform' });
    await fsExtra.outputJson(path.join(workspacePath, 'platform', 'package.json'), {
      name: 'platform',
      private: true,
    });
    await fsExtra.outputJson(path.join(workspacePath, 'platform', 'apps', 'web', 'package.json'), {
      name: 'web',
      dependencies: { react: '^19.0.0' },
    });
    await fsExtra.outputJson(
      path.join(workspacePath, 'platform', 'node_modules', 'ignored', 'package.json'),
      { name: 'ignored' }
    );

    const result = await planVerifiedGoal({
      workspacePath,
      kind: 'dependency-security',
    });
    const paths = result.goal.dependencySafetyBaseline?.manifests.map((entry) => entry.path);

    expect(paths).toEqual(['platform/apps/web/package.json', 'platform/package.json']);
  });

  it('rejects a durable goal whose safety constraints were weakened after planning', async () => {
    const workspacePath = await workspaceFixture();
    const planned = await planVerifiedGoal({
      workspacePath,
      kind: 'dependency-security',
    });
    const tampered = structuredClone(planned.goal);
    tampered.constraints.allowForce = true;
    await fsExtra.writeJson(planned.goal.artifactPaths.goal, tampered, { spaces: 2 });

    await expect(readVerifiedGoal(workspacePath, planned.goal.id)).rejects.toThrow(
      'Verified goal artifacts are inconsistent'
    );
  });

  it('does not claim verification when execution evidence is disabled', async () => {
    const workspacePath = await workspaceFixture();
    const planned = await planVerifiedGoal({
      workspacePath,
      kind: 'dependency-security',
    });
    const status = await verifyVerifiedGoal({
      workspacePath,
      goalId: planned.goal.id,
      run: false,
    });
    const persisted = await readVerifiedGoal(workspacePath, planned.goal.id);

    expect(status.state).toBe('blocked');
    expect(status.blockingReasons.length).toBeGreaterThan(0);
    expect(persisted.status).toEqual(status);
  });

  it('supports a workspace-wide coverage goal without hiding missing projects', async () => {
    const workspacePath = await workspaceFixture();
    const planned = await planVerifiedGoal({
      workspacePath,
      kind: 'test-coverage',
      target: 75,
    });

    expect(planned.goal.scope).toEqual({ kind: 'workspace' });
    expect(planned.goal.baseline).toMatchObject({
      value: null,
      target: 75,
      status: 'unavailable',
    });
    expect(planned.goal.baseline.message).toContain('does not contain a registered project');
  });
});
