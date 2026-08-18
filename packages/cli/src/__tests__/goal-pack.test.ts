import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { planGoalPack } from '../goal-pack.js';
import {
  buildGoalLifecycleResult,
  inspectGoalLifecycle,
  prepareGoalVerification,
  transitionGoalLifecycle,
  verifyGoalLifecycle,
} from '../goal-lifecycle.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import {
  approveWorkspaceRepair,
  executeWorkspaceRepair,
  planWorkspaceRepairProposal,
} from '../workspace-repair-engine.js';
import { WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION } from '../contracts/workspace-repair-proposal-contract.js';
import { readVerifiedGoal } from '../verified-goal.js';

const roots: string[] = [];

async function fixture(): Promise<{ workspacePath: string; projectPath: string }> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-goal-pack-'));
  roots.push(workspacePath);
  const projectPath = path.join(workspacePath, 'api');
  await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
    name: 'platform',
    profile: 'polyglot',
  });
  await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-08-15T00:00:00.000Z',
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
    scripts: { 'test:coverage': 'vitest run --coverage' },
    dependencies: { '@nestjs/core': '^11.0.0' },
  });
  await fsExtra.outputFile(
    path.join(projectPath, 'src', 'health.controller.ts'),
    "export const health = () => 'ok';\n"
  );
  await fsExtra.outputFile(
    path.join(projectPath, 'src', 'retry-backoff.ts'),
    'export const retryBackoff = (attempt: number) => 2 ** attempt;\n'
  );
  await fsExtra.outputFile(
    path.join(projectPath, 'test', 'retry-backoff.test.ts'),
    "import { retryBackoff } from '../src/retry-backoff';\nvoid retryBackoff(1);\n"
  );
  const model = await buildWorkspaceModel({
    workspacePath,
    includeAbsolutePaths: true,
    now: new Date('2026-08-15T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, workspacePath);
  return { workspacePath, projectPath };
}

async function addFixtureProject(input: {
  workspacePath: string;
  name: string;
  runtime: 'node' | 'python';
}): Promise<string> {
  const projectPath = path.join(input.workspacePath, input.name);
  const contractPath = path.join(input.workspacePath, '.workspai', 'workspace.contract.json');
  const contract = await fsExtra.readJson(contractPath);
  contract.projects.push({
    slug: input.name,
    relativePath: input.name,
    runtime: input.runtime,
    framework: input.runtime === 'python' ? 'fastapi' : 'nestjs',
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
  });
  await fsExtra.writeJson(contractPath, contract, { spaces: 2 });
  await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
    name: input.name,
    runtime: input.runtime,
    framework: input.runtime === 'python' ? 'fastapi' : 'nestjs',
  });
  if (input.runtime === 'python') {
    await fsExtra.outputFile(
      path.join(projectPath, 'pyproject.toml'),
      '[project]\nname = "worker"\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'worker.py'),
      'def run():\n    return True\n'
    );
  } else {
    await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
      name: `@platform/${input.name}`,
      scripts: { test: 'vitest run' },
    });
  }
  const model = await buildWorkspaceModel({
    workspacePath: input.workspacePath,
    includeAbsolutePaths: true,
    now: new Date('2026-08-15T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, input.workspacePath);
  return projectPath;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('goal pack workspace adapter', () => {
  it('requires an explicit bounded scope at a multi-project workspace root', async () => {
    const { workspacePath } = await fixture();
    await addFixtureProject({ workspacePath, name: 'worker', runtime: 'python' });

    const result = await planGoalPack({
      startPath: workspacePath,
      intent: 'Map the system architecture',
    });

    expect(result.result).toBe('needs-confirmation');
    expect(result.goalPack.scope).toMatchObject({
      kind: 'workspace',
      projects: ['api', 'worker'],
      selectionSource: 'workspace',
      resolution: 'selection-required',
    });
    expect(result.goalPack.decision?.question).toContain('one project, multiple projects');
  });

  it('persists an interactive runtime-compatible project-set scope', async () => {
    const { workspacePath } = await fixture();
    await addFixtureProject({ workspacePath, name: 'worker', runtime: 'node' });

    const result = await planGoalPack({
      startPath: workspacePath,
      intent: 'Raise test coverage to 82%',
      selectScope: async () => ({ kind: 'projects', projects: ['api', 'worker'] }),
    });

    expect(result.result).toBe('planned');
    expect(result.goalPack.scope).toEqual({
      kind: 'project-set',
      projects: ['api', 'worker'],
      selectionSource: 'interactive',
      resolution: 'selected',
    });
    expect(result.goalPack.intent.requestedTarget?.runtime).toBe('node');
    expect(result.goalPack.preflight.measurement.runtimeChoices).toEqual(['node']);
    expect(result.agentHandoff.renewal.command).toContain('--scope "projects:api,worker"');
    expect(result.agentHandoff.renewal.command).toContain('--runtime node');
    const prepared = await prepareGoalVerification({
      workspacePath,
      goalId: result.goalPack.id,
    });
    const verified = await readVerifiedGoal(workspacePath, prepared.verifiedGoalId);
    expect(verified.goal.scope).toMatchObject({ kind: 'project-set' });
    expect(verified.goal.criteria).toMatchObject({ runtime: 'node' });
  });

  it('requires runtime-compatible scopes instead of silently dropping mixed-runtime projects', async () => {
    const { workspacePath } = await fixture();
    await addFixtureProject({ workspacePath, name: 'worker', runtime: 'python' });

    const result = await planGoalPack({
      startPath: workspacePath,
      intent: 'Raise test coverage to 82%',
      scope: 'projects:api,worker',
    });

    expect(result.result).toBe('needs-confirmation');
    expect(result.goalPack.preflight.measurement.runtimeChoices).toEqual([]);
    expect(result.goalPack.decision?.reason).toContain(
      'do not share a common canonical coverage runtime'
    );
    expect(result.goalPack.decision?.question).toContain('runtime-compatible Goal scopes');

    await expect(
      planGoalPack({
        startPath: workspacePath,
        intent: 'Raise test coverage to 82%',
        scope: 'projects:api,worker',
        runtime: 'python',
      })
    ).rejects.toThrow('not canonical for every project');
  });

  it('rejects an explicit runtime outside the canonical selected scope', async () => {
    const { projectPath } = await fixture();

    await expect(
      planGoalPack({
        startPath: projectPath,
        intent: 'Raise test coverage to 82%',
        runtime: 'python',
      })
    ).rejects.toThrow('not present in the canonical Workspace Model');
  });

  it('resolves project invocation, publishes an atomic portable pack, and preserves CLI ownership', async () => {
    const { workspacePath, projectPath } = await fixture();
    const result = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 82%',
      consumer: 'codex',
    });

    expect(result.resolution).toEqual({ source: 'parent', invocationScope: 'project' });
    expect(result.goalPack.scope).toEqual({
      kind: 'project',
      projects: ['api'],
      selectionSource: 'invocation-project',
      resolution: 'selected',
    });
    expect(result.goalPack.policy).toMatchObject({
      mutationMode: 'proposal-only',
      approval: 'required-before-mutation',
      verificationOwner: 'workspai-cli',
      rollbackOwner: 'workspai-cli',
    });
    expect(result.writtenArtifacts).toHaveLength(4);
    for (const relativePath of result.writtenArtifacts) {
      expect(await fsExtra.pathExists(path.join(workspacePath, relativePath))).toBe(true);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(workspacePath);
    expect(serialized).not.toContain(os.tmpdir());
    expect(result.goalPack.state).toBe('ready-to-plan');
    expect(result.goalPack.preflight.retrieval.queries[0]).toBe('Raise test coverage to 82%');
    expect(result.agentHandoff.discovery.index).toBe('.workspai/goals/index.json');

    const resumed = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 82%',
      consumer: 'codex',
    });
    expect(resumed.resumed).toBe(true);
    expect(resumed.goalPack.generatedAt).toBe(result.goalPack.generatedAt);
  });

  it('grounds general Goals in objective-relevant anchors before category fallback', async () => {
    const { projectPath } = await fixture();
    const result = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve retry backoff diagnostics',
      dryRun: true,
    });

    expect(result.goalPack.preflight.retrieval.queries[0]).toBe(
      'Improve retry backoff diagnostics'
    );
    expect(result.goalPack.preflight.retrieval.anchors[0]?.label).toContain('retry-backoff');
    expect(result.goalPack.preflight.retrieval.status).toBe('partial');
  });

  it('keeps Goal identity stable across an evidence-only Graph regeneration', async () => {
    const { workspacePath, projectPath } = await fixture();
    const first = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 82%',
      consumer: 'codex',
    });
    const graphPath = path.join(
      workspacePath,
      '.workspai',
      'reports',
      'workspace-knowledge-graph.json'
    );
    const graph = (await fsExtra.readJson(graphPath)) as { generatedAt: string };
    graph.generatedAt = '2026-08-15T01:00:00.000Z';
    await fsExtra.writeJson(graphPath, graph, { spaces: 2 });

    const resumed = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 82%',
      consumer: 'codex',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.goalPack.id).toBe(first.goalPack.id);
    expect(resumed.goalPack.sourceBinding.graph.hash).toBe(first.goalPack.sourceBinding.graph.hash);
  });

  it('supports side-effect-free preview and explicit workspace scope', async () => {
    const { workspacePath, projectPath } = await fixture();
    const result = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
      scope: 'workspace',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.writtenArtifacts).toEqual([]);
    expect(result.goalPack.scope).toMatchObject({ kind: 'workspace', selectionSource: 'explicit' });
    expect(
      await fsExtra.pathExists(path.join(workspacePath, result.goalPack.artifacts.goalPack))
    ).toBe(false);
  });

  it('publishes an agent-discoverable active index and preserves auditable cancellation', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    const inspected = await inspectGoalLifecycle({ workspacePath });
    expect(inspected.active?.id).toBe(planned.goalPack.id);
    expect(inspected.goalPack?.fingerprint).toBe(planned.goalPack.fingerprint);
    expect(
      buildGoalLifecycleResult({
        operation: 'status',
        activeGoalId: inspected.index.activeGoalId,
        goal: inspected.active,
        goals: inspected.index.goals,
        goalPack: inspected.goalPack,
        verifiedGoalId: null,
        verification: null,
      }).schemaVersion
    ).toBe('workspai.goal-lifecycle-result.v1');

    const cancelled = await transitionGoalLifecycle({
      workspacePath,
      goalId: planned.goalPack.id,
      action: 'cancel',
    });
    expect(cancelled.index.activeGoalId).toBeNull();
    expect(cancelled.goal.lifecycle).toBe('cancelled');
    expect(
      await fsExtra.pathExists(path.join(workspacePath, planned.goalPack.artifacts.goalPack))
    ).toBe(true);
  });

  it('keeps exactly one lifecycle entry active as newer goals become current', async () => {
    const { workspacePath, projectPath } = await fixture();
    const first = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    const second = await planGoalPack({
      startPath: projectPath,
      intent: 'Understand the API architecture',
    });

    const inspected = await inspectGoalLifecycle({ workspacePath });
    expect(inspected.index.activeGoalId).toBe(second.goalPack.id);
    expect(inspected.index.goals.filter((goal) => goal.lifecycle === 'active')).toHaveLength(1);
    expect(inspected.index.goals.find((goal) => goal.id === first.goalPack.id)?.lifecycle).toBe(
      'planned'
    );
  });

  it('does not replace an active Goal with a plan that still needs confirmation', async () => {
    const { workspacePath, projectPath } = await fixture();
    const active = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    const incomplete = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });

    expect(incomplete.result).toBe('needs-confirmation');
    const inspected = await inspectGoalLifecycle({ workspacePath });
    expect(inspected.index.activeGoalId).toBe(active.goalPack.id);
    expect(
      inspected.index.goals.find((goal) => goal.id === incomplete.goalPack.id)?.lifecycle
    ).toBe('planned');
  });

  it('reconciles a legacy active non-actionable Goal without corrupting the Goal index', async () => {
    const { workspacePath, projectPath } = await fixture();
    const pending = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });
    const indexPath = path.join(workspacePath, '.workspai', 'goals', 'index.json');
    const legacyIndex = await fsExtra.readJson(indexPath);
    legacyIndex.activeGoalId = pending.goalPack.id;
    legacyIndex.goals[0].lifecycle = 'planned';
    await fsExtra.writeJson(indexPath, legacyIndex, { spaces: 2 });

    const replanned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });
    const inspected = await inspectGoalLifecycle({ workspacePath, validateBindings: false });

    expect(replanned.result).toBe('needs-confirmation');
    expect(inspected.index.activeGoalId).toBeNull();
    expect(inspected.index.goals[0]?.lifecycle).toBe('planned');
  });

  it('demotes a legacy non-actionable active lifecycle entry during planning', async () => {
    const { workspacePath, projectPath } = await fixture();
    const pending = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });
    const indexPath = path.join(workspacePath, '.workspai', 'goals', 'index.json');
    const legacyIndex = await fsExtra.readJson(indexPath);
    legacyIndex.activeGoalId = pending.goalPack.id;
    legacyIndex.goals[0].lifecycle = 'active';
    await fsExtra.writeJson(indexPath, legacyIndex, { spaces: 2 });

    const replanned = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });
    const inspected = await inspectGoalLifecycle({ workspacePath, validateBindings: false });

    expect(replanned.result).toBe('needs-confirmation');
    expect(inspected.index.activeGoalId).toBeNull();
    expect(inspected.index.goals[0]?.lifecycle).toBe('planned');
  });

  it('refuses to activate a Goal until clarification and evidence are complete', async () => {
    const { workspacePath, projectPath } = await fixture();
    const pending = await planGoalPack({
      startPath: projectPath,
      intent: 'Improve test coverage',
    });

    await expect(
      transitionGoalLifecycle({
        workspacePath,
        goalId: pending.goalPack.id,
        action: 'activate',
      })
    ).rejects.toThrow('cannot be activated while its planning state is needs-confirmation');
  });

  it('bridges an active deterministic goal through preparation and blocked verification', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Prepare this project for release',
    });

    const prepared = await prepareGoalVerification({
      workspacePath,
      goalId: planned.goalPack.id,
    });
    expect(prepared.goal.lifecycle).toBe('verification-ready');
    expect(prepared.verifiedGoalId).toBeTruthy();
    expect((await inspectGoalLifecycle({ workspacePath })).index.activeGoalId).toBe(
      planned.goalPack.id
    );

    const verification = await verifyGoalLifecycle({
      workspacePath,
      goalId: planned.goalPack.id,
      run: false,
    });
    expect(verification.goal.lifecycle).toBe('verification-ready');
    expect((await inspectGoalLifecycle({ workspacePath })).index.activeGoalId).toBe(
      planned.goalPack.id
    );
  });

  it('enforces the immutable Goal Pack verification-attempt budget', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Prepare this project for release',
      maxAttempts: 1,
    });
    await prepareGoalVerification({ workspacePath, goalId: planned.goalPack.id });
    await verifyGoalLifecycle({ workspacePath, goalId: planned.goalPack.id, run: false });

    await expect(
      verifyGoalLifecycle({ workspacePath, goalId: planned.goalPack.id, run: false })
    ).rejects.toThrow('exhausted its verification budget (1)');
  });

  it('serializes concurrent verification so consumers cannot race the attempt budget', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Prepare this project for release',
      maxAttempts: 1,
    });
    await prepareGoalVerification({ workspacePath, goalId: planned.goalPack.id });

    const results = await Promise.allSettled([
      verifyGoalLifecycle({ workspacePath, goalId: planned.goalPack.id, run: false }),
      verifyGoalLifecycle({ workspacePath, goalId: planned.goalPack.id, run: false }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected' });
    expect(String((rejected as PromiseRejectedResult).reason)).toContain(
      'exhausted its verification budget (1)'
    );
  });

  it('requires explicit activation before preparing an older deterministic goal', async () => {
    const { workspacePath, projectPath } = await fixture();
    const older = await planGoalPack({
      startPath: projectPath,
      intent: 'Prepare this project for release',
    });
    await planGoalPack({ startPath: projectPath, intent: 'Map the system architecture' });

    await expect(
      prepareGoalVerification({ workspacePath, goalId: older.goalPack.id })
    ).rejects.toThrow('is not active');
  });

  it('binds Repair Engine proposals to the active goal and rejects scope widening', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    const sourcePath = path.join(projectPath, 'src', 'health.controller.ts');
    const before = await fsExtra.readFile(sourcePath, 'utf8');
    const proposal = {
      schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
      goalId: planned.goalPack.id,
      cardId: 'goal-source-proposal',
      rationale: 'Apply one bounded source edit for the active goal.',
      changes: [
        {
          id: 'health-source',
          path: 'api/src/health.controller.ts',
          operation: 'write' as const,
          expectedBeforeHash: createHash('sha256').update(before).digest('hex'),
          content: `${before}// proposed\n`,
          risk: 'safe' as const,
          summary: 'Keep the proposal inside the selected project.',
        },
      ],
    };
    await expect(planWorkspaceRepairProposal({ workspacePath, proposal })).rejects.toThrow(
      'exact permitted projectName'
    );

    const transaction = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: { ...proposal, projectName: 'api', projectPath: 'api' },
    });
    const inspected = await inspectGoalLifecycle({ workspacePath });
    expect(inspected.active?.repairTransactionId).toBe(transaction.transactionId);
  });

  it('limits every project-set repair proposal to a selected project member', async () => {
    const { workspacePath, projectPath } = await fixture();
    await addFixtureProject({ workspacePath, name: 'worker', runtime: 'python' });
    const planned = await planGoalPack({
      startPath: workspacePath,
      scope: 'projects:api,worker',
      intent: 'Map the system architecture',
    });
    const sourcePath = path.join(projectPath, 'src', 'health.controller.ts');
    const before = await fsExtra.readFile(sourcePath, 'utf8');

    await expect(
      planWorkspaceRepairProposal({
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          goalId: planned.goalPack.id,
          cardId: 'goal-project-set-widening',
          projectName: 'outside',
          projectPath: 'outside',
          rationale: 'Attempt to widen the selected project set.',
          changes: [
            {
              id: 'outside-source',
              path: 'api/src/health.controller.ts',
              operation: 'write',
              expectedBeforeHash: createHash('sha256').update(before).digest('hex'),
              content: `${before}// proposed\n`,
              risk: 'safe',
              summary: 'This proposal must be rejected before mutation.',
            },
          ],
        },
      })
    ).rejects.toThrow('inside the permitted Goal scope (api, worker)');
  });

  it('serializes Goal repair proposals so concurrent consumers cannot exceed the budget', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 80%',
      maxAttempts: 1,
    });
    const sourcePath = path.join(projectPath, 'src', 'health.controller.ts');
    const before = await fsExtra.readFile(sourcePath, 'utf8');
    const proposal = (suffix: string) => ({
      schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
      goalId: planned.goalPack.id,
      cardId: `goal-source-${suffix}`,
      projectName: 'api',
      projectPath: 'api',
      rationale: 'Reserve one bounded Goal repair attempt.',
      changes: [
        {
          id: `health-source-${suffix}`,
          path: 'api/src/health.controller.ts',
          operation: 'write' as const,
          expectedBeforeHash: createHash('sha256').update(before).digest('hex'),
          content: `${before}// ${suffix}\n`,
          risk: 'safe' as const,
          summary: 'Keep the proposal inside the selected project.',
        },
      ],
    });

    const results = await Promise.allSettled([
      planWorkspaceRepairProposal({ workspacePath, proposal: proposal('first') }),
      planWorkspaceRepairProposal({ workspacePath, proposal: proposal('second') }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      String(
        (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason
      )
    ).toContain('exhausted its repair proposal budget (1)');
  });

  it('accepts only a closed Goal repair as the sanctioned post-mutation source binding', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Prepare this project for release',
    });
    await prepareGoalVerification({ workspacePath, goalId: planned.goalPack.id });
    const sourcePath = path.join(projectPath, 'src', 'health.controller.ts');
    const before = await fsExtra.readFile(sourcePath, 'utf8');
    const transaction = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        goalId: planned.goalPack.id,
        cardId: 'goal-release-source-proposal',
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Apply one bounded source edit and retain the Goal evidence chain.',
        changes: [
          {
            id: 'health-source',
            path: 'api/src/health.controller.ts',
            operation: 'write',
            expectedBeforeHash: createHash('sha256').update(before).digest('hex'),
            content: `${before}// governed repair\n`,
            risk: 'safe',
            summary: 'Apply the inspected source change.',
          },
        ],
      },
    });
    await approveWorkspaceRepair({ workspacePath, transactionId: transaction.transactionId });
    const closed = await executeWorkspaceRepair(
      { workspacePath, transactionId: transaction.transactionId },
      {
        verify: async () => {
          const refreshed = await buildWorkspaceModel({
            workspacePath,
            includeAbsolutePaths: true,
            now: new Date('2026-08-15T00:05:00.000Z'),
          });
          await writeWorkspaceModel(refreshed, workspacePath);
          return {
            status: 'passed',
            exitCode: 0,
            artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
          };
        },
      }
    );

    expect(closed.state).toBe('closed');
    expect(closed.integrity.closureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(closed.verification?.sourceBinding?.graphInputHash).toMatch(/^[a-f0-9]{64}$/);
    const inspected = await inspectGoalLifecycle({ workspacePath });
    expect(inspected.active?.repairTransactionIds).toEqual([transaction.transactionId]);
    const evidenceRerun = await buildWorkspaceModel({
      workspacePath,
      includeAbsolutePaths: true,
      now: new Date('2026-08-15T00:10:00.000Z'),
    });
    await writeWorkspaceModel(evidenceRerun, workspacePath);
    await expect(inspectGoalLifecycle({ workspacePath })).resolves.toMatchObject({
      active: { id: planned.goalPack.id },
    });
    const unrelatedPath = path.join(projectPath, 'src', 'unrelated.ts');
    await fsExtra.outputFile(unrelatedPath, 'export const unrelated = true;\n');
    await expect(inspectGoalLifecycle({ workspacePath })).rejects.toThrow('stale');
    await fsExtra.remove(unrelatedPath);
    await expect(
      verifyGoalLifecycle({ workspacePath, goalId: planned.goalPack.id, run: false })
    ).resolves.toMatchObject({ goal: { id: planned.goalPack.id } });
  });

  it('fails closed when graph evidence no longer matches the canonical model', async () => {
    const { workspacePath, projectPath } = await fixture();
    const graphPath = path.join(
      workspacePath,
      '.workspai',
      'reports',
      'workspace-knowledge-graph.json'
    );
    const graph = await fsExtra.readJson(graphPath);
    graph.source.hash = '0'.repeat(64);
    await fsExtra.writeJson(graphPath, graph, { spaces: 2 });

    await expect(
      planGoalPack({ startPath: projectPath, intent: 'Fix the failing authentication bug' })
    ).rejects.toThrow('source-mismatch');
  });

  it('rejects planning after live source changes invalidate the graph fingerprint', async () => {
    const { projectPath } = await fixture();
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'health.controller.ts'),
      "export const health = () => 'changed';\n"
    );

    await expect(
      planGoalPack({ startPath: projectPath, intent: 'Fix the failing authentication bug' })
    ).rejects.toThrow('live-input-mismatch');
  });

  it('fails closed when an immutable Goal Pack is edited after publication', async () => {
    const { workspacePath, projectPath } = await fixture();
    const first = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 81%',
    });
    const goalPath = path.join(workspacePath, first.goalPack.artifacts.goalPack);
    const tampered = await fsExtra.readJson(goalPath);
    tampered.policy.maxAttempts = 20;
    await fsExtra.writeJson(goalPath, tampered, { spaces: 2 });

    await expect(
      planGoalPack({ startPath: projectPath, intent: 'Raise test coverage to 81%' })
    ).rejects.toThrow('immutable integrity validation');
  });

  it('fails closed when an indexed agent handoff no longer matches its Goal Pack', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    const handoffPath = path.join(workspacePath, planned.goalPack.artifacts.agentHandoff);
    const handoff = await fsExtra.readJson(handoffPath);
    handoff.objective = 'tampered objective';
    await fsExtra.writeJson(handoffPath, handoff, { spaces: 2 });

    await expect(inspectGoalLifecycle({ workspacePath })).rejects.toThrow(
      'handoff integrity validation'
    );
  });

  it('fails closed instead of repairing a tampered Goal index during replanning', async () => {
    const { workspacePath, projectPath } = await fixture();
    await planGoalPack({ startPath: projectPath, intent: 'Map the system architecture' });
    const indexPath = path.join(workspacePath, '.workspai', 'goals', 'index.json');
    const index = await fsExtra.readJson(indexPath);
    index.goals[0].fingerprint = 'not-a-valid-digest';
    await fsExtra.writeJson(indexPath, index, { spaces: 2 });

    await expect(
      planGoalPack({ startPath: projectPath, intent: 'Map the system architecture' })
    ).rejects.toThrow('Goal index violates');
  });

  it('rejects malformed Goal index JSON instead of treating it as an empty registry', async () => {
    const { workspacePath, projectPath } = await fixture();
    await fsExtra.outputFile(
      path.join(workspacePath, '.workspai', 'goals', 'index.json'),
      '{ malformed'
    );

    await expect(
      planGoalPack({ startPath: projectPath, intent: 'Map the system architecture' })
    ).rejects.toThrow();
  });

  it('allows stale goals to be listed and cancelled but not activated', async () => {
    const { workspacePath, projectPath } = await fixture();
    const planned = await planGoalPack({
      startPath: projectPath,
      intent: 'Map the system architecture',
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'health.controller.ts'),
      "export const health = () => 'stale';\n"
    );

    await expect(inspectGoalLifecycle({ workspacePath })).rejects.toThrow('stale');
    const listed = await inspectGoalLifecycle({ workspacePath, validateBindings: false });
    expect(listed.active?.id).toBe(planned.goalPack.id);
    await expect(
      transitionGoalLifecycle({
        workspacePath,
        goalId: planned.goalPack.id,
        action: 'activate',
      })
    ).rejects.toThrow('stale');
    const cancelled = await transitionGoalLifecycle({
      workspacePath,
      goalId: planned.goalPack.id,
      action: 'cancel',
    });
    expect(cancelled.index.activeGoalId).toBeNull();
  });

  it('serializes concurrent publication and reuses one immutable instance', async () => {
    const { projectPath } = await fixture();
    const [first, second] = await Promise.all([
      planGoalPack({ startPath: projectPath, intent: 'Raise test coverage to 83%' }),
      planGoalPack({ startPath: projectPath, intent: 'Raise test coverage to 83%' }),
    ]);

    expect([first.resumed, second.resumed].sort()).toEqual([false, true]);
    expect(first.goalPack.id).toBe(second.goalPack.id);
    expect(first.goalPack.generatedAt).toBe(second.goalPack.generatedAt);
    expect(first.agentHandoff.generatedAt).toBe(second.agentHandoff.generatedAt);
  });

  it('rolls back every Goal Pack artifact when atomic publication fails', async () => {
    const { workspacePath, projectPath } = await fixture();
    const preview = await planGoalPack({
      startPath: projectPath,
      intent: 'Raise test coverage to 84%',
      dryRun: true,
    });
    process.env.WORKSPAI_TEST_FAIL_ARTIFACT_SET_AFTER = '1';
    try {
      await expect(
        planGoalPack({ startPath: projectPath, intent: 'Raise test coverage to 84%' })
      ).rejects.toThrow();
    } finally {
      delete process.env.WORKSPAI_TEST_FAIL_ARTIFACT_SET_AFTER;
    }

    expect(
      await fsExtra.pathExists(path.join(workspacePath, preview.goalPack.artifacts.goalPack))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(path.join(workspacePath, preview.goalPack.artifacts.agentHandoff))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(
        path.join(workspacePath, '.workspai', 'reports', 'goal-pack-last-run.json')
      )
    ).toBe(false);
  });
});
