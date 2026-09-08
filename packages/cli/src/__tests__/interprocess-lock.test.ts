import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { withInterprocessLock } from '../utils/interprocess-lock.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fsExtra.remove(directory)));
});

describe('interprocess lock', () => {
  it('serializes concurrent asynchronous callers and releases the lock', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-lock-'));
    tempDirectories.push(root);
    const lockDirectory = path.join(root, 'shared.lock');
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        withInterprocessLock(
          lockDirectory,
          async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 3));
            completed.push(index);
            active -= 1;
          },
          { timeoutMs: 10_000, staleMs: 30_000, retryDelayMs: 2 }
        )
      )
    );

    expect(maximumActive).toBe(1);
    expect(completed).toHaveLength(20);
    expect(await fsExtra.pathExists(lockDirectory)).toBe(false);
  });

  it('reclaims an abandoned stale lock', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-stale-lock-'));
    tempDirectories.push(root);
    const lockDirectory = path.join(root, 'shared.lock');
    await fsExtra.ensureDir(lockDirectory);
    const stale = new Date(Date.now() - 60_000);
    await fsExtra.utimes(lockDirectory, stale, stale);

    const result = await withInterprocessLock(lockDirectory, async () => 'recovered', {
      timeoutMs: 2_000,
      staleMs: 100,
      retryDelayMs: 2,
    });

    expect(result).toBe('recovered');
    expect(await fsExtra.pathExists(lockDirectory)).toBe(false);
  });
});
