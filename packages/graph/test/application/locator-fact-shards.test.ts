import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
} from '../../src/contracts/index.js';
import {
  GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
  appendReusedLocatorFacts,
  compositionSourcesAreIdenticalFacts,
  createLocatorFactShardStore,
  expandCallEnvironmentLocators,
  locatorCallEnvironmentDigest,
  lookupLocatorFactShard,
  internedCompositionNode,
  rememberInternedCompositionNode,
  rememberLocatorFactShard,
  lastCompositionPreparation,
  lastSessionCompositionAnchor,
  rememberSessionCompositionAnchor,
  runWithLocatorFactShardStore,
  setLocatorFactShardMembership,
  stageSessionCompositionPreparation,
  stagedCompositionLineageDigest,
} from '../../src/application/locator-fact-shards.js';
import type {
  GraphCompositionReceipt,
  GraphCompositionSource,
  GraphReferenceCompositionTaskOutput,
} from '../../src/application/composition-types.js';
import type { GraphSessionCompositionAnchor } from '../../src/application/locator-fact-shards.js';
import type { GraphWorkspaceFact } from '../../src/contracts/index.js';

function fact(id: string, locator: string): GraphWorkspaceFact {
  return {
    factId: id,
    factType: 'source.file',
    subject: {
      id: `entity:workspai:file:${locator}`,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope: { kind: 'project', projectIds: ['p'] },
    },
    predicate: 'contains',
    object: {
      id: `entity:workspai:file:${locator}:obj`,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope: { kind: 'project', projectIds: ['p'] },
    },
    scope: { kind: 'project', projectIds: ['p'] },
    evidence: [
      {
        id: `evidence:${id}`,
        sourceKind: 'source-file',
        relativeLocator: locator,
        digest: { algorithm: 'sha256', value: 'a'.repeat(64) },
      },
    ],
    provenance: { id: 'workspai.graph.provider.fixture', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change'] },
    observedAt: '2026-09-21T00:00:00.000Z',
    inputDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    unknownZones: [],
  };
}

function source(id: string, facts: readonly GraphWorkspaceFact[]): GraphCompositionSource {
  return {
    manifest: {
      contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
      id,
      version: '1',
      displayName: id,
      determinism: 'deterministic',
      capabilities: {
        entityKinds: ['file'],
        relationKinds: ['contains'],
        relationSemantics: ['structural'],
        factFamilies: ['source.file'],
        allowedClaims: ['observed'],
      },
      permissions: {
        filesystem: 'read',
        network: 'deny',
        process: 'deny',
        credentials: 'deny',
      },
      limits: { maxDurationMs: 1_000, maxFacts: 10, maxInputBytes: 1_024 },
      contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
      supportedInputs: ['fixture'],
      incremental: 'input',
      identitySchemes: [GRAPH_IDENTITY_SCHEME],
    },
    batch: {
      contract: GRAPH_FACT_BATCH_CONTRACT,
      provider: { id, version: '1' },
      batchId: `batch:${id}`,
      scope: { kind: 'project', projectIds: ['p'] },
      inputs: [{ locator: 'a.ts', digest: { algorithm: 'sha256', value: 'a'.repeat(64) } }],
      facts: [...facts],
      diagnostics: [],
      coverage: [],
      unknownZones: [],
      unsupportedZones: [],
      redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
      status: 'complete',
      processing: [
        {
          input: { locator: 'a.ts', digest: { algorithm: 'sha256', value: 'a'.repeat(64) } },
          provider: { id, version: '1' },
          stage: { id: 'fixture', version: '1' },
          outcome: 'processed',
          outputDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
          diagnostics: [],
        },
      ],
    },
  };
}

describe('locator fact shards', () => {
  it('restores partition ownership only inside the active membership and session', () => {
    const store = createLocatorFactShardStore();
    const first = fact('fact:1', 'a.ts');
    runWithLocatorFactShardStore(store, () => {
      setLocatorFactShardMembership(['a.ts']);
      rememberLocatorFactShard({
        schema: GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
        providerId: 'workspai.graph.provider.fixture',
        providerVersion: '1',
        locator: 'a.ts',
        inputDigest: 'a'.repeat(64),
        inputIndex: 0,
        facts: [first],
        observationOrigins: [['fact:1', 'build-clock']],
        unknownZones: [],
        processing: source('workspai.graph.provider.fixture', [first]).batch.processing[0]!,
        callEnvironmentDigest: '',
      });
      const facts: GraphWorkspaceFact[] = [];
      const processing: import('../../src/contracts/index.js').GraphFactBatch['processing'][number][] =
        [];
      const unknownZones: import('../../src/contracts/index.js').GraphUnknownZone[] = [];
      expect(
        appendReusedLocatorFacts(
          {
            providerId: 'workspai.graph.provider.fixture',
            locator: 'a.ts',
            inputDigest: 'a'.repeat(64),
            inputIndex: 0,
          },
          '',
          facts,
          processing as never,
          unknownZones
        )
      ).toBe(true);
      expect(facts[0]).not.toBe(first);
      expect(facts[0]).toMatchObject({
        factId: first.factId,
        partitionOwner: { locator: 'a.ts', observationOrigin: 'build-clock' },
      });
      setLocatorFactShardMembership(['a.ts', 'b.ts']);
      expect(
        lookupLocatorFactShard({
          providerId: 'workspai.graph.provider.fixture',
          locator: 'a.ts',
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
        })
      ).toBeUndefined();
    });
    store.dispose();
    expect(
      runWithLocatorFactShardStore(store, () =>
        lookupLocatorFactShard({
          providerId: 'workspai.graph.provider.fixture',
          locator: 'a.ts',
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
        })
      )
    ).toBeUndefined();
  });

  it('treats composition sources as identical only when fact objects alias', () => {
    const shared = fact('fact:1', 'a.ts');
    const left = [source('provider.one', [shared])];
    const right = [source('provider.one', [shared])];
    const copy = [source('provider.one', [{ ...shared }])];
    expect(compositionSourcesAreIdenticalFacts(left, right)).toBe(true);
    expect(compositionSourcesAreIdenticalFacts(left, copy)).toBe(false);
  });

  it('drops interned composition nodes when inventory membership changes', () => {
    const store = createLocatorFactShardStore();
    const node = {
      id: 'entity:workspai:file:sha256:ab',
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope: { kind: 'project' as const, projectIds: ['p'] as [string] },
    };
    runWithLocatorFactShardStore(store, () => {
      setLocatorFactShardMembership(['a.ts']);
      rememberInternedCompositionNode('file\0a.ts', node);
      expect(internedCompositionNode('file\0a.ts')).toBe(node);
      setLocatorFactShardMembership(['a.ts', 'b.ts']);
      expect(internedCompositionNode('file\0a.ts')).toBeUndefined();
    });
    store.dispose();
  });

  it('drops shards and anchors when the extraction-environment boundary changes', () => {
    const store = createLocatorFactShardStore();
    const first = fact('fact:1', 'a.ts');
    runWithLocatorFactShardStore(store, () => {
      store.setExtractionEnvironment('env-a');
      setLocatorFactShardMembership(['a.ts']);
      rememberLocatorFactShard({
        schema: GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
        providerId: 'workspai.graph.provider.fixture',
        providerVersion: '1',
        locator: 'a.ts',
        inputDigest: 'a'.repeat(64),
        inputIndex: 0,
        facts: [first],
        observationOrigins: [['fact:1', 'build-clock']],
        unknownZones: [],
        processing: source('workspai.graph.provider.fixture', [first]).batch.processing[0]!,
        callEnvironmentDigest: '',
      });
      rememberInternedCompositionNode('file\0a.ts', {
        id: 'entity:workspai:file:sha256:ab',
        identityScheme: GRAPH_IDENTITY_SCHEME,
        kind: 'file',
        scope: { kind: 'project', projectIds: ['p'] },
      });
      expect(
        lookupLocatorFactShard({
          providerId: 'workspai.graph.provider.fixture',
          locator: 'a.ts',
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
        })
      ).toBeDefined();
      store.setExtractionEnvironment('env-b');
      expect(
        lookupLocatorFactShard({
          providerId: 'workspai.graph.provider.fixture',
          locator: 'a.ts',
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
        })
      ).toBeUndefined();
      expect(internedCompositionNode('file\0a.ts')).toBeUndefined();
      expect(lastSessionCompositionAnchor()).toBeUndefined();
    });
    store.dispose();
  });

  it('does not retain historical memberships across create/delete churn', () => {
    const store = createLocatorFactShardStore();
    runWithLocatorFactShardStore(store, () => {
      store.setExtractionEnvironment('env-stable');
      for (let cycle = 0; cycle < 40; cycle += 1) {
        setLocatorFactShardMembership(['keep.ts', `tmp-${cycle}.ts`]);
        rememberLocatorFactShard({
          schema: GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
          providerId: 'workspai.graph.provider.fixture',
          providerVersion: '1',
          locator: `tmp-${cycle}.ts`,
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
          facts: [fact(`fact:${cycle}`, `tmp-${cycle}.ts`)],
          observationOrigins: [[`fact:${cycle}`, 'build-clock']],
          unknownZones: [],
          processing: source('workspai.graph.provider.fixture', [
            fact(`fact:${cycle}`, `tmp-${cycle}.ts`),
          ]).batch.processing[0]!,
          callEnvironmentDigest: '',
        });
        setLocatorFactShardMembership(['keep.ts']);
      }
      expect(store.stats().entries).toBeLessThanOrEqual(1);
      expect(
        lookupLocatorFactShard({
          providerId: 'workspai.graph.provider.fixture',
          locator: 'tmp-0.ts',
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
        })
      ).toBeUndefined();
    });
    store.dispose();
    expect(store.stats().entries).toBe(0);
  });

  it('evicts deterministically when the shard budget is reached', () => {
    const store = createLocatorFactShardStore({ maxEntries: 2, maxFacts: 8, maxBytes: 64 * 1024 });
    runWithLocatorFactShardStore(store, () => {
      store.setExtractionEnvironment('env-budget');
      setLocatorFactShardMembership(['a.ts', 'b.ts', 'c.ts']);
      for (const locator of ['a.ts', 'b.ts', 'c.ts'] as const) {
        rememberLocatorFactShard({
          schema: GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
          providerId: 'workspai.graph.provider.fixture',
          providerVersion: '1',
          locator,
          inputDigest: 'a'.repeat(64),
          inputIndex: 0,
          facts: [fact(`fact:${locator}`, locator)],
          observationOrigins: [[`fact:${locator}`, 'build-clock']],
          unknownZones: [],
          processing: source('workspai.graph.provider.fixture', [fact(`fact:${locator}`, locator)])
            .batch.processing[0]!,
          callEnvironmentDigest: '',
        });
      }
      expect(store.stats().entries).toBeLessThanOrEqual(2);
      expect(store.stats().evictions).toBeGreaterThanOrEqual(1);
    });
    store.dispose();
  });

  it('includes transitive re-export locators in the call-environment digest', () => {
    const signatures = new Map([
      ['src/lib.ts', 'loadItem:function'],
      ['src/barrel.ts', 'loadItem=loadItem'],
      ['src/other.ts', 'unrelated:function'],
    ]);
    const reexports = new Map([['src/barrel.ts', Object.freeze([{ locator: 'src/lib.ts' }])]]);
    expect(expandCallEnvironmentLocators(['src/barrel.ts'], reexports)).toEqual([
      'src/barrel.ts',
      'src/lib.ts',
    ]);
    const withLib = locatorCallEnvironmentDigest(['src/barrel.ts'], signatures, reexports);
    const withoutLib = locatorCallEnvironmentDigest(
      ['src/barrel.ts'],
      new Map([
        ['src/lib.ts', 'other:function'],
        ['src/barrel.ts', 'loadItem=loadItem'],
      ]),
      reexports
    );
    expect(withLib).not.toBe(withoutLib);
    expect(withLib).toContain('src/lib.ts');
  });

  it('publishes preparation only with the matching anchor after a successful compose', () => {
    const store = createLocatorFactShardStore();
    const prepared = { id: 'prepared-a' } as unknown as GraphReferenceCompositionTaskOutput;
    const replacement = { id: 'prepared-b' } as unknown as GraphReferenceCompositionTaskOutput;
    const anchor = compositionAnchor('fact-a');
    runWithLocatorFactShardStore(store, () => {
      stageSessionCompositionPreparation({
        prepared,
        factSetDigest: anchor.receipt.factSetDigest,
        proofPolicyDigest: anchor.receipt.proofPolicySetDigest,
        lineageDigest: anchor.lineageDigest,
      });
      expect(lastCompositionPreparation()).toBeUndefined();
      expect(lastSessionCompositionAnchor()).toBeUndefined();
      expect(stagedCompositionLineageDigest()).toBe(anchor.lineageDigest);

      rememberSessionCompositionAnchor(anchor);
      expect(lastCompositionPreparation()).toBe(prepared);
      expect(lastSessionCompositionAnchor()?.receipt.factSetDigest.value).toBe('fact-a');
      expect(lastSessionCompositionAnchor()?.lineageDigest).toBe(anchor.lineageDigest);

      stageSessionCompositionPreparation({
        prepared: replacement,
        factSetDigest: { algorithm: 'sha256', value: 'fact-b' },
        proofPolicyDigest: anchor.receipt.proofPolicySetDigest,
        lineageDigest: 'lineage-b',
      });
      expect(lastCompositionPreparation()).toBe(prepared);
      expect(lastSessionCompositionAnchor()?.lineageDigest).toBe(anchor.lineageDigest);

      rememberSessionCompositionAnchor({
        ...anchor,
        receipt: receiptFor('fact-b'),
        lineageDigest: 'lineage-b',
      });
      expect(lastCompositionPreparation()).toBe(replacement);
      expect(lastSessionCompositionAnchor()?.receipt.factSetDigest.value).toBe('fact-b');
    });
    store.dispose();
  });

  it('drops a staged preparation when composition does not publish', () => {
    const store = createLocatorFactShardStore();
    const prepared = { id: 'prepared-a' } as unknown as GraphReferenceCompositionTaskOutput;
    const stranded = { id: 'prepared-failed' } as unknown as GraphReferenceCompositionTaskOutput;
    const anchor = compositionAnchor('fact-a');
    runWithLocatorFactShardStore(store, () => {
      stageSessionCompositionPreparation({
        prepared,
        factSetDigest: anchor.receipt.factSetDigest,
        proofPolicyDigest: anchor.receipt.proofPolicySetDigest,
        lineageDigest: anchor.lineageDigest,
      });
      rememberSessionCompositionAnchor(anchor);

      stageSessionCompositionPreparation({
        prepared: stranded,
        factSetDigest: { algorithm: 'sha256', value: 'fact-failed' },
        proofPolicyDigest: anchor.receipt.proofPolicySetDigest,
        lineageDigest: 'lineage-failed',
      });
      expect(lastCompositionPreparation()).toBe(prepared);
      expect(lastSessionCompositionAnchor()?.receipt.factSetDigest.value).toBe('fact-a');

      rememberSessionCompositionAnchor({
        ...anchor,
        receipt: receiptFor('fact-other'),
        lineageDigest: '',
      });
      expect(lastCompositionPreparation()).toBeUndefined();
      expect(lastSessionCompositionAnchor()?.receipt.factSetDigest.value).toBe('fact-other');
      expect(lastSessionCompositionAnchor()?.lineageDigest).toBe('');
    });
    store.dispose();
  });
});

function receiptFor(factDigest: string): GraphCompositionReceipt {
  return {
    factSetDigest: { algorithm: 'sha256', value: factDigest },
    proofPolicySetDigest: { algorithm: 'sha256', value: 'policy' },
  } as GraphCompositionReceipt;
}

function compositionAnchor(factDigest: string): GraphSessionCompositionAnchor {
  return {
    sources: [],
    graph: { edges: [] },
    quality: {},
    receipt: receiptFor(factDigest),
    extractionEnvironmentDigest: 'env-a',
    lineageDigest: 'lineage-a',
    incomplete: false,
  } as unknown as GraphSessionCompositionAnchor;
}
