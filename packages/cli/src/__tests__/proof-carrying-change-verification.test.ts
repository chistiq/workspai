import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { planGoalPack } from '../goal-pack.js';
import { writeProjectWorkspaceLink } from '../project-workspace-link.js';
import { publishWorkspaceRunStageReport } from '../utils/workspace-run-evidence.js';
import {
  authorizeProofCarryingChange,
  beginProofCarryingChange,
  createDeletedArtifactReference,
  inspectProofCarryingChange,
  recordProofCarryingChangeEffect,
  recordProofCarryingChangePrediction,
  recordProofCarryingChangeVerification,
  resumeProofCarryingChange,
  validatePredictedArchitectureChangeInput,
  validateProofCarryingChangeCapsule,
  verifyProofCarryingChange,
} from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import {
  buildWorkspaceModelSnapshot,
  writeWorkspaceModelSnapshot,
} from '../workspace-intelligence.js';
import type { WorkspaceRunReport } from '../workspace-run.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';

const roots: string[] = [];
const effectTime = '2026-08-29T00:01:00.000Z';
const freshTime = '2026-08-29T00:03:00.000Z';
const staleTime = '2026-08-28T00:03:00.000Z';
const sourceV1 = 'export const retryBackoff = (attempt: number) => 2 ** attempt + 1;\n';
const sourceV2 = sourceV1.replace('+ 1', '+ 2');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

