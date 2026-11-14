import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve from this ESM module, independently of the caller's working
// directory and Vitest's compatibility globals. CLI suites also mock
// fs.existsSync; that mock must not decide whether the real build exists.
const distPath = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));

export function ensureDistBuilt(label = 'CLI tests'): string {
  try {
    if (statSync(distPath).isFile()) return distPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  throw new Error(
    `Missing CLI build for ${label}: ${distPath}. Run tests through npm test; do not rebuild or clean dist while tests are running.`
  );
}
