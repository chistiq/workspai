import fs from 'node:fs';
import path from 'node:path';

import { buildActivityBoardModel, type ActivityBoardNode } from './activity-board.js';
import type { ActivityMonitorView } from './activity-monitor.js';
import type { WorkspaceActivityStatus } from './activity-contract.js';

export const ACTIVITY_CAPTURE_PRESETS = ['github', 'linkedin', 'x', 'square', 'wide'] as const;
export const ACTIVITY_CAPTURE_THEMES = ['obsidian', 'light', 'mono'] as const;

export type ActivityCapturePreset = (typeof ACTIVITY_CAPTURE_PRESETS)[number];
export type ActivityCaptureTheme = (typeof ACTIVITY_CAPTURE_THEMES)[number];

export type ActivityCaptureOptions = {
  outputPath: string;
  runId?: string;
  preset?: ActivityCapturePreset;
  theme?: ActivityCaptureTheme;
  redact?: boolean;
  now?: number;
};

type Palette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  grid: string;
  text: string;
  muted: string;
  cyan: string;
  green: string;
  yellow: string;
  red: string;
  violet: string;
};

const PRESET_SIZE: Record<ActivityCapturePreset, { width: number; height: number }> = {
  github: { width: 1280, height: 720 },
  linkedin: { width: 1200, height: 627 },
  x: { width: 1600, height: 900 },
  square: { width: 1080, height: 1080 },
  wide: { width: 1600, height: 900 },
};

const PALETTES: Record<ActivityCaptureTheme, Palette> = {
  obsidian: {
    background: '#070b12',
    surface: '#0d1420',
    surfaceRaised: '#121c2b',
    grid: '#1d2a3b',
    text: '#edf6ff',
    muted: '#8090a5',
    cyan: '#20d9ff',
    green: '#27e0a3',
    yellow: '#f4d35e',
    red: '#ff667d',
    violet: '#b89cff',
  },
  light: {
    background: '#f4f7fb',
    surface: '#ffffff',
    surfaceRaised: '#eef3f9',
    grid: '#d9e2ee',
    text: '#102033',
    muted: '#617187',
    cyan: '#007fa3',
    green: '#087f5b',
    yellow: '#a16a00',
    red: '#c92a42',
    violet: '#6741d9',
  },
  mono: {
    background: '#080808',
    surface: '#111111',
    surfaceRaised: '#181818',
    grid: '#303030',
    text: '#f4f4f4',
    muted: '#9a9a9a',
    cyan: '#f4f4f4',
    green: '#d8d8d8',
    yellow: '#bdbdbd',
    red: '#ffffff',
    violet: '#c9c9c9',
  },
};

function xml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ');
}

function truncate(value: string, length: number): string {
  const characters = [...value];
  return characters.length <= length ? value : `${characters.slice(0, length - 1).join('')}…`;
}

function statusColor(status: WorkspaceActivityStatus, palette: Palette): string {
  if (status === 'running') return palette.cyan;
  if (status === 'succeeded') return palette.green;
  if (status === 'warned' || status === 'blocked') return palette.yellow;
  if (status === 'failed' || status === 'cancelled') return palette.red;
  if (status === 'rolled-back') return palette.violet;
  return palette.muted;
}

function statusLabel(status: WorkspaceActivityStatus): string {
  return (
    {
      planned: 'QUEUE',
      running: 'RUNNING',
      succeeded: 'COMPLETE',
      warned: 'WARNING',
      blocked: 'BLOCKED',
      failed: 'FAILED',
      cancelled: 'CANCELLED',
      skipped: 'SKIPPED',
      'rolled-back': 'ROLLED BACK',
    } as const
  )[status];
}

function duration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function blockProgress(block: ActivityBoardNode): string {
  if (block.progress?.percent !== undefined) return `${Math.round(block.progress.percent)}%`;
  if (block.progress?.completed !== undefined && block.progress.total !== undefined) {
    return `${block.progress.completed}/${block.progress.total}`;
  }
  return '';
}

