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

export interface GraphIncrementalBuildRequest {
  readonly baseGeneration: string;
  readonly targetGeneration: string;
  readonly baseManifest: GraphContentStateManifest;
  readonly targetManifest: GraphContentStateManifest;
  readonly requiredSemanticDependencies?: readonly WisDigestReference[];
  readonly authorizedShardIds?: readonly string[];
  readonly comparisonBudget?: Partial<GraphContentStateComparisonBudget>;
}

export interface GraphIncrementalBuildPlan {
  readonly status: 'complete' | 'partial' | 'failed';
  readonly changeSet: GraphChangeSet;
  readonly delta: GraphDelta;
  readonly comparison: GraphContentStateComparisonResult;
  readonly shardReuse: GraphShardReusePlan;
  readonly providersToRecompute: readonly string[];
  readonly diagnostics: readonly GraphDiagnostic[];
}