async function setup(
  options: {
    external?: boolean;
    workspaceAlias?: boolean;
    intent?: string;
    dependent?: boolean;
  } = {}
) {
  const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-pcc-verification-'));
  roots.push(root);
  const canonicalWorkspace = path.join(root, 'workspace');
  await fsExtra.ensureDir(canonicalWorkspace);
  let workspacePath = canonicalWorkspace;
  if (options.workspaceAlias) {
    workspacePath = path.join(root, 'workspace-alias');
    await fsExtra.symlink(
      canonicalWorkspace,
      workspacePath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  }
  const projectPath = options.external
    ? path.join(root, 'source', 'api')
    : path.join(workspacePath, 'api');
  const prefix = options.external ? 'external/api' : 'api';
  const project = {
    slug: 'api',
    relativePath: prefix,
    ...(options.external ? { externalPath: projectPath } : {}),
    runtime: 'node',
    framework: 'nestjs',
    kit: 'nestjs.standard',
    modules: [],
    ports: [],
    contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
  };
  await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
    name: 'platform',
    profile: 'polyglot',
  });
  await fsExtra.outputJson(path.join(workspacePath, '.workspai/workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-08-29T00:00:00.000Z',
    workspace: { name: 'platform', profile: 'polyglot' },
    projects: [
      project,
      ...(options.dependent ? [{ ...project, slug: 'web', relativePath: 'web' }] : []),
    ],
  });
  await fsExtra.outputJson(path.join(projectPath, '.workspai/project.json'), {
    name: 'api',
    runtime: 'node',
    framework: 'nestjs',
  });
  await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
    name: '@platform/api',
    version: '1.0.0',
    scripts: { test: 'vitest run' },
    dependencies: { '@nestjs/core': '^11.0.0' },
  });
  if (options.dependent) {
    await fsExtra.outputJson(path.join(workspacePath, 'web/.workspai/project.json'), {
      name: 'web',
      runtime: 'node',
      framework: 'nestjs',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'web/package.json'), {
      name: '@platform/web',
      version: '1.0.0',
      scripts: { test: 'vitest run' },
      dependencies: { '@nestjs/core': '^11.0.0', '@platform/api': '^1.0.0' },
    });
  }
  if (options.external) {
    await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName: 'api',
      relationship: 'adopted',
      relativePath: prefix,
    });
  }
  const sourcePath = path.join(projectPath, 'src/retry-backoff.ts');
  const sourceArtifact = `${prefix}/src/retry-backoff.ts`;
  await fsExtra.outputFile(
    sourcePath,
    'export const retryBackoff = (attempt: number) => 2 ** attempt;\n'
  );
  async function refresh() {
    const model = await buildWorkspaceModel({
      workspacePath,
      now: new Date('2026-08-29T00:02:00.000Z'),
    });
    await writeWorkspaceModel(model, workspacePath);
    await writeWorkspaceModelSnapshot(
      await buildWorkspaceModelSnapshot({
        workspacePath,
        model,
        now: new Date('2026-08-29T00:02:00.000Z'),
      }),
      workspacePath
    );
  }
  await refresh();
  const goal = await planGoalPack({
    startPath: projectPath,
    intent: options.intent ?? 'Improve retry backoff behavior',
  });
  const begun = await beginProofCarryingChange({ workspacePath, goalId: goal.goalPack.id });
  const changeId = begun.changeId;
  await recordProofCarryingChangePrediction({
    workspacePath,
    changeId,
    prediction: validatePredictedArchitectureChangeInput({
      operations: [
        {
          operation: 'change',
          targetKind: 'artifact',
          targetId: sourceArtifact,
          rationale: 'Adjust the retry calculation.',
          confidence: 'high',
        },
      ],
      assumptions: ['Project contracts remain unchanged.'],
      predictedRisk: 'low',
    }),
  });
  await authorizeProofCarryingChange({
    workspacePath,
    changeId,
    effectClasses: ['filesystem'],
    grantedBy: 'maintainer',
  });
  let receiptSequence = 0;
  async function record(content: string, artifact = sourceArtifact, observedAt = effectTime) {
    const id = `effect-${++receiptSequence}`;
    return recordProofCarryingChangeEffect({
      workspacePath,
      changeId,
      receipt: {
        id,
        idempotencyKey: id,
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Recorded the actual source update.',
        observedAt,
        artifacts: [
          {
            role: 'changed-source',
            artifact,
            schemaVersion: 'raw-bytes-v1',
            digest: {
              algorithm: 'sha256',
              semantics: 'raw-bytes-v1',
              value: createHash('sha256').update(content).digest('hex'),
            },
          },
        ],
      },
    });
  }
  async function update(content = sourceV1, artifact = sourceArtifact, observedAt = effectTime) {
    await fsExtra.outputFile(sourcePath, content);
    return record(content, artifact, observedAt);
  }
  async function removeSource() {
    await fsExtra.remove(sourcePath);
    const id = `effect-${++receiptSequence}`;
    return recordProofCarryingChangeEffect({
      workspacePath,
      changeId,
      receipt: {
        id,
        idempotencyKey: id,
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Removed source.',
        observedAt: '2026-08-29T00:01:20.000Z',
        artifacts: [],
        deletedArtifacts: [
          createDeletedArtifactReference({
            artifact: sourceArtifact,
            observedAt: '2026-08-29T00:01:20.000Z',
          }),
        ],
      },
    });
  }
  async function evidence(
    generatedAt = freshTime,
    names = ['api'],
    status: 'passed' | 'skipped' = 'passed',
    execution: { durationMs?: number; reusePassed?: boolean; planOnly?: boolean } = {}
  ) {
    const runReport = {
      schemaVersion: '1.0',
      workspacePath,
      stage: 'test',
      generatedAt,
      durationMs: execution.durationMs ?? 1,
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
        reusePassed: execution.reusePassed ?? false,
        planOnly: execution.planOnly ?? false,
        runtime: null,
      },
      selection: {
        mode: 'all',
        since: null,
        scope: null,
        graphStatus: 'not-applicable',
        expansionDepth: 0,
      },
      gates: { enforced: false, results: [], blocked: false },
      summary: {
        projectCount: names.length,
        selectedCount: names.length,
        passed: status === 'passed' ? names.length : 0,
        failed: 0,
        skipped: status === 'skipped' ? names.length : 0,
        blocked: 0,
        exitCode: 0,
      },
      projects: names.map((name) => ({
        path: name === 'api' ? projectPath : path.join(workspacePath, name),
        relativePath: name === 'api' ? prefix : name,
        projectName: name,
        selected: true,
        affected: false,
        status,
        exitCode: 0,
        durationMs: 1,
      })),
    } as WorkspaceRunReport;
    await publishWorkspaceRunStageReport(workspacePath, { ...runReport, stage: 'init' });
    await publishWorkspaceRunStageReport(workspacePath, runReport);
  }
  async function healthyWorkspace() {
    const generatedAt = freshTime;
    await fsExtra.outputJson(path.join(workspacePath, '.workspai/reports/doctor-last-run.json'), {
      schemaVersion: 'doctor-workspace-evidence-v1',
      evidenceType: 'workspace',
      generatedAt,
      workspacePath,
      summary: { totalProjects: 1, totalIssues: 0, hasSystemErrors: false },
      projects: [],
      healthScore: { percent: 95, errors: 0 },
    });
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai/reports/release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        generatedAt,
        workspacePath,
        projectPath: workspacePath,
        overallStatus: 'pass',
        blocking: false,
        blockingReasons: [],
        gates: [],
      }
    );
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai/reports/workspace-contract-verify-last-run.json'),
      {
        schemaVersion: 'workspace-contract-verify.v1',
        generatedAt,
        status: 'passed',
        contractPath: '.workspai/workspace.contract.json',
        projectCount: 1,
        checks: [],
        violations: [],
      }
    );
  }
  async function verify(strict = false) {
    return verifyProofCarryingChange({ workspacePath, changeId, refresh: false, strict });
  }
  async function report() {
    return fsExtra.readJson(
      path.join(workspacePath, '.workspai/changes', changeId, 'verification/workspace-verify.json')
    );
  }
  async function validCapsule() {
    expect(await validateProofCarryingChangeCapsule({ workspacePath, changeId })).toMatchObject({
      valid: true,
      errors: [],
    });
  }
  return {
    workspacePath,
    projectPath,
    sourcePath,
    sourceArtifact,
    changeId,
    update,
    record,
    removeSource,
    refresh,
    evidence,
    healthyWorkspace,
    verify,
    report,
    validCapsule,
  };
}

