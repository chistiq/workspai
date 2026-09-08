import path from 'node:path';

import fsExtra from 'fs-extra';

/**
 * Resolve a provider symlink only when its final target is a regular file
 * inside the canonical project boundary. Canonicalizing both sides is
 * required on platforms where a temporary or mounted path has an alternate
 * spelling, such as macOS /var -> /private/var.
 */
export async function resolveRepositoryLocalSymlinkFile(
  projectPath: string,
  linkPath: string
): Promise<string | null> {
  const [canonicalProjectPath, targetPath] = await Promise.all([
    fsExtra.realpath(projectPath).catch(() => null),
    fsExtra.realpath(linkPath).catch(() => null),
  ]);
  if (!canonicalProjectPath || !targetPath) return null;

  const relative = path.relative(canonicalProjectPath, targetPath);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return null;
  }
  const stat = await fsExtra.stat(targetPath).catch(() => null);
  return stat?.isFile() ? targetPath : null;
}
