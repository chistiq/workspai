import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createBuiltinAgentFrameworkRegistry,
  digestBuiltinAgentFrameworkManifest,
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
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
import { planGoalPack } from '../goal-pack.js';
import {
  authorizeProofCarryingChange,
  beginProofCarryingChange,
} from '../proof-carrying-change.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';

const roots: string[] = [];

function admittedRegistry(
  adapter: typeof openaiAgentsPythonAdapter | typeof openaiAgentsTypeScriptAdapter
) {
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
      cliVersion: '0.75.2',
      environment: {
        platform,
        architecture: 'x64',
        runtime: adapter.manifest.implementation.runtimes[0]!,
        runtimeVersion:
          adapter.manifest.implementation.runtimes[0] === 'python' ? '3.10.21' : '22.20.0',
      },
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
  goalId: string;
}> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-oai-lifecycle-'));
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
    startPath: workspacePath,
    intent: 'Add a bounded OpenAI Agents SDK release reviewer',
    scope: 'project:api',
  });
  const change = await beginProofCarryingChange({
    workspacePath,
    goalId: goal.goalPack.id,
  });
  return { workspacePath, projectPath, changeId: change.changeId, goalId: goal.goalPack.id };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('OpenAI Agents SDK proof-carrying lifecycle', () => {
  it('rejects lifecycle access when OpenAI adapters are not admitted', async () => {
    const { workspacePath, changeId } = await fixture();
    await expect(
      prepareAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry: createBuiltinAgentFrameworkRegistry(),
        adapterId: openaiAgentsTypeScriptAdapter.manifest.adapter.id,
        instanceName: 'Release Reviewer',
        mode: 'attach',
      })
    ).rejects.toThrow(/adapter is not admitted/i);
  });

  it.each([openaiAgentsPythonAdapter, openaiAgentsTypeScriptAdapter])(
    'plans without mutation and applies $manifest.adapter.id only after a filesystem grant',
    async (adapter) => {
      const { workspacePath, projectPath, changeId } = await fixture();
      const registry = admittedRegistry(adapter);
      const prepared = await prepareAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry,
        adapterId: adapter.manifest.adapter.id,
        instanceName: 'Release Reviewer',
        mode: 'attach',
      });
      expect(prepared.status).toBe('planned');
      expect(await fsExtra.pathExists(path.join(projectPath, 'agents', 'release-reviewer'))).toBe(
        false
      );

      await expect(
        applyAgentFrameworkChange({
          workspacePath,
          project: 'api',
          changeId,
          registry,
          adapterId: adapter.manifest.adapter.id,
        })
      ).rejects.toThrow(/authorized PCC transaction/i);

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
        adapterId: adapter.manifest.adapter.id,
      });
      expect(applied.status).toBe('applied');
      expect(applied.files.length).toBeGreaterThan(0);
      const entry = adapter.manifest.adapter.id.endsWith('python') ? 'main.py' : 'src/main.ts';
      expect(
        await fsExtra.readFile(path.join(projectPath, 'agents', 'release-reviewer', entry), 'utf8')
      ).toContain('Generated and managed by Workspai');
    }
  );

  it('keeps a second OpenAI instance independent and fails closed on stale plans', async () => {
    const { workspacePath, projectPath, changeId, goalId } = await fixture();
    const registry = admittedRegistry(openaiAgentsPythonAdapter);
    const second = await beginProofCarryingChange({
      workspacePath,
      goalId,
    });
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'attach',
    });
    const preparedSecond = await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId: second.changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      instanceName: 'Second Reviewer',
      mode: 'attach',
    });
    expect(preparedSecond.status).toBe('planned');
    await authorizeProofCarryingChange({
      workspacePath,
      changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: second.changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await applyAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
    });
    await fsExtra.outputFile(
      path.join(projectPath, 'agents', 'second-reviewer', 'main.py'),
      '# user-authored after approval\n'
    );
    await expect(
      applyAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId: second.changeId,
        registry,
        adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      })
    ).rejects.toThrow(/plan is stale/i);
    expect(
      await fsExtra.pathExists(path.join(projectPath, 'agents', 'release-reviewer', 'main.py'))
    ).toBe(true);
    expect(
      await fsExtra.readFile(path.join(projectPath, 'agents', 'second-reviewer', 'main.py'), 'utf8')
    ).toBe('# user-authored after approval\n');
  });

  it('scaffolds a new instance through the host lifecycle and no-ops a managed refresh', async () => {
    const { workspacePath, projectPath, changeId, goalId } = await fixture();
    const registry = admittedRegistry(openaiAgentsTypeScriptAdapter);
    const refresh = await beginProofCarryingChange({ workspacePath, goalId });
    const prepared = await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: openaiAgentsTypeScriptAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'scaffold',
    });
    expect(prepared.status).toBe('planned');
    expect(prepared.plan.mode).toBe('scaffold');
    expect(
      prepared.plan.changes.some((change) => change.kind === 'dependency-recommendation')
    ).toBe(false);
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
      adapterId: openaiAgentsTypeScriptAdapter.manifest.adapter.id,
    });
    expect(applied.status).toBe('applied');
    expect(
      await fsExtra.pathExists(
        path.join(projectPath, 'agents', 'release-reviewer', 'src', 'main.ts')
      )
    ).toBe(true);

    const refreshed = await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId: refresh.changeId,
      registry,
      adapterId: openaiAgentsTypeScriptAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'attach',
    });
    expect(refreshed.status).toBe('no-op');
    expect(refreshed.planArtifact).toBeNull();
  });

  it('fails closed on a corrupt ownership receipt and a managed symlink escape', async () => {
    const { workspacePath, projectPath, changeId, goalId } = await fixture();
    const registry = admittedRegistry(openaiAgentsPythonAdapter);
    const refresh = await beginProofCarryingChange({ workspacePath, goalId });
    const symlinkChange = await beginProofCarryingChange({ workspacePath, goalId });
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      instanceName: 'Release Reviewer',
      mode: 'attach',
    });
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId: symlinkChange.changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      instanceName: 'Escape Reviewer',
      mode: 'attach',
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await authorizeProofCarryingChange({
      workspacePath,
      changeId: symlinkChange.changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await applyAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
    });

    const ownershipRoot = path.join(workspacePath, '.workspai', 'agent-frameworks', 'ownership');
    const receipts = (await fsExtra.readdir(ownershipRoot, { recursive: true })).filter((entry) =>
      String(entry).endsWith('.json')
    );
    expect(receipts.length).toBeGreaterThan(0);
    await fsExtra.writeFile(
      path.join(ownershipRoot, String(receipts[0])),
      '{not-valid-ownership-receipt',
      'utf8'
    );
    await expect(
      prepareAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId: refresh.changeId,
        registry,
        adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
        instanceName: 'Release Reviewer',
        mode: 'attach',
      })
    ).rejects.toThrow(/ownership receipt|JSON|corrupt|incompatible/i);

    const managed = path.join(projectPath, 'agents', 'escape-reviewer', 'main.py');
    await fsExtra.ensureDir(path.dirname(managed));
    const outside = path.join(workspacePath, 'outside-secret.py');
    await fsExtra.outputFile(outside, '# do-not-overwrite\n');
    try {
      await fsExtra.symlink(outside, managed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(
      applyAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId: symlinkChange.changeId,
        registry,
        adapterId: openaiAgentsPythonAdapter.manifest.adapter.id,
      })
    ).rejects.toThrow(/regular file|symlink|stale/i);
    expect(await fsExtra.readFile(outside, 'utf8')).toBe('# do-not-overwrite\n');
  });
});
