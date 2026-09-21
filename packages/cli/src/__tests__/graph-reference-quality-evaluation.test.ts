import { describe, expect, it } from 'vitest';

import {
  evaluationExitCode,
  portableGraphProjectId,
  type GraphReferenceQualityObservation,
} from '../../scripts/graph-reference-quality-evaluation.js';

function passingObservation(
  overrides: Partial<GraphReferenceQualityObservation> = {}
): GraphReferenceQualityObservation {
  return {
    packageExecution: 'complete',
    compositionErrors: [],
    directionalDelta: { status: 'different' },
    deterministicDigest: true,
    deterministicDigestComparison: 'equal',
    unchangedRebuildDigestEqual: true,
    unchangedRebuildDigest: 'equal',
    cancellation: { status: 'cancelled' },
    timeout: { status: 'cancelled' },
    providerFailures: [],
    incrementalSkipReread: {
      assessed: true,
      status: 'complete',
      digestComparison: 'equal',
      digestEqualToCurrentTree: true,
      digestEqualToBase: true,
      equivalence: 'pass',
      inventoryRereadTrust: 'untrusted',
    },
    inventory: { truncated: false },
    ...overrides,
  };
}

describe('graph reference quality evaluation exit code', () => {
  it('returns 0 when every gate holds, including untrusted skip-reread', () => {
    expect(evaluationExitCode([passingObservation()])).toBe(0);
  });

  it('returns 2 for partial execution or resource truncation without treating policy omissions as truncation', () => {
    expect(evaluationExitCode([passingObservation({ packageExecution: 'partial' })])).toBe(2);
    expect(evaluationExitCode([passingObservation({ inventory: { truncated: true } })])).toBe(2);
    expect(
      evaluationExitCode([
        passingObservation({
          deterministicDigest: false,
          deterministicDigestComparison: 'not-assessed',
        }),
      ])
    ).toBe(2);
  });

  it.each([
    ['deterministic digest mismatch', { deterministicDigestComparison: 'different' as const }],
    ['rebuild digest mismatch', { unchangedRebuildDigest: 'different' as const }],
    ['cancellation did not cancel', { cancellation: { status: 'complete' } }],
    ['timeout did not cancel', { timeout: { status: 'complete' } }],
    [
      'incremental execution failed',
      { incrementalSkipReread: { assessed: true, status: 'failed' } },
    ],
    [
      'incremental digest drifted',
      {
        incrementalSkipReread: {
          assessed: true,
          status: 'complete',
          digestComparison: 'different',
          digestEqualToBase: false,
          equivalence: 'pass',
        },
      },
    ],
    [
      'incremental equivalence blocked',
      {
        incrementalSkipReread: {
          assessed: true,
          status: 'complete',
          digestEqualToBase: true,
          equivalence: 'blocked',
        },
      },
    ],
    ['provider failure', { providerFailures: ['GRAPH_PROVIDER_FAILED'] }],
    ['package execution failed', { packageExecution: 'failed' }],
    ['directional delta failed', { directionalDelta: { status: 'failed' } }],
  ] as const)('returns 3 when %s', (_label, overrides) => {
    expect(evaluationExitCode([passingObservation(overrides)])).toBe(3);
  });
});

describe('portableGraphProjectId', () => {
  it('maps mixed-case corpus folder names onto admitted Graph project identifiers', () => {
    expect(portableGraphProjectId('OpenBot')).toBe('openbot');
    expect(portableGraphProjectId('CopilotKit')).toBe('copilotkit');
    expect(portableGraphProjectId('opentelemetry-demo')).toBe('opentelemetry-demo');
    expect(portableGraphProjectId('OpenBot')).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
  });
});
