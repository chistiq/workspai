/* Generated from schemas/graph-delta.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphDeltaCandidate {
  contract: { id: 'workspai.graph.graph-delta'; version: '0.1.0-candidate' };
  baseGeneration: string;
  targetGeneration: string;
  /**
   * @maxItems 1000000
   */
  changedInputs: InputChange[];
  /**
   * @maxItems 10000
   */
  affectedProviders: string[];
  facts: {
    /**
     * @maxItems 1000000
     */
    added: string[];
    /**
     * @maxItems 1000000
     */
    renewed: string[];
    /**
     * @maxItems 1000000
     */
    removed: string[];
    /**
     * @maxItems 1000000
     */
    invalidated: string[];
  };
  graph: {
    /**
     * @maxItems 1000000
     */
    addedNodes: string[];
    /**
     * @maxItems 1000000
     */
    removedNodes: string[];
    /**
     * @maxItems 1000000
     */
    changedNodes: string[];
    /**
     * @maxItems 1000000
     */
    changedEdges: string[];
    /**
     * @maxItems 1000000
     */
    addedAssertions: string[];
    /**
     * @maxItems 1000000
     */
    removedAssertions: string[];
    /**
     * @maxItems 1000000
     */
    changedAssertions: string[];
  };
  /**
   * @maxItems 10000
   */
  affectedProjections: string[];
  /**
   * @maxItems 100000
   */
  downstreamInvalidations: string[];
  execution: {
    detected: number;
    scanned: number;
    parsed: number;
    recomputed: number;
    skippedByDigest: number;
    unsupported: number;
    failed: number;
    /**
     * @maxItems 1000
     */
    truncation: {}[];
    /**
     * @maxItems 1000000
     */
    processing: {}[];
  };
  equivalence: 'pass' | 'attention' | 'blocked' | 'not-assessed';
}
/**
 * This interface was referenced by `WorkspaiGraphDeltaCandidate`'s JSON-Schema
 * via the `definition` "inputChange".
 */
export interface InputChange {
  kind: 'added' | 'edited' | 'deleted' | 'renewed' | 'rename-candidate';
  locator: string;
  inputKind: string;
  scanProfileDigest: Digest;
  priorDigest?: Digest;
  nextDigest?: Digest;
  renameCandidate?: {
    priorLocator: string;
    nextLocator: string;
    confidence: number;
  };
}
/**
 * This interface was referenced by `WorkspaiGraphDeltaCandidate`'s JSON-Schema
 * via the `definition` "digest".
 */
export interface Digest {
  algorithm: 'sha256';
  value: string;
}
