import fs from 'node:fs';
import path from 'node:path';

import {
  WORKSPACE_ACTIVITY_EVENT_KINDS,
  WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION,
  WORKSPACE_ACTIVITY_STATUSES,
  type WorkspaceActivityEvent,
  type WorkspaceActivityEvidenceBinding,
  type WorkspaceActivityOrigin,
  type WorkspaceActivityScope,
  type WorkspaceActivityStatus,
} from './activity-contract.js';
import {
  resolveActivityScope,
  resolveActivityStateHome,
  type ResolvedActivityScope,
} from './activity-scope.js';
import { pruneActivityJournalDirectory } from './activity-retention.js';

const ACTIVITY_JOURNAL_HEAD_BYTES = 64 * 1_024;
const ACTIVITY_JOURNAL_TAIL_BYTES = 1_024 * 1_024;

export const WORKSPACE_ACTIVITY_MONITOR_SNAPSHOT_SCHEMA_VERSION =
  'workspace-activity-monitor-snapshot.v1' as const;
export const WORKSPACE_ACTIVITY_MONITOR_FLEET_SCHEMA_VERSION =
  'workspace-activity-monitor-fleet.v1' as const;

export type ActivityBlockView = {
  id: string;
  label: string;
  status: WorkspaceActivityStatus;
  order: number;
  parentId?: string;
  progress?: WorkspaceActivityEvent['progress'];
  durationMs?: number;
  layoutHint?: 'source' | 'process' | 'gate' | 'sink';
  group?: string;
  updatedAt: string;
  attempt?: number;
  attempts: ActivityBlockAttemptView[];
  evidenceBindings: WorkspaceActivityEvidenceBinding[];
};

export type ActivityBlockAttemptView = {
  attempt: number;
  status: WorkspaceActivityStatus;
  startedAt: string;
  updatedAt: string;
  progress?: WorkspaceActivityEvent['progress'];
  durationMs?: number;
};

export type ActivityEdgeView = {
  id: string;
  fromBlockId: string;
  toBlockId: string;
  kind: 'sequence' | 'parallel' | 'gate' | 'handoff';
  status: WorkspaceActivityStatus;
  order: number;
  updatedAt: string;
};

export type ActivityRunView = {
  runId: string;
  parentRunId?: string;
  pid?: number;
  orphaned?: boolean;
  origin?: WorkspaceActivityOrigin;
  command: string[];
  status: WorkspaceActivityStatus;
  startedAt: string;
  updatedAt: string;
  durationMs?: number;
  blocks: ActivityBlockView[];
  edges: ActivityEdgeView[];
  touches: Array<{ locator: string; operation?: string; at: string }>;
  artifacts: Array<{ locator: string; at: string }>;
  warnings: string[];
  evidenceBindings: WorkspaceActivityEvidenceBinding[];
};

export type ActivityMonitorSnapshot = {
  schemaVersion: typeof WORKSPACE_ACTIVITY_MONITOR_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  scope: ResolvedActivityScope['scope'];
  runs: ActivityRunView[];
  diagnostics: string[];
};

export type ActivityFleetSnapshot = {
  schemaVersion: typeof WORKSPACE_ACTIVITY_MONITOR_FLEET_SCHEMA_VERSION;
  generatedAt: string;
  scopes: ActivityMonitorSnapshot[];
  diagnostics: string[];
};

export type ActivityMonitorView = ActivityMonitorSnapshot | ActivityFleetSnapshot;

function isEvidenceBinding(value: unknown): value is WorkspaceActivityEvidenceBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<WorkspaceActivityEvidenceBinding>;
  return (
    ['artifact', 'graph-entity', 'graph-relation', 'proof', 'project'].includes(
      String(binding.kind)
    ) &&
    typeof binding.ref === 'string' &&
    binding.ref.length > 0 &&
    ['input', 'output', 'verification', 'subject'].includes(String(binding.role)) &&
    ['authoritative', 'observed'].includes(String(binding.provenance)) &&
    (!['graph-entity', 'graph-relation', 'proof'].includes(String(binding.kind)) ||
      (typeof binding.graphSourceHash === 'string' && binding.graphSourceHash.length > 0)) &&
    (binding.graphSourceHash === undefined ||
      (typeof binding.graphSourceHash === 'string' && binding.graphSourceHash.length > 0))
  );
}

