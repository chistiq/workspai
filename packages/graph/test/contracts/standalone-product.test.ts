import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_CLI_COMMANDS,
  GRAPH_CLI_EXIT_CODES,
  GRAPH_CLI_RESULT_CONTRACT,
  GRAPH_CLI_RESULT_SCHEMA_VERSION,
  GRAPH_INCIDENT_CLASSES,
  GRAPH_PACKAGE_METADATA,
  GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY,
  GRAPH_PUBLIC_EXPORT_MAP,
  GRAPH_QUERY_CACHE_OPERATING_BOUNDARY,
  GRAPH_QUERY_PRESETS,
  GRAPH_RELEASE_INVENTORY_CONTRACT,
  GRAPH_RETRIEVAL_BENCHMARK_CLAIM,
  GRAPH_ROLLBACK_PROCEDURE,
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
      maxCompressedBytes: 294_912,
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
    expect(GRAPH_ROLLBACK_PROCEDURE).toEqual({
      status: 'not-proven',
      restores: 'last-supported-package-and-graph-generation',
      sourceRewrite: 'prohibited',
    });
    expect([...GRAPH_INCIDENT_CLASSES]).toEqual([
      'compromised-provider-or-package',
      'contract-or-identity-regression',
      'corrupted-cache-or-artifact-generation',
      'false-authoritative-edge-or-missing-conflict',
      'secret-or-path-leakage',
      'performance-amplification',
      'cli-package-incompatibility',
    ]);
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
    const packedJobIds = GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.packedJobs).toEqual(packedJobIds);
    expect(packedJobIds[0]).toBe('help');
    expect(packedJobIds.at(-1)).toBe('inspect-write');
    expect(packedJobIds).toEqual(
      expect.arrayContaining([
        'inspect-project-only',
        'inspect-source-view',
        'inspect-workspace-without-onboarding',
        'inspect-existing-workspace-without-selection',
        'inspect-existing-workspace-write-without-selection',
        'query-dependencies',
        'query-owners',
        'query-impact',
        'query-contract-topology',
        'query-architecture-conformance',
        'query-operational-risk',
        'query-dependencies-without-subject',
        'query-unknown-preset',
        'query-without-preset',
        'query-slice-without-review-context',
        'quality-write-rejected',
        'providers-inspect-unknown',
      ])
    );
    expect(packedJobIds.indexOf('inspect-existing-workspace-write-without-selection')).toBeLessThan(
      packedJobIds.indexOf('inspect-write')
    );
    expect(packedJobIds.indexOf('inspect-existing-workspace-without-selection')).toBeLessThan(
      packedJobIds.indexOf('inspect-write')
    );
    expect(
      GRAPH_STANDALONE_PACKED_JOBS.filter(
        (job) => 'requiresSubject' in job && job.requiresSubject
      ).map((job) => job.id)
    ).toEqual(['query-operational-risk', 'query-dependencies', 'query-owners', 'query-impact']);
    expect(
      GRAPH_STANDALONE_PACKED_JOBS.filter(
        (job) => 'requiresTarget' in job && job.requiresTarget
      ).map((job) => job.id)
    ).toEqual(['query-impact']);
    expect(
      GRAPH_STANDALONE_PACKED_JOBS.filter((job) => 'output' in job && job.output === 'help').map(
        (job) => job.id
      )
    ).toEqual(['help']);
    for (const command of GRAPH_CLI_COMMANDS) {
      expect(
        GRAPH_STANDALONE_PACKED_JOBS.some((job) =>
          (job.args as readonly string[]).includes(command)
        ),
        `packed jobs omit CLI command ${command}`
      ).toBe(true);
    }
    for (const preset of Object.keys(GRAPH_QUERY_PRESETS)) {
      expect(
        GRAPH_STANDALONE_PACKED_JOBS.some((job) =>
          (job.args as readonly string[]).includes(preset)
        ),
        `packed jobs omit query preset ${preset}`
      ).toBe(true);
    }
    expect(packedJobIds.indexOf('inspect-workspace-without-onboarding')).toBeLessThan(
      packedJobIds.indexOf('inspect-write')
    );
    expect(packChecker).toMatch(/GRAPH_STANDALONE_PACKED_JOBS/);
    expect(packChecker).toMatch(/GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY/);
    expect(packChecker).toMatch(/fixtures\/g4\/structural-extractor-profile\.json/);
    expect(packChecker).toMatch(/GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE/);
    expect(GRAPH_QUERY_CACHE_OPERATING_BOUNDARY.resultEnvelopeCacheField).toBe('prohibited');
    expect(GRAPH_QUERY_CACHE_OPERATING_BOUNDARY.defaultStore).toBe('none');
  });
});
