import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_FRAMEWORK_OWNERSHIP_MARKER,
  googleAdkPythonAdapter,
  googleAdkTypeScriptAdapter,
} from '../agent-frameworks/index.js';
import { agentFrameworkPythonContextSource } from '../agent-frameworks/context-loaders/python.js';
import { agentFrameworkTypeScriptContextSource } from '../agent-frameworks/context-loaders/typescript.js';
import {
  GOOGLE_ADK_PYTHON_BASELINE,
  GOOGLE_ADK_TYPESCRIPT_BASELINE,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-adk-adapter-'));
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
  expect(manifest.framework.id).toBe('google-adk');
  expect(manifest.adapter.stability).toBe('preview');
  expect(manifest.security.secrets).toBe('references-only');
  expect(manifest.ownership.mutationAdmission).toBe('workspai-pcc');
  expect(manifest.capabilities['single-agent']?.support).toBe('native');
  expect(manifest.capabilities['typed-tools']?.support).toBe('native');
  expect(manifest.capabilities['local-execution']?.support).toBe('native');
  expect(manifest.capabilities.streaming?.support).toBe('native');
  expect(manifest.capabilities['conversation-state']?.support).toBe('native');
  expect(manifest.capabilities.telemetry?.support).toBe('conditional');
  expect(manifest.capabilities['explicit-workflows']?.support).toBe('unsupported');
  expect(manifest.capabilities['mcp-client']?.support).toBe('unsupported');
  expect(manifest.capabilities['managed-hosting']?.support).toBe('unsupported');
  expect(JSON.stringify(manifest)).not.toMatch(/openrouter/i);
}

