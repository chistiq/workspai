/**
 * Returns true for Python virtual-environment directories that must never be
 * treated as authored workspace source. Recovery, backup, and quarantined
 * environments are included because users commonly rename a broken `.venv`
 * instead of deleting it.
 */
export function isPythonVirtualEnvironmentDirectory(directoryName: string): boolean {
  const normalized = directoryName.trim().toLowerCase();
  return /^(?:\.venv(?:[._-].+)?|venv)$/.test(normalized);
}
