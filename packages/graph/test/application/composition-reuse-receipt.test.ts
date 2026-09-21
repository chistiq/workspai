import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphOntologyProfile,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../../src/contracts/index.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  GRAPH_COMPOSITION_ORDERING_RULES,
  buildRepoGraph,
  executeGraphReferenceCompositionTask,
} from '../../src/application/index.js';
import type {
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import { markGraphFactAdmitted } from '../../src/domain/admitted-graph-facts.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:receipt'] as [string] };
const input: GraphProviderInput = {
  locator: 'src/index.ts',
  mediaType: 'text/typescript',
  byteLength: 21,
  digest,
};
const ontology: GraphOntologyProfile = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.receipt-reuse',
  version: '1',
  entities: [
    { kind: 'repository', family: 'system' },
    { kind: 'file', family: 'source' },
  ],
  relations: [
    {
      kind: 'contains',
      semantics: 'structural',
      subjectFamilies: ['system'],
      objectFamilies: ['source'],
      symmetric: false,
      transitive: false,
      allowedAuthorities: ['observed'],
      proofPolicy: { id: 'workspai.graph.proof.standard', version: '1' },
    },
  ],
};

function ports(): GraphProductHostPorts {
  return {
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (value) => createHash('sha256').update(value).digest('hex'),
      digestSync: (value) => createHash('sha256').update(value).digest('hex'),
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
        };
      },
    },
    fileSource: {
      inventory: async () => ({
        status: 'complete',
        inputs: [input],
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        unknownZones: [],
        unsupportedZones: [],
      }),
      read: async () => new TextEncoder().encode('export const ok = 1;'),
    },
  };
}

function liveFact(confidence = 1, evidenceId = 'evidence:fixture-file'): GraphWorkspaceFact {
  return {
    factId: 'fact:fixture-file',
    factType: 'source.file',
    subject: {
      id: 'entity:fixture:repository:root',
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'repository',
      scope,
    },
    predicate: 'contains',
    object: {
      id: 'entity:fixture:file:src-index-ts',
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope,
    },
    scope,
    evidence: [
      {
        id: evidenceId,
        sourceKind: 'source-file',
        relativeLocator: input.locator,
        digest: input.digest,
      },
    ],
    provenance: { id: 'workspai.graph.provider.fixture-files', version: '1' },
    derivation: 'observed',
    authority: 'observed',
    confidence,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
    observedAt: '2026-09-09T12:00:00.000Z',
    inputDigest: input.digest,
    unknownZones: [],
  };
}

function provider(fact: GraphWorkspaceFact): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: 'workspai.graph.provider.fixture-files',
    version: '1',
    displayName: 'Fixture files',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'file'],
      relationKinds: ['contains'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.file'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 1_000, maxFacts: 100, maxInputBytes: 1_024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['repository-files'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };
  return {
    manifest,
    detect: () => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: 'applicable',
      matchedInputs: ['repository-files'],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: () => {
      const factBatch: GraphFactBatch = {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: 'batch:fixture-files',
        scope,
        inputs: [{ locator: input.locator, digest: input.digest }],
        facts: [fact],
        diagnostics: [],
        coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'complete',
        processing: [
          {
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'extract', version: '1' },
            outcome: 'processed',
            outputDigest: input.digest,
            diagnostics: [],
          },
        ],
      };
      return factBatch;
    },
  };
}

function request(runtime: GraphProviderRuntime, host = ports()) {
  return {
    root: '/repository',
    scope,
    ontology,
    providers: [runtime],
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: host,
  };
}

