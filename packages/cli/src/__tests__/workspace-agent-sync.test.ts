import os from 'os';
import path from 'path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
  AGENT_GROUNDING_DOC_PATH,
  AGENT_REPORTS_INDEX_PATH,
  LEGACY_COPILOT_GROUNDING_SKILL_PATH,
  LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  LEGACY_CURSOR_GROUNDING_RULE_PATH,
  LEGACY_MCP_DESIGN_REPORT_PATH,
  LEGACY_VSCODE_AGENT_HOOKS_PATH,
  buildWorkspaceAgentReportsIndex,
  syncWorkspaceAgentGrounding,
  WORKSPAI_COPILOT_GROUNDING_SKILL_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
  WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
  WORKSPAI_CURSOR_GROUNDING_RULE_PATH,
  WORKSPAI_MCP_DESIGN_REPORT_PATH,
  WORKSPAI_VSCODE_AGENT_HOOKS_PATH,
} from '../workspace-agent-sync.js';
import { WORKSPACE_SKILLS_INDEX_PATH } from '../contracts/workspace-artifact-paths.js';
import {
  LEGACY_COPILOT_REPAIR_PROMPT_PATH,
  WORKSPAI_COPILOT_REPAIR_PROMPT_PATH,
} from '../contracts/workspace-artifact-paths.js';
import {
  extractManagedAgentSection,
  RAPIDKIT_AGENT_GROUNDING_END,
  RAPIDKIT_AGENT_GROUNDING_START,
  upsertManagedAgentSection,
} from '../utils/managed-agent-markers.js';
import { WORKSPACE_CONTEXT_AGENT_REPORT_PATH } from '../workspace-context.js';

describe('managed agent markers', () => {
  it('upserts managed sections without losing surrounding content', () => {
    const original = [
      '# Team notes',
      '',
      'Keep this custom section.',
      '',
      RAPIDKIT_AGENT_GROUNDING_START,
      'old managed body',
      RAPIDKIT_AGENT_GROUNDING_END,
      '',
    ].join('\n');

    const updated = upsertManagedAgentSection(original, 'new managed body');
    expect(updated).toContain('Keep this custom section.');
    expect(extractManagedAgentSection(updated)).toBe('new managed body');
  });
});

