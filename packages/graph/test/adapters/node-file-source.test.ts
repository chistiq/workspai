import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeGraphFileSource } from '../../src/adapters/node/index.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-files-'));
  temporary.push(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'index.js'), 'hidden\n');
  return root;
}

describe('Node repository file source', () => {
  it('inventories deterministic content-addressed inputs without excluded trees', async () => {
    const root = await fixture();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result).toMatchObject({ status: 'complete', omittedFiles: 0, omittedBytes: 0 });
    expect(result.inputs.map((input) => input.locator)).toEqual(['package.json', 'src/index.ts']);
    expect(result.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: 'src/index.ts',
          mediaType: 'text/typescript',
          digest: { algorithm: 'sha256', value: expect.stringMatching(/^[a-f0-9]{64}$/u) },
        }),
      ])
    );
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('emits identical portable locators and digests for the same tree in two checkouts', async () => {
    const left = await fixture();
    const right = await fixture();
    const source = createNodeGraphFileSource();
    const request = {
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known' as const,
    };
    const first = await source.inventory({ ...request, root: left });
    const second = await source.inventory({ ...request, root: right });

    expect(left).not.toBe(right);
    expect(
      first.inputs.map((input) => ({
        locator: input.locator,
        digest: input.digest,
        byteLength: input.byteLength,
        mediaType: input.mediaType,
      }))
    ).toEqual(
      second.inputs.map((input) => ({
        locator: input.locator,
        digest: input.digest,
        byteLength: input.byteLength,
        mediaType: input.mediaType,
      }))
    );
    expect(JSON.stringify(first)).not.toContain(left);
    expect(JSON.stringify(second)).not.toContain(right);
  });

  it('revalidates content identity before every provider read', async () => {
    const root = await fixture();
    const source = createNodeGraphFileSource();
    const inventory = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });
    const input = inventory.inputs.find((candidate) => candidate.locator === 'src/index.ts');
    expect(input).toBeDefined();
    if (!input) return;

    await expect(source.read(root, input, { maxBytes: 1_000 })).resolves.toEqual(
      new TextEncoder().encode('export const value = 1;\n')
    );
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 2;\n');
    await expect(source.read(root, input, { maxBytes: 1_000 })).rejects.toThrow(
      'admitted boundary'
    );
    await expect(
      source.read(root, { ...input, locator: '../outside' }, { maxBytes: 1_000 })
    ).rejects.toThrow('admitted boundary');
  });

  it('returns an honest partial inventory when resource ceilings omit files', async () => {
    const root = await fixture();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 1,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.status).toBe('partial');
    expect(result.inputs).toHaveLength(1);
    expect(result.omittedFiles).toBe(1);
    expect(result.omittedBytes).toBeGreaterThan(0);
  });

  it('omits known sensitive inputs without reading their contents into provider inventory', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, '.env.production'), 'TOKEN=do-not-ingest\n');
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.status).toBe('partial');
    expect(result.inputs.map((input) => input.locator)).not.toContain('.env.production');
    expect(result.unsupportedZones).toContainEqual(
      expect.objectContaining({ code: 'graph.sensitive-input-omitted' })
    );
    expect(JSON.stringify(result)).not.toContain('do-not-ingest');
  });

  it('reports deep unobserved trees instead of presenting truncated traversal as complete', async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await fs.writeFile(path.join(root, 'a', 'b', 'hidden.ts'), 'export {};\n');
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 0,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.status).toBe('partial');
    expect(result.inputs.map((input) => input.locator)).not.toContain('a/b/hidden.ts');
    expect(result.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.repository-depth-truncated', scope: 'a' })
    );
  });

  it('bounds oversized directory listings before they can amplify inventory memory', async () => {
    const root = await fixture();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 1,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.status).toBe('partial');
    expect(result.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.repository-directory-truncated' })
    );
  });

  it('admits only repository-local Git HEAD metadata and excludes other Git state', async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await fs.writeFile(
      path.join(root, '.git', 'config'),
      '[remote "origin"]\nurl = https://secret@example.invalid/private.git\n'
    );
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['.git', 'node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.inputs.map((candidate) => candidate.locator)).toContain('.git/HEAD');
    expect(result.inputs.map((candidate) => candidate.locator)).not.toContain('.git/config');
    expect(JSON.stringify(result)).not.toContain('secret@example.invalid');
    const head = result.inputs.find((candidate) => candidate.locator === '.git/HEAD');
    expect(head).toBeDefined();
    if (!head) return;
    await expect(source.read(root, head, { maxBytes: 4_096 })).resolves.toEqual(
      new TextEncoder().encode('ref: refs/heads/main\n')
    );
  });

  it('does not follow or expose Git worktree indirection outside the repository', async () => {
    const root = await fixture();
    const externalGitDirectory = path.join(root, '..', 'private-worktree-metadata');
    await fs.writeFile(path.join(root, '.git'), `gitdir: ${externalGitDirectory}\n`);
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['.git', 'node_modules'],
      sensitiveFiles: 'omit-known',
    });

    expect(result.status).toBe('partial');
    expect(result.inputs.map((candidate) => candidate.locator)).not.toContain('.git');
    expect(result.unsupportedZones).toContainEqual(
      expect.objectContaining({ code: 'graph.git-indirection-unsupported' })
    );
    expect(JSON.stringify(result)).not.toContain(externalGitDirectory);
  });

  it('content-hashes only the requested locators during skip-reread inventory', async () => {
    const root = await fixture();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
      onlyLocators: ['src/index.ts'],
    });

    expect(result.inputs.map((input) => input.locator)).toEqual(['src/index.ts']);
    const skipped = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
      onlyLocators: [],
    });
    expect(skipped.inputs).toEqual([]);
  });

  it('emits NFC locators for NFD filenames and still reads the admitted bytes', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'src', 'Cafe\u0301.ts'), 'export const cafe = 1;\n', 'utf8');
    const source = createNodeGraphFileSource();
    const bounds = {
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known' as const,
    };
    const result = await source.inventory({ ...bounds, root });
    const cafe = result.inputs.find((input) => input.locator.endsWith('Caf\u00e9.ts'));
    expect(cafe?.locator).toBe('src/Caf\u00e9.ts');
    expect(result.inputs.some((input) => input.locator.includes('\u0301'))).toBe(false);
    if (!cafe) throw new Error('NFC cafe locator was not inventoried.');
    const bytes = await source.read(root, cafe, { maxBytes: 1_000 });
    expect(new TextDecoder().decode(bytes)).toBe('export const cafe = 1;\n');
  });

  it('omits NFC-equivalent filenames that collide in one directory', async () => {
    const root = await fixture();
    const src = path.join(root, 'src');
    await fs.writeFile(path.join(src, 'Caf\u00e9.ts'), 'nfc\n', 'utf8');
    await fs.writeFile(path.join(src, 'Cafe\u0301.ts'), 'nfd\n', 'utf8');
    const names = await fs.readdir(src);
    const cafeNames = names.filter((name) => name.normalize('NFC') === 'Caf\u00e9.ts');
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 10,
      maxTotalBytes: 10_000,
      maxFileBytes: 1_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: ['node_modules'],
      sensitiveFiles: 'omit-known',
    });
    if (new Set(cafeNames).size < 2) {
      expect(cafeNames.map((name) => name.normalize('NFC'))).toEqual(['Caf\u00e9.ts']);
      return;
    }
    expect(result.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.unicode-locator-collision' })
    );
    expect(result.inputs.some((input) => input.locator.endsWith('Caf\u00e9.ts'))).toBe(false);
  });
});
