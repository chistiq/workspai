import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  linkSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SNAPSHOT_SCHEMA = 'workspai.graph.native-snapshot.v1';

export interface NativeSnapshotManifest {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly packedDigest: string;
  readonly packedBytes: number;
  readonly factDigest: string;
  readonly contentDigest: string;
  readonly factCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly decisionCount: number;
  readonly unresolvedCount: number;
  readonly lifecycle: 'published';
}

export function nativeSnapshotRoot(): string {
  return process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT ?? join(tmpdir(), 'workspai-graph-snapshots');
}

export function nativeSnapshotPackedPath(id: string): string {
  return snapshotPath(id);
}

function snapshotPath(id: string): string {
  return join(nativeSnapshotRoot(), id.slice(0, 2), id);
}

function manifestPath(id: string): string {
  return `${snapshotPath(id)}.manifest.json`;
}

function hashFile(path: string): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let read = 0;
    do {
      read = readSync(fd, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function copyVerified(source: string, destination: string): number {
  const input = openSync(source, 'r');
  const output = openSync(destination, 'w', 0o600);
  const buffer = Buffer.alloc(1024 * 1024);
  let total = 0;
  try {
    let read = 0;
    do {
      read = readSync(input, buffer, 0, buffer.length, null);
      if (read > 0) {
        let offset = 0;
        while (offset < read) {
          const wrote = writeSync(output, buffer, offset, read - offset);
          if (wrote <= 0) throw new Error('snapshot-write');
          offset += wrote;
        }
        total += read;
      }
    } while (read > 0);
    fsyncSync(output);
  } finally {
    closeSync(input);
    closeSync(output);
  }
  return total;
}

function fsyncDirectory(directory: string): void {
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function lockPath(directory: string): string {
  return join(directory, '.publish.lock');
}

function processStartTicks(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = stat.lastIndexOf(')');
    if (end < 0) return undefined;
    return stat.slice(end + 2).split(' ')[19];
  } catch {
    return undefined;
  }
}

interface PublishLock {
  readonly path: string;
  readonly body: string;
}

function lockTextIsStale(text: string): boolean {
  const [pidText, timeText, , startText] = text.split('\n');
  const pid = Number(pidText);
  const createdAt = Number(timeText);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(createdAt)) return true;
  const observedStart = processStartTicks(pid);
  if (startText && observedStart && startText !== observedStart) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function acquirePublishLock(directory: string): PublishLock {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = lockPath(directory);
  const nonce = randomBytes(16).toString('hex');
  const body = `${process.pid}\n${Date.now()}\n${nonce}\n${processStartTicks(process.pid) ?? ''}\n`;
  try {
    writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
    return { path, body };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
    claimStaleLock(path, body);
    return { path, body };
  }
}

function claimStaleLock(path: string, body: string): void {
  let observed = '';
  try {
    observed = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
      return;
    }
    throw error;
  }
  if (!lockTextIsStale(observed)) throw new Error('snapshot-lock');
  const retired = `${path}.${randomBytes(8).toString('hex')}.stale`;
  try {
    renameSync(path, retired);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
      return;
    }
    throw error;
  }
  const moved = readFileSync(retired, 'utf8');
  if (moved !== observed || !lockTextIsStale(moved)) {
    rmSync(retired, { force: true });
    throw new Error('snapshot-lock');
  }
  try {
    writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    rmSync(retired, { force: true });
    throw error;
  }
  rmSync(retired, { force: true });
}

function releasePublishLock(lock: PublishLock): void {
  try {
    if (readFileSync(lock.path, 'utf8') !== lock.body) return;
    rmSync(lock.path, { force: true });
  } catch {
    return;
  }
}

