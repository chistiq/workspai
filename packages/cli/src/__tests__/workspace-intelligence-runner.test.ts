import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathExists: vi.fn(),
  readJson: vi.fn(),
  syncWorkspaceProjects: vi.fn(),
  syncWorkspaceContract: vi.fn(),
  buildWorkspaceModel: vi.fn(),
  createWorkspaceModelBuildProvenance: vi.fn(),
  writeWorkspaceModel: vi.fn(),
  buildWorkspaceModelSnapshot: vi.fn(),
  migrateLegacyWorkspaceModelSnapshot: vi.fn(),
  writeWorkspaceModelSnapshot: vi.fn(),
  diffWorkspaceModel: vi.fn(),
  writeWorkspaceModelDiff: vi.fn(),
  buildWorkspaceImpact: vi.fn(),
  writeWorkspaceImpact: vi.fn(),
  runDoctor: vi.fn(),
  verifyWorkspaceContract: vi.fn(),
  writeWorkspaceContractVerifyEvidence: vi.fn(),
  runAnalyze: vi.fn(),
  evaluateReleaseReadiness: vi.fn(),
  buildWorkspaceVerify: vi.fn(),
  writeWorkspaceVerify: vi.fn(),
  evaluateWorkspaceVerifyGate: vi.fn(),
  historyEntryFromVerify: vi.fn(),
  recordWorkspaceHistory: vi.fn(),
  buildWorkspaceAgentContext: vi.fn(),
  writeWorkspaceAgentContext: vi.fn(),
  syncWorkspaceAgentGrounding: vi.fn(),
  buildWorkspaceExplain: vi.fn(),
  writeWorkspaceExplainReport: vi.fn(),
  writeWorkspaceArtifactJson: vi.fn(),
  emitWorkspacePhase: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: { pathExists: mocks.pathExists, readJson: mocks.readJson },
}));
vi.mock('../workspace.js', () => ({ syncWorkspaceProjects: mocks.syncWorkspaceProjects }));
vi.mock('../workspace-model.js', () => ({
  buildWorkspaceModel: mocks.buildWorkspaceModel,
  createWorkspaceModelBuildProvenance: mocks.createWorkspaceModelBuildProvenance,
  writeWorkspaceModel: mocks.writeWorkspaceModel,
}));
vi.mock('../workspace-intelligence.js', () => ({
  buildWorkspaceImpact: mocks.buildWorkspaceImpact,
  buildWorkspaceModelSnapshot: mocks.buildWorkspaceModelSnapshot,
  migrateLegacyWorkspaceModelSnapshot: mocks.migrateLegacyWorkspaceModelSnapshot,
  diffWorkspaceModel: mocks.diffWorkspaceModel,
  writeWorkspaceImpact: mocks.writeWorkspaceImpact,
  writeWorkspaceModelDiff: mocks.writeWorkspaceModelDiff,
  writeWorkspaceModelSnapshot: mocks.writeWorkspaceModelSnapshot,
}));
vi.mock('../doctor.js', () => ({ runDoctor: mocks.runDoctor }));
vi.mock('../analyze.js', () => ({ runAnalyze: mocks.runAnalyze }));
vi.mock('../readiness.js', () => ({ evaluateReleaseReadiness: mocks.evaluateReleaseReadiness }));
vi.mock('../workspace-verify.js', () => ({
  buildWorkspaceVerify: mocks.buildWorkspaceVerify,
  writeWorkspaceVerify: mocks.writeWorkspaceVerify,
  evaluateWorkspaceVerifyGate: mocks.evaluateWorkspaceVerifyGate,
}));
vi.mock('../workspace-context.js', () => ({
  buildWorkspaceAgentContext: mocks.buildWorkspaceAgentContext,
  writeWorkspaceAgentContext: mocks.writeWorkspaceAgentContext,
}));
vi.mock('../workspace-agent-sync.js', () => ({
  syncWorkspaceAgentGrounding: mocks.syncWorkspaceAgentGrounding,
}));
vi.mock('../workspace-explain.js', () => ({
  buildWorkspaceExplain: mocks.buildWorkspaceExplain,
  writeWorkspaceExplainReport: mocks.writeWorkspaceExplainReport,
}));
vi.mock('../utils/workspace-contract.js', () => ({
  syncWorkspaceContract: mocks.syncWorkspaceContract,
  verifyWorkspaceContract: mocks.verifyWorkspaceContract,
  writeWorkspaceContractVerifyEvidence: mocks.writeWorkspaceContractVerifyEvidence,
}));
vi.mock('../workspace-history.js', () => ({
  historyEntryFromVerify: mocks.historyEntryFromVerify,
  recordWorkspaceHistory: mocks.recordWorkspaceHistory,
}));
vi.mock('../utils/artifact-path-compat.js', () => ({
  writeWorkspaceArtifactJson: mocks.writeWorkspaceArtifactJson,
}));
vi.mock('../observability/cli-progress.js', () => ({
  emitWorkspacePhase: mocks.emitWorkspacePhase,
}));

