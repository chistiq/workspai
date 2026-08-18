/**
 * Extraction-safe contracts for the natural-language goal front door.
 *
 * Keep this module free of filesystem, process, terminal, and CLI imports. A
 * future standalone goals/decisions package must be able to own these types
 * without importing the integrated Workspai CLI.
 */

export const GOAL_PACK_SCHEMA_VERSION = 'workspai.goal-pack.v1' as const;
export const GOAL_AGENT_HANDOFF_SCHEMA_VERSION = 'workspai.goal-agent-handoff.v1' as const;
export const GOAL_PLAN_RESULT_SCHEMA_VERSION = 'workspai.goal-plan-result.v1' as const;
export const GOAL_PACK_LAST_RUN_PATH = '.workspai/reports/goal-pack-last-run.json' as const;
export const GOAL_INDEX_SCHEMA_VERSION = 'workspai.goal-index.v1' as const;
export const GOAL_INDEX_PATH = '.workspai/goals/index.json' as const;
export const GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION = 'workspai.goal-lifecycle-result.v1' as const;

export const GOAL_INTENT_CATEGORIES = [
  'release-readiness',
  'dependency-security',
  'test-coverage',
  'defect-repair',
  'feature-change',
  'refactor',
  'performance',
  'documentation',
  'system-understanding',
] as const;

export type GoalIntentCategory = (typeof GOAL_INTENT_CATEGORIES)[number];
export type GoalPackState = 'ready-to-plan' | 'needs-confirmation' | 'needs-evidence' | 'blocked';
export type GoalScopeKind = 'workspace' | 'project' | 'project-set';
export type GoalScopeSelectionSource =
  'workspace' | 'single-project-workspace' | 'invocation-project' | 'explicit' | 'interactive';
export type GoalMutationMode = 'proposal-only';
export type GoalCoverageRuntime =
  | 'node'
  | 'bun'
  | 'deno'
  | 'python'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'elixir'
  | 'clojure'
  | 'scala'
  | 'kotlin'
  | 'c'
  | 'cpp';

export type CompiledGoalIntent = {
  original: string;
  normalized: string;
  statement: string;
  category: GoalIntentCategory;
  confidence: 'high' | 'medium' | 'low';
  ambiguities: string[];
  requestedTarget?: {
    metric: 'test-coverage-percent';
    operator: 'at-least';
    value: number;
    runtime?: GoalCoverageRuntime;
  };
};

export type GoalSuccessCriterion = {
  id: string;
  kind: 'workspace-verify' | 'release-readiness' | 'dependency-security' | 'test-coverage';
  expected: string;
  producerCommand: string;
  machineVerifiable: boolean;
};

export type GoalPack = {
  schemaVersion: typeof GOAL_PACK_SCHEMA_VERSION;
  id: string;
  fingerprint: string;
  generatedAt: string;
  state: GoalPackState;
  intent: CompiledGoalIntent;
  workspace: {
    name: string;
  };
  scope: {
    kind: GoalScopeKind;
    projects: string[];
    selectionSource: GoalScopeSelectionSource;
    /** Omitted by older v1 producers; omission has the same meaning as selected. */
    resolution?: 'selected' | 'selection-required';
  };
  sourceBinding: {
    model: {
      artifact: '.workspai/reports/workspace-model.json';
      schemaVersion: 'workspace-model.v1';
      hashAlgorithm: 'sha256';
      hashSemantics: 'workspace-model-structural-v1';
      hash: string;
      generatedAt: string;
    };
    graph: {
      artifact: '.workspai/reports/workspace-knowledge-graph.json';
      schemaVersion: 'workspace-knowledge-graph.v1';
      hashAlgorithm: 'sha256';
      hashSemantics: 'canonical-json-v1';
      hash: string;
      generatedAt: string;
      modelHash: string;
      inputHash?: string;
    };
  };
  baseline: {
    projectCount: number;
    runtimes: string[];
    frameworks: string[];
    graph: {
      entities: number;
      relationships: number;
      proofs: number;
      unresolved: number;
      proofCoveragePercent: number;
    };
  };
  preflight: {
    workspaceIntelligence: {
      status: 'passed' | 'blocked' | 'unknown';
      artifact: '.workspai/reports/workspace-intelligence-run-last-run.json';
      blockedStages: string[];
    };
    measurement: {
      status: 'available' | 'requires-setup' | 'unsupported' | 'not-applicable';
      runtime: string | null;
      /** Canonical runtimes valid for every project in the selected scope. */
      runtimeChoices?: string[];
      runner: string | null;
      existingEvidence: Array<{ project: string; path: string; sha256: string }>;
      prerequisites: string[];
    };
    retrieval: {
      status: 'grounded' | 'partial' | 'empty';
      strategy: 'deterministic-category-v1';
      queries: string[];
      anchors: Array<{
        entityId: string;
        kind: string;
        label: string;
        proofIds: string[];
      }>;
    };
  };
  successCriteria: GoalSuccessCriterion[];
  policy: {
    mutationMode: GoalMutationMode;
    approval: 'required-before-mutation';
    verificationOwner: 'workspai-cli';
    rollbackOwner: 'workspai-cli';
    maxAttempts: number;
    allowBreakingChanges: false;
    allowForce: false;
    networkAccess: 'not-granted';
    scopeExpansion: 'requires-decision';
  };
  orchestration: Array<{
    id: 'understand' | 'impact' | 'propose' | 'approve' | 'execute' | 'verify';
    owner: 'workspai-cli' | 'agent' | 'human';
    status: 'complete' | 'pending' | 'blocked';
    summary: string;
  }>;
  decision?: {
    required: true;
    reason: string;
    question: string;
  };
  artifacts: {
    goalPack: string;
    agentHandoff: string;
    latestReport: typeof GOAL_PACK_LAST_RUN_PATH;
  };
  commands: {
    refreshEvidence: 'workspai workspace intelligence run --for-agent generic --strict --json';
    inspectGraph: string;
    planVerifiedGoal?: string;
    proposeRepair: 'workspai workspace repair propose --file <proposal.json> --json';
  };
};

