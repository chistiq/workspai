import fsExtra from 'fs-extra';

import { assertWorkspaceArtifactContract } from '../contracts/artifact-contract-registry.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';
import {
  resolveContainedWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
  writeWorkspaceArtifactText,
} from '../utils/artifact-path-compat.js';
import { withInterprocessLock } from '../utils/interprocess-lock.js';
import type {
  DecisionCheckpoint,
  DecisionEvent,
  DecisionTransaction,
  UnsignedDecisionEvent,
} from './decision-contract.js';
import {
  buildDecisionCheckpoint,
  createDecisionEvent,
  reduceDecisionEvents,
} from './decision-kernel.js';

const ports = { digestCanonical: hashCanonicalJson };

export type DecisionTransactionRecord = {
  transaction: DecisionTransaction;
  checkpoint: DecisionCheckpoint;
  events: DecisionEvent[];
  paths: {
    directory: string;
    transaction: string;
    checkpoint: string;
    events: string;
  };
};

function validateTransactionId(transactionId: string): string {
  const normalized = transactionId.trim();
  if (!/^change-[a-z0-9][a-z0-9-]{7,95}$/.test(normalized)) {
    throw new Error(`Invalid decision transaction id: ${transactionId}`);
  }
  return normalized;
}

function relativePaths(transactionId: string) {
  const id = validateTransactionId(transactionId);
  const directory = `.workspai/decisions/${id}`;
  return {
    directory,
    transaction: `${directory}/transaction.json`,
    checkpoint: `${directory}/checkpoint.json`,
    events: `${directory}/events.jsonl`,
    lock: `${directory}.lock`,
  };
}

function parseEvents(text: string, artifact: string): DecisionEvent[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as DecisionEvent;
    } catch (error) {
      throw new Error(
        `Decision event log is corrupt at ${artifact}:${index + 1}: ${(error as Error).message}`
      );
    }
  });
}

async function readEvents(workspacePath: string, transactionId: string): Promise<DecisionEvent[]> {
  const paths = relativePaths(transactionId);
  const absolute = await resolveContainedWorkspaceArtifactPath(workspacePath, paths.events);
  if (!absolute) return [];
  return parseEvents(await fsExtra.readFile(absolute, 'utf8'), absolute);
}

function recordPaths(workspacePath: string, transactionId: string) {
  const relative = relativePaths(transactionId);
  return {
    directory: resolveWorkspaceArtifactPath(workspacePath, relative.directory),
    transaction: resolveWorkspaceArtifactPath(workspacePath, relative.transaction),
    checkpoint: resolveWorkspaceArtifactPath(workspacePath, relative.checkpoint),
    events: resolveWorkspaceArtifactPath(workspacePath, relative.events),
  };
}

async function publishProjection(
  workspacePath: string,
  transaction: DecisionTransaction,
  events: DecisionEvent[],
  generatedAt: string
): Promise<DecisionTransactionRecord> {
  const relative = relativePaths(transaction.id);
  const checkpoint = buildDecisionCheckpoint(transaction, generatedAt, ports);
  for (const [index, event] of events.entries()) {
    assertJsonSchemaContract(
      event,
      'contracts/workspace-intelligence/decision-event.v1.json',
      `Decision event ${index + 1}`
    );
  }
  assertWorkspaceArtifactContract(relative.transaction, transaction);
  assertWorkspaceArtifactContract(relative.checkpoint, checkpoint);
  await writeWorkspaceArtifactText(
    workspacePath,
    relative.events,
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  );
  await writeWorkspaceArtifactJson(workspacePath, relative.transaction, transaction);
  await writeWorkspaceArtifactJson(workspacePath, relative.checkpoint, checkpoint);
  return { transaction, checkpoint, events, paths: recordPaths(workspacePath, transaction.id) };
}

/**
 * Append one causally ordered event under an optimistic head guard.
 *
 * The event log is authoritative. Projections are rebuilt from the complete,
 * digest-validated log on every write so interrupted projection publication is
 * recoverable and cannot silently fork transaction history.
 */
export async function appendDecisionEvent(input: {
  workspacePath: string;
  transactionId: string;
  expectedHeadDigest: string | null;
  event: UnsignedDecisionEvent;
}): Promise<DecisionTransactionRecord> {
  const relative = relativePaths(input.transactionId);
  const lockDirectory = resolveWorkspaceArtifactPath(input.workspacePath, relative.lock);
  return withInterprocessLock(
    lockDirectory,
    async () => {
      const events = await readEvents(input.workspacePath, input.transactionId);
      const previous = events.at(-1) ?? null;
      if ((previous?.digest ?? null) !== input.expectedHeadDigest) {
        throw new Error(
          `Decision transaction head changed: expected ${input.expectedHeadDigest ?? '<empty>'}, ` +
            `observed ${previous?.digest ?? '<empty>'}`
        );
      }
      if (events.length > 0) reduceDecisionEvents(events, ports);
      const event = createDecisionEvent(input.transactionId, previous, input.event, ports);
      const nextEvents = [...events, event];
      const transaction = reduceDecisionEvents(nextEvents, ports);
      return publishProjection(
        input.workspacePath,
        transaction,
        nextEvents,
        input.event.occurredAt
      );
    },
    { purpose: `decision:${input.transactionId}`, timeoutMs: 30_000, staleMs: 60_000 }
  );
}

export async function readDecisionTransaction(
  workspacePath: string,
  transactionId: string
): Promise<DecisionTransactionRecord> {
  const events = await readEvents(workspacePath, transactionId);
  if (events.length === 0) throw new Error(`Decision transaction not found: ${transactionId}`);
  const transaction = reduceDecisionEvents(events, ports);
  const checkpoint = buildDecisionCheckpoint(transaction, transaction.updatedAt, ports);
  return { transaction, checkpoint, events, paths: recordPaths(workspacePath, transactionId) };
}

export async function repairDecisionProjection(
  workspacePath: string,
  transactionId: string,
  generatedAt: string
): Promise<DecisionTransactionRecord> {
  const relative = relativePaths(transactionId);
  const lockDirectory = resolveWorkspaceArtifactPath(workspacePath, relative.lock);
  return withInterprocessLock(
    lockDirectory,
    async () => {
      const events = await readEvents(workspacePath, transactionId);
      if (events.length === 0) throw new Error(`Decision transaction not found: ${transactionId}`);
      return publishProjection(
        workspacePath,
        reduceDecisionEvents(events, ports),
        events,
        generatedAt
      );
    },
    { purpose: `decision-repair:${transactionId}`, timeoutMs: 30_000, staleMs: 60_000 }
  );
}

export function decisionRelativeDirectory(transactionId: string): string {
  return relativePaths(transactionId).directory;
}
