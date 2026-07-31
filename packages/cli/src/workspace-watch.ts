import fs from 'node:fs';

import { computeInputsHash } from './contracts/freshness-metadata-contract.js';
import { computeProjectOwnHashes } from './workspace-graph-freshness.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import {
  buildWorkspaceModelIncremental,
  workspaceModelProjectTopology,
  type BuildWorkspaceModelOptions,
  type WorkspaceModel,
  type WorkspaceModelIncrementalMode,
} from './workspace-model.js';

/**
 * Watch / daemon mode (roadmap 1.17).
 *
 * Keeps the workspace model + dependency graph in memory and, on every settled
 * filesystem change, performs a graph-aware **incremental** rebuild (reusing the
 * 1.15/1.16 cache) and emits a deterministic change event describing what moved:
 * which projects changed/added/removed, which graph edges appeared/disappeared,
 * and whether the structural model hash changed.
 *
 * The engine (pure-ish, injectable `rebuild`) is decoupled from the OS watcher so
 * it is fully unit-testable without a real `fs.watch`; the CLI adapter
 * (`runWorkspaceWatch`) wires Node's built-in recursive watcher (Node 20+, works
 * on Linux/macOS/Windows — no extra dependency) with debouncing and graceful
 * shutdown.
 */

export const WORKSPACE_WATCH_EVENT_SCHEMA_VERSION = 'workspace-watch-event.v1' as const;

export type WorkspaceWatchEventKind = 'ready' | 'changed' | 'unchanged' | 'error';

export type WorkspaceWatchGraphEdgeRef = {
  from: string;
  to: string;
  kind: string;
};

export type WorkspaceWatchEvent = {
  schemaVersion: typeof WORKSPACE_WATCH_EVENT_SCHEMA_VERSION;
  kind: WorkspaceWatchEventKind;
  sequence: number;
  timestamp: string;
  mode: WorkspaceModelIncrementalMode | 'initial';
  modelHash: string;
  modelHashChanged: boolean;
  changedProjects: string[];
  addedProjects: string[];
  removedProjects: string[];
  graph: {
    nodeCount: number;
    edgeCount: number;
    edgesAdded: WorkspaceWatchGraphEdgeRef[];
    edgesRemoved: WorkspaceWatchGraphEdgeRef[];
  };
  durationMs: number;
  error?: string;
};

function validatedWorkspaceWatchEvent(event: WorkspaceWatchEvent): WorkspaceWatchEvent {
  assertJsonSchemaContract(
    event,
    'contracts/workspace-watch-event.v1.json',
    'Workspace watch event'
  );
  return event;
}

function edgeKey(edge: WorkspaceWatchGraphEdgeRef): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
}

function modelEdges(model: WorkspaceModel): WorkspaceWatchGraphEdgeRef[] {
  return (workspaceModelProjectTopology(model)?.edges ?? []).map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
  }));
}

/**
 * Deterministic, content-addressed structural hash of the model (project own
 * hashes + sorted graph edges). Ignores timestamps so it only changes when the
 * structure changes.
 */
export function computeWatchModelHash(model: WorkspaceModel): string {
  const ownHashes = computeProjectOwnHashes(model);
  const projects = [...ownHashes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, hash]) => ({ id, hash }));
  const edges = modelEdges(model)
    .map(edgeKey)
    .sort((a, b) => a.localeCompare(b));
  return computeInputsHash({ projects, edges });
}

export function diffWatchModels(
  previous: WorkspaceModel | null,
  next: WorkspaceModel
): {
  changedProjects: string[];
  addedProjects: string[];
  removedProjects: string[];
  edgesAdded: WorkspaceWatchGraphEdgeRef[];
  edgesRemoved: WorkspaceWatchGraphEdgeRef[];
} {
  const nextHashes = computeProjectOwnHashes(next);
  const prevHashes = previous ? computeProjectOwnHashes(previous) : new Map<string, string>();

  const changedProjects: string[] = [];
  const addedProjects: string[] = [];
  for (const [id, hash] of nextHashes.entries()) {
    if (!prevHashes.has(id)) {
      addedProjects.push(id);
    } else if (prevHashes.get(id) !== hash) {
      changedProjects.push(id);
    }
  }
  const removedProjects: string[] = [];
  for (const id of prevHashes.keys()) {
    if (!nextHashes.has(id)) {
      removedProjects.push(id);
    }
  }

  const prevEdges = new Map(previous ? modelEdges(previous).map((e) => [edgeKey(e), e]) : []);
  const nextEdges = new Map(modelEdges(next).map((e) => [edgeKey(e), e]));
  const edgesAdded: WorkspaceWatchGraphEdgeRef[] = [];
  for (const [key, edge] of nextEdges.entries()) {
    if (!prevEdges.has(key)) edgesAdded.push(edge);
  }
  const edgesRemoved: WorkspaceWatchGraphEdgeRef[] = [];
  for (const [key, edge] of prevEdges.entries()) {
    if (!nextEdges.has(key)) edgesRemoved.push(edge);
  }

  const edgeComparator = (a: WorkspaceWatchGraphEdgeRef, b: WorkspaceWatchGraphEdgeRef): number =>
    edgeKey(a).localeCompare(edgeKey(b));
  changedProjects.sort((a, b) => a.localeCompare(b));
  addedProjects.sort((a, b) => a.localeCompare(b));
  removedProjects.sort((a, b) => a.localeCompare(b));
  edgesAdded.sort(edgeComparator);
  edgesRemoved.sort(edgeComparator);

  return { changedProjects, addedProjects, removedProjects, edgesAdded, edgesRemoved };
}

