import type {
  GraphChangeJournalInspection,
  GraphChangeJournalRecord,
  GraphGitWorktreeBaseline,
} from '../ports/index.js';
import { assertPortableLocator, normalizePortableLocator } from '../domain/content-state-merkle.js';

const STATUS_KIND: Readonly<Record<string, GraphChangeJournalRecord['kind']>> = Object.freeze({
  M: 'changed',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'changed',
  T: 'changed',
  U: 'unknown',
  '?': 'untracked',
  '!': 'unknown',
});

const PORCELAIN_LINE = /^[ MADRCUT?!]{2} (.+)$/u;
const PORCELAIN_V2_ORDINARY =
  /^1 ([ .MADRCUT?!]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ([\s\S]*)$/u;
const PORCELAIN_V2_RENAME =
  /^2 ([ .MADRCUT?!]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ([RC]\d+) ([\s\S]*)$/u;
const PORCELAIN_V2_UNMERGED =
  /^u ([ .MADRCUT?!]{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) ([\s\S]*)$/u;

function kindFromCode(code: string): GraphChangeJournalRecord['kind'] {
  return STATUS_KIND[code] ?? 'unknown';
}

function kindFromXy(xy: string): GraphChangeJournalRecord['kind'] {
  if (xy.includes('R') || xy.includes('C')) return 'renamed';
  const worktree = xy[1] ?? '.';
  const index = xy[0] ?? '.';
  const code = worktree !== ' ' && worktree !== '.' ? worktree : index;
  return kindFromCode(code);
}

function decodePorcelainPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

function hostAbsoluteLocator(value: string): boolean {
  return value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/u.test(value);
}

function admitJournalLocator(value: string): string | undefined {
  if (!value || value.includes('\0') || hostAbsoluteLocator(value)) return undefined;
  try {
    const locator = normalizePortableLocator(value);
    assertPortableLocator(locator);
    return locator;
  } catch {
    return undefined;
  }
}

function portableJournalLocator(value: string): string | undefined {
  return admitJournalLocator(decodePorcelainPath(value));
}

export function absentChangeJournal(
  baseline?: GraphGitWorktreeBaseline
): GraphChangeJournalInspection {
  return Object.freeze({
    trust: 'absent',
    source: 'none',
    records: Object.freeze([]),
    diagnostics: Object.freeze([]),
    ...(baseline ? { baseline } : {}),
  });
}

export function untrustedChangeJournal(
  source: GraphChangeJournalInspection['source'],
  reason: string,
  baseline?: GraphGitWorktreeBaseline
): GraphChangeJournalInspection {
  return Object.freeze({
    trust: 'untrusted',
    source,
    records: Object.freeze([]),
    diagnostics: Object.freeze([
      Object.freeze({
        code: 'GRAPH_CHANGE_JOURNAL_UNTRUSTED',
        severity: 'warning' as const,
        path: '/journal',
        message: reason,
      }),
    ]),
    ...(baseline ? { baseline } : {}),
  });
}

function trustedJournal(
  records: readonly GraphChangeJournalRecord[],
  baseline?: GraphGitWorktreeBaseline
): GraphChangeJournalInspection {
  return Object.freeze({
    trust: 'trusted',
    source: 'git',
    records: Object.freeze(records),
    diagnostics: Object.freeze([]),
    ...(baseline ? { baseline } : {}),
  });
}

function freezeRecord(record: GraphChangeJournalRecord): GraphChangeJournalRecord {
  return Object.freeze({
    locator: record.locator,
    kind: record.kind,
    ...(record.gitStatus ? { gitStatus: record.gitStatus } : {}),
    ...(record.priorLocator ? { priorLocator: record.priorLocator } : {}),
  });
}

/**
 * Interprets already-admitted `git status --porcelain=v1` bytes. Does not spawn
 * Git. Malformed porcelain is untrusted so skip-reread cannot reuse stale digests.
 */
export function parseGitStatusPorcelain(text: string): GraphChangeJournalInspection {
  const records: GraphChangeJournalRecord[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  for (const line of lines) {
    const matched = PORCELAIN_LINE.exec(line);
    if (!matched) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain status is malformed and cannot authorize skip-reread.'
      );
    }
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    const remainder = matched[1] ?? '';
    const rename = remainder.split(' -> ');
    if (rename.length === 2 && (index === 'R' || worktree === 'R' || index === 'C')) {
      const locator = portableJournalLocator(rename[1]!);
      const priorLocator = portableJournalLocator(rename[0]!);
      if (!locator || !priorLocator) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      if (locator.endsWith('/') || priorLocator.endsWith('/')) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain directory records cannot authorize skip-reread.'
        );
      }
      records.push(
        freezeRecord({
          locator,
          kind: 'renamed',
          gitStatus: `${index}${worktree}`,
          priorLocator,
        })
      );
      continue;
    }
    const code = worktree !== ' ' ? worktree : index;
    const locator = portableJournalLocator(remainder);
    if (!locator) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain status is malformed and cannot authorize skip-reread.'
      );
    }
    if (locator.endsWith('/')) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain directory records cannot authorize skip-reread.'
      );
    }
    records.push(
      freezeRecord({
        locator,
        kind: kindFromCode(code),
        gitStatus: `${index}${worktree}`,
      })
    );
  }
  return trustedJournal(records);
}

