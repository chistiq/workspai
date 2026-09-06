import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

import { emitWorkspaceActivity } from './activity/activity-runtime.js';
import {
  ARCHITECTURE_CHANGE_LEASE_SCHEMA_VERSION,
  ARCHITECTURE_SURPRISE_REPORT_SCHEMA_VERSION,
  CHANGE_OPERATION_RESULT_SCHEMA_VERSION,
  PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION,
  PROOF_CARRYING_CHANGE_CAPSULE_EXPORT_SCHEMA_VERSION,
  PROOF_CARRYING_CHANGE_LIST_SCHEMA_VERSION,
  PROOF_CARRYING_CHANGE_CAPSULE_VALIDATION_SCHEMA_VERSION,
  PROOF_CARRYING_CHANGE_CAPSULE_SCHEMA_VERSION,
  type ArchitectureChangeLease,
  type ArchitectureSurpriseReport,
  type ChangeOperationResult,
  type PredictedArchitectureChange,
  type ProofCarryingChangeCapsuleExport,
  type ProofCarryingChangeCapsuleValidation,
  type ProofCarryingChangeList,
  type ProofCarryingChangeListEntry,
  type ProofCarryingChangeCapsule,
} from './contracts/proof-carrying-change-contract.js';
import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import {
  WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION,
  type WorkspaceKnowledgeGraphChangeOverlay,
} from './contracts/workspace-knowledge-graph-change-overlay-contract.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import type {
  DecisionArtifactReference,
  DecisionDeletedArtifactReference,
  DecisionEffectReceipt,
  DecisionTransaction,
  DecisionVerificationReceipt,
  UnsignedDecisionEvent,
} from './decisions/decision-contract.js';
import { currentDecisionEffectHeadDigest } from './decisions/decision-kernel.js';
import {
  appendDecisionEvent,
  decisionRelativeDirectory,
  readDecisionTransaction,
  type DecisionTransactionRecord,
} from './decisions/decision-store.js';
import { inspectGoalLifecycle, linkGoalChangeTransaction } from './goal-lifecycle.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  resolveContainedWorkspaceArtifactPath,
  resolvePortableWorkspaceEvidenceCandidatePath,
  resolvePortableWorkspaceEvidencePath,
  writeWorkspaceArtifactJson,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import { runWorkspaceIntelligenceChain } from './workspace-intelligence-runner.js';
import { buildWorkspaceKnowledgeGraphChangeOverlay } from './workspace-knowledge-graph-change-overlay.js';
import { readWorkspaceKnowledgeGraphSnapshot } from './workspace-knowledge-graph-snapshot.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';
import {
  buildWorkspaceVerify,
  evaluateWorkspaceVerifyGate,
  writeWorkspaceVerify,
} from './workspace-verify.js';

type ChangePaths = {
  directory: string;
  lease: string;
  prediction: string;
  actualOverlay: string;
  surprises: string;
  capsule: string;
  privateBaselineGraph: string;
};

const kernelPorts = { digestCanonical: hashCanonicalJson };
const DELETED_ARTIFACT_TOMBSTONE_SCHEMA_VERSION = 'workspai.deleted-artifact-tombstone.v1' as const;

function assertChangeId(changeId: string): string {
  const normalized = changeId.trim();
  if (!/^change-[a-z0-9][a-z0-9-]{7,95}$/.test(normalized)) {
    throw new Error(`Invalid proof-carrying change id: ${changeId}`);
  }
  return normalized;
}

function pathsFor(changeId: string): ChangePaths {
  const id = assertChangeId(changeId);
  const directory = `.workspai/changes/${id}`;
  return {
    directory,
    lease: `${directory}/lease.json`,
    prediction: `${directory}/predicted-overlay.json`,
    actualOverlay: `${directory}/actual-overlay.json`,
    surprises: `${directory}/architecture-surprises.json`,
    capsule: `${directory}/capsule.json`,
    privateBaselineGraph: `${directory}/private/baseline-graph.json`,
  };
}

function actor(kind: 'human' | 'agent' | 'cli' | 'ci' | 'extension', id: string) {
  return { kind, id } as const;
}

function reference(input: {
  role: string;
  artifact: string;
  schemaVersion: string;
  value: string;
  semantics?: DecisionArtifactReference['digest']['semantics'];
}): DecisionArtifactReference {
  return {
    role: input.role,
    artifact: input.artifact,
    schemaVersion: input.schemaVersion,
    digest: {
      algorithm: 'sha256',
      semantics: input.semantics ?? 'canonical-json-v1',
      value: input.value,
    },
  };
}

async function readJson<T>(workspacePath: string, relativePath: string): Promise<T | null> {
  const absolute = await resolveContainedWorkspaceArtifactPath(workspacePath, relativePath);
  if (!absolute) return null;
  return (await fsExtra.readJson(absolute)) as T;
}

async function workspaceIdentityName(workspacePath: string): Promise<string> {
  const contract = await readJson<{ workspace?: { name?: unknown } }>(
    workspacePath,
    WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.workspaceContract.artifactPath
  );
  const contractName = contract?.workspace?.name;
  if (typeof contractName === 'string' && contractName.trim()) return contractName.trim();
  const manifest = await readJson<{ workspace_name?: unknown; name?: unknown }>(
    workspacePath,
    '.workspai/workspace.json'
  );
  const manifestName = manifest?.workspace_name ?? manifest?.name;
  return typeof manifestName === 'string' && manifestName.trim()
    ? manifestName.trim()
    : path.basename(workspacePath);
}

async function artifactDigestMatches(
  workspacePath: string,
  artifact: DecisionArtifactReference
): Promise<boolean> {
  const absolute = await resolvePortableWorkspaceEvidencePath(workspacePath, artifact.artifact);
  if (!absolute) return false;
  if (artifact.digest.semantics === 'raw-bytes-v1') {
    const content = await fsExtra.readFile(absolute);
    return createHash('sha256').update(content).digest('hex') === artifact.digest.value;
  }
  const payload = await fsExtra.readJson(absolute).catch(() => null);
  if (!payload) return false;
  const digest =
    artifact.digest.semantics === 'workspace-model-structural-v1'
      ? hashWorkspaceModel(payload)
      : hashCanonicalJson(payload);
  return digest === artifact.digest.value;
}

function deletedArtifactDigest(artifact: string): string {
  return hashCanonicalJson({
    schemaVersion: DELETED_ARTIFACT_TOMBSTONE_SCHEMA_VERSION,
    artifact: normalizedArtifactIdentity(artifact),
    deleted: true,
  });
}

export function createDeletedArtifactReference(input: {
  artifact: string;
  observedAt?: string;
}): DecisionDeletedArtifactReference {
  const artifact = normalizedArtifactIdentity(input.artifact);
  if (!artifact || artifact === '.' || artifact === '..' || artifact.startsWith('../')) {
    throw new Error(
      `Deleted artifact identity must be a contained relative path: ${input.artifact}`
    );
  }
  return {
    artifact,
    observedAt: input.observedAt ?? new Date().toISOString(),
    digest: {
      algorithm: 'sha256',
      semantics: 'deletion-tombstone-v1',
      value: deletedArtifactDigest(artifact),
    },
  };
}

async function deletedArtifactReferenceMatches(
  workspacePath: string,
  deletedArtifact: DecisionDeletedArtifactReference
): Promise<boolean> {
  if (
    deletedArtifact.digest.algorithm !== 'sha256' ||
    deletedArtifact.digest.semantics !== 'deletion-tombstone-v1' ||
    deletedArtifact.digest.value !== deletedArtifactDigest(deletedArtifact.artifact)
  ) {
    return false;
  }
  const candidate = await resolvePortableWorkspaceEvidenceCandidatePath(
    workspacePath,
    deletedArtifact.artifact
  );
  return candidate !== null && !(await fsExtra.pathExists(candidate));
}

async function requireLease(
  workspacePath: string,
  changeId: string
): Promise<ArchitectureChangeLease> {
  const lease = await readJson<ArchitectureChangeLease>(workspacePath, pathsFor(changeId).lease);
  if (!lease || lease.schemaVersion !== ARCHITECTURE_CHANGE_LEASE_SCHEMA_VERSION) {
    throw new Error(`Architecture lease is missing or unsupported for ${changeId}.`);
  }
  if (lease.changeId !== changeId)
    throw new Error(`Architecture lease binding failed for ${changeId}.`);
  return lease;
}

