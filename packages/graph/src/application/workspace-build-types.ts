import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphDiagnostic,
  GraphGenerationRef,
  GraphProjectMembershipRelationship,
  GraphQualityReport,
  GraphScope,
  GraphValidationIssue,
} from '../contracts/index.js';
import type { GraphProjectGraphReference } from '../contracts/workspace-integration.js';
import type { GraphCompositionPolicy, GraphCompositionSource } from './composition-types.js';
import type { GraphExecutionPorts } from '../ports/index.js';

export interface GraphWorkspaceProjectInput {
  readonly projectIdentity: string;
  readonly graph: GraphCanonicalGraph;
  readonly quality: GraphQualityReport;
  readonly artifactRef: string;
  readonly membership: GraphProjectMembershipRelationship;
}

export interface GraphWorkspaceBuildPolicy {
  readonly network: 'deny' | 'allow';
  readonly redactionProfile: string;
  readonly composition: GraphCompositionPolicy;
}

export interface GraphWorkspaceBuildRequest {
  readonly context: {
    readonly workspaceId: string;
    readonly root: string;
    readonly scope: Extract<GraphScope, { readonly kind: 'workspace' }>;
  };
  readonly projects: readonly GraphWorkspaceProjectInput[];
  readonly sources?: readonly GraphCompositionSource[];
  readonly policy: GraphWorkspaceBuildPolicy;
  readonly ports: GraphExecutionPorts;
  readonly signal?: AbortSignal;
}

export interface GraphWorkspaceBuildMetrics {
  readonly projectCount: number;
  readonly referencedGenerations: number;
  readonly workspaceFacts: number;
}

export interface GraphWorkspaceBuildResult {
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly graph?: GraphCanonicalGraph;
  readonly quality: {
    readonly graph?: GraphQualityReport;
    readonly unknownZones: GraphQualityReport['unknownZones'];
    readonly unsupportedZones: GraphQualityReport['unsupportedZones'];
    readonly providerFailures: readonly GraphDiagnostic[];
  };
  readonly projectReferences: readonly GraphProjectGraphReference[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly metrics: GraphWorkspaceBuildMetrics;
}

export type GraphWorkspaceBuildExecution =
  | {
      readonly accepted: true;
      readonly value: GraphWorkspaceBuildResult;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly code: 'invalid-input' | 'cancelled' | 'composition-failed';
      readonly issues: readonly GraphValidationIssue[];
    };

export interface GraphDualScopeGraphResult {
  readonly status: 'complete-project-only' | 'complete-dual-scope' | 'partial' | 'failed';
  readonly project: {
    readonly build: import('./repo-build-types.js').GraphRepoBuildResult;
    readonly artifact?: string;
    readonly generation?: GraphGenerationRef;
  };
  readonly workspace: {
    readonly status: 'not-requested' | 'complete' | 'handoff-unavailable' | 'failed';
    readonly build?: GraphWorkspaceBuildResult;
    readonly artifact?: string;
    readonly generation?: GraphGenerationRef;
    readonly projectReference?: GraphProjectGraphReference;
    readonly renewalCommand?: string;
  };
  readonly diagnostics: readonly GraphDiagnostic[];
}

export function projectGraphReference(
  input: GraphWorkspaceProjectInput,
  workspaceId: string
): GraphProjectGraphReference {
  return Object.freeze({
    projectIdentity: input.projectIdentity,
    graphGeneration: input.graph.generation.reference.id,
    graphDigest: input.graph.generation.reference.contentDigest as WisDigestReference,
    projectArtifact: input.artifactRef,
    membership: Object.freeze({
      workspaceId,
      relationship: input.membership,
    }),
  });
}
