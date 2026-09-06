import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createBuiltinAgentFrameworkRegistry,
  digestBuiltinAgentFrameworkManifest,
  microsoftAgentFrameworkPythonAdapter,
} from '../agent-frameworks/index.js';
import {
  applyAgentFrameworkChange,
  prepareAgentFrameworkChange,
} from '../agent-frameworks/lifecycle.js';
import {
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { readDecisionTransaction } from '../decisions/decision-store.js';
import { planGoalPack } from '../goal-pack.js';
import {
  authorizeProofCarryingChange,
  beginProofCarryingChange,
} from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';

const roots: string[] = [];

function admittedRegistry() {
  const adapter = microsoftAgentFrameworkPythonAdapter;
  const manifestSha256 = digestBuiltinAgentFrameworkManifest(adapter);
  const reports = adapter.manifest.implementation.platforms.map((platform) => {
    const checks = AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.map((id) => ({
      id,
      status: 'passed' as const,
      required: true,
      summary: `${id} passed`,
      evidencePaths: [`evidence/${platform}/${id}.json`],
      durationMs: 1,
    }));
    return {
      schemaVersion: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
      protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
      generatedAt: '2026-09-06T00:00:00.000Z',
      adapter: {
        id: adapter.manifest.adapter.id,
        version: adapter.manifest.adapter.version,
        manifestSha256,
      },
      frameworkVersion: adapter.manifest.framework.testedVersions[0],
      cliVersion: '0.74.0',
      environment: { platform, architecture: 'x64', runtime: 'python', runtimeVersion: '3.10.21' },
      checks,
      summary: { passed: checks.length, failed: 0, skipped: 0, required: checks.length },
      verdict: 'admitted',
      blockers: [],
      limitations: [],
    } satisfies AgentFrameworkConformanceReport;
  });
  return createBuiltinAgentFrameworkRegistry({ [adapter.manifest.adapter.id]: reports });
}

async function fixture(): Promise<{
  workspacePath: string;
  projectPath: string;
  changeId: string;
}> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-framework-'));
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
    ],
  });
  await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
    name: '@platform/api',
    version: '1.0.0',
  });
  const model = await buildWorkspaceModel({
    workspacePath,
    includeAbsolutePaths: true,
    now: new Date('2026-09-06T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, workspacePath);
  const goal = await planGoalPack({
    startPath: projectPath,
    intent: 'Add a bounded Microsoft Agent Framework release reviewer',
    scope: 'project:api',
  });
  const change = await beginProofCarryingChange({
    workspacePath,
    goalId: goal.goalPack.id,
  });
  return { workspacePath, projectPath, changeId: change.changeId };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('agent framework proof-carrying lifecycle', () => {
  it('rejects lifecycle access when adapter conformance has not been admitted', async () => {
    const { workspacePath, changeId } = await fixture();
    await expect(
      prepareAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry: createBuiltinAgentFrameworkRegistry(),
        adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
        instanceName: 'Release Reviewer',
        mode: 'attach',
      })
    ).rejects.toThrow(/adapter is not admitted/i);
    const transaction = await readDecisionTransaction(workspacePath, changeId);
    expect(transaction.transaction.plans).toEqual([]);
  });

  it('binds an exact project plan, applies it only after authorization, and records ownership', async () => {
    const { workspacePath, projectPath, changeId } = await fixture();
    const registry = admittedRegistry();
    const prepared = await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'attach',
    });

    expect(prepared.status).toBe('planned');
    expect(prepared.plan.target).toEqual({ project: 'api', artifactPrefix: 'api' });
    expect(prepared.plan.files).toHaveLength(4);
    expect(prepared.planArtifact).toContain(
      `/plans/agent-framework-change-plan-${prepared.planDigest}.json`
    );
    const beforeAuthorization = await readDecisionTransaction(workspacePath, changeId);
    expect(beforeAuthorization.transaction.plans).toContainEqual(
      expect.objectContaining({
        role: 'agent-framework-change-plan',
        digest: expect.objectContaining({ value: prepared.planDigest }),
      })
    );

    await expect(
      applyAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry,
        adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
      })
    ).rejects.toThrow(/authorized PCC transaction/i);
    expect(await fsExtra.pathExists(path.join(projectPath, 'agents', 'release-reviewer'))).toBe(
      false
    );

    await authorizeProofCarryingChange({
      workspacePath,
      changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    const applied = await applyAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
    });

    expect(applied.status).toBe('applied');
    expect(applied.files).toHaveLength(4);
    expect(
      await fsExtra.readFile(
        path.join(projectPath, 'agents', 'release-reviewer', 'main.py'),
        'utf8'
      )
    ).toContain('Generated and managed by Workspai');
    const ownership = await fsExtra.readJson(path.join(workspacePath, applied.ownershipReceipt));
    expect(ownership).toMatchObject({
      schemaVersion: 'workspai.agent-framework-ownership-receipt.v1',
      changeId,
      target: { workspace: 'platform', project: 'api', instanceName: 'release-reviewer' },
    });
    expect(ownership.files).toHaveLength(4);
    const transaction = await readDecisionTransaction(workspacePath, changeId);
    expect(transaction.transaction.effects).toContainEqual(
      expect.objectContaining({
        effectClass: 'filesystem',
        status: 'succeeded',
        artifacts: expect.arrayContaining([
          expect.objectContaining({ artifact: applied.ownershipReceipt }),
          expect.objectContaining({ artifact: 'api/agents/release-reviewer/main.py' }),
        ]),
      })
    );
  });

  it('fails closed when a user file appears after plan authorization', async () => {
    const { workspacePath, projectPath, changeId } = await fixture();
    const registry = admittedRegistry();
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'attach',
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    const userFile = path.join(projectPath, 'agents', 'release-reviewer', 'main.py');
    await fsExtra.outputFile(userFile, '# user-authored after approval\n');

    await expect(
      applyAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry,
        adapterId: microsoftAgentFrameworkPythonAdapter.manifest.adapter.id,
      })
    ).rejects.toThrow(/plan is stale/i);
    expect(await fsExtra.readFile(userFile, 'utf8')).toBe('# user-authored after approval\n');
    expect(
      await fsExtra.pathExists(
        path.join(projectPath, 'agents', 'release-reviewer', 'pyproject.toml')
      )
    ).toBe(false);
  });
});
