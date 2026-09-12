import { defineWisContract } from '@workspai/shared/contracts';

import type { GraphDiagnostic, GraphUnknownZone } from './foundation.js';
import type { GraphGenerationRef, GraphQualityReport, GraphQualityVerdict } from './graph.js';
import type {
  GraphChangeCause,
  GraphDeltaExecutionAccounting,
  GraphInputChange,
} from './incremental.js';

export const GRAPH_PROPOSED_CHANGE_SET_CONTRACT = defineWisContract({
  id: 'workspai.graph.proposed-change-set',
  version: '0.1.0-candidate',
});

export const GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT = defineWisContract({
  id: 'workspai.graph.proposed-graph-delta',
  version: '0.1.0-candidate',
});

export const GRAPH_CHANGE_OVERLAY_CONTRACT = defineWisContract({
  id: 'workspai.graph.change-overlay',
  version: '0.1.0-candidate',
});

export type GraphChangeProposalKind =
  'patch' | 'working-tree' | 'branch' | 'pull-request' | 'external';

export interface GraphChangeProposal {
  readonly kind: GraphChangeProposalKind;
  readonly identity: string;
  readonly digest: string;
}

/** Declares proposed inputs against one immutable base generation. */
export interface GraphProposedChangeSet {
  readonly contract: typeof GRAPH_PROPOSED_CHANGE_SET_CONTRACT;
  readonly id: string;
  readonly baseGeneration: string;
  readonly inputs: readonly GraphInputChange[];
  readonly causes: readonly GraphChangeCause[];
  readonly proposal: GraphChangeProposal;
  readonly assumptions: readonly string[];
}

/** Predicted delta bound to an ephemeral overlay rather than a canonical generation. */
export interface GraphProposedGraphDelta {
  readonly contract: typeof GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT;
  readonly baseGeneration: string;
  readonly targetOverlay: string;
  readonly changedInputs: readonly GraphInputChange[];
  readonly affectedProviders: readonly string[];
  readonly facts: {
    readonly added: readonly string[];
    readonly renewed: readonly string[];
    readonly removed: readonly string[];
    readonly invalidated: readonly string[];
  };
  readonly graph: {
    readonly addedNodes: readonly string[];
    readonly removedNodes: readonly string[];
    readonly changedNodes: readonly string[];
    readonly changedEdges: readonly string[];
    readonly addedAssertions: readonly string[];
    readonly removedAssertions: readonly string[];
    readonly changedAssertions: readonly string[];
  };
  readonly affectedProjections: readonly string[];
  readonly downstreamInvalidations: readonly string[];
  readonly execution: GraphDeltaExecutionAccounting;
  readonly equivalence: GraphQualityVerdict | 'not-assessed';
}

export type GraphChangeOverlayStatus = 'complete' | 'partial' | 'failed' | 'stale';

/** Non-canonical, generation-bound prediction over an immutable base graph. */
export interface GraphChangeOverlay {
  readonly contract: typeof GRAPH_CHANGE_OVERLAY_CONTRACT;
  readonly id: string;
  readonly baseGeneration: GraphGenerationRef;
  readonly proposal: GraphChangeProposal;
  readonly status: GraphChangeOverlayStatus;
  readonly proposedChangeSet: GraphProposedChangeSet;
  readonly predictedDelta: GraphProposedGraphDelta;
  readonly quality: GraphQualityReport;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly generatedAt: string;
  readonly expiresAt?: string;
}

export type GraphOverlayStalenessReason =
  'base-generation-changed' | 'proposal-changed' | 'overlay-expired';

export interface GraphOverlayStalenessResult {
  readonly stale: boolean;
  readonly reasons: readonly GraphOverlayStalenessReason[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

export type GraphOverlayMergeOrderRisk = 'none' | 'shared-inputs' | 'shared-providers';

export interface GraphChangeOverlayOverlapResult {
  readonly sharedChangedLocators: readonly string[];
  readonly sharedAffectedProviders: readonly string[];
  readonly advisoryMergeOrderRisk: GraphOverlayMergeOrderRisk;
  readonly limitations: readonly string[];
  readonly diagnostics: readonly GraphDiagnostic[];
}