export type GoalAgentHandoff = {
  schemaVersion: typeof GOAL_AGENT_HANDOFF_SCHEMA_VERSION;
  goalId: string;
  goalFingerprint: string;
  generatedAt: string;
  consumer: 'generic' | 'claude' | 'codex';
  state: GoalPackState;
  objective: string;
  scope: GoalPack['scope'];
  evidence: Array<{
    role: 'model' | 'graph' | 'goal';
    artifact: string;
    binding: {
      algorithm: 'sha256';
      semantics: 'workspace-model-structural-v1' | 'canonical-json-v1';
      value: string;
    };
  }>;
  discovery: {
    index: typeof GOAL_INDEX_PATH;
    statusCommand: string;
    requiredReads: string[];
  };
  retrieval: GoalPack['preflight']['retrieval'];
  guardrails: string[];
  workflow: Array<{
    order: number;
    owner: 'workspai-cli' | 'agent' | 'human';
    instruction: string;
  }>;
  renewal: {
    command: string;
    reason: string;
  };
};

export type GoalPackKernelInput = {
  generatedAt: string;
  intent: CompiledGoalIntent;
  workspaceName: string;
  scope: GoalPack['scope'];
  sourceBinding: GoalPack['sourceBinding'];
  baseline: GoalPack['baseline'];
  preflight: GoalPack['preflight'];
  maxAttempts: number;
  consumer: GoalAgentHandoff['consumer'];
};

export type GoalIndexEntry = {
  id: string;
  fingerprint: string;
  objective: string;
  category: GoalIntentCategory;
  state: GoalPackState;
  lifecycle: 'planned' | 'active' | 'cancelled' | 'verification-ready' | 'verified' | 'failed';
  scope: GoalPack['scope'];
  createdAt: string;
  updatedAt: string;
  goalPack: string;
  agentHandoff: string;
  verifiedGoalId?: string;
  repairTransactionId?: string;
  repairTransactionIds?: string[];
  verificationReceipt?: {
    verifiedGoalId: string;
    attempt: number;
    statusHash: string;
    modelHash: string;
    graphFingerprint: string;
    graphFingerprintSemantics: 'workspace-knowledge-graph-inputs-v1' | 'canonical-json-v1';
    recordedAt: string;
  };
};

export type GoalIndex = {
  schemaVersion: typeof GOAL_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  activeGoalId: string | null;
  goals: GoalIndexEntry[];
};

/**
 * Reconcile the one legacy index shape emitted before non-actionable Goal
 * Packs were prevented from becoming active. This migration is intentionally
 * narrow: it only clears the selected Goal and, when necessary, demotes that
 * same entry. Every unrelated semantic failure remains fail-closed.
 */
