import path from 'node:path';

import { execa } from 'execa';
import fsExtra from 'fs-extra';

async function launches(candidate: string, cwd: string): Promise<boolean> {
  try {
    const result = await execa(candidate, ['--version'], {
      cwd,
      shell: false,
      reject: false,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      stdin: 'ignore',
    });
    return result.exitCode !== undefined && result.exitCode !== null;
  } catch {
    return false;
  }
}

/**
 * Proves that an executable is both present and launchable. This is shared by
 * planning and execution so an action cannot be advertised as ready and then
 * fail the engine's first precondition for the same environment.
 */
export async function executableAvailable(input: {
  executable: string;
  cwd: string;
}): Promise<boolean> {
  if (!path.isAbsolute(input.executable) && !/^\.{1,2}[\\/]/.test(input.executable)) {
    // Let the process launcher apply the platform's PATH/PATHEXT semantics.
    // Missing binaries and broken interpreter chains reject without an exit
    // code, while a non-zero --version response still proves launchability.
    return launches(input.executable, input.cwd);
  }
  const candidate = path.isAbsolute(input.executable)
    ? input.executable
    : path.resolve(input.cwd, input.executable);
  const stat = await fsExtra.stat(candidate).catch(() => undefined);
  const runnable =
    stat?.isFile() === true && (process.platform === 'win32' || (stat.mode & 0o111) !== 0);
  return runnable && launches(candidate, input.cwd);
}
