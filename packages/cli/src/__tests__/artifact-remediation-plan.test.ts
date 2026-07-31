import path from 'path';
import fsExtra from 'fs-extra';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';

import {
  buildArtifactRemediationPlan,
  writeArtifactRemediationPlan,
} from '../artifact-remediation-plan.js';

async function makeWorkspace(): Promise<string> {
  const workspacePath = await fsExtra.mkdtemp(path.join(tmpdir(), 'rapidkit-artifact-plan-'));
  await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
  await fsExtra.writeJSON(path.join(workspacePath, '.workspai', 'workspace.json'), {
    name: path.basename(workspacePath),
    profile: 'enterprise',
  });
  await fsExtra.writeFile(path.join(workspacePath, '.workspai-workspace'), '1\n');
  return workspacePath;
}

describe('artifact remediation plan', () => {
  it('builds deterministic Bootstrap compliance remediation actions for Studio', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'bootstrap-compliance.latest.json'),
      {
        schemaVersion: 'bootstrap-compliance-v1',
        blockers: [
          'profile.enterprise.ci: enterprise profile expects --ci for deterministic non-interactive mode.',
          'profile.enterprise.compatibility-matrix: enterprise profile requires .rapidkit/compatibility-matrix.json.',
          'profile.enterprise.mirror-config: enterprise profile requires .rapidkit/mirror-config.json.',
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath });

    expect(plan.schemaVersion).toBe('artifact-remediation-plan-v1');
    expect(plan.source.ciMode).toBe(false);
    expect(plan.summary.artifactsScanned).toBe(1);
    expect(plan.summary.cardsCovered).toBe(1);
    expect(plan.summary.totalActions).toBe(3);
    expect(plan.summary.risk.safe).toBe(3);
    expect(plan.actions.map((action) => action.id)).toEqual([
      'bootstrap.enterprise-ci',
      'bootstrap.compatibility-matrix',
      'bootstrap.mirror-config',
    ]);
    expect(plan.actions[0].command).toBe('npx workspai bootstrap --ci --json');
    expect(plan.actions[1].operation).toEqual(
      expect.objectContaining({
        type: 'file-create',
        path: '.workspai/compatibility-matrix.json',
        overwrite: false,
      })
    );
    expect(plan.actions[2].operation).toEqual(
      expect.objectContaining({
        type: 'file-create',
        path: '.workspai/mirror-config.json',
        overwrite: false,
      })
    );
  });

  it('bridges non-Doctor governance artifacts to command-first remediation', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'analyze-last-run.json'),
      {
        schemaVersion: 'rapidkit-analyze-v1',
        findings: [{ id: 'test-surface', message: 'No test script detected.' }],
      }
    );
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        blockers: ['dependency: 2 dependency vulnerabilities reported'],
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardId: 'analyze',
          mode: 'run-command',
          command: 'npx workspai analyze --strict --json',
        }),
        expect.objectContaining({
          cardId: 'readiness',
          mode: 'verify-before-fix',
          command: 'npx workspai doctor workspace --plan --json',
          verifyCommand: 'npx workspai readiness --json',
        }),
      ])
    );
  });

  it('projects Doctor remediation steps into ordered project-scoped actions', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = path.join(workspacePath, 'api');
    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json'),
      {
        schemaVersion: 'doctor-remediation-plan-v2',
        generatedAt: new Date().toISOString(),
        policyProfile: 'local',
        fixableProjects: 1,
        totalSteps: 1,
        executableSteps: 1,
        risk: { safe: 0, guarded: 1, invasive: 0 },
        steps: [
          {
            id: 'api-security-fix',
            phase: 'dependency-baseline',
            order: 1,
            dependsOn: [],
            projectName: 'api',
            projectPath,
            originalCommand: 'npm audit fix --audit-level=moderate',
            kind: 'shell',
            risk: 'guarded',
            executable: true,
            files: ['package.json', 'package-lock.json'],
            preview: {
              title: 'Repair api dependency baseline',
              summary: 'Apply compatible dependency fixes without force.',
              changes: ['package.json', 'package-lock.json'],
            },
            diffPreview: {
              available: false,
              format: 'none',
              summary: 'Generated by the package manager.',
              hunks: [],
            },
            verifyCommand: 'npx workspai doctor project --json',
            refreshCommands: ['npx workspai doctor project --json'],
            rollback: { available: true, strategy: 'snapshot' },
            studioStatus: { state: 'ready', reason: 'Guarded repair is executable.' },
            executableInCurrentEnvironment: true,
            strategy: [
              {
                id: 'reconcile',
                kind: 'safe-fix',
                description: 'Reconcile the dependency tree.',
                risk: 'guarded',
                continueWhen: 'always',
              },
            ],
            transaction: {
              schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
              kind: 'dependency-security',
              state: 'planned',
              projectPath,
              ecosystem: 'npm',
              requiredStages: ['reconcile', 'audit', 'test', 'build'],
              completion: {
                manifestLockConsistent: true,
                auditClean: true,
                declaredTestsPass: true,
                declaredBuildPass: true,
                canonicalVerificationRequired: true,
              },
            },
          },
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        id: 'doctor.api-security-fix',
        cardId: 'doctor',
        scope: 'project',
        projectName: 'api',
        projectPath: 'api',
        sourceStepId: 'api-security-fix',
        cwd: 'project',
        command: 'npm audit fix --audit-level=moderate',
        verifyCommand: 'npx workspai doctor project --json',
        strategy: [
          expect.objectContaining({
            id: 'reconcile',
            kind: 'safe-fix',
          }),
        ],
        transaction: expect.objectContaining({
          schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
          requiredStages: ['reconcile', 'audit', 'test', 'build'],
        }),
      }),
    ]);
  });

  it('builds CI-oriented verify commands when requested', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        blockers: ['dependency: 2 dependency vulnerabilities reported'],
      }
    );
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-run-last.json'),
      {
        schemaVersion: 'workspace-run-evidence-v1',
        stages: {
          test: {
            projects: [{ project: 'api', status: 'failed' }],
          },
        },
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath, ciMode: true });

    expect(plan.source.ciMode).toBe(true);
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardId: 'readiness',
          command: 'npx workspai doctor workspace --plan --json',
          verifyCommand: 'npx workspai readiness --strict --json',
        }),
        expect.objectContaining({
          cardId: 'workspaceRun',
          command: 'npx workspai workspace run test --strict --json',
          verifyCommand: 'npx workspai workspace run test --strict --json',
        }),
      ])
    );
  });

  it('persists artifact remediation plan for IDE consumers', async () => {
    const workspacePath = await makeWorkspace();
    const plan = await buildArtifactRemediationPlan({ workspacePath });
    const outputPath = await writeArtifactRemediationPlan(plan, workspacePath);

    expect(outputPath).toBe(
      path.join(workspacePath, '.workspai', 'reports', 'artifact-remediation-plan-last-run.json')
    );
    expect(await fsExtra.pathExists(outputPath)).toBe(true);
    expect(
      await fsExtra.pathExists(
        path.join(workspacePath, '.workspai', 'reports', 'artifact-remediation-plan-last-run.json')
      )
    ).toBe(true);
  });
});
