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

function kindFromCode(code: string): GraphChangeJournalRecord['kind'] {
  return STATUS_KIND[code] ?? 'unknown';
}

function decodePorcelainPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

/**
 * Interprets already-admitted `git status --porcelain=v1` bytes. Does not spawn
 * Git and never treats Git status as Merkle reuse authority.
 */
export function parseGitStatusPorcelain(text: string): GraphChangeJournalInspection {
  const records: GraphChangeJournalRecord[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) {
      continue;
    }
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    const remainder = line.slice(3);
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
    const locator = decodePorcelainPath(remainder);
    const code = worktree !== ' ' ? worktree : index;
    records.push(
      Object.freeze({
        locator,
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
