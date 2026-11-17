import { realpathSync } from 'fs';
import path from 'path';

/** Canonical registry path for cross-platform workspace/project entries. */
export function normalizeRegistryPath(inputPath: string): string {
  let resolved = path.resolve(inputPath);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // A deleted or not-yet-created leaf still has the physical identity of
    // its existing parent. Preserve aliases such as /var -> /private/var
    // instead of changing workspace link bindings when that leaf is removed.
    let ancestor = path.dirname(resolved);
    while (true) {
      try {
        resolved = path.resolve(realpathSync.native(ancestor), path.relative(ancestor, resolved));
        break;
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
