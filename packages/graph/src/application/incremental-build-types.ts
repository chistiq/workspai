import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphChangeSet,
  GraphContentStateComparisonBudget,
  GraphContentStateComparisonResult,
  GraphContentStateManifest,
  GraphDelta,
  GraphDiagnostic,
  GraphShardReusePlan,
} from '../contracts/index.js';

import type { GraphIncrementalSemanticStamps } from './collect-semantic-dependencies.js';

export interface GraphIncrementalBuildRequest {
  readonly baseGeneration: string;
  readonly targetGeneration: string;
  readonly baseManifest: GraphContentStateManifest;
  readonly targetManifest: GraphContentStateManifest;
  readonly requiredSemanticDependencies?: readonly WisDigestReference[];
  readonly semanticStamps?: GraphIncrementalSemanticStamps;
  readonly authorizedShardIds?: readonly string[];
  readonly comparisonBudget?: Partial<GraphContentStateComparisonBudget>;
}

export interface GraphIncrementalAccounting {
  readonly merkle: {
    readonly comparedBranches: number;
    readonly skippedBranches: number;
  };
  readonly leaves: {
    readonly added: number;
    readonly edited: number;
    readonly deleted: number;
    readonly renewed: number;
    readonly renameCandidates: number;
    readonly unchanged: number;
  };
  readonly shards: {
    readonly reused: number;
    readonly rejected: number;
  };
  readonly bytes: {
    readonly hashed: number;
    readonly reused: number;
  };
}

export interface GraphIncrementalBuildPlan {
  readonly status: 'complete' | 'partial' | 'failed';
  readonly changeSet: GraphChangeSet;
  readonly delta: GraphDelta;
  readonly comparison: GraphContentStateComparisonResult;
  readonly shardReuse: GraphShardReusePlan;
  readonly providersToRecompute: readonly string[];
  readonly accounting: GraphIncrementalAccounting;
  readonly diagnostics: readonly GraphDiagnostic[];
}
