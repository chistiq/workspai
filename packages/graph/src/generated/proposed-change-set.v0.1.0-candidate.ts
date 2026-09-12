/* Generated from schemas/proposed-change-set.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphProposedChangeSetCandidate {
  contract: { id: 'workspai.graph.proposed-change-set'; version: '0.1.0-candidate' };
  id: string;
  baseGeneration: string;
  /**
   * @maxItems 1000000
   */
  inputs: InputChange[];
  /**
   * @maxItems 10000
   */
  causes: ChangeCause[];
  proposal: {
    kind: 'patch' | 'working-tree' | 'branch' | 'pull-request' | 'external';
    identity: string;
    digest: string;
  };
  /**
   * @maxItems 1000
   */
  assumptions: string[];
}
/**
 * This interface was referenced by `WorkspaiGraphProposedChangeSetCandidate`'s JSON-Schema
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
 * This interface was referenced by `WorkspaiGraphProposedChangeSetCandidate`'s JSON-Schema
 * via the `definition` "digest".
 */
export interface Digest {
  algorithm: 'sha256';
  value: string;
}
/**
 * This interface was referenced by `WorkspaiGraphProposedChangeSetCandidate`'s JSON-Schema
 * via the `definition` "changeCause".
 */
export interface ChangeCause {
  kind:
    | 'content'
    | 'provider'
    | 'schema'
    | 'ontology'
    | 'proof-policy'
    | 'scan-profile'
    | 'redaction'
    | 'authorization'
    | 'manual'
    | 'unknown';
  source: string;
  detail?: string;
}