describe('workspace agent sync', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fsExtra.remove(dir);
      }
    }
  });

  async function makeWorkspace(): Promise<string> {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-agent-sync-'));
    tempDirs.push(workspacePath);
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'sync-lab',
    });
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-context-agent.json'),
      {
        schemaVersion: 'workspace-context.v1',
        generatedAt: new Date().toISOString(),
        blockers: ['pipeline stage failed'],
      }
    );
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'pipeline-last-run.json'),
      {
        schemaVersion: 'rapidkit-pipeline-v1',
        generatedAt: new Date().toISOString(),
        workspacePath,
        summary: {
          verdict: 'blocked',
          exitCode: 2,
          stagesPassed: 0,
          stagesWarn: 0,
          stagesFailed: 1,
        },
        stages: [],
        blockingReasons: ['pipeline stage failed'],
        artifacts: { reportPath: '.workspai/reports/pipeline-last-run.json' },
        commandId: 'workspacePipeline',
        exitCode: 2,
      }
    );
    return workspacePath;
  }

  it('builds an index with read order and merged blockers', async () => {
    const workspacePath = await makeWorkspace();
    const index = await buildWorkspaceAgentReportsIndex({ workspacePath });

    expect(index.schemaVersion).toBe('rapidkit-agent-reports-index.v1');
    expect(index.intelligenceChain).toEqual({
      schemaVersion: 'workspai-workspace-intelligence-chain-v1',
      contractPath: 'contracts/workspace-intelligence-chain.v1.json',
      currentStep: 'agent-sync',
    });
    expect(index.readOrder.slice(0, 3)).toEqual([
      '.workspai/goals/index.json',
      '.workspai/reports/goal-pack-last-run.json',
      WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
    ]);
    expect(index.readOrder).toEqual(
      expect.arrayContaining([
        '.workspai/reports/doctor-project-last-run.json',
        '.workspai/reports/doctor-remediation-plan-last-run.json',
        '.workspai/reports/artifact-remediation-plan-last-run.json',
        '.workspai/reports/doctor-fix-result-last-run.json',
      ])
    );
    expect(index.blockers).toContain('pipeline stage failed');
    expect(
      index.reports.find((report) => report.path === WORKSPACE_CONTEXT_AGENT_REPORT_PATH)?.exists
    ).toBe(true);
  });

  it('prefers project-scoped blockers over duplicate aggregate wording', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-context-agent.json'),
      {
        schemaVersion: 'workspace-context.v1',
        generatedAt: new Date().toISOString(),
        blockers: ['12 moderate/high/critical dependency vulnerability(ies) reported.'],
      }
    );
    const pipelinePath = path.join(workspacePath, '.workspai', 'reports', 'pipeline-last-run.json');
    const pipeline = await fsExtra.readJson(pipelinePath);
    pipeline.blockingReasons = [
      'canvas-web: 12 moderate/high/critical dependency vulnerability(ies) reported.',
    ];
    await fsExtra.writeJson(pipelinePath, pipeline);

    const index = await buildWorkspaceAgentReportsIndex({ workspacePath });

    expect(index.blockers).toContain(
      'canvas-web: 12 moderate/high/critical dependency vulnerability(ies) reported.'
    );
    expect(index.blockers).not.toContain(
      '12 moderate/high/critical dependency vulnerability(ies) reported.'
    );
  });

  it('writes cross-tool grounding files', async () => {
    const workspacePath = await makeWorkspace();
    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: true,
      refreshContext: true,
    });

    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        AGENT_REPORTS_INDEX_PATH,
        WORKSPACE_SKILLS_INDEX_PATH,
        AGENT_GROUNDING_DOC_PATH,
        'AGENTS.md',
        '.github/copilot-instructions.md',
        WORKSPAI_CURSOR_GROUNDING_RULE_PATH,
        LEGACY_CURSOR_GROUNDING_RULE_PATH,
        'CLAUDE.md',
        'GEMINI.md',
        'QWEN.md',
        '.amazonq/rules/workspai-agent-entry.md',
        WORKSPAI_COPILOT_GROUNDING_SKILL_PATH,
        LEGACY_COPILOT_GROUNDING_SKILL_PATH,
        AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
      ])
    );

    const agents = await fsExtra.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(RAPIDKIT_AGENT_GROUNDING_START);
    expect(agents).toContain('Read order (mandatory before workspace diagnosis)');

    const claude = await fsExtra.readFile(path.join(workspacePath, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('@AGENTS.md');
    expect(await fsExtra.readFile(path.join(workspacePath, 'GEMINI.md'), 'utf8')).toContain(
      '@./AGENTS.md'
    );
    expect(await fsExtra.readFile(path.join(workspacePath, 'QWEN.md'), 'utf8')).toContain(
      '@AGENTS.md'
    );
    expect(
      await fsExtra.readFile(
        path.join(workspacePath, '.amazonq/rules/workspai-agent-entry.md'),
        'utf8'
      )
    ).toContain('Amazon Q Developer');

    const cursorRule = await fsExtra.readFile(
      path.join(workspacePath, WORKSPAI_CURSOR_GROUNDING_RULE_PATH),
      'utf8'
    );
    expect(cursorRule).toContain('alwaysApply: true');

    const groundingDoc = await fsExtra.readFile(
      path.join(workspacePath, AGENT_GROUNDING_DOC_PATH),
      'utf8'
    );
    expect(groundingDoc).toContain('## Mandatory read order');

    const reportsIndex = await fsExtra.readJson(path.join(workspacePath, AGENT_REPORTS_INDEX_PATH));
    expect(
      reportsIndex.reports.find(
        (report: { path: string }) => report.path === WORKSPACE_SKILLS_INDEX_PATH
      )
    ).toMatchObject({ required: true, exists: true, validity: 'valid' });

    const pack = await fsExtra.readJson(
      path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH)
    );
    expect(pack.schemaVersion).toBe('rapidkit-agent-customization-pack.v1');
    expect(pack.answerContract).toEqual([
      'Scope',
      'Evidence',
      'Diagnosis',
      'Fix Plan',
      'Run',
      'Verify',
      'Assumptions',
    ]);
    expect(pack.outputInventory.map((output: { path: string }) => output.path)).toEqual(
      expect.arrayContaining([
        WORKSPAI_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
        LEGACY_COPILOT_WORKSPACE_INSTRUCTIONS_PATH,
        WORKSPAI_COPILOT_REPAIR_PROMPT_PATH,
        LEGACY_COPILOT_REPAIR_PROMPT_PATH,
        WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
        LEGACY_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH,
        `${path.dirname(WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH)}/resources/artifact-map.md`,
        `${path.dirname(WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH)}/resources/mcp-tools.md`,
        '.github/agents/workspai-advisor.agent.md',
        WORKSPAI_MCP_DESIGN_REPORT_PATH,
        LEGACY_MCP_DESIGN_REPORT_PATH,
      ])
    );
    expect(pack.experimental).toEqual({
      hooksEnabled: false,
      mcpReady: true,
    });

    const intelligenceSkill = await fsExtra.readFile(
      path.join(workspacePath, WORKSPAI_COPILOT_WORKSPACE_INTELLIGENCE_SKILL_PATH),
      'utf8'
    );
    expect(intelligenceSkill).toContain('Operational skills (canonical)');

    const mcpDesign = await fsExtra.readJson(
      path.join(workspacePath, WORKSPAI_MCP_DESIGN_REPORT_PATH)
    );
    expect(mcpDesign.mode).toBe('read-mostly');
    expect(mcpDesign.safety.writeToolsEnabled).toBe(false);
  });

  it('supports a VS Code target dry run without writing files', async () => {
    const workspacePath = await makeWorkspace();
    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: false,
      dryRun: true,
      preset: 'enterprise',
      targets: ['vscode'],
    });

    expect(result.pack?.targets).toEqual(['vscode']);
    expect(result.pack?.outputInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '.github/agents/workspai-repair.agent.md',
          status: 'planned',
        }),
      ])
    );
    expect(
      await fsExtra.pathExists(path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH))
    ).toBe(false);
  });

  it('plans advisory VS Code hooks only when explicitly requested', async () => {
    const workspacePath = await makeWorkspace();
    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: true,
      preset: 'enterprise',
      targets: ['vscode'],
      experimentalHooks: true,
    });

    expect(result.writtenFiles).toContain(WORKSPAI_VSCODE_AGENT_HOOKS_PATH);
    expect(result.writtenFiles).toContain(LEGACY_VSCODE_AGENT_HOOKS_PATH);

    const hooks = await fsExtra.readJson(
      path.join(workspacePath, WORKSPAI_VSCODE_AGENT_HOOKS_PATH)
    );
    expect(hooks.enabledByDefault).toBe(false);
    expect(hooks.mode).toBe('advisory');

    const pack = await fsExtra.readJson(
      path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH)
    );
    expect(pack.experimental.hooksEnabled).toBe(true);
    expect(pack.outputInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: LEGACY_VSCODE_AGENT_HOOKS_PATH,
          kind: 'hook',
          status: 'written',
        }),
        expect.objectContaining({
          path: WORKSPAI_VSCODE_AGENT_HOOKS_PATH,
          kind: 'hook',
          status: 'written',
        }),
      ])
    );
  });

  it('fails strict mode when required context is missing', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-agent-sync-strict-'));
    tempDirs.push(workspacePath);
    await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
      workspace_name: 'empty',
    });

    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: false,
      strict: true,
    });

    expect(result.strictViolations.join('\n')).toContain('Missing required reports');
  });

  it('enforces project entry coverage only for the selected agent host', async (context) => {
    const workspacePath = await makeWorkspace();
    const projectPath = path.join(workspacePath, 'apps', 'api');
    const outsideAmazonQ = path.join(workspacePath, 'outside-amazonq');
    await fsExtra.outputJson(path.join(projectPath, '.workspai', 'project.json'), {
      schema_version: '1.0',
      name: 'api',
      runtime: 'node',
      framework: 'express',
    });
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      generatedAt: new Date().toISOString(),
      workspace: { name: 'sync-lab', profile: 'polyglot' },
      projects: [
        {
          slug: 'api',
          relativePath: 'apps/api',
          relationship: 'managed',
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
    await fsExtra.ensureDir(outsideAmazonQ);
    try {
      await fsExtra.symlink(outsideAmazonQ, path.join(projectPath, '.amazonq'), 'dir');
    } catch {
      context.skip();
      return;
    }

    const codex = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: true,
      strict: true,
      targets: ['codex'],
    });
    expect(codex.strictViolations.join('\n')).not.toContain('Project agent entry coverage blocked');

    const amazonQ = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: true,
      strict: true,
      targets: ['amazon-q'],
    });
    expect(amazonQ.strictViolations.join('\n')).toContain(
      'Project agent entry coverage blocked: api:amazon-q'
    );
    expect(
      await fsExtra.pathExists(path.join(outsideAmazonQ, 'rules', 'workspai-agent-entry.md'))
    ).toBe(false);
  });

  it('refuses to write a workspace host adapter through an authored parent symlink', async (context) => {
    const workspacePath = await makeWorkspace();
    const outsidePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-agent-sync-outside-'));
    tempDirs.push(outsidePath);
    try {
      await fsExtra.symlink(outsidePath, path.join(workspacePath, '.amazonq'), 'dir');
    } catch {
      context.skip();
      return;
    }

    await expect(
      syncWorkspaceAgentGrounding({
        workspacePath,
        write: true,
        targets: ['amazon-q'],
      })
    ).rejects.toThrow(/blocked by authored repository state/);
    expect(
      await fsExtra.pathExists(path.join(outsidePath, 'rules', 'workspai-agent-entry.md'))
    ).toBe(false);
  });

  it('does not treat the accepted model snapshot baseline as TTL-stale', async () => {
    const workspacePath = await makeWorkspace();
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-model-snapshot.json'),
      {
        schemaVersion: 'workspace-model-snapshot.v1',
        generatedAt: '2020-01-01T00:00:00.000Z',
        modelHash: 'a'.repeat(64),
        modelRef: '.workspai/reports/workspace-model.json',
        model: { schemaVersion: 'workspace-model.v1' },
      }
    );

    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: false,
      staleAfterHours: 1,
      now: new Date(),
    });

    expect(result.staleReports).not.toContain('.workspai/reports/workspace-model-snapshot.json');
  });

  it('uses the newest append-only history entry as the history freshness boundary', async () => {
    const workspacePath = await makeWorkspace();
    const now = new Date('2026-07-27T12:00:00.000Z');
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-intelligence-history.json'),
      {
        schemaVersion: 'workspace-intelligence-history.v1',
        retention: 50,
        entries: [
          { generatedAt: '2020-01-01T00:00:00.000Z', kind: 'verify' },
          { generatedAt: '2026-07-27T11:55:00.000Z', kind: 'verify' },
        ],
      }
    );

    const result = await syncWorkspaceAgentGrounding({
      workspacePath,
      write: false,
      staleAfterHours: 1,
      now,
    });
    const index = await buildWorkspaceAgentReportsIndex({
      workspacePath,
      staleAfterHours: 1,
      now,
    });
    const historyPath = '.workspai/reports/workspace-intelligence-history.json';
    const history = index.reports.find((report) => report.path === historyPath);

    expect(history?.generatedAt).toBe('2026-07-27T11:55:00.000Z');
    expect(result.staleReports).not.toContain(historyPath);
  });

  it('rolls back every generated surface when agent-sync fails before its pack commit', async () => {
    const workspacePath = await makeWorkspace();
    const projectPath = path.join(workspacePath, 'app');
    await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
      name: 'app',
      version: '1.0.0',
    });
    await fsExtra.outputJson(path.join(workspacePath, '.workspai', 'workspace.contract.json'), {
      workspace: { name: 'sync-lab', profile: 'minimal' },
      projects: [{ slug: 'app', relativePath: 'app', relationship: 'managed' }],
    });
    const agentsPath = path.join(workspacePath, 'AGENTS.md');
    await fsExtra.writeFile(agentsPath, '# operator-owned preimage\n');

    process.env.WORKSPAI_TEST_FAIL_AGENT_SYNC_BEFORE_PACK = '1';
    try {
      await expect(
        syncWorkspaceAgentGrounding({
          workspacePath,
          write: true,
          preset: 'enterprise',
          targets: ['all'],
        })
      ).rejects.toThrow('Injected agent-sync failure');
    } finally {
      delete process.env.WORKSPAI_TEST_FAIL_AGENT_SYNC_BEFORE_PACK;
    }

    expect(await fsExtra.readFile(agentsPath, 'utf8')).toBe('# operator-owned preimage\n');
    expect(
      await fsExtra.pathExists(path.join(workspacePath, AGENT_CUSTOMIZATION_PACK_REPORT_PATH))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(
        path.join(workspacePath, '.github', 'agents', 'workspai-repair.agent.md')
      )
    ).toBe(false);
    for (const relativePath of [
      '.workspai/agent-entry.v1.json',
      'CLAUDE.md',
      'GEMINI.md',
      'QWEN.md',
      '.amazonq/rules/workspai-agent-entry.md',
    ]) {
      expect(await fsExtra.pathExists(path.join(projectPath, relativePath))).toBe(false);
    }
  });
});