export function reconcileLegacyNonActionableGoalSelection(index: GoalIndex): GoalIndex | null {
  if (!index.activeGoalId) return null;
  const selected = index.goals.find((entry) => entry.id === index.activeGoalId);
  const activeEntries = index.goals.filter((entry) => entry.lifecycle === 'active');
  if (!selected || selected.state === 'ready-to-plan') return null;
  if (!(
    (selected.lifecycle === 'planned' && activeEntries.length === 0) ||
    (selected.lifecycle === 'active' &&
      activeEntries.length === 1 &&
      activeEntries[0]?.id === selected.id)
  )) {
    return null;
  }
  return {
    ...index,
    activeGoalId: null,
    goals: index.goals.map((entry) =>
      entry.id === selected.id && entry.lifecycle === 'active'
        ? { ...entry, lifecycle: 'planned' as const }
        : entry
    ),
  };
}

export function assertGoalIndexSemantics(index: GoalIndex): void {
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  const generatedAt = Date.parse(index.generatedAt);
  for (const entry of index.goals) {
    if (ids.has(entry.id)) throw new Error(`Goal index contains duplicate id: ${entry.id}`);
    if (fingerprints.has(entry.fingerprint)) {
      throw new Error(`Goal index contains duplicate fingerprint: ${entry.fingerprint}`);
    }
    ids.add(entry.id);
    fingerprints.add(entry.fingerprint);
    if (
      entry.goalPack !== `.workspai/goals/${entry.id}/goal-pack.json` ||
      entry.agentHandoff !== `.workspai/goals/${entry.id}/agent-handoff.json`
    ) {
      throw new Error(`Goal index artifact paths do not match goal id: ${entry.id}`);
    }
    if (Date.parse(entry.createdAt) > Date.parse(entry.updatedAt)) {
      throw new Error(`Goal index timestamps are inconsistent for: ${entry.id}`);
    }
    if (Date.parse(entry.updatedAt) > generatedAt) {
      throw new Error(`Goal index generatedAt predates entry update: ${entry.id}`);
    }
  }
  const activeEntries = index.goals.filter((entry) => entry.lifecycle === 'active');
  for (const entry of index.goals) {
    if (entry.repairTransactionIds) {
      if (
        entry.repairTransactionIds.length > 25 ||
        new Set(entry.repairTransactionIds).size !== entry.repairTransactionIds.length ||
        (entry.repairTransactionId &&
          entry.repairTransactionIds.at(-1) !== entry.repairTransactionId)
      ) {
        throw new Error(`Goal index repair transaction history is inconsistent: ${entry.id}`);
      }
    }
    if (
      entry.verificationReceipt &&
      (!entry.verifiedGoalId ||
        entry.verificationReceipt.verifiedGoalId !== entry.verifiedGoalId ||
        entry.verificationReceipt.attempt < 1 ||
        Date.parse(entry.verificationReceipt.recordedAt) > generatedAt)
    ) {
      throw new Error(`Goal index verification receipt is inconsistent: ${entry.id}`);
    }
  }
  if (index.activeGoalId === null) {
    if (activeEntries.length > 0) {
      throw new Error('Goal index is inconsistent: active lifecycle entries require activeGoalId.');
    }
    return;
  }
  const selected = index.goals.find((entry) => entry.id === index.activeGoalId);
  if (
    !selected ||
    selected.state !== 'ready-to-plan' ||
    !['active', 'verification-ready', 'failed'].includes(selected.lifecycle) ||
    activeEntries.some((entry) => entry.id !== index.activeGoalId)
  ) {
    throw new Error(
      'Goal index is inconsistent: activeGoalId must identify the only selected actionable lifecycle entry.'
    );
  }
}

/** Stable machine-readable envelope for every non-planning `workspai goal` operation. */
export type GoalLifecycleResult = {
  schemaVersion: typeof GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION;
  operation: 'status' | 'list' | 'activate' | 'cancel' | 'prepare' | 'verify';
  activeGoalId: string | null;
  goal: GoalIndexEntry | null;
  goals: GoalIndexEntry[];
  goalPack: GoalPack | null;
  verifiedGoalId: string | null;
  verification: unknown | null;
};

export type GoalPackKernelPorts = {
  /** Deterministic SHA-256 over a canonical JSON projection supplied by the adapter. */
  digestCanonical: (value: unknown) => string;
};
