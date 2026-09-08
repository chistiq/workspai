import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { emitActivityTouch, emitWorkspaceActivity } from '../activity/activity-runtime.js';

const JOURNAL_KIND = 'workspai.lifecycle-transaction';
const JOURNAL_VERSION = 1;
const JOURNAL_FILE = 'manifest.json';
const JOURNAL_DIRECTORY_PREFIX = 'lifecycle-transaction-';

export type LifecycleJournalPhase = 'active' | 'committed' | 'rolling-back';

type FileSnapshot =
  | { type: 'file'; path: string; state: 'absent' }
  | { type: 'file'; path: string; state: 'regular'; mode: number; backup: string };

type TreeSnapshot = { type: 'tree'; path: string };
type DurableSnapshot = FileSnapshot | TreeSnapshot;
type RollbackAction = DurableSnapshot | { type: 'compensation'; run: () => Promise<void> };

interface LifecycleJournalManifest {
  kind: typeof JOURNAL_KIND;
  version: typeof JOURNAL_VERSION;
  ownerPid: number;
  phase: LifecycleJournalPhase;
  operations: DurableSnapshot[];
}

export interface LifecycleTransactionOptions {
  /** A transaction-specific subdirectory is created beneath this directory. */
  journalDirectory?: string;
}

async function lstatOrNull(targetPath: string) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isIgnorableWindowsDurabilityError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return (
    process.platform === 'win32' && (code === 'EPERM' || code === 'EINVAL' || code === 'ENOSYS')
  );
}

async function syncHandle(handle: Awaited<ReturnType<typeof fs.open>>): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    // Windows filesystems and the GitHub-hosted runner can reject fsync even
    // after the bytes were written successfully. Atomic rename still protects
    // readers; durability sync remains mandatory on platforms that support it.
    if (!isIgnorableWindowsDurabilityError(error)) throw error;
  }
}

function assertAbsoluteTarget(targetPath: unknown): asserts targetPath is string {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    throw new Error('Lifecycle transaction journal contains a non-absolute target path.');
  }
}

function assertSafeBackupReference(backup: unknown): asserts backup is string {
  if (
    typeof backup !== 'string' ||
    backup.length === 0 ||
    path.basename(backup) !== backup ||
    backup === '.' ||
    backup === '..'
  ) {
    throw new Error('Lifecycle transaction journal contains an unsafe backup reference.');
  }
}

function parseManifest(input: unknown): LifecycleJournalManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('Lifecycle transaction journal is not an object.');
  }
  const value = input as Record<string, unknown>;
  if (value.kind !== JOURNAL_KIND || value.version !== JOURNAL_VERSION) {
    throw new Error('Lifecycle transaction journal has an unsupported format.');
  }
  if (!Number.isInteger(value.ownerPid) || (value.ownerPid as number) <= 0) {
    throw new Error('Lifecycle transaction journal has an invalid owner process.');
  }
  if (!['active', 'committed', 'rolling-back'].includes(value.phase as string)) {
    throw new Error('Lifecycle transaction journal has an invalid phase.');
  }
  if (!Array.isArray(value.operations)) {
    throw new Error('Lifecycle transaction journal has invalid operations.');
  }

  for (const operation of value.operations) {
    if (!operation || typeof operation !== 'object') {
      throw new Error('Lifecycle transaction journal contains an invalid operation.');
    }
    const candidate = operation as Record<string, unknown>;
    assertAbsoluteTarget(candidate.path);
    if (candidate.type === 'tree') continue;
    if (candidate.type !== 'file' || !['absent', 'regular'].includes(candidate.state as string)) {
      throw new Error('Lifecycle transaction journal contains an invalid operation.');
    }
    if (candidate.state === 'regular') {
      if (
        !Number.isInteger(candidate.mode) ||
        (candidate.mode as number) < 0 ||
        (candidate.mode as number) > 0o7777
      ) {
        throw new Error('Lifecycle transaction journal contains an invalid file mode.');
      }
      assertSafeBackupReference(candidate.backup);
    }
  }

  return value as unknown as LifecycleJournalManifest;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(directoryPath, constants.O_RDONLY);
  } catch (error) {
    if (isIgnorableWindowsDurabilityError(error)) return;
    throw error;
  }
  try {
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
}

