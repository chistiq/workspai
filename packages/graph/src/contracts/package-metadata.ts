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
  implementedCapabilities: [
    'package-status',
    'shared-adoption-conformance',
    'entity-identity-contract-candidate',
    'provider-manifest-contract-candidate',
    'provider-detection-contract-candidate',
    'fact-batch-contract-candidate',
    'foundation-semantic-admission',
    'provider-output-admission',
    'generated-wire-types',
    'content-addressed-contract-catalog',
    'portable-identity-normalization',
    'ontology-semantic-admission',
    'canonical-graph-semantic-admission',
    'generation-publication-semantic-admission',
    'graph-model-generation-binding-admission',
    'quality-semantic-admission',
    'query-cache-lifecycle-semantic-admission',
    'bounded-canonical-digest-replay',
    'evidence-independence-assessment',
  ] as const,
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
