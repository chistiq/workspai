import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseGitStatusPorcelainV2Z,
  scopeChangeJournalToGraphRoot,
} from '../../src/application/index.js';
import { createNodeGitChangeJournalPort } from '../../src/adapters/node/git-change-journal.js';
import { GRAPH_GIT_WORKTREE_BASELINE_SCHEMA } from '../../src/ports/index.js';
import type { GraphGitWorktreeBaseline } from '../../src/ports/index.js';

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
      timeout: 15_000,
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return (result.stdout ?? '').trim();
}

async function initRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-git-'));
  temporary.push(root);
  git(root, ['init']);
  await fs.writeFile(path.join(root, 'src.ts'), 'export const value = 1;\n', 'utf8');
  git(root, ['add', 'src.ts']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

describe('Node Git change journal', { timeout: 30_000 }, () => {
  it('keeps porcelain relative to a subdirectory Graph root and ignores sibling dirt', () => {
    const scoped = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z(
        [
          '1 .M N... 100644 100644 100644 0 0 packages/cli/src/index.ts',
          '1 .M N... 100644 100644 100644 0 0 packages/graph/src/cli.ts',
          '? packages/cli/src/new.ts',
          '2 R. N... 100644 100644 100644 0 0 R100 packages/cli/src/renamed.ts',
          'packages/cli/src/old.ts',
          '',
        ].join('\0')
      ),
      'packages/cli/'
    );
    expect(scoped.trust).toBe('trusted');
    expect(scoped.records.map((record) => `${record.kind}:${record.locator}`)).toEqual([
      'changed:src/index.ts',
      'untracked:src/new.ts',
      'renamed:src/renamed.ts',
    ]);
  });

  it('treats a clean subdirectory as an empty trusted journal after scoping', () => {
    const scoped = scopeChangeJournalToGraphRoot(
      parseGitStatusPorcelainV2Z('1 .M N... 100644 100644 100644 0 0 packages/graph/src/cli.ts\0'),
      'packages/cli/'
    );
    expect(scoped).toMatchObject({ trust: 'trusted', records: [] });
  });

  it('does not trust skip-reread without a clean base-generation receipt', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    expect(captured.trust).toBe('untrusted');
    expect(captured.baseline?.schema).toBe(GRAPH_GIT_WORKTREE_BASELINE_SCHEMA);
    expect(captured.baseline?.clean).toBe(true);
    expect(JSON.stringify(captured)).not.toContain(root);
  });

  it('trusts skip-reread only against the captured clean baseline', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const base = captured.baseline as GraphGitWorktreeBaseline;
    const trusted = await journal.inspect({
      root,
      base,
      inventoryLocators: ['src.ts'],
    });
    expect(trusted.trust).toBe('trusted');
    expect(trusted.records).toEqual([]);
    await fs.writeFile(path.join(root, 'src.ts'), 'export const value = 2;\n', 'utf8');
    const changed = await journal.inspect({
      root,
      base,
      inventoryLocators: ['src.ts'],
    });
    expect(changed.trust).toBe('trusted');
    expect(changed.records.map((record) => record.locator)).toEqual(['src.ts']);
  });

  it('does not trust skip-reread without inventory locators', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const base = captured.baseline as GraphGitWorktreeBaseline;
    const missing = await journal.inspect({ root, base });
    expect(missing.trust).toBe('untrusted');
    expect(missing.diagnostics[0]?.message).toMatch(/inventory locators/u);
  });

  it('does not trust skip-reread for a gitignored inventoried file', async () => {
    const root = await initRepo();
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.ts\n', 'utf8');
    await fs.writeFile(path.join(root, 'ignored.ts'), 'export const ignored = 1;\n', 'utf8');
    git(root, ['add', '.gitignore']);
    git(root, ['commit', '-m', 'ignore']);
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const base = captured.baseline as GraphGitWorktreeBaseline;
    await fs.writeFile(path.join(root, 'ignored.ts'), 'export const ignored = 2;\n', 'utf8');
    const inspection = await journal.inspect({
      root,
      base,
      inventoryLocators: ['src.ts', 'ignored.ts'],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/ignored/u);
    expect(JSON.stringify(inspection)).not.toContain(root);
  });

  it('does not trust skip-reread for assume-unchanged inventoried files', async () => {
    const root = await initRepo();
    git(root, ['update-index', '--assume-unchanged', 'src.ts']);
    await fs.writeFile(path.join(root, 'src.ts'), 'export const value = 2;\n', 'utf8');
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    expect(captured.baseline?.clean).toBe(true);
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: ['src.ts'],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/assume-unchanged|skip-worktree/u);
  });

  it('does not trust skip-reread for skip-worktree inventoried files', async () => {
    const root = await initRepo();
    git(root, ['update-index', '--skip-worktree', 'src.ts']);
    await fs.writeFile(path.join(root, 'src.ts'), 'export const value = 2;\n', 'utf8');
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    expect(captured.baseline?.clean).toBe(true);
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: ['src.ts'],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/assume-unchanged|skip-worktree/u);
  });

  it('does not trust skip-reread when inventory locators are not portable', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: ['../escape.ts'],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/portable/u);
  });

  it('does not trust skip-reread when inventory locators exceed the coverage bound', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: Array.from({ length: 100_001 }, () => 'src.ts'),
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/too large/u);
  });

  it('does not trust skip-reread when coverage stdin would exceed the byte bound', async () => {
    const root = await initRepo();
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: ['a'.repeat(8 * 1024 * 1024 + 16)],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(inspection.diagnostics[0]?.message).toMatch(/too large/u);
  });

  it('does not trust skip-reread for files inside an embedded Git repository', async () => {
    const root = await initRepo();
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    git(nested, ['init']);
    await fs.writeFile(path.join(nested, 'nested.ts'), 'export const nested = 1;\n', 'utf8');
    git(nested, ['add', 'nested.ts']);
    git(nested, ['commit', '-m', 'nested']);
    const journal = createNodeGitChangeJournalPort();
    const captured = await journal.inspect({ root });
    const inspection = await journal.inspect({
      root,
      base: captured.baseline as GraphGitWorktreeBaseline,
      inventoryLocators: ['src.ts', 'nested/nested.ts'],
    });
    expect(inspection.trust).toBe('untrusted');
    expect(JSON.stringify(inspection)).not.toContain(root);
  });

  it('does not execute repository-controlled fsmonitor helpers', async () => {
    const root = await initRepo();
    const marker = path.join(root, 'PWNED');
    git(root, ['config', 'core.fsmonitor', `touch "${marker}"`]);
    const journal = createNodeGitChangeJournalPort();
    await journal.inspect({ root });
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
