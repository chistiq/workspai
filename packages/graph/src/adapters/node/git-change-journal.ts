import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  admitGitSkipReread,
  freezeGitWorktreeBaseline,
  journalDirtyLocators,
} from '../../application/git-worktree-baseline.js';
import {
  absentChangeJournal,
  isGitlinkMode,
  parseGitLsFilesStageZ,
  parseGitLsFilesVerboseZ,
  parseGitStatusPorcelainV2Z,
  scopeChangeJournalToGraphRoot,
  untrustedChangeJournal,
} from '../../application/parse-git-status-porcelain.js';
import { GRAPH_GIT_WORKTREE_BASELINE_SCHEMA } from '../../ports/index.js';
import type {
  GraphChangeJournalInspection,
  GraphChangeJournalPort,
  GraphGitWorktreeBaseline,
} from '../../ports/index.js';

const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_INVENTORY_COVERAGE_LOCATORS = 100_000;
const MAX_INVENTORY_COVERAGE_BYTES = 8 * 1024 * 1024;
const INDEPENDENT_GIT_METADATA_LOCATORS = new Set(['.git/HEAD']);
const HEAD_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const HOOKS_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';

const GIT_CONFIG_FLAGS = Object.freeze([
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=',
  '-c',
  'core.useBuiltinFSMonitor=false',
  '-c',
  `core.hooksPath=${HOOKS_PATH}`,
  '-c',
  'core.untrackedCache=false',
  '-c',
  'core.pager=',
  '-c',
  'pager.status=false',
  '-c',
  'diff.external=',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.smudge=',
  '-c',
  'filter.lfs.required=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'status.showUntrackedFiles=all',
  '-c',
  'advice.detachedHead=false',
]);

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_ASKPASS: '',
    GIT_EDITOR: 'true',
    GIT_PAGER: 'cat',
    GIT_FLUSH: '1',
    LC_ALL: 'C',
    LANG: 'C',
  };
  if (process.platform === 'win32') {
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
    if (process.env.COMSPEC) env.COMSPEC = process.env.COMSPEC;
  }
  return env;
}

function spawnGit(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  options?: { readonly input?: Buffer }
): { readonly status: number; readonly stdout: Buffer; readonly failed: boolean } {
  if (signal?.aborted) {
    return { status: 1, stdout: Buffer.alloc(0), failed: true };
  }
  const result = spawnSync('git', [...GIT_CONFIG_FLAGS, ...args], {
    cwd,
    encoding: 'buffer',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
    env: gitEnv(),
    ...(options?.input ? { input: options.input } : {}),
  });
  if (result.error || result.signal) {
    return { status: 1, stdout: Buffer.alloc(0), failed: true };
  }
  return {
    status: result.status ?? 1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    failed: false,
  };
}

function encodeNulTerminatedPaths(paths: readonly string[]): Buffer | undefined {
  let total = 0;
  for (const value of paths) {
    total += Buffer.byteLength(value, 'utf8') + 1;
    if (total > MAX_INVENTORY_COVERAGE_BYTES) return undefined;
  }
  if (paths.length === 0) return Buffer.alloc(0);
  return Buffer.from(`${paths.join('\0')}\0`, 'utf8');
}

function portableInventoryLocator(value: string): string | undefined {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  ) {
    return undefined;
  }
  return value;
}

function normalizeShowPrefix(prefix: string): string | undefined {
  const normalized = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    return undefined;
  }
  return normalized;
}

function repoPathForGraphLocator(prefix: string, locator: string): string | undefined {
  const portable = portableInventoryLocator(locator);
  const normalized = normalizeShowPrefix(prefix);
  if (!portable || normalized === undefined) return undefined;
  if (portable === '.') return normalized ? normalized.slice(0, -1) : '.';
  return `${normalized}${portable}`;
}

function graphLocatorFromRepoPath(
  prefix: string,
  repoLocator: string
): { readonly kind: 'in'; readonly locator: string } | { readonly kind: 'out' } | undefined {
  const normalized = normalizeShowPrefix(prefix);
  if (normalized === undefined) return undefined;
  if (!normalized) return { kind: 'in', locator: repoLocator };
  if (repoLocator === normalized.slice(0, -1)) return { kind: 'in', locator: '.' };
  if (repoLocator.startsWith(normalized)) {
    return { kind: 'in', locator: repoLocator.slice(normalized.length) };
  }
  return { kind: 'out' };
}

function gitlinkCoversLocator(locator: string, gitlinks: ReadonlySet<string>): boolean {
  for (const gitlink of gitlinks) {
    if (locator === gitlink || locator.startsWith(`${gitlink}/`)) return true;
  }
  return false;
}

