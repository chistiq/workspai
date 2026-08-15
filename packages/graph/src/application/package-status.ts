import {
  WIS_CORE_CONTRACT_VERSION,
  type WisResultEnvelope,
  type WisScopeReference,
} from '@workspai/shared/contracts';

import {
  GRAPH_PACKAGE_METADATA,
  GRAPH_PACKAGE_STATUS_CONTRACT,
  type GraphPackageMetadata,
} from '../contracts/index.js';

export { GRAPH_PACKAGE_STATUS_CONTRACT } from '../contracts/index.js';

export function getGraphPackageStatus(
  scope: WisScopeReference
): WisResultEnvelope<GraphPackageMetadata> {
  const generatedAt = new Date().toISOString();

  return {
    specVersion: 'wis-candidate',
    coreVersion: WIS_CORE_CONTRACT_VERSION,
    schemaId: GRAPH_PACKAGE_STATUS_CONTRACT.id,
    profile: { id: 'workspai.graph.package-status', version: '0.1.0-draft' },
    producer: { id: '@workspai/graph', version: GRAPH_PACKAGE_METADATA.version },
    operation: 'inspect-package-status',
    operationOutcome: 'succeeded',
    status: 'partial',
    scope,
    generation: {
      id: `workspai.graph.package-status:${GRAPH_PACKAGE_METADATA.version}:${generatedAt}`,
      generatedAt,
    },
    payload: GRAPH_PACKAGE_METADATA,
    evidence: [],
    freshness: { status: 'current', evaluatedAt: generatedAt },
    unknowns: [],
    diagnostics: [],
    compatibility: {
      status: 'conditionally-compatible',
      unsupportedCapabilities: ['graph-engine'],
    },
    omissions: [
      {
        code: 'GRAPH_ENGINE_NOT_IMPLEMENTED',
        reason: 'The package is intentionally limited to contract-design scaffold capabilities.',
        affectsStatus: true,
        recoverable: true,
        scope,
      },
    ],
  };
}
