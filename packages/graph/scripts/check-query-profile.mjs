import { createHash } from 'node:crypto';

import { queryGraph } from '../dist/index.js';
import {
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_QUERY_CONTRACT,
} from '../dist/contracts/index.js';

const contentDigest = { algorithm: 'sha256', value: 'a'.repeat(64) };
const scope = { kind: 'project', projectIds: ['project:query-scale'] };
const digest = {
  algorithm: 'sha256',
  digest: async (input) => createHash('sha256').update(input).digest('hex'),
};

function graph(edgeCount) {
  const nodes = Array.from({ length: edgeCount + 1 }, (_, index) => ({
    id: `module:${String(index).padStart(8, '0')}`,
    kind: 'module',
    scope,
    identityScheme: GRAPH_IDENTITY_SCHEME,
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    id: `edge:${String(index).padStart(8, '0')}`,
    from: nodes[index].id,
    to: nodes[index + 1].id,
    relation: 'depends-on',
    semantics: 'structural',
    state: 'accepted',
    facts: [`fact:${index}`],
    derivations: ['extracted'],
    proof: {
      policy: { id: 'workspai.graph.proof.standard', version: '1' },
      state: 'supported',
      authorities: ['observed'],
      evidence: [
        {
          id: `evidence:${index}`,
          sourceKind: 'source-file',
          relativeLocator: `src/module-${index}.ts`,
          digest: contentDigest,
        },
      ],
      corroborationGroups: [],
      counterEvidence: [],
      missingRequirements: [],
      evaluatedAt: '2026-09-09T00:00:00Z',
      inputDigest: contentDigest,
      explanationCode: 'GRAPH_EDGE_SUPPORTED',
    },
    freshness: { status: 'current' },
    confidence: 0.9,
    explanation: { code: 'GRAPH_EDGE_ACCEPTED', drivers: ['scale-fixture'] },
  }));
  return {
    contract: GRAPH_CANONICAL_GRAPH_CONTRACT,
    graphVersion: '0.1.0-candidate',
    generation: {
      reference: {
        id: `generation:scale:${edgeCount}`,
        generatedAt: '2026-09-09T00:00:00Z',
        contentDigest,
      },
      graphSchema: GRAPH_CANONICAL_GRAPH_CONTRACT,
      architectureEpoch: 'wis-graph-1',
      ontologySetDigest: contentDigest,
      proofPolicySetDigest: contentDigest,
      inputsDigest: contentDigest,
      factSetDigest: contentDigest,
      providerSetDigest: contentDigest,
      compositionPolicyDigest: contentDigest,
    },
    ontology: [{ id: 'workspai.graph.ontology.core', version: '0.1.0-candidate' }],
    nodes,
    edges,
    assertions: [],
    disputes: [],
    unresolved: [],
    diagnostics: [],
  };
}

const profiles = [
  { name: 'small', edges: 100, iterations: 30, p95BudgetMs: 25 },
  { name: 'normal', edges: 5_000, iterations: 15, p95BudgetMs: 150 },
  { name: 'large', edges: 25_000, iterations: 8, p95BudgetMs: 750 },
];

for (const profile of profiles) {
  const fixture = graph(profile.edges);
  const query = {
    contract: GRAPH_QUERY_CONTRACT,
    kind: 'dependencies',
    subject: fixture.nodes[0].id,
    budget: { maxDepth: 4, maxNodes: 10, maxEdges: profile.edges, maxEvidence: 10 },
  };
  const timings = [];
  let baseline;
  for (let index = 0; index < profile.iterations; index += 1) {
    const started = performance.now();
    const result = await queryGraph(fixture, query, digest);
    timings.push(performance.now() - started);
    if (!result.accepted) throw new Error(`${profile.name} query was rejected`);
    const replay = JSON.stringify({
      digest: result.value.queryDigest,
      paths: result.value.paths,
      truncation: result.value.truncation,
    });
    baseline ??= replay;
    if (baseline !== replay) throw new Error(`${profile.name} query output is nondeterministic`);
  }
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)];
  if (p95 > profile.p95BudgetMs)
    throw new Error(
      `${profile.name} query p95 ${p95.toFixed(3)}ms exceeds ${profile.p95BudgetMs}ms`
    );
  console.log(
    `${profile.name}: ${profile.edges} edges; p95 ${p95.toFixed(3)}ms; budget ${profile.p95BudgetMs}ms`
  );
}
