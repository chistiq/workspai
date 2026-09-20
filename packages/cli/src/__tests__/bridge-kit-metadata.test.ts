import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { enrichBridgeBackedProjectMetadata } from '../utils/bridge-kit-metadata.js';
import { getVersion } from '../update-checker.js';

describe('bridge-backed project metadata enrichment', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
  });

  async function makeProjectRoot(prefix: string): Promise<string> {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  it('merges Workspai identity into Core FastAPI markers without dropping Core provenance', async () => {
    const root = await makeProjectRoot('workspai-bridge-fastapi-');
    await fsExtra.outputFile(
      path.join(root, 'pyproject.toml'),
      '[tool.poetry]\nname = "quantum-api"\nversion = "0.1.0"\n'
    );
    await fsExtra.outputJson(path.join(root, '.workspai', 'project.json'), {
      kit_name: 'fastapi.standard',
      profile: 'fastapi/standard',
      created_at: '2026-09-19T23:52:14.240509+00:00',
      rapidkit_version: '0.6.1',
    });
    await fsExtra.outputJson(path.join(root, '.workspai', 'context.json'), { engine: 'pip' });

    expect(await enrichBridgeBackedProjectMetadata(root)).toBe(true);

    expect(await fsExtra.readJson(path.join(root, '.workspai', 'project.json'))).toMatchObject({
      schema_version: '1.0',
      name: path.basename(root),
      slug: path.basename(root),
      kind: 'backend',
      runtime: 'python',
      framework: 'fastapi',
      kit_name: 'fastapi.standard',
      profile: 'fastapi/standard',
      created_at: '2026-09-19T23:52:14.240509+00:00',
      engine: 'poetry',
      rapidkit_version: '0.6.1',
      rapidkit_core_version: '0.6.1',
      workspai_version: getVersion(),
      generated_by: 'workspai',
      generator: { id: 'fastapi.standard', source: 'rapidkit-core-bridge', official: false },
    });
    expect(await fsExtra.readJson(path.join(root, '.workspai', 'context.json'))).toMatchObject({
      engine: 'poetry',
      runtime: 'python',
      framework: 'fastapi',
      kind: 'backend',
      source: 'core-bridge',
    });
  });

  it('keeps NestJS Python control-plane engine in context.json and records node runtime separately', async () => {
    const workspace = await makeProjectRoot('workspai-bridge-ws-');
    const root = path.join(workspace, 'vault-api');
    await fsExtra.ensureDir(root);
    await fsExtra.outputJson(path.join(workspace, '.workspai-workspace'), {
      signature: 'RAPIDKIT_WORKSPACE',
      createdBy: 'workspai-cli',
      version: '0.76.0',
      createdAt: '2026-09-19T23:47:22.872Z',
      name: 'my-workspace',
      metadata: { npm: { installMethod: 'venv' } },
    });
    await fsExtra.outputJson(path.join(root, '.workspai', 'project.json'), {
      kit_name: 'nestjs.standard',
      profile: 'nestjs/standard',
      created_at: '2026-09-20T00:20:34.749399+00:00',
      rapidkit_version: '0.6.1',
    });
    await fsExtra.outputJson(path.join(root, '.workspai', 'context.json'), { engine: 'pip' });

    expect(await enrichBridgeBackedProjectMetadata(root)).toBe(true);

    expect(await fsExtra.readJson(path.join(root, '.workspai', 'project.json'))).toMatchObject({
      schema_version: '1.0',
      runtime: 'node',
      framework: 'nestjs',
      kit_name: 'nestjs.standard',
      profile: 'nestjs/standard',
      engine: 'npm',
      rapidkit_core_version: '0.6.1',
      generated_by: 'workspai',
    });
    expect(await fsExtra.readJson(path.join(root, '.workspai', 'context.json'))).toMatchObject({
      engine: 'venv',
      runtime: 'node',
      framework: 'nestjs',
      source: 'core-bridge',
    });
  });

  it('does not rewrite official or npm-owned kit metadata', async () => {
    const root = await makeProjectRoot('workspai-bridge-official-');
    const projectJson = {
      schema_version: '1.0',
      kit_name: 'desktop.electron',
      runtime: 'node',
      generated_by: 'workspai',
    };
    await fsExtra.outputJson(path.join(root, '.workspai', 'project.json'), projectJson);

    expect(await enrichBridgeBackedProjectMetadata(root)).toBe(false);
    expect(await fsExtra.readJson(path.join(root, '.workspai', 'project.json'))).toEqual(
      projectJson
    );
  });
});
