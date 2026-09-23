import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  closeNativeSnapshot,
  nativeSnapshotPackedPath,
  nativeSnapshotRoot,
  openNativeSnapshot,
  publishNativeSnapshot,
} from '../../src/application/native-snapshot-store.js';

const manifest = {
  factDigest: 'ab'.repeat(32),
  contentDigest: 'cd'.repeat(32),
  factCount: 1,
  nodeCount: 1,
  edgeCount: 0,
  decisionCount: 0,
  unresolvedCount: 0,
};

describe('native snapshot store', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    delete process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    root = '';
  });

  function isolate(): string {
    root = mkdtempSync(join(tmpdir(), 'workspai-snapshot-'));
    process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = root;
    return root;
  }

  function sourceFile(): string {
    const directory = isolate();
    const path = join(directory, 'source.wgp');
    writeFileSync(path, Buffer.from('WGP1-snapshot-body'));
    return path;
  }

  it('reopens a published snapshot from its content digest', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const opened = openNativeSnapshot(published.packedDigest);
    expect(opened.manifest.packedDigest).toBe(published.packedDigest);
    expect(opened.packed.toString()).toBe('WGP1-snapshot-body');
    expect(nativeSnapshotPackedPath(published.packedDigest).includes(published.packedDigest)).toBe(
      true
    );
    expect(
      readFileSync(`${nativeSnapshotPackedPath(published.packedDigest)}.manifest.json`, 'utf8')
    ).not.toContain(root);
  });

  it('rejects a truncated or rewritten snapshot', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const path = nativeSnapshotPackedPath(published.packedDigest);
    writeFileSync(path, Buffer.from('WGP1-snapshot-BODY'));
    expect(() => openNativeSnapshot(published.packedDigest)).toThrow('snapshot-corrupt');
  });

  it('rejects a manifest whose digest does not match the file name', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const manifestPath = `${nativeSnapshotPackedPath(published.packedDigest)}.manifest.json`;
    const body = JSON.parse(readFileSync(manifestPath, 'utf8')) as { packedDigest: string };
    body.packedDigest = 'ff'.repeat(32);
    writeFileSync(manifestPath, JSON.stringify(body));
    expect(() => openNativeSnapshot(published.packedDigest)).toThrow('snapshot-corrupt');
  });

  it('closes twice and then refuses to open', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    closeNativeSnapshot(published.packedDigest);
    closeNativeSnapshot(published.packedDigest);
    expect(() => openNativeSnapshot(published.packedDigest)).toThrow('native-snapshot-missing');
    expect(() => openNativeSnapshot('not-a-digest')).toThrow('snapshot-id');
  });

  it('lets two readers open one published snapshot', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const first = openNativeSnapshot(published.packedDigest);
    const second = openNativeSnapshot(published.packedDigest);
    expect(first.packed.equals(second.packed)).toBe(true);
    expect(() => closeNativeSnapshot(published.packedDigest)).toThrow('snapshot-busy');
    first.release();
    expect(() => closeNativeSnapshot(published.packedDigest)).toThrow('snapshot-busy');
    second.release();
    closeNativeSnapshot(published.packedDigest);
    expect(() => openNativeSnapshot(published.packedDigest)).toThrow('native-snapshot-missing');
  });

  it('reaps a reader token whose process is gone', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const readers = `${nativeSnapshotPackedPath(published.packedDigest)}.readers`;
    mkdirSync(readers, { recursive: true });
    writeFileSync(join(readers, 'dead'), `999999\n0\nnonce\n1\n`);
    closeNativeSnapshot(published.packedDigest);
    expect(existsSync(nativeSnapshotPackedPath(published.packedDigest))).toBe(false);
  });

  it('rejects a live publish lock and recovers a stale lock', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    const directory = join(nativeSnapshotRoot(), published.packedDigest.slice(0, 2));
    const lock = join(directory, '.publish.lock');
    writeFileSync(lock, `${process.pid}\n${Date.now()}\n`);
    expect(() => publishNativeSnapshot(source, manifest)).toThrow('snapshot-lock');
    writeFileSync(lock, `999999\n0\n`);
    expect(publishNativeSnapshot(source, manifest).packedDigest).toBe(published.packedDigest);
  });

  it('replaces an interrupted partial without deleting another snapshot', () => {
    const source = sourceFile();
    const published = publishNativeSnapshot(source, manifest);
    writeFileSync(join(nativeSnapshotRoot(), published.packedDigest.slice(0, 2), '.kept'), 'live');
    const partial = join(
      nativeSnapshotRoot(),
      published.packedDigest.slice(0, 2),
      `.${published.packedDigest}.${process.pid}.partial`
    );
    writeFileSync(partial, 'partial');
    publishNativeSnapshot(source, manifest);
    expect(openNativeSnapshot(published.packedDigest).packed.toString()).toBe('WGP1-snapshot-body');
    expect(
      readFileSync(join(nativeSnapshotRoot(), published.packedDigest.slice(0, 2), '.kept'), 'utf8')
    ).toBe('live');
    expect(() => openNativeSnapshot('11'.repeat(32))).toThrow('native-snapshot-missing');
  });
});