async function currentSnapshot(workspacePath: string) {
  const snapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
  if (snapshot.status === 'miss') {
    throw new Error(
      `A current canonical Model and Graph are required (${snapshot.reason}). ` +
        'Run workspai workspace intelligence run --for-agent generic --strict --json.'
    );
  }
  return snapshot;
}

function architectureGeneration(modelHash: string, graphHash: string, inputHash: string): string {
  return hashCanonicalJson({ modelHash, graphHash, inputHash });
}

function snapshotGeneration(snapshot: Awaited<ReturnType<typeof currentSnapshot>>) {
  const modelHash = hashWorkspaceModel(snapshot.model);
  const graphHash = hashCanonicalJson(snapshot.graph);
  const inputHash = snapshot.graph.source.inputs?.hash;
  if (!inputHash) throw new Error('The canonical Graph has no live input fingerprint.');
  return {
    modelHash,
    graphHash,
    inputHash,
    generation: architectureGeneration(modelHash, graphHash, inputHash),
  };
}

async function assertLeaseStillCurrent(workspacePath: string, lease: ArchitectureChangeLease) {
  const snapshot = await currentSnapshot(workspacePath);
  const generation = snapshotGeneration(snapshot);
  if (generation.generation !== lease.generation) {
    throw new Error(
      `Architecture lease ${lease.changeId} is stale. Expected generation ${lease.generation}, ` +
        `observed ${generation.generation}. Abort or begin a new change from current evidence.`
    );
  }
  return snapshot;
}

function event(
  kind: UnsignedDecisionEvent['kind'],
  payload: UnsignedDecisionEvent['payload'],
  actorKind: Parameters<typeof actor>[0],
  actorId: string,
  occurredAt = new Date().toISOString()
): UnsignedDecisionEvent {
  return { kind, payload, occurredAt, actor: actor(actorKind, actorId) };
}

async function append(
  workspacePath: string,
  record: DecisionTransactionRecord | null,
  changeId: string,
  next: UnsignedDecisionEvent
): Promise<DecisionTransactionRecord> {
  return appendDecisionEvent({
    workspacePath,
    transactionId: changeId,
    expectedHeadDigest: record?.transaction.eventHeadDigest ?? null,
    event: next,
  });
}

function operationKey(operation: string, targetKind: string, targetId: string): string {
  return `${operation}\u0000${targetKind}\u0000${targetId}`;
}

function actualOperations(overlay: WorkspaceKnowledgeGraphChangeOverlay) {
  const operations: Array<{ operation: string; targetKind: string; targetId: string }> = [];
  for (const [targetKind, group] of [
    ['entity', overlay.entities],
    ['relation', overlay.relations],
    ['proof', overlay.proofs],
  ] as const) {
    operations.push(
      ...group.added.map((item) => ({ operation: 'add', targetKind, targetId: item.id }))
    );
    operations.push(
      ...group.removed.map((item) => ({ operation: 'remove', targetKind, targetId: item.id }))
    );
    operations.push(
      ...group.changed.map((item) => ({ operation: 'change', targetKind, targetId: item.id }))
    );
  }
  operations.push(
    ...overlay.changedArtifacts.map((artifact) => ({
      operation: 'change',
      targetKind: 'artifact',
      targetId: artifact,
    }))
  );
  return operations.sort((left, right) =>
    operationKey(left.operation, left.targetKind, left.targetId).localeCompare(
      operationKey(right.operation, right.targetKind, right.targetId)
    )
  );
}

function buildSurpriseReport(input: {
  changeId: string;
  generatedAt: string;
  prediction: PredictedArchitectureChange | null;
  predictionReference: DecisionArtifactReference | null;
  actual: WorkspaceKnowledgeGraphChangeOverlay;
  actualReference: DecisionArtifactReference;
}): ArchitectureSurpriseReport {
  const predicted =
    input.prediction?.operations.map((operation) => ({
      operation: operation.operation,
      targetKind: operation.targetKind,
      targetId: operation.targetId,
    })) ?? [];
  const actual = actualOperations(input.actual);
  const predictedKeys = new Set(
    predicted.map((item) => operationKey(item.operation, item.targetKind, item.targetId))
  );
  const actualKeys = new Set(
    actual.map((item) => operationKey(item.operation, item.targetKind, item.targetId))
  );
  const matched = actual.filter((item) =>
    predictedKeys.has(operationKey(item.operation, item.targetKind, item.targetId))
  );
  const unpredicted = actual.filter(
    (item) => !predictedKeys.has(operationKey(item.operation, item.targetKind, item.targetId))
  );
  const missing = predicted.filter(
    (item) => !actualKeys.has(operationKey(item.operation, item.targetKind, item.targetId))
  );
  const verdict = !input.prediction
    ? 'no-prediction'
    : unpredicted.length === 0 && missing.length === 0
      ? 'exact'
      : unpredicted.length === 0
        ? 'within-expectation'
        : 'surprising';
  return {
    schemaVersion: ARCHITECTURE_SURPRISE_REPORT_SCHEMA_VERSION,
    changeId: input.changeId,
    generatedAt: input.generatedAt,
    prediction: input.predictionReference,
    actual: input.actualReference,
    matched,
    unpredicted,
    missing,
    summary: {
      predicted: predicted.length,
      actual: actual.length,
      matched: matched.length,
      unpredicted: unpredicted.length,
      missing: missing.length,
      verdict,
    },
  };
}

async function artifactReferenceIfPresent(input: {
  workspacePath: string;
  relativePath: string;
  role: string;
  schemaVersion: string;
}): Promise<DecisionArtifactReference | null> {
  const payload = await readJson<unknown>(input.workspacePath, input.relativePath);
  return payload
    ? reference({
        role: input.role,
        artifact: input.relativePath,
        schemaVersion: input.schemaVersion,
        value: hashCanonicalJson(payload),
      })
    : null;
}

function capsuleWithoutIntegrity(
  capsule: ProofCarryingChangeCapsule
): Omit<ProofCarryingChangeCapsule, 'integrity'> {
  const { integrity: _integrity, ...content } = capsule;
  return content;
}

