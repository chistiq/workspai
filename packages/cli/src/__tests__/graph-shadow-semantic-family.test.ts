import { describe, expect, it } from 'vitest';

import {
  classifyGraphShadowSemanticFamily,
  summarizeGraphShadowSemanticFamilies,
  summarizeGraphShadowStructuralDeltas,
  summarizeGraphShadowUnknownCauses,
} from '../graph-shadow-semantic-family.js';

describe('Graph shadow semantic families', () => {
  it('classifies leftover shadow codes by general family, not repository layout', () => {
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_NODE_LEGACY_ONLY')).toBe('node');
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_NODE_PACKAGE_ONLY')).toBe('node');
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_RELATION_LEGACY_ONLY')).toBe('relation');
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_RELATION_PACKAGE_ONLY')).toBe(
      'relation'
    );
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_PROOF_LEGACY_ONLY')).toBe('proof');
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_PROOF_PACKAGE_ONLY')).toBe('proof');
    expect(
      classifyGraphShadowSemanticFamily('GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL')
    ).toBe('generated-artifact');
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_UNKNOWN_FAMILY_UNMAPPED')).toBe(
      'unknown-zone'
    );
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY')).toBe(
      'unknown-zone'
    );
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_OMITTED_SUBTREE_PACKAGE_ONLY')).toBe(
      'omitted-subtree'
    );
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_DIAGNOSTIC_LEGACY_ONLY')).toBe(
      'diagnostic'
    );
    expect(classifyGraphShadowSemanticFamily('GRAPH_SHADOW_UNSAFE_IDENTITY')).toBe('identity');
  });

  it('summarizes a mixed leftover set without collapsing generated artifacts into proof', () => {
    expect(
      summarizeGraphShadowSemanticFamilies([
        { code: 'GRAPH_SHADOW_NODE_LEGACY_ONLY' },
        { code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY' },
        { code: 'GRAPH_SHADOW_RELATION_LEGACY_ONLY' },
        { code: 'GRAPH_SHADOW_PROOF_PACKAGE_ONLY' },
        { code: 'GRAPH_SHADOW_PROOF_GENERATED_WORKSPACE_CONTROL' },
        { code: 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY' },
        { code: 'GRAPH_SHADOW_DIAGNOSTIC_LEGACY_ONLY' },
      ])
    ).toEqual({
      node: 2,
      relation: 1,
      proof: 1,
      'generated-artifact': 1,
      'unknown-zone': 1,
      'omitted-subtree': 0,
      diagnostic: 1,
      identity: 0,
      completeness: 0,
      binding: 0,
    });
  });

  it('summarizes unknown leftovers by general cause and structural leftovers by corpus membership', () => {
    expect(
      summarizeGraphShadowUnknownCauses([
        {
          code: 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
          key: 'package-unknown-zone::graph.source-call-ambiguous@src/a.ts',
          package: { count: 1 },
        },
        {
          code: 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
          key: 'package-unknown-zone::graph.source-call-ambiguous@src/b.ts',
          package: { count: 1 },
        },
        {
          code: 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
          key: 'parser-limitation',
          package: { count: 1 },
        },
        {
          code: 'GRAPH_SHADOW_UNKNOWN_ZONE_PACKAGE_ONLY',
          key: 'unsupported-syntax',
          package: { count: 2 },
        },
        {
          code: 'GRAPH_SHADOW_UNKNOWN_FAMILY_UNMAPPED',
          key: 'legacy-binding-coverage',
          legacy: { count: 4 },
        },
      ])
    ).toMatchObject({
      'parser-limitation': 3,
      'unsupported-syntax': 2,
      'unmapped-legacy-coverage': 4,
      unclassified: 0,
    });
    expect(
      summarizeGraphShadowStructuralDeltas([
        { code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY', key: 'file', package: { count: 10 } },
        { code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY', key: 'widget', package: { count: 2 } },
        { code: 'GRAPH_SHADOW_RELATION_LEGACY_ONLY', key: 'contains', legacy: { count: 4 } },
      ])
    ).toMatchObject({
      node: {
        inCorpus: 10,
        outsideCorpus: 2,
        rawCount: 12,
        semanticKindCount: 2,
        differenceEntries: 2,
      },
      relation: {
        inCorpus: 4,
        outsideCorpus: 0,
        rawCount: 4,
        semanticKindCount: 1,
        differenceEntries: 1,
      },
    });
  });
});
