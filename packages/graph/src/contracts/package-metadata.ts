import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_PACKAGE_STATUS_CONTRACT = defineWisContract({
  id: 'workspai.graph.package-status',
  version: '0.1.0-draft',
});

export const GRAPH_PACKAGE_MATURITY = 'contract-design' as const;

export const GRAPH_PACKAGE_METADATA = Object.freeze({
  name: '@workspai/graph',
  version: '0.0.0-development',
  maturity: GRAPH_PACKAGE_MATURITY,
  publishable: false,
  implementedCapabilities: ['package-status', 'shared-adoption-conformance'] as const,
  plannedCapabilities: [
    'facts',
    'identity',
    'ontology',
    'composition',
    'proof',
    'quality',
    'query',
    'projection',
    'incremental',
  ] as const,
});

export type GraphPackageMetadata = typeof GRAPH_PACKAGE_METADATA;
