import type { AgentBootstrapReceipt } from './project-agent-entry.js';
import { hashCanonicalJson } from './workspace-model-hash.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';

export const AGENT_BOOTSTRAP_VIEW_SCHEMA_VERSION = 'workspai.agent-bootstrap-view.v1' as const;
export const DEFAULT_AGENT_BOOTSTRAP_MAX_BYTES = 12 * 1024;
export const MAX_AGENT_BOOTSTRAP_BYTES = 128 * 1024;

type SourceReceipt = Pick<AgentBootstrapReceipt, 'schemaVersion' | 'receiptId' | 'integrity'>;

export type AgentBootstrapView = {
  schemaVersion: typeof AGENT_BOOTSTRAP_VIEW_SCHEMA_VERSION;
  sourceReceipt: SourceReceipt;
  generatedAt: string;
  status: AgentBootstrapReceipt['status'];
  statusScope: AgentBootstrapReceipt['statusScope'];
  readiness: AgentBootstrapReceipt['readiness'];
  requestedAgent: AgentBootstrapReceipt['requestedAgent'];
  resolvedHost: AgentBootstrapReceipt['resolvedHost'];
  project: AgentBootstrapReceipt['project'];
  workspace: AgentBootstrapReceipt['workspace'];
  entry: AgentBootstrapReceipt['entry'];
  canonicalEvidence: AgentBootstrapReceipt['canonicalEvidence'];
  activeGoal: AgentBootstrapReceipt['activeGoal'];
  claims: AgentBootstrapReceipt['claims'];
  requiredReadOrder: string[];
  checks: {
    total: number;
    passed: number;
    findings: AgentBootstrapReceipt['checks'];
    omittedPassedDetails: number;
  };
  nextActions: string[];
  budget: { maxBytes: number; usedBytes: number; accounting: 'utf8-json-with-newline' };
  integrity: { algorithm: 'sha256'; payloadHash: string };
};

export type AgentBootstrapBudgetFailure = {
  schemaVersion: typeof AGENT_BOOTSTRAP_VIEW_SCHEMA_VERSION;
  status: 'insufficient-budget';
  sourceReceipt: SourceReceipt;
  groundingStatus: AgentBootstrapReceipt['status'];
  budget: { maxBytes: number; requiredBytes: number; accounting: 'utf8-json-with-newline' };
  message: string;
  nextActions: string[];
};

export function agentBootstrapByteBudget(value?: string | number): number {
  if (value === undefined) return DEFAULT_AGENT_BOOTSTRAP_MAX_BYTES;
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new Error('--max-bytes must be an integer.');
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > MAX_AGENT_BOOTSTRAP_BYTES) {
    throw new Error(`--max-bytes must be between 1024 and ${MAX_AGENT_BOOTSTRAP_BYTES}.`);
  }
  return bytes;
}

/** UTF-8 bytes of the exact compact CLI representation, including its trailing newline. */
export function agentBootstrapViewBytes(
  view: AgentBootstrapView | AgentBootstrapBudgetFailure
): number {
  return Buffer.byteLength(JSON.stringify(view) + '\n', 'utf8');
}

function remainingReads(receipt: AgentBootstrapReceipt): string[] {
  const goalIndex = 'workspace:.workspai/goals/index.json';
  const reads = receipt.requiredReadOrder.filter(
    (entry) =>
      !entry.startsWith('command:workspai agent bootstrap ') &&
      entry !== 'command:workspai project workspace status --json' &&
      entry !== goalIndex
  );
  // Bootstrap resolved membership and selected the active Goal already. Read the
  // exact applicable pack before Skills/retrieval, never an unrelated latest alias.
  if (receipt.activeGoal.present && receipt.activeGoal.appliesToProject) {
    const goalReads = [receipt.activeGoal.goalPack, receipt.activeGoal.agentHandoff].filter(
      (entry): entry is string => Boolean(entry)
    );
    const skillIndex = reads.indexOf(receipt.canonicalEvidence.workspaceSkillsIndex);
    reads.splice(skillIndex < 0 ? 0 : skillIndex, 0, ...goalReads);
  }
  return [
    ...new Set(
      reads.map((entry) =>
        entry.startsWith('command:workspai workspace graph search ') && !entry.includes('--view ')
          ? `${entry} --view agent`
          : entry
      )
    ),
  ];
}

