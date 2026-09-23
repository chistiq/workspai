import { createHash } from 'node:crypto';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphOntologyProfile,
  type GraphProviderManifest,
  type GraphWorkspaceFact,
} from '../../src/contracts/index.js';
import { validateCanonicalGraph, validateGraphQualityReport } from '../../src/conformance/index.js';
import {
  requireMaterializedDecisions,
  requireMaterializedGraph,
} from '../../src/application/composition-types.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  composeGraph,
  executeGraphReferenceCompositionTask,
  type GraphCompositionPolicy,
  type GraphCompositionRequest,
  type GraphCompositionResult,
  type GraphCompositionSource,
} from '../../src/index.js';
import {
  estimateCanonicalJsonBytes,
  planGraphCompositionShards,
} from '../../src/application/plan-composition-shards.js';
import type {
  GraphExecutionPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';

const digest = { algorithm: 'sha256', value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };
const ontology: GraphOntologyProfile = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.test',
  version: '1',
  entities: [
    { kind: 'file', family: 'source' },
    { kind: 'module', family: 'source' },
  ],
  relations: [
    {
      kind: 'imports',
      semantics: 'structural',
      subjectFamilies: ['source'],
      objectFamilies: ['source'],
      symmetric: false,
      transitive: false,
      allowedAuthorities: ['declared', 'observed', 'verified', 'inferred'],
      proofPolicy: { id: 'workspai.graph.proof.test', version: '1' },
    },
  ],
};

function entity(id: string, kind: 'file' | 'module' = 'file') {
  return { id, identityScheme: GRAPH_IDENTITY_SCHEME, kind, scope };
}

function manifest(id: string): GraphProviderManifest {
  return {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id,
    version: '1',
    displayName: id,
    determinism: 'deterministic',
    capabilities: {
      entityKinds: ['file', 'module'],
      relationKinds: ['imports'],
      relationSemantics: ['structural'],
      factFamilies: ['source.import'],
      allowedClaims: ['observed', 'declared', 'verified', 'inferred'],
    },
    permissions: { filesystem: 'none', network: 'deny', process: 'deny', credentials: 'deny' },
    limits: { maxDurationMs: 1_000, maxFacts: 100 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['source'],
    incremental: 'input',
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };
}

function fact(
  provider: string,
  id: string,
  target: string,
  options: Partial<GraphWorkspaceFact> = {}
): GraphWorkspaceFact {
  return {
    factId: id,
    factType: 'source.import',
    subject: entity('entity:source'),
    predicate: 'imports',
    object: entity(target, 'module'),
    scope,
    evidence: [
      {
        id: `evidence:${id}`,
        sourceKind: 'source-file',
        relativeLocator: `src/${id.replaceAll(':', '-')}.ts`,
        digest,
      },
    ],
    provenance: { id: provider, version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 0.9,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
    observedAt: '2026-09-08T12:00:00Z',
    inputDigest: digest,
    unknownZones: [],
    ...options,
  };
}

function source(provider: string, facts: readonly GraphWorkspaceFact[]): GraphCompositionSource {
  const providerManifest = manifest(provider);
  const input = {
    locator: `src/${provider}.ts`,
    digest,
  };
  const batch: GraphFactBatch = {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: provider, version: '1' },
    batchId: `batch:${provider}`,
    scope,
    inputs: [input],
    facts,
    diagnostics: [],
    coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
    unknownZones: [],
    unsupportedZones: [],
    redaction: { policy: 'portable', redacted: 0, omitted: 0 },
    status: 'complete',
    processing: [
      {
        input,
        provider: { id: provider, version: '1' },
        stage: { id: 'extract', version: '1' },
        outcome: 'processed',
        outputDigest: digest,
        diagnostics: [],
      },
    ],
  };
  return { manifest: providerManifest, batch };
}

function ports(overrides: Partial<GraphExecutionPorts> = {}): GraphExecutionPorts {
  return {
    clock: { now: () => new Date('2026-09-08T20:00:00.000Z') },
    digest: {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      digestSync: (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => {
        const hash = createHash('sha256');
        return {
          update: (chunk: Uint8Array) => {
            hash.update(chunk);
          },
          digest: async () => hash.digest('hex'),
        };
      },
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        const output = executeGraphReferenceCompositionTask(
          request.input as GraphCompositionRequest
        ) as TOutput;
        return {
          status: 'complete',
          output,
          diagnostics: [],
          metrics: { durationMs: 0, inputBytes: 0, outputBytes: 0 },
        };
      },
    },
    ...overrides,
  };
}

function portsAt(timestamp: string): GraphExecutionPorts {
  return ports({ clock: { now: () => new Date(timestamp) } });
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const output = [...values];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [output[index], output[target]] = [output[target] as T, output[index] as T];
  }
  return output;
}

function padSources(count = 12): GraphCompositionSource[] {
  return Array.from({ length: count }, (_, index) =>
    source(`provider:eq-pad:${index}`, [
      fact(`provider:eq-pad:${index}`, `fact:eq-pad:${index}`, `entity:eq-pad-target:${index}`, {
        subject: entity(`entity:eq-pad-source:${index}`),
      }),
    ])
  );
}

