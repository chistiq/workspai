import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyPreparedAgentFrameworkAttachment,
  prepareAgentFrameworkAttachment,
} from '../agent-frameworks/user-flow.js';
import { readDecisionTransaction } from '../decisions/decision-store.js';
import { inspectGoalLifecycle } from '../goal-lifecycle.js';
import { verifyProofCarryingChange } from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import { runWorkspaceIntelligenceChain } from '../workspace-intelligence-runner.js';

const roots: string[] = [];

async function fixture(options: { secondProject?: boolean } = {}): Promise<{
  workspacePath: string;
  projectPath: string;
}> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-user-flow-'));
  roots.push(workspacePath);
  const projectPath = path.join(workspacePath, 'api');
  await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
    name: 'platform',
    profile: 'polyglot',
  });
  await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-09-06T00:00:00.000Z',
    workspace: { name: 'platform', profile: 'polyglot' },
    projects: [
      {
        slug: 'api',
        relativePath: 'api',
        runtime: 'node',
        framework: 'express',
        kit: 'express.standard',
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
      ...(options.secondProject
        ? [
            {
              slug: 'worker',
              relativePath: 'worker',
              runtime: 'node',
              framework: 'node',
              kit: 'node',
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
          ]
        : []),
    ],
  });
  await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
    name: '@platform/api',
    version: '1.0.0',
  });
  if (options.secondProject) {
    await fsExtra.outputJson(path.join(workspacePath, 'worker', 'package.json'), {
      name: '@platform/worker',
      version: '1.0.0',
    });
  }
  const model = await buildWorkspaceModel({
    workspacePath,
    includeAbsolutePaths: true,
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, workspacePath);
  return { workspacePath, projectPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('agent framework user flow', () => {
  it('turns one attach request into a Goal, hash-bound plan, authorization, and owned files', async () => {
    const { workspacePath, projectPath } = await fixture();
    const prepared = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      instanceName: 'Release Reviewer',
    });

    expect(prepared).toMatchObject({
      schemaVersion: 'workspai.agent-framework-attachment.v1',
      operation: 'plan',
      status: 'planned',
      project: 'api',
      runtime: 'python',
      instanceName: 'release-reviewer',
    });
    expect(prepared.files).toHaveLength(6);
    expect(await fsExtra.pathExists(path.join(projectPath, 'agents', 'release-reviewer'))).toBe(
      false
    );

    const plannedTransaction = await readDecisionTransaction(workspacePath, prepared.changeId);
    expect(plannedTransaction.transaction.state).toBe('evidence-ready');
    expect(plannedTransaction.transaction.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'noncanonical-prediction' }),
        expect.objectContaining({ role: 'agent-framework-change-plan' }),
      ])
    );

    const applied = await applyPreparedAgentFrameworkAttachment({
      prepared,
      grantedBy: 'test-maintainer',
    });
    expect(applied).toMatchObject({
      operation: 'attach',
      status: 'applied',
      project: 'api',
      runtime: 'python',
    });
    expect(
      await fsExtra.readFile(
        path.join(projectPath, 'agents', 'release-reviewer', 'main.py'),
        'utf8'
      )
    ).toContain('Generated and managed by Workspai');
    expect(await fsExtra.pathExists(path.join(workspacePath, applied.ownershipReceipt))).toBe(true);
  });

  it('closes its generated Goal and Change when an idempotent plan is a no-op', async () => {
    const { workspacePath } = await fixture();
    const first = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: first, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const noOp = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      instanceName: 'primary',
    });
    expect(noOp.status).toBe('no-op');
    expect((await readDecisionTransaction(workspacePath, noOp.changeId)).transaction.state).toBe(
      'aborted'
    );
    expect(
      (await inspectGoalLifecycle({ workspacePath, goalId: noOp.goalId, validateBindings: false }))
        .active?.lifecycle
    ).toBe('cancelled');
  });

  it('rejects path-shaped instance input before creating Goal evidence', async () => {
    const { workspacePath } = await fixture();
    await expect(
      prepareAgentFrameworkAttachment({
        workspacePath,
        project: 'api',
        runtime: 'python',
        instanceName: '../escape',
      })
    ).rejects.toThrow(/not a path/i);
    expect(
      (await inspectGoalLifecycle({ workspacePath, validateBindings: false })).index.goals
    ).toEqual([]);
  });

  it('does not attribute a concurrent project mutation to another project-scoped Change', async () => {
    const { workspacePath } = await fixture({ secondProject: true });
    const first = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: first, grantedBy: 'maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const concurrent = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'worker',
      runtime: 'python',
      instanceName: 'secondary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: concurrent, grantedBy: 'maintainer' });

    const verified = await verifyProofCarryingChange({
      workspacePath,
      changeId: first.changeId,
      strict: false,
    });
    expect(
      verified.capsule.remainingUncertainty.some((entry) =>
        entry.includes('effect_receipt.coverage_missing')
      )
    ).toBe(false);
    const transaction = await readDecisionTransaction(workspacePath, first.changeId);
    expect(
      transaction.transaction.blockers.filter(
        (blocker) => blocker.code === 'change.effect_receipt.coverage_missing'
      )
    ).toEqual([]);
    const surpriseArtifact = verified.capsule.surpriseReport?.artifact;
    expect(surpriseArtifact).toBeTruthy();
    const surprise = await fsExtra.readJson(path.join(workspacePath, surpriseArtifact!));
    const actual = await fsExtra.readJson(
      path.join(workspacePath, verified.capsule.actualOverlay!.artifact)
    );
    expect(
      [...actual.entities.added, ...actual.entities.removed].every(
        (entity: { projectId?: string }) => entity.projectId === 'api'
      )
    ).toBe(true);
    expect(
      actual.changedArtifacts.every((artifact: string) => !artifact.startsWith('worker/'))
    ).toBe(true);
    expect(
      surprise.unpredicted.some(
        (operation: { targetKind: string; targetId: string }) =>
          operation.targetKind === 'artifact' && operation.targetId.startsWith('worker/')
      )
    ).toBe(false);
  });
});
