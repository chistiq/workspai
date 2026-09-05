import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { planGoalPack } from '../goal-pack.js';
import {
  abortProofCarryingChange,
  authorizeProofCarryingChange,
  beginProofCarryingChange,
  createDeletedArtifactReference,
  findUncoveredEffectArtifacts,
  listProofCarryingChanges,
  recordProofCarryingChangeEffect,
  recordProofCarryingChangePrediction,
  resumeProofCarryingChange,
  validatePredictedArchitectureChangeInput,
  validateEffectReceiptInput,
  validateProofCarryingChangeCapsule,
  verifyProofCarryingChange,
} from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import { resetCliRunIdForTests, setCliRunId } from '../observability/cli-log-event.js';

const roots: string[] = [];

async function fixture(): Promise<{ workspacePath: string; projectPath: string }> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-pcc-'));
  roots.push(workspacePath);
  const projectPath = path.join(workspacePath, 'api');
  await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
    name: 'platform',
    profile: 'polyglot',
  });
  await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-08-29T00:00:00.000Z',
    workspace: { name: 'platform', profile: 'polyglot' },
    projects: [
      {
        slug: 'api',
        relativePath: 'api',
        runtime: 'node',
        framework: 'nestjs',
        kit: 'nestjs.standard',
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
  await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
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
  await fsExtra.outputFile(
    path.join(projectPath, 'src', 'retry-backoff.ts'),
    'export const retryBackoff = (attempt: number) => 2 ** attempt;\n'
  );
  const model = await buildWorkspaceModel({
    workspacePath,
    includeAbsolutePaths: true,
    now: new Date('2026-08-29T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, workspacePath);
  return { workspacePath, projectPath };
}

afterEach(async () => {
  resetCliRunIdForTests();
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('proof-carrying change composition', () => {
  it('keeps a Goal lease valid when Workspai operational telemetry changes before PCC begins', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Warm project dependencies through an approved command',
    });

    await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      name: 'platform',
      profile: 'polyglot',
      metadata: {
        custom: {
          workspaiTelemetry: {
            commandUsage: { 'workspai.studio.action_executed': 1 },
            recentEvents: [
              {
                command: 'workspai.studio.action_executed',
                at: '2026-08-29T00:01:00.000Z',
              },
            ],
          },
        },
      },
    });
    await fsExtra.outputFile(
      path.join(workspacePath, '.github', 'agents', 'workspai-repair.agent.md'),
      'Generated repair agent projection.\n'
    );

    await expect(
      beginProofCarryingChange({
        workspacePath,
        goalId: planned.goalPack.id,
      })
    ).resolves.toMatchObject({
      state: 'evidence-ready',
      capsule: {
        assurances: expect.arrayContaining([
          expect.objectContaining({ id: 'baseline-pinned', status: 'passed' }),
        ]),
      },
    });
  });

  it('covers overlapping Graph aliases with one receipt for the same physical artifact', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-pcc-overlap-'));
    roots.push(root);
    const workspacePath = path.join(root, 'workspace');
    const sourcePath = path.join(root, 'source');
    const nestedPath = path.join(sourcePath, 'python');
    await fsExtra.ensureDir(path.join(nestedPath, 'src'));
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-08-29T00:00:00.000Z',
      workspace: { name: 'platform', profile: 'polyglot' },
      projects: [
        {
          slug: 'platform',
          relativePath: 'external/platform',
          externalPath: sourcePath,
        },
        {
          slug: 'platform-python',
          relativePath: 'external/platform-python',
          externalPath: nestedPath,
        },
      ],
    });

    const uncovered = await findUncoveredEffectArtifacts({
      workspacePath,
      changedArtifacts: [
        'external/platform/python/src/obsolete.py',
        'external/platform-python/src/obsolete.py',
      ],
      receiptedArtifacts: ['external/platform-python/src/obsolete.py'],
    });

    expect(uncovered).toEqual([]);
  });

  it('normalizes compact deleted-artifact input into a typed tombstone', () => {
    const receipt = validateEffectReceiptInput({
      id: 'delete-obsolete-source',
      effectClass: 'filesystem',
      status: 'succeeded',
      summary: 'Removed obsolete source.',
      artifacts: [],
      deletedArtifacts: [{ artifact: './api/src/obsolete.ts' }],
      observedAt: '2026-08-29T00:01:00.000Z',
      idempotencyKey: 'delete-obsolete-source-v1',
    });
    expect(receipt.deletedArtifacts).toEqual([
      expect.objectContaining({
        artifact: 'api/src/obsolete.ts',
        observedAt: '2026-08-29T00:01:00.000Z',
        digest: expect.objectContaining({ semantics: 'deletion-tombstone-v1' }),
      }),
    ]);
  });

  it('pins Goal and architecture identity, keeps prediction noncanonical, and preserves an aborted audit trail', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff behavior',
    });
    expect(planned.goalPack.state).toBe('ready-to-plan');

    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    expect(begun.state).toBe('evidence-ready');
    expect(begun.capsule.assurances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'intent-bound', status: 'passed' }),
        expect.objectContaining({ id: 'baseline-pinned', status: 'passed' }),
      ])
    );

    const prediction = validatePredictedArchitectureChangeInput({
      operations: [
        {
          operation: 'change',
          targetKind: 'artifact',
          targetId: 'api/src/retry-backoff.ts',
          rationale: 'The Goal targets retry behavior.',
          confidence: 'high',
        },
      ],
      assumptions: ['The public retry contract remains backward compatible.'],
      predictedRisk: 'low',
    });
    const predicted = await recordProofCarryingChangePrediction({
      workspacePath,
      changeId: begun.changeId,
      prediction,
    });
    expect(predicted.capsule.prediction).toMatchObject({ role: 'prediction' });
    expect(predicted.capsule.verification).toEqual([]);

    const authorized = await authorizeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      effectClasses: ['filesystem', 'command'],
      grantedBy: 'maintainer',
    });
    expect(authorized.state).toBe('authorized');

    const aborted = await abortProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      reason: 'Operator cancelled before mutation.',
      actorId: 'maintainer',
    });
    expect(aborted.state).toBe('aborted');
    expect(aborted.capsule.status).toBe('aborted');
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({ valid: true });
    await expect(listProofCarryingChanges({ workspacePath })).resolves.toMatchObject({
      changes: [
        expect.objectContaining({
          changeId: begun.changeId,
          state: 'aborted',
          status: 'aborted',
          valid: true,
        }),
      ],
      summary: { total: 1, open: 0, blocked: 0, sealed: 0, aborted: 1, invalid: 0 },
    });

    const transactionPath = path.join(
      workspacePath,
      '.workspai',
      'decisions',
      begun.changeId,
      'transaction.json'
    );
    const transaction = await fsExtra.readJson(transactionPath);
    transaction.terminalReason = 'tampered projection';
    await fsExtra.writeJson(transactionPath, transaction);
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringMatching(/transaction\.json/)]),
    });
  });

  it('re-observes a no-effect architecture generation before emitting verification proof', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff behavior',
    });
    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      effectClasses: ['command'],
      grantedBy: 'maintainer',
    });

    const verified = await verifyProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      refresh: false,
    });

    expect(verified.state).toBe('blocked');
    expect(verified.capsule.status).toBe('blocked');
    expect(verified.capsule.actualOverlay).toMatchObject({
      role: 'actual-architecture-overlay',
    });
    expect(verified.capsule.surpriseReport).toMatchObject({
      role: 'architecture-surprises',
    });
    expect(verified.capsule.assurances).toContainEqual(
      expect.objectContaining({ id: 'effects-receipted', status: 'passed' })
    );
    expect(verified.capsule.verification.length).toBeGreaterThan(0);
    const listed = await listProofCarryingChanges({ workspacePath });
    expect(listed.changes[0]?.blockers).toContainEqual(
      expect.stringContaining('independently-verified')
    );
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({ valid: true });

    const resumed = await resumeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      resumeTo: 'authorized',
      reason: 'Operator will add missing evidence.',
      actorId: 'maintainer',
    });
    expect(resumed.state).toBe('authorized');
  });

  it('pins the current Graph materialization after a metadata-only refresh', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the project architecture',
    });
    const originalGraphHash = planned.goalPack.sourceBinding.graph.hash;

    const refreshedModel = await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: true,
      now: new Date('2026-08-29T00:01:00.000Z'),
    });
    await writeWorkspaceModel(refreshedModel, workspacePath);

    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });

    expect(begun.capsule.baseline.graph.digest.value).not.toBe(originalGraphHash);
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({ valid: true });
    await expect(listProofCarryingChanges({ workspacePath })).resolves.toMatchObject({
      summary: expect.objectContaining({ invalid: 0 }),
    });
  });

  it('binds verification receipts to the exact run-correlated artifact persisted by the CLI', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff behavior',
    });
    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      effectClasses: ['command'],
      grantedBy: 'maintainer',
    });

    setCliRunId('run-pcc-verification-correlation');
    await verifyProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      refresh: false,
    });

    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({ valid: true });
  });

  it('detects stale leases, unreceipted architecture changes, and tampered capsules', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff behavior',
    });
    const stale = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
      name: '@platform/api',
      version: '1.0.1',
      scripts: { test: 'vitest run' },
      dependencies: { '@nestjs/core': '^11.0.0' },
    });
    const changedModel = await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: true,
      now: new Date('2026-08-29T00:01:00.000Z'),
    });
    await writeWorkspaceModel(changedModel, workspacePath);
    await expect(
      authorizeProofCarryingChange({
        workspacePath,
        changeId: stale.changeId,
        effectClasses: ['filesystem'],
        grantedBy: 'maintainer',
      })
    ).rejects.toThrow(/lease .* is stale/i);

    const replanned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff behavior after dependency metadata refresh',
      refresh: true,
    });
    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: replanned.goalPack.id,
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'retry-policy.ts'),
      'export const retryPolicy = { attempts: 3 };\n'
    );
    const postEffectModel = await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: true,
      now: new Date('2026-08-29T00:02:00.000Z'),
    });
    await writeWorkspaceModel(postEffectModel, workspacePath);
    const blocked = await verifyProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      refresh: false,
    });
    expect(blocked.state).toBe('blocked');
    expect(blocked.capsule.remainingUncertainty).toContain(
      'Record the actual mutation effect before verification can claim causality.'
    );

    const capsulePath = path.join(
      workspacePath,
      '.workspai',
      'changes',
      begun.changeId,
      'capsule.json'
    );
    const capsule = await fsExtra.readJson(capsulePath);
    capsule.remainingUncertainty = ['tampered'];
    await fsExtra.writeJson(capsulePath, capsule);
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringMatching(/integrity digest/)]),
    });
    const listed = await listProofCarryingChanges({ workspacePath });
    expect(listed.summary.invalid).toBe(1);
    expect(listed.changes.find((item) => item.changeId === begun.changeId)).toMatchObject({
      valid: false,
    });
  });

  it('records a deletion tombstone, covers the fresh Graph removal, and detects resurrection', async () => {
    const { workspacePath, projectPath } = await fixture();
    const sourcePath = path.join(projectPath, 'src', 'retry-backoff.ts');
    const sourceBytes = await fsExtra.readFile(sourcePath);
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Remove the obsolete retry backoff implementation',
    });
    const begun = await beginProofCarryingChange({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    const deletedArtifact = createDeletedArtifactReference({
      artifact: 'api/src/retry-backoff.ts',
      observedAt: '2026-08-29T00:01:00.000Z',
    });

    await expect(
      recordProofCarryingChangeEffect({
        workspacePath,
        changeId: begun.changeId,
        receipt: {
          id: 'delete-retry-backoff',
          effectClass: 'filesystem',
          status: 'succeeded',
          summary: 'Removed the obsolete retry implementation.',
          artifacts: [],
          deletedArtifacts: [deletedArtifact],
          observedAt: '2026-08-29T00:01:00.000Z',
          idempotencyKey: 'delete-retry-backoff-v1',
        },
      })
    ).rejects.toThrow(/artifact is present/i);

    await fsExtra.remove(sourcePath);
    await expect(
      recordProofCarryingChangeEffect({
        workspacePath,
        changeId: begun.changeId,
        receipt: {
          id: 'delete-retry-backoff-tampered',
          effectClass: 'filesystem',
          status: 'succeeded',
          summary: 'Attempted to record a tampered deletion tombstone.',
          artifacts: [],
          deletedArtifacts: [
            {
              ...deletedArtifact,
              digest: { ...deletedArtifact.digest, value: '0'.repeat(64) },
            },
          ],
          observedAt: '2026-08-29T00:01:00.000Z',
          idempotencyKey: 'delete-retry-backoff-tampered-v1',
        },
      })
    ).rejects.toThrow(/invalid tombstone/i);

    const recorded = await recordProofCarryingChangeEffect({
      workspacePath,
      changeId: begun.changeId,
      receipt: {
        id: 'delete-retry-backoff',
        effectClass: 'filesystem',
        status: 'succeeded',
        summary: 'Removed the obsolete retry implementation.',
        artifacts: [],
        deletedArtifacts: [deletedArtifact],
        observedAt: '2026-08-29T00:01:00.000Z',
        idempotencyKey: 'delete-retry-backoff-v1',
      },
    });
    expect(recorded.capsule.deletedArtifacts).toEqual([deletedArtifact]);

    const postEffectModel = await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: true,
      now: new Date('2026-08-29T00:02:00.000Z'),
    });
    await writeWorkspaceModel(postEffectModel, workspacePath);
    const verified = await verifyProofCarryingChange({
      workspacePath,
      changeId: begun.changeId,
      refresh: false,
    });
    const actualOverlay = await fsExtra.readJson(
      path.join(workspacePath, verified.capsule.actualOverlay?.artifact ?? '')
    );
    expect(actualOverlay.changedArtifacts).toContain('api/src/retry-backoff.ts');
    expect(verified.capsule.remainingUncertainty).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Uncovered artifacts:/)])
    );
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({ valid: true });

    await fsExtra.outputFile(sourcePath, sourceBytes);
    await expect(
      validateProofCarryingChangeCapsule({ workspacePath, changeId: begun.changeId })
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringMatching(/exists again/)]),
    });
  });
});