function sourcesForSharding(
  base: readonly GraphCompositionSource[]
): readonly GraphCompositionSource[] {
  return [...base, ...padSources()];
}

function workerBudgetThatForcesShards(
  sources: readonly GraphCompositionSource[],
  minShards = 2
): number {
  const groups = new Map<string, number>();
  for (const item of sources) {
    for (const itemFact of item.batch.facts) {
      groups.set(
        itemFact.factId,
        (groups.get(itemFact.factId) ?? 0) + estimateCanonicalJsonBytes(itemFact)
      );
    }
  }
  const groupBytes = [...groups.values()];
  const maxGroup = Math.max(...groupBytes, 1);
  const totalFacts = groupBytes.reduce((total, bytes) => total + bytes, 0);
  for (const multiplier of [2, 1.75, 1.6, 1.5, 1.4]) {
    const budget = Math.max(maxGroup * 4, Math.ceil(totalFacts * multiplier));
    if (budget <= totalFacts) continue;
    const plan = planGraphCompositionShards(sources, budget);
    if (plan.status === 'ready' && plan.shards.length >= minShards) {
      return budget;
    }
  }
  throw new Error(`fixture did not force ${minShards} composition shards`);
}

function singleShotPolicy(policy: GraphCompositionPolicy): GraphCompositionPolicy {
  return {
    ...policy,
    maxWorkerOutputBytes: GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes,
  };
}

function shardedPolicy(
  sources: readonly GraphCompositionSource[],
  policy: GraphCompositionPolicy,
  minShards = 2
): GraphCompositionPolicy {
  return {
    ...policy,
    maxWorkerOutputBytes: workerBudgetThatForcesShards(sources, minShards),
  };
}

function compositionSemantics(result: GraphCompositionResult) {
  if (!result.accepted) {
    return {
      accepted: false as const,
      code: result.code,
      issues: result.issues,
    };
  }
  const graph = requireMaterializedGraph(result.value);
  return {
    accepted: true as const,
    issues: result.issues,
    nodes: graph.nodes,
    edges: graph.edges,
    disputes: graph.disputes,
    unresolved: graph.unresolved,
    diagnostics: graph.diagnostics,
    assertions: graph.assertions,
    ontology: graph.ontology,
    decisions: requireMaterializedDecisions(result.value),
    quality: {
      integrity: result.value.quality.integrity,
      determinism: result.value.quality.determinism,
      coverage: result.value.quality.coverage,
      proofStates: result.value.quality.proofStates,
      unknownZones: result.value.quality.unknownZones,
      unsupportedZones: result.value.quality.unsupportedZones,
      providerFailures: result.value.quality.providerFailures,
    },
    inputsDigest: graph.generation.inputsDigest,
    factSetDigest: graph.generation.factSetDigest,
    providerSetDigest: graph.generation.providerSetDigest,
    ontologySetDigest: graph.generation.ontologySetDigest,
    proofPolicySetDigest: graph.generation.proofPolicySetDigest,
  };
}

async function composeSingleAndSharded(
  request: GraphCompositionRequest,
  minShards = 2
): Promise<{
  readonly sources: readonly GraphCompositionSource[];
  readonly planShards: number;
  readonly single: GraphCompositionResult;
  readonly sharded: GraphCompositionResult;
}> {
  const sources = sourcesForSharding(request.sources);
  const singlePolicy = singleShotPolicy(request.policy);
  const shardPolicy = shardedPolicy(sources, request.policy, minShards);
  const plan = planGraphCompositionShards(sources, shardPolicy.maxWorkerOutputBytes);
  if (plan.status !== 'ready') {
    throw new Error(`sharded plan failed: ${plan.code}`);
  }
  const [single, sharded] = await Promise.all([
    composeGraph({ ...request, sources, policy: singlePolicy }, ports()),
    composeGraph({ ...request, sources, policy: shardPolicy }, ports()),
  ]);
  return { sources, planShards: plan.shards.length, single, sharded };
}

