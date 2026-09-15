import { GRAPH_UNKNOWN_CAUSE } from '@workspai/graph/conformance';
import { describe, expect, it } from 'vitest';

import {
  GRAPH_SHADOW_UNKNOWN_CONTRACT_VERSION,
  projectLegacyUnknownItems,
  projectPackageUnknownItems,
  unknownCauseFromComparisonKey,
  unknownComparisonToken,
  unknownItemKey,
} from '../graph-shadow-unknown-contract.js';

describe('Graph shadow unknown compatibility contract', () => {
  it('does not equate legacy binding-coverage counts with package unknown zones', () => {
    expect(GRAPH_SHADOW_UNKNOWN_CONTRACT_VERSION).toBe('workspai.graph-shadow-unknown-contract.v1');
    const legacy = projectLegacyUnknownItems({
      unknownCount: 2,
      diagnostics: [],
    });
    expect(legacy).toEqual([
      { family: 'legacy-binding-coverage', code: 'legacy.binding-coverage.1' },
      { family: 'legacy-binding-coverage', code: 'legacy.binding-coverage.2' },
    ]);
    const mapped = projectPackageUnknownItems({
      unresolved: [],
      unknownZones: [],
      unsupportedZones: [],
    });
    expect(mapped).toEqual([]);
    expect(legacy.every((item) => item.family === 'legacy-binding-coverage')).toBe(true);
  });

  it('names binding-coverage leftovers by dimension when the legacy overlay is present', () => {
    expect(
      projectLegacyUnknownItems({
        unknownCount: 2,
        diagnostics: [],
        bindingCoverage: {
          projectTests: { unknownCount: 0 },
          projectDeployment: { unknownCount: 1 },
          projectOwnership: { unknownCount: 1 },
        },
      })
    ).toEqual([
      { family: 'legacy-binding-coverage', code: 'projectDeployment' },
      { family: 'legacy-binding-coverage', code: 'projectOwnership' },
    ]);
  });

  it('preserves unresolved identities and scoped unknown zones instead of collapsing counters', () => {
    const items = projectPackageUnknownItems({
      unresolved: [{ id: 'call:dynamic' }, { id: 'import:missing' }],
      unknownZones: [{ code: 'graph.source-call-ambiguous', scope: 'src/a.ts' }],
      unsupportedZones: [{ code: 'graph.source-language-unsupported', scope: 'app.dart' }],
    });
    expect(items.map((item) => unknownItemKey(item))).toEqual([
      'package-unresolved\0call:dynamic',
      'package-unresolved\0import:missing',
      'package-unknown-zone\0graph.source-call-ambiguous@src/a.ts',
      'package-unsupported-zone\0graph.source-language-unsupported@app.dart',
    ]);
    expect(GRAPH_UNKNOWN_CAUSE.classify('graph.source-call-ambiguous@src/a.ts')).toBe(
      'parser-limitation'
    );
    expect(GRAPH_UNKNOWN_CAUSE.classify('graph.source-language-unsupported@app.dart')).toBe(
      'unsupported-syntax'
    );
    expect(
      unknownCauseFromComparisonKey('package-unknown-zone::graph.source-call-ambiguous@src/a.ts')
    ).toBe('parser-limitation');
    expect(unknownCauseFromComparisonKey('parser-limitation')).toBe('parser-limitation');
    expect(unknownCauseFromComparisonKey('legacy-binding-coverage')).toBe(
      'unmapped-legacy-coverage'
    );
    expect(unknownComparisonToken(items[2]!)).toBe(
      'package-unknown-zone::graph.source-call-ambiguous@src/a.ts\0package-unknown-zone::graph.source-call-ambiguous@src/a.ts'
    );
    expect(unknownComparisonToken(items[3]!)).toBe(
      'package-unsupported-zone::graph.source-language-unsupported@app.dart\0package-unsupported-zone::graph.source-language-unsupported@app.dart'
    );
  });

  it('maps only diagnostic codes that actually describe unknown or unresolved state', () => {
    expect(
      projectLegacyUnknownItems({
        unknownCount: 1,
        diagnostics: [{ code: 'graph.provider.source_symbol_binding.ambiguous_calls' }],
      })
    ).toEqual([{ family: 'legacy-binding-coverage', code: 'legacy.binding-coverage.1' }]);
    expect(
      projectLegacyUnknownItems({
        unknownCount: 1,
        diagnostics: [{ code: 'graph.provider.local_import.unresolved' }],
      })
    ).toEqual([
      { family: 'legacy-diagnostic-unknown', code: 'graph.provider.local_import.unresolved' },
    ]);
  });
});
