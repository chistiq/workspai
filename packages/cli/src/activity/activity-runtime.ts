import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION,
  type EmitWorkspaceActivityEventInput,
  type WorkspaceActivityBlueprint,
  type WorkspaceActivityEvidenceBinding,
  type WorkspaceActivityEvent,
  type WorkspaceActivityStatus,
} from './activity-contract.js';
import {
  resolveActivityOrigin,
  resolveActivityScope,
  toActivityLocator,
  type ResolvedActivityScope,
} from './activity-scope.js';
import {
  DEFAULT_ACTIVITY_RETENTION_RUNS,
  pruneActivityJournalDirectory,
} from './activity-retention.js';

type ActiveActivityRun = {
  runId: string;
  parentRunId?: string;
  command: string[];
  sensitiveValues: string[];
  startedAtMs: number;
  sequence: number;
  fds: number[];
  journalPaths: string[];
  resolvedScope: ResolvedActivityScope;
  rootBlockId?: string;
  blockStatuses: Map<string, WorkspaceActivityStatus>;
  blockAttempts: Map<string, number>;
  finalized: boolean;
};

let activeRun: ActiveActivityRun | null = null;

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|passwd|secret|token|api[-_]?key)/i;

function activityDisabled(command: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (env.WORKSPAI_ACTIVITY_DISABLE === '1') return true;
  const testRuntime = env.VITEST === 'true' || env.VITEST === '1' || env.NODE_ENV === 'test';
  if (testRuntime && env.WORKSPAI_ACTIVITY_FORCE !== '1') return true;
  return command[0] === 'live';
}

function sanitizeValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (depth > 4) return '[TRUNCATED]';
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => sanitizeValue(item, key, depth + 1));
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message) };
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(
      0,
      100
    )) {
      output[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return String(value);
}

function sanitizeString(value: string): string {
  let output = value;
  for (const sensitiveValue of activeRun?.sensitiveValues ?? []) {
    if (sensitiveValue.length >= 3) output = output.split(sensitiveValue).join('[REDACTED]');
  }
  output = output.replace(
    /((?:authorization|cookie|credential|password|passwd|secret|token|api[-_]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1[REDACTED]'
  );
  output = output.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');

  if (activeRun) {
    const observationRootPath = activeRun.resolvedScope.observationRootPath;
    const roots = [observationRootPath, activeRun.resolvedScope.rootPath].sort(
      (left, right) => right.length - left.length
    );
    for (const root of new Set(roots)) {
      output = output.split(root).join('.');
      if (path.sep === '\\') output = output.split(root.replaceAll('\\', '/')).join('.');
    }
    output = output.replace(
      /(^|[\s("'=])((?:[A-Za-z]:[\\/]|\/)(?!\/)[^\s"',;)\]}]+)/g,
      (_match, prefix: string, absolutePath: string) =>
        `${prefix}${toActivityLocator(observationRootPath, absolutePath)}`
    );
  }

  return output.length > 2_000 ? `${output.slice(0, 2_000)}…` : output;
}

function isSensitiveFlag(flag: string, command: readonly string[]): boolean {
  if (!flag.startsWith('-')) return false;
  if (SENSITIVE_KEY.test(flag)) return true;
  const credentialCommand = command.some((token) =>
    /^(?:set|add|update|rotate)-(?:api-)?(?:key|token|secret|password)$/i.test(token)
  );
  return credentialCommand && /^--?key$/i.test(flag);
}

function collectSensitiveCommandValues(command: readonly string[]): string[] {
  const values: string[] = [];
  let redactNext = false;
  for (const argument of command) {
    if (redactNext) {
      if (argument.length > 0) values.push(argument);
      redactNext = false;
      continue;
    }
    const separator = argument.indexOf('=');
    const flag = separator >= 0 ? argument.slice(0, separator) : argument;
    if (!isSensitiveFlag(flag, command)) continue;
    if (separator >= 0) {
      const value = argument.slice(separator + 1);
      if (value.length > 0) values.push(value);
    } else {
      redactNext = true;
    }
  }
  return [...new Set(values)];
}

function sanitizeCommand(command: readonly string[], rootPath: string): string[] {
  let redactNext = false;
  return command.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    const separator = argument.indexOf('=');
    const flag = separator >= 0 ? argument.slice(0, separator) : argument;
    if (isSensitiveFlag(flag, command)) {
      if (separator >= 0) return `${flag}=[REDACTED]`;
      redactNext = true;
      return argument;
    }
    if (path.isAbsolute(argument)) return toActivityLocator(rootPath, argument);
    return argument.length > 300 ? `${argument.slice(0, 300)}…` : argument;
  });
}

function sanitizeAttributes(
  attributes: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!attributes) return undefined;
  return sanitizeValue(attributes) as Record<string, unknown>;
}

function appendEvent(input: EmitWorkspaceActivityEventInput): WorkspaceActivityEvent | null {
  if (!activeRun || activeRun.finalized) return null;
  let attempt: number | undefined;
  if (input.blockId && input.kind.startsWith('block.') && input.kind !== 'block.planned') {
    const previousAttempt = activeRun.blockAttempts.get(input.blockId) ?? 0;
    const previousStatus = activeRun.blockStatuses.get(input.blockId);
    if (input.kind === 'block.started') {
      attempt = previousStatus === 'running' ? Math.max(1, previousAttempt) : previousAttempt + 1;
    } else if (input.kind !== 'block.skipped' || previousAttempt > 0) {
      attempt = Math.max(1, previousAttempt);
    }
  }
  const event: WorkspaceActivityEvent = {
    schemaVersion: WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    sequence: ++activeRun.sequence,
    timestamp: new Date().toISOString(),
    runId: activeRun.runId,
    ...(activeRun.parentRunId ? { parentRunId: activeRun.parentRunId } : {}),
    scope: activeRun.resolvedScope.scope,
    ...input,
    origin: resolveActivityOrigin(activeRun.resolvedScope),
    ...(attempt !== undefined ? { attempt } : {}),
    component: sanitizeString(input.component),
    message: sanitizeString(input.message),
    ...(input.target
      ? {
          target: {
            ...input.target,
            ...(input.target.locator ? { locator: sanitizeString(input.target.locator) } : {}),
            ...(input.target.operation
              ? { operation: sanitizeString(input.target.operation) }
              : {}),
          },
        }
      : {}),
    ...(input.evidenceBindings
      ? {
          evidenceBindings: input.evidenceBindings.slice(0, 100).map((binding) => ({
            ...binding,
            ref: sanitizeString(binding.ref),
            ...(binding.graphSourceHash
              ? { graphSourceHash: sanitizeString(binding.graphSourceHash) }
              : {}),
          })),
        }
      : {}),
    ...(input.attributes ? { attributes: sanitizeAttributes(input.attributes) } : {}),
  };
  const serialized = `${JSON.stringify(event)}\n`;
  let written = false;
  for (const fd of activeRun.fds) {
    try {
      fs.writeSync(fd, serialized);
      written = true;
    } catch {
      // A failed mirror must not stop the primary channel or the command.
    }
  }
  if (written && event.blockId && event.kind.startsWith('block.')) {
    activeRun.blockStatuses.set(event.blockId, event.status);
    if (event.attempt !== undefined) activeRun.blockAttempts.set(event.blockId, event.attempt);
  }
  return written ? event : null;
}

export function initializeActivityRun(input: {
  runId: string;
  command: string[];
  cwd: string;
  rapidkitVersion: string;
  parentRunId?: string;
  blueprint?: WorkspaceActivityBlueprint;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = input.env ?? process.env;
  if (activityDisabled(input.command, env)) return;
  finalizeActivityRun(1, 'Previous in-process activity run was superseded.');

  try {
    const resolvedScope = resolveActivityScope(input.cwd, { env });
    const channelPaths = [resolvedScope.statePath, ...resolvedScope.mirrorStatePaths];
    const journalPaths = channelPaths.map((statePath) => {
      const runsPath = path.join(statePath, 'runs');
      fs.mkdirSync(runsPath, { recursive: true, mode: 0o700 });
      pruneActivityJournalDirectory(runsPath, {
        maxRuns: DEFAULT_ACTIVITY_RETENTION_RUNS - 1,
      });
      return path.join(runsPath, `${input.runId}.ndjson`);
    });
    const fds: number[] = [];
    try {
      for (const journalPath of journalPaths) fds.push(fs.openSync(journalPath, 'a', 0o600));
    } catch (error) {
      for (const fd of fds) {
        try {
          fs.closeSync(fd);
        } catch {
          // Preserve the original open failure.
        }
      }
      throw error;
    }
    const sensitiveValues = collectSensitiveCommandValues(input.command);
    const safeCommand = sanitizeCommand(input.command, resolvedScope.observationRootPath);
    activeRun = {
      runId: input.runId,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      command: safeCommand,
      sensitiveValues,
      startedAtMs: Date.now(),
      sequence: 0,
      fds,
      journalPaths,
      resolvedScope,
      ...(input.blueprint?.nodes[0]?.id ? { rootBlockId: input.blueprint.nodes[0].id } : {}),
      blockStatuses: new Map(),
      blockAttempts: new Map(),
      finalized: false,
    };
    appendEvent({
      kind: 'run.started',
      status: 'running',
      component: 'cli',
      message: safeCommand.length > 0 ? `workspai ${safeCommand.join(' ')}` : 'workspai',
      attributes: {
        command: safeCommand,
        rapidkitVersion: input.rapidkitVersion,
        pid: process.pid,
        blueprintId: input.blueprint?.id,
        blueprintVersion: input.blueprint?.version,
      },
    });
    for (const node of input.blueprint?.nodes ?? []) {
      appendEvent({
        kind: 'block.planned',
        status: 'planned',
        component: 'cli',
        blockId: node.id,
        parentSpanId: node.parentId,
        message: node.label,
        attributes: {
          order: node.order,
          layoutHint: node.layoutHint,
          group: node.group,
        },
        ...(node.evidenceBindings ? { evidenceBindings: node.evidenceBindings } : {}),
      });
    }
    for (const edge of input.blueprint?.edges ?? []) {
      appendEvent({
        kind: 'edge.declared',
        status: 'planned',
        component: 'cli',
        message: `${edge.from} -> ${edge.to}`,
        edge: {
          id: edge.id,
          fromBlockId: edge.from,
          toBlockId: edge.to,
          kind: edge.kind,
        },
        attributes: { order: edge.order },
      });
    }
    if (activeRun.rootBlockId) {
      appendEvent({
        kind: 'block.started',
        status: 'running',
        component: 'cli',
        blockId: activeRun.rootBlockId,
        message: input.blueprint?.nodes[0]?.label ?? 'Workspai command',
      });
    }
  } catch {
    activeRun = null;
  }
}

export function emitWorkspaceActivity(
  input: EmitWorkspaceActivityEventInput
): WorkspaceActivityEvent | null {
  return appendEvent(input);
}

export function emitActivityBlock(input: {
  blockId: string;
  status: WorkspaceActivityStatus;
  message: string;
  component?: string;
  progress?: WorkspaceActivityEvent['progress'];
  attributes?: Record<string, unknown>;
  evidenceBindings?: WorkspaceActivityEvidenceBinding[];
}): WorkspaceActivityEvent | null {
  const kind =
    input.status === 'planned'
      ? 'block.planned'
      : input.status === 'running'
        ? input.progress
          ? 'block.progress'
          : 'block.started'
        : input.status === 'succeeded'
          ? 'block.completed'
          : input.status === 'failed'
            ? 'block.failed'
            : input.status === 'blocked'
              ? 'block.blocked'
              : input.status === 'skipped'
                ? 'block.skipped'
                : 'block.progress';
  return appendEvent({
    kind,
    status: input.status,
    component: input.component ?? 'cli',
    blockId: input.blockId,
    message: input.message,
    ...(input.progress ? { progress: input.progress } : {}),
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(input.evidenceBindings ? { evidenceBindings: input.evidenceBindings } : {}),
  });
}

export async function withActivitySpan<T>(
  input: {
    blockId: string;
    message: string;
    component?: string;
    attributes?: Record<string, unknown>;
    evidenceBindings?: WorkspaceActivityEvidenceBinding[];
  },
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  emitActivityBlock({
    blockId: input.blockId,
    status: 'running',
    message: input.message,
    component: input.component,
    attributes: input.attributes,
    evidenceBindings: input.evidenceBindings,
  });
  try {
    const result = await operation();
    emitWorkspaceActivity({
      kind: 'block.completed',
      status: 'succeeded',
      component: input.component ?? 'cli',
      blockId: input.blockId,
      message: input.message,
      durationMs: Date.now() - startedAt,
      attributes: input.attributes,
      ...(input.evidenceBindings ? { evidenceBindings: input.evidenceBindings } : {}),
    });
    return result;
  } catch (error) {
    emitWorkspaceActivity({
      kind: 'block.failed',
      status: 'failed',
      component: input.component ?? 'cli',
      blockId: input.blockId,
      message: error instanceof Error ? error.message : input.message,
      durationMs: Date.now() - startedAt,
      attributes: { ...(input.attributes ?? {}), error },
      ...(input.evidenceBindings ? { evidenceBindings: input.evidenceBindings } : {}),
    });
    throw error;
  }
}

export function emitActivityArtifact(input: {
  workspacePath: string;
  relativePath: string;
  operation?: string;
  blockId?: string;
}): WorkspaceActivityEvent | null {
  const locator = activeRun
    ? toActivityLocator(
        activeRun.resolvedScope.observationRootPath,
        path.resolve(input.workspacePath, input.relativePath)
      )
    : input.relativePath.replaceAll('\\', '/');
  const activeStageIds = activeRun
    ? [...activeRun.blockStatuses.entries()]
        .filter(([blockId, status]) => blockId !== activeRun?.rootBlockId && status === 'running')
        .map(([blockId]) => blockId)
    : [];
  const blockId = input.blockId ?? (activeStageIds.length === 1 ? activeStageIds[0] : undefined);
  return appendEvent({
    kind: 'artifact.published',
    status: 'succeeded',
    component: 'artifact-store',
    message: `Published ${locator}`,
    ...(blockId ? { blockId } : {}),
    target: {
      kind: 'artifact',
      locator,
      operation: input.operation ?? 'publish',
      provenance: 'authoritative',
    },
    evidenceBindings: [
      {
        kind: 'artifact',
        ref: locator,
        role: 'output',
        provenance: 'authoritative',
      },
    ],
  });
}

export function emitActivityTouch(input: {
  targetPath: string;
  operation: string;
  status?: WorkspaceActivityStatus;
  provenance?: 'authoritative' | 'observed' | 'inferred';
  message?: string;
}): WorkspaceActivityEvent | null {
  if (!activeRun) return null;
  const locator = toActivityLocator(activeRun.resolvedScope.observationRootPath, input.targetPath);
  return appendEvent({
    kind: input.status === 'planned' ? 'touch.planned' : 'touch.observed',
    status: input.status ?? 'succeeded',
    component: 'filesystem',
    message: input.message ?? `${input.operation} ${locator}`,
    target: {
      kind: 'file',
      locator,
      operation: input.operation,
      provenance: input.provenance ?? 'authoritative',
    },
  });
}

export function finalizeActivityRun(exitCode: number, message?: string): void {
  if (!activeRun || activeRun.finalized) return;
  const run = activeRun;
  const durationMs = Date.now() - run.startedAtMs;
  for (const [blockId, status] of [...run.blockStatuses.entries()]) {
    if (blockId === run.rootBlockId || (status !== 'planned' && status !== 'running')) continue;
    const wasStarted = status === 'running';
    const cancelled = exitCode === 130 || exitCode === 143;
    appendEvent({
      kind: !wasStarted
        ? 'block.skipped'
        : exitCode === 0
          ? 'block.completed'
          : cancelled
            ? 'block.blocked'
            : 'block.failed',
      status: !wasStarted
        ? 'skipped'
        : exitCode === 0
          ? 'succeeded'
          : cancelled
            ? 'cancelled'
            : 'failed',
      component: 'cli',
      blockId,
      message: !wasStarted
        ? 'Stage was not entered'
        : exitCode === 0
          ? 'Stage completed with command'
          : (message ?? `Stage interrupted by command exit ${exitCode}`),
      durationMs,
      attributes: { finalizedByRun: true },
    });
  }
  if (run.rootBlockId) {
    appendEvent({
      kind:
        exitCode === 0
          ? 'block.completed'
          : exitCode === 130 || exitCode === 143
            ? 'block.blocked'
            : 'block.failed',
      status:
        exitCode === 0
          ? 'succeeded'
          : exitCode === 130 || exitCode === 143
            ? 'cancelled'
            : 'failed',
      component: 'cli',
      blockId: run.rootBlockId,
      message:
        message ?? (exitCode === 0 ? 'Command completed' : `Command exited with code ${exitCode}`),
      durationMs,
    });
  }
  appendEvent({
    kind:
      exitCode === 0
        ? 'run.completed'
        : exitCode === 130 || exitCode === 143
          ? 'run.cancelled'
          : 'run.failed',
    status:
      exitCode === 0 ? 'succeeded' : exitCode === 130 || exitCode === 143 ? 'cancelled' : 'failed',
    component: 'cli',
    message:
      message ?? (exitCode === 0 ? 'CLI run completed' : `CLI run exited with code ${exitCode}`),
    durationMs,
    attributes: { exitCode },
  });
  run.finalized = true;
  for (const fd of run.fds) {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed during abrupt shutdown.
    }
  }
  activeRun = null;
}

export function getActiveActivityRun(): Readonly<ActiveActivityRun> | null {
  return activeRun;
}

export function resetActivityRuntimeForTests(): void {
  if (activeRun) {
    for (const fd of activeRun.fds) {
      try {
        fs.closeSync(fd);
      } catch {
        // Test cleanup is best effort.
      }
    }
  }
  activeRun = null;
}
