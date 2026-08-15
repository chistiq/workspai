import { describe, expect, it } from 'vitest';

import { GRAPH_ADAPTERS_AVAILABLE } from '../../src/adapters/index.js';
import { GRAPH_CONFORMANCE_PROFILE } from '../../src/conformance/index.js';
import {
  GRAPH_TRUTH_DEPENDENCY_DIRECTION,
  GRAPH_TRUTH_INVARIANTS,
} from '../../src/domain/index.js';
import { GRAPH_PROJECTIONS_AVAILABLE } from '../../src/projections/index.js';
import { GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES } from '../../src/testing/index.js';

describe('contract-design scaffold surfaces', () => {
  it('locks the one-way truth direction and core invariants', () => {
    expect(GRAPH_TRUTH_DEPENDENCY_DIRECTION).toEqual([
      'wis-contracts',
      'facts-and-evidence',
      'canonical-graph-generation',
      'model-and-consumer-projections',
    ]);
    expect(GRAPH_TRUTH_INVARIANTS).toContain('model-does-not-write-back-graph-truth');
  });

  it('keeps unavailable runtime surfaces explicitly unavailable', () => {
    expect(GRAPH_ADAPTERS_AVAILABLE).toBe(false);
    expect(GRAPH_PROJECTIONS_AVAILABLE).toBe(false);
  });

  it('publishes a conformance seed without granting production trust', () => {
    expect(GRAPH_CONFORMANCE_PROFILE.maturity).toBe('seed');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('architecture-boundaries');
    expect(GRAPH_CONFORMANCE_PROFILE.requiredSuites).toContain('security-adversarial');
  });

  it('lists the central CLI and consumer frameworks as forbidden runtime dependencies', () => {
    expect(GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES).toEqual(
      expect.arrayContaining(['workspai', 'commander', 'vscode'])
    );
  });
});
