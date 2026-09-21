import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GRAPH_PRODUCER_BENCHMARK_SCHEMA = 'workspai.graph-producer-benchmark.v3' as const;

/**
 * Measurement groups. Held-out repositories are not inspected during
 * implementation-driven tuning.
 */
export const GRAPH_REFERENCE_CORPUS_PROTOCOL = Object.freeze({
  development: Object.freeze(['committed-node-service', 'opentelemetry-demo', 'pnpm', 'crewAI']),
  validation: Object.freeze(['OpenBot', 'grpc', 'OpenSearch']),
  heldOut: Object.freeze(['bun', 'istio']),
});

export type GraphBenchmarkIncrementalKind =
  | 'no-change'
  | 'one-file-edit'
  | 'file-create'
  | 'file-delete'
  | 'module-invalidation'
  | 'framework-binding'
  | 'configuration-change';

const SOURCE_EXTENSION = /\.(?:cjs|cts|go|js|jsx|mjs|mts|py|ts|tsx)$/u;
const CREATED_LOCATOR = '.__workspai_graph_bench_created.ts';
const MODULE_IMPORTED_LOCATOR = '.__workspai_graph_bench_mod.ts';
const MODULE_IMPORTER_LOCATOR = '.__workspai_graph_bench_mod_user.ts';
const FRAMEWORK_ROUTE_LOCATOR = '.__workspai_graph_bench_route.ts';
const CONFIGURATION_LOCATOR = '.__workspai_graph_bench_tsconfig.json';

function git(
  cwd: string,
  args: readonly string[],
  timeoutMs = 30_000
): { readonly stdout: string; readonly status: number } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  return { stdout: result.stdout ?? '', status: result.status ?? 1 };
}

export function inspectReferenceRepository(repoRoot: string): {
  readonly commit: string;
  readonly dirty: boolean;
  readonly dirtyCount: number;
} {
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const commit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error('Reference repository HEAD is not a 40-character commit.');
  }
  const status = git(repoRoot, ['status', '--porcelain=v1']);
  const dirtyCount = status.stdout.split('\n').filter((line) => line.length > 0).length;
  return { commit, dirty: dirtyCount > 0, dirtyCount };
}

export function implementationSourceDigest(repoRoot: string): {
  readonly head: string;
  readonly workingTreeDigest: string;
} {
  const head = git(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
  const hash = createHash('sha256');
  hash.update(head);
  hash.update('\n');
  hash.update(git(repoRoot, ['status', '--porcelain=v1']).stdout);
  hash.update('\n');
  hash.update(git(repoRoot, ['diff', 'HEAD']).stdout);
  const status = git(repoRoot, ['status', '--porcelain=v1']).stdout;
  for (const line of status.split('\n')) {
    if (!line.startsWith('?? ')) continue;
    const relative = line.slice(3).trim();
    if (!relative || relative.endsWith('/')) continue;
    if (!relative.startsWith('packages/')) continue;
    try {
      hash.update(readFileSync(path.join(repoRoot, relative)));
    } catch {
      hash.update(relative);
    }
  }
  return {
    head: /^[0-9a-f]{40}$/u.test(head) ? head : 'unspecified',
    workingTreeDigest: hash.digest('hex'),
  };
}

export async function createPinnedCommitWorktree(repoRoot: string): Promise<{
  readonly root: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly dirtyCount: number;
  readonly kind: 'pinned-commit-worktree';
  readonly cleanup: () => Promise<void>;
}> {
  const inspection = inspectReferenceRepository(repoRoot);
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'wspai-gbench-'));
  const root = path.join(parent, 'tree');
  const added = spawnSync(
    'git',
    ['-C', repoRoot, 'worktree', 'add', '--detach', root, inspection.commit],
    { encoding: 'utf8', timeout: 120_000 }
  );
  if (added.status !== 0) {
    await fs.rm(parent, { recursive: true, force: true });
    throw new Error('Pinned commit worktree could not be created.');
  }
  return {
    root,
    commit: inspection.commit,
    dirty: inspection.dirty,
    dirtyCount: inspection.dirtyCount,
    kind: 'pinned-commit-worktree',
    cleanup: async () => {
      spawnSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', root], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      await fs.rm(parent, { recursive: true, force: true });
    },
  };
}

export async function createCopiedEvaluationTree(sourceRoot: string): Promise<{
  readonly root: string;
  readonly commit: 'fixture';
  readonly dirty: false;
  readonly dirtyCount: 0;
  readonly kind: 'copied-fixture';
  readonly cleanup: () => Promise<void>;
  readonly reset: () => Promise<void>;
}> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'wspai-gbench-'));
  const root = path.join(parent, 'tree');
  await fs.cp(sourceRoot, root, { recursive: true });
  const initialized = spawnSync(
    'git',
    ['-c', 'user.email=bench@example.test', '-c', 'user.name=Benchmark', 'init'],
    { cwd: root, encoding: 'utf8', timeout: 15_000 }
  );
  if (initialized.status !== 0) {
    await fs.rm(parent, { recursive: true, force: true });
    throw new Error('Isolated evaluation tree could not be initialized as Git.');
  }
  if (git(root, ['add', '-A']).status !== 0) {
    await fs.rm(parent, { recursive: true, force: true });
    throw new Error('Isolated evaluation tree could not be staged.');
  }
  const committed = spawnSync(
    'git',
    [
      '-c',
      'user.email=bench@example.test',
      '-c',
      'user.name=Benchmark',
      'commit',
      '-m',
      'isolated-evaluation',
    ],
    { cwd: root, encoding: 'utf8', timeout: 15_000 }
  );
  if (committed.status !== 0) {
    await fs.rm(parent, { recursive: true, force: true });
    throw new Error('Isolated evaluation tree could not be committed.');
  }
  return {
    root,
    commit: 'fixture',
    dirty: false,
    dirtyCount: 0,
    kind: 'copied-fixture',
    cleanup: async () => {
      await fs.rm(parent, { recursive: true, force: true });
    },
    reset: async () => {
      await resetPinnedWorktree(root);
    },
  };
}

