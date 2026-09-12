import { describe, expect, it } from 'vitest';

import { getGraphPackageStatus } from '../../src/index.js';
import {
  GRAPH_SHARED_ADOPTION_PROFILE,
  assessGraphSharedEnvelope,
} from '../../src/conformance/index.js';

const scope = { kind: 'workspace', workspaceId: 'workspace:shared-adoption' } as const;

function previousEnvelope(): Record<string, unknown> {
  return {
    specVersion: 'wis-candidate',
    coreVersion: '0.1.0-draft',
    schemaId: 'https://schemas.workspai.dev/wis/core/result-envelope/0.1.0-draft',
    profile: { id: 'workspai.graph.package-status', version: '0.1.0-draft' },
    producer: { id: '@workspai/graph', version: '0.0.0-development' },
    operation: 'inspect-package-status',
    scope,
    generation: {
      id: 'generation:previous-graph:1',
      generatedAt: '2026-08-15T00:00:00.000Z',
    },
    outcome: 'partial',
    payload: { maturity: 'contract-design' },
    evidence: [],
    freshness: { status: 'current', evaluatedAt: '2026-08-15T00:00:00.000Z' },
    unknowns: [],
    omissions: [
      {
        code: 'GRAPH_PREVIOUS_DOMAIN_CONTRACT',
        reason: 'The previous domain contract requires explicit migration.',
        affectsStatus: true,
        recoverable: true,
        scope,
      },
    ],
    diagnostics: [],
  };
}

describe('independent Shared domain adoption', () => {
  it('accepts an exact current Graph envelope and carries registry identity', () => {
    const result = assessGraphSharedEnvelope(getGraphPackageStatus(scope));

    expect(result).toMatchObject({
      accepted: true,
      status: 'exact',
      sharedContract: {
        id: 'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft',
        version: '0.2.0-draft',
      },
    });
    expect(GRAPH_SHARED_ADOPTION_PROFILE.requiredSharedSubpaths).toEqual([
      '@workspai/shared/contracts',
      '@workspai/shared/compatibility',
      '@workspai/shared/validation',
      '@workspai/shared/registry',
    ]);
    expect(Object.isFrozen(GRAPH_SHARED_ADOPTION_PROFILE)).toBe(true);
    expect(Object.isFrozen(GRAPH_SHARED_ADOPTION_PROFILE.requiredSharedSubpaths)).toBe(true);
  });

  it('rejects structurally invalid and unsupported Shared envelopes', () => {
    expect(assessGraphSharedEnvelope(null)).toMatchObject({
      accepted: false,
      status: 'invalid-shared-envelope',
    });
    expect(
      assessGraphSharedEnvelope({ ...getGraphPackageStatus(scope), coreVersion: '99.0.0' })
    ).toMatchObject({ accepted: false, status: 'unsupported-shared-version' });
  });

  it('does not mistake Shared envelope migration for Graph-domain migration', () => {
    expect(assessGraphSharedEnvelope(previousEnvelope())).toMatchObject({
      accepted: false,
      status: 'domain-contract-migration-required',
      diagnostics: [{ code: 'GRAPH_DOMAIN_MIGRATION_REQUIRED' }],
    });
  });

  it('rejects foreign producers and unknown Graph-domain schemas without echoing payloads', () => {
    const original = getGraphPackageStatus(scope);
    const secret = 'do-not-echo-domain-payload';
    const foreign = assessGraphSharedEnvelope({
      ...original,
      producer: { id: 'foreign.consumer', version: '1.0.0' },
      payload: { secret },
    });
    const unknown = assessGraphSharedEnvelope({
      ...original,
      schemaId: 'workspai.graph.unknown',
      payload: { secret },
    });

    expect(foreign).toMatchObject({ accepted: false, status: 'foreign-producer' });
    expect(unknown).toMatchObject({ accepted: false, status: 'unsupported-graph-schema' });
    expect(JSON.stringify([foreign, unknown])).not.toContain(secret);
  });

  it('honors Shared cancellation at the domain boundary', () => {
    expect(
      assessGraphSharedEnvelope(getGraphPackageStatus(scope), {
        signal: {
          get aborted() {
            return true;
          },
        },
      })
    ).toMatchObject({
      accepted: false,
      status: 'invalid-shared-envelope',
      diagnostics: [{ code: 'WIS_RESOURCE_CANCELLED' }],
    });
  });
});
