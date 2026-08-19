import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDoctorInternalRepairCommand } from '../utils/doctor-repair-capabilities.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import { WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH } from '../contracts/workspace-repair-transaction-contract.js';
import { STUDIO_CARD_REPAIR_CAPABILITIES } from '../contracts/studio-card-repair-capabilities-contract.js';
import {
  WORKSPACE_REPAIR_PROPOSAL_CONTRACT_PATH,
  WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
} from '../contracts/workspace-repair-proposal-contract.js';
import {
  approveWorkspaceRepair,
  decideWorkspaceRepair,
  executeWorkspaceRepair,
  planWorkspaceRepair,
  planWorkspaceRepairProposal,
  readWorkspaceRepairTransaction,
} from '../workspace-repair-engine.js';

const roots: string[] = [];

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

async function workspaceFixture(): Promise<{ workspacePath: string; projectPath: string }> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-repair-engine-'));
  roots.push(workspacePath);
  await fsExtra.writeFile(path.join(workspacePath, '.workspai-workspace'), 'profile=minimal\n');
  await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
  const projectPath = path.join(workspacePath, 'api');
  await fsExtra.ensureDir(projectPath);
  return { workspacePath, projectPath };
}

async function writeFileRepairEvidence(input: {
  workspacePath: string;
  projectPath: string;
  fileName?: string;
}): Promise<void> {
  const fileName = input.fileName ?? '.env.example';
  const operation = {
    type: 'file-create' as const,
    path: path.join(input.projectPath, fileName),
    content: 'APP_ENV=development\n',
    overwrite: false as const,
  };
  await fsExtra.writeJson(
    path.join(input.workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
    {
      projects: [
        {
          name: 'api',
          path: input.projectPath,
          probes: [
            {
              id: 'surface-environment-config',
              status: 'fail',
              repairCapability: {
                id: 'surface-environment-config.file-create',
                title: 'Create environment contract',
                status: 'available',
                risk: 'safe',
                canAutoFix: true,
                canEditFiles: true,
                requiresApproval: true,
                requiresReview: false,
                files: [operation.path],
                command: buildDoctorInternalRepairCommand(operation),
                operation,
                verifyCommand: 'npx workspai doctor project --json',
                refreshCommands: [],
                reason: 'Environment contract is missing.',
              },
            },
          ],
        },
      ],
    },
    { spaces: 2 }
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('Workspace Repair Engine', () => {
  it('binds explicit approval to the immutable source plan and closes only after canonical verify', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });

    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    expect(() =>
      assertJsonSchemaContract(
        planned,
        WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
        'workspace repair transaction'
      )
    ).not.toThrow();
    expect(planned).toMatchObject({
      schemaVersion: 'workspai.workspace-repair-transaction.v1',
      state: 'awaiting-approval',
      approval: { status: 'pending' },
      checkpoint: { status: 'pending' },
    });

    const approved = await approveWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
      approvedBy: 'test-user',
    });
    expect(approved).toMatchObject({
      state: 'approved',
      approval: {
        status: 'approved',
        approvedBy: 'test-user',
        approvedPlanHash: planned.integrity.planHash,
      },
    });

    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(completed.state).toBe('closed');
    expect(completed.verification?.status).toBe('passed');
    expect(await fsExtra.readFile(path.join(projectPath, '.env.example'), 'utf8')).toBe(
      'APP_ENV=development\n'
    );
    expect(completed.events.at(-1)).toMatchObject({ type: 'closed', status: 'passed' });
    const legacyV1Receipt = structuredClone(completed);
    if (legacyV1Receipt.verification) {
      delete legacyV1Receipt.verification.targetStatus;
      delete legacyV1Receipt.verification.workspaceStatus;
      delete legacyV1Receipt.verification.remainingActionIds;
    }
    expect(() =>
      assertJsonSchemaContract(
        legacyV1Receipt,
        WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH,
        'legacy workspace repair transaction'
      )
    ).not.toThrow();
  });

  it('publishes a workspace target when one Doctor transaction spans multiple projects', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const secondProjectPath = path.join(workspacePath, 'web');
    await fsExtra.ensureDir(secondProjectPath);
    const projects = [
      { name: 'api', projectPath },
      { name: 'web', projectPath: secondProjectPath },
    ];
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        projects: projects.map(({ name, projectPath: targetPath }) => {
          const operation = {
            type: 'file-create' as const,
            path: path.join(targetPath, '.env.example'),
            content: 'APP_ENV=development\n',
            overwrite: false as const,
          };
          return {
            name,
            path: targetPath,
            probes: [
              {
                id: 'surface-environment-config',
                status: 'fail',
                repairCapability: {
                  id: 'surface-environment-config.file-create',
                  title: 'Create environment contract',
                  status: 'available',
                  risk: 'safe',
                  canAutoFix: true,
                  canEditFiles: true,
                  requiresApproval: true,
                  requiresReview: false,
                  files: [operation.path],
                  command: buildDoctorInternalRepairCommand(operation),
                  operation,
                  verifyCommand: 'npx workspai doctor project --json',
                  refreshCommands: [],
                  reason: 'Environment contract is missing.',
                },
              },
            ],
          };
        }),
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });

    expect(planned.target).toMatchObject({
      cardId: 'doctor',
      scope: 'workspace',
      actionIds: [
        'doctor.api.surface-environment-config.file-create',
        'doctor.web.surface-environment-config.file-create',
      ],
    });
    expect(planned.target).not.toHaveProperty('projectName');
    expect(planned.target).not.toHaveProperty('projectPath');
  });

  it('isolates one blocking finding family from unrelated Doctor guidance and advisory actions', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const secondProjectPath = path.join(workspacePath, 'web');
    await fsExtra.ensureDir(secondProjectPath);
    const envSteps = [
      { name: 'api', projectPath },
      { name: 'web', projectPath: secondProjectPath },
    ].map(({ name, projectPath: targetPath }, index) => {
      const operation = {
        type: 'file-copy' as const,
        sourcePath: path.join(targetPath, '.env.example'),
        path: path.join(targetPath, '.env'),
        overwrite: false as const,
      };
      return {
        id: `${name}:env-copy:${index}`,
        phase: 'local-environment',
        order: index + 1,
        dependsOn: [],
        projectName: name,
        projectPath: targetPath,
        originalCommand: buildDoctorInternalRepairCommand(operation),
        kind: 'env-copy',
        risk: 'safe',
        executable: true,
        issueId: 'surface-env-contract',
        findingStatus: 'blocking',
        files: [operation.sourcePath, operation.path],
        operation,
        preview: {
          title: 'Create local environment file',
          summary: 'Copy .env.example to .env if the target is missing.',
          changes: ['copy reviewed environment example'],
        },
        diffPreview: {
          available: false,
          format: 'summary',
          summary: 'Copy the reviewed example.',
          hunks: [],
        },
        verifyCommand: 'npx workspai doctor project --json',
        refreshCommands: ['npx workspai doctor project --json'],
        rollback: { available: true, strategy: 'snapshot' },
        studioStatus: { state: 'ready', reason: 'Safe typed repair.' },
        executableInCurrentEnvironment: true,
      };
    });
    envSteps[0].dependsOn = [envSteps[1].id];
    await fsExtra.writeFile(path.join(projectPath, '.env.example'), 'API_KEY=\n');
    await fsExtra.writeFile(path.join(secondProjectPath, '.env.example'), 'API_KEY=\n');
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json'),
      {
        schemaVersion: 'doctor-remediation-plan-v2',
        generatedAt: new Date().toISOString(),
        policyProfile: 'local',
        fixableProjects: 2,
        totalSteps: 4,
        executableSteps: 3,
        risk: { safe: 2, guarded: 1, invasive: 1 },
        steps: [
          ...envSteps,
          {
            ...envSteps[0],
            id: 'api:security-guidance',
            order: 3,
            phase: 'manual-review',
            kind: 'shell',
            risk: 'guarded',
            executable: false,
            issueId: 'surface-security-hygiene',
            findingStatus: 'advisory',
            originalCommand: '',
            operation: undefined,
            files: [path.join(projectPath, 'pyproject.toml')],
            studioStatus: { state: 'review-required', reason: 'Declare pip-audit first.' },
            executableInCurrentEnvironment: false,
          },
          {
            ...envSteps[0],
            id: 'api:coverage',
            order: 4,
            phase: 'generic-execution',
            kind: 'shell',
            risk: 'invasive',
            issueId: 'test-coverage-evidence',
            findingStatus: 'advisory',
            originalCommand: 'npx workspai project coverage --run --json',
            operation: undefined,
            files: ['.workspai/reports/project-test-coverage-last-run.json'],
          },
        ],
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });

    expect(planned.state).toBe('awaiting-approval');
    expect(planned.target.actionIds).toEqual(['doctor.api:env-copy:0', 'doctor.web:env-copy:1']);
    expect(planned.decision).toBeUndefined();
    expect(planned.preconditions).toContainEqual(
      expect.objectContaining({ id: 'structured-execution', status: 'passed' })
    );

    const exact = await planWorkspaceRepair({
      workspacePath,
      cardId: 'doctor',
      actionId: 'doctor.api:env-copy:0',
    });
    expect(exact.target.actionIds).toEqual(['doctor.api:env-copy:0', 'doctor.web:env-copy:1']);
    expect(exact.state).toBe('awaiting-approval');
  });

  it('automatically restores the bounded checkpoint when canonical verification fails', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath, fileName: '.env.example' });
    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    const approved = await approveWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
    });
    expect(approved.state, approved.decision?.reason).toBe('approved');

    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        verify: vi.fn(async () => ({
          status: 'failed',
          exitCode: 1,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(completed.state).toBe('rolled-back');
    expect(completed.decision).toBeUndefined();
    expect(completed.checkpoint.status).toBe('restored');
    expect(await fsExtra.pathExists(path.join(projectPath, '.env.example'))).toBe(false);
  });

  it('closes the selected repair target while preserving unrelated workspace blockers', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const planned = await planWorkspaceRepair({
      workspacePath,
      cardId: 'doctor',
      projectName: 'api',
    });
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });

    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        verify: vi.fn(async () => ({
          status: 'blocked',
          exitCode: 2,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
        targetVerify: vi.fn(async () => ({ status: 'passed', remainingActionIds: [] })),
      }
    );

    expect(completed).toMatchObject({
      state: 'closed',
      verification: {
        status: 'passed',
        targetStatus: 'passed',
        workspaceStatus: 'blocked',
        remainingActionIds: [],
        exitCode: 2,
      },
    });
    expect(completed.verification?.summary).toContain('other governed findings');
    expect(await fsExtra.readFile(path.join(projectPath, '.env.example'), 'utf8')).toBe(
      'APP_ENV=development\n'
    );
  });

  it('expires approval when the persisted remediation plan changes before approval', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    const sourcePlanPath = path.join(
      workspacePath,
      '.workspai',
      'repair',
      'transactions',
      planned.transactionId,
      'source-plan.json'
    );
    const sourcePlan = await fsExtra.readJson(sourcePlanPath);
    sourcePlan.actions[0].summary = 'tampered';
    await fsExtra.writeJson(sourcePlanPath, sourcePlan, { spaces: 2 });

    const approval = await approveWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
    });

    expect(approval).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
      decision: { options: ['cancel'] },
    });
  });

  it('expires approval when the compiled transaction plan is tampered with', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    const transactionPath = path.join(
      workspacePath,
      '.workspai',
      'repair',
      'transactions',
      planned.transactionId,
      'transaction.json'
    );
    const transaction = await fsExtra.readJson(transactionPath);
    transaction.policy.allowForce = true;
    await fsExtra.writeJson(transactionPath, transaction, { spaces: 2 });

    const approval = await approveWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
    });

    expect(approval).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
      decision: { options: ['cancel'] },
    });
  });

  it('refuses execution when a checkpoint target changes after approval', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const target = path.join(projectPath, '.env.example');
    await fsExtra.writeFile(target, 'APP_ENV=initial\n');
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    await fsExtra.writeFile(target, 'APP_ENV=external-change\n');

    const result = await executeWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
    });

    expect(result).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
    });
    expect(result.decision?.reason).toContain('changed after planning');
    expect(await fsExtra.readFile(target, 'utf8')).toBe('APP_ENV=external-change\n');
  });

  it('does not steal an old lock from a still-running repair owner', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const planned = await planWorkspaceRepair({ workspacePath, cardId: 'doctor' });
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const lockPath = path.join(workspacePath, '.workspai', 'repair', 'engine.lock');
    await fsExtra.outputJson(lockPath, {
      transactionId: 'repair_otherowner',
      pid: process.pid,
      host: os.hostname(),
      acquiredAt: new Date(0).toISOString(),
    });
    await fsExtra.utimes(lockPath, new Date(0), new Date(0));

    await expect(
      executeWorkspaceRepair({ workspacePath, transactionId: planned.transactionId })
    ).rejects.toThrow('Another workspace repair transaction currently owns the engine lock');
    expect(await fsExtra.pathExists(lockPath)).toBe(true);
  });

  it('executes a Node dependency repair as one ordered closure transaction', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'api',
      scripts: { test: 'vitest run', build: 'tsc --noEmit' },
      dependencies: { next: '16.2.10' },
    });
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), {
      lockfileVersion: 3,
    });
    const capability = {
      id: 'surface-security-hygiene.command',
      title: 'Apply compatible npm fixes',
      status: 'available',
      risk: 'guarded',
      canAutoFix: true,
      canEditFiles: false,
      requiresApproval: true,
      requiresReview: true,
      files: [path.join(projectPath, 'package.json'), path.join(projectPath, 'package-lock.json')],
      command: `cd "${projectPath}" && npm audit fix --audit-level=moderate`,
      invocation: {
        cwd: projectPath,
        executable: 'npm',
        args: ['audit', 'fix', '--audit-level=moderate'],
      },
      strategy: [
        {
          id: 'recheck-advisory-graph',
          kind: 'verify',
          description: 'Re-run npm audit.',
          risk: 'safe',
          invocation: {
            cwd: projectPath,
            executable: 'npm',
            args: ['audit', '--json'],
          },
          continueWhen: 'blocker-remains',
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
      verifyCommand: 'npx workspai doctor project --json',
      refreshCommands: [],
      reason: 'Dependency vulnerabilities remain.',
    };
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        projects: [
          {
            name: 'api',
            path: projectPath,
            vulnerabilities: 2,
            probes: [
              {
                id: 'surface-security-hygiene',
                status: 'fail',
                repairCapability: capability,
              },
            ],
          },
        ],
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair({
      workspacePath,
      cardId: 'doctor',
      projectName: 'api',
    });
    expect(planned.state).toBe('awaiting-approval');
    expect(planned.stages.map((stage) => stage.kind)).toEqual([
      'verify',
      'repair',
      'reconcile',
      'audit',
      'test',
      'build',
      'verify',
      'verify',
    ]);
    expect(planned.adapterEvaluations).toEqual([
      expect.objectContaining({ adapterId: 'node', projectPath: 'api', status: 'ready' }),
    ]);
    const missingToolPlan = await planWorkspaceRepair(
      { workspacePath, cardId: 'doctor', projectName: 'api' },
      { toolAvailable: async () => false }
    );
    expect(missingToolPlan).toMatchObject({
      state: 'decision-required',
      adapterEvaluations: [expect.objectContaining({ adapterId: 'node', status: 'partial' })],
    });
    expect(missingToolPlan.preconditions).toContainEqual(
      expect.objectContaining({ id: 'tool:api:npm', status: 'failed' })
    );
    expect(missingToolPlan.decision?.causes).toContainEqual(
      expect.objectContaining({
        kind: 'missing-executable',
        projectPath: 'api',
        executable: 'npm',
      })
    );
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const purposes: string[] = [];
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => {
          purposes.push(invocation.purpose);
          return { exitCode: 0, stdout: '{}', stderr: '' };
        }),
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(purposes).toEqual(['repair', 'reconcile', 'audit', 'test', 'build']);
    expect(completed.state).toBe('closed');
    expect(completed.stages.every((stage) => stage.status === 'passed')).toBe(true);
    expect(
      await readWorkspaceRepairTransaction({ workspacePath, transactionId: planned.transactionId })
    ).toMatchObject({ state: 'closed' });
  });

  it('materializes a missing dependency tree without requiring a source mutation', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'catalog-api',
      scripts: { test: 'vitest run', build: 'tsc --noEmit' },
      dependencies: { '@nestjs/core': '^11.0.0' },
    });
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), {
      lockfileVersion: 3,
    });
    const command = `cd "${projectPath}" && npm install`;
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        projects: [
          {
            name: 'api',
            path: projectPath,
            issues: ['Dependencies not installed (node_modules empty or missing)'],
            repairCapabilities: [
              {
                id: 'surface-dependency-contract.command',
                title: 'Install npm dependency baseline',
                status: 'available',
                risk: 'guarded',
                canAutoFix: true,
                canEditFiles: false,
                requiresApproval: true,
                requiresReview: true,
                files: [
                  path.join(projectPath, 'package.json'),
                  path.join(projectPath, 'package-lock.json'),
                ],
                command,
                verifyCommand: 'npx workspai doctor project --json',
                refreshCommands: [],
                reason: 'Generate the runtime-native dependency baseline.',
              },
              {
                id: 'test-coverage-evidence.command',
                title: 'Generate optional coverage evidence',
                status: 'available',
                risk: 'safe',
                canAutoFix: true,
                canEditFiles: false,
                requiresApproval: true,
                requiresReview: false,
                files: [],
                command: 'npx workspai project coverage --run --json',
                invocation: {
                  cwd: projectPath,
                  executable: 'npx',
                  args: ['workspai', 'project', 'coverage', '--run', '--json'],
                },
                verifyCommand: 'npx workspai doctor project --json',
                refreshCommands: [],
                reason: 'Optional coverage evidence is missing.',
              },
              {
                id: 'runtime-dependency-materialization.dependency-materialization',
                issueId: 'runtime-dependency-materialization',
                title: 'Install npm dependencies',
                status: 'available',
                fixKind: 'dependency-sync',
                risk: 'guarded',
                canAutoFix: true,
                canEditFiles: false,
                requiresApproval: true,
                requiresReview: false,
                files: [
                  path.join(projectPath, 'package.json'),
                  path.join(projectPath, 'package-lock.json'),
                ],
                command,
                invocation: { cwd: projectPath, executable: 'npm', args: ['install'] },
                transaction: {
                  schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
                  kind: 'dependency-materialization',
                  state: 'planned',
                  projectPath,
                  ecosystem: 'npm',
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
                verifyCommand: 'npx workspai doctor project --json',
                refreshCommands: [],
                reason: 'The installed dependency tree is missing.',
              },
            ],
          },
        ],
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair({
      workspacePath,
      cardId: 'doctor',
      projectName: 'api',
    });
    expect(planned.state).toBe('awaiting-approval');
    expect(planned.target.actionIds).toEqual([
      'doctor.api.runtime-dependency-materialization.dependency-materialization',
    ]);
    expect(planned.stages.map((stage) => stage.kind)).toEqual([
      'verify',
      'repair',
      'test',
      'build',
      'verify',
      'verify',
    ]);
    expect(planned.preconditions).not.toContainEqual(expect.objectContaining({ status: 'failed' }));

    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const purposes: string[] = [];
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => {
          purposes.push(invocation.purpose);
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(purposes).toEqual(['repair', 'test', 'build']);
    expect(completed.state).toBe('closed');
  });

  it('keeps Poetry validation inside the environment created by materialization', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeFile(
      path.join(projectPath, 'pyproject.toml'),
      '[build-system]\nrequires = ["poetry-core"]\nbuild-backend = "poetry.core.masonry.api"\n'
    );
    await fsExtra.ensureDir(path.join(projectPath, 'tests'));
    const command = `cd "${projectPath}" && poetry install --no-root`;
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        projects: [
          {
            name: 'api',
            path: projectPath,
            issues: ['Virtual environment not created'],
            repairCapabilities: [
              {
                id: 'surface-dependency-contract.command',
                title: 'Install Poetry dependency baseline',
                status: 'available',
                risk: 'guarded',
                canAutoFix: true,
                canEditFiles: false,
                files: [path.join(projectPath, 'pyproject.toml')],
                command,
                reason: 'Generate the Poetry dependency baseline.',
              },
              {
                id: 'runtime-dependency-materialization.dependency-materialization',
                title: 'Install Poetry dependencies',
                status: 'available',
                risk: 'guarded',
                canAutoFix: true,
                canEditFiles: false,
                files: [
                  path.join(projectPath, 'pyproject.toml'),
                  path.join(projectPath, 'poetry.lock'),
                ],
                command,
                invocation: {
                  cwd: projectPath,
                  executable: 'poetry',
                  args: ['install', '--no-root'],
                },
                transaction: {
                  schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
                  kind: 'dependency-materialization',
                  state: 'planned',
                  projectPath,
                  ecosystem: 'poetry',
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
                reason: 'The Poetry environment is missing.',
              },
            ],
          },
        ],
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair(
      { workspacePath, cardId: 'doctor', projectName: 'api' },
      { toolAvailable: vi.fn(async () => true) }
    );
    expect(planned.state).toBe('awaiting-approval');
    expect(planned.target.actionIds).toEqual([
      'doctor.api.runtime-dependency-materialization.dependency-materialization',
    ]);
    expect(
      planned.stages
        .filter((stage) => stage.invocation)
        .map((stage) => ({
          kind: stage.kind,
          executable: stage.invocation?.executable,
          args: stage.invocation?.args,
        }))
    ).toEqual([
      { kind: 'repair', executable: 'poetry', args: ['install', '--no-root'] },
      {
        kind: 'test',
        executable: 'poetry',
        args: ['run', 'python', '-m', 'pytest'],
      },
      { kind: 'build', executable: 'poetry', args: ['build'] },
    ]);
  });

  it('creates and closes a standard Python venv before isolated dependency validation', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeFile(path.join(projectPath, 'requirements.txt'), 'fastapi>=0.116\n');
    await fsExtra.ensureDir(path.join(projectPath, 'tests'));
    const pythonExecutable = process.platform === 'win32' ? 'py' : 'python3';
    const pythonArgs =
      process.platform === 'win32' ? ['-3', '-m', 'venv', '.venv'] : ['-m', 'venv', '.venv'];
    const venvPython = path.join(
      projectPath,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
    const command = `cd "${projectPath}" && ${pythonExecutable} ${pythonArgs.join(' ')}`;
    await fsExtra.writeJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      {
        projects: [
          {
            name: 'api',
            path: projectPath,
            issues: ['Virtual environment not created'],
            repairCapabilities: [
              {
                id: 'runtime-dependency-materialization.dependency-materialization',
                issueId: 'runtime-dependency-materialization',
                title: 'Create the isolated Python environment',
                status: 'available',
                fixKind: 'dependency-sync',
                risk: 'guarded',
                canAutoFix: true,
                canEditFiles: false,
                requiresApproval: true,
                requiresReview: false,
                files: [
                  path.join(projectPath, 'requirements.txt'),
                  path.join(projectPath, 'pyproject.toml'),
                ],
                command,
                invocation: {
                  cwd: projectPath,
                  executable: pythonExecutable,
                  args: pythonArgs,
                },
                transaction: {
                  schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
                  kind: 'dependency-materialization',
                  state: 'planned',
                  projectPath,
                  ecosystem: 'python',
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
                reason: 'The project-local Python environment is missing.',
              },
            ],
          },
        ],
      },
      { spaces: 2 }
    );

    const planned = await planWorkspaceRepair(
      { workspacePath, cardId: 'doctor', projectName: 'api' },
      {
        toolAvailable: vi.fn(async (executable) => executable === pythonExecutable),
      }
    );
    expect(planned.state).toBe('awaiting-approval');
    expect(planned.preconditions).toContainEqual(
      expect.objectContaining({
        id: expect.stringContaining(venvPython),
        status: 'passed',
        message: expect.stringContaining('will create the isolated executable'),
      })
    );
    expect(
      planned.stages
        .filter((stage) => stage.invocation)
        .map((stage) => ({ kind: stage.kind, invocation: stage.invocation }))
    ).toEqual([
      {
        kind: 'repair',
        invocation: expect.objectContaining({ executable: pythonExecutable, args: pythonArgs }),
      },
      {
        kind: 'reconcile',
        invocation: expect.objectContaining({
          executable: venvPython,
          args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
        }),
      },
      {
        kind: 'test',
        invocation: expect.objectContaining({
          executable: venvPython,
          args: ['-m', 'pytest'],
        }),
      },
    ]);

    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const purposes: string[] = [];
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => {
          purposes.push(invocation.purpose);
          if (invocation.purpose === 'repair') {
            await fsExtra.outputFile(venvPython, 'python');
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );
    expect(purposes).toEqual(['repair', 'reconcile', 'test']);
    expect(completed.state).toBe('closed');
  });

  it('compiles a model proposal into the same approval, checkpoint, validation, and verify boundary', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'src', 'service.ts');
    await fsExtra.outputFile(sourcePath, 'export const ready = false;\n');
    const proposal = {
      schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
      cardId: 'doctor',
      blockerSignature: 'doctor:api:surface-environment-config:missing',
      targetActionIds: ['doctor.api.surface-environment-config.file-create'],
      projectName: 'api',
      projectPath: 'api',
      rationale: 'Restore the missing environment readiness behavior.',
      changes: [
        {
          id: 'enable-readiness',
          path: 'api/src/service.ts',
          operation: 'write' as const,
          expectedBeforeHash: sha256('export const ready = false;\n'),
          content: 'export const ready = true;\n',
          risk: 'guarded' as const,
          summary: 'Enable the verified readiness path.',
        },
      ],
      validation: [
        {
          id: 'source-check',
          kind: 'test' as const,
          cwd: 'api',
          executable: 'pytest',
          args: [],
          required: true,
          risk: 'safe' as const,
          summary: 'Run the focused source contract.',
        },
      ],
    };
    expect(() =>
      assertJsonSchemaContract(
        proposal,
        WORKSPACE_REPAIR_PROPOSAL_CONTRACT_PATH,
        'workspace repair proposal'
      )
    ).not.toThrow();

    const planned = await planWorkspaceRepairProposal(
      { workspacePath, proposal },
      { toolAvailable: async () => true }
    );
    expect(planned).toMatchObject({
      state: 'awaiting-approval',
      target: {
        projectName: 'api',
        projectPath: 'api',
        blockerSignature: 'doctor:api:surface-environment-config:missing',
        actionIds: ['doctor.api.surface-environment-config.file-create'],
      },
      checkpoint: { files: [{ path: 'api/src/service.ts' }] },
    });
    expect(planned.stages.map((stage) => stage.kind)).toEqual([
      'verify',
      'repair',
      'test',
      'verify',
      'verify',
    ]);
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const runTargetProducer = vi.fn(async () => ({
      exitCode: 2,
      stdout: '{"status":"blocked"}',
      stderr: '',
    }));
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
        runTargetProducer,
        toolAvailable: async () => true,
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(completed.state).toBe('closed');
    expect(runTargetProducer).toHaveBeenCalledTimes(2);
    expect(completed.stages.find((stage) => stage.id === 'target-precondition')).toMatchObject({
      status: 'passed',
      exitCode: 2,
    });
    expect(completed.stages.find((stage) => stage.id === 'target-producer-verify')).toMatchObject({
      status: 'passed',
      exitCode: 2,
    });
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('export const ready = true;\n');
  });

  it('accepts an exit-1 target producer only when canonical evidence was refreshed', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'src', 'doctor-service.ts');
    await fsExtra.outputFile(sourcePath, 'export const ready = false;\n');
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          blockerSignature: 'doctor:api:runtime-dependency-materialization:missing',
          targetActionIds: ['doctor.api.surface-environment-config.file-create'],
          projectName: 'api',
          projectPath: 'api',
          rationale: 'Repair a Doctor finding whose successful producer uses exit one.',
          changes: [
            {
              id: 'doctor-exit-one',
              path: 'api/src/doctor-service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('export const ready = false;\n'),
              content: 'export const ready = true;\n',
              risk: 'guarded',
              summary: 'Repair the source prerequisite.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
        runTargetProducer: vi.fn(async () => ({
          exitCode: 1,
          stdout: '{"healthScore":{"verdict":"blocked"}}',
          stderr: '',
          evidenceProduced: true,
        })),
        toolAvailable: async () => true,
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
      }
    );

    expect(completed.state).toBe('closed');
    expect(completed.stages.find((stage) => stage.id === 'target-precondition')).toMatchObject({
      status: 'passed',
      exitCode: 1,
    });
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('export const ready = true;\n');
  });

  it('bounds an exit-1 producer failure when no canonical evidence was refreshed', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'producer-failure.txt');
    await fsExtra.writeFile(sourcePath, 'blocked\n');
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        blockerSignature: 'doctor:api:producer-failure',
        targetActionIds: ['doctor.api.surface-environment-config.file-create'],
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Prove an execution error cannot masquerade as blocked evidence.',
        changes: [
          {
            id: 'producer-failure',
            path: 'api/producer-failure.txt',
            operation: 'write',
            expectedBeforeHash: sha256('blocked\n'),
            content: 'must-not-run\n',
            risk: 'guarded',
            summary: 'This mutation must not run.',
          },
        ],
      },
    });
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runTargetProducer: vi.fn(async () => ({
          exitCode: 1,
          stdout: `{"payload":"${'x'.repeat(20_000)}"}`,
          stderr: '',
          evidenceProduced: false,
        })),
      }
    );

    expect(completed.state).toBe('decision-required');
    expect(completed.decision?.reason).toContain('Exact card producer failed with exit 1');
    expect(completed.decision?.reason.length).toBeLessThan(1_000);
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('blocked\n');
  });

  it('routes every published Studio card through exact producer and canonical closure stages', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    for (const [index, capability] of STUDIO_CARD_REPAIR_CAPABILITIES.entries()) {
      const relativePath = `api/card-${index}.txt`;
      const absolutePath = path.join(projectPath, `card-${index}.txt`);
      await fsExtra.writeFile(absolutePath, 'blocked\n');
      const planned = await planWorkspaceRepairProposal({
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: capability.cardId,
          blockerSignature: `${capability.cardId}:fixture-generation`,
          ...(capability.scope === 'project' ? { projectName: 'api', projectPath: 'api' } : {}),
          rationale: `Exercise the ${capability.cardId} repair control plane.`,
          changes: [
            {
              id: `card-${index}`,
              path: relativePath,
              operation: 'write',
              expectedBeforeHash: sha256('blocked\n'),
              content: 'repaired\n',
              risk: 'guarded',
              summary: `Repair ${capability.cardId}.`,
            },
          ],
        },
      });
      expect(planned.state, `${capability.cardId}: ${planned.decision?.reason ?? ''}`).toBe(
        'awaiting-approval'
      );
      expect(planned.stages.slice(-2).map((stage) => stage.id)).toEqual([
        'target-producer-verify',
        'canonical-verify',
      ]);
      await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
      const runTargetProducer = vi.fn(async () => ({
        exitCode: 2,
        stdout: '{"status":"blocked"}',
        stderr: '',
      }));
      const completed = await executeWorkspaceRepair(
        { workspacePath, transactionId: planned.transactionId },
        {
          runTargetProducer,
          verify: vi.fn(async () => ({
            status: 'passed',
            exitCode: 0,
            artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
          })),
        }
      );
      expect(completed.state, capability.cardId).toBe('closed');
      expect(runTargetProducer, capability.cardId).toHaveBeenCalledTimes(2);
      expect(await fsExtra.readFile(absolutePath, 'utf8')).toBe('repaired\n');
    }
  });

  it('expires approval before checkpoint when the selected causal action drifted', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'stale-target.txt');
    await fsExtra.writeFile(sourcePath, 'blocked\n');
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        blockerSignature: 'doctor:api:stale-generation',
        targetActionIds: ['doctor.api.removed-causal-action'],
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Prove a stale approved blocker cannot mutate source.',
        changes: [
          {
            id: 'stale-target',
            path: 'api/stale-target.txt',
            operation: 'write',
            expectedBeforeHash: sha256('blocked\n'),
            content: 'must-not-run\n',
            risk: 'guarded',
            summary: 'This mutation must be rejected before checkpoint.',
          },
        ],
      },
    });
    expect(planned.state).toBe('awaiting-approval');
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runTargetProducer: vi.fn(async () => ({
          exitCode: 2,
          stdout: '{"status":"blocked"}',
          stderr: '',
        })),
      }
    );

    expect(completed).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
      checkpoint: { status: 'pending' },
      decision: { options: ['cancel'] },
    });
    expect(completed.decision?.reason).toContain('Target precondition failed before checkpoint');
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('blocked\n');
  });

  it('expires approval when a causal action keeps its id but changes meaning', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await writeFileRepairEvidence({ workspacePath, projectPath });
    const sourcePath = path.join(projectPath, 'semantic-target.txt');
    await fsExtra.writeFile(sourcePath, 'blocked\n');
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        blockerSignature: 'doctor:api:semantic-generation',
        targetActionIds: ['doctor.api.surface-environment-config.file-create'],
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Bind approval to the complete causal action semantics.',
        changes: [
          {
            id: 'semantic-target',
            path: 'api/semantic-target.txt',
            operation: 'write',
            expectedBeforeHash: sha256('blocked\n'),
            content: 'must-not-run\n',
            risk: 'guarded',
            summary: 'This mutation must be rejected when evidence meaning drifts.',
          },
        ],
      },
    });
    expect(planned.state).toBe('awaiting-approval');
    expect(planned.preconditions).toContainEqual(
      expect.objectContaining({ id: expect.stringContaining('causal-action-integrity:') })
    );
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });

    const doctorPath = path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json');
    const doctor = await fsExtra.readJson(doctorPath);
    doctor.projects[0].probes[0].repairCapability.reason =
      'The same capability id now represents a different blocker generation.';
    await fsExtra.writeJson(doctorPath, doctor, { spaces: 2 });

    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runTargetProducer: vi.fn(async () => ({
          exitCode: 2,
          stdout: '{"status":"blocked"}',
          stderr: '',
        })),
      }
    );

    expect(completed).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
      checkpoint: { status: 'pending' },
    });
    expect(completed.decision?.reason).toContain(
      'The selected action semantics changed after approval.'
    );
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('blocked\n');
  });

  it('expires approval before checkpoint or mutation when the approved toolchain disappears', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'service.ts');
    await fsExtra.writeFile(sourcePath, 'before\n');
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectPath: 'api',
          rationale: 'Exercise execute-time toolchain preflight.',
          changes: [
            {
              id: 'source-change',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('before\n'),
              content: 'after\n',
              risk: 'guarded',
              summary: 'Apply the bounded source change.',
            },
          ],
          validation: [
            {
              id: 'focused-test',
              kind: 'test',
              cwd: 'api',
              executable: 'pytest',
              args: [],
              required: true,
              risk: 'safe',
              summary: 'Run the focused test contract.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    expect(planned.state).toBe('awaiting-approval');
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const runInvocation = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));

    const stopped = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      { runInvocation, toolAvailable: async () => false }
    );

    expect(stopped).toMatchObject({
      state: 'decision-required',
      approval: { status: 'expired' },
      checkpoint: { status: 'pending' },
    });
    expect(stopped.decision?.reason).toContain('changed toolchain');
    expect(stopped.events.at(-1)).toMatchObject({ status: 'tool-precondition-failed' });
    expect(runInvocation).not.toHaveBeenCalled();
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('before\n');
  });

  it('rejects an executable with a broken interpreter before approval', async () => {
    if (process.platform === 'win32') return;
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'service.ts');
    const brokenToolPath = path.join(projectPath, 'python');
    await fsExtra.writeFile(sourcePath, 'before\n');
    await fsExtra.writeFile(brokenToolPath, '#!/workspai/missing/interpreter\n');
    await fsExtra.chmod(brokenToolPath, 0o755);

    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectPath: 'api',
        rationale: 'Prove that an executable can actually launch before mutation.',
        changes: [
          {
            id: 'source-change',
            path: 'api/service.ts',
            operation: 'write',
            expectedBeforeHash: sha256('before\n'),
            content: 'after\n',
            risk: 'guarded',
            summary: 'Apply the bounded source change.',
          },
        ],
        validation: [
          {
            id: 'broken-tool-check',
            kind: 'test',
            cwd: 'api',
            executable: './python',
            args: ['-m', 'pytest'],
            required: true,
            risk: 'safe',
            summary: 'Run the local validation tool.',
          },
        ],
      },
    });

    expect(planned).toMatchObject({
      state: 'decision-required',
      checkpoint: { status: 'pending' },
    });
    expect(planned.preconditions).toContainEqual(
      expect.objectContaining({ id: 'tool:api:./python', status: 'failed' })
    );
    expect(planned.decision?.causes).toContainEqual(
      expect.objectContaining({ kind: 'missing-executable', executable: './python' })
    );
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('before\n');

    const repeated = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectPath: 'api',
        rationale: 'Prove that an unchanged toolchain boundary is idempotent.',
        changes: [
          {
            id: 'source-change',
            path: 'api/service.ts',
            operation: 'write',
            expectedBeforeHash: sha256('before\n'),
            content: 'after\n',
            risk: 'guarded',
            summary: 'Apply the bounded source change.',
          },
        ],
        validation: [
          {
            id: 'broken-tool-check',
            kind: 'test',
            cwd: 'api',
            executable: './python',
            args: ['-m', 'pytest'],
            required: true,
            risk: 'safe',
            summary: 'Run the local validation tool.',
          },
        ],
      },
    });

    expect(repeated.transactionId).toBe(planned.transactionId);
  });

  it('continues past a broken PATH shadow to a launchable executable', async () => {
    if (process.platform === 'win32') return;
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'service.ts');
    const brokenBin = path.join(workspacePath, 'broken-bin');
    const healthyBin = path.join(workspacePath, 'healthy-bin');
    await fsExtra.writeFile(sourcePath, 'before\n');
    await fsExtra.ensureDir(brokenBin);
    await fsExtra.ensureDir(healthyBin);
    await fsExtra.writeFile(path.join(brokenBin, 'pytest'), '#!/workspai/missing/interpreter\n');
    await fsExtra.writeFile(path.join(healthyBin, 'pytest'), '#!/bin/sh\nexit 0\n');
    await fsExtra.chmod(path.join(brokenBin, 'pytest'), 0o755);
    await fsExtra.chmod(path.join(healthyBin, 'pytest'), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = [brokenBin, healthyBin, originalPath].filter(Boolean).join(path.delimiter);

    try {
      const planned = await planWorkspaceRepairProposal({
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectPath: 'api',
          rationale: 'Use the first launchable executable in PATH.',
          changes: [
            {
              id: 'source-change',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('before\n'),
              content: 'after\n',
              risk: 'guarded',
              summary: 'Apply the bounded source change.',
            },
          ],
          validation: [
            {
              id: 'path-shadow-check',
              kind: 'test',
              cwd: 'api',
              executable: 'pytest',
              args: [],
              required: true,
              risk: 'safe',
              summary: 'Run the first launchable PATH candidate.',
            },
          ],
        },
      });

      expect(planned.preconditions).toContainEqual(
        expect.objectContaining({ id: 'tool:api:pytest', status: 'passed' })
      );
      expect(planned.state).toBe('awaiting-approval');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('classifies a no-op model proposal as automatic replanning rather than a user decision', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const content = 'export const ready = true;\n';
    await fsExtra.writeFile(path.join(projectPath, 'service.ts'), content);
    await fsExtra.writeJson(path.join(projectPath, 'package.json'), {
      name: 'api',
      private: true,
      scripts: { test: 'node --test', build: 'node --check service.ts' },
    });

    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'readiness',
          projectPath: 'api',
          blockerSignature: 'readiness:analyze:blocked',
          rationale: 'A model accidentally returned the inspected file unchanged.',
          changes: [
            {
              id: 'unchanged-source',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256(content),
              content,
              risk: 'guarded',
              summary: 'Update the inspected source.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );

    expect(planned).toMatchObject({
      state: 'decision-required',
      decision: {
        options: ['replan', 'cancel'],
        causes: [expect.objectContaining({ kind: 'failed-precondition' })],
      },
    });
    expect(planned.decision?.reason).toContain('no-op');
  });

  it('rejects stale or protected model changes before approval', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeFile(path.join(projectPath, 'service.ts'), 'current\n');
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          rationale: 'Attempt stale and evidence edits.',
          changes: [
            {
              id: 'stale-source',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('older\n'),
              content: 'new\n',
              risk: 'guarded',
              summary: 'Edit stale source.',
            },
            {
              id: 'forge-report',
              path: '.workspai/reports/workspace-verify-last-run.json',
              operation: 'write',
              expectedBeforeHash: null,
              content: '{}\n',
              risk: 'safe',
              summary: 'Forge evidence.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );

    expect(planned.state).toBe('decision-required');
    expect(planned.decision?.reason).toContain('expected source hash');
    expect(planned.decision?.reason).toContain('Canonical workspace state and evidence');
    expect(
      planned.decision?.reason.match(/Canonical workspace state and evidence/g) ?? []
    ).toHaveLength(1);
    expect(planned.decision?.causes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'failed-precondition' })])
    );
    expect(planned.approval.status).toBe('pending');
  });

  it('rolls back a model write when required validation fails', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'service.ts');
    await fsExtra.writeFile(sourcePath, 'before\n');
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectPath: 'api',
          rationale: 'Apply a repair with focused verification.',
          changes: [
            {
              id: 'source-change',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('before\n'),
              content: 'after\n',
              risk: 'guarded',
              summary: 'Apply source repair.',
            },
          ],
          validation: [
            {
              id: 'focused-test',
              kind: 'test',
              cwd: 'api',
              executable: 'pytest',
              args: [],
              required: true,
              risk: 'safe',
              summary: 'Run focused validation.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'failed' })),
        toolAvailable: async () => true,
      }
    );

    expect(completed.state).toBe('rolled-back');
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('before\n');
  });

  it('creates a missing nested source file from a hash-null proposal', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectPath: 'api',
          rationale: 'Create the missing CI workflow.',
          changes: [
            {
              id: 'create-ci',
              path: 'api/.github/workflows/ci.yml',
              operation: 'write',
              expectedBeforeHash: null,
              content: 'name: CI\non: [push]\njobs: {}\n',
              risk: 'guarded',
              summary: 'Create CI workflow.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    expect(planned.state, planned.decision?.reason).toBe('awaiting-approval');
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        verify: vi.fn(async () => ({
          status: 'blocked',
          exitCode: 2,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
        targetVerify: vi.fn(async () => ({ status: 'passed', remainingActionIds: [] })),
        toolAvailable: async () => true,
      }
    );

    expect(completed.state, completed.decision?.reason).toBe('closed');
    expect(
      await fsExtra.readFile(path.join(projectPath, '.github/workflows/ci.yml'), 'utf8')
    ).toContain('name: CI');
  });

  it('refuses rollback before changing any file when a checkpoint backup was tampered with', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const sourcePath = path.join(projectPath, 'service.ts');
    await fsExtra.writeFile(sourcePath, 'before\n');
    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectPath: 'api',
          rationale: 'Apply a repair with focused verification.',
          changes: [
            {
              id: 'source-change',
              path: 'api/service.ts',
              operation: 'write',
              expectedBeforeHash: sha256('before\n'),
              content: 'after\n',
              risk: 'guarded',
              summary: 'Apply source repair.',
            },
          ],
          validation: [
            {
              id: 'focused-test',
              kind: 'test',
              cwd: 'api',
              executable: 'pytest',
              args: [],
              required: true,
              risk: 'safe',
              summary: 'Run focused validation.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    expect(planned.state, planned.decision?.reason).toBe('awaiting-approval');
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async () => {
          const live = await readWorkspaceRepairTransaction({
            workspacePath,
            transactionId: planned.transactionId,
          });
          const backupRef = live.checkpoint.files[0].backupRef!;
          await fsExtra.writeFile(
            path.join(
              workspacePath,
              '.workspai',
              'repair',
              'transactions',
              planned.transactionId,
              backupRef
            ),
            'tampered\n'
          );
          return { exitCode: 1, stdout: '', stderr: 'failed' };
        }),
        toolAvailable: async () => true,
      }
    );

    expect(completed).toMatchObject({
      state: 'decision-required',
      checkpoint: { status: 'conflicted' },
    });
    expect(completed.decision?.reason).toContain('backup hash is invalid');
    expect(await fsExtra.readFile(sourcePath, 'utf8')).toBe('after\n');
  });

  it('adds the full dependency closure when a proposal changes a manifest', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const before =
      JSON.stringify(
        {
          name: 'api',
          scripts: { test: 'vitest run', build: 'tsc --noEmit' },
          dependencies: { example: '1.0.0' },
        },
        null,
        2
      ) + '\n';
    const after = before.replace('1.0.0', '1.0.1');
    await fsExtra.writeFile(path.join(projectPath, 'package.json'), before);
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Move to the compatible patched dependency.',
        changes: [
          {
            id: 'dependency-upgrade',
            path: 'api/package.json',
            operation: 'write',
            expectedBeforeHash: sha256(before),
            content: after,
            risk: 'guarded',
            summary: 'Upgrade the compatible dependency.',
          },
        ],
      },
    });

    expect(planned.state).toBe('awaiting-approval');
    expect(planned.stages.map((stage) => stage.kind)).toEqual([
      'verify',
      'repair',
      'reconcile',
      'audit',
      'test',
      'build',
      'verify',
      'verify',
    ]);
    expect(planned.checkpoint.files.map((file) => file.path)).toEqual([
      'api/package-lock.json',
      'api/package.json',
    ]);
  });

  it('rejects JSON manifest proposals that are not parseable before mutation', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const before =
      JSON.stringify(
        {
          name: 'api',
          scripts: { test: 'vitest run', build: 'tsc --noEmit' },
        },
        null,
        2
      ) + '\n';
    await fsExtra.writeFile(path.join(projectPath, 'package.json'), before);
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Add a JavaScript comment that npm cannot parse.',
        changes: [
          {
            id: 'invalid-json-comment',
            path: 'api/package.json',
            operation: 'write',
            expectedBeforeHash: sha256(before),
            content: `${before.trim().slice(0, -1)}\n  // invalid comment\n}\n`,
            risk: 'guarded',
            summary: 'Inject a JavaScript comment into package.json.',
          },
        ],
      },
    });

    expect(planned.state).toBe('decision-required');
    expect(planned.decision?.reason).toMatch(/must contain valid JSON/i);
    expect(await fsExtra.readFile(path.join(projectPath, 'package.json'), 'utf8')).toBe(before);
  });

  it('plans collision-free closure stages for every runtime in one polyglot project', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const packageBefore = `${JSON.stringify(
      {
        name: 'polyglot-api',
        scripts: { test: 'vitest run', build: 'tsc --noEmit' },
        dependencies: { example: '1.0.0' },
      },
      null,
      2
    )}\n`;
    const goBefore = 'module example.test/polyglot-api\n\ngo 1.26\n';
    await fsExtra.writeFile(path.join(projectPath, 'package.json'), packageBefore);
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    await fsExtra.writeFile(path.join(projectPath, 'go.mod'), goBefore);
    await fsExtra.writeFile(path.join(projectPath, 'go.sum'), '');

    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'doctor',
          projectName: 'api',
          projectPath: 'api',
          rationale: 'Apply one bounded cross-runtime dependency transaction.',
          changes: [
            {
              id: 'node-dependency-upgrade',
              path: 'api/package.json',
              operation: 'write',
              expectedBeforeHash: sha256(packageBefore),
              content: packageBefore.replace('1.0.0', '1.0.1'),
              risk: 'guarded',
              summary: 'Upgrade the Node dependency.',
            },
            {
              id: 'go-baseline-update',
              path: 'api/go.mod',
              operation: 'write',
              expectedBeforeHash: sha256(goBefore),
              content: `${goBefore}\nrequire example.test/dependency v1.0.1\n`,
              risk: 'guarded',
              summary: 'Update the Go dependency baseline.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );

    expect(planned.state, planned.decision?.reason).toBe('awaiting-approval');
    expect(planned.adapterEvaluations).toEqual([
      expect.objectContaining({ adapterId: 'node', projectPath: 'api', status: 'ready' }),
      expect.objectContaining({ adapterId: 'go', projectPath: 'api', status: 'ready' }),
    ]);
    expect(planned.stages.map((stage) => stage.id)).toEqual(
      expect.arrayContaining([
        'api:node:reconcile',
        'api:node:audit',
        'api:node:test',
        'api:node:build',
        'api:go:reconcile',
        'api:go:audit',
        'api:go:test',
        'api:go:build',
      ])
    );
    expect(new Set(planned.stages.map((stage) => stage.id)).size).toBe(planned.stages.length);
    expect(planned.checkpoint.files.map((file) => file.path)).toEqual([
      'api/go.mod',
      'api/go.sum',
      'api/package-lock.json',
      'api/package.json',
    ]);
  });

  it('reconciles the installed dependency tree after restoring dependency files', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const manifestPath = path.join(projectPath, 'package.json');
    const before = `${JSON.stringify(
      {
        name: 'api',
        scripts: { test: 'vitest run', build: 'tsc --noEmit' },
        dependencies: { example: '1.0.0' },
      },
      null,
      2
    )}\n`;
    const after = before.replace('1.0.0', '1.0.1');
    await fsExtra.writeFile(manifestPath, before);
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectName: 'api',
        projectPath: 'api',
        rationale: 'Move to a compatible dependency patch.',
        changes: [
          {
            id: 'dependency-upgrade',
            path: 'api/package.json',
            operation: 'write',
            expectedBeforeHash: sha256(before),
            content: after,
            risk: 'guarded',
            summary: 'Upgrade the dependency.',
          },
        ],
      },
    });
    expect(planned.state, planned.decision?.reason).toBe('awaiting-approval');
    const approvedDependencyRepair = await approveWorkspaceRepair({
      workspacePath,
      transactionId: planned.transactionId,
    });
    expect(approvedDependencyRepair.state, approvedDependencyRepair.decision?.reason).toBe(
      'approved'
    );
    const purposes: string[] = [];
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => {
          purposes.push(invocation.purpose);
          if (invocation.purpose === 'audit') {
            return { exitCode: 1, stdout: '', stderr: 'advisory remains' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
      }
    );

    expect(completed.state).toBe('rolled-back');
    expect(await fsExtra.readFile(manifestPath, 'utf8')).toBe(before);
    expect(purposes).toEqual(['reconcile', 'audit', 'reconcile']);
    expect(completed.stages).toContainEqual(
      expect.objectContaining({
        id: 'rollback:api:reconcile',
        kind: 'rollback',
        status: 'passed',
      })
    );
  });

  it('resumes an interrupted rollback without duplicating its reconciliation receipt', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    const manifestPath = path.join(projectPath, 'package.json');
    const before = `${JSON.stringify(
      {
        name: 'api',
        scripts: { test: 'vitest run', build: 'tsc --noEmit' },
        dependencies: { example: '1.0.0' },
      },
      null,
      2
    )}\n`;
    await fsExtra.writeFile(manifestPath, before);
    await fsExtra.writeJson(path.join(projectPath, 'package-lock.json'), { lockfileVersion: 3 });
    const planned = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectPath: 'api',
        rationale: 'Exercise resumable rollback.',
        changes: [
          {
            id: 'dependency-upgrade',
            path: 'api/package.json',
            operation: 'write',
            expectedBeforeHash: sha256(before),
            content: before.replace('1.0.0', '1.0.1'),
            risk: 'guarded',
            summary: 'Upgrade the dependency.',
          },
        ],
      },
    });
    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const rolledBack = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => ({
          exitCode: invocation.purpose === 'audit' ? 1 : 0,
          stdout: '',
          stderr: invocation.purpose === 'audit' ? 'advisory remains' : '',
        })),
      }
    );
    expect(rolledBack.state).toBe('rolled-back');

    const persistedPath = path.join(
      workspacePath,
      '.workspai',
      'repair',
      'transactions',
      planned.transactionId,
      'transaction.json'
    );
    const interrupted = await fsExtra.readJson(persistedPath);
    interrupted.state = 'rolling-back';
    interrupted.stages.find(
      (stage: { id: string }) => stage.id === 'rollback:api:reconcile'
    ).status = 'running';
    await fsExtra.writeJson(persistedPath, interrupted, { spaces: 2 });

    const resumeInvocations: string[] = [];
    const resumed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async ({ invocation }) => {
          resumeInvocations.push(invocation.purpose);
          return { exitCode: 0, stdout: '', stderr: '' };
        }),
      }
    );
    expect(resumed.state).toBe('rolled-back');
    expect(resumeInvocations).toEqual(['reconcile']);
    expect(resumed.stages.filter((stage) => stage.id === 'rollback:api:reconcile')).toHaveLength(1);
    expect(await fsExtra.readFile(manifestPath, 'utf8')).toBe(before);
  });

  it('turns an explicit risk decision into a fresh immutable plan instead of mutating approval', async () => {
    const { workspacePath, projectPath } = await workspaceFixture();
    await fsExtra.writeFile(path.join(projectPath, 'service.ts'), 'before\n');
    const blocked = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'doctor',
        projectPath: 'api',
        rationale: 'Apply an invasive source migration.',
        changes: [
          {
            id: 'migration',
            path: 'api/service.ts',
            operation: 'write',
            expectedBeforeHash: sha256('before\n'),
            content: 'after\n',
            risk: 'invasive',
            summary: 'Apply the migration.',
          },
        ],
      },
    });
    expect(blocked).toMatchObject({
      state: 'decision-required',
      policy: { maxRisk: 'guarded' },
    });
    expect(blocked.decision?.options).toContain('approve-invasive');
    expect(blocked.decision?.causes).toContainEqual(
      expect.objectContaining({ kind: 'risk-approval', id: 'risk:migration' })
    );

    const replanned = await decideWorkspaceRepair({
      workspacePath,
      transactionId: blocked.transactionId,
      decision: 'approve-invasive',
    });

    expect(replanned).toMatchObject({
      state: 'awaiting-approval',
      policy: { maxRisk: 'invasive' },
      approval: { status: 'pending' },
    });
    expect(replanned.transactionId).not.toBe(blocked.transactionId);
    expect(
      await readWorkspaceRepairTransaction({ workspacePath, transactionId: blocked.transactionId })
    ).toMatchObject({ state: 'cancelled' });
  });

  it('repairs a hash-pinned source file inside one canonically registered external project', async () => {
    const { workspacePath } = await workspaceFixture();
    const externalProject = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'workspai-repair-external-source-')
    );
    roots.push(externalProject);
    await fsExtra.writeJson(path.join(externalProject, 'package.json'), {
      name: 'external-api',
      scripts: { test: 'node --test', build: 'node --check src.js' },
    });
    await fsExtra.writeFile(path.join(externalProject, 'src.js'), 'export const ready = false;\n');
    await fsExtra.writeJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      projects: [
        {
          slug: 'external-api',
          relativePath: 'external/external-api',
          externalPath: externalProject,
          source: 'adopted-local',
          relationship: 'adopted',
        },
      ],
    });
    const projectPath = path.relative(workspacePath, externalProject).replace(/\\/g, '/');
    const sourcePath = `${projectPath}/src.js`;

    const planned = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'workspaceRun',
          projectName: 'external-api',
          rationale: 'Repair the one failed linked project without widening filesystem scope.',
          changes: [
            {
              id: 'external-source',
              path: sourcePath,
              operation: 'write',
              expectedBeforeHash: sha256('export const ready = false;\n'),
              content: 'export const ready = true;\n',
              risk: 'guarded',
              summary: 'Fix linked project source.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );

    expect(planned.state, planned.decision?.reason).toBe('awaiting-approval');
    expect(planned.target).toMatchObject({
      scope: 'project',
      projectName: 'external-api',
      projectPath,
    });
    expect(planned.checkpoint.files.map((entry) => entry.path)).toContain(sourcePath);

    await approveWorkspaceRepair({ workspacePath, transactionId: planned.transactionId });
    const completed = await executeWorkspaceRepair(
      { workspacePath, transactionId: planned.transactionId },
      {
        runInvocation: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
        runTargetProducer: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: '' })),
        verify: vi.fn(async () => ({
          status: 'passed',
          exitCode: 0,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
        toolAvailable: async () => true,
      }
    );

    expect(completed.state).toBe('closed');
    expect(await fsExtra.readFile(path.join(externalProject, 'src.js'), 'utf8')).toBe(
      'export const ready = true;\n'
    );

    const rollbackPlan = await planWorkspaceRepairProposal(
      {
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'workspaceRun',
          projectName: 'external-api',
          rationale: 'Prove linked source rollback retains the same canonical boundary.',
          changes: [
            {
              id: 'external-source-rollback',
              path: sourcePath,
              operation: 'write',
              expectedBeforeHash: sha256('export const ready = true;\n'),
              content: 'export const ready = false;\n',
              risk: 'guarded',
              summary: 'Exercise verified rollback for linked source.',
            },
          ],
        },
      },
      { toolAvailable: async () => true }
    );
    expect(rollbackPlan.state, rollbackPlan.decision?.reason).toBe('awaiting-approval');
    await approveWorkspaceRepair({ workspacePath, transactionId: rollbackPlan.transactionId });
    const rolledBack = await executeWorkspaceRepair(
      { workspacePath, transactionId: rollbackPlan.transactionId },
      {
        runInvocation: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
        runTargetProducer: vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: '' })),
        verify: vi.fn(async () => ({
          status: 'blocked',
          exitCode: 2,
          artifactPath: '.workspai/reports/workspace-intelligence-run-last-run.json',
        })),
        toolAvailable: async () => true,
      }
    );
    expect(rolledBack.state).toBe('rolled-back');
    expect(await fsExtra.readFile(path.join(externalProject, 'src.js'), 'utf8')).toBe(
      'export const ready = true;\n'
    );

    const siblingProject = path.join(path.dirname(externalProject), 'unregistered-sibling');
    await fsExtra.ensureDir(siblingProject);
    await fsExtra.writeFile(path.join(siblingProject, 'src.js'), 'do not touch\n');
    roots.push(siblingProject);
    await expect(
      planWorkspaceRepairProposal({
        workspacePath,
        proposal: {
          schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
          cardId: 'workspaceRun',
          projectName: 'external-api',
          projectPath,
          rationale: 'Attempt to widen the linked project boundary.',
          changes: [
            {
              id: 'sibling-escape',
              path: path
                .relative(workspacePath, path.join(siblingProject, 'src.js'))
                .replace(/\\/g, '/'),
              operation: 'write',
              expectedBeforeHash: sha256('do not touch\n'),
              content: 'unsafe\n',
              risk: 'guarded',
              summary: 'Must fail closed.',
            },
          ],
        },
      })
    ).rejects.toThrow('escapes workspace boundary');
    expect(await fsExtra.readFile(path.join(siblingProject, 'src.js'), 'utf8')).toBe(
      'do not touch\n'
    );

    const linkedSibling = path.join(externalProject, 'linked-sibling');
    await fsExtra.symlink(
      siblingProject,
      linkedSibling,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const linkedEscape = await planWorkspaceRepairProposal({
      workspacePath,
      proposal: {
        schemaVersion: WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION,
        cardId: 'workspaceRun',
        projectName: 'external-api',
        projectPath,
        rationale: 'Attempt to cross the linked project through a symbolic directory.',
        changes: [
          {
            id: 'linked-sibling-escape',
            path: `${projectPath}/linked-sibling/src.js`,
            operation: 'write',
            expectedBeforeHash: sha256('do not touch\n'),
            content: 'unsafe through link\n',
            risk: 'guarded',
            summary: 'Must fail before approval.',
          },
        ],
      },
    });
    expect(linkedEscape.state).toBe('decision-required');
    expect(linkedEscape.decision?.reason).toContain(
      'resolves through a link outside its authorized boundary'
    );
    expect(await fsExtra.readFile(path.join(siblingProject, 'src.js'), 'utf8')).toBe(
      'do not touch\n'
    );
  });
});