async function writeFileAtomically(targetPath: string, data: Uint8Array): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    const handle = await fs.open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    try {
      await handle.writeFile(data);
      await syncHandle(handle);
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, targetPath);
    await syncDirectory(path.dirname(targetPath));
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeManifest(
  transactionDirectory: string,
  manifest: LifecycleJournalManifest
): Promise<void> {
  await writeFileAtomically(
    path.join(transactionDirectory, JOURNAL_FILE),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  );
}

async function restoreFile(snapshot: FileSnapshot, transactionDirectory?: string): Promise<void> {
  const current = await lstatOrNull(snapshot.path);
  if (current?.isSymbolicLink() || (current && !current.isFile())) {
    throw new Error(`Refusing to restore over a non-regular file: ${snapshot.path}`);
  }
  if (snapshot.state === 'absent') {
    if (current) await fs.unlink(snapshot.path);
    return;
  }
  if (!transactionDirectory) {
    throw new Error(`Missing durable backup for: ${snapshot.path}`);
  }
  if (!(await lstatOrNull(path.dirname(snapshot.path)))) {
    // The containing tree was removed independently, so there is no surviving
    // location whose bytes can be restored and no transaction-owned tree to recreate.
    return;
  }

  const backupPath = path.join(transactionDirectory, snapshot.backup);
  const backupStat = await fs.lstat(backupPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && current?.isFile()) {
      // A concurrent recovery from an older CLI may already have restored this
      // operation and removed its backup. Recovery is serialized in current CLI runs.
      return current;
    }
    throw error;
  });
  if (backupStat === current) return;
  if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
    throw new Error(`Lifecycle transaction backup is not a regular file: ${backupPath}`);
  }
  const bytes = await fs.readFile(backupPath);
  const temporaryPath = path.join(
    path.dirname(snapshot.path),
    `.${path.basename(snapshot.path)}.${process.pid}.${crypto.randomUUID()}.rollback`
  );
  const handle = await fs.open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    snapshot.mode
  );
  try {
    await handle.writeFile(bytes);
    await handle.chmod(snapshot.mode);
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, snapshot.path);
    await syncDirectory(path.dirname(snapshot.path));
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeOwnedTree(snapshot: TreeSnapshot): Promise<void> {
  const current = await lstatOrNull(snapshot.path);
  if (!current) return;
  if (current.isSymbolicLink() || !current.isDirectory()) {
    throw new Error(`Refusing to remove a non-directory owned tree: ${snapshot.path}`);
  }
  await fs.rm(snapshot.path, { recursive: true });
}

async function runDurableRollback(
  operations: DurableSnapshot[],
  transactionDirectory: string
): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of [...operations].reverse()) {
    try {
      if (operation.type === 'file') await restoreFile(operation, transactionDirectory);
      else await removeOwnedTree(operation);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Lifecycle transaction rollback failed.');
  }
}

export class LifecycleTransaction {
  readonly journalPath?: string;

  private readonly actions: RollbackAction[] = [];
  private readonly durableOperations: DurableSnapshot[] = [];
  private phase: LifecycleJournalPhase = 'active';
  private finished = false;

  private constructor(private readonly transactionDirectory?: string) {
    this.journalPath = transactionDirectory
      ? path.join(transactionDirectory, JOURNAL_FILE)
      : undefined;
  }

  static async create(options: LifecycleTransactionOptions = {}): Promise<LifecycleTransaction> {
    if (!options.journalDirectory) return new LifecycleTransaction();

    const journalRoot = path.resolve(options.journalDirectory);
    await fs.mkdir(journalRoot, { recursive: true });
    const transactionDirectory = await fs.mkdtemp(path.join(journalRoot, JOURNAL_DIRECTORY_PREFIX));
    await syncDirectory(journalRoot);
    const transaction = new LifecycleTransaction(transactionDirectory);
    await transaction.persist();
    return transaction;
  }

