import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkspaceContract,
  buildWorkspaceContractGraph,
  syncWorkspaceContract,
  verifyWorkspaceContract,
  writeWorkspaceContract,
  WORKSPACE_CONTRACT_PATH,
  WorkspaceContractVerificationError,
} from '../utils/workspace-contract.js';
import { WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH } from '../utils/workspace-registry-summary.js';
import { upsertImportedProjectsRegistry } from '../imported-projects-registry.js';

describe('workspace contract registry', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    delete process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fsExtra.remove(dir);
    }
  });

  it('builds a canonical contract from discovered RapidKit projects', async () => {
    const workspacePath = await makeTempDir('rk-contract-ws-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'team-ws',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'orders-api', '.rapidkit', 'project.json'), {
      runtime: 'python',
      kit_name: 'fastapi.standard',
      modules: ['auth/core', 'billing/stripe_payment'],
    });

    const contract = await buildWorkspaceContract({
      workspacePath,
      now: new Date('2026-06-02T00:00:00.000Z'),
    });

    expect(contract.kind).toBe('rapidkit.workspace.contract');
    expect(contract.workspace.name).toBe('team-ws');
    expect(contract.projects).toHaveLength(1);
    expect(contract.projects[0]).toMatchObject({
      slug: 'orders-api',
      relativePath: 'orders-api',
      runtime: 'python',
      framework: 'fastapi',
      kit: 'fastapi.standard',
      modules: ['auth/core', 'billing/stripe_payment'],
    });
  });

  it('discovers context.json-only projects when building a workspace contract', async () => {
    const workspacePath = await makeTempDir('rk-contract-context-');
    await fsExtra.outputJson(path.join(workspacePath, 'web-ui', '.rapidkit', 'context.json'), {
      name: 'web-ui',
      runtime: 'node',
      framework: 'vite',
      kit: 'vite.standard',
    });

    const contract = await buildWorkspaceContract({ workspacePath });
    expect(contract.projects).toHaveLength(1);
    expect(contract.projects[0]).toMatchObject({
      slug: 'web-ui',
      relativePath: 'web-ui',
      runtime: 'node',
      framework: 'vite',
      kit: 'vite.standard',
    });
  });

  it('excludes archived metadata and deduplicates stale imported copies of local projects', async () => {
    const workspacePath = await makeTempDir('rk-contract-archive-filter-');
    const externalCopy = await makeTempDir('rk-contract-external-copy-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });
    await fsExtra.outputJson(
      path.join(
        workspacePath,
        '.workspai',
        'archive',
        'projects',
        'old-api',
        '.workspai',
        'project.json'
      ),
      { runtime: 'node', kit_name: 'nestjs.standard' }
    );
    await fsExtra.outputJson(path.join(externalCopy, '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });
    await upsertImportedProjectsRegistry(workspacePath, [
      {
        name: 'api',
        path: externalCopy,
        relativePath: 'api',
        relationship: 'imported',
        source: 'local-folder',
        stack: 'nestjs',
        runtime: 'node',
        framework: 'nestjs',
        frameworkDisplayName: 'NestJS',
        supportTier: 'extended',
        moduleSupport: false,
        confidence: 'high',
        importedAt: '2026-07-13T00:00:00.000Z',
      },
    ]);

    const contract = await buildWorkspaceContract({ workspacePath });

    expect(contract.projects).toHaveLength(1);
    expect(contract.projects[0]).toMatchObject({
      slug: 'api',
      relativePath: 'api',
      source: 'workspace',
    });

    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      ...contract,
      projects: [
        {
          ...contract.projects[0],
          relativePath: 'external/api',
          source: 'local-folder',
          relationship: 'imported',
          externalPath: externalCopy,
        },
      ],
    });
    const synced = await syncWorkspaceContract({ workspacePath });
    expect(synced.contract.projects[0]).toMatchObject({
      slug: 'api',
      relativePath: 'api',
      source: 'workspace',
    });
    expect(synced.contract.projects[0].externalPath).toBeUndefined();
  });

  it('removes discovery-managed projects that have been archived while preserving manual entries', async () => {
    const workspacePath = await makeTempDir('rk-contract-prune-managed-');
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-07-13T00:00:00.000Z',
      workspace: { name: 'prune-ws' },
      projects: [
        {
          slug: 'archived-api',
          relativePath: 'archived-api',
          source: 'workspace',
          modules: [],
          ports: [],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
        {
          slug: 'manual-service',
          relativePath: 'manual-service',
          modules: [],
          ports: [],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
      ],
    });

    const result = await syncWorkspaceContract({ workspacePath });

    expect(result.contract.projects.map((project) => project.slug)).toEqual(['manual-service']);
  });

  it('treats the current workspace manifest profile as authoritative during contract sync', async () => {
    const workspacePath = await makeTempDir('rk-contract-profile-sync-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'profile-ws',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-07-13T00:00:00.000Z',
      workspace: { name: 'profile-ws', profile: 'minimal' },
      projects: [],
    });

    const result = await syncWorkspaceContract({ workspacePath });

    expect(result.contract.workspace).toEqual({ name: 'profile-ws', profile: 'polyglot' });
    expect(await fsExtra.readJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH))).toMatchObject(
      {
        workspace: { name: 'profile-ws', profile: 'polyglot' },
      }
    );
  });

  it('writes and verifies a valid workspace contract', async () => {
    const workspacePath = await makeTempDir('rk-contract-write-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });

    const { contractPath } = await writeWorkspaceContract({ workspacePath });
    expect(contractPath).toBe(path.join(workspacePath, WORKSPACE_CONTRACT_PATH));

    const result = await verifyWorkspaceContract({ workspacePath });
    expect(result.status).toBe('passed');
    expect(result.projectCount).toBe(1);
    const contract = await fsExtra.readJson(contractPath);
    expect(contract.projects[0].ports).toEqual([{ name: 'http', port: 3000, protocol: 'http' }]);
  });

  it('does not rewrite canonical contract artifacts when sync has no semantic changes', async () => {
    const workspacePath = await makeTempDir('rk-contract-idempotent-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });

    await syncWorkspaceContract({
      workspacePath,
      now: new Date('2026-07-18T00:00:00.000Z'),
    });
    const contractPath = path.join(workspacePath, WORKSPACE_CONTRACT_PATH);
    const summaryPath = path.join(workspacePath, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH);
    const before = await Promise.all([
      fsExtra.readFile(contractPath, 'utf8'),
      fsExtra.readFile(summaryPath, 'utf8'),
    ]);

    await syncWorkspaceContract({
      workspacePath,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });

    await expect(fsExtra.readFile(contractPath, 'utf8')).resolves.toBe(before[0]);
    await expect(fsExtra.readFile(summaryPath, 'utf8')).resolves.toBe(before[1]);
  });

  it('uses explicit project metadata ports instead of kit defaults', async () => {
    const workspacePath = await makeTempDir('rk-contract-explicit-port-');
    await fsExtra.outputJson(path.join(workspacePath, 'web', '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nextjs',
      frontend: { default_port: 3000 },
    });
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
      ports: [{ name: 'http', port: 3001, protocol: 'http' }],
    });

    const { contract } = await writeWorkspaceContract({ workspacePath });
    expect(contract.projects.find((project) => project.slug === 'api')?.ports).toEqual([
      { name: 'http', port: 3001, protocol: 'http' },
    ]);
    expect(contract.projects.find((project) => project.slug === 'web')?.ports).toEqual([
      { name: 'http', port: 3000, protocol: 'http' },
    ]);
    await expect(verifyWorkspaceContract({ workspacePath })).resolves.toMatchObject({
      status: 'passed',
    });
  });

  it('assigns deterministic available ports when project metadata defaults collide', async () => {
    const workspacePath = await makeTempDir('rk-contract-port-allocation-');
    for (const projectName of ['orders', 'users']) {
      await fsExtra.outputJson(path.join(workspacePath, projectName, '.workspai', 'project.json'), {
        runtime: 'python',
        kit_name: 'fastapi.standard',
        ports: [{ name: 'http', port: 8000, protocol: 'http' }],
      });
    }

    const { contract } = await writeWorkspaceContract({ workspacePath, strict: true });
    expect(contract.projects.map((project) => project.ports[0]?.port).sort()).toEqual([8000, 8001]);
  });

  it('syncs discovered projects while preserving manually declared contracts', async () => {
    const workspacePath = await makeTempDir('rk-contract-sync-');
    await fsExtra.outputJson(path.join(workspacePath, 'orders', '.rapidkit', 'project.json'), {
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-02T00:00:00.000Z',
      workspace: { name: 'sync-ws' },
      projects: [
        {
          slug: 'orders',
          relativePath: 'orders',
          runtime: 'python',
          framework: 'fastapi',
          kit: 'fastapi.standard',
          modules: [],
          ports: [{ name: 'http', port: 8100, protocol: 'http' }],
          contracts: {
            owns: ['Order'],
            apis: [{ name: 'Orders API', basePath: '/api/orders' }],
            publishes: ['OrderCreated'],
            consumes: [],
            dependsOn: [],
            env: ['DATABASE_URL'],
          },
        },
      ],
    });
    await fsExtra.outputJson(path.join(workspacePath, 'users', '.rapidkit', 'project.json'), {
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const result = await syncWorkspaceContract({ workspacePath });
    expect(result.verification.status).toBe('passed');
    expect(result.addedProjects).toEqual(['users']);
    const orders = result.contract.projects.find((project) => project.slug === 'orders');
    const users = result.contract.projects.find((project) => project.slug === 'users');
    expect(orders?.ports[0].port).toBe(8100);
    expect(orders?.contracts.owns).toEqual(['Order']);
    expect(users?.ports[0].port).toBe(8000);
  });

  it('models adopted external projects with safe contract-relative paths', async () => {
    const workspacePath = await makeTempDir('rk-contract-adopt-ws-');
    const externalProjectPath = await makeTempDir('rk-contract-adopt-next-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'adopt-ws',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(externalProjectPath, '.rapidkit', 'project.json'), {
      name: 'web',
      runtime: 'node',
      framework: 'nextjs',
      kit_name: 'adopted.nextjs',
      modules: [],
    });
    await upsertImportedProjectsRegistry(workspacePath, [
      {
        name: 'web',
        path: externalProjectPath,
        relativePath: path.relative(workspacePath, externalProjectPath).replace(/\\/g, '/'),
        relationship: 'adopted',
        source: 'adopted-local',
        stack: 'nextjs',
        runtime: 'node',
        framework: 'nextjs',
        frameworkDisplayName: 'Next.js',
        supportTier: 'extended',
        moduleSupport: false,
        confidence: 'high',
        importedAt: '2026-06-14T00:00:00.000Z',
      },
    ]);

    const result = await syncWorkspaceContract({ workspacePath });
    const web = result.contract.projects.find((project) => project.slug === 'web');

    expect(result.verification.status).toBe('passed');
    expect(web).toMatchObject({
      slug: 'web',
      relativePath: 'external/web',
      externalPath: externalProjectPath,
      relationship: 'adopted',
      source: 'adopted-local',
      runtime: 'node',
      framework: 'nextjs',
      kit: 'adopted.nextjs',
    });
  });

  it('does not preserve a synthetic HTTP port for an adopted VS Code extension', async () => {
    const workspacePath = await makeTempDir('rk-contract-vscode-ws-');
    const externalProjectPath = await makeTempDir('rk-contract-vscode-project-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'extension-ws',
    });
    await fsExtra.outputJson(path.join(externalProjectPath, '.workspai', 'project.json'), {
      name: 'extension',
      runtime: 'node',
      framework: 'vscode-extension',
      kit_name: 'adopted.vscode-extension',
      modules: [],
    });
    await upsertImportedProjectsRegistry(workspacePath, [
      {
        name: 'extension',
        path: externalProjectPath,
        relativePath: path.relative(workspacePath, externalProjectPath).replace(/\\/g, '/'),
        relationship: 'adopted',
        source: 'adopted-local',
        stack: 'vscode-extension',
        runtime: 'node',
        framework: 'vscode-extension',
        frameworkDisplayName: 'VS Code Extension',
        supportTier: 'extended',
        moduleSupport: false,
        confidence: 'high',
        importedAt: '2026-08-10T00:00:00.000Z',
      },
    ]);
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-08-10T00:00:00.000Z',
      workspace: { name: 'extension-ws' },
      projects: [
        {
          slug: 'extension',
          relativePath: 'external/extension',
          source: 'adopted-local',
          relationship: 'adopted',
          externalPath: externalProjectPath,
          runtime: 'node',
          framework: 'vscode-extension',
          kit: 'adopted.vscode-extension',
          modules: [],
          ports: [{ name: 'http', port: 3000, protocol: 'http' }],
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

    const result = await syncWorkspaceContract({ workspacePath });

    expect(result.contract.projects.find((project) => project.slug === 'extension')?.ports).toEqual(
      []
    );
  });

  it('refreshes an adopted generic Python port from Docker evidence', async () => {
    const workspacePath = await makeTempDir('rk-contract-python-ws-');
    const externalProjectPath = await makeTempDir('rk-contract-python-project-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'python-ws',
    });
    await fsExtra.outputJson(path.join(externalProjectPath, '.workspai', 'project.json'), {
      name: 'graph-tool',
      runtime: 'python',
      framework: 'python',
      kit_name: 'adopted.python',
    });
    await fsExtra.outputFile(
      path.join(externalProjectPath, 'Dockerfile'),
      'FROM python:3.12-slim\nEXPOSE 8080\n'
    );
    await upsertImportedProjectsRegistry(workspacePath, [
      {
        name: 'graph-tool',
        path: externalProjectPath,
        relativePath: path.relative(workspacePath, externalProjectPath).replace(/\\/g, '/'),
        relationship: 'adopted',
        source: 'adopted-local',
        stack: 'python',
        runtime: 'python',
        framework: 'python',
        frameworkDisplayName: 'Python',
        supportTier: 'observed',
        moduleSupport: false,
        confidence: 'medium',
        importedAt: '2026-08-10T00:00:00.000Z',
      },
    ]);
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'python-ws' },
      projects: [
        {
          slug: 'graph-tool',
          relativePath: 'external/graph-tool',
          source: 'adopted-local',
          relationship: 'adopted',
          externalPath: externalProjectPath,
          runtime: 'python',
          framework: 'python',
          kit: 'adopted.python',
          modules: [],
          ports: [{ name: 'http', port: 8000, protocol: 'http' }],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
      ],
    });

    const result = await syncWorkspaceContract({ workspacePath });
    expect(
      result.contract.projects.find((project) => project.slug === 'graph-tool')?.ports
    ).toEqual([{ name: 'http', port: 8080, protocol: 'http' }]);
  });

  it('refreshes managed adoption runtime metadata after source re-detection', async () => {
    const workspacePath = await makeTempDir('rk-contract-refresh-ws-');
    const externalProjectPath = await makeTempDir('rk-contract-refresh-project-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'refresh-ws',
    });
    await fsExtra.outputJson(path.join(externalProjectPath, '.workspai', 'project.json'), {
      name: 'native-service',
      runtime: 'cpp',
      framework: 'cpp',
      kit_name: 'adopted.cpp',
    });
    await upsertImportedProjectsRegistry(workspacePath, [
      {
        name: 'native-service',
        path: externalProjectPath,
        relationship: 'adopted',
        source: 'adopted-local',
        stack: 'unknown',
        runtime: 'cpp',
        framework: 'cpp',
        frameworkDisplayName: 'C++',
        supportTier: 'observed',
        moduleSupport: false,
        confidence: 'high',
        importedAt: '2026-08-10T00:00:00.000Z',
      },
    ]);
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'refresh-ws' },
      projects: [
        {
          slug: 'native-service',
          relativePath: 'external/native-service',
          source: 'adopted-local',
          relationship: 'adopted',
          externalPath: externalProjectPath,
          runtime: 'python',
          framework: 'python',
          kit: 'adopted.python',
          modules: [],
          ports: [],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
      ],
    });

    const result = await syncWorkspaceContract({ workspacePath });

    expect(result.contract.projects[0]).toMatchObject({
      runtime: 'cpp',
      framework: 'cpp',
      kit: 'adopted.cpp',
    });
    expect(result.updatedProjects).toEqual(['native-service']);
  });

  it('fails verification for colliding ports and unknown dependencies', async () => {
    const workspacePath = await makeTempDir('rk-contract-fail-');
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-02T00:00:00.000Z',
      workspace: { name: 'broken-ws' },
      projects: [
        {
          slug: 'orders',
          relativePath: 'orders',
          modules: [],
          ports: [{ name: 'http', port: 8000, protocol: 'http' }],
          contracts: {
            owns: [],
            apis: [],
            publishes: [],
            consumes: [],
            dependsOn: ['missing-users'],
            env: [],
          },
        },
        {
          slug: 'billing',
          relativePath: 'billing',
          modules: [],
          ports: [{ name: 'http', port: 8000, protocol: 'http' }],
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

    const result = await verifyWorkspaceContract({ workspacePath });
    expect(result.status).toBe('failed');
    expect(result.violations.join('\n')).toContain('Port 8000');
    expect(result.violations.join('\n')).toContain('depends on unknown project');
  });

  it('restores exact artifact preimages when registry summary publication fails', async () => {
    const workspacePath = await makeTempDir('rk-contract-transaction-');
    const contractPath = path.join(workspacePath, WORKSPACE_CONTRACT_PATH);
    const summaryPath = path.join(workspacePath, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH);
    const contractPreimage = Buffer.from('{\n  "preexisting": "contract spacing"\n}\n');
    const summaryPreimage = Buffer.from('{"preexisting":"summary spacing"}\n');
    await fsExtra.outputFile(contractPath, contractPreimage);
    await fsExtra.outputFile(summaryPath, summaryPreimage);
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.workspai', 'project.json'), {
      runtime: 'node',
      kit_name: 'nestjs.standard',
    });
    process.env.WORKSPAI_TEST_FAIL_WORKSPACE_REGISTRY_PUBLISH = '1';

    await expect(syncWorkspaceContract({ workspacePath })).rejects.toThrow(
      'Injected workspace registry summary publication failure.'
    );

    expect(await fsExtra.readFile(contractPath)).toEqual(contractPreimage);
    expect(await fsExtra.readFile(summaryPath)).toEqual(summaryPreimage);
  });

  it('fails verification for unsafe paths and invalid service contracts', async () => {
    const workspacePath = await makeTempDir('rk-contract-invalid-contracts-');
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-02T00:00:00.000Z',
      workspace: { name: 'invalid-contracts-ws' },
      projects: [
        {
          slug: 'orders',
          relativePath: '../orders',
          modules: [],
          ports: [],
          contracts: {
            owns: [],
            apis: [{ name: '', basePath: 'api/orders' }],
            publishes: [''],
            consumes: [],
            dependsOn: [],
            env: ['database-url'],
          },
        },
      ],
    });

    const result = await verifyWorkspaceContract({ workspacePath });
    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.id === 'contracts')?.status).toBe('failed');
    expect(result.violations.join('\n')).toContain('unsafe relativePath');
    expect(result.violations.join('\n')).toContain('invalid API contract');
    expect(result.violations.join('\n')).toContain('empty event contract');
    expect(result.violations.join('\n')).toContain('invalid env contract');
  });

  it('rejects strict sync before replacing artifacts when candidate verification fails', async () => {
    const workspacePath = await makeTempDir('rk-contract-strict-sync-');
    const contractPath = path.join(workspacePath, WORKSPACE_CONTRACT_PATH);
    const contractPreimage = {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-02T00:00:00.000Z',
      workspace: { name: 'strict-ws' },
      projects: [
        {
          slug: 'manual-service',
          relativePath: '../manual-service',
          modules: [],
          ports: [],
          contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
        },
      ],
    };
    await fsExtra.outputJson(contractPath, contractPreimage, { spaces: 4 });
    const exactPreimage = await fsExtra.readFile(contractPath);

    await expect(syncWorkspaceContract({ workspacePath, strict: true })).rejects.toBeInstanceOf(
      WorkspaceContractVerificationError
    );
    expect(await fsExtra.readFile(contractPath)).toEqual(exactPreimage);
    expect(
      await fsExtra.pathExists(path.join(workspacePath, WORKSPACE_REGISTRY_SUMMARY_RELATIVE_PATH))
    ).toBe(false);
  });

  it('builds service graph nodes and dependency/event edges', async () => {
    const workspacePath = await makeTempDir('rk-contract-graph-');
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-02T00:00:00.000Z',
      workspace: { name: 'graph-ws' },
      projects: [
        {
          slug: 'orders',
          relativePath: 'orders',
          runtime: 'python',
          framework: 'fastapi',
          kit: 'fastapi.standard',
          modules: [],
          ports: [{ name: 'http', port: 8000, protocol: 'http' }],
          contracts: {
            owns: ['Order'],
            apis: [{ name: 'Orders API', basePath: '/api/orders' }],
            publishes: ['OrderCreated'],
            consumes: [],
            dependsOn: [],
            env: ['DATABASE_URL'],
          },
        },
        {
          slug: 'billing',
          relativePath: 'billing',
          runtime: 'node',
          framework: 'nestjs',
          kit: 'nestjs.standard',
          modules: [],
          ports: [{ name: 'http', port: 3000, protocol: 'http' }],
          contracts: {
            owns: ['Invoice'],
            apis: [],
            publishes: [],
            consumes: ['OrderCreated'],
            dependsOn: ['orders'],
            env: [],
          },
        },
      ],
    });

    const { graph } = await buildWorkspaceContractGraph({
      workspacePath,
      now: new Date('2026-06-03T00:00:00.000Z'),
    });
    expect(graph.kind).toBe('rapidkit.workspace.contract.graph');
    expect(graph.generatedAt).toBe('2026-06-03T00:00:00.000Z');
    expect(graph.semantics).toEqual({
      legacyEdges: 'producer-to-consumer',
      dependencyGraphEdges: 'consumer-to-dependency',
    });
    expect(graph.summary).toMatchObject({
      projectCount: 2,
      dependencyEdges: 1,
      eventEdges: 1,
      portCount: 2,
      apiCount: 1,
      relationshipEdges: 2,
      inferredEdges: 0,
      authoritativeEdges: 2,
      orphanProjects: 0,
      evidenceCoverageRatio: 1,
      edgeCoverageRatio: 1,
      connectedProjects: 2,
      hasCycle: false,
    });
    expect(graph.edges).toEqual([
      { from: 'orders', to: 'billing', type: 'dependency', label: 'dependsOn' },
      { from: 'orders', to: 'billing', type: 'event', label: 'OrderCreated' },
    ]);
    expect(graph.dependencyGraph.schemaVersion).toBe('workspace-dependency-graph.v1');
    expect(
      graph.dependencyGraph.edges.filter((edge) => edge.from === 'billing' && edge.to === 'orders')
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'service-dependsOn',
          source: 'contract',
          confidence: 'high',
        }),
        expect.objectContaining({
          kind: 'event-pub-sub',
          source: 'contract',
          confidence: 'high',
        }),
      ])
    );
  });

  it('enriches the graph from project evidence without requiring hand-authored edges', async () => {
    const workspacePath = await makeTempDir('rk-contract-evidence-graph-');
    const apiRoot = path.join(workspacePath, 'api-service');
    const webRoot = path.join(workspacePath, 'web-app');
    await fsExtra.outputJson(path.join(apiRoot, '.workspai', 'project.json'), {
      runtime: 'node',
      framework: 'nestjs',
      kit: 'nestjs.standard',
    });
    await fsExtra.outputJson(path.join(apiRoot, 'package.json'), {
      name: '@demo/api',
      version: '1.2.3',
      private: true,
      scripts: { build: 'nest build', test: 'vitest run' },
      dependencies: { '@nestjs/core': '^11.0.0' },
      devDependencies: { vitest: '^3.0.0' },
    });
    await fsExtra.outputFile(path.join(apiRoot, 'src', 'main.ts'), 'export const api = true;\n');
    await fsExtra.outputFile(path.join(apiRoot, 'openapi.yaml'), 'openapi: 3.1.0\n');
    await fsExtra.outputFile(path.join(apiRoot, 'Dockerfile'), 'FROM node:22\n');
    await fsExtra.outputFile(path.join(apiRoot, 'README.md'), '# API\n');
    await fsExtra.outputFile(
      path.join(apiRoot, '.env.example'),
      'DATABASE_URL=postgres://public-template\nAPI_TOKEN=do-not-export-this-value\n'
    );

    await fsExtra.outputJson(path.join(webRoot, '.workspai', 'project.json'), {
      runtime: 'node',
      framework: 'nextjs',
      kit: 'nextjs.standard',
    });
    await fsExtra.outputJson(path.join(webRoot, 'package.json'), {
      name: '@demo/web',
      scripts: { dev: 'next dev' },
      dependencies: { '@demo/api': 'workspace:*', next: '^15.0.0' },
    });
    await fsExtra.outputFile(
      path.join(webRoot, 'src', 'index.ts'),
      "import '@demo/api';\nexport const web = true;\n"
    );

    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_PATH), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: '2026-06-03T00:00:00.000Z',
      workspace: { name: 'evidence-ws', profile: 'enterprise' },
      projects: [
        {
          slug: 'api-service',
          relativePath: 'api-service',
          runtime: 'node',
          framework: 'nestjs',
          kit: 'nestjs.standard',
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
        {
          slug: 'web-app',
          relativePath: 'web-app',
          runtime: 'node',
          framework: 'nextjs',
          kit: 'nextjs.standard',
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

    const { graph } = await buildWorkspaceContractGraph({
      workspacePath,
      now: new Date('2026-06-04T00:00:00.000Z'),
    });

    expect(graph.edges).toEqual([]);
    expect(graph.dependencyGraph.edges).toContainEqual(
      expect.objectContaining({
        from: 'web-app',
        to: 'api-service',
        kind: 'package-dep',
        source: 'inferred',
        confidence: 'high',
        evidence: expect.arrayContaining([
          expect.objectContaining({ file: 'web-app/package.json' }),
        ]),
      })
    );
    expect(graph.summary).toMatchObject({
      projectCount: 2,
      relationshipEdges: 1,
      inferredEdges: 1,
      authoritativeEdges: 0,
      orphanProjects: 0,
      evidenceCoverageRatio: 1,
      edgeCoverageRatio: 1,
      connectedProjects: 2,
      manifestCount: 2,
      entrypointCount: 2,
      diagnostics: 0,
      relationshipKinds: {
        'code-import': 0,
        'package-dep': 1,
        'event-pub-sub': 0,
        'service-dependsOn': 0,
        'shared-resource': 0,
      },
      relationshipSources: { inferred: 1, contract: 0, manual: 0 },
    });
    const apiNode = graph.nodes.find((node) => node.id === 'api-service');
    expect(apiNode).toMatchObject({
      env: ['API_TOKEN', 'DATABASE_URL'],
      files: {
        metadata: ['.workspai/project.json'],
        manifests: ['package.json'],
        entrypoints: ['src/main.ts'],
        apiSpecifications: ['openapi.yaml'],
        infrastructure: ['Dockerfile'],
        documentation: ['README.md'],
      },
      package: {
        name: '@demo/api',
        version: '1.2.3',
        private: true,
        scripts: ['build', 'test'],
        dependencies: {
          runtime: ['@nestjs/core'],
          development: ['vitest'],
          peer: [],
          optional: [],
        },
        dependencyCount: 2,
      },
      capabilities: {
        engine: 'npm',
      },
      operationalProfile: {
        verificationPriority: 'elevated',
      },
    });
    expect(JSON.stringify(graph)).not.toContain('do-not-export-this-value');
  });
});
