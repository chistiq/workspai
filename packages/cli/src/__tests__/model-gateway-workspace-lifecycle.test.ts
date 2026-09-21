import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as create from '../create.js';
import * as index from '../index.js';
import {
  buildWorkspaceModelSnapshot,
  writeWorkspaceModelSnapshot,
} from '../workspace-intelligence.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import { runWorkspaceStage } from '../workspace-run.js';
import { buildWorkspaceVerify } from '../workspace-verify.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

function looksLikeRegistryFailure(text: string): boolean {
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|401 Unauthorized|403 Forbidden|404 Not Found|EAI_AGAIN|npm ERR!|Could not find a version|Failed to establish|No matching distribution|HTTPError|read ECONNRESET/i.test(
    text
  );
}

describe('OpenRouter gateway Workspai lifecycle', () => {
  it('creates both kits through the production CLI and exercises workspace run/verify', async () => {
    const parent = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai or gateway '));
    roots.push(parent);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await create.createProject('gateway-lifecycle', {
      parentDirectory: parent,
      profile: 'minimal',
      skipPythonEngine: true,
      skipGit: true,
      yes: true,
    });
    const workspacePath = path.join(parent, 'gateway-lifecycle');
    const emptyModel = await buildWorkspaceModel({ workspacePath });
    await writeWorkspaceModel(emptyModel, workspacePath);
    await writeWorkspaceModelSnapshot(
      await buildWorkspaceModelSnapshot({
        workspacePath,
        model: emptyModel,
      }),
      workspacePath
    );

    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    try {
      expect(
        await index.handleCreateOrFallback([
          'create',
          'project',
          'gateway.openrouter.typescript',
          'first-gateway',
          '--skip-git',
          '--yes',
        ])
      ).toBe(0);
      expect(
        await fsExtra.pathExists(path.join(workspacePath, 'first-gateway', 'node_modules'))
      ).toBe(false);

      const firstProject = {
        packageJson: await fsExtra.readFile(
          path.join(workspacePath, 'first-gateway', 'package.json'),
          'utf8'
        ),
        policy: await fsExtra.readFile(
          path.join(workspacePath, 'first-gateway', 'gateway.policy.json'),
          'utf8'
        ),
        projectJson: await fsExtra.readFile(
          path.join(workspacePath, 'first-gateway', '.workspai', 'project.json'),
          'utf8'
        ),
      };
      const firstModel = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json')
      );
      const firstContract = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'workspace.contract.json')
      );
      const goalsPath = path.join(workspacePath, '.workspai', 'goals', 'index.json');
      const firstGoals = (await fsExtra.pathExists(goalsPath))
        ? await fsExtra.readJson(goalsPath)
        : null;
      const graphPath = path.join(workspacePath, '.workspai', 'reports', 'workspace-graph.json');
      const firstGraph = (await fsExtra.pathExists(graphPath))
        ? await fsExtra.readJson(graphPath)
        : null;

      expect(
        await index.handleCreateOrFallback([
          'create',
          'project',
          'gateway.openrouter.python',
          'second-gateway',
          '--skip-git',
          '--yes',
        ])
      ).toBe(0);
      expect(await fsExtra.pathExists(path.join(workspacePath, 'second-gateway', '.venv'))).toBe(
        false
      );

      expect(
        await fsExtra.readFile(path.join(workspacePath, 'first-gateway', 'package.json'), 'utf8')
      ).toBe(firstProject.packageJson);
      expect(
        await fsExtra.readFile(
          path.join(workspacePath, 'first-gateway', 'gateway.policy.json'),
          'utf8'
        )
      ).toBe(firstProject.policy);
      expect(
        await fsExtra.readFile(
          path.join(workspacePath, 'first-gateway', '.workspai', 'project.json'),
          'utf8'
        )
      ).toBe(firstProject.projectJson);

      const model = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json')
      );
      expect(model.projects.map((project: { name?: string }) => project.name).sort()).toEqual([
        'first-gateway',
        'second-gateway',
      ]);
      expect(firstModel.projects.map((project: { name?: string }) => project.name)).toEqual([
        'first-gateway',
      ]);
      const typescriptProject = model.projects.find(
        (project: { name?: string }) => project.name === 'first-gateway'
      );
      const pythonProject = model.projects.find(
        (project: { name?: string }) => project.name === 'second-gateway'
      );
      expect(typescriptProject).toMatchObject({
        kind: 'gateway',
        category: 'gateway',
        kit: 'gateway.openrouter.typescript',
        runtime: 'node',
      });
      expect(pythonProject).toMatchObject({
        kind: 'gateway',
        category: 'gateway',
        kit: 'gateway.openrouter.python',
        runtime: 'python',
      });
      const typescriptRecord = await fsExtra.readJson(
        path.join(workspacePath, 'first-gateway', '.workspai', 'project.json')
      );
      const pythonRecord = await fsExtra.readJson(
        path.join(workspacePath, 'second-gateway', '.workspai', 'project.json')
      );
      expect(typescriptRecord).toMatchObject({
        kind: 'gateway',
        category: 'gateway',
        framework: 'openrouter',
        kit: 'gateway.openrouter.typescript',
      });
      expect(pythonRecord).toMatchObject({
        kind: 'gateway',
        category: 'gateway',
        framework: 'openrouter',
        kit: 'gateway.openrouter.python',
      });
      expect(typescriptProject.commands.fleetStages).toEqual(
        expect.arrayContaining(['init', 'test', 'build', 'start'])
      );
      expect(pythonProject.commands.fleetStages).toEqual(
        expect.arrayContaining(['init', 'test', 'build', 'start'])
      );

      const contract = await fsExtra.readJson(
        path.join(workspacePath, '.workspai', 'workspace.contract.json')
      );
      expect(contract.workspace).toEqual(firstContract.workspace);
      expect(contract.projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'first-gateway', kit: 'gateway.openrouter.typescript' }),
          expect.objectContaining({ slug: 'second-gateway', kit: 'gateway.openrouter.python' }),
        ])
      );
      if (firstGoals) {
        expect(await fsExtra.pathExists(goalsPath)).toBe(true);
      }
      if (firstGraph) {
        expect(await fsExtra.pathExists(graphPath)).toBe(true);
      }

      for (const [scope, kitId, expected] of [
        [
          'project:first-gateway',
          'gateway.openrouter.typescript',
          {
            init: /rapidkit init|npm install/,
            test: /rapidkit test|npm (?:run )?test/,
            build: /rapidkit build|npm run build/,
            start: /rapidkit start|npm (?:run )?start/,
          },
        ],
        [
          'project:second-gateway',
          'gateway.openrouter.python',
          {
            init: /rapidkit init|pip install|python/,
            test: /rapidkit test|unittest/,
            build: /rapidkit build|compileall/,
            start: /rapidkit start|main\.py/,
          },
        ],
      ] as const) {
        for (const stage of ['init', 'test', 'build', 'start'] as const) {
          const planned = await runWorkspaceStage({
            workspacePath,
            stage,
            scope,
            planOnly: true,
            json: true,
            enforceGates: false,
          });
          expect(planned.summary.selectedCount).toBe(1);
          const row = planned.projects.find((project) => project.selected);
          expect(row?.projectName).toBe(scope.replace('project:', ''));
          const command =
            row?.runtimeExecutions?.map((execution) => execution.command).join(' ') ??
            row?.executionCommand ??
            '';
          expect(command, `${kitId} ${stage}`).toMatch(expected[stage]);
        }
      }

      const verify = await buildWorkspaceVerify({ workspacePath });
      expect(verify.steps.some((step) => step.id === 'workspace.doctor')).toBe(true);
      expect(verify.steps.map((step) => step.id).join('\n')).not.toMatch(
        /unknown kind|unsupported kind/i
      );
      const verifiedProjects = new Set(
        verify.steps.filter((step) => step.scope === 'project').map((step) => step.project)
      );
      expect([...verifiedProjects]).toEqual(
        expect.arrayContaining(['first-gateway', 'second-gateway'])
      );

      const previousKey = process.env.OPENROUTER_API_KEY;
      const previousModel = process.env.OPENROUTER_MODEL;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
      try {
        const initReport = await runWorkspaceStage({
          workspacePath,
          stage: 'init',
          json: true,
          enforceGates: false,
        });
        const initText = JSON.stringify(initReport);
        if (looksLikeRegistryFailure(initText)) {
          return;
        }
        const initFailures = initReport.projects
          .filter((project) => project.status === 'failed')
          .map(
            (project) =>
              `${project.projectName}: ${project.reason ?? ''} ${project.errorMessage ?? ''} ${project.failureDiagnostic?.outputExcerpt ?? ''}`
          )
          .join('\n');
        expect(initReport.summary.failed, initFailures).toBe(0);

        const testReport = await runWorkspaceStage({
          workspacePath,
          stage: 'test',
          json: true,
          enforceGates: false,
        });
        const testText = JSON.stringify(testReport);
        expect(testText.toLowerCase()).not.toContain('sk-or-live');
        const testFailures = testReport.projects
          .filter((project) => project.status === 'failed')
          .map(
            (project) =>
              `${project.projectName}: ${project.reason ?? ''} ${project.errorMessage ?? ''} ${project.failureDiagnostic?.outputExcerpt ?? ''} ${project.runtimeExecutions
                ?.map((execution) => execution.command)
                .join(' | ')}`
          )
          .join('\n');
        if (!looksLikeRegistryFailure(`${testText}\n${testFailures}`)) {
          expect(testReport.summary.failed, testFailures).toBe(0);
        }

        const startReport = await runWorkspaceStage({
          workspacePath,
          stage: 'start',
          json: true,
          enforceGates: false,
        });
        expect(startReport.summary.failed).toBeGreaterThan(0);
        const startText = JSON.stringify(startReport);
        expect(startText).toMatch(/OPENROUTER_API_KEY|OPENROUTER_MODEL/);
        expect(startText.toLowerCase()).not.toContain('sk-or-live');
      } finally {
        if (previousKey !== undefined) process.env.OPENROUTER_API_KEY = previousKey;
        if (previousModel !== undefined) process.env.OPENROUTER_MODEL = previousModel;
      }
    } finally {
      process.chdir(previousCwd);
    }
  }, 600_000);
});
