import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphContentStateManifest, GraphInputProcessingRecord } from '../contracts/index.js';

import type { GraphCompositionSource } from './composition-types.js';
import type { GraphIncrementalBuildPlan } from './incremental-build-types.js';
import type { GraphInventoryRereadPlan } from './plan-inventory-reread.js';
import type { GraphRepoBuildRequest, GraphRepoBuildResult } from './repo-build-types.js';

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
}

export interface GraphIncrementalRepoBuildResult extends GraphRepoBuildResult {
  readonly plan: GraphIncrementalBuildPlan;
  readonly targetManifest: GraphContentStateManifest;
  readonly processing: readonly GraphInputProcessingRecord[];
  readonly equivalence: GraphIncrementalBuildPlan['delta']['equivalence'];
  readonly inventoryReread: GraphInventoryRereadPlan;
}
