import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseWorkspaceExplainTarget,
  resolveWorkspaceTraceTarget,
} from '../contracts/workspace-explain-contract.js';
import {
  WORKSPACE_EXPLAIN_REPORT_PATH,
  WORKSPACE_EXPLAIN_SCHEMA_VERSION,
  WORKSPACE_TRACE_REPORT_PATH,
  WORKSPACE_WHY_REPORT_PATH,
} from '../contracts/workspace-explain-contract.js';
import {
  buildWorkspaceExplain,
  resolveWorkspaceExplainArtifactPath,
  writeWorkspaceExplainReport,
} from '../workspace-explain.js';
import { WORKSPACE_VERIFY_REPORT_PATH } from '../workspace-verify.js';

let workspacePath: string;

function verifyFixture(input: {
  risk: 'low' | 'high';
  affectedProjects: number;
  blockers: string[];
  verdict?: 'ready' | 'needs-attention' | 'blocked';
}) {
  return {
    schemaVersion: 'workspace-verify.v1',
    generatedAt: new Date().toISOString(),
    workspacePath,
    mode: 'evidence',
    summary: {
      verdict: input.verdict ?? 'blocked',
      exitCode: (input.verdict ?? 'blocked') === 'blocked' ? 2 : 0,
      stepsPassed: 0,
      stepsWarn: 0,
      stepsFailed: 0,
      stepsMissing: input.blockers.length,
      stepsSkipped: 0,
    },
    impact: {
      changed: input.affectedProjects > 0,
      risk: input.risk,
      affectedProjects: input.affectedProjects,
      recommendedCommands: 0,
    },
    freshness: {
      verdict: 'fresh',
      baseline: 'none',
      changed: [],
      added: [],
      removed: [],
      projectHashes: {},
    },
    blockingReasons: input.blockers,
    missingEvidence: [],
    resolutionHints: [],
    steps: [],
    verificationPlan: [],
    affectedSubgraph: {
      totalProjects: input.affectedProjects,
      directlyChanged: [],
      transitiveDependents: [],
      covered: [],
      uncovered: [],
      unverifiable: [],
    },
    graphIntegrity: {
      ok: true,
      cycles: [],
      danglingEdges: [],
      orphans: [],
      stats: { nodeCount: 0, edgeCount: 0, cycleCount: 0, danglingCount: 0, orphanCount: 0 },
    },
    policyMode: 'warn',
    policyViolations: [],
  };
}

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'rk-explain-'));
  await fsExtra.outputJson(path.join(workspacePath, '.rapidkit', 'workspace.json'), {
    workspace_name: 'explain-lab',
  });
});

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true });
});

