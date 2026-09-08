export const WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION = 'workspace-activity-event.v1' as const;

export const WORKSPACE_ACTIVITY_EVENT_KINDS = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'block.planned',
  'block.started',
  'block.progress',
  'block.completed',
  'block.failed',
  'block.blocked',
  'block.skipped',
  'edge.declared',
  'operation.started',
  'operation.completed',
  'operation.failed',
  'touch.planned',
  'touch.observed',
  'artifact.published',
  'artifact.rejected',
  'warning.detected',
] as const;

export const WORKSPACE_ACTIVITY_STATUSES = [
  'planned',
  'running',
  'succeeded',
  'warned',
  'blocked',
  'failed',
  'cancelled',
  'skipped',
  'rolled-back',
] as const;

export type WorkspaceActivityEventKind = (typeof WORKSPACE_ACTIVITY_EVENT_KINDS)[number];
export type WorkspaceActivityStatus = (typeof WORKSPACE_ACTIVITY_STATUSES)[number];
export type WorkspaceActivityScopeKind = 'ephemeral-project' | 'project' | 'workspace';

export type WorkspaceActivityScope = {
  kind: WorkspaceActivityScopeKind;
  id: string;
  /** Local display name only. It is never a portable WIS identity. */
  label: string;
  portable: boolean;
};

export type WorkspaceActivityOrigin = {
  /** Machine-local identity of the project/root that launched the command. */
  id: string;
  kind: 'project' | 'workspace-root';
  label: string;
};

/**
 * A portable reference from observed execution to canonical workspace evidence.
 *
 * Bindings never promote activity into verification evidence. Consumers must
 * still resolve and validate the referenced artifact or Graph revision before
 * making an architectural or release claim.
 */
type WorkspaceActivityEvidenceBindingBase = {
  ref: string;
  role: 'input' | 'output' | 'verification' | 'subject';
  provenance: 'authoritative' | 'observed';
};

export type WorkspaceActivityEvidenceBinding =
  | (WorkspaceActivityEvidenceBindingBase & {
      kind: 'artifact' | 'project';
      graphSourceHash?: string;
    })
  | (WorkspaceActivityEvidenceBindingBase & {
      kind: 'graph-entity' | 'graph-relation' | 'proof';
      /** Exact Graph revision that gives this identity meaning. */
      graphSourceHash: string;
    });

export type WorkspaceActivityBlueprintNode = {
  id: string;
  label: string;
  parentId?: string;
  order: number;
  layoutHint?: 'source' | 'process' | 'gate' | 'sink';
  group?: string;
  evidenceBindings?: WorkspaceActivityEvidenceBinding[];
};

export type WorkspaceActivityBlueprintEdge = {
  id: string;
  from: string;
  to: string;
  kind: 'sequence' | 'parallel' | 'gate' | 'handoff';
  order: number;
};

export type WorkspaceActivityBlueprint = {
  id: string;
  version: number;
  nodes: WorkspaceActivityBlueprintNode[];
  edges?: WorkspaceActivityBlueprintEdge[];
};

export type WorkspaceActivityEvent = {
  schemaVersion: typeof WORKSPACE_ACTIVITY_EVENT_SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  timestamp: string;
  runId: string;
  parentRunId?: string;
  spanId?: string;
  parentSpanId?: string;
  causationId?: string;
  correlationId?: string;
  scope: WorkspaceActivityScope;
  kind: WorkspaceActivityEventKind;
  status: WorkspaceActivityStatus;
  component: string;
  message: string;
  blockId?: string;
  /** One-based execution attempt for block events. Planned blocks have no attempt. */
  attempt?: number;
  /** Physical command origin, distinct from the shared workspace activity scope. */
  origin?: WorkspaceActivityOrigin;
  edge?: {
    id: string;
    fromBlockId: string;
    toBlockId: string;
    kind: WorkspaceActivityBlueprintEdge['kind'];
  };
  projectId?: string;
  durationMs?: number;
  progress?: {
    completed?: number;
    total?: number;
    percent?: number;
    iteration?: number;
    iterations?: number;
  };
  target?: {
    kind: 'file' | 'directory' | 'artifact' | 'process' | 'workspace' | 'project' | 'other';
    locator?: string;
    operation?: string;
    provenance?: 'authoritative' | 'observed' | 'inferred';
  };
  evidenceBindings?: WorkspaceActivityEvidenceBinding[];
  attributes?: Record<string, unknown>;
};

export type EmitWorkspaceActivityEventInput = Omit<
  WorkspaceActivityEvent,
  'schemaVersion' | 'eventId' | 'sequence' | 'timestamp' | 'runId' | 'scope' | 'origin' | 'attempt'
>;
