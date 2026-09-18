import {
  GRAPH_COMPARABLE_SURFACE_LAW,
  GRAPH_GENERATED_ARTIFACT_LAW,
  GRAPH_UNKNOWN_CAUSE_LAW,
} from '../contracts/semantic-parity.js';
import {
  classifyComparableKind,
  classifyComparableRelation,
  mapComparableKind,
  mapComparableRelation,
} from '../domain/comparable-surface.js';
import {
  classifyGeneratedArtifactLocator,
  isGeneratedArtifactLocator,
} from '../domain/generated-artifact.js';
import { classifyGraphUnknownCause, summarizeGraphUnknownCauses } from '../domain/unknown-cause.js';

/**
 * Public unknown-cause API. Shadow consumers must classify leftovers through
 * this contract, not a parallel family map.
 */
export const GRAPH_UNKNOWN_CAUSE = Object.freeze({
  ...GRAPH_UNKNOWN_CAUSE_LAW,
  classify: classifyGraphUnknownCause,
  summarize: summarizeGraphUnknownCauses,
});

/**
 * Public generated-artifact API. Treatment is include, exclude, or
 * bounded-unknown. Only generated, declared-generated, observed-generated,
 * and vendored inventory-surface classes enter this policy.
 */
export const GRAPH_GENERATED_ARTIFACT = Object.freeze({
  ...GRAPH_GENERATED_ARTIFACT_LAW,
  classifyLocator: classifyGeneratedArtifactLocator,
  isGeneratedLocator: isGeneratedArtifactLocator,
});

/**
 * Public comparable-surface API. Independent Graph providers and CLI legacy
 * compare node and relation kinds against the core ontology plus these aliases.
 */
export const GRAPH_COMPARABLE_SURFACE = Object.freeze({
  ...GRAPH_COMPARABLE_SURFACE_LAW,
  mapKind: mapComparableKind,
  mapRelation: mapComparableRelation,
  classifyKind: classifyComparableKind,
  classifyRelation: classifyComparableRelation,
});
