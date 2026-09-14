import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  replaceExistingPathWithTemporary,
  replaceFileAtomically,
} from '../utils/atomic-file-replace.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => fsExtra.remove(root)));
});

async function temporaryDir(): Promise<string> {
  const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-atomic-replace-'));
  temporaryRoots.push(root);
  return root;
}

describe('atomic file replace', () => {
  it('overwrites an existing target and does not leave a temp file', async () => {
    const root = await temporaryDir();
    const target = path.join(root, 'report.json');
    await fsExtra.writeFile(target, '{"old":true}\n');
    await replaceFileAtomically(target, '{"new":true}\n');
    expect(await fsExtra.readFile(target, 'utf8')).toBe('{"new":true}\n');
    expect((await fsExtra.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('falls back to overwrite-move when rename reports EEXIST or EPERM', async () => {
    for (const code of ['EEXIST', 'EPERM'] as const) {
      const rename = vi
        .spyOn(fsExtra, 'rename')
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      const move = vi.spyOn(fsExtra, 'move').mockResolvedValueOnce();
      await replaceExistingPathWithTemporary('/tmp/report.json.tmp', '/tmp/report.json');
      expect(move).toHaveBeenCalledWith('/tmp/report.json.tmp', '/tmp/report.json', {
        overwrite: true,
      });
      rename.mockRestore();
      move.mockRestore();
    }
  });
});
