import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
} from '../../src/contracts/index.js';
import { buildShardDependenciesFromSources } from '../../src/application/build-shard-dependencies.js';
import type { GraphCompositionSource } from '../../src/application/composition-types.js';

const digest = { algorithm: 'sha256' as const, value: 'c'.repeat(64) };
const manifest = {
  contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
  id: 'workspai.graph.provider.ecmascript-imports',
  version: '1',
  displayName: 'ECMAScript imports',
  determinism: 'deterministic' as const,
  capabilities: {
    entityKinds: ['module'],
    relationKinds: ['imports'],
    relationSemantics: ['structural'] as const,
    factFamilies: ['imports'],
    allowedClaims: ['observed'],
  },
  permissions: {
    filesystem: 'read' as const,
    network: 'deny' as const,
    process: 'deny' as const,
    credentials: 'deny' as const,
  },
  limits: { maxDurationMs: 1_000, maxFacts: 100, maxInputBytes: 1_024 },
  contractVersions: ['0.1.0-candidate'],
  supportedInputs: ['source-file'],
  incremental: 'input' as const,
  identitySchemes: [{ id: GRAPH_IDENTITY_SCHEME.id, version: GRAPH_IDENTITY_SCHEME.version }],
};

describe('buildShardDependenciesFromSources', () => {
  it('maps admitted processing records into portable shard dependencies', () => {
    const source: GraphCompositionSource = {
      manifest,
      batch: {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: 'batch:fixture',
        scope: { kind: 'project', projectIds: ['project:fixture'] },
        inputs: [{ locator: 'src/index.ts', digest }],
        facts: [],
        diagnostics: [],
        coverage: [],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'complete',
        processing: [
          {
            input: { locator: 'src/index.ts', digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'ecmascript-static-imports', version: manifest.version },
            outcome: 'processed',
            outputDigest: digest,
            diagnostics: [],
          },
        ],
      },
    };
    const shards = buildShardDependenciesFromSources([source]);
    expect(shards).toHaveLength(1);
    expect(shards[0]).toMatchObject({
      shardId: 'shard:ecmascript-static-imports:src/index.ts',
      providerStages: ['workspai.graph.provider.ecmascript-imports'],
      graphRegions: ['imports'],
    });
  });

  it('falls back to provider fact families for unknown provider metadata', () => {
    const unknownManifest = {
      ...manifest,
      id: 'workspai.graph.provider.unknown',
      capabilities: {
        ...manifest.capabilities,
        factFamilies: ['custom.family'],
      },
    };
    const shards = buildShardDependenciesFromSources([
      {
        manifest: unknownManifest,
        batch: {
          contract: GRAPH_FACT_BATCH_CONTRACT,
          provider: { id: unknownManifest.id, version: unknownManifest.version },
          batchId: 'batch:unknown',
          scope: { kind: 'project', projectIds: ['project:fixture'] },
          inputs: [{ locator: 'src/index.ts', digest }],
          facts: [],
          diagnostics: [],
          coverage: [],
          unknownZones: [],
          unsupportedZones: [],
          redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
          status: 'complete',
          processing: [
            {
              input: { locator: 'src/index.ts', digest },
              provider: { id: unknownManifest.id, version: unknownManifest.version },
              stage: { id: 'unknown-stage', version: unknownManifest.version },
              outcome: 'processed',
              priorDigest: digest,
              diagnostics: [],
            },
          ],
        },
      },
    ]);
    expect(shards[0]?.graphRegions).toEqual(['custom.family']);
    expect(shards[0]?.semanticDependencies).toEqual([digest]);
  });
});
