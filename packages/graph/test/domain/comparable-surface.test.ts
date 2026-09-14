import { describe, expect, it } from 'vitest';

import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/core-ontology.js';
import { GRAPH_COMPARABLE_SURFACE_LAW } from '../../src/contracts/semantic-parity.js';
import {
  classifyComparableKind,
  classifyComparableRelation,
  mapComparableKind,
  mapComparableRelation,
} from '../../src/domain/comparable-surface.js';

describe('comparable-surface corpus', () => {
  it('maps compatibility aliases onto the core ontology without inventing kinds', () => {
    expect(GRAPH_COMPARABLE_SURFACE_LAW.ontologyId).toBe(CORE_GRAPH_ONTOLOGY_PROFILE.id);
    expect(mapComparableKind('test-suite')).toBe('test');
    expect(mapComparableKind('repository')).toBe('project');
    expect(mapComparableRelation('owns')).toBe('owned-by');
    expect(mapComparableRelation('documents')).toBe('documented-by');
    expect(mapComparableKind('file')).toBe('file');
    expect(mapComparableRelation('contains')).toBe('contains');
    expect(mapComparableKind('widget')).toBe('widget');
  });

  it('distinguishes in-corpus kinds from leftovers outside the shared ontology', () => {
    expect(classifyComparableKind('test-suite')).toEqual({
      kind: 'test',
      membership: 'in-corpus',
    });
    expect(classifyComparableKind('file')).toEqual({ kind: 'file', membership: 'in-corpus' });
    expect(classifyComparableKind('widget')).toEqual({
      kind: 'widget',
      membership: 'outside-corpus',
    });
    expect(classifyComparableRelation('owns')).toEqual({
      kind: 'owned-by',
      membership: 'in-corpus',
    });
    expect(classifyComparableRelation('teleports')).toEqual({
      kind: 'teleports',
      membership: 'outside-corpus',
    });
    expect(CORE_GRAPH_ONTOLOGY_PROFILE.entities.some((entity) => entity.kind === 'test')).toBe(
      true
    );
    expect(
      CORE_GRAPH_ONTOLOGY_PROFILE.relations.some((relation) => relation.kind === 'owned-by')
    ).toBe(true);
  });
});
