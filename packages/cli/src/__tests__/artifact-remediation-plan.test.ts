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
  it('uses canonical portable references for an adopted project outside the workspace', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = await fsExtra.mkdtemp(path.join(tmpdir(), 'workspai-external-grpc-'));
    await fsExtra.writeFile(path.join(projectPath, 'CMakeLists.txt'), 'project(grpc)\n');
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json'),
      {
        schemaVersion: 'doctor-remediation-plan-v2',
        steps: [
          {
            id: 'grpc.coverage.command',
            diagnosisFindingId: 'grpc.coverage',
            causalKey: 'grpc:test:coverage',
            findingStatus: 'advisory',
            projectName: 'grpc',
            projectPath,
            originalCommand: 'npx workspai project coverage --run --json',
            executableInCurrentEnvironment: true,
            risk: 'safe',
            files: [path.join(projectPath, 'CMakeLists.txt')],
            invocation: {
              cwd: projectPath,
              executable: 'npx',
              // Legacy evidence may predate the no-network execution contract.
              args: ['workspai', 'project', 'coverage', '--run', '--json'],
            },
            studioStatus: { state: 'ready' },
          },
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({
      workspacePath,
      toolAvailable: async () => true,
    });
    const action = plan.actions[0];
    const serialized = JSON.stringify(plan);

    expect(action).toMatchObject({
      projectName: 'grpc',
      projectPath: 'external/grpc',
      files: ['external/grpc/CMakeLists.txt'],
      invocation: {
        cwd: '.',
        executable: 'npx',
        args: ['--no-install', 'workspai', 'project', 'coverage', '--run', '--json'],
      },
    });
    expect(serialized).not.toContain(projectPath);
    expect(serialized).not.toContain('../');
  });

  it('preserves unavailable Doctor invocations as explicit host prerequisites', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = path.join(workspacePath, 'accounting');
    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json'),
      {
        schemaVersion: 'doctor-remediation-plan-v2',
        steps: [
          {
            id: 'accounting.dependencies',
            projectName: 'accounting',
            projectPath,
            originalCommand: 'dotnet restore',
            executable: true,
            executableInCurrentEnvironment: false,
            risk: 'guarded',
            invocation: { cwd: projectPath, executable: 'dotnet', args: ['restore'] },
            studioStatus: {
              state: 'blocked',
              reason: 'Required executable is unavailable: dotnet',
            },
          },
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({
      workspacePath,
      toolAvailable: async () => false,
    });
    const action = plan.actions.find((item) => item.id === 'doctor.accounting.dependencies');

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'environment.runtime.dotnet',
          status: 'guidance-only',
        }),
      ])
    );
    expect(action).toMatchObject({
      mode: 'run-command',
      status: 'blocked',
      command: 'dotnet restore',
      invocation: { cwd: '.', executable: 'dotnet', args: ['restore'] },
      dependsOn: ['environment.runtime.dotnet'],
      retryPolicy: { sameGeneration: 'forbidden', resumeWhen: 'environment-changed' },
    });
    expect(action?.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'executable', status: 'missing' }),
        expect.objectContaining({
          kind: 'action',
          actionId: 'environment.runtime.dotnet',
          status: 'pending',
        }),
      ])
    );
  });

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
            diagnosisFindingId: 'finding.api.security',
            causalKey: 'causal.api.security',
            phase: 'dependency-baseline',
            order: 1,
            dependsOn: [],
            projectName: 'api',
            projectPath,
            originalCommand: `cd "${projectPath}" && npm audit fix --audit-level=moderate`,
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
        findingId: 'finding.api.security',
        causalKey: 'causal.api.security',
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
          projectPath: 'api',
          requiredStages: ['reconcile', 'audit', 'test', 'build'],
        }),
        rollback: { available: true, strategy: 'manual' },
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain(projectPath);
  });

  it('derives a portable dependency transaction from normal Doctor evidence', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = path.join(workspacePath, 'api');
    const copyOperation = {
      type: 'file-copy',
      sourcePath: path.join(projectPath, '.env.example'),
      path: path.join(projectPath, '.env'),
      overwrite: false,
    } as const;
    const copyCommand = `workspai:doctor:repair ${Buffer.from(
      JSON.stringify(copyOperation)
    ).toString('base64url')}`;
    await fsExtra.ensureDir(projectPath);
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        schemaVersion: 'doctor-workspace-evidence-v1',
        projects: [
          {
            name: 'api',
            path: projectPath,
            diagnosis: {
              findings: [
                {
                  id: 'finding.api.security',
                  causalKey: 'causal.api.security',
                  status: 'blocking',
                  repair: { capabilityId: 'surface-security-hygiene.command' },
                },
                {
                  id: 'finding.api.environment',
                  causalKey: 'causal.api.environment',
                  status: 'advisory',
                  repair: { capabilityId: 'surface-env-contract.file-copy' },
                },
              ],
            },
            repairCapabilities: [
              {
                id: 'surface-security-hygiene.command',
                title: 'Repair dependency security baseline',
                status: 'available',
                risk: 'guarded',
                canAutoFix: true,
                reason: 'Dependency vulnerabilities require a package-manager transaction.',
                files: [
                  path.join(projectPath, 'package.json'),
                  path.join(projectPath, 'package-lock.json'),
                ],
                command: `cd "${projectPath}" && npm audit fix --audit-level=moderate`,
                invocation: {
                  cwd: projectPath,
                  executable: 'npm',
                  args: ['audit', 'fix', '--audit-level=moderate'],
                },
                verifyCommand: 'npx workspai doctor project --json',
                strategy: [
                  {
                    id: 'reconcile',
                    kind: 'safe-fix',
                    description: 'Reconcile manifest, lockfile, and installed tree.',
                    risk: 'guarded',
                    continueWhen: 'always',
                    invocation: {
                      cwd: projectPath,
                      executable: 'npm',
                      args: ['install'],
                    },
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
              {
                id: 'surface-env-contract.file-copy',
                title: 'Create local environment file',
                status: 'available',
                risk: 'safe',
                canAutoFix: true,
                canEditFiles: true,
                reason: 'Copy the reviewed environment example without overwriting user data.',
                files: [copyOperation.sourcePath, copyOperation.path],
                command: copyCommand,
                operation: copyOperation,
                verifyCommand: 'npx workspai doctor project --json',
              },
              {
                id: 'surface-security-hygiene.command-alias',
                title: 'Repair the same dependency baseline alias',
                status: 'available',
                risk: 'guarded',
                canAutoFix: true,
                reason: 'A second probe owns the same executable repair.',
                files: [path.join(projectPath, 'package.json')],
                invocation: {
                  cwd: projectPath,
                  executable: 'npm',
                  args: ['audit', 'fix', '--audit-level=moderate'],
                },
                verifyCommand: 'npx workspai doctor project --json',
              },
            ],
          },
        ],
      }
    );
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        blockers: [
          'dependency: 2 dependency vulnerabilities reported',
          'dependency: api remains blocked by security audit',
        ],
      }
    );
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-verify-last-run.json'),
      {
        schemaVersion: 'workspace-verify.v1',
        blockers: ['api verification is blocked', 'api evidence is stale'],
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath });
    const serialized = JSON.stringify(plan);

    const dependencyAction = plan.actions.find(
      (action) => action.id === 'doctor.api.surface-security-hygiene.command'
    );
    expect(dependencyAction).toEqual(
      expect.objectContaining({
        projectName: 'api',
        projectPath: 'api',
        findingId: 'finding.api.security',
        causalKey: 'causal.api.security',
        command: 'npm audit fix --audit-level=moderate',
        files: ['api/package.json', 'api/package-lock.json'],
        strategy: [
          expect.objectContaining({
            invocation: expect.objectContaining({ cwd: '.' }),
          }),
        ],
        transaction: expect.objectContaining({
          schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
          projectPath: 'api',
          requiredStages: ['reconcile', 'audit', 'test', 'build'],
        }),
      })
    );
    expect(dependencyAction?.notes).toContain(
      'Also satisfies Doctor capability: surface-security-hygiene.command-alias'
    );
    expect(
      plan.actions.filter((action) => action.command === 'npm audit fix --audit-level=moderate')
    ).toHaveLength(1);
    const fileAction = plan.actions.find(
      (action) => action.id === 'doctor.api.surface-env-contract.file-copy'
    );
    const portableToken = fileAction?.command?.split(' ')[1];
    expect(portableToken).toBeTruthy();
    expect(JSON.parse(Buffer.from(portableToken as string, 'base64url').toString('utf8'))).toEqual({
      type: 'file-copy',
      sourcePath: '.env.example',
      path: '.env',
      overwrite: false,
    });
    expect(fileAction?.rollback).toEqual({ available: true, strategy: 'manual' });
    expect(plan.actions.some((action) => action.id.includes('doctor-owner'))).toBe(false);
    expect(plan.actions.filter((action) => action.cardId === 'workspaceVerify')).toHaveLength(1);
    expect(serialized).not.toContain(projectPath);
  });

  it('applies executable truth to every dependency ecosystem in a polyglot Doctor plan', async () => {
    const workspacePath = await makeWorkspace();
    const ecosystems = [
      ['node', 'npm'],
      ['python', 'poetry'],
      ['go', 'go'],
      ['rust', 'cargo'],
      ['php-composer', 'composer'],
      ['ruby-bundler', 'bundle'],
      ['elixir-mix', 'mix'],
      ['deno', 'deno'],
      ['dotnet', 'dotnet'],
      ['jvm-maven', 'mvn'],
      ['jvm-gradle', 'gradle'],
      ['clojure', 'clojure'],
      ['scala-sbt', 'sbt'],
    ] as const;
    const projects = [];
    for (const [ecosystem, executable] of ecosystems) {
      const projectPath = path.join(workspacePath, ecosystem);
      await fsExtra.ensureDir(projectPath);
      projects.push({
        name: ecosystem,
        path: projectPath,
        issues: ['Dependencies are not materialized'],
        repairCapabilities: [
          {
            id: 'runtime-dependency-materialization.dependency-materialization',
            title: `Materialize ${ecosystem} dependencies`,
            status: 'available',
            risk: 'guarded',
            canAutoFix: true,
            canEditFiles: false,
            files: [],
            command: `${executable} install`,
            invocation: { cwd: projectPath, executable, args: ['install'] },
            transaction: {
              schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
              kind: 'dependency-materialization',
              state: 'planned',
              projectPath,
              ecosystem,
              sourceMutationRequired: false,
              observableState: 'runtime-dependency-tree',
              requiredStages: ['reconcile', 'test', 'build'],
              completion: {
                manifestLockConsistent: true,
                installedTreePresent: true,
                declaredTestsPass: true,
                declaredBuildPass: true,
                canonicalVerificationRequired: true,
              },
            },
            reason: `${ecosystem} dependencies are missing.`,
          },
        ],
      });
    }
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      { projects }
    );

    const plan = await buildArtifactRemediationPlan({
      workspacePath,
      toolAvailable: async () => false,
    });
    const dependencyActions = plan.actions.filter((action) => action.transaction);

    expect(dependencyActions).toHaveLength(ecosystems.length);
    for (const action of dependencyActions) {
      expect(action).toMatchObject({
        status: 'blocked',
        retryPolicy: { sameGeneration: 'forbidden', resumeWhen: 'environment-changed' },
      });
      expect(action.requirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'executable', status: 'missing' }),
          expect.objectContaining({ kind: 'action', status: 'pending' }),
        ])
      );
    }
    expect(plan.execution.eligibleActionIds).toEqual([]);
    expect(plan.execution.nextActionId).toMatch(/^environment\./);
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

  it('turns missing project verification evidence into ordered scoped producers', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-verify-last-run.json'),
      {
        schemaVersion: 'workspace-verify.v1',
        blockingReasons: [
          'project.api.init: Workspace run evidence does not include project api.',
          'project.api.test: Workspace run evidence does not include project api.',
        ],
        steps: [
          {
            id: 'workspace.readiness',
            scope: 'workspace',
            required: true,
            status: 'fail',
            message: 'Release readiness is blocked.',
            command: { display: 'npx workspai readiness --json' },
          },
          {
            id: 'project.api.init',
            label: 'Run init for api',
            scope: 'project',
            project: 'api',
            required: true,
            status: 'missing',
            message: 'Workspace run evidence does not include project api.',
            command: {
              display: 'npx workspai workspace run init --scope project:api --json',
            },
          },
          {
            id: 'project.api.test',
            label: 'Run tests for api',
            scope: 'project',
            project: 'api',
            required: true,
            status: 'missing',
            message: 'Workspace run evidence does not include project api.',
            command: {
              display: 'npx workspai workspace run test --scope project:api --json',
            },
          },
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({ workspacePath });
    const projectActions = plan.actions.filter((action) => action.cardId === 'workspaceVerify');

    expect(projectActions).toEqual([
      expect.objectContaining({
        id: 'workspaceVerify.project.api.init',
        scope: 'project',
        projectName: 'api',
        command: 'npx workspai workspace run init --scope project:api --json --no-gates',
      }),
      expect.objectContaining({
        id: 'workspaceVerify.project.api.test',
        command: 'npx workspai workspace run test --scope project:api --json --no-gates',
        dependsOn: ['workspaceVerify.project.api.init'],
      }),
    ]);
    expect(projectActions[0].dependsOn).toBeUndefined();
    expect(projectActions.some((action) => action.command?.includes('workspace verify'))).toBe(
      false
    );
  });

  it('creates runtime setup and bootstrap actions for readiness toolchain blockers', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        blockingReasons: ['env: Project runtimes (node, python) are not pinned in toolchain.lock'],
      }
    );

    const plan = await buildArtifactRemediationPlan({
      workspacePath,
      toolAvailable: async () => true,
    });

    expect(plan.actions.map((action) => action.command)).toEqual([
      'npx workspai setup node --json',
      'npx workspai bootstrap --ci --json',
      'npx workspai setup python --json',
      'npx workspai bootstrap --ci --json',
    ]);
    expect(plan.actions[1].dependsOn).toEqual(['readiness.toolchain.node.setup']);
    expect(plan.actions[3].dependsOn).toEqual(['readiness.toolchain.python.setup']);
    expect(plan.actions[0].invocation).toEqual({
      cwd: '.',
      executable: 'npx',
      args: ['--no-install', 'workspai', 'setup', 'node', '--json'],
    });
    expect(plan.actions[1].invocation).toEqual({
      cwd: '.',
      executable: 'npx',
      args: ['--no-install', 'workspai', 'bootstrap', '--ci', '--json'],
    });
  });

  it('blocks every supported missing host runtime before setup and exposes one canonical next step', async () => {
    const workspacePath = await makeWorkspace();
    const runtimes = ['python', 'node', 'go', 'java', 'dotnet', 'rust', 'php'];
    await fsExtra.writeJSON(
      path.join(workspacePath, '.workspai', 'reports', 'release-readiness-last-run.json'),
      {
        schemaVersion: 'release-readiness-v1',
        blockingReasons: [
          `env: Project runtimes (${runtimes.join(', ')}) are not pinned in toolchain.lock`,
        ],
      }
    );

    const plan = await buildArtifactRemediationPlan({
      workspacePath,
      toolAvailable: async (executable) => executable === 'npx',
    });

    for (const runtime of runtimes) {
      const prerequisite = plan.actions.find(
        (action) => action.id === `environment.runtime.${runtime}`
      );
      const setup = plan.actions.find(
        (action) => action.id === `readiness.toolchain.${runtime}.setup`
      );
      const bootstrap = plan.actions.find(
        (action) => action.id === `readiness.toolchain.${runtime}.bootstrap`
      );
      expect(prerequisite).toMatchObject({
        status: 'guidance-only',
        retryPolicy: { sameGeneration: 'forbidden', resumeWhen: 'environment-changed' },
      });
      expect(setup).toMatchObject({
        status: 'blocked',
        dependsOn: [`environment.runtime.${runtime}`],
        invocation: {
          cwd: '.',
          executable: 'npx',
          args: ['--no-install', 'workspai', 'setup', runtime, '--json'],
        },
      });
      expect(bootstrap).toMatchObject({
        status: 'blocked',
        dependsOn: [`readiness.toolchain.${runtime}.setup`],
        invocation: {
          cwd: '.',
          executable: 'npx',
          args: ['--no-install', 'workspai', 'bootstrap', '--ci', '--json'],
        },
      });
    }
    expect(plan.execution.eligibleActionIds).toEqual([]);
    expect(plan.execution.nextActionId).toBe('environment.runtime.python');
    expect(plan.summary).toMatchObject({
      executableActions: 0,
      blockedActions: runtimes.length * 2,
      guidanceActions: runtimes.length,
    });
  });

  it('binds aggregate pipeline reruns to their upstream remediation actions', async () => {
    const workspacePath = await makeWorkspace();
    const reportsPath = path.join(workspacePath, '.workspai', 'reports');
    await fsExtra.writeJSON(path.join(reportsPath, 'release-readiness-last-run.json'), {
      schemaVersion: 'release-readiness-v1',
      blockingReasons: ['env: Project runtime (node) is not pinned in toolchain.lock'],
    });
    await fsExtra.writeJSON(path.join(reportsPath, 'pipeline-last-run.json'), {
      schemaVersion: 'rapidkit-pipeline-v1',
      blockingReasons: ['readiness: Project runtime (node) is not pinned in toolchain.lock'],
    });

    const plan = await buildArtifactRemediationPlan({ workspacePath });
    const pipelineAction = plan.actions.find((action) => action.cardId === 'pipeline');

    expect(pipelineAction).toEqual(
      expect.objectContaining({
        command: 'npx workspai pipeline --json --strict',
        dependsOn: ['readiness.toolchain.node.setup', 'readiness.toolchain.node.bootstrap'],
      })
    );
    expect(pipelineAction?.notes).toContain(
      'This aggregate gate must run after its contract-owned upstream remediation actions.'
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
