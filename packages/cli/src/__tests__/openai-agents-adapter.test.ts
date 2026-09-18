import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_FRAMEWORK_OWNERSHIP_MARKER,
  createBuiltinAgentFrameworkRegistry,
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
} from '../agent-frameworks/index.js';
import {
  OPENAI_AGENTS_PYTHON_BASELINE,
  OPENAI_AGENTS_TYPESCRIPT_BASELINE,
  packageVersion,
} from '../agent-frameworks/version-policy.js';
import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  type AgentFrameworkAdapterManifest,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-oai-adapter-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

function assertCompleteManifest(manifest: AgentFrameworkAdapterManifest) {
  expect(() =>
    assertJsonSchemaContract(
      manifest,
      AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
      'Adapter manifest'
    )
  ).not.toThrow();
  expect(validateAgentFrameworkAdapterManifest(manifest)).toEqual([]);
  expect(Object.values(manifest.operations).every((operation) => operation.supported)).toBe(true);
  expect(manifest.framework.id).toBe('openai-agents');
  expect(manifest.adapter.stability).toBe('preview');
  expect(manifest.security.secrets).toBe('references-only');
  expect(manifest.ownership.mutationAdmission).toBe('workspai-pcc');
  expect(manifest.capabilities['single-agent']?.support).toBe('native');
  expect(manifest.capabilities['typed-tools']?.support).toBe('native');
  expect(manifest.capabilities['local-execution']?.support).toBe('native');
  expect(manifest.capabilities.telemetry?.support).toBe('conditional');
  expect(manifest.capabilities['provider-neutral-models']?.support).toBe('conditional');
  expect(manifest.capabilities.handoffs?.support).toBe('unsupported');
  expect(manifest.capabilities['mcp-client']?.support).toBe('unsupported');
}

