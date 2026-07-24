import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceWatchEngine,
  diffWatchModels,
  computeWatchModelHash,
  isWatchRelevantPath,
  runWorkspaceWatch,
  WORKSPACE_WATCH_EVENT_SCHEMA_VERSION,
} from '../workspace-watch.js';
import type { WorkspaceModel, WorkspaceModelIncrementalMode } from '../workspace-model.js';
import type { WorkspaceGraphEdge } from '../contracts/workspace-dependency-graph-contract.js';

function edge(from: string, to: string): WorkspaceGraphEdge {
  return { from, to, kind: 'package-dep', source: 'inferred', confidence: 'high', evidence: [] };
}

function model(
  projects: Array<Record<string, unknown>>,
  edges: WorkspaceGraphEdge[]
): WorkspaceModel {
  return {
    projects,
    graph: {
      schemaVersion: 'workspace-dependency-graph.v1',
      generatedAt: '2026-06-22T00:00:00.000Z',
      nodes: projects.map((p) => ({ id: p.name as string, path: p.name as string })),
      edges,
      stats: {
        nodeCount: projects.length,
        edgeCount: edges.length,
        inferredEdges: edges.length,
        contractEdges: 0,
        manualEdges: 0,
        hasCycle: false,
      },
    },
  } as unknown as WorkspaceModel;
}

function project(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, path: name, kind: 'service', runtime: 'node', framework: 'unknown', ...extra };
}

/** Build a fake rebuild that yields a queue of models with explicit modes. */
function fakeRebuild(
  sequence: Array<{ model: WorkspaceModel; mode: WorkspaceModelIncrementalMode }>
) {
  let i = 0;
  return async () => sequence[Math.min(i++, sequence.length - 1)];
}

