/* Generated from schemas/graph-quality.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphQualityCandidate`'s JSON-Schema
 * via the `definition` "verdict".
 */
export type Verdict = 'pass' | 'attention' | 'blocked' | 'not-assessed';
/**
 * This interface was referenced by `WorkspaiGraphQualityCandidate`'s JSON-Schema
 * via the `definition` "count".
 */
export type Count = number;

export interface WorkspaiGraphQualityCandidate {
  contract: { id: 'workspai.graph.quality'; version: '0.1.0-candidate' };
  generation: {};
  integrity: Verdict;
  determinism: Verdict;
  incrementalEquivalence: Verdict;
  coverage: {}[];
  proofStates: {
    supported: Count;
    corroborated: Count;
    verified: Count;
    disputed: Count;
    insufficient: Count;
    unresolved: Count;
  };
  unknownZones: unknown[];
  unsupportedZones: unknown[];
  staleZones: unknown[];
  conflicts: unknown[];
  orphans: unknown[];
  providerFailures: unknown[];
  releaseClaims: string[];
}