describe('OpenAI Agents SDK adapters', () => {
  it('declares separate, complete Python and TypeScript adapter manifests', () => {
    assertCompleteManifest(openaiAgentsPythonAdapter.manifest);
    assertCompleteManifest(openaiAgentsTypeScriptAdapter.manifest);
    expect(openaiAgentsPythonAdapter.manifest.adapter.id).toBe('openai-agents-python');
    expect(openaiAgentsTypeScriptAdapter.manifest.adapter.id).toBe('openai-agents-typescript');
    expect(openaiAgentsPythonAdapter.manifest.implementation.runtimes).toEqual(['python']);
    expect(openaiAgentsTypeScriptAdapter.manifest.implementation.runtimes).toEqual(['node']);
    expect(openaiAgentsPythonAdapter.manifest.framework.testedVersions).toEqual([
      OPENAI_AGENTS_PYTHON_BASELINE.frameworkVersion,
    ]);
    expect(openaiAgentsTypeScriptAdapter.manifest.framework.testedVersions).toEqual([
      OPENAI_AGENTS_TYPESCRIPT_BASELINE.frameworkVersion,
    ]);
  });

  it('detects authored openai-agents PyPI evidence and ignores the openai package', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      `[project]\nname="sample"\ndependencies=["openai-agents==${packageVersion(OPENAI_AGENTS_PYTHON_BASELINE, 'openai-agents')}"]\n`
    );
    const detected = await openaiAgentsPythonAdapter.detect(root);
    expect(detected.detected).toBe(true);
    expect(detected.confidence).toBe(1);
    expect(detected.evidence.find((evidence) => evidence.authored)?.path).toBe('pyproject.toml');

    const openaiOnly = await temporaryProject();
    await fs.writeFile(path.join(openaiOnly, 'requirements.txt'), 'openai==1.109.1\n');
    await expect(openaiAgentsPythonAdapter.detect(openaiOnly)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('detects authored @openai/agents npm evidence and ignores the openai package', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@openai/agents': packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, '@openai/agents'),
        },
      })
    );
    const detected = await openaiAgentsTypeScriptAdapter.detect(root);
    expect(detected.detected).toBe(true);
    expect(detected.evidence.find((evidence) => evidence.authored)?.path).toBe('package.json');

    const openaiOnly = await temporaryProject();
    await fs.writeFile(
      path.join(openaiOnly, 'package.json'),
      JSON.stringify({ dependencies: { openai: '5.16.0' } })
    );
    await expect(openaiAgentsTypeScriptAdapter.detect(openaiOnly)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('does not treat generated Workspai state as framework identity', async () => {
    const root = await temporaryProject();
    await fs.mkdir(path.join(root, '.workspai', 'agent-frameworks', 'openai-agents-python'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, '.workspai', 'agent-frameworks', 'openai-agents-python', 'primary.json'),
      '{}\n'
    );
    await expect(openaiAgentsPythonAdapter.detect(root)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('renders deterministic Python files without credentials or filesystem writes', async () => {
    const root = await temporaryProject();
    const input = { projectRoot: root, instanceName: 'Release Reviewer' };
    const first = openaiAgentsPythonAdapter.render(input);
    const second = openaiAgentsPythonAdapter.render(input);
    expect(first).toEqual(second);
    expect(first.conflicts).toEqual([]);
    expect(first.files.map((file) => file.path)).toEqual([
      'agents/release-reviewer/workspai_context.py',
      'agents/release-reviewer/agent.py',
      'agents/release-reviewer/main.py',
      'agents/release-reviewer/pyproject.toml',
      'agents/release-reviewer/tests/test_context.py',
      'agents/release-reviewer/.env.example',
      'agents/release-reviewer/README.md',
      '.workspai/agent-frameworks/openai-agents-python/release-reviewer.json',
    ]);
    expect(
      first.files.every((file) => file.content.includes(AGENT_FRAMEWORK_OWNERSHIP_MARKER))
    ).toBe(true);
    expect(first.files.some((file) => /sk-[A-Za-z0-9]/.test(file.content))).toBe(false);
    const agent = first.files.find((file) => file.path.endsWith('/agent.py'))?.content ?? '';
    const entrypoint = first.files.find((file) => file.path.endsWith('/main.py'))?.content ?? '';
    const generatedTests =
      first.files.find((file) => file.path.endsWith('/tests/test_context.py'))?.content ?? '';
    const dependencies =
      first.files.find((file) => file.path.endsWith('/pyproject.toml'))?.content ?? '';
    expect(agent).toContain('from agents import Agent, ModelSettings, function_tool');
    expect(agent).toContain('ModelSettings(timeout=MODEL_TIMEOUT_SECONDS)');
    expect(agent).toContain('if model is not None:');
    expect(generatedTests).toContain('setUpClass');
    expect(generatedTests).toContain('_restore_live_context');
    expect(generatedTests).toContain('test_scripted_model_tool_call_stays_offline');
    expect(generatedTests).toContain('ScriptedModel');
    expect(generatedTests).toContain('test_allowlisted_views_omit_non_admitted_keys');
    expect(agent).toContain('@function_tool(failure_error_function=None)');
    expect(agent).toContain('describe_workspai_context');
    expect(agent).toContain('read_workspai_project_summary');
    expect(agent).toContain('list_workspai_supported_commands');
    expect(agent).toContain('OPENAI_API_KEY is not set');
    expect(agent).not.toContain('<workspai-context>');
    expect(entrypoint).toContain('max_turns=MAX_TURNS');
    expect(entrypoint).toContain('set_tracing_disabled');
    expect(entrypoint).toContain('require_api_key');
    expect(entrypoint).toContain('run_admitted_agent');
    expect(entrypoint).toContain('Runner.run_streamed');
    expect(entrypoint).toContain('read_user_prompt');
    expect(agent).toContain('def build_agent');
    expect(agent).toContain('OPENAI_AGENTS_DISABLE_TRACING');
    expect(agent).toContain('WORKSPAI_AGENT_TRACING');
    expect(dependencies).toContain('[build-system]');
    expect(dependencies).toContain('setuptools');
    const contextFile =
      first.files.find((file) => file.path.endsWith('workspai_context.py'))?.content ?? '';
    expect(contextFile).toContain('resolve_workspai_project_root');
    expect(contextFile).toContain('describe_workspai_context_view');
    expect(contextFile).toContain('read_workspai_project_summary');
    expect(contextFile).toContain('list_workspai_supported_commands');
    expect(contextFile).toContain('redact_secret_shaped_values');
    expect(contextFile).not.toContain('Path.cwd');
    expect(dependencies).toContain(
      `openai-agents==${packageVersion(OPENAI_AGENTS_PYTHON_BASELINE, 'openai-agents')}`
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('renders a pinned TypeScript starter bound to bounded Workspai context', async () => {
    const root = await temporaryProject();
    const rendered = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    const agent = rendered.files.find((file) => file.path.endsWith('/agent.ts'))?.content ?? '';
    const entrypoint = rendered.files.find((file) => file.path.endsWith('/main.ts'))?.content ?? '';
    const manifest =
      rendered.files.find((file) => file.path.endsWith('/package.json'))?.content ?? '';
    expect(agent).toContain("from '@openai/agents'");
    expect(agent).toContain('describe_workspai_context');
    expect(agent).toContain('read_workspai_project_summary');
    expect(agent).toContain('list_workspai_supported_commands');
    expect(agent).toContain('redactSdkError');
    expect(agent).toContain('runAdmittedAgent');
    expect(agent).toContain('streamAdmittedAgent');
    expect(agent).not.toContain('<workspai-context>');
    expect(agent).toContain('OPENAI_AGENTS_DISABLE_TRACING');
    expect(agent).toContain('WORKSPAI_AGENT_TRACING');
    expect(agent).toContain('maxTurns: options?.maxTurns ?? MAX_TURNS');
    expect(agent).toContain('AbortSignal.timeout');
    expect(entrypoint).toContain('streamAdmittedAgent');
    expect(entrypoint).toContain('readUserPrompt');
    const contextFile =
      rendered.files.find((file) => file.path.endsWith('workspai-context.ts'))?.content ?? '';
    const generatedTests =
      rendered.files.find((file) => file.path.endsWith('/tests/context.test.ts'))?.content ?? '';
    expect(contextFile).toContain('resolveWorkspaiProjectRoot');
    expect(contextFile).toContain('describeWorkspaiContextView');
    expect(contextFile).toContain('readWorkspaiProjectSummary');
    expect(contextFile).toContain('listWorkspaiSupportedCommands');
    expect(contextFile).toContain('redactSecretShapedValues');
    expect(contextFile).not.toContain('process.cwd()');
    expect(generatedTests).toContain('restoreLiveContext');
    expect(generatedTests).toContain('before(isolateLiveContext)');
    expect(generatedTests).toContain('scripted model tool call stays offline');
    expect(generatedTests).toContain('ScriptedModel');
    expect(generatedTests).toContain('allowlisted views omit non-admitted keys');
    expect(generatedTests).toContain("const leaked = 'do-not-leak'");
    expect(generatedTests).not.toMatch(/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i);
    expect(agent).toContain('errorFunction: null');
    expect(
      openaiAgentsTypeScriptAdapter.validate({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).status
    ).toBe('passed');
    expect(manifest).toContain(
      `"@openai/agents": "${packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, '@openai/agents')}"`
    );
    expect(manifest).toContain(
      `"zod": "${packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, 'zod')}"`
    );
    expect(manifest).toContain('"node": ">=22"');
    expect(
      openaiAgentsTypeScriptAdapter.context({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).verificationCommands
    ).toContain('npm --prefix agents/release-reviewer test');
    expect(rendered.files.find((file) => file.path.endsWith('/README.md'))?.content).toContain(
      'npm --prefix agents/release-reviewer install'
    );
    expect(rendered.files.find((file) => file.path.endsWith('/README.md'))?.content).not.toContain(
      'npm install --prefix'
    );
  });

  it('preserves user-authored files and exposes the conflict as a plan blocker', async () => {
    const root = await temporaryProject();
    const existingFiles = new Map([['agents/release-reviewer/main.py', '# user-owned source\n']]);
    const input = { projectRoot: root, instanceName: 'Release Reviewer', existingFiles };
    const rendered = openaiAgentsPythonAdapter.render(input);
    const plan = openaiAgentsPythonAdapter.plan('attach', input);
    expect(rendered.conflicts).toEqual([
      { path: 'agents/release-reviewer/main.py', reason: 'user-authored-file-exists' },
    ]);
    expect(plan.blockers).toContain('agents/release-reviewer/main.py: user authored file exists');
    expect(openaiAgentsPythonAdapter.validate(input).status).toBe('blocked');
    expect(() =>
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'blocked plan')
    ).not.toThrow();
  });

  it('refreshes an owned file only when the prior receipt digest proves ownership', async () => {
    const root = await temporaryProject();
    const initial = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    const entrypoint = initial.files.find((file) => file.path.endsWith('/main.ts'))!;
    const existingFiles = new Map([[entrypoint.path, entrypoint.content]]);

    expect(
      openaiAgentsTypeScriptAdapter.render({
        projectRoot: root,
        instanceName: 'Release Reviewer',
        existingFiles,
      }).conflicts
    ).toContainEqual({ path: entrypoint.path, reason: 'ownership-unproven' });

    const admitted = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
      existingFiles,
      ownershipLedger: new Map([[entrypoint.path, entrypoint.sha256]]),
    });
    expect(admitted.conflicts).toEqual([]);
    expect(admitted.files.some((file) => file.path === entrypoint.path)).toBe(false);

    const drifted = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
      existingFiles: new Map([[entrypoint.path, `${entrypoint.content}\n// manual edit\n`]]),
      ownershipLedger: new Map([[entrypoint.path, entrypoint.sha256]]),
    });
    expect(drifted.conflicts).toContainEqual({
      path: entrypoint.path,
      reason: 'owned-file-modified',
    });
  });

  it('resolves one explicit runtime and fails closed on missing or ambiguous runtimes', () => {
    expect(openaiAgentsPythonAdapter.resolveRuntime(['python@3.10.21']).status).toBe('resolved');
    expect(openaiAgentsTypeScriptAdapter.resolveRuntime(['node@22.20.0']).status).toBe('resolved');
    expect(openaiAgentsTypeScriptAdapter.resolveRuntime(['python@3.10.21']).status).toBe(
      'unavailable'
    );
    expect(
      openaiAgentsTypeScriptAdapter.resolveRuntime(['node@22.20.0', 'node@24.20.0']).status
    ).toBe('ambiguous');
  });

  it('registers OpenAI adapters as blocked until their own complete matrix is admitted', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      `[project]\ndependencies=["openai-agents==${packageVersion(OPENAI_AGENTS_PYTHON_BASELINE, 'openai-agents')}"]\n`
    );
    const registry = createBuiltinAgentFrameworkRegistry();
    expect(registry.list().map((entry) => entry.manifest.adapter.id)).toEqual([
      'microsoft-agent-framework-dotnet',
      'microsoft-agent-framework-python',
      'openai-agents-python',
      'openai-agents-typescript',
    ]);
    const resolution = await registry.resolveProject({ projectRoot: root, runtime: 'python' });
    expect(resolution.status).toBe('blocked');
    expect(resolution.blockers).toEqual(
      expect.arrayContaining([
        `missing admitted lane: linux/python/${OPENAI_AGENTS_PYTHON_BASELINE.frameworkVersion}`,
        `missing admitted lane: darwin/python/${OPENAI_AGENTS_PYTHON_BASELINE.frameworkVersion}`,
        `missing admitted lane: win32/python/${OPENAI_AGENTS_PYTHON_BASELINE.frameworkVersion}`,
      ])
    );
  });

  it('treats a project that declares both Microsoft and OpenAI Python packages as a conflict', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[project]\ndependencies=["agent-framework-core==1.18.0", "openai-agents==0.22.2"]\n'
    );
    const registry = createBuiltinAgentFrameworkRegistry();
    await expect(
      registry.resolveProject({ projectRoot: root, runtime: 'python' })
    ).resolves.toMatchObject({
      status: 'conflict',
    });
  });
});
