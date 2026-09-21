/**
 * Semantic extraction-environment digest. Session reuse is valid only when this
 * digest matches the current request and the current provider/policy boundary
 * still admits the stored sources. Volatile clocks, durations, and RSS never
 * participate.
 *
 * Host repository paths are hashed into an internal root digest. That digest
 * is session-local and is not published as graph identity.
 */
import {
  GRAPH_ENTITY_IDENTITY_CONTRACT,
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_LOCATOR_IDENTITY_LAW,
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE,
  type GraphOntologyProfile,
  type GraphProviderInput,
  type GraphProviderManifest,
  type GraphProviderRuntime,
  type GraphScope,
} from '../contracts/index.js';
import {
  GRAPH_GO_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_HTTP_RUNTIME_CAPABILITIES_VERSION,
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES,
} from '../contracts/http-runtime-capabilities.js';
import { validateGraphProviderManifest } from '../conformance/index.js';
import { isGraphFactAdmitted } from '../domain/admitted-graph-facts.js';
import type { GraphDigestPort } from '../ports/index.js';

import { GRAPH_COMPOSITION_ORDERING_RULES } from './composition-types.js';
import type { GraphCompositionSource } from './composition-types.js';
import { digestCanonicalGraphInput } from './digest-canonical-graph-input.js';
import type { GraphRepoBuildPolicy, GraphRepoBuildRequest } from './repo-build-types.js';
import type { GraphDiagnostic } from '../contracts/index.js';

export const GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA =
  'workspai.graph.extraction-environment.v1' as const;
export const GRAPH_PRODUCT_SCAN_PROFILE_ID = 'workspai.graph.node-product-scan-profile.v1' as const;
export const GRAPH_LANGUAGE_RUNTIME_DETECTION_VERSION =
  'workspai.graph.language-runtime-detection.v1' as const;
export const GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION =
  'workspai.graph.call-resolution-environment.v2' as const;
export const GRAPH_NATIVE_ENGINE_ABI_VERSION = 1 as const;
export const GRAPH_ECMASCRIPT_SYNTAX_VERSION = 'workspai.graph.ecmascript-syntax.v1' as const;
export const GRAPH_MATRIX_SOURCE_MASK_VERSION = 'workspai.graph.matrix-source-mask.v1' as const;
export const GRAPH_EXTRACTION_SUPPORT_VERSION = 'workspai.graph.extraction-support.v1' as const;
const GRAPH_WORKSPACE_IDENTITY_INPUT_LOCATOR = 'workspai.workspace-identity';

/**
 * Inputs that must change the extraction-environment digest when they change
 * semantics. This is the cache-key/receipt dependency matrix.
 */
export const GRAPH_EXTRACTION_ENVIRONMENT_DEPENDENCIES = Object.freeze([
  Object.freeze({
    id: 'scope',
    role: 'canonical requested project/workspace identity for every admitted fact',
  }),
  Object.freeze({
    id: 'workspaceIdentity',
    role: 'host-supplied workspace identity input digest when present',
  }),
  Object.freeze({
    id: 'repositoryRootDigest',
    role: 'session-internal hash of the repository root string; never published',
  }),
  Object.freeze({
    id: 'inventory',
    role: 'locator identity, media type, byte length, and content digest of every leaf',
  }),
  Object.freeze({
    id: 'providerManifests',
    role: 'full provider manifest semantic digest, not id/version alone',
  }),
  Object.freeze({
    id: 'providerConfiguration',
    role: 'permissions, limits, capabilities, supported inputs, determinism, identity schemes',
  }),
  Object.freeze({
    id: 'detectionInputs',
    role: 'available input locators, scope kind, and networkAllowed',
  }),
  Object.freeze({
    id: 'collectionPolicy',
    role: 'redaction, excluded directories, sensitive-file policy, and read-byte limits',
  }),
  Object.freeze({
    id: 'networkPermissionPolicy',
    role: 'repository network allow/deny bound before reuse',
  }),
  Object.freeze({
    id: 'processPermissionPolicy',
    role: 'standalone builds never grant process execution',
  }),
  Object.freeze({
    id: 'credentialPermissionPolicy',
    role: 'standalone builds never grant credentials',
  }),
  Object.freeze({
    id: 'redactionProfile',
    role: 'batch redaction policy must equal the current request profile',
  }),
  Object.freeze({
    id: 'scanProfile',
    role: 'inventory ignore/generated classification profile identity',
  }),
  Object.freeze({
    id: 'ontology',
    role: 'full ontology profile used for admission and composition',
  }),
  Object.freeze({
    id: 'architectureEpoch',
    role: 'composition architecture epoch',
  }),
  Object.freeze({
    id: 'compositionPolicy',
    role: 'full composition policy including inferred-claim and resource bounds',
  }),
  Object.freeze({
    id: 'orderingRules',
    role: 'deterministic composition ordering rule identity',
  }),
  Object.freeze({
    id: 'languageRuntimeDetectionVersion',
    role: 'language/runtime classification contract',
  }),
  Object.freeze({
    id: 'structuralExtractorProfile',
    role: 'language extension and extraction-support registry',
  }),
  Object.freeze({
    id: 'httpRuntimeCapabilities',
    role: 'framework specifier/constructor/method registry used by route binding',
  }),
  Object.freeze({
    id: 'callResolutionEnvironment',
    role: 'import/export/call/route binding algorithm version',
  }),
  Object.freeze({
    id: 'maskingAndSyntaxVersions',
    role: 'comment/string mask and ECMAScript syntax scanner versions',
  }),
  Object.freeze({
    id: 'identityAndLocatorLaw',
    role: 'portable entity identity scheme and locator identity law',
  }),
  Object.freeze({
    id: 'nativeEngineAbi',
    role: 'declaration-kernel ABI so a kernel change cannot silently reuse facts',
  }),
] as const);

