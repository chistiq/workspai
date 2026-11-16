import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import fsExtra from 'fs-extra';

import { agentTaskContextByteBudget, buildAgentTaskContext } from '../agent-task-context.js';
import * as projectAgentEntry from '../project-agent-entry.js';
import * as graphSnapshot from '../workspace-knowledge-graph-snapshot.js';
import * as graphView from '../workspace-graph-search-view.js';
import { syncProjectIntelligenceLens } from '../project-intelligence-lens.js';
import { writeProjectWorkspaceLink } from '../project-workspace-link.js';
import { buildWorkspaceModel, writeWorkspaceModel } from '../workspace-model.js';
import { buildWorkspaceAgentContext, writeWorkspaceAgentContext } from '../workspace-context.js';
import {
  buildWorkspaceOperationalSkills,
  writeWorkspaceOperationalSkills,
} from '../workspace-operational-skills.js';
import {
  buildWorkspaceAgentReportsIndex,
  AGENT_REPORTS_INDEX_PATH,
} from '../workspace-agent-sync.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';
import { buildPolyglotLifecyclePlan } from '../polyglot-lifecycle-plan.js';
import { buildAgentBootstrapView } from '../agent-bootstrap-view.js';

let projectPath: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (projectPath) await rm(projectPath, { recursive: true, force: true });
  projectPath = undefined;
});

async function managedProject(location: 'linked' | 'parent' | 'managed-default' = 'linked') {
  projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-managed-'));
  const homeDir = path.join(projectPath, 'test-home');
  const workspacePath =
    location === 'parent'
      ? projectPath
      : location === 'managed-default'
        ? path.join(homeDir, '.workspai', 'workspaces', 'workspai')
        : path.join(projectPath, 'workspace');
  const sourcePath = path.join(projectPath, 'sources', 'api');
  await fsExtra.outputFile(path.join(workspacePath, '.workspai-workspace'), 'lab\n');
  await fsExtra.outputJson(path.join(workspacePath, '.rapidkit/workspace.json'), {
    workspace_name: 'lab',
    profile: 'polyglot',
  });
  const projects = ['api', 'worker'].map((name) => ({
    slug: name,
    relativePath: `external/${name}`,
    externalPath: path.join(projectPath!, 'sources', name),
    relationship: 'adopted',
    runtime: 'node',
    framework: 'generic',
    modules: [],
    ports: [],
    contracts: { owns: [], apis: [], publishes: [], consumes: [], dependsOn: [], env: [] },
  }));
  await fsExtra.outputJson(
    path.join(workspacePath, WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract),
    {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'lab', profile: 'polyglot' },
      projects,
    }
  );
  for (const project of projects) {
    await fsExtra.outputJson(path.join(project.externalPath, 'package.json'), {
      name: project.slug,
      version: '1.0.0',
      workspaces: ['packages/*'],
      scripts: { test: 'node --test', build: 'tsc' },
    });
    await fsExtra.outputFile(
      path.join(project.externalPath, 'src/index.ts'),
      'export function retryDelay(attempt: number) { return attempt * 100; }\n'
    );
    await fsExtra.outputFile(
      path.join(project.externalPath, 'tests/retry.test.ts'),
      'retryDelay(1);\n'
    );
    await fsExtra.outputJson(path.join(project.externalPath, '.workspai/project.json'), {
      schema_version: '1.0',
      name: project.slug,
      runtime: 'node',
      framework: 'generic',
      adoption: { managed_by: 'workspai', mode: 'linked' },
    });
    await writeProjectWorkspaceLink({
      workspacePath,
      projectPath: project.externalPath,
      projectName: project.slug,
      relationship: 'adopted',
      relativePath: project.relativePath,
    });
  }
  const lens = {
    workspacePath,
    projectPath: sourcePath,
    projectName: 'api',
    relationship: 'adopted' as const,
    mode: 'managed' as const,
  };
  await syncProjectIntelligenceLens(lens);
  await fsExtra.outputJson(path.join(sourcePath, 'packages/ui/package.json'), {
    name: 'ui',
    scripts: { test: 'vitest run', build: 'vite build' },
  });
  await fsExtra.outputFile(
    path.join(sourcePath, 'packages/ui/src/widget.ts'),
    'export const widget = 1;\n'
  );
  const model = await buildWorkspaceModel({ workspacePath, includeEvidence: true });
  await writeWorkspaceModel(model, workspacePath);
  const context = await buildWorkspaceAgentContext({ workspacePath, model, agent: 'generic' });
  await writeWorkspaceAgentContext(context, workspacePath);
  await writeWorkspaceOperationalSkills({
    workspacePath,
    skills: buildWorkspaceOperationalSkills({ workspacePath, model, context }),
    generatedAt: new Date().toISOString(),
    write: true,
  });
  await fsExtra.outputJson(
    path.join(workspacePath, AGENT_REPORTS_INDEX_PATH),
    await buildWorkspaceAgentReportsIndex({ workspacePath })
  );
  await syncProjectIntelligenceLens(lens);
  return { workspacePath, sourcePath, homeDir };
}

