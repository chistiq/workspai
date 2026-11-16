import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import fsExtra from 'fs-extra';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentTaskContext } from '../agent-task-context.js';
import * as lifecycle from '../project-lifecycle-context.js';
import * as entry from '../project-agent-entry.js';
import { taskContextRetry } from '../agent-task-recovery.js';

const roots: string[] = [];
const cliPath = path.resolve('dist/index.js');

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'workspai-task-selection-'));
  roots.push(root);
  const source = path.join(root, 'projects', 'app');
  await fsExtra.outputFile(
    path.join(source, 'pyproject.toml'),
    '[project]\nname = "app"\nversion = "1.0.0"\n'
  );
  await fsExtra.outputFile(path.join(source, 'src/parser.py'), 'def parse(): return 1\n');
  return { root, source };
}

describe('agent task project selection', () => {
  it('refuses an implicit umbrella directory before scanning descendants or preparing evidence', async () => {
    const { root } = await fixture();
    const plan = vi.spyOn(lifecycle, 'buildProjectLifecycleContext');
    const bootstrap = vi.spyOn(entry, 'buildAgentBootstrapReceipt');
    const result = await buildAgentTaskContext({
      projectPath: root,
      projectSelected: false,
      task: 'Fix the selected parser',
    });
    expect(result).toMatchObject({
      status: 'project-selection-required',
      selection: { source: 'working-directory', reason: 'unverified-working-directory' },
      recovery: [{ kind: 'select-project', requiredOption: '--project' }],
    });
    expect(result).not.toHaveProperty('grounding');
    expect(result).not.toHaveProperty('scope');
    expect(plan).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('delivers selection refusals as JSON through the CLI and preserves strict automation exits', async () => {
    const { root } = await fixture();
    for (const strict of [false, true]) {
      const result = await execa(
        process.execPath,
        [cliPath, 'agent', 'context', '--task', 'Fix the parser', ...(strict ? ['--strict'] : [])],
        { cwd: root, reject: false }
      );
      expect(result.exitCode).toBe(strict ? 2 : 0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'project-selection-required',
        selection: { reason: 'unverified-working-directory' },
      });
    }
  });

  it.each(['directory', 'file'])(
    'does not trust an invalid .git %s as a project boundary',
    async (kind) => {
      const { root } = await fixture();
      if (kind === 'directory') await mkdir(path.join(root, '.git'));
      else await fsExtra.outputFile(path.join(root, '.git'), 'gitdir: missing-worktree\n');
      const plan = vi.spyOn(lifecycle, 'buildProjectLifecycleContext');
      const result = await buildAgentTaskContext({
        projectPath: root,
        projectSelected: false,
        task: 'Fix the selected parser',
      });
      expect(result).toMatchObject({
        status: 'project-selection-required',
        selection: { reason: 'unverified-working-directory' },
      });
      expect(plan).not.toHaveBeenCalled();
    }
  );

  it('accepts a verified Git root even without a supported root manifest', async () => {
    const { root } = await fixture();
    await execa('git', ['init', '--quiet', root]);
    const result = await buildAgentTaskContext({
      projectPath: root,
      projectSelected: false,
      task: 'Inspect the repository',
    });
    expect(result).toMatchObject({
      status: 'partial',
      selection: { source: 'working-directory', verifiedBy: 'root-evidence' },
    });
  });

  it('uses an explicit project from a different shell directory instead of its parent', async () => {
    const { root, source } = await fixture();
    const result = await execa(
      process.execPath,
      [
        cliPath,
        'agent',
        'context',
        '--task',
        'Fix the parser',
        '--project',
        path.relative(root, source),
        '--path',
        'src/parser.py',
      ],
      { cwd: root }
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'partial',
      scope: { project: 'app', binding: 'not-workspai-managed' },
      selection: { source: 'explicit-project', verifiedBy: 'root-evidence' },
      lifecycle: { status: 'ready', units: [{ manifest: 'pyproject.toml' }] },
    });
  });

  it('retains native manifest discovery from a real cwd without requiring adoption', async () => {
    const { source } = await fixture();
    const result = await buildAgentTaskContext({
      projectPath: source,
      projectSelected: false,
      task: 'Inspect the parser',
      path: 'src/parser.py',
    });
    expect(result).toMatchObject({
      status: 'partial',
      scope: { project: 'app' },
      selection: { source: 'working-directory', verifiedBy: 'root-evidence' },
      lifecycle: { status: 'ready' },
    });
  });

  it('allows an explicitly selected project with an unsupported or manifest-free structure', async () => {
    const { root } = await fixture();
    const source = path.join(root, 'unknown-language');
    await mkdir(source);
    const result = await buildAgentTaskContext({
      projectPath: source,
      task: 'Inspect this project',
    });
    expect(result).toMatchObject({
      status: 'partial',
      selection: { verifiedBy: 'explicit-directory' },
      lifecycle: { status: 'no-lifecycle-units' },
    });
  });

  it('withholds context for a missing path instead of accepting mismatched source and shell roots', async () => {
    const { source } = await fixture();
    const plan = vi.spyOn(lifecycle, 'buildProjectLifecycleContext');
    const result = await buildAgentTaskContext({
      projectPath: source,
      task: 'Fix the parser',
      path: 'other-project/src/parser.py',
    });
    expect(result).toMatchObject({
      status: 'project-selection-required',
      selection: { reason: 'path-not-found' },
    });
    expect(plan).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('grounding');
    // Planning a new file remains supported: omit the existing-source selector.
    expect(
      (await buildAgentTaskContext({ projectPath: source, task: 'Create a new parser' })).status
    ).toBe('partial');
  });

  it.each(['.git', '.workspai/project.json'])(
    'detects a nested %s boundary and offers a correctly rebased argv retry',
    async (marker) => {
      const { root, source } = await fixture();
      await fsExtra.outputJson(path.join(root, 'package.json'), { name: 'parent', private: true });
      if (marker === '.git') await mkdir(path.join(source, '.git'));
      else await fsExtra.outputJson(path.join(source, marker), { name: 'app' });
      const plan = vi.spyOn(lifecycle, 'buildProjectLifecycleContext');
      const task = 'Fix parser; $(do-not-execute) "quoted"';
      const result = await buildAgentTaskContext({
        projectPath: root,
        task,
        path: 'projects/app/src/parser.py',
        forAgent: 'copilot',
      });
      expect(result.status).toBe('project-selection-required');
      if (result.status !== 'project-selection-required')
        throw new Error('Expected nested selection');
      expect(result.selection.reason).toBe('nested-project-boundary');
      expect(plan).not.toHaveBeenCalled();
      const command = result.recovery[0].command!;
      expect(command).toMatchObject({
        executable: 'workspai',
        cwd: '.',
        cwdBase: 'request-project-directory',
      });
      expect(command.args).toEqual(
        expect.arrayContaining([
          '--project',
          'projects/app',
          '--path',
          'src/parser.py',
          '--task',
          task,
          '--for-agent',
          'copilot',
        ])
      );
      const retry = await execa(process.execPath, [cliPath, ...command.args], { cwd: root });
      expect(JSON.parse(retry.stdout)).toMatchObject({
        status: 'partial',
        scope: { project: 'app' },
        lifecycle: { status: 'ready' },
      });
      expect(JSON.stringify(result)).not.toContain(root);
    }
  );

  it('does not mistake an ordinary monorepo package manifest for another project', async () => {
    const { root, source } = await fixture();
    await fsExtra.outputJson(path.join(root, 'package.json'), { name: 'parent', private: true });
    const result = await buildAgentTaskContext({
      projectPath: root,
      task: 'Fix the nested parser',
      path: path.relative(root, path.join(source, 'src/parser.py')).split(path.sep).join('/'),
    });
    expect(result).toMatchObject({
      status: 'partial',
      lifecycle: { status: 'ready', units: [{ root: 'projects/app' }] },
    });
  });

  it('represents recovery requests as argv data and preserves the verified target and options', () => {
    const request = {
      task: 'Fix "parser"; $(false)\nnext line',
      forAgent: 'copilot',
      project: 'project with spaces',
      path: 'src/parse input.py',
      limit: 8,
      maxBytes: 8192,
    };
    const recovery = taskContextRetry(request, { maxBytes: 24000 });
    expect(recovery.kind).toBe('retry');
    expect(recovery.command?.args).toEqual([
      'agent',
      'context',
      '--project',
      request.project,
      '--task',
      request.task,
      '--for-agent',
      'copilot',
      '--limit',
      '8',
      '--max-bytes',
      '24000',
      '--path',
      request.path,
    ]);
  });

  it('never serializes a user-selected workspace path into a retry command', () => {
    const request = {
      task: 'Inspect the parser',
      forAgent: 'generic',
      project: 'project',
      workspaceChoice: 'explicit' as const,
      limit: 8,
      maxBytes: 8192,
    };
    const recovery = taskContextRetry(request, { maxBytes: 24000 });
    expect(recovery).toMatchObject({
      kind: 'select-workspace',
      requiredOption: '--workspace',
      message: expect.stringContaining('--max-bytes 24000'),
    });
    expect(recovery).not.toHaveProperty('command');
  });

  it('preserves the managed-default workspace choice in a bounded retry', () => {
    const recovery = taskContextRetry(
      {
        task: 'Inspect the parser',
        forAgent: 'generic',
        project: 'project',
        workspaceChoice: 'managed-default',
        limit: 8,
        maxBytes: 8192,
      },
      { maxBytes: 24000 }
    );
    expect(recovery.kind).toBe('retry');
    expect(recovery.command?.args).toContain('--workspace-default');
    expect(recovery.command?.args).toContain('24000');
  });
});
