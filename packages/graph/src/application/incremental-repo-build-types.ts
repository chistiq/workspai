import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphContentStateManifest,
  GraphInputProcessingRecord,
  GraphQualityReport,
  GraphQueryCacheEntry,
  GraphQueryCacheInvalidation,
  GraphScope,
} from '../contracts/index.js';
import type { GraphGitWorktreeBaseline, GraphQueryCacheStorePort } from '../ports/index.js';

import type { GraphCompositionReceipt, GraphCompositionSource } from './composition-types.js';
import type { GraphIncrementalBuildPlan } from './incremental-build-types.js';
import type { GraphInventoryRereadPlan } from './plan-inventory-reread.js';
import type { GraphRepoBuildRequest, GraphRepoBuildResult } from './repo-build-types.js';

export interface GraphIncrementalQueryCacheRequest {
  readonly store: GraphQueryCacheStorePort;
  readonly entries: readonly GraphQueryCacheEntry[];
  readonly policy?: {
    readonly redactionPolicyDigest?: WisDigestReference;
    readonly authorizationDigest?: WisDigestReference;
    readonly profileDigest?: WisDigestReference;
    readonly scope?: GraphScope;
  };
}

export interface GraphIncrementalRepoBuildRequest extends GraphRepoBuildRequest {
  readonly baseManifest: GraphContentStateManifest;
  readonly baseGeneration: string;
  readonly targetGeneration: string;
  readonly baseSources: readonly GraphCompositionSource[];
  /**
   * Extra providers to recompute. Content-required recomputes from the plan
   * are always included; an empty list means derive-only.
   */
  readonly providersToRecompute: readonly string[];
  readonly scanProfileDigest: WisDigestReference;
  readonly referenceGenerationDigest?: WisDigestReference;
  /** Base-generation Git receipt. Without it the Node Git journal stays untrusted. */
  readonly baseGitBaseline?: GraphGitWorktreeBaseline;
  /** Optional prior canonical graph used only to fill executed GraphDelta identities. */
  readonly baseGraph?: GraphCanonicalGraph;
  readonly baseQuality?: GraphQualityReport;
  readonly baseCompositionReceipt?: GraphCompositionReceipt;
  readonly queryCache?: GraphIncrementalQueryCacheRequest;
  /** Bounded pre/post snapshot attempts. Defaults to 3. */
  readonly snapshotAttempts?: number;
}

export type GraphIncrementalExecutionPath = 'skip-reread' | 'full';

export interface GraphIncrementalRepoBuildResult extends GraphRepoBuildResult {
  readonly plan: GraphIncrementalBuildPlan;
  readonly targetManifest: GraphContentStateManifest;
  readonly processing: readonly GraphInputProcessingRecord[];
  readonly equivalence: GraphIncrementalBuildPlan['delta']['equivalence'];
  readonly inventoryReread: GraphInventoryRereadPlan;
  /**
   * `full` when no prior file digest could be reused; the package then executes
   * the ordinary full build instead of a slower skip-reread overlay.
   */
  readonly executionPath: GraphIncrementalExecutionPath;
  readonly queryCacheInvalidations?: readonly GraphQueryCacheInvalidation[];
  /**
   * `matched` when pre/post Git and membership receipts agree. `unstable` when
   * the retry bound was exhausted; gitBaseline is then omitted.
   */
  readonly snapshotConsistency?: 'matched' | 'unstable';
}