export async function resetPinnedWorktree(worktreeRoot: string): Promise<void> {
  const reset = git(worktreeRoot, ['reset', '--hard', 'HEAD']);
  if (reset.status !== 0) throw new Error('Pinned worktree could not be reset.');
  const clean = git(worktreeRoot, ['clean', '-fd']);
  if (clean.status !== 0) throw new Error('Pinned worktree could not be cleaned.');
}

export function selectTrackedSourceLocator(repoRoot: string): string | undefined {
  const listed = git(repoRoot, ['ls-files', '-z']);
  if (listed.status !== 0) return undefined;
  return listed.stdout
    .split('\0')
    .filter(
      (locator) =>
        locator.length > 0 &&
        SOURCE_EXTENSION.test(locator) &&
        !locator.split('/').includes('node_modules') &&
        path.posix.basename(locator) !== 'package.json'
    )
    .sort((left, right) => left.localeCompare(right))[0];
}

export async function selectEditableSourceLocator(repoRoot: string): Promise<string | undefined> {
  const tracked = selectTrackedSourceLocator(repoRoot);
  if (tracked) return tracked;
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    if (found.length > 0) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length > 0) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const locator = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), locator);
        continue;
      }
      if (SOURCE_EXTENSION.test(entry.name) && entry.name !== 'package.json') {
        found.push(locator);
        return;
      }
    }
  }
  await walk(repoRoot, '');
  return found[0];
}

export async function prepareIncrementalBase(
  worktreeRoot: string,
  kind: GraphBenchmarkIncrementalKind
): Promise<void> {
  if (kind === 'module-invalidation') {
    await fs.writeFile(
      path.join(worktreeRoot, MODULE_IMPORTED_LOCATOR),
      'export const workspaiGraphBenchSymbol = 1;\n'
    );
    await fs.writeFile(
      path.join(worktreeRoot, MODULE_IMPORTER_LOCATOR),
      'import { workspaiGraphBenchSymbol } from "./.__workspai_graph_bench_mod.js";\nexport const workspaiGraphBenchImported = workspaiGraphBenchSymbol;\n'
    );
  }
  if (kind === 'framework-binding') {
    await fs.writeFile(
      path.join(worktreeRoot, FRAMEWORK_ROUTE_LOCATOR),
      [
        'import express from "express";',
        'export const workspaiGraphBenchApp = express();',
        'workspaiGraphBenchApp.get("/health", (_req, res) => { res.end("ok"); });',
        '',
      ].join('\n')
    );
  }
  if (kind === 'configuration-change') {
    await fs.writeFile(
      path.join(worktreeRoot, CONFIGURATION_LOCATOR),
      `${JSON.stringify({ compilerOptions: { strict: true }, include: ['./**/*.ts'] }, null, 2)}\n`
    );
  }
}

export async function applyIncrementalMutation(
  worktreeRoot: string,
  kind: GraphBenchmarkIncrementalKind
): Promise<{ readonly kind: GraphBenchmarkIncrementalKind; readonly locator: string }> {
  if (kind === 'no-change') return { kind, locator: '.' };
  if (kind === 'one-file-edit') {
    const locator = await selectEditableSourceLocator(worktreeRoot);
    if (!locator) throw new Error('Evaluation tree has no source file to edit.');
    const absolute = path.join(worktreeRoot, locator);
    const current = await fs.readFile(absolute);
    await fs.writeFile(absolute, Buffer.concat([current, Buffer.from('\n')]));
    return { kind, locator };
  }
  if (kind === 'file-create') {
    await fs.writeFile(
      path.join(worktreeRoot, CREATED_LOCATOR),
      'export const workspaiGraphBenchCreated = 1;\n'
    );
    return { kind, locator: CREATED_LOCATOR };
  }
  if (kind === 'file-delete') {
    const locator = await selectEditableSourceLocator(worktreeRoot);
    if (!locator) throw new Error('Evaluation tree has no source file to delete.');
    await fs.unlink(path.join(worktreeRoot, locator));
    return { kind, locator };
  }
  if (kind === 'framework-binding') {
    const absolute = path.join(worktreeRoot, FRAMEWORK_ROUTE_LOCATOR);
    await fs.writeFile(
      absolute,
      [
        'import express from "express";',
        'export const workspaiGraphBenchApp = express();',
        'workspaiGraphBenchApp.get("/ready", (_req, res) => { res.end("ok"); });',
        '',
      ].join('\n')
    );
    return { kind, locator: FRAMEWORK_ROUTE_LOCATOR };
  }
  if (kind === 'configuration-change') {
    const absolute = path.join(worktreeRoot, CONFIGURATION_LOCATOR);
    await fs.writeFile(
      absolute,
      `${JSON.stringify({ compilerOptions: { strict: false }, include: ['./**/*.ts'] }, null, 2)}\n`
    );
    return { kind, locator: CONFIGURATION_LOCATOR };
  }
  const absolute = path.join(worktreeRoot, MODULE_IMPORTED_LOCATOR);
  const current = await fs.readFile(absolute);
  await fs.writeFile(absolute, Buffer.concat([current, Buffer.from('\n')]));
  return { kind, locator: MODULE_IMPORTED_LOCATOR };
}
