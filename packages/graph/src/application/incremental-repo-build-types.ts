import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphContentStateManifest,
  GraphInputProcessingRecord,
  GraphQueryCacheEntry,
  GraphQueryCacheInvalidation,
  GraphScope,
} from '../contracts/index.js';
import type { GraphQueryCacheStorePort } from '../ports/index.js';

import type { GraphCompositionSource } from './composition-types.js';
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
  /** Optional prior canonical graph used only to fill executed GraphDelta identities. */
  readonly baseGraph?: GraphCanonicalGraph;
  readonly queryCache?: GraphIncrementalQueryCacheRequest;
}

export interface GraphIncrementalRepoBuildResult extends GraphRepoBuildResult {
  readonly plan: GraphIncrementalBuildPlan;
  readonly targetManifest: GraphContentStateManifest;
  readonly processing: readonly GraphInputProcessingRecord[];
  readonly equivalence: GraphIncrementalBuildPlan['delta']['equivalence'];
  readonly inventoryReread: GraphInventoryRereadPlan;
  readonly queryCacheInvalidations?: readonly GraphQueryCacheInvalidation[];
}
