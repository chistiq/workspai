import type { GraphDiagnostic, GraphProviderInput } from '../contracts/index.js';
import type { GraphChangeJournalInspection, GraphGitWorktreeBaseline } from '../ports/index.js';

export const GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA = 'workspai.graph.incremental-snapshot.v1' as const;
export const MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS = 3;

export interface GraphIncrementalSnapshotGit {
  readonly trust: GraphChangeJournalInspection['trust'];
  readonly source: GraphChangeJournalInspection['source'];
  readonly worktreeKey: string;
  readonly head: string;
  readonly indexKey: string;
  readonly prefix: string;
  readonly clean: string;
  readonly detached: string;
  readonly branch: string;
  readonly dirtyLocators: readonly string[];
  readonly records: readonly string[];
}

export interface GraphIncrementalSnapshotMembership {
  readonly complete: boolean;
  readonly locators: readonly string[];
}

export interface GraphIncrementalSnapshotReceipt {
  readonly schema: typeof GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA;
  readonly git: GraphIncrementalSnapshotGit;
  readonly membership: GraphIncrementalSnapshotMembership;
}

export type GraphIncrementalSnapshotComparison =
  { readonly consistent: true } | { readonly consistent: false; readonly reason: string };

function recordToken(record: GraphChangeJournalInspection['records'][number]): string {
  return `${record.locator}\0${record.kind}\0${record.gitStatus ?? ''}\0${record.priorLocator ?? ''}`;
}

export function gitSnapshotFromJournal(
  journal: GraphChangeJournalInspection
): GraphIncrementalSnapshotGit {
  const baseline = journal.baseline;
  return Object.freeze({
    trust: journal.trust,
    source: journal.source,
    worktreeKey: baseline?.worktreeKey ?? '',
    head: baseline?.head ?? '',
    indexKey: baseline?.indexKey ?? '',
    prefix: baseline?.prefix ?? '',
    clean: baseline ? (baseline.clean ? '1' : '0') : '',
    detached: baseline ? (baseline.detached ? '1' : '0') : '',
    branch: baseline?.branch ?? '',
    dirtyLocators: Object.freeze([...(baseline?.dirtyLocators ?? [])]),
    records: Object.freeze([...journal.records.map(recordToken)].sort()),
  });
}

export function membershipSnapshotFromLocators(
  locators: readonly string[],
  complete: boolean
): GraphIncrementalSnapshotMembership {
  return Object.freeze({
    complete,
    locators: Object.freeze([...locators].sort((left, right) => left.localeCompare(right))),
  });
}

export function freezeIncrementalSnapshot(input: {
  readonly git: GraphIncrementalSnapshotGit;
  readonly membership: GraphIncrementalSnapshotMembership;
}): GraphIncrementalSnapshotReceipt {
  return Object.freeze({
    schema: GRAPH_INCREMENTAL_SNAPSHOT_SCHEMA,
    git: input.git,
    membership: input.membership,
  });
}

function gitSnapshotToken(git: GraphIncrementalSnapshotGit): string {
  return [
    git.trust,
    git.source,
    git.worktreeKey,
    git.head,
    git.indexKey,
    git.prefix,
    git.clean,
    git.detached,
    git.branch,
    git.dirtyLocators.join('\n'),
    git.records.join('\n'),
  ].join('\0');
}

function membershipSnapshotToken(membership: GraphIncrementalSnapshotMembership): string {
  return `${membership.complete ? '1' : '0'}\0${membership.locators.join('\n')}`;
}

/**
 * Pre/post receipts must cover Git identity and filesystem membership used for
 * trusted reuse. Incomplete membership cannot prove a consistent snapshot.
 */
export function compareIncrementalSnapshots(
  pre: GraphIncrementalSnapshotReceipt,
  post: GraphIncrementalSnapshotReceipt
): GraphIncrementalSnapshotComparison {
  if (gitSnapshotToken(pre.git) !== gitSnapshotToken(post.git)) {
    return Object.freeze({
      consistent: false,
      reason: 'Git worktree observation changed during incremental construction.',
    });
  }
  if (!pre.membership.complete || !post.membership.complete) {
    return Object.freeze({
      consistent: false,
      reason: 'Filesystem membership was incomplete and cannot prove snapshot consistency.',
    });
  }
  if (membershipSnapshotToken(pre.membership) !== membershipSnapshotToken(post.membership)) {
    return Object.freeze({
      consistent: false,
      reason: 'Filesystem membership changed during incremental construction.',
    });
  }
  return Object.freeze({ consistent: true });
}

export function snapshotUnstableDiagnostic(): GraphDiagnostic {
  return Object.freeze({
    code: 'GRAPH_INCREMENTAL_SNAPSHOT_UNSTABLE',
    severity: 'warning',
    path: '/incremental/snapshot',
    message:
      'The repository changed during incremental construction and a consistent snapshot could not be proven. The result is not a skip-reread authority.',
  });
}

export function contentInventoryIdentityBytes(inputs: readonly GraphProviderInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const input of [...inputs].sort((left, right) =>
    left.locator.localeCompare(right.locator)
  )) {
    const locator = encoder.encode(input.locator);
    const digest = encoder.encode(input.digest.value);
    const sep = encoder.encode('\0');
    const nl = encoder.encode('\n');
    chunks.push(locator, sep, digest, nl);
    total += locator.byteLength + sep.byteLength + digest.byteLength + nl.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function clampIncrementalSnapshotAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS;
  return Math.min(MAX_INCREMENTAL_SNAPSHOT_ATTEMPTS, Math.max(1, Math.trunc(value)));
}

export function snapshotGitBaseline(
  journal: GraphChangeJournalInspection,
  scanProfileDigest: string,
  inventoryDigest: string
): GraphGitWorktreeBaseline | undefined {
  if (!journal.baseline) return undefined;
  return {
    ...journal.baseline,
    scanProfileDigest,
    inventoryDigest,
  };
}
