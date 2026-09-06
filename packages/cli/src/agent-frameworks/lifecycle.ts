import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import fsExtra from 'fs-extra';

import {
  AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
  AGENT_FRAMEWORK_CHANGE_PLAN_SCHEMA_VERSION,
  AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_CONTRACT_PATH,
  AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION,
} from '../contracts/agent-framework-contract.js';
import { PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION } from '../contracts/proof-carrying-change-contract.js';
import type { DecisionArtifactReference } from '../decisions/decision-contract.js';
import { readDecisionTransaction } from '../decisions/decision-store.js';
import {
  attachProofCarryingChangePlan,
  recordProofCarryingChangePrediction,
  recordProofCarryingChangeEffect,
} from '../proof-carrying-change.js';
import {
  resolveContainedWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from '../utils/artifact-path-compat.js';
import { withInterprocessLock } from '../utils/interprocess-lock.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import { WORKSPACE_MODEL_REPORT_PATH, type WorkspaceModel } from '../workspace-model.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';
import { workspaceModelProjectRoot } from '../workspace-knowledge-graph-projection.js';
import { BUILTIN_AGENT_FRAMEWORK_ADAPTERS } from './builtins.js';
import {
  normalizedAgentInstanceName,
  type AgentFrameworkAdapter,
  type AgentFrameworkAdapterInput,
  type AgentFrameworkChangePlan,
  type AgentFrameworkProjectMode,
} from './adapter.js';
import type { AgentFrameworkRegistry } from './registry.js';

const PLAN_ROLE = 'agent-framework-change-plan';
const MANAGED_FILE_SCHEMA_VERSION = 'workspai.agent-framework-managed-file.v1';
const MAX_MANAGED_FILE_BYTES = 1024 * 1024;

type AgentFrameworkTarget = {
  workspacePath: string;
  workspaceName: string;
  projectName: string;
  projectRoot: string;
  artifactPrefix: string;
};

export type AgentFrameworkOwnershipReceipt = {
  schemaVersion: typeof AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION;
  generatedAt: string;
  changeId: string;
  adapter: { id: string; version: string; manifestSha256: string };
  framework: { id: string; version: string };
  target: { workspace: string; project: string; artifactPrefix: string; instanceName: string };
  files: Array<{ path: string; sha256: string }>;
};

export type PreparedAgentFrameworkChange = {
  status: AgentFrameworkChangePlan['status'];
  changeId: string;
  project: string;
  plan: AgentFrameworkChangePlan;
  planArtifact: string | null;
  planDigest: string;
};

export type AppliedAgentFrameworkChange = {
  status: 'applied';
  changeId: string;
  project: string;
  adapterId: string;
  instanceName: string;
  files: Array<{ path: string; artifact: string; sha256: string }>;
  ownershipReceipt: string;
};

function portable(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function artifactPath(prefix: string, relativePath: string): string {
  const normalizedPrefix = portable(prefix);
  return normalizedPrefix === '.' || normalizedPrefix === ''
    ? portable(relativePath)
    : `${normalizedPrefix}/${portable(relativePath)}`;
}

function stableSegment(value: string): string {
  const readable =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .slice(0, 48) || 'project';
  const suffix = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${readable}-${suffix}`;
}

function adapterManifestDigest(adapter: AgentFrameworkAdapter): string {
  return createHash('sha256')
    .update(`${JSON.stringify(adapter.manifest)}\n`)
    .digest('hex');
}

function admittedAdapter(input: {
  registry: AgentFrameworkRegistry;
  adapterId: string;
}): AgentFrameworkAdapter {
  const resolution = input.registry.resolveAdapter(input.adapterId);
  if (resolution.status !== 'admitted' || !resolution.entry) {
    const details = resolution.blockers.length > 0 ? ` ${resolution.blockers.join(' ')}` : '';
    throw new Error(`Agent framework adapter is not admitted: ${input.adapterId}.${details}`);
  }
  const adapter = BUILTIN_AGENT_FRAMEWORK_ADAPTERS.find(
    (candidate) => candidate.manifest.adapter.id === resolution.entry?.manifest.adapter.id
  );
  if (!adapter || adapterManifestDigest(adapter) !== resolution.entry.manifestSha256) {
    throw new Error(
      `Admitted adapter implementation does not match its registry manifest: ${input.adapterId}`
    );
  }
  return adapter;
}

function ownershipReceiptPath(input: {
  adapterId: string;
  projectName: string;
  instanceName: string;
}): string {
  return `.workspai/agent-frameworks/ownership/${stableSegment(input.adapterId)}/${stableSegment(input.projectName)}/${normalizedAgentInstanceName(input.instanceName)}.json`;
}

async function resolveTarget(
  workspacePathInput: string,
  projectName: string
): Promise<AgentFrameworkTarget> {
  const workspacePath = path.resolve(workspacePathInput);
  const modelPath = await resolveContainedWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_MODEL_REPORT_PATH
  );
  if (!modelPath) {
    throw new Error(
      'Workspace Model is missing; run Workspace Intelligence before planning an agent framework change.'
    );
  }
  const model = (await fsExtra.readJson(modelPath)) as WorkspaceModel;
  const matches = model.projects.filter(
    (project) => project.name === projectName || portable(project.path) === portable(projectName)
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Project is not present in the canonical Workspace Model: ${projectName}`
        : `Project target is ambiguous in the canonical Workspace Model: ${projectName}`
    );
  }
  const project = matches[0];
  const projectRoot = workspaceModelProjectRoot(workspacePath, project);
  const stat = await fsExtra.stat(projectRoot).catch(() => null);
  if (!stat?.isDirectory())
    throw new Error(`Canonical project root is unavailable: ${project.name}`);
  return {
    workspacePath,
    workspaceName: model.workspace.name,
    projectName: project.name,
    projectRoot,
    artifactPrefix: portable(project.path),
  };
}

