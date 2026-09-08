/* Generated from schemas/model-generation-binding.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphModelGenerationBindingCandidate {
  graphGeneration: Generation;
  modelGeneration: Generation;
  architectureEpoch: string;
}
/**
 * This interface was referenced by `WorkspaiGraphModelGenerationBindingCandidate`'s JSON-Schema
 * via the `definition` "generation".
 */
export interface Generation {
  id: string;
  generatedAt: string;
  parents?: string[];
  contentDigest: {};
}
