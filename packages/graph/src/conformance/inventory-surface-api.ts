import { GRAPH_INVENTORY_SURFACE_LAW } from '../contracts/inventory-surface.js';
import {
  classifyInventoryDirectoryName,
  classifyInventorySurfaceLocator,
  classifyInventoryWalkSkip,
  comparePortableInventoryNames,
  inventorySurfaceExcludedDirectoryNames,
  inventorySurfacePolicyMaterial,
  omittedSubtreeComparisonToken,
} from '../domain/inventory-surface.js';

/**
 * Public inventory-surface API. Ambiguous directory names stay source.
 * Hidden directories default to repository-configuration. Only generated,
 * declared-generated, observed-generated, and vendored classes enter
 * generated-artifact treatment. Walk exclusion is evidence-bound.
 */
export const GRAPH_INVENTORY_SURFACE = Object.freeze({
  ...GRAPH_INVENTORY_SURFACE_LAW,
  classifyDirectoryName: classifyInventoryDirectoryName,
  classifyLocator: classifyInventorySurfaceLocator,
  classifyWalkSkip: classifyInventoryWalkSkip,
  compareNames: comparePortableInventoryNames,
  excludedDirectoryNames: inventorySurfaceExcludedDirectoryNames,
  policyMaterial: inventorySurfacePolicyMaterial,
  omittedSubtreeComparisonToken,
});
