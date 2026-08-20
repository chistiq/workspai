import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkspaceAgentContext,
  WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
  writeWorkspaceAgentContext,
} from '../workspace-context.js';
import { buildWorkspaceModel } from '../workspace-model.js';

describe('workspace agent context', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fsExtra.remove(dir);
    }
  });

  it('builds a vendor-neutral context pack from the workspace model', async () => {
    const workspacePath = await makeTempDir('rk-context-');
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'agent-platform',
      profile: 'polyglot',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });
    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
      },
    });

    const context = await buildWorkspaceAgentContext({
      workspacePath,
      agent: 'codex',
      now: new Date('2026-06-14T00:00:00.000Z'),
    });

    expect(context).toMatchObject({
      schemaVersion: 'workspace-context.v1',
      generatedAt: '2026-06-14T00:00:00.000Z',
      agent: 'codex',
      intelligenceChain: {
        schemaVersion: 'workspai-workspace-intelligence-chain-v1',
        contractPath: 'contracts/workspace-intelligence-chain.v1.json',
        currentStep: 'context',
      },
      workspace: {
        name: 'agent-platform',
        root: 'workspace:agent-platform',
        type: 'polyglot-product-workspace',
      },
      scope: {
        requested: 'workspace',
      },
    });
    expect(JSON.stringify(context)).not.toContain(workspacePath);
    expect(context.projects.map((project) => project.name).sort()).toEqual(['api', 'web']);
    expect(
      context.projects.find((project) => project.name === 'api')?.createCapability
    ).toMatchObject({
      lane: 'native',
      canExecuteCreate: true,
      resolved: 'fastapi.standard',
    });
    expect(context.projects.find((project) => project.name === 'web')?.safeCommands).toEqual([]);
    expect(context.workspaceSummary).toContain('polyglot-product-workspace');
    expect(context.knowledgeGraph).toMatchObject({
      artifact: '.workspai/reports/workspace-knowledge-graph.json',
      schemaVersion: 'workspace-knowledge-graph.v1',
      available: false,
      queryCommands: expect.arrayContaining([
        expect.stringContaining('workspace graph entities'),
        expect.stringContaining('workspace graph evidence'),
        expect.stringContaining('workspace graph path'),
      ]),
    });
    expect(context.safeCommands.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'workspace.graph.entities',
        'workspace.graph.evidence',
        'workspace.graph.path',
      ])
    );
    expect(context.agentInstructions.join('\n')).toContain('Use `display` commands');
    expect(context.agentInstructions.join('\n')).toContain('freshness.verifyBeforeUse');
    expect(context.unsafeAssumptions.join('\n')).toContain('Do not claim a command passed');
    expect(context.factFreshness).toMatchObject({
      schemaVersion: 'rapidkit-fact-freshness-v1',
      totalFacts: expect.any(Number),
    });
    expect(context.facts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([
        'workspace.projectCount',
        'project.api.framework',
        'project.web.runtime',
        'workspace.evidence.pipeline',
      ])
    );
    expect(
      context.facts.find((fact) => fact.id === 'workspace.evidence.pipeline')?.freshness
    ).toMatchObject({
      kind: 'verify-before-use',
      category: 'verification',
      verifyBeforeUse: true,
    });
  });

  it('describes an empty workspace without assigning a backend identity', async () => {
    const workspacePath = await makeTempDir('rk-context-empty-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'empty-platform',
      profile: 'minimal',
    });

    const context = await buildWorkspaceAgentContext({ workspacePath, agent: 'codex' });

    expect(context.workspace.type).toBe('empty-workspace');
    expect(context.workspaceSummary).toContain('no runtime coverage');
    expect(context.workspaceSummary).not.toContain('no runtime runtime coverage');
  });

  it('refreshes evidence availability without rebuilding the supplied canonical model', async () => {
    const workspacePath = await makeTempDir('rk-context-evidence-refresh-');
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'evidence-refresh',
      profile: 'minimal',
    });
    const model = await buildWorkspaceModel({
      workspacePath,
      includeEvidence: true,
      now: new Date('2026-07-26T00:00:00.000Z'),
    });
    expect(model.evidence.doctor?.exists).toBe(false);

    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'doctor-last-run.json'),
      { generatedAt: '2026-07-26T00:01:00.000Z' }
    );
    const context = await buildWorkspaceAgentContext({
      workspacePath,
      model,
      now: new Date('2026-07-26T00:02:00.000Z'),
    });

    expect(context.evidence.available).toContain('doctor: .workspai/reports/doctor-last-run.json');
    expect(context.evidence.missing).not.toContain('doctor');
  });

  it('separates simple display commands from pinned execution commands', async () => {
    const workspacePath = await makeTempDir('rk-context-command-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const context = await buildWorkspaceAgentContext({ workspacePath });
    const doctor = context.safeCommands.find((item) => item.id === 'workspace.doctor');

    expect(doctor).toMatchObject({
      display: 'npx workspai doctor workspace --json',
      execute: 'npx --yes --package workspai workspai doctor workspace --json',
      freshness: {
        schemaVersion: 'rapidkit-fact-freshness-v1',
        kind: 'derived',
        category: 'structure',
      },
    });
    expect(context.safeCommands.find((item) => item.id === 'workspace.verify')).toMatchObject({
      display: 'npx workspai workspace verify --json',
      execute: 'npx --yes --package workspai workspai workspace verify --json',
    });
  });

  it('narrows context to an explicit project scope', async () => {
    const workspacePath = await makeTempDir('rk-context-scope-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });
    await fsExtra.outputFile(
      path.join(workspacePath, 'worker', 'go.mod'),
      'module example.com/worker\n'
    );

    const context = await buildWorkspaceAgentContext({
      workspacePath,
      scope: 'project:api',
    });

    expect(context.scope.activeProject).toBe('api');
    expect(context.projects).toHaveLength(1);
    expect(context.projects[0].name).toBe('api');
    expect(context.projects[0].facts.every((fact) => fact.project === 'api')).toBe(true);
    expect(context.facts.some((fact) => fact.project === 'worker')).toBe(false);
    expect(context.safeCommands.every((item) => !item.project || item.project === 'api')).toBe(
      true
    );
    expect(context.validation.status).toBe('warning');
  });

  it('keeps local-only project commands out of agent safe commands', async () => {
    const workspacePath = await makeTempDir('rk-context-fleet-safe-');
    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: {
        next: '^15.0.0',
      },
      scripts: {
        dev: 'next dev',
        test: 'vitest run',
        build: 'next build',
        lint: 'next lint',
      },
    });

    const context = await buildWorkspaceAgentContext({ workspacePath });
    const webSummary = context.projects.find((project) => project.name === 'web');

    expect(webSummary?.safeCommands).toEqual(['workspace run test', 'workspace run build']);
    expect(context.safeCommands.map((item) => item.id)).toEqual(
      expect.arrayContaining(['project.web.test', 'project.web.build'])
    );
    expect(context.safeCommands.map((item) => item.display).join('\n')).not.toContain(
      'workspace run dev'
    );
  });

  it('keeps official generator identity available for agent context packs', async () => {
    const workspacePath = await makeTempDir('rk-context-generator-');
    await fsExtra.outputJson(path.join(workspacePath, 'web', '.rapidkit', 'project.json'), {
      name: 'web',
      kind: 'frontend',
      runtime: 'node',
      framework: 'react',
      kit_name: 'frontend.vite-react',
      frontend: {
        generator: 'vite-react',
        official_generator: true,
      },
    });
    await fsExtra.outputJson(path.join(workspacePath, 'web', 'package.json'), {
      dependencies: {
        vite: '^6.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    });

    const context = await buildWorkspaceAgentContext({
      workspacePath,
      scope: 'project:web',
    });

    expect(context.projects[0]).toMatchObject({
      name: 'web',
      framework: 'React',
      generator: {
        id: 'vite-react',
        kit: 'frontend.vite-react',
        source: 'official-generator',
      },
      createCapability: {
        lane: 'official',
        canExecuteCreate: true,
        resolved: 'frontend.vite-react',
      },
    });
  });

  it('resolves project scope by relative path basename for adopted projects', async () => {
    const workspacePath = await makeTempDir('rk-context-path-scope-');
    await fsExtra.outputJson(path.join(workspacePath, 'apps', 'web', '.rapidkit', 'project.json'), {
      name: 'customer-portal',
      runtime: 'node',
      framework: 'nextjs',
      kind: 'frontend',
      relationship: 'adopted',
    });

    const context = await buildWorkspaceAgentContext({
      workspacePath,
      scope: 'project:WEB',
    });

    expect(context.scope.activeProject).toBe('customer-portal');
    expect(context.projects).toHaveLength(1);
    expect(context.projects[0]).toMatchObject({
      name: 'customer-portal',
      path: 'apps/web',
      kind: 'frontend',
    });
    expect(context.validation.status).toBe('warning');
  });

  it('fails strict context validation when project scope is missing', async () => {
    const workspacePath = await makeTempDir('rk-context-missing-scope-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    await expect(
      buildWorkspaceAgentContext({
        workspacePath,
        scope: 'project:missing-api',
        strict: true,
      })
    ).rejects.toThrow('Workspace context strict validation failed');
  });

  it('keeps validation details for missing project scope when strict is not enabled', async () => {
    const workspacePath = await makeTempDir('rk-context-soft-missing-scope-');
    await fsExtra.outputJson(path.join(workspacePath, 'api', '.rapidkit', 'project.json'), {
      name: 'api',
      runtime: 'python',
      kit_name: 'fastapi.standard',
    });

    const context = await buildWorkspaceAgentContext({
      workspacePath,
      scope: 'project:missing-api',
    });

    expect(context.validation).toMatchObject({
      status: 'failed',
      errors: 1,
    });
    expect(context.validation.issues.map((issue) => issue.code)).toContain(
      'context.scope.project.missing'
    );
    expect(context.projects.map((project) => project.name)).toEqual(['api']);
  });

  it('writes the context artifact', async () => {
    const workspacePath = await makeTempDir('rk-context-write-');
    const context = await buildWorkspaceAgentContext({
      workspacePath,
      now: new Date('2026-06-14T00:00:00.000Z'),
    });

    const outputPath = await writeWorkspaceAgentContext(context, workspacePath);

    expect(outputPath).toBe(path.join(workspacePath, WORKSPACE_CONTEXT_AGENT_REPORT_PATH));
    const saved = await fsExtra.readJson(outputPath);
    expect(saved.schemaVersion).toBe('workspace-context.v1');
  });
});
