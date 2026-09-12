import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  GRAPH_CANONICAL_GRAPH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  type GraphProviderManifest,
} from '../../src/contracts/index.js';
import {
  canonicalizeGraphValue,
  measureCanonicalGraphValueBytes,
  validateCanonicalGraph,
  validateGraphFactBatch,
  validateGraphModelGenerationBinding,
  validateGraphNaryAssertion,
  validateGraphOntologyProfile,
  validateGraphProviderDetectionRequest,
  validateGraphProviderDetectionResult,
  validateGraphProviderManifest,
  validateGraphPublicationManifest,
  validateGraphQualityReport,
  validateGraphQueryCacheEntry,
  validateGraphQueryCacheInvalidation,
  validateGraphQueryCacheKey,
  validateGraphQueryCacheReuseDecision,
} from '../../src/conformance/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, 'fixtures/g1', name), 'utf8')) as unknown;
const manifest = read('minimal-provider-manifest.json') as GraphProviderManifest;
const digest = { algorithm: 'sha256', value: 'a'.repeat(64) };
const scope = { kind: 'project', projectIds: ['project:adversarial'] };

function canonicalGraph(): Record<string, unknown> {
  const proof = {
    policy: { id: 'workspai.graph.proof.standard', version: '1' },
    state: 'supported',
    authorities: ['observed'],
    evidence: [
      { id: 'evidence:1', sourceKind: 'source-file', relativeLocator: 'src/index.ts', digest },
    ],
    corroborationGroups: [],
    counterEvidence: [],
    missingRequirements: [],
    evaluatedAt: '2026-09-08T12:00:00Z',
    inputDigest: digest,
    explanationCode: 'fixture',
  };
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
    ontology: [
      { id: CORE_GRAPH_ONTOLOGY_PROFILE.id, version: CORE_GRAPH_ONTOLOGY_PROFILE.version },
    ],
    nodes: [
      { id: 'entity:project', identityScheme: GRAPH_IDENTITY_SCHEME, kind: 'project', scope },
      { id: 'entity:file', identityScheme: GRAPH_IDENTITY_SCHEME, kind: 'file', scope },
    ],
    edges: [
      {
        id: 'edge:contains:1',
        relation: 'contains',
        semantics: 'structural',
        from: 'entity:project',
        to: 'entity:file',
        state: 'accepted',
        facts: ['fact:1'],
        derivations: ['extracted'],
        proof,
        freshness: { status: 'current' },
        confidence: 1,
        explanation: { code: 'accepted', drivers: ['fixture'] },
      },
    ],
    assertions: [],
    disputes: [],
    unresolved: [],
    diagnostics: [],
  };
}

function rejected(result: { accepted: boolean }): void {
  expect(result.accepted).toBe(false);
}