export type WorkspaceWatchRebuild = () => Promise<{
  model: WorkspaceModel;
  mode: WorkspaceModelIncrementalMode;
}>;

export type WorkspaceWatchEngineOptions = {
  /** Injectable rebuild; defaults to the graph-aware incremental builder. */
  rebuild?: WorkspaceWatchRebuild;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
};

/**
 * In-memory model+graph holder. `start()` performs the initial build (a `ready`
 * event) and `pulse()` performs an incremental rebuild + diff (a `changed` or
 * `unchanged` event). Decoupled from any OS watcher for testability.
 */
export class WorkspaceWatchEngine {
  private model: WorkspaceModel | null = null;
  private sequence = 0;
  private readonly rebuild: WorkspaceWatchRebuild;
  private readonly now: () => Date;

  constructor(buildOptions: BuildWorkspaceModelOptions, options?: WorkspaceWatchEngineOptions) {
    this.rebuild = options?.rebuild ?? (() => buildWorkspaceModelIncremental({ ...buildOptions }));
    this.now = options?.now ?? (() => new Date());
  }

  get currentModel(): WorkspaceModel | null {
    return this.model;
  }

  async start(): Promise<WorkspaceWatchEvent> {
    const startedAt = Date.now();
    const { model } = await this.rebuild();
    this.model = model;
    const event = this.buildEvent('ready', 'initial', null, model, Date.now() - startedAt);
    return event;
  }

  async pulse(): Promise<WorkspaceWatchEvent> {
    const startedAt = Date.now();
    const previous = this.model;
    const { model, mode } = await this.rebuild();
    const event = this.buildEvent(
      this.hasStructuralChange(previous, model) ? 'changed' : 'unchanged',
      mode,
      previous,
      model,
      Date.now() - startedAt
    );
    this.model = model;
    return event;
  }

  private hasStructuralChange(previous: WorkspaceModel | null, next: WorkspaceModel): boolean {
    if (!previous) return true;
    return computeWatchModelHash(previous) !== computeWatchModelHash(next);
  }

  private buildEvent(
    kind: WorkspaceWatchEventKind,
    mode: WorkspaceModelIncrementalMode | 'initial',
    previous: WorkspaceModel | null,
    next: WorkspaceModel,
    durationMs: number
  ): WorkspaceWatchEvent {
    const diff = diffWatchModels(previous, next);
    const modelHash = computeWatchModelHash(next);
    const modelHashChanged = previous ? computeWatchModelHash(previous) !== modelHash : true;
    return validatedWorkspaceWatchEvent({
      schemaVersion: WORKSPACE_WATCH_EVENT_SCHEMA_VERSION,
      kind,
      sequence: this.sequence++,
      timestamp: this.now().toISOString(),
      mode,
      modelHash,
      modelHashChanged,
      changedProjects: diff.changedProjects,
      addedProjects: diff.addedProjects,
      removedProjects: diff.removedProjects,
      graph: {
        nodeCount: next.graph?.nodes.length ?? 0,
        edgeCount: next.graph?.edges.length ?? 0,
        edgesAdded: diff.edgesAdded,
        edgesRemoved: diff.edgesRemoved,
      },
      durationMs,
    });
  }
}

/** Directory segments whose changes must never trigger a rebuild (avoids feedback loops). */
const WATCH_IGNORED_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'htmlcov',
  '.next',
  '.turbo',
  '.cache',
]);

/**
 * Generated `.workspai`/legacy `.rapidkit` output subdirectories. These must be ignored (the model
 * cache lives here and rewriting it would loop), but bare project markers like
 * `.rapidkit/project.json` / `.rapidkit/workspace.json` MUST still trigger a
 * rebuild — so we ignore by subdirectory rather than blanket-ignoring `.rapidkit`.
 */
