import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ACTIVITY_RETENTION_RUNS = 200;
export const DEFAULT_ACTIVITY_RETENTION_DAYS = 14;

export function pruneActivityJournalDirectory(
  runsPath: string,
  options: { maxRuns?: number; maxAgeDays?: number } = {}
): number {
  const maxRuns = Math.max(10, options.maxRuns ?? DEFAULT_ACTIVITY_RETENTION_RUNS);
  const cutoff =
    Date.now() -
    Math.max(1, options.maxAgeDays ?? DEFAULT_ACTIVITY_RETENTION_DAYS) * 24 * 60 * 60 * 1_000;
  let entries: Array<{ path: string; mtimeMs: number }> = [];
  try {
    entries = fs
      .readdirSync(runsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
      .map((entry) => {
        const filePath = path.join(runsPath, entry.name);
        return { path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const [index, entry] of entries.entries()) {
    if (index < maxRuns && entry.mtimeMs >= cutoff) continue;
    try {
      fs.unlinkSync(entry.path);
      removed += 1;
    } catch {
      // Retention is best effort and must never affect an observed command.
    }
  }
  return removed;
}