function mergeEvidenceBindings(
  current: readonly WorkspaceActivityEvidenceBinding[],
  next: readonly WorkspaceActivityEvidenceBinding[] | undefined
): WorkspaceActivityEvidenceBinding[] {
  const merged = new Map<string, WorkspaceActivityEvidenceBinding>();
  for (const binding of [...current, ...(next ?? [])]) {
    if (!isEvidenceBinding(binding)) continue;
    const key = [
      binding.kind,
      binding.ref,
      binding.role,
      binding.provenance,
      binding.graphSourceHash ?? '',
    ].join('\u0000');
    merged.set(key, binding);
  }
  return [...merged.values()]
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.ref.localeCompare(right.ref) ||
        left.role.localeCompare(right.role)
    )
    .slice(0, 100);
}

function isActivityEvent(value: unknown): value is WorkspaceActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<WorkspaceActivityEvent>;
  return (
    event.schemaVersion === WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION &&
    typeof event.eventId === 'string' &&
    typeof event.runId === 'string' &&
    Number.isInteger(event.sequence) &&
    Number(event.sequence) > 0 &&
    typeof event.timestamp === 'string' &&
    Boolean(event.scope) &&
    typeof event.scope?.id === 'string' &&
    typeof event.scope?.label === 'string' &&
    ['ephemeral-project', 'project', 'workspace'].includes(String(event.scope?.kind)) &&
    typeof event.scope?.portable === 'boolean' &&
    WORKSPACE_ACTIVITY_EVENT_KINDS.includes(event.kind as WorkspaceActivityEvent['kind']) &&
    WORKSPACE_ACTIVITY_STATUSES.includes(event.status as WorkspaceActivityStatus) &&
    (event.attempt === undefined || (Number.isInteger(event.attempt) && event.attempt > 0)) &&
    (event.origin === undefined ||
      (typeof event.origin.id === 'string' &&
        typeof event.origin.label === 'string' &&
        ['project', 'workspace-root'].includes(event.origin.kind))) &&
    (event.evidenceBindings === undefined ||
      (Array.isArray(event.evidenceBindings) && event.evidenceBindings.every(isEvidenceBinding))) &&
    typeof event.message === 'string'
  );
}

