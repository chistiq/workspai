import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GRAPH_SBOM_SPEC } from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Graph G7 SBOM candidate', () => {
  it('emits an unattested CycloneDX snapshot without machine-local paths', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-graph-sbom.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'workspai-graph-g7-sbom-audit.v1',
      bomFormat: GRAPH_SBOM_SPEC.bomFormat,
      specVersion: GRAPH_SBOM_SPEC.specVersion,
      provenance: GRAPH_SBOM_SPEC.provenance,
      failures: [],
    });
    const bom = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'governance/g7-sbom.cdx.json'), 'utf8')
    ) as {
      components: { name: string; scope: string }[];
      dependencies: { ref: string; dependsOn: string[] }[];
      metadata: { properties: { name: string; value: string }[] };
    };
    expect(JSON.stringify(bom)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    expect(bom.metadata.properties).toEqual(
      expect.arrayContaining([
        { name: 'workspai:provenance', value: 'unattested' },
        { name: 'workspai:slsa', value: 'not-generated' },
      ])
    );
    expect(bom.components.some((item) => item.name === '@workspai/graph')).toBe(true);
    expect(bom.components.some((item) => item.name === '@workspai/shared')).toBe(true);
    expect(bom.components.some((item) => item.name === 'yaml')).toBe(true);
    expect(
      bom.dependencies.find((item) => item.ref.includes('%40workspai/graph@'))?.dependsOn
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('%40workspai/shared@'),
        expect.stringContaining('yaml@2.9.0'),
      ])
    );
    expect(
      bom.components.every((item) => item.scope === 'required' || item.scope === 'excluded')
    ).toBe(true);
  });
});
