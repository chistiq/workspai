import { defineWisContract, type WisContractReference } from '@workspai/shared/contracts';

export const GRAPH_PROVIDER_MANIFEST_CONTRACT = defineWisContract({
  id: 'workspai.graph.provider-manifest',
  version: '0.1.0-draft',
} satisfies WisContractReference);

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
}

export function defineGraphProviderManifest<const TManifest extends GraphProviderManifest>(
  manifest: TManifest
): Readonly<TManifest> {
  return Object.freeze({ ...manifest });
}
