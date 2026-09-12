/* Generated from schemas/provider-detection.v0.1.0-candidate.schema.json. Do not edit. */

/**
 * This interface was referenced by `WorkspaiGraphProviderDetectionCandidate`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string;

export interface WorkspaiGraphProviderDetectionCandidate {
  contract: { id: 'workspai.graph.provider-detection'; version: '0.1.0-candidate' };
  provider: {
    id: Identifier;
    version: Identifier;
  };
  status: 'applicable' | 'not-applicable' | 'blocked' | 'unknown';
  /**
   * @maxItems 1000
   */
  matchedInputs: Identifier[];
  /**
   * @maxItems 32
   */
  missingPermissions: ('filesystem' | 'network' | 'process' | 'credentials')[];
  /**
   * @maxItems 100
   */
  diagnostics: {
    code: Identifier;
    message: string;
  }[];
}
