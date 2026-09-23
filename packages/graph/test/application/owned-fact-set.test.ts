import { describe, expect, it } from 'vitest';

import { GRAPH_IDENTITY_SCHEME, type GraphWorkspaceFact } from '../../src/contracts/index.js';
import { semanticFactCanonical } from '../../src/application/compose-graph.js';
import {
  digestLocaleCanonicalKeys,
  digestOwnedFactSet,
} from '../../src/application/owned-fact-set.js';

const digest = { algorithm: 'sha256' as const, value: 'ab'.repeat(32) };
const scope = { kind: 'project' as const, projectIds: ['app'] as [string] };

function entity(id: string, kind: string): GraphWorkspaceFact['subject'] {
  return { id, identityScheme: GRAPH_IDENTITY_SCHEME, kind, scope };
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

describe('owned fact-set digest', () => {
  it('matches localeCompare order across batch boundaries and input order', async () => {
    const facts = [
      fact(),
      fact({
        factId: 'fact:literal',
        predicate: 'annotates',
        object: { kind: 'string', value: 'line\nbreak' },
        extensions: undefined,
        freshness: { status: 'current' },
      }),
      fact({ factId: 'fact:z', subject: entity('file:src/Z.ts', 'file') }),
      fact({ factId: 'fact:lower', subject: entity('file:src/a.ts', 'file') }),
    ];
    const reversed = [...facts].reverse();
    const expected = digestLocaleCanonicalKeys(facts.map((item) => semanticFactCanonical(item)));
    const forward = await digestOwnedFactSet(facts, semanticFactCanonical);
    const backward = await digestOwnedFactSet(reversed, semanticFactCanonical);
    expect(forward.status).toBe('complete');
    expect(backward.status).toBe('complete');
    if (forward.status === 'complete' && backward.status === 'complete') {
      expect(forward.digest.value).toBe(expected);
      expect(backward.digest.value).toBe(expected);
      expect(forward.facts).toBe(facts.length);
    }
  });

  it('falls back observably when a canonical key is not printable ASCII', async () => {
    const owned = await digestOwnedFactSet(
      [fact({ factId: 'fact:é', subject: entity('file:src/é.ts', 'file') })],
      semanticFactCanonical
    );
    expect(owned.status).toBe('fallback');
    if (owned.status === 'fallback') expect(owned.reason).toBe('rejected-10');
  });
});
