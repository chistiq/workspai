import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GRAPH_PRODUCER_BENCHMARK_SCHEMA,
  GRAPH_REFERENCE_CORPUS_PROTOCOL,
  applyIncrementalMutation,
  createCopiedEvaluationTree,
  createPinnedCommitWorktree,
  implementationSourceDigest,
  inspectReferenceRepository,
  prepareIncrementalBase,
  resetPinnedWorktree,
} from '../graph-producer-benchmark-support.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function gitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-bench-git-'));
  temporary.push(root);
  await fs.writeFile(path.join(root, 'index.ts'), 'export const value = 1;\n');
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['add', 'index.ts'], { cwd: root, encoding: 'utf8' });
  spawnSync(
    'git',
    ['-c', 'user.email=bench@example.test', '-c', 'user.name=Benchmark', 'commit', '-m', 'fixture'],
    { cwd: root, encoding: 'utf8' }
  );
  return root;
}

describe('graph producer benchmark support', () => {
  it('pins a dirty repository to a detached worktree without mutating the original', async () => {
    const root = await gitRepo();
    await fs.writeFile(path.join(root, 'index.ts'), 'export const value = 2;\n');
    const inspection = inspectReferenceRepository(root);
    expect(inspection.dirty).toBe(true);
    expect(GRAPH_PRODUCER_BENCHMARK_SCHEMA).toBe('workspai.graph-producer-benchmark.v3');
    expect(GRAPH_REFERENCE_CORPUS_PROTOCOL.heldOut).toEqual(['bun', 'istio']);
    const pin = await createPinnedCommitWorktree(root);
    temporary.push(pin.root);
    try {
      const pinned = await fs.readFile(path.join(pin.root, 'index.ts'), 'utf8');
      const original = await fs.readFile(path.join(root, 'index.ts'), 'utf8');
      expect(pinned).toBe('export const value = 1;\n');
      expect(original).toBe('export const value = 2;\n');
      await applyIncrementalMutation(pin.root, 'one-file-edit');
      const edited = await fs.readFile(path.join(pin.root, 'index.ts'), 'utf8');
      expect(edited.endsWith('\n\n')).toBe(true);
      await applyIncrementalMutation(pin.root, 'file-delete');
      await expect(fs.stat(path.join(pin.root, 'index.ts'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await resetPinnedWorktree(pin.root);
      expect(await fs.readFile(path.join(pin.root, 'index.ts'), 'utf8')).toBe(
        'export const value = 1;\n'
      );
      await prepareIncrementalBase(pin.root, 'module-invalidation');
      await applyIncrementalMutation(pin.root, 'module-invalidation');
      expect(await fs.readFile(path.join(pin.root, '.__workspai_graph_bench_mod.ts'), 'utf8')).toBe(
        'export const workspaiGraphBenchSymbol = 1;\n\n'
      );
      await resetPinnedWorktree(pin.root);
      await prepareIncrementalBase(pin.root, 'framework-binding');
      await applyIncrementalMutation(pin.root, 'framework-binding');
      expect(
        await fs.readFile(path.join(pin.root, '.__workspai_graph_bench_route.ts'), 'utf8')
      ).toContain('/ready');
      await resetPinnedWorktree(pin.root);
      await prepareIncrementalBase(pin.root, 'configuration-change');
      await applyIncrementalMutation(pin.root, 'configuration-change');
      expect(
        JSON.parse(
          await fs.readFile(path.join(pin.root, '.__workspai_graph_bench_tsconfig.json'), 'utf8')
        )
      ).toMatchObject({ compilerOptions: { strict: false } });
    } finally {
      await pin.cleanup();
    }
    expect(await fs.readFile(path.join(root, 'index.ts'), 'utf8')).toBe(
      'export const value = 2;\n'
    );
    const digest = implementationSourceDigest(root);
    expect(digest.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(digest.workingTreeDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('copies a non-git fixture instead of mutating the original tree', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-bench-src-'));
    temporary.push(source);
    await fs.writeFile(path.join(source, 'index.ts'), 'export const original = 1;\n');
    const copy = await createCopiedEvaluationTree(source);
    temporary.push(copy.root);
    try {
      expect(copy.kind).toBe('copied-fixture');
      await applyIncrementalMutation(copy.root, 'one-file-edit');
      expect(await fs.readFile(path.join(copy.root, 'index.ts'), 'utf8')).toBe(
        'export const original = 1;\n\n'
      );
      expect(await fs.readFile(path.join(source, 'index.ts'), 'utf8')).toBe(
        'export const original = 1;\n'
      );
      await copy.reset();
      expect(await fs.readFile(path.join(copy.root, 'index.ts'), 'utf8')).toBe(
        'export const original = 1;\n'
      );
    } finally {
      await copy.cleanup();
    }
  });
});