export interface GraphExtractionEnvironmentRequest {
  readonly root: string;
  readonly scope: GraphScope;
  readonly ontology: GraphOntologyProfile;
  readonly providers: readonly GraphProviderRuntime[];
  readonly policy: GraphRepoBuildPolicy;
  readonly inputs: readonly GraphProviderInput[];
  readonly digest: GraphDigestPort;
}

export interface GraphExtractionEnvironmentDigests {
  readonly schema: typeof GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA;
  /** Full environment including inventory membership and content. Session source reuse. */
  readonly digest: { readonly algorithm: 'sha256'; readonly value: string };
  /**
   * Scope, policy, ontology, providers, and algorithm versions without inventory
   * bytes. Locator shards survive one-file content changes when this is stable.
   */
  readonly stableBoundaryDigest: { readonly algorithm: 'sha256'; readonly value: string };
}

function canonicalScope(scope: GraphScope): unknown {
  if (scope.kind === 'project') {
    return Object.freeze({
      kind: 'project',
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      projectIds: Object.freeze(
        [...scope.projectIds].sort((left, right) => left.localeCompare(right))
      ),
    });
  }
  if (scope.kind === 'workspace') {
    return Object.freeze({ kind: 'workspace', workspaceId: scope.workspaceId });
  }
  return Object.freeze(JSON.parse(JSON.stringify(scope)) as unknown);
}

export function scopesEqual(left: GraphScope, right: GraphScope): boolean {
  return JSON.stringify(canonicalScope(left)) === JSON.stringify(canonicalScope(right));
}

function sortedInventory(inputs: readonly GraphProviderInput[]): readonly unknown[] {
  return Object.freeze(
    [...inputs]
      .map((input) =>
        Object.freeze({
          locator: input.locator,
          mediaType: input.mediaType,
          byteLength: input.byteLength,
          digest: Object.freeze({
            algorithm: input.digest.algorithm,
            value: input.digest.value,
          }),
        })
      )
      .sort(
        (left, right) =>
          String((left as { locator: string }).locator).localeCompare(
            String((right as { locator: string }).locator)
          ) ||
          String((left as { digest: { value: string } }).digest.value).localeCompare(
            String((right as { digest: { value: string } }).digest.value)
          )
      )
  );
}

function sortedManifests(
  providers: readonly GraphProviderRuntime[]
): readonly GraphProviderManifest[] {
  return Object.freeze(
    [...providers]
      .map((provider) => {
        try {
          return structuredClone(provider.manifest);
        } catch {
          throw new Error('GRAPH_EXTRACTION_ENVIRONMENT_MANIFEST_NOT_SNAPSHOTTABLE');
        }
      })
      .sort(
        (left, right) =>
          String(left.id).localeCompare(String(right.id)) ||
          String(left.version).localeCompare(String(right.version))
      )
  );
}

function workspaceIdentityDigest(inputs: readonly GraphProviderInput[]): unknown {
  const identity = inputs.find((item) => item.locator === GRAPH_WORKSPACE_IDENTITY_INPUT_LOCATOR);
  if (!identity) return null;
  return Object.freeze({
    locator: identity.locator,
    byteLength: identity.byteLength,
    digest: Object.freeze({ algorithm: identity.digest.algorithm, value: identity.digest.value }),
  });
}

async function repositoryRootDigest(root: string, digest: GraphDigestPort): Promise<string> {
  const encoded = new TextEncoder().encode(
    `${GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA}:repository-root\0${root}`
  );
  return digest.digest(encoded);
}

