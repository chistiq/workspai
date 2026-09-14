/* Generated from schemas/generated-artifact.v1.schema.json. Do not edit. */

export interface WorkspaiGraphGeneratedArtifactCandidate {
  contract: { id: 'workspai.graph.generated-artifact'; version: '1' };
  treatments: ['include', 'exclude', 'bounded-unknown'];
  defaultTreatment: 'bounded-unknown';
  omissionClasses: ['generated', 'vendored'];
}