async function buildCapsule(input: {
  workspacePath: string;
  lease: ArchitectureChangeLease;
  record: DecisionTransactionRecord;
}): Promise<ProofCarryingChangeCapsule> {
  const paths = pathsFor(input.lease.changeId);
  const [prediction, actualOverlay, surpriseReport] = await Promise.all([
    artifactReferenceIfPresent({
      workspacePath: input.workspacePath,
      relativePath: paths.prediction,
      role: 'prediction',
      schemaVersion: PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION,
    }),
    artifactReferenceIfPresent({
      workspacePath: input.workspacePath,
      relativePath: paths.actualOverlay,
      role: 'actual-architecture-overlay',
      schemaVersion: WORKSPACE_KNOWLEDGE_GRAPH_CHANGE_OVERLAY_SCHEMA_VERSION,
    }),
    artifactReferenceIfPresent({
      workspacePath: input.workspacePath,
      relativePath: paths.surprises,
      role: 'architecture-surprises',
      schemaVersion: ARCHITECTURE_SURPRISE_REPORT_SCHEMA_VERSION,
    }),
  ]);
  const transactionReference = reference({
    role: 'decision-transaction',
    artifact: `${decisionRelativeDirectory(input.lease.changeId)}/transaction.json`,
    schemaVersion: input.record.transaction.schemaVersion,
    value: hashCanonicalJson(input.record.transaction),
  });
  const effects = input.record.transaction.effects.flatMap((effect) => effect.artifacts);
  const deletedArtifacts = input.record.transaction.effects.flatMap(
    (effect) => effect.deletedArtifacts ?? []
  );
  const verification = input.record.transaction.verifications.flatMap(
    (receipt) => receipt.artifacts
  );
  const observedOverlay = await readJson<WorkspaceKnowledgeGraphChangeOverlay>(
    input.workspacePath,
    paths.actualOverlay
  );
  const noObservedMutation = observedOverlay ? !actualChanged(observedOverlay) : false;
  const assurances: ProofCarryingChangeCapsule['assurances'] = [
    {
      id: 'intent-bound',
      status: 'passed',
      summary: 'The transaction is hash-bound to its immutable Goal Pack.',
    },
    {
      id: 'baseline-pinned',
      status: 'passed',
      summary: 'The architecture lease pins exact Model, Graph, and live-input identities.',
    },
    {
      id: 'effects-receipted',
      status:
        input.record.transaction.effects.length > 0 &&
        input.record.transaction.effects.every((effect) => effect.status === 'succeeded')
          ? 'passed'
          : input.record.transaction.effects.length === 0 && noObservedMutation
            ? 'passed'
            : input.record.transaction.effects.length === 0
              ? 'pending'
              : 'failed',
      summary:
        input.record.transaction.effects.length === 0 && noObservedMutation
          ? 'Fresh Graph observation proves this was a no-effect change.'
          : `${input.record.transaction.effects.length} typed effect receipt(s) are bound to the transaction ledger.`,
    },
    {
      id: 'architecture-reobserved',
      status: actualOverlay ? 'passed' : 'pending',
      summary: actualOverlay
        ? 'The actual architecture delta was derived from a fresh canonical Graph.'
        : 'No post-effect architecture overlay has been observed yet.',
    },
    {
      id: 'independently-verified',
      status:
        input.record.transaction.state === 'committed'
          ? 'passed'
          : input.record.transaction.verifications.some((receipt) => receipt.status === 'failed')
            ? 'failed'
            : 'pending',
      summary: `${input.record.transaction.verifications.length} independent verification receipt(s) are recorded.`,
    },
  ];
  const surprise = await readJson<ArchitectureSurpriseReport>(input.workspacePath, paths.surprises);
  const remainingUncertainty = [
    ...(input.record.transaction.effects.length === 0 &&
    observedOverlay &&
    actualChanged(observedOverlay)
      ? ['No typed effect receipt explains the observed architecture generation.']
      : []),
    ...(surprise?.summary.unpredicted
      ? [`${surprise.summary.unpredicted} actual architecture operation(s) were not predicted.`]
      : []),
    ...input.record.transaction.blockers.map((blocker) => blocker.details ?? blocker.code),
  ];
  const status: ProofCarryingChangeCapsule['status'] =
    input.record.transaction.state === 'committed'
      ? 'sealed'
      : input.record.transaction.state === 'aborted'
        ? 'aborted'
        : input.record.transaction.state === 'blocked' ||
            input.record.transaction.state === 'awaiting-human'
          ? 'blocked'
          : input.record.transaction.state === 'verifying' &&
              input.record.transaction.verifications.some((receipt) => receipt.status === 'passed')
            ? 'verified'
            : 'open';
  const unsigned: Omit<ProofCarryingChangeCapsule, 'integrity'> = {
    schemaVersion: PROOF_CARRYING_CHANGE_CAPSULE_SCHEMA_VERSION,
    changeId: input.lease.changeId,
    goalId: input.lease.goalId,
    generatedAt: input.record.transaction.updatedAt,
    status,
    workspace: input.lease.workspace,
    scope: input.lease.scope,
    decision: {
      transaction: transactionReference,
      eventHeadDigest: input.record.transaction.eventHeadDigest,
      effectHeadDigest: currentDecisionEffectHeadDigest(input.record.transaction, kernelPorts),
      state: input.record.transaction.state,
      generation: input.record.transaction.generation,
    },
    intent: input.record.transaction.intent,
    baseline: input.lease.baseline,
    prediction,
    actualOverlay,
    surpriseReport,
    effects,
    deletedArtifacts,
    verification,
    assurances,
    remainingUncertainty: [...new Set(remainingUncertainty)],
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256',
      semantics: 'canonical-json-v1',
      capsuleDigest: hashCanonicalJson(unsigned),
    },
  };
}

async function publishCapsule(
  workspacePath: string,
  lease: ArchitectureChangeLease,
  record: DecisionTransactionRecord
): Promise<ProofCarryingChangeCapsule> {
  const capsule = await buildCapsule({ workspacePath, lease, record });
  await writeWorkspaceArtifactJson(workspacePath, pathsFor(lease.changeId).capsule, capsule);
  return capsule;
}

function result(input: {
  operation: ChangeOperationResult['operation'];
  lease: ArchitectureChangeLease;
  record: DecisionTransactionRecord;
  capsule: ProofCarryingChangeCapsule;
  nextActions: string[];
}): ChangeOperationResult {
  const paths = pathsFor(input.lease.changeId);
  const payload: ChangeOperationResult = {
    schemaVersion: CHANGE_OPERATION_RESULT_SCHEMA_VERSION,
    operation: input.operation,
    changeId: input.lease.changeId,
    state: input.record.transaction.state,
    capsule: input.capsule,
    artifacts: {
      lease: paths.lease,
      prediction: input.capsule.prediction?.artifact ?? null,
      actualOverlay: input.capsule.actualOverlay?.artifact ?? null,
      surpriseReport: input.capsule.surpriseReport?.artifact ?? null,
      transaction: `${decisionRelativeDirectory(input.lease.changeId)}/transaction.json`,
      events: `${decisionRelativeDirectory(input.lease.changeId)}/events.jsonl`,
      capsule: paths.capsule,
    },
    nextActions: input.nextActions,
  };
  assertJsonSchemaContract(
    payload,
    'contracts/workspace-intelligence/change-operation-result.v1.json',
    'Proof-Carrying Change operation result'
  );
  emitWorkspaceActivity({
    kind: 'operation.completed',
    status:
      input.record.transaction.state === 'blocked' ||
      input.record.transaction.state === 'awaiting-human'
        ? 'blocked'
        : input.record.transaction.state === 'aborted'
          ? 'cancelled'
          : 'succeeded',
    component: 'proof-carrying-change',
    correlationId: input.lease.changeId,
    message: `${input.operation}: ${input.record.transaction.state}`,
    evidenceBindings: [
      {
        kind: 'artifact',
        ref: paths.capsule,
        role: 'output',
        provenance: 'authoritative',
      },
      {
        kind: 'artifact',
        ref: `${decisionRelativeDirectory(input.lease.changeId)}/transaction.json`,
        role: 'subject',
        provenance: 'authoritative',
      },
    ],
    attributes: {
      operation: input.operation,
      changeId: input.lease.changeId,
      goalId: input.lease.goalId,
      decisionState: input.record.transaction.state,
      assurancePassed: input.capsule.assurances.filter((assurance) => assurance.status === 'passed')
        .length,
      assuranceTotal: input.capsule.assurances.length,
    },
  });
  return payload;
}

async function loadChange(workspacePath: string, changeId: string) {
  const lease = await requireLease(workspacePath, changeId);
  const record = await readDecisionTransaction(workspacePath, changeId);
  return { lease, record };
}

