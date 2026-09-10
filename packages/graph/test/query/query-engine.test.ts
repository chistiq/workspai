import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES,
  GRAPH_QUERY_CONTRACT,
  GRAPH_QUERY_CACHE_CONTRACT,
  GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
  GRAPH_STANDARD_BINDING_PROFILES,
  GRAPH_QUERY_PRESETS,
  GRAPH_PROOF_POLICY_CONTRACT,
  type GraphCanonicalGraph,
  type GraphEdge,
  type GraphEntityReference,
  type GraphQuery,
  type GraphQueryCacheEntry,
} from '../../src/contracts/index.js';
import {
  assessGraphEdgeProof,
  createQueryCacheKey,
  evaluateGraphQueryCacheReuse,
  normalizeGraphQuery,
  queryGraph,
} from '../../src/index.js';
import { applyQueryCacheInvalidations } from '../../src/application/query-cache.js';
import { planQueryCacheInvalidation } from '../../src/application/plan-query-cache-invalidation.js';
import {
  validateGraphBindingProfile,
  validateGraphProofPolicy,
  validateGraphQuery,
  validateGraphQueryResult,
} from '../../src/conformance/index.js';
import type { GraphQueryCacheStorePort } from '../../src/ports/index.js';

const digest = { algorithm: 'sha256', value: 'a'.repeat(64) } as const;
const scope = { kind: 'project' as const, projectIds: ['project:query-fixture'] as [string] };
const digestPort = {
  algorithm: 'sha256' as const,
  digest: async (input: Uint8Array) => createHash('sha256').update(input).digest('hex'),
};

function node(id: string, kind: string): GraphEntityReference {
  return { id, kind, scope, identityScheme: GRAPH_IDENTITY_SCHEME };
}

const nodes = [
  node('endpoint:login', 'endpoint'),
  node('symbol:login', 'symbol'),
  node('test:login', 'test'),
  node('service:identity', 'service'),
  node('deployment:identity', 'deployment'),
  node('team:identity', 'team'),
  node('module:cycle-a', 'module'),
  node('module:cycle-b', 'module'),
];

function edge(
  id: string,
  from: string,
  relation: string,
  to: string,
  semantics: GraphEdge['semantics'] = 'structural',
  state: GraphEdge['state'] = 'accepted'
): GraphEdge {
  return {
    id,
    from,
    to,
    relation,
    semantics,
    state,
    facts: [`fact:${id}`],
    derivations: ['extracted'],
    proof: {
      policy: { id: 'workspai.graph.proof.standard', version: '1' },
      state: state === 'disputed' ? 'disputed' : 'corroborated',
      authorities: ['observed'],
      evidence: [
        {
          id: `evidence:${id}`,
          sourceKind: 'source-file',
          relativeLocator: `src/${id}.ts`,
          digest,
        },
      ],
      corroborationGroups: [],
      counterEvidence: [],
      missingRequirements: [],
      evaluatedAt: '2026-09-09T00:00:00Z',
      inputDigest: digest,
      explanationCode: 'GRAPH_EDGE_CORROBORATED',
    },
    freshness: { status: 'current' },
    confidence: 0.9,
    explanation: { code: 'GRAPH_EDGE_CORROBORATED', drivers: ['independent evidence roots'] },
  };
}

const edges = [
  edge('endpoint-implementation', 'symbol:login', 'implements', 'endpoint:login'),
  edge('implementation-test', 'symbol:login', 'verified-by', 'test:login', 'derived'),
  edge(
    'service-deployment',
    'service:identity',
    'deployed-as',
    'deployment:identity',
    'declarative'
  ),
  edge('deployment-owner', 'deployment:identity', 'owned-by', 'team:identity', 'declarative'),
  edge('cycle-a-b', 'module:cycle-a', 'depends-on', 'module:cycle-b'),
  edge('cycle-b-a', 'module:cycle-b', 'depends-on', 'module:cycle-a'),
  edge(
    'disputed-owner',
    'service:identity',
    'owned-by',
    'team:identity',
    'declarative',
    'disputed'
  ),
];