function writeDurableFile(path: string, body: Buffer): void {
  const fd = openSync(path, 'w', 0o600);
  try {
    let offset = 0;
    while (offset < body.byteLength) {
      const wrote = writeSync(fd, body, offset, body.byteLength - offset);
      if (wrote <= 0) throw new Error('snapshot-write');
      offset += wrote;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function snapshotFormat(path: string): 'WGP1' | 'WGP2' {
  const magic = Buffer.alloc(4);
  const source = openSync(path, 'r');
  try {
    readSync(source, magic, 0, 4, 0);
  } finally {
    closeSync(source);
  }
  return magic.toString('ascii') === 'WGP2' ? 'WGP2' : 'WGP1';
}

export function snapshotBytesForDecode(packed: Buffer): Buffer {
  if (packed.subarray(0, 4).toString('ascii') !== 'WGP2') return packed;
  if (packed.readUInt32LE(4) !== 1) throw new Error('snapshot-segment');
  const count = packed.readUInt32LE(8);
  if (packed.byteLength !== 12 + count * 41) throw new Error('snapshot-segment');
  const parts = new Map<number, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 41;
    const kind = packed[at] ?? 0;
    const digest = packed.subarray(at + 9, at + 41).toString('hex');
    parts.set(kind, readFileSync(join(nativeSnapshotRoot(), 'segments', digest)));
  }
  const header = Buffer.alloc(8);
  header.write('WGP1', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  return Buffer.concat([
    header,
    parts.get(1) ?? Buffer.alloc(0),
    parts.get(2) ?? Buffer.alloc(0),
    parts.get(3) ?? Buffer.alloc(0),
    parts.get(5) ?? Buffer.alloc(0),
    parts.get(6) ?? Buffer.alloc(0),
  ]);
}

function linkPublishedSegments(sourcePath: string): void {
  const magic = Buffer.alloc(4);
  const source = openSync(sourcePath, 'r');
  try {
    readSync(source, magic, 0, 4, 0);
  } finally {
    closeSync(source);
  }
  if (magic.toString('ascii') !== 'WGP2') return;
  const manifest = readFileSync(sourcePath);
  if (manifest.readUInt32LE(4) !== 1) throw new Error('snapshot-segment');
  const count = manifest.readUInt32LE(8);
  if (manifest.byteLength !== 12 + count * 41) throw new Error('snapshot-segment');
  const shared = join(nativeSnapshotRoot(), 'segments');
  mkdirSync(shared, { recursive: true, mode: 0o700 });
  const sourceDir = join(dirname(sourcePath), 'segments');
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 41;
    const length = Number(manifest.readBigUInt64LE(at + 1));
    const digest = manifest.subarray(at + 9, at + 41).toString('hex');
    const from = join(sourceDir, digest);
    const to = join(shared, digest);
    if (!existsSync(to)) {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
    }
    if (statSync(to).size !== length || hashFile(to) !== digest) {
      throw new Error('snapshot-segment');
    }
  }
}

export function publishNativeSnapshot(
  sourcePath: string,
  manifest: Omit<NativeSnapshotManifest, 'schema' | 'lifecycle' | 'packedDigest' | 'packedBytes'>
): NativeSnapshotManifest {
  const packedDigest = hashFile(sourcePath);
  const packedBytes = statSync(sourcePath).size;
  if (!/^[a-f0-9]{64}$/u.test(packedDigest)) throw new Error('snapshot-digest');
  const directory = dirname(snapshotPath(packedDigest));
  const destination = snapshotPath(packedDigest);
  const publishedManifest = manifestPath(packedDigest);
  const lock = acquirePublishLock(directory);
  const tempPath = join(directory, `.${packedDigest}.${process.pid}.partial`);
  try {
    if (existsSync(destination) && existsSync(publishedManifest)) {
      const existing = JSON.parse(
        readFileSync(publishedManifest, 'utf8')
      ) as NativeSnapshotManifest;
      if (
        existing.schema === SNAPSHOT_SCHEMA &&
        existing.lifecycle === 'published' &&
        existing.packedDigest === packedDigest &&
        existing.factDigest === manifest.factDigest &&
        existing.contentDigest === manifest.contentDigest &&
        existing.packedBytes === statSync(destination).size &&
        hashFile(destination) === packedDigest &&
        hashFile(sourcePath) === packedDigest
      ) {
        rmSync(tempPath, { force: true });
        return Object.freeze(existing);
      }
    }
    linkPublishedSegments(sourcePath);
    const copied = copyVerified(sourcePath, tempPath);
    if (copied !== packedBytes || hashFile(tempPath) !== packedDigest) {
      throw new Error('snapshot-verify');
    }
    renameSync(tempPath, snapshotPath(packedDigest));
    fsyncDirectory(directory);
    if (hashFile(snapshotPath(packedDigest)) !== packedDigest) throw new Error('snapshot-verify');
    const published: NativeSnapshotManifest = Object.freeze({
      schema: SNAPSHOT_SCHEMA,
      lifecycle: 'published',
      packedDigest,
      packedBytes,
      ...manifest,
    });
    const manifestTemp = `${manifestPath(packedDigest)}.${process.pid}.partial`;
    try {
      writeDurableFile(manifestTemp, Buffer.from(`${JSON.stringify(published)}\n`));
      renameSync(manifestTemp, manifestPath(packedDigest));
      fsyncDirectory(directory);
    } catch (error) {
      rmSync(manifestTemp, { force: true });
      throw error;
    }
    return published;
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  } finally {
    releasePublishLock(lock);
  }
}

function readersDirectory(id: string): string {
  return `${snapshotPath(id)}.readers`;
}

function readerTokenBody(): string {
  const nonce = randomBytes(8).toString('hex');
  return `${process.pid}\n${Date.now()}\n${nonce}\n${processStartTicks(process.pid) ?? ''}\n`;
}

function readerTokenIsStale(path: string): boolean {
  try {
    return lockTextIsStale(readFileSync(path, 'utf8'));
  } catch {
    return true;
  }
}

function retainReader(id: string): () => void {
  const directory = dirname(snapshotPath(id));
  const lock = acquirePublishLock(directory);
  try {
    if (!existsSync(snapshotPath(id)) || !existsSync(manifestPath(id))) {
      throw new Error('native-snapshot-missing');
    }
    const readers = readersDirectory(id);
    mkdirSync(readers, { recursive: true, mode: 0o700 });
    const token = join(readers, randomBytes(8).toString('hex'));
    writeFileSync(token, readerTokenBody(), { flag: 'wx', mode: 0o600 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      rmSync(token, { force: true });
    };
  } finally {
    releasePublishLock(lock);
  }
}

/**
 * Registers a reader lease without reading the packed snapshot into Node.
 * Query processes use this so close cannot delete a snapshot they have open.
 */
export function retainNativeSnapshot(id: string): () => void {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('snapshot-id');
  return retainReader(id);
}

export function openNativeSnapshot(id: string): {
  readonly manifest: NativeSnapshotManifest;
  readonly packed: Buffer;
  release(): void;
} {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('snapshot-id');
  const path = snapshotPath(id);
  const release = retainReader(id);
  try {
    const manifest = JSON.parse(readFileSync(manifestPath(id), 'utf8')) as NativeSnapshotManifest;
    const packed = readFileSync(path);
    const digest = createHash('sha256').update(packed).digest('hex');
    if (
      manifest.schema !== SNAPSHOT_SCHEMA ||
      manifest.lifecycle !== 'published' ||
      manifest.packedDigest !== id ||
      digest !== id ||
      packed.byteLength !== manifest.packedBytes
    ) {
      throw new Error('snapshot-corrupt');
    }
    return { manifest, packed, release };
  } catch (error) {
    release();
    throw error;
  }
}

export function closeNativeSnapshot(id: string): void {
  if (!/^[a-f0-9]{64}$/u.test(id)) return;
  const directory = dirname(snapshotPath(id));
  const lock = acquirePublishLock(directory);
  try {
    const readers = readersDirectory(id);
    if (existsSync(readers)) {
      for (const name of readdirSync(readers)) {
        const token = join(readers, name);
        if (readerTokenIsStale(token)) rmSync(token, { force: true });
      }
      if (readdirSync(readers).length > 0) throw new Error('snapshot-busy');
      rmSync(readers, { recursive: true, force: true });
    }
    rmSync(snapshotPath(id), { force: true });
    rmSync(manifestPath(id), { force: true });
  } finally {
    releasePublishLock(lock);
  }
}
