import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION,
  GRAPH_ECMASCRIPT_SYNTAX_VERSION,
  GRAPH_EXTRACTION_ENVIRONMENT_DEPENDENCIES,
  GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA,
  GRAPH_LANGUAGE_RUNTIME_DETECTION_VERSION,
  GRAPH_MATRIX_SOURCE_MASK_VERSION,
  GRAPH_NATIVE_ENGINE_ABI_VERSION,
  GRAPH_PRODUCT_SCAN_PROFILE_ID,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  digestGraphExtractionEnvironment,
} from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type { GraphProviderInput, GraphProviderRuntime } from '../../src/contracts/index.js';
import type { GraphDigestPort } from '../../src/ports/index.js';
import {
  createPackageJsonProvider,
  createSourceDeclarationsProvider,
  GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION,
} from '../../src/providers/index.js';
import { ECMASCRIPT_SYNTAX_VERSION } from '../../src/providers/ecmascript-syntax.js';
import { MATRIX_SOURCE_MASK_VERSION } from '../../src/providers/matrix-source-mask.js';
import { WORKSPACE_IDENTITY_INPUT_LOCATOR } from '../../src/providers/scope-containment.js';

const digestPort: GraphDigestPort = {
  algorithm: 'sha256',
  digest: async (value) => createHash('sha256').update(value).digest('hex'),
  digestSync: (value) => createHash('sha256').update(value).digest('hex'),
};

const input = (locator: string, bytes: string): GraphProviderInput => {
  const encoded = new TextEncoder().encode(bytes);
  return {
    locator,
    mediaType: 'text/plain',
    byteLength: encoded.byteLength,
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(encoded).digest('hex'),
    },
  };
};

function request(overrides: {
  readonly root?: string;
  readonly scope?: { kind: 'project'; projectIds: [string, ...string[]]; workspaceId?: string };
  readonly ontology?: typeof CORE_GRAPH_ONTOLOGY_PROFILE;
  readonly providers?: readonly GraphProviderRuntime[];
  readonly policy?: typeof GRAPH_STANDARD_REPO_BUILD_POLICY;
  readonly inputs?: readonly GraphProviderInput[];
}) {
  return {
    root: overrides.root ?? '/tmp/graph-extraction-a',
    scope: overrides.scope ?? { kind: 'project' as const, projectIds: ['project:a'] as [string] },
    ontology: overrides.ontology ?? CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: overrides.providers ?? [createPackageJsonProvider()],
    policy: overrides.policy ?? GRAPH_STANDARD_REPO_BUILD_POLICY,
    inputs: overrides.inputs ?? [input('package.json', '{"name":"a"}\n')],
    digest: digestPort,
  };
}

