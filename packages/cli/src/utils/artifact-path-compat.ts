import path from 'path';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import fsExtra from 'fs-extra';
import { assertWorkspaceArtifactContract } from '../contracts/artifact-contract-registry.js';
import { toLegacyRapidkitArtifactPath, toWorkspaiArtifactPath } from './workspace-paths.js';

function assertWorkspaceContainedPath(workspacePath: string, relativePath: string): string {
  const root = path.resolve(workspacePath);
  const normalized = relativePath.trim();
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error(`Workspace artifact path must be non-empty and relative: ${relativePath}`);
  }
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Workspace artifact path escapes workspace root: ${relativePath}`);
  }
  return target;
}

export function resolveWorkspaceArtifactPath(workspacePath: string, relativePath: string): string {
  return assertWorkspaceContainedPath(workspacePath, toWorkspaiArtifactPath(relativePath));
}

export function resolveLegacyWorkspaceArtifactPath(
  workspacePath: string,
  relativePath: string
): string {
  return assertWorkspaceContainedPath(workspacePath, toLegacyRapidkitArtifactPath(relativePath));
}

async function ensureArtifactParentIsContained(
  workspacePath: string,
  artifactPath: string
): Promise<void> {
  const root = path.resolve(workspacePath);
  await fsExtra.ensureDir(root);
  const parent = path.dirname(artifactPath);
  await fsExtra.ensureDir(parent);
  const [realRoot, realParent] = await Promise.all([
    fsExtra.realpath(root),
    fsExtra.realpath(parent),
  ]);
  const relative = path.relative(realRoot, realParent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Workspace artifact parent resolves outside workspace root: ${parent}`);
  }
}

async function assertExistingArtifactIsContained(
  workspacePath: string,
  artifactPath: string
): Promise<void> {
  const root = path.resolve(workspacePath);
  const [realRoot, realArtifact] = await Promise.all([
    fsExtra.realpath(root),
    fsExtra.realpath(artifactPath),
  ]);
  const relative = path.relative(realRoot, realArtifact);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Workspace artifact resolves outside workspace root: ${artifactPath}`);
  }
}

function isIgnorableArtifactFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    process.platform === 'win32' && (code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS')
  );
}

export function isWorkspaceArtifactLockContentionError(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== 'win32') return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

async function removeWorkspaceArtifactLock(lockPath: string): Promise<void> {
  const attempts = process.platform === 'win32' ? 6 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fsExtra.remove(lockPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isWorkspaceArtifactLockContentionError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
  throw lastError;
}

const inProcessArtifactLockTails = new Map<string, Promise<void>>();

async function withInProcessArtifactLock<T>(
  lockPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = inProcessArtifactLockTails.get(lockPath) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => turn);
  inProcessArtifactLockTails.set(lockPath, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (inProcessArtifactLockTails.get(lockPath) === tail) {
      inProcessArtifactLockTails.delete(lockPath);
    }
  }
}

async function syncFileHandleForArtifact(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    if (!isIgnorableArtifactFsyncError(error)) {
      throw error;
    }
  }
}

async function replaceArtifactAtomically(
  workspacePath: string,
  primaryPath: string,
  writeTemporary: (temporaryPath: string) => Promise<void>
): Promise<void> {
  await ensureArtifactParentIsContained(workspacePath, primaryPath);
  const parent = path.dirname(primaryPath);
  const temporaryPrefix = `${path.basename(primaryPath)}.`;
  const now = Date.now();
  for (const name of await fsExtra.readdir(parent)) {
    if (!name.startsWith(temporaryPrefix) || !name.endsWith('.tmp')) continue;
    const candidate = path.join(parent, name);
    const stat = await fsExtra.stat(candidate).catch(() => null);
    if (stat && now - stat.mtimeMs > 30_000) {
      await fsExtra.remove(candidate).catch(() => undefined);
    }
  }
  const temporaryPath = `${primaryPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeTemporary(temporaryPath);
    const temporaryHandle = await open(temporaryPath, 'r');
    try {
      await syncFileHandleForArtifact(temporaryHandle);
    } finally {
      await temporaryHandle.close();
    }
    const testDelayMs = Number(process.env.WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS ?? 0);
    if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(testDelayMs, 30_000)));
    }
    try {
      await fsExtra.rename(temporaryPath, primaryPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw error;
      }
      await fsExtra.move(temporaryPath, primaryPath, { overwrite: true });
    }
  } finally {
    await fsExtra.remove(temporaryPath).catch(() => undefined);
  }
}

export async function withWorkspaceArtifactLock<T>(
  workspacePath: string,
  relativePath: string,
  operation: () => Promise<T>,
  options: { timeoutMs?: number; staleAfterMs?: number } = {}
): Promise<T> {
  const artifactPath = resolveWorkspaceArtifactPath(workspacePath, relativePath);
  await ensureArtifactParentIsContained(workspacePath, artifactPath);
  const lockPath = `${artifactPath}.lock`;
  return withInProcessArtifactLock(lockPath, () =>
    withWorkspaceArtifactFileLock(lockPath, relativePath, operation, options)
  );
}

