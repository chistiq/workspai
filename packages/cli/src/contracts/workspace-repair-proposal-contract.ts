import type { WorkspaceRepairRisk } from './workspace-repair-transaction-contract.js';

export const WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION =
  'workspai.workspace-repair-proposal.v1' as const;

export const WORKSPACE_REPAIR_PROPOSAL_CONTRACT_PATH =
  'contracts/workspace-intelligence/workspace-repair-proposal.v1.json' as const;

export type WorkspaceRepairProposalChange = {
  id: string;
  path: string;
  operation: 'write' | 'delete';
  expectedBeforeHash: string | null;
  content?: string;
  risk: WorkspaceRepairRisk;
  summary: string;
};

export type WorkspaceRepairProposalValidation = {
  id: string;
  kind: 'audit' | 'test' | 'build';
  cwd: string;
  executable: string;
  args: string[];
  required: boolean;
  risk: WorkspaceRepairRisk;
  summary: string;
  timeoutMs?: number;
};

export type WorkspaceRepairProposal = {
  schemaVersion: typeof WORKSPACE_REPAIR_PROPOSAL_SCHEMA_VERSION;
  cardId: string;
  projectName?: string;
  projectPath?: string;
  rationale: string;
  changes: WorkspaceRepairProposalChange[];
  validation?: WorkspaceRepairProposalValidation[];
};