describe('extraction environment digest', () => {
  it('names every semantic dependency required for provider-source reuse', () => {
    const ids = GRAPH_EXTRACTION_ENVIRONMENT_DEPENDENCIES.map((entry) => entry.id);
    expect(GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA).toBe('workspai.graph.extraction-environment.v1');
    expect(ids).toEqual(
      expect.arrayContaining([
        'scope',
        'workspaceIdentity',
        'repositoryRootDigest',
        'inventory',
        'providerManifests',
        'providerConfiguration',
        'detectionInputs',
        'collectionPolicy',
        'networkPermissionPolicy',
        'processPermissionPolicy',
        'credentialPermissionPolicy',
        'redactionProfile',
        'scanProfile',
        'ontology',
        'architectureEpoch',
        'compositionPolicy',
        'orderingRules',
        'languageRuntimeDetectionVersion',
        'structuralExtractorProfile',
        'httpRuntimeCapabilities',
        'callResolutionEnvironment',
        'maskingAndSyntaxVersions',
        'identityAndLocatorLaw',
        'nativeEngineAbi',
      ])
    );
    expect(GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION).toBe(
      'workspai.graph.call-resolution-environment.v2'
    );
    expect(GRAPH_NATIVE_ENGINE_ABI_VERSION).toBe(1);
    expect(GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION).toBe('0.1.0-candidate');
    expect(createSourceDeclarationsProvider().manifest.version).toBe(
      GRAPH_SOURCE_DECLARATIONS_PROVIDER_VERSION
    );
    expect(GRAPH_LANGUAGE_RUNTIME_DETECTION_VERSION).toContain('language-runtime-detection');
    expect(GRAPH_PRODUCT_SCAN_PROFILE_ID).toContain('node-product-scan-profile');
    expect(GRAPH_ECMASCRIPT_SYNTAX_VERSION).toBe(ECMASCRIPT_SYNTAX_VERSION);
    expect(GRAPH_MATRIX_SOURCE_MASK_VERSION).toBe(MATRIX_SOURCE_MASK_VERSION);
    expect(WORKSPACE_IDENTITY_INPUT_LOCATOR).toBe('workspai.workspace-identity');
  });

  it('is stable for identical semantic inputs and changes when scope, root, inventory, policy, or manifests change', async () => {
    const baseline = await digestGraphExtractionEnvironment(request({}));
    const same = await digestGraphExtractionEnvironment(request({}));
    expect(baseline.digest.value).toBe(same.digest.value);
    expect(baseline.stableBoundaryDigest.value).toBe(same.stableBoundaryDigest.value);

    const scoped = await digestGraphExtractionEnvironment(
      request({ scope: { kind: 'project', projectIds: ['project:b'] } })
    );
    expect(scoped.digest.value).not.toBe(baseline.digest.value);
    expect(scoped.stableBoundaryDigest.value).not.toBe(baseline.stableBoundaryDigest.value);

    const rooted = await digestGraphExtractionEnvironment(
      request({ root: '/tmp/graph-extraction-b' })
    );
    expect(rooted.digest.value).not.toBe(baseline.digest.value);

    const inventory = await digestGraphExtractionEnvironment(
      request({ inputs: [input('package.json', '{"name":"b"}\n')] })
    );
    expect(inventory.digest.value).not.toBe(baseline.digest.value);
    expect(inventory.stableBoundaryDigest.value).toBe(baseline.stableBoundaryDigest.value);

    const network = await digestGraphExtractionEnvironment(
      request({
        policy: { ...GRAPH_STANDARD_REPO_BUILD_POLICY, network: 'allow' },
      })
    );
    expect(network.digest.value).not.toBe(baseline.digest.value);

    const redaction = await digestGraphExtractionEnvironment(
      request({
        policy: { ...GRAPH_STANDARD_REPO_BUILD_POLICY, redactionProfile: 'strict-test' },
      })
    );
    expect(redaction.digest.value).not.toBe(baseline.digest.value);

    const composition = await digestGraphExtractionEnvironment(
      request({
        policy: {
          ...GRAPH_STANDARD_REPO_BUILD_POLICY,
          composition: {
            ...GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
            architectureEpoch: 'wis-graph-test',
          },
        },
      })
    );
    expect(composition.digest.value).not.toBe(baseline.digest.value);

    const ontology = await digestGraphExtractionEnvironment(
      request({
        ontology: { ...CORE_GRAPH_ONTOLOGY_PROFILE, id: 'workspai.graph.ontology.env-shifted' },
      })
    );
    expect(ontology.digest.value).not.toBe(baseline.digest.value);

    const baseProvider = createPackageJsonProvider();
    const mutatedLimits = {
      ...baseProvider,
      manifest: {
        ...baseProvider.manifest,
        limits: { ...baseProvider.manifest.limits, maxFacts: 3 },
      },
    };
    const limits = await digestGraphExtractionEnvironment(request({ providers: [mutatedLimits] }));
    expect(limits.digest.value).not.toBe(baseline.digest.value);

    const mutatedVersion = {
      ...baseProvider,
      manifest: { ...baseProvider.manifest, version: '0.1.0-shifted' },
    };
    const version = await digestGraphExtractionEnvironment(
      request({ providers: [mutatedVersion] })
    );
    expect(version.digest.value).not.toBe(baseline.digest.value);

    const workspace = await digestGraphExtractionEnvironment(
      request({
        inputs: [
          input('package.json', '{"name":"a"}\n'),
          {
            locator: 'workspai.workspace-identity',
            mediaType: 'application/json',
            byteLength: 8,
            digest: { algorithm: 'sha256', value: 'b'.repeat(64) },
          },
        ],
      })
    );
    expect(workspace.digest.value).not.toBe(baseline.digest.value);
    expect(workspace.stableBoundaryDigest.value).not.toBe(baseline.stableBoundaryDigest.value);
  });
});
