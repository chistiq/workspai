import fs from 'fs';
import path from 'path';

function isRunnableGoSource(targetPath: string): boolean {
  try {
    const source = fs.readFileSync(targetPath, 'utf8');
    return /^\s*package\s+main\b/m.test(source) && /\bfunc\s+main\s*\(/m.test(source);
  } catch {
    return false;
  }
}

/**
 * Resolve a deterministic `go run` target.
 *
 * A repository with several commands must provide an explicit Makefile run
 * target instead of allowing the adapter to choose an arbitrary binary.
 */
export function resolveGoRunTarget(projectRoot: string): string | null {
  const directMain = path.join(projectRoot, 'main.go');
  if (isRunnableGoSource(directMain)) return './.';

  try {
    const rootMainSources = fs
      .readdirSync(projectRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.go'))
      .map((entry) => path.join(projectRoot, entry.name))
      .filter(isRunnableGoSource);
    if (rootMainSources.length > 0) return './.';
  } catch {
    // Continue with cmd discovery.
  }

  const cmdPath = path.join(projectRoot, 'cmd');
  try {
    const candidates = fs
      .readdirSync(cmdPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        mainPath: path.join(cmdPath, entry.name, 'main.go'),
      }))
      .filter((entry) => isRunnableGoSource(entry.mainPath))
      .map((entry) => `./cmd/${entry.name}`)
      .sort();
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}
