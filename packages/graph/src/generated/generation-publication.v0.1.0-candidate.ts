/* Generated from schemas/generation-publication.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphGenerationPublicationCandidate {
  generation: {
    reference: GenerationReference;
    graphSchema: Contract;
    architectureEpoch: string;
    ontologySetDigest: Digest;
    proofPolicySetDigest: Digest;
    inputsDigest: Digest;
    factSetDigest: Digest;
    providerSetDigest: Digest;
    compositionPolicyDigest: Digest;
  };
  artifactDigest: Digest;
  qualityDigest: Digest;
  publication: 'staged' | 'committed';
  previousGeneration?: GenerationReference;
}
/**
 * This interface was referenced by `WorkspaiGraphGenerationPublicationCandidate`'s JSON-Schema
 * via the `definition` "generationReference".
 */
export interface GenerationReference {
  id: string;
  generatedAt: string;
  parents?: string[];
  contentDigest: Digest;
}
/**
 * This interface was referenced by `WorkspaiGraphGenerationPublicationCandidate`'s JSON-Schema
 * via the `definition` "digest".
 */
export interface Digest {
  algorithm: string;
  value: string;
  canonicalization?: string;
}
/**
 * This interface was referenced by `WorkspaiGraphGenerationPublicationCandidate`'s JSON-Schema
 * via the `definition` "contract".
 */
export interface Contract {
  id: string;
  version: string;
}
