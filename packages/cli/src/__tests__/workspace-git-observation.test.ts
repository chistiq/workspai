import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { buildCleanGitEnv } from '../utils/git-worktree.js';
import { collectGitWorkingTreeObservation } from '../workspace-git-observation.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: buildCleanGitEnv(), stdio: 'ignore' });
}

describe('workspace git observation', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fsExtra.remove(dir);
    }
  });

  it('returns unavailable outside a git repository', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-git-none-'));
    tempDirs.push(workspacePath);
    const observation = collectGitWorkingTreeObservation(workspacePath);
    expect(observation.available).toBe(false);
    expect(observation.dirty).toBe(false);
    expect(observation.changedFiles).toEqual([]);
  });

  it('does not inherit an outer Git worktree from the test runner', () => {
    expect(process.env.GIT_DIR).toBeUndefined();
    expect(process.env.GIT_WORK_TREE).toBeUndefined();
    expect(process.env.GIT_INDEX_FILE).toBeUndefined();
  });

  it('excludes generated reports, caches, and grounding from freshness observation', async () => {
    const workspacePath = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rk-git-generated-'));
    tempDirs.push(workspacePath);
    git(workspacePath, ['init']);
    await fsExtra.outputFile(path.join(workspacePath, 'src', 'app.ts'), 'export {};\n');
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'reports', 'workspace-impact-last-run.json'),
      { schemaVersion: 'workspace-impact.v1' }
    );
    await fsExtra.outputJson(
      path.join(workspacePath, '.workspai', 'cache', 'workspace-model.v1.json'),
      { schemaVersion: 'workspace-model-cache.v1' }
    );
    await fsExtra.outputFile(
      path.join(workspacePath, '.workspai', 'AGENT-GROUNDING.md'),
      '# Generated workspace grounding\n'
    );
    git(workspacePath, ['add', '.workspai/AGENT-GROUNDING.md']);
    git(workspacePath, [
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Workspai Test',
      '-c',
      'user.email=test@workspai.local',
      'commit',
      '-m',
      'test baseline',
    ]);
    await fsExtra.outputFile(
      path.join(workspacePath, '.workspai', 'AGENT-GROUNDING.md'),
      '# Refreshed generated workspace grounding\n'
    );

    const observation = collectGitWorkingTreeObservation(workspacePath);

    expect(observation.untrackedFiles).toEqual(['src/app.ts']);
    expect(observation.dirty).toBe(true);
  });
});