const WORKSPAI_GENERATED_SUBDIRS = new Set(['reports', 'cache', 'tmp', '.cache']);

export function isWatchRelevantPath(relativePath: string): boolean {
  if (!relativePath) return false;
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (
    segments.some(
      (segment) =>
        WATCH_IGNORED_SEGMENTS.has(segment) || isPythonVirtualEnvironmentDirectory(segment)
    )
  ) {
    return false;
  }
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (
      (segments[i] === '.workspai' || segments[i] === '.rapidkit') &&
      WORKSPAI_GENERATED_SUBDIRS.has(segments[i + 1])
    ) {
      return false;
    }
  }
  return true;
}

export type RunWorkspaceWatchOptions = {
  workspacePath: string;
  buildOptions: BuildWorkspaceModelOptions;
  emit: (event: WorkspaceWatchEvent) => void;
  /** Receives the authoritative in-memory model after each emitted watch event. */
  onModel?: (model: WorkspaceModel, event: WorkspaceWatchEvent) => void | Promise<void>;
  onProgress?: (message: string) => void;
  /** Debounce window for coalescing bursts of FS events (ms). */
  debounceMs?: number;
  /** Window after a rebuild during which FS events are ignored (self-write guard, ms). */
  selfWriteSuppressionMs?: number;
  /** When true, perform the initial build and return immediately (no watcher). */
  once?: boolean;
  /** Abort signal for graceful shutdown (SIGINT). */
  signal?: AbortSignal;
  engineOptions?: WorkspaceWatchEngineOptions;
};

/**
 * CLI adapter: builds the initial model, then watches the workspace with Node's
 * built-in recursive watcher, debouncing bursts and emitting a change event after
 * each settled batch. Resolves when `once` is set or the abort signal fires.
 */
export async function runWorkspaceWatch(options: RunWorkspaceWatchOptions): Promise<void> {
  const engine = new WorkspaceWatchEngine(options.buildOptions, options.engineOptions);
  const ready = await engine.start();
  options.emit(ready);
  if (engine.currentModel) {
    await options.onModel?.(engine.currentModel, ready);
  }

  if (options.once) {
    return;
  }

  const debounceMs = options.debounceMs ?? 250;
  // Incremental rebuilds write the model cache back into the workspace tree, which
  // would otherwise re-trigger the watcher in a tight loop. Ignore FS events for a
  // short window after each rebuild settles. This is platform-independent (robust
  // even where `fs.watch` reports only a basename and the path filter can't help).
  const selfWriteSuppressionMs = options.selfWriteSuppressionMs ?? Math.max(400, debounceMs + 150);
  let timer: NodeJS.Timeout | null = null;
  let pulsing = false;
  let pending = false;
  let suppressEventsUntil = 0;

  const runPulse = async (): Promise<void> => {
    if (pulsing) {
      pending = true;
      return;
    }
    pulsing = true;
    try {
      const event = await engine.pulse();
      options.emit(event);
      if (engine.currentModel) {
        await options.onModel?.(engine.currentModel, event);
      }
    } catch (error) {
      options.emit(
        validatedWorkspaceWatchEvent({
          schemaVersion: WORKSPACE_WATCH_EVENT_SCHEMA_VERSION,
          kind: 'error',
          sequence: -1,
          timestamp: new Date().toISOString(),
          mode: 'full',
          modelHash: engine.currentModel ? computeWatchModelHash(engine.currentModel) : '',
          modelHashChanged: false,
          changedProjects: [],
          addedProjects: [],
          removedProjects: [],
          graph: { nodeCount: 0, edgeCount: 0, edgesAdded: [], edgesRemoved: [] },
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      pulsing = false;
      // Start the self-write suppression window after the rebuild (and its cache
      // write) has settled.
      suppressEventsUntil = Date.now() + selfWriteSuppressionMs;
      if (pending) {
        pending = false;
        void runPulse();
      }
    }
  };

  const schedule = (relativePath: string): void => {
    if (!isWatchRelevantPath(relativePath)) {
      return;
    }
    if (pulsing || Date.now() < suppressEventsUntil) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void runPulse();
    }, debounceMs);
  };

  options.onProgress?.(`Watching ${options.workspacePath} for changes (Ctrl+C to stop).`);

  const watcher = fs.watch(options.workspacePath, { recursive: true }, (_eventType, filename) => {
    if (typeof filename === 'string') {
      schedule(filename);
    } else if (filename) {
      schedule(Buffer.from(filename).toString('utf8'));
    }
  });

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.close();
      resolve();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        stop();
        return;
      }
      options.signal.addEventListener('abort', stop, { once: true });
    }
    watcher.on('error', () => stop());
  });
}
