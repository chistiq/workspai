import os from 'os';
import path from 'path';
import fs from 'fs';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => {
  return {
    execa: vi.fn(),
  };
});

import { execa } from 'execa';
import { runWorkspaceStage } from '../workspace-run';

async function createProject(workspacePath: string, relPath: string) {
  const projectPath = path.join(workspacePath, relPath);
  await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
  await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
    name: relPath,
    runtime: 'node',
  });
  await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
    scripts: {
      install: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
      start: 'node -e "process.exit(0)"',
      dev: 'node -e "process.exit(0)"',
    },
  });
  return projectPath;
}

async function createProjectWithoutContext(
  workspacePath: string,
  relPath: string
): Promise<string> {
  const projectPath = path.join(workspacePath, relPath);
  await fsExtra.ensureDir(projectPath);
  return projectPath;
}

function noGateMock(extraArgs?: Record<string, { exitCode: number; stdout: string }>) {
  const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
  execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
    if (extraArgs) {
      for (const [key, val] of Object.entries(extraArgs)) {
        if (args.includes(key)) {
          return { exitCode: val.exitCode, stdout: val.stdout, stderr: '' };
        }
      }
    }
    return { exitCode: 0, stdout: '{}', stderr: '' };
  });
  return execaMock;
}

describe('workspace-run', { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── existing tests ────────────────────────────────────────────────────────

  it('runs only affected projects when --affected is enabled', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'services/api-a');
    await createProject(workspacePath, 'services/api-b');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'services/api-a/src/users.ts\n', stderr: '' };
      }
      if (args.includes('test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      since: 'HEAD~1',
      enforceGates: false,
      json: true,
    });

    expect(report.summary.selectedCount).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(
      report.projects.filter((item) => item.selected).map((item) => item.relativePath)
    ).toEqual(['services/api-a']);

    const reportPath = path.join(workspacePath, '.workspai', 'reports', 'workspace-run-last.json');
    expect(await fsExtra.pathExists(reportPath)).toBe(true);
    const aggregate = await fsExtra.readJson(reportPath);
    expect(aggregate.schemaVersion).toBe('workspace-run-v1');
    expect(aggregate.stages.test?.summary?.passed).toBe(1);
    expect(report.enterpriseControls).toEqual({
      jsonReady: true,
      evidencePath: '.workspai/reports/workspace-run-last.json',
    });

    await fsExtra.remove(workspacePath);
  });

  it('writes enterprise evidence metadata for empty workspace runs', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-empty-'));
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      json: true,
      enforceGates: false,
    });

    expect(report.summary.projectCount).toBe(0);
    expect(report.summary.selectedCount).toBe(0);
    expect(report.enterpriseControls?.evidencePath).toBe(
      '.workspai/reports/workspace-run-last.json'
    );

    await fsExtra.remove(workspacePath);
  });

  it('reuses a previously passed project result without executing the stage again', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-reuse-'));
    await createProject(workspacePath, 'apps/api');
    const execaMock = noGateMock({ build: { exitCode: 0, stdout: 'built' } });

    const initial = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      enforceGates: false,
      json: true,
    });
    expect(initial.summary.passed).toBe(1);

    execaMock.mockClear();
    const reused = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      reusePassed: true,
      enforceGates: false,
      json: true,
    });

    expect(reused.projects[0]).toMatchObject({
      status: 'passed',
      exitCode: 0,
      reason: 'reused passed result from workspace-run-last.json',
    });
    expect(execaMock).not.toHaveBeenCalled();

    await fsExtra.remove(workspacePath);
  });

  it('stops sequential execution after the first project failure', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-stop-'));
    await createProject(workspacePath, 'apps/a');
    await createProject(workspacePath, 'apps/b');
    const execaMock = noGateMock({ build: { exitCode: 1, stdout: 'build failed' } });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      enforceGates: false,
      json: true,
    });

    expect(
      report.projects.map(({ relativePath, status, reason }) => ({
        relativePath,
        status,
        reason,
      }))
    ).toEqual([
      expect.objectContaining({ relativePath: 'apps/a', status: 'failed' }),
      { relativePath: 'apps/b', status: 'skipped', reason: 'stopped after failure' },
    ]);
    // One preflight probe and one stage execution; the second project never
    // reaches either path.
    expect(execaMock).toHaveBeenCalledTimes(2);

    await fsExtra.remove(workspacePath);
  });

  it('does not fail strict empty workspace runs when gates are skipped', async () => {
    const workspacePath = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'rk-workspace-run-strict-empty-')
    );
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      json: true,
      strict: true,
      enforceGates: false,
      affected: true,
      since: 'HEAD~1',
    });

    expect(report.summary.projectCount).toBe(0);
    expect(report.summary.selectedCount).toBe(0);
    expect(report.summary.exitCode).toBe(0);

    await fsExtra.remove(workspacePath);
  });

  it('fails selected projects when the requested workspace stage is unsupported', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = path.join(workspacePath, 'web');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.writeJSON(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'web',
      runtime: 'node',
      framework: 'nextjs',
    });
    await fsExtra.writeJSON(path.join(projectPath, 'package.json'), {
      scripts: {
        build: 'next build',
      },
      dependencies: {
        next: '^16.0.0',
      },
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      scope: 'project:web',
      enforceGates: false,
      json: true,
    });

    const projectReport = report.projects.find((item) => item.relativePath === 'web');
    expect(projectReport?.selected).toBe(true);
    expect(projectReport?.status).toBe('failed');
    expect(projectReport?.exitCode).toBe(127);
    expect(projectReport?.reason).toContain('No test script was found');
    expect(report.summary.failed).toBe(1);
    expect(report.summary.exitCode).toBe(1);

    await fsExtra.remove(workspacePath);
  });

  it('blocks project execution when readiness gate fails', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'services/api-a');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor')) {
        return { exitCode: 0, stdout: JSON.stringify({ healthScore: { errors: 0 } }), stderr: '' };
      }
      if (args.includes('readiness')) {
        return { exitCode: 0, stdout: JSON.stringify({ overallStatus: 'fail' }), stderr: '' };
      }
      if (args.includes('build')) {
        throw new Error('build should not execute when gate fails');
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      json: true,
      strict: true,
    });

    expect(report.gates.blocked).toBe(true);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.exitCode).toBe(1);

    await fsExtra.remove(workspacePath);
  });

  it('does not block init stage on readiness gate failure', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'services/api-a');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('init')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (args.includes('doctor')) {
        return { exitCode: 0, stdout: JSON.stringify({ healthScore: { errors: 0 } }), stderr: '' };
      }
      if (args.includes('readiness')) {
        return { exitCode: 0, stdout: JSON.stringify({ overallStatus: 'fail' }), stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'init',
      json: true,
    });

    expect(report.gates.enforced).toBe(false);
    expect(report.gates.blocked).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.exitCode).toBe(0);

    await fsExtra.remove(workspacePath);
  });

  it('respects workspace policy override to disable gates', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'services/api-a');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fs.promises.writeFile(
      path.join(workspacePath, '.rapidkit', 'policies.yml'),
      'mode: warn\nrules.enforce_workspace_run_gates: false\n',
      'utf-8'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('start')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      if (args.includes('doctor') || args.includes('readiness')) {
        throw new Error('gates should be skipped by policy override');
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'start',
      json: true,
    });

    expect(report.gates.enforced).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.exitCode).toBe(0);

    await fsExtra.remove(workspacePath);
  });

  it('expands affected set with blast-radius dependency graph', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    await createProject(workspacePath, 'apps/api-b');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(
      path.join(workspacePath, '.rapidkit', 'workspace-dependency-graph.json'),
      {
        projects: [
          { path: 'apps/api-a', dependsOn: [] },
          { path: 'apps/api-b', dependsOn: ['apps/api-a'] },
        ],
      }
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/api-a/src/users.ts\n', stderr: '' };
      }
      if (args.includes('test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      blastRadius: true,
      enforceGates: false,
      json: true,
    });

    expect(
      report.projects.filter((item) => item.selected).map((item) => item.relativePath)
    ).toEqual(['apps/api-a', 'apps/api-b']);
    expect(report.summary.selectedCount).toBe(2);
    expect(report.summary.passed).toBe(2);

    await fsExtra.remove(workspacePath);
  });

  it('expands affected set with workspace contract dependencies and events', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/orders');
    await createProject(workspacePath, 'apps/billing');
    await createProject(workspacePath, 'apps/notifications');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspacePath, '.rapidkit', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'contract-ws' },
      projects: [
        {
          slug: 'orders',
          relativePath: 'apps/orders',
          modules: [],
          ports: [],
          contracts: {
            owns: ['Order'],
            apis: [],
            publishes: ['OrderCreated'],
            consumes: [],
            dependsOn: [],
            env: [],
          },
        },
        {
          slug: 'billing',
          relativePath: 'apps/billing',
          modules: [],
          ports: [],
          contracts: {
            owns: ['Invoice'],
            apis: [],
            publishes: [],
            consumes: [],
            dependsOn: ['orders'],
            env: [],
          },
        },
        {
          slug: 'notifications',
          relativePath: 'apps/notifications',
          modules: [],
          ports: [],
          contracts: {
            owns: [],
            apis: [],
            publishes: [],
            consumes: ['OrderCreated'],
            dependsOn: [],
            env: [],
          },
        },
      ],
    });

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/orders/src/orders.ts\n', stderr: '' };
      }
      if (args.includes('test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      blastRadius: true,
      enforceGates: false,
      json: true,
    });

    expect(report.selection.graphStatus).toBe('loaded');
    expect(
      report.projects
        .filter((item) => item.selected)
        .map((item) => item.relativePath)
        .sort()
    ).toEqual(['apps/billing', 'apps/notifications', 'apps/orders']);
    expect(report.summary.selectedCount).toBe(3);

    await fsExtra.remove(workspacePath);
  });

  // ─── selection provenance tests ────────────────────────────────────────────

  it('selection provenance: mode=all when affected is not set', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    noGateMock({ build: { exitCode: 0, stdout: 'ok' } });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      enforceGates: false,
      json: true,
    });

    expect(report.selection.mode).toBe('all');
    expect(report.selection.since).toBeNull();
    expect(report.selection.graphStatus).toBe('not-applicable');
    expect(report.selection.expansionDepth).toBe(0);

    await fsExtra.remove(workspacePath);
  });

  it('runs only the explicit project scope when --scope project:<name> is set', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    await createProject(workspacePath, 'apps/api-b');
    noGateMock({ test: { exitCode: 0, stdout: 'ok' } });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      scope: 'project:api-a',
      enforceGates: false,
      json: true,
    });

    expect(report.options.scope).toBe('api-a');
    expect(report.selection.scope).toBe('api-a');
    expect(report.summary.selectedCount).toBe(1);
    expect(report.projects.find((item) => item.relativePath === 'apps/api-a')).toMatchObject({
      selected: true,
      status: 'passed',
    });
    expect(report.projects.find((item) => item.relativePath === 'apps/api-b')).toMatchObject({
      selected: false,
      status: 'skipped',
      reason: 'outside scope',
    });

    await fsExtra.remove(workspacePath);
  });

  it('rejects a workspace run project scope that matches no project', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');

    await expect(
      runWorkspaceStage({
        workspacePath,
        stage: 'test',
        scope: 'project:missing-api',
        enforceGates: false,
        json: true,
      })
    ).rejects.toThrow('Workspace run scope did not match any project: project:missing-api');

    await fsExtra.remove(workspacePath);
  });

  it('selection provenance: mode=affected when --affected without blast-radius', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/api-a/readme.md\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      since: 'origin/main',
      enforceGates: false,
      json: true,
    });

    expect(report.selection.mode).toBe('affected');
    expect(report.selection.since).toBe('origin/main');
    expect(report.selection.graphStatus).toBe('not-applicable');

    await fsExtra.remove(workspacePath);
  });

  it('selection provenance: mode=affected+blast-radius and graphStatus=loaded', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    await createProject(workspacePath, 'apps/api-b');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJSON(
      path.join(workspacePath, '.rapidkit', 'workspace-dependency-graph.json'),
      {
        projects: [
          { path: 'apps/api-a', dependsOn: [] },
          { path: 'apps/api-b', dependsOn: ['apps/api-a'] },
        ],
      }
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/api-a/src/x.ts\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      blastRadius: true,
      enforceGates: false,
      json: true,
    });

    expect(report.selection.mode).toBe('affected+blast-radius');
    expect(report.selection.graphStatus).toBe('loaded');
    expect(report.selection.expansionDepth).toBeGreaterThan(0);

    await fsExtra.remove(workspacePath);
  });

  // ─── blast-radius graph fallback observability tests ──────────────────────

  it('blast-radius graph missing: falls back to direct affected set with graphStatus=missing', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    await createProject(workspacePath, 'apps/api-b');
    // No dependency graph file written

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/api-a/src/x.ts\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      blastRadius: true,
      enforceGates: false,
      json: true,
    });

    expect(report.selection.graphStatus).toBe('missing');
    // Only api-a affected; api-b should NOT be expanded (no graph)
    expect(report.projects.filter((p) => p.selected).map((p) => p.relativePath)).toEqual([
      'apps/api-a',
    ]);

    await fsExtra.remove(workspacePath);
  });

  it('blast-radius graph invalid JSON: falls back to affected set with graphStatus=invalid', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fs.promises.writeFile(
      path.join(workspacePath, '.rapidkit', 'workspace-dependency-graph.json'),
      'NOT VALID JSON }{',
      'utf-8'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'apps/api-a/src/x.ts\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      affected: true,
      blastRadius: true,
      enforceGates: false,
      json: true,
    });

    expect(report.selection.graphStatus).toBe('invalid');

    await fsExtra.remove(workspacePath);
  });

  // ─── gate strict/warn matrix tests ────────────────────────────────────────

  it('strict mode: readiness gate=warn causes non-zero exit', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor')) {
        return { exitCode: 0, stdout: JSON.stringify({ healthScore: { errors: 0 } }), stderr: '' };
      }
      if (args.includes('readiness')) {
        return { exitCode: 0, stdout: JSON.stringify({ overallStatus: 'warn' }), stderr: '' };
      }
      if (args.includes('build')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      strict: true,
      json: true,
    });

    // gates not blocked (warn != fail), stage runs, but strict => non-zero exit
    expect(report.gates.blocked).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.exitCode).toBe(1);

    await fsExtra.remove(workspacePath);
  });

  it('warn mode: readiness gate=warn causes zero exit when no stage fails', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor')) {
        return { exitCode: 0, stdout: JSON.stringify({ healthScore: { errors: 0 } }), stderr: '' };
      }
      if (args.includes('readiness')) {
        return { exitCode: 0, stdout: JSON.stringify({ overallStatus: 'warn' }), stderr: '' };
      }
      if (args.includes('build')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      strict: false,
      json: true,
    });

    expect(report.gates.blocked).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.exitCode).toBe(0);

    await fsExtra.remove(workspacePath);
  });

  // ─── report mandatory field presence tests ────────────────────────────────

  it('report contains all mandatory contract fields', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    noGateMock({ build: { exitCode: 0, stdout: 'ok' } });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'build',
      enforceGates: false,
      json: true,
    });

    // top-level mandatory fields
    expect(report.schemaVersion).toBe('1.0');
    expect(typeof report.generatedAt).toBe('string');
    expect(typeof report.workspacePath).toBe('string');
    expect(typeof report.stage).toBe('string');
    expect(typeof report.durationMs).toBe('number');

    // options block
    expect(typeof report.options.affected).toBe('boolean');
    expect(typeof report.options.blastRadius).toBe('boolean');
    expect(typeof report.options.parallel).toBe('boolean');
    expect(typeof report.options.strict).toBe('boolean');
    expect(typeof report.options.enforceGates).toBe('boolean');

    // selection provenance block
    expect(['all', 'affected', 'affected+blast-radius']).toContain(report.selection.mode);
    expect(typeof report.selection.graphStatus).toBe('string');
    expect(typeof report.selection.expansionDepth).toBe('number');

    // gates block
    expect(typeof report.gates.enforced).toBe('boolean');
    expect(typeof report.gates.blocked).toBe('boolean');
    expect(Array.isArray(report.gates.results)).toBe(true);

    // summary block
    expect(typeof report.summary.projectCount).toBe('number');
    expect(typeof report.summary.selectedCount).toBe('number');
    expect(typeof report.summary.passed).toBe('number');
    expect(typeof report.summary.failed).toBe('number');
    expect(typeof report.summary.skipped).toBe('number');
    expect(typeof report.summary.exitCode).toBe('number');

    // projects array
    expect(Array.isArray(report.projects)).toBe(true);
    for (const project of report.projects) {
      expect(typeof project.path).toBe('string');
      expect(typeof project.relativePath).toBe('string');
      expect(typeof project.selected).toBe('boolean');
      expect(typeof project.status).toBe('string');
      expect(typeof project.durationMs).toBe('number');
    }

    await fsExtra.remove(workspacePath);
  });

  it('detects rails from manifests but skips init when fleet capabilities do not support observed runtimes', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = await createProjectWithoutContext(workspacePath, 'apps/rails-api');
    await fsExtra.writeFile(path.join(projectPath, 'Gemfile'), 'gem "rails", "~> 7.1.0"\n');
    await fsExtra.ensureDir(path.join(projectPath, 'config'));
    await fsExtra.writeFile(
      path.join(projectPath, 'config', 'application.rb'),
      'require "rails/all"\n'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'bundle install && rails db:prepare') {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'init',
      enforceGates: false,
      json: true,
    });

    const projectReport = report.projects.find((item) => item.relativePath === 'apps/rails-api');
    expect(projectReport?.framework).toBe('rails');
    expect(projectReport?.runtimeDetected).toBe('ruby');
    expect(projectReport?.status).toBe('skipped');
    expect(projectReport?.reason).toMatch(/init/i);
    expect(projectReport?.executionCommand).toBeUndefined();

    await fsExtra.remove(workspacePath);
  });

  it('reports canonical framework labels from manifest detection when context metadata is missing', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = await createProjectWithoutContext(workspacePath, 'apps/gin-api');
    await fsExtra.writeFile(
      path.join(projectPath, 'go.mod'),
      'module example\n\nrequire github.com/gin-gonic/gin v1.9.1\n'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      enforceGates: false,
      json: true,
    });

    const projectReport = report.projects.find((item) => item.relativePath === 'apps/gin-api');
    expect(projectReport?.framework).toBe('gogin');
    expect(projectReport?.runtimeDetected).toBe('go');
    expect(projectReport?.executionCommand).toBe('rapidkit test');
    expect(projectReport?.status).toBe('passed');

    await fsExtra.remove(workspacePath);
  });

  it('prints actionable failure details when a workspace project runtime is missing', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = await createProjectWithoutContext(workspacePath, 'dotnet-api');
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
      name: 'dotnet-api',
      runtime: 'dotnet',
      framework: 'dotnet',
    });
    await fsExtra.writeFile(path.join(projectPath, 'dotnet-api.csproj'), '<Project />\n');

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if ((cmd === 'which' || cmd === 'where') && args[0] === 'dotnet') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'init',
      enforceGates: false,
      json: false,
    });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain("Reason: Command 'dotnet' not found or not executable");
    expect(output).toContain('Command: rapidkit init');
    expect(output).toContain('Hint: Install .NET 8+ SDK');

    const projectReport = report.projects[0];
    expect(projectReport?.relativePath).toBe('dotnet-api');
    expect(projectReport?.status).toBe('failed');
    expect(projectReport?.errorCategory).toBe('setup');

    await fsExtra.remove(workspacePath);
  });

  it('runs python wrapper test when pytest exists only in the project venv', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = path.join(workspacePath, 'atlas-api');
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeFile(
      path.join(projectPath, '.rapidkit', 'cli.py'),
      '#!/usr/bin/env python3\n'
    );
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
      name: 'atlas-api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      '[project]\nname = "atlas-api"\n'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if ((cmd === 'which' || cmd === 'where') && args[0] === 'pytest') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      if (args.includes('test')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      enforceGates: false,
      json: true,
    });

    const projectReport = report.projects.find((item) => item.relativePath === 'atlas-api');
    expect(projectReport?.runtimeDetected).toBe('python');
    expect(projectReport?.executionCommand).toBe('rapidkit test');
    expect(projectReport?.status).toBe('passed');

    await fsExtra.remove(workspacePath);
  });

  it('continues init across a mixed workspace when an extended runtime setup is missing', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const dotnetPath = await createProjectWithoutContext(workspacePath, 'dotnet-api');
    const nodePath = await createProject(workspacePath, 'node-api');

    await fsExtra.ensureDir(path.join(dotnetPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(dotnetPath, '.rapidkit', 'context.json'), {
      name: 'dotnet-api',
      runtime: 'dotnet',
      framework: 'dotnet',
    });
    await fsExtra.writeFile(path.join(dotnetPath, 'dotnet-api.csproj'), '<Project />\n');
    await fsExtra.writeJSON(path.join(nodePath, 'package.json'), {
      scripts: {
        install: 'node -e "process.exit(0)"',
      },
    });

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if ((cmd === 'which' || cmd === 'where') && args[0] === 'dotnet') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      if (cmd === 'npm' && args.includes('install')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'init',
      enforceGates: false,
      json: true,
    });

    const dotnetReport = report.projects.find((item) => item.relativePath === 'dotnet-api');
    const nodeReport = report.projects.find((item) => item.relativePath === 'node-api');

    expect(dotnetReport?.status).toBe('failed');
    expect(nodeReport?.status).toBe('passed');
    expect(report.summary.failed).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.skipped).toBe(0);
    expect(report.summary.exitCode).toBe(1);

    await fsExtra.remove(workspacePath);
  });

  it('does not require a framework init stage to have passed before running init itself', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = await createProjectWithoutContext(workspacePath, 'fiber-api');
    await fsExtra.ensureDir(path.join(projectPath, '.workspai'));
    await fsExtra.writeJSON(path.join(projectPath, '.workspai', 'project.json'), {
      name: 'fiber-api',
      runtime: 'go',
      framework: 'gofiber',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'go.mod'),
      'module example.test/fiber-api\n\nrequire github.com/gofiber/fiber/v2 v2.52.5\n'
    );
    await fsExtra.outputJSON(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-run-last.json'),
      {
        schemaVersion: 'workspace-run-v1',
        generatedAt: new Date().toISOString(),
        workspacePath,
        latestStage: 'test',
        stages: {},
        enterpriseControls: {
          jsonReady: true,
          evidencePath: '.workspai/reports/workspace-run-last.json',
        },
      }
    );
    noGateMock();

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'init',
      enforceGates: false,
      json: true,
    });

    expect(report.projects[0]).toMatchObject({
      relativePath: 'fiber-api',
      selected: true,
    });
    expect(report.projects[0].status).not.toBe('skipped');
    expect(report.projects[0].reason?.includes('dependency stage') ?? false).toBe(false);

    await fsExtra.remove(workspacePath);
  });

  // ─── invalid stage validation ─────────────────────────────────────────────

  it('throws for invalid stage name', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    await createProject(workspacePath, 'apps/api-a');
    noGateMock();

    await expect(
      runWorkspaceStage({
        workspacePath,
        stage: 'dev' as never,
        enforceGates: false,
        json: true,
      })
    ).rejects.toThrow('Unsupported workspace run stage: dev');

    await fsExtra.remove(workspacePath);
  });

  it('classifies missing python test dependency from wrapper output as setup', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-'));
    const projectPath = path.join(workspacePath, 'ledger-api');
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeFile(
      path.join(projectPath, '.rapidkit', 'cli.py'),
      '#!/usr/bin/env python3\n'
    );
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
      name: 'ledger-api',
      runtime: 'python',
      framework: 'fastapi',
    });
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      '[project]\nname = "ledger-api"\n'
    );

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('test')) {
        return {
          exitCode: 1,
          stdout:
            '⚠️  Release readiness is warn. Command continues in warn mode.\n' +
            '/workspace/ledger-api/.venv/bin/python: No module named pytest',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runWorkspaceStage({
      workspacePath,
      stage: 'test',
      enforceGates: false,
      json: true,
    });

    const projectReport = report.projects[0];
    expect(projectReport?.status).toBe('failed');
    expect(projectReport?.errorCategory).toBe('setup');
    expect(projectReport?.failureDiagnostic?.category).toBe('setup');
    expect(projectReport?.failureDiagnostic?.outputExcerpt).toContain('No module named pytest');

    await fsExtra.remove(workspacePath);
  });
});
