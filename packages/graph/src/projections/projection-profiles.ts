import { GRAPH_PROJECTION_PROFILE_CONTRACT } from '../contracts/projection.js';
import type { GraphProjectionProfile } from '../contracts/projection.js';

const SOURCE_ENTITY_KINDS = Object.freeze([
  'repository',
  'project',
  'module',
  'package',
  'file',
  'symbol',
  'branch',
  'revision',
]);

const OPERATIONAL_ENTITY_KINDS = Object.freeze([
  'service',
  'runtime',
  'container',
  'image',
  'deployment',
  'environment',
  'pipeline',
  'workflow',
  'command',
  'test',
  'artifact',
  'gate',
]);

const OWNERSHIP_ENTITY_KINDS = Object.freeze(['owner', 'team']);

const WORKSPACE_ENTITY_KINDS = Object.freeze(['workspace', 'project', 'service', 'repository']);

function profile(
  id: string,
  includeEntityKinds: readonly string[],
  includeRelationSemantics: GraphProjectionProfile['includeRelationSemantics'],
  includeRelations?: readonly string[]
): GraphProjectionProfile {
  return Object.freeze({
    id,
    version: GRAPH_PROJECTION_PROFILE_CONTRACT.version,
    sourceGraphVersion: '0.1.0-candidate',
    includeEntityKinds,
    includeRelationSemantics,
    includeRelations,
    redactionPolicy: 'portable-default',
  });
}

/** Built-in deterministic projection families declared by ADR-0002. */
export const GRAPH_STANDARD_PROJECTION_PROFILES = Object.freeze({
  source: profile('workspai.graph.projection.source', SOURCE_ENTITY_KINDS, ['structural']),
  structural: profile('workspai.graph.projection.structural', [], ['structural']),
  evidence: profile(
    'workspai.graph.projection.evidence',
    [],
    ['structural', 'declarative', 'behavioral', 'derived']
  ),
  dependency: profile(
    'workspai.graph.projection.dependency',
    [...SOURCE_ENTITY_KINDS, 'service', 'module', 'package'],
    ['structural'],
    ['depends-on', 'imports', 'exports', 'contains']
  ),
  operational: profile(
    'workspai.graph.projection.operational',
    [...OPERATIONAL_ENTITY_KINDS, 'service', 'api', 'endpoint'],
    ['structural', 'declarative', 'behavioral'],
    ['deployed-as', 'runs-on', 'routes-to', 'configured-by', 'contains']
  ),
  ownership: profile(
    'workspai.graph.projection.ownership',
    [...OWNERSHIP_ENTITY_KINDS, 'service', 'project', 'repository'],
    ['declarative'],
    ['owned-by', 'reviewed-by']
  ),
  workspace: profile(
    'workspai.graph.projection.workspace',
    WORKSPACE_ENTITY_KINDS,
    ['structural', 'declarative'],
    ['contains', 'depends-on', 'owned-by']
  ),
  agentConsumption: profile(
    'workspai.graph.projection.agent-consumption',
    ['agent-context', 'agent-action', 'service', 'endpoint', 'document', 'decision'],
    ['declarative', 'behavioral', 'derived'],
    ['grounds', 'consumed-by', 'produced-by', 'documented-by']
  ),
} satisfies Record<string, GraphProjectionProfile>);

export type GraphStandardProjectionProfileId = keyof typeof GRAPH_STANDARD_PROJECTION_PROFILES;
