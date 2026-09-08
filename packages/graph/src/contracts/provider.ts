import { defineWisContract } from '@workspai/shared/contracts';

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

export function defineGraphProviderManifest<const TManifest extends GraphProviderManifest>(
  manifest: TManifest
): Readonly<TManifest> {
  return Object.freeze({ ...manifest });
}
