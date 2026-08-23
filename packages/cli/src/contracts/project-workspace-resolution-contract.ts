import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import type { ProjectWorkspaceResolutionSource } from '../project-workspace-link.js';

export const PROJECT_WORKSPACE_RESOLUTION_SCHEMA_VERSION =
  'project-workspace-resolution.v1' as const;

export interface ProjectWorkspaceResolutionContract {
  schemaVersion: typeof PROJECT_WORKSPACE_RESOLUTION_SCHEMA_VERSION;
  status: 'resolved';
  workspacePath: string;
  projectPath: string;
  source: ProjectWorkspaceResolutionSource;
  recovered: boolean;
  linkPath: string;
  nextCommand: string;
  pathPolicy: {
    classification: 'machine-local';
    portable: false;
    persistence: 'forbidden';
    disclosure: 'forbidden';
    purpose: 'runtime-workspace-resolution';
  };
}

export function assertProjectWorkspaceResolutionContract(
  payload: ProjectWorkspaceResolutionContract
): void {
  assertJsonSchemaContract(
    payload,
    'contracts/project-workspace-resolution.v1.json',
    'Project workspace resolution'
  );
}