import {
  runWorkspaceIntelligenceChain,
  WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH,
} from '../workspace-intelligence-runner.js';
import {
  WORKSPACE_INTELLIGENCE_PREFLIGHT_IDS,
  WORKSPACE_INTELLIGENCE_STEP_IDS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

function configurePassingChain(): void {
  mocks.pathExists.mockResolvedValue(false);
  mocks.readJson.mockResolvedValue({ schemaVersion: 'workspace-model-snapshot.v1' });
  mocks.syncWorkspaceProjects.mockResolvedValue({ added: ['api'], skipped: 1 });
  mocks.syncWorkspaceContract.mockResolvedValue({ contract: { projects: [{ slug: 'api' }] } });
  mocks.buildWorkspaceModel.mockResolvedValue({ summary: { projectCount: 1 } });
  mocks.createWorkspaceModelBuildProvenance.mockReturnValue({
    schemaVersion: 'workspace-model-build.v1',
    mode: 'full',
    outcome: 'rebuilt',
    engineStatus: 'disabled',
  });
  mocks.buildWorkspaceModelSnapshot.mockResolvedValue({
    schemaVersion: 'workspace-model-snapshot.v1',
  });
  mocks.migrateLegacyWorkspaceModelSnapshot.mockReturnValue(null);
  mocks.diffWorkspaceModel.mockResolvedValue({ summary: { changed: false } });
  mocks.buildWorkspaceImpact.mockResolvedValue({
    summary: { risk: 'low', affectedProjects: 0 },
  });
  mocks.runDoctor.mockResolvedValue(0);
  mocks.verifyWorkspaceContract.mockResolvedValue({ status: 'passed' });
  mocks.runAnalyze.mockResolvedValue({ summary: { verdict: 'healthy', score: 98 } });
  mocks.evaluateReleaseReadiness.mockResolvedValue({ overallStatus: 'pass' });
  mocks.buildWorkspaceVerify.mockResolvedValue({ summary: { verdict: 'verified' } });
  mocks.evaluateWorkspaceVerifyGate.mockReturnValue({ passed: true, exitCode: 0 });
  mocks.historyEntryFromVerify.mockReturnValue({ id: 'history-entry' });
  mocks.buildWorkspaceAgentContext.mockResolvedValue({ agent: 'codex' });
  mocks.syncWorkspaceAgentGrounding.mockResolvedValue({ writtenFiles: ['AGENTS.md'] });
  mocks.buildWorkspaceExplain.mockResolvedValue({ summary: 'release is ready' });
  for (const mock of Object.values(mocks)) {
    if (mock.getMockImplementation() === undefined) mock.mockResolvedValue(undefined);
  }
}

describe('unified Workspace Intelligence runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configurePassingChain();
  });

  it('executes the canonical chain, creates a first baseline, and publishes a semantic report', async () => {
    const workspacePath = path.resolve('/tmp/workspai-intelligence-runner-pass');

    const report = await runWorkspaceIntelligenceChain({
      workspacePath,
      strict: true,
      agent: 'codex',
    });

    expect(report.status).toBe('passed');
    expect(report.exitCode).toBe(0);
    expect(report.baselineCreated).toBe(true);
    expect(report.preflight.map((step) => step.id)).toEqual(WORKSPACE_INTELLIGENCE_PREFLIGHT_IDS);
    expect(report.stages.map((stage) => stage.id)).toEqual(WORKSPACE_INTELLIGENCE_STEP_IDS);
    expect(report.preflight.every((step) => step.status === 'passed')).toBe(true);
    expect(report.stages.every((stage) => stage.status === 'passed')).toBe(true);
    expect(
      mocks.emitWorkspacePhase.mock.calls
        .map(([event]) => event.metadata)
        .filter(
          (metadata) =>
            metadata?.intelligenceMilestoneKind === 'stage' &&
            metadata?.intelligenceMilestoneStatus === 'started'
        )
        .map((metadata) => metadata.intelligenceMilestoneId)
    ).toEqual(WORKSPACE_INTELLIGENCE_STEP_IDS);
    expect(
      mocks.emitWorkspacePhase.mock.calls
        .map(([event]) => event.metadata)
        .filter(
          (metadata) =>
            metadata?.intelligenceMilestoneKind === 'preflight' &&
            metadata?.intelligenceMilestoneStatus === 'started'
        )
        .map((metadata) => metadata.intelligenceMilestoneId)
    ).toEqual(WORKSPACE_INTELLIGENCE_PREFLIGHT_IDS);
    expect(mocks.buildWorkspaceModel).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkspaceModelBuildProvenance).toHaveBeenCalledWith({
      mode: 'full',
      engineStatus: 'disabled',
    });
    expect(mocks.writeWorkspaceModel).toHaveBeenCalledWith(
      expect.objectContaining({
        build: {
          schemaVersion: 'workspace-model-build.v1',
          mode: 'full',
          outcome: 'rebuilt',
          engineStatus: 'disabled',
        },
      }),
      workspacePath
    );
    expect(mocks.buildWorkspaceAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath,
        agent: 'codex',
        includeEvidence: true,
        model: expect.objectContaining({ summary: { projectCount: 1 } }),
      })
    );
    expect(mocks.syncWorkspaceAgentGrounding).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', preset: 'enterprise', write: true })
    );
    expect(mocks.writeWorkspaceArtifactJson).toHaveBeenCalledWith(
      workspacePath,
      WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH,
      report
    );
  });

  it('reuses an existing baseline and records every evidence gate as blocked without aborting consumers', async () => {
    mocks.pathExists.mockResolvedValue(true);
    mocks.runDoctor.mockResolvedValue(1);
    mocks.verifyWorkspaceContract.mockResolvedValue({ status: 'failed' });
    mocks.runAnalyze.mockResolvedValue({ summary: { verdict: 'needs-attention', score: 72 } });
    mocks.evaluateReleaseReadiness.mockResolvedValue({ overallStatus: 'warn' });
    mocks.buildWorkspaceVerify.mockResolvedValue({ summary: { verdict: 'blocked' } });
    mocks.evaluateWorkspaceVerifyGate.mockReturnValue({ passed: false, exitCode: 1 });

    const report = await runWorkspaceIntelligenceChain({
      workspacePath: '/tmp/workspai-intelligence-runner-blocked',
      strict: true,
    });

    expect(report.status).toBe('blocked');
    expect(report.exitCode).toBe(2);
    expect(report.baselineCreated).toBe(false);
    expect(report.preflight[1]).toMatchObject({ id: 'baseline', result: 'reused' });
    expect(
      report.stages.filter((stage) => stage.status === 'blocked').map((stage) => stage.id)
    ).toEqual([
      'doctor-evidence',
      'contract-evidence',
      'analyze-evidence',
      'readiness-evidence',
      'verify',
    ]);
    expect(report.stages.find((stage) => stage.id === 'context')?.status).toBe('passed');
    expect(report.stages.find((stage) => stage.id === 'agent-sync')?.status).toBe('passed');
    expect(report.stages.find((stage) => stage.id === 'explain')?.status).toBe('passed');
    expect(mocks.buildWorkspaceModelSnapshot).not.toHaveBeenCalled();
  });

  it('migrates an authenticated legacy baseline before diffing without replacing it', async () => {
    mocks.pathExists.mockResolvedValue(true);
    const legacy = { schemaVersion: 'workspace-model-snapshot.v1', modelHash: 'legacy' };
    const migrated = { schemaVersion: 'workspace-model-snapshot.v1', modelHash: 'canonical' };
    mocks.readJson.mockResolvedValue(legacy);
    mocks.migrateLegacyWorkspaceModelSnapshot.mockReturnValue(migrated);

    const report = await runWorkspaceIntelligenceChain({
      workspacePath: '/tmp/workspai-intelligence-runner-legacy-baseline',
      strict: true,
    });

    expect(report.preflight[1]).toMatchObject({
      id: 'baseline',
      result: 'reused',
      message: 'legacy structural baseline migrated and reused',
    });
    expect(report.baselineCreated).toBe(false);
    expect(mocks.writeWorkspaceModelSnapshot).toHaveBeenCalledWith(
      migrated,
      path.resolve('/tmp/workspai-intelligence-runner-legacy-baseline')
    );
    expect(mocks.diffWorkspaceModel).toHaveBeenCalled();
  });

  it('fails closed on preflight failure and deterministically skips all downstream stages', async () => {
    mocks.syncWorkspaceProjects.mockRejectedValue('registry unavailable');

    const report = await runWorkspaceIntelligenceChain({
      workspacePath: '/tmp/workspai-intelligence-runner-preflight-failure',
    });

    expect(report.status).toBe('failed');
    expect(report.exitCode).toBe(1);
    expect(report.preflight).toEqual([
      expect.objectContaining({ id: 'sync', status: 'failed', message: 'registry unavailable' }),
      expect.objectContaining({ id: 'baseline', status: 'skipped', result: 'skipped' }),
    ]);
    expect(report.stages).toHaveLength(WORKSPACE_INTELLIGENCE_STEP_IDS.length);
    expect(report.stages.every((stage) => stage.status === 'skipped')).toBe(true);
    expect(mocks.buildWorkspaceModel).not.toHaveBeenCalled();
    expect(mocks.writeWorkspaceArtifactJson).toHaveBeenCalledWith(
      expect.any(String),
      WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH,
      report
    );
  });

  it('fails closed when a stage throws and marks every later operation skipped', async () => {
    mocks.diffWorkspaceModel.mockRejectedValue(new Error('diff artifact corrupt'));

    const report = await runWorkspaceIntelligenceChain({
      workspacePath: '/tmp/workspai-intelligence-runner-stage-failure',
    });

    expect(report.status).toBe('failed');
    expect(report.stages.find((stage) => stage.id === 'diff')).toMatchObject({
      status: 'failed',
      exitCode: 1,
      message: 'diff artifact corrupt',
    });
    expect(
      report.stages
        .slice(report.stages.findIndex((stage) => stage.id === 'impact'))
        .every((stage) => stage.status === 'skipped')
    ).toBe(true);
    expect(mocks.runDoctor).not.toHaveBeenCalled();
  });
});
