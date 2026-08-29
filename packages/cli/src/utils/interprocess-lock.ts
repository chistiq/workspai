import crypto from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

export type InterprocessLockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  retryDelayMs?: number;
  purpose?: string;
};

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_STALE_MS = 15 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 75;

// Avoid making callers in this process contend through the filesystem. This is
// especially important on Windows, where removing a lock directory and
// immediately recreating it from another asynchronous caller can transiently
// fail with EPERM even after the removal promise has resolved.
const inProcessLockTails = new Map<string, Promise<void>>();

type LockOwner = {
  token: string;
  pid: number;
  createdAt: string;
  purpose?: string;
};

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readOwner(lockDirectory: string): Promise<LockOwner | null> {
  try {
    const owner = (await fsExtra.readJson(
      path.join(lockDirectory, 'owner.json')
    )) as Partial<LockOwner>;
    return typeof owner.token === 'string' && typeof owner.pid === 'number'
      ? (owner as LockOwner)
      : null;
  } catch {
    return null;
  }
}

async function reclaimIfStale(lockDirectory: string, staleMs: number): Promise<void> {
  try {
    const stat = await fsExtra.stat(lockDirectory);
    if (Date.now() - stat.mtimeMs <= staleMs) return;
    await fsExtra.remove(lockDirectory);
  } catch {
    // Another contender may have released or reclaimed the lock first.
  }
}

async function acquireInProcessLock(lockDirectory: string): Promise<() => void> {
  const previous = inProcessLockTails.get(lockDirectory) ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.then(
    () => gate,
    () => gate
  );
  inProcessLockTails.set(lockDirectory, tail);
  await previous.catch(() => undefined);

  return () => {
    releaseGate();
    if (inProcessLockTails.get(lockDirectory) === tail) {
      inProcessLockTails.delete(lockDirectory);
    }
  };
}

function isRetryableAcquisitionError(code: string | undefined): boolean {
  if (code === 'EEXIST') return true;
  return process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY');
}

/**
 * Serialize a read-modify-write or bootstrap operation across both asynchronous
 * callers and OS processes. A directory is the lock primitive because mkdir is
 * atomic on every filesystem supported by Node. The heartbeat prevents a slow,
 * healthy owner from being mistaken for a crashed process.
 */
async function withFilesystemLock<T>(
  lockDirectory: string,
  operation: () => Promise<T>,
  options: InterprocessLockOptions = {}
): Promise<T> {
  const resolvedLock = path.resolve(lockDirectory);
  const timeoutMs = positiveFinite(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const staleMs = positiveFinite(options.staleMs, DEFAULT_STALE_MS);
  const retryDelayMs = positiveFinite(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  const startedAt = Date.now();
  const token = crypto.randomUUID();
  const owner: LockOwner = {
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    ...(options.purpose ? { purpose: options.purpose } : {}),
  };

  await fsExtra.ensureDir(path.dirname(resolvedLock));
  while (true) {
    try {
      await fsExtra.mkdir(resolvedLock);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!isRetryableAcquisitionError(code)) throw error;
      await reclaimIfStale(resolvedLock, staleMs);
      if (Date.now() - startedAt >= timeoutMs) {
        const currentOwner = await readOwner(resolvedLock);
        const ownerDescription = currentOwner ? ` (owner pid ${currentOwner.pid})` : '';
        throw new Error(`Timed out waiting for Workspai lock${ownerDescription}: ${resolvedLock}`);
      }
      const jitter = Math.floor(Math.random() * Math.max(10, retryDelayMs));
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs + jitter));
      continue;
    }

    try {
      await fsExtra.writeJson(path.join(resolvedLock, 'owner.json'), owner, { spaces: 2 });
      break;
    } catch (error) {
      await fsExtra.remove(resolvedLock).catch(() => undefined);
      throw error;
    }
  }

  const heartbeatMs = Math.max(1_000, Math.min(30_000, Math.floor(staleMs / 3)));
  const heartbeat = setInterval(() => {
    const now = new Date();
    void fsExtra.utimes(resolvedLock, now, now).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref();

  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    const currentOwner = await readOwner(resolvedLock);
    if (currentOwner?.token === token) {
      await fsExtra.remove(resolvedLock).catch(() => undefined);
    }
  }
}

export async function withInterprocessLock<T>(
  lockDirectory: string,
  operation: () => Promise<T>,
  options: InterprocessLockOptions = {}
): Promise<T> {
  const resolvedLock = path.resolve(lockDirectory);
  const releaseInProcessLock = await acquireInProcessLock(resolvedLock);
  try {
    return await withFilesystemLock(resolvedLock, operation, options);
  } finally {
    releaseInProcessLock();
  }
}
