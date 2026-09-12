import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GraphProviderManifest } from '../../src/contracts/index.js';
import {
  validateGraphFactBatch,
  validateGraphProviderManifest,
} from '../../src/conformance/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, 'fixtures/g1', name), 'utf8')) as unknown;

function mutate(
  document: unknown,
  mutation: { pointer: string; value?: unknown; remove?: boolean }
): void {
  const segments = mutation.pointer.split('/').slice(1);
  let cursor = document as Record<string, unknown>;
  for (const segment of segments.slice(0, -1))
    cursor = (Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment]) as Record<
      string,
      unknown
    >;
  const key = segments.at(-1)!;
  if (mutation.remove) Array.isArray(cursor) ? cursor.splice(Number(key), 1) : delete cursor[key];
  else if (Array.isArray(cursor)) cursor[Number(key)] = mutation.value;
  else cursor[key] = mutation.value;
}

describe('portable G1 fixture corpus', () => {
  const manifest = read('minimal-provider-manifest.json') as GraphProviderManifest;
  it('admits the minimal portable provider and FactBatch fixtures', () => {
    expect(validateGraphProviderManifest(manifest)).toMatchObject({ accepted: true });
    expect(validateGraphFactBatch(read('minimal-fact-batch.json'), manifest)).toMatchObject({
      accepted: true,
    });
  });

  it('admits the maximal portable fixture without erasing partial, stale or unknown state', () => {
    const maximalManifest = read('maximal-provider-manifest.json') as GraphProviderManifest;
    expect(validateGraphProviderManifest(maximalManifest)).toMatchObject({ accepted: true });
    const result = validateGraphFactBatch(read('maximal-fact-batch.json'), maximalManifest);
    expect(result).toMatchObject({ accepted: true });
    if (result.accepted) {
      expect(result.value.status).toBe('partial');
      expect(result.value.unknownZones).toHaveLength(1);
      expect(result.value.unsupportedZones).toHaveLength(1);
      expect(result.value.facts.some((fact) => fact.freshness.status === 'stale')).toBe(true);
    }
  });

  it('preserves competing facts for later conflict resolution instead of choosing by order', () => {
    const batch = structuredClone(read('minimal-fact-batch.json')) as Record<string, unknown>;
    const first = (batch.facts as Record<string, unknown>[])[0];
    const competing = {
      ...first,
      factId: 'fact:fixture:competing',
      object: { kind: 'string', value: 'competing-value' },
    };
    batch.facts = [first, competing];
    const result = validateGraphFactBatch(batch, manifest);
    expect(result).toMatchObject({ accepted: true });
    if (result.accepted) expect(result.value.facts).toHaveLength(2);
  });

  it('keeps a known-empty batch distinct from an explicitly unknown partial batch', () => {
    const knownEmpty = structuredClone(read('minimal-fact-batch.json')) as Record<string, unknown>;
    knownEmpty.facts = [];
    const unknown = structuredClone(knownEmpty) as Record<string, unknown>;
    unknown.status = 'partial';
    unknown.unknownZones = [
      { code: 'parser-coverage-unknown', scope: 'src/index.ts', reason: 'Parser unavailable.' },
    ];
    expect(validateGraphFactBatch(knownEmpty, manifest)).toMatchObject({ accepted: true });
    const unknownResult = validateGraphFactBatch(unknown, manifest);
    expect(unknownResult).toMatchObject({ accepted: true });
    if (unknownResult.accepted) expect(unknownResult.value.unknownZones).toHaveLength(1);
  });

  it('executes every declared semantic-invalid mutation fail-closed', () => {
    const cases = read('semantic-invalid-mutations.json') as Array<{
      id: string;
      pointer: string;
      value?: unknown;
      remove?: boolean;
      expectedCode: string;
      also?: { pointer: string; value: unknown };
    }>;
    for (const fixture of cases) {
      const batch = structuredClone(read('minimal-fact-batch.json'));
      mutate(batch, fixture);
      if (fixture.also) mutate(batch, fixture.also);
      const result = validateGraphFactBatch(batch, manifest);
      expect(result.accepted, fixture.id).toBe(false);
      if (!result.accepted)
        expect(
          result.issues.map((issue) => issue.code),
          fixture.id
        ).toContain(fixture.expectedCode);
    }
  });
});
