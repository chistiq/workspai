/* Generated from schemas/unknown-cause.v1.schema.json. Do not edit. */

export interface WorkspaiGraphUnknownCauseCandidate {
  contract: { id: 'workspai.graph.unknown-cause'; version: '1' };
  causes: [
    'unsupported-syntax',
    'inventory-policy',
    'generated-or-vendor-policy',
    'parser-limitation',
    'resource-bound',
    'unmapped-legacy-coverage',
    'unclassified',
  ];
  disposition: 'bounded-unknown';
  admissionImpact: 'blocking';
  neverBenignCauses: ['unclassified', 'unmapped-legacy-coverage'];
  classificationOrigins: ['structured-producer', 'legacy-fallback'];
}
