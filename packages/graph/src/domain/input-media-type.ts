const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.css': 'text/css',
  '.go': 'text/x-go',
  '.html': 'text/html',
  '.java': 'text/x-java',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/jsx',
  '.md': 'text/markdown',
  '.php': 'text/x-php',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.toml': 'application/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
});

/** Portable media type for an admitted repository locator. */
export function graphInputMediaType(locator: string): string {
  if (locator === '.git/HEAD') {
    return 'text/plain';
  }
  const index = locator.lastIndexOf('.');
  const extension = index === -1 ? '' : locator.slice(index).toLowerCase();
  return MEDIA_TYPES[extension] ?? 'application/octet-stream';
}