describe('workspace watch engine (1.17)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('emits a ready event with the initial in-memory model', async () => {
    const initial = model([project('api'), project('core')], [edge('api', 'core')]);
    const engine = new WorkspaceWatchEngine(
      { workspacePath: '/tmp/ws' },
      {
        rebuild: fakeRebuild([{ model: initial, mode: 'full' }]),
        now: () => new Date('2026-06-22T00:00:00.000Z'),
      }
    );
    const ready = await engine.start();
    expect(ready.schemaVersion).toBe(WORKSPACE_WATCH_EVENT_SCHEMA_VERSION);
    expect(ready.kind).toBe('ready');
    expect(ready.mode).toBe('initial');
    expect(ready.graph.nodeCount).toBe(2);
    expect(ready.graph.edgeCount).toBe(1);
    expect(ready.modelHashChanged).toBe(true);
    expect(engine.currentModel).toBe(initial);
  });

  it('publishes the authoritative model to adapters after the ready event', async () => {
    const initial = model([project('api')], []);
    const onModel = vi.fn();
    await runWorkspaceWatch({
      workspacePath: '/tmp/ws',
      buildOptions: { workspacePath: '/tmp/ws' },
      once: true,
      emit: vi.fn(),
      onModel,
      engineOptions: {
        rebuild: fakeRebuild([{ model: initial, mode: 'full' }]),
      },
    });
    expect(onModel).toHaveBeenCalledWith(initial, expect.objectContaining({ kind: 'ready' }));
  });

  it('emits a changed event when a project content changes', async () => {
    const before = model([project('api'), project('core')], [edge('api', 'core')]);
    const after = model(
      [project('api'), project('core', { framework: 'changed' })],
      [edge('api', 'core')]
    );
    const engine = new WorkspaceWatchEngine(
      { workspacePath: '/tmp/ws' },
      {
        rebuild: fakeRebuild([
          { model: before, mode: 'full' },
          { model: after, mode: 'incremental' },
        ]),
      }
    );
    await engine.start();
    const event = await engine.pulse();
    expect(event.kind).toBe('changed');
    expect(event.mode).toBe('incremental');
    expect(event.changedProjects).toEqual(['core']);
    expect(event.modelHashChanged).toBe(true);
    expect(event.sequence).toBe(1);
  });

  it('emits unchanged when nothing structural moved', async () => {
    const same = model([project('api'), project('core')], [edge('api', 'core')]);
    const engine = new WorkspaceWatchEngine(
      { workspacePath: '/tmp/ws' },
      {
        rebuild: fakeRebuild([
          { model: same, mode: 'full' },
          { model: same, mode: 'unchanged' },
        ]),
      }
    );
    await engine.start();
    const event = await engine.pulse();
    expect(event.kind).toBe('unchanged');
    expect(event.changedProjects).toEqual([]);
    expect(event.modelHashChanged).toBe(false);
  });

  it('detects added/removed projects and graph edge deltas', () => {
    const before = model([project('api'), project('core')], [edge('api', 'core')]);
    const after = model(
      [project('api'), project('core'), project('web')],
      [edge('api', 'core'), edge('web', 'api')]
    );
    const diff = diffWatchModels(before, after);
    expect(diff.addedProjects).toEqual(['web']);
    expect(diff.removedProjects).toEqual([]);
    expect(diff.edgesAdded).toEqual([{ from: 'web', to: 'api', kind: 'package-dep' }]);
    expect(diff.edgesRemoved).toEqual([]);

    const removed = diffWatchModels(after, before);
    expect(removed.removedProjects).toEqual(['web']);
    expect(removed.edgesRemoved).toEqual([{ from: 'web', to: 'api', kind: 'package-dep' }]);
  });

  it('model hash is deterministic and structure-only', () => {
    const a = model([project('api'), project('core')], [edge('api', 'core')]);
    const b = model([project('core'), project('api')], [edge('api', 'core')]);
    // Same structure, different ordering / no timestamps → identical hash.
    expect(computeWatchModelHash(a)).toBe(computeWatchModelHash(b));
  });

  it('ignores generated outputs but keeps project markers relevant', () => {
    expect(isWatchRelevantPath('')).toBe(false);
    expect(isWatchRelevantPath('services/api/src/main.ts')).toBe(true);
    expect(isWatchRelevantPath('.workspai/reports/workspace-model-cache.json')).toBe(false);
    expect(isWatchRelevantPath('node_modules/foo/index.js')).toBe(false);
    expect(isWatchRelevantPath('web/dist/bundle.js')).toBe(false);
    expect(isWatchRelevantPath('.git/HEAD')).toBe(false);
    // Project + workspace markers DO change the model and must trigger rebuilds.
    expect(isWatchRelevantPath('services/api/.rapidkit/project.json')).toBe(true);
    expect(isWatchRelevantPath('.rapidkit/workspace.json')).toBe(true);
    expect(isWatchRelevantPath('service\\coverage\\report.json')).toBe(false);
  });

  it('supports one-shot mode without opening an OS watcher', async () => {
    const initial = model([project('api')], []);
    const emit = vi.fn();
    const watchSpy = vi.spyOn(fs, 'watch');

    await runWorkspaceWatch({
      workspacePath: '/tmp/ws',
      buildOptions: { workspacePath: '/tmp/ws' },
      emit,
      once: true,
      engineOptions: { rebuild: fakeRebuild([{ model: initial, mode: 'full' }]) },
    });

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready', sequence: 0 }));
    expect(watchSpy).not.toHaveBeenCalled();
  });

  it('debounces relevant filesystem events, emits changes, and shuts down on abort', async () => {
    vi.useFakeTimers();
    const before = model([project('api')], []);
    const after = model([project('api'), project('web')], [edge('web', 'api')]);
    const emitter = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    emitter.close = vi.fn();
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
    vi.spyOn(fs, 'watch').mockImplementation(((_path, _options, listener) => {
      watchCallback = listener as typeof watchCallback;
      return emitter as never;
    }) as typeof fs.watch);
    const controller = new AbortController();
    const emit = vi.fn();
    const progress = vi.fn();
    const running = runWorkspaceWatch({
      workspacePath: '/tmp/ws',
      buildOptions: { workspacePath: '/tmp/ws' },
      emit,
      onProgress: progress,
      debounceMs: 5,
      selfWriteSuppressionMs: 0,
      signal: controller.signal,
      engineOptions: {
        rebuild: fakeRebuild([
          { model: before, mode: 'full' },
          { model: after, mode: 'incremental' },
        ]),
      },
    });
    await vi.waitFor(() => expect(watchCallback).toBeTypeOf('function'));

    watchCallback?.('change', 'node_modules/ignored.js');
    watchCallback?.('change', Buffer.from('services/api/src/main.ts'));
    watchCallback?.('change', 'services/api/src/other.ts');
    await vi.advanceTimersByTimeAsync(6);
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'changed', sequence: 1 }))
    );
    controller.abort();
    await running;

    expect(progress).toHaveBeenCalledWith(expect.stringContaining('Watching /tmp/ws'));
    expect(emitter.close).toHaveBeenCalledOnce();
  });

  it('emits a schema-valid error event when an incremental rebuild fails', async () => {
    vi.useFakeTimers();
    const initial = model([project('api')], []);
    const emitter = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    emitter.close = vi.fn();
    let watchCallback: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
    vi.spyOn(fs, 'watch').mockImplementation(((_path, _options, listener) => {
      watchCallback = listener as typeof watchCallback;
      return emitter as never;
    }) as typeof fs.watch);
    const rebuild = vi
      .fn()
      .mockResolvedValueOnce({ model: initial, mode: 'full' })
      .mockRejectedValueOnce('incremental failure');
    const controller = new AbortController();
    const emit = vi.fn();
    const running = runWorkspaceWatch({
      workspacePath: '/tmp/ws',
      buildOptions: { workspacePath: '/tmp/ws' },
      emit,
      debounceMs: 1,
      selfWriteSuppressionMs: 0,
      signal: controller.signal,
      engineOptions: { rebuild },
    });
    await vi.waitFor(() => expect(watchCallback).toBeTypeOf('function'));
    watchCallback?.('change', 'services/api/package.json');
    await vi.advanceTimersByTimeAsync(2);
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', error: 'incremental failure', sequence: -1 })
      )
    );
    emitter.emit('error', new Error('watcher closed'));
    await running;
    expect(emitter.close).toHaveBeenCalledOnce();
  });
});
