import { describe, expect, it } from 'vitest';
import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';

import { GRAPH_PACKAGE_METADATA, getGraphPackageStatus } from '../../src/index.js';

describe('@workspai/graph development package', () => {
  it('is explicitly non-publishable and honest about implemented capabilities', () => {
    expect(GRAPH_PACKAGE_METADATA.publishable).toBe(false);
    expect(GRAPH_PACKAGE_METADATA.maturity).toBe('contract-design');
    expect(GRAPH_PACKAGE_METADATA.implementedCapabilities).toEqual([
      'package-status',
      'shared-adoption-conformance',
    ]);
  });

  it('returns a WIS-shaped status without claiming an engine exists', () => {
    const result = getGraphPackageStatus({ kind: 'project', projectIds: ['project:fixture'] });

    expect(result.status).toBe('partial');
    expect(result.operationOutcome).toBe('succeeded');
    expect(result.payload).toBe(GRAPH_PACKAGE_METADATA);
    expect(result.omissions).toEqual([
      expect.objectContaining({ code: 'GRAPH_ENGINE_NOT_IMPLEMENTED' }),
    ]);
    expect(validateWisCoreResultEnvelope(result)).toMatchObject({ valid: true });
  });
});
