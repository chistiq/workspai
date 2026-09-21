/**
 * One-repo Graph quality probe. Not a published CLI command.
 * One buildNodeRepoGraph, then exit so memory is released with the process.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { buildNodeRepoGraph } from '@workspai/graph/adapters/node';
import { portableGraphProjectId } from '../src/graph-producer-benchmark-support.js';

const PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;

const project = process.argv[2];
const repo = process.argv[3];
if (!project || !repo || !path.isAbsolute(repo)) {
  throw new Error('Usage: g8-one-repo-quality.ts <project> <absolute-repo>');
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  return (result.stdout ?? '').trim();
}

const commit = git(repo, ['rev-parse', 'HEAD']);
const porcelain = git(repo, ['status', '--porcelain']);
const dirty = porcelain.length > 0;
let root = repo;
let cleanup: (() => void) | undefined;
if (dirty) {
  const worktree = path.join(os.tmpdir(), `g8-ref-${randomUUID()}`);
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (added.status !== 0) {
    throw new Error('Pinned commit checkout for a dirty reference worktree failed.');
  }
  root = worktree;
  cleanup = () => {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
    });
    rmSync(worktree, { recursive: true, force: true });
  };
}

const rssKb = (): number => {
  try {
    return Number(
      spawnSync('ps', ['-p', String(process.pid), '-o', 'rss='], { encoding: 'utf8' }).stdout.trim()
    );
  } catch {
    return 0;
  }
};

async function main(): Promise<void> {
  const started = performance.now();
  const heapBefore = process.memoryUsage().heapUsed;
  const rssBefore = rssKb();
  try {
    const result = await buildNodeRepoGraph({
      root,
      scope: { kind: 'project', projectIds: [portableGraphProjectId(project)] },
    });
    const payload = {
      id: project,
      commit,
      clean: !dirty,
      evaluatedFrom: dirty ? 'pinned-commit-worktree' : 'clean-worktree',
      status: result.status,
      compositionErrors: [
        ...new Set(
          result.diagnostics.filter((item) => item.severity === 'error').map((item) => item.code)
        ),
      ].sort(),
      providerFailures: result.quality.providerFailures.map((item) => item.code).sort(),
      inputsDigest: result.graph?.generation.inputsDigest.value ?? null,
      providerSetDigest: result.graph?.generation.providerSetDigest.value ?? null,
      contentDigest: result.graph?.generation.reference.contentDigest.value ?? null,
      inputFiles: result.metrics.inputFiles,
      omittedFiles: result.metrics.omittedFiles,
      omittedBytes: result.metrics.omittedBytes,
      omittedFileAccounting: result.metrics.omittedFileAccounting ?? null,
      omittedByteAccounting: result.metrics.omittedByteAccounting ?? null,
      omittedSubtreeCount: result.metrics.omittedSubtrees?.length ?? 0,
      omittedSubtreeClasses: Object.fromEntries(
        [...new Set((result.metrics.omittedSubtrees ?? []).map((subtree) => subtree.class))]
          .sort((left, right) => left.localeCompare(right))
          .map((omissionClass) => [
            omissionClass,
            (result.metrics.omittedSubtrees ?? []).filter(
              (subtree) => subtree.class === omissionClass
            ).length,
          ])
      ),
      omittedSubtreeSample: (result.metrics.omittedSubtrees ?? [])
        .map((subtree) => ({
          locator: subtree.locator,
          class: subtree.class,
          count: subtree.count,
          bytes: subtree.bytes,
          enumeration: subtree.enumeration,
          enumeratedEntryCount: subtree.enumeratedEntryCount,
          evidenceKind: subtree.evidenceKind,
          policyDigest: subtree.policyDigest,
        }))
        .sort((left, right) =>
          `${left.class}\0${left.locator}`.localeCompare(`${right.class}\0${right.locator}`)
        )
        .slice(0, 32),
      omittedSubtreeTruncated: (result.metrics.omittedSubtrees?.length ?? 0) > 32,
      providerFacts: result.metrics.providerFacts,
      nodeCount: result.graph?.nodes.length ?? 0,
      edgeCount: result.graph?.edges.length ?? 0,
      unknownZoneCodes: [...new Set(result.quality.unknownZones.map((zone) => zone.code))].sort(),
      unsupportedZoneCodes: [
        ...new Set(result.quality.unsupportedZones.map((zone) => zone.code)),
      ].sort(),
      diagnosticCodes: [...new Set(result.diagnostics.map((item) => item.code))].sort(),
      ms: Math.round(performance.now() - started),
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      heapUsedBytes: process.memoryUsage().heapUsed,
      rssBeforeKb: rssBefore,
      rssAfterKb: rssKb(),
    };
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    if (PATH_LEAK.test(serialized)) {
      throw new Error('One-repo quality report leaked a machine path.');
    }
    process.stdout.write(serialized);
    process.exitCode = result.status === 'failed' || payload.compositionErrors.length > 0 ? 3 : 0;
  } finally {
    cleanup?.();
  }
}

void main();
