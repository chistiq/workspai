import { describe, expect, it } from 'vitest';

import { GRAPH_UNKNOWN_CAUSE_LAW } from '../../src/contracts/semantic-parity.js';
import {
  classifyGraphUnknownCause,
  graphUnknownDiagnosticCode,
  graphUnknownObservation,
  summarizeGraphUnknownCauses,
} from '../../src/domain/unknown-cause.js';

describe('unknown-cause classification', () => {
  it('strips scope suffixes and classifies general causes, not repository paths', () => {
    expect(graphUnknownDiagnosticCode('graph.source-call-ambiguous@src/a.ts')).toBe(
      'graph.source-call-ambiguous'
    );
    expect(classifyGraphUnknownCause('graph.source-language-unsupported@app.dart')).toBe(
      'unsupported-syntax'
    );
    expect(classifyGraphUnknownCause('graph.ecmascript-dynamic-import-unsupported')).toBe(
      'unsupported-syntax'
    );
    expect(classifyGraphUnknownCause('graph.dynamic-route-unsupported')).toBe('unsupported-syntax');
    expect(classifyGraphUnknownCause('graph.sensitive-input-omitted')).toBe('inventory-policy');
    expect(classifyGraphUnknownCause('graph.repository-policy-directory')).toBe('inventory-policy');
    expect(classifyGraphUnknownCause('graph.repository-configuration-directory')).toBe(
      'inventory-policy'
    );
    expect(classifyGraphUnknownCause('graph.repository-vendored-directory')).toBe(
      'generated-or-vendor-policy'
    );
    expect(classifyGraphUnknownCause('graph.repository-generated-directory')).toBe(
      'generated-or-vendor-policy'
    );
    expect(classifyGraphUnknownCause('graph.source-call-ambiguous@src/a.ts')).toBe(
      'parser-limitation'
    );
    expect(classifyGraphUnknownCause('graph.ecmascript-local-import-unresolved')).toBe(
      'parser-limitation'
    );
    expect(classifyGraphUnknownCause('graph.source-declarations-truncated')).toBe('resource-bound');
    expect(classifyGraphUnknownCause('graph.repository-budget-truncated')).toBe('resource-bound');
    expect(classifyGraphUnknownCause('legacy.binding-coverage.12')).toBe(
      'unmapped-legacy-coverage'
    );
    expect(classifyGraphUnknownCause('graph.novel-future-code')).toBe('unclassified');
    expect(GRAPH_UNKNOWN_CAUSE_LAW.disposition).toBe('bounded-unknown');
    expect(GRAPH_UNKNOWN_CAUSE_LAW.admissionImpact).toBe('blocking');
    expect([...GRAPH_UNKNOWN_CAUSE_LAW.classificationOrigins]).toEqual([
      'structured-producer',
      'legacy-fallback',
    ]);
    expect([...GRAPH_UNKNOWN_CAUSE_LAW.neverBenignCauses]).toEqual([
      'unclassified',
      'unmapped-legacy-coverage',
    ]);
  });

  it('summarizes causes with bounded codes and never drops unclassified leftovers', () => {
    expect(
      summarizeGraphUnknownCauses([
        'graph.source-call-ambiguous@src/a.ts',
        'graph.source-call-ambiguous@src/b.ts',
        'graph.source-language-unsupported',
        'graph.novel-future-code',
      ])
    ).toEqual([
      {
        cause: 'unsupported-syntax',
        disposition: 'bounded-unknown',
        admissionImpact: 'blocking',
        count: 1,
        codes: ['graph.source-language-unsupported'],
      },
      {
        cause: 'parser-limitation',
        disposition: 'bounded-unknown',
        admissionImpact: 'blocking',
        count: 2,
        codes: ['graph.source-call-ambiguous@src/a.ts', 'graph.source-call-ambiguous@src/b.ts'],
      },
      {
        cause: 'unclassified',
        disposition: 'bounded-unknown',
        admissionImpact: 'blocking',
        count: 1,
        codes: ['graph.novel-future-code'],
      },
    ]);
  });

  it('emits structured unknown observations at source without making unclassified benign', () => {
    const observed = graphUnknownObservation({
      code: 'graph.novel-future-code',
      scope: 'src/a.ts',
      reason: 'No classified cause is available.',
      provider: 'graph.repository-inventory',
      stage: 'inventory',
    });
    expect(observed).toMatchObject({
      cause: 'unclassified',
      bound: 'failed',
      completeness: 'partial',
      severity: 'error',
      admissionImpact: 'blocking',
      provider: 'graph.repository-inventory',
      stage: 'inventory',
      classificationOrigin: 'legacy-fallback',
    });
    const producer = graphUnknownObservation({
      code: 'graph.repository-vendored-directory',
      scope: 'node_modules',
      reason: 'Vendored store was not enumerated.',
      cause: 'generated-or-vendor-policy',
      provider: 'graph.repository-inventory',
      stage: 'inventory',
    });
    expect(producer).toMatchObject({
      cause: 'generated-or-vendor-policy',
      classificationOrigin: 'structured-producer',
      admissionImpact: 'blocking',
    });
    const truncated = graphUnknownObservation({
      code: 'graph.repository-budget-truncated',
      scope: 'repository',
      reason: 'Budget exhausted.',
      stage: 'inventory',
    });
    expect(truncated).toMatchObject({
      cause: 'resource-bound',
      bound: 'resource-limited',
      completeness: 'partial',
      admissionImpact: 'blocking',
    });
  });
});
