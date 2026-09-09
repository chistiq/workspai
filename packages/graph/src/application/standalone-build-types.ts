import type { GraphScope } from '../contracts/index.js';
import type { GraphWorkspaceOnboardingPort } from '../contracts/workspace-integration.js';
import type { GraphProjectArtifactStorePort, GraphProductHostPorts } from '../ports/index.js';

import type { GraphRepoBuildRequest } from './repo-build-types.js';
import type { GraphDualScopeGraphResult } from './workspace-build-types.js';
import type { GraphWorkspaceBuildPolicy } from './workspace-build-types.js';

export type GraphStandaloneMode =
  'project-only' | 'project-and-default-workspace' | 'project-and-existing-workspace';

export interface GraphStandaloneInteraction {
  readonly approved: boolean;
}

export interface GraphStandaloneGraphRequest {
  readonly repo: GraphRepoBuildRequest;
  readonly mode: GraphStandaloneMode;
  readonly workspace?: {
    readonly id?: string;
    readonly root?: string;
  };
  readonly workspacePolicy: GraphWorkspaceBuildPolicy;
  readonly write: boolean;
  readonly projectStore?: GraphProjectArtifactStorePort;
  readonly workspaceStore?: GraphProjectArtifactStorePort;
  readonly onboarding?: GraphWorkspaceOnboardingPort;
  readonly interaction: GraphStandaloneInteraction;
  readonly signal?: AbortSignal;
}

export type GraphStandaloneGraphExecution =
  | {
      readonly accepted: true;
      readonly value: GraphDualScopeGraphResult;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly code: 'invalid-input' | 'cancelled';
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };

export function projectIdentityFromScope(scope: GraphScope): string | undefined {
  if (scope.kind === 'project') return scope.projectIds[0];
  return undefined;
}

export function workspaceScope(
  workspaceId: string
): Extract<GraphScope, { readonly kind: 'workspace' }> {
  return Object.freeze({ kind: 'workspace', workspaceId });
}

export type { GraphProductHostPorts };
