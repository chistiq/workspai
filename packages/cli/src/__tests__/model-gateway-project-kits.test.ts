import os from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  describeModelGatewayProjectKits,
  generateModelGatewayProject,
  isModelGatewayProjectKit,
  listModelGatewayProjectKits,
  lookupModelGatewayProjectKit,
} from '../model-gateways/project-kits.js';
import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  EXCLUDED_MODEL_GATEWAY_LANGUAGES,
  MODEL_GATEWAY_BASELINES_REVIEWED_AT,
  packageVersion,
} from '../model-gateways/version-policy.js';
import { openRouterTypeScriptSdkVersion } from '../model-gateways/adapters/openrouter/typescript.js';
import { openRouterPythonSdkVersion } from '../model-gateways/adapters/openrouter/python.js';
import { buildPolyglotLifecyclePlan } from '../polyglot-lifecycle-plan.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('model gateway project kits', () => {
  it('publishes only stable OpenRouter Client SDK kits', () => {
    expect(describeModelGatewayProjectKits().map((kit) => kit.id)).toEqual([
      'gateway.openrouter.typescript',
      'gateway.openrouter.python',
    ]);
    expect(listModelGatewayProjectKits().map((kit) => kit.id)).toEqual([
      'gateway.openrouter.typescript',
      'gateway.openrouter.python',
    ]);
    expect(isModelGatewayProjectKit('gateway.openrouter.typescript')).toBe(true);
    expect(isModelGatewayProjectKit('openrouter.python')).toBe(true);
    expect(isModelGatewayProjectKit('gateway.openrouter.ts')).toBe(true);
    expect(isModelGatewayProjectKit('openrouter')).toBe(false);
    expect(isModelGatewayProjectKit('agent.openrouter.typescript')).toBe(false);
    expect(lookupModelGatewayProjectKit('openrouter-typescript')?.id).toBe(
      'gateway.openrouter.typescript'
    );
    const first = lookupModelGatewayProjectKit('gateway.openrouter.python');
    expect(first?.adapterId).toBe('openrouter-python');
    if (!first) throw new Error('Expected Python gateway kit.');
    first.aliases.length = 0;
    expect(
      lookupModelGatewayProjectKit('gateway.openrouter.python')?.aliases.length
    ).toBeGreaterThan(0);
  });

  it('pins SDK versions from the reviewed baseline document', () => {
    expect(MODEL_GATEWAY_BASELINES_REVIEWED_AT).toBe('2026-09-21');
    const typescript = BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.find(
      (entry) => entry.adapterId === 'openrouter-typescript'
    );
    const python = BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.find(
      (entry) => entry.adapterId === 'openrouter-python'
    );
    expect(typescript?.sdkVersion).toBe('1.3.11');
    expect(python?.sdkVersion).toBe('1.2.11');
    expect(openRouterTypeScriptSdkVersion()).toBe(packageVersion(typescript!, '@openrouter/sdk'));
    expect(openRouterPythonSdkVersion()).toBe(packageVersion(python!, 'openrouter'));
    expect(EXCLUDED_MODEL_GATEWAY_LANGUAGES).toEqual([
      expect.objectContaining({
        language: 'go',
        latestObservedVersion: 'v0.8.11',
        declaredMaturity: 'beta',
      }),
    ]);
  });

  it('emits deterministic TypeScript and Python gateway projects without secrets', async () => {
    for (const kit of listModelGatewayProjectKits()) {
      const first = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-gateway-a-'));
      const second = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-gateway-b-'));
      roots.push(first, second);
      const generatedAt = '2026-09-21T12:00:00.000Z';
      await generateModelGatewayProject({
        projectPath: first,
        projectName: 'route-gateway',
        kit,
        generatedAt,
      });
      await generateModelGatewayProject({
        projectPath: second,
        projectName: 'route-gateway',
        kit,
        generatedAt,
      });
      const left = await collectGeneratedText(first);
      const right = await collectGeneratedText(second);
      expect(left).toEqual(right);
      expect(await fsExtra.readJson(path.join(first, '.workspai', 'project.json'))).toMatchObject({
        kind: 'gateway',
        category: 'gateway',
        kit: kit.id,
        framework: 'openrouter',
      });
      for (const relativePath of [
        'README.md',
        '.env.example',
        'gateway.policy.json',
        '.workspai/project.json',
      ]) {
        const contents = await fsExtra.readFile(path.join(first, relativePath), 'utf8');
        expect(contents).not.toMatch(/sk-or-[A-Za-z0-9]{8,}/);
        expect(contents).not.toMatch(/OPENROUTER_API_KEY=.+/);
      }
      const envExample = await fsExtra.readFile(path.join(first, '.env.example'), 'utf8');
      expect(envExample).toContain('OPENROUTER_API_KEY=');
      expect(envExample).toContain('OPENROUTER_MODEL=');
      if (kit.runtime === 'node') {
        const packageJson = await fsExtra.readJson(path.join(first, 'package.json'));
        expect(packageJson.dependencies['@openrouter/sdk']).toBe('1.3.11');
        expect(packageJson.devDependencies.typescript).toBe('5.9.3');
        expect(packageJson.devDependencies['@types/node']).toBe('22.20.3');
        expect(JSON.stringify(packageJson)).not.toMatch(/\^|~|latest|\*/);
        const policy = await fsExtra.readFile(path.join(first, 'gateway.policy.json'), 'utf8');
        expect(policy).toContain('enforceDistillableText');
        const config = await fsExtra.readFile(path.join(first, 'src', 'config.ts'), 'utf8');
        expect(config).toContain('unknown field');
        expect(config).toContain('partition');
        const gateway = await fsExtra.readFile(
          path.join(first, 'src', 'openrouter-gateway.ts'),
          'utf8'
        );
        expect(gateway).toContain('toGatewayUpstreamError');
        expect(gateway).toContain('releaseOpenedStream');
        const plan = buildPolyglotLifecyclePlan(first);
        expect(plan.units[0]?.stages.map((stage) => stage.stage)).toEqual(
          expect.arrayContaining(['init', 'test', 'build', 'start'])
        );
      } else {
        const pyproject = await fsExtra.readFile(path.join(first, 'pyproject.toml'), 'utf8');
        expect(pyproject).toContain('openrouter==1.2.11');
        expect(pyproject).not.toContain('openrouter>=');
        const policy = await fsExtra.readFile(path.join(first, 'gateway.policy.json'), 'utf8');
        expect(policy).toContain('enforce_distillable_text');
        const config = await fsExtra.readFile(
          path.join(first, 'src', 'model_gateway', 'config.py'),
          'utf8'
        );
        expect(config).toContain('default_policy_root');
        expect(config).not.toContain('root or Path.cwd()');
        const gateway = await fsExtra.readFile(
          path.join(first, 'src', 'model_gateway', 'gateway.py'),
          'utf8'
        );
        expect(gateway).toContain('to_gateway_upstream_error');
        expect(gateway).toContain('_release_stream');
        const plan = buildPolyglotLifecyclePlan(first);
        expect(plan.units[0]?.stages.find((stage) => stage.stage === 'test')?.command).toContain(
          'unittest'
        );
        expect(plan.units[0]?.stages.find((stage) => stage.stage === 'build')?.command).toContain(
          'compileall'
        );
        expect(plan.units[0]?.stages.find((stage) => stage.stage === 'start')?.command).toContain(
          'main.py'
        );
      }
    }
  });
});

async function collectGeneratedText(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fsExtra.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      const relative = path.relative(root, target).split(path.sep).join('/');
      const contents = await fsExtra.readFile(target, 'utf8');
      files.push(`${relative}\n${contents}`);
    }
  };
  await visit(root);
  return files;
}
