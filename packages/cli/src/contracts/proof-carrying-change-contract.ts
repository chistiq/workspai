import type { DecisionArtifactReference } from '../decisions/decision-contract.js';
import type { WorkspaceKnowledgeGraphChangeOverlay } from './workspace-knowledge-graph-change-overlay-contract.js';

export const ARCHITECTURE_CHANGE_LEASE_SCHEMA_VERSION =
  'workspai.architecture-change-lease.v1' as const;
export const PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION =
  'workspai.predicted-architecture-change.v1' as const;
export const ARCHITECTURE_SURPRISE_REPORT_SCHEMA_VERSION =
  'workspai.architecture-surprise-report.v1' as const;
export const PROOF_CARRYING_CHANGE_CAPSULE_SCHEMA_VERSION =
  'workspai.proof-carrying-change-capsule.v1' as const;
export const CHANGE_OPERATION_RESULT_SCHEMA_VERSION =
  'workspai.change-operation-result.v1' as const;
export const PROOF_CARRYING_CHANGE_LIST_SCHEMA_VERSION =
  'workspai.proof-carrying-change-list.v1' as const;
export const PROOF_CARRYING_CHANGE_CAPSULE_VALIDATION_SCHEMA_VERSION =
  'workspai.proof-carrying-change-capsule-validation.v1' as const;
export const PROOF_CARRYING_CHANGE_CAPSULE_EXPORT_SCHEMA_VERSION =
  'workspai.proof-carrying-change-capsule-export.v1' as const;

export type ArchitectureGenerationBinding = {
  model: DecisionArtifactReference;
  graph: DecisionArtifactReference & { inputHash: string };
};

export type ArchitectureChangeLease = {
  schemaVersion: typeof ARCHITECTURE_CHANGE_LEASE_SCHEMA_VERSION;
  changeId: string;
  goalId: string;
  createdAt: string;
  workspace: { name: string };
  scope: { kind: 'workspace' | 'project' | 'project-set'; projects: string[] };
  baseline: ArchitectureGenerationBinding;
  generation: string;
  semantics: 'optimistic-generation-guard';
  privateMaterialization: {
    artifact: string;
    role: 'hash-bound-baseline-cache';
    portable: false;
    authoritative: false;
    digest: DecisionArtifactReference['digest'];
  };
};

export type PredictedChangeOperation = {
  operation: 'add' | 'remove' | 'change';
  targetKind: 'entity' | 'relation' | 'proof' | 'artifact';
  targetId: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
};

export type PredictedArchitectureChange = {
  schemaVersion: typeof PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION;
  changeId: string;
  goalId: string;
  generatedAt: string;
  baselineGeneration: string;
  nonCanonical: true;
  proofEligible: false;
  operations: PredictedChangeOperation[];
  assumptions: string[];
  predictedRisk: 'none' | 'low' | 'medium' | 'high';
};

export type ArchitectureSurpriseReport = {
  schemaVersion: typeof ARCHITECTURE_SURPRISE_REPORT_SCHEMA_VERSION;
  changeId: string;
  generatedAt: string;
  prediction: DecisionArtifactReference | null;
  actual: DecisionArtifactReference;
  matched: Array<{ operation: string; targetKind: string; targetId: string }>;
  unpredicted: Array<{ operation: string; targetKind: string; targetId: string }>;
  missing: Array<{ operation: string; targetKind: string; targetId: string }>;
  summary: {
    predicted: number;
    actual: number;
    matched: number;
    unpredicted: number;
    missing: number;
    verdict: 'exact' | 'within-expectation' | 'surprising' | 'no-prediction';
  };
};

export type ProofCarryingChangeCapsule = {
  schemaVersion: typeof PROOF_CARRYING_CHANGE_CAPSULE_SCHEMA_VERSION;
  changeId: string;
  goalId: string;
  generatedAt: string;
  status: 'open' | 'blocked' | 'verified' | 'sealed' | 'aborted';
  workspace: { name: string };
  scope: ArchitectureChangeLease['scope'];
  decision: {
    transaction: DecisionArtifactReference;
    eventHeadDigest: string;
    effectHeadDigest: string;
    state: string;
    generation: number;
  };
  intent: DecisionArtifactReference;
  baseline: ArchitectureGenerationBinding;
  prediction: DecisionArtifactReference | null;
  actualOverlay: DecisionArtifactReference | null;
  surpriseReport: DecisionArtifactReference | null;
  effects: DecisionArtifactReference[];
  verification: DecisionArtifactReference[];
  assurances: Array<{
    id:
      | 'intent-bound'
      | 'baseline-pinned'
      | 'effects-receipted'
      | 'architecture-reobserved'
      | 'independently-verified';
    status: 'passed' | 'failed' | 'pending';
    summary: string;
  }>;
  remainingUncertainty: string[];
  integrity: {
    algorithm: 'sha256';
    semantics: 'canonical-json-v1';
    capsuleDigest: string;
  };
};

export type ChangeOperationResult = {
  schemaVersion: typeof CHANGE_OPERATION_RESULT_SCHEMA_VERSION;
  operation:
    | 'begin'
    | 'predict'
    | 'authorize'
    | 'resume'
    | 'effect-record'
    | 'verification-record'
    | 'status'
    | 'verify'
    | 'explain'
    | 'abort'
    | 'capsule-validate'
    | 'capsule-export';
  changeId: string;
  state: string;
  capsule: ProofCarryingChangeCapsule;
  artifacts: Record<string, string | null>;
  nextActions: string[];
};

export type ProofCarryingChangeListEntry = {
  changeId: string;
  goalId: string | null;
  state: string | null;
  status: ProofCarryingChangeCapsule['status'] | 'invalid';
  createdAt: string | null;
  updatedAt: string | null;
  scope: ArchitectureChangeLease['scope'] | null;
  assurance: { passed: number; total: number };
  blockers: string[];
  capsuleArtifact: string;
  valid: boolean;
  errors: string[];
};

export type ProofCarryingChangeList = {
  schemaVersion: typeof PROOF_CARRYING_CHANGE_LIST_SCHEMA_VERSION;
  generatedAt: string;
  workspace: { name: string };
  changes: ProofCarryingChangeListEntry[];
  summary: {
    total: number;
    open: number;
    blocked: number;
    sealed: number;
    aborted: number;
    invalid: number;
  };
};

export type ProofCarryingChangeCapsuleValidation = {
  schemaVersion: typeof PROOF_CARRYING_CHANGE_CAPSULE_VALIDATION_SCHEMA_VERSION;
  changeId: string;
  validatedAt: string;
  valid: boolean;
  errors: string[];
  capsule: ProofCarryingChangeCapsule;
};

export type ProofCarryingChangeCapsuleExport = {
  schemaVersion: typeof PROOF_CARRYING_CHANGE_CAPSULE_EXPORT_SCHEMA_VERSION;
  changeId: string;
  outputPath: string;
  validation: ProofCarryingChangeCapsuleValidation;
};

export type ActualArchitectureOverlay = WorkspaceKnowledgeGraphChangeOverlay;
