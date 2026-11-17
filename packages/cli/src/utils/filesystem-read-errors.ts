/** Classify access failures without persisting local paths or error messages. */
export function isFilesystemReadDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['EACCES', 'EPERM', 'EROFS'].includes(String(error.code));
}