const graph: GraphCanonicalGraph = {
  contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
  graphVersion: '0.1.0-candidate',
  generation: {
    reference: {
      id: 'generation:query-fixture',
      generatedAt: '2026-09-09T00:00:00Z',
      contentDigest: digest,
    },
    graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
    architectureEpoch: 'wis-graph-1',
    ontologySetDigest: digest,
    proofPolicySetDigest: digest,
    inputsDigest: digest,
    factSetDigest: digest,
    providerSetDigest: digest,
    compositionPolicyDigest: digest,
  },
  ontology: [{ id: 'workspai.graph.ontology.core', version: '0.1.0-candidate' }],
  nodes,
  edges,
  assertions: [],
  disputes: [{ id: 'dispute:owner', factIds: ['fact:disputed-owner'] }],
  unresolved: [],
  diagnostics: [],
};

function query(input: Omit<GraphQuery, 'contract'>): GraphQuery {
  return { contract: GRAPH_QUERY_CONTRACT, ...input };
}

describe('Graph G3 deterministic query engine', () => {
  it('returns a proof-carrying API to controller to test path', async () => {
    const output = await queryGraph(
      graph,
      query({
        kind: 'path',
        subject: 'endpoint:login',
        target: 'test:login',
        relations: ['implements', 'verified-by'],
        direction: 'both',
      }),
      digestPort
    );

    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.paths).toHaveLength(1);
    expect(output.value.paths[0]?.nodes.map((item) => item.id)).toEqual([
      'endpoint:login',
      'symbol:login',
      'test:login',
    ]);
    expect(output.value.paths[0]?.hops.every((hop) => hop.evidence.length > 0)).toBe(true);
    expect(output.value).toMatchObject({
      generation: { id: 'generation:query-fixture' },
      disputes: [],
      unknownBoundaries: [],
      retrievalPlan: { selected: 'graph' },
      truncation: { truncated: false },
    });
  });

  it('applies an exact service to deployment to owner binding profile', async () => {
    const profile = GRAPH_STANDARD_BINDING_PROFILES.serviceDeploymentOwnership;
    const output = await queryGraph(
      graph,
      query({
        kind: 'bindings',
        subject: 'service:identity',
        relations: ['deployed-as', 'owned-by'],
        bindingProfile: { id: profile.id, version: profile.version },
        budget: { maxDepth: 2 },
      }),
      digestPort,
      { bindingProfiles: [profile] }
    );

    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.paths.map((path) => path.nodes.map((item) => item.id))).toContainEqual([
      'service:identity',
      'deployment:identity',
      'team:identity',
    ]);
    expect(output.value.quality.bindingCompleteness).toContainEqual(
      expect.objectContaining({ status: 'complete', ratio: 1 })
    );
  });

  it('applies mixed-direction binding steps without caller traversal hints', async () => {
    const profile = GRAPH_STANDARD_BINDING_PROFILES.apiImplementationVerification;
    const output = await queryGraph(
      graph,
      query({
        kind: 'bindings',
        subject: 'endpoint:login',
        bindingProfile: { id: profile.id, version: profile.version },
      }),
      digestPort,
      { bindingProfiles: [profile] }
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.query.direction).toBe('both');
    expect(output.value.paths[0]?.nodes.map((item) => item.id)).toEqual([
      'endpoint:login',
      'symbol:login',
      'test:login',
    ]);
  });

  it('finds deterministic cycles without following disputed edges by default', async () => {
    const output = await queryGraph(
      graph,
      query({ kind: 'cycles', subject: 'module:cycle-a', budget: { maxDepth: 3 } }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.paths[0]?.nodes.map((item) => item.id)).toEqual([
      'module:cycle-a',
      'module:cycle-b',
      'module:cycle-a',
    ]);
    expect(output.value.disputes).toEqual([]);
  });

  it('returns disputed relations only after explicit opt-in', async () => {
    const output = await queryGraph(
      graph,
      query({
        kind: 'owners',
        subject: 'service:identity',
        includeDisputed: true,
      }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.paths.some((path) => path.hops[0]?.decision === 'disputed')).toBe(true);
    expect(output.value.disputes).toContainEqual({
      id: 'dispute:owner',
      factIds: ['fact:disputed-owner'],
    });
  });

  it('uses canonical normalization and deterministic pagination', async () => {
    const left = normalizeGraphQuery(
      query({
        kind: 'related',
        subject: 'service:identity',
        relations: ['owned-by', 'deployed-as', 'owned-by'],
      })
    );
    const right = normalizeGraphQuery(
      query({
        kind: 'related',
        subject: 'service:identity',
        relations: ['deployed-as', 'owned-by'],
      })
    );
    expect(left).toEqual(right);
    const first = await queryGraph(
      graph,
      query({
        kind: 'related',
        subject: 'service:identity',
        relations: ['deployed-as', 'owned-by'],
        page: { size: 1 },
      }),
      digestPort
    );
    expect(first).toMatchObject({ accepted: true });
    if (!first.accepted) return;
    expect(first.value.truncation).toMatchObject({ truncated: true, nextCursor: 'offset:1' });
  });

  it('fails closed for unknown binding profiles and invalid cursors', async () => {
    await expect(
      queryGraph(
        graph,
        query({
          kind: 'bindings',
          subject: 'service:identity',
          bindingProfile: { id: 'missing', version: '1' },
        }),
        digestPort
      )
    ).resolves.toMatchObject({ accepted: false, code: 'unsupported' });
    await expect(
      queryGraph(
        graph,
        query({
          kind: 'related',
          subject: 'service:identity',
          page: { size: 10, cursor: '../escape' },
        }),
        digestPort
      )
    ).resolves.toMatchObject({ accepted: false, code: 'invalid-query' });
  });

  it('requires binding profiles and enforces their proof floor before traversal', async () => {
    await expect(
      queryGraph(graph, query({ kind: 'bindings', subject: 'service:identity' }), digestPort)
    ).resolves.toMatchObject({
      accepted: false,
      code: 'invalid-query',
      issues: [{ code: 'GRAPH_QUERY_BINDING_PROFILE_REQUIRED' }],
    });

    const verifiedProfile = {
      ...GRAPH_STANDARD_BINDING_PROFILES.serviceDeploymentOwnership,
      id: 'workspai.graph.binding.service-deployment-ownership.verified',
      minimumProof: 'verified' as const,
    };
    const output = await queryGraph(
      graph,
      query({
        kind: 'bindings',
        subject: 'service:identity',
        bindingProfile: { id: verifiedProfile.id, version: verifiedProfile.version },
      }),
      digestPort,
      { bindingProfiles: [verifiedProfile] }
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.query.minimumProof).toBe('verified');
    expect(output.value.paths).toEqual([]);
    expect(output.value.unknownBoundaries).toContainEqual(
      expect.objectContaining({ code: 'GRAPH_BINDING_INCOMPLETE', scope: 'service:identity' })
    );
  });

  it('fails closed when a claimed canonical generation has broken topology', async () => {
    await expect(
      queryGraph(
        { ...graph, edges: [...graph.edges, { ...edges[0], id: 'broken', to: 'missing' }] },
        query({ kind: 'dependencies', subject: 'module:cycle-a' }),
        digestPort
      )
    ).resolves.toMatchObject({
      accepted: false,
      issues: [{ code: 'GRAPH_QUERY_GRAPH_EDGE_UNRESOLVED' }],
    });
    await expect(
      queryGraph(
        { ...graph, nodes: [...graph.nodes, graph.nodes[0] as GraphEntityReference] },
        query({ kind: 'dependencies', subject: 'module:cycle-a' }),
        digestPort
      )
    ).resolves.toMatchObject({
      accepted: false,
      issues: [{ code: 'GRAPH_QUERY_GRAPH_NODE_DUPLICATE' }],
    });
  });

  it('makes missing contract topology evidence explicit', async () => {
    const output = await queryGraph(
      graph,
      query({ kind: 'contract-topology', relations: ['declares'] }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.unknownBoundaries).toContainEqual(
      expect.objectContaining({
        code: 'GRAPH_CONTRACT_BINDING_UNOBSERVED',
        scope: 'endpoint:login',
      })
    );
  });

  it('enforces scope and reports deterministic evidence truncation', async () => {
    const outsideScope = { kind: 'project' as const, projectIds: ['project:other'] as [string] };
    await expect(
      queryGraph(
        graph,
        query({ kind: 'related', subject: 'service:identity', scope: outsideScope }),
        digestPort
      )
    ).resolves.toMatchObject({
      accepted: false,
      issues: [{ code: 'GRAPH_QUERY_SUBJECT_OUTSIDE_SCOPE' }],
    });

    const output = await queryGraph(
      graph,
      query({
        kind: 'related',
        subject: 'service:identity',
        relations: ['deployed-as', 'owned-by'],
        budget: { maxEvidence: 1 },
      }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.evidence).toHaveLength(1);
    expect(output.value.truncation.reasons).toContain('evidence');
  });

  it('does not turn a mixed semantic path into a structural risk claim', async () => {
    const output = await queryGraph(
      graph,
      query({
        kind: 'operational-risk',
        subject: 'endpoint:login',
        relations: ['implements', 'verified-by'],
        direction: 'both',
        budget: { maxDepth: 2 },
      }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.result).toContainEqual(
      expect.objectContaining({
        score: null,
        classification: 'unassessed',
        consequenceSemantics: 'indeterminate',
      })
    );
  });

  it('ships versioned deterministic presets for product consumers', () => {
    expect(GRAPH_QUERY_PRESETS.architectureConformance).toMatchObject({
      id: 'workspai.graph.query.architecture-conformance',
      version: '0.1.0-candidate',
      query: { kind: 'architecture-conformance', strategy: 'hybrid' },
    });
    expect(GRAPH_QUERY_PRESETS.reviewContext).toMatchObject({
      id: 'workspai.graph.query.review-context',
      version: '0.1.0-candidate',
      query: {
        kind: 'architecture-conformance',
        strategy: 'hybrid',
        budget: { maxNodes: 150, maxEdges: 300, maxEvidence: 150 },
      },
    });
    expect(GRAPH_STANDARD_BINDING_PROFILES.apiImplementationVerification.steps).toHaveLength(2);
  });

  it('reports an explicit unknown boundary when no proven path exists', async () => {
    const output = await queryGraph(
      graph,
      query({
        kind: 'path',
        subject: 'endpoint:login',
        target: 'team:identity',
        relations: ['owned-by'],
      }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(output.value.paths).toEqual([]);
    expect(output.value.unknownBoundaries[0]?.code).toBe('GRAPH_QUERY_NO_PROVEN_PATH');
    expect(output.value.utility).toMatchObject({ status: 'not-assessed', sufficient: false });
  });

  it('admits proof only under its exact versioned policy and authority floor', () => {
    const policy = {
      contract: GRAPH_PROOF_POLICY_CONTRACT,
      id: 'workspai.graph.proof.standard',
      version: '1',
      minimumAuthority: 'observed' as const,
      minimumIndependentRoots: 1,
      verificationRequired: false,
      allowDisputed: false,
      allowStale: false,
    };
    const candidate = {
      ...edges[0],
      proof: {
        ...edges[0]?.proof,
        corroborationGroups: [{ root: 'source:one', evidence: edges[0]?.proof.evidence ?? [] }],
      },
    } as GraphEdge;
    expect(validateGraphProofPolicy(policy)).toMatchObject({ accepted: true });
    expect(assessGraphEdgeProof(candidate, policy)).toEqual({
      admitted: true,
      state: 'admitted',
      reasons: [],
    });
    expect(
      assessGraphEdgeProof(candidate, { ...policy, verificationRequired: true })
    ).toMatchObject({ admitted: false, state: 'insufficient' });
    expect(assessGraphEdgeProof(candidate, { ...policy, version: '2' })).toMatchObject({
      admitted: false,
      state: 'policy-mismatch',
    });
  });

  it('rejects malformed query and binding contracts before traversal', async () => {
    expect(validateGraphQuery({})).toMatchObject({ accepted: false });
    expect(validateGraphBindingProfile({})).toMatchObject({ accepted: false });
    expect(validateGraphProofPolicy(null)).toMatchObject({ accepted: false });
    expect(
      validateGraphProofPolicy({
        contract: {},
        id: '',
        version: '',
        minimumAuthority: 'invented',
        minimumIndependentRoots: 0,
        verificationRequired: 'yes',
        allowDisputed: 'yes',
        allowStale: 'yes',
      })
    ).toMatchObject({ accepted: false });
    expect(
      validateGraphBindingProfile({
        contract: {},
        id: '',
        version: '',
        sourceKinds: [],
        steps: [{ relations: [], direction: 'sideways', semantics: ['invented'] }],
        minimumProof: 'invented',
      })
    ).toMatchObject({ accepted: false });
    expect(
      validateGraphQuery({
        contract: {},
        kind: 'invented',
        relations: ['same', 'same'],
        strategy: 'invented',
        minimumProof: 'invented',
        includeDisputed: 'yes',
      })
    ).toMatchObject({ accepted: false });
    await expect(
      queryGraph(graph, { contract: GRAPH_QUERY_CONTRACT, kind: 'invented' } as never, digestPort)
    ).resolves.toMatchObject({ accepted: false, code: 'invalid-query' });
  });

  it('rejects similarity and vector strategies before traversal or cache reuse', async () => {
    for (const strategy of GRAPH_PROHIBITED_RETRIEVAL_STRATEGIES) {
      expect(
        validateGraphQuery({
          contract: GRAPH_QUERY_CONTRACT,
          kind: 'related',
          subject: 'service:identity',
          strategy,
        })
      ).toMatchObject({
        accepted: false,
        issues: [expect.objectContaining({ code: 'GRAPH_QUERY_STRATEGY_PROHIBITED' })],
      });
      await expect(
        queryGraph(
          graph,
          query({ kind: 'related', subject: 'service:identity', strategy: strategy as never }),
          digestPort
        )
      ).resolves.toMatchObject({
        accepted: false,
        code: 'invalid-query',
        issues: [expect.objectContaining({ code: 'GRAPH_QUERY_STRATEGY_PROHIBITED' })],
      });
    }
    const normalized = normalizeGraphQuery(
      query({ kind: 'related', subject: 'service:identity', strategy: 'similarity' as never })
    );
    expect(['direct', 'graph', 'hybrid']).toContain(normalized.strategy);
    expect(normalized.strategy).not.toBe('similarity');
  });

  it('validates the complete machine result envelope', async () => {
    const output = await queryGraph(
      graph,
      query({ kind: 'dependencies', subject: 'module:cycle-a' }),
      digestPort
    );
    expect(output).toMatchObject({ accepted: true });
    if (!output.accepted) return;
    expect(validateGraphQueryResult(output.value)).toMatchObject({ accepted: true });
    expect(
      validateGraphQueryResult({ ...output.value, unknownBoundaries: undefined })
    ).toMatchObject({
      accepted: false,
    });
    expect(validateGraphQueryResult(null)).toMatchObject({ accepted: false });
    expect(
      validateGraphQueryResult({
        contract: {},
        paths: null,
        evidence: null,
        disputes: null,
        unknownBoundaries: null,
        diagnostics: null,
        generation: {},
        confidence: 2,
      })
    ).toMatchObject({ accepted: false });
  });

  it('reuses cache entries only under exact semantic and authorization dependencies', () => {
    const key = {
      contract: GRAPH_QUERY_CACHE_CONTRACT,
      graphGeneration: graph.generation.reference,
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
      budget: { maxDepth: 4, maxNodes: 500, maxEdges: 1_000, maxEvidence: 200 },
    };
    const entry = {
      contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
      keyDigest: digest,
      key,
      result: null,
      resultDigest: digest,
      freshness: { status: 'current' as const },
    };
    expect(evaluateGraphQueryCacheReuse(key, entry)).toMatchObject({
      reusable: true,
      status: 'exact',
    });
    expect(
      evaluateGraphQueryCacheReuse(
        { ...key, plannerProfileDigest: { ...digest, value: 'b'.repeat(64) } },
        entry
      )
    ).toMatchObject({ reusable: false, status: 'incompatible' });
    expect(
      evaluateGraphQueryCacheReuse(
        { ...key, authorizationDigest: { ...digest, value: 'c'.repeat(64) } },
        entry
      )
    ).toMatchObject({ reusable: false, status: 'denied' });
    expect(
      evaluateGraphQueryCacheReuse(key, {
        ...entry,
        freshness: { status: 'stale' as const },
      })
    ).toMatchObject({ reusable: false, status: 'stale' });
    expect(
      evaluateGraphQueryCacheReuse(
        {
          ...key,
          requiredExtensions: [
            { id: 'z', version: '1' },
            { id: 'a', version: '1' },
          ],
        },
        entry
      )
    ).toMatchObject({ reusable: false, status: 'incompatible' });
    expect(
      evaluateGraphQueryCacheReuse(key, {
        ...entry,
        resultDigest: { algorithm: 'sha256', value: 'bad' },
      })
    ).toMatchObject({ reusable: false, status: 'corrupt' });
  });

  it('classifies disputed, stale and insufficient proof without upgrading it', () => {
    const policy = {
      contract: GRAPH_PROOF_POLICY_CONTRACT,
      id: 'workspai.graph.proof.standard',
      version: '1',
      minimumAuthority: 'verified' as const,
      minimumIndependentRoots: 2,
      verificationRequired: false,
      allowDisputed: false,
      allowStale: false,
    };
    expect(assessGraphEdgeProof(edges.at(-1) as GraphEdge, policy)).toMatchObject({
      admitted: false,
      state: 'disputed',
    });
    expect(
      assessGraphEdgeProof(
        { ...edges[0], freshness: { status: 'stale', reason: 'changed input' } } as GraphEdge,
        policy
      )
    ).toMatchObject({ admitted: false, state: 'stale' });
    expect(assessGraphEdgeProof(edges[0] as GraphEdge, policy)).toMatchObject({
      admitted: false,
      state: 'insufficient',
    });
  });
});

function memoryQueryCacheStore(): GraphQueryCacheStorePort & {
  readonly entries: Map<string, GraphQueryCacheEntry>;
} {
  const entries = new Map<string, GraphQueryCacheEntry>();
  return {
    entries,
    async get(keyDigest) {
      return entries.get(`${keyDigest.algorithm}:${keyDigest.value}`);
    },
    async publish(entry) {
      entries.set(`${entry.keyDigest.algorithm}:${entry.keyDigest.value}`, entry);
    },
    async invalidate(keyDigests) {
      for (const keyDigest of keyDigests) {
        entries.delete(`${keyDigest.algorithm}:${keyDigest.value}`);
      }
    },
  };
}

function cachePolicy(
  overrides: {
    readonly authorizationDigest?: typeof digest;
    readonly redactionPolicyDigest?: typeof digest;
    readonly plannerProfileDigest?: typeof digest;
  } = {}
) {
  return {
    redactionPolicyDigest: digest,
    authorizationDigest: digest,
    ...overrides,
  };
}

const cachedPathQuery = () =>
  query({
    kind: 'path',
    subject: 'endpoint:login',
    target: 'test:login',
    relations: ['implements', 'verified-by'],
    direction: 'both',
  });

describe('optional query cache store', () => {
  it('creates generation, budget and authorization-bound keys', async () => {
    const normalized = normalizeGraphQuery(
      query({
        kind: 'related',
        subject: 'service:identity',
        page: { cursor: 'offset:0', size: 10 },
        budget: { maxDepth: 2, maxNodes: 500, maxEdges: 1_000, maxEvidence: 200 },
      })
    );
    const key = await createQueryCacheKey({
      graph,
      query: normalized,
      digest: digestPort,
      policy: cachePolicy(),
    });
    expect(key.graphGeneration).toEqual(graph.generation.reference);
    expect(key.budget).toEqual({ maxDepth: 2, maxNodes: 500, maxEdges: 1_000, maxEvidence: 200 });
    expect(key.authorizationDigest).toEqual(digest);
    expect(key.page).toEqual({ cursor: 'offset:0', size: 10 });
    const otherBudget = await createQueryCacheKey({
      graph,
      query: normalizeGraphQuery({ ...normalized, budget: { ...normalized.budget, maxDepth: 3 } }),
      digest: digestPort,
      policy: cachePolicy(),
    });
    expect(otherBudget.queryDigest.value).not.toBe(key.queryDigest.value);
    const otherAuth = await createQueryCacheKey({
      graph,
      query: normalized,
      digest: digestPort,
      policy: cachePolicy({ authorizationDigest: { ...digest, value: 'c'.repeat(64) } }),
    });
    expect(otherAuth.authorizationDigest.value).not.toBe(key.authorizationDigest.value);
  });

  it('returns cached results equivalent to uncached execution and keeps historical cost', async () => {
    const input = cachedPathQuery();
    const uncached = await queryGraph(graph, input, digestPort);
    expect(uncached).toMatchObject({ accepted: true });
    if (!uncached.accepted) return;
    expect(uncached).not.toHaveProperty('cache');
    expect(uncached.value).not.toHaveProperty('cache');

    const store = memoryQueryCacheStore();
    const options = { cache: { store, policy: cachePolicy() } };
    const miss = await queryGraph(graph, input, digestPort, options);
    expect(miss).toMatchObject({ accepted: true, cache: { status: 'miss' } });
    if (!miss.accepted) return;
    expect(store.entries.size).toBe(1);

    const hit = await queryGraph(graph, input, digestPort, options);
    expect(hit).toMatchObject({ accepted: true, cache: { status: 'hit' } });
    if (!hit.accepted) return;
    expect(hit.value).toEqual(uncached.value);
    expect(hit.value).toEqual(miss.value);
    expect(hit.value.cost).toEqual(miss.value.cost);
    expect(validateGraphQueryResult(hit.value)).toMatchObject({ accepted: true });
  });

  it('does not publish in read-only mode and still hits a populated store', async () => {
    const input = cachedPathQuery();
    const store = memoryQueryCacheStore();
    const miss = await queryGraph(graph, input, digestPort, {
      cache: { store, mode: 'read-only', policy: cachePolicy() },
    });
    expect(miss).toMatchObject({ accepted: true, cache: { status: 'miss' } });
    expect(store.entries.size).toBe(0);

    await queryGraph(graph, input, digestPort, {
      cache: { store, mode: 'read-write', policy: cachePolicy() },
    });
    const hit = await queryGraph(graph, input, digestPort, {
      cache: { store, mode: 'read-only', policy: cachePolicy() },
    });
    expect(hit).toMatchObject({ accepted: true, cache: { status: 'hit' } });
  });

  it('executes live when the store is unavailable, corrupt, stale or denied', async () => {
    const input = cachedPathQuery();
    const uncached = await queryGraph(graph, input, digestPort);
    if (!uncached.accepted) return;

    const unavailable = await queryGraph(graph, input, digestPort, {
      cache: {
        store: {
          async get() {
            throw new Error('down');
          },
          async publish() {
            throw new Error('down');
          },
          async invalidate() {
            throw new Error('down');
          },
        },
        policy: cachePolicy(),
      },
    });
    expect(unavailable).toMatchObject({ accepted: true, cache: { status: 'unavailable' } });
    if (!unavailable.accepted) return;
    expect(unavailable.value).toEqual(uncached.value);

    const store = memoryQueryCacheStore();
    const options = { cache: { store, policy: cachePolicy() } };
    await queryGraph(graph, input, digestPort, options);
    const recorded = [...store.entries.entries()][0];
    if (!recorded) throw new Error('expected a published cache entry');
    const [mapKey, entry] = recorded;

    store.entries.set(mapKey, { ...entry, result: { contract: {} } });
    const corrupt = await queryGraph(graph, input, digestPort, options);
    expect(corrupt).toMatchObject({ accepted: true, cache: { status: 'corrupt' } });
    if (!corrupt.accepted) return;
    expect(corrupt.value).toEqual(uncached.value);

    store.entries.set(mapKey, { ...entry, freshness: { status: 'stale' } });
    const stale = await queryGraph(graph, input, digestPort, options);
    expect(stale).toMatchObject({ accepted: true, cache: { status: 'stale' } });

    store.entries.set(mapKey, {
      ...entry,
      key: { ...entry.key, authorizationDigest: { ...digest, value: 'c'.repeat(64) } },
    });
    const denied = await queryGraph(graph, input, digestPort, options);
    expect(denied).toMatchObject({ accepted: true, cache: { status: 'denied' } });

    store.entries.set(mapKey, {
      ...entry,
      key: { ...entry.key, plannerProfileDigest: { ...digest, value: 'b'.repeat(64) } },
    });
    const incompatible = await queryGraph(graph, input, digestPort, options);
    expect(incompatible).toMatchObject({ accepted: true, cache: { status: 'incompatible' } });
  });

  it('skips caching when no scope can be bound and still returns the live result', async () => {
    const output = await queryGraph(graph, query({ kind: 'entry-points' }), digestPort, {
      cache: { store: memoryQueryCacheStore(), policy: cachePolicy() },
    });
    expect(output).toMatchObject({
      accepted: true,
      cache: { status: 'unavailable', reasons: ['GRAPH_QUERY_CACHE_SCOPE_MISSING'] },
    });
    if (!output.accepted) return;
    expect(output.value.result.length).toBeGreaterThan(0);
  });

  it('does not address cache keys with a latest generation alias', async () => {
    const aliased: GraphCanonicalGraph = {
      ...graph,
      generation: {
        ...graph.generation,
        reference: { ...graph.generation.reference, id: 'latest' },
      },
    };
    await expect(
      createQueryCacheKey({
        graph: aliased,
        query: normalizeGraphQuery(cachedPathQuery()),
        digest: digestPort,
        policy: cachePolicy(),
      })
    ).rejects.toThrow('GRAPH_QUERY_CACHE_MUTABLE_GENERATION');
    const live = await queryGraph(aliased, cachedPathQuery(), digestPort, {
      cache: { store: memoryQueryCacheStore(), policy: cachePolicy() },
    });
    expect(live).toMatchObject({
      accepted: true,
      cache: { status: 'unavailable', reasons: ['GRAPH_QUERY_CACHE_MUTABLE_GENERATION'] },
    });
  });

  it('applies planned invalidations atomically and leaves unspecified keys', async () => {
    const store = memoryQueryCacheStore();
    const keep = {
      contract: GRAPH_QUERY_CACHE_ENTRY_CONTRACT,
      keyDigest: { algorithm: 'sha256' as const, value: '1'.repeat(64) },
      key: {
        contract: GRAPH_QUERY_CACHE_CONTRACT,
        graphGeneration: graph.generation.reference,
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
        budget: { maxDepth: 4, maxNodes: 100, maxEdges: 200, maxEvidence: 50 },
      },
      result: null,
      resultDigest: digest,
      freshness: { status: 'current' as const },
    };
    const drop = {
      ...keep,
      keyDigest: { algorithm: 'sha256' as const, value: '2'.repeat(64) },
      key: { ...keep.key, authorizationDigest: { ...digest, value: 'c'.repeat(64) } },
    };
    await store.publish(keep);
    await store.publish(drop);
    const planned = planQueryCacheInvalidation({
      entries: [keep, drop],
      currentAuthorizationDigest: digest,
    });
    await applyQueryCacheInvalidations({ store, invalidations: planned });
    expect(store.entries.has(`${keep.keyDigest.algorithm}:${keep.keyDigest.value}`)).toBe(true);
    expect(store.entries.has(`${drop.keyDigest.algorithm}:${drop.keyDigest.value}`)).toBe(false);
  });
});
