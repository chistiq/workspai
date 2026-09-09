import { describe, expect, it } from 'vitest';

import { GRAPH_ADAPTERS_AVAILABLE } from '../../src/adapters/index.js';
import { GRAPH_CONFORMANCE_PROFILE } from '../../src/conformance/index.js';
import {
  GRAPH_TRUTH_DEPENDENCY_DIRECTION,
  GRAPH_TRUTH_INVARIANTS,
} from '../../src/domain/index.js';
import {
  GRAPH_PROJECTIONS_AVAILABLE,
  GRAPH_REPOSITORY_PREVIEW_VIEWS_AVAILABLE,
} from '../../src/projections/index.js';
import { GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES } from '../../src/testing/index.js';

describe('developing Graph package surfaces', () => {
  it('locks the one-way truth direction and core invariants', () => {
    expect(GRAPH_TRUTH_DEPENDENCY_DIRECTION).toEqual([
      'wis-contracts',
      'facts-and-evidence',
      'canonical-graph-generation',
      'model-and-consumer-projections',
    ]);
    expect(GRAPH_TRUTH_INVARIANTS).toContain('model-does-not-write-back-graph-truth');
  });

  it('exposes the admitted execution adapter while keeping later projections unavailable', () => {
    expect(GRAPH_ADAPTERS_AVAILABLE).toBe(true);
    expect(GRAPH_PROJECTIONS_AVAILABLE).toBe(false);
    expect(GRAPH_REPOSITORY_PREVIEW_VIEWS_AVAILABLE).toBe(true);
  });

  it('publishes query conformance without granting production trust', () => {
    expect(GRAPH_CONFORMANCE_PROFILE.maturity).toBe('query-candidate');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('architecture-boundaries');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('security-adversarial');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('reference-composition');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('proof-carrying-query');
  });

  it('lists the central CLI and consumer frameworks as forbidden runtime dependencies', () => {
    expect(GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES).toEqual(
      expect.arrayContaining(['workspai', 'commander', 'vscode'])
    );
  });
});