describe('Graph G1 adversarial admission', () => {
  it('rejects missing permanent dimensions across every foundation envelope', () => {
    rejected(validateGraphProviderManifest({}));
    rejected(validateGraphFactBatch({}, manifest));
    rejected(validateGraphProviderDetectionRequest({}));
    rejected(validateGraphProviderDetectionResult({}, manifest));
    rejected(validateGraphOntologyProfile({}));
    rejected(validateCanonicalGraph({}, CORE_GRAPH_ONTOLOGY_PROFILE));
    rejected(validateGraphNaryAssertion({}, CORE_GRAPH_ONTOLOGY_PROFILE));
    rejected(validateGraphPublicationManifest({}));
    rejected(validateGraphModelGenerationBinding({}));
    rejected(validateGraphQualityReport({}));
    rejected(validateGraphQueryCacheKey({}));
    rejected(validateGraphQueryCacheEntry({}));
    rejected(validateGraphQueryCacheReuseDecision({}));
    rejected(validateGraphQueryCacheInvalidation({}));
  });

  it('rejects non-object envelopes without throwing or echoing their payload', () => {
    for (const value of [null, false, 1, 'payload', []]) {
      rejected(validateGraphProviderManifest(value));
      rejected(validateGraphFactBatch(value, manifest));
      rejected(validateGraphProviderDetectionRequest(value));
      rejected(validateGraphProviderDetectionResult(value, manifest));
      rejected(validateGraphOntologyProfile(value));
      rejected(validateCanonicalGraph(value, CORE_GRAPH_ONTOLOGY_PROFILE));
      rejected(validateGraphNaryAssertion(value, CORE_GRAPH_ONTOLOGY_PROFILE));
      rejected(validateGraphPublicationManifest(value));
      rejected(validateGraphModelGenerationBinding(value));
      rejected(validateGraphQualityReport(value));
      rejected(validateGraphQueryCacheKey(value));
      rejected(validateGraphQueryCacheEntry(value));
      rejected(validateGraphQueryCacheReuseDecision(value));
      rejected(validateGraphQueryCacheInvalidation(value));
    }
  });

  it('rejects contradictory detection outcomes and malformed diagnostics', () => {
    const base = {
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: 'applicable',
      matchedInputs: ['source-file'],
      missingPermissions: [],
      diagnostics: [],
    };
    for (const candidate of [
      { ...base, provider: { id: 'foreign', version: '1' } },
      { ...base, matchedInputs: ['source-file', 'source-file'] },
      { ...base, missingPermissions: ['root'] },
      { ...base, diagnostics: [{ code: '', message: 1 }] },
      { ...base, status: 'not-applicable' },
      { ...base, status: 'unknown' },
    ])
      rejected(validateGraphProviderDetectionResult(candidate, manifest));
  });

  it('rejects malformed facts and result accounting at the admitted boundary', () => {
    const minimal = read('minimal-fact-batch.json') as Record<string, unknown>;
    const validFact = (minimal.facts as Record<string, unknown>[])[0];
    const invalidFact = {
      ...validFact,
      factId: '',
      subject: {},
      object: {},
      scope: { kind: 'workspace' },
      evidence: [],
      provenance: {},
      derivation: 'invented',
      authority: 'invented',
      confidence: Number.NaN,
      freshness: {},
      truthLifecycle: {},
      observedAt: 'today',
      inputDigest: {},
      unknownZones: null,
    };
    const aliasedEntity = {
      ...(validFact.subject as Record<string, unknown>),
      aliases: [
        { id: 'entity:fixture:source', reason: 'move' },
        { id: '', reason: 1 },
      ],
    };
    for (const candidate of [
      { ...minimal, facts: [null] },
      { ...minimal, facts: [invalidFact] },
      { ...minimal, facts: [{ ...validFact, subject: aliasedEntity }] },
      {
        ...minimal,
        facts: [
          {
            ...validFact,
            subject: { ...(validFact.subject as object), kind: 'module' },
            object: { ...(validFact.subject as object), id: 'entity:other', kind: 'module' },
          },
        ],
      },
      { ...minimal, inputs: [null] },
      { ...minimal, inputs: [...(minimal.inputs as unknown[]), ...(minimal.inputs as unknown[])] },
      { ...minimal, diagnostics: [{ code: '', severity: 'fatal', path: 1, message: 1 }] },
      { ...minimal, coverage: [{ dimension: '', observed: -1, expected: -1 }] },
      { ...minimal, unknownZones: [{ code: '', scope: '', reason: '' }] },
      { ...minimal, redaction: { policy: '', redacted: -1, omitted: -1 } },
      { ...minimal, processing: [null] },
    ])
      rejected(validateGraphFactBatch(candidate, manifest));
  });

  it('rejects malformed canonical identities, edges, disputes and unresolved state', () => {
    const base = canonicalGraph();
    expect(validateCanonicalGraph(base, CORE_GRAPH_ONTOLOGY_PROFILE)).toMatchObject({
      accepted: true,
    });
    const nodes = base.nodes as Record<string, unknown>[];
    const edges = base.edges as Record<string, unknown>[];
    for (const candidate of [
      { ...base, nodes: [null] },
      { ...base, nodes: [nodes[0], nodes[0]] },
      { ...base, edges: [null] },
      { ...base, edges: [edges[0], edges[0]] },
      {
        ...base,
        edges: [
          {
            ...edges[0],
            state: 'invented',
            facts: [],
            derivations: ['invented'],
            proof: {},
            confidence: Number.NaN,
          },
        ],
      },
      { ...base, assertions: [{}] },
      { ...base, disputes: [{ id: '', factIds: [] }] },
      { ...base, unresolved: [{ id: '', candidates: [] }] },
    ])
      rejected(validateCanonicalGraph(candidate, CORE_GRAPH_ONTOLOGY_PROFILE));
  });

  it('bounds canonical input classes and rejects prototype-bearing keys', () => {
    for (const value of [undefined, () => undefined, Symbol('value'), 1n])
      rejected(canonicalizeGraphValue(value));
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile.__proto__ = { polluted: true };
    rejected(canonicalizeGraphValue(hostile));
  });

  it('measures large canonical values without the digest canonicalization value ceiling', () => {
    const value = Array.from({ length: 250_000 }, (_, index) => ({ index, enabled: true }));
    const expected = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(measureCanonicalGraphValueBytes(value, expected)).toEqual({
      accepted: true,
      value: expected,
      issues: [],
    });
    rejected(measureCanonicalGraphValueBytes(value, expected - 1));
    rejected(measureCanonicalGraphValueBytes(value, 0));
  });

  it('keeps canonicalization deterministic across scalar and nested JSON boundaries', () => {
    expect(canonicalizeGraphValue({ z: -0, a: [null, true, false, 'value', 1.5] })).toEqual({
      accepted: true,
      value: '{"a":[null,true,false,"value",1.5],"z":0}',
      issues: [],
    });
    rejected(canonicalizeGraphValue(Number.POSITIVE_INFINITY));
    rejected(canonicalizeGraphValue({ missing: undefined }));
    rejected(canonicalizeGraphValue({ callback: () => undefined }));
    rejected(canonicalizeGraphValue({ token: Symbol('token') }));
    rejected(canonicalizeGraphValue({ count: 1n }));
    rejected(canonicalizeGraphValue({ constructor: 'blocked' }));
    rejected(canonicalizeGraphValue({}, { maxValues: 0 }));
    rejected(canonicalizeGraphValue({}, { maxValues: 1.5 }));
    rejected(canonicalizeGraphValue([1], { maxValues: 1 }));

    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    rejected(canonicalizeGraphValue(arrayCycle));
    const objectCycle: Record<string, unknown> = {};
    objectCycle.self = objectCycle;
    rejected(canonicalizeGraphValue(objectCycle));
    let nested: unknown = null;
    for (let depth = 0; depth < 258; depth += 1) nested = [nested];
    rejected(canonicalizeGraphValue(nested));
  });

  it('measures every JSON shape and rejects unsafe measured values', () => {
    const value = { z: -0, a: [null, true, false, 'value', 1.5] };
    expect(measureCanonicalGraphValueBytes(value, 1_000)).toEqual({
      accepted: true,
      value: new TextEncoder().encode(JSON.stringify(value)).byteLength,
      issues: [],
    });
    rejected(measureCanonicalGraphValueBytes(Number.NaN, 100));
    rejected(measureCanonicalGraphValueBytes(undefined, 100));
    rejected(measureCanonicalGraphValueBytes({ missing: undefined }, 100));
    rejected(measureCanonicalGraphValueBytes({ callback: () => undefined }, 100));
    rejected(measureCanonicalGraphValueBytes({ token: Symbol('token') }, 100));
    rejected(measureCanonicalGraphValueBytes({ count: 1n }, 100));
    rejected(measureCanonicalGraphValueBytes({ constructor: 'blocked' }, 100));
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    rejected(measureCanonicalGraphValueBytes(cycle, 100));
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    rejected(measureCanonicalGraphValueBytes(arrayCycle, 100));

    let nested: unknown = null;
    for (let depth = 0; depth < 258; depth += 1) nested = [nested];
    rejected(measureCanonicalGraphValueBytes(nested, 10_000));
  });
});
