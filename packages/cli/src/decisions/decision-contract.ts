/**
 * Extraction-safe decision transaction contracts.
 *
 * This module deliberately has no filesystem, process, CLI, or clock imports.
 * It is the ownership boundary that can later move to `@workspai/decisions`
 * without changing the persisted protocol.
 */

export const DECISION_TRANSACTION_SCHEMA_VERSION = 'workspai.decision-transaction.v1' as const;
export const DECISION_EVENT_SCHEMA_VERSION = 'workspai.decision-event.v1' as const;
export const DECISION_CHECKPOINT_SCHEMA_VERSION = 'workspai.decision-checkpoint.v1' as const;

export const DECISION_TRANSACTION_STATES = [
  'draft',
  'scoped',
  'evidence-ready',
  'authorized',
  'executing',
  'verifying',
  'awaiting-human',
  'blocked',
  'committed',
  'rejected',
  'aborted',
  'superseded',
] as const;

export type DecisionTransactionState = (typeof DECISION_TRANSACTION_STATES)[number];

export const DECISION_EVENT_KINDS = [
  'created',
  'scope-bound',
  'evidence-attached',
  'plan-attached',
  'authorized',
  'effect-requested',
  'effect-recorded',
  'effect-uncertain',
  'verification-started',
  'verification-recorded',
  'human-required',
  'blocked',
  'resumed',
  'committed',
  'rejected',
  'aborted',
  'superseded',
] as const;

export type DecisionEventKind = (typeof DECISION_EVENT_KINDS)[number];
export type DecisionActorKind = 'human' | 'agent' | 'cli' | 'ci' | 'extension';

export type DecisionArtifactReference = {
  role: string;
  artifact: string;
  schemaVersion: string;
  digest: {
    algorithm: 'sha256';
    semantics: 'canonical-json-v1' | 'raw-bytes-v1' | 'workspace-model-structural-v1';
    value: string;
  };
};

export type DecisionEffectReceipt = {
  id: string;
  effectClass: 'filesystem' | 'command' | 'configuration' | 'dependency' | 'external';
  status: 'succeeded' | 'failed' | 'uncertain';
  summary: string;
  command?: string[];
  artifacts: DecisionArtifactReference[];
  observedAt: string;
  idempotencyKey: string;
};

export type DecisionVerificationReceipt = {
  id: string;
  criterionId: string;
  status: 'passed' | 'failed' | 'inconclusive';
  summary: string;
  target: {
    modelHash: string;
    graphHash: string;
    effectHeadDigest: string;
  };
  artifacts: DecisionArtifactReference[];
  observedAt: string;
};

export type DecisionEventPayload = {
  summary: string;
  scope?: { kind: 'workspace' | 'project' | 'project-set'; projects: string[] };
  references?: DecisionArtifactReference[];
  authorization?: {
    grantedBy: string;
    grant: 'bounded-effects' | 'verification-only';
    effectClasses: DecisionEffectReceipt['effectClass'][];
  };
  effect?: DecisionEffectReceipt;
  verification?: DecisionVerificationReceipt;
  blocker?: { code: string; actionable: boolean; details?: string };
  resumeTo?: Extract<DecisionTransactionState, 'authorized' | 'executing' | 'verifying'>;
  reason?: string;
};

export type DecisionEvent = {
  schemaVersion: typeof DECISION_EVENT_SCHEMA_VERSION;
  transactionId: string;
  sequence: number;
  kind: DecisionEventKind;
  occurredAt: string;
  actor: { kind: DecisionActorKind; id: string };
  previousEventDigest: string | null;
  payload: DecisionEventPayload;
  digest: string;
};

export type DecisionTransaction = {
  schemaVersion: typeof DECISION_TRANSACTION_SCHEMA_VERSION;
  id: string;
  purpose: 'proof-carrying-change';
  createdAt: string;
  updatedAt: string;
  state: DecisionTransactionState;
  generation: number;
  eventCount: number;
  eventHeadDigest: string;
  intent: DecisionArtifactReference;
  requiredCriteria: string[];
  scope: { kind: 'workspace' | 'project' | 'project-set'; projects: string[] } | null;
  evidence: DecisionArtifactReference[];
  plans: DecisionArtifactReference[];
  authorization: DecisionEventPayload['authorization'] | null;
  effects: DecisionEffectReceipt[];
  verifications: DecisionVerificationReceipt[];
  blockers: Array<{ code: string; actionable: boolean; details?: string }>;
  terminalReason?: string;
};

export type DecisionCheckpoint = {
  schemaVersion: typeof DECISION_CHECKPOINT_SCHEMA_VERSION;
  transactionId: string;
  generatedAt: string;
  generation: number;
  eventCount: number;
  eventHeadDigest: string;
  state: DecisionTransactionState;
  transactionDigest: string;
};

export type UnsignedDecisionEvent = Omit<
  DecisionEvent,
  'schemaVersion' | 'transactionId' | 'sequence' | 'previousEventDigest' | 'digest'
>;

export type DecisionKernelPorts = {
  digestCanonical(value: unknown): string;
};
