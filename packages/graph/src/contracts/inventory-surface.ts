import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_INVENTORY_SURFACE_CONTRACT = defineWisContract({
  id: 'workspai.graph.inventory-surface',
  version: '1',
});

export const GRAPH_INVENTORY_SURFACE_CLASSES = Object.freeze([
  'source',
  'repository-configuration',
  'generated',
  'declared-generated',
  'observed-generated',
  'vendored',
  'vcs-metadata',
  'ignored',
  'policy-excluded',
  'binary',
  'unsafe-path',
  'inaccessible',
  'resource-bounded',
  'unsupported',
  'unknown-classification',
] as const);

export type GraphInventorySurfaceClass = (typeof GRAPH_INVENTORY_SURFACE_CLASSES)[number];

export const GRAPH_INVENTORY_VCS_METADATA_DIRECTORY_MARKERS = Object.freeze([
  '.git',
  '.hg',
  '.svn',
] as const);

export const GRAPH_INVENTORY_DEPENDENCY_STORE_DIRECTORY_MARKERS = Object.freeze([
  'node_modules',
] as const);

export const GRAPH_INVENTORY_ENVIRONMENT_STORE_DIRECTORY_MARKERS = Object.freeze([
  '.venv',
] as const);

export const GRAPH_INVENTORY_AMBIGUOUS_OUTPUT_DIRECTORY_NAMES = Object.freeze([
  'dist',
  'build',
  'coverage',
  'target',
  'bin',
  'obj',
  'out',
  'generated',
] as const);

export const GRAPH_INVENTORY_AMBIGUOUS_VENDOR_DIRECTORY_NAMES = Object.freeze([
  'vendor',
  'third_party',
  'venv',
] as const);

export const GRAPH_INVENTORY_WALK_SKIP_EVIDENCE_KINDS = Object.freeze([
  'universal-vcs-metadata',
  'universal-dependency-store',
  'universal-environment-store',
  'host-inventory-exclusion',
  'resource-budget',
] as const);

export type GraphInventoryWalkSkipEvidenceKind =
  (typeof GRAPH_INVENTORY_WALK_SKIP_EVIDENCE_KINDS)[number];

export const GRAPH_INVENTORY_OMITTED_SUBTREE_COUNT_STATES = Object.freeze([
  'not-enumerated',
] as const);

export const GRAPH_INVENTORY_OMITTED_SUBTREE_BYTE_STATES = Object.freeze(['not-measured'] as const);

export const GRAPH_INVENTORY_GENERATED_ARTIFACT_CLASSES = Object.freeze([
  'generated',
  'declared-generated',
  'observed-generated',
  'vendored',
] as const);

export const GRAPH_INVENTORY_SURFACE_LAW = Object.freeze({
  contract: GRAPH_INVENTORY_SURFACE_CONTRACT,
  classes: GRAPH_INVENTORY_SURFACE_CLASSES,
  vcsMetadataDirectoryMarkers: GRAPH_INVENTORY_VCS_METADATA_DIRECTORY_MARKERS,
  dependencyStoreDirectoryMarkers: GRAPH_INVENTORY_DEPENDENCY_STORE_DIRECTORY_MARKERS,
  environmentStoreDirectoryMarkers: GRAPH_INVENTORY_ENVIRONMENT_STORE_DIRECTORY_MARKERS,
  ambiguousOutputDirectoryNames: GRAPH_INVENTORY_AMBIGUOUS_OUTPUT_DIRECTORY_NAMES,
  ambiguousVendorDirectoryNames: GRAPH_INVENTORY_AMBIGUOUS_VENDOR_DIRECTORY_NAMES,
  walkSkipEvidenceKinds: GRAPH_INVENTORY_WALK_SKIP_EVIDENCE_KINDS,
  omittedSubtreeCountStates: GRAPH_INVENTORY_OMITTED_SUBTREE_COUNT_STATES,
  omittedSubtreeByteStates: GRAPH_INVENTORY_OMITTED_SUBTREE_BYTE_STATES,
  hiddenDirectoryDefault: 'repository-configuration' as const,
  generatedArtifactClasses: GRAPH_INVENTORY_GENERATED_ARTIFACT_CLASSES,
  ambiguousDirectoryDefault: 'source' as const,
});

export interface GraphOmittedSubtree {
  readonly locator: string;
  readonly class: GraphInventorySurfaceClass;
  readonly count: 'not-enumerated';
  readonly bytes: 'not-measured';
  readonly enumeration: 'not-enumerated';
  readonly reason: string;
  readonly code: string;
  readonly evidenceKind: GraphInventoryWalkSkipEvidenceKind;
  readonly policyDigest: string;
}
