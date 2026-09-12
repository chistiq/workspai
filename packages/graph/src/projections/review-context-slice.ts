import type { WisContractReference, WisEvidenceReference } from '@workspai/shared/contracts';
import { defineWisContract } from '@workspai/shared/contracts';

import { canonicalizeGraphValue } from '../conformance/canonical-value.js';
import type {
  GraphEntityReference,
  GraphGenerationRef,
  GraphPath,
  GraphQueryResult,
  GraphUnknownZone,
} from '../contracts/index.js';

export const GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT = defineWisContract({
  id: 'workspai.graph.review-context-slice',
  version: '0.1.0-candidate',
});

export interface GraphReviewContextSliceBudget {
  readonly maxEntities: number;
  readonly maxPaths: number;
  readonly maxEvidence: number;
  readonly maxDisputes: number;
  readonly maxUnknownZones: number;
  readonly maxContentBytes: number;
}

export interface GraphReviewContextSliceResult {
  readonly contract: typeof GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT;
  readonly profile: WisContractReference;
  readonly sourceGeneration: GraphGenerationRef;
  readonly sourceQueryDigest: GraphQueryResult['queryDigest'];
  readonly entities: readonly GraphEntityReference[];
  readonly paths: readonly GraphPath[];
  readonly evidence: readonly WisEvidenceReference[];
  readonly disputes: GraphQueryResult['disputes'];
  readonly unknownBoundaries: readonly GraphUnknownZone[];
  readonly sourceCost: GraphQueryResult['cost'];
  readonly quality: GraphQueryResult['quality'];
  readonly analysis: GraphQueryResult['analysis'];
  readonly cost: {
    readonly candidateItems: number;
    readonly returnedItems: number;
    readonly contentBytes: number;
  };
  readonly truncation: {
    readonly truncated: boolean;
    readonly reasons: readonly (
      'entities' | 'paths' | 'evidence' | 'disputes' | 'unknown-zones' | 'content-bytes'
    )[];
  };
}

export type GraphReviewContextSliceExecution =
  | {
      readonly accepted: true;
      readonly value: GraphReviewContextSliceResult;
      readonly issues: readonly [];
    }
  | {
      readonly accepted: false;
      readonly issues: readonly {
        readonly code: string;
        readonly path: string;
        readonly message: string;
      }[];
    };

const DEFAULT_BUDGET: GraphReviewContextSliceBudget = Object.freeze({
  maxEntities: 150,
  maxPaths: 150,
  maxEvidence: 150,
  maxDisputes: 100,
  maxUnknownZones: 150,
  maxContentBytes: 512 * 1024,
});
const MAX_BUDGET: GraphReviewContextSliceBudget = Object.freeze({
  maxEntities: 10_000,
  maxPaths: 10_000,
  maxEvidence: 10_000,
  maxDisputes: 10_000,
  maxUnknownZones: 10_000,
  maxContentBytes: 10 * 1024 * 1024,
});
const PROFILE = Object.freeze({
  id: 'workspai.graph.review-context-slice.standard',
  version: GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT.version,
});

function validBudget(budget: GraphReviewContextSliceBudget): boolean {
  return (Object.keys(MAX_BUDGET) as (keyof GraphReviewContextSliceBudget)[]).every(
    (key) => Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= MAX_BUDGET[key]
  );
}

function contentBytes(value: unknown): number | undefined {
  const canonical = canonicalizeGraphValue(value);
  return canonical.accepted ? new TextEncoder().encode(canonical.value).byteLength : undefined;
}

function entityResults(result: GraphQueryResult<unknown>): GraphEntityReference[] {
  if (!Array.isArray(result.result)) return [];
  return result.result
    .filter(
      (candidate): candidate is GraphEntityReference =>
        typeof candidate === 'object' &&
        candidate !== null &&
        typeof (candidate as { readonly id?: unknown }).id === 'string' &&
        typeof (candidate as { readonly kind?: unknown }).kind === 'string'
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Creates a deterministic, bounded, model-neutral review context payload. */
export function buildReviewContextSlice(
  result: GraphQueryResult<unknown>,
  requestedBudget: Partial<GraphReviewContextSliceBudget> = {}
): GraphReviewContextSliceExecution {
  const budget = Object.freeze({ ...DEFAULT_BUDGET, ...requestedBudget });
  if (!validBudget(budget)) {
    return {
      accepted: false,
      issues: [
        {
          code: 'GRAPH_REVIEW_CONTEXT_SLICE_BUDGET_INVALID',
          path: '/budget',
          message: 'Review context budgets must be positive and within fixed safety ceilings.',
        },
      ],
    };
  }
  const candidates = {
    entities: entityResults(result),
    paths: [...result.paths].sort((left, right) => left.pathId.localeCompare(right.pathId)),
    evidence: [...result.evidence].sort((left, right) =>
      `${left.relativeLocator}\0${left.id}`.localeCompare(`${right.relativeLocator}\0${right.id}`)
    ),
    disputes: [...result.disputes].sort((left, right) => left.id.localeCompare(right.id)),
    unknown: [...result.unknownBoundaries].sort((left, right) =>
      `${left.scope}\0${left.code}`.localeCompare(`${right.scope}\0${right.code}`)
    ),
  };
  let usedBytes = 0;
  let byteTruncated = false;
  const take = <T>(values: readonly T[], limit: number): readonly T[] => {
    const accepted: T[] = [];
    for (const value of values.slice(0, limit)) {
      const bytes = contentBytes(value);
      if (bytes === undefined || usedBytes + bytes > budget.maxContentBytes) {
        byteTruncated = true;
        continue;
      }
      accepted.push(value);
      usedBytes += bytes;
    }
    return Object.freeze(accepted);
  };
  const entities = take(candidates.entities, budget.maxEntities);
  const paths = take(candidates.paths, budget.maxPaths);
  const evidence = take(candidates.evidence, budget.maxEvidence);
  const disputes = take(candidates.disputes, budget.maxDisputes);
  const unknownBoundaries = take(candidates.unknown, budget.maxUnknownZones);
  const reasons: GraphReviewContextSliceResult['truncation']['reasons'][number][] = [];
  if (candidates.entities.length > entities.length) reasons.push('entities');
  if (candidates.paths.length > paths.length) reasons.push('paths');
  if (candidates.evidence.length > evidence.length) reasons.push('evidence');
  if (candidates.disputes.length > disputes.length) reasons.push('disputes');
  if (candidates.unknown.length > unknownBoundaries.length) reasons.push('unknown-zones');
  if (byteTruncated) reasons.push('content-bytes');
  const candidateItems = Object.values(candidates).reduce(
    (total, values) => total + values.length,
    0
  );
  const returnedItems =
    entities.length + paths.length + evidence.length + disputes.length + unknownBoundaries.length;

  return {
    accepted: true,
    value: Object.freeze({
      contract: GRAPH_REVIEW_CONTEXT_SLICE_CONTRACT,
      profile: PROFILE,
      sourceGeneration: result.generation,
      sourceQueryDigest: result.queryDigest,
      entities,
      paths,
      evidence,
      disputes,
      unknownBoundaries,
      sourceCost: result.cost,
      quality: result.quality,
      analysis: result.analysis,
      cost: Object.freeze({ candidateItems, returnedItems, contentBytes: usedBytes }),
      truncation: Object.freeze({ truncated: reasons.length > 0, reasons: Object.freeze(reasons) }),
    }),
    issues: [],
  };
}