describe('Google ADK adapters', () => {
  it('declares independent Python and TypeScript adapter manifests', () => {
    assertCompleteManifest(googleAdkPythonAdapter.manifest);
    assertCompleteManifest(googleAdkTypeScriptAdapter.manifest);
    expect(googleAdkPythonAdapter.manifest.adapter.id).toBe('google-adk-python');
    expect(googleAdkTypeScriptAdapter.manifest.adapter.id).toBe('google-adk-typescript');
    expect(googleAdkPythonAdapter.manifest.implementation.runtimes).toEqual(['python']);
    expect(googleAdkTypeScriptAdapter.manifest.implementation.runtimes).toEqual(['node']);
    expect(googleAdkPythonAdapter.manifest.framework.testedVersions).toEqual([
      GOOGLE_ADK_PYTHON_BASELINE.frameworkVersion,
    ]);
    expect(googleAdkTypeScriptAdapter.manifest.framework.testedVersions).toEqual([
      GOOGLE_ADK_TYPESCRIPT_BASELINE.frameworkVersion,
    ]);
    expect(googleAdkPythonAdapter.manifest.capabilities.streaming?.limitations.join(' ')).toMatch(
      /no AbortSignal/i
    );
    expect(googleAdkPythonAdapter.manifest.capabilities.streaming?.limitations.join(' ')).toMatch(
      /writes each text delta/i
    );
    expect(
      googleAdkTypeScriptAdapter.manifest.capabilities.streaming?.limitations.join(' ')
    ).toMatch(/AbortSignal/);
    expect(
      googleAdkTypeScriptAdapter.manifest.capabilities.streaming?.limitations.join(' ')
    ).toMatch(/writes each text delta/i);
    expect(googleAdkPythonAdapter.manifest.capabilities.telemetry?.evidence.join(' ')).toMatch(
      /OTEL_SDK_DISABLED/
    );
    expect(
      googleAdkTypeScriptAdapter.manifest.capabilities.streaming?.limitations.join(' ')
    ).toMatch(/AbortSignal/);
    expect(
      googleAdkTypeScriptAdapter.manifest.capabilities['single-agent']?.limitations.join(' ')
    ).toMatch(/graph Workflow Runtime/i);
    expect(
      googleAdkPythonAdapter.manifest.capabilities['single-agent']?.limitations.join(' ')
    ).not.toMatch(/graph Workflow Runtime is part/i);
  });

  it('detects authored google-adk PyPI evidence and ignores unrelated packages', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      `[project]\nname="sample"\ndependencies=["google-adk==${packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk')}"]\n`
    );
    const detected = await googleAdkPythonAdapter.detect(root);
    expect(detected.detected).toBe(true);
    expect(detected.confidence).toBe(1);
    expect(detected.evidence.find((evidence) => evidence.authored)?.path).toBe('pyproject.toml');

    const unrelated = await temporaryProject();
    await fs.writeFile(path.join(unrelated, 'requirements.txt'), 'openai==1.109.1\n');
    await expect(googleAdkPythonAdapter.detect(unrelated)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('detects authored @google/adk npm evidence and ignores the openai package', async () => {
    const root = await temporaryProject();
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@google/adk': packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk'),
        },
      })
    );
    const detected = await googleAdkTypeScriptAdapter.detect(root);
    expect(detected.detected).toBe(true);
    expect(detected.evidence.find((evidence) => evidence.authored)?.path).toBe('package.json');

    const unrelated = await temporaryProject();
    await fs.writeFile(
      path.join(unrelated, 'package.json'),
      JSON.stringify({ dependencies: { openai: '5.16.0' } })
    );
    await expect(googleAdkTypeScriptAdapter.detect(unrelated)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('does not treat generated Workspai state as framework identity', async () => {
    const root = await temporaryProject();
    await fs.mkdir(path.join(root, '.workspai', 'agent-frameworks', 'google-adk-python'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, '.workspai', 'agent-frameworks', 'google-adk-python', 'primary.json'),
      '{}\n'
    );
    await expect(googleAdkPythonAdapter.detect(root)).resolves.toMatchObject({
      detected: false,
      matchedAuthoredMarkers: 0,
    });
  });

  it('renders a pinned Python starter bound to bounded Workspai context', async () => {
    const root = await temporaryProject();
    const input = { projectRoot: root, instanceName: 'Release Reviewer' };
    const first = googleAdkPythonAdapter.render(input);
    const second = googleAdkPythonAdapter.render(input);
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
      'agents/release-reviewer/.gitignore',
      'agents/release-reviewer/README.md',
      '.workspai/agent-frameworks/google-adk-python/release-reviewer.json',
    ]);
    expect(
      first.files.every((file) => file.content.includes(AGENT_FRAMEWORK_OWNERSHIP_MARKER))
    ).toBe(true);
    expect(first.files.some((file) => /sk-[A-Za-z0-9]/.test(file.content))).toBe(false);
    const agent = first.files.find((file) => file.path.endsWith('/agent.py'))?.content ?? '';
    const entrypoint = first.files.find((file) => file.path.endsWith('/main.py'))?.content ?? '';
    const generatedTests =
      first.files.find((file) => file.path.endsWith('/tests/test_context.py'))?.content ?? '';
    const generatedFrameworkTests =
      first.files.find((file) => file.path.endsWith('/tests/test_framework.py'))?.content ?? '';
    const dependencies =
      first.files.find((file) => file.path.endsWith('/pyproject.toml'))?.content ?? '';
    const environment =
      first.files.find((file) => file.path.endsWith('/.env.example'))?.content ?? '';
    expect(agent).toContain('from google.adk.agents import LlmAgent');
    expect(agent).toContain('name="release_reviewer"');
    expect(agent).toContain('WORKSPAI_ADK_PROVIDER');
    expect(agent).toContain('gemini-api');
    expect(agent).toContain('vertex-ai');
    expect(agent).toContain('GOOGLE_API_KEY is not set');
    expect(agent).not.toContain('openrouter');
    expect(agent).not.toContain('<workspai-context>');
    expect(entrypoint).toContain('run_admitted_agent');
    expect(entrypoint).toContain('InMemorySessionService');
    expect(entrypoint).toContain('get_session');
    expect(entrypoint).toContain('max_llm_calls');
    expect(entrypoint).toContain('asyncio.wait_for');
    expect(generatedTests).toContain('bind_workspai_project_root_for_tests');
    expect(generatedFrameworkTests).toContain('google-adk is required for this Google ADK kit');
    expect(generatedFrameworkTests).toContain('ScriptedLlm');
    expect(generatedFrameworkTests).toContain('in_memory_session_continues');
    expect(generatedFrameworkTests).toContain('first_chunk_before_the_model_finishes');
    expect(generatedFrameworkTests).toContain('tracing_is_disabled_unless_opted_in');
    expect(agent).toContain('def tracing_enabled');
    expect(agent.indexOf('def tracing_enabled')).toBeLessThan(agent.indexOf('from google.adk'));
    expect(agent).toContain('OTEL_SDK_DISABLED');
    expect(entrypoint).toContain('on_text');
    expect(entrypoint.indexOf('from agent import')).toBeLessThan(
      entrypoint.indexOf('from google.adk')
    );
    expect(first.files.find((file) => file.path.endsWith('/workspai_context.py'))?.content).toBe(
      agentFrameworkPythonContextSource()
    );
    expect(first.files.every((file) => !file.content.includes('openai-agents'))).toBe(true);
    expect(generatedTests).not.toContain('ScriptedLlm');
    expect(environment).toContain('WORKSPAI_ADK_PROVIDER=');
    expect(environment).not.toMatch(/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i);
    expect(
      first.files.every(
        (file) => !/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i.test(file.content)
      )
    ).toBe(true);
    expect(googleAdkPythonAdapter.validate(input).status).toBe('passed');
    expect(dependencies).toContain(
      `google-adk==${packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk')}`
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('renders a pinned TypeScript starter bound to bounded Workspai context', async () => {
    const root = await temporaryProject();
    const rendered = googleAdkTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    expect(rendered.files.map((file) => file.path)).toEqual([
      'agents/release-reviewer/src/workspai-context.ts',
      'agents/release-reviewer/src/tracing.ts',
      'agents/release-reviewer/src/agent.ts',
      'agents/release-reviewer/src/main.ts',
      'agents/release-reviewer/package.json',
      'agents/release-reviewer/tsconfig.json',
      'agents/release-reviewer/tests/context.test.ts',
      'agents/release-reviewer/tests/framework.test.ts',
      'agents/release-reviewer/.env.example',
      'agents/release-reviewer/.gitignore',
      'agents/release-reviewer/README.md',
      '.workspai/agent-frameworks/google-adk-typescript/release-reviewer.json',
    ]);
    const agent = rendered.files.find((file) => file.path.endsWith('/agent.ts'))?.content ?? '';
    const entrypoint = rendered.files.find((file) => file.path.endsWith('/main.ts'))?.content ?? '';
    const manifest =
      rendered.files.find((file) => file.path.endsWith('/package.json'))?.content ?? '';
    const readme = rendered.files.find((file) => file.path.endsWith('/README.md'))?.content ?? '';
    const generatedTests =
      rendered.files.find((file) => file.path.endsWith('/tests/context.test.ts'))?.content ?? '';
    const generatedFrameworkTests =
      rendered.files.find((file) => file.path.endsWith('/tests/framework.test.ts'))?.content ?? '';
    expect(agent).toContain("from '@google/adk'");
    expect(agent).toContain('GOOGLE_GENAI_API_KEY');
    expect(agent).toContain('runAdmittedAgent');
    expect(agent).toContain('AbortSignal.timeout');
    expect(agent).toContain('maxLlmCalls');
    expect(agent).toContain('errorMessage');
    expect(agent).toContain('throwIfAborted');
    expect(agent).toContain('getSession');
    expect(agent).not.toContain('npx adk');
    expect(agent).not.toContain('openrouter');
    expect(entrypoint).toContain('streamAdmittedAgent');
    expect(agent).toContain('options?.sessionId');
    expect(readme).toContain('Do not run unqualified `npx adk`');
    expect(readme).toContain('cd agents/release-reviewer && npm test');
    expect(generatedTests).toContain('bindWorkspaiProjectRootForTests');
    expect(generatedFrameworkTests).toContain('ScriptedLlm');
    expect(generatedFrameworkTests).toContain('in-memory session continues');
    expect(generatedFrameworkTests).toContain('first chunk before the model finishes');
    expect(generatedFrameworkTests).toContain('tracing is disabled unless opted in');
    expect(agent).toContain("from './tracing.js'");
    expect(agent.indexOf("from './tracing.js'")).toBeLessThan(agent.indexOf("from '@google/adk'"));
    expect(agent).toContain('onText');
    expect(rendered.files.find((file) => file.path.endsWith('/tracing.ts'))?.content).toContain(
      'OTEL_SDK_DISABLED'
    );
    expect(rendered.files.find((file) => file.path.endsWith('/workspai-context.ts'))?.content).toBe(
      agentFrameworkTypeScriptContextSource()
    );
    expect(rendered.files.every((file) => !file.content.includes('openai-agents'))).toBe(true);
    expect(manifest).toContain(
      `"@google/adk": "${packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk')}"`
    );
    expect(manifest).toContain(`"zod": "${packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, 'zod')}"`);
    expect(manifest).toContain('"node": ">=20.19.0"');
    expect(
      rendered.files.every(
        (file) => !/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i.test(file.content)
      )
    ).toBe(true);
    expect(
      googleAdkTypeScriptAdapter.validate({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).status
    ).toBe('passed');
    expect(
      googleAdkTypeScriptAdapter.context({
        projectRoot: root,
        instanceName: 'Release Reviewer',
      }).verificationCommands
    ).toEqual(['cd agents/release-reviewer && npm test']);
  });

  it('renders into a project path that contains spaces and Unicode', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai adk review ★-'));
    temporaryRoots.push(root);
    const python = googleAdkPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    const typescript = googleAdkTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    expect(python.conflicts).toEqual([]);
    expect(typescript.conflicts).toEqual([]);
    expect(python.files.every((file) => !path.isAbsolute(file.path))).toBe(true);
    expect(
      googleAdkPythonAdapter.validate({ projectRoot: root, instanceName: 'Release Reviewer' })
        .status
    ).toBe('passed');
    expect(
      googleAdkTypeScriptAdapter.validate({ projectRoot: root, instanceName: 'Release Reviewer' })
        .status
    ).toBe('passed');
  });

  it('preserves user-authored files and exposes mixed or unsupported attach as blockers', () => {
    const existingFiles = new Map([['agents/release-reviewer/main.py', '# user-owned source\n']]);
    const input = {
      projectRoot: '/tmp/unused',
      instanceName: 'Release Reviewer',
      existingFiles,
    };
    const rendered = googleAdkPythonAdapter.render(input);
    const plan = googleAdkPythonAdapter.plan('attach', input);
    expect(rendered.conflicts).toEqual([
      { path: 'agents/release-reviewer/main.py', reason: 'user-authored-file-exists' },
    ]);
    expect(plan.blockers).toContain('agents/release-reviewer/main.py: user authored file exists');
    expect(() =>
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'blocked plan')
    ).not.toThrow();

    const mixed = googleAdkPythonAdapter.plan('attach', {
      projectRoot: '/tmp/unused',
      instanceName: 'Release Reviewer',
      existingFiles: new Map([
        [
          'agents/mixed/pyproject.toml',
          `dependencies = ["google-adk==${packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk')}"]\n`,
        ],
        [
          'agents/mixed/package.json',
          JSON.stringify({
            dependencies: {
              '@google/adk': packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk'),
            },
          }),
        ],
      ]),
    });
    expect(mixed.status).toBe('blocked');
    expect(mixed.blockers.join(' ')).toMatch(/Mixed Google ADK Python and TypeScript/i);

    const unsupported = googleAdkPythonAdapter.plan('attach', {
      projectRoot: '/tmp/unused',
      instanceName: 'Release Reviewer',
      existingFiles: new Map([
        ['agents/old/pyproject.toml', 'dependencies = ["google-adk==1.0.0"]\n'],
      ]),
    });
    expect(unsupported.status).toBe('blocked');
    expect(unsupported.blockers.join(' ')).toMatch(/outside the supported range/i);
  });

  it('refreshes an owned file only when the prior receipt digest proves ownership', () => {
    const initial = googleAdkTypeScriptAdapter.render({
      projectRoot: '/tmp/unused',
      instanceName: 'Release Reviewer',
    });
    const entrypoint = initial.files.find((file) => file.path.endsWith('/main.ts'))!;
    const existingFiles = new Map([[entrypoint.path, entrypoint.content]]);
    expect(
      googleAdkTypeScriptAdapter.render({
        projectRoot: '/tmp/unused',
        instanceName: 'Release Reviewer',
        existingFiles,
      }).conflicts
    ).toContainEqual({ path: entrypoint.path, reason: 'ownership-unproven' });
    const admitted = googleAdkTypeScriptAdapter.render({
      projectRoot: '/tmp/unused',
      instanceName: 'Release Reviewer',
      existingFiles,
      ownershipLedger: new Map([[entrypoint.path, entrypoint.sha256]]),
    });
    expect(admitted.conflicts).toEqual([]);
    expect(admitted.files.some((file) => file.path === entrypoint.path)).toBe(false);
  });

  it('resolves one explicit runtime and fails closed on missing or ambiguous runtimes', () => {
    expect(googleAdkPythonAdapter.resolveRuntime(['python@3.10.21']).status).toBe('resolved');
    expect(googleAdkTypeScriptAdapter.resolveRuntime(['node@20.19.0']).status).toBe('resolved');
    expect(googleAdkTypeScriptAdapter.resolveRuntime(['python@3.10.21']).status).toBe(
      'unavailable'
    );
    expect(googleAdkTypeScriptAdapter.resolveRuntime(['node@20.19.0', 'node@22.20.0']).status).toBe(
      'ambiguous'
    );
  });

  it('does not rewrite a previously rendered sibling instance', () => {
    const python = googleAdkPythonAdapter.render({
      projectRoot: '/tmp/unused',
      instanceName: 'First Reviewer',
    });
    const typescript = googleAdkTypeScriptAdapter.render({
      projectRoot: '/tmp/unused',
      instanceName: 'Second Reviewer',
      existingFiles: new Map(python.files.map((file) => [file.path, file.content])),
    });
    expect(typescript.conflicts).toEqual([]);
    expect(typescript.files.every((file) => !file.path.includes('first-reviewer'))).toBe(true);
    expect(python.files.every((file) => !file.path.includes('second-reviewer'))).toBe(true);
  });
});