async function containedManagedPath(rootInput: string, relativePath: string): Promise<string> {
  const root = path.resolve(rootInput);
  const target = path.resolve(root, relativePath);
  const lexical = path.relative(root, target);
  if (
    !lexical ||
    lexical === '..' ||
    lexical.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lexical)
  ) {
    throw new Error(`Managed path escapes the canonical project root: ${relativePath}`);
  }
  const realRoot = await fsExtra.realpath(root);
  let ancestor = target;
  while (!(await fsExtra.pathExists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve managed path: ${relativePath}`);
    ancestor = parent;
  }
  const realAncestor = await fsExtra.realpath(ancestor);
  const realRelative = path.relative(realRoot, realAncestor);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error(
      `Managed path resolves through a symlink outside the project root: ${relativePath}`
    );
  }
  if (await fsExtra.pathExists(target)) {
    const stat = await fsExtra.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Managed target is not a regular file: ${relativePath}`);
    }
  }
  return target;
}

async function readExistingFiles(
  target: AgentFrameworkTarget,
  adapter: AgentFrameworkAdapter,
  instanceName: string
): Promise<Map<string, string>> {
  const expected = adapter.render({ projectRoot: target.projectRoot, instanceName }).files;
  const existing = new Map<string, string>();
  for (const file of expected) {
    const absolute = await containedManagedPath(target.projectRoot, file.path);
    const stat = await fsExtra.stat(absolute).catch(() => null);
    if (!stat) continue;
    if (stat.size > MAX_MANAGED_FILE_BYTES) {
      throw new Error(
        `Managed file exceeds the ${MAX_MANAGED_FILE_BYTES} byte safety limit: ${file.path}`
      );
    }
    existing.set(file.path, await fsExtra.readFile(absolute, 'utf8'));
  }
  return existing;
}

async function readOwnershipLedger(input: {
  target: AgentFrameworkTarget;
  adapter: AgentFrameworkAdapter;
  instanceName: string;
}): Promise<{ path: string; ledger: Map<string, string> }> {
  const receiptPath = ownershipReceiptPath({
    adapterId: input.adapter.manifest.adapter.id,
    projectName: input.target.projectName,
    instanceName: input.instanceName,
  });
  const absolute = await resolveContainedWorkspaceArtifactPath(
    input.target.workspacePath,
    receiptPath
  );
  if (!absolute) return { path: receiptPath, ledger: new Map() };
  const receipt = (await fsExtra.readJson(absolute)) as Partial<AgentFrameworkOwnershipReceipt>;
  assertJsonSchemaContract(
    receipt,
    AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_CONTRACT_PATH,
    'Agent framework ownership receipt'
  );
  if (
    receipt.schemaVersion !== AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION ||
    receipt.adapter?.id !== input.adapter.manifest.adapter.id ||
    receipt.adapter.version !== input.adapter.manifest.adapter.version ||
    receipt.adapter.manifestSha256 !== adapterManifestDigest(input.adapter) ||
    receipt.framework?.id !== input.adapter.manifest.framework.id ||
    !input.adapter.manifest.framework.testedVersions.includes(receipt.framework.version) ||
    receipt.target?.workspace !== input.target.workspaceName ||
    receipt.target?.project !== input.target.projectName ||
    portable(receipt.target.artifactPrefix) !== input.target.artifactPrefix ||
    receipt.target.instanceName !== normalizedAgentInstanceName(input.instanceName) ||
    !Array.isArray(receipt.files)
  ) {
    throw new Error(`Agent framework ownership receipt is incompatible or corrupt: ${receiptPath}`);
  }
  const ledger = new Map<string, string>();
  for (const file of receipt.files) {
    if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(
        `Agent framework ownership receipt contains an invalid file entry: ${receiptPath}`
      );
    }
    if (ledger.has(file.path))
      throw new Error(`Agent framework ownership receipt contains duplicate paths: ${receiptPath}`);
    ledger.set(file.path, file.sha256);
  }
  return { path: receiptPath, ledger };
}

