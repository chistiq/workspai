import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNodeIncrementalRepoGraph,
  buildNodeRepoGraph,
} from '../../src/adapters/node/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    GIT_AUTHOR_NAME: 'Graph Test',
    GIT_AUTHOR_EMAIL: 'graph-test@example.invalid',
    GIT_COMMITTER_NAME: 'Graph Test',
    GIT_COMMITTER_EMAIL: 'graph-test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '1',
    LC_ALL: 'C',
  };
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync(
    'git',
    [
      '-c',
      'init.defaultBranch=main',
      '-c',
      'user.name=Graph Test',
      '-c',
      'user.email=graph-test@example.invalid',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: gitEnv(),
      timeout: 20_000,
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return (result.stdout ?? '').trim();
}

async function writeSrc(root: string, contents: string, locator = 'src.ts'): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, locator)), { recursive: true });
  await fs.writeFile(path.join(root, locator), contents, 'utf8');
}

async function initRepo(options: { readonly nested?: boolean } = {}): Promise<{
  readonly root: string;
  readonly graphRoot: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-inc-'));
  temporary.push(root);
  git(root, ['init']);
  const graphRoot = options.nested ? path.join(root, 'packages', 'cli') : root;
  await writeSrc(graphRoot, 'export const value = 1;\n');
  if (options.nested) {
    await writeSrc(path.join(root, 'packages', 'graph'), 'export const other = 1;\n');
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  return { root, graphRoot };
}

async function assess(graphRoot: string, base: Awaited<ReturnType<typeof buildNodeRepoGraph>>) {
  const current = await buildNodeRepoGraph({ root: graphRoot });
  const incremental = await buildNodeIncrementalRepoGraph({
    root: graphRoot,
    base,
    currentTreeReferenceDigest: current.graph?.generation.reference.contentDigest,
  });
  return { current, incremental };
}

describe('Node incremental Git baseline skip-reread', { timeout: 120_000 }, () => {
  it('reuses a clean unchanged tree and matches an independent current-tree full build', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.gitBaseline?.clean).toBe(true);
    const { current, incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toEqual([]);
    expect(incremental.executionPath).toBe('skip-reread');
    expect(incremental.snapshotConsistency).toBe('matched');
    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('rereads one modified file from a clean base', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const value = 2;\n');
    const { current, incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not reuse a dirty base after the worktree is restored to HEAD', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const value = "dirty";\n');
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.gitBaseline?.clean).toBe(false);
    expect(base.gitBaseline?.dirtyLocators).toContain('src.ts');
    git(graphRoot, ['checkout', '--', 'src.ts']);
    const { current, incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not reuse a dirty base when the dirty content changes again', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const value = "dirty-a";\n');
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const value = "dirty-b";\n');
    const { current, incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('does not reuse an untracked-base file after that file is deleted', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const extra = 1;\n', 'extra.ts');
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.gitBaseline?.clean).toBe(false);
    await fs.unlink(path.join(graphRoot, 'extra.ts'));
    const { current, incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('extra.ts');
    expect(incremental.executionPath).toBe('full');
    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('rereads a new untracked file from a clean base', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const extra = 1;\n', 'extra.ts');
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toContain('extra.ts');
    expect(incremental.equivalence).toBe('pass');
  });

  it('rereads a rename from a clean base', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    git(graphRoot, ['mv', 'src.ts', 'renamed.ts']);
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toContain('renamed.ts');
    expect(incremental.inventoryReread.deletedLocators).toContain('src.ts');
    expect(incremental.equivalence).toBe('pass');
  });

  it('rereads a deletion from a clean base', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const extra = 1;\n', 'extra.ts');
    git(graphRoot, ['add', 'extra.ts']);
    git(graphRoot, ['commit', '-m', 'add extra']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await fs.unlink(path.join(graphRoot, 'extra.ts'));
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.deletedLocators).toContain('extra.ts');
    expect(incremental.equivalence).toBe('pass');
  });

  it('rereads a staged-only change from a clean base', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const value = 3;\n');
    git(graphRoot, ['add', 'src.ts']);
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(incremental.equivalence).toBe('pass');
  });

  it('does not skip-reread after HEAD changes', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const value = 4;\n');
    git(graphRoot, ['add', 'src.ts']);
    git(graphRoot, ['commit', '-m', 'second']);
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.equivalence).toBe('pass');
  });

  it('does not skip-reread after a branch switch', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    git(graphRoot, ['checkout', '-b', 'other']);
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.equivalence).toBe('pass');
  });

  it('does not skip-reread after moving onto a detached HEAD', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    git(graphRoot, ['checkout', '--detach', 'HEAD']);
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.equivalence).toBe('pass');
  });

  it('scopes a subdirectory Graph root away from sibling dirt', async () => {
    const { root, graphRoot } = await initRepo({ nested: true });
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.gitBaseline?.clean).toBe(true);
    await writeSrc(path.join(root, 'packages', 'graph'), 'export const other = 2;\n');
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toEqual([]);
    expect(incremental.equivalence).toBe('pass');
  });

  it('does not reuse a sibling worktree dirty state', async () => {
    const { root, graphRoot } = await initRepo();
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-wt-'));
    temporary.push(other);
    git(root, ['worktree', 'add', '--detach', other]);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(other, 'export const value = "other-worktree";\n');
    const { incremental } = await assess(graphRoot, base);
    expect(incremental.inventoryReread.trust).toBe('trusted');
    expect(incremental.inventoryReread.rereadLocators).toEqual([]);
    expect(incremental.equivalence).toBe('pass');
  });

  it('forces a full reread when the Git journal is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-nongit-'));
    temporary.push(root);
    await writeSrc(root, 'export const value = 1;\n');
    const base = await buildNodeRepoGraph({ root });
    expect(base.gitBaseline).toBeUndefined();
    const { incremental } = await assess(root, base);
    expect(incremental.inventoryReread.trust).toBe('absent');
    expect(incremental.inventoryReread.reusedLocators).toEqual([]);
    expect(incremental.executionPath).toBe('full');
    expect(incremental.equivalence).toBe('pass');
  });

  it('keeps skip-reread across full then incremental then incremental', async () => {
    const { graphRoot } = await initRepo();
    const full = await buildNodeRepoGraph({ root: graphRoot });
    expect(full.gitBaseline?.clean).toBe(true);
    const first = await assess(graphRoot, full);
    expect(first.incremental.inventoryReread.trust).toBe('trusted');
    expect(first.incremental.gitBaseline?.clean).toBe(true);
    expect(first.incremental.gitBaseline?.inventoryDigest).toBeTypeOf('string');
    expect(first.incremental.snapshotConsistency).toBe('matched');
    const second = await assess(graphRoot, first.incremental);
    expect(second.incremental.inventoryReread.trust).toBe('trusted');
    expect(second.incremental.inventoryReread.rereadLocators).toEqual([]);
    expect(second.incremental.executionPath).toBe('skip-reread');
    expect(second.incremental.equivalence).toBe('pass');
    expect(second.incremental.graph?.generation.reference.contentDigest).toEqual(
      second.current.graph?.generation.reference.contentDigest
    );
  });

  it('rereads only later edits when chaining dirty incrementals from a recorded baseline', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const other = 1;\n', 'other.ts');
    git(graphRoot, ['add', 'other.ts']);
    git(graphRoot, ['commit', '-m', 'add other']);
    const full = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const value = 2;\n');
    const first = await assess(graphRoot, full);
    expect(first.incremental.inventoryReread.trust).toBe('trusted');
    expect(first.incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(first.incremental.inventoryReread.reusedLocators).toContain('other.ts');
    expect(first.incremental.gitBaseline?.clean).toBe(false);
    expect(first.incremental.gitBaseline?.dirtyLocators).toContain('src.ts');
    await writeSrc(graphRoot, 'export const value = 3;\n');
    const second = await assess(graphRoot, first.incremental);
    expect(second.incremental.inventoryReread.trust).toBe('trusted');
    expect(second.incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(second.incremental.inventoryReread.reusedLocators).toContain('other.ts');
    expect(second.incremental.executionPath).toBe('skip-reread');
    expect(second.incremental.equivalence).toBe('pass');
    expect(second.incremental.graph?.generation.reference.contentDigest).toEqual(
      second.current.graph?.generation.reference.contentDigest
    );
    expect(second.incremental.graph?.generation.reference.contentDigest).not.toEqual(
      first.incremental.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when a gitignored inventoried file changes', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored.ts\n', '.gitignore');
    await writeSrc(graphRoot, 'export const ignored = 1;\n', 'ignored.ts');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'ignored.ts')).toBe(true);
    await writeSrc(graphRoot, 'export const ignored = 2;\n', 'ignored.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('ignored.ts');
    expect(incremental.executionPath).toBe('full');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when an assume-unchanged file changes', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const tracked = 1;\n', 'tracked.ts');
    git(graphRoot, ['add', 'tracked.ts']);
    git(graphRoot, ['commit', '-m', 'tracked']);
    git(graphRoot, ['update-index', '--assume-unchanged', 'tracked.ts']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const tracked = 2;\n', 'tracked.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('tracked.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when a skip-worktree file changes', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const skip = 1;\n', 'skip.ts');
    git(graphRoot, ['add', 'skip.ts']);
    git(graphRoot, ['commit', '-m', 'skip']);
    git(graphRoot, ['update-index', '--skip-worktree', 'skip.ts']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const skip = 2;\n', 'skip.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('skip.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when an embedded Git directory repository changes', async () => {
    const { graphRoot } = await initRepo();
    const nested = path.join(graphRoot, 'nested');
    await fs.mkdir(nested);
    git(nested, ['init']);
    await writeSrc(nested, 'export const nested = 1;\n', 'nested.ts');
    git(nested, ['add', 'nested.ts']);
    git(nested, ['commit', '-m', 'nested']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'nested/nested.ts')).toBe(true);
    await writeSrc(nested, 'export const nested = 2;\n', 'nested.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('nested/nested.ts');
    expect(incremental.executionPath).toBe('full');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when an embedded Git file repository changes', async () => {
    const { graphRoot } = await initRepo();
    const gitdir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-gitdir-'));
    temporary.push(gitdir);
    const nested = path.join(graphRoot, 'nested');
    await fs.mkdir(nested);
    git(nested, ['init', `--separate-git-dir=${gitdir}`]);
    await writeSrc(nested, 'export const nested = 1;\n', 'nested.ts');
    git(nested, ['add', 'nested.ts']);
    git(nested, ['commit', '-m', 'nested']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'nested/nested.ts')).toBe(true);
    await writeSrc(nested, 'export const nested = 2;\n', 'nested.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('nested/nested.ts');
    expect(incremental.executionPath).toBe('full');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('does not return a stale graph when a submodule gitlink worktree changes', async () => {
    const { graphRoot } = await initRepo();
    const nested = path.join(graphRoot, 'nested');
    await fs.mkdir(nested);
    git(nested, ['init']);
    await writeSrc(nested, 'export const nested = 1;\n', 'nested.ts');
    git(nested, ['add', 'nested.ts']);
    git(nested, ['commit', '-m', 'nested']);
    const oid = git(nested, ['rev-parse', 'HEAD']);
    git(graphRoot, ['update-index', '--add', '--cacheinfo', `160000,${oid},nested`]);
    git(graphRoot, ['commit', '-m', 'gitlink']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'nested/nested.ts')).toBe(true);
    await writeSrc(nested, 'export const nested = 2;\n', 'nested.ts');
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.trust).toBe('untrusted');
    expect(incremental.inventoryReread.reusedLocators).not.toContain('nested/nested.ts');
    expect(incremental.executionPath).toBe('full');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });
});

describe('Node incremental filesystem membership', { timeout: 120_000 }, () => {
  async function currentAndIncremental(
    graphRoot: string,
    base: Awaited<ReturnType<typeof buildNodeRepoGraph>>
  ) {
    const current = await buildNodeRepoGraph({ root: graphRoot });
    const incremental = await buildNodeIncrementalRepoGraph({ root: graphRoot, base });
    return { current, incremental };
  }

  it('hashes a new gitignored file created after a clean base', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored-*.ts\n', '.gitignore');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore pattern']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'ignored-new.ts')).toBe(false);
    await writeSrc(graphRoot, 'export const ignored = 1;\n', 'ignored-new.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.equivalence).toBe('not-assessed');
    expect(incremental.inventoryReread.rereadLocators).toContain('ignored-new.ts');
    expect(incremental.admittedInputs?.some((input) => input.locator === 'ignored-new.ts')).toBe(
      true
    );
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
    expect(incremental.graph?.generation.reference.contentDigest).not.toEqual(
      base.graph?.generation.reference.contentDigest
    );
  });

  it('hashes a new file created inside an ignored directory', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored-dir/\n', '.gitignore');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore directory']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const inside = 1;\n', 'ignored-dir/inside.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.rereadLocators).toContain('ignored-dir/inside.ts');
    expect(
      incremental.admittedInputs?.some((input) => input.locator === 'ignored-dir/inside.ts')
    ).toBe(true);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('invalidates a gitignored inventoried file after it is deleted', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored.ts\n', '.gitignore');
    await writeSrc(graphRoot, 'export const ignored = 1;\n', 'ignored.ts');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    expect(base.admittedInputs?.some((input) => input.locator === 'ignored.ts')).toBe(true);
    await fs.unlink(path.join(graphRoot, 'ignored.ts'));
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.reusedLocators).not.toContain('ignored.ts');
    expect(incremental.admittedInputs?.some((input) => input.locator === 'ignored.ts')).toBe(false);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('does not reuse an assume-unchanged file flagged before the base generation', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const tracked = 1;\n', 'tracked.ts');
    git(graphRoot, ['add', 'tracked.ts']);
    git(graphRoot, ['commit', '-m', 'tracked']);
    git(graphRoot, ['update-index', '--assume-unchanged', 'tracked.ts']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const tracked = 2;\n', 'tracked.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.reusedLocators).not.toContain('tracked.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('does not reuse a skip-worktree file flagged before the base generation', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'export const skip = 1;\n', 'skip.ts');
    git(graphRoot, ['add', 'skip.ts']);
    git(graphRoot, ['commit', '-m', 'skip']);
    git(graphRoot, ['update-index', '--skip-worktree', 'skip.ts']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const skip = 2;\n', 'skip.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.reusedLocators).not.toContain('skip.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('invalidates a file renamed out of the Graph root', async () => {
    const { root, graphRoot } = await initRepo({ nested: true });
    await writeSrc(graphRoot, 'export const keep = 1;\n', 'keep.ts');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'keep']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await fs.rename(
      path.join(graphRoot, 'src.ts'),
      path.join(root, 'packages', 'graph', 'moved.ts')
    );
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.admittedInputs?.some((input) => input.locator === 'src.ts')).toBe(false);
    expect(incremental.admittedInputs?.some((input) => input.locator === 'keep.ts')).toBe(true);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('hashes a file renamed into the Graph root', async () => {
    const { root, graphRoot } = await initRepo({ nested: true });
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await fs.rename(
      path.join(root, 'packages', 'graph', 'src.ts'),
      path.join(graphRoot, 'moved.ts')
    );
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.rereadLocators).toContain('moved.ts');
    expect(incremental.admittedInputs?.some((input) => input.locator === 'moved.ts')).toBe(true);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('hashes a case-only rename on a case-sensitive filesystem', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    git(graphRoot, ['mv', 'src.ts', 'Src.ts']);
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.inventoryReread.deletedLocators).toContain('src.ts');
    expect(incremental.inventoryReread.rereadLocators).toContain('Src.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('hashes an NFC-equivalent filename created after the base', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const cafe = 1;\n', 'Cafe\u0301.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.admittedInputs?.some((input) => input.locator === 'Caf\u00e9.ts')).toBe(
      true
    );
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('hashes filenames containing spaces, tabs and newlines', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    await writeSrc(graphRoot, 'export const spaced = 1;\n', 'my file.ts');
    await writeSrc(graphRoot, 'export const tabbed = 1;\n', 'tab\tname.ts');
    await writeSrc(graphRoot, 'export const lined = 1;\n', 'new\nline.ts');
    const { current, incremental } = await currentAndIncremental(graphRoot, base);
    expect(incremental.admittedInputs?.some((input) => input.locator === 'my file.ts')).toBe(true);
    expect(incremental.admittedInputs?.some((input) => input.locator === 'tab\tname.ts')).toBe(
      true
    );
    expect(incremental.admittedInputs?.some((input) => input.locator === 'new\nline.ts')).toBe(
      true
    );
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('matches an independent full build across full then three incrementals', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored-*.ts\n', '.gitignore');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore pattern']);
    const full = await buildNodeRepoGraph({ root: graphRoot });
    const first = await currentAndIncremental(graphRoot, full);
    expect(first.incremental.graph?.generation.reference.contentDigest).toEqual(
      first.current.graph?.generation.reference.contentDigest
    );
    const second = await currentAndIncremental(graphRoot, first.incremental);
    expect(second.incremental.graph?.generation.reference.contentDigest).toEqual(
      second.current.graph?.generation.reference.contentDigest
    );
    await writeSrc(graphRoot, 'export const ignored = 1;\n', 'ignored-new.ts');
    const third = await currentAndIncremental(graphRoot, second.incremental);
    expect(third.incremental.inventoryReread.rereadLocators).toContain('ignored-new.ts');
    expect(third.incremental.graph?.generation.reference.contentDigest).toEqual(
      third.current.graph?.generation.reference.contentDigest
    );
  });

  it('retries when a tracked file mutates after Git inspection', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    let mutated = false;
    const incremental = await buildNodeIncrementalRepoGraph({
      root: graphRoot,
      base,
      snapshotProbe: {
        afterPreObserve: async () => {
          if (mutated) return;
          mutated = true;
          await writeSrc(graphRoot, 'export const value = 2;\n');
        },
      },
    });
    const current = await buildNodeRepoGraph({ root: graphRoot });
    expect(incremental.snapshotConsistency).toBe('matched');
    expect(incremental.gitBaseline).toBeDefined();
    expect(incremental.inventoryReread.rereadLocators).toContain('src.ts');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('retries when an ignored file is created after Git inspection', async () => {
    const { graphRoot } = await initRepo();
    await writeSrc(graphRoot, 'ignored-*.ts\n', '.gitignore');
    git(graphRoot, ['add', '.gitignore']);
    git(graphRoot, ['commit', '-m', 'ignore']);
    const base = await buildNodeRepoGraph({ root: graphRoot });
    let created = false;
    const incremental = await buildNodeIncrementalRepoGraph({
      root: graphRoot,
      base,
      snapshotProbe: {
        afterPreObserve: async () => {
          if (created) return;
          created = true;
          await writeSrc(graphRoot, 'export const ignored = 1;\n', 'ignored-new.ts');
        },
      },
    });
    const current = await buildNodeRepoGraph({ root: graphRoot });
    expect(incremental.snapshotConsistency).toBe('matched');
    expect(incremental.admittedInputs?.some((input) => input.locator === 'ignored-new.ts')).toBe(
      true
    );
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('retries when a file is renamed after Git inspection', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    let renamed = false;
    const incremental = await buildNodeIncrementalRepoGraph({
      root: graphRoot,
      base,
      snapshotProbe: {
        afterPreObserve: () => {
          if (renamed) return;
          renamed = true;
          git(graphRoot, ['mv', 'src.ts', 'renamed.ts']);
        },
      },
    });
    const current = await buildNodeRepoGraph({ root: graphRoot });
    expect(incremental.snapshotConsistency).toBe('matched');
    expect(incremental.admittedInputs?.some((input) => input.locator === 'renamed.ts')).toBe(true);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('retries when HEAD changes after Git inspection', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    let committed = false;
    const incremental = await buildNodeIncrementalRepoGraph({
      root: graphRoot,
      base,
      snapshotProbe: {
        afterPreObserve: async () => {
          if (committed) return;
          committed = true;
          await writeSrc(graphRoot, 'export const value = 9;\n');
          git(graphRoot, ['add', 'src.ts']);
          git(graphRoot, ['commit', '-m', 'during']);
        },
      },
    });
    const current = await buildNodeRepoGraph({ root: graphRoot });
    expect(incremental.snapshotConsistency).toBe('matched');
    expect(incremental.gitBaseline?.head).toBe(current.gitBaseline?.head);
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      current.graph?.generation.reference.contentDigest
    );
  });

  it('does not stamp a skip-reread baseline when mutation exceeds the retry bound', async () => {
    const { graphRoot } = await initRepo();
    const base = await buildNodeRepoGraph({ root: graphRoot });
    let extra = 0;
    const incremental = await buildNodeIncrementalRepoGraph({
      root: graphRoot,
      base,
      snapshotAttempts: 2,
      snapshotProbe: {
        afterInventory: async () => {
          extra += 1;
          await writeSrc(graphRoot, `export const extra = ${extra};\n`, `extra-${extra}.ts`);
        },
      },
    });
    expect(incremental.snapshotConsistency).toBe('unstable');
    expect(incremental.gitBaseline).toBeUndefined();
  });
});