/**
 * Interprets `git status --porcelain=v2 -z --untracked-files=all` bytes.
 * Paths are not quoted. Rename/copy records occupy two NUL fields.
 */
export function parseGitStatusPorcelainV2Z(text: string): GraphChangeJournalInspection {
  const records: GraphChangeJournalRecord[] = [];
  const tokens = text.split('\0');
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    index += 1;
    if (!token) continue;
    if (token.startsWith('#')) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain status is malformed and cannot authorize skip-reread.'
      );
    }
    if (token.startsWith('? ')) {
      const locator = admitJournalLocator(token.slice(2));
      if (!locator) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      if (locator.endsWith('/')) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain directory records cannot authorize skip-reread.'
        );
      }
      records.push(freezeRecord({ locator, kind: 'untracked', gitStatus: '??' }));
      continue;
    }
    if (token.startsWith('! ')) {
      const locator = admitJournalLocator(token.slice(2));
      if (!locator) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      if (locator.endsWith('/')) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain directory records cannot authorize skip-reread.'
        );
      }
      records.push(freezeRecord({ locator, kind: 'unknown', gitStatus: '!!' }));
      continue;
    }
    if (token.startsWith('u ')) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain status is malformed and cannot authorize skip-reread.'
      );
    }
    if (token.startsWith('2 ')) {
      const matched = PORCELAIN_V2_RENAME.exec(token);
      const origPath = tokens[index] ?? '';
      index += 1;
      if (!matched || !origPath) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      const xy = matched[1] ?? '';
      if (isGitlinkMode(matched[3]) || isGitlinkMode(matched[4]) || isGitlinkMode(matched[5])) {
        return untrustedChangeJournal(
          'git',
          'Gitlink or submodule paths cannot authorize skip-reread.'
        );
      }
      const locator = admitJournalLocator(matched[9] ?? '');
      const priorLocator = admitJournalLocator(origPath);
      if (!locator || !priorLocator) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      if (locator.endsWith('/') || priorLocator.endsWith('/')) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain directory records cannot authorize skip-reread.'
        );
      }
      records.push(
        freezeRecord({
          locator,
          kind: 'renamed',
          gitStatus: xy,
          priorLocator,
        })
      );
      continue;
    }
    if (token.startsWith('1 ')) {
      const matched = PORCELAIN_V2_ORDINARY.exec(token);
      if (!matched) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      const xy = matched[1] ?? '';
      if (isGitlinkMode(matched[3]) || isGitlinkMode(matched[4]) || isGitlinkMode(matched[5])) {
        return untrustedChangeJournal(
          'git',
          'Gitlink or submodule paths cannot authorize skip-reread.'
        );
      }
      const locator = admitJournalLocator(matched[8] ?? '');
      if (!locator) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain status is malformed and cannot authorize skip-reread.'
        );
      }
      if (locator.endsWith('/')) {
        return untrustedChangeJournal(
          'git',
          'Git porcelain directory records cannot authorize skip-reread.'
        );
      }
      records.push(
        freezeRecord({
          locator,
          kind: kindFromXy(xy),
          gitStatus: xy,
        })
      );
      continue;
    }
    if (PORCELAIN_V2_UNMERGED.test(token)) {
      return untrustedChangeJournal(
        'git',
        'Git porcelain status is malformed and cannot authorize skip-reread.'
      );
    }
    return untrustedChangeJournal(
      'git',
      'Git porcelain status is malformed and cannot authorize skip-reread.'
    );
  }
  return trustedJournal(records);
}

function classifyScopedLocator(
  locator: string,
  prefix: string
): { readonly kind: 'in'; readonly locator: string } | { readonly kind: 'out' } | undefined {
  const admitted = admitJournalLocator(locator);
  if (!admitted) return undefined;
  if (!prefix) return { kind: 'in', locator: admitted };
  if (admitted === prefix.slice(0, -1)) return { kind: 'in', locator: '.' };
  if (admitted.startsWith(prefix)) return { kind: 'in', locator: admitted.slice(prefix.length) };
  return { kind: 'out' };
}

