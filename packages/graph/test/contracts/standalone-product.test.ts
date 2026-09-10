import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_CLI_EXIT_CODES,
  GRAPH_CLI_RESULT_CONTRACT,
  GRAPH_CLI_RESULT_SCHEMA_VERSION,
  GRAPH_PACKAGE_METADATA,
  GRAPH_PUBLIC_EXPORT_MAP,
  GRAPH_QUERY_CACHE_OPERATING_BOUNDARY,
  GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY,
  GRAPH_RELEASE_INVENTORY_CONTRACT,
  GRAPH_RETRIEVAL_BENCHMARK_CLAIM,
  GRAPH_SBOM_SPEC,
  GRAPH_STANDALONE_PACKED_JOBS,
  GRAPH_STANDALONE_SUPPORT_MATRIX,
  GRAPH_STANDALONE_SUPPORT_MATRIX_CONTRACT,
} from '../../src/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function compileSchema(name: string) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8')) as object;
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  }).compile(schema);
  return { schema, validate };
}

function namedValueExports(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:\{([^}]+)\}|(?:const|function|async function|class)\s+(\w+))/g
  )) {
    if (match[1]) {
      for (const part of match[1].split(',')) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith('type ')) continue;
        const name = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
    if (match[2]) names.add(match[2]);
  }
  return [...names].sort();
}

describe('G7 standalone product contracts', () => {
  it('admits the CLI result fixture and rejects the invalid envelope', () => {
    const { schema, validate } = compileSchema('cli-result.v0.1.0-candidate.schema.json');
    const valid = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g7/minimal-cli-result.json'), 'utf8')
    ) as { schemaVersion: string };
    const invalid = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/g7/invalid-cli-result.json'), 'utf8')
    ) as object;

    expect(
      (schema as { properties: { schemaVersion: { const: string } } }).properties.schemaVersion
        .const
    ).toBe(GRAPH_CLI_RESULT_SCHEMA_VERSION);
    expect(GRAPH_CLI_RESULT_CONTRACT).toEqual({
      id: 'workspai.graph.cli-result',
      version: '0.1.0-candidate',
    });
    expect(validate(valid), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(invalid)).toBe(false);
  });

  it('publishes the support matrix against its schema without claiming stability', () => {
    const { schema, validate } = compileSchema(
      'standalone-support-matrix.v0.1.0-candidate.schema.json'
    );
    expect(
      (schema as { properties: { contract: { const: unknown } } }).properties.contract.const
    ).toEqual(GRAPH_STANDALONE_SUPPORT_MATRIX_CONTRACT);
    expect(validate(GRAPH_STANDALONE_SUPPORT_MATRIX), JSON.stringify(validate.errors)).toBe(true);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.standaloneStable).toBe(false);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.publicPreview).toBe(false);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.centralCliRuntime).toBe('prohibited');
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.nativeAcceleration).toBe('prohibited');
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.externalProviderSdk).toEqual({
      status: 'deferred',
      until: 'standalone-stable',
    });
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.publicPreviewMigrations).toEqual([]);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.queryCache).toEqual(
      GRAPH_QUERY_CACHE_OPERATING_BOUNDARY
    );
    expect([...GRAPH_PACKAGE_METADATA.plannedCapabilities]).toEqual([
      ...GRAPH_STANDALONE_SUPPORT_MATRIX.plannedCapabilities,
    ]);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.limitations).toEqual(
      expect.arrayContaining([
        'signed-provenance-unattested',
        'rollback-procedure-not-proven',
        'retrieval-benchmark-is-synthetic-fixture-labelled',
      ])
    );
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.limitations).not.toContain(
      'sbom-and-provenance-pending'
    );
    expect(GRAPH_SBOM_SPEC.provenance).toBe('unattested');
    expect(GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY).toEqual({
      sourceMaps: 'excluded',
      governance: 'excluded',
      machineLocalPaths: 'rejected',
      secrets: 'rejected',
      catalogDigest: 'required',
      signedAttestation: 'not-generated',
      rollbackProcedure: 'not-proven',
    });
    expect(GRAPH_RELEASE_INVENTORY_CONTRACT).toEqual({
      id: 'workspai.graph.release-inventory',
      version: '0.1.0-candidate',
    });
    expect(GRAPH_RETRIEVAL_BENCHMARK_CLAIM.publicAccuracyClaimPermitted).toBe(false);
  });

  it('locks the public export map to package.json and the root entrypoint', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const rootApi = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    const exported = namedValueExports(rootApi);

    expect(Object.keys(manifest.exports).sort()).toEqual(
      [...GRAPH_PUBLIC_EXPORT_MAP.subpaths].sort()
    );
    expect(exported).toEqual([...GRAPH_PUBLIC_EXPORT_MAP.rootValueExports].sort());
    for (const forbidden of GRAPH_PUBLIC_EXPORT_MAP.rootForbiddenValueExports) {
      expect(exported).not.toContain(forbidden);
      expect(rootApi).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it('keeps packed standalone jobs aligned with the pack checker and exit contract', () => {
    const packChecker = fs
      .readFileSync(path.join(root, 'scripts/check-packed-package.mjs'), 'utf8')
      .replace(/\s+/g, ' ');
    expect(GRAPH_CLI_EXIT_CODES).toMatchObject({
      success: 0,
      partial: 2,
      failed: 1,
      rejected: 3,
      publicationFailed: 4,
      cancelled: 130,
    });
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.packedJobs).toEqual(
      GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id)
    );
    expect(packChecker).toMatch(/GRAPH_STANDALONE_PACKED_JOBS/);
    expect(packChecker).toMatch(/GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY/);
    expect(GRAPH_QUERY_CACHE_OPERATING_BOUNDARY.resultEnvelopeCacheField).toBe('prohibited');
    expect(GRAPH_QUERY_CACHE_OPERATING_BOUNDARY.defaultStore).toBe('none');
  });
});