function porcelainObservedLocators(
  records: readonly { readonly locator: string; readonly priorLocator?: string }[]
): Set<string> | undefined {
  const observed = new Set<string>();
  for (const record of records) {
    if (record.locator.endsWith('/') || record.priorLocator?.endsWith('/')) return undefined;
    observed.add(record.locator);
    if (record.priorLocator) observed.add(record.priorLocator);
  }
  return observed;
}

function proveInventoryGitCoverage(options: {
  readonly toplevel: string;
  readonly prefix: string;
  readonly locators: readonly string[] | undefined;
  readonly porcelainRecords: readonly {
    readonly locator: string;
    readonly priorLocator?: string;
  }[];
  readonly stageListing: Buffer;
  readonly signal?: AbortSignal;
}): { readonly covered: true } | { readonly covered: false; readonly reason: string } {
  if (!options.locators) {
    return {
      covered: false,
      reason: 'Skip-reread requires inventory locators so Git coverage can be proven.',
    };
  }
  if (options.locators.length > MAX_INVENTORY_COVERAGE_LOCATORS) {
    return {
      covered: false,
      reason: 'Inventory is too large to prove Git coverage for skip-reread.',
    };
  }
  const inventory = new Set<string>();
  const repoPaths: string[] = [];
  for (const locator of options.locators) {
    const portable = portableInventoryLocator(locator);
    const repoPath = repoPathForGraphLocator(options.prefix, locator);
    if (!portable || !repoPath || portable.endsWith('/')) {
      return {
        covered: false,
        reason: 'Inventory locators are not portable and cannot authorize skip-reread.',
      };
    }
    inventory.add(portable);
    repoPaths.push(repoPath);
  }
  const encoded = encodeNulTerminatedPaths(repoPaths);
  if (!encoded) {
    return {
      covered: false,
      reason: 'Inventory coverage input is too large to prove Git observation for skip-reread.',
    };
  }
  if (repoPaths.length === 0) return { covered: true };

  const verboseArgs = options.prefix
    ? (['ls-files', '-v', '-z', '--', options.prefix] as const)
    : (['ls-files', '-v', '-z'] as const);
  const verbose = spawnGit(options.toplevel, verboseArgs, options.signal);
  if (verbose.failed || verbose.status !== 0 || options.signal?.aborted) {
    return {
      covered: false,
      reason: 'Git index tags could not be admitted for skip-reread.',
    };
  }
  const parsed = parseGitLsFilesVerboseZ(verbose.stdout.toString('utf8'));
  if (!parsed.ok) {
    return {
      covered: false,
      reason: 'Git index tags are malformed and cannot authorize skip-reread.',
    };
  }
  const staged = parseGitLsFilesStageZ(options.stageListing.toString('utf8'));
  if (!staged.ok) {
    return {
      covered: false,
      reason: 'Git index staging is malformed and cannot authorize skip-reread.',
    };
  }
  const gitlinks = new Set<string>();
  for (const entry of staged.entries) {
    if (!isGitlinkMode(entry.mode)) continue;
    const scoped = graphLocatorFromRepoPath(options.prefix, entry.locator);
    if (!scoped) {
      return {
        covered: false,
        reason: 'Git index staging is malformed and cannot authorize skip-reread.',
      };
    }
    if (scoped.kind === 'in') gitlinks.add(scoped.locator);
  }
  const trackedExact = new Set<string>();
  for (const entry of parsed.entries) {
    const scoped = graphLocatorFromRepoPath(options.prefix, entry.locator);
    if (!scoped) {
      return {
        covered: false,
        reason: 'Git index tags are malformed and cannot authorize skip-reread.',
      };
    }
    if (scoped.kind === 'out') continue;
    if (inventory.has(scoped.locator) && entry.tag !== 'H') {
      return {
        covered: false,
        reason:
          'Assume-unchanged or skip-worktree inventoried files are not observed by status and cannot authorize skip-reread.',
      };
    }
    if (entry.tag === 'H' && !gitlinkCoversLocator(scoped.locator, gitlinks)) {
      trackedExact.add(scoped.locator);
    }
  }

  const ignored = spawnGit(options.toplevel, ['check-ignore', '-z', '--stdin'], options.signal, {
    input: encoded,
  });
  if (ignored.failed || options.signal?.aborted) {
    return {
      covered: false,
      reason: 'Git ignore coverage could not be admitted for skip-reread.',
    };
  }
  if (ignored.status === 0) {
    return {
      covered: false,
      reason:
        'Git-ignored inventoried files are not observed by status and cannot authorize skip-reread.',
    };
  }
  if (ignored.status !== 1) {
    return {
      covered: false,
      reason: 'Git ignore coverage could not be admitted for skip-reread.',
    };
  }

  const porcelainObserved = porcelainObservedLocators(options.porcelainRecords);
  if (!porcelainObserved) {
    return {
      covered: false,
      reason: 'Git porcelain directory records cannot authorize skip-reread.',
    };
  }
  for (const locator of inventory) {
    if (INDEPENDENT_GIT_METADATA_LOCATORS.has(locator)) continue;
    if (trackedExact.has(locator) || porcelainObserved.has(locator)) continue;
    return {
      covered: false,
      reason:
        'Git cannot observe every inventoried file at file level and cannot authorize skip-reread.',
    };
  }
  return { covered: true };
}