  private assertActive(): void {
    if (this.finished || this.phase !== 'active') {
      throw new Error('Lifecycle transaction is no longer active.');
    }
  }

  private async persist(operations = this.durableOperations): Promise<void> {
    if (!this.transactionDirectory) return;
    await writeManifest(this.transactionDirectory, {
      kind: JOURNAL_KIND,
      version: JOURNAL_VERSION,
      ownerPid: process.pid,
      phase: this.phase,
      operations,
    });
  }

  private async addDurableOperation(operation: DurableSnapshot): Promise<void> {
    const nextOperations = [...this.durableOperations, operation];
    await this.persist(nextOperations);
    this.durableOperations.push(operation);
    this.actions.push(operation);
  }

  /** Capture an absent path or the exact bytes and permission bits of a regular file. */
  async captureFile(targetPath: string): Promise<void> {
    this.assertActive();
    const absolutePath = path.resolve(targetPath);
    const initialStat = await lstatOrNull(absolutePath);
    if (!initialStat) {
      await this.addDurableOperation({ type: 'file', path: absolutePath, state: 'absent' });
      emitActivityTouch({
        targetPath: absolutePath,
        operation: 'capture-preimage',
        status: 'planned',
      });
      return;
    }
    if (initialStat.isSymbolicLink() || !initialStat.isFile()) {
      throw new Error(`Lifecycle transaction can only capture regular files: ${absolutePath}`);
    }

    let handle;
    try {
      handle = await fs.open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(`File changed while being captured: ${absolutePath}`, { cause: error });
      throw error;
    }

    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new Error(`Lifecycle transaction can only capture regular files: ${absolutePath}`);
      }
      const bytes = await handle.readFile();
      const mode = stat.mode & 0o7777;
      if (this.transactionDirectory) {
        const backup = `file-${this.durableOperations.length}-${crypto.randomUUID()}.bin`;
        await writeFileAtomically(path.join(this.transactionDirectory, backup), bytes);
        await this.addDurableOperation({
          type: 'file',
          path: absolutePath,
          state: 'regular',
          mode,
          backup,
        });
      } else {
        const backup = `memory-${this.durableOperations.length}`;
        const operation: FileSnapshot = {
          type: 'file',
          path: absolutePath,
          state: 'regular',
          mode,
          backup,
        };
        this.durableOperations.push(operation);
        this.actions.push({
          type: 'compensation',
          run: async () => {
            const current = await lstatOrNull(absolutePath);
            if (current?.isSymbolicLink() || (current && !current.isFile())) {
              throw new Error(`Refusing to restore over a non-regular file: ${absolutePath}`);
            }
            const temporaryPath = path.join(
              path.dirname(absolutePath),
              `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.rollback`
            );
            await fs.writeFile(temporaryPath, bytes, { flag: 'wx', mode });
            await fs.chmod(temporaryPath, mode);
            try {
              await fs.rename(temporaryPath, absolutePath);
            } catch (error) {
              await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
              throw error;
            }
          },
        });
      }
      emitActivityTouch({
        targetPath: absolutePath,
        operation: 'capture-preimage',
        status: 'planned',
      });
    } finally {
      await handle.close();
    }
  }

  /** Record a tree for removal only when its root is absent at capture time. */
  async captureOwnedTree(targetPath: string): Promise<boolean> {
    this.assertActive();
    const absolutePath = path.resolve(targetPath);
    const stat = await lstatOrNull(absolutePath);
    if (!stat) {
      await this.addDurableOperation({ type: 'tree', path: absolutePath });
      emitActivityTouch({ targetPath: absolutePath, operation: 'create-tree', status: 'planned' });
      return true;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Lifecycle transaction tree must be absent or a directory: ${absolutePath}`);
    }
    return false;
  }

  registerCompensation(compensation: () => void | Promise<void>): void {
    this.assertActive();
    this.actions.push({
      type: 'compensation',
      run: async () => compensation(),
    });
  }

  async commit(): Promise<void> {
    if (this.finished) return;
    this.assertActive();
    this.phase = 'committed';
    try {
      await this.persist();
      this.finished = true;
      this.actions.length = 0;
      if (this.transactionDirectory) {
        await fs.rm(this.transactionDirectory, { recursive: true }).catch(() => undefined);
      }
      emitWorkspaceActivity({
        kind: 'operation.completed',
        status: 'succeeded',
        component: 'lifecycle-transaction',
        message: 'Lifecycle transaction committed.',
        attributes: { capturedTargets: this.durableOperations.length },
      });
    } catch (error) {
      this.phase = 'active';
      throw error;
    }
  }

  async rollback(): Promise<void> {
    if (this.finished || this.phase === 'committed') return;
    this.assertActive();
    this.phase = 'rolling-back';
    emitWorkspaceActivity({
      kind: 'operation.started',
      status: 'running',
      component: 'lifecycle-transaction',
      message: 'Lifecycle transaction rollback started.',
      attributes: { capturedTargets: this.durableOperations.length },
    });
    try {
      await this.persist();
    } catch (error) {
      this.phase = 'active';
      throw error;
    }

    const failures: unknown[] = [];
    for (const action of [...this.actions].reverse()) {
      try {
        if (action.type === 'compensation') await action.run();
        else if (action.type === 'file') await restoreFile(action, this.transactionDirectory);
        else await removeOwnedTree(action);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      emitWorkspaceActivity({
        kind: 'operation.failed',
        status: 'failed',
        component: 'lifecycle-transaction',
        message: 'Lifecycle transaction rollback failed.',
        attributes: { failures: failures.length },
      });
      throw new AggregateError(failures, 'Lifecycle transaction rollback failed.');
    }

    this.finished = true;
    if (this.transactionDirectory) await fs.rm(this.transactionDirectory, { recursive: true });
    emitWorkspaceActivity({
      kind: 'operation.completed',
      status: 'rolled-back',
      component: 'lifecycle-transaction',
      message: 'Lifecycle transaction rolled back.',
      attributes: { restoredTargets: this.durableOperations.length },
    });
  }
}

export async function createLifecycleTransaction(
  options: LifecycleTransactionOptions = {}
): Promise<LifecycleTransaction> {
  return LifecycleTransaction.create(options);
}

/** Recover every active or interrupted rollback journal beneath the supplied root. */
export async function recoverActiveLifecycleTransactions(
  journalDirectory: string
): Promise<string[]> {
  const journalRoot = path.resolve(journalDirectory);
  const entries = await fs.readdir(journalRoot, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const recovered: string[] = [];
  const failures: unknown[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(JOURNAL_DIRECTORY_PREFIX)) continue;
    const transactionDirectory = path.join(journalRoot, entry.name);
    try {
      let manifestText: string;
      try {
        manifestText = await fs.readFile(path.join(transactionDirectory, JOURNAL_FILE), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Another process may observe the mkdtemp directory before its first
          // manifest is atomically published, or after its owner committed and
          // removed it. Neither state contains recoverable operations.
          continue;
        }
        throw error;
      }
      const manifest = parseManifest(JSON.parse(manifestText));
      if (manifest.phase === 'committed') {
        await fs.rm(transactionDirectory, { recursive: true });
        continue;
      }
      let ownerAlive = false;
      try {
        process.kill(manifest.ownerPid, 0);
        ownerAlive = true;
      } catch (error) {
        ownerAlive = (error as NodeJS.ErrnoException).code === 'EPERM';
      }
      if (ownerAlive) continue;
      if (manifest.phase === 'active') {
        manifest.phase = 'rolling-back';
        await writeManifest(transactionDirectory, manifest);
      }
      await runDurableRollback(manifest.operations, transactionDirectory);
      await fs.rm(transactionDirectory, { recursive: true });
      recovered.push(transactionDirectory);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Lifecycle transaction recovery failed.');
  }
  return recovered;
}
