import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION } from '../activity/activity-contract.js';
import {
  emitActivityArtifact,
  emitActivityBlock,
  emitWorkspaceActivity,
  finalizeActivityRun,
  initializeActivityRun,
  resetActivityRuntimeForTests,
} from '../activity/activity-runtime.js';
import {
  projectActivitySnapshot,
  projectActivityReplayFrame,
  readActivityFleetSnapshot,
  readActivityEvents,
  readActivitySnapshot,
  reconcileActivityProcessLiveness,
} from '../activity/activity-monitor.js';
import { resolveActivityScope } from '../activity/activity-scope.js';
import {
  WORKSPACE_ACTIVITY_BOARD_SCHEMA_VERSION,
  buildActivityBoardModel,
} from '../activity/activity-board.js';
import { renderActivityTerminal } from '../activity/activity-terminal.js';
import { renderActivityCaptureSvg, writeActivityCapture } from '../activity/activity-capture.js';
import { resolveCliActivityBlueprint } from '../activity/cli-activity-blueprints.js';
import {
  activitySnapshotComparisonKey,
  projectLiveJsonOutput,
  renderActivityScreenDiff,
} from '../live-command.js';

describe('workspace activity runtime', () => {
  let projectPath: string;
  let statePath: string;
  let previousForce: string | undefined;
  let previousStatePath: string | undefined;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-activity-project-'));
    statePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-activity-state-'));
    fs.writeFileSync(path.join(projectPath, 'package.json'), '{"name":"activity-fixture"}\n');
    previousForce = process.env.WORKSPAI_ACTIVITY_FORCE;
    previousStatePath = process.env.WORKSPAI_ACTIVITY_STATE_DIR;
    process.env.WORKSPAI_ACTIVITY_FORCE = '1';
    process.env.WORKSPAI_ACTIVITY_STATE_DIR = statePath;
  });

  afterEach(() => {
    resetActivityRuntimeForTests();
    if (previousForce === undefined) delete process.env.WORKSPAI_ACTIVITY_FORCE;
    else process.env.WORKSPAI_ACTIVITY_FORCE = previousForce;
    if (previousStatePath === undefined) delete process.env.WORKSPAI_ACTIVITY_STATE_DIR;
    else process.env.WORKSPAI_ACTIVITY_STATE_DIR = previousStatePath;
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(statePath, { recursive: true, force: true });
  });

  it('records a durable run, live blocks and portable artifact locators without adopting', () => {
    initializeActivityRun({
      runId: 'run-activity-12345678',
      command: ['workspace', 'intelligence', 'run'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: {
        id: 'test.intelligence',
        version: 1,
        nodes: [{ id: 'model', label: 'Build model', order: 1 }],
      },
    });
    emitActivityBlock({
      blockId: 'model',
      status: 'running',
      message: 'Building model',
      progress: { completed: 5, total: 10, percent: 50 },
    });
    emitActivityArtifact({
      workspacePath: projectPath,
      relativePath: '.workspai/reports/model.json',
    });
    emitActivityBlock({ blockId: 'model', status: 'succeeded', message: 'Model built' });
    finalizeActivityRun(0);

    const result = readActivityEvents({ targetPath: projectPath });
    expect(result.resolvedScope.scope.kind).toBe('ephemeral-project');
    expect(result.events[0]?.kind).toBe('run.started');
    expect(result.events.at(-1)?.kind).toBe('run.completed');
    expect(result.events.some((event) => event.kind === 'block.progress')).toBe(true);
    expect(
      result.events.find((event) => event.kind === 'artifact.published')?.target?.locator
    ).toBe('.workspai/reports/model.json');
    expect(fs.existsSync(path.join(projectPath, '.workspai'))).toBe(false);
  });

  it('redacts sensitive command arguments before journaling', () => {
    initializeActivityRun({
      runId: 'run-redaction-12345678',
      command: ['config', 'set-api-key', '--key', 'secret-value'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
    });
    emitWorkspaceActivity({
      kind: 'operation.failed',
      status: 'failed',
      component: 'config',
      message: `Failed at ${path.join(projectPath, 'config.json')}: secret-value token=second-secret`,
      attributes: {
        error: new Error(`secret-value rejected in ${path.join(projectPath, 'config.json')}`),
      },
    });
    finalizeActivityRun(0);

    const events = readActivityEvents({ targetPath: projectPath }).events;
    const started = events[0];
    expect(started?.attributes?.command).toEqual(['config', 'set-api-key', '--key', '[REDACTED]']);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('second-secret');
    expect(serialized).not.toContain(projectPath);
  });

  it('projects journals into a deterministic terminal execution graph', () => {
    initializeActivityRun({
      runId: 'run-terminal-12345678',
      command: ['doctor', 'workspace'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
    });
    emitActivityBlock({
      blockId: 'doctor.observe',
      status: 'running',
      message: 'Collect health evidence',
      progress: { completed: 2, total: 4 },
    });

    const read = readActivityEvents({ targetPath: projectPath });
    const snapshot = projectActivitySnapshot({
      resolvedScope: read.resolvedScope,
      events: read.events,
    });
    const rendered = renderActivityTerminal(snapshot, { width: 100, now: Date.now() });
    expect(rendered).toContain('WORKSPAI LIVE');
    expect(rendered).toContain('workspai doctor workspace');
    expect(rendered).toContain('Collect health');
    expect(rendered).toContain('RUN 2/4');
  });

  it('projects declared DAG edges into a bounded animated flow board', () => {
    initializeActivityRun({
      runId: 'run-flow-board-12345678',
      command: ['workspace', 'run', 'test'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: {
        id: 'test.flow-board',
        version: 2,
        nodes: [
          { id: 'command.workspace.run', label: 'workspace run', order: 0 },
          {
            id: 'resolve',
            label: 'Resolve',
            order: 1,
            parentId: 'command.workspace.run',
            layoutHint: 'source',
          },
          {
            id: 'execute',
            label: 'Execute',
            order: 2,
            parentId: 'command.workspace.run',
          },
          {
            id: 'publish',
            label: 'Publish',
            order: 3,
            parentId: 'command.workspace.run',
            layoutHint: 'sink',
          },
        ],
        edges: [
          { id: 'resolve->execute', from: 'resolve', to: 'execute', kind: 'sequence', order: 1 },
          { id: 'execute->publish', from: 'execute', to: 'publish', kind: 'handoff', order: 2 },
        ],
      },
    });
    emitActivityBlock({ blockId: 'resolve', status: 'running', message: 'Resolving fleet' });
    emitActivityBlock({ blockId: 'resolve', status: 'succeeded', message: 'Fleet resolved' });

    const snapshot = readActivitySnapshot({ targetPath: projectPath });
    const board = buildActivityBoardModel(snapshot);
    expect(board.schemaVersion).toBe(WORKSPACE_ACTIVITY_BOARD_SCHEMA_VERSION);
    expect(board.runs[0]?.nodes.map((node) => node.id)).toEqual(['resolve', 'execute', 'publish']);
    expect(board.runs[0]?.edges).toMatchObject([
      { id: 'resolve->execute', status: 'running', inferred: false },
      { id: 'execute->publish', status: 'planned', inferred: false },
    ]);

    const rendered = renderActivityTerminal(snapshot, {
      width: 100,
      height: 18,
      frame: 0,
      ascii: true,
      color: false,
      motion: true,
    });
    expect(rendered).toContain('=------');
    expect(rendered.split('\n').length).toBeLessThanOrEqual(18);
    expect(rendered.split('\n').every((line) => [...line].length <= 100)).toBe(true);

    const narrow = renderActivityTerminal(snapshot, {
      width: 32,
      height: 4,
      ascii: true,
      color: false,
      motion: false,
      interactive: true,
    });
    expect(narrow.split('\n').length).toBeLessThanOrEqual(4);
    expect(narrow.split('\n').every((line) => [...line].length <= 32)).toBe(true);

    const primaryRun = snapshot.runs[0]!;
    const secondaryMessage = 'RAW VERBOSE SECONDARY STAGE MESSAGE MUST NOT RENDER';
    const concurrentSnapshot = {
      ...snapshot,
      runs: [
        primaryRun,
        {
          ...primaryRun,
          runId: 'run-peer-active-12345678',
          command: ['doctor', 'workspace'],
          blocks: [{ ...primaryRun.blocks[0]!, id: 'peer.observe', label: secondaryMessage }],
          edges: [],
        },
        {
          ...primaryRun,
          runId: 'run-history-12345678',
          command: ['init'],
          status: 'succeeded' as const,
          blocks: [],
          edges: [],
        },
      ],
    };
    const concurrent = renderActivityTerminal(concurrentSnapshot, {
      width: 120,
      height: 18,
      selectedRunId: primaryRun.runId,
      ascii: true,
      color: false,
      motion: false,
      interactive: true,
    });
    expect(concurrent).toContain('ALSO ACTIVE');
    expect(concurrent).toContain('doctor workspace');
    expect(concurrent).not.toContain(secondaryMessage);
    expect(concurrent).not.toContain('workspai init');
  });

  it('tracks and renders repeated block attempts while reactivating its incoming wire', () => {
    initializeActivityRun({
      runId: 'run-retry-12345678',
      command: ['analyze'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: {
        id: 'test.retry',
        version: 1,
        nodes: [
          { id: 'prepare', label: 'Prepare', order: 1 },
          { id: 'analyze', label: 'Analyze', order: 2 },
        ],
        edges: [
          { id: 'prepare->analyze', from: 'prepare', to: 'analyze', kind: 'sequence', order: 1 },
        ],
      },
    });
    emitActivityBlock({ blockId: 'prepare', status: 'succeeded', message: 'Prepared' });
    emitActivityBlock({ blockId: 'analyze', status: 'running', message: 'Analyzing' });
    emitActivityBlock({ blockId: 'analyze', status: 'failed', message: 'Transient failure' });
    emitActivityBlock({ blockId: 'analyze', status: 'running', message: 'Analyzing again' });

    const events = readActivityEvents({ targetPath: projectPath }).events.filter(
      (event) => event.blockId === 'analyze' && event.kind !== 'block.planned'
    );
    expect(events.map((event) => event.attempt)).toEqual([1, 1, 2]);
    const snapshot = readActivitySnapshot({ targetPath: projectPath });
    const block = snapshot.runs[0]?.blocks.find((entry) => entry.id === 'analyze');
    expect(block).toMatchObject({ status: 'running', attempt: 2 });
    expect(block?.attempts).toMatchObject([
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'running' },
    ]);
    expect(snapshot.runs[0]?.edges[0]?.status).toBe('running');
    const rendered = renderActivityTerminal(snapshot, {
      width: 100,
      height: 18,
      ascii: false,
      color: false,
      motion: true,
      frame: 1,
    });
    expect(rendered).toContain('↻2');
    expect(rendered).toContain('╍');
    expect(rendered).not.toMatch(/[◀▶▼]/);
  });

  it('renders semantic phases and a factual adaptive inspector from blueprint metadata', () => {
    const blueprint = resolveCliActivityBlueprint(['workspace', 'intelligence', 'run']);
    initializeActivityRun({
      runId: 'run-semantic-board-12345678',
      command: ['workspace', 'intelligence', 'run'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint,
    });
    emitActivityBlock({
      blockId: 'workspace.intelligence.stage.model',
      status: 'running',
      message: 'Build model and graph',
      progress: { percent: 42 },
    });
    const snapshot = readActivitySnapshot({ targetPath: projectPath });
    expect(
      snapshot.runs[0]?.blocks.find((block) => block.id === 'workspace.intelligence.stage.model')
        ?.group
    ).toBe('UNDERSTAND');
    const rendered = renderActivityTerminal(snapshot, {
      width: 170,
      height: 34,
      ascii: true,
      color: false,
      motion: false,
      inspector: true,
    });
    expect(rendered).toContain('PHASES');
    expect(rendered).toContain('UNDERSTAND');
    expect(rendered).toContain('ASSURE');
    expect(rendered).toContain('INSPECT');
    expect(rendered).toContain('PROGRESS   42%');
  });

  it('creates deterministic, redacted and platform-sized SVG product captures', () => {
    initializeActivityRun({
      runId: 'run-capture-secret-12345678',
      command: ['doctor', 'workspace', projectPath],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: resolveCliActivityBlueprint(['doctor', 'workspace']),
    });
    emitActivityBlock({ blockId: 'doctor.observe', status: 'running', message: 'Observe' });
    const snapshot = readActivitySnapshot({ targetPath: projectPath });
    const first = renderActivityCaptureSvg(snapshot, {
      preset: 'linkedin',
      theme: 'obsidian',
      redact: true,
      now: 1_700_000_000_000,
    });
    const second = renderActivityCaptureSvg(snapshot, {
      preset: 'linkedin',
      theme: 'obsidian',
      redact: true,
      now: 1_700_000_000_000,
    });
    expect(first).toBe(second);
    expect(first).toContain('<svg');
    expect(first).toContain('width="1200" height="627"');
    expect(first).toContain('PRODUCT-SAFE CAPTURE');
    expect(first).not.toContain(projectPath);
    expect(first).not.toContain('run-capture-secret');

    const outputPath = path.join(statePath, 'captures', 'activity.svg');
    const receipt = writeActivityCapture(snapshot, {
      outputPath,
      preset: 'linkedin',
      redact: true,
      now: 1_700_000_000_000,
    });
    expect(receipt).toMatchObject({ outputPath, width: 1200, height: 627 });
    expect(fs.readFileSync(outputPath, 'utf8')).toBe(first);
  });

  it('offers a stable screen-reader view without animation or terminal control sequences', () => {
    initializeActivityRun({
      runId: 'run-accessible-12345678',
      command: ['doctor', 'workspace'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
    });
    emitActivityBlock({
      blockId: 'doctor.observe',
      status: 'running',
      message: 'Observe\u001b[2J\nInjected',
    });
    const rendered = renderActivityTerminal(readActivitySnapshot({ targetPath: projectPath }), {
      width: 100,
      accessible: true,
      color: true,
      motion: true,
    });
    expect(rendered).toContain('RUN RUNNING | workspai doctor workspace');
    expect(rendered).toContain('BLOCK RUNNING | Observe');
    expect(rendered).toContain('Injected');
    expect(rendered).not.toMatch(/\x1b\[/);
  });

  it('updates only changed terminal rows and clears rows removed by a smaller frame', () => {
    const initial = renderActivityScreenDiff([], 'header\nactive\nfooter', {
      force: true,
      height: 10,
    });
    expect(initial.output).toContain('\x1b[2J');
    const update = renderActivityScreenDiff(initial.lines, 'header\ncomplete', { height: 10 });
    expect(update.output).not.toContain('\x1b[1;1H\x1b[2Kheader');
    expect(update.output).toContain('\x1b[2;1H\x1b[2Kcomplete');
    expect(update.output).toContain('\x1b[3;1H\x1b[2K');
    expect(renderActivityScreenDiff(update.lines, 'header\ncomplete', { height: 10 }).output).toBe(
      ''
    );
  });

  it('projects bounded deterministic replay frames from the durable event stream', () => {
    initializeActivityRun({
      runId: 'run-replay-12345678',
      command: ['doctor'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: resolveCliActivityBlueprint(['doctor']),
    });
    emitActivityBlock({ blockId: 'doctor.observe', status: 'running', message: 'Observe' });
    emitActivityBlock({ blockId: 'doctor.observe', status: 'succeeded', message: 'Observed' });
    finalizeActivityRun(0);
    const replay = readActivityEvents({ targetPath: projectPath, runId: 'run-replay-12345678' });
    const middleIndex = replay.events.findIndex(
      (event) => event.blockId === 'doctor.observe' && event.status === 'running'
    );
    const middle = projectActivityReplayFrame({
      resolvedScope: replay.resolvedScope,
      events: replay.events,
      eventCount: middleIndex + 1,
    });
    const final = projectActivityReplayFrame({
      resolvedScope: replay.resolvedScope,
      events: replay.events,
      eventCount: replay.events.length,
    });
    expect(middle.runs[0]?.blocks.find((block) => block.id === 'doctor.observe')?.status).toBe(
      'running'
    );
    expect(final.runs[0]?.status).toBe('succeeded');
    expect(final.runs[0]?.blocks.find((block) => block.id === 'doctor.observe')?.status).toBe(
      'succeeded'
    );
  });

  it('removes orphaned command processes from the active board without rewriting history', () => {
    initializeActivityRun({
      runId: 'run-orphaned-12345678',
      command: ['workspace', 'run', 'init'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: {
        id: 'test.orphan',
        version: 2,
        nodes: [
          { id: 'command.workspace.run', label: 'workspace run', order: 0 },
          {
            id: 'workspace.run.execute',
            label: 'Execute',
            order: 1,
            parentId: 'command.workspace.run',
          },
        ],
      },
    });
    emitActivityBlock({
      blockId: 'workspace.run.execute',
      status: 'running',
      message: 'Executing init',
    });
    const read = readActivityEvents({ targetPath: projectPath });
    const projected = projectActivitySnapshot({
      resolvedScope: read.resolvedScope,
      events: read.events,
    });
    const reconciled = reconcileActivityProcessLiveness(projected, () => false);
    expect(projected.runs[0]?.status).toBe('running');
    expect(reconciled.runs[0]).toMatchObject({ status: 'cancelled', orphaned: true });
    expect(
      reconciled.runs[0]?.blocks.find((block) => block.id === 'workspace.run.execute')?.status
    ).toBe('cancelled');
    expect(buildActivityBoardModel(reconciled).activeRunCount).toBe(0);
  });

  it('uses a workspace channel for linked external projects', () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-activity-workspace-'));
    const siblingProjectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'workspai-activity-sibling-project-')
    );
    try {
      fs.writeFileSync(path.join(workspacePath, '.workspai-workspace'), '1\n');
      fs.mkdirSync(path.join(projectPath, '.workspai'), { recursive: true });
      fs.writeFileSync(
        path.join(projectPath, '.workspai', 'workspace-link.local.json'),
        JSON.stringify({ workspace: { root: workspacePath } })
      );
      const resolved = resolveActivityScope(projectPath);
      expect(resolved.scope.kind).toBe('workspace');
      expect(resolved.rootPath).toBe(workspacePath);
      expect(resolved.observationRootPath).toBe(projectPath);
      expect(resolved.mirrorStatePaths).toHaveLength(1);

      initializeActivityRun({
        runId: 'run-linked-12345678',
        command: ['doctor', 'project'],
        cwd: projectPath,
        rapidkitVersion: '0.65.0',
      });
      finalizeActivityRun(0);
      expect(readActivitySnapshot({ targetPath: workspacePath }).runs[0]?.runId).toBe(
        'run-linked-12345678'
      );
      fs.writeFileSync(path.join(siblingProjectPath, 'package.json'), '{"name":"sibling"}\n');
      fs.mkdirSync(path.join(siblingProjectPath, '.workspai'), { recursive: true });
      fs.writeFileSync(
        path.join(siblingProjectPath, '.workspai', 'workspace-link.local.json'),
        JSON.stringify({ workspace: { root: workspacePath } })
      );
      initializeActivityRun({
        runId: 'run-linked-sibling-12345678',
        command: ['analyze'],
        cwd: siblingProjectPath,
        rapidkitVersion: '0.65.0',
      });
      finalizeActivityRun(0);
      const fleet = readActivityFleetSnapshot({ maxRuns: 10 });
      expect(fleet.scopes).toHaveLength(1);
      expect(fleet.scopes[0]?.runs).toHaveLength(2);
      expect(fleet.scopes[0]?.runs.map((run) => run.origin?.label)).toEqual(
        expect.arrayContaining([path.basename(projectPath), path.basename(siblingProjectPath)])
      );
    } finally {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      fs.rmSync(siblingProjectPath, { recursive: true, force: true });
    }
  });

  it('aggregates independent scopes globally and labels each command origin', () => {
    const secondProjectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'workspai-activity-second-project-')
    );
    try {
      fs.writeFileSync(path.join(secondProjectPath, 'package.json'), '{"name":"second"}\n');
      initializeActivityRun({
        runId: 'run-global-first-12345678',
        command: ['doctor'],
        cwd: projectPath,
        rapidkitVersion: '0.65.0',
      });
      finalizeActivityRun(0);
      initializeActivityRun({
        runId: 'run-global-second-12345678',
        command: ['analyze'],
        cwd: secondProjectPath,
        rapidkitVersion: '0.65.0',
      });
      finalizeActivityRun(0);

      const fleet = readActivityFleetSnapshot({ maxRuns: 10, maxScopes: 10 });
      expect(fleet.scopes).toHaveLength(2);
      expect(fleet.scopes.flatMap((scope) => scope.runs.map((run) => run.runId)).sort()).toEqual([
        'run-global-first-12345678',
        'run-global-second-12345678',
      ]);
      expect(buildActivityBoardModel(fleet).runs.map((run) => run.locationLabel)).toEqual(
        expect.arrayContaining([path.basename(projectPath), path.basename(secondProjectPath)])
      );
      const rendered = renderActivityTerminal(fleet, {
        width: 140,
        height: 18,
        ascii: true,
        color: false,
        motion: false,
      });
      expect(rendered).toContain('Global activity');
      expect(rendered).toContain('2 SCOPES');
      expect(rendered).toContain('FLEET');
      expect(rendered).toContain('workspai-activity-');
    } finally {
      fs.rmSync(secondProjectPath, { recursive: true, force: true });
    }
  });

  it('validates emitted events against the published JSON schema', () => {
    initializeActivityRun({
      runId: 'run-schema-12345678',
      command: ['analyze'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
      blueprint: {
        id: 'test.schema-edges',
        version: 2,
        nodes: [
          { id: 'first', label: 'First', order: 1 },
          { id: 'second', label: 'Second', order: 2 },
        ],
        edges: [{ id: 'first->second', from: 'first', to: 'second', kind: 'sequence', order: 1 }],
      },
    });
    finalizeActivityRun(0);
    const snapshot = readActivitySnapshot({ targetPath: projectPath });
    expect(snapshot.runs).toHaveLength(1);
    const emittedEvents = readActivityEvents({ targetPath: projectPath }).events;
    expect(emittedEvents.some((event) => event.kind === 'edge.declared')).toBe(true);
    expect(
      emittedEvents.some(
        (event) =>
          event.blockId === 'second' && event.kind === 'block.skipped' && event.status === 'skipped'
      )
    ).toBe(true);
    expect(
      emittedEvents.find((event) => event.blockId === 'second' && event.kind === 'block.skipped')
        ?.attempt
    ).toBeUndefined();

    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'contracts', 'workspace-activity-event.v1.json'),
        'utf8'
      )
    );
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    for (const event of emittedEvents) {
      expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
      expect(event.schemaVersion).toBe(WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION);
    }

    const snapshotSchema = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'contracts', 'workspace-activity-monitor-snapshot.v1.json'),
        'utf8'
      )
    );
    const boardSchema = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'contracts', 'workspace-activity-board.v1.json'),
        'utf8'
      )
    );
    const fleetSchema = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'contracts', 'workspace-activity-monitor-fleet.v1.json'),
        'utf8'
      )
    );
    const projectionAjv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(projectionAjv);
    projectionAjv.addSchema(snapshotSchema);
    const validateSnapshot = projectionAjv.getSchema(snapshotSchema.$id)!;
    const board = projectLiveJsonOutput(snapshot, { projection: 'board', maxRuns: 6 });
    const validateBoard = projectionAjv.compile(boardSchema);
    const validateFleet = projectionAjv.compile(fleetSchema);
    expect(validateSnapshot(snapshot), JSON.stringify(validateSnapshot.errors)).toBe(true);
    expect(validateBoard(board), JSON.stringify(validateBoard.errors)).toBe(true);
    expect(
      validateFleet({
        schemaVersion: 'workspace-activity-monitor-fleet.v1',
        generatedAt: snapshot.generatedAt,
        scopes: [snapshot],
        diagnostics: [],
      }),
      JSON.stringify(validateFleet.errors)
    ).toBe(true);
  });

  it('ignores generated timestamps when comparing global non-TTY snapshots', () => {
    const fleet = readActivityFleetSnapshot({ maxRuns: 10 });
    const later = {
      ...fleet,
      generatedAt: '2099-01-01T00:00:00.000Z',
      scopes: fleet.scopes.map((scope) => ({
        ...scope,
        generatedAt: '2099-01-01T00:00:00.000Z',
      })),
    };
    expect(activitySnapshotComparisonKey(later)).toBe(activitySnapshotComparisonKey(fleet));
  });

  it('bounds writer-side retention even when no live monitor has been opened', () => {
    const resolved = resolveActivityScope(projectPath);
    const runsPath = path.join(resolved.statePath, 'runs');
    fs.mkdirSync(runsPath, { recursive: true });
    for (let index = 0; index < 205; index += 1) {
      const journalPath = path.join(runsPath, `old-${String(index).padStart(3, '0')}.ndjson`);
      fs.writeFileSync(journalPath, '{}\n');
      const timestamp = new Date(Date.now() - (index + 1) * 1_000);
      fs.utimesSync(journalPath, timestamp, timestamp);
    }

    initializeActivityRun({
      runId: 'run-retention-12345678',
      command: ['doctor'],
      cwd: projectPath,
      rapidkitVersion: '0.65.0',
    });
    finalizeActivityRun(0);

    expect(
      fs.readdirSync(runsPath).filter((name) => name.endsWith('.ndjson')).length
    ).toBeLessThanOrEqual(200);
  });
});
