import { rm } from 'node:fs/promises';
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
import {
  assertGatewayQualificationStage,
  classifyGatewayLifecycleReport,
  ModelGatewayQualificationError,
  runGatewayInitWithRegistryRetry,
} from '../model-gateways/qualification-gate.js';

const roots: string[] = [];

async function removeTempRoot(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const cwd = process.cwd();
  if (cwd === resolvedRoot || cwd.startsWith(`${resolvedRoot}${path.sep}`)) {
    process.chdir(os.tmpdir());
  }
  await rm(resolvedRoot, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 10 : 0,
    retryDelay: 100,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await removeTempRoot(root);
  }
});

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
        const initReport = await runGatewayInitWithRegistryRetry(
          () =>
            runWorkspaceStage({
              workspacePath,
              stage: 'init',
              json: true,
              enforceGates: false,
            }),
          { attempts: 2, delayMs: 1_000 }
        );
        const initFailures = initReport.projects
          .filter((project) => project.status === 'failed')
          .map(
            (project) =>
              `${project.projectName}: ${project.reason ?? ''} ${project.errorMessage ?? ''} ${project.failureDiagnostic?.outputExcerpt ?? ''}`
          )
          .join('\n');
        assertGatewayQualificationStage({
          stage: 'init',
          failed: initReport.summary.failed,
          report: initReport,
          detail: initFailures,
        });

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
        assertGatewayQualificationStage({
          stage: 'test',
          failed: testReport.summary.failed,
          report: testReport,
          detail: testFailures,
        });

        const buildReport = await runWorkspaceStage({
          workspacePath,
          stage: 'build',
          json: true,
          enforceGates: false,
        });
        const buildFailures = buildReport.projects
          .filter((project) => project.status === 'failed')
          .map(
            (project) =>
              `${project.projectName}: ${project.reason ?? ''} ${project.errorMessage ?? ''} ${project.failureDiagnostic?.outputExcerpt ?? ''}`
          )
          .join('\n');
        assertGatewayQualificationStage({
          stage: 'build',
          failed: buildReport.summary.failed,
          report: buildReport,
          detail: buildFailures,
        });

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

  it('does not return a passing qualification result for a registry outage', async () => {
    expect(() =>
      assertGatewayQualificationStage({
        stage: 'init',
        failed: 1,
        detail: 'npm ERR! 404 Not Found @openrouter/sdk',
      })
    ).toThrow(ModelGatewayQualificationError);
    try {
      assertGatewayQualificationStage({
        stage: 'init',
        failed: 1,
        detail: 'npm ERR! 404 Not Found @openrouter/sdk',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelGatewayQualificationError);
      expect((error as ModelGatewayQualificationError).classification).toBe('registry');
    }

    const sparseUnknownInitReport = {
      summary: { failed: 1 },
      projects: [
        {
          status: 'failed',
          errorCategory: 'unknown',
          reason: 'Stage failed with exit code 1',
          errorMessage: 'Stage failed with exit code 1',
          executionCommand: '[node:.] npm install',
          failureDiagnostic: {
            category: 'unknown',
            exitCode: 1,
            command: 'npm install',
            timedOut: false,
            timeoutMs: 300_000,
          },
        },
      ],
    };
    expect(classifyGatewayLifecycleReport(sparseUnknownInitReport, 'init')).toBe('registry');
    try {
      assertGatewayQualificationStage({
        stage: 'init',
        failed: 1,
        report: sparseUnknownInitReport,
      });
      throw new Error('expected sparse init receipt to fail qualification');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelGatewayQualificationError);
      expect((error as ModelGatewayQualificationError).classification).toBe('registry');
      expect((error as Error).message).toContain('QUALIFICATION_INFRA');
    }

    let sparseAttempts = 0;
    await runGatewayInitWithRegistryRetry(
      async () => {
        sparseAttempts += 1;
        return sparseUnknownInitReport;
      },
      { attempts: 2, delayMs: 0 }
    );
    expect(sparseAttempts).toBe(2);

    const assertionFailureReport = {
      summary: { failed: 1 },
      projects: [
        {
          status: 'failed',
          errorCategory: 'test-failure',
          reason: 'Stage failed with exit code 1: AssertionError',
          errorMessage: 'Stage failed with exit code 1: AssertionError',
          executionCommand: '[python:.] python -m unittest',
          failureDiagnostic: {
            category: 'test-failure',
            exitCode: 1,
            command: 'python -m unittest',
            timedOut: false,
            timeoutMs: 90_000,
            outputExcerpt: 'AssertionError: 1 != 2',
          },
        },
      ],
    };
    expect(classifyGatewayLifecycleReport(assertionFailureReport, 'test')).toBe('product');

    let productAttempts = 0;
    await runGatewayInitWithRegistryRetry(
      async () => {
        productAttempts += 1;
        return {
          summary: { failed: 1 },
          projects: [
            {
              status: 'failed',
              errorCategory: 'runtime',
              reason: 'TypeError: boom',
              failureDiagnostic: {
                category: 'runtime',
                command: 'node src/main.ts',
                outputExcerpt: 'TypeError: boom',
              },
            },
          ],
        };
      },
      { attempts: 2, delayMs: 0 }
    );
    expect(productAttempts).toBe(1);

    await expect(
      runGatewayInitWithRegistryRetry(
        async () => ({
          summary: { failed: 1 },
          projects: [{ status: 'failed', errorMessage: 'ENOTFOUND registry.npmjs.org' }],
        }),
        { attempts: 2, delayMs: 0 }
      ).then((report) =>
        assertGatewayQualificationStage({
          stage: 'init',
          failed: report.summary.failed,
          report,
        })
      )
    ).rejects.toBeInstanceOf(ModelGatewayQualificationError);
  });
});
