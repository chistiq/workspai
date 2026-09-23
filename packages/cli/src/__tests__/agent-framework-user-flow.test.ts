import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyPreparedAgentFrameworkAttachment,
  prepareAgentFrameworkAttachment,
} from '../agent-frameworks/user-flow.js';
import { listBundledAgentFrameworkReleaseAdmissions } from '../agent-frameworks/release-admission.js';
import { readDecisionTransaction } from '../decisions/decision-store.js';
import { inspectGoalLifecycle } from '../goal-lifecycle.js';
import { verifyProofCarryingChange } from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import { runWorkspaceIntelligenceChain } from '../workspace-intelligence-runner.js';

const roots: string[] = [];
const releaseAdmitted = listBundledAgentFrameworkReleaseAdmissions().length === 4;

async function fixture(
  options: { secondProject?: boolean; extraProjects?: string[] } = {}
): Promise<{
  workspacePath: string;
  projectPath: string;
}> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-user-flow-'));
  roots.push(workspacePath);
  const projectPath = path.join(workspacePath, 'api');
  const extraProjects = [
    ...(options.secondProject ? ['worker'] : []),
    ...(options.extraProjects ?? []),
  ];
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
      ...extraProjects.map((slug) => ({
        slug,
        relativePath: slug,
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
      })),
    ],
  });
  await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
    name: '@platform/api',
    version: '1.0.0',
  });
  for (const slug of extraProjects) {
    await fsExtra.outputJson(path.join(workspacePath, slug, 'package.json'), {
      name: `@platform/${slug}`,
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

describe.skipIf(releaseAdmitted)('agent framework user flow fail-closed', () => {
  it('refuses prepare when v2 release admission is empty', async () => {
    const { workspacePath } = await fixture();
    await expect(
      prepareAgentFrameworkAttachment({
        workspacePath,
        project: 'api',
        runtime: 'python',
        framework: 'openai-agents',
        instanceName: 'primary',
      })
    ).rejects.toThrow(/not release-admitted/i);
  });
});

describe('Google ADK user flow fail-closed', () => {
  it('refuses prepare while Google adapters remain outside the reviewed admission inventory', async () => {
    const { workspacePath } = await fixture();
    await expect(
      prepareAgentFrameworkAttachment({
        workspacePath,
        project: 'api',
        runtime: 'python',
        framework: 'google-adk',
        instanceName: 'primary',
      })
    ).rejects.toThrow(/not release-admitted/i);
  });
});

describe.skipIf(!releaseAdmitted)('agent framework user flow', () => {
  it('turns one attach request into a Goal, hash-bound plan, authorization, and owned files', async () => {
    const { workspacePath, projectPath } = await fixture();
    const prepared = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
      instanceName: 'Release Reviewer',
    });

    expect(prepared).toMatchObject({
      schemaVersion: 'workspai.agent-framework-attachment.v1',
      operation: 'plan',
      status: 'planned',
      project: 'api',
      runtime: 'python',
      frameworkId: 'microsoft-agent-framework',
      adapterId: 'microsoft-agent-framework-python',
      instanceName: 'release-reviewer',
    });
    expect(prepared.files).toHaveLength(9);
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

    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });
    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: prepared.goalId, validateBindings: true })
    ).resolves.toMatchObject({
      active: expect.objectContaining({ id: prepared.goalId }),
    });
  });

  it('does not sanction an unrelated architecture mutation with an older apply receipt', async () => {
    const { workspacePath, projectPath } = await fixture();
    const prepared = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });
    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: prepared.goalId, validateBindings: true })
    ).resolves.toBeDefined();

    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'unreceipted.ts'),
      'export const unreceipted = true;\n'
    );
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: prepared.goalId, validateBindings: true })
    ).rejects.toThrow('changed outside a closed Goal repair transaction');
  });

  it('closes its generated Goal and Change when an idempotent plan is a no-op', async () => {
    const { workspacePath } = await fixture();
    const first = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: first, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const noOp = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
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
        framework: 'microsoft-agent-framework',
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
      framework: 'microsoft-agent-framework',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: first, grantedBy: 'maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const concurrent = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'worker',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
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

  it('keeps the first kit Goal current after a later kit is attached in the same workspace', async () => {
    const { workspacePath } = await fixture({ secondProject: true });
    const first = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: first, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const second = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'worker',
      runtime: 'python',
      framework: 'openai-agents',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared: second, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: first.goalId, validateBindings: true })
    ).resolves.toMatchObject({
      active: expect.objectContaining({ id: first.goalId }),
    });
    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: second.goalId, validateBindings: true })
    ).resolves.toMatchObject({
      active: expect.objectContaining({ id: second.goalId }),
    });
  });

  it('fails closed when Python attach does not name one of the published frameworks', async () => {
    const { workspacePath } = await fixture();
    await expect(
      prepareAgentFrameworkAttachment({
        workspacePath,
        project: 'api',
        runtime: 'python',
        instanceName: 'primary',
      })
    ).rejects.toThrow(/Pass --framework explicitly/);
  });

  it('plans an OpenAI attach after reviewed release admission', async () => {
    const { workspacePath, projectPath } = await fixture();
    const prepared = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'openai-agents',
      instanceName: 'primary',
    });
    expect(prepared).toMatchObject({
      operation: 'plan',
      status: 'planned',
      adapterId: 'openai-agents-python',
      frameworkId: 'openai-agents',
      instanceName: 'primary',
    });
    expect(await fsExtra.pathExists(path.join(projectPath, 'agents', 'primary'))).toBe(false);
  });

  it('keeps Create verification pending until init/test/build evidence exists', async () => {
    const { workspacePath } = await fixture();
    const prepared = await prepareAgentFrameworkAttachment({
      workspacePath,
      project: 'api',
      runtime: 'python',
      framework: 'microsoft-agent-framework',
      instanceName: 'primary',
    });
    await applyPreparedAgentFrameworkAttachment({ prepared, grantedBy: 'test-maintainer' });
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });

    const verified = await verifyProofCarryingChange({
      workspacePath,
      changeId: prepared.changeId,
      strict: false,
    });
    expect(verified.state).toBe('executing');
    expect(verified.capsule.status).toBe('open');
    expect(
      verified.capsule.assurances.find((assurance) => assurance.id === 'independently-verified')
        ?.status
    ).toBe('pending');
    const surpriseArtifact = verified.capsule.surpriseReport?.artifact;
    expect(surpriseArtifact).toBeTruthy();
    const surprise = await fsExtra.readJson(path.join(workspacePath, surpriseArtifact!));
    expect(surprise.summary.unpredicted, JSON.stringify(surprise.unpredicted, null, 2)).toBe(0);
    await expect(
      inspectGoalLifecycle({ workspacePath, goalId: prepared.goalId, validateBindings: true })
    ).resolves.toMatchObject({
      active: expect.objectContaining({ id: prepared.goalId }),
    });
  });

  it('creates all four kits sequentially without invalidating earlier Goals', async () => {
    const { workspacePath } = await fixture({
      extraProjects: ['worker', 'web', 'backend'],
    });
    const kits = [
      { project: 'api', runtime: 'python' as const, framework: 'microsoft-agent-framework' },
      { project: 'worker', runtime: 'python' as const, framework: 'openai-agents' },
      { project: 'web', runtime: 'node' as const, framework: 'openai-agents' },
      { project: 'backend', runtime: 'dotnet' as const, framework: 'microsoft-agent-framework' },
    ];
    const attached = [];
    for (const kit of kits) {
      const prepared = await prepareAgentFrameworkAttachment({
        workspacePath,
        project: kit.project,
        runtime: kit.runtime,
        framework: kit.framework,
        instanceName: 'primary',
      });
      await applyPreparedAgentFrameworkAttachment({ prepared, grantedBy: 'test-maintainer' });
      await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });
      attached.push(prepared);
    }

    for (const prepared of attached) {
      await expect(
        inspectGoalLifecycle({ workspacePath, goalId: prepared.goalId, validateBindings: true })
      ).resolves.toMatchObject({
        active: expect.objectContaining({ id: prepared.goalId }),
      });
    }

    const firstVerified = await verifyProofCarryingChange({
      workspacePath,
      changeId: attached[0]!.changeId,
      strict: false,
    });
    expect(
      firstVerified.capsule.assurances.find(
        (assurance) => assurance.id === 'independently-verified'
      )?.status
    ).toBe('pending');
    expect(firstVerified.capsule.status).toBe('open');
    const surpriseArtifact = firstVerified.capsule.surpriseReport?.artifact;
    expect(surpriseArtifact).toBeTruthy();
    const surprise = await fsExtra.readJson(path.join(workspacePath, surpriseArtifact!));
    expect(
      surprise.unpredicted.some(
        (operation: { targetKind: string; targetId: string }) =>
          operation.targetKind === 'artifact' &&
          (operation.targetId.startsWith('worker/') ||
            operation.targetId.startsWith('web/') ||
            operation.targetId.startsWith('backend/'))
      )
    ).toBe(false);
  }, 120_000);
});
