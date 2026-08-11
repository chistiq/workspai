import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseWorkspaceExplainTarget } from '../contracts/workspace-explain-contract.js';
import {
  invokeMcpToolForTest,
  runWorkspaceMcpServe,
  WORKSPACE_MCP_READ_TOOLS,
} from '../workspace-mcp-serve.js';
import { WORKSPACE_CONTRACT_VERIFY_REPORT_PATH } from '../utils/workspace-contract.js';
import { WORKSPACE_EXPLAIN_REPORT_PATH } from '../contracts/workspace-explain-contract.js';
import { buildWorkspaceVerify, WORKSPACE_VERIFY_REPORT_PATH } from '../workspace-verify.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import {
  createWorkspaceEvaluation,
  writeWorkspaceEvaluation,
} from '../workspace-intelligence-evaluation.js';

let workspacePath: string;

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'rk-mcp-'));
});

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe('workspace mcp serve (4.19)', () => {
  it('advertises read-mostly Phase 4 tools including getProjectContext', () => {
    const names = WORKSPACE_MCP_READ_TOOLS.map((tool) => tool.name);
    expect(names).toContain('listOperationalSkills');
    expect(names).toContain('getWorkspaceExplain');
    expect(names).toContain('getProjectContext');
    expect(names).toEqual(
      expect.arrayContaining([
        'getWorkspaceKnowledgeGraph',
        'getWorkspaceEvaluation',
        'queryWorkspaceEntities',
        'searchWorkspaceGraph',
        'getWorkspaceGraphEvidence',
        'findWorkspaceGraphPath',
      ])
    );
    expect(names).not.toContain('refreshWorkspaceIntelligence');
  });

  it('serves the same contract-validated evaluation artifact used by IDE dashboards', async () => {
    const evaluation = createWorkspaceEvaluation({
      workspacePath,
      taskId: 'mcp-evaluation',
      runId: 'mcp-run',
      sessionId: 'mcp-session',
    });
    await writeWorkspaceEvaluation(workspacePath, evaluation);
    await expect(
      invokeMcpToolForTest(workspacePath, 'getWorkspaceEvaluation', { live: true })
    ).resolves.toMatchObject({
      schemaVersion: 'workspace-intelligence-evaluation.v1',
      runId: 'mcp-run',
      status: 'live',
    });
  });

  it('serves contract-validated graph reads and bounded queries', async () => {
    await fsExtra.outputJson(path.join(workspacePath, 'api', 'package.json'), {
      name: '@example/api',
      version: '1.0.0',
    });
    const model = await buildWorkspaceModel({
      workspacePath,
      now: new Date('2026-07-21T12:00:00.000Z'),
    });
    await writeWorkspaceModel(model, workspacePath);

    await expect(
      invokeMcpToolForTest(workspacePath, 'getWorkspaceKnowledgeGraph')
    ).resolves.toMatchObject({ schemaVersion: 'workspace-knowledge-graph.v1' });
    const entities = (await invokeMcpToolForTest(workspacePath, 'queryWorkspaceEntities', {
      kind: 'project',
    })) as { entities: Array<{ label: string }> };
    expect(entities.entities.map((entity) => entity.label)).toContain('api');
    await expect(
      invokeMcpToolForTest(workspacePath, 'searchWorkspaceGraph', {
        query: 'example api',
        projectId: 'api',
        limit: 1,
      })
    ).resolves.toMatchObject({
      schemaVersion: 'workspace-knowledge-search.v1',
      projectId: 'api',
      entities: [{ label: '@example/api' }],
    });
    await expect(
      invokeMcpToolForTest(workspacePath, 'getWorkspaceGraphEvidence', { query: 'api' })
    ).resolves.toMatchObject({ found: true, proofs: expect.any(Array) });
    await expect(
      invokeMcpToolForTest(workspacePath, 'findWorkspaceGraphPath', {
        from: 'api',
        to: '@example/api',
      })
    ).resolves.toMatchObject({ found: true, hops: expect.any(Array) });
  });

  it('fails closed when the graph source hash no longer matches the workspace model', async () => {
    await fsExtra.outputJson(path.join(workspacePath, 'api', 'package.json'), {
      name: '@example/api',
      version: '1.0.0',
    });
    const model = await buildWorkspaceModel({ workspacePath });
    await writeWorkspaceModel(model, workspacePath);
    const modelPath = path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json');
    const persistedModel = await fsExtra.readJson(modelPath);
    persistedModel.workspace.name = 'changed-after-graph-publication';
    await fsExtra.writeJson(modelPath, persistedModel);

    await expect(invokeMcpToolForTest(workspacePath, 'getWorkspaceKnowledgeGraph')).rejects.toThrow(
      /source hash does not match/i
    );
    await expect(
      invokeMcpToolForTest(workspacePath, 'queryWorkspaceEntities', { kind: 'project' })
    ).rejects.toThrow(/source hash does not match/i);
  });

  it('parses blocker and trace explain targets for MCP consumers', () => {
    expect(parseWorkspaceExplainTarget('blocker:doctor.workspace')).toEqual({
      kind: 'blocker',
      blockerId: 'doctor.workspace',
    });
    expect(
      parseWorkspaceExplainTarget('trace:.workspai/reports/workspace-model-diff-last-run.json')
    ).toEqual({
      kind: 'trace',
      diffRef: '.workspai/reports/workspace-model-diff-last-run.json',
    });
  });
});

