import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphDiagnostic } from './foundation.js';
import type { GraphGenerationRef } from './graph.js';

export type GraphProjectMembershipRelationship = 'linked' | 'adopted-in-place' | 'local';

export interface GraphProjectGraphReference {
  readonly projectIdentity: string;
  readonly graphGeneration: string;
  readonly graphDigest: WisDigestReference;
  readonly projectArtifact: string;
  readonly membership: {
    readonly workspaceId: string;
    readonly relationship: GraphProjectMembershipRelationship;
  };
}

export type GraphWorkspaceOnboardingMode =
  'project-and-default-workspace' | 'project-and-existing-workspace';

export interface GraphWorkspaceOnboardingRequest {
  readonly mode: GraphWorkspaceOnboardingMode;
  readonly project: {
    readonly proposedId: string;
    readonly root: string;
    readonly graphGeneration: string;
    readonly graphDigest: WisDigestReference;
    readonly artifactRef: string;
  };
  readonly workspace?: { readonly id?: string; readonly root?: string };
  readonly requestedProfile: 'minimal';
  readonly interaction: 'interactive-approved' | 'non-interactive-approved';
}

export interface GraphWorkspaceOnboardingPlan {
  readonly request: GraphWorkspaceOnboardingRequest;
  readonly plannedWrites: readonly string[];
  readonly requiresCentralCli: boolean;
  readonly diagnostics: readonly GraphDiagnostic[];
}

export interface GraphWorkspaceOnboardingResult {
  readonly status: 'linked' | 'adopted-in-place' | 'already-member' | 'failed';
  readonly workspace?: { readonly id: string; readonly root: string; readonly profile: string };
  readonly membership?: GraphProjectGraphReference['membership'];
  readonly plannedWrites: readonly string[];
  readonly appliedWrites: readonly string[];
  readonly workspaceRenewalCommand?: string;
  readonly diagnostics: readonly GraphDiagnostic[];
}

/** Optional handoff to the central CLI; the Graph engine never invokes it directly. */
export interface GraphWorkspaceOnboardingPort {
  plan(input: GraphWorkspaceOnboardingRequest): Promise<GraphWorkspaceOnboardingPlan>;
  apply(
    plan: GraphWorkspaceOnboardingPlan,
    options: { readonly approved: boolean; readonly signal?: AbortSignal }
  ): Promise<GraphWorkspaceOnboardingResult>;
}

export interface GraphWorkspaceContextReference {
  readonly workspaceId: string;
  readonly root: string;
}

export interface GraphDualScopeWorkspaceStatus {
  readonly status: 'not-requested' | 'complete' | 'handoff-unavailable' | 'failed';
  readonly artifact?: string;
  readonly generation?: GraphGenerationRef;
  readonly projectReference?: GraphProjectGraphReference;
  readonly renewalCommand?: string;
}
