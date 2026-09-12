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
      bomFormat: string;
      specVersion: string;
      serialNumber: string;
      components: {
        name: string;
        scope: string;
        hashes?: { alg: string; content: string }[];
        properties?: { name: string; value: string }[];
      }[];
      dependencies: { ref: string; dependsOn: string[] }[];
      metadata: { properties: { name: string; value: string }[] };
    };
    expect(bom).toMatchObject({
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: expect.stringMatching(
        /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      ),
    });
    // actions/attest detects CycloneDX only when all three fields are present.
    expect(Boolean(bom.bomFormat && bom.serialNumber && bom.specVersion)).toBe(true);
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
    const rustEngine = bom.components.find((item) => item.name === 'workspai-graph-engine');
    expect(rustEngine?.hashes).toEqual([
      { alg: 'SHA-256', content: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(rustEngine?.properties).toEqual(
      expect.arrayContaining([
        { name: 'workspai:maxNodes', value: '1000000' },
        { name: 'workspai:maxEdges', value: '5000000' },
        { name: 'workspai:maxMemoryBytes', value: '268435456' },
        { name: 'workspai:userToolchain', value: 'not-required' },
        { name: 'workspai:hashSubject', value: 'canonical-source-and-build-policy' },
        { name: 'workspai:artifactDigestPolicy', value: 'bound-in-build-evidence' },
      ])
    );
    expect(
      bom.dependencies.find((item) => item.ref.includes('%40workspai/graph@'))?.dependsOn
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('%40workspai/shared@'),
        expect.stringContaining('yaml@2.9.0'),
        'pkg:cargo/workspai-graph-engine@0.0.0',
      ])
    );
    expect(
      bom.components.every((item) => item.scope === 'required' || item.scope === 'excluded')
    ).toBe(true);
  });
});
