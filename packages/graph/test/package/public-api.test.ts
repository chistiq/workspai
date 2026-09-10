import { describe, expect, it } from 'vitest';
import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';

import {
  GRAPH_CLI_EXIT_CODES,
  GRAPH_PACKAGE_METADATA,
  GRAPH_STANDALONE_SUPPORT_MATRIX,
  GRAPH_STANDARD_COMPOSITION_POLICY,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildRepoGraph,
  composeGraph,
  createQueryCacheKey,
  getGraphPackageStatus,
  queryGraph,
} from '../../src/index.js';
import {
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
} from '../../src/contracts/index.js';
import {
  createPackageJsonProvider,
  createRepositoryFilesProvider,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';

describe('@workspai/graph development package', () => {
  it('is explicitly non-publishable and honest about implemented capabilities', () => {
    expect(GRAPH_PACKAGE_METADATA.publishable).toBe(false);
    expect(GRAPH_PACKAGE_METADATA.maturity).toBe('repository-preview-candidate');
    expect(GRAPH_PACKAGE_METADATA.implementedCapabilities).toEqual([
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
      'optional-query-cache-store',
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
      'governed-repository-build-orchestration',
      'bounded-repository-file-inventory-port',
      'official-offline-repository-providers',
      'node-repository-preview-adapter',
      'repository-contract-runtime-delivery-surfaces',
      'safe-local-git-head-evidence',
      'declarative-structural-extractor-profile',
      'literal-route-extraction',
      'unsupported-language-abstention',
      'multi-language-repository-fixtures',
      'fixed-repository-preview-views',
      'bounded-review-context-slice',
      'project-local-atomic-persistence',
      'explicit-generation-publication',
      'standalone-executable',
      'installed-cli-smoke',
      'honest-incremental-execution-accounting',
      'scan-profile-merkle-leaf-identity',
      'executed-canonical-generation-delta',
      'query-cache-store-invalidation',
      'merkle-unequal-branch-walk',
      'semantic-dependency-shard-invalidation',
      'observation-excluded-merkle-identity',
      'git-nongit-incremental-digest-parity',
      'official-provider-incremental-equivalence',
      'similarity-barred-from-canonical-reuse',
      'added-input-provider-reobservation',
      'nfc-portable-content-locators',
      'official-cross-language-incremental-mutations',
      'profile-driven-projection',
      'workspace-graph-composition',
      'incremental-engine',
      'proposed-change-overlay',
      'standalone-cli-json-contract',
      'standalone-support-matrix',
      'cyclonedx-sbom-candidate',
      'synthetic-retrieval-benchmark',
      'packed-artifact-security-scan',
      'public-release-inventory-candidate',
      'packed-conformance-corpus',
      'incident-rollback-boundary-candidate',
      'packed-version-1-query-preset-jobs',
    ]);
    expect([...GRAPH_PACKAGE_METADATA.plannedCapabilities]).toEqual([
      'standalone-stable',
      'public-preview',
      'cli-shadow-parity',
    ]);
  });

  it('exports the G3 proof-carrying query candidate without claiming stable publication', () => {
    expect(queryGraph).toBeTypeOf('function');
    expect(createQueryCacheKey).toBeTypeOf('function');
    expect(GRAPH_PACKAGE_METADATA.publishable).toBe(false);
  });

  it('exports the host-neutral G4 repository build candidate without Node coupling', () => {
    expect(buildRepoGraph).toBeTypeOf('function');
    expect(GRAPH_STANDARD_REPO_BUILD_POLICY).toMatchObject({
      network: 'deny',
      redactionProfile: 'portable-default',
      sensitiveFiles: 'omit-known',
    });
    expect(GRAPH_PACKAGE_METADATA.publishable).toBe(false);
  });

  it('returns a WIS-shaped status without claiming standalone stability', () => {
    const result = getGraphPackageStatus({ kind: 'project', projectIds: ['project:fixture'] });

    expect(result.status).toBe('partial');
    expect(result.operationOutcome).toBe('succeeded');
    expect(result.payload).toBe(GRAPH_PACKAGE_METADATA);
    expect(result.omissions).toEqual([
      expect.objectContaining({ code: 'GRAPH_ENGINE_NOT_STANDALONE_STABLE' }),
    ]);
    expect(result.compatibility.unsupportedCapabilities).toEqual([
      ...GRAPH_STANDALONE_SUPPORT_MATRIX.unsupportedCapabilities,
    ]);
    expect(result.compatibility.unsupportedCapabilities).not.toContain('query');
    expect(result.compatibility.unsupportedCapabilities).not.toContain('persistence');
    expect(result.compatibility.unsupportedCapabilities).not.toContain('incremental');
    expect(GRAPH_CLI_EXIT_CODES.rejected).toBe(3);
    expect(GRAPH_STANDALONE_SUPPORT_MATRIX.standaloneStable).toBe(false);
    expect(validateWisCoreResultEnvelope(result)).toMatchObject({ valid: true });
  });

  it('exports the G2 composition candidate without exposing infrastructure adapters', () => {
    expect(composeGraph).toBeTypeOf('function');
    expect(GRAPH_STANDARD_COMPOSITION_POLICY).toMatchObject({
      id: 'workspai.graph.composition.standard',
      version: '0.1.0-candidate',
    });
    expect(Object.isFrozen(GRAPH_STANDARD_COMPOSITION_POLICY)).toBe(true);
  });

  it('exports provider manifest and detection contracts through the public contracts entrypoint', () => {
    expect(GRAPH_PROVIDER_MANIFEST_CONTRACT).toEqual({
      id: 'workspai.graph.provider-manifest',
      version: '0.1.0-candidate',
    });
    expect(GRAPH_PROVIDER_DETECTION_CONTRACT).toEqual({
      id: 'workspai.graph.provider-detection',
      version: '0.1.0-candidate',
    });
    expect(Object.isFrozen(GRAPH_PROVIDER_DETECTION_CONTRACT)).toBe(true);
  });

  it('exports only deterministic offline providers in the standard repository set', () => {
    expect(createRepositoryFilesProvider().manifest.permissions).toMatchObject({
      network: 'deny',
      process: 'deny',
      credentials: 'deny',
    });
    expect(createPackageJsonProvider().manifest.permissions).toMatchObject({
      network: 'deny',
      process: 'deny',
      credentials: 'deny',
    });
    const providers = createStandardRepositoryProviders();
    expect(providers).toHaveLength(7);
    expect(Object.isFrozen(providers)).toBe(true);
  });
});
