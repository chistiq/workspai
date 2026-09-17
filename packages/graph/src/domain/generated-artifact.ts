import {
  GRAPH_GENERATED_ARTIFACT_LAW,
  type GraphGeneratedArtifactTreatment,
} from '../contracts/semantic-parity.js';
import { GRAPH_INVENTORY_SURFACE_LAW } from '../contracts/inventory-surface.js';
import { classifyInventorySurfaceLocator } from './inventory-surface.js';
import type { GraphInventoryOmissionClass } from './inventory-omissions.js';

export type GraphGeneratedArtifactClassification =
  | {
      readonly class: 'source';
      readonly treatment: 'include';
    }
  | {
      readonly class: 'generated-artifact';
      readonly omissionClass: GraphInventoryOmissionClass;
      readonly treatment: GraphGeneratedArtifactTreatment;
    };

const GENERATED_SURFACE = new Set<string>(GRAPH_INVENTORY_SURFACE_LAW.generatedArtifactClasses);

function omissionClassForSurface(
  surfaceClass: string
): Extract<GraphInventoryOmissionClass, 'generated' | 'vendored'> {
  return surfaceClass === 'vendored' ? 'vendored' : 'generated';
}

/**
 * Classifies a portable relative locator as a generated artifact only when a
 * generated, declared-generated, observed-generated, or vendored
 * inventory-surface class is present. Ambiguous directory names and hidden
 * repository-configuration directories remain source for this policy.
 */
export function classifyGeneratedArtifactLocator(
  locator: string
): GraphGeneratedArtifactClassification {
  const surface = classifyInventorySurfaceLocator(locator);
  if (GENERATED_SURFACE.has(surface.class)) {
    return {
      class: 'generated-artifact',
      omissionClass: omissionClassForSurface(surface.class),
      treatment: GRAPH_GENERATED_ARTIFACT_LAW.defaultTreatment,
    };
  }
  return { class: 'source', treatment: 'include' };
}

export function isGeneratedArtifactLocator(locator: string): boolean {
  return classifyGeneratedArtifactLocator(locator).class === 'generated-artifact';
}
