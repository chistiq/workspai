import { spawnSync } from 'node:child_process';
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
  MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE,
  MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE,
  packageVersion,
} from '../agent-frameworks/version-policy.js';
import {
  AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  type AgentFrameworkAdapterManifest,
} from '../contracts/agent-framework-contract.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
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
      'agents/release-reviewer/workspai_context.py',
      'agents/release-reviewer/agent.py',
      'agents/release-reviewer/main.py',
      'agents/release-reviewer/pyproject.toml',
      'agents/release-reviewer/tests/test_context.py',
      'agents/release-reviewer/tests/test_framework.py',
      'agents/release-reviewer/.env.example',
      'agents/release-reviewer/README.md',
      '.workspai/agent-frameworks/microsoft-agent-framework-python/release-reviewer.json',
    ]);
    expect(
      first.files.every((file) => file.content.includes(AGENT_FRAMEWORK_OWNERSHIP_MARKER))
    ).toBe(true);
    expect(first.files.some((file) => /sk-[A-Za-z0-9]/.test(file.content))).toBe(false);
    expect(first.files.some((file) => file.content.includes('gpt-4o'))).toBe(false);
    const entrypoint = first.files.find((file) => file.path.endsWith('/main.py'))?.content ?? '';
    const agent = first.files.find((file) => file.path.endsWith('/agent.py'))?.content ?? '';
    const contextFile =
      first.files.find((file) => file.path.endsWith('workspai_context.py'))?.content ?? '';
    const dependencies =
      first.files.find((file) => file.path.endsWith('/pyproject.toml'))?.content ?? '';
    expect(entrypoint).toContain('from agent import build_agent');
    expect(entrypoint).not.toContain('Path.cwd');
    expect(entrypoint).toContain('redact');
    expect(entrypoint).toContain('read_user_prompt');
    expect(entrypoint).toContain('run_stream');
    expect(agent).toContain('describe_workspai_context');
    expect(agent).toContain('read_workspai_project_summary');
    expect(agent).toContain('list_workspai_supported_commands');
    expect(agent).toContain('FoundryChatClient');
    expect(agent).toContain('tools=[');
    expect(agent).not.toContain('<workspai-context>');
    expect(agent).not.toContain('gpt-4o');
    expect(agent).not.toContain('Path.cwd');
    expect(contextFile).toContain('resolve_workspai_project_root');
    expect(contextFile).toContain('describe_workspai_context_view');
    expect(contextFile).toContain('read_workspai_project_summary');
    expect(contextFile).toContain('131_072');
    expect(contextFile).not.toContain('Path.cwd');
    const generatedTests =
      first.files.find((file) => file.path.endsWith('/tests/test_context.py'))?.content ?? '';
    const generatedFrameworkTests =
      first.files.find((file) => file.path.endsWith('/tests/test_framework.py'))?.content ?? '';
    expect(generatedTests).toContain('bind_workspai_project_root_for_tests');
    expect(generatedTests).not.toContain('_restore_live_context');
    expect(generatedTests).toContain('test_allowlisted_views_omit_non_admitted_keys');
    expect(generatedFrameworkTests).toContain(
      'agent-framework is required for this release-admitted kit'
    );
    expect(generatedFrameworkTests).not.toContain('skipTest("agent-framework is not installed")');
    expect(generatedTests).not.toContain('RequiredFrameworkLoopTests');
    expect(generatedTests).not.toContain('main.Path.cwd');
    expect(dependencies).toContain('[build-system]');
    expect(dependencies).toContain('setuptools');
    expect(dependencies).not.toContain('package = false');
    expect(dependencies).toContain(
      `agent-framework-core==${packageVersion(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE, 'agent-framework-core')}`
    );
    expect(dependencies).toContain(
      `agent-framework-foundry==${packageVersion(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE, 'agent-framework-foundry')}`
    );
    expect(dependencies).toContain(
      `azure-identity==${packageVersion(MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE, 'azure-identity')}`
    );
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
    expect(entrypoint).toContain('WorkspaiContext.DescribeViewAsync');
    expect(entrypoint).toContain('AIFunctionFactory.Create');
    expect(entrypoint).toContain('DescribeWorkspaiContext');
    expect(entrypoint).toContain('ReadWorkspaiProjectSummary');
    expect(entrypoint).toContain('ListWorkspaiSupportedCommands');
    expect(entrypoint).toContain('RunStreamingAsync');
    expect(entrypoint).not.toContain('<workspai-context>');
    expect(entrypoint).not.toContain('GetCurrentDirectory');
    expect(entrypoint).not.toContain('gpt-4o');
    expect(contextLoader).toContain('FileAttributes attributes = default');
    expect(contextLoader).toContain('FileAttributes targetAttributes = default');
    expect(contextLoader).toContain('project-context-agent.json');
    expect(contextLoader).toContain('const long ContextLimit = 131_072');
    expect(contextLoader).toContain('ResolveProjectRoot');
    expect(contextLoader).toContain('AppContext.BaseDirectory');
    expect(contextLoader).toContain('schemaVersion');
    expect(contextLoader).toContain('ProjectSummaryAsync');
    expect(contextLoader).toContain('SupportedCommandsAsync');
    expect(contextLoader).toContain('RedactSecretShapedValues');
    expect(contextLoader).toContain(
      'new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)'
    );
    expect(contextLoader).toContain('if (!stream.CanSeek)');
    expect(contextLoader).toContain('FileAttributes.Device');
    const generatedTests =
      rendered.files.find((file) => file.path.endsWith('/WorkspaiContextTests.cs'))?.content ?? '';
    expect(generatedTests).toContain('AllowlistedViewsOmitNonAdmittedKeys');
    expect(generatedTests).toContain('RejectsMalformedUtf8WithoutDisclosingContents');
    expect(project).toContain(
      `Microsoft.Agents.AI.Foundry" Version="${packageVersion(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE, 'Microsoft.Agents.AI.Foundry')}"`
    );
    expect(project).toContain(
      `Azure.Identity" Version="${packageVersion(MICROSOFT_AGENT_FRAMEWORK_DOTNET_BASELINE, 'Azure.Identity')}"`
    );
    expect(project).toContain('<Compile Remove="tests/**/*.cs" />');
    expect(project).toContain('<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>');
    expect(testProject).toContain('<OutputType>Exe</OutputType>');
    expect(testProject).toContain('<UseMicrosoftTestingPlatformRunner>true');
    expect(testProject).toContain('<TestingPlatformDotnetTestSupport>true');
    expect(testProject).toContain(
      '<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>'
    );
    expect(rendered.files.find((file) => file.path.endsWith('/README.md'))?.content).not.toContain(
      '--use-lock-file'
    );
    expect(
      microsoftAgentFrameworkDotnetAdapter.context({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).verificationCommands
    ).toContain(
      'dotnet run --project agents/release-reviewer/tests/ReleaseReviewer.Tests.csproj --no-restore'
    );
    expect(
      microsoftAgentFrameworkDotnetAdapter.context({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).verificationCommands
    ).toContain('dotnet restore agents/release-reviewer/ReleaseReviewer.csproj');
    expect(
      microsoftAgentFrameworkDotnetAdapter
        .context({
          projectRoot: root,
          instanceName: 'Release Reviewer',
        })
        .verificationCommands.join('\n')
    ).not.toContain('--use-lock-file');
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

  it('Python loader finds project context from the agent package directory, not cwd', async () => {
    const root = await temporaryProject();
    const rendered = microsoftAgentFrameworkPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    for (const file of rendered.files) {
      const destination = path.join(root, ...file.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.content, 'utf8');
    }
    const contextPath = path.join(root, '.workspai', 'reports', 'project-context-agent.json');
    await fs.mkdir(path.dirname(contextPath), { recursive: true });
    const admitted = JSON.stringify({
      schemaVersion: WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectContextAgent.schemaVersion,
    });
    await fs.writeFile(contextPath, admitted, 'utf8');
    const agentRoot = path.join(root, 'agents', 'release-reviewer');
    const result = spawnSync(
      'python3',
      [
        '-c',
        [
          'from workspai_context import load_workspai_context',
          'print(load_workspai_context(), end="")',
        ].join('\n'),
      ],
      {
        cwd: agentRoot,
        encoding: 'utf8',
      }
    );
    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
    expect(result.stdout).toBe(admitted);
    const generatedSuite = spawnSync(
      'python3',
      ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_context.py', '-v'],
      {
        cwd: agentRoot,
        encoding: 'utf8',
      }
    );
    expect(generatedSuite.status, `${generatedSuite.stderr}${generatedSuite.stdout}`).toBe(0);
    expect(`${generatedSuite.stderr}${generatedSuite.stdout}`).toContain(
      'test_reads_bounded_context_from_the_owning_project_not_cwd'
    );
    expect(`${generatedSuite.stderr}${generatedSuite.stdout}`).toMatch(/\bOK\b/);
    expect(await fs.readFile(contextPath, 'utf8')).toBe(admitted);
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
      'google-adk-python',
      'google-adk-typescript',
      'microsoft-agent-framework-dotnet',
      'microsoft-agent-framework-python',
      'openai-agents-python',
      'openai-agents-typescript',
    ]);
    const resolution = await registry.resolveProject({ projectRoot: root, runtime: 'python' });
    expect(resolution.status).toBe('blocked');
    expect(resolution.blockers).toEqual(
      expect.arrayContaining([
        `missing admitted lane: linux/python/${MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.frameworkVersion}`,
        `missing admitted lane: darwin/python/${MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.frameworkVersion}`,
        `missing admitted lane: win32/python/${MICROSOFT_AGENT_FRAMEWORK_PYTHON_BASELINE.frameworkVersion}`,
      ])
    );
  });
});
