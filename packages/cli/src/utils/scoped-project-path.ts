import fs from 'node:fs';
import path from 'node:path';

export function isInsideProject(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve a live path without crossing a different Git or Workspai project. */
export function scopedProjectPath(root: string, relative: string): string | undefined {
  if (
    relative !== '.' &&
    (!relative ||
      /[\\:\x00-\x1f\x7f]/u.test(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..'))
  )
    return undefined;
  try {
    const canonical = fs.realpathSync(root);
    const lexical = path.join(canonical, relative);
    const physical = fs.realpathSync(lexical);
    if (!isInsideProject(canonical, physical)) return undefined;
    for (const target of new Set([lexical, physical])) {
      const stat = fs.statSync(target);
      let current = stat.isDirectory() ? target : path.dirname(target);
      while (path.relative(canonical, current)) {
        if (!isInsideProject(canonical, current)) return undefined;
        if (
          ['.git', '.workspai/project.json'].some((marker) =>
            fs.existsSync(path.join(current, marker))
          )
        ) {
          return undefined;
        }
        current = path.dirname(current);
      }
    }
    return physical;
  } catch {
    return undefined;
  }
}