describe('Proof-Carrying Change current effects and verification', () => {
  it.each([{}, { external: true }, { workspaceAlias: true }])(
    'seals a local change with fresh evidence and validates its capsule (%j)',
    async (options) => {
      const c = await setup(options);
      await c.update();
      await c.refresh();
      await c.evidence();
      expect(await c.verify()).toMatchObject({ state: 'committed', capsule: { status: 'sealed' } });
      expect((await c.report()).steps.map((step: { id: string }) => step.id)).not.toContain(
        'workspace.doctor'
      );
      await c.validCapsule();
    }
  );

  it.each([staleTime, effectTime])(
    'rejects evidence from before or at the last effect (%s)',
    async (time) => {
      const c = await setup();
      await c.update();
      await c.refresh();
      await c.evidence(time);
      expect(await c.verify()).toMatchObject({ state: 'blocked' });
      expect((await c.report()).blockingReasons.join('\n')).toContain('latest governed effect');
    }
  );

  it.each([false, true])(
    'keeps the freshness floor in the full workspace gate (strict=%s)',
    async (strict) => {
      const c = await setup();
      await c.update();
      await fsExtra.outputFile(path.join(c.workspacePath, 'shared.txt'), 'shared\n');
      await c.record('shared\n', 'api/../shared.txt');
      await c.refresh();
      await c.healthyWorkspace();
      await c.evidence(staleTime);
      expect(await c.verify(strict)).toMatchObject({ state: 'blocked' });
      const report = await c.report();
      expect(report.steps.map((step: { id: string }) => step.id)).toContain('workspace.doctor');
      expect(
        report.steps.find((step: { id: string }) => step.id === 'project.api.test')
      ).toMatchObject({ status: 'fail' });
    }
  );

  it.each([false, true])(
    'blocks unreceipted bytes before gate selection (strict=%s)',
    async (strict) => {
      const c = await setup();
      await c.update();
      await fsExtra.outputFile(c.sourcePath, sourceV2);
      await c.refresh();
      await c.evidence();
      await c.healthyWorkspace();
      const result = await c.verify(strict);
      expect(result).toMatchObject({ state: 'blocked', capsule: { status: 'blocked' } });
      expect(result.capsule.remainingUncertainty.join('\n')).toContain('Current effect artifact');
      expect(result.nextActions.join('\n')).toContain('change effect record');
      expect(
        (
          await inspectProofCarryingChange({ workspacePath: c.workspacePath, changeId: c.changeId })
        ).nextActions.join('\n')
      ).toContain('change effect record');
    }
  );

  it('validates only the last receipt after sequential edits, while retaining the ledger history', async () => {
    const c = await setup();
    await c.update();
    await c.update(
      sourceV2,
      c.sourceArtifact.replace('/src/', '/src/./'),
      '2026-08-29T00:01:30.000Z'
    );
    await c.refresh();
    await c.evidence();
    const result = await c.verify();
    expect(result.state).toBe('committed');
    expect(result.capsule.effects).toHaveLength(1);
    const ledger = await fsExtra.readJson(
      path.join(c.workspacePath, '.workspai/decisions', c.changeId, 'transaction.json')
    );
    expect(ledger.effects).toHaveLength(2);
    await c.validCapsule();
  });

  it.each([false, true])(
    'projects update/delete/recreate sequences without stale live refs or tombstones (recreate=%s)',
    async (recreate) => {
      const c = await setup();
      await c.update();
      await c.removeSource();
      if (recreate) await c.update(sourceV2, c.sourceArtifact, '2026-08-29T00:01:40.000Z');
      await c.refresh();
      await c.evidence();
      const result = await c.verify();
      expect(result.state).toBe('committed');
      expect(result.capsule.effects).toHaveLength(recreate ? 1 : 0);
      expect(result.capsule.deletedArtifacts).toHaveLength(recreate ? 0 : 1);
      await c.validCapsule();
    }
  );

  it('rejects a reappeared deleted artifact', async () => {
    const c = await setup();
    await c.update();
    await c.removeSource();
    await fsExtra.outputFile(c.sourcePath, sourceV2);
    await c.refresh();
    await c.evidence();
    await c.healthyWorkspace();
    expect(await c.verify()).toMatchObject({ state: 'blocked' });
  });

  it('uses the full workspace gate for a symlink to a shared file', async () => {
    const c = await setup();
    await c.update();
    const target = path.join(c.workspacePath, 'shared.txt');
    await fsExtra.outputFile(target, 'shared\n');
    await fsExtra.symlink(target, path.join(c.projectPath, 'shared-link.txt'), 'file');
    await c.record('shared\n', 'api/shared-link.txt');
    await c.refresh();
    await c.evidence();
    expect(await c.verify()).toMatchObject({ state: 'blocked' });
    expect((await c.report()).steps.map((step: { id: string }) => step.id)).toContain(
      'workspace.doctor'
    );
  });

  it('requires fresh checks for transitive dependents even without a structural Model diff', async () => {
    const c = await setup({ dependent: true });
    await c.update();
    await c.refresh();
    await c.evidence();
    expect(await c.verify()).toMatchObject({ state: 'blocked' });
    expect(
      (await c.report()).steps.find((step: { id: string }) => step.id === 'project.web.test')
    ).toMatchObject({ status: 'missing' });
  });

  it('does not accept skipped runtime checks as successful governed verification', async () => {
    const c = await setup();
    await c.update();
    await c.refresh();
    await c.evidence(freshTime, ['api'], 'skipped');
    expect(await c.verify()).toMatchObject({ state: 'blocked' });
  });

  it('resumes after stale evidence and validates a capsule without old verification digests', async () => {
    const c = await setup();
    await c.update();
    await c.refresh();
    await c.evidence(staleTime);
    expect(await c.verify()).toMatchObject({ state: 'blocked' });
    await resumeProofCarryingChange({
      workspacePath: c.workspacePath,
      changeId: c.changeId,
      resumeTo: 'authorized',
      reason: 'Rerun fresh checks.',
      actorId: 'maintainer',
    });
    await c.evidence();
    expect(await c.verify()).toMatchObject({ state: 'committed' });
    await c.validCapsule();
  });

  it.each([{ reusePassed: true }, { planOnly: true }, { durationMs: 180_001 }])(
    'rejects fresh-looking reports without an actual post-effect execution (%j)',
    async (execution) => {
      const c = await setup();
      await c.update();
      await c.refresh();
      await c.evidence(freshTime, ['api'], 'passed', execution);
      expect(await c.verify()).toMatchObject({ state: 'blocked' });
      expect(
        (await c.report()).steps.find((step: { id: string }) => step.id === 'project.api.test')
      ).toMatchObject({ status: 'fail' });
    }
  );

  it.each([false, true])(
    'preserves actual execution provenance in keyed stage history (reused=%s)',
    async (reusePassed) => {
      const c = await setup();
      await c.update();
      await c.refresh();
      await c.evidence(freshTime, ['api'], 'passed', { reusePassed });
      const evidencePath = path.join(c.workspacePath, '.workspai/reports/workspace-run-last.json');
      const aggregate = await fsExtra.readJson(evidencePath);
      // A later fleet run can skip this project while preserving the exact prior
      // per-project receipt. Its execution mode must not be replaced by the later run.
      for (const stage of ['init', 'test']) {
        aggregate.stages[stage].projects[0].status = 'skipped';
        aggregate.stages[stage].projects[0].selected = false;
        aggregate.stages[stage].options.reusePassed = false;
      }
      await fsExtra.writeJson(evidencePath, aggregate);
      const result = await c.verify();
      expect(result.state).toBe(reusePassed ? 'blocked' : 'committed');
      if (!reusePassed) await c.validCapsule();
    }
  );

  it('resolves adopted evidence through its contract even when a local path shadows its portable label', async () => {
    const c = await setup({ external: true });
    await fsExtra.outputFile(
      path.join(c.workspacePath, c.sourceArtifact),
      'unrelated shadow file\n'
    );
    await c.update();
    await c.refresh();
    await c.evidence();
    expect(await c.verify()).toMatchObject({ state: 'committed' });
    await c.validCapsule();
  });

  it('keeps legacy capsule history readable and rejects omission of current effect evidence', async () => {
    const c = await setup();
    await c.update();
    await c.update(sourceV2, c.sourceArtifact, '2026-08-29T00:01:30.000Z');
    await c.refresh();
    await c.evidence();
    const result = await c.verify();
    expect(result.state).toBe('committed');
    const capsulePath = path.join(c.workspacePath, '.workspai/changes', c.changeId, 'capsule.json');
    const ledger = await fsExtra.readJson(
      path.join(c.workspacePath, '.workspai/decisions', c.changeId, 'transaction.json')
    );
    const { integrity: _integrity, ...unsigned } = result.capsule;
    unsigned.effects = ledger.effects.flatMap(
      (effect: { artifacts: unknown[] }) => effect.artifacts
    );
    const publish = async () =>
      fsExtra.writeJson(capsulePath, {
        ...unsigned,
        integrity: {
          algorithm: 'sha256',
          semantics: 'canonical-json-v1',
          capsuleDigest: hashCanonicalJson(unsigned),
        },
      });
    await publish();
    await c.validCapsule();
    unsigned.effects = [];
    await publish();
    const validation = await validateProofCarryingChangeCapsule({
      workspacePath: c.workspacePath,
      changeId: c.changeId,
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('artifact projection');
  });

  it.each([false, true])(
    'admits domain evidence only while its latest scope verification remains intact (corrupt=%s)',
    async (corrupt) => {
      const c = await setup({ intent: 'Verify release readiness' });
      await c.update();
      await c.refresh();
      await c.evidence();
      await c.healthyWorkspace();
      const verified = await c.verify();
      expect(verified.state).toBe('blocked'); // The separate release criterion is still open.
      const ledger = await fsExtra.readJson(
        path.join(c.workspacePath, '.workspai/decisions', c.changeId, 'transaction.json')
      );
      const scope = ledger.verifications.at(-1);
      expect(scope).toMatchObject({ criterionId: 'workspace-verify', status: 'passed' });
      const scopeArtifact = scope.artifacts[0];
      if (corrupt) {
        const verifyPath = path.join(c.workspacePath, scopeArtifact.artifact);
        const report = await fsExtra.readJson(verifyPath);
        report.summary.verdict = 'blocked';
        await fsExtra.writeJson(verifyPath, report);
      }
      const artifact = '.workspai/reports/release-readiness-last-run.json';
      const readiness = await fsExtra.readJson(path.join(c.workspacePath, artifact));
      const admit = () =>
        recordProofCarryingChangeVerification({
          workspacePath: c.workspacePath,
          changeId: c.changeId,
          receipt: {
            id: 'release-readiness-check',
            criterionId: 'release-readiness',
            status: 'passed',
            summary: 'The domain readiness checks passed.',
            target: scope.target,
            observedAt: freshTime,
            artifacts: [
              {
                role: 'release-readiness',
                artifact,
                schemaVersion: 'release-readiness-v1',
                digest: {
                  algorithm: 'sha256',
                  semantics: 'canonical-json-v1',
                  value: hashCanonicalJson(readiness),
                },
              },
            ],
          },
        });
      if (corrupt) {
        await expect(admit()).rejects.toThrow('Scope verification artifact is missing or corrupt');
      } else {
        expect(await admit()).toMatchObject({ state: 'committed' });
        await c.validCapsule();
      }
    }
  );
});
