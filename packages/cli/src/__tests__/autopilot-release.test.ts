import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => {
  return {
    execa: vi.fn(),
  };
});

vi.mock('../workspace-run.js', () => {
  return {
    runWorkspaceStage: vi.fn(),
  };
});

import { execa } from 'execa';
import { runWorkspaceStage } from '../workspace-run.js';
import type { WorkspaceRunReport } from '../workspace-run.js';
import { runAutopilotRelease, AUTOPILOT_RELEASE_ALIAS_FILENAME } from '../autopilot-release.js';

const createdPaths: string[] = [];

async function makeWorkspace(): Promise<string> {
  const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-autopilot-'));
  createdPaths.push(workspace);

  await fsExtra.writeJSON(path.join(workspace, '.workspai-workspace'), {
    signature: 'RAPIDKIT_WORKSPACE',
    name: 'autopilot-test',
  });

  const projectPath = path.join(workspace, 'services', 'api');
  await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
  await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'context.json'), {
    name: 'api',
    runtime: 'node',
  });

  return workspace;
}

function makeWorkspaceRunReport(
  workspacePath: string,
  stage: WorkspaceRunReport['stage'] = 'test'
): WorkspaceRunReport {
  return {
    schemaVersion: '1.0',
    workspacePath,
    stage,
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    options: {
      affected: true,
      blastRadius: false,
      since: null,
      parallel: false,
      maxWorkers: 1,
      continueOnError: false,
      strict: false,
      enforceGates: false,
      scope: null,
      reusePassed: false,
    },
    selection: {
      mode: 'affected',
      since: null,
      scope: null,
      graphStatus: 'not-applicable',
      expansionDepth: 0,
    },
    summary: {
      projectCount: 1,
      selectedCount: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      blocked: 0,
      exitCode: 0,
    },
    projects: [],
    gates: { enforced: false, results: [], blocked: false },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (createdPaths.length > 0) {
    const target = createdPaths.pop();
    if (target) {
      await fsExtra.remove(target);
    }
  }
});

