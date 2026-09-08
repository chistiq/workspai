import type {
  WorkspaceActivityBlueprint,
  WorkspaceActivityBlueprintEdge,
  WorkspaceActivityBlueprintNode,
} from './activity-contract.js';

function node(
  id: string,
  label: string,
  order: number,
  parentId?: string,
  layoutHint: WorkspaceActivityBlueprintNode['layoutHint'] = 'process',
  group?: string
): WorkspaceActivityBlueprintNode {
  return {
    id,
    label,
    order,
    layoutHint,
    ...(parentId ? { parentId } : {}),
    ...(group ? { group } : {}),
  };
}

function sequentialEdges(
  nodes: readonly WorkspaceActivityBlueprintNode[]
): WorkspaceActivityBlueprintEdge[] {
  return nodes.slice(1).map((current, index) => {
    const previous = nodes[index];
    return {
      id: `${previous.id}->${current.id}`,
      from: previous.id,
      to: current.id,
      kind:
        current.layoutHint === 'gate'
          ? 'gate'
          : current.layoutHint === 'sink'
            ? 'handoff'
            : 'sequence',
      order: index + 1,
    };
  });
}

const INTELLIGENCE_STEPS = [
  ['workspace.intelligence.preflight.sync', 'Sync', 'source', 'DISCOVER'],
  ['workspace.intelligence.stage.model', 'Model + Graph', 'process', 'UNDERSTAND'],
  ['workspace.intelligence.preflight.baseline', 'Baseline', 'process', 'UNDERSTAND'],
  ['workspace.intelligence.stage.diff', 'Diff', 'process', 'UNDERSTAND'],
  ['workspace.intelligence.stage.impact', 'Impact', 'process', 'UNDERSTAND'],
  ['workspace.intelligence.stage.doctor-evidence', 'Doctor', 'gate', 'ASSURE'],
  ['workspace.intelligence.stage.contract-evidence', 'Contracts', 'gate', 'ASSURE'],
  ['workspace.intelligence.stage.analyze-evidence', 'Analyze', 'gate', 'ASSURE'],
  ['workspace.intelligence.stage.readiness-evidence', 'Readiness', 'gate', 'ASSURE'],
  ['workspace.intelligence.stage.verify', 'Verify', 'gate', 'ASSURE'],
  ['workspace.intelligence.stage.context', 'Context', 'process', 'PUBLISH'],
  ['workspace.intelligence.stage.agent-sync', 'Agent Sync', 'process', 'PUBLISH'],
  ['workspace.intelligence.stage.explain', 'Explain', 'sink', 'PUBLISH'],
] as const;

function buildBlueprint(
  id: string,
  rootNode: WorkspaceActivityBlueprintNode,
  stages: WorkspaceActivityBlueprintNode[]
): WorkspaceActivityBlueprint {
  return {
    id,
    version: 3,
    nodes: [rootNode, ...stages],
    edges: sequentialEdges(stages),
  };
}

export function resolveCliActivityBlueprint(
  command: readonly string[]
): WorkspaceActivityBlueprint {
  const normalized = command
    .filter((part) => !part.startsWith('-') && /^[a-z][a-z0-9-]*$/i.test(part))
    .slice(0, 3);
  const root = normalized.slice(0, 3).join('.') || 'cli';
  const rootId = `command.${root}`;
  const rootNode = node(rootId, normalized.join(' ') || 'Workspai command', 0, undefined, 'source');

  if (normalized[0] === 'workspace' && normalized[1] === 'intelligence') {
    const stages = INTELLIGENCE_STEPS.map(([id, label, hint, group], index) =>
      node(id, label, index + 1, rootId, hint, group)
    );
    return buildBlueprint(`cli.${root}`, rootNode, stages);
  }

  if (normalized[0] === 'adopt') {
    return buildBlueprint(`cli.${root}`, rootNode, [
      node('adopt.resolve', 'Resolve', 1, rootId, 'source', 'DISCOVER'),
      node('adopt.detect', 'Detect', 2, rootId, 'process', 'DISCOVER'),
      node('adopt.link', 'Link', 3, rootId, 'process', 'CONNECT'),
      node('adopt.publish', 'Seal Intelligence', 4, rootId, 'gate', 'PUBLISH'),
      node('adopt.ground', 'Agent Entry', 5, rootId, 'sink', 'PUBLISH'),
    ]);
  }

  if (normalized[0] === 'workspace' && normalized[1] === 'run') {
    return buildBlueprint(`cli.${root}`, rootNode, [
      node('workspace.run.resolve', 'Resolve Fleet', 1, rootId, 'source', 'DISCOVER'),
      node('workspace.run.gates', 'Gates', 2, rootId, 'gate', 'ASSURE'),
      node('workspace.run.execute', 'Execute', 3, rootId, 'process', 'EXECUTE'),
      node('workspace.run.publish', 'Publish', 4, rootId, 'sink', 'PUBLISH'),
    ]);
  }

  if (normalized[0] === 'doctor') {
    return buildBlueprint(`cli.${root}`, rootNode, [
      node('doctor.observe', 'Observe', 1, rootId, 'source', 'OBSERVE'),
      node('doctor.diagnose', 'Diagnose', 2, rootId, 'process', 'DIAGNOSE'),
      node('doctor.plan', 'Plan', 3, rootId, 'process', 'DECIDE'),
      node('doctor.verify', 'Verify', 4, rootId, 'gate', 'VERIFY'),
    ]);
  }

  if (normalized[0] === 'workspace' && normalized[1] === 'repair') {
    return buildBlueprint(`cli.${root}`, rootNode, [
      node('repair.observe', 'Observe', 1, rootId, 'source', 'OBSERVE'),
      node('repair.plan', 'Plan', 2, rootId, 'process', 'DECIDE'),
      node('repair.authorize', 'Authorize', 3, rootId, 'gate', 'AUTHORIZE'),
      node('repair.execute', 'Execute', 4, rootId, 'process', 'EXECUTE'),
      node('repair.verify', 'Verify', 5, rootId, 'gate', 'VERIFY'),
    ]);
  }

  return { id: `cli.${root}`, version: 3, nodes: [rootNode], edges: [] };
}
