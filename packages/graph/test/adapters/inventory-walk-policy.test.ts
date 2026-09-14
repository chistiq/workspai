import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeGraphFileSource } from '../../src/adapters/node/index.js';
import { GRAPH_STANDARD_REPO_BUILD_POLICY } from '../../src/application/build-repo-graph.js';

const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function mixedRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-walk-'));
  temporary.push(root);
  const unicodeDocs = path.join(root, 'docs', '\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8');
  await fs.mkdir(path.join(root, 'src', 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'tools', 'build'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages', 'target'), { recursive: true });
  await fs.mkdir(path.join(root, 'app', 'out'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages', 'app', 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await fs.mkdir(path.join(root, '.workspai'), { recursive: true });
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  await fs.mkdir(path.join(root, 'vendor'), { recursive: true });
  await fs.mkdir(path.join(root, 'coverage', 'tmp'), { recursive: true });
  await fs.mkdir(unicodeDocs, { recursive: true });
  await fs.mkdir(path.join(root, 'secrets'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'bin', 'run.ts'), 'export const run = 1;\n');
  await fs.writeFile(path.join(root, 'tools', 'build', 'script.py'), 'print("ok")\n');
  await fs.writeFile(path.join(root, 'packages', 'target', 'lib.rs'), 'pub fn f() {}\n');
  await fs.writeFile(path.join(root, 'app', 'out', 'Main.cs'), 'class Program {}\n');
  await fs.writeFile(path.join(root, 'packages', 'app', 'src', 'index.ts'), 'export {};\n');
  await fs.writeFile(path.join(root, 'src', 'Service.java'), 'class Service {}\n');
  await fs.writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  await fs.writeFile(path.join(root, '.workspai', 'policy.json'), '{"ok":true}\n');
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(path.join(root, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n');
  await fs.writeFile(
    path.join(root, 'node_modules', 'left-pad', 'index.js'),
    'module.exports=1;\n'
  );
  await fs.writeFile(path.join(root, 'vendor', 'authored.c'), 'int f(void) { return 1; }\n');
  await fs.writeFile(path.join(root, 'coverage', 'tmp', 'out.json'), '{"n":1}\n');
  await fs.writeFile(path.join(unicodeDocs, 'readme.md'), '# docs\n');
  await fs.writeFile(path.join(root, 'secrets', '.env.production'), 'TOKEN=do-not-ingest\n');
  await fs.writeFile(path.join(root, 'infra.yaml'), 'kind: ConfigMap\n');
  return root;
}

describe('real filesystem inventory walk policy', () => {
  it('inventories configuration, authored ambiguous names, and mixed-language files under standard policy', async () => {
    const root = await mixedRepository();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      ...GRAPH_STANDARD_REPO_BUILD_POLICY.limits,
      excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
      sensitiveFiles: GRAPH_STANDARD_REPO_BUILD_POLICY.sensitiveFiles,
    });

    const locators = result.inputs
      .map((input) => input.locator)
      .sort((left, right) => left.localeCompare(right));
    expect(locators).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml',
        '.workspai/policy.json',
        '.git/HEAD',
        'src/bin/run.ts',
        'tools/build/script.py',
        'packages/target/lib.rs',
        'app/out/Main.cs',
        'packages/app/src/index.ts',
        'src/Service.java',
        'vendor/authored.c',
        'coverage/tmp/out.json',
        'docs/\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8/readme.md',
        'infra.yaml',
      ])
    );
    expect(locators).not.toContain('.git/config');
    expect(locators).not.toContain('node_modules/left-pad/index.js');
    expect(locators).not.toContain('secrets/.env.production');
    expect(result.omittedSubtrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: '.git',
          class: 'vcs-metadata',
          count: 'not-enumerated',
          bytes: 'not-measured',
          evidenceKind: 'universal-vcs-metadata',
        }),
        expect.objectContaining({
          locator: 'node_modules',
          class: 'vendored',
          count: 'not-enumerated',
          bytes: 'not-measured',
          evidenceKind: 'universal-dependency-store',
        }),
      ])
    );
    expect(result.omittedSubtrees?.every((subtree) => subtree.count === 'not-enumerated')).toBe(
      true
    );
    expect(result.omittedFileAccounting).toBe('unknown-subtrees');
    expect(result.omittedByteAccounting).toBe('unknown-subtrees');
    expect(result.unsupportedZones).toContainEqual(
      expect.objectContaining({
        code: 'graph.sensitive-input-omitted',
        scope: 'secrets/.env.production',
        classificationOrigin: 'structured-producer',
      })
    );
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain('do-not-ingest');
  });

  it('excludes a declared subtree only when host policy names it, and never by basename alone', async () => {
    const root = await mixedRepository();
    const source = createNodeGraphFileSource();
    const withoutHost = await source.inventory({
      root,
      maxFiles: 100,
      maxTotalBytes: 100_000,
      maxFileBytes: 10_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
      sensitiveFiles: 'omit-known',
    });
    expect(withoutHost.inputs.map((input) => input.locator)).toContain('coverage/tmp/out.json');
    expect(withoutHost.omittedSubtrees?.map((subtree) => subtree.locator)).not.toContain(
      'coverage'
    );

    const withHost = await source.inventory({
      root,
      maxFiles: 100,
      maxTotalBytes: 100_000,
      maxFileBytes: 10_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: [...GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories, 'coverage'],
      sensitiveFiles: 'omit-known',
    });
    expect(withHost.inputs.map((input) => input.locator)).not.toContain('coverage/tmp/out.json');
    expect(withHost.omittedSubtrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: 'coverage',
          class: 'policy-excluded',
          count: 'not-enumerated',
          bytes: 'not-measured',
          evidenceKind: 'host-inventory-exclusion',
          code: 'graph.repository-policy-directory',
        }),
      ])
    );
    expect(withHost.omittedSubtrees?.find((subtree) => subtree.locator === 'coverage')?.count).toBe(
      'not-enumerated'
    );
  });

  it('keeps Windows separators, collisions, and nested workspace locators portable', async () => {
    const root = await mixedRepository();
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 100,
      maxTotalBytes: 100_000,
      maxFileBytes: 10_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
      sensitiveFiles: 'omit-known',
    });
    expect(result.inputs.every((input) => !input.locator.includes('\\'))).toBe(true);
    expect(result.inputs.map((input) => input.locator)).toContain('packages/app/src/index.ts');
    expect(JSON.stringify(result.omittedSubtrees)).not.toMatch(/\\\\/u);
  });
});
