import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_PACKAGE_STATUS_CONTRACT = defineWisContract({
  id: 'workspai.graph.package-status',
  version: '0.1.0-draft',
});

export const GRAPH_PACKAGE_MATURITY = 'query-candidate' as const;

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
    'deterministic-reference-composition',
    'evidence-backed-proof-evaluation',
    'functional-conflict-preservation',
    'graph-quality-assessment',
    'injected-execution-ports',
    'validated-worker-output-accounting',
    'node-reference-worker-adapter',
    'non-publishable-cancellation',
    'versioned-proof-policy-assessment',
    'cross-layer-binding-profiles',
    'deterministic-proof-carrying-query',
    'bounded-query-planning',
    'deterministic-query-pagination',
    'operational-risk-abstention',
    'query-result-semantic-admission',
    'query-scale-baseline',
  ] as const,
  plannedCapabilities: [
    'projection',
    'incremental',
    'storage-adapters',
    'provider-runtime',
    'cli-shadow-parity',
  ] as const,
});

export type GraphPackageMetadata = typeof GRAPH_PACKAGE_METADATA;