describe('composition receipt reuse', () => {
  it('reuses a graph only when the semantic receipt still matches', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    expect(first.status).toBe('complete');
    expect(first.compositionReceipt).toBeDefined();
    const reused = await buildRepoGraph({
      ...request(provider(fact)),
      compositionReuse: {
        reusedSources: first.compositionSources ?? [],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(reused.graph?.generation.reference.contentDigest).toEqual(
      first.graph?.generation.reference.contentDigest
    );
    expect(reused.compositionReceipt).toEqual(first.compositionReceipt);
  });

  it('invalidates reuse when a valid mutated batch is re-admitted', async () => {
    const fact = liveFact(1, 'evidence:original');
    const first = await buildRepoGraph(request(provider(fact)));
    expect(first.status).toBe('complete');
    const cloned = structuredClone(first.compositionSources?.[0]);
    if (!cloned) throw new Error('expected composition source');
    const mutatedFact = {
      ...cloned.batch.facts[0]!,
      confidence: 0.7,
      evidence: [
        {
          id: 'evidence:mutated' as const,
          sourceKind: 'source-file' as const,
          relativeLocator: input.locator,
          digest: input.digest,
        },
      ],
    };
    markGraphFactAdmitted(mutatedFact);
    const mutated = {
      ...cloned,
      batch: {
        ...cloned.batch,
        facts: [mutatedFact],
      },
    };
    const second = await buildRepoGraph({
      ...request(provider(mutatedFact)),
      compositionReuse: {
        reusedSources: [mutated],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(second.status).toBe('complete');
    expect(second.graph?.generation.factSetDigest.value).not.toBe(
      first.graph?.generation.factSetDigest.value
    );
    expect(second.graph?.edges[0]?.proof.evidence.map((entry) => entry.id)).toEqual([
      'evidence:mutated',
    ]);
  });

  it('fails admission instead of returning the old graph when mutation is invalid', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const cloned = structuredClone(first.compositionSources?.[0]);
    if (!cloned) throw new Error('expected composition source');
    const mutated = {
      ...cloned,
      batch: {
        ...cloned.batch,
        facts: [{ ...cloned.batch.facts[0]!, confidence: Number.NaN }],
      },
    };
    const second = await buildRepoGraph({
      ...request(provider(mutated.batch.facts[0]!)),
      compositionReuse: {
        reusedSources: [mutated],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(second.graph).toBeUndefined();
    expect(second.status).toBe('failed');
  });

  it('does not reuse when the receipt is omitted', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const withoutReceipt = await buildRepoGraph({
      ...request(provider(fact)),
      compositionReuse: {
        reusedSources: first.compositionSources ?? [],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
      },
    });
    expect(withoutReceipt.graph?.generation.reference.id).toBeDefined();
    expect(withoutReceipt.metrics.compositionTimings?.semanticDigestMs).toBeDefined();
  });

  it('invalidates reuse when composition policy changes', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const second = await buildRepoGraph({
      ...request(provider(fact)),
      policy: {
        ...GRAPH_STANDARD_REPO_BUILD_POLICY,
        composition: { ...GRAPH_STANDARD_COMPOSITION_POLICY, version: 'policy-mutated' },
      },
      compositionReuse: {
        reusedSources: first.compositionSources ?? [],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(second.graph?.generation.compositionPolicyDigest.value).not.toBe(
      first.graph?.generation.compositionPolicyDigest.value
    );
  });

  it('invalidates reuse when unknown-zone material changes', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const cloned = structuredClone(first.compositionSources?.[0]);
    if (!cloned) throw new Error('expected composition source');
    const mutated = {
      ...cloned,
      batch: {
        ...cloned.batch,
        unknownZones: [
          {
            code: 'graph.test-unknown',
            scope: input.locator,
            reason: 'mutated unknown zone',
          },
        ],
      },
    };
    const second = await buildRepoGraph({
      ...request(
        provider({
          ...mutated.batch.facts[0]!,
        })
      ),
      compositionReuse: {
        reusedSources: [mutated],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(second.compositionReceipt?.unknownZoneDigest.value).not.toBe(
      first.compositionReceipt?.unknownZoneDigest.value
    );
  });

  it('re-admits a spread of a prior source instead of trusting object shape', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const cloned = structuredClone(first.compositionSources?.[0]);
    if (!cloned) throw new Error('expected composition source');
    const forged = {
      ...cloned,
      alreadyAdmitted: true,
      batch: {
        ...cloned.batch,
        facts: [{ ...cloned.batch.facts[0]!, confidence: Number.NaN }],
      },
    };
    const second = await buildRepoGraph({
      ...request(provider(forged.batch.facts[0]!)),
      compositionReuse: {
        reusedSources: [forged],
        providersToRecompute: [],
      },
      reuseCanonicalBuild: {
        graph: first.graph!,
        quality: first.quality.graph,
        receipt: first.compositionReceipt,
      },
    });
    expect(second.graph).toBeUndefined();
    expect(second.status).toBe('failed');
  });

  it('fails closed on cloned, spread, or version-incompatible receipts', async () => {
    const fact = liveFact();
    const first = await buildRepoGraph(request(provider(fact)));
    const receipt = first.compositionReceipt;
    if (!receipt) throw new Error('expected composition receipt');
    const reused = {
      reusedSources: first.compositionSources ?? [],
      providersToRecompute: [] as const,
    };
    const quality = first.quality.graph;
    const graph = first.graph!;
    const forgedOrdering = await buildRepoGraph({
      ...request(provider(fact)),
      compositionReuse: reused,
      reuseCanonicalBuild: {
        graph,
        quality,
        receipt: {
          ...receipt,
          orderingRuleId: 'workspai.graph.composition-ordering.forged',
        } as unknown as typeof receipt,
      },
    });
    expect(forgedOrdering.metrics.compositionTimings?.semanticDigestMs).toBeDefined();
    const forgedRedaction = await buildRepoGraph({
      ...request(provider(fact)),
      compositionReuse: reused,
      reuseCanonicalBuild: {
        graph,
        quality,
        receipt: {
          ...receipt,
          redactionPolicyDigest: { algorithm: 'sha256', value: 'f'.repeat(64) },
        },
      },
    });
    expect(forgedRedaction.metrics.compositionTimings?.semanticDigestMs).toBeDefined();
    const missingFields = await buildRepoGraph({
      ...request(provider(fact)),
      compositionReuse: reused,
      reuseCanonicalBuild: {
        graph,
        quality,
        receipt: {
          schema: receipt.schema,
          graphSchema: receipt.graphSchema,
          architectureEpoch: receipt.architectureEpoch,
          ontologySetDigest: receipt.ontologySetDigest,
          proofPolicySetDigest: receipt.proofPolicySetDigest,
          inputsDigest: receipt.inputsDigest,
          factSetDigest: receipt.factSetDigest,
          providerSetDigest: receipt.providerSetDigest,
          compositionPolicyDigest: receipt.compositionPolicyDigest,
          coverageDigest: receipt.coverageDigest,
          unknownZoneDigest: receipt.unknownZoneDigest,
          unsupportedZoneDigest: receipt.unsupportedZoneDigest,
          contentDigest: receipt.contentDigest,
          qualityDigest: receipt.qualityDigest,
        } as typeof receipt,
      },
    });
    expect(missingFields.metrics.compositionTimings?.semanticDigestMs).toBeDefined();
    expect(first.compositionReceipt?.orderingRuleId).toBe(GRAPH_COMPOSITION_ORDERING_RULES.id);
    expect(first.compositionReceipt?.extractorSetDigest.value).toHaveLength(64);
    expect(first.compositionReceipt?.redactionPolicyDigest.value).toHaveLength(64);
    expect(first.compositionReceipt?.scopeDigest.value).toHaveLength(64);
  });
});
