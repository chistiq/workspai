import type { GraphChangeJournalRecord } from '../ports/index.js';
import {
  GRAPH_GIT_WORKTREE_BASELINE_SCHEMA,
  type GraphGitWorktreeBaseline,
} from '../ports/index.js';

const HEAD_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const KEY_DIGEST = /^[0-9a-f]{64}$/u;
const MAX_DIRTY_LOCATORS = 100_000;

export type GraphGitSkipRereadAdmission =
  { readonly admitted: true } | { readonly admitted: false; readonly reason: string };

function portableLocator(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').includes('..')
  );
}

export function journalDirtyLocators(
  records: readonly GraphChangeJournalRecord[]
): readonly string[] {
  const locators = new Set<string>();
  for (const record of records) {
    if (portableLocator(record.locator)) locators.add(record.locator);
    if (record.priorLocator && portableLocator(record.priorLocator)) {
      locators.add(record.priorLocator);
    }
  }
  return Object.freeze([...locators].sort((left, right) => left.localeCompare(right)));
}

export function freezeGitWorktreeBaseline(
  baseline: GraphGitWorktreeBaseline
): GraphGitWorktreeBaseline {
  const dirtyLocators = baseline.dirtyLocators
    ? journalDirtyLocators(baseline.dirtyLocators.map((locator) => ({ locator, kind: 'changed' })))
    : undefined;
  return Object.freeze({
    schema: GRAPH_GIT_WORKTREE_BASELINE_SCHEMA,
    worktreeKey: baseline.worktreeKey,
    head: baseline.head,
    indexKey: baseline.indexKey,
    prefix: baseline.prefix,
    clean: baseline.clean,
    detached: baseline.detached,
    branch: baseline.branch,
    ...(baseline.scanProfileDigest ? { scanProfileDigest: baseline.scanProfileDigest } : {}),
    ...(baseline.inventoryDigest ? { inventoryDigest: baseline.inventoryDigest } : {}),
    ...(dirtyLocators && dirtyLocators.length > 0 ? { dirtyLocators } : {}),
  });
}

export function isAdmittedGitWorktreeBaseline(
  value: GraphGitWorktreeBaseline | undefined
): value is GraphGitWorktreeBaseline {
  if (!value || value.schema !== GRAPH_GIT_WORKTREE_BASELINE_SCHEMA) return false;
  if (!KEY_DIGEST.test(value.worktreeKey) || !KEY_DIGEST.test(value.indexKey)) return false;
  if (!HEAD_OID.test(value.head)) return false;
  if (!portableLocator(value.prefix) && value.prefix !== '') return false;
  if (typeof value.branch !== 'string') return false;
  if (value.branch.includes('\0') || value.branch.includes('\\') || value.branch.includes('..')) {
    return false;
  }
  if (value.scanProfileDigest && !KEY_DIGEST.test(value.scanProfileDigest)) return false;
  if (value.inventoryDigest && !KEY_DIGEST.test(value.inventoryDigest)) return false;
  if (value.dirtyLocators) {
    if (value.dirtyLocators.length > MAX_DIRTY_LOCATORS) return false;
    if (value.clean && value.dirtyLocators.length > 0) return false;
    for (const locator of value.dirtyLocators) {
      if (!portableLocator(locator)) return false;
    }
  } else if (!value.clean) {
    return false;
  }
  return true;
}

/**
 * Skip-reread is admitted for the same worktree with a compatible HEAD.
 * A dirty base must record dirty locators so restored files cannot go missing
 * from porcelain and be reused stale. HEAD/branch/worktree changes fail closed.
 */
export function admitGitSkipReread(request: {
  readonly base?: GraphGitWorktreeBaseline;
  readonly current: GraphGitWorktreeBaseline;
  readonly scopedRecordCount: number;
}): GraphGitSkipRereadAdmission {
  if (!isAdmittedGitWorktreeBaseline(request.base)) {
    return {
      admitted: false,
      reason: 'Base generation is missing an admitted Git worktree receipt.',
    };
  }
  if (!isAdmittedGitWorktreeBaseline(request.current)) {
    return {
      admitted: false,
      reason: 'Current Git worktree identity could not be admitted for skip-reread.',
    };
  }
  if (request.base.worktreeKey !== request.current.worktreeKey) {
    return {
      admitted: false,
      reason: 'Git worktree identity does not match the base generation.',
    };
  }
  if (request.base.prefix !== request.current.prefix) {
    return {
      admitted: false,
      reason: 'Graph root prefix does not match the base generation.',
    };
  }
  if (request.base.head !== request.current.head) {
    return {
      admitted: false,
      reason: 'Git HEAD does not match the base generation.',
    };
  }
  if (request.base.detached !== request.current.detached) {
    return {
      admitted: false,
      reason: 'Detached HEAD state does not match the base generation.',
    };
  }
  if (request.base.branch !== request.current.branch) {
    return {
      admitted: false,
      reason: 'Git branch does not match the base generation.',
    };
  }
  if (
    request.base.scanProfileDigest &&
    request.current.scanProfileDigest &&
    request.base.scanProfileDigest !== request.current.scanProfileDigest
  ) {
    return {
      admitted: false,
      reason: 'Scan profile does not match the base generation.',
    };
  }
  if (
    request.base.clean &&
    request.scopedRecordCount === 0 &&
    request.base.indexKey !== request.current.indexKey
  ) {
    return {
      admitted: false,
      reason: 'Git index identity changed without an in-scope porcelain record.',
    };
  }
  return { admitted: true };
}