describe('agent task context', () => {
  it('keeps a foreign Goal warning visible without exposing its repair route as a task continuation', async () => {
    const { sourcePath } = await managedProject();
    const receipt = await projectAgentEntry.buildAgentBootstrapReceipt({ startPath: sourcePath });
    receipt.activeGoal = {
      present: true,
      appliesToProject: false,
      status: 'invalid',
      id: 'goal-foreign',
      objective: 'Repair the other project',
      goalPack: 'workspace:.workspai/goals/foreign/goal-pack.json',
    };
    receipt.status = 'degraded';
    receipt.readiness.agentGrounding = 'degraded';
    receipt.checks = receipt.checks.filter((check) => check.id !== 'active-goal');
    receipt.checks.push({
      id: 'active-goal',
      status: 'warning',
      message: 'Foreign goal is invalid; project evidence remains usable.',
    });
    receipt.nextActions = ['workspai goal --status --json'];
    const { integrity, ...unsigned } = receipt;
    receipt.integrity = { ...integrity, payloadHash: hashCanonicalJson(unsigned) };
    const view = buildAgentBootstrapView(receipt, { projectTask: true });
    expect(view.status).toBe('degraded');
    if (view.status === 'insufficient-budget') throw new Error('Unexpected budget refusal');
    expect(view.activeGoal).toEqual({ present: true, appliesToProject: false, status: 'invalid' });
    expect(view.checks.findings.some((finding) => finding.id === 'active-goal')).toBe(true);
    expect(view.nextActions.join(' ')).toContain('Continue authorized project work');
    expect(view.nextActions.join(' ')).not.toContain('workspai goal');
    expect(JSON.stringify(view.requiredReadOrder)).not.toContain('goals/foreign');
  });
  it.each([
    { args: ['doctor', 'workspace', '--project', '--json'] },
    { args: ['doctor', 'project', '--workspace', '--json'] },
  ])('rejects contradictory Doctor scopes before collecting evidence: %j', async ({ args }) => {
    const result = await execa(process.execPath, [path.resolve('dist/index.js'), ...args], {
      reject: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('scopes are mutually exclusive');
  });

  it('does not advertise a proven foreign Skill in the project host entry', async () => {
    const { workspacePath, sourcePath } = await managedProject();
    const indexPath = path.join(workspacePath, '.workspai/reports/workspace-skills-index.json');
    const index = await fsExtra.readJson(indexPath);
    index.skills.push({
      skillId: 'worker-specialist',
      title: 'Worker specialist',
      path: '.workspai/skills/worker-specialist.md',
      schemaVersion: 'workspace-operational-skill.v1',
      scopedProjects: ['worker'],
    });
    await fsExtra.writeJson(indexPath, index);
    await syncProjectIntelligenceLens({
      workspacePath,
      projectPath: sourcePath,
      projectName: 'api',
      relationship: 'adopted',
      mode: 'managed',
    });
    expect(
      await fsExtra.pathExists(path.join(sourcePath, '.agents/skills/worker-specialist/SKILL.md'))
    ).toBe(false);
    expect(
      await fsExtra.pathExists(
        path.join(sourcePath, '.agents/skills/workspai-node-runtime-validation/SKILL.md')
      )
    ).toBe(true);
  });
  it('enters a canonical linked project once and returns scoped evidence without repeating completed reads', async () => {
    const { sourcePath } = await managedProject();
    const projectGrounding = await readFile(
      path.join(sourcePath, '.workspai', 'PROJECT-GROUNDING.md'),
      'utf8'
    );
    const bootstrap = vi.spyOn(projectAgentEntry, 'buildAgentBootstrapReceipt');
    const snapshots = vi.spyOn(graphSnapshot, 'readWorkspaceKnowledgeGraphSnapshot');
    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Fix retryDelay calculation and test retries',
      path: 'src/index.ts',
    });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(result.scope).toMatchObject({
      project: 'api',
      workspace: 'lab',
      projectPath: 'external/api',
      binding: 'canonical-project-member',
      workspaceResolution: {
        status: 'resolved',
        source: 'local-link',
        managedDefault: false,
      },
    });
    expect(result.execution).toMatchObject({
      cwdBase: 'canonical-project-root',
      sourceReadsChangeCwd: false,
      workspaceLocator: {
        base: 'canonical-workspace-root',
        resolveCommand: 'workspai project workspace status --json',
        resolveCommandCwd: '.',
        pathField: 'workspacePath',
      },
    });
    expect(result.delivery).toEqual({
      status: 'prepared',
      hostLoading: 'not-observed',
      modelCompliance: 'not-observed',
    });
    expect(result.graph.status).toBe('results');
    if (result.graph.status !== 'results' || result.grounding.status !== 'ready') {
      throw new Error('Expected complete managed evidence');
    }
    expect(result.graph.matches.length).toBeGreaterThan(0);
    expect(result.graph.matches.every((match) => !match.project || match.project === 'api')).toBe(
      true
    );
    expect(result.graph.proofs.some((proof) => proof.artifact.endsWith('src/index.ts'))).toBe(true);
    expect(result.grounding.requiredReadOrder.join('\n')).not.toMatch(
      /command:workspai (agent bootstrap|project workspace status|workspace graph search)/
    );
    expect(result.grounding.requiredReadOrder).not.toContain(
      result.grounding.canonicalEvidence.projectContext
    );
    expect(result.grounding.requiredReadOrder).not.toContain(
      result.grounding.canonicalEvidence.workspaceSkillsIndex
    );
    expect(result.skill).toMatchObject({
      scope: 'project',
      project: 'api',
      runtimes: ['node'],
      skillId: 'workspai-node-runtime-validation',
      authority: 'guidance-only',
    });
    expect(JSON.stringify(result.skill)).not.toContain('worker');
    expect(result.grounding.nextActions.join('\n')).not.toContain(
      'workspai workspace graph search'
    );
    expect(result.lifecycle).toMatchObject({
      status: 'ready',
      units: [{ manifest: 'package.json' }],
    });
    expect(result.budget.usedBytes).toBe(Buffer.byteLength(`${JSON.stringify(result)}\n`, 'utf8'));
    expect(JSON.stringify(result)).not.toContain(sourcePath);
    expect(result.operatingRules.join(' ')).toContain('never require or execute that file');
    expect(result.operatingRules.join(' ')).toContain('locators, not a reading checklist');
    expect(result.operatingRules.join(' ')).toContain('silence alone is not failure');
    expect(result.operatingRules.join(' ')).toContain('Scope is this project');
    expect(result.operatingRules.join(' ')).toContain('workspaceResolution is authoritative');
    expect(result.operatingRules.join(' ')).toContain('delivery.hostLoading/modelCompliance');
    expect(projectGrounding).toContain('scope.workspaceResolution');
    expect(projectGrounding).toContain('managedDefault');
    expect(projectGrounding).toContain('do not repeat an identical CLI or MCP query');

    const cli = await execa(
      process.execPath,
      [
        path.resolve('dist/index.js'),
        'agent',
        'context',
        '--task',
        'Inspect the widget',
        '--path',
        'packages/ui/src/widget.ts',
      ],
      { cwd: path.join(sourcePath, 'packages/ui'), reject: false }
    );
    expect(cli.exitCode).toBe(0);
    const installedPacket = JSON.parse(cli.stdout);
    expect(installedPacket).toMatchObject({
      status: 'ready',
      scope: { project: 'api', binding: 'canonical-project-member' },
      lifecycle: { status: 'ready', units: [{ manifest: 'packages/ui/package.json' }] },
    });
    expect(installedPacket.lifecycle.units[0].stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'test', command: 'npm run test', cwd: 'packages/ui' }),
      ])
    );
    expect(installedPacket.budget.usedBytes).toBe(Buffer.byteLength(`${cli.stdout}\n`, 'utf8'));
    expect(cli.stdout).not.toContain(sourcePath);

    const fromParent = await execa(
      process.execPath,
      [
        path.resolve('dist/index.js'),
        'agent',
        'context',
        '--task',
        'Inspect the widget',
        '--project',
        path.relative(projectPath!, sourcePath),
        '--path',
        'packages/ui/src/widget.ts',
        '--for-agent',
        'copilot',
      ],
      { cwd: projectPath! }
    );
    expect(JSON.parse(fromParent.stdout)).toMatchObject({
      status: 'ready',
      scope: { project: 'api', binding: 'canonical-project-member' },
      selection: { source: 'explicit-project', verifiedBy: 'canonical-membership' },
    });

    // Hosts may save plain JSON with a .txt suffix. Parsing must not execute it
    // or send the whole packet back into the conversation via an error stack.
    const savedOutput = path.join(projectPath!, 'host-output.txt');
    await writeFile(savedOutput, cli.stdout);
    const selected = execFileSync(
      process.execPath,
      [
        '-e',
        "const fs = require('node:fs'); const p = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const selected = p.status === 'insufficient-budget' ? {status:p.status, budget:p.budget, message:p.message, nextActions:p.nextActions} : {status:p.status, scope:p.scope, findings:p.grounding?.checks?.findings, proofs:p.graph?.proofs, lifecycle:p.lifecycle, skill:p.skill, execution:p.execution}; console.log(JSON.stringify(selected));",
        savedOutput,
      ],
      { encoding: 'utf8' }
    );
    expect(JSON.parse(selected)).toMatchObject({
      status: 'ready',
      scope: { project: 'api' },
      findings: [],
    });
    expect(selected.length).toBeLessThan(cli.stdout.length);

    const budgetRequest = 'x'.repeat(4000);
    const budgetRefusal = await execa(
      process.execPath,
      [
        path.resolve('dist/index.js'),
        'agent',
        'context',
        '--task',
        budgetRequest,
        '--max-bytes',
        '8192',
      ],
      { cwd: sourcePath, reject: false }
    );
    expect(budgetRefusal.exitCode).toBe(0);
    const budgetPacket = JSON.parse(budgetRefusal.stdout);
    expect(budgetPacket).toMatchObject({
      status: 'insufficient-budget',
      budget: { maxBytes: 8192, accounting: 'utf8-json-with-newline' },
      nextActions: [expect.any(String)],
    });
    expect(budgetPacket).not.toHaveProperty('grounding');

    const strictRefusal = await execa(
      process.execPath,
      [
        path.resolve('dist/index.js'),
        'agent',
        'context',
        '--task',
        budgetRequest,
        '--max-bytes',
        '8192',
        '--strict',
      ],
      { cwd: sourcePath, reject: false }
    );
    expect(strictRefusal.exitCode).toBe(2);
    expect(JSON.parse(strictRefusal.stdout)).toMatchObject({
      status: 'insufficient-budget',
      budget: { maxBytes: 8192 },
    });
  });

  it('does not misreport a stale project link as unmanaged or recommend adoption', async () => {
    const { workspacePath, sourcePath } = await managedProject();
    const contractPath = path.join(
      workspacePath,
      WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract
    );
    const contract = await fsExtra.readJson(contractPath);
    contract.projects = contract.projects.filter(
      (project: { slug: string }) => project.slug !== 'api'
    );
    await fsExtra.writeJson(contractPath, contract);

    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Explain why the retry test is failing',
    });

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected partial context for stale binding');
    expect(result.scope.workspaceResolution).toEqual({
      status: 'blocked',
      source: 'none',
      managedDefault: false,
      reason: 'project.workspace.link-stale',
    });
    expect(result.scope.binding).toBe('resolution-blocked');
    expect(result.grounding).toMatchObject({ status: 'unavailable' });
    expect(result.graph).toMatchObject({ status: 'unavailable' });
    expect(result.nextActions.join(' ')).toContain('Do not treat this target as unmanaged');
    expect(result.nextActions.join(' ')).not.toContain('Workspai adoption is optional');
  });

  it('does not fall through a marked parent with missing membership to a project link', async () => {
    const { sourcePath } = await managedProject();
    await fsExtra.outputFile(path.join(projectPath!, '.workspai-workspace'), 'parent\n');

    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Explain the retry implementation',
    });

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected blocked parent resolution');
    expect(result.scope.workspaceResolution).toEqual({
      status: 'blocked',
      source: 'none',
      managedDefault: false,
      reason: 'project.workspace.membership-missing',
    });
    expect(result.scope.binding).toBe('resolution-blocked');
    expect(result.grounding).toMatchObject({ status: 'unavailable' });
    expect(result.graph).toMatchObject({ status: 'unavailable' });
  });

  it('identifies an ancestor workspace as the selected project workspace', async () => {
    const { sourcePath } = await managedProject('parent');

    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Explain the retry implementation',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Expected a task context for a parent workspace');
    expect(result.scope.workspaceResolution).toEqual({
      status: 'resolved',
      source: 'parent',
      managedDefault: false,
    });
  });

  it('distinguishes a linked managed-default workspace without emitting its path', async () => {
    const { sourcePath, homeDir } = await managedProject('managed-default');
    vi.stubEnv(process.platform === 'win32' ? 'USERPROFILE' : 'HOME', homeDir);

    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Explain the retry implementation',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Expected a task context for the managed default workspace');
    expect(result.scope.workspaceResolution).toEqual({
      status: 'resolved',
      source: 'local-link',
      managedDefault: true,
    });
    expect(JSON.stringify(result)).not.toContain(homeDir);
  });

  it('reports an unlinked source as unmanaged without claiming host tool availability', async () => {
    const { sourcePath } = await managedProject();
    await fsExtra.remove(path.join(sourcePath, '.workspai/workspace-link.local.json'));

    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Explain the retry implementation',
    });

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected partial context without a binding');
    expect(result.scope.workspaceResolution).toEqual({
      status: 'unmanaged',
      source: 'none',
      managedDefault: false,
    });
    expect(result.delivery).toEqual({
      status: 'prepared',
      hostLoading: 'not-observed',
      modelCompliance: 'not-observed',
    });
  });

  it('discloses another project changing after sealing without forcing workspace repair or claiming fresh Graph evidence', async () => {
    const { sourcePath } = await managedProject();
    await fsExtra.outputFile(
      path.resolve(sourcePath, '../worker/src/index.ts'),
      'export const changed = true;\n'
    );
    const snapshot = vi.spyOn(graphSnapshot, 'readWorkspaceKnowledgeGraphSnapshot');
    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Fix retryDelay',
      path: 'src/index.ts',
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('partial');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Expected partial packet');
    expect(result.graph).toMatchObject({
      status: 'unavailable',
      inputValidation: {
        matches: false,
        omittedFindings: 0,
        findings: [{ scope: { kind: 'project', id: 'worker' }, reason: 'content-changed' }],
      },
    });
    expect(result.grounding).toMatchObject({
      status: 'blocked',
      claims: { architecture: 'prohibited' },
      checks: {
        findings: expect.arrayContaining([
          expect.objectContaining({
            id: 'live-inputs',
            inputValidation: expect.objectContaining({ matches: false }),
          }),
        ]),
      },
    });
    expect(result.lifecycle.status).toBe('ready');
    expect(result.nextActions.join(' ')).toContain('continue authorized native project work');
    expect(JSON.stringify(result)).not.toContain(sourcePath);
  });

  it('keeps a failed snapshot read unavailable without retrying discovery inside the same packet', async () => {
    const { sourcePath } = await managedProject();
    const snapshot = vi
      .spyOn(graphSnapshot, 'readWorkspaceKnowledgeGraphSnapshot')
      .mockRejectedValueOnce(new Error('Unavailable filesystem'));
    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Inspect retryDelay',
      path: 'src/index.ts',
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('partial');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Expected partial packet');
    expect(result.graph).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('input-scan-failed'),
    });
    expect(result.lifecycle.status).toBe('ready');
  });

  it('uses one aggregate byte budget and returns an exact, valid one-retry recovery without dropping evidence', async () => {
    const { sourcePath } = await managedProject();
    const request = {
      projectPath: sourcePath,
      task: 'Fix retryDelay calculation; \u0628\u0631\u0631\u0633\u06cc \u062a\u0633\u062a',
      path: 'src/index.ts',
    };
    const full = await buildAgentTaskContext({ ...request, maxBytes: 131072 });
    expect(full.status).toBe('ready');
    if (full.status !== 'ready' && full.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(full.budget.usedBytes).toBeGreaterThan(8192);
    const refusal = await buildAgentTaskContext({ ...request, maxBytes: 8192 });
    expect(refusal.status).toBe('insufficient-budget');
    if (refusal.status !== 'insufficient-budget')
      throw new Error('Expected a complete-packet refusal');
    expect(refusal.budget.requiredBytes).toBeGreaterThan(8192);
    expect(agentTaskContextByteBudget(refusal.budget.requiredBytes)).toBe(
      refusal.budget.requiredBytes
    );
    expect(refusal.nextActions.join('\n')).toContain(`--max-bytes ${refusal.budget.requiredBytes}`);
    const command = refusal.recovery[0].command!;
    expect(command).toMatchObject({ cwd: '.', cwdBase: 'request-project-directory' });
    const replay = await execa(process.execPath, [path.resolve('dist/index.js'), ...command.args], {
      cwd: sourcePath,
    });
    expect(JSON.parse(replay.stdout)).toMatchObject({
      status: 'ready',
      task: { text: request.task },
      scope: { project: 'api' },
      lifecycle: { selection: { path: 'src/index.ts' } },
    });
    const retry = await buildAgentTaskContext({
      ...request,
      maxBytes: refusal.budget.requiredBytes,
    });
    expect(retry.status).toBe('ready');
    if (retry.status !== 'ready' && retry.status !== 'partial')
      throw new Error('One retry must suffice');
    expect(retry.budget.usedBytes).toBe(refusal.budget.requiredBytes);
    expect(retry.graph).toEqual(full.graph);
    expect(retry.lifecycle).toEqual(full.lifecycle);
    const oneLess = await buildAgentTaskContext({
      ...request,
      maxBytes: refusal.budget.requiredBytes - 1,
    });
    expect(oneLess.status).toBe('insufficient-budget');
    expect(oneLess.budget).toHaveProperty('requiredBytes', refusal.budget.requiredBytes);
  });

  it('recovers an oversized Graph with a valid match count while preserving task, host and project selection', async () => {
    const { sourcePath } = await managedProject();
    const buildView = vi.spyOn(graphView, 'buildWorkspaceGraphSearchView').mockReturnValueOnce({
      schemaVersion: 'workspace-graph-search-view.v1',
      status: 'insufficient-budget',
      requestHash: 'a'.repeat(64),
      graphHash: 'b'.repeat(64),
      budget: { maxBytes: 131072, requiredBytes: 140000, accounting: 'utf8-json-with-newline' },
      message: 'Oversized Graph evidence',
      nextActions: ['Narrow Graph matches'],
    });
    const task = 'Fix "widget"; $(do-not-execute)';
    const result = await buildAgentTaskContext({
      projectPath: path.join(sourcePath, 'packages/ui'),
      task,
      forAgent: 'copilot',
      path: 'packages/ui/src/widget.ts',
      limit: 8,
      maxBytes: 131072,
    });
    expect(result.status).toBe('insufficient-budget');
    if (result.status !== 'insufficient-budget') throw new Error('Expected budget refusal');
    expect(result.recovery[0].command?.args).toEqual([
      'agent',
      'context',
      '--project',
      '../..',
      '--task',
      task,
      '--for-agent',
      'copilot',
      '--limit',
      '1',
      '--max-bytes',
      '131072',
      '--path',
      'packages/ui/src/widget.ts',
    ]);
    buildView.mockRestore();
    const replay = await execa(
      process.execPath,
      [path.resolve('dist/index.js'), ...result.recovery[0].command!.args],
      { cwd: path.join(sourcePath, 'packages/ui') }
    );
    expect(JSON.parse(replay.stdout)).toMatchObject({ status: 'ready', scope: { project: 'api' } });
  });

  it('uses the canonical project boundary for lifecycle selection when started in a nested package', async () => {
    const { sourcePath } = await managedProject();
    const result = await buildAgentTaskContext({
      projectPath: path.join(sourcePath, 'packages/ui'),
      task: 'Inspect the widget',
      path: 'packages/ui/src/widget.ts',
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(result.scope.project).toBe('api');
    expect(result.lifecycle).toMatchObject({
      status: 'ready',
      units: [{ root: 'packages/ui', manifest: 'packages/ui/package.json' }],
    });
  });

  it('discloses stale source evidence without making workspace-wide repair a prerequisite for native work', async () => {
    const { sourcePath } = await managedProject();
    await fsExtra.writeFile(
      path.join(sourcePath, 'src/index.ts'),
      'export const changed = true;\n'
    );
    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Inspect the changed source',
    });
    expect(result.status).toBe('partial');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(result.graph.status).toBe('unavailable');
    expect(result.nextActions.join('\n')).toContain('native');
    expect(result.nextActions.join('\n')).not.toMatch(
      /workspai workspace (repair|intelligence run)/u
    );
    expect(result.operatingRules.join('\n')).toContain('does not block native work');
  });

  it('finds the closest Cargo workspace member without changing default workspace execution planning', async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-cargo-'));
    await fsExtra.outputFile(
      path.join(projectPath, 'Cargo.toml'),
      '[workspace]\nmembers = ["crates/*"]\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'crates/sdk/Cargo.toml'),
      '[package]\nname = "sdk"\nversion = "0.1.0"\nedition = "2021"\n'
    );
    await fsExtra.outputFile(
      path.join(projectPath, 'crates/sdk/src/lib.rs'),
      'pub fn retry_delay() -> u32 { 1 }\n'
    );
    expect(
      buildPolyglotLifecyclePlan(projectPath).units.some((unit) => unit.root === 'crates/sdk')
    ).toBe(false);
    const result = await buildAgentTaskContext({
      projectPath,
      task: 'Fix retry_delay',
      path: 'crates/sdk/src/lib.rs',
    });
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(result.lifecycle).toMatchObject({
      status: 'ready',
      units: [{ runtime: 'rust', root: 'crates/sdk', manifest: 'crates/sdk/Cargo.toml' }],
    });
  });

  it('accepts an integrity-bound legacy v1 entry without rewriting it or relaxing its mutation policy', async () => {
    const { sourcePath } = await managedProject();
    const entryPath = path.join(sourcePath, '.workspai/agent-entry.v1.json');
    const manifest = await fsExtra.readJson(entryPath);
    const contextPath = path.join(sourcePath, '.workspai/reports/project-context-agent.json');
    const legacyContext = await fsExtra.readJson(contextPath);
    legacyContext.agentRouting.mandatoryPreflight = {
      command: 'workspai agent bootstrap --for-agent generic --strict --json',
      successCondition: 'ready',
    };
    const { integrity: contextIntegrity, ...contextPayload } = legacyContext;
    legacyContext.integrity = {
      ...contextIntegrity,
      payloadHash: createHash('sha256').update(JSON.stringify(contextPayload)).digest('hex'),
    };
    await fsExtra.writeJson(contextPath, legacyContext);
    delete manifest.protocol.taskContextCommand;
    manifest.protocol.sourcePolicy.sourceMutation = 'governed-only';
    const { integrity, ...unsigned } = manifest;
    manifest.integrity = {
      ...integrity,
      projectContextHash: legacyContext.integrity.payloadHash,
      payloadHash: hashCanonicalJson(unsigned),
    };
    await fsExtra.writeJson(entryPath, manifest);
    const before = await fsExtra.readFile(entryPath, 'utf8');
    const contextBefore = await fsExtra.readFile(contextPath, 'utf8');
    const result = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Inspect retryDelay',
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' && result.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(result.grounding).toMatchObject({
      status: 'ready',
      claims: { sourceMutation: 'governed-cli-transaction-only' },
    });
    expect(await fsExtra.readFile(entryPath, 'utf8')).toBe(before);
    expect(await fsExtra.readFile(contextPath, 'utf8')).toBe(contextBefore);
    manifest.protocol.sourcePolicy.sourceMutation = 'risk-and-project-policy-based';
    await fsExtra.writeJson(entryPath, manifest);
    const tampered = await buildAgentTaskContext({
      projectPath: sourcePath,
      task: 'Inspect retryDelay',
    });
    expect(tampered.status).toBe('partial');
    if (tampered.status !== 'ready' && tampered.status !== 'partial')
      throw new Error('Unexpected budget refusal');
    expect(tampered.grounding.status).toBe('unavailable');
    expect(tampered.graph.status).toBe('unavailable');
  });

  it('does not turn an oversized component into partial context or recommend an ineffective packet retry', async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-large-'));
    await fsExtra.outputJson(path.join(projectPath, 'package.json'), {
      name: 'large-workspace',
      private: true,
    });
    await Promise.all(
      Array.from({ length: 160 }, (_, index) =>
        fsExtra.outputJson(path.join(projectPath!, `packages/package-${index}/package.json`), {
          name: `package-${index}`,
          scripts: { test: 'node --test', build: 'tsc', start: 'node index.js' },
        })
      )
    );
    const result = await buildAgentTaskContext({
      projectPath,
      task: 'Inspect project checks',
      maxBytes: 131072,
    });
    expect(result.status).toBe('insufficient-budget');
    if (result.status !== 'insufficient-budget')
      throw new Error('Expected component-limit refusal');
    expect(result.message).toContain('component');
    expect(result.recovery.some((action) => action.kind === 'retry')).toBe(false);
    expect(result.nextActions.join('\n')).toContain('native evidence');
    expect(result.recovery).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'select-path', requiredOption: '--path' }),
      ])
    );
  });

  it('returns useful native project checks when Workspai membership is absent', async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-'));
    await writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name: 'sample-api',
        scripts: { test: 'vitest run', build: 'tsc -b' },
      })
    );
    await writeFile(path.join(projectPath, 'index.ts'), 'export const value = 1;\n');
    const before = (await readdir(projectPath)).sort();

    const result = await buildAgentTaskContext({
      projectPath,
      task: 'Add a test for the exported value',
      path: 'index.ts',
    });

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected native packet');
    expect(result.scope).toMatchObject({
      project: path.basename(projectPath),
      projectPath: '.',
      workspace: null,
      binding: 'not-workspai-managed',
    });
    expect(result.execution.workspaceLocator).toBeNull();
    expect(result.grounding).toMatchObject({ status: 'unavailable' });
    expect(result.graph).toMatchObject({ status: 'unavailable' });
    expect(result.nextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('repository instructions'),
        expect.stringContaining('native source search'),
      ])
    );
    expect(result.lifecycle).toMatchObject({
      status: 'ready',
      selection: { path: 'index.ts', mode: 'closest-unit' },
      units: [{ runtime: 'node', ecosystem: 'npm' }],
    });
    expect(JSON.stringify(result)).not.toContain(projectPath);
    expect((await readdir(projectPath)).sort()).toEqual(before);
    expect(result.budget.usedBytes).toBe(Buffer.byteLength(`${JSON.stringify(result)}\n`, 'utf8'));
    const { integrity, ...payload } = result;
    expect(integrity.payloadHash).toBe(
      createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    );
  });

  it('rejects unsafe task paths and invalid byte budgets', async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-'));
    await expect(
      buildAgentTaskContext({ projectPath, task: 'Inspect source', path: '../outside.ts' })
    ).rejects.toThrow(/remain inside the selected project/i);
    await expect(
      buildAgentTaskContext({ projectPath, task: 'Inspect source', path: 'src\u0000/main.ts' })
    ).rejects.toThrow(/project-relative path/i);
    expect(() => agentTaskContextByteBudget(1024)).toThrow(/between 8192 and/i);
    expect(() => agentTaskContextByteBudget('32kb')).toThrow(/integer/i);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a task path that escapes through a symlink',
    async () => {
      projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-link-'));
      const project = path.join(projectPath, 'app');
      const outside = path.join(projectPath, 'outside');
      await mkdir(project);
      await mkdir(outside);
      await symlink(outside, path.join(project, 'linked'), 'dir');

      await expect(
        buildAgentTaskContext({
          projectPath: project,
          task: 'Inspect a manifest',
          path: 'linked/package.json',
        })
      ).rejects.toThrow(/symbolic link/i);
    }
  );

  it('exposes the bounded packet through the installed CLI command without requiring adoption', async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'workspai-agent-context-cli-'));
    await writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({ name: 'unmanaged-api', scripts: { test: 'vitest run' } })
    );
    await writeFile(path.join(projectPath, 'index.ts'), 'export const value = 1;\n');

    const result = await execa(
      process.execPath,
      [
        path.resolve('dist/index.js'),
        'agent',
        'context',
        '--task',
        'Add a focused test for the exported value',
        '--project',
        projectPath,
        '--path',
        'index.ts',
        '--max-bytes',
        '8192',
      ],
      { reject: false }
    );

    expect(result.exitCode).toBe(0);
    const packet = JSON.parse(result.stdout);
    expect(packet).toMatchObject({
      schemaVersion: 'workspai.agent-task-context.v1',
      status: 'partial',
      scope: { binding: 'not-workspai-managed', projectPath: '.', workspace: null },
      grounding: { status: 'unavailable' },
      graph: { status: 'unavailable' },
      lifecycle: { status: 'ready', selection: { path: 'index.ts', mode: 'closest-unit' } },
    });
    expect(result.stdout).not.toContain(projectPath);
  });
});