function utf8Trim(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\0/gu, '').trim();
}

function portablePrefix(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\0/gu, '');
}

function digestKey(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

interface GitSnapshot {
  readonly toplevel: string;
  readonly prefix: string;
  readonly baseline: GraphGitWorktreeBaseline;
  readonly stageListing: Buffer;
  readonly indexPath: string;
}

interface GitObservationCache {
  readonly root: string;
  readonly head: string;
  readonly indexMtimeMs: number;
  readonly indexSize: number;
  readonly snapshot: GitSnapshot;
  coveredLocatorDigest?: string;
}

let gitObservationCache: GitObservationCache | undefined;

function locatorCoverageDigest(locators: readonly string[] | undefined): string {
  const hash = createHash('sha256');
  hash.update(String(locators?.length ?? 0));
  for (const locator of locators ?? []) {
    hash.update('\0');
    hash.update(locator);
  }
  return hash.digest('hex');
}

function rememberGitObservation(cache: GitObservationCache): void {
  gitObservationCache = cache;
}

function cachedGitSnapshot(
  root: string,
  signal?: AbortSignal
): { readonly snapshot: GitSnapshot; readonly cache: GitObservationCache } | undefined {
  const cached = gitObservationCache;
  if (!cached || cached.root !== root) return undefined;
  if (signal?.aborted) return undefined;
  const head = spawnGit(root, ['rev-parse', 'HEAD'], signal);
  if (head.status !== 0 || utf8Trim(head.stdout) !== cached.head) return undefined;
  let stamp: { mtimeMs: number; size: number };
  try {
    const stat = statSync(cached.snapshot.indexPath);
    stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
  if (stamp.mtimeMs !== cached.indexMtimeMs || stamp.size !== cached.indexSize) return undefined;
  return { snapshot: cached.snapshot, cache: cached };
}

function captureGitSnapshot(root: string, signal?: AbortSignal): GitSnapshot | undefined {
  const inside = spawnGit(root, ['rev-parse', '--is-inside-work-tree'], signal);
  if (inside.status !== 0 || utf8Trim(inside.stdout) !== 'true') return undefined;
  const toplevel = spawnGit(root, ['rev-parse', '--show-toplevel'], signal);
  const prefixResult = spawnGit(root, ['rev-parse', '--show-prefix'], signal);
  const gitDir = spawnGit(root, ['rev-parse', '--absolute-git-dir'], signal);
  const head = spawnGit(root, ['rev-parse', 'HEAD'], signal);
  const symbolic = spawnGit(root, ['symbolic-ref', '--quiet', 'HEAD'], signal);
  if (
    toplevel.status !== 0 ||
    prefixResult.status !== 0 ||
    gitDir.status !== 0 ||
    head.status !== 0
  ) {
    return undefined;
  }
  const resolvedRoot = path.resolve(root);
  const resolvedTop = path.resolve(utf8Trim(toplevel.stdout));
  if (resolvedRoot !== resolvedTop && !resolvedRoot.startsWith(`${resolvedTop}${path.sep}`)) {
    return undefined;
  }
  const headOid = utf8Trim(head.stdout);
  if (!HEAD_OID.test(headOid)) return undefined;
  const prefix = portablePrefix(utf8Trim(prefixResult.stdout));
  if (prefix.startsWith('/') || prefix.includes('..') || prefix.includes('\\')) return undefined;
  const indexArgs = prefix
    ? (['ls-files', '--stage', '-z', '--', prefix] as const)
    : (['ls-files', '--stage', '-z'] as const);
  const index = spawnGit(resolvedTop, indexArgs, signal);
  if (index.status !== 0) return undefined;
  const indexPathResult = spawnGit(resolvedTop, ['rev-parse', '--git-path', 'index'], signal);
  if (indexPathResult.status !== 0) return undefined;
  const indexPath = path.resolve(resolvedTop, utf8Trim(indexPathResult.stdout));
  let indexStat: { mtimeMs: number; size: number };
  try {
    const stat = statSync(indexPath);
    indexStat = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
  const snapshot = {
    toplevel: resolvedTop,
    prefix,
    stageListing: index.stdout,
    indexPath,
    baseline: freezeGitWorktreeBaseline({
      schema: GRAPH_GIT_WORKTREE_BASELINE_SCHEMA,
      worktreeKey: digestKey([utf8Trim(gitDir.stdout), prefix]),
      head: headOid,
      indexKey: createHash('sha256').update(index.stdout).digest('hex'),
      prefix,
      clean: false,
      detached: symbolic.status !== 0,
      branch: symbolic.status === 0 ? utf8Trim(symbolic.stdout).replace(/^refs\/heads\//u, '') : '',
    }),
  };
  rememberGitObservation({
    root: path.resolve(root),
    head: headOid,
    indexMtimeMs: indexStat.mtimeMs,
    indexSize: indexStat.size,
    snapshot,
  });
  return snapshot;
}

/**
 * Read-only Git porcelain v2 -z journal. Skip-reread is trusted only when the
 * caller supplies an admitted base-generation receipt and every inventory
 * locator has a file-level Git observation (exact tracked file, exact
 * untracked porcelain file, or `.git/HEAD`). Directory records, gitlinks,
 * ignored files, assume-unchanged, and skip-worktree bits fail closed.
 */
export function createNodeGitChangeJournalPort(): GraphChangeJournalPort {
  return {
    async inspect(request): Promise<GraphChangeJournalInspection> {
      if (request.signal?.aborted) {
        return untrustedChangeJournal('git', 'Change journal inspection was cancelled.');
      }
      const resolvedRoot = path.resolve(request.root);
      const reused = cachedGitSnapshot(resolvedRoot, request.signal);
      const snapshot = reused?.snapshot ?? captureGitSnapshot(request.root, request.signal);
      if (!snapshot) return absentChangeJournal();
      const porcelain = spawnGit(
        snapshot.toplevel,
        ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
        request.signal
      );
      if (porcelain.status !== 0) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status could not be admitted for skip-reread.',
          snapshot.baseline
        );
      }
      const parsed = parseGitStatusPorcelainV2Z(porcelain.stdout.toString('utf8'));
      const scoped = scopeChangeJournalToGraphRoot(parsed, snapshot.prefix);
      if (scoped.trust !== 'trusted') {
        return untrustedChangeJournal(
          'git',
          scoped.diagnostics[0]?.message ??
            'Git porcelain status is malformed and cannot authorize skip-reread.',
          snapshot.baseline
        );
      }
      const dirtyLocators = journalDirtyLocators(scoped.records);
      const current = freezeGitWorktreeBaseline({
        ...snapshot.baseline,
        clean: scoped.records.length === 0,
        ...(dirtyLocators.length > 0 ? { dirtyLocators } : {}),
      });
      if (!request.base) {
        return untrustedChangeJournal(
          'git',
          'Skip-reread requires an admitted base-generation Git receipt.',
          current
        );
      }
      const admission = admitGitSkipReread({
        base: request.base,
        current,
        scopedRecordCount: scoped.records.length,
      });
      if (!admission.admitted) {
        return untrustedChangeJournal('git', admission.reason, current);
      }
      const coverageDigest = locatorCoverageDigest(request.inventoryLocators);
      const porcelainClean = scoped.records.length === 0;
      const cachedCoverage =
        porcelainClean &&
        reused?.cache.coveredLocatorDigest === coverageDigest &&
        reused.cache.snapshot === snapshot;
      const coverage = cachedCoverage
        ? { covered: true as const }
        : proveInventoryGitCoverage({
            toplevel: snapshot.toplevel,
            prefix: snapshot.prefix,
            locators: request.inventoryLocators,
            porcelainRecords: scoped.records,
            stageListing: snapshot.stageListing,
            signal: request.signal,
          });
      if (!cachedCoverage && coverage.covered && porcelainClean && gitObservationCache) {
        gitObservationCache.coveredLocatorDigest = coverageDigest;
      }
      if (!coverage.covered) {
        return untrustedChangeJournal('git', coverage.reason, current);
      }
      const recorded = new Set<string>();
      for (const record of scoped.records) {
        recorded.add(record.locator);
        if (record.priorLocator) recorded.add(record.priorLocator);
      }
      const restored = (request.base.dirtyLocators ?? []).filter(
        (locator) => !recorded.has(locator)
      );
      const records =
        restored.length === 0
          ? scoped.records
          : Object.freeze([
              ...scoped.records,
              ...restored.map((locator) =>
                Object.freeze({
                  locator,
                  kind: 'changed' as const,
                  gitStatus: 'restored',
                })
              ),
            ]);
      return Object.freeze({
        trust: 'trusted' as const,
        source: 'git' as const,
        records,
        diagnostics: Object.freeze([]),
        baseline: current,
      });
    },
  };
}
