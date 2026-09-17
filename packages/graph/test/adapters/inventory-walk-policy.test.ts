import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeGraphFileSource } from '../../src/adapters/node/index.js';
import { GRAPH_STANDARD_REPO_BUILD_POLICY } from '../../src/application/build-repo-graph.js';
import { GRAPH_INVENTORY_SURFACE } from '../../src/conformance/inventory-surface-api.js';

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
          enumeration: 'not-enumerated',
          enumeratedEntryCount: 0,
        }),
        expect.objectContaining({
          locator: 'node_modules',
          class: 'vendored',
          count: 'not-enumerated',
          bytes: 'not-measured',
          evidenceKind: 'universal-dependency-store',
          enumeration: 'not-enumerated',
          enumeratedEntryCount: 0,
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
          enumeration: 'not-enumerated',
          enumeratedEntryCount: 0,
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

  it('records directory truncation as partially-enumerated without counting unread dirents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-trunc-'));
    temporary.push(root);
    await fs.writeFile(path.join(root, 'zeta.ts'), 'export const zeta = 1;\n');
    await fs.writeFile(path.join(root, 'alpha.ts'), 'export const alpha = 1;\n');
    await fs.writeFile(path.join(root, 'mu.ts'), 'export const mu = 1;\n');
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 100,
      maxTotalBytes: 100_000,
      maxFileBytes: 10_000,
      maxDepth: 10,
      maxDirectoryEntries: 2,
      excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
      sensitiveFiles: 'omit-known',
    });
    const locators = result.inputs.map((input) => input.locator);
    expect(locators).toHaveLength(2);
    expect(locators.every((locator) => !locator.includes('\\'))).toBe(true);
    expect(['alpha.ts', 'mu.ts', 'zeta.ts']).toEqual(expect.arrayContaining(locators));
    expect(new Set(locators).size).toBe(2);
    const truncated = result.omittedSubtrees?.find((subtree) => subtree.locator === '.');
    expect(truncated).toMatchObject({
      class: 'resource-bounded',
      enumeration: 'partially-enumerated',
      enumeratedEntryCount: 2,
      count: 'not-enumerated',
      bytes: 'not-measured',
      evidenceKind: 'resource-budget',
      code: 'graph.repository-directory-truncated',
    });
    expect(truncated?.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('stops after the file budget and leaves unvisited directories unmeasured', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-budget-'));
    temporary.push(root);
    await fs.mkdir(path.join(root, 'leftover', 'nested'), { recursive: true });
    const admitted = 'export const admitted = 1;\n';
    const overflow = 'export const overflow = 1;\n';
    const hidden = 'export const hidden = 1;\n';
    await fs.writeFile(path.join(root, 'a.ts'), admitted);
    await fs.writeFile(path.join(root, 'leftover', 'z.ts'), overflow);
    await fs.writeFile(path.join(root, 'leftover', 'nested', 'deep.ts'), hidden);
    const source = createNodeGraphFileSource();
    const result = await source.inventory({
      root,
      maxFiles: 1,
      maxTotalBytes: 100_000,
      maxFileBytes: 10_000,
      maxDepth: 10,
      maxDirectoryEntries: 100,
      excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
      sensitiveFiles: 'omit-known',
    });
    expect(result.status).toBe('partial');
    expect(result.inputs.map((input) => input.locator)).toEqual(['a.ts']);
    expect(result.inputs.map((input) => input.locator)).not.toContain('leftover/nested/deep.ts');
    expect(result.omittedFiles).toBe(1);
    expect(result.omittedBytes).toBe(Buffer.byteLength(overflow));
    expect(result.omittedBytes).not.toBe(Buffer.byteLength(overflow) + Buffer.byteLength(hidden));
    expect(result.omittedSubtrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: 'leftover/nested',
          class: 'resource-bounded',
          enumeration: 'not-enumerated',
          enumeratedEntryCount: 0,
          count: 'not-enumerated',
          bytes: 'not-measured',
          code: 'graph.repository-budget-truncated',
        }),
      ])
    );
    expect(result.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.repository-budget-truncated' })
    );
  });

  it('binds complete walk budgets into policyDigest independently of host path separators', async () => {
    const root = await mixedRepository();
    const source = createNodeGraphFileSource();
    const request = {
      root,
      maxFiles: 40,
      maxTotalBytes: 80_000,
      maxFileBytes: 9_000,
      maxDepth: 7,
      maxDirectoryEntries: 50,
      excludedDirectories: ['node_modules', '.git', '.venv'],
      sensitiveFiles: 'omit-known' as const,
    };
    const reversed = {
      ...request,
      excludedDirectories: ['.venv', '.git', 'node_modules'],
    };
    const first = await source.inventory(request);
    const second = await source.inventory(reversed);
    const expected = `sha256:${createHash('sha256')
      .update(
        GRAPH_INVENTORY_SURFACE.policyMaterial({
          excludedDirectories: request.excludedDirectories,
          evidenceKind: 'universal-dependency-store',
          budgets: {
            maxFiles: request.maxFiles,
            maxTotalBytes: request.maxTotalBytes,
            maxFileBytes: request.maxFileBytes,
            maxDepth: request.maxDepth,
            maxDirectoryEntries: request.maxDirectoryEntries,
          },
          sensitiveFiles: request.sensitiveFiles,
        })
      )
      .digest('hex')}`;
    const nodeModules = first.omittedSubtrees?.find(
      (subtree) => subtree.locator === 'node_modules'
    );
    expect(nodeModules?.policyDigest).toBe(expected);
    expect(
      second.omittedSubtrees?.find((subtree) => subtree.locator === 'node_modules')?.policyDigest
    ).toBe(expected);
    const tighter = await source.inventory({ ...request, maxFiles: 39 });
    expect(
      tighter.omittedSubtrees?.find((subtree) => subtree.locator === 'node_modules')?.policyDigest
    ).not.toBe(expected);
    expect(JSON.stringify(first.omittedSubtrees)).not.toMatch(/\\\\/u);
    expect(JSON.stringify(first)).not.toContain(root);
  });
});
