import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY,
  GRAPH_PUBLIC_EXPORT_MAP,
  GRAPH_RELEASE_INVENTORY_CONTRACT,
  GRAPH_STANDALONE_PACKED_JOBS,
} from '../../src/contracts/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Graph G7 release inventory', () => {
  it('locks the public export map and schema catalog without claiming attestation', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-g7-release-inventory.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'workspai-graph-g7-release-inventory-audit.v1',
      provenance: 'unattested',
      failures: [],
    });

    const inventory = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'governance/g7-release-inventory.v1.json'), 'utf8')
    ) as {
      contract: { id: string; version: string };
      publishable: boolean;
      standaloneStable: boolean;
      signedAttestation: string;
      rollbackProcedure: string;
      publicInternalDocuments: number;
      exports: {
        subpaths: string[];
        rootValueExports: string[];
        rootForbiddenValueExports: string[];
      };
      packedJobs: string[];
      schemas: { file: string; sha256: string }[];
      packedArtifactSecurity: typeof GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY;
    };

    expect(inventory.contract).toEqual(GRAPH_RELEASE_INVENTORY_CONTRACT);
    expect(inventory.publishable).toBe(false);
    expect(inventory.standaloneStable).toBe(false);
    expect(inventory.signedAttestation).toBe('not-generated');
    expect(inventory.rollbackProcedure).toBe('not-proven');
    expect(inventory.publicInternalDocuments).toBe(0);
    expect(inventory.exports.subpaths).toEqual([...GRAPH_PUBLIC_EXPORT_MAP.subpaths]);
    expect(inventory.exports.rootValueExports).toEqual([
      ...GRAPH_PUBLIC_EXPORT_MAP.rootValueExports,
    ]);
    expect(inventory.exports.rootForbiddenValueExports).toEqual([
      ...GRAPH_PUBLIC_EXPORT_MAP.rootForbiddenValueExports,
    ]);
    expect(inventory.packedJobs).toEqual(GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id));
    expect(inventory.packedArtifactSecurity).toEqual(GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY);
    expect(inventory.schemas.length).toBeGreaterThan(0);
    expect(JSON.stringify(inventory)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
  });
});