describe('autopilot-release', () => {
  it('blocks full enforce flow when workspace test/build gate warns', async () => {
    const workspace = await makeWorkspace();

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--plan')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ remediationPlan: { totalSteps: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('doctor') && args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ healthScore: { errors: 0, warnings: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('readiness')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ overallStatus: 'pass' }),
          stderr: '',
        };
      }
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'services/api/package.json', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockImplementation(async ({ stage }: { stage: string }) => {
      if (stage === 'test') {
        return {
          schemaVersion: '1.0',
          workspacePath: workspace,
          stage: 'test',
          generatedAt: new Date().toISOString(),
          durationMs: 1,
          options: {
            affected: true,
            blastRadius: false,
            since: null,
            parallel: false,
            maxWorkers: 1,
            continueOnError: false,
            strict: false,
            enforceGates: false,
            scope: null,
          },
          selection: {
            mode: 'affected',
            since: null,
            scope: null,
            graphStatus: 'not-applicable',
            expansionDepth: 0,
          },
          summary: {
            projectCount: 1,
            selectedCount: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            blocked: 0,
            exitCode: 0,
          },
          projects: [],
          gates: {
            enforced: false,
            results: [{ gate: 'test-warn', status: 'warn', summary: 'test gate warning' }],
            blocked: false,
          },
        };
      }

      return {
        schemaVersion: '1.0',
        workspacePath: workspace,
        stage: 'build',
        generatedAt: new Date().toISOString(),
        durationMs: 1,
        options: {
          affected: true,
          blastRadius: false,
          since: null,
          parallel: false,
          maxWorkers: 1,
          continueOnError: false,
          strict: false,
          enforceGates: false,
          scope: null,
        },
        selection: {
          mode: 'affected',
          since: null,
          scope: null,
          graphStatus: 'not-applicable',
          expansionDepth: 0,
        },
        summary: {
          projectCount: 1,
          selectedCount: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          blocked: 0,
          exitCode: 0,
        },
        projects: [],
        gates: { enforced: false, results: [], blocked: false },
      };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'enforce',
      json: true,
    });

    expect(report.summary.verdict).toBe('blocked');
    expect(report.summary.exitCode).toBe(1);
    expect(
      report.blockingReasons.some((reason) =>
        reason.includes('workspace run test reported warnings under enforce mode')
      )
    ).toBe(true);
    expect(report.stages.find((stage) => stage.name === 'workspace-run-test-build')?.status).toBe(
      'warn'
    );
  });

  it('blocks workspace run test stage when a workspace-run gate fails with no project failures', async () => {
    const workspace = await makeWorkspace();

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--plan')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ remediationPlan: { totalSteps: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('doctor') && args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ healthScore: { errors: 0, warnings: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('readiness')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ overallStatus: 'pass' }),
          stderr: '',
        };
      }
      if (args.includes('diff')) {
        return { exitCode: 0, stdout: 'services/api/package.json', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockImplementation(async ({ stage }: { stage: string }) => {
      if (stage === 'test') {
        return {
          schemaVersion: '1.0',
          workspacePath: workspace,
          stage: 'test',
          generatedAt: new Date().toISOString(),
          durationMs: 1,
          options: {
            affected: true,
            blastRadius: false,
            since: null,
            parallel: false,
            maxWorkers: 1,
            continueOnError: false,
            strict: true,
            enforceGates: false,
            scope: null,
          },
          selection: {
            mode: 'affected',
            since: null,
            scope: null,
            graphStatus: 'not-applicable',
            expansionDepth: 0,
          },
          summary: {
            projectCount: 1,
            selectedCount: 1,
            passed: 0,
            failed: 0,
            skipped: 1,
            blocked: 1,
            exitCode: 1,
          },
          projects: [
            {
              path: path.join(workspace, 'services/api'),
              relativePath: 'services/api',
              selected: false,
              affected: false,
              status: 'skipped',
              exitCode: null,
              durationMs: 0,
              reason: 'blocked by readiness',
            },
          ],
          gates: {
            enforced: false,
            results: [
              {
                gate: 'readiness',
                status: 'fail',
                summary: 'readiness blocked workspace run',
              },
            ],
            blocked: true,
            blockingGate: 'readiness',
          },
        };
      }

      return {
        schemaVersion: '1.0',
        workspacePath: workspace,
        stage: 'build',
        generatedAt: new Date().toISOString(),
        durationMs: 1,
        options: {
          affected: true,
          blastRadius: false,
          since: null,
          parallel: false,
          maxWorkers: 1,
          continueOnError: false,
          strict: true,
          enforceGates: false,
          scope: null,
        },
        selection: {
          mode: 'affected',
          since: null,
          scope: null,
          graphStatus: 'not-applicable',
          expansionDepth: 0,
        },
        summary: {
          projectCount: 1,
          selectedCount: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          blocked: 0,
          exitCode: 0,
        },
        projects: [],
        gates: { enforced: false, results: [], blocked: false },
      };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'audit',
      json: true,
    });

    expect(report.summary.verdict).toBe('blocked');
    expect(report.summary.exitCode).toBe(1);
    expect(report.blockingReasons).toContain('workspace run test failed for selected projects');
    expect(report.stages.find((stage) => stage.name === 'workspace-run-test-build')?.status).toBe(
      'fail'
    );
  });

  it('returns approved verdict in audit mode for healthy workspace', async () => {
    const workspace = await makeWorkspace();

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockImplementation(async ({ stage }: { stage: string }) => ({
      schemaVersion: '1.0',
      workspacePath: workspace,
      stage,
      generatedAt: new Date().toISOString(),
      durationMs: 1,
      options: {
        affected: true,
        blastRadius: false,
        since: null,
        parallel: false,
        maxWorkers: 1,
        continueOnError: false,
        strict: true,
        enforceGates: false,
        scope: null,
      },
      selection: {
        mode: 'affected',
        since: null,
        scope: null,
        graphStatus: 'not-applicable',
        expansionDepth: 0,
      },
      gates: { enforced: false, results: [], blocked: false },
      summary: {
        projectCount: 1,
        selectedCount: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        blocked: 0,
        exitCode: 0,
      },
      projects: [],
    }));

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--plan')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ remediationPlan: { totalSteps: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('doctor') && args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ healthScore: { errors: 0, warnings: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('readiness')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ overallStatus: 'pass' }),
          stderr: '',
        };
      }
      if (args.includes('diff')) {
        return { exitCode: 1, stdout: '', stderr: 'not a git repo' };
      }
      if (args.includes('test') || args.includes('build')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'audit',
      json: true,
    });

    expect(report.summary.verdict).toBe('approved');
    expect(report.summary.exitCode).toBe(0);
    expect(report.summary.blockers).toBe(0);
    expect(report.artifacts.workspaceRunEvidencePath).toContain('workspace-run-last.json');
    expect(report.artifacts.workspaceRunTestPath).toContain('workspace-run-last.json');
    expect(report.artifacts.workspaceRunBuildPath).toContain('workspace-run-last.json');

    const reportPath = path.join(
      workspace,
      '.workspai',
      'reports',
      'autopilot-release-last-run.json'
    );
    const workspaceRunEvidencePath = path.join(
      workspace,
      '.workspai',
      'reports',
      'workspace-run-last.json'
    );
    expect(await fsExtra.pathExists(reportPath)).toBe(true);
    expect(await fsExtra.pathExists(workspaceRunEvidencePath)).toBe(true);

    const workspaceRunEvidence = await fsExtra.readJson(workspaceRunEvidencePath);
    expect(workspaceRunEvidence.schemaVersion).toBe('workspace-run-v1');
    expect(workspaceRunEvidence.stages.test).toBeTruthy();
    expect(workspaceRunEvidence.stages.build).toBeTruthy();
    expect(
      await fsExtra.pathExists(
        path.join(workspace, '.workspai', 'reports', 'autopilot-workspace-run-test.json')
      )
    ).toBe(false);
    const aliasPath = path.join(
      workspace,
      '.workspai',
      'reports',
      AUTOPILOT_RELEASE_ALIAS_FILENAME
    );
    const legacyAliasPath = path.join(
      workspace,
      '.workspai',
      'reports',
      AUTOPILOT_RELEASE_ALIAS_FILENAME
    );
    expect(await fsExtra.pathExists(aliasPath)).toBe(true);
    expect(await fsExtra.pathExists(legacyAliasPath)).toBe(true);
    const aliasPayload = JSON.parse(await fsExtra.readFile(aliasPath, 'utf8'));
    expect(aliasPayload.summary.verdict).toBe('approved');
    expect(report.artifacts.aliasEvidencePath).toBe(aliasPath);
    expect(report.enterpriseControls?.aliasEvidencePath).toBe(
      `.workspai/reports/${AUTOPILOT_RELEASE_ALIAS_FILENAME}`
    );
  });

  it('blocks in enforce mode when readiness is warn', async () => {
    const workspace = await makeWorkspace();

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockResolvedValue(makeWorkspaceRunReport(workspace));

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--plan')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ remediationPlan: { totalSteps: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('doctor') && args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ healthScore: { errors: 0, warnings: 0 } }),
          stderr: '',
        };
      }
      if (args.includes('readiness')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ overallStatus: 'warn' }),
          stderr: '',
        };
      }
      if (args.includes('diff')) {
        return { exitCode: 1, stdout: '', stderr: 'not a git repo' };
      }
      if (args.includes('test') || args.includes('build')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'enforce',
      json: true,
    });

    expect(report.summary.verdict).toBe('blocked');
    expect(report.summary.exitCode).toBe(1);
    expect(report.summary.blockers).toBeGreaterThan(0);
    expect(
      report.blockingReasons.some((reason) => reason.includes('readiness reported warnings'))
    ).toBe(true);
  });

  it('executes doctor apply stage in safe-fix mode', async () => {
    const workspace = await makeWorkspace();

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockResolvedValue(makeWorkspaceRunReport(workspace));

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--apply')) {
        return { exitCode: 0, stdout: 'applied', stderr: '' };
      }
      if (args.includes('doctor') && args.includes('--plan')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ remediationPlan: { totalSteps: 2 } }),
          stderr: '',
        };
      }
      if (args.includes('doctor') && args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ healthScore: { errors: 0, warnings: 1 } }),
          stderr: '',
        };
      }
      if (args.includes('readiness')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ overallStatus: 'pass' }),
          stderr: '',
        };
      }
      if (args.includes('diff')) {
        return { exitCode: 1, stdout: '', stderr: 'not a git repo' };
      }
      if (args.includes('test') || args.includes('build')) {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'safe-fix',
      json: true,
    });

    expect(report.summary.safeFixesApplied).toBe(2);
    expect(report.stages.find((stage) => stage.name === 'remediation-apply')?.status).toBe('pass');

    const applyCalled = execaMock.mock.calls.some((call) => {
      const args = (call[1] ?? []) as string[];
      return args.includes('doctor') && args.includes('--apply');
    });
    expect(applyCalled).toBe(true);

    const doctorJsonCalls = execaMock.mock.calls.filter((call) => {
      const args = (call[1] ?? []) as string[];
      return args.includes('doctor') && args.includes('--json');
    }).length;
    const readinessJsonCalls = execaMock.mock.calls.filter((call) => {
      const args = (call[1] ?? []) as string[];
      return args.includes('readiness') && args.includes('--json');
    }).length;

    expect(doctorJsonCalls).toBeGreaterThanOrEqual(2);
    expect(readinessJsonCalls).toBeGreaterThanOrEqual(2);
  });

  it('returns exitCode 3 on command execution crash', async () => {
    const workspace = await makeWorkspace();

    const runWorkspaceStageMock = runWorkspaceStage as unknown as ReturnType<typeof vi.fn>;
    runWorkspaceStageMock.mockResolvedValue(makeWorkspaceRunReport(workspace));

    const execaMock = execa as unknown as ReturnType<typeof vi.fn>;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('doctor') && args.includes('--json')) {
        throw new Error('spawn failed');
      }

      return { exitCode: 0, stdout: '{}', stderr: '' };
    });

    const report = await runAutopilotRelease({
      workspacePath: workspace,
      mode: 'audit',
      json: true,
    });

    expect(report.summary.exitCode).toBe(3);
    expect(report.summary.verdict).toBe('blocked');
    expect(report.blockingReasons.some((reason) => reason.includes('execution error'))).toBe(true);
  });
});
