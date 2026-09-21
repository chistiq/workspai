import { describe, expect, it } from 'vitest';

import { GRAPH_IDENTITY_SCHEME, type GraphWorkspaceFact } from '../../src/contracts/index.js';
import {
  decodeGraphEntityLocator,
  factClassObservationsFromFacts,
  factClassObservationsFromGraph,
} from '../../src/testing/index.js';

const scope = { kind: 'project' as const, projectIds: ['obs'] as [string] };
const digest = { algorithm: 'sha256' as const, value: 'a'.repeat(64) };

function fact(input: {
  readonly factType: string;
  readonly factId?: string;
  readonly object?: GraphWorkspaceFact['object'];
  readonly evidence?: GraphWorkspaceFact['evidence'];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly unknownZones?: GraphWorkspaceFact['unknownZones'];
}): GraphWorkspaceFact {
  return {
    factId: input.factId ?? `fact:${input.factType}`,
    factType: input.factType,
    subject: {
      id: 'entity:obs:file:src',
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope,
    },
    predicate: 'observes',
    object: input.object ?? {
      id: 'entity:obs:symbol:n',
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'symbol',
      scope,
    },
    scope,
    evidence: input.evidence ?? [
      { id: 'evidence:1', sourceKind: 'source-file', relativeLocator: 'src.ts', digest },
    ],
    provenance: { id: 'test', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change'] },
    observedAt: '2026-09-20T00:00:00.000Z',
    inputDigest: digest,
    unknownZones: input.unknownZones ?? [],
    ...(input.extensions ? { extensions: input.extensions } : {}),
  };
}

describe('fact-class observation keys', () => {
  it('uses auditable extensions and classifies unknown zones', () => {
    const observed = factClassObservationsFromFacts(
      [
        fact({ factType: 'source.file', object: { kind: 'string', value: 'ignored' } }),
        fact({
          factType: 'source.literal-route',
          extensions: { httpMethod: 'GET', httpPath: '/health' },
        }),
        fact({ factType: 'manifest.package', extensions: { packageName: 'golden' } }),
        fact({ factType: 'source.declaration', extensions: { symbolName: 'health' } }),
        fact({ factType: 'source.export', extensions: { symbolName: 'health' } }),
        fact({ factType: 'source.call', extensions: { calleeName: 'health' } }),
        fact({
          factType: 'source.static-import',
          extensions: { moduleSpecifier: 'express' },
        }),
        fact({
          factType: 'source.declared-import',
          extensions: { moduleSpecifier: 'flask' },
        }),
        fact({
          factType: 'source.declaration',
          extensions: { symbolName: 'truncated' },
          unknownZones: [
            { code: 'graph.source-calls-truncated', scope: 'src.ts', reason: 'budget' },
          ],
        }),
        fact({
          factType: 'source.call',
          extensions: { calleeName: 'shared' },
          unknownZones: [
            { code: 'graph.source-call-ambiguous', scope: 'src.ts', reason: 'collision' },
          ],
        }),
        fact({
          factType: 'source.file',
          evidence: [],
          object: { kind: 'string', value: 'no-evidence' },
        }),
        fact({ factType: 'unknown.skip-me' }),
      ],
      [
        { code: 'graph.route-receiver-unproven', scope: 'api.py', reason: 'name only' },
        { code: 'graph.source-call-ambiguous', scope: 'c.ts', reason: 'collision' },
        { code: 'graph.source-generated', scope: 'gen.ts', reason: 'generated' },
        { code: 'graph.source-unreadable', scope: 'bad.ts', reason: 'decode' },
        { code: 'graph.literal-routes-truncated', scope: 'routes.ts', reason: 'budget' },
      ]
    );
    expect(observed.files.keys).toContain('src.ts');
    expect(
      factClassObservationsFromFacts([
        fact({
          factType: 'delivery.test',
          evidence: [
            {
              id: 'evidence:test',
              sourceKind: 'test-source',
              relativeLocator: 'src/server.test.ts',
              digest,
            },
          ],
        }),
      ]).tests.keys
    ).toEqual(['src/server.test.ts']);
    expect(observed.routes.keys).toEqual(['GET /health']);
    expect(observed.projects.keys).toEqual(['golden']);
    expect(observed.declarations.keys).toEqual(expect.arrayContaining(['health', 'truncated']));
    expect(observed.exports.keys).toEqual(['health']);
    expect(observed.calls.keys).toEqual(expect.arrayContaining(['health', 'shared']));
    expect(observed.imports.keys).toEqual(['express', 'flask']);
    expect(observed.declarations.truncatedKeys).toContain('truncated');
    expect(observed.calls.ambiguousKeys).toContain('shared');
    expect(observed.files.evidenceFailureKeys?.length).toBeGreaterThan(0);
    expect(observed.routes.unsupportedKeys).toContain('api.py');
    expect(observed.calls.ambiguousKeys).toContain('c.ts');
    expect(observed.declarations.generatedExcludedKeys).toContain('gen.ts');
    expect(observed.declarations.evidenceFailureKeys).toContain('bad.ts');
    expect(observed.routes.truncatedKeys).toContain('routes.ts');
  });

  it('drops opaque hashed identities when overlaying canonical graph nodes', () => {
    expect(decodeGraphEntityLocator('not-an-entity')).toBe('not-an-entity');
    expect(decodeGraphEntityLocator('entity:ns:kind:')).toBe('entity:ns:kind:');
    const observed = factClassObservationsFromGraph(
      {
        contract: { id: 'workspai.graph.canonical-graph', version: '0.1.0-candidate' },
        generation: {
          inputsDigest: digest,
          providerSetDigest: digest,
          compositionPolicyDigest: digest,
        },
        nodes: [
          {
            id: 'entity:obs:file:src%2Fapp.ts',
            identityScheme: GRAPH_IDENTITY_SCHEME,
            kind: 'file',
            scope,
          },
          {
            id: 'sha256:deadbeef',
            identityScheme: GRAPH_IDENTITY_SCHEME,
            kind: 'endpoint',
            scope,
          },
        ],
        edges: [],
        unresolved: [{ id: 'missing', candidates: [] }],
      } as never,
      [
        fact({
          factType: 'source.literal-route',
          extensions: { httpMethod: 'POST', httpPath: '/orders' },
        }),
      ]
    );
    expect(observed.routes.keys).toEqual(['POST /orders']);
    expect(observed.files.keys.some((key) => key.startsWith('sha256:'))).toBe(false);
  });
});
