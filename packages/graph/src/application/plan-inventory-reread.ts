import { assertPortableLocator, normalizePortableLocator } from '../domain/content-state-merkle.js';
import type { GraphChangeJournalInspection, GraphChangeJournalRecord } from '../ports/index.js';
import type {
  GraphContentStateLeaf,
  GraphContentStateManifest,
  GraphDiagnostic,
} from '../contracts/index.js';

export type GraphInventoryRereadDecision =
  'reread' | 'reuse-prior-digest' | 'deleted' | 'skip-absent';

export interface GraphInventoryRereadPlan {
  readonly trust: GraphChangeJournalInspection['trust'];
  readonly source: GraphChangeJournalInspection['source'];
  readonly rereadLocators: readonly string[];
  readonly reusedLocators: readonly string[];
  readonly deletedLocators: readonly string[];
  readonly decisions: Readonly<Record<string, GraphInventoryRereadDecision>>;
  readonly observations: Readonly<
    Record<string, { readonly gitStatus?: string; readonly priorLocator?: string }>
  >;
  readonly diagnostics: readonly GraphDiagnostic[];
}

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

function priorLeaves(manifest: GraphContentStateManifest): Map<string, GraphContentStateLeaf> {
  const files = new Map<string, GraphContentStateLeaf>();
  for (const node of manifest.nodes) {
    if (node.kind === 'file') {
      const locator = normalizePortableLocator(node.locator);
      assertPortableLocator(locator);
      if (files.has(locator)) {
        throw new Error(`Duplicate content-state leaf locator: ${locator}`);
      }
      files.set(locator, Object.freeze({ ...node, locator }));
    }
  }
  return files;
}

function indexRecords(
  records: readonly GraphChangeJournalRecord[]
): Map<string, GraphChangeJournalRecord> {
  const indexed = new Map<string, GraphChangeJournalRecord>();
  for (const record of records) {
    const locator = normalizePortableLocator(record.locator);
    assertPortableLocator(locator);
    indexed.set(
      locator,
      Object.freeze({
        ...record,
        locator,
        ...(record.priorLocator
          ? { priorLocator: normalizePortableLocator(record.priorLocator) }
          : {}),
      })
    );
    if (record.priorLocator) {
      assertPortableLocator(normalizePortableLocator(record.priorLocator));
    }
  }
  return indexed;
}

/**
 * Decides which prior content-state leaves may skip a file-content reread.
 * Only a trusted Git/watcher/journal may skip; observations never enter Merkle
 * identity. Untrusted or absent journals reread every known leaf.
 */
export function planInventoryReread(request: {
  readonly priorManifest: GraphContentStateManifest;
  readonly journal: GraphChangeJournalInspection;
  readonly scanProfileDigestValue: string;
}): GraphInventoryRereadPlan {
  const diagnostics: GraphDiagnostic[] = [...request.journal.diagnostics];
  const files = priorLeaves(request.priorManifest);
  const records = indexRecords(request.journal.records);
  const decisions: Record<string, GraphInventoryRereadDecision> = {};
  const observations: Record<
    string,
    { readonly gitStatus?: string; readonly priorLocator?: string }
  > = {};

  const conservative = request.journal.trust !== 'trusted';
  if (conservative) {
    diagnostics.push(
      diagnostic(
        'GRAPH_CHANGE_JOURNAL_CONSERVATIVE_REREAD',
        'info',
        '/journal/trust',
        'Untrusted or absent change journals force a full content reread.'
      )
    );
  }

  for (const locator of [...files.keys()].sort()) {
    const prior = files.get(locator)!;
    const record = records.get(locator);
    if (record?.gitStatus || record?.priorLocator) {
      observations[locator] = Object.freeze({
        ...(record.gitStatus ? { gitStatus: record.gitStatus } : {}),
        ...(record.priorLocator ? { priorLocator: record.priorLocator } : {}),
      });
    }

    if (conservative) {
      decisions[locator] = 'reread';
      continue;
    }

    if (prior.scanProfileDigest.value !== request.scanProfileDigestValue) {
      decisions[locator] = 'reread';
      continue;
    }

    if (!record) {
      decisions[locator] = 'reuse-prior-digest';
      continue;
    }

    if (record.kind === 'unknown' || record.kind === 'untracked') {
      decisions[locator] = 'reread';
      continue;
    }

    if (record.kind === 'deleted') {
      decisions[locator] = 'deleted';
      continue;
    }

    if (record.kind === 'unchanged') {
      decisions[locator] = 'reuse-prior-digest';
      continue;
    }

    decisions[locator] = 'reread';
  }

  for (const [locator, record] of [...records.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (files.has(locator)) {
      continue;
    }
    if (record.kind === 'added' || record.kind === 'untracked' || record.kind === 'renamed') {
      decisions[locator] = 'reread';
      continue;
    }
    decisions[locator] = 'skip-absent';
  }

  if (!conservative) {
    for (const record of records.values()) {
      if (
        record.kind !== 'renamed' ||
        !record.priorLocator ||
        record.priorLocator === record.locator
      ) {
        continue;
      }
      decisions[record.locator] = 'reread';
      decisions[record.priorLocator] = 'deleted';
      observations[record.locator] = Object.freeze({
        ...(record.gitStatus ? { gitStatus: record.gitStatus } : {}),
        priorLocator: record.priorLocator,
      });
      observations[record.priorLocator] = Object.freeze({
        ...(record.gitStatus ? { gitStatus: record.gitStatus } : {}),
        priorLocator: record.priorLocator,
      });
    }
  }

  const reread: string[] = [];
  const reused: string[] = [];
  const deleted: string[] = [];
  for (const locator of Object.keys(decisions).sort()) {
    const decision = decisions[locator];
    if (decision === 'reread') {
      reread.push(locator);
    } else if (decision === 'reuse-prior-digest') {
      reused.push(locator);
    } else if (decision === 'deleted') {
      deleted.push(locator);
    }
  }

  return Object.freeze({
    trust: request.journal.trust,
    source: request.journal.source,
    rereadLocators: Object.freeze(reread),
    reusedLocators: Object.freeze(reused),
    deletedLocators: Object.freeze(deleted),
    decisions: Object.freeze(decisions),
    observations: Object.freeze(observations),
    diagnostics: Object.freeze(diagnostics),
  });
}
