import { describe, expect, it } from 'vitest';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  CORE_GRAPH_ONTOLOGY_PROFILE,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_NARY_ASSERTION_CONTRACT,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_QUALITY_CONTRACT,
  GRAPH_QUERY_CACHE_CONTRACT,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT,
  GRAPH_QUERY_CACHE_REUSE_CONTRACT,
} from '../../src/contracts/index.js';
import {
  canonicalizeGraphValue,
  digestCanonicalGraphValue,
  validateCanonicalGraph,
  validateGraphModelGenerationBinding,
  validateGraphNaryAssertion,
  validateGraphOntologyProfile,
  validateGraphPublicationManifest,
  validateGraphQualityReport,
  validateGraphQueryCacheEntry,
  validateGraphQueryCacheInvalidation,
  validateGraphQueryCacheKey,
  validateGraphQueryCacheReuseDecision,
} from '../../src/conformance/index.js';

const digest = { algorithm: 'sha256', value: 'b'.repeat(64) };
const scope = { kind: 'project', projectIds: ['project:fixture'] };
const ontology = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.core',
  version: '0.1.0-candidate',
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
      allowedAuthorities: ['observed'],
      proofPolicy: { id: 'workspai.graph.proof.structural', version: '1' },
    },
  ],
} as const;

function graph() {
  return {
    contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
    graphVersion: '0.1.0-candidate',
    generation: {
      reference: { id: 'generation:1', generatedAt: '2026-09-08T12:00:00Z', contentDigest: digest },
      graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
      architectureEpoch: 'wis-graph-1',
      ontologySetDigest: digest,
      proofPolicySetDigest: digest,
      inputsDigest: digest,
      factSetDigest: digest,
      providerSetDigest: digest,
      compositionPolicyDigest: digest,
    },
    ontology: [{ id: ontology.id, version: ontology.version }],
    nodes: [
      { id: 'entity:source', identityScheme: GRAPH_IDENTITY_SCHEME, kind: 'file', scope },
      { id: 'entity:target', identityScheme: GRAPH_IDENTITY_SCHEME, kind: 'module', scope },
    ],
    edges: [
      {
        id: 'edge:imports:1',
        relation: 'imports',
        semantics: 'structural',
        from: 'entity:source',
        to: 'entity:target',
        state: 'accepted',
        facts: ['fact:1'],
        derivations: ['extracted'],
        proof: {
          policy: { id: 'workspai.graph.proof.structural', version: '1' },
          state: 'supported',
          authorities: ['observed'],
          evidence: [
            {
              id: 'evidence:1',
              sourceKind: 'source-file',
              relativeLocator: 'src/index.ts',
              digest,
            },
          ],
          corroborationGroups: [],
          counterEvidence: [],
          missingRequirements: [],
          evaluatedAt: '2026-09-08T12:00:00Z',
          inputDigest: digest,
          explanationCode: 'STRUCTURAL_IMPORT',
        },
        freshness: { status: 'current' },
        confidence: 0.99,
        explanation: { code: 'ACCEPTED', drivers: ['observed-import'] },
      },
    ],
    assertions: [],
    disputes: [],
    unresolved: [],
    diagnostics: [],
  };
}