describe('Graph G2 reference composition engine', () => {
  it('is invariant to source order and aggregates independent evidence', async () => {
    const first = source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]);
    const second = source('provider:b', [fact('provider:b', 'fact:b', 'entity:target')]);
    const request = {
      ontology,
      sources: [first, second],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const forward = await composeGraph(request, ports());
    const reverse = await composeGraph({ ...request, sources: [second, first] }, ports());

    expect(forward).toMatchObject({ accepted: true });
    expect(reverse).toMatchObject({ accepted: true });
    if (!forward.accepted || !reverse.accepted) return;
    expect(requireMaterializedGraph(forward.value).generation.reference.contentDigest).toEqual(
      requireMaterializedGraph(reverse.value).generation.reference.contentDigest
    );
    expect(requireMaterializedGraph(forward.value).edges[0]).toMatchObject({
      state: 'accepted',
      facts: ['fact:a', 'fact:b'],
      proof: { state: 'corroborated' },
    });
    expect(validateCanonicalGraph(requireMaterializedGraph(forward.value), ontology)).toMatchObject(
      { accepted: true }
    );
    expect(validateGraphQualityReport(forward.value.quality)).toMatchObject({ accepted: true });
  });

  it('preserves complete output identity across an amplified seeded ordering corpus', async () => {
    const sources = Array.from({ length: 32 }, (_, index) => {
      const provider = `provider:${String(index).padStart(2, '0')}`;
      return source(provider, [
        fact(provider, `fact:${String(index).padStart(2, '0')}`, `entity:target:${index % 5}`),
      ]);
    });
    const baseline = await composeGraph(
      { ontology, sources, policy: GRAPH_STANDARD_COMPOSITION_POLICY },
      ports()
    );
    expect(baseline).toMatchObject({ accepted: true });
    if (!baseline.accepted) return;

    for (let seed = 1; seed <= 24; seed += 1) {
      const candidate = await composeGraph(
        {
          ontology,
          sources: seededShuffle(sources, seed),
          policy: GRAPH_STANDARD_COMPOSITION_POLICY,
        },
        ports()
      );
      expect(candidate.accepted).toBe(true);
      if (!candidate.accepted) return;
      expect(candidate.value).toEqual(baseline.value);
      expect(candidate.issues).toEqual(baseline.issues);
    }
  });

  it('does not turn repeated dependent evidence into false corroboration', async () => {
    const repeated = Array.from({ length: 64 }, (_, index) => {
      const provider = `provider:copy:${index}`;
      return source(provider, [
        fact(provider, `fact:copy:${index}`, 'entity:target', {
          evidence: [
            {
              id: 'evidence:shared-root',
              sourceKind: 'generated-copy',
              relativeLocator: 'generated/shared.json',
              digest,
            },
          ],
        }),
      ]);
    });
    const result = await composeGraph(
      {
        ontology,
        sources: repeated,
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(1);
    expect(requireMaterializedGraph(result.value).edges[0]?.proof).toMatchObject({
      state: 'supported',
    });
    expect(requireMaterializedGraph(result.value).edges[0]?.facts).toHaveLength(64);
  });

  it('preserves a minority functional claim as a dispute instead of majority voting', async () => {
    const majority = Array.from({ length: 24 }, (_, index) => {
      const provider = `provider:majority:${index}`;
      return source(provider, [fact(provider, `fact:majority:${index}`, 'entity:majority-target')]);
    });
    const minority = source('provider:minority', [
      fact('provider:minority', 'fact:minority', 'entity:minority-target'),
    ]);
    const result = await composeGraph(
      {
        ontology,
        sources: [...majority, minority],
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, functionalRelations: ['imports'] },
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(2);
    expect(
      requireMaterializedGraph(result.value).edges.every((edge) => edge.state === 'disputed')
    ).toBe(true);
    expect(
      requireMaterializedGraph(result.value)
        .edges.map((edge) => edge.to)
        .sort()
    ).toEqual(['entity:majority-target', 'entity:minority-target']);
  });

  it('returns an immutable content-addressed result without freezing caller input', async () => {
    const inputFact = fact('provider:a', 'fact:a', 'entity:target');
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [inputFact])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(requireMaterializedGraph(result.value).edges[0])).toBe(true);
    expect(
      Object.isFrozen(requireMaterializedGraph(result.value).edges[0]?.proof.evidence[0])
    ).toBe(true);
    expect(Object.isFrozen(inputFact)).toBe(false);
  });

  it('preserves functional conflicts and never chooses a target by provider order', async () => {
    const request = {
      ontology,
      sources: [
        source('provider:a', [fact('provider:a', 'fact:a', 'entity:first')]),
        source('provider:b', [fact('provider:b', 'fact:b', 'entity:second')]),
      ],
      policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, functionalRelations: ['imports'] },
    };
    const result = await composeGraph(request, ports());

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(2);
    expect(
      requireMaterializedGraph(result.value).edges.every((edge) => edge.state === 'disputed')
    ).toBe(true);
    expect(requireMaterializedGraph(result.value).disputes).toHaveLength(1);
    expect(requireMaterializedDecisions(result.value).map((decision) => decision.state)).toEqual([
      'disputed',
      'disputed',
    ]);
  });

  it('does not let evaluation time change immutable graph content identity', async () => {
    const request = {
      ontology,
      sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const earlier = await composeGraph(request, portsAt('2026-09-08T20:00:00.000Z'));
    const later = await composeGraph(request, portsAt('2026-09-09T20:00:00.000Z'));

    expect(earlier).toMatchObject({ accepted: true });
    expect(later).toMatchObject({ accepted: true });
    if (!earlier.accepted || !later.accepted) return;
    expect(requireMaterializedGraph(earlier.value).generation.reference.generatedAt).not.toBe(
      requireMaterializedGraph(later.value).generation.reference.generatedAt
    );
    expect(requireMaterializedGraph(earlier.value).generation.reference.contentDigest).toEqual(
      requireMaterializedGraph(later.value).generation.reference.contentDigest
    );
  });

  it('excludes declared fact timestamps from structural generation identity', async () => {
    const earlierFact = fact('provider:a', 'fact:a', 'entity:target', {
      observedAt: '2026-09-08T12:00:00Z',
      freshness: { status: 'current', validUntil: '2026-09-09T12:00:00Z' },
    });
    const laterFact = fact('provider:a', 'fact:a', 'entity:target', {
      observedAt: '2026-09-09T12:00:00Z',
      freshness: { status: 'current', validUntil: '2026-09-10T12:00:00Z' },
    });
    const earlier = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [earlierFact])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );
    const later = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [laterFact])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(earlier).toMatchObject({ accepted: true });
    expect(later).toMatchObject({ accepted: true });
    if (!earlier.accepted || !later.accepted) return;
    expect(requireMaterializedGraph(earlier.value).generation.reference.contentDigest).toEqual(
      requireMaterializedGraph(later.value).generation.reference.contentDigest
    );
    expect(earlier.value.semanticDigests.facts).toEqual(later.value.semanticDigests.facts);
  });

  it('does not promote weak claims into traversable edges through a conflict', async () => {
    const current = fact('provider:a', 'fact:current', 'entity:first');
    const stale = fact('provider:b', 'fact:stale', 'entity:second', {
      freshness: { status: 'stale' },
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [current]), source('provider:b', [stale])],
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, functionalRelations: ['imports'] },
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(1);
    expect(requireMaterializedGraph(result.value).edges[0]).toMatchObject({
      to: 'entity:first',
      state: 'accepted',
    });
    expect(requireMaterializedGraph(result.value).disputes).toEqual([]);
    expect(requireMaterializedDecisions(result.value)).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'rejected' })])
    );
  });

  it('isolates stale and low-confidence facts from a healthy edge proof', async () => {
    const current = fact('provider:a', 'fact:current', 'entity:target');
    const stale = fact('provider:a', 'fact:stale', 'entity:target', {
      freshness: { status: 'stale' },
    });
    const weak = fact('provider:a', 'fact:weak', 'entity:target', {
      confidence: 0.1,
      evidence: [
        {
          id: 'evidence:independent-but-weak',
          sourceKind: 'source-file',
          relativeLocator: 'src/weak.ts',
          digest,
        },
      ],
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [current, stale, weak])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(1);
    expect(requireMaterializedGraph(result.value).edges[0]).toMatchObject({
      facts: ['fact:current'],
      proof: { state: 'supported' },
      freshness: { status: 'current' },
      confidence: 0.9,
    });
    expect(requireMaterializedDecisions(result.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factIds: ['fact:stale'],
          explanation: expect.objectContaining({ code: 'GRAPH_FACT_STALE' }),
        }),
        expect.objectContaining({
          factIds: ['fact:weak'],
          explanation: expect.objectContaining({ code: 'GRAPH_FACT_CONFIDENCE_INSUFFICIENT' }),
        }),
      ])
    );
  });

  it('fails closed on globally colliding fact identities', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [
          source('provider:a', [fact('provider:a', 'fact:duplicate', 'entity:first')]),
          source('provider:b', [fact('provider:b', 'fact:duplicate', 'entity:second')]),
        ],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toEqual([]);
    expect(requireMaterializedDecisions(result.value)).toContainEqual(
      expect.objectContaining({
        state: 'unresolved',
        explanation: expect.objectContaining({ code: 'GRAPH_FACT_ID_COLLISION' }),
      })
    );
  });

  it('resolves directional rename aliases to one canonical endpoint', async () => {
    const renamed = fact('provider:a', 'fact:new', 'entity:target', {
      subject: {
        ...entity('entity:new'),
        aliases: [{ id: 'entity:old', reason: 'rename' }],
      },
    });
    const legacyReference = fact('provider:a', 'fact:old', 'entity:target', {
      subject: entity('entity:old'),
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [renamed, legacyReference])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toHaveLength(1);
    expect(requireMaterializedGraph(result.value).edges[0]).toMatchObject({
      from: 'entity:new',
      facts: ['fact:new', 'fact:old'],
    });
    expect(requireMaterializedGraph(result.value).nodes).toContainEqual(
      expect.objectContaining({
        id: 'entity:new',
        aliases: [expect.objectContaining({ id: 'entity:old' })],
      })
    );
    expect(
      requireMaterializedGraph(result.value).nodes.some((node) => node.id === 'entity:old')
    ).toBe(false);
  });

  it('preserves alias cycles as unresolved instead of selecting a canonical winner', async () => {
    const first = fact('provider:a', 'fact:first', 'entity:target', {
      subject: {
        ...entity('entity:first'),
        aliases: [{ id: 'entity:second', reason: 'provider-alias' }],
      },
    });
    const second = fact('provider:a', 'fact:second', 'entity:target', {
      subject: {
        ...entity('entity:second'),
        aliases: [{ id: 'entity:first', reason: 'provider-alias' }],
      },
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [first, second])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toEqual([]);
    expect(requireMaterializedGraph(result.value).unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('unresolved:alias-cycle:') }),
      ])
    );
    expect(result.value.quality.integrity).toBe('attention');
  });

  it('keeps rejected and unresolved claims out of traversable graph edges', async () => {
    const inferred = fact('provider:a', 'fact:inferred', 'entity:target', {
      authority: 'inferred',
      derivation: 'inferred',
    });
    const unknown = fact('provider:a', 'fact:unknown', 'entity:unknown', {
      freshness: { status: 'unknown' },
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [inferred, unknown])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    expect(requireMaterializedGraph(result.value).edges).toEqual([]);
    expect(requireMaterializedDecisions(result.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'rejected', includedInGraph: false }),
        expect.objectContaining({ state: 'unresolved', includedInGraph: false }),
      ])
    );
    expect(result.value.quality.proofStates).toMatchObject({ insufficient: 1, unresolved: 1 });
  });

  it('fails closed before composition when provider output is invalid', async () => {
    const invalid = source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]);
    const result = await composeGraph(
      {
        ontology,
        sources: [{ ...invalid, batch: { ...invalid.batch, status: 'invalid' as never } }],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );

    expect(result).toMatchObject({ accepted: false, code: 'invalid-input' });
  });

  it('rejects unknown policy relations and duplicate provider batch identities', async () => {
    const one = source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]);
    const invalidPolicy = await composeGraph(
      {
        ontology,
        sources: [one],
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, functionalRelations: ['unknown'] },
      },
      ports()
    );
    const duplicateSource = await composeGraph(
      { ontology, sources: [one, one], policy: GRAPH_STANDARD_COMPOSITION_POLICY },
      ports()
    );

    expect(invalidPolicy).toMatchObject({ accepted: false, code: 'invalid-input' });
    expect(duplicateSource).toMatchObject({
      accepted: false,
      code: 'invalid-input',
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_SOURCE_DUPLICATE' })],
    });
  });

  it('enforces composition fact and edge resource limits before publication', async () => {
    const twoFacts = source('provider:a', [
      fact('provider:a', 'fact:a', 'entity:first'),
      fact('provider:a', 'fact:b', 'entity:second'),
    ]);
    const factLimited = await composeGraph(
      {
        ontology,
        sources: [twoFacts],
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, maxFacts: 1 },
      },
      ports()
    );
    const edgeLimited = await composeGraph(
      {
        ontology,
        sources: [twoFacts],
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, maxEdges: 1 },
      },
      ports()
    );

    expect(factLimited).toMatchObject({ accepted: false, code: 'resource-limit' });
    expect(edgeLimited).toMatchObject({ accepted: false, code: 'resource-limit' });
  });

  it('rejects cyclic lineage and preserves custom evidence-root grouping', async () => {
    const facts = [
      fact('provider:a', 'fact:a', 'entity:target'),
      fact('provider:a', 'fact:b', 'entity:target'),
    ];
    const cyclic = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', facts)],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
        lineages: [
          {
            factId: 'fact:a',
            derivation: 'extracted',
            evidenceRoots: ['root:a'],
            parentFactIds: ['fact:b'],
          },
          {
            factId: 'fact:b',
            derivation: 'extracted',
            evidenceRoots: ['root:b'],
            parentFactIds: ['fact:a'],
          },
        ],
      },
      ports()
    );
    const grouped = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', facts)],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
        lineages: [
          {
            factId: 'fact:a',
            derivation: 'extracted',
            evidenceRoots: ['root:a'],
            parentFactIds: [],
          },
          {
            factId: 'fact:b',
            derivation: 'extracted',
            evidenceRoots: ['root:b'],
            parentFactIds: [],
          },
        ],
      },
      ports()
    );

    expect(cyclic).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_LINEAGE_CYCLE' })],
    });
    expect(grouped).toMatchObject({ accepted: true });
    if (!grouped.accepted) return;
    expect(requireMaterializedGraph(grouped.value).edges[0]?.proof.corroborationGroups).toEqual([
      expect.objectContaining({
        root: 'root:a',
        evidence: [expect.objectContaining({ id: 'evidence:fact:a' })],
      }),
      expect.objectContaining({
        root: 'root:b',
        evidence: [expect.objectContaining({ id: 'evidence:fact:b' })],
      }),
    ]);
  });

  it('fails closed when an execution port violates the digest contract', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({ digest: { algorithm: 'sha256', digest: async () => 'NOT-A-DIGEST' } })
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'composition-failed',
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_FAILED' })],
    });
  });

  it('uses the worker and scheduler ports so large composition does not own the event loop', async () => {
    let heartbeat = false;
    let workerRuns = 0;
    let yields = 0;
    const execution = ports({
      workers: {
        async execute<TInput, TOutput>(
          request: GraphWorkerTaskRequest<TInput>
        ): Promise<GraphWorkerTaskResult<TOutput>> {
          workerRuns += 1;
          await waitForImmediate();
          heartbeat = true;
          return {
            status: 'complete',
            output: executeGraphReferenceCompositionTask(
              request.input as GraphCompositionRequest
            ) as TOutput,
            diagnostics: [],
            metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
          };
        },
      },
      scheduler: {
        yield: async () => {
          yields += 1;
          await waitForImmediate();
        },
      },
    });
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      execution
    );

    expect(result).toMatchObject({ accepted: true });
    expect({ heartbeat, workerRuns, yields }).toEqual({
      heartbeat: true,
      workerRuns: 1,
      yields: 1,
    });
  });

  it('runs one in-process composition task when the worker pool does not serialize payloads', async () => {
    const sources = sourcesForSharding([
      source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]),
      source('provider:b', [fact('provider:b', 'fact:b', 'entity:other')]),
    ]);
    const shardPolicy = shardedPolicy(sources, GRAPH_STANDARD_COMPOSITION_POLICY);
    const plan = planGraphCompositionShards(sources, shardPolicy.maxWorkerOutputBytes);
    expect(plan.status).toBe('ready');
    if (plan.status === 'ready') expect(plan.shards.length).toBeGreaterThan(1);
    let workerRuns = 0;
    const result = await composeGraph(
      { ontology, sources, policy: shardPolicy },
      ports({
        workers: {
          serializesTasks: false,
          async execute<TInput, TOutput>(request: GraphWorkerTaskRequest<TInput>) {
            workerRuns += 1;
            expect((request.input as GraphCompositionRequest).sources).toHaveLength(sources.length);
            return {
              status: 'complete' as const,
              output: executeGraphReferenceCompositionTask(
                request.input as GraphCompositionRequest
              ) as TOutput,
              diagnostics: [],
              metrics: { durationMs: 1, inputBytes: 0, outputBytes: 1 },
            };
          },
        },
      })
    );
    expect(result).toMatchObject({ accepted: true });
    expect(workerRuns).toBe(1);
  });

  it.each(['failed', 'unsupported'] as const)(
    'fails closed when the worker reports %s',
    async (status) => {
      const result = await composeGraph(
        {
          ontology,
          sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
          policy: GRAPH_STANDARD_COMPOSITION_POLICY,
        },
        ports({
          workers: {
            execute: async () => ({
              status,
              diagnostics:
                status === 'failed'
                  ? [
                      {
                        code: 'WORKER_FAILED',
                        severity: 'error',
                        path: '/worker',
                        message: 'Worker failed safely.',
                      } as const,
                    ]
                  : [],
              metrics: { durationMs: 1, inputBytes: 1, outputBytes: 0 },
            }),
          },
        })
      );

      expect(result).toMatchObject({ accepted: false, code: 'composition-failed' });
      if (!result.accepted && status === 'failed') {
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'WORKER_FAILED' }));
      }
    }
  );

  it('rejects dishonest or over-budget worker accounting', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({
        workers: {
          async execute<TInput, TOutput>(request: GraphWorkerTaskRequest<TInput>) {
            return {
              status: 'complete' as const,
              output: executeGraphReferenceCompositionTask(
                request.input as GraphCompositionRequest
              ) as TOutput,
              diagnostics: [],
              metrics: {
                durationMs: 1,
                inputBytes: 1,
                outputBytes: GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes + 1,
              },
            };
          },
        },
      })
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'resource-limit',
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_WORKER_BUDGET_INVALID' })],
    });
  });

  it('fails closed when a worker silently omits an admitted fact', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({
        workers: {
          async execute<TInput, TOutput>(request: GraphWorkerTaskRequest<TInput>) {
            const prepared = executeGraphReferenceCompositionTask(
              request.input as GraphCompositionRequest
            );
            return {
              status: 'complete' as const,
              output: { ...prepared, candidates: [] } as TOutput,
              diagnostics: [],
              metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
            };
          },
        },
      })
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'composition-failed',
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_WORKER_FACT_OMITTED' })],
    });
  });

  it('fails closed when a worker mutates admitted fact or endpoint semantics', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({
        workers: {
          async execute<TInput, TOutput>(request: GraphWorkerTaskRequest<TInput>) {
            const prepared = executeGraphReferenceCompositionTask(
              request.input as GraphCompositionRequest
            );
            const candidate = prepared.candidates[0];
            if (!candidate?.facts[0]) throw new Error('Expected a composition candidate.');
            return {
              status: 'complete' as const,
              output: {
                ...prepared,
                candidates: [
                  {
                    ...candidate,
                    facts: [
                      {
                        factId: candidate.facts[0].factId,
                        fact: { confidence: 1 },
                      },
                    ],
                  },
                ],
              } as TOutput,
              diagnostics: [],
              metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
            };
          },
        },
      })
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'composition-failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'GRAPH_COMPOSITION_WORKER_FACT_MUTATED' }),
      ]),
    });
  });

  it('maps worker cancellation to an incomplete result without publishing output', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({
        workers: {
          execute: async () => ({
            status: 'cancelled',
            diagnostics: [],
            metrics: { durationMs: 1, inputBytes: 1, outputBytes: 0 },
          }),
        },
      })
    );

    expect(result).toMatchObject({ accepted: false, code: 'cancelled' });
    expect(result).not.toHaveProperty('value');
  });

  it('returns a non-publishable cancellation result without a partial graph', async () => {
    const result = await composeGraph(
      {
        ontology,
        sources: [source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports({
        cancellation: {
          aborted: true,
          throwIfAborted: () => {
            throw new Error('cancelled');
          },
        },
      })
    );

    expect(result).toMatchObject({ accepted: false, code: 'cancelled' });
    expect(result).not.toHaveProperty('value.graph');
  });
});

