import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import type { WorkspaceGraphSearchView } from './workspace-graph-search-view.js';
import {
  resolveContainedWorkspaceArtifactPath,
  withWorkspaceArtifactLock,
  writeWorkspaceArtifactText,
} from './utils/artifact-path-compat.js';
import { hashCanonicalJson } from './workspace-model-hash.js';

export const WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION =
  'workspai.graph-search-delivery-ledger.v1' as const;
export const WORKSPACE_GRAPH_DELIVERY_LEDGER_PATH =
  '.workspai/cache/graph-search-delivery-ledger.v1.json';
const DELIVERY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DELIVERIES = 64;
const MAX_MATCHES_PER_DELIVERY = 512;

export type GraphSearchDeliveryReceipt = {
  receiptId: string;
  graphHash: string;
  scope: WorkspaceGraphSearchView['scope'];
  matchDigests: Record<string, string>;
  createdAt: string;
  expiresAt: string;
};

type GraphSearchDeliveryLedger = {
  schemaVersion: typeof WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION;
  deliveries: GraphSearchDeliveryReceipt[];
};

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isReceipt(value: unknown): value is GraphSearchDeliveryReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const scope = record.scope as Record<string, unknown> | null;
  const digests = record.matchDigests;
  return (
    typeof record.receiptId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      record.receiptId
    ) &&
    isHash(record.graphHash) &&
    Boolean(scope) &&
    typeof scope?.workspace === 'string' &&
    (scope.project === null || typeof scope.project === 'string') &&
    (scope.kind === null || typeof scope.kind === 'string') &&
    Boolean(digests) &&
    typeof digests === 'object' &&
    !Array.isArray(digests) &&
    Object.keys(digests as Record<string, unknown>).length <= MAX_MATCHES_PER_DELIVERY &&
    Object.values(digests as Record<string, unknown>).every(isHash) &&
    typeof record.createdAt === 'string' &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    typeof record.expiresAt === 'string' &&
    Number.isFinite(Date.parse(record.expiresAt))
  );
}

function parseLedger(raw: string): GraphSearchDeliveryLedger | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const ledger = value as Record<string, unknown>;
    if (
      ledger.schemaVersion !== WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION ||
      !Array.isArray(ledger.deliveries) ||
      ledger.deliveries.length > MAX_DELIVERIES ||
      !ledger.deliveries.every(isReceipt)
    )
      return null;
    const receipts = ledger.deliveries as GraphSearchDeliveryReceipt[];
    if (new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length) return null;
    return { schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION, deliveries: receipts };
  } catch {
    return null;
  }
}

async function readLedger(workspacePath: string): Promise<GraphSearchDeliveryLedger> {
  const target = await resolveContainedWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_GRAPH_DELIVERY_LEDGER_PATH
  );
  if (!target)
    return { schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION, deliveries: [] };
  const stat = await fs.stat(target);
  if (stat.size > 1024 * 1024) {
    return { schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION, deliveries: [] };
  }
  const parsed = parseLedger(await fs.readFile(target, 'utf8'));
  return (
    parsed ?? { schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION, deliveries: [] }
  );
}

function withoutExpired(ledger: GraphSearchDeliveryLedger, now: number): GraphSearchDeliveryLedger {
  return {
    schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION,
    deliveries: ledger.deliveries.filter((receipt) => Date.parse(receipt.expiresAt) > now),
  };
}

export async function readGraphSearchDeliveryReceipt(
  workspacePath: string,
  receiptId: string
): Promise<{ receipt: GraphSearchDeliveryReceipt | null; expired: boolean }> {
  return withWorkspaceArtifactLock(
    workspacePath,
    WORKSPACE_GRAPH_DELIVERY_LEDGER_PATH,
    async () => {
      const ledger = await readLedger(workspacePath);
      const receipt =
        ledger.deliveries.find((candidate) => candidate.receiptId === receiptId) ?? null;
      if (!receipt) return { receipt: null, expired: false };
      return Date.parse(receipt.expiresAt) > Date.now()
        ? { receipt, expired: false }
        : { receipt: null, expired: true };
    }
  );
}

/**
 * Persist only hashes and portable graph identifiers. Source text, query text,
 * absolute paths, and model-authored claims are never used as reuse authority.
 */
export async function recordGraphSearchDelivery(
  workspacePath: string,
  view: WorkspaceGraphSearchView,
  previous?: GraphSearchDeliveryReceipt
): Promise<void> {
  if (!view.delivery) throw new Error('Graph delivery receipt is missing from the response view.');
  const now = Date.now();
  const priorMatches =
    previous &&
    previous.graphHash === view.source.graphHash &&
    hashCanonicalJson(previous.scope) === hashCanonicalJson(view.scope) &&
    Date.parse(previous.expiresAt) > now
      ? previous.matchDigests
      : {};
  const currentMatches = Object.fromEntries(
    view.matches.map((match) => {
      const proof = view.proofs.find((candidate) => candidate.id === match.proofId);
      return [match.id, hashCanonicalJson({ match, proof: proof ?? null })];
    })
  );
  const merged = { ...priorMatches, ...currentMatches };
  const matchDigests =
    Object.keys(merged).length <= MAX_MATCHES_PER_DELIVERY ? merged : currentMatches;
  const createdAt = new Date(now).toISOString();
  const receipt: GraphSearchDeliveryReceipt = {
    receiptId: view.delivery.receiptId,
    graphHash: view.source.graphHash,
    scope: view.scope,
    matchDigests,
    createdAt,
    expiresAt: new Date(now + DELIVERY_TTL_MS).toISOString(),
  };

  await withWorkspaceArtifactLock(workspacePath, WORKSPACE_GRAPH_DELIVERY_LEDGER_PATH, async () => {
    const ledger = withoutExpired(await readLedger(workspacePath), now);
    const deliveries = [
      ...ledger.deliveries.filter((candidate) => candidate.receiptId !== receipt.receiptId),
      receipt,
    ].slice(-MAX_DELIVERIES);
    const payload: GraphSearchDeliveryLedger = {
      schemaVersion: WORKSPACE_GRAPH_DELIVERY_LEDGER_SCHEMA_VERSION,
      deliveries,
    };
    await writeWorkspaceArtifactText(
      workspacePath,
      WORKSPACE_GRAPH_DELIVERY_LEDGER_PATH,
      `${JSON.stringify(payload)}\n`
    );
  });
}

export function createGraphSearchDeliveryId(): string {
  return randomUUID();
}