describe('Graph G1 graph-domain contracts', () => {
  it('ships a self-consistent core ontology with the documented graph vocabulary', () => {
    expect(validateGraphOntologyProfile(CORE_GRAPH_ONTOLOGY_PROFILE)).toMatchObject({
      accepted: true,
    });
    expect(CORE_GRAPH_ONTOLOGY_PROFILE.entities.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'workspace',
        'project',
        'service',
        'file',
        'symbol',
        'endpoint',
        'deployment',
        'test',
        'decision',
        'agent-context',
      ])
    );
    expect(CORE_GRAPH_ONTOLOGY_PROFILE.relations.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'contains',
        'imports',
        'calls',
        'depends-on',
        'owned-by',
        'verified-by',
        'invalidates',
        'grounds',
      ])
    );
  });
  it('accepts an ontology and an evidence-backed canonical graph', () => {
    const ontologyResult = validateGraphOntologyProfile(ontology);
    expect(ontologyResult).toMatchObject({ accepted: true });
    expect(validateCanonicalGraph(graph(), ontology)).toMatchObject({ accepted: true });
  });

  it('rejects unresolved edge endpoints and unsupported relations', () => {
    const candidate = graph();
    candidate.edges[0] = { ...candidate.edges[0], to: 'entity:missing', relation: 'executes' };
    const result = validateCanonicalGraph(candidate, ontology);
    expect(result.accepted).toBe(false);
    if (!result.accepted)
      expect(result.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          'GRAPH_EDGE_ENDPOINT_UNRESOLVED',
          'GRAPH_EDGE_RELATION_UNSUPPORTED',
        ])
      );
  });

  it('rejects alias collisions and ontology-incompatible edge semantics', () => {
    const candidate = graph();
    Object.assign(candidate.nodes[1], {
      aliases: [{ id: candidate.nodes[0].id, reason: 'move' }],
    });
    candidate.edges[0] = { ...candidate.edges[0], semantics: 'behavioral' };
    const result = validateCanonicalGraph(candidate, ontology);
    expect(result.accepted).toBe(false);
    if (!result.accepted)
      expect(result.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining(['GRAPH_NODE_IDENTITY_COLLISION', 'GRAPH_EDGE_SEMANTICS_MISMATCH'])
      );
  });

  it('requires the full immutable generation dependency set', () => {
    const candidate = graph();
    candidate.generation = { ...candidate.generation, providerSetDigest: undefined } as never;
    expect(validateCanonicalGraph(candidate, ontology)).toMatchObject({ accepted: false });
  });

  it('preserves unresolved identity candidates as first-class graph state', () => {
    const candidate = graph();
    (candidate as unknown as Record<string, unknown>).unresolved = [
      {
        id: 'unresolved:import:1',
        candidates: ['entity:source', 'entity:target'],
      },
    ];
    const result = validateCanonicalGraph(candidate, ontology);
    expect(result).toMatchObject({ accepted: true });
    if (result.accepted) expect(result.value.unresolved).toHaveLength(1);
  });

  it('canonicalizes object order and rejects cycles and non-finite values', () => {
    expect(canonicalizeGraphValue({ z: 1, a: { y: 2, x: 3 } })).toMatchObject({
      accepted: true,
      value: '{"a":{"x":3,"y":2},"z":1}',
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(canonicalizeGraphValue(cyclic)).toMatchObject({ accepted: false });
    expect(canonicalizeGraphValue({ value: Number.NaN })).toMatchObject({ accepted: false });
  });

  it('replays the same content digest independent of object insertion order', () => {
    const first = digestCanonicalGraphValue({ z: [3, 2, 1], a: { y: true, x: 'value' } });
    const second = digestCanonicalGraphValue({ a: { x: 'value', y: true }, z: [3, 2, 1] });
    expect(first).toMatchObject({ accepted: true });
    expect(second).toEqual(first);
  });

  it('rejects adversarial nesting before recursive canonicalization can exhaust the runtime', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 300; index += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    expect(canonicalizeGraphValue(root)).toMatchObject({ accepted: false });
  });

  it('requires immutable generation and all semantic cache dependencies', () => {
    const key = {
      contract: GRAPH_QUERY_CACHE_CONTRACT,
      graphGeneration: graph().generation.reference,
      queryDigest: digest,
      ontologyDigest: digest,
      proofPolicyDigest: digest,
      profileDigest: digest,
      plannerProfileDigest: digest,
      resultProfileDigest: digest,
      projectionDigests: [],
      indexDigests: [],
      requiredExtensions: [],
      scope,
      redactionPolicyDigest: digest,
      authorizationDigest: digest,
      budget: { maxDepth: 4, maxNodes: 100, maxEdges: 200, maxEvidence: 100 },
    };
    expect(validateGraphQueryCacheKey(key)).toMatchObject({ accepted: true });
    expect(validateGraphQueryCacheKey({ ...key, authorizationDigest: undefined })).toMatchObject({
      accepted: false,
    });
    expect(validateGraphQueryCacheKey({ ...key, graphGeneration: { id: 'latest' } })).toMatchObject(
      { accepted: false }
    );
  });

  it('validates publication, model binding and every cache lifecycle envelope', () => {
    const source = graph();
    const key = {
      contract: GRAPH_QUERY_CACHE_CONTRACT,
      graphGeneration: source.generation.reference,
      queryDigest: digest,
      ontologyDigest: digest,
      proofPolicyDigest: digest,
      profileDigest: digest,
      plannerProfileDigest: digest,
      resultProfileDigest: digest,
      projectionDigests: [],
      indexDigests: [],
      requiredExtensions: [],
      scope,
      redactionPolicyDigest: digest,
      authorizationDigest: digest,
      budget: { maxDepth: 4, maxNodes: 100, maxEdges: 200, maxEvidence: 100 },
    };
    expect(
      validateGraphPublicationManifest({
        generation: source.generation,
        artifactDigest: digest,
        qualityDigest: digest,
        publication: 'committed',
      })
    ).toMatchObject({ accepted: true });
    expect(
      validateGraphModelGenerationBinding({
        graphGeneration: source.generation.reference,
        modelGeneration: {
          ...source.generation.reference,
          id: 'model-generation:1',
        },
        architectureEpoch: source.generation.architectureEpoch,
      })
    ).toMatchObject({ accepted: true });
    expect(
      validateGraphQueryCacheEntry({
        contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
        keyDigest: digest,
        key,
        result: null,
        resultDigest: digest,
        freshness: { status: 'current' },
      })
    ).toMatchObject({ accepted: true });
    expect(
      validateGraphQueryCacheReuseDecision({
        contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
        reusable: true,
        status: 'exact',
        entryDigest: digest,
      })
    ).toMatchObject({ accepted: true });
    expect(
      validateGraphQueryCacheReuseDecision({
        contract: GRAPH_QUERY_CACHE_REUSE_CONTRACT,
        reusable: false,
        status: 'denied',
        reasons: ['authorization-changed'],
      })
    ).toMatchObject({ accepted: true });
    expect(
      validateGraphQueryCacheInvalidation({
        contract: GRAPH_QUERY_CACHE_INVALIDATION_CONTRACT,
        keyDigests: [digest],
        reason: 'authorization',
      })
    ).toMatchObject({ accepted: true });
  });

  it('preserves role-labelled n-ary assertions and rejects role collapse', () => {
    const nodes = graph().nodes;
    const assertion = {
      contract: GRAPH_NARY_ASSERTION_CONTRACT,
      id: 'assertion:imports:1',
      relation: 'imports',
      profile: { id: ontology.id, version: ontology.version },
      participants: [
        { role: 'consumer', entity: nodes[0] },
        { role: 'dependency', entity: nodes[1] },
      ],
      facts: ['fact:1'],
      derivation: 'extracted',
      state: 'accepted',
      proof: graph().edges[0].proof,
      freshness: { status: 'current' },
      confidence: 0.99,
    };
    expect(validateGraphNaryAssertion(assertion, ontology)).toMatchObject({ accepted: true });
    expect(
      validateGraphNaryAssertion(
        {
          ...assertion,
          participants: [
            { role: 'member', entity: nodes[0] },
            { role: 'member', entity: nodes[1] },
          ],
        },
        ontology
      )
    ).toMatchObject({ accepted: false });
  });

  it('blocks complete quality claims when provider evidence failed', () => {
    const quality = {
      contract: GRAPH_QUALITY_CONTRACT,
      generation: graph().generation.reference,
      integrity: 'attention',
      determinism: 'pass',
      incrementalEquivalence: 'not-assessed',
      coverage: [],
      proofStates: {
        supported: 1,
        corroborated: 0,
        verified: 0,
        disputed: 0,
        insufficient: 0,
        unresolved: 0,
      },
      unknownZones: [],
      unsupportedZones: [],
      staleZones: [],
      conflicts: [],
      orphans: [],
      providerFailures: [{ providerId: 'fixture.failed', code: 'PROVIDER_FAILED' }],
      releaseClaims: ['complete'],
    };
    const result = validateGraphQualityReport(quality);
    expect(result.accepted).toBe(false);
    if (!result.accepted)
      expect(result.issues.map((item) => item.code)).toContain(
        'GRAPH_QUALITY_COMPLETE_CLAIM_INVALID'
      );
  });
});
