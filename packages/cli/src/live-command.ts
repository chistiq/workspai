import path from 'node:path';

import {
  pruneActivityJournals,
  readActivityFleetSnapshot,
  readActivityEvents,
  readActivitySnapshot,
  projectActivityReplayFrame,
  type ActivityMonitorView,
} from './activity/activity-monitor.js';
import {
  activityBoardHasMotion,
  activityBoardVisibleRunIds,
  buildActivityBoardModel,
  type ActivityBoardModel,
} from './activity/activity-board.js';
import {
  renderActivityTerminal,
  type ActivityTerminalRenderOptions,
} from './activity/activity-terminal.js';
import {
  writeActivityCapture,
  type ActivityCapturePreset,
  type ActivityCaptureTheme,
} from './activity/activity-capture.js';

export type LiveCommandOptions = {
  targetPath?: string;
  runId?: string;
  once?: boolean;
  json?: boolean;
  projection?: 'monitor' | 'board';
  refreshMs?: number;
  maxRuns?: number;
  classic?: boolean;
  color?: boolean;
  motion?: boolean;
  ascii?: boolean;
  accessible?: boolean;
  global?: boolean;
  maxScopes?: number;
  capturePath?: string;
  capturePreset?: ActivityCapturePreset;
  captureTheme?: ActivityCaptureTheme;
  captureRedact?: boolean;
  replayRunId?: string;
  replaySpeed?: number;
};

export function projectLiveJsonOutput(
  snapshot: ActivityMonitorView,
  options: Pick<LiveCommandOptions, 'projection' | 'runId' | 'maxRuns'> = {}
): ActivityMonitorView | ActivityBoardModel {
  if (options.projection !== 'board') return snapshot;
  return buildActivityBoardModel(snapshot, {
    selectedRunId: options.runId,
    maxRuns: Math.max(1, Math.min(50, options.maxRuns ?? 6)),
  });
}

type LiveInteractionState = {
  selectedRunId?: string;
  selectionPinned: boolean;
  focused: boolean;
  activeOnly: boolean;
  inspector: boolean;
  dirty: boolean;
};

export function activitySnapshotComparisonKey(snapshot: ActivityMonitorView): string {
  return JSON.stringify(
    snapshot.schemaVersion === 'workspace-activity-monitor-fleet.v1'
      ? {
          ...snapshot,
          generatedAt: '',
          scopes: snapshot.scopes.map((scope) => ({ ...scope, generatedAt: '' })),
        }
      : { ...snapshot, generatedAt: '' }
  );
}

export function renderActivityScreenDiff(
  previousLines: readonly string[],
  nextFrame: string,
  options: { force?: boolean; height?: number } = {}
): { output: string; lines: string[] } {
  const height = Math.max(1, options.height ?? process.stdout.rows ?? 28);
  const nextLines = nextFrame.split('\n').slice(0, height);
  const rowCount = Math.min(height, Math.max(previousLines.length, nextLines.length));
  let output = options.force ? '\x1b[2J' : '';
  let changed = options.force === true;
  for (let index = 0; index < rowCount; index += 1) {
    const next = nextLines[index] ?? '';
    if (!options.force && previousLines[index] === next) continue;
    changed = true;
    output += `\x1b[${index + 1};1H\x1b[2K${next}`;
  }
  if (changed) output += `\x1b[${Math.min(height, nextLines.length + 1)};1H`;
  return { output, lines: nextLines };
}

function visibleRunIds(
  snapshot: ActivityMonitorView,
  state: LiveInteractionState,
  maxRuns: number
): string[] {
  return activityBoardVisibleRunIds(
    buildActivityBoardModel(snapshot, {
      selectedRunId: state.selectedRunId,
      activeOnly: state.activeOnly,
      maxRuns,
    })
  );
}

