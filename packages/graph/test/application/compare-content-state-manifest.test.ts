import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compareContentStateManifests } from '../../src/application/compare-content-state-manifest.js';
import { buildContentStateManifest } from '../../src/application/build-content-state-manifest.js';
import type {
  GraphContentStateLeaf,
  GraphContentStateManifest,
} from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = (value: string) => ({ algorithm: 'sha256' as const, value });

function readManifest(name: string): GraphContentStateManifest {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'fixtures/g6', name), 'utf8')
  ) as GraphContentStateManifest;
}

function cloneManifest(manifest: GraphContentStateManifest): GraphContentStateManifest {
  return structuredClone(manifest) as GraphContentStateManifest;
}

function withManifest(
  manifest: GraphContentStateManifest,
  patch: Partial<GraphContentStateManifest>
): GraphContentStateManifest {
  return { ...cloneManifest(manifest), ...patch };
}

function withComparedDirectoryDigests(
  nodes: GraphContentStateManifest['nodes'],
  branchDigest: GraphContentStateManifest['merkleRoot']
): GraphContentStateManifest['nodes'] {
  return nodes.map((node) =>
    node.kind === 'directory' ? { ...node, digest: branchDigest } : node
  );
}

function replaceFile(
  manifest: GraphContentStateManifest,
  locator: string,
  next: Partial<GraphContentStateLeaf>
): GraphContentStateManifest {
  const merkleRoot = next.contentDigest
    ? digest('1111111111111111111111111111111111111111111111111111111111111111')
    : manifest.merkleRoot;
  const nodes = withComparedDirectoryDigests(
    manifest.nodes.map((node) =>
      node.kind === 'file' && node.locator === locator ? { ...node, ...next } : node
    ),
    merkleRoot
  );
  return withManifest(manifest, {
    nodes,
    merkleRoot,
  });
}

