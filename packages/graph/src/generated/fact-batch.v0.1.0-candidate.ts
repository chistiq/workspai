/* Generated from schemas/fact-batch.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphFactBatchCandidate`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string;

export interface WorkspaiGraphFactBatchCandidate {
  contract: { id: 'workspai.graph.fact-batch'; version: '0.1.0-candidate' };
  provider: Identity;
  batchId: Id;
  scope: {};
  /**
   * @minItems 1
   * @maxItems 1000000
   */
  inputs: [Input, ...Input[]];
  /**
   * @maxItems 10000000
   */
  facts: Fact[];
  /**
   * @maxItems 10000
   */
  diagnostics: {}[];
  /**
   * @maxItems 10000
   */
  coverage: {}[];
  /**
   * @maxItems 10000
   */
  unknownZones: {}[];
  /**
   * @maxItems 10000
   */
  unsupportedZones: {}[];
  redaction: {};
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  /**
   * @maxItems 1000000
   */
  processing: {}[];
}
/**
 * This interface was referenced by `WorkspaiGraphFactBatchCandidate`'s JSON-Schema
 * via the `definition` "identity".
 */
export interface Identity {
  id: Id;
  version: Id;
}
/**
 * This interface was referenced by `WorkspaiGraphFactBatchCandidate`'s JSON-Schema
 * via the `definition` "input".
 */
export interface Input {
  locator: string;
  digest: Digest;
}
/**
 * This interface was referenced by `WorkspaiGraphFactBatchCandidate`'s JSON-Schema
 * via the `definition` "digest".
 */
export interface Digest {
  algorithm: Id;
  value: string;
}
/**
 * This interface was referenced by `WorkspaiGraphFactBatchCandidate`'s JSON-Schema
 * via the `definition` "fact".
 */
export interface Fact {
  factId: Id;
  factType: Id;
  subject: {};
  predicate: Id;
  object: {};
  scope: {};
  /**
   * @minItems 1
   */
  evidence: [unknown, ...unknown[]];
  provenance: Identity;
  derivation:
    'observed' | 'extracted' | 'declared' | 'computed' | 'inferred' | 'generated' | 'imported';
  authority: 'declared' | 'observed' | 'verified' | 'inferred';
  confidence: number;
  freshness: {};
  truthLifecycle: {};
  observedAt: string;
  inputDigest: Digest;
  unknownZones: unknown[];
}