async function adapterInput(input: {
  target: AgentFrameworkTarget;
  adapter: AgentFrameworkAdapter;
  instanceName: string;
}): Promise<{ input: AgentFrameworkAdapterInput; receiptPath: string }> {
  const [existingFiles, ownership] = await Promise.all([
    readExistingFiles(input.target, input.adapter, input.instanceName),
    readOwnershipLedger(input),
  ]);
  return {
    input: {
      projectRoot: input.target.projectRoot,
      instanceName: input.instanceName,
      target: { project: input.target.projectName, artifactPrefix: input.target.artifactPrefix },
      existingFiles,
      ownershipLedger: ownership.ledger,
    },
    receiptPath: ownership.path,
  };
}

export async function prepareAgentFrameworkChange(input: {
  workspacePath: string;
  project: string;
  changeId: string;
  registry: AgentFrameworkRegistry;
  adapterId: string;
  instanceName: string;
  mode: AgentFrameworkProjectMode;
}): Promise<PreparedAgentFrameworkChange> {
  const adapter = admittedAdapter(input);
  const target = await resolveTarget(input.workspacePath, input.project);
  const prepared = await adapterInput({
    target,
    adapter,
    instanceName: input.instanceName,
  });
  const plan = adapter.plan(input.mode, prepared.input);
  assertJsonSchemaContract(
    plan,
    AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
    'Agent framework change plan'
  );
  const planDigest = hashCanonicalJson(plan);
  if (plan.status !== 'planned') {
    return {
      status: plan.status,
      changeId: input.changeId,
      project: target.projectName,
      plan,
      planArtifact: null,
      planDigest,
    };
  }
  // PCC capsules must describe the expected mutation, not merely carry an
  // adapter-specific plan that generic Change consumers cannot interpret.
  await recordProofCarryingChangePrediction({
    workspacePath: target.workspacePath,
    changeId: input.changeId,
    actorKind: 'cli',
    actorId: 'workspai-agent-framework',
    prediction: {
      schemaVersion: PREDICTED_ARCHITECTURE_CHANGE_SCHEMA_VERSION,
      changeId: input.changeId,
      goalId: '',
      generatedAt: new Date().toISOString(),
      baselineGeneration: '',
      nonCanonical: true,
      proofEligible: false,
      operations: plan.files.map((file) => ({
        operation: 'change',
        targetKind: 'artifact',
        targetId: artifactPath(target.artifactPrefix, file.path),
        rationale: `${file.overwrite} under the admitted agent-framework plan.`,
        confidence: 'high',
      })),
      assumptions: [
        'Only hash-bound Workspai-managed files in the admitted ownership roots will change.',
      ],
      predictedRisk: plan.files.length > 0 ? 'low' : 'none',
    },
  });
  const attached = await attachProofCarryingChangePlan({
    workspacePath: target.workspacePath,
    changeId: input.changeId,
    role: PLAN_ROLE,
    schemaVersion: AGENT_FRAMEWORK_CHANGE_PLAN_SCHEMA_VERSION,
    contractPath: AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
    payload: plan,
    actorId: 'workspai-agent-framework',
  });
  return {
    status: 'planned',
    changeId: input.changeId,
    project: target.projectName,
    plan,
    planArtifact: attached.artifact,
    planDigest: attached.digest,
  };
}

