import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_FRAMEWORK_OWNERSHIP_MARKER,
  createBuiltinAgentFrameworkRegistry,
  microsoftAgentFrameworkDotnetAdapter,
  microsoftAgentFrameworkPythonAdapter,
} from '../agent-frameworks/index.js';
import {
  AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  type AgentFrameworkAdapterManifest,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-maf-adapter-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

function assertCompleteManifest(manifest: AgentFrameworkAdapterManifest) {
  expect(validateAgentFrameworkAdapterManifest(manifest)).toEqual([]);
  expect(Object.values(manifest.operations).every((operation) => operation.supported)).toBe(true);
  expect(manifest.framework.id).toBe('microsoft-agent-framework');
  expect(manifest.adapter.stability).toBe('preview');
  expect(manifest.security.secrets).toBe('references-only');
  expect(manifest.ownership.mutationAdmission).toBe('workspai-pcc');
}

describe('Microsoft Agent Framework adapters', () => {
  it('declares separate, complete Python and .NET adapter manifests', () => {
    assertCompleteManifest(microsoftAgentFrameworkPythonAdapter.manifest);
    assertCompleteManifest(microsoftAgentFrameworkDotnetAdapter.manifest);
    expect(microsoftAgentFrameworkPythonAdapter.manifest.implementation.runtimes).toEqual([
      'python',
    ]);
    expect(microsoftAgentFrameworkDotnetAdapter.manifest.implementation.runtimes).toEqual([
      'dotnet',
    ]);
  });

  it('detects authored Python package-family evidence without generated state', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[project]\nname="sample"\ndependencies=["agent-framework-openai==1.17.0"]\n'
    );
    const result = await microsoftAgentFrameworkPythonAdapter.detect(root);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.evidence.find((evidence) => evidence.authored)?.path).toBe('pyproject.toml');
  });

  it('detects authored nested .NET package-family evidence', async () => {
    const root = await temporaryProject();
    await fs.mkdir(path.join(root, 'src', 'Agent'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'Agent', 'Agent.csproj'),
      '<Project><ItemGroup><PackageReference Include="Microsoft.Agents.AI.Foundry" Version="1.20.0-preview.260831.1" /></ItemGroup></Project>'
    );
    const result = await microsoftAgentFrameworkDotnetAdapter.detect(root);
    expect(result.detected).toBe(true);
    expect(result.evidence.find((evidence) => evidence.matched)?.path).toBe(
      path.join('src', 'Agent', 'Agent.csproj')
    );
  });

  it('renders deterministic owned files without credentials or filesystem writes', async () => {
    const root = await temporaryProject();
    const input = { projectRoot: root, instanceName: 'Release Reviewer' };
    const first = microsoftAgentFrameworkPythonAdapter.render(input);
    const second = microsoftAgentFrameworkPythonAdapter.render(input);
    expect(first).toEqual(second);
    expect(first.conflicts).toEqual([]);
    expect(first.files.map((file) => file.path)).toEqual([
      'agents/release-reviewer/main.py',
      'agents/release-reviewer/pyproject.toml',
      'agents/release-reviewer/tests/test_context.py',
      'agents/release-reviewer/.env.example',
      'agents/release-reviewer/README.md',
      '.workspai/agent-frameworks/microsoft-agent-framework-python/release-reviewer.json',
    ]);
    expect(
      first.files.every((file) => file.content.includes(AGENT_FRAMEWORK_OWNERSHIP_MARKER))
    ).toBe(true);
    expect(first.files.some((file) => /sk-[A-Za-z0-9]/.test(file.content))).toBe(false);
    const entrypoint = first.files.find((file) => file.path.endsWith('/main.py'))?.content ?? '';
    const dependencies =
      first.files.find((file) => file.path.endsWith('/pyproject.toml'))?.content ?? '';
    expect(entrypoint).toContain('.workspai/reports/project-context-agent.json');
    expect(entrypoint).toContain('_CONTEXT_LIMIT = 131_072');
    expect(dependencies).toContain('agent-framework-core==1.17.0');
    expect(dependencies).toContain('agent-framework-foundry==1.12.0');
    expect(dependencies).toContain('azure-identity==1.25.3');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('pins the .NET baseline and binds its entrypoint to bounded Workspai context', async () => {
    const root = await temporaryProject();
    const rendered = microsoftAgentFrameworkDotnetAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    const entrypoint =
      rendered.files.find((file) => file.path.endsWith('/Program.cs'))?.content ?? '';
    const contextLoader =
      rendered.files.find((file) => file.path.endsWith('/WorkspaiContext.cs'))?.content ?? '';
    const project =
      rendered.files.find((file) => file.path.endsWith('/ReleaseReviewer.csproj'))?.content ?? '';
    const testProject =
      rendered.files.find((file) => file.path.endsWith('/ReleaseReviewer.Tests.csproj'))?.content ??
      '';
    expect(entrypoint).toContain('WorkspaiContext.LoadAsync');
    expect(contextLoader).toContain('project-context-agent.json');
    expect(contextLoader).toContain('const long ContextLimit = 131_072');
    expect(project).toContain('Microsoft.Agents.AI.Foundry" Version="1.20.0-preview.260831.1"');
    expect(project).toContain('Azure.Identity" Version="1.21.0"');
    expect(project).toContain('<Compile Remove="tests/**/*.cs" />');
    expect(testProject).toContain('<OutputType>Exe</OutputType>');
    expect(testProject).toContain('<UseMicrosoftTestingPlatformRunner>true');
    expect(testProject).toContain('<TestingPlatformDotnetTestSupport>true');
  });

  it('preserves user-authored files and exposes the conflict as a plan blocker', async () => {
    const root = await temporaryProject();
    const existingFiles = new Map([['agents/release-reviewer/main.py', '# user-owned source\n']]);
    const input = { projectRoot: root, instanceName: 'Release Reviewer', existingFiles };
    const rendered = microsoftAgentFrameworkPythonAdapter.render(input);
    const plan = microsoftAgentFrameworkPythonAdapter.plan('attach', input);
    expect(rendered.conflicts).toEqual([
      { path: 'agents/release-reviewer/main.py', reason: 'user-authored-file-exists' },
    ]);
    expect(plan.blockers).toContain('agents/release-reviewer/main.py: user authored file exists');
    expect(microsoftAgentFrameworkPythonAdapter.validate(input).status).toBe('blocked');
    expect(() =>
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'blocked plan')
    ).not.toThrow();
  });

  it('refreshes an owned file only when the prior receipt digest proves ownership', async () => {
    const root = await temporaryProject();
    const initial = microsoftAgentFrameworkPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    const entrypoint = initial.files.find((file) => file.path.endsWith('/main.py'))!;
    const existingFiles = new Map([[entrypoint.path, entrypoint.content]]);

    expect(
      microsoftAgentFrameworkPythonAdapter.render({
        projectRoot: root,
        instanceName: 'Release Reviewer',
        existingFiles,
      }).conflicts
    ).toContainEqual({ path: entrypoint.path, reason: 'ownership-unproven' });

    const admitted = microsoftAgentFrameworkPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
      existingFiles,
      ownershipLedger: new Map([[entrypoint.path, entrypoint.sha256]]),
    });
    expect(admitted.conflicts).toEqual([]);
    expect(admitted.files.some((file) => file.path === entrypoint.path)).toBe(false);
    const noOpPlan = microsoftAgentFrameworkPythonAdapter.plan('scaffold', {
      projectRoot: root,
      instanceName: 'Release Reviewer',
      existingFiles: new Map(initial.files.map((file) => [file.path, file.content])),
      ownershipLedger: new Map(initial.files.map((file) => [file.path, file.sha256])),
    });
    expect(noOpPlan.status).toBe('no-op');
    expect(() =>
      assertJsonSchemaContract(noOpPlan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'no-op plan')
    ).not.toThrow();

    const drifted = microsoftAgentFrameworkPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
      existingFiles: new Map([[entrypoint.path, `${entrypoint.content}\n# manual edit\n`]]),
      ownershipLedger: new Map([[entrypoint.path, entrypoint.sha256]]),
    });
    expect(drifted.conflicts).toContainEqual({
      path: entrypoint.path,
      reason: 'owned-file-modified',
    });
  });

  it('resolves one explicit runtime and fails closed on missing or ambiguous runtimes', () => {
    expect(microsoftAgentFrameworkPythonAdapter.resolveRuntime(['python@3.10.21']).status).toBe(
      'resolved'
    );
    expect(microsoftAgentFrameworkPythonAdapter.resolveRuntime([]).status).toBe('unavailable');
    expect(
      microsoftAgentFrameworkPythonAdapter.resolveRuntime(['python@3.10.21', 'python@3.13.5'])
        .status
    ).toBe('ambiguous');
  });

  it('registers both built-ins but keeps them blocked until every claimed lane has evidence', async () => {
    const root = await temporaryProject();
    await fs.writeFile(path.join(root, 'requirements.txt'), 'agent-framework-foundry==1.17.0\n');
    const registry = createBuiltinAgentFrameworkRegistry();
    expect(registry.list().map((entry) => entry.manifest.adapter.id)).toEqual([
      'microsoft-agent-framework-dotnet',
      'microsoft-agent-framework-python',
    ]);
    const resolution = await registry.resolveProject({ projectRoot: root, runtime: 'python' });
    expect(resolution.status).toBe('blocked');
    expect(resolution.blockers).toEqual(
      expect.arrayContaining([
        'missing admitted lane: linux/python/1.17.0',
        'missing admitted lane: darwin/python/1.17.0',
        'missing admitted lane: win32/python/1.17.0',
      ])
    );
  });
});
