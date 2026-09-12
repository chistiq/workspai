import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphChangeOverlay,
  GraphChangeProposal,
  GraphContentStateComparisonBudget,
  GraphContentStateManifest,
  GraphGenerationRef,
} from '../contracts/index.js';

export interface GraphChangeOverlayRequest {
  readonly overlayId: string;
  readonly baseGeneration: GraphGenerationRef;
  readonly baseManifest: GraphContentStateManifest;
  readonly proposedManifest: GraphContentStateManifest;
  readonly proposal: GraphChangeProposal;
  readonly assumptions: readonly string[];
  readonly generatedAt: string;
  readonly expiresAt?: string;
  readonly requiredSemanticDependencies?: readonly WisDigestReference[];
  readonly authorizedShardIds?: readonly string[];
  readonly comparisonBudget?: Partial<GraphContentStateComparisonBudget>;
}

export interface GraphOverlayStalenessRequest {
  readonly overlay: GraphChangeOverlay;
  readonly currentBaseGeneration: GraphGenerationRef;
  readonly currentProposalDigest: string;
  readonly evaluatedAt: string;
}

export interface GraphChangeOverlayOverlapRequest {
  readonly left: GraphChangeOverlay;
  readonly right: GraphChangeOverlay;
}