describe('workspace mcp blockers aggregation', () => {
  it('merges verify, explain, and contract-verify blockers without duplicates', async () => {
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai', 'reports'));
    await fsExtra.writeJson(path.join(workspacePath, '.workspai', 'workspace.json'), {
      workspace_name: 'mcp-test',
    });
    const verify = await buildWorkspaceVerify({ workspacePath });
    await fsExtra.writeJson(path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH), {
      ...verify,
      blockingReasons: ['verify blocker', 'shared blocker'],
    });
    await fsExtra.writeJson(path.join(workspacePath, WORKSPACE_EXPLAIN_REPORT_PATH), {
      schemaVersion: 'workspace-explain.v1',
      generatedAt: new Date().toISOString(),
      workspacePath,
      target: { kind: 'release-blocked' },
      summary: 'blocked',
      sections: [],
      blockingReasons: ['explain blocker', 'shared blocker'],
    });
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_VERIFY_REPORT_PATH), {
      schemaVersion: 'workspace-contract-verify.v1',
      generatedAt: new Date().toISOString(),
      status: 'failed',
      contractPath: '.rapidkit/workspace.contract.json',
      projectCount: 1,
      checks: [],
      violations: ['contract violation'],
    });

    const { invokeMcpToolForTest } = await import('../workspace-mcp-serve.js');
    const result = (await invokeMcpToolForTest(workspacePath, 'getBlockers', {})) as {
      blockingReasons: string[];
      sources: Array<{ artifact: string }>;
    };

    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        'verify blocker',
        'explain blocker',
        'shared blocker',
        'contract violation',
      ])
    );
    expect(result.blockingReasons).toHaveLength(4);
    expect(result.sources.map((entry) => entry.artifact)).toEqual(
      expect.arrayContaining([
        WORKSPACE_VERIFY_REPORT_PATH,
        WORKSPACE_EXPLAIN_REPORT_PATH,
        WORKSPACE_CONTRACT_VERIFY_REPORT_PATH,
      ])
    );
  });

  it('uses the canonical fallback reason when contract verification failed without violations', async () => {
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_CONTRACT_VERIFY_REPORT_PATH), {
      schemaVersion: 'workspace-contract-verify.v1',
      generatedAt: new Date().toISOString(),
      status: 'failed',
      contractPath: '.workspai/workspace.contract.json',
      projectCount: 0,
      checks: [],
      violations: [],
    });

    await expect(invokeMcpToolForTest(workspacePath, 'getBlockers')).resolves.toMatchObject({
      blockingReasons: ['Workspace contract verification failed'],
    });
  });

  it('reads only workspace-contained artifacts and returns null for missing safe paths', async () => {
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'custom.json'), {
      source: 'custom',
    });

    await expect(
      invokeMcpToolForTest(workspacePath, 'getArtifact', {
        relativePath: '.workspai/custom.json',
      })
    ).resolves.toEqual({ source: 'custom' });
    await expect(
      invokeMcpToolForTest(workspacePath, 'getArtifact', {
        relativePath: '.workspai/missing.json',
      })
    ).resolves.toBeNull();
    for (const unsafe of ['', '../secret.json', '/tmp/secret.json', '.workspai/../secret.json']) {
      await expect(
        invokeMcpToolForTest(workspacePath, 'getArtifact', { relativePath: unsafe })
      ).rejects.toThrow(/Unsafe artifact path/);
    }
    await expect(invokeMcpToolForTest(workspacePath, 'unknownTool')).rejects.toThrow(
      'Unknown tool: unknownTool'
    );
  });

  it('reuses cached explain reports only when their typed target matches', async () => {
    const reportPath = path.join(workspacePath, WORKSPACE_EXPLAIN_REPORT_PATH);
    const base = {
      schemaVersion: 'workspace-explain.v1',
      generatedAt: '2026-07-19T00:00:00.000Z',
      workspacePath,
      summary: 'cached explanation',
      sections: [{ id: 'summary', title: 'Summary', body: 'cached' }],
    };
    const cases = [
      { target: { kind: 'release-blocked' }, request: 'release-blocked' },
      { target: { kind: 'project', project: 'API' }, request: 'project:api' },
      {
        target: { kind: 'blocker', blockerId: 'doctor.workspace' },
        request: 'blocker:doctor.workspace',
      },
      { target: { kind: 'trace', diffRef: 'diff.json' }, request: 'trace:diff.json' },
    ];

    for (const testCase of cases) {
      await fsExtra.outputJson(reportPath, { ...base, target: testCase.target });
      await expect(
        invokeMcpToolForTest(workspacePath, 'getWorkspaceExplain', {
          target: testCase.request,
        })
      ).resolves.toMatchObject({ summary: 'cached explanation', target: testCase.target });
    }
    await expect(
      invokeMcpToolForTest(workspacePath, 'getWorkspaceExplain', { target: 'trace:' })
    ).rejects.toThrow(/Invalid explain target/);
  });

  it('serves JSON-RPC initialization, discovery, tool calls, and fail-closed errors over stdio', async () => {
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'custom.json'), {
      source: 'rpc',
    });
    const requests = [
      '',
      '{invalid-json',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'getArtifact',
          arguments: { relativePath: '.workspai/custom.json' },
        },
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'getArtifact', arguments: { relativePath: '.workspai/missing.json' } },
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'unknownTool', arguments: 'invalid' },
      }),
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'unsupported/method' }),
    ];
    const stdin = Readable.from(`${requests.join('\n')}\n`);
    const stdinSpy = vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as never);
    const writes: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      await runWorkspaceMcpServe({ workspacePath });
    } finally {
      stdoutSpy.mockRestore();
      stdinSpy.mockRestore();
    }

    const responses = writes.map((line) => JSON.parse(line) as Record<string, any>);
    expect(responses[0].error.message).toBe('Invalid JSON-RPC request');
    expect(responses.find((response) => response.id === 1)?.result.serverInfo.name).toBe(
      'workspai-workspace-mcp'
    );
    expect(responses.find((response) => response.id === 'tools')?.result.tools).toHaveLength(
      WORKSPACE_MCP_READ_TOOLS.length
    );
    expect(responses.find((response) => response.id === 2)?.result.isError).toBe(false);
    expect(responses.find((response) => response.id === 3)?.result.isError).toBe(true);
    expect(responses.find((response) => response.id === 4)?.error.message).toBe(
      'Unknown tool: unknownTool'
    );
    expect(responses.find((response) => response.id === 5)?.error.message).toBe(
      'Unsupported method: unsupported/method'
    );
  });
});