function readJournal(filePath: string, diagnostics: string[]): WorkspaceActivityEvent[] {
  try {
    const fileSize = fs.statSync(filePath).size;
    let content: string;
    if (fileSize <= ACTIVITY_JOURNAL_HEAD_BYTES + ACTIVITY_JOURNAL_TAIL_BYTES) {
      content = fs.readFileSync(filePath, 'utf8');
    } else {
      const fd = fs.openSync(filePath, 'r');
      try {
        const head = Buffer.allocUnsafe(ACTIVITY_JOURNAL_HEAD_BYTES);
        const tail = Buffer.allocUnsafe(ACTIVITY_JOURNAL_TAIL_BYTES);
        const headBytes = fs.readSync(fd, head, 0, head.length, 0);
        const tailStart = Math.max(0, fileSize - tail.length);
        const tailBytes = fs.readSync(fd, tail, 0, tail.length, tailStart);
        const headText = head.subarray(0, headBytes).toString('utf8');
        const rawTailText = tail.subarray(0, tailBytes).toString('utf8');
        const firstCompleteLine = rawTailText.indexOf('\n');
        const tailText = firstCompleteLine >= 0 ? rawTailText.slice(firstCompleteLine + 1) : '';
        content = `${headText.endsWith('\n') ? headText : `${headText}\n`}${tailText}`;
        diagnostics.push(`Bounded replay window applied to ${path.basename(filePath)}.`);
      } finally {
        fs.closeSync(fd);
      }
    }
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isActivityEvent(parsed) ? [parsed] : [];
        } catch {
          diagnostics.push(`Ignored an incomplete activity record in ${path.basename(filePath)}.`);
          return [];
        }
      });
  } catch (error) {
    diagnostics.push(
      `Unable to read ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function deriveActivityEdgeStatus(
  edge: Pick<ActivityEdgeView, 'fromBlockId' | 'toBlockId'>,
  blocks: ReadonlyMap<string, ActivityBlockView>,
  runStatus: WorkspaceActivityStatus
): WorkspaceActivityStatus {
  const source = blocks.get(edge.fromBlockId);
  const target = blocks.get(edge.toBlockId);
  if (!source || !target) return 'planned';
  if (target.status !== 'planned') return target.status;
  if (runStatus !== 'running' && runStatus !== 'planned') return 'skipped';
  if (source.status === 'succeeded' || source.status === 'warned') return 'running';
  if (source.status === 'failed') return 'failed';
  if (source.status === 'blocked') return 'blocked';
  if (source.status === 'cancelled') return 'cancelled';
  return 'planned';
}

export function readActivityEvents(input: {
  targetPath?: string;
  runId?: string;
  maxRuns?: number;
  maxEvents?: number;
  env?: NodeJS.ProcessEnv;
}): {
  resolvedScope: ResolvedActivityScope;
  events: WorkspaceActivityEvent[];
  diagnostics: string[];
} {
  const resolvedScope = resolveActivityScope(input.targetPath ?? process.cwd(), { env: input.env });
  const diagnostics: string[] = [];
  const runsPath = path.join(resolvedScope.statePath, 'runs');
  let entries: Array<{ name: string; mtimeMs: number }> = [];
  try {
    entries = fs
      .readdirSync(runsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
      .map((entry) => {
        const filePath = path.join(runsPath, entry.name);
        return { name: entry.name, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (input.runId) entries = entries.filter((entry) => entry.name === `${input.runId}.ndjson`);
  entries = entries.slice(0, Math.max(1, input.maxRuns ?? 25));
  const events = entries
    .flatMap((entry) => readJournal(path.join(runsPath, entry.name), diagnostics))
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence
    );
  const maxEvents = Math.max(100, input.maxEvents ?? 20_000);
  return { resolvedScope, events: events.slice(-maxEvents), diagnostics };
}

export function projectActivitySnapshot(input: {
  resolvedScope: Pick<ResolvedActivityScope, 'scope'>;
  events: readonly WorkspaceActivityEvent[];
  diagnostics?: readonly string[];
}): ActivityMonitorSnapshot {
  const runs = new Map<string, ActivityRunView>();
  const blockMaps = new Map<string, Map<string, ActivityBlockView>>();
  const edgeMaps = new Map<string, Map<string, ActivityEdgeView>>();

  for (const event of input.events) {
    let run = runs.get(event.runId);
    if (!run) {
      const command = Array.isArray(event.attributes?.command)
        ? event.attributes.command.filter((part): part is string => typeof part === 'string')
        : [];
      run = {
        runId: event.runId,
        ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
        ...(Number.isInteger(Number(event.attributes?.pid)) && Number(event.attributes?.pid) > 0
          ? { pid: Number(event.attributes?.pid) }
          : {}),
        ...(event.origin ? { origin: event.origin } : {}),
        command,
        status: event.status,
        startedAt: event.timestamp,
        updatedAt: event.timestamp,
        blocks: [],
        edges: [],
        touches: [],
        artifacts: [],
        warnings: [],
        evidenceBindings: [],
      };
      runs.set(event.runId, run);
      blockMaps.set(event.runId, new Map());
      edgeMaps.set(event.runId, new Map());
    }
    run.updatedAt = event.timestamp;
    run.evidenceBindings = mergeEvidenceBindings(run.evidenceBindings, event.evidenceBindings);

    if (event.kind.startsWith('run.')) {
      run.status = event.status;
      if (event.kind === 'run.started' && Array.isArray(event.attributes?.command)) {
        const command = event.attributes?.command as unknown[];
        run.command = command.filter((part): part is string => typeof part === 'string');
      }
      const pid = Number(event.attributes?.pid);
      if (event.kind === 'run.started' && Number.isInteger(pid) && pid > 0) run.pid = pid;
      if (event.origin) run.origin = event.origin;
      if (event.durationMs !== undefined) run.durationMs = event.durationMs;
    }

    if (event.blockId && event.kind.startsWith('block.')) {
      const blocks = blockMaps.get(event.runId) as Map<string, ActivityBlockView>;
      const previous = blocks.get(event.blockId);
      const orderValue = Number(event.attributes?.order);
      const previousAttempt = previous?.attempt ?? 0;
      const inferredAttempt =
        event.kind === 'block.planned' || (event.kind === 'block.skipped' && previousAttempt === 0)
          ? undefined
          : event.kind === 'block.started' && previous?.status !== 'running'
            ? previousAttempt + 1
            : Math.max(1, previousAttempt);
      const attempt = event.attempt ?? inferredAttempt;
      const attempts = [...(previous?.attempts ?? [])];
      if (attempt !== undefined) {
        const existingIndex = attempts.findIndex((entry) => entry.attempt === attempt);
        const existing = existingIndex >= 0 ? attempts[existingIndex] : undefined;
        const projectedAttempt: ActivityBlockAttemptView = {
          attempt,
          status: event.status,
          startedAt: existing?.startedAt ?? event.timestamp,
          updatedAt: event.timestamp,
          ...(event.progress
            ? { progress: event.progress }
            : existing?.progress
              ? { progress: existing.progress }
              : {}),
          ...(event.durationMs !== undefined
            ? { durationMs: event.durationMs }
            : existing?.durationMs !== undefined
              ? { durationMs: existing.durationMs }
              : {}),
        };
        if (existingIndex >= 0) attempts[existingIndex] = projectedAttempt;
        else attempts.push(projectedAttempt);
      }
      blocks.set(event.blockId, {
        id: event.blockId,
        label:
          event.kind === 'block.planned' || !previous
            ? event.message || event.blockId
            : previous.label,
        status: event.status,
        order: Number.isFinite(orderValue) ? orderValue : (previous?.order ?? blocks.size + 1),
        ...(event.parentSpanId
          ? { parentId: event.parentSpanId }
          : previous?.parentId
            ? { parentId: previous.parentId }
            : {}),
        ...(event.progress
          ? { progress: event.progress }
          : previous?.progress
            ? { progress: previous.progress }
            : {}),
        ...(event.durationMs !== undefined
          ? { durationMs: event.durationMs }
          : previous?.durationMs !== undefined
            ? { durationMs: previous.durationMs }
            : {}),
        ...(typeof event.attributes?.layoutHint === 'string'
          ? {
              layoutHint: event.attributes.layoutHint as ActivityBlockView['layoutHint'],
            }
          : previous?.layoutHint
            ? { layoutHint: previous.layoutHint }
            : {}),
        ...(typeof event.attributes?.group === 'string'
          ? { group: event.attributes.group }
          : previous?.group
            ? { group: previous.group }
            : {}),
        updatedAt: event.timestamp,
        ...(attempt !== undefined
          ? { attempt }
          : previous?.attempt
            ? { attempt: previous.attempt }
            : {}),
        attempts,
        evidenceBindings: mergeEvidenceBindings(
          previous?.evidenceBindings ?? [],
          event.evidenceBindings
        ),
      });
    }

    if (event.blockId && event.evidenceBindings?.length && !event.kind.startsWith('block.')) {
      const blocks = blockMaps.get(event.runId) as Map<string, ActivityBlockView>;
      const block = blocks.get(event.blockId);
      if (block) {
        blocks.set(event.blockId, {
          ...block,
          evidenceBindings: mergeEvidenceBindings(block.evidenceBindings, event.evidenceBindings),
          updatedAt: event.timestamp,
        });
      }
    }

    if (event.kind === 'edge.declared' && event.edge) {
      const edges = edgeMaps.get(event.runId) as Map<string, ActivityEdgeView>;
      const orderValue = Number(event.attributes?.order);
      edges.set(event.edge.id, {
        id: event.edge.id,
        fromBlockId: event.edge.fromBlockId,
        toBlockId: event.edge.toBlockId,
        kind: event.edge.kind,
        status: 'planned',
        order: Number.isFinite(orderValue) ? orderValue : edges.size + 1,
        updatedAt: event.timestamp,
      });
    }

    if (event.kind === 'touch.observed' || event.kind === 'touch.planned') {
      run.touches.push({
        locator: event.target?.locator ?? event.message,
        ...(event.target?.operation ? { operation: event.target.operation } : {}),
        at: event.timestamp,
      });
      run.touches = run.touches.slice(-20);
    }
    if (event.kind === 'artifact.published') {
      run.artifacts.push({ locator: event.target?.locator ?? event.message, at: event.timestamp });
      run.artifacts = run.artifacts.slice(-20);
    }
    if (event.kind === 'warning.detected') {
      run.warnings.push(event.message);
      run.warnings = run.warnings.slice(-20);
    }
  }

  for (const [runId, run] of runs) {
    run.blocks = [...(blockMaps.get(runId)?.values() ?? [])].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id)
    );
    const blocks = blockMaps.get(runId) ?? new Map<string, ActivityBlockView>();
    run.edges = [...(edgeMaps.get(runId)?.values() ?? [])]
      .map((edge) => ({
        ...edge,
        status: deriveActivityEdgeStatus(edge, blocks, run.status),
        updatedAt:
          blocks.get(edge.toBlockId)?.updatedAt ??
          blocks.get(edge.fromBlockId)?.updatedAt ??
          edge.updatedAt,
      }))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  return {
    schemaVersion: WORKSPACE_ACTIVITY_MONITOR_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    scope: input.resolvedScope.scope,
    runs: [...runs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    diagnostics: [...(input.diagnostics ?? [])],
  };
}

export function projectActivityReplayFrame(input: {
  resolvedScope: Pick<ResolvedActivityScope, 'scope'>;
  events: readonly WorkspaceActivityEvent[];
  eventCount: number;
  diagnostics?: readonly string[];
}): ActivityMonitorSnapshot {
  const eventCount = Math.max(0, Math.min(input.events.length, Math.floor(input.eventCount)));
  return projectActivitySnapshot({
    resolvedScope: input.resolvedScope,
    events: input.events.slice(0, eventCount),
    diagnostics: input.diagnostics,
  });
}

function isLocalProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function reconcileActivityProcessLiveness(
  snapshot: ActivityMonitorSnapshot,
  processAlive: (pid: number) => boolean = isLocalProcessAlive
): ActivityMonitorSnapshot {
  return {
    ...snapshot,
    runs: snapshot.runs.map((run) => {
      if (run.status !== 'running' || !run.pid || processAlive(run.pid)) return run;
      const terminalAt = Date.parse(run.updatedAt);
      const startedAt = Date.parse(run.startedAt);
      return {
        ...run,
        status: 'cancelled',
        orphaned: true,
        durationMs:
          Number.isFinite(terminalAt) && Number.isFinite(startedAt)
            ? Math.max(0, terminalAt - startedAt)
            : run.durationMs,
        blocks: run.blocks.map((block) => ({
          ...block,
          status:
            block.status === 'running'
              ? ('cancelled' as const)
              : block.status === 'planned'
                ? ('skipped' as const)
                : block.status,
          attempts: block.attempts.map((attempt, index, attempts) =>
            index === attempts.length - 1 && attempt.status === 'running'
              ? { ...attempt, status: 'cancelled' as const }
              : attempt
          ),
        })),
        edges: run.edges.map((edge) => ({
          ...edge,
          status:
            edge.status === 'running'
              ? ('cancelled' as const)
              : edge.status === 'planned'
                ? ('skipped' as const)
                : edge.status,
        })),
      };
    }),
  };
}

function readGlobalJournalEntries(input: {
  stateHome: string;
  runId?: string;
  maxRuns: number;
  maxScopes: number;
  diagnostics: string[];
}): WorkspaceActivityEvent[] {
  let channels: Array<{ path: string; mtimeMs: number }> = [];
  try {
    channels = fs
      .readdirSync(input.stateHome, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const runsPath = path.join(input.stateHome, entry.name, 'runs');
        try {
          return [{ path: runsPath, mtimeMs: fs.statSync(runsPath).mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, Math.min(200, Math.max(16, input.maxScopes * 4)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      input.diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }

  const journals = channels
    .flatMap((channel) => {
      try {
        return fs
          .readdirSync(channel.path, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.endsWith('.ndjson') &&
              (!input.runId || entry.name === `${input.runId}.ndjson`)
          )
          .map((entry) => {
            const filePath = path.join(channel.path, entry.name);
            return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
          });
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, Math.max(input.maxRuns * 4, input.maxScopes * 2));

  const byEventId = new Map<string, WorkspaceActivityEvent>();
  for (const journal of journals) {
    for (const event of readJournal(journal.filePath, input.diagnostics)) {
      if (!byEventId.has(event.eventId)) byEventId.set(event.eventId, event);
    }
  }
  const events = [...byEventId.values()].sort(
    (left, right) => left.timestamp.localeCompare(right.timestamp) || left.sequence - right.sequence
  );
  const newestRunIds = [...new Set([...events].reverse().map((event) => event.runId))].slice(
    0,
    input.maxRuns
  );
  const selectedRunIds = new Set(newestRunIds);
  return events.filter((event) => selectedRunIds.has(event.runId));
}

export function readActivityFleetSnapshot(
  input: {
    runId?: string;
    maxRuns?: number;
    maxScopes?: number;
    maxEvents?: number;
    env?: NodeJS.ProcessEnv;
  } = {}
): ActivityFleetSnapshot {
  const diagnostics: string[] = [];
  const maxRuns = Math.max(1, Math.min(100, input.maxRuns ?? 12));
  const maxScopes = Math.max(1, Math.min(50, input.maxScopes ?? 12));
  let events = readGlobalJournalEntries({
    stateHome: resolveActivityStateHome(input.env),
    runId: input.runId,
    maxRuns,
    maxScopes,
    diagnostics,
  });
  const maxEvents = Math.max(100, Math.min(500_000, input.maxEvents ?? 50_000));
  events = events.slice(-maxEvents);
  const byScope = new Map<
    string,
    { scope: WorkspaceActivityScope; events: WorkspaceActivityEvent[] }
  >();
  for (const event of events) {
    const group = byScope.get(event.scope.id) ?? { scope: event.scope, events: [] };
    group.events.push(event);
    byScope.set(event.scope.id, group);
  }
  const scopes = [...byScope.values()]
    .map((group) =>
      reconcileActivityProcessLiveness(
        projectActivitySnapshot({ resolvedScope: { scope: group.scope }, events: group.events })
      )
    )
    .sort(
      (left, right) =>
        (right.runs[0]?.updatedAt ?? '').localeCompare(left.runs[0]?.updatedAt ?? '') ||
        left.scope.label.localeCompare(right.scope.label)
    )
    .slice(0, maxScopes);
  return {
    schemaVersion: WORKSPACE_ACTIVITY_MONITOR_FLEET_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    scopes,
    diagnostics,
  };
}

export function readActivitySnapshot(
  input: {
    targetPath?: string;
    runId?: string;
    maxRuns?: number;
    maxEvents?: number;
    env?: NodeJS.ProcessEnv;
  } = {}
): ActivityMonitorSnapshot {
  const result = readActivityEvents(input);
  return reconcileActivityProcessLiveness(
    projectActivitySnapshot({
      resolvedScope: result.resolvedScope,
      events: result.events,
      diagnostics: result.diagnostics,
    })
  );
}

export function pruneActivityJournals(
  input: {
    targetPath?: string;
    maxRuns?: number;
    maxAgeDays?: number;
    env?: NodeJS.ProcessEnv;
  } = {}
): number {
  const resolved = resolveActivityScope(input.targetPath ?? process.cwd(), { env: input.env });
  const runsPath = path.join(resolved.statePath, 'runs');
  return pruneActivityJournalDirectory(runsPath, {
    maxRuns: input.maxRuns,
    maxAgeDays: input.maxAgeDays,
  });
}