describe('workspace explain (Phase 4.B)', () => {
  it('parses explain targets', () => {
    expect(parseWorkspaceExplainTarget('release-blocked')).toEqual({ kind: 'release-blocked' });
    expect(parseWorkspaceExplainTarget('project:api')).toEqual({
      kind: 'project',
      project: 'api',
    });
    expect(parseWorkspaceExplainTarget('api')).toEqual({ kind: 'project', project: 'api' });
    expect(parseWorkspaceExplainTarget('blocker:doctor.workspace')).toEqual({
      kind: 'blocker',
      blockerId: 'doctor.workspace',
    });
    expect(parseWorkspaceExplainTarget('trace:diff.json')).toEqual({
      kind: 'trace',
      diffRef: 'diff.json',
    });
  });

  it('resolves workspace trace targets from diff artifact paths', () => {
    expect(
      resolveWorkspaceTraceTarget('.workspai/reports/workspace-model-diff-last-run.json')
    ).toEqual({
      kind: 'trace',
      diffRef: '.workspai/reports/workspace-model-diff-last-run.json',
    });
    expect(resolveWorkspaceTraceTarget('trace:custom-diff.json')).toEqual({
      kind: 'trace',
      diffRef: 'custom-diff.json',
    });
    expect(resolveWorkspaceTraceTarget('api')).toBeNull();
  });

  it('uses scaffold wording for release-blocked explain in an empty workspace', async () => {
    await fsExtra.outputJson(
      path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH),
      verifyFixture({
        risk: 'low',
        affectedProjects: 0,
        blockers: ['workspace.doctor: Doctor evidence is stale'],
      })
    );

    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
    });

    expect(report.summary).toContain('Workspace scaffold');
    expect(report.summary).toContain('pre-project');
    expect(report.summary).not.toContain('Release blocked');
  });

  it('builds release-blocked explain from verify report', async () => {
    await fsExtra.outputJson(
      path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH),
      verifyFixture({
        risk: 'high',
        affectedProjects: 1,
        blockers: ['doctor workspace failed'],
      })
    );

    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
      model: { summary: { projectCount: 1 }, projects: [] } as never,
    });

    expect(report.schemaVersion).toBe(WORKSPACE_EXPLAIN_SCHEMA_VERSION);
    expect(report.summary).toContain('blocked');
    expect(report.blockingReasons).toContain('doctor workspace failed');
    expect(report.releaseVerdict).toBe('blocked');
    expect(report.evidenceFreshness).toBe('fresh');
    expect(report.blocking).toBe(true);
  });

  it('publishes needs-attention as advisory when verify has no blocking reason', async () => {
    await fsExtra.outputJson(
      path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH),
      verifyFixture({
        risk: 'high',
        affectedProjects: 1,
        blockers: [],
        verdict: 'needs-attention',
      })
    );

    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
      model: { summary: { projectCount: 1 }, projects: [] } as never,
    });

    expect(report.releaseVerdict).toBe('needs-attention');
    expect(report.blockingReasons).toEqual([]);
    expect(report.blocking).toBe(false);
    expect(report.summary).toBe(
      'Release needs attention: advisory or incomplete verification evidence remains; no blocking reason was reported.'
    );
    expect(report.summary).not.toContain('0 blocking reason');
  });

  it('renders structured resolution hints and blocker-specific guidance', async () => {
    const verify = verifyFixture({
      risk: 'high',
      affectedProjects: 1,
      blockers: ['doctor.workspace: evidence is stale'],
    });
    verify.resolutionHints = [
      {
        blockerId: 'doctor.workspace',
        resolutionClass: 'command',
        commandRetryHint: 'npx workspai doctor workspace --json',
        fixHints: [{ detail: 'Refresh doctor evidence' }],
      },
    ] as never;
    const model = { summary: { projectCount: 1 }, projects: [] } as never;

    const release = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'release-blocked' },
      model,
      contract: null,
      verify,
      impact: null,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
    const blocker = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'blocker', blockerId: 'doctor.workspace' },
      model,
      contract: null,
      verify,
      impact: null,
    });
    const unknown = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'blocker', blockerId: 'unknown.blocker' },
      model,
      contract: null,
      verify,
      impact: null,
    });

    expect(release.generatedAt).toBe('2026-07-19T00:00:00.000Z');
    expect(release.sections.find((section) => section.id === 'resolution')?.body).toContain(
      'npx workspai doctor workspace --json'
    );
    expect(blocker.summary).toBe('Blocker doctor.workspace: command');
    expect(blocker.resolutionHints).toHaveLength(1);
    expect(unknown.summary).toContain('no structured hint');
    expect(unknown.sections[1].body).toContain('Run workspace verify');
  });

  it('explains a project across graph, contracts, consumers, verification, and impact', async () => {
    const graph = {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: '2026-07-19T00:00:00.000Z',
      nodes: [
        { id: 'api', path: 'services/api' },
        { id: 'web', path: 'apps/web' },
      ],
      edges: [
        {
          from: 'web',
          to: 'api',
          kind: 'service-dependsOn',
          source: 'contract',
          confidence: 'high',
          evidence: [],
        },
      ],
      stats: {
        nodeCount: 2,
        edgeCount: 1,
        inferredEdges: 0,
        contractEdges: 1,
        manualEdges: 0,
        hasCycle: false,
      },
    };
    const model = {
      summary: { projectCount: 2 },
      projects: [
        {
          name: 'api',
          path: 'services/api',
          frameworkDisplayName: 'FastAPI',
          runtime: 'python',
        },
        { name: 'web', path: 'apps/web', frameworkDisplayName: 'Next.js', runtime: 'node' },
      ],
      graph,
    } as never;
    const contract = {
      projects: [
        {
          slug: 'api',
          relativePath: 'services/api',
          contracts: {
            owns: ['users'],
            publishes: ['user.created'],
            consumes: [],
            dependsOn: [],
            apis: [{ name: 'users-api' }],
          },
        },
        {
          slug: 'web',
          relativePath: 'apps/web',
          contracts: {
            owns: [],
            publishes: [],
            consumes: ['user.created'],
            dependsOn: ['api'],
            apis: [],
          },
        },
      ],
    } as never;
    const verify = verifyFixture({ risk: 'high', affectedProjects: 1, blockers: [] });
    verify.steps = [
      {
        scope: 'project',
        project: 'api',
        command: { display: 'pytest -q' },
      },
      { scope: 'workspace', command: { display: 'ignored' } },
    ] as never;
    const impact = {
      affectedProjects: [{ target: 'api', risk: 'critical' }],
      transitiveImpact: [],
      summary: { risk: 'high' },
    } as never;

    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'project', project: 'api' },
      model,
      contract,
      verify,
      impact,
    });

    expect(report.summary).toContain('1 consumer(s)');
    expect(report.releaseRisk).toBe('critical');
    expect(report.sections.find((section) => section.id === 'consumers')?.body).toContain('web');
    expect(report.sections.find((section) => section.id === 'contracts')?.body).toContain(
      'users-api'
    );
    expect(report.sections.find((section) => section.id === 'verification')?.body).toContain(
      'pytest -q'
    );
    expect(report.sections.find((section) => section.id === 'centrality')?.body).toContain(
      'fanIn 1'
    );
  });

  it('renders trace fallbacks when diff, impact, and verify artifacts are absent', async () => {
    const report = await buildWorkspaceExplain({
      workspacePath,
      target: { kind: 'trace', diffRef: 'missing-diff.json' },
      model: { summary: { projectCount: 0 }, projects: [] } as never,
      contract: null,
      verify: null,
      impact: null,
    });

    expect(report.summary).toContain('workspace scaffold baseline');
    expect(report.sections.find((section) => section.id === 'origin')?.body).toContain(
      'No changed projects'
    );
    expect(report.sections.find((section) => section.id === 'blast-radius')?.body).toContain(
      'No transitive impact'
    );
    expect(report.sections.find((section) => section.id === 'gate')?.body).toContain(
      'No verify subgraph'
    );
  });

  it('rejects malformed verify evidence instead of narrating unvalidated data', async () => {
    await fsExtra.outputJson(path.join(workspacePath, WORKSPACE_VERIFY_REPORT_PATH), {
      schemaVersion: 'workspace-verify.v1',
      generatedAt: new Date().toISOString(),
      summary: { verdict: 'blocked', exitCode: 2 },
    });

    await expect(
      buildWorkspaceExplain({
        workspacePath,
        target: { kind: 'release-blocked' },
      })
    ).rejects.toThrow('violates contracts/workspace-intelligence/workspace-verify.v1.json');
  });

  it('writes explain, why, and trace artifacts to separate last-run paths', async () => {
    const baseReport = {
      schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      workspacePath,
      summary: 'Narrative summary',
      sections: [{ id: 's1', title: 'Section', body: 'Body' }],
    };

    await writeWorkspaceExplainReport(
      { ...baseReport, target: { kind: 'release-blocked' } },
      workspacePath,
      'explain'
    );
    await writeWorkspaceExplainReport(
      { ...baseReport, target: { kind: 'release-blocked' } },
      workspacePath,
      'why'
    );
    await writeWorkspaceExplainReport(
      {
        ...baseReport,
        target: { kind: 'trace', diffRef: '.workspai/reports/workspace-model-diff-last-run.json' },
      },
      workspacePath,
      'trace'
    );

    expect(resolveWorkspaceExplainArtifactPath('explain')).toBe(WORKSPACE_EXPLAIN_REPORT_PATH);
    expect(resolveWorkspaceExplainArtifactPath('why')).toBe(WORKSPACE_WHY_REPORT_PATH);
    expect(resolveWorkspaceExplainArtifactPath('trace')).toBe(WORKSPACE_TRACE_REPORT_PATH);
    expect(await fsExtra.pathExists(path.join(workspacePath, WORKSPACE_EXPLAIN_REPORT_PATH))).toBe(
      true
    );
    expect(await fsExtra.pathExists(path.join(workspacePath, WORKSPACE_WHY_REPORT_PATH))).toBe(
      true
    );
    expect(await fsExtra.pathExists(path.join(workspacePath, WORKSPACE_TRACE_REPORT_PATH))).toBe(
      true
    );
  });
});