async function readAttachedPlan(
  workspacePath: string,
  changeId: string
): Promise<AgentFrameworkChangePlan> {
  const record = await readDecisionTransaction(workspacePath, changeId);
  const references = record.transaction.plans.filter((candidate) => candidate.role === PLAN_ROLE);
  if (references.length !== 1) {
    throw new Error(`PCC transaction must contain exactly one ${PLAN_ROLE} reference.`);
  }
  const reference = references[0];
  const absolute = await resolveContainedWorkspaceArtifactPath(workspacePath, reference.artifact);
  if (!absolute) throw new Error(`Attached agent framework plan is missing: ${reference.artifact}`);
  const plan = (await fsExtra.readJson(absolute)) as AgentFrameworkChangePlan;
  assertJsonSchemaContract(
    plan,
    AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
    'Attached agent framework change plan'
  );
  if (hashCanonicalJson(plan) !== reference.digest.value) {
    throw new Error('Attached agent framework plan digest does not match the PCC event chain.');
  }
  return plan;
}

function assertAuthorizedTransaction(input: {
  transaction: Awaited<ReturnType<typeof readDecisionTransaction>>['transaction'];
  projectName: string;
}): void {
  const { transaction } = input;
  if (transaction.state !== 'authorized' && transaction.state !== 'executing') {
    throw new Error(
      `Agent framework apply requires an authorized PCC transaction; observed ${transaction.state}.`
    );
  }
  if (!transaction.authorization?.effectClasses.includes('filesystem')) {
    throw new Error('Agent framework apply requires an explicit filesystem effect grant.');
  }
  if (!transaction.scope?.projects.includes(input.projectName)) {
    throw new Error(`Project ${input.projectName} is outside the immutable PCC scope.`);
  }
}

function rawArtifactReference(artifact: string, sha256: string): DecisionArtifactReference {
  return {
    role: 'agent-framework-managed-file',
    artifact,
    schemaVersion: MANAGED_FILE_SCHEMA_VERSION,
    digest: { algorithm: 'sha256', semantics: 'raw-bytes-v1', value: sha256 },
  };
}

