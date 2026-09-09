import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compareContentStateManifests } from '../../src/application/compare-content-state-manifest.js';
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

function replaceFile(
  manifest: GraphContentStateManifest,
  locator: string,
  next: Partial<GraphContentStateLeaf>
): GraphContentStateManifest {
  const nodes = manifest.nodes.map((node) =>
    node.kind === 'file' && node.locator === locator ? { ...node, ...next } : node
  );
  return withManifest(manifest, {
    nodes,
    merkleRoot: next.contentDigest
      ? digest('1111111111111111111111111111111111111111111111111111111111111111')
      : manifest.merkleRoot,
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
    const target = withManifest(base, {
      merkleRoot: digest('2222222222222222222222222222222222222222222222222222222222222222'),
      nodes: [
        ...base.nodes.filter((node) => node.kind !== 'file' || node.locator !== 'src/index.ts'),
        {
          kind: 'file',
          locator: 'src/new.ts',
          contentDigest: digest('abababababababababababababababababababababababababababababababab'),
          inputKind: 'source-file',
          scanProfileDigest: digest(
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          ),
        },
      ] as GraphContentStateManifest['nodes'],
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
    const target = withManifest(base, {
      merkleRoot: digest('3333333333333333333333333333333333333333333333333333333333333333'),
      nodes: base.nodes.map((node) =>
        node.kind === 'file' && node.locator === 'src/index.ts'
          ? { ...node, locator: 'src/renamed.ts' }
          : node
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
    const target = withManifest(base, {
      merkleRoot: digest('4444444444444444444444444444444444444444444444444444444444444444'),
      nodes: [
        ...base.nodes,
        {
          kind: 'file',
          locator: 'src/extra.ts',
          contentDigest: digest('5555555555555555555555555555555555555555555555555555555555555555'),
          inputKind: 'source-file',
          scanProfileDigest: digest(
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          ),
        },
      ] as GraphContentStateManifest['nodes'],
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
});
