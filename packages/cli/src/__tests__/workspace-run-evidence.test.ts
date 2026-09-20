import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeWorkspaceRunEvidence,
  publishWorkspaceRunStageReport,
  readWorkspaceRunEvidence,
  resolveWorkspaceRunStageReport,
  WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION,
  WORKSPACE_RUN_LAST_REPORT_FILENAME,
} from '../utils/workspace-run-evidence.js';
import type { WorkspaceRunReport } from '../workspace-run.js';

const createdPaths: string[] = [];

function makeStageReport(
  workspacePath: string,
  stage: WorkspaceRunReport['stage']
): WorkspaceRunReport {
  return {
    schemaVersion: '1.0',
    workspacePath,
    stage,
    generatedAt: '2026-06-16T12:00:00.000Z',
    durationMs: 42,
    options: {
      affected: false,
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
      mode: 'all',
      since: null,
      scope: null,
      graphStatus: 'not-applicable',
      expansionDepth: 0,
    },
    gates: {
      enforced: false,
      results: [],
      blocked: false,
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
  };
}

afterEach(async () => {
  while (createdPaths.length > 0) {
    const target = createdPaths.pop();
    if (target) {
      await fsExtra.remove(target);
    }
  }
});

describe('workspace run evidence', () => {
  it('publishes multi-stage aggregate to workspace-run-last.json', async () => {
    const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-evidence-'));
    createdPaths.push(workspace);

    await publishWorkspaceRunStageReport(workspace, makeStageReport(workspace, 'test'));
    await publishWorkspaceRunStageReport(workspace, makeStageReport(workspace, 'build'));

    const evidence = await readWorkspaceRunEvidence(workspace);
    expect(evidence?.schemaVersion).toBe(WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION);
    expect(evidence?.latestStage).toBe('build');
    expect(evidence?.stages.test?.stage).toBe('test');
    expect(evidence?.stages.build?.stage).toBe('build');

    const reportPath = path.join(
      workspace,
      '.workspai',
      'reports',
      WORKSPACE_RUN_LAST_REPORT_FILENAME
    );
    const raw = await fsExtra.readJson(reportPath);
    expect(raw.schemaVersion).toBe(WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION);
  });

  it('normalizes legacy flat stage reports', () => {
    const legacy = makeStageReport('/tmp/ws', 'test');
    const normalized = normalizeWorkspaceRunEvidence(legacy);
    expect(normalized?.schemaVersion).toBe(WORKSPACE_RUN_EVIDENCE_SCHEMA_VERSION);
    expect(normalized?.stages.test?.stage).toBe('test');
    expect(resolveWorkspaceRunStageReport(legacy, 'test')?.stage).toBe('test');
  });

  it('preserves both stages when publishers race', async () => {
    const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-race-'));
    createdPaths.push(workspace);

    await Promise.all([
      publishWorkspaceRunStageReport(workspace, makeStageReport(workspace, 'test')),
      publishWorkspaceRunStageReport(workspace, makeStageReport(workspace, 'build')),
    ]);

    const evidence = await readWorkspaceRunEvidence(workspace);
    expect(evidence?.stages.test?.stage).toBe('test');
    expect(evidence?.stages.build?.stage).toBe('build');
  });

  it('refuses to overwrite unreadable existing evidence', async () => {
    const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-invalid-'));
    createdPaths.push(workspace);
    const reportPath = path.join(
      workspace,
      '.workspai',
      'reports',
      WORKSPACE_RUN_LAST_REPORT_FILENAME
    );
    await fsExtra.outputFile(reportPath, '{invalid json');

    await expect(
      publishWorkspaceRunStageReport(workspace, makeStageReport(workspace, 'test'))
    ).rejects.toThrow('refusing to overwrite');
    expect(await fsExtra.readFile(reportPath, 'utf-8')).toBe('{invalid json');
  });

  it('keeps timestamped project history without presenting old rows as the latest run', async () => {
    const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-workspace-run-merge-'));
    createdPaths.push(workspace);
    const base = makeStageReport(workspace, 'test');
    const first: WorkspaceRunReport = {
      ...base,
      generatedAt: '2026-06-16T12:00:00.000Z',
      projects: [
        {
          path: path.join(workspace, 'alpha'),
          relativePath: 'alpha',
          projectName: 'alpha',
          selected: true,
          affected: true,
          status: 'passed',
          exitCode: 0,
          durationMs: 10,
          executionCommand: 'python -m unittest',
        },
        {
          path: path.join(workspace, 'beta'),
          relativePath: 'beta',
          projectName: 'beta',
          selected: false,
          affected: false,
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          reason: 'outside scope',
        },
      ],
      summary: { ...base.summary, selectedCount: 1, passed: 1, skipped: 1 },
    };
    const second: WorkspaceRunReport = {
      ...base,
      generatedAt: '2026-06-16T12:05:00.000Z',
      projects: [
        {
          path: path.join(workspace, 'alpha'),
          relativePath: 'alpha',
          projectName: 'alpha',
          selected: false,
          affected: false,
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          reason: 'outside scope',
        },
        {
          path: path.join(workspace, 'beta'),
          relativePath: 'beta',
          projectName: 'beta',
          selected: true,
          affected: true,
          status: 'passed',
          exitCode: 0,
          durationMs: 12,
          executionCommand: 'python -m unittest',
        },
      ],
      summary: { ...base.summary, selectedCount: 1, passed: 1, skipped: 1 },
    };

    await publishWorkspaceRunStageReport(workspace, first);
    await publishWorkspaceRunStageReport(workspace, second);
    const evidence = await readWorkspaceRunEvidence(workspace);
    const testStage = evidence?.stages.test;
    expect(testStage?.projects.find((project) => project.relativePath === 'alpha')?.status).toBe(
      'skipped'
    );
    expect(testStage?.projects.find((project) => project.relativePath === 'beta')?.status).toBe(
      'passed'
    );
    expect(evidence?.projectStages?.alpha?.test?.status).toBe('passed');
    expect(evidence?.projectStages?.beta?.test?.status).toBe('passed');
  });
});