function permissionAndLimitPolicy(policy: GraphRepoBuildPolicy): unknown {
  return Object.freeze({
    network: policy.network,
    redactionProfile: policy.redactionProfile,
    sensitiveFiles: policy.sensitiveFiles,
    excludedDirectories: Object.freeze([...policy.excludedDirectories]),
    limits: Object.freeze({ ...policy.limits }),
    composition: policy.composition,
  });
}

function algorithmRegistry(): unknown {
  return Object.freeze({
    scanProfileId: GRAPH_PRODUCT_SCAN_PROFILE_ID,
    languageRuntimeDetectionVersion: GRAPH_LANGUAGE_RUNTIME_DETECTION_VERSION,
    callResolutionEnvironmentVersion: GRAPH_CALL_RESOLUTION_ENVIRONMENT_VERSION,
    httpRuntimeCapabilitiesVersion: GRAPH_HTTP_RUNTIME_CAPABILITIES_VERSION,
    nativeEngineAbiVersion: GRAPH_NATIVE_ENGINE_ABI_VERSION,
    ecmascriptSyntaxVersion: GRAPH_ECMASCRIPT_SYNTAX_VERSION,
    matrixSourceMaskVersion: GRAPH_MATRIX_SOURCE_MASK_VERSION,
    extractionSupportVersion: GRAPH_EXTRACTION_SUPPORT_VERSION,
    factBatchContract: GRAPH_FACT_BATCH_CONTRACT,
    identityScheme: GRAPH_IDENTITY_SCHEME,
    entityIdentityContract: GRAPH_ENTITY_IDENTITY_CONTRACT,
    locatorIdentityLaw: GRAPH_LOCATOR_IDENTITY_LAW,
    orderingRuleId: GRAPH_COMPOSITION_ORDERING_RULES.id,
    orderingRules: GRAPH_COMPOSITION_ORDERING_RULES,
    structuralExtractorProfile: GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE,
    httpRuntimeCapabilities: Object.freeze({
      javascript: GRAPH_JS_HTTP_RUNTIME_CAPABILITIES,
      python: GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES,
      go: GRAPH_GO_HTTP_RUNTIME_CAPABILITIES,
    }),
  });
}

function detectionInputs(scope: GraphScope, policy: GraphRepoBuildPolicy): unknown {
  return Object.freeze({
    scopeKind: scope.kind === 'workspace' ? 'workspace' : 'project',
    networkAllowed: policy.network === 'allow',
  });
}

async function buildMaterials(request: GraphExtractionEnvironmentRequest): Promise<{
  readonly full: unknown;
  readonly stable: unknown;
}> {
  const repositoryRoot = await repositoryRootDigest(request.root, request.digest);
  const manifests = sortedManifests(request.providers);
  const inventory = sortedInventory(request.inputs);
  const availableInputs = Object.freeze(
    [...request.inputs.map((input) => input.locator)].sort((left, right) =>
      left.localeCompare(right)
    )
  );
  const stable = Object.freeze({
    schema: GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA,
    scope: canonicalScope(request.scope),
    repositoryRootDigest: repositoryRoot,
    workspaceIdentity: workspaceIdentityDigest(request.inputs),
    ontology: request.ontology,
    providerManifests: manifests,
    policy: permissionAndLimitPolicy(request.policy),
    detection: detectionInputs(request.scope, request.policy),
    algorithms: algorithmRegistry(),
  });
  const full = Object.freeze({
    ...stable,
    inventory,
    availableInputs,
  });
  return { full, stable };
}

export async function digestGraphExtractionEnvironment(
  request: GraphExtractionEnvironmentRequest
): Promise<GraphExtractionEnvironmentDigests> {
  if (request.digest.algorithm !== 'sha256') {
    throw new Error('GRAPH_EXTRACTION_ENVIRONMENT_DIGEST_UNSUPPORTED');
  }
  const materials = await buildMaterials(request);
  const digest = await digestCanonicalGraphInput(materials.full, request.digest);
  const stableBoundaryDigest = await digestCanonicalGraphInput(materials.stable, request.digest);
  if (digest.algorithm !== 'sha256' || stableBoundaryDigest.algorithm !== 'sha256') {
    throw new Error('GRAPH_EXTRACTION_ENVIRONMENT_DIGEST_UNSUPPORTED');
  }
  return Object.freeze({
    schema: GRAPH_EXTRACTION_ENVIRONMENT_SCHEMA,
    digest: Object.freeze({ algorithm: 'sha256' as const, value: digest.value }),
    stableBoundaryDigest: Object.freeze({
      algorithm: 'sha256' as const,
      value: stableBoundaryDigest.value,
    }),
  });
}

function permissionDiagnostic(providerId: string, code: string, message: string): GraphDiagnostic {
  return {
    code,
    severity: 'warning',
    path: `/providers/${encodeURIComponent(providerId)}`,
    message,
  };
}

