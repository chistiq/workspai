/**
 * In-process phase profile for a pinned-commit worktree. Not a published command.
 * Output never includes host paths. Filesystem page cache is not controlled.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNodeRepoGraph, createGraphProductBuildSession } from '@workspai/graph/adapters/node';

import { createPinnedCommitWorktree } from '../src/graph-producer-benchmark-support.js';

const PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;

const repo = process.argv[2];
const id = process.argv[3] ?? 'profile';
if (!repo) throw new Error('-- profile requires an absolute repository path.');
if (!path.isAbsolute(repo)) throw new Error('Repository path must be absolute.');

const pin = await createPinnedCommitWorktree(repo);
try {
  const scope = { kind: 'project' as const, projectIds: [id] };
  const session = createGraphProductBuildSession();
  try {
    const coldStart = performance.now();
    const cold = await buildNodeRepoGraph({ root: pin.root, scope, session });
    const coldMs = Math.round(performance.now() - coldStart);
    const warmStart = performance.now();
    const warm = await buildNodeRepoGraph({ root: pin.root, scope, session });
    const warmMs = Math.round(performance.now() - warmStart);
    const payload = {
      schemaVersion: 'workspai.graph-phase-profile.v1',
      id,
      commit: pin.commit,
      sourceDirty: pin.dirty,
      dirtyCount: pin.dirtyCount,
      evaluatedFrom: pin.kind,
      filesystemCold: 'not-controlled',
      implementation: path.basename(fileURLToPath(import.meta.url)),
      coldMs,
      warmMs,
      peakRssMb: Math.round((process.resourceUsage().maxRSS * 1024) / (1024 * 1024)),
      inputFiles: warm.metrics.inputFiles,
      inputBytes: warm.metrics.inputBytes,
      providerFacts: warm.metrics.providerFacts,
      cold: {
        providerMs: cold.metrics.providerMs,
        compositionMs: cold.metrics.compositionMs,
        inventoryMs: cold.metrics.inventoryMs,
        cacheHits: cold.metrics.cacheHits,
        cacheMisses: cold.metrics.cacheMisses,
        filesRead: cold.metrics.filesRead,
        filesParsed: cold.metrics.filesParsed,
        filesExtracted: cold.metrics.filesExtracted,
        providerTimings: cold.metrics.providerTimings,
        phaseTimings: cold.metrics.phaseTimings,
      },
      warm: {
        providerMs: warm.metrics.providerMs,
        compositionMs: warm.metrics.compositionMs,
        inventoryMs: warm.metrics.inventoryMs,
        cacheHits: warm.metrics.cacheHits,
        cacheMisses: warm.metrics.cacheMisses,
        filesRead: warm.metrics.filesRead,
        filesParsed: warm.metrics.filesParsed,
        filesExtracted: warm.metrics.filesExtracted,
        providerTimings: warm.metrics.providerTimings,
        phaseTimings: warm.metrics.phaseTimings,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    if (PATH_LEAK.test(json)) throw new Error('Phase profile leaked a host path.');
    process.stdout.write(`${json}\n`);
  } finally {
    session.dispose();
  }
} finally {
  await pin.cleanup();
}
