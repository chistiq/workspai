import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './workspace-intelligence-runtime-registry.js';

export const WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.repairTransaction;

export const WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.repairTransaction;

export const WORKSPACE_REPAIR_TRANSACTION_CONTRACT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS.repairTransaction;

export type WorkspaceRepairState =
  | 'planned'
  | 'awaiting-approval'
  | 'approved'
  | 'checkpointed'
  | 'executing'
  | 'verifying'
  | 'closed'
  | 'decision-required'
  | 'rollback-required'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed'
  | 'cancelled';

export type WorkspaceRepairRisk = 'safe' | 'guarded' | 'invasive';

export type WorkspaceRepairInvocation = {
  cwd: string;
  executable: string;
  args: string[];
  purpose: 'repair' | 'reconcile' | 'audit' | 'test' | 'build' | 'verify';
  timeoutMs: number;
};

export type WorkspaceRepairStage = {
  id: string;
  kind: 'repair' | 'reconcile' | 'audit' | 'test' | 'build' | 'verify' | 'rollback';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'cancelled';
  required: boolean;
  risk: WorkspaceRepairRisk;
  summary: string;
  invocation?: WorkspaceRepairInvocation;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  stdoutTail?: string;
  stderrTail?: string;
  changedPaths?: string[];
};

export type WorkspaceRepairCheckpointFile = {
  path: string;
  existed: boolean;
  beforeHash: string | null;
  mode?: number;
  afterHash?: string | null;
  backupRef?: string;
};

export type WorkspaceRepairDecision =
  | 'approve-guarded'
  | 'approve-invasive'
  | 'allow-breaking'
  | 'allow-force'
  | 'manual-repair'
  | 'rollback'
  | 'cancel';

export type WorkspaceRepairDecisionCause = {
  kind:
    | 'missing-executable'
    | 'unsupported-adapter'
    | 'failed-precondition'
    | 'risk-approval'
    | 'policy-exception'
    | 'source-repair-required';
  id: string;
  message: string;
  projectPath?: string;
  adapterId?: string;
  executable?: string;
};

export type WorkspaceRepairTransaction = {
  schemaVersion: typeof WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION;
  transactionId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  workspace: { name: string; rootRef: '.' };
  target: {
    cardId: string;
    blockerSignature?: string;
    scope: 'workspace' | 'project';
    projectName?: string;
    projectPath?: string;
    actionIds: string[];
  };
  state: WorkspaceRepairState;
  policy: {
    maxRisk: WorkspaceRepairRisk;
    allowForce: boolean;
    allowBreaking: boolean;
    autoRollback: boolean;
    strictVerify: true;
  };
  approval: {
    required: true;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    approvedAt?: string;
    approvedBy?: string;
    approvedPlanHash?: string;
  };
  preconditions: Array<{
    id: string;
    status: 'passed' | 'failed' | 'unknown';
    message: string;
  }>;
  adapterEvaluations?: Array<{
    adapterId: string;
    ecosystem: string;
    projectPath: string;
    manifests: string[];
    support: 'full' | 'conditional' | 'unsupported';
    status: 'ready' | 'partial' | 'unsupported';
    requiredExecutables: string[];
    missingExecutables: string[];
    message: string;
  }>;
  checkpoint: {
    status: 'pending' | 'captured' | 'restored' | 'conflicted' | 'unavailable';
    capturedAt?: string;
    restoredAt?: string;
    files: WorkspaceRepairCheckpointFile[];
  };
  stages: WorkspaceRepairStage[];
  verification?: {
    status: 'passed' | 'failed' | 'not-run';
    targetStatus?: 'passed' | 'failed' | 'unknown';
    workspaceStatus?: 'passed' | 'blocked' | 'failed';
    remainingActionIds?: string[];
    artifact: (typeof WORKSPACE_INTELLIGENCE_ARTIFACTS)['intelligenceRun'];
    exitCode: number | null;
    summary: string;
  };
  decision?: {
    reason: string;
    options: WorkspaceRepairDecision[];
    causes: WorkspaceRepairDecisionCause[];
  };
  events: Array<{
    sequence: number;
    at: string;
    type:
      | 'planned'
      | 'approval'
      | 'checkpoint'
      | 'stage'
      | 'verification'
      | 'decision'
      | 'rollback'
      | 'closed'
      | 'failed'
      | 'cancelled';
    stageId?: string;
    status?: string;
    message: string;
  }>;
  integrity: {
    planHash: string;
    sourceEvidenceHash: string;
  };
};
