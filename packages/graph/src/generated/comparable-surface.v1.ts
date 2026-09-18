/* Generated from schemas/comparable-surface.v1.schema.json. Do not edit. */

export interface WorkspaiGraphComparableSurfaceCandidate {
  contract: { id: 'workspai.graph.comparable-surface'; version: '1' };
  ontologyId: 'workspai.graph.ontology.core';
  kindAliases: {
    'test-suite': 'test';
    'runtime-unit': 'runtime';
    'lifecycle-stage': 'gate';
    protocol: 'contract';
    repository: 'project';
  };
  relationAliases: {
    publishes: 'produces';
    deploys: 'deployed-as';
    documents: 'documented-by';
    owns: 'owned-by';
    'generated-by': 'produced-by';
    'implements-protocol': 'implements';
  };
}