function selectedBlock(nodes: readonly ActivityBoardNode[]): ActivityBoardNode | undefined {
  return (
    [...nodes].reverse().find((node) => node.status === 'running') ??
    [...nodes].reverse().find((node) => ['failed', 'blocked', 'warned'].includes(node.status)) ??
    [...nodes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  );
}

function safeCommand(command: readonly string[], redact: boolean): string {
  if (!redact) return `workspai ${command.join(' ')}`.trim();
  const root = command[0]?.match(/^[a-z][a-z0-9-]*$/i)?.[0] ?? 'command';
  const namespaced = new Set(['workspace', 'doctor', 'goal', 'graph', 'model', 'context']);
  const subcommand = namespaced.has(root)
    ? command[1]?.match(/^[a-z][a-z0-9-]*$/i)?.[0]
    : undefined;
  return `workspai ${[root, subcommand].filter(Boolean).join(' ')}`;
}

export function renderActivityCaptureSvg(
  snapshot: ActivityMonitorView,
  options: Omit<ActivityCaptureOptions, 'outputPath'> = {}
): string {
  const preset = options.preset ?? 'github';
  const theme = options.theme ?? 'obsidian';
  const { width, height } = PRESET_SIZE[preset];
  const palette = PALETTES[theme];
  const model = buildActivityBoardModel(snapshot, {
    selectedRunId: options.runId,
    maxRuns: 50,
  });
  const run = model.runs.find((entry) => entry.run.runId === model.selectedRunId) ?? model.runs[0];
  const now = options.now ?? Date.parse(snapshot.generatedAt);
  const margin = Math.round(width * 0.045);
  const panelGap = 28;
  const inspectorWidth = Math.max(250, Math.round(width * 0.24));
  const graphWidth = width - margin * 2 - inspectorWidth - panelGap;
  const graphX = margin;
  const inspectorX = graphX + graphWidth + panelGap;
  const top = 184;
  const bottom = height - 54;
  const cardGapX = 30;
  const cardGapY = 34;
  const columns = Math.max(2, Math.min(5, Math.floor((graphWidth + cardGapX) / 180)));
  const cardWidth = Math.floor((graphWidth - cardGapX * (columns - 1)) / columns);
  const rowCount = Math.max(1, Math.ceil((run?.nodes.length ?? 0) / columns));
  const cardHeight = Math.max(
    48,
    Math.min(64, Math.floor((bottom - top - cardGapY * (rowCount - 1)) / rowCount))
  );
  const groups = [
    ...new Set(run?.nodes.map((node) => node.group).filter(Boolean) ?? []),
  ] as string[];
  const nodePositions = new Map<string, { x: number; y: number }>();
  run?.nodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const logicalColumn = index % columns;
    const column = row % 2 === 0 ? logicalColumn : columns - logicalColumn - 1;
    nodePositions.set(node.id, {
      x: graphX + column * (cardWidth + cardGapX),
      y: top + row * (cardHeight + cardGapY),
    });
  });
  const selected = run ? selectedBlock(run.nodes) : undefined;
  const scopeLabel = options.redact ? 'workspace / project' : model.scopeLabel;
  const locationLabel = options.redact ? 'workspace / project' : run?.locationLabel;
  const command = run
    ? safeCommand(run.run.command, options.redact === true)
    : 'Waiting for activity';
  const runDuration = run
    ? (run.run.durationMs ?? Math.max(0, now - Date.parse(run.run.startedAt)))
    : 0;
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">Workspai Live execution board</title>`,
    `<desc id="description">${xml(command)} execution graph with ${run?.nodes.length ?? 0} blocks.</desc>`,
    '<defs>',
    `<pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="${palette.grid}" stroke-width="1" opacity="0.28"/></pattern>`,
    ...(
      [
        'planned',
        'running',
        'succeeded',
        'warned',
        'blocked',
        'failed',
        'cancelled',
        'skipped',
        'rolled-back',
      ] as const
    ).map(
      (status) =>
        `<marker id="arrow-${status}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${statusColor(status, palette)}"/></marker>`
    ),
    `<filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    '</defs>',
    `<rect width="${width}" height="${height}" fill="${palette.background}"/>`,
    `<rect width="${width}" height="${height}" fill="url(#grid)"/>`,
    `<text x="${margin}" y="58" fill="${palette.cyan}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="17" font-weight="700" letter-spacing="2">WORKSPAI LIVE</text>`,
    `<text x="${margin}" y="91" fill="${palette.text}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="27" font-weight="650">${xml(truncate(command, 62))}</text>`,
    `<text x="${margin}" y="118" fill="${palette.muted}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="14">${xml(truncate(locationLabel ?? scopeLabel, 72))}</text>`,
    `<text x="${width - margin}" y="61" text-anchor="end" fill="${run ? statusColor(run.run.status, palette) : palette.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14" font-weight="700">${run ? statusLabel(run.run.status) : 'STANDBY'} · ${duration(runDuration)}</text>`,
    `<line x1="${margin}" y1="143" x2="${width - margin}" y2="143" stroke="${palette.grid}" stroke-width="2"/>`,
  ];

  if (groups.length > 1) {
    const groupWidth = Math.min(
      132,
      Math.floor((graphWidth - 12 * (groups.length - 1)) / groups.length)
    );
    groups.forEach((group, index) => {
      const x = graphX + index * (groupWidth + 12);
      svg.push(
        `<rect x="${x}" y="156" width="${groupWidth}" height="20" rx="10" fill="${palette.surfaceRaised}" stroke="${palette.grid}"/>`,
        `<text x="${x + groupWidth / 2}" y="170" text-anchor="middle" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="10" font-weight="700" letter-spacing="1">${xml(group)}</text>`
      );
    });
  }

  for (const edge of run?.edges ?? []) {
    const from = nodePositions.get(edge.fromBlockId);
    const to = nodePositions.get(edge.toBlockId);
    if (!from || !to) continue;
    const fromX = from.x + cardWidth / 2;
    const fromY = from.y + cardHeight / 2;
    const toX = to.x + cardWidth / 2;
    const toY = to.y + cardHeight / 2;
    const horizontal = Math.abs(toY - fromY) < 2;
    const startX = horizontal ? (toX > fromX ? from.x + cardWidth : from.x) : fromX;
    const startY = horizontal ? fromY : from.y + cardHeight;
    const endX = horizontal ? (toX > fromX ? to.x : to.x + cardWidth) : toX;
    const endY = horizontal ? toY : to.y;
    const middleY = (startY + endY) / 2;
    const pathData = horizontal
      ? `M ${startX} ${startY} L ${endX} ${endY}`
      : `M ${startX} ${startY} L ${startX} ${middleY} L ${endX} ${middleY} L ${endX} ${endY}`;
    const color = statusColor(edge.status, palette);
    svg.push(
      `<path d="${pathData}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ${edge.status === 'planned' ? 'stroke-dasharray="5 7"' : ''} marker-end="url(#arrow-${edge.status})" opacity="${edge.status === 'planned' ? '0.55' : '0.9'}"/>`
    );
  }

  for (const node of run?.nodes ?? []) {
    const position = nodePositions.get(node.id);
    if (!position) continue;
    const color = statusColor(node.status, palette);
    const attempt = node.attempt && node.attempt > 1 ? ` · R${node.attempt}` : '';
    const progress = blockProgress(node);
    svg.push(
      `<g${node.status === 'running' ? ' filter="url(#glow)"' : ''}>`,
      `<rect x="${position.x}" y="${position.y}" width="${cardWidth}" height="${cardHeight}" rx="8" fill="${palette.surface}" stroke="${color}" stroke-width="${node.status === 'running' ? 3 : 1.5}"/>`,
      `<rect x="${position.x}" y="${position.y}" width="4" height="${cardHeight}" rx="2" fill="${color}"/>`,
      `<text x="${position.x + 15}" y="${position.y + 25}" fill="${palette.text}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="650">${xml(truncate(node.label, Math.max(10, Math.floor(cardWidth / 8))))}</text>`,
      `<text x="${position.x + 15}" y="${position.y + 45}" fill="${color}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="10" font-weight="700">${statusLabel(node.status)}${xml(attempt)}${progress ? ` · ${xml(progress)}` : ''}</text>`,
      '</g>'
    );
  }

  svg.push(
    `<rect x="${inspectorX}" y="156" width="${inspectorWidth}" height="${Math.max(250, height - 210)}" rx="12" fill="${palette.surface}" stroke="${palette.grid}" stroke-width="1.5"/>`,
    `<text x="${inspectorX + 24}" y="191" fill="${palette.cyan}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12" font-weight="700" letter-spacing="1.5">INSPECT</text>`,
    `<text x="${inspectorX + 24}" y="224" fill="${palette.text}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="19" font-weight="650">${xml(truncate(selected?.label ?? 'No active block', 24))}</text>`
  );
  const details = [
    ['STATE', selected ? statusLabel(selected.status) : 'STANDBY'],
    ['PHASE', selected?.group ?? 'GENERAL'],
    ['ATTEMPT', selected?.attempt ? String(selected.attempt) : '—'],
    ['PROGRESS', selected ? blockProgress(selected) || '—' : '—'],
    ['TOUCHES', String(run?.run.touches.length ?? 0)],
    ['ARTIFACTS', String(run?.run.artifacts.length ?? 0)],
    ['WARNINGS', String(run?.warningCount ?? 0)],
  ];
  details.forEach(([label, value], index) => {
    const y = 273 + index * 45;
    svg.push(
      `<text x="${inspectorX + 24}" y="${y}" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="10" font-weight="700" letter-spacing="1">${label}</text>`,
      `<text x="${inspectorX + inspectorWidth - 24}" y="${y}" text-anchor="end" fill="${label === 'STATE' && selected ? statusColor(selected.status, palette) : palette.text}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12" font-weight="700">${xml(value)}</text>`
    );
  });
  svg.push(
    `<text x="${margin}" y="${height - 24}" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="10" letter-spacing="1">EVENT-DRIVEN · DETERMINISTIC · LOCAL-FIRST</text>`,
    `<text x="${width - margin}" y="${height - 24}" text-anchor="end" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="10">${options.redact ? 'PRODUCT-SAFE CAPTURE' : xml(run?.run.runId.slice(0, 8).toUpperCase() ?? 'NO RUN')}</text>`,
    '</svg>'
  );
  return `${svg.join('\n')}\n`;
}

export function writeActivityCapture(
  snapshot: ActivityMonitorView,
  options: ActivityCaptureOptions
): { outputPath: string; width: number; height: number; bytes: number } {
  const preset = options.preset ?? 'github';
  const outputPath = path.resolve(options.outputPath);
  if (path.extname(outputPath).toLowerCase() !== '.svg') {
    throw new Error('Activity capture output must use the .svg extension.');
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const content = renderActivityCaptureSvg(snapshot, options);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { outputPath, ...PRESET_SIZE[preset], bytes: Buffer.byteLength(content) };
}