/**
 * Rewrites worktree-relative journal records so they are relative to a Graph
 * subdirectory. Clearly outside-prefix paths are scoped out. Ambiguous or
 * non-portable locators untrust the whole journal.
 */
export function scopeChangeJournalToGraphRoot(
  journal: GraphChangeJournalInspection,
  showPrefix: string
): GraphChangeJournalInspection {
  if (journal.trust !== 'trusted') return journal;
  const prefix = showPrefix.replaceAll('\\', '/').replace(/^\.\//u, '');
  const normalizedPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  if (normalizedPrefix.includes('..') || normalizedPrefix.startsWith('/')) {
    return untrustedChangeJournal(
      journal.source,
      'Git porcelain status is malformed and cannot authorize skip-reread.',
      journal.baseline
    );
  }
  const records: GraphChangeJournalRecord[] = [];
  for (const record of journal.records) {
    const current = classifyScopedLocator(record.locator, normalizedPrefix);
    if (!current) {
      return untrustedChangeJournal(
        journal.source,
        'Git porcelain status is malformed and cannot authorize skip-reread.',
        journal.baseline
      );
    }
    if (record.priorLocator) {
      const prior = classifyScopedLocator(record.priorLocator, normalizedPrefix);
      if (!prior) {
        return untrustedChangeJournal(
          journal.source,
          'Git porcelain status is malformed and cannot authorize skip-reread.',
          journal.baseline
        );
      }
      if (current.kind === 'in' && prior.kind === 'in') {
        records.push(
          freezeRecord({
            ...record,
            locator: current.locator,
            priorLocator: prior.locator,
          })
        );
        continue;
      }
      if (current.kind === 'in' && prior.kind === 'out') {
        records.push(
          freezeRecord({
            locator: current.locator,
            kind: 'added',
            gitStatus: record.gitStatus,
          })
        );
        continue;
      }
      if (current.kind === 'out' && prior.kind === 'in') {
        records.push(
          freezeRecord({
            locator: prior.locator,
            kind: 'deleted',
            gitStatus: record.gitStatus,
          })
        );
        continue;
      }
      continue;
    }
    if (current.kind === 'out') continue;
    records.push(freezeRecord({ ...record, locator: current.locator }));
  }
  return trustedJournal(records, journal.baseline);
}

export interface GitLsFilesVerboseEntry {
  readonly tag: string;
  readonly locator: string;
}

/**
 * Interprets `git ls-files -v -z` bytes. Only tag `H` (cached, fully
 * observable) can authorize skip-reread. Lowercase tags are
 * assume-unchanged; `S`/`s` are skip-worktree.
 */
export function parseGitLsFilesVerboseZ(
  text: string
):
  | { readonly ok: true; readonly entries: readonly GitLsFilesVerboseEntry[] }
  | { readonly ok: false } {
  const entries: GitLsFilesVerboseEntry[] = [];
  for (const token of text.split('\0')) {
    if (!token) continue;
    if (token.length < 3 || token[1] !== ' ') return { ok: false };
    const tag = token[0] ?? '';
    if (!/^[A-Za-z?]$/u.test(tag)) return { ok: false };
    const locator = admitJournalLocator(token.slice(2));
    if (!locator) return { ok: false };
    entries.push(Object.freeze({ tag, locator }));
  }
  return { ok: true, entries: Object.freeze(entries) };
}

export interface GitLsFilesStageEntry {
  readonly mode: string;
  readonly locator: string;
}

const LS_FILES_STAGE = /^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-3])\t([\s\S]*)$/u;

export function isGitlinkMode(mode: string | undefined): boolean {
  return mode === '160000';
}

/**
 * Interprets `git ls-files --stage -z` bytes. Mode `160000` is a gitlink /
 * submodule and is not a file-level observation of descendant inventory.
 */
export function parseGitLsFilesStageZ(
  text: string
):
  | { readonly ok: true; readonly entries: readonly GitLsFilesStageEntry[] }
  | { readonly ok: false } {
  const entries: GitLsFilesStageEntry[] = [];
  for (const token of text.split('\0')) {
    if (!token) continue;
    const matched = LS_FILES_STAGE.exec(token);
    if (!matched) return { ok: false };
    const locator = admitJournalLocator(matched[4] ?? '');
    if (!locator || locator.endsWith('/')) return { ok: false };
    entries.push(Object.freeze({ mode: matched[1] ?? '', locator }));
  }
  return { ok: true, entries: Object.freeze(entries) };
}