/** Terminal projection only. It never changes source receipt claims or persists evidence. */
export function buildAgentBootstrapView(
  receipt: AgentBootstrapReceipt,
  options: { maxBytes?: number; completedReads?: readonly string[] } = {}
): AgentBootstrapView | AgentBootstrapBudgetFailure {
  assertJsonSchemaContract(
    receipt,
    'contracts/workspace-intelligence/agent-bootstrap-receipt.v1.json',
    'Source agent bootstrap receipt'
  );
  const { integrity: sourceIntegrity, ...sourcePayload } = receipt;
  if (sourceIntegrity.payloadHash !== hashCanonicalJson(sourcePayload)) {
    throw new Error('Source agent bootstrap receipt integrity mismatch.');
  }
  const maxBytes = agentBootstrapByteBudget(options.maxBytes);
  const sourceReceipt = structuredClone({
    schemaVersion: receipt.schemaVersion,
    receiptId: receipt.receiptId,
    integrity: receipt.integrity,
  });
  const findings = receipt.checks.filter((check) => check.status !== 'passed');
  const passed = receipt.checks.length - findings.length;
  const payload = structuredClone({
    schemaVersion: AGENT_BOOTSTRAP_VIEW_SCHEMA_VERSION,
    sourceReceipt,
    generatedAt: receipt.generatedAt,
    status: receipt.status,
    statusScope: receipt.statusScope,
    readiness: receipt.readiness,
    requestedAgent: receipt.requestedAgent,
    resolvedHost: receipt.resolvedHost,
    project: receipt.project,
    workspace: receipt.workspace,
    entry: receipt.entry,
    canonicalEvidence: receipt.canonicalEvidence,
    activeGoal: receipt.activeGoal,
    claims: receipt.claims,
    requiredReadOrder: remainingReads(receipt).filter(
      (entry) => !options.completedReads?.includes(entry)
    ),
    checks: { total: receipt.checks.length, passed, findings, omittedPassedDetails: passed },
    nextActions: receipt.nextActions.filter(
      (entry) =>
        !options.completedReads?.includes(entry) &&
        !options.completedReads?.includes(`command:${entry}`)
    ),
    budget: { maxBytes, usedBytes: 0, accounting: 'utf8-json-with-newline' as const },
  });
  const view: AgentBootstrapView = {
    ...payload,
    integrity: { algorithm: 'sha256', payloadHash: '0'.repeat(64) },
  };
  // The digest has fixed width. Settle the self-reported byte count before hashing.
  while (view.budget.usedBytes !== agentBootstrapViewBytes(view)) {
    view.budget.usedBytes = agentBootstrapViewBytes(view);
  }
  const { integrity: _integrity, ...unsigned } = view;
  view.integrity.payloadHash = hashCanonicalJson(unsigned);
  // Raising maxBytes may add a digit to the JSON itself. Recommend a budget
  // that fits in one retry even at decimal-width boundaries.
  let requiredBytes = view.budget.usedBytes;
  if (requiredBytes > maxBytes) {
    let previous: number;
    do {
      previous = requiredBytes;
      requiredBytes =
        view.budget.usedBytes + String(requiredBytes).length - String(maxBytes).length;
    } while (requiredBytes !== previous);
  }
  const result: AgentBootstrapView | AgentBootstrapBudgetFailure =
    view.budget.usedBytes <= maxBytes
      ? view
      : {
          schemaVersion: AGENT_BOOTSTRAP_VIEW_SCHEMA_VERSION,
          status: 'insufficient-budget',
          sourceReceipt,
          groundingStatus: receipt.status,
          budget: {
            maxBytes,
            requiredBytes,
            accounting: 'utf8-json-with-newline',
          },
          message:
            'Required grounding, findings and claim limits cannot fit; no partial view was emitted.',
          nextActions: [
            requiredBytes <= MAX_AGENT_BOOTSTRAP_BYTES
              ? `Increase --max-bytes to at least ${requiredBytes}, or use --view full.`
              : 'Use --view full; the required view exceeds the maximum agent output budget.',
          ],
        };
  assertJsonSchemaContract(
    result,
    'contracts/workspace-intelligence/agent-bootstrap-view.v1.json',
    'Agent bootstrap view'
  );
  return result;
}
