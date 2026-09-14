import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

import fsExtra from 'fs-extra';

function isIgnorableFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EINVAL' || code === 'ENOTSUP' || code === 'EOPNOTSUPP';
}

/**
 * Cross-platform commit of a temp file onto an existing target. POSIX rename
 * replaces; Windows may return EEXIST/EPERM when the target already exists.
 */
export async function replaceExistingPathWithTemporary(
  temporaryPath: string,
  targetPath: string
): Promise<void> {
  try {
    await fsExtra.rename(temporaryPath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }
    await fsExtra.move(temporaryPath, targetPath, { overwrite: true });
  }
}

export async function replaceFileAtomically(targetPath: string, contents: string): Promise<void> {
  await fsExtra.ensureDir(path.dirname(targetPath));
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fsExtra.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    const handle = await open(temporaryPath, 'r');
    try {
      try {
        await handle.sync();
      } catch (error) {
        if (!isIgnorableFsyncError(error)) {
          throw error;
        }
      }
    } finally {
      await handle.close();
    }
    await replaceExistingPathWithTemporary(temporaryPath, targetPath);
  } finally {
    await fsExtra.remove(temporaryPath).catch(() => undefined);
  }
}
