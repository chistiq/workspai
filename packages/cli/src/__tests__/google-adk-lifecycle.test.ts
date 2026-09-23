import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createBuiltinAgentFrameworkRegistry,
  digestBuiltinAgentFrameworkImplementation,
  digestBuiltinAgentFrameworkManifest,
  googleAdkPythonAdapter,
  googleAdkTypeScriptAdapter,
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
  adapter: typeof googleAdkPythonAdapter | typeof googleAdkTypeScriptAdapter
) {
  const manifestSha256 = digestBuiltinAgentFrameworkManifest(adapter);
  const implementationSha256 = digestBuiltinAgentFrameworkImplementation(adapter);
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
      generatedAt: '2026-09-22T00:00:00.000Z',
      adapter: {
        id: adapter.manifest.adapter.id,
        version: adapter.manifest.adapter.version,
        manifestSha256,
        implementationSha256,
      },
      frameworkVersion: adapter.manifest.framework.testedVersions[0],
      cliVersion: '0.77.0',
      environment: {
        platform,
        architecture: 'x64',
        runtime: adapter.manifest.implementation.runtimes[0]!,
        runtimeVersion:
          adapter.manifest.implementation.runtimes[0] === 'python' ? '3.10.21' : '20.19.0',
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

function combinedAdmittedRegistry() {
  const python = admittedRegistry(googleAdkPythonAdapter);
  const typescript = admittedRegistry(googleAdkTypeScriptAdapter);
  return createBuiltinAgentFrameworkRegistry({
    [googleAdkPythonAdapter.manifest.adapter.id]: python.get(
      googleAdkPythonAdapter.manifest.adapter.id
    )!.conformanceReports,
    [googleAdkTypeScriptAdapter.manifest.adapter.id]: typescript.get(
      googleAdkTypeScriptAdapter.manifest.adapter.id
    )!.conformanceReports,
  });
}

async function fixture(): Promise<{
  workspacePath: string;
  projectPath: string;
  changeId: string;
  goalId: string;
}> {
  const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-adk-lifecycle-'));
  roots.push(workspacePath);
  const projectPath = path.join(workspacePath, 'api');
  await fsExtra.outputJson(path.join(workspacePath, '.workspai-workspace'), {
    name: 'platform',
    profile: 'polyglot',
  });
  await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
    schemaVersion: 1,
    kind: 'rapidkit.workspace.contract',
    generatedAt: '2026-09-22T00:00:00.000Z',
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
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  await writeWorkspaceModel(model, workspacePath);
  const goal = await planGoalPack({
    startPath: workspacePath,
    intent: 'Add a bounded Google ADK release reviewer',
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

describe('Google ADK proof-carrying lifecycle', () => {
  it('rejects lifecycle access when Google adapters are not admitted', async () => {
    const { workspacePath, changeId } = await fixture();
    await expect(
      prepareAgentFrameworkChange({
        workspacePath,
        project: 'api',
        changeId,
        registry: createBuiltinAgentFrameworkRegistry(),
        adapterId: googleAdkTypeScriptAdapter.manifest.adapter.id,
        instanceName: 'Release Reviewer',
        mode: 'attach',
      })
    ).rejects.toThrow(/adapter is not admitted/i);
  });

  it.each([googleAdkPythonAdapter, googleAdkTypeScriptAdapter])(
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

  it('creates Python then TypeScript without rewriting the first instance, and the reverse', async () => {
    const { workspacePath, projectPath, changeId, goalId } = await fixture();
    const registry = combinedAdmittedRegistry();
    const second = await beginProofCarryingChange({ workspacePath, goalId });
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: googleAdkPythonAdapter.manifest.adapter.id,
      instanceName: 'Python Reviewer',
      mode: 'attach',
    });
    await prepareAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId: second.changeId,
      registry,
      adapterId: googleAdkTypeScriptAdapter.manifest.adapter.id,
      instanceName: 'TypeScript Reviewer',
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
      changeId: second.changeId,
      effectClasses: ['filesystem'],
      grantedBy: 'maintainer',
    });
    await applyAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId,
      registry,
      adapterId: googleAdkPythonAdapter.manifest.adapter.id,
    });
    const pythonMain = await fsExtra.readFile(
      path.join(projectPath, 'agents', 'python-reviewer', 'main.py'),
      'utf8'
    );
    await applyAgentFrameworkChange({
      workspacePath,
      project: 'api',
      changeId: second.changeId,
      registry,
      adapterId: googleAdkTypeScriptAdapter.manifest.adapter.id,
    });
    expect(
      await fsExtra.readFile(path.join(projectPath, 'agents', 'python-reviewer', 'main.py'), 'utf8')
    ).toBe(pythonMain);
    expect(
      await fsExtra.pathExists(
        path.join(projectPath, 'agents', 'typescript-reviewer', 'src', 'main.ts')
      )
    ).toBe(true);
  });
});