function normalizeSelection(
  snapshot: ActivityMonitorView,
  state: LiveInteractionState,
  maxRuns: number
): void {
  const model = buildActivityBoardModel(snapshot, {
    selectedRunId: state.selectionPinned ? state.selectedRunId : undefined,
    activeOnly: state.activeOnly,
    maxRuns,
  });
  state.selectedRunId = model.selectedRunId;
}

function moveSelection(
  direction: -1 | 1,
  snapshot: ActivityMonitorView,
  state: LiveInteractionState,
  maxRuns: number
): void {
  const ids = visibleRunIds(snapshot, state, maxRuns);
  if (ids.length === 0) return;
  const current = Math.max(0, ids.indexOf(state.selectedRunId ?? ''));
  state.selectedRunId = ids[(current + direction + ids.length) % ids.length];
  state.selectionPinned = true;
  state.dirty = true;
}

function installKeyboardControls(input: {
  snapshot: () => ActivityMonitorView;
  state: LiveInteractionState;
  maxRuns: number;
  stop: () => void;
}): (() => void) | null {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return null;
  const previousRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();
  const onData = (chunk: Buffer | string) => {
    const key = chunk.toString();
    if (key === '\u0003' || key.toLowerCase() === 'q') {
      input.stop();
      return;
    }
    if (key === '\x1b[A' || key === '\x1b[D' || key.toLowerCase() === 'k') {
      moveSelection(-1, input.snapshot(), input.state, input.maxRuns);
      return;
    }
    if (key === '\x1b[B' || key === '\x1b[C' || key.toLowerCase() === 'j') {
      moveSelection(1, input.snapshot(), input.state, input.maxRuns);
      return;
    }
    if (key === '\r' || key === '\n') {
      input.state.focused = !input.state.focused;
      if (input.state.focused) input.state.selectionPinned = true;
      input.state.dirty = true;
      return;
    }
    if (key.toLowerCase() === 'f') {
      input.state.activeOnly = !input.state.activeOnly;
      normalizeSelection(input.snapshot(), input.state, input.maxRuns);
      input.state.dirty = true;
      return;
    }
    if (key === '\t' || key.toLowerCase() === 'i') {
      input.state.inspector = !input.state.inspector;
      input.state.dirty = true;
    }
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  return () => {
    stdin.removeListener('data', onData);
    stdin.setRawMode(previousRaw === true);
    if (wasPaused) stdin.pause();
  };
}

async function runActivityReplay(input: {
  targetPath: string;
  runId: string;
  speed: number;
  maxRuns: number;
  options: LiveCommandOptions;
}): Promise<ActivityMonitorView> {
  const replay = readActivityEvents({
    targetPath: input.targetPath,
    runId: input.runId,
    maxRuns: input.maxRuns,
  });
  if (replay.events.length === 0) {
    throw new Error(`No activity journal found for run ${input.runId}.`);
  }
  const project = (index: number) =>
    projectActivityReplayFrame({
      resolvedScope: replay.resolvedScope,
      events: replay.events,
      eventCount: index + 1,
      diagnostics: replay.diagnostics,
    });
  const finalSnapshot = project(replay.events.length - 1);
  if (
    input.options.once ||
    input.options.json ||
    input.options.accessible ||
    input.options.classic ||
    !process.stdout.isTTY ||
    !process.stdin.isTTY
  ) {
    process.stdout.write(
      input.options.json
        ? `${JSON.stringify(projectLiveJsonOutput(finalSnapshot, input.options), null, 2)}\n`
        : `${renderActivityTerminal(finalSnapshot, {
            width: process.stdout.columns,
            height: process.stdout.rows,
            maxRuns: input.maxRuns,
            selectedRunId: input.runId,
            color: input.options.color,
            motion: false,
            ascii: input.options.ascii,
            accessible: input.options.accessible,
            classic: input.options.classic,
          })}\n`
    );
    return finalSnapshot;
  }

  let index = 0;
  let paused = false;
  let stopping = false;
  let dirty = true;
  let previousLines: string[] = [];
  const stdin = process.stdin;
  const previousRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();
  const onData = (chunk: Buffer | string) => {
    const key = chunk.toString();
    if (key === '\u0003' || key.toLowerCase() === 'q') stopping = true;
    else if (key === ' ') paused = !paused;
    else if (key === '\x1b[C' || key === '.') {
      index = Math.min(replay.events.length - 1, index + 1);
      paused = true;
    } else if (key === '\x1b[D' || key === ',') {
      index = Math.max(0, index - 1);
      paused = true;
    }
    dirty = true;
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  try {
    while (!stopping) {
      if (index >= replay.events.length - 1 && !paused) {
        paused = true;
        dirty = true;
      }
      const snapshot = project(index);
      if (dirty) {
        const rendered = renderActivityTerminal(snapshot, {
          width: process.stdout.columns,
          height: process.stdout.rows,
          maxRuns: input.maxRuns,
          selectedRunId: input.runId,
          focused: true,
          frame: index,
          color: input.options.color,
          motion: input.options.motion,
          ascii: input.options.ascii,
          accessible: input.options.accessible,
          classic: input.options.classic,
          inspector: true,
          interactive: true,
          replay: { index: index + 1, total: replay.events.length, paused, speed: input.speed },
        });
        const diff = renderActivityScreenDiff(previousLines, rendered, {
          force: previousLines.length === 0,
          height: process.stdout.rows,
        });
        if (diff.output) process.stdout.write(diff.output);
        previousLines = diff.lines;
        dirty = false;
      }
      if (paused || index >= replay.events.length - 1) {
        paused = index >= replay.events.length - 1 ? true : paused;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const currentAt = Date.parse(replay.events[index]?.timestamp ?? '');
      const nextAt = Date.parse(replay.events[index + 1]?.timestamp ?? '');
      const delay = Math.max(30, Math.min(1_000, (nextAt - currentAt) / input.speed || 30));
      await new Promise((resolve) => setTimeout(resolve, delay));
      index += 1;
      dirty = true;
    }
  } finally {
    stdin.removeListener('data', onData);
    stdin.setRawMode(previousRaw === true);
    if (wasPaused) stdin.pause();
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
  return project(index);
}

export async function runLiveCommand(options: LiveCommandOptions): Promise<ActivityMonitorView> {
  const targetPath = path.resolve(options.targetPath ?? process.cwd());
  const maxRuns = Math.max(1, Math.min(50, options.maxRuns ?? 6));
  const maxScopes = Math.max(1, Math.min(50, options.maxScopes ?? 12));
  const refreshMs = Math.max(100, Math.min(5_000, options.refreshMs ?? 250));
  const replaySpeed = Math.max(0.25, Math.min(64, options.replaySpeed ?? 4));
  if (options.replayRunId) {
    if (options.global) throw new Error('--replay cannot be combined with --global.');
    return runActivityReplay({
      targetPath,
      runId: options.replayRunId,
      speed: replaySpeed,
      maxRuns,
      options,
    });
  }
  if (!options.global) pruneActivityJournals({ targetPath });

  const read = (): ActivityMonitorView =>
    options.global
      ? readActivityFleetSnapshot({ runId: options.runId, maxRuns, maxScopes })
      : readActivitySnapshot({ targetPath, runId: options.runId, maxRuns });
  let snapshot = read();
  const interactive = Boolean(
    process.stdout.isTTY &&
    process.stdin.isTTY &&
    typeof process.stdin.setRawMode === 'function' &&
    !options.json &&
    !options.accessible
  );
  const interaction: LiveInteractionState = {
    selectedRunId: options.runId,
    selectionPinned: Boolean(options.runId),
    focused: Boolean(options.runId),
    activeOnly: false,
    inspector: true,
    dirty: true,
  };
  let frame = 0;
  const renderOptions = (): ActivityTerminalRenderOptions => ({
    width: process.stdout.columns,
    height: process.stdout.rows,
    maxRuns,
    selectedRunId: interaction.selectedRunId,
    focused: interaction.focused,
    activeOnly: interaction.activeOnly,
    frame,
    color: options.color,
    motion: options.motion,
    ascii: options.ascii,
    accessible: options.accessible,
    classic: options.classic,
    interactive,
    inspector: interaction.inspector,
  });
  normalizeSelection(snapshot, interaction, maxRuns);

  if (options.capturePath) {
    const receipt = writeActivityCapture(snapshot, {
      outputPath: options.capturePath,
      runId: interaction.selectedRunId,
      preset: options.capturePreset,
      theme: options.captureTheme,
      redact: options.captureRedact,
    });
    process.stdout.write(
      `${JSON.stringify({ kind: 'workspai.live.capture', ...receipt }, null, options.json ? 2 : 0)}\n`
    );
    return snapshot;
  }

  if (options.once) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(projectLiveJsonOutput(snapshot, options), null, 2)}\n`
      );
    } else process.stdout.write(`${renderActivityTerminal(snapshot, renderOptions())}\n`);
    return snapshot;
  }

  let stopping = false;
  let wakeDelay: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wakeDelay?.();
  };
  const waitForNextFrame = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeDelay = undefined;
        resolve();
      }, milliseconds);
      wakeDelay = () => {
        clearTimeout(timer);
        wakeDelay = undefined;
        resolve();
      };
    });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let forceRedraw = true;
  const onResize = () => {
    forceRedraw = true;
    interaction.dirty = true;
  };
  process.stdout.on('resize', onResize);
  const restoreKeyboard = interactive
    ? installKeyboardControls({ snapshot: () => snapshot, state: interaction, maxRuns, stop })
    : null;
  if (interactive) process.stdout.write('\x1b[?1049h\x1b[?25l');

  let previousJson = '';
  let previousLines: string[] = [];
  let lastReadAt = 0;
  const animationEnabled =
    interactive &&
    options.motion !== false &&
    process.env.WORKSPAI_LIVE_REDUCED_MOTION !== '1' &&
    process.env.CI !== 'true';
  try {
    while (!stopping) {
      const now = Date.now();
      if (lastReadAt === 0 || now - lastReadAt >= refreshMs) {
        snapshot = read();
        normalizeSelection(snapshot, interaction, maxRuns);
        lastReadAt = now;
        interaction.dirty = true;
      }
      if (interactive) {
        const rendered = renderActivityTerminal(snapshot, renderOptions());
        const diff = renderActivityScreenDiff(previousLines, rendered, {
          force: forceRedraw,
          height: process.stdout.rows,
        });
        if (diff.output) process.stdout.write(diff.output);
        previousLines = diff.lines;
        forceRedraw = false;
        interaction.dirty = false;
        frame += 1;
      } else {
        const serialized = JSON.stringify(projectLiveJsonOutput(snapshot, options));
        const semanticSnapshot = activitySnapshotComparisonKey(snapshot);
        if (semanticSnapshot !== previousJson) {
          process.stdout.write(
            options.json
              ? `${serialized}\n`
              : `${renderActivityTerminal(snapshot, renderOptions())}\n`
          );
          previousJson = semanticSnapshot;
        }
      }
      const hasLiveMotion =
        animationEnabled &&
        activityBoardHasMotion(
          buildActivityBoardModel(snapshot, {
            selectedRunId: interaction.selectedRunId,
            activeOnly: interaction.activeOnly,
            maxRuns,
          })
        );
      if (!stopping) {
        await waitForNextFrame(hasLiveMotion ? Math.min(refreshMs, 125) : refreshMs);
      }
    }
  } finally {
    restoreKeyboard?.();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdout.removeListener('resize', onResize);
    if (interactive) process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
  return snapshot;
}