describe('sharded composition equivalence', () => {
  it('keeps independent edges identical to single-shot composition', async () => {
    const sources = [
      source(
        'provider:a',
        Array.from({ length: 8 }, (_, index) =>
          fact('provider:a', `fact:${index}`, `entity:target-${index}`)
        )
      ),
    ];
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources,
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    });
    expect(planShards).toBeGreaterThan(1);
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('preserves functional conflicts across shards', async () => {
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources: [
        source('provider:a', [fact('provider:a', 'fact:a', 'entity:first')]),
        source('provider:b', [fact('provider:b', 'fact:b', 'entity:second')]),
      ],
      policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, functionalRelations: ['imports'] },
    });
    expect(planShards).toBeGreaterThan(1);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    const conflicted = requireMaterializedGraph(sharded.value).edges.filter(
      (edge) => edge.from === 'entity:source'
    );
    expect(conflicted).toHaveLength(2);
    expect(conflicted.every((edge) => edge.state === 'disputed')).toBe(true);
    expect(
      requireMaterializedDecisions(sharded.value).map((decision) => decision.explanation.code)
    ).toEqual(expect.arrayContaining(['GRAPH_EDGE_FUNCTIONAL_CONFLICT']));
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('aggregates multiple facts for one edge across shards', async () => {
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources: [
        source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]),
        source('provider:b', [fact('provider:b', 'fact:b', 'entity:target')]),
      ],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    });
    expect(planShards).toBeGreaterThan(1);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    const target = requireMaterializedGraph(sharded.value).edges.find(
      (edge) => edge.to === 'entity:target'
    );
    expect(target).toMatchObject({
      facts: ['fact:a', 'fact:b'],
      proof: { state: 'corroborated' },
    });
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('keeps duplicate fact identities in one shard and matches single-shot collision handling', async () => {
    const sources = sourcesForSharding([
      source('provider:a', [fact('provider:a', 'fact:duplicate', 'entity:first')]),
      source('provider:b', [fact('provider:b', 'fact:duplicate', 'entity:second')]),
    ]);
    const shardPolicy = shardedPolicy(sources, GRAPH_STANDARD_COMPOSITION_POLICY);
    const plan = planGraphCompositionShards(sources, shardPolicy.maxWorkerOutputBytes);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.shards.length).toBeGreaterThan(1);
    const duplicateShards = plan.shards.filter((shard) =>
      shard.some((item) =>
        item.batch.facts.some((itemFact) => itemFact.factId === 'fact:duplicate')
      )
    );
    expect(duplicateShards).toHaveLength(1);
    expect(
      duplicateShards[0]
        ?.flatMap((item) => item.batch.facts)
        .filter((itemFact) => itemFact.factId === 'fact:duplicate')
    ).toHaveLength(2);
    const [single, sharded] = await Promise.all([
      composeGraph(
        { ontology, sources, policy: singleShotPolicy(GRAPH_STANDARD_COMPOSITION_POLICY) },
        ports()
      ),
      composeGraph({ ontology, sources, policy: shardPolicy }, ports()),
    ]);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    expect(requireMaterializedDecisions(sharded.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'unresolved',
          explanation: expect.objectContaining({ code: 'GRAPH_FACT_ID_COLLISION' }),
        }),
      ])
    );
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('keeps rejected and unresolved facts out of traversable edges after a merge', async () => {
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources: [
        source('provider:a', [
          fact('provider:a', 'fact:inferred', 'entity:target', {
            authority: 'inferred',
            derivation: 'inferred',
          }),
        ]),
        source('provider:b', [
          fact('provider:b', 'fact:unknown', 'entity:unknown', {
            freshness: { status: 'unknown' },
          }),
        ]),
        source('provider:c', [fact('provider:c', 'fact:current', 'entity:healthy')]),
      ],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    });
    expect(planShards).toBeGreaterThan(1);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    expect(requireMaterializedDecisions(sharded.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'rejected', includedInGraph: false }),
        expect.objectContaining({ state: 'unresolved', includedInGraph: false }),
      ])
    );
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('preserves alias-cycle unresolved identity across a global freeze', async () => {
    const first = fact('provider:a', 'fact:first', 'entity:target', {
      subject: {
        ...entity('entity:first'),
        aliases: [{ id: 'entity:second', reason: 'provider-alias' }],
      },
    });
    const second = fact('provider:b', 'fact:second', 'entity:target', {
      subject: {
        ...entity('entity:second'),
        aliases: [{ id: 'entity:first', reason: 'provider-alias' }],
      },
    });
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources: [source('provider:a', [first]), source('provider:b', [second])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    });
    expect(planShards).toBeGreaterThan(1);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    expect(requireMaterializedGraph(sharded.value).unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('unresolved:alias-cycle:') }),
      ])
    );
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('fails closed on cyclic lineage identically for single-shot and sharded plans', async () => {
    const facts = [
      fact('provider:a', 'fact:a', 'entity:target'),
      fact('provider:a', 'fact:b', 'entity:target'),
    ];
    const request = {
      ontology,
      sources: [source('provider:a', facts)],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      lineages: [
        {
          factId: 'fact:a',
          derivation: 'extracted' as const,
          evidenceRoots: ['root:a'],
          parentFactIds: ['fact:b'],
        },
        {
          factId: 'fact:b',
          derivation: 'extracted' as const,
          evidenceRoots: ['root:b'],
          parentFactIds: ['fact:a'],
        },
      ],
    };
    const { single, sharded } = await composeSingleAndSharded(request);
    expect(single).toMatchObject({
      accepted: false,
      issues: [expect.objectContaining({ code: 'GRAPH_COMPOSITION_LINEAGE_CYCLE' })],
    });
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('aggregates lineage proof groups identically after a merge', async () => {
    const facts = [
      fact('provider:a', 'fact:a', 'entity:target'),
      fact('provider:b', 'fact:b', 'entity:target'),
    ];
    const { planShards, single, sharded } = await composeSingleAndSharded({
      ontology,
      sources: [
        source('provider:a', [facts[0] as (typeof facts)[number]]),
        source('provider:b', [facts[1] as (typeof facts)[number]]),
      ],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      lineages: [
        {
          factId: 'fact:a',
          derivation: 'extracted',
          evidenceRoots: ['root:a'],
          parentFactIds: [],
        },
        {
          factId: 'fact:b',
          derivation: 'extracted',
          evidenceRoots: ['root:b'],
          parentFactIds: [],
        },
      ],
    });
    expect(planShards).toBeGreaterThan(1);
    expect(sharded).toMatchObject({ accepted: true });
    if (!sharded.accepted) return;
    const grouped = requireMaterializedGraph(sharded.value).edges.find(
      (edge) => edge.to === 'entity:target'
    );
    expect(grouped?.proof.corroborationGroups).toEqual([
      expect.objectContaining({
        root: 'root:a',
        evidence: [expect.objectContaining({ id: 'evidence:fact:a' })],
      }),
      expect.objectContaining({
        root: 'root:b',
        evidence: [expect.objectContaining({ id: 'evidence:fact:b' })],
      }),
    ]);
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('is invariant to shuffled source order between single-shot and sharded composition', async () => {
    const canonical = sourcesForSharding([
      source('provider:a', [fact('provider:a', 'fact:a', 'entity:target')]),
      source('provider:b', [fact('provider:b', 'fact:b', 'entity:target')]),
      source('provider:c', [fact('provider:c', 'fact:c', 'entity:other')]),
    ]);
    const shuffled = seededShuffle(canonical, 20260913);
    expect(shuffled.map((item) => item.manifest.id)).not.toEqual(
      canonical.map((item) => item.manifest.id)
    );
    const shardPolicy = shardedPolicy(shuffled, GRAPH_STANDARD_COMPOSITION_POLICY);
    const plan = planGraphCompositionShards(shuffled, shardPolicy.maxWorkerOutputBytes);
    expect(plan.status).toBe('ready');
    if (plan.status === 'ready') expect(plan.shards.length).toBeGreaterThan(1);
    const [single, sharded] = await Promise.all([
      composeGraph(
        {
          ontology,
          sources: canonical,
          policy: singleShotPolicy(GRAPH_STANDARD_COMPOSITION_POLICY),
        },
        ports()
      ),
      composeGraph({ ontology, sources: shuffled, policy: shardPolicy }, ports()),
    ]);
    expect(compositionSemantics(sharded)).toEqual(compositionSemantics(single));
  });

  it('fails closed when a single fact identity exceeds the shard payload budget', async () => {
    const sources = [source('provider:a', [fact('provider:a', 'fact:huge', 'entity:target')])];
    const plan = planGraphCompositionShards(sources, 256);
    expect(plan).toMatchObject({
      status: 'failed',
      code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE',
    });
    const composed = await composeGraph(
      {
        ontology,
        sources,
        policy: { ...GRAPH_STANDARD_COMPOSITION_POLICY, maxWorkerOutputBytes: 256 },
      },
      ports()
    );
    expect(composed).toMatchObject({
      accepted: false,
      code: 'resource-limit',
    });
    expect(composed).not.toHaveProperty('value');
    if (composed.accepted) return;
    expect(composed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE' }),
      ])
    );
  });

  it.each(['failed', 'cancelled'] as const)(
    'does not publish a graph when a middle shard is %s',
    async (status) => {
      const sources = sourcesForSharding([
        source('provider:a', [fact('provider:a', 'fact:a', 'entity:first')]),
        source('provider:b', [fact('provider:b', 'fact:b', 'entity:second')]),
      ]);
      const policy = shardedPolicy(sources, GRAPH_STANDARD_COMPOSITION_POLICY, 3);
      const plan = planGraphCompositionShards(sources, policy.maxWorkerOutputBytes);
      expect(plan.status).toBe('ready');
      if (plan.status !== 'ready') return;
      expect(plan.shards.length).toBeGreaterThanOrEqual(3);
      let shardIndex = 0;
      const result = await composeGraph(
        { ontology, sources, policy },
        ports({
          workers: {
            async execute<TInput, TOutput>(request: GraphWorkerTaskRequest<TInput>) {
              shardIndex += 1;
              if (shardIndex === 2) {
                return {
                  status,
                  diagnostics:
                    status === 'failed'
                      ? [
                          {
                            code: 'WORKER_FAILED',
                            severity: 'error' as const,
                            path: '/worker',
                            message: 'Middle shard failed safely.',
                          },
                        ]
                      : [],
                  metrics: { durationMs: 1, inputBytes: 1, outputBytes: 0 },
                };
              }
              return {
                status: 'complete',
                output: executeGraphReferenceCompositionTask(
                  request.input as GraphCompositionRequest
                ) as TOutput,
                diagnostics: [],
                metrics: { durationMs: 0, inputBytes: 0, outputBytes: 0 },
              };
            },
          },
        })
      );
      expect(shardIndex).toBe(2);
      expect(result).toMatchObject({
        accepted: false,
        code: status === 'cancelled' ? 'cancelled' : 'composition-failed',
      });
      expect(result).not.toHaveProperty('value');
    }
  );
});
