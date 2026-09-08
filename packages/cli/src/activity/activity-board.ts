import type {
  ActivityBlockView,
  ActivityEdgeView,
  ActivityMonitorView,
  ActivityRunView,
} from './activity-monitor.js';
import type { WorkspaceActivityScope } from './activity-contract.js';
import type { WorkspaceActivityStatus } from './activity-contract.js';

const ACTIVE_STATUSES = new Set<WorkspaceActivityStatus>(['planned', 'running']);

export const WORKSPACE_ACTIVITY_BOARD_SCHEMA_VERSION = 'workspace-activity-board.v1' as const;

export type ActivityBoardNode = ActivityBlockView & {
  root: boolean;
};

export type ActivityBoardEdge = ActivityEdgeView & {
  inferred: boolean;
};

export type ActivityBoardRun = {
  run: ActivityRunView;
  commandLabel: string;
  active: boolean;
  nodes: ActivityBoardNode[];
  edges: ActivityBoardEdge[];
  activeBlockCount: number;
  warningCount: number;
  scope: WorkspaceActivityScope;
  locationLabel: string;
};

export type ActivityBoardModel = {
  schemaVersion: typeof WORKSPACE_ACTIVITY_BOARD_SCHEMA_VERSION;
  scopeLabel: string;
  generatedAt: string;
  activeRunCount: number;
  healthyRunCount: number;
  warningRunCount: number;
  failedRunCount: number;
  selectedRunId?: string;
  runs: ActivityBoardRun[];
  diagnostics: string[];
  global: boolean;
  scopeCount: number;
};

