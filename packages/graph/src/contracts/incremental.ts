import type { WisDigestReference } from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import type { GraphDiagnostic, GraphInputProcessingRecord, GraphScope } from './foundation.js';
import type { GraphQualityVerdict } from './graph.js';

export const GRAPH_CHANGE_SET_CONTRACT = defineWisContract({
  id: 'workspai.graph.change-set',
  version: '0.1.0-candidate',
});

export const GRAPH_DELTA_CONTRACT = defineWisContract({
  id: 'workspai.graph.graph-delta',
  version: '0.1.0-candidate',
});

export const GRAPH_CONTENT_STATE_MANIFEST_CONTRACT = defineWisContract({
  id: 'workspai.graph.content-state-manifest',
  version: '0.1.0-candidate',
});

export type GraphInputChangeKind = 'added' | 'edited' | 'deleted' | 'renewed' | 'rename-candidate';

export interface GraphInputChange {
  readonly kind: GraphInputChangeKind;
  readonly locator: string;
  readonly inputKind: string;
  readonly scanProfileDigest: WisDigestReference;
  readonly priorDigest?: WisDigestReference;
  readonly nextDigest?: WisDigestReference;
  readonly renameCandidate?: {
    readonly priorLocator: string;
    readonly nextLocator: string;
    readonly confidence: number;
  };
}

export type GraphChangeCauseKind =
  | 'content'
  | 'provider'
  | 'schema'
  | 'ontology'
  | 'proof-policy'
  | 'scan-profile'
  | 'redaction'
  | 'authorization'
  | 'manual'
  | 'unknown';

export interface GraphChangeCause {
  readonly kind: GraphChangeCauseKind;
  readonly source: string;
  readonly detail?: string;
}

/** Declares changed inputs and causes used to plan incremental work. */
export interface GraphChangeSet {
  readonly contract: typeof GRAPH_CHANGE_SET_CONTRACT;
  readonly id: string;
  readonly baseGeneration?: string;
  readonly inputs: readonly GraphInputChange[];
  readonly causes: readonly GraphChangeCause[];
}

export interface GraphIncrementalTruncationSummary {
  readonly dimension: string;
  readonly limit: number;
  readonly observed: number;
  readonly reason: string;
}

export interface GraphDeltaExecutionAccounting {
  readonly detected: number;
  readonly scanned: number;
  readonly parsed: number;
  readonly recomputed: number;
  readonly skippedByDigest: number;
  readonly unsupported: number;
  readonly failed: number;
  readonly truncation: readonly GraphIncrementalTruncationSummary[];
  readonly processing: readonly GraphInputProcessingRecord[];
}

/** Records facts, graph elements and downstream invalidations between generations. */
export interface GraphDelta {
  readonly contract: typeof GRAPH_DELTA_CONTRACT;
  readonly baseGeneration: string;
  readonly targetGeneration: string;
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
    readonly changedEdges: readonly string[];
  };
  readonly affectedProjections: readonly string[];
  readonly downstreamInvalidations: readonly string[];
  readonly execution: GraphDeltaExecutionAccounting;
  readonly equivalence: GraphQualityVerdict | 'not-assessed';
}

export type GraphContentStateNodeKind = 'file' | 'directory';

export interface GraphContentStateLeaf {
  readonly kind: 'file';
  readonly locator: string;
  readonly contentDigest: WisDigestReference;
  readonly inputKind: string;
  readonly scanProfileDigest: WisDigestReference;
  readonly observations?: {
    readonly sizeBytes?: number;
    readonly modifiedAt?: string;
    readonly gitStatus?: string;
  };
}

export interface GraphContentStateDirectoryChild {
  readonly name: string;
  readonly kind: GraphContentStateNodeKind;
  readonly digest: WisDigestReference;
}

export interface GraphContentStateDirectory {
  readonly kind: 'directory';
  readonly locator: string;
  readonly digest: WisDigestReference;
  readonly children: readonly GraphContentStateDirectoryChild[];
}

export type GraphContentStateNode = GraphContentStateLeaf | GraphContentStateDirectory;

export interface GraphShardDependency {
  readonly shardId: string;
  readonly contentDigest: WisDigestReference;
  readonly semanticDependencies: readonly WisDigestReference[];
  readonly providerStages: readonly string[];
  readonly graphRegions: readonly string[];
  readonly projections: readonly string[];
  readonly queryIndexes: readonly string[];
}

/** Portable content tree and shard dependency manifest for incremental reuse. */
export interface GraphContentStateManifest {
  readonly contract: typeof GRAPH_CONTENT_STATE_MANIFEST_CONTRACT;
  readonly scope: GraphScope;
  readonly merkleRoot: WisDigestReference;
  readonly nodes: readonly GraphContentStateNode[];
  readonly shardDependencies: readonly GraphShardDependency[];
  readonly generatedAt: string;
}

export interface GraphContentStateComparisonBudget {
  readonly maxComparedBranches: number;
  readonly maxChangedInputs: number;
}

export interface GraphContentStateComparisonRequest {
  readonly base: GraphContentStateManifest;
  readonly target: GraphContentStateManifest;
  readonly budget?: Partial<GraphContentStateComparisonBudget>;
}

export type GraphContentStateComparisonStatus = 'complete' | 'partial' | 'failed';

export interface GraphContentStateComparisonResult {
  readonly baseRoot: WisDigestReference;
  readonly targetRoot: WisDigestReference;
  readonly comparedBranches: number;
  readonly skippedBranches: number;
  readonly changedInputs: readonly GraphInputChange[];
  readonly causes: readonly GraphChangeCause[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly truncation?: GraphIncrementalTruncationSummary;
  readonly status: GraphContentStateComparisonStatus;
}
