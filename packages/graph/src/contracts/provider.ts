import { defineWisContract } from '@workspai/shared/contracts';
import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphDiagnostic,
  GraphEntityIdentityInput,
  GraphEntityIdentityNormalization,
  GraphFactBatch,
  GraphProviderIdentity,
  GraphScope,
  GraphValidationResult,
} from './foundation.js';

export const GRAPH_PROVIDER_MANIFEST_CONTRACT = defineWisContract({
  id: 'workspai.graph.provider-manifest',
  version: '0.1.0-candidate',
});
export const GRAPH_PROVIDER_DETECTION_CONTRACT = defineWisContract({
  id: 'workspai.graph.provider-detection',
  version: '0.1.0-candidate',
});

export type GraphRelationSemantics = 'structural' | 'behavioral' | 'declarative' | 'derived';

export interface GraphProviderCapabilityClaim {
  readonly entityKinds: readonly string[];
  readonly relationKinds: readonly string[];
  readonly relationSemantics: readonly GraphRelationSemantics[];
  readonly factFamilies: readonly string[];
  readonly allowedClaims: readonly string[];
}

export interface GraphProviderPermissions {
  readonly filesystem: 'none' | 'read';
  readonly network: 'deny' | 'allow';
  readonly process: 'deny' | 'allow';
  readonly credentials: 'deny' | 'allow';
}

export interface GraphProviderLimits {
  readonly maxDurationMs: number;
  readonly maxFacts: number;
  readonly maxInputBytes?: number;
}

export interface GraphProviderManifest {
  readonly contract: typeof GRAPH_PROVIDER_MANIFEST_CONTRACT;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly determinism: 'deterministic' | 'seeded' | 'nondeterministic';
  readonly capabilities: GraphProviderCapabilityClaim;
  readonly permissions: GraphProviderPermissions;
  readonly limits: GraphProviderLimits;
  readonly contractVersions: readonly string[];
  readonly supportedInputs: readonly string[];
  readonly incremental: 'none' | 'input' | 'native';
  readonly identitySchemes: readonly { readonly id: string; readonly version: string }[];
}

export interface GraphProviderDetectionRequest {
  readonly availableInputs: readonly string[];
  readonly scopeKind: 'project' | 'workspace';
  readonly networkAllowed: boolean;
}

export interface GraphProviderDetectionResult {
  readonly contract: typeof GRAPH_PROVIDER_DETECTION_CONTRACT;
  readonly provider: { readonly id: string; readonly version: string };
  readonly status: 'applicable' | 'not-applicable' | 'blocked' | 'unknown';
  readonly matchedInputs: readonly string[];
  readonly missingPermissions: readonly string[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

/** A content-addressed, portable input visible to repository providers. */
export interface GraphProviderInput {
  readonly locator: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly digest: WisDigestReference;
}

export interface GraphProviderCollectionRequest {
  readonly scope: GraphScope;
  readonly inputs: readonly GraphProviderInput[];
  readonly observedAt: string;
  readonly resolveIdentity: (
    input: GraphEntityIdentityInput
  ) => Promise<GraphValidationResult<GraphEntityIdentityNormalization>>;
  readonly readInput: (
    input: GraphProviderInput,
    options: { readonly maxBytes: number; readonly signal?: AbortSignal }
  ) => Promise<Uint8Array>;
  readonly signal?: AbortSignal;
}

export interface GraphProviderRuntime {
  readonly manifest: GraphProviderManifest;
  detect(request: GraphProviderDetectionRequest): Promise<unknown> | unknown;
  collect(request: GraphProviderCollectionRequest): Promise<unknown> | unknown;
}

export interface GraphProviderRunSummary {
  readonly provider: GraphProviderIdentity;
  readonly detection: GraphProviderDetectionResult['status'] | 'invalid' | 'failed';
  readonly collection: GraphFactBatch['status'] | 'not-run' | 'invalid';
  readonly factCount: number;
  readonly diagnostics: readonly GraphDiagnostic[];
}

export function defineGraphProviderManifest<const TManifest extends GraphProviderManifest>(
  manifest: TManifest
): Readonly<TManifest> {
  return Object.freeze({ ...manifest });
}