async function withWorkspaceArtifactFileLock<T>(
  lockPath: string,
  relativePath: string,
  operation: () => Promise<T>,
  options: { timeoutMs?: number; staleAfterMs?: number }
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  while (!handle) {
    try {
      handle = await open(lockPath, 'wx');
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`
      );
      await syncFileHandleForArtifact(handle);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const contention = code === 'EEXIST' || isWorkspaceArtifactLockContentionError(error);
      if (!contention) {
        if (handle) {
          await handle.close().catch(() => undefined);
          handle = undefined;
          await removeWorkspaceArtifactLock(lockPath).catch(() => undefined);
        }
        throw error;
      }
      if (handle) {
        await handle.close().catch(() => undefined);
        handle = undefined;
        await removeWorkspaceArtifactLock(lockPath).catch(() => undefined);
      }
      const [stat, lock] = await Promise.all([
        fsExtra.stat(lockPath).catch(() => null),
        fsExtra.readJson(lockPath).catch(() => null),
      ]);
      const ownerPid = Number(lock?.pid);
      const hasOwnerPid = Number.isInteger(ownerPid) && ownerPid > 0;
      let ownerAlive = false;
      if (hasOwnerPid) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = true;
        } catch (ownerError) {
          ownerAlive = (ownerError as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      const expiredUnknownOwner =
        !hasOwnerPid && Boolean(stat && Date.now() - stat.mtimeMs > staleAfterMs);
      if ((hasOwnerPid && !ownerAlive) || expiredUnknownOwner) {
        await removeWorkspaceArtifactLock(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for workspace artifact lock: ${relativePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await removeWorkspaceArtifactLock(lockPath);
  }
}

export async function firstExistingWorkspaceArtifactPath(
  workspacePath: string,
  relativePath: string
): Promise<string | null> {
  const candidates = [
    resolveWorkspaceArtifactPath(workspacePath, relativePath),
    resolveLegacyWorkspaceArtifactPath(workspacePath, relativePath),
  ];

  for (const candidate of candidates) {
    if (await fsExtra.pathExists(candidate)) {
      await assertExistingArtifactIsContained(workspacePath, candidate);
      return candidate;
    }
  }

  return null;
}

export async function writeWorkspaceArtifactJson(
  workspacePath: string,
  relativePath: string,
  payload: unknown
): Promise<string> {
  assertWorkspaceArtifactContract(relativePath, payload);
  const primaryPath = resolveWorkspaceArtifactPath(workspacePath, relativePath);

  await replaceArtifactAtomically(workspacePath, primaryPath, (temporaryPath) =>
    fsExtra.writeJson(temporaryPath, payload, { spaces: 2 })
  );

  return primaryPath;
}

export async function writeWorkspaceArtifactJsonSet(
  workspacePath: string,
  lockRelativePath: string,
  artifacts: readonly { relativePath: string; payload: unknown }[]
): Promise<string[]> {
  if (artifacts.length === 0) return [];
  const normalized = artifacts.map((artifact) => ({
    ...artifact,
    path: resolveWorkspaceArtifactPath(workspacePath, artifact.relativePath),
  }));
  const duplicate = normalized.find(
    (artifact, index) =>
      normalized.findIndex((candidate) => candidate.path === artifact.path) !== index
  );
  if (duplicate)
    throw new Error(`Duplicate workspace artifact transaction target: ${duplicate.relativePath}`);
  for (const artifact of normalized) {
    assertWorkspaceArtifactContract(artifact.relativePath, artifact.payload);
  }

  return withWorkspaceArtifactLock(workspacePath, lockRelativePath, async () => {
    const preimages = await Promise.all(
      normalized.map(async (artifact) => ({
        path: artifact.path,
        exists: await fsExtra.pathExists(artifact.path),
        contents: await fsExtra.readFile(artifact.path).catch(() => null),
      }))
    );
    try {
      for (let index = 0; index < normalized.length; index += 1) {
        const artifact = normalized[index];
        await replaceArtifactAtomically(workspacePath, artifact.path, (temporaryPath) =>
          fsExtra.writeJson(temporaryPath, artifact.payload, { spaces: 2 })
        );
        const failAfter = Number(process.env.WORKSPAI_TEST_FAIL_ARTIFACT_SET_AFTER ?? 0);
        if (Number.isInteger(failAfter) && failAfter === index + 1) {
          throw new Error(`Injected artifact-set failure after ${failAfter} write(s).`);
        }
      }
      return normalized.map((artifact) => artifact.path);
    } catch (error) {
      const restorations = await Promise.allSettled(
        preimages.map(async (preimage) => {
          if (!preimage.exists || preimage.contents === null) {
            await fsExtra.remove(preimage.path);
            return;
          }
          await replaceArtifactAtomically(workspacePath, preimage.path, (temporaryPath) =>
            fsExtra.writeFile(temporaryPath, preimage.contents as Buffer)
          );
        })
      );
      const failures = restorations.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failures.length > 0) {
        throw new AggregateError(
          [error, ...failures.map((failure) => failure.reason)],
          'Workspace artifact transaction failed and rollback was incomplete.'
        );
      }
      throw error;
    }
  });
}

export async function writeWorkspaceArtifactText(
  workspacePath: string,
  relativePath: string,
  payload: string
): Promise<string> {
  const primaryPath = resolveWorkspaceArtifactPath(workspacePath, relativePath);

  await replaceArtifactAtomically(workspacePath, primaryPath, (temporaryPath) =>
    fsExtra.writeFile(temporaryPath, payload, 'utf-8')
  );

  return primaryPath;
}