export async function beginProofCarryingChange(input: {
  workspacePath: string;
  goalId?: string;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<ChangeOperationResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const inspected = await inspectGoalLifecycle({
    workspacePath,
    goalId: input.goalId,
    validateBindings: true,
  });
  const goal = inspected.goalPack;
  if (!goal || !inspected.active) {
    throw new Error('No active Goal Pack is available, or the named Goal is not active.');
  }
  if (goal.state !== 'ready-to-plan') {
    throw new Error(`Goal ${goal.id} cannot begin a change while its state is ${goal.state}.`);
  }
  const snapshot = await currentSnapshot(workspacePath);
  const generation = snapshotGeneration(snapshot);
  if (
    generation.modelHash !== goal.sourceBinding.model.hash ||
    (goal.sourceBinding.graph.inputHash
      ? generation.inputHash !== goal.sourceBinding.graph.inputHash
      : generation.graphHash !== goal.sourceBinding.graph.hash)
  ) {
    throw new Error(`Goal ${goal.id} is no longer bound to the current architecture generation.`);
  }
  const changeId = `change-${goal.intent.category}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const paths = pathsFor(changeId);
  const generatedAt = new Date().toISOString();
  const baselineGraphDigest = hashCanonicalJson(snapshot.graph);
  const lease: ArchitectureChangeLease = {
    schemaVersion: ARCHITECTURE_CHANGE_LEASE_SCHEMA_VERSION,
    changeId,
    goalId: goal.id,
    createdAt: generatedAt,
    workspace: goal.workspace,
    scope: {
      kind: goal.scope.kind,
      projects: [...goal.scope.projects],
    },
    baseline: {
      model: reference({
        role: 'baseline-model',
        artifact: goal.sourceBinding.model.artifact,
        schemaVersion: goal.sourceBinding.model.schemaVersion,
        value: goal.sourceBinding.model.hash,
        semantics: 'workspace-model-structural-v1',
      }),
      graph: {
        ...reference({
          role: 'baseline-graph',
          artifact: goal.sourceBinding.graph.artifact,
          schemaVersion: goal.sourceBinding.graph.schemaVersion,
          // A Goal remains usable across a metadata-only Graph refresh when
          // the live input fingerprint is unchanged. In that case the lease
          // must pin the current materialization, not the older canonical JSON
          // digest retained by the immutable Goal Pack.
          value: generation.graphHash,
        }),
        inputHash: generation.inputHash,
      },
    },
    generation: generation.generation,
    semantics: 'optimistic-generation-guard',
    privateMaterialization: {
      artifact: paths.privateBaselineGraph,
      role: 'hash-bound-baseline-cache',
      portable: false,
      authoritative: false,
      digest: {
        algorithm: 'sha256',
        semantics: 'canonical-json-v1',
        value: baselineGraphDigest,
      },
    },
  };
  await writeWorkspaceArtifactJsonSet(workspacePath, paths.lease, [
    { relativePath: paths.privateBaselineGraph, payload: snapshot.graph },
    { relativePath: paths.lease, payload: lease },
  ]);
  const actorKind = input.actorKind ?? 'cli';
  const actorId = input.actorId ?? 'workspai-change';
  const goalReference = reference({
    role: 'intent',
    artifact: inspected.active.goalPack,
    schemaVersion: goal.schemaVersion,
    value: hashCanonicalJson(goal),
  });
  const criterionReferences = goal.successCriteria.map((criterion) =>
    reference({
      role: 'success-criterion',
      artifact: criterion.id,
      schemaVersion: 'workspai.goal-success-criterion.v1',
      value: hashCanonicalJson(criterion),
    })
  );
  let record = await append(
    workspacePath,
    null,
    changeId,
    event(
      'created',
      {
        summary: `Begin proof-carrying change for ${goal.id}.`,
        references: [goalReference, ...criterionReferences],
      },
      actorKind,
      actorId,
      generatedAt
    )
  );
  record = await append(
    workspacePath,
    record,
    changeId,
    event(
      'scope-bound',
      { summary: 'Bind immutable Goal scope.', scope: lease.scope },
      actorKind,
      actorId
    )
  );
  record = await append(
    workspacePath,
    record,
    changeId,
    event(
      'evidence-attached',
      {
        summary: 'Attach exact architecture generation and lease.',
        references: [
          lease.baseline.model,
          {
            role: lease.baseline.graph.role,
            artifact: lease.baseline.graph.artifact,
            schemaVersion: lease.baseline.graph.schemaVersion,
            digest: lease.baseline.graph.digest,
          },
          reference({
            role: 'architecture-lease',
            artifact: paths.lease,
            schemaVersion: lease.schemaVersion,
            value: hashCanonicalJson(lease),
          }),
        ],
      },
      actorKind,
      actorId
    )
  );
  await linkGoalChangeTransaction({
    workspacePath,
    goalId: goal.id,
    changeId,
  });
  const capsule = await publishCapsule(workspacePath, lease, record);
  return result({
    operation: 'begin',
    lease,
    record,
    capsule,
    nextActions: [
      `workspai change predict --change ${changeId} --file <prediction.json> --json`,
      `workspai change authorize --change ${changeId} --effects filesystem,command --json`,
    ],
  });
}

export async function recordProofCarryingChangePrediction(input: {
  workspacePath: string;
  changeId: string;
  prediction: PredictedArchitectureChange;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<ChangeOperationResult> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  await assertLeaseStillCurrent(input.workspacePath, lease);
  if (initial.transaction.state !== 'evidence-ready') {
    throw new Error(
      `Prediction requires evidence-ready state, observed ${initial.transaction.state}.`
    );
  }
  const prediction: PredictedArchitectureChange = {
    ...input.prediction,
    schemaVersion: PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION,
    changeId: input.changeId,
    goalId: lease.goalId,
    baselineGeneration: lease.generation,
    nonCanonical: true,
    proofEligible: false,
    operations: [...input.prediction.operations].sort((left, right) =>
      operationKey(left.operation, left.targetKind, left.targetId).localeCompare(
        operationKey(right.operation, right.targetKind, right.targetId)
      )
    ),
  };
  await writeWorkspaceArtifactJson(
    input.workspacePath,
    pathsFor(input.changeId).prediction,
    prediction
  );
  const predictionReference = reference({
    role: 'noncanonical-prediction',
    artifact: pathsFor(input.changeId).prediction,
    schemaVersion: prediction.schemaVersion,
    value: hashCanonicalJson(prediction),
  });
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event(
      'plan-attached',
      {
        summary: 'Attach an explicitly noncanonical architecture prediction.',
        references: [predictionReference],
      },
      input.actorKind ?? 'agent',
      input.actorId ?? 'workspai-agent'
    )
  );
  const capsule = await publishCapsule(input.workspacePath, lease, record);
  return result({
    operation: 'predict',
    lease,
    record,
    capsule,
    nextActions: [
      `workspai change authorize --change ${input.changeId} --effects filesystem,command --json`,
    ],
  });
}

/**
 * Bind a typed, portable execution plan to an evidence-ready PCC transaction.
 *
 * Domain integrations use this boundary instead of treating a broad effect
 * authorization as permission to execute an unrecorded plan. The payload is
 * persisted under the immutable change namespace and its canonical digest is
 * appended to the decision event chain before a human can authorize effects.
 */
export async function attachProofCarryingChangePlan(input: {
  workspacePath: string;
  changeId: string;
  role: string;
  schemaVersion: string;
  contractPath: string;
  payload: unknown;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<{
  changeId: string;
  state: string;
  artifact: string;
  digest: string;
}> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  await assertLeaseStillCurrent(input.workspacePath, lease);
  if (initial.transaction.state !== 'evidence-ready') {
    throw new Error(
      `Plan attachment requires evidence-ready state, observed ${initial.transaction.state}.`
    );
  }
  const role = input.role.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(role)) {
    throw new Error(`Invalid proof-carrying plan role: ${input.role}`);
  }
  if (!input.schemaVersion.trim()) throw new Error('Plan schema version is required.');
  const contractPath = input.contractPath.replace(/\\/g, '/');
  if (
    !contractPath.startsWith('contracts/') ||
    contractPath.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new Error(
      `Plan contract path must resolve inside the published contract root: ${input.contractPath}`
    );
  }
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    (input.payload as { schemaVersion?: unknown }).schemaVersion !== input.schemaVersion
  ) {
    throw new Error('Plan payload schema version does not match its PCC reference.');
  }
  assertJsonSchemaContract(input.payload, contractPath, `${role} plan`);
  const digest = hashCanonicalJson(input.payload);
  const artifact = `${pathsFor(input.changeId).directory}/plans/${role}-${digest}.json`;
  await writeWorkspaceArtifactJson(input.workspacePath, artifact, input.payload);
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event(
      'plan-attached',
      {
        summary: `Attach ${role} execution plan.`,
        references: [
          reference({
            role,
            artifact,
            schemaVersion: input.schemaVersion,
            value: digest,
          }),
        ],
      },
      input.actorKind ?? 'cli',
      input.actorId ?? 'workspai-plan'
    )
  );
  await publishCapsule(input.workspacePath, lease, record);
  return { changeId: input.changeId, state: record.transaction.state, artifact, digest };
}

export async function authorizeProofCarryingChange(input: {
  workspacePath: string;
  changeId: string;
  effectClasses: DecisionEffectReceipt['effectClass'][];
  grantedBy: string;
  actorKind?: Parameters<typeof actor>[0];
}): Promise<ChangeOperationResult> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  await assertLeaseStillCurrent(input.workspacePath, lease);
  if (input.effectClasses.length === 0)
    throw new Error('Authorization requires at least one effect class.');
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event(
      'authorized',
      {
        summary: `Authorize bounded effect classes: ${input.effectClasses.join(', ')}.`,
        authorization: {
          grantedBy: input.grantedBy,
          grant: 'bounded-effects',
          effectClasses: [...new Set(input.effectClasses)].sort(),
        },
      },
      input.actorKind ?? 'human',
      input.grantedBy
    )
  );
  const capsule = await publishCapsule(input.workspacePath, lease, record);
  return result({
    operation: 'authorize',
    lease,
    record,
    capsule,
    nextActions: [
      `workspai change effect record --change ${input.changeId} --file <effect-receipt.json> --json`,
      `workspai change verify --change ${input.changeId} --json`,
    ],
  });
}

export async function resumeProofCarryingChange(input: {
  workspacePath: string;
  changeId: string;
  resumeTo: 'authorized' | 'executing' | 'verifying';
  reason: string;
  actorId: string;
}): Promise<ChangeOperationResult> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  if (initial.transaction.state !== 'blocked' && initial.transaction.state !== 'awaiting-human') {
    throw new Error(
      `Resume requires blocked or awaiting-human state, observed ${initial.transaction.state}.`
    );
  }
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event(
      'resumed',
      { summary: input.reason, reason: input.reason, resumeTo: input.resumeTo },
      'human',
      input.actorId
    )
  );
  const capsule = await publishCapsule(input.workspacePath, lease, record);
  return result({
    operation: 'resume',
    lease,
    record,
    capsule,
    nextActions:
      input.resumeTo === 'verifying'
        ? [
            `workspai change verification record --change ${input.changeId} --file <verification-receipt.json> --json`,
          ]
        : [
            `workspai change effect record --change ${input.changeId} --file <effect-receipt.json> --json`,
          ],
  });
}

export async function recordProofCarryingChangeEffect(input: {
  workspacePath: string;
  changeId: string;
  receipt: DecisionEffectReceipt;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<ChangeOperationResult> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  const liveArtifacts = new Set(
    input.receipt.artifacts.map((artifact) => normalizedArtifactIdentity(artifact.artifact))
  );
  const deletedArtifacts = (input.receipt.deletedArtifacts ?? []).map((artifact) =>
    normalizedArtifactIdentity(artifact.artifact)
  );
  if (new Set(deletedArtifacts).size !== deletedArtifacts.length) {
    throw new Error('Effect receipt contains duplicate deleted-artifact identities.');
  }
  if (deletedArtifacts.some((artifact) => liveArtifacts.has(artifact))) {
    throw new Error('An effect artifact cannot be both present and deleted in one receipt.');
  }
  if (deletedArtifacts.length > 0 && input.receipt.status !== 'succeeded') {
    throw new Error('Only a succeeded effect may carry deleted-artifact tombstones.');
  }
  for (const artifact of input.receipt.artifacts) {
    if (!(await artifactDigestMatches(input.workspacePath, artifact))) {
      throw new Error(`Effect artifact is missing or corrupt: ${artifact.artifact}`);
    }
  }
  for (const deletedArtifact of input.receipt.deletedArtifacts ?? []) {
    if (!(await deletedArtifactReferenceMatches(input.workspacePath, deletedArtifact))) {
      throw new Error(
        `Deleted effect artifact is present, outside the governed scope, or has an invalid tombstone: ${deletedArtifact.artifact}`
      );
    }
  }
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event(
      'effect-recorded',
      { summary: input.receipt.summary, effect: input.receipt },
      input.actorKind ?? 'agent',
      input.actorId ?? 'workspai-agent'
    )
  );
  const capsule = await publishCapsule(input.workspacePath, lease, record);
  return result({
    operation: 'effect-record',
    lease,
    record,
    capsule,
    nextActions:
      record.transaction.state === 'blocked'
        ? [`workspai change status --change ${input.changeId} --json`]
        : [`workspai change verify --change ${input.changeId} --json`],
  });
}

export async function recordProofCarryingChangeVerification(input: {
  workspacePath: string;
  changeId: string;
  receipt: DecisionVerificationReceipt;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<ChangeOperationResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const { lease, record: initial } = await loadChange(workspacePath, input.changeId);
  if (!initial.transaction.requiredCriteria.includes(input.receipt.criterionId)) {
    throw new Error(
      `Verification criterion '${input.receipt.criterionId}' is outside the immutable Goal contract.`
    );
  }
  const snapshot = await currentSnapshot(workspacePath);
  const changePaths = pathsFor(input.changeId);
  const [actualOverlay, surpriseReport] = await Promise.all([
    readJson<WorkspaceKnowledgeGraphChangeOverlay>(workspacePath, changePaths.actualOverlay),
    readJson<ArchitectureSurpriseReport>(workspacePath, changePaths.surprises),
  ]);
  const hasWorkspaceVerification = initial.transaction.verifications.some(
    (receipt) => receipt.criterionId === 'workspace-verify' && receipt.status === 'passed'
  );
  if (!actualOverlay || !surpriseReport || !hasWorkspaceVerification) {
    throw new Error(
      'Domain verification can be admitted only after change verify re-observes the Graph and records a passing Workspace Verify receipt.'
    );
  }
  const current = snapshotGeneration(snapshot);
  const effectHeadDigest = currentDecisionEffectHeadDigest(initial.transaction, kernelPorts);
  if (
    input.receipt.target.modelHash !== current.modelHash ||
    input.receipt.target.graphHash !== current.graphHash ||
    input.receipt.target.effectHeadDigest !== effectHeadDigest
  ) {
    throw new Error(
      'Verification receipt does not target the current Model, Graph, and effect head.'
    );
  }
  for (const artifact of input.receipt.artifacts) {
    if (!(await artifactDigestMatches(workspacePath, artifact))) {
      throw new Error(`Verification artifact is missing or corrupt: ${artifact.artifact}`);
    }
  }
  const actorKind = input.actorKind ?? 'ci';
  const actorId = input.actorId ?? 'workspai-verifier';
  let record = initial;
  if (record.transaction.state === 'blocked') {
    const resumable = record.transaction.blockers.every(
      (blocker) => blocker.code === 'change.verification.criteria_missing'
    );
    if (!resumable) {
      throw new Error(
        'The change is blocked by a condition that a verification receipt cannot resume.'
      );
    }
    record = await append(
      workspacePath,
      record,
      input.changeId,
      event(
        'resumed',
        { summary: 'Resume to admit a missing verification receipt.', resumeTo: 'verifying' },
        actorKind,
        actorId
      )
    );
  } else if (record.transaction.state !== 'verifying') {
    throw new Error(
      `Verification receipt requires verifying or criteria-blocked state; observed ${record.transaction.state}.`
    );
  }
  record = await append(
    workspacePath,
    record,
    input.changeId,
    event(
      'verification-recorded',
      { summary: input.receipt.summary, verification: input.receipt },
      actorKind,
      actorId
    )
  );
  if (record.transaction.state === 'verifying') {
    const satisfied = record.transaction.requiredCriteria.every((criterionId) => {
      const receipts = record.transaction.verifications.filter(
        (receipt) => receipt.criterionId === criterionId
      );
      return receipts.at(-1)?.status === 'passed';
    });
    if (satisfied) {
      record = await append(
        workspacePath,
        record,
        input.changeId,
        event(
          'committed',
          { summary: 'Seal the independently verified proof-carrying change.' },
          actorKind,
          actorId
        )
      );
    }
  }
  const capsule = await publishCapsule(workspacePath, lease, record);
  return result({
    operation: 'verification-record',
    lease,
    record,
    capsule,
    nextActions:
      record.transaction.state === 'committed'
        ? [`workspai change capsule validate --change ${input.changeId} --json`]
        : [`workspai change status --change ${input.changeId} --json`],
  });
}

function verificationArtifactReference(
  artifact: string,
  schemaVersion: string,
  payload: unknown,
  role = 'verification'
): DecisionArtifactReference {
  return reference({ role, artifact, schemaVersion, value: hashCanonicalJson(payload) });
}

function actualChanged(overlay: WorkspaceKnowledgeGraphChangeOverlay): boolean {
  return (
    overlay.summary.entityAdds +
      overlay.summary.entityRemovals +
      overlay.summary.entityChanges +
      overlay.summary.relationAdds +
      overlay.summary.relationRemovals +
      overlay.summary.relationChanges +
      overlay.summary.proofAdds +
      overlay.summary.proofRemovals +
      overlay.summary.proofChanges >
    0
  );
}

function normalizedArtifactIdentity(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function filesystemArtifactIdentity(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Match Graph artifact identities to observed effects by both portable label
 * and canonical filesystem target. Overlapping adopted project scopes may
 * project one physical file under multiple Graph labels; they must not require
 * duplicate effect receipts for the same mutation.
 */
export async function findUncoveredEffectArtifacts(input: {
  workspacePath: string;
  changedArtifacts: string[];
  receiptedArtifacts: string[];
}): Promise<string[]> {
  const receiptedIdentities = new Set(input.receiptedArtifacts.map(normalizedArtifactIdentity));
  const receiptedFilesystemIdentities = new Set<string>();
  for (const artifact of receiptedIdentities) {
    const candidate = await resolvePortableWorkspaceEvidenceCandidatePath(
      input.workspacePath,
      artifact
    );
    if (candidate) receiptedFilesystemIdentities.add(filesystemArtifactIdentity(candidate));
  }

  const uncovered: string[] = [];
  for (const artifact of input.changedArtifacts) {
    const identity = normalizedArtifactIdentity(artifact);
    if (receiptedIdentities.has(identity)) continue;
    const candidate = await resolvePortableWorkspaceEvidenceCandidatePath(
      input.workspacePath,
      identity
    );
    if (candidate && receiptedFilesystemIdentities.has(filesystemArtifactIdentity(candidate))) {
      continue;
    }
    uncovered.push(artifact);
  }
  return uncovered;
}

export async function verifyProofCarryingChange(input: {
  workspacePath: string;
  changeId: string;
  strict?: boolean;
  refresh?: boolean;
  actorKind?: Parameters<typeof actor>[0];
  actorId?: string;
}): Promise<ChangeOperationResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const { lease, record: initial } = await loadChange(workspacePath, input.changeId);
  if (initial.transaction.state !== 'authorized' && initial.transaction.state !== 'executing') {
    throw new Error(
      `Verification requires authorized or executing state, observed ${initial.transaction.state}.`
    );
  }
  if (input.refresh !== false) {
    await runWorkspaceIntelligenceChain({ workspacePath, strict: false, agent: 'generic' });
  }
  const snapshot = await currentSnapshot(workspacePath);
  const baseline = await readJson<WorkspaceKnowledgeGraph>(
    workspacePath,
    lease.privateMaterialization.artifact
  );
  if (!baseline || hashCanonicalJson(baseline) !== lease.privateMaterialization.digest.value) {
    throw new Error(
      `The hash-bound baseline materialization is missing or corrupt for ${input.changeId}.`
    );
  }
  const generatedAt = new Date().toISOString();
  const overlay = buildWorkspaceKnowledgeGraphChangeOverlay(
    baseline,
    snapshot.graph,
    new Date(generatedAt)
  );
  const paths = pathsFor(input.changeId);
  await writeWorkspaceArtifactJson(workspacePath, paths.actualOverlay, overlay);
  const actualReference = verificationArtifactReference(
    paths.actualOverlay,
    overlay.schemaVersion,
    overlay,
    'actual-architecture-overlay'
  );
  const prediction = await readJson<PredictedArchitectureChange>(workspacePath, paths.prediction);
  const predictionReference = prediction
    ? verificationArtifactReference(
        paths.prediction,
        prediction.schemaVersion,
        prediction,
        'noncanonical-prediction'
      )
    : null;
  const surprises = buildSurpriseReport({
    changeId: input.changeId,
    generatedAt,
    prediction,
    predictionReference,
    actual: overlay,
    actualReference,
  });
  await writeWorkspaceArtifactJson(workspacePath, paths.surprises, surprises);
  const surpriseReference = verificationArtifactReference(
    paths.surprises,
    surprises.schemaVersion,
    surprises,
    'architecture-surprises'
  );
  let record = initial;
  const actorKind = input.actorKind ?? 'cli';
  const actorId = input.actorId ?? 'workspai-change-verify';
  if (actualChanged(overlay) && record.transaction.effects.length === 0) {
    record = await append(
      workspacePath,
      record,
      input.changeId,
      event(
        'blocked',
        {
          summary: 'Observed architecture change has no typed effect receipt.',
          blocker: {
            code: 'change.effect_receipt.missing',
            actionable: true,
            details: 'Record the actual mutation effect before verification can claim causality.',
          },
        },
        actorKind,
        actorId
      )
    );
    const capsule = await publishCapsule(workspacePath, lease, record);
    return result({
      operation: 'verify',
      lease,
      record,
      capsule,
      nextActions: [
        `workspai change resume --change ${input.changeId} --to authorized --reason "Record missing effect receipt" --json`,
      ],
    });
  }
  const receiptedArtifacts = record.transaction.effects
    .filter((effect) => effect.status === 'succeeded')
    .flatMap((effect) => [
      ...effect.artifacts.map((artifact) => artifact.artifact),
      ...(effect.deletedArtifacts ?? []).map((artifact) => artifact.artifact),
    ]);
  const uncoveredArtifacts = await findUncoveredEffectArtifacts({
    workspacePath,
    changedArtifacts: overlay.changedArtifacts,
    receiptedArtifacts,
  });
  if (uncoveredArtifacts.length > 0) {
    record = await append(
      workspacePath,
      record,
      input.changeId,
      event(
        'blocked',
        {
          summary: 'Observed architecture artifacts are not covered by typed effect receipts.',
          blocker: {
            code: 'change.effect_receipt.coverage_missing',
            actionable: true,
            details: `Uncovered artifacts: ${uncoveredArtifacts.slice(0, 20).join(', ')}`,
          },
        },
        actorKind,
        actorId
      )
    );
    const capsule = await publishCapsule(workspacePath, lease, record);
    return result({
      operation: 'verify',
      lease,
      record,
      capsule,
      nextActions: [
        `workspai change resume --change ${input.changeId} --to authorized --reason "Cover observed artifacts" --json`,
      ],
    });
  }
  record = await append(
    workspacePath,
    record,
    input.changeId,
    event(
      'verification-started',
      { summary: 'Begin independent post-effect verification.' },
      actorKind,
      actorId
    )
  );
  const verify = await buildWorkspaceVerify({ workspacePath });
  const verifyPath = await writeWorkspaceVerify(verify, workspacePath);
  const relativeVerifyPath = path.relative(workspacePath, verifyPath).split(path.sep).join('/');
  const persistedVerify = await readJson<typeof verify>(workspacePath, relativeVerifyPath);
  if (!persistedVerify) {
    throw new Error(`Workspace Verify evidence was not persisted at ${relativeVerifyPath}.`);
  }
  // Artifact writers attach the active CLI run correlation at persistence time.
  // Bind the receipt to those exact bytes, not the pre-write in-memory value,
  // otherwise a freshly sealed CLI capsule fails its own integrity replay.
  const gate = evaluateWorkspaceVerifyGate(persistedVerify, { strict: input.strict === true });
  const current = snapshotGeneration(snapshot);
  const workspaceReceipt: DecisionVerificationReceipt = {
    id: `verify-workspace-${hashCanonicalJson({ generatedAt, verify: persistedVerify, gate }).slice(0, 16)}`,
    criterionId: 'workspace-verify',
    status: gate.passed ? 'passed' : 'failed',
    summary: gate.passed
      ? `Workspace Verify passed in ${gate.mode} mode.`
      : `Workspace Verify blocked in ${gate.mode} mode: ${gate.reasons.join('; ')}`,
    target: {
      modelHash: current.modelHash,
      graphHash: current.graphHash,
      effectHeadDigest: currentDecisionEffectHeadDigest(record.transaction, kernelPorts),
    },
    artifacts: [
      verificationArtifactReference(
        relativeVerifyPath,
        persistedVerify.schemaVersion,
        persistedVerify
      ),
      actualReference,
      surpriseReference,
    ],
    observedAt: generatedAt,
  };
  record = await append(
    workspacePath,
    record,
    input.changeId,
    event(
      'verification-recorded',
      { summary: workspaceReceipt.summary, verification: workspaceReceipt },
      actorKind,
      actorId
    )
  );
  if (record.transaction.state === 'verifying') {
    const missingCriteria = record.transaction.requiredCriteria.filter((criterionId) => {
      const receipts = record.transaction.verifications.filter(
        (receipt) => receipt.criterionId === criterionId
      );
      return receipts.at(-1)?.status !== 'passed';
    });
    if (missingCriteria.length > 0) {
      record = await append(
        workspacePath,
        record,
        input.changeId,
        event(
          'blocked',
          {
            summary: 'Required outcome verification is incomplete.',
            blocker: {
              code: 'change.verification.criteria_missing',
              actionable: true,
              details: `Missing passing receipts: ${missingCriteria.join(', ')}`,
            },
          },
          actorKind,
          actorId
        )
      );
    } else {
      record = await append(
        workspacePath,
        record,
        input.changeId,
        event(
          'committed',
          { summary: 'Seal the independently verified proof-carrying change.' },
          actorKind,
          actorId
        )
      );
    }
  }
  const capsule = await publishCapsule(workspacePath, lease, record);
  return result({
    operation: 'verify',
    lease,
    record,
    capsule,
    nextActions:
      record.transaction.state === 'committed'
        ? [`workspai change capsule validate --change ${input.changeId} --json`]
        : [`workspai change status --change ${input.changeId} --json`],
  });
}

export async function inspectProofCarryingChange(input: {
  workspacePath: string;
  changeId: string;
  operation?: 'status' | 'explain';
}): Promise<ChangeOperationResult> {
  const { lease, record } = await loadChange(input.workspacePath, input.changeId);
  const capsule = await buildCapsule({ workspacePath: input.workspacePath, lease, record });
  return result({
    operation: input.operation ?? 'status',
    lease,
    record,
    capsule,
    nextActions:
      record.transaction.state === 'evidence-ready'
        ? [
            `workspai change authorize --change ${input.changeId} --effects filesystem,command --json`,
          ]
        : record.transaction.state === 'authorized' || record.transaction.state === 'executing'
          ? [`workspai change verify --change ${input.changeId} --json`]
          : [],
  });
}

export async function listProofCarryingChanges(input: {
  workspacePath: string;
}): Promise<ProofCarryingChangeList> {
  const workspacePath = path.resolve(input.workspacePath);
  const changesRoot = await resolveContainedWorkspaceArtifactPath(
    workspacePath,
    '.workspai/changes',
    'directory'
  );
  const directoryEntries = changesRoot
    ? await fsExtra.readdir(changesRoot, { withFileTypes: true })
    : [];
  const changeIds = directoryEntries
    .filter((entry) => entry.isDirectory() && /^change-[a-z0-9][a-z0-9-]{7,95}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const entries: ProofCarryingChangeListEntry[] = [];
  let discoveredWorkspaceName: string | null = null;
  for (const changeId of changeIds) {
    try {
      const { lease, record } = await loadChange(workspacePath, changeId);
      discoveredWorkspaceName ??= lease.workspace.name;
      const capsule = await buildCapsule({ workspacePath, lease, record });
      const validation = await validateProofCarryingChangeCapsule({ workspacePath, changeId });
      const transactionBlockers = record.transaction.blockers.map(
        (blocker) => blocker.details ?? blocker.code
      );
      const assuranceBlockers =
        capsule.status === 'blocked'
          ? capsule.assurances
              .filter((assurance) => assurance.status === 'failed')
              .map((assurance) => `${assurance.id}: ${assurance.summary}`)
          : [];
      entries.push({
        changeId,
        goalId: lease.goalId,
        state: record.transaction.state,
        status: capsule.status,
        createdAt: record.transaction.createdAt,
        updatedAt: record.transaction.updatedAt,
        scope: lease.scope,
        assurance: {
          passed: capsule.assurances.filter((assurance) => assurance.status === 'passed').length,
          total: capsule.assurances.length,
        },
        blockers: [...new Set([...transactionBlockers, ...assuranceBlockers])],
        capsuleArtifact: pathsFor(changeId).capsule,
        valid: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      entries.push({
        changeId,
        goalId: null,
        state: null,
        status: 'invalid',
        createdAt: null,
        updatedAt: null,
        scope: null,
        assurance: { passed: 0, total: 5 },
        blockers: [],
        capsuleArtifact: pathsFor(changeId).capsule,
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  entries.sort((left, right) => {
    const byUpdated = (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
    return byUpdated || left.changeId.localeCompare(right.changeId);
  });
  const payload: ProofCarryingChangeList = {
    schemaVersion: PROOF_CARRYING_CHANGE_LIST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workspace: {
      name: discoveredWorkspaceName ?? (await workspaceIdentityName(workspacePath)),
    },
    changes: entries,
    summary: {
      total: entries.length,
      open: entries.filter((entry) => entry.status === 'open' || entry.status === 'verified')
        .length,
      blocked: entries.filter((entry) => entry.status === 'blocked').length,
      sealed: entries.filter((entry) => entry.status === 'sealed').length,
      aborted: entries.filter((entry) => entry.status === 'aborted').length,
      invalid: entries.filter((entry) => !entry.valid).length,
    },
  };
  assertJsonSchemaContract(
    payload,
    'contracts/workspace-intelligence/proof-carrying-change-list.v1.json',
    'Proof-Carrying Change list'
  );
  return payload;
}

export async function abortProofCarryingChange(input: {
  workspacePath: string;
  changeId: string;
  reason: string;
  actorId: string;
}): Promise<ChangeOperationResult> {
  const { lease, record: initial } = await loadChange(input.workspacePath, input.changeId);
  const record = await append(
    input.workspacePath,
    initial,
    input.changeId,
    event('aborted', { summary: input.reason, reason: input.reason }, 'human', input.actorId)
  );
  const capsule = await publishCapsule(input.workspacePath, lease, record);
  return result({ operation: 'abort', lease, record, capsule, nextActions: [] });
}

export type CapsuleValidation = ProofCarryingChangeCapsuleValidation;

export async function validateProofCarryingChangeCapsule(input: {
  workspacePath: string;
  changeId: string;
}): Promise<CapsuleValidation> {
  const paths = pathsFor(input.changeId);
  const capsule = await readJson<ProofCarryingChangeCapsule>(input.workspacePath, paths.capsule);
  if (!capsule) throw new Error(`Proof-carrying change capsule not found: ${input.changeId}`);
  const errors: string[] = [];
  if (capsule.schemaVersion !== PROOF_CARRYING_CHANGE_CAPSULE_SCHEMA_VERSION) {
    errors.push(`Unsupported capsule schema: ${capsule.schemaVersion}`);
  }
  if (capsule.changeId !== input.changeId) errors.push('Capsule change binding does not match.');
  if (hashCanonicalJson(capsuleWithoutIntegrity(capsule)) !== capsule.integrity.capsuleDigest) {
    errors.push('Capsule integrity digest does not match its canonical content.');
  }
  const { lease, record } = await loadChange(input.workspacePath, input.changeId);
  const leaseEvidence = record.transaction.evidence.find(
    (item) => item.role === 'architecture-lease'
  );
  if (!leaseEvidence || leaseEvidence.digest.value !== hashCanonicalJson(lease)) {
    errors.push('Architecture lease does not match the decision-ledger evidence binding.');
  }
  if (
    lease.goalId !== capsule.goalId ||
    lease.generation !==
      hashCanonicalJson({
        modelHash: lease.baseline.model.digest.value,
        graphHash: lease.baseline.graph.digest.value,
        inputHash: lease.baseline.graph.inputHash,
      })
  ) {
    errors.push('Architecture lease identity or generation binding is invalid.');
  }
  if (record.transaction.eventHeadDigest !== capsule.decision.eventHeadDigest) {
    errors.push('Capsule does not bind the current decision event head.');
  }
  if (hashCanonicalJson(record.transaction) !== capsule.decision.transaction.digest.value) {
    errors.push('Decision transaction projection digest does not match the capsule.');
  }
  const baseline = await readJson<WorkspaceKnowledgeGraph>(
    input.workspacePath,
    lease.privateMaterialization.artifact
  );
  if (!baseline || hashCanonicalJson(baseline) !== lease.privateMaterialization.digest.value) {
    errors.push('Hash-bound baseline materialization is missing or corrupt.');
  }
  for (const artifact of [
    capsule.intent,
    capsule.decision.transaction,
    capsule.prediction,
    capsule.actualOverlay,
    capsule.surpriseReport,
    ...capsule.effects,
    ...capsule.verification,
  ].filter((value): value is DecisionArtifactReference => Boolean(value))) {
    if (!(await artifactDigestMatches(input.workspacePath, artifact))) {
      errors.push(`Referenced artifact is missing or corrupt: ${artifact.artifact}`);
    }
  }
  for (const deletedArtifact of capsule.deletedArtifacts ?? []) {
    if (!(await deletedArtifactReferenceMatches(input.workspacePath, deletedArtifact))) {
      errors.push(
        `Deleted artifact tombstone is invalid or the artifact exists again: ${deletedArtifact.artifact}`
      );
    }
  }
  const validation: CapsuleValidation = {
    schemaVersion: PROOF_CARRYING_CHANGE_CAPSULE_VALIDATION_SCHEMA_VERSION,
    changeId: input.changeId,
    validatedAt: new Date().toISOString(),
    valid: errors.length === 0,
    errors,
    capsule,
  };
  assertJsonSchemaContract(
    validation,
    'contracts/workspace-intelligence/proof-carrying-change-capsule-validation.v1.json',
    'Proof-Carrying Change capsule validation'
  );
  return validation;
}

export async function exportProofCarryingChangeCapsule(input: {
  workspacePath: string;
  changeId: string;
  outputPath: string;
}): Promise<ProofCarryingChangeCapsuleExport> {
  const validation = await validateProofCarryingChangeCapsule(input);
  if (!validation.valid) {
    throw new Error(`Cannot export an invalid capsule: ${validation.errors.join('; ')}`);
  }
  const workspacePath = path.resolve(input.workspacePath);
  const outputPath = path.resolve(workspacePath, input.outputPath);
  const relative = path.relative(workspacePath, outputPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Capsule export path must remain inside the workspace.');
  }
  const relativeArtifact = relative.split(path.sep).join('/');
  const writtenPath = await writeWorkspaceArtifactJson(
    workspacePath,
    relativeArtifact,
    validation.capsule
  );
  const exported: ProofCarryingChangeCapsuleExport = {
    schemaVersion: PROOF_CARRYING_CHANGE_CAPSULE_EXPORT_SCHEMA_VERSION,
    changeId: input.changeId,
    outputPath: writtenPath,
    validation,
  };
  assertJsonSchemaContract(
    exported,
    'contracts/workspace-intelligence/proof-carrying-change-capsule-export.v1.json',
    'Proof-Carrying Change capsule export'
  );
  return exported;
}

export function validatePredictedArchitectureChangeInput(
  value: unknown
): PredictedArchitectureChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Prediction input must be a JSON object.');
  }
  const candidate = value as Partial<PredictedArchitectureChange>;
  if (!Array.isArray(candidate.operations) || !Array.isArray(candidate.assumptions)) {
    throw new Error('Prediction input requires operations[] and assumptions[].');
  }
  const allowedOperations = new Set(['add', 'remove', 'change']);
  const allowedKinds = new Set(['entity', 'relation', 'proof', 'artifact']);
  const allowedConfidence = new Set(['high', 'medium', 'low']);
  for (const operation of candidate.operations) {
    if (
      !operation ||
      !allowedOperations.has(operation.operation) ||
      !allowedKinds.has(operation.targetKind) ||
      typeof operation.targetId !== 'string' ||
      operation.targetId.trim().length === 0 ||
      typeof operation.rationale !== 'string' ||
      !allowedConfidence.has(operation.confidence)
    ) {
      throw new Error('Prediction contains an invalid operation.');
    }
  }
  const risk = candidate.predictedRisk;
  if (!risk || !['none', 'low', 'medium', 'high'].includes(risk)) {
    throw new Error('Prediction requires predictedRisk: none, low, medium, or high.');
  }
  return {
    schemaVersion: PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION,
    changeId: candidate.changeId ?? 'change-placeholder',
    goalId: candidate.goalId ?? 'goal-placeholder',
    generatedAt: candidate.generatedAt ?? new Date().toISOString(),
    baselineGeneration: candidate.baselineGeneration ?? 'pending-binding',
    nonCanonical: true,
    proofEligible: false,
    operations: candidate.operations,
    assumptions: candidate.assumptions.filter((item): item is string => typeof item === 'string'),
    predictedRisk: risk,
  };
}

export function validateEffectReceiptInput(value: unknown): DecisionEffectReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Effect receipt input must be a JSON object.');
  }
  const candidate = value as Partial<DecisionEffectReceipt>;
  if (
    typeof candidate.id !== 'string' ||
    !['filesystem', 'command', 'configuration', 'dependency', 'external'].includes(
      String(candidate.effectClass)
    ) ||
    !['succeeded', 'failed', 'uncertain'].includes(String(candidate.status)) ||
    typeof candidate.summary !== 'string' ||
    typeof candidate.observedAt !== 'string' ||
    typeof candidate.idempotencyKey !== 'string' ||
    !Array.isArray(candidate.artifacts)
  ) {
    throw new Error('Effect receipt is missing required typed fields.');
  }
  if (
    candidate.deletedArtifacts !== undefined &&
    (!Array.isArray(candidate.deletedArtifacts) ||
      candidate.deletedArtifacts.some(
        (artifact) =>
          !artifact ||
          typeof artifact.artifact !== 'string' ||
          (artifact.observedAt !== undefined && typeof artifact.observedAt !== 'string') ||
          (artifact.digest !== undefined &&
            (artifact.digest.algorithm !== 'sha256' ||
              artifact.digest.semantics !== 'deletion-tombstone-v1' ||
              typeof artifact.digest.value !== 'string'))
      ))
  ) {
    throw new Error('Effect receipt contains an invalid deleted-artifact tombstone.');
  }
  const receipt = candidate as DecisionEffectReceipt;
  return {
    ...receipt,
    ...(receipt.deletedArtifacts
      ? {
          deletedArtifacts: receipt.deletedArtifacts.map((artifact) =>
            artifact.digest
              ? artifact
              : createDeletedArtifactReference({
                  artifact: artifact.artifact,
                  observedAt: artifact.observedAt ?? receipt.observedAt,
                })
          ),
        }
      : {}),
  };
}

export function validateVerificationReceiptInput(value: unknown): DecisionVerificationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Verification receipt input must be a JSON object.');
  }
  const candidate = value as Partial<DecisionVerificationReceipt>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.criterionId !== 'string' ||
    !['passed', 'failed', 'inconclusive'].includes(String(candidate.status)) ||
    typeof candidate.summary !== 'string' ||
    typeof candidate.observedAt !== 'string' ||
    !candidate.target ||
    typeof candidate.target.modelHash !== 'string' ||
    typeof candidate.target.graphHash !== 'string' ||
    typeof candidate.target.effectHeadDigest !== 'string' ||
    !Array.isArray(candidate.artifacts)
  ) {
    throw new Error('Verification receipt is missing required typed fields.');
  }
  return candidate as DecisionVerificationReceipt;
}

export function decisionTransactionForCapsule(
  capsule: ProofCarryingChangeCapsule,
  transaction: DecisionTransaction
): boolean {
  return (
    capsule.decision.eventHeadDigest === transaction.eventHeadDigest &&
    capsule.decision.transaction.digest.value === hashCanonicalJson(transaction)
  );
}

export async function assertSealedProofCarryingChangeCurrent(input: {
  workspacePath: string;
  changeId: string;
  goalId: string;
}): Promise<{ modelHash: string; graphHash: string }> {
  const validation = await validateProofCarryingChangeCapsule({
    workspacePath: input.workspacePath,
    changeId: input.changeId,
  });
  if (!validation.valid) {
    throw new Error(`Proof-carrying change ${input.changeId} failed capsule validation.`);
  }
  const { lease, record } = await loadChange(input.workspacePath, input.changeId);
  if (
    lease.goalId !== input.goalId ||
    record.transaction.state !== 'committed' ||
    validation.capsule.status !== 'sealed'
  ) {
    throw new Error(
      `Proof-carrying change ${input.changeId} is not a sealed change for ${input.goalId}.`
    );
  }
  const passing = [...record.transaction.verifications]
    .reverse()
    .find((receipt) => receipt.status === 'passed');
  if (!passing) {
    throw new Error(`Proof-carrying change ${input.changeId} has no passing verification receipt.`);
  }
  return {
    modelHash: passing.target.modelHash,
    graphHash: passing.target.graphHash,
  };
}
