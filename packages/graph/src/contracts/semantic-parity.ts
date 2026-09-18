import { defineWisContract } from '@workspai/shared/contracts';

export const GRAPH_UNKNOWN_CAUSE_CONTRACT = defineWisContract({
  id: 'workspai.graph.unknown-cause',
  version: '1',
});

export const GRAPH_UNKNOWN_CAUSES = Object.freeze([
  'unsupported-syntax',
  'inventory-policy',
  'generated-or-vendor-policy',
  'parser-limitation',
  'resource-bound',
  'unmapped-legacy-coverage',
  'unclassified',
] as const);

export type GraphUnknownCause = (typeof GRAPH_UNKNOWN_CAUSES)[number];

export const GRAPH_UNKNOWN_CAUSE_DISPOSITION = 'bounded-unknown' as const;

export const GRAPH_UNKNOWN_CAUSE_ADMISSION_IMPACT = 'blocking' as const;

export const GRAPH_UNKNOWN_NEVER_BENIGN_CAUSES = Object.freeze([
  'unclassified',
  'unmapped-legacy-coverage',
] as const);

export const GRAPH_UNKNOWN_CLASSIFICATION_ORIGINS = Object.freeze([
  'structured-producer',
  'legacy-fallback',
] as const);

export type GraphUnknownClassificationOrigin =
  (typeof GRAPH_UNKNOWN_CLASSIFICATION_ORIGINS)[number];

export const GRAPH_UNKNOWN_CAUSE_LAW = Object.freeze({
  contract: GRAPH_UNKNOWN_CAUSE_CONTRACT,
  causes: GRAPH_UNKNOWN_CAUSES,
  disposition: GRAPH_UNKNOWN_CAUSE_DISPOSITION,
  admissionImpact: GRAPH_UNKNOWN_CAUSE_ADMISSION_IMPACT,
  neverBenignCauses: GRAPH_UNKNOWN_NEVER_BENIGN_CAUSES,
  classificationOrigins: GRAPH_UNKNOWN_CLASSIFICATION_ORIGINS,
});

export const GRAPH_GENERATED_ARTIFACT_CONTRACT = defineWisContract({
  id: 'workspai.graph.generated-artifact',
  version: '1',
});

export const GRAPH_GENERATED_ARTIFACT_TREATMENTS = Object.freeze([
  'include',
  'exclude',
  'bounded-unknown',
] as const);

export type GraphGeneratedArtifactTreatment = (typeof GRAPH_GENERATED_ARTIFACT_TREATMENTS)[number];

export const GRAPH_GENERATED_ARTIFACT_OMISSION_CLASSES = Object.freeze([
  'generated',
  'vendored',
] as const);

export const GRAPH_GENERATED_ARTIFACT_LAW = Object.freeze({
  contract: GRAPH_GENERATED_ARTIFACT_CONTRACT,
  treatments: GRAPH_GENERATED_ARTIFACT_TREATMENTS,
  defaultTreatment: 'bounded-unknown' as const,
  omissionClasses: GRAPH_GENERATED_ARTIFACT_OMISSION_CLASSES,
});

export const GRAPH_COMPARABLE_SURFACE_CONTRACT = defineWisContract({
  id: 'workspai.graph.comparable-surface',
  version: '1',
});

export const GRAPH_COMPARABLE_KIND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'test-suite': 'test',
  'runtime-unit': 'runtime',
  'lifecycle-stage': 'gate',
  protocol: 'contract',
  repository: 'project',
});

export const GRAPH_COMPARABLE_RELATION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  publishes: 'produces',
  deploys: 'deployed-as',
  documents: 'documented-by',
  owns: 'owned-by',
  'generated-by': 'produced-by',
  'implements-protocol': 'implements',
});

export const GRAPH_COMPARABLE_SURFACE_LAW = Object.freeze({
  contract: GRAPH_COMPARABLE_SURFACE_CONTRACT,
  ontologyId: 'workspai.graph.ontology.core',
  kindAliases: GRAPH_COMPARABLE_KIND_ALIASES,
  relationAliases: GRAPH_COMPARABLE_RELATION_ALIASES,
});

export type GraphComparableMembership = 'in-corpus' | 'outside-corpus';
