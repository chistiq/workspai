import { describe, expect, it } from 'vitest';

import { createNodeRustWasmGraphNativePort } from '../../src/adapters/node/rust-wasm-engine.js';
import {
  canonicalFactKeysFromNative,
  compactFactSupported,
  encodeCompactFactBatch,
} from '../../src/application/compact-fact-ir.js';
import { semanticFactCanonical } from '../../src/application/compose-graph.js';
import { GRAPH_IDENTITY_SCHEME, type GraphWorkspaceFact } from '../../src/contracts/index.js';

const digest = { algorithm: 'sha256' as const, value: 'ab'.repeat(32) };
const scope = { kind: 'project' as const, projectIds: ['app'] as [string] };

function entity(id: string, kind: string): GraphWorkspaceFact['subject'] {
  return {
    id,
    identityScheme: GRAPH_IDENTITY_SCHEME,
    kind,
    scope,
  };
}

function fact(overrides: Partial<GraphWorkspaceFact> = {}): GraphWorkspaceFact {
  return {
    factId: 'fact:1',
    factType: 'source.static-import',
    subject: entity('file:src/a.ts', 'file'),
    predicate: 'imports',
    object: entity('module:left', 'module'),
    scope,
    evidence: [
      {
        id: 'evidence:1',
        sourceKind: 'source-file',
        relativeLocator: 'src/a "quote".ts',
        digest,
      },
    ],
    provenance: { id: 'workspai.graph.provider.ecmascript-imports', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 0.9,
    freshness: { status: 'current', renewal: 'input-change' },
    truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
    observedAt: '2026-09-12T00:00:00.000Z',
    inputDigest: digest,
    unknownZones: [],
    extensions: { moduleSpecifier: './left' },
    ...overrides,
  };
}

describe('compact fact canonical kernel', () => {
  it('rejects facts whose unknown zones the v1 record cannot carry', () => {
    expect(compactFactSupported(fact())).toBe(true);
    expect(
      compactFactSupported(
        fact({
          unknownZones: [{ code: 'graph.example', scope: 'src/a.ts', reason: 'outside v1' }],
        })
      )
    ).toBe(false);
    expect(
      encodeCompactFactBatch([fact({ unknownZones: [{ code: 'x', scope: 'y', reason: 'z' }] })])
    ).toBe(undefined);
  });

  it('matches the TypeScript semantic fact string, including escapes and renewal order', async () => {
    const native = await createNodeRustWasmGraphNativePort();
    const facts = [
      fact(),
      fact({
        factId: 'fact:literal',
        predicate: 'annotates',
        object: { kind: 'string', value: 'line\nbreak' },
        extensions: undefined,
        freshness: { status: 'current' },
        evidence: [
          {
            id: 'evidence:2',
            sourceKind: 'source-file',
            relativeLocator: 'src/b.ts',
            digest: { ...digest, canonicalization: 'workspai.canonical-json.v1' },
          },
        ],
      }),
    ];
    const keys = canonicalFactKeysFromNative(
      facts,
      (bytes) => {
        const result = native.canonicalizeFactBatch?.(bytes);
        return result?.status === 'complete' ? result.canonical : undefined;
      },
      semanticFactCanonical
    );
    expect(keys).toEqual(facts.map((item) => semanticFactCanonical(item)));
  });
});
