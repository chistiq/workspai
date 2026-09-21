import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModelGatewayAdapter } from '../model-gateways/adapter.js';
import {
  MODEL_GATEWAY_LIFECYCLE_STAGES,
  MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES,
  writeGatewayWorkspaiMetadata,
} from '../model-gateways/generated.js';
import { createModelGatewayRegistry } from '../model-gateways/registry.js';
import {
  generateModelGatewayProject,
  listModelGatewayProjectKits,
  lookupModelGatewayProjectKit,
} from '../model-gateways/project-kits.js';
import { openRouterPythonAdapter } from '../model-gateways/adapters/openrouter/python.js';
import { openRouterTypeScriptAdapter } from '../model-gateways/adapters/openrouter/typescript.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

function syntheticAdapter(kitId: string): ModelGatewayAdapter {
  return {
    id: `synthetic-${kitId}`,
    gatewayId: 'synthetic',
    gatewayName: 'Synthetic',
    kitId,
    aliases: [`synthetic.${kitId}`],
    label: 'Synthetic · Test',
    runtime: 'node',
    requiredEnvironment: ['SYNTHETIC_TOKEN'],
    versionBaselineId: 'synthetic',
    capabilities: MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES,
    lifecycle: { stages: MODEL_GATEWAY_LIFECYCLE_STAGES },
    attach: 'unsupported',
    async generate(input) {
      await fsExtra.outputFile(path.join(input.projectPath, 'synthetic.txt'), input.projectName);
    },
  };
}

describe('model gateway adapter registry', () => {
  it('derives production kits from registered OpenRouter adapters', () => {
    expect(listModelGatewayProjectKits().map((kit) => kit.id)).toEqual([
      openRouterTypeScriptAdapter.kitId,
      openRouterPythonAdapter.kitId,
    ]);
    expect(lookupModelGatewayProjectKit('openrouter.typescript')?.adapterId).toBe(
      openRouterTypeScriptAdapter.id
    );
    const cloned = lookupModelGatewayProjectKit('gateway.openrouter.python');
    cloned?.aliases.splice(0);
    expect(
      lookupModelGatewayProjectKit('gateway.openrouter.python')?.aliases.length
    ).toBeGreaterThan(0);
  });

  it('dispatches a synthetic adapter without editing OpenRouter production branches', async () => {
    const registry = createModelGatewayRegistry([
      openRouterTypeScriptAdapter,
      openRouterPythonAdapter,
      syntheticAdapter('gateway.synthetic.node'),
    ]);
    expect(registry.listKits().map((kit) => kit.id)).toContain('gateway.synthetic.node');
    const kit = registry.lookupKit('synthetic.gateway.synthetic.node');
    if (!kit) throw new Error('missing synthetic kit');
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-gateway-synth-'));
    roots.push(root);
    await registry.generate({ projectPath: root, projectName: 'synth-app', kit });
    await writeGatewayWorkspaiMetadata({
      projectPath: root,
      projectName: 'synth-app',
      kit,
      generatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(await fsExtra.readFile(path.join(root, 'synthetic.txt'), 'utf8')).toBe('synth-app');
    const metadata = await fsExtra.readJson(path.join(root, '.workspai', 'project.json'));
    expect(metadata.contracts.consumes).toEqual(['synthetic']);
    expect(metadata.framework).toBe('synthetic');
    expect(listModelGatewayProjectKits().map((entry) => entry.id)).not.toContain(
      'gateway.synthetic.node'
    );
  });

  it('rejects duplicate adapter, kit, and alias registration', () => {
    expect(() =>
      createModelGatewayRegistry([openRouterTypeScriptAdapter, openRouterTypeScriptAdapter])
    ).toThrow(/Duplicate model gateway adapter/);
    expect(() =>
      createModelGatewayRegistry([
        openRouterTypeScriptAdapter,
        { ...openRouterPythonAdapter, kitId: openRouterTypeScriptAdapter.kitId },
      ])
    ).toThrow(/Duplicate model gateway kit/);
    expect(() =>
      createModelGatewayRegistry([
        openRouterTypeScriptAdapter,
        { ...openRouterPythonAdapter, aliases: [...openRouterTypeScriptAdapter.aliases] },
      ])
    ).toThrow(/Duplicate model gateway alias/);
  });

  it('does not require generateModelGatewayProject to branch on kit id for OpenRouter kits', async () => {
    const kit = listModelGatewayProjectKits()[0];
    if (!kit) throw new Error('missing production kit');
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-gateway-dispatch-'));
    roots.push(root);
    await generateModelGatewayProject({
      projectPath: root,
      projectName: 'dispatch-kit',
      kit,
      generatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(await fsExtra.pathExists(path.join(root, '.workspai', 'project.json'))).toBe(true);
  });
});
