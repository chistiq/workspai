import {
  activityBoardEdgeBetween,
  buildActivityBoardModel,
  type ActivityBoardEdge,
  type ActivityBoardModel,
  type ActivityBoardNode,
  type ActivityBoardRun,
} from './activity-board.js';
import type {
  ActivityBlockView,
  ActivityMonitorView,
  ActivityRunView,
} from './activity-monitor.js';
import type { WorkspaceActivityStatus } from './activity-contract.js';

export type ActivityTerminalRenderOptions = {
  width?: number;
  height?: number;
  maxRuns?: number;
  now?: number;
  selectedRunId?: string;
  focused?: boolean;
  activeOnly?: boolean;
  frame?: number;
  color?: boolean;
  motion?: boolean;
  ascii?: boolean;
  accessible?: boolean;
  classic?: boolean;
  interactive?: boolean;
  inspector?: boolean;
  replay?: { index: number; total: number; paused: boolean; speed: number };
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[97m',
} as const;

const STATUS_SYMBOL_UNICODE: Record<WorkspaceActivityStatus, string> = {
  planned: '○',
  running: '◉',
  succeeded: '✓',
  warned: '!',
  blocked: '⊘',
  failed: '×',
  cancelled: '×',
  skipped: '–',
  'rolled-back': '↶',
};

const STATUS_SYMBOL_ASCII: Record<WorkspaceActivityStatus, string> = {
  planned: 'o',
  running: '*',
  succeeded: '+',
  warned: '!',
  blocked: '#',
  failed: 'x',
  cancelled: 'x',
  skipped: '-',
  'rolled-back': '~',
};

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function terminalText(value: string): string {
  return stripAnsi(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function visibleLength(value: string): number {
  return [...stripAnsi(value)].length;
}

function truncatePlain(value: string, width: number): string {
  const safeValue = terminalText(value);
  const characters = [...safeValue];
  if (characters.length <= width) return safeValue;
  if (width <= 0) return '';
  if (width === 1) return '…';
  return `${characters.slice(0, width - 1).join('')}…`;
}

function fit(value: string, width: number): string {
  if (visibleLength(value) <= width) return value;
  return truncatePlain(stripAnsi(value), width);
}

function statusAnsi(status: WorkspaceActivityStatus, frame: number): string {
  if (status === 'running') return frame % 2 === 0 ? ANSI.brightCyan : ANSI.cyan;
  if (status === 'succeeded') return ANSI.green;
  if (status === 'warned' || status === 'blocked') return ANSI.yellow;
  if (status === 'failed' || status === 'cancelled') return ANSI.red;
  if (status === 'rolled-back') return ANSI.magenta;
  return ANSI.dim;
}

function paint(
  value: string,
  status: WorkspaceActivityStatus,
  enabled: boolean,
  frame: number
): string {
  return enabled ? `${statusAnsi(status, frame)}${value}${ANSI.reset}` : value;
}

function accent(value: string, enabled: boolean): string {
  return enabled ? `${ANSI.bold}${ANSI.brightCyan}${value}${ANSI.reset}` : value;
}

function symbol(status: WorkspaceActivityStatus, ascii: boolean): string {
  return (ascii ? STATUS_SYMBOL_ASCII : STATUS_SYMBOL_UNICODE)[status];
}

function elapsed(run: ActivityRunView, now: number): string {
  const milliseconds = run.durationMs ?? Math.max(0, now - Date.parse(run.startedAt));
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function progressLabel(block: ActivityBlockView): string {
  const progress = block.progress;
  if (!progress) return '';
  if (progress.percent !== undefined) return `${Math.round(progress.percent)}%`;
  if (progress.completed !== undefined && progress.total !== undefined) {
    return `${progress.completed}/${progress.total}`;
  }
  if (progress.iteration !== undefined && progress.iterations !== undefined) {
    return `${progress.iteration}/${progress.iterations}`;
  }
  return '';
}

function attemptLabel(block: ActivityBlockView, ascii: boolean): string {
  return block.attempt && block.attempt > 1 ? `${ascii ? 'R' : '↻'}${block.attempt}` : '';
}

function joinSides(left: string, right: string, width: number): string {
  const leftWidth = visibleLength(left);
  const rightWidth = visibleLength(right);
  if (leftWidth + rightWidth + 1 > width) return fit(`${left}  ${right}`, width);
  return `${left}${' '.repeat(width - leftWidth - rightWidth)}${right}`;
}

const STATUS_LABEL: Record<WorkspaceActivityStatus, string> = {
  planned: 'QUEUE',
  running: 'RUN',
  succeeded: 'DONE',
  warned: 'WARN',
  blocked: 'BLOCK',
  failed: 'FAIL',
  cancelled: 'STOP',
  skipped: 'SKIP',
  'rolled-back': 'ROLL',
};

type CardPorts = {
  left?: WorkspaceActivityStatus;
  right?: WorkspaceActivityStatus;
  top?: WorkspaceActivityStatus;
  bottom?: WorkspaceActivityStatus;
};

function cardPortGlyph(
  side: keyof CardPorts,
  status: WorkspaceActivityStatus,
  running: boolean,
  ascii: boolean
): string {
  if (ascii) return '+';
  if (running) {
    return { left: '┫', right: '┣', top: '┻', bottom: '┳' }[side];
  }
  const light = status === 'planned' || status === 'skipped';
  return light
    ? { left: '┤', right: '├', top: '┴', bottom: '┬' }[side]
    : { left: '┥', right: '┝', top: '┷', bottom: '┯' }[side];
}

function cardContent(left: string, right: string, width: number): string {
  const safeRight = truncatePlain(right, Math.max(3, Math.floor(width * 0.6)));
  const leftBudget = Math.max(0, width - visibleLength(safeRight) - (safeRight ? 1 : 0));
  const safeLeft = truncatePlain(left, leftBudget);
  return `${safeLeft}${' '.repeat(Math.max(0, width - visibleLength(safeLeft) - visibleLength(safeRight)))}${safeRight}`;
}

function cardHorizontalBorder(
  left: string,
  right: string,
  horizontal: string,
  width: number,
  port?: string
): string {
  const inner = Array.from({ length: Math.max(0, width - 2) }, () => horizontal);
  if (port && inner.length > 0) inner[Math.floor(inner.length / 2)] = port;
  return `${left}${inner.join('')}${right}`;
}

function cardLines(
  block: ActivityBoardNode,
  width: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>,
  ports: CardPorts
): string[] {
  const running = block.status === 'running';
  const border = options.ascii
    ? {
        topLeft: '+',
        topRight: '+',
        bottomLeft: '+',
        bottomRight: '+',
        horizontal: '-',
        vertical: '|',
      }
    : running
      ? {
          topLeft: '┏',
          topRight: '┓',
          bottomLeft: '┗',
          bottomRight: '┛',
          horizontal: '━',
          vertical: '┃',
        }
      : {
          topLeft: '┌',
          topRight: '┐',
          bottomLeft: '└',
          bottomRight: '┘',
          horizontal: '─',
          vertical: '│',
        };
  const progress = progressLabel(block);
  const attempt = attemptLabel(block, options.ascii);
  const state = [STATUS_LABEL[block.status], attempt, progress].filter(Boolean).join(' ');
  const top = cardHorizontalBorder(
    border.topLeft,
    border.topRight,
    border.horizontal,
    width,
    ports.top ? cardPortGlyph('top', ports.top, running, options.ascii) : undefined
  );
  const middle = `${ports.left ? cardPortGlyph('left', ports.left, running, options.ascii) : border.vertical}${cardContent(terminalText(block.label), state, width - 2)}${ports.right ? cardPortGlyph('right', ports.right, running, options.ascii) : border.vertical}`;
  const bottom = cardHorizontalBorder(
    border.bottomLeft,
    border.bottomRight,
    border.horizontal,
    width,
    ports.bottom ? cardPortGlyph('bottom', ports.bottom, running, options.ascii) : undefined
  );
  return [top, middle, bottom].map((line) =>
    paint(line, block.status, options.color, options.frame)
  );
}

function wireCharacters(
  status: WorkspaceActivityStatus,
  direction: 'left' | 'right',
  frame: number,
  motion: boolean,
  ascii: boolean,
  width: number
): string {
  const bodyWidth = Math.max(2, width);
  const line = ascii ? '-' : '━';
  const dotted = ascii ? '.' : '┄';
  if (status === 'running' && motion) {
    const pulse = ascii ? '=' : '╍';
    const cells: string[] = Array.from({ length: bodyWidth }, () => line);
    const phase = frame % bodyWidth;
    cells[direction === 'right' ? phase : bodyWidth - phase - 1] = pulse;
    return cells.join('');
  }
  if (status === 'planned' || status === 'skipped') {
    return dotted.repeat(bodyWidth);
  }
  if (status === 'blocked' || status === 'warned') {
    return (ascii ? '~' : '┅').repeat(bodyWidth);
  }
  if (status === 'failed' || status === 'cancelled') {
    return (ascii ? '=' : '╍').repeat(bodyWidth);
  }
  return line.repeat(bodyWidth);
}

function renderWire(
  edge: ActivityBoardEdge | undefined,
  direction: 'left' | 'right',
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame' | 'motion'>>,
  width = 7
): string {
  if (!edge) return ' '.repeat(width);
  return paint(
    wireCharacters(edge.status, direction, options.frame, options.motion, options.ascii, width),
    edge.status,
    options.color,
    options.frame
  );
}

function renderVerticalWire(
  edge: ActivityBoardEdge | undefined,
  position: number,
  width: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame' | 'motion'>>
): string[] {
  const status = edge?.status ?? 'planned';
  const flowing = status === 'running' && options.motion;
  const base =
    status === 'planned' || status === 'skipped'
      ? options.ascii
        ? ':'
        : '┊'
      : status === 'blocked' || status === 'warned'
        ? options.ascii
          ? '~'
          : '┋'
        : options.ascii
          ? '|'
          : '┃';
  const pulse = options.ascii ? ':' : '╏';
  const glyphs = [
    flowing && options.frame % 2 === 0 ? pulse : base,
    flowing && options.frame % 2 === 1 ? pulse : base,
  ];
  return glyphs.map((glyph) =>
    paint(
      `${' '.repeat(Math.max(0, position))}${glyph}`.padEnd(width),
      status,
      options.color,
      options.frame
    )
  );
}

function renderFlowGraph(
  run: ActivityBoardRun,
  width: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame' | 'motion'>>
): string[] {
  const wireWidth = width >= 132 ? 9 : 7;
  const cardWidth =
    run.nodes.length <= 2 ? Math.min(32, width) : width >= 132 ? 19 : width >= 100 ? 17 : 15;
  const nodesPerRow = Math.max(1, Math.floor((width + wireWidth) / (cardWidth + wireWidth)));
  const chunks: ActivityBoardNode[][] = [];
  for (let index = 0; index < run.nodes.length; index += nodesPerRow) {
    chunks.push(run.nodes.slice(index, index + nodesPerRow));
  }
  const lines: string[] = [];

  chunks.forEach((logicalChunk, rowIndex) => {
    const direction = rowIndex % 2 === 0 ? 'right' : 'left';
    const visualChunk = direction === 'right' ? logicalChunk : [...logicalChunk].reverse();
    const nextChunk = chunks[rowIndex + 1];
    const previousChunk = chunks[rowIndex - 1];
    const verticalInEdge = previousChunk
      ? activityBoardEdgeBetween(run, previousChunk.at(-1)?.id ?? '', logicalChunk[0]?.id ?? '')
      : undefined;
    const verticalOutEdge = nextChunk
      ? activityBoardEdgeBetween(run, logicalChunk.at(-1)?.id ?? '', nextChunk[0]?.id ?? '')
      : undefined;
    const edgeForGap = (left: ActivityBoardNode, right: ActivityBoardNode) =>
      direction === 'right'
        ? activityBoardEdgeBetween(run, left.id, right.id)
        : activityBoardEdgeBetween(run, right.id, left.id);
    const renderedCards = visualChunk.map((block, visualIndex) => {
      const leftEdge =
        visualIndex > 0
          ? edgeForGap(visualChunk[visualIndex - 1] as ActivityBoardNode, block)
          : undefined;
      const rightEdge =
        visualIndex < visualChunk.length - 1
          ? edgeForGap(block, visualChunk[visualIndex + 1] as ActivityBoardNode)
          : undefined;
      return cardLines(block, cardWidth, options, {
        ...(leftEdge ? { left: leftEdge.status } : {}),
        ...(rightEdge ? { right: rightEdge.status } : {}),
        ...(verticalInEdge && block.id === logicalChunk[0]?.id
          ? { top: verticalInEdge.status }
          : {}),
        ...(verticalOutEdge && block.id === logicalChunk.at(-1)?.id
          ? { bottom: verticalOutEdge.status }
          : {}),
      });
    });
    for (let cardLine = 0; cardLine < 3; cardLine += 1) {
      let line = '';
      visualChunk.forEach((block, visualIndex) => {
        line += renderedCards[visualIndex][cardLine];
        if (visualIndex >= visualChunk.length - 1) return;
        if (cardLine !== 1) {
          line += ' '.repeat(wireWidth);
          return;
        }
        const next = visualChunk[visualIndex + 1];
        const edge =
          direction === 'right'
            ? activityBoardEdgeBetween(run, block.id, next.id)
            : activityBoardEdgeBetween(run, next.id, block.id);
        line += renderWire(edge, direction, options, wireWidth);
      });
      lines.push(fit(line, width));
    }

    if (!nextChunk) return;
    const edge = verticalOutEdge;
    const renderedWidth = visualChunk.length * cardWidth + (visualChunk.length - 1) * wireWidth;
    const position =
      direction === 'right'
        ? Math.max(0, renderedWidth - Math.ceil(cardWidth / 2))
        : Math.floor(cardWidth / 2);
    lines.push(...renderVerticalWire(edge, position, width, options));
  });
  return lines;
}

function compactChip(
  block: ActivityBoardNode,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>
): string {
  const progress = progressLabel(block);
  const attempt = attemptLabel(block, options.ascii);
  const label = `${symbol(block.status, options.ascii)} ${terminalText(block.label)}${attempt ? ` ${attempt}` : ''}${progress ? ` ${progress}` : ''}`;
  return paint(`[${label}]`, block.status, options.color, options.frame);
}

function renderCompactFlow(
  run: ActivityBoardRun,
  width: number,
  maxLines: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame' | 'motion'>>
): string[] {
  if (run.nodes.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  let visibleNodes = 0;
  for (const [index, block] of run.nodes.entries()) {
    const chip = compactChip(block, options);
    const previous = run.nodes[index - 1];
    const edge = previous ? activityBoardEdgeBetween(run, previous.id, block.id) : undefined;
    const wire = previous ? renderWire(edge, 'right', options, 7) : '';
    const addition = `${current ? wire : ''}${chip}`;
    if (current && visibleLength(current) + visibleLength(addition) > width) {
      lines.push(fit(current, width));
      if (lines.length >= maxLines) break;
      current = `${options.ascii ? '> ' : '↳ '}${chip}`;
    } else {
      current += addition;
    }
    visibleNodes = index + 1;
  }
  if (lines.length < maxLines && current) lines.push(fit(current, width));
  if (visibleNodes < run.nodes.length && lines.length > 0) {
    const remaining = ` … +${run.nodes.length - visibleNodes}`;
    lines[lines.length - 1] = fit(`${lines.at(-1)}${remaining}`, width);
  }
  return lines.slice(0, maxLines);
}

function renderActiveRunDock(
  runs: readonly ActivityBoardRun[],
  width: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>,
  global: boolean
): string | undefined {
  if (runs.length === 0) return undefined;
  const capacity = width >= 130 ? 3 : width >= 92 ? 2 : 1;
  const visibleRuns = runs.slice(0, capacity);
  const prefix = 'ALSO ACTIVE  ';
  const chips = visibleRuns.map((run) => {
    const command = truncatePlain(run.commandLabel.replace(/^workspai\s+/, ''), 24);
    const location = global ? `${truncatePlain(run.locationLabel, 20)} · ` : '';
    return paint(
      `[${symbol('running', options.ascii)} ${location}${command} · ${run.run.runId.slice(0, 8)}]`,
      'running',
      options.color,
      options.frame
    );
  });
  const remaining = runs.length - visibleRuns.length;
  return fit(`${prefix}${chips.join('  ')}${remaining > 0 ? `  +${remaining}` : ''}`, width);
}

function aggregateStatus(nodes: readonly ActivityBoardNode[]): WorkspaceActivityStatus {
  const statuses = nodes.map((node) => node.status);
  for (const status of ['failed', 'cancelled', 'blocked', 'warned', 'running'] as const) {
    if (statuses.includes(status)) return status;
  }
  if (statuses.length > 0 && statuses.every((status) => status === 'succeeded')) return 'succeeded';
  if (statuses.some((status) => status === 'succeeded')) return 'running';
  return statuses[0] ?? 'planned';
}

function renderGroupRail(
  run: ActivityBoardRun,
  width: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>
): string | undefined {
  const groups = [...new Set(run.nodes.map((node) => node.group).filter(Boolean))] as string[];
  if (groups.length < 2) return undefined;
  const divider = options.ascii ? ' > ' : ' ━ ';
  const cells = groups.map((group, index) => {
    const status = aggregateStatus(run.nodes.filter((node) => node.group === group));
    return paint(
      `${String(index + 1).padStart(2, '0')} ${truncatePlain(group, 14)}`,
      status,
      options.color,
      options.frame
    );
  });
  return fit(`PHASES  ${cells.join(divider)}`, width);
}

function selectedNode(run: ActivityBoardRun): ActivityBoardNode | undefined {
  return (
    [...run.nodes].reverse().find((node) => node.status === 'running') ??
    [...run.nodes]
      .reverse()
      .find((node) => ['failed', 'blocked', 'warned', 'cancelled'].includes(node.status)) ??
    [...run.nodes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  );
}

function durationLabel(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function renderInspector(
  run: ActivityBoardRun,
  width: number,
  now: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>
): string[] {
  const block = selectedNode(run);
  if (!block || width < 24) return [];
  const horizontal = options.ascii ? '-' : '─';
  const vertical = options.ascii ? '|' : '│';
  const innerWidth = width - 2;
  const attempt = block.attempt ?? 0;
  const startedAt = block.attempts.at(-1)?.startedAt ?? block.updatedAt;
  const duration =
    block.durationMs ??
    (block.status === 'running' ? Math.max(0, now - Date.parse(startedAt)) : undefined);
  const rows = [
    accent('INSPECT', options.color),
    terminalText(block.label),
    '',
    `STATE      ${STATUS_LABEL[block.status]}`,
    `PHASE      ${block.group ?? 'GENERAL'}`,
    `ATTEMPT    ${attempt > 0 ? `${attempt}/${Math.max(attempt, block.attempts.length)}` : '—'}`,
    `PROGRESS   ${progressLabel(block) || '—'}`,
    `ELAPSED    ${duration === undefined ? '—' : durationLabel(duration)}`,
    '',
    `TOUCHES    ${run.run.touches.length}`,
    `ARTIFACTS  ${run.run.artifacts.length}`,
    `WARNINGS   ${run.warningCount}`,
  ];
  const frame = options.ascii
    ? { tl: '+', tr: '+', bl: '+', br: '+' }
    : { tl: '┌', tr: '┐', bl: '└', br: '┘' };
  return [
    `${frame.tl}${horizontal.repeat(innerWidth)}${frame.tr}`,
    ...rows.map((row) => {
      const safe = fit(row, innerWidth);
      return `${vertical}${safe}${' '.repeat(Math.max(0, innerWidth - visibleLength(safe)))}${vertical}`;
    }),
    `${frame.bl}${horizontal.repeat(innerWidth)}${frame.br}`,
  ];
}

function mergeColumns(
  left: readonly string[],
  right: readonly string[],
  leftWidth: number,
  gap = 3
): string[] {
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftLine = fit(left[index] ?? '', leftWidth);
    return `${leftLine}${' '.repeat(Math.max(0, leftWidth - visibleLength(leftLine)) + gap)}${right[index] ?? ''}`;
  });
}

function renderFleetCockpit(
  model: ActivityBoardModel,
  selectedRunId: string,
  width: number,
  now: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>
): string[] {
  const runs = [
    ...model.runs.filter((run) => run.active),
    ...model.runs.filter((run) => !run.active && run.run.runId === selectedRunId),
  ].filter(
    (run, index, all) => all.findIndex((entry) => entry.run.runId === run.run.runId) === index
  );
  if (runs.length === 0) return [];
  const rows = runs.slice(0, width >= 110 ? 4 : 2);
  const locationWidth = Math.max(12, Math.min(28, Math.floor(width * 0.24)));
  const commandWidth = Math.max(14, Math.min(30, Math.floor(width * 0.27)));
  const stageWidth = Math.max(10, Math.min(20, Math.floor(width * 0.18)));
  const header = `FLEET  ${'LOCATION'.padEnd(locationWidth)}  ${'COMMAND'.padEnd(commandWidth)}  ${'ACTIVE BLOCK'.padEnd(stageWidth)}  STATE`;
  const result = [accent(fit(header, width), options.color)];
  for (const run of rows) {
    const active = selectedNode(run);
    const pointer = run.run.runId === selectedRunId ? (options.ascii ? '>' : '◆') : ' ';
    const command = run.commandLabel.replace(/^workspai\s+/, '');
    const row = `${pointer}      ${truncatePlain(run.locationLabel, locationWidth).padEnd(locationWidth)}  ${truncatePlain(command, commandWidth).padEnd(commandWidth)}  ${truncatePlain(active?.label ?? '—', stageWidth).padEnd(stageWidth)}  ${STATUS_LABEL[run.run.status]} · ${elapsed(run.run, now)}`;
    result.push(paint(fit(row, width), run.run.status, options.color, options.frame));
  }
  if (runs.length > rows.length)
    result.push(fit(`       +${runs.length - rows.length} more runs`, width));
  return result;
}

function runHeader(
  run: ActivityBoardRun,
  selected: boolean,
  width: number,
  now: number,
  options: Required<Pick<ActivityTerminalRenderOptions, 'ascii' | 'color' | 'frame'>>,
  global: boolean
): string {
  const pointer = selected ? (options.ascii ? '>' : '◆') : ' ';
  const location = global ? `${truncatePlain(run.locationLabel, 28)}  ` : '';
  const left = `RUN ${run.run.runId.slice(0, 8).toUpperCase()}  ${location}${terminalText(run.commandLabel)}`;
  const warnings = run.warningCount > 0 ? ` · !${run.warningCount}` : '';
  const right = `${STATUS_LABEL[run.run.status]} · ${elapsed(run.run, now)}${warnings}`;
  const body = paint(
    joinSides(left, right, Math.max(0, width - 2)),
    run.run.status,
    options.color,
    options.frame
  );
  return `${selected ? accent(pointer, options.color) : pointer} ${body}`;
}

function renderAccessibleBoard(model: ActivityBoardModel, width: number, now: number): string {
  const lines = [
    fit(
      `Workspai Live | ${terminalText(model.scopeLabel)} | ${model.activeRunCount} active | ${model.failedRunCount} failed`,
      width
    ),
  ];
  if (model.runs.length === 0) lines.push('WAITING');
  for (const run of model.runs) {
    lines.push(
      fit(
        `RUN ${run.run.status.toUpperCase()} | ${terminalText(run.commandLabel)} | ${run.run.runId.slice(0, 8)} | ${elapsed(run.run, now)}`,
        width
      )
    );
    for (const block of run.nodes) {
      lines.push(
        fit(
          `  BLOCK ${block.status.toUpperCase()} | ${terminalText(block.label)}${attemptLabel(block, true) ? ` | ATTEMPT ${block.attempt}` : ''}${progressLabel(block) ? ` | ${progressLabel(block)}` : ''}`,
          width
        )
      );
    }
  }
  return lines.join('\n');
}

export function renderActivityTerminal(
  snapshot: ActivityMonitorView,
  options: ActivityTerminalRenderOptions = {}
): string {
  if (options.classic) return renderClassicActivityTerminal(snapshot, options);
  const width = Math.max(20, options.width ?? process.stdout.columns ?? 100);
  const height = Math.max(1, options.height ?? process.stdout.rows ?? 28);
  const now = options.now ?? Date.now();
  const frame = options.frame ?? 0;
  const ascii =
    options.ascii ?? (process.env.WORKSPAI_LIVE_ASCII === '1' || process.env.TERM === 'dumb');
  const color =
    options.color ??
    (process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
  const motion =
    options.motion ??
    (process.env.WORKSPAI_LIVE_REDUCED_MOTION !== '1' && process.env.CI !== 'true');
  const model = buildActivityBoardModel(snapshot, {
    selectedRunId: options.selectedRunId,
    activeOnly: options.activeOnly,
    maxRuns: options.maxRuns,
  });
  if (options.accessible) return renderAccessibleBoard(model, width, now);

  const renderOptions = { ascii, color, frame, motion };
  const title = accent('WORKSPAI LIVE', color);
  const scope = fit(terminalText(model.scopeLabel), Math.max(8, Math.floor(width / 3)));
  const scopeCounter = model.global ? `${model.scopeCount} SCOPES  ` : '';
  const counters = `${scopeCounter}${symbol('running', ascii)} ${model.activeRunCount} ACTIVE  ${symbol('succeeded', ascii)} ${model.healthyRunCount}  ${symbol('warned', ascii)} ${model.warningRunCount}  ${symbol('failed', ascii)} ${model.failedRunCount}`;
  const separator = ascii ? '-'.repeat(width) : '━'.repeat(width);
  const lines = [
    joinSides(`${title}  ${scope}`, counters, width),
    paint(separator, 'planned', color, frame),
  ];
  const controlLine = fit(
    options.replay
      ? `${options.replay.paused ? 'PAUSED' : 'PLAY'} ${options.replay.index}/${options.replay.total} · ${options.replay.speed}x   SPACE PLAY/PAUSE   ${ascii ? '<>' : '←→'} STEP   Q CLOSE`
      : `${ascii ? '^v' : '↑↓'} SELECT   ENTER FOCUS   I INSPECT   F ACTIVE   Q CLOSE`,
    width
  );
  const footerLines = options.interactive
    ? height >= 8
      ? [paint(separator, 'planned', color, frame), controlLine]
      : height >= 3
        ? [controlLine]
        : []
    : [];
  if (model.runs.length === 0) {
    lines.push('', accent(`${ascii ? '*' : '◇'} WAITING FOR WORKSPAI ACTIVITY`, color));
  } else {
    const selected =
      model.runs.find((run) => run.run.runId === model.selectedRunId) ?? model.runs[0];
    const activePeers = options.focused
      ? []
      : model.runs.filter((run) => run.run.runId !== selected.run.runId && run.active);
    if (model.global && !options.focused) {
      lines.push(...renderFleetCockpit(model, selected.run.runId, width, now, renderOptions));
    }
    lines.push(runHeader(selected, true, width, now, renderOptions, model.global));
    const inspectorEnabled = options.inspector !== false && width >= 132;
    const inspectorWidth = inspectorEnabled ? Math.min(34, Math.floor(width * 0.25)) : 0;
    const graphWidth = inspectorEnabled ? width - inspectorWidth - 3 : width;
    const groupRail = renderGroupRail(selected, graphWidth, renderOptions);
    const graph = [
      ...(groupRail ? [groupRail] : []),
      ...renderFlowGraph(selected, graphWidth, renderOptions),
    ];
    const inspector = inspectorEnabled
      ? renderInspector(selected, inspectorWidth, now, renderOptions)
      : [];
    const board = inspectorEnabled ? mergeColumns(graph, inspector, graphWidth) : graph;
    const activeRunDock = renderActiveRunDock(activePeers, width, renderOptions, model.global);
    const reservedForDock = activeRunDock && !model.global ? 1 : 0;
    const graphLineBudget = Math.max(
      0,
      height - footerLines.length - lines.length - reservedForDock
    );
    const useFullGraph = width >= 72 && height >= 14 && board.length <= graphLineBudget;
    if (activeRunDock && !model.global && lines.length + footerLines.length < height) {
      lines.push(activeRunDock);
    }
    lines.push(
      ...(useFullGraph
        ? board
        : graphLineBudget > 0
          ? renderCompactFlow(selected, width, Math.min(3, graphLineBudget), renderOptions)
          : [])
    );
  }

  if (model.diagnostics.length > 0 && lines.length + footerLines.length < height) {
    lines.push(paint(`! ${model.diagnostics.length} DIAGNOSTIC`, 'warned', color, frame));
  }
  lines.push(...footerLines);
  return lines
    .slice(0, height)
    .map((line) => fit(line, width))
    .join('\n');
}

export function renderClassicActivityTerminal(
  snapshot: ActivityMonitorView,
  options: Pick<ActivityTerminalRenderOptions, 'width' | 'maxRuns' | 'now' | 'ascii'> = {}
): string {
  const width = Math.max(20, options.width ?? process.stdout.columns ?? 100);
  const now = options.now ?? Date.now();
  const ascii = options.ascii ?? false;
  const model = buildActivityBoardModel(snapshot, { maxRuns: options.maxRuns });
  const runs = model.runs.map((entry) => entry.run);
  const activeCount = model.activeRunCount;
  const lines = [
    fit(
      `Workspai Live · ${terminalText(model.scopeLabel)} · ${activeCount} active run${activeCount === 1 ? '' : 's'}`,
      width
    ),
    (ascii ? '-' : '─').repeat(Math.min(width, 100)),
  ];
  if (runs.length === 0) lines.push('Waiting for Workspai commands in this project or workspace…');
  for (const [index, run] of runs.entries()) {
    if (index > 0) lines.push('');
    const command = terminalText(
      run.command.length > 0 ? `workspai ${run.command.join(' ')}` : run.runId
    );
    lines.push(
      fit(
        `${symbol(run.status, ascii)} ${command} · ${run.runId.slice(0, 8)} · ${elapsed(run, now)}`,
        width
      )
    );
    for (const block of run.blocks.slice(0, 18)) {
      lines.push(
        fit(
          `   ${symbol(block.status, ascii)} ${terminalText(block.label)}${attemptLabel(block, ascii) ? ` ${attemptLabel(block, ascii)}` : ''}${progressLabel(block) ? ` ${progressLabel(block)}` : ''}`,
          width
        )
      );
    }
  }
  return lines.join('\n');
}