async function writeAtomically(absolute: string, content: string): Promise<void> {
  await fsExtra.ensureDir(path.dirname(absolute));
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.workspai-tmp`;
  try {
    await fsExtra.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
      await fsExtra.rename(temporary, absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      await fsExtra.move(temporary, absolute, { overwrite: true });
    }
  } finally {
    await fsExtra.remove(temporary).catch(() => undefined);
  }
}

export async function applyAgentFrameworkChange(input: {
  workspacePath: string;
  project: string;
  changeId: string;
  registry: AgentFrameworkRegistry;
  adapterId: string;
}): Promise<AppliedAgentFrameworkChange> {
  const adapter = admittedAdapter(input);
  const target = await resolveTarget(input.workspacePath, input.project);
  const lockPath = path.join(
    target.workspacePath,
    '.workspai',
    'locks',
    'agent-framework',
    stableSegment(`${target.projectName}:${adapter.manifest.adapter.id}`)
  );
  return withInterprocessLock(
    lockPath,
    async () => {
      const [record, attachedPlan] = await Promise.all([
        readDecisionTransaction(target.workspacePath, input.changeId),
        readAttachedPlan(target.workspacePath, input.changeId),
      ]);
      assertAuthorizedTransaction({
        transaction: record.transaction,
        projectName: target.projectName,
      });
      if (
        attachedPlan.status !== 'planned' ||
        attachedPlan.adapterId !== adapter.manifest.adapter.id ||
        attachedPlan.adapterVersion !== adapter.manifest.adapter.version
      ) {
        throw new Error('Attached plan is not executable by the selected adapter version.');
      }
      if (
        attachedPlan.target.project !== target.projectName ||
        portable(attachedPlan.target.artifactPrefix) !== target.artifactPrefix
      ) {
        throw new Error(
          'Attached plan target does not match the canonical Workspace Model project.'
        );
      }
      const prepared = await adapterInput({
        target,
        adapter,
        instanceName: attachedPlan.instanceName,
      });
      const livePlan = adapter.plan(attachedPlan.mode, prepared.input);
      if (hashCanonicalJson(livePlan) !== hashCanonicalJson(attachedPlan)) {
        throw new Error(
          'Agent framework plan is stale; project files or ownership evidence changed after authorization.'
        );
      }
      const rendered = adapter.render(prepared.input);
      if (rendered.conflicts.length > 0)
        throw new Error('Adapter render became blocked after authorization.');
      const planFiles = new Map(attachedPlan.files.map((file) => [file.path, file]));
      if (
        rendered.files.length !== planFiles.size ||
        rendered.files.some((file) => {
          const planned = planFiles.get(file.path);
          return !planned || planned.sha256 !== file.sha256 || planned.overwrite !== file.overwrite;
        })
      ) {
        throw new Error('Rendered files do not match the hash-bound PCC plan.');
      }

      const previousFiles = new Map<string, Buffer | null>();
      const written: Array<{ path: string; artifact: string; sha256: string }> = [];
      const priorReceiptPath = await resolveContainedWorkspaceArtifactPath(
        target.workspacePath,
        prepared.receiptPath
      );
      const priorReceipt = priorReceiptPath ? await fsExtra.readFile(priorReceiptPath) : null;
      try {
        for (const file of rendered.files) {
          const absolute = await containedManagedPath(target.projectRoot, file.path);
          previousFiles.set(
            file.path,
            (await fsExtra.pathExists(absolute)) ? await fsExtra.readFile(absolute) : null
          );
          await writeAtomically(absolute, file.content);
          written.push({
            path: file.path,
            artifact: artifactPath(target.artifactPrefix, file.path),
            sha256: file.sha256,
          });
        }
        const desiredFiles = adapter.render({
          projectRoot: target.projectRoot,
          instanceName: attachedPlan.instanceName,
          target: attachedPlan.target,
        }).files;
        const receipt: AgentFrameworkOwnershipReceipt = {
          schemaVersion: AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION,
          generatedAt: new Date().toISOString(),
          changeId: input.changeId,
          adapter: {
            id: adapter.manifest.adapter.id,
            version: adapter.manifest.adapter.version,
            manifestSha256: adapterManifestDigest(adapter),
          },
          framework: {
            id: adapter.manifest.framework.id,
            version: attachedPlan.frameworkVersion,
          },
          target: {
            workspace: target.workspaceName,
            project: target.projectName,
            artifactPrefix: target.artifactPrefix,
            instanceName: attachedPlan.instanceName,
          },
          files: desiredFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
        };
        assertJsonSchemaContract(
          receipt,
          AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_CONTRACT_PATH,
          'Agent framework ownership receipt'
        );
        await writeWorkspaceArtifactJson(target.workspacePath, prepared.receiptPath, receipt);
        const receiptReference: DecisionArtifactReference = {
          role: 'agent-framework-ownership-receipt',
          artifact: prepared.receiptPath,
          schemaVersion: AGENT_FRAMEWORK_OWNERSHIP_RECEIPT_SCHEMA_VERSION,
          digest: {
            algorithm: 'sha256',
            semantics: 'canonical-json-v1',
            value: hashCanonicalJson(receipt),
          },
        };
        await recordProofCarryingChangeEffect({
          workspacePath: target.workspacePath,
          changeId: input.changeId,
          actorKind: 'cli',
          actorId: 'workspai-agent-framework',
          receipt: {
            id: `agent-framework-${input.changeId}`,
            effectClass: 'filesystem',
            status: 'succeeded',
            summary: `Applied ${adapter.manifest.framework.name} instance ${attachedPlan.instanceName}.`,
            artifacts: [
              ...written.map((file) => rawArtifactReference(file.artifact, file.sha256)),
              receiptReference,
            ],
            observedAt: receipt.generatedAt,
            idempotencyKey: `agent-framework:${input.changeId}:${hashCanonicalJson(attachedPlan)}`,
          },
        });
        return {
          status: 'applied',
          changeId: input.changeId,
          project: target.projectName,
          adapterId: adapter.manifest.adapter.id,
          instanceName: attachedPlan.instanceName,
          files: written,
          ownershipReceipt: prepared.receiptPath,
        };
      } catch (error) {
        for (const [relativePath, previous] of [...previousFiles].reverse()) {
          const absolute = await containedManagedPath(target.projectRoot, relativePath);
          if (previous === null) await fsExtra.remove(absolute);
          else await fsExtra.outputFile(absolute, previous);
        }
        if (priorReceipt === null) {
          const receipt = await resolveContainedWorkspaceArtifactPath(
            target.workspacePath,
            prepared.receiptPath
          );
          if (receipt) await fsExtra.remove(receipt);
        } else {
          await fsExtra.outputFile(
            path.join(target.workspacePath, prepared.receiptPath),
            priorReceipt
          );
        }
        throw error;
      }
    },
    {
      purpose: `agent-framework:${target.projectName}:${adapter.manifest.adapter.id}`,
      timeoutMs: 30_000,
      staleMs: 60_000,
    }
  );
}
