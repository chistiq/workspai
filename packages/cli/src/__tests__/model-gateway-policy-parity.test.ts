import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  generateModelGatewayProject,
  listModelGatewayProjectKits,
} from '../model-gateways/project-kits.js';
import {
  OPENROUTER_OVERFLOW_PRICE,
  OPENROUTER_POLICY_PARITY_CASES,
} from '../model-gateways/adapters/openrouter/policy-parity.js';
import { getDefaultPythonCommand } from '../utils/platform-capabilities.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('OpenRouter policy parity corpus', () => {
  it('exports the required accept/reject ids', () => {
    const ids = OPENROUTER_POLICY_PARITY_CASES.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'unknown-root-field',
        'unknown-provider-field',
        'unknown-max-price-key',
        'unknown-percentile-key',
        'unknown-sort-field',
        'require-parameters-number',
        'zdr-number',
        'empty-model-name',
        'whitespace-provider-name',
        'duplicate-models',
        'duplicate-order',
        'only-ignore-overlap',
        'ignored-provider-in-order',
        'unsupported-quantization',
        'invalid-sort',
        'invalid-sort-partition',
        'zdr-with-data-collection-allow',
        'timeout-zero',
        'timeout-one',
        'timeout-max',
        'timeout-over-max',
        'max-price-number',
        'max-price-negative',
        'max-price-malformed',
        'max-price-overflow',
        'max-price-zero',
        'max-price-micro',
        'max-price-positive',
        'valid-minimal-policy',
        'valid-complete-policy',
      ])
    );
    const overflow = OPENROUTER_POLICY_PARITY_CASES.find(
      (entry) => entry.id === 'max-price-overflow'
    );
    expect(JSON.stringify(overflow)).toContain(OPENROUTER_OVERFLOW_PRICE);
    expect(OPENROUTER_OVERFLOW_PRICE).toHaveLength(400);
  });

  it('executes the generated Python validator for the shared corpus', async () => {
    const kit = listModelGatewayProjectKits().find(
      (entry) => entry.id === 'gateway.openrouter.python'
    );
    if (!kit) throw new Error('missing Python gateway kit');
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-or-parity-'));
    roots.push(root);
    await generateModelGatewayProject({
      projectPath: root,
      projectName: 'parity-gateway',
      kit,
    });
    await fsExtra.writeJson(path.join(root, 'parity-cases.json'), OPENROUTER_POLICY_PARITY_CASES);
    const python = getDefaultPythonCommand();
    const script = [
      'import importlib.util, json, os, sys, types',
      'from pathlib import Path',
      'root = Path(sys.argv[1])',
      'package_dir = root / "src" / "model_gateway"',
      'pkg = types.ModuleType("model_gateway")',
      'pkg.__path__ = [str(package_dir)]',
      'sys.modules["model_gateway"] = pkg',
      '',
      'def load_generated(name, filename):',
      '    spec = importlib.util.spec_from_file_location(name, package_dir / filename)',
      '    module = importlib.util.module_from_spec(spec)',
      '    sys.modules[name] = module',
      '    spec.loader.exec_module(module)',
      '    return module',
      '',
      'os.environ["OPENROUTER_API_KEY"] = "sk-or-test"',
      'os.environ["OPENROUTER_MODEL"] = "openrouter/test-model"',
      'load_generated("model_gateway.redact", "redact.py")',
      'errors = load_generated("model_gateway.errors", "errors.py")',
      'config = load_generated("model_gateway.config", "config.py")',
      'load_gateway_config = config.load_gateway_config',
      'to_sdk_provider = config.to_sdk_provider',
      'GatewayConfigurationError = errors.GatewayConfigurationError',
      'cases = json.loads((root / "parity-cases.json").read_text(encoding="utf-8"))',
      'failed = []',
      'for case in cases:',
      '    try:',
      '        if case["decision"] == "reject":',
      '            try:',
      '                load_gateway_config(policy=case["python"])',
      '            except GatewayConfigurationError as error:',
      '                needle = case.get("needle")',
      '                if needle and needle not in str(error):',
      '                    failed.append(case["id"] + ": missing needle")',
      '            else:',
      '                failed.append(case["id"] + ": expected reject")',
      '        else:',
      '            config = load_gateway_config(policy=case["python"])',
      '            mapped = to_sdk_provider(config.provider) or {}',
      '            if case["id"] == "max-price-zero" and mapped["max_price"]["prompt"] != "0":',
      '                failed.append("max-price-zero: string not preserved")',
      '            if case["id"] == "max-price-micro" and mapped["max_price"]["prompt"] != "0.000001":',
      '                failed.append("max-price-micro: string not preserved")',
      '    except Exception as error:',
      '        failed.append(case["id"] + ": " + type(error).__name__)',
      'try:',
      '    load_gateway_config(policy={"provider": {"max_price": {"prompt": "9" * 400}}})',
      'except GatewayConfigurationError:',
      '    pass',
      'else:',
      '    failed.append("overflow-direct: expected reject")',
      'print("parity-ok" if not failed else "parity-failed:" + ",".join(failed))',
      'raise SystemExit(0 if not failed else 1)',
    ].join('\n');
    const env = { ...process.env, CI: '1' };
    delete env.OPENROUTER_API_KEY;
    delete env.OPENROUTER_MODEL;
    const result = spawnSync(python, ['-c', script, root], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env,
      timeout: 30_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(output, output).toContain('parity-ok');
    expect(result.status).toBe(0);
    expect(output.toLowerCase()).not.toContain('sk-or-live');
  });
});
