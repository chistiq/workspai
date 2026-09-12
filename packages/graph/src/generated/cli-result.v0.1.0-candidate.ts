/* Generated from schemas/cli-result.v0.1.0-candidate.schema.json. Do not edit. */

export interface WorkspaiGraphCliResultCandidate {
  schemaVersion: 'workspai.graph.cli-result.v1';
  command: 'inspect' | 'quality' | 'query' | 'providers' | 'input';
  status: 'complete' | 'partial' | 'failed' | 'cancelled';
  data: unknown;
  /**
   * @maxItems 10000
   */
  diagnostics: Diagnostic[];
}
/**
 * This interface was referenced by `WorkspaiGraphCliResultCandidate`'s JSON-Schema
 * via the `definition` "diagnostic".
 */
export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  path: string;
  message: string;
}