export function graphProviderPermissionBlocks(
  manifest: GraphProviderManifest,
  policy: GraphRepoBuildPolicy
): readonly GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  if (policy.network === 'deny' && manifest.permissions.network === 'allow') {
    diagnostics.push(
      permissionDiagnostic(
        manifest.id,
        'GRAPH_PROVIDER_NETWORK_DENIED',
        'Provider requires network access but the repository build policy denies it.'
      )
    );
  }
  if (manifest.permissions.process === 'allow') {
    diagnostics.push(
      permissionDiagnostic(
        manifest.id,
        'GRAPH_PROVIDER_PROCESS_DENIED',
        'Standalone repository builds do not grant process execution to providers.'
      )
    );
  }
  if (manifest.permissions.credentials === 'allow') {
    diagnostics.push(
      permissionDiagnostic(
        manifest.id,
        'GRAPH_PROVIDER_CREDENTIALS_DENIED',
        'Standalone repository builds do not grant credentials to providers.'
      )
    );
  }
  return Object.freeze(diagnostics);
}

export type GraphReusedSourceBoundaryResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Current-request security and applicability checks that reused sources must
 * still pass. Matching the stored environment digest is not sufficient if the
 * current provider/policy boundary would have blocked collection.
 */
export function reusedProviderSourcesSatisfyCurrentBoundary(input: {
  readonly sources: readonly GraphCompositionSource[];
  readonly request: Pick<GraphRepoBuildRequest, 'scope' | 'policy' | 'providers'>;
  readonly inputs: readonly GraphProviderInput[];
}): GraphReusedSourceBoundaryResult {
  if (input.sources.length === 0) {
    return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_EMPTY' };
  }
  const currentByIdentity = new Map<string, GraphProviderRuntime>();
  for (const provider of input.request.providers) {
    const identity = `${String(provider.manifest?.id ?? '')}\u0000${String(provider.manifest?.version ?? '')}`;
    currentByIdentity.set(identity, provider);
    if (provider.manifest?.determinism !== 'deterministic') {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_NONDETERMINISTIC' };
    }
  }
  const inputByLocator = new Map(input.inputs.map((item) => [item.locator, item]));
  for (const source of input.sources) {
    if (source.manifest.determinism !== 'deterministic') {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_NONDETERMINISTIC' };
    }
    let manifestSnapshot: unknown;
    try {
      manifestSnapshot = structuredClone(source.manifest);
    } catch {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_MANIFEST_NOT_SNAPSHOTTABLE' };
    }
    const manifest = validateGraphProviderManifest(manifestSnapshot);
    if (!manifest.accepted) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_MANIFEST_INVALID' };
    }
    if (graphProviderPermissionBlocks(manifest.value, input.request.policy).length > 0) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_PERMISSION_DENIED' };
    }
    const current = currentByIdentity.get(`${manifest.value.id}\u0000${manifest.value.version}`);
    if (!current) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_IDENTITY_MISSING' };
    }
    const currentManifest = validateGraphProviderManifest(
      (() => {
        try {
          return structuredClone(current.manifest);
        } catch {
          return null;
        }
      })()
    );
    if (!currentManifest.accepted) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_CURRENT_MANIFEST_INVALID' };
    }
    if (graphProviderPermissionBlocks(currentManifest.value, input.request.policy).length > 0) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_PERMISSION_DENIED' };
    }
    if (source.batch.redaction.policy !== input.request.policy.redactionProfile) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_REDACTION_MISMATCH' };
    }
    if (!scopesEqual(source.batch.scope, input.request.scope)) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_SCOPE_MISMATCH' };
    }
    if (source.batch.facts.length > currentManifest.value.limits.maxFacts) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_FACT_LIMIT' };
    }
    let inputBytes = 0;
    for (const batchInput of source.batch.inputs) {
      const currentInput = inputByLocator.get(batchInput.locator);
      if (!currentInput || currentInput.digest.value !== batchInput.digest.value) {
        return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_INPUT_DRIFT' };
      }
      inputBytes += currentInput.byteLength;
    }
    const providerByteLimit = currentManifest.value.limits.maxInputBytes;
    if (
      providerByteLimit !== undefined &&
      (!Number.isSafeInteger(providerByteLimit) || inputBytes > providerByteLimit)
    ) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_INPUT_BYTE_LIMIT' };
    }
    if (inputBytes > input.request.policy.limits.maxProviderReadBytes) {
      return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_INPUT_BYTE_LIMIT' };
    }
    for (const fact of source.batch.facts) {
      if (!isGraphFactAdmitted(fact)) {
        return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_FACT_NOT_ADMITTED' };
      }
      if (!scopesEqual(fact.scope, input.request.scope)) {
        return { ok: false, reason: 'GRAPH_PROVIDER_REUSE_FACT_SCOPE_MISMATCH' };
      }
    }
  }
  return { ok: true };
}