function isActiveStatus(status: WorkspaceActivityStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function commandLabel(run: ActivityRunView): string {
  return run.command.length > 0
    ? `workspai ${run.command.join(' ')}`
    : `run ${run.runId.slice(0, 8)}`;
}

function inferSequentialEdges(nodes: readonly ActivityBoardNode[]): ActivityBoardEdge[] {
  return nodes.slice(1).map((node, index) => {
    const previous = nodes[index];
    return {
      id: `inferred:${previous.id}->${node.id}`,
      fromBlockId: previous.id,
      toBlockId: node.id,
      kind:
        node.layoutHint === 'gate' ? 'gate' : node.layoutHint === 'sink' ? 'handoff' : 'sequence',
      status: deriveInferredEdgeStatus(previous.status, node.status),
      order: index + 1,
      updatedAt: node.updatedAt,
      inferred: true,
    };
  });
}

function deriveInferredEdgeStatus(
  source: WorkspaceActivityStatus,
  target: WorkspaceActivityStatus
): WorkspaceActivityStatus {
  if (target !== 'planned') return target;
  if (source === 'succeeded' || source === 'warned') return 'running';
  if (source === 'failed' || source === 'blocked' || source === 'cancelled') return source;
  return 'planned';
}

function toBoardRun(
  run: ActivityRunView,
  scope: WorkspaceActivityScope,
  display: { scopeLabel: string; originLabel?: string }
): ActivityBoardRun {
  const sortedBlocks = [...run.blocks].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const hasStages = sortedBlocks.some((block) => block.parentId);
  const nodes = sortedBlocks
    .filter((block) => !hasStages || Boolean(block.parentId))
    .map((block) => ({ ...block, root: !block.parentId }));
  const edges =
    run.edges.length > 0
      ? run.edges.map((edge) => ({ ...edge, inferred: false }))
      : inferSequentialEdges(nodes);
  return {
    run,
    commandLabel: commandLabel(run),
    active: run.status === 'running',
    nodes,
    edges,
    activeBlockCount: nodes.filter((block) => block.status === 'running').length,
    warningCount: run.warnings.length + nodes.filter((block) => block.status === 'warned').length,
    scope,
    locationLabel:
      run.origin && (run.origin.label !== scope.label || display.originLabel !== run.origin.label)
        ? `${display.scopeLabel}/${display.originLabel}`
        : display.scopeLabel,
  };
}

export function buildActivityBoardModel(
  snapshot: ActivityMonitorView,
  options: { selectedRunId?: string; activeOnly?: boolean; maxRuns?: number } = {}
): ActivityBoardModel {
  const maxRuns = Math.max(1, options.maxRuns ?? 6);
  const global = snapshot.schemaVersion === 'workspace-activity-monitor-fleet.v1';
  const scopes = global ? snapshot.scopes : [snapshot];
  const scopeLabelIds = new Map<string, Set<string>>();
  const originLabelIds = new Map<string, Set<string>>();
  for (const scope of scopes) {
    const scopeIds = scopeLabelIds.get(scope.scope.label) ?? new Set<string>();
    scopeIds.add(scope.scope.id);
    scopeLabelIds.set(scope.scope.label, scopeIds);
    for (const run of scope.runs) {
      if (!run.origin) continue;
      const key = `${scope.scope.id}\u0000${run.origin.label}`;
      const originIds = originLabelIds.get(key) ?? new Set<string>();
      originIds.add(run.origin.id);
      originLabelIds.set(key, originIds);
    }
  }
  const allRuns = scopes
    .flatMap((scope) =>
      scope.runs.map((run) => {
        const scopeLabel =
          (scopeLabelIds.get(scope.scope.label)?.size ?? 0) > 1
            ? `${scope.scope.label}#${scope.scope.id.slice(-4)}`
            : scope.scope.label;
        const originKey = run.origin ? `${scope.scope.id}\u0000${run.origin.label}` : undefined;
        const originLabel = run.origin
          ? (originLabelIds.get(originKey ?? '')?.size ?? 0) > 1
            ? `${run.origin.label}#${run.origin.id.slice(-4)}`
            : run.origin.label
          : undefined;
        return toBoardRun(run, scope.scope, { scopeLabel, originLabel });
      })
    )
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return right.run.updatedAt.localeCompare(left.run.updatedAt);
    });
  const visibleRuns = (options.activeOnly ? allRuns.filter((run) => run.active) : allRuns).slice(
    0,
    maxRuns
  );
  const selectedRunId =
    visibleRuns.find((run) => run.run.runId === options.selectedRunId)?.run.runId ??
    visibleRuns.find((run) => run.active)?.run.runId ??
    visibleRuns[0]?.run.runId;

  return {
    schemaVersion: WORKSPACE_ACTIVITY_BOARD_SCHEMA_VERSION,
    scopeLabel: global ? 'Global activity' : (scopes[0]?.scope.label ?? 'activity'),
    generatedAt: snapshot.generatedAt,
    activeRunCount: allRuns.filter((run) => run.active).length,
    healthyRunCount: allRuns.filter((run) => run.run.status === 'succeeded').length,
    warningRunCount: allRuns.filter((run) => run.run.status === 'warned' || run.warningCount > 0)
      .length,
    failedRunCount: allRuns.filter((run) => run.run.status === 'failed').length,
    ...(selectedRunId ? { selectedRunId } : {}),
    runs: visibleRuns,
    diagnostics: global
      ? [...snapshot.diagnostics, ...scopes.flatMap((scope) => scope.diagnostics)]
      : snapshot.diagnostics,
    global,
    scopeCount: scopes.length,
  };
}

export function activityBoardEdgeBetween(
  run: ActivityBoardRun,
  fromBlockId: string,
  toBlockId: string
): ActivityBoardEdge | undefined {
  return run.edges.find((edge) => edge.fromBlockId === fromBlockId && edge.toBlockId === toBlockId);
}

export function activityBoardVisibleRunIds(model: ActivityBoardModel): string[] {
  return model.runs.map((run) => run.run.runId);
}

export function activityBoardHasMotion(model: ActivityBoardModel): boolean {
  return model.runs.some(
    (run) =>
      run.active ||
      run.nodes.some((node) => isActiveStatus(node.status)) ||
      run.edges.some((edge) => edge.status === 'running')
  );
}
