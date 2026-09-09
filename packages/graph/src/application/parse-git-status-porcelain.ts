import type { GraphChangeJournalInspection, GraphChangeJournalRecord } from '../ports/index.js';

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

function kindFromCode(code: string): GraphChangeJournalRecord['kind'] {
  return STATUS_KIND[code] ?? 'unknown';
}

function decodePorcelainPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

export function absentChangeJournal(): GraphChangeJournalInspection {
  return Object.freeze({
    trust: 'absent',
    source: 'none',
    records: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

export function untrustedChangeJournal(
  source: GraphChangeJournalInspection['source'],
  reason: string
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
      records.push(
        Object.freeze({
          locator: decodePorcelainPath(rename[1]!),
          kind: 'renamed',
          gitStatus: `${index}${worktree}`,
          priorLocator: decodePorcelainPath(rename[0]!),
        })
      );
      continue;
    }
    const code = worktree !== ' ' ? worktree : index;
    records.push(
      Object.freeze({
        locator: decodePorcelainPath(remainder),
        kind: kindFromCode(code),
        gitStatus: `${index}${worktree}`,
      })
    );
  }
  return Object.freeze({
    trust: 'trusted',
    source: 'git',
    records: Object.freeze(records),
    diagnostics: Object.freeze([]),
  });
}
