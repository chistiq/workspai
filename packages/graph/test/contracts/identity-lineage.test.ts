import { describe, expect, it } from 'vitest';

import {
  assessGraphEvidenceIndependence,
  normalizeGraphEntityIdentity,
  resolveGraphEntityIdentity,
} from '../../src/conformance/index.js';
import { createHash } from 'node:crypto';

const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };

describe('Graph identity and evidence lineage', () => {
  it('normalizes separators, Unicode and configured case deterministically', () => {
    const first = normalizeGraphEntityIdentity({
      namespace: 'SOURCE',
      kind: 'File',
      relativeLocator: '.\\SRC\\Caf\u00e9.ts',
      caseSensitivity: 'insensitive',
      scope,
    });
    const second = normalizeGraphEntityIdentity({
      namespace: 'source',
      kind: 'file',
      relativeLocator: './src/Cafe\u0301.ts',
      caseSensitivity: 'insensitive',
      scope,
    });
    expect(first).toMatchObject({ accepted: true });
    expect(second).toMatchObject({ accepted: true });
    if (first.accepted && second.accepted)
      expect(first.value.reference.id).toBe(second.value.reference.id);
  });

  it('resolves Unicode and deep locators to bounded content-addressed identities', async () => {
    const resolve = (relativeLocator: string) =>
      resolveGraphEntityIdentity(
        {
          namespace: 'source',
          kind: 'file',
          relativeLocator,
          caseSensitivity: 'insensitive',
          scope,
        },
        {
          algorithm: 'sha256',
          digest: async (value) => createHash('sha256').update(value).digest('hex'),
        }
      );
    const composed = `src/${'deep/'.repeat(80)}Cafe\u0301.ts`;
    const first = await resolve(composed);
    const second = await resolve(composed.normalize('NFC').replace('Caf\u00e9', 'CAF\u00c9'));

    expect(first).toMatchObject({ accepted: true });
    expect(second).toMatchObject({ accepted: true });
    if (first.accepted && second.accepted) {
      expect(first.value.reference.id).toBe(second.value.reference.id);
      expect(first.value.reference.id).toMatch(/^entity:source:file:sha256:[a-f0-9]{64}$/u);
      expect(first.value.reference.id.length).toBeLessThanOrEqual(512);
    }
  });

  it.each(['/private/source.ts', 'C:\\private\\source.ts', '../source.ts', 'src/../../secret'])(
    'rejects machine-local or escaping identity %s',
    (relativeLocator) => {
      expect(
        normalizeGraphEntityIdentity({
          namespace: 'source',
          kind: 'file',
          relativeLocator,
          caseSensitivity: 'sensitive',
          scope,
        })
      ).toMatchObject({ accepted: false });
    }
  );

  it('does not count common-root generated claims as corroboration', () => {
    const assessment = assessGraphEvidenceIndependence([
      { factId: 'fact:a', derivation: 'generated', evidenceRoots: ['root:1'], parentFactIds: [] },
      { factId: 'fact:b', derivation: 'generated', evidenceRoots: ['root:1'], parentFactIds: [] },
    ]);
    expect(assessment).toMatchObject({ independent: false });
    expect(assessment.rejectedPairs).toContainEqual({
      left: 'fact:a',
      right: 'fact:b',
      reason: 'generated-sibling',
    });
  });

  it('accepts genuinely independent evidence roots', () => {
    expect(
      assessGraphEvidenceIndependence([
        {
          factId: 'fact:a',
          derivation: 'observed',
          evidenceRoots: ['root:source'],
          parentFactIds: [],
        },
        {
          factId: 'fact:b',
          derivation: 'declared',
          evidenceRoots: ['root:manifest'],
          parentFactIds: [],
        },
      ])
    ).toMatchObject({ independent: true, rejectedPairs: [] });
  });

  it('rejects direct and transitive lineage ancestry as independent corroboration', () => {
    const result = assessGraphEvidenceIndependence([
      { factId: 'fact:root', derivation: 'observed', evidenceRoots: ['root:a'], parentFactIds: [] },
      {
        factId: 'fact:middle',
        derivation: 'computed',
        evidenceRoots: ['root:b'],
        parentFactIds: ['fact:root'],
      },
      {
        factId: 'fact:leaf',
        derivation: 'inferred',
        evidenceRoots: ['root:c'],
        parentFactIds: ['fact:middle'],
      },
    ]);
    expect(result.independent).toBe(false);
    expect(result.rejectedPairs).toContainEqual({
      left: 'fact:root',
      right: 'fact:leaf',
      reason: 'ancestor',
    });
  });
});
