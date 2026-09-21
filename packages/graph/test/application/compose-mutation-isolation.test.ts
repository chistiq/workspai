import { createHash } from 'node:crypto';

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
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  composeGraph,
  type GraphCompositionRequest,
  type GraphCompositionSource,
} from '../../src/index.js';
import type {
  GraphExecutionPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import { executeGraphReferenceCompositionTask } from '../../src/application/index.js';

const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };
const scope = { kind: 'project' as const, projectIds: ['project:mutation'] as [string] };
const ontology: GraphOntologyProfile = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.mutation',
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

function fact(id: string, options: Partial<GraphWorkspaceFact> = {}): GraphWorkspaceFact {
  return {
    factId: id,
    factType: 'source.import',
    subject: entity('entity:source'),
    predicate: 'imports',
    object: entity('entity:target', 'module'),
    scope,
    evidence: [
      {
        id: 'e',
        sourceKind: 'source-file',
        relativeLocator: 'src/index.ts',
        digest,
      },
    ],
    provenance: { id: 'provider:mutation', version: '1' },
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

type LiveFact = GraphWorkspaceFact & {
  confidence: number;
  evidence: {
    id: string;
    sourceKind: 'source-file';
    relativeLocator: string;
    digest: typeof digest;
  }[];
  unknownZones: { code: string; scope: string; reason: string }[];
  extensions?: Record<string, unknown>;
};

function liveFact(id: string, options: Partial<GraphWorkspaceFact> = {}): LiveFact {
  return fact(id, options) as LiveFact;
}

function sourceFromFacts(facts: GraphWorkspaceFact[]): GraphCompositionSource {
  const providerManifest = manifest('provider:mutation');
  const input = { locator: 'src/index.ts', digest };
  const batch: GraphFactBatch = {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: providerManifest.id, version: '1' },
    batchId: 'batch:mutation',
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
        provider: { id: providerManifest.id, version: '1' },
        stage: { id: 'extract', version: '1' },
        outcome: 'processed',
        outputDigest: digest,
        diagnostics: [],
      },
    ],
  };
  return { manifest: providerManifest, batch };
}

function ports(): GraphExecutionPorts {
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
  };
}

function evidenceIds(result: Awaited<ReturnType<typeof composeGraph>>): string[] {
  if (!result.accepted) return [];
  return [
    ...new Set(
      result.value.graph.edges.flatMap((edge) => edge.proof.evidence.map((entry) => entry.id))
    ),
  ].sort();
}

describe('composeGraph mutation isolation', () => {
  it('re-walks top-level confidence and evidence mutations between compose calls', async () => {
    const live = liveFact('fact:mutation');
    const request = {
      ontology,
      sources: [sourceFromFacts([live])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const first = await composeGraph(request, ports());
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.value.graph.edges[0]?.confidence).toBe(0.9);
    expect(evidenceIds(first)).toEqual(['e']);

    live.confidence = 0.8;
    live.evidence[0] = {
      id: 'e2',
      sourceKind: 'source-file',
      relativeLocator: 'src/index.ts',
      digest,
    };

    const second = await composeGraph(request, ports());
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    expect(second.value.semanticDigests.facts.value).not.toBe(
      first.value.semanticDigests.facts.value
    );
    expect(second.value.graph.generation.factSetDigest.value).not.toBe(
      first.value.graph.generation.factSetDigest.value
    );
    expect(second.value.graph.edges[0]?.confidence).toBe(0.8);
    expect(evidenceIds(second)).toEqual(['e2']);
    expect(evidenceIds(second)).not.toContain('e');
  });

  it('observes nested evidence, scope, extension and array mutations', async () => {
    const live = liveFact('fact:nested', {
      extensions: { tag: 'one' },
      unknownZones: [{ code: 'graph.test-unknown', scope: 'src/index.ts', reason: 'probe' }],
    });
    const request = {
      ontology,
      sources: [sourceFromFacts([live])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const first = await composeGraph(request, ports());
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;

    live.evidence[0]!.relativeLocator = 'src/changed.ts';
    (live.scope as { projectIds: string[] }).projectIds = ['project:mutated'];
    live.extensions = { tag: 'two' };
    live.unknownZones = [
      { code: 'graph.test-unknown', scope: 'src/changed.ts', reason: 'mutated' },
    ];

    const second = await composeGraph(request, ports());
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    expect(second.value.semanticDigests.facts.value).not.toBe(
      first.value.semanticDigests.facts.value
    );
    expect(second.value.receipt.factSetDigest.value).not.toBe(
      first.value.receipt.factSetDigest.value
    );
  });

  it('rejects a cycle introduced after a successful composition', async () => {
    const live = liveFact('fact:cycle');
    const request = {
      ontology,
      sources: [sourceFromFacts([live])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const first = await composeGraph(request, ports());
    expect(first.accepted).toBe(true);

    (live as { extensions?: unknown }).extensions = live;

    const second = await composeGraph(request, ports());
    expect(second.accepted).toBe(false);
  });

  it('does not let caller mutation after admission change the published graph', async () => {
    const live = liveFact('fact:after-admission');
    const first = await composeGraph(
      {
        ontology,
        sources: [sourceFromFacts([live])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const publishedDigest = first.value.graph.generation.factSetDigest.value;
    live.confidence = 0.51;
    live.evidence[0] = {
      id: 'e-after',
      sourceKind: 'source-file',
      relativeLocator: 'src/index.ts',
      digest,
    };
    expect(first.value.graph.generation.factSetDigest.value).toBe(publishedDigest);
    expect(first.value.graph.edges[0]?.confidence).toBe(0.9);
    expect(evidenceIds(first)).toEqual(['e']);
  });

  it('does not treat forged admission branding as a validation bypass', async () => {
    const live = liveFact('fact:forged-brand');
    const forged = {
      ...sourceFromFacts([live]),
      alreadyAdmitted: true,
      admitted: true,
      receipt: { schema: 'forged' },
    };
    live.confidence = Number.NaN;
    const result = await composeGraph(
      {
        ontology,
        sources: [forged as GraphCompositionSource],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      },
      ports()
    );
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(
      result.issues.some((item) => item.path.includes('/facts/') || item.code.includes('FACT'))
    ).toBe(true);
  });
});
