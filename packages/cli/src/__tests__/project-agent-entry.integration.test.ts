import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';
import { buildAgentBootstrapReceipt } from '../project-agent-entry.js';
import { syncProjectIntelligenceLens } from '../project-intelligence-lens.js';
import { writeProjectWorkspaceLink } from '../project-workspace-link.js';
import { planGoalPack } from '../goal-pack.js';
import { transitionGoalLifecycle } from '../goal-lifecycle.js';
import {
  buildWorkspaceAgentReportsIndex,
  AGENT_REPORTS_INDEX_PATH,
} from '../workspace-agent-sync.js';
import { buildWorkspaceAgentContext, writeWorkspaceAgentContext } from '../workspace-context.js';
import {
  buildWorkspaceModel,
  writeWorkspaceModel,
  type WorkspaceModel,
} from '../workspace-model.js';

describe('canonical-first project agent entry', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
  });

  it('issues a ready, portable receipt from generated Model and Graph evidence', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-entry-'));
    roots.push(root);
    const workspacePath = path.join(root, 'workspace');
    const projectPath = path.join(root, 'projects', 'api');
    await fsExtra.outputFile(path.join(workspacePath, '.workspai-workspace'), 'workspace\n');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'agent-entry-lab',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
      name: 'api',
      version: '1.0.0',
      scripts: { build: 'tsc', test: 'vitest run' },
      dependencies: { express: '^5.0.0' },
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'index.ts'),
      'export const health = "ok";\n'
    );
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'api',
      runtime: 'node',
      framework: 'express',
      adoption: { managed_by: 'workspai', mode: 'linked' },
    });
    await fsExtra.outputJson(
      path.join(workspacePath, WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract),
      {
        schemaVersion: 1,
        kind: 'rapidkit.workspace.contract',
        generatedAt: '2026-08-16T00:00:00.000Z',
        workspace: { name: 'agent-entry-lab', profile: 'polyglot' },
        projects: [
          {
            slug: 'api',
            relativePath: 'external/api',
            externalPath: projectPath,
            relationship: 'adopted',
            runtime: 'node',
            framework: 'express',
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
      }
    );
    await writeProjectWorkspaceLink({
      workspacePath,
      projectPath,
      projectName: 'api',
      relationship: 'adopted',
      workspaceName: 'agent-entry-lab',
      relativePath: 'external/api',
      now: new Date('2026-08-16T00:00:00.000Z'),
    });

    // Adoption creates host entry surfaces before the canonical graph captures
    // the live source fingerprint.
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'api',
      relationship: 'adopted',
      mode: 'managed',
      now: new Date('2026-08-16T00:00:00.000Z'),
    });

    const model = await buildWorkspaceModel({
      workspacePath,
      includeEvidence: true,
      now: new Date('2026-08-16T00:01:00.000Z'),
    });
    expect(model.projects.map((project) => project.name)).toContain('api');
    await writeWorkspaceModel(model, workspacePath);
    const persistedModel = (await fsExtra.readJson(
      path.join(workspacePath, WORKSPACE_INTELLIGENCE_ARTIFACTS.model)
    )) as WorkspaceModel;
    const workspaceContext = await buildWorkspaceAgentContext({
      workspacePath,
      model: persistedModel,
      agent: 'codex',
      now: new Date('2026-08-16T00:02:00.000Z'),
    });
    await writeWorkspaceAgentContext(workspaceContext, workspacePath);
    const index = await buildWorkspaceAgentReportsIndex({
      workspacePath,
      now: new Date('2026-08-16T00:02:00.000Z'),
    });
    await fsExtra.outputJson(path.join(workspacePath, AGENT_REPORTS_INDEX_PATH), index);
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'api',
      relationship: 'adopted',
      mode: 'managed',
      now: new Date('2026-08-16T00:03:00.000Z'),
    });

    const receipt = await buildAgentBootstrapReceipt({
      startPath: projectPath,
      forAgent: 'codex',
      now: new Date('2026-08-16T00:04:00.000Z'),
    });

    expect(receipt.checks.filter((check) => check.status !== 'passed')).toEqual([]);
    expect(receipt).toMatchObject({
      status: 'ready',
      resolvedHost: 'codex',
      project: { name: 'api', relativePath: 'external/api' },
      workspace: {
        name: 'agent-entry-lab',
        resolved: true,
        identityIsFilesystemPath: false,
        resolverCommand: 'workspai project workspace status --json',
        portableUriScheme: 'workspace:',
        resolvedPathPolicy: 'runtime-private-never-persist',
      },
      activeGoal: { present: false, appliesToProject: false, status: 'none' },
      canonicalEvidence: {
        projectContext: '.workspai/reports/project-context-agent.json',
        workspaceIndex: 'workspace:.workspai/reports/INDEX.json',
        workspaceContext: 'workspace:.workspai/reports/workspace-context-agent.json',
        workspaceModel: 'workspace:.workspai/reports/workspace-model.json',
        knowledgeGraph: 'workspace:.workspai/reports/workspace-knowledge-graph.json',
        graphMatchesModel: true,
        liveInputsValidated: true,
      },
      claims: { architecture: 'allowed-with-citations' },
      integrity: { portable: true, absolutePathsEmitted: false },
    });
    expect(receipt.requiredReadOrder.slice(0, 4)).toEqual([
      '.workspai/agent-entry.v1.json',
      'command:workspai agent bootstrap --for-agent codex --strict --json',
      'command:workspai project workspace status --json',
      '.workspai/reports/project-context-agent.json',
    ]);
    expect(JSON.stringify(receipt)).not.toContain(root);

    const plannedGoal = await planGoalPack({
      startPath: projectPath,
      intent: 'Document the health endpoint contract',
      scope: 'project:api',
      consumer: 'generic',
    });
    expect(plannedGoal.goalPack.scope.projects).toEqual(['api']);
    await transitionGoalLifecycle({
      workspacePath,
      goalId: plannedGoal.goalPack.id,
      action: 'activate',
    });

    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'index.ts'),
      'export const health = "changed";\n'
    );
    const refreshedModel = await buildWorkspaceModel({
      workspacePath,
      includeEvidence: true,
      now: new Date('2026-08-16T00:05:00.000Z'),
    });
    await writeWorkspaceModel(refreshedModel, workspacePath);
    const refreshedContext = await buildWorkspaceAgentContext({
      workspacePath,
      model: refreshedModel,
      agent: 'generic',
      now: new Date('2026-08-16T00:05:30.000Z'),
    });
    await writeWorkspaceAgentContext(refreshedContext, workspacePath);
    const refreshedIndex = await buildWorkspaceAgentReportsIndex({
      workspacePath,
      now: new Date('2026-08-16T00:05:30.000Z'),
    });
    await fsExtra.outputJson(path.join(workspacePath, AGENT_REPORTS_INDEX_PATH), refreshedIndex);
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath,
      projectName: 'api',
      relationship: 'adopted',
      mode: 'managed',
      now: new Date('2026-08-16T00:06:00.000Z'),
    });

    const staleGoalReceipt = await buildAgentBootstrapReceipt({
      startPath: projectPath,
      forAgent: 'codex',
      now: new Date('2026-08-16T00:07:00.000Z'),
    });
    expect(staleGoalReceipt).toMatchObject({
      status: 'blocked',
      activeGoal: {
        present: true,
        appliesToProject: true,
        status: 'stale',
        id: plannedGoal.goalPack.id,
        goalPack: `workspace:.workspai/goals/${plannedGoal.goalPack.id}/goal-pack.json`,
        agentHandoff: `workspace:.workspai/goals/${plannedGoal.goalPack.id}/agent-handoff.json`,
      },
      canonicalEvidence: { liveInputsValidated: true },
    });
    expect(staleGoalReceipt.checks).toContainEqual(
      expect.objectContaining({ id: 'active-goal', status: 'failed' })
    );
    expect(staleGoalReceipt.nextActions[0]).toBe(
      'workspai goal "Document the health endpoint contract" --scope project:api --for-agent generic --refresh --json'
    );
    expect(JSON.stringify(staleGoalReceipt)).not.toContain(root);

    await fsExtra.outputFile(
      path.join(projectPath, 'src', 'index.ts'),
      'export const health = "changed-again";\n'
    );
    const staleReceipt = await buildAgentBootstrapReceipt({
      startPath: projectPath,
      forAgent: 'codex',
      now: new Date('2026-08-16T00:08:00.000Z'),
    });
    expect(staleReceipt).toMatchObject({
      status: 'blocked',
      canonicalEvidence: { liveInputsValidated: false },
      claims: { architecture: 'prohibited' },
    });
    expect(staleReceipt.checks).toContainEqual(
      expect.objectContaining({ id: 'live-inputs', status: 'failed' })
    );
  });
});