describe('compareContentStateManifests', () => {
  it('returns no changes when Merkle roots are equal', () => {
    const manifest = readManifest('minimal-content-state-manifest.json');
    const result = compareContentStateManifests({ base: manifest, target: manifest });

    expect(result.status).toBe('complete');
    expect(result.changedInputs).toEqual([]);
    expect(result.comparedBranches).toBe(0);
    expect(result.skippedBranches).toBe(1);
    expect(result.causes).toEqual([]);
  });

  it('ignores observation-only drift so size, mtime and git status cannot emit edits', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const identity = {
      locator: 'src/index.ts',
      contentDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    };
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [
        {
          ...identity,
          observations: { sizeBytes: 12, modifiedAt: '2026-09-09T20:00:00.000Z', gitStatus: '  ' },
        },
      ],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T21:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [
        {
          ...identity,
          observations: {
            sizeBytes: 99,
            modifiedAt: '2026-09-10T08:00:00.000Z',
            gitStatus: ' M',
          },
        },
      ],
    });

    const result = compareContentStateManifests({ base, target });

    expect(base.merkleRoot).toEqual(target.merkleRoot);
    expect(result.changedInputs).toEqual([]);
    expect(result.causes).toEqual([]);
    expect(result.comparedBranches).toBe(0);
  });

  it('detects edited file leaves with prior and next digests', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = replaceFile(base, 'src/index.ts', {
      contentDigest: digest('9999999999999999999999999999999999999999999999999999999999999999'),
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.status).toBe('complete');
    expect(result.changedInputs).toEqual([
      expect.objectContaining({
        kind: 'edited',
        locator: 'src/index.ts',
        priorDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
        nextDigest: digest('9999999999999999999999999999999999999999999999999999999999999999'),
      }),
    ]);
    expect(result.comparedBranches).toBeGreaterThan(0);
  });

  it('detects added and deleted file leaves', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const merkleRoot = digest('2222222222222222222222222222222222222222222222222222222222222222');
    const target = withManifest(base, {
      merkleRoot,
      nodes: withComparedDirectoryDigests(
        [
          ...base.nodes.filter((node) => node.kind !== 'file' || node.locator !== 'src/index.ts'),
          {
            kind: 'file',
            locator: 'src/new.ts',
            contentDigest: digest(
              'abababababababababababababababababababababababababababababababab'
            ),
            inputKind: 'source-file',
            scanProfileDigest: digest(
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ),
          },
        ] as GraphContentStateManifest['nodes'],
        merkleRoot
      ),
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.changedInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'deleted', locator: 'src/index.ts' }),
        expect.objectContaining({ kind: 'added', locator: 'src/new.ts' }),
      ])
    );
  });

  it('promotes exact identity matches to rename candidates', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const merkleRoot = digest('3333333333333333333333333333333333333333333333333333333333333333');
    const target = withManifest(base, {
      merkleRoot,
      nodes: withComparedDirectoryDigests(
        base.nodes.map((node) =>
          node.kind === 'file' && node.locator === 'src/index.ts'
            ? { ...node, locator: 'src/renamed.ts' }
            : node
        ),
        merkleRoot
      ),
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.status).toBe('complete');
    expect(result.changedInputs).toEqual([
      expect.objectContaining({
        kind: 'rename-candidate',
        locator: 'src/renamed.ts',
        renameCandidate: {
          priorLocator: 'src/index.ts',
          nextLocator: 'src/renamed.ts',
          confidence: 1,
        },
      }),
    ]);
  });

  it('fails closed on scope mismatch', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const target = withManifest(base, {
      scope: { kind: 'workspace', workspaceId: 'workspace:other' },
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.status).toBe('failed');
    expect(result.changedInputs).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('GRAPH_INCREMENTAL_SCOPE_MISMATCH');
  });

  it('reports partial status when changed-input budget is exceeded', () => {
    const base = readManifest('minimal-content-state-manifest.json');
    const merkleRoot = digest('4444444444444444444444444444444444444444444444444444444444444444');
    const target = withManifest(base, {
      merkleRoot,
      nodes: withComparedDirectoryDigests(
        [
          ...base.nodes,
          {
            kind: 'file',
            locator: 'src/extra.ts',
            contentDigest: digest(
              '5555555555555555555555555555555555555555555555555555555555555555'
            ),
            inputKind: 'source-file',
            scanProfileDigest: digest(
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ),
          },
        ] as GraphContentStateManifest['nodes'],
        merkleRoot
      ),
    });

    const result = compareContentStateManifests({
      base,
      target: replaceFile(target, 'src/index.ts', {
        contentDigest: digest('6666666666666666666666666666666666666666666666666666666666666666'),
      }),
      budget: { maxChangedInputs: 1 },
    });

    expect(result.status).toBe('partial');
    expect(result.changedInputs).toHaveLength(1);
    expect(result.truncation).toMatchObject({
      dimension: 'changed-inputs',
      limit: 1,
      reason: 'input-budget-exceeded',
    });
  });

  it('emits renewed when content and input kind match but scan-profile identity drifted', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const nextScan = digest('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    const leaf = {
      locator: 'src/index.ts',
      contentDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    };
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: nextScan,
      leaves: [{ ...leaf, scanProfileDigest: nextScan }],
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.status).toBe('complete');
    expect(result.changedInputs).toEqual([
      expect.objectContaining({
        kind: 'renewed',
        locator: 'src/index.ts',
        priorDigest: leaf.contentDigest,
        nextDigest: leaf.contentDigest,
      }),
    ]);
    expect(result.causes).toEqual([
      expect.objectContaining({ kind: 'scan-profile', source: 'content-state-comparison' }),
    ]);
  });

  it('treats input-kind drift as edited even when content digest is unchanged', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const leaf = {
      locator: 'src/index.ts',
      contentDigest: digest('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    };
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: scan,
      leaves: [{ ...leaf, inputKind: 'generated-file' }],
    });

    const result = compareContentStateManifests({ base, target });

    expect(result.changedInputs).toEqual([
      expect.objectContaining({ kind: 'edited', locator: 'src/index.ts' }),
    ]);
    expect(result.causes).toEqual([
      expect.objectContaining({ kind: 'content', source: 'content-state-comparison' }),
    ]);
  });

  it('enumerates files only under unequal Merkle branches', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const leaf = (
      locator: string,
      content: string
    ): {
      locator: string;
      contentDigest: ReturnType<typeof digest>;
      inputKind: string;
      scanProfileDigest: ReturnType<typeof digest>;
    } => ({
      locator,
      contentDigest: digest(content),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    });
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('src/index.ts', 'c'.repeat(64)), leaf('lib/util.ts', 'd'.repeat(64))],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('src/index.ts', 'e'.repeat(64)), leaf('lib/util.ts', 'd'.repeat(64))],
    });
    const result = compareContentStateManifests({ base, target });

    expect(result.status).toBe('complete');
    expect(result.skippedBranches).toBeGreaterThanOrEqual(1);
    expect(result.changedInputs).toEqual([
      expect.objectContaining({ kind: 'edited', locator: 'src/index.ts' }),
    ]);
  });

  it('treats equal sibling directory digests as skip authority even if a leaf was hand-edited', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const leaf = (
      locator: string,
      content: string
    ): {
      locator: string;
      contentDigest: ReturnType<typeof digest>;
      inputKind: string;
      scanProfileDigest: ReturnType<typeof digest>;
    } => ({
      locator,
      contentDigest: digest(content),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    });
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('src/index.ts', 'c'.repeat(64)), leaf('lib/util.ts', 'd'.repeat(64))],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('src/index.ts', 'e'.repeat(64)), leaf('lib/util.ts', 'd'.repeat(64))],
    });
    const corrupt = withManifest(target, {
      nodes: target.nodes.map((node) =>
        node.kind === 'file' && node.locator === 'lib/util.ts'
          ? { ...node, contentDigest: digest('f'.repeat(64)) }
          : node
      ),
    });
    const result = compareContentStateManifests({ base, target: corrupt });

    expect(result.changedInputs).toEqual([
      expect.objectContaining({ kind: 'edited', locator: 'src/index.ts' }),
    ]);
    expect(result.changedInputs.some((change) => change.locator === 'lib/util.ts')).toBe(false);
  });

  it('still promotes cross-directory identity matches to rename candidates', () => {
    const scan = digest('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const leaf = (
      locator: string,
      content: string
    ): {
      locator: string;
      contentDigest: ReturnType<typeof digest>;
      inputKind: string;
      scanProfileDigest: ReturnType<typeof digest>;
    } => ({
      locator,
      contentDigest: digest(content),
      inputKind: 'source-file',
      scanProfileDigest: scan,
    });
    const base = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:00:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('src/moved.ts', 'c'.repeat(64)), leaf('lib/stay.ts', 'd'.repeat(64))],
    });
    const target = buildContentStateManifest({
      scope: { kind: 'project', projectIds: ['project:fixture'] },
      generatedAt: '2026-09-09T20:01:00.000Z',
      scanProfileDigest: scan,
      leaves: [leaf('lib/moved.ts', 'c'.repeat(64)), leaf('lib/stay.ts', 'd'.repeat(64))],
    });
    const result = compareContentStateManifests({ base, target });

    expect(result.changedInputs).toEqual([
      expect.objectContaining({
        kind: 'rename-candidate',
        locator: 'lib/moved.ts',
        renameCandidate: {
          priorLocator: 'src/moved.ts',
          nextLocator: 'lib/moved.ts',
          confidence: 1,
        },
      }),
    ]);
  });
});
