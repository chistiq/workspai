import {
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  type GraphOntologyProfile,
  type GraphOntologyRelationDefinition,
} from './graph.js';

const proofPolicy = Object.freeze({ id: 'workspai.graph.proof.standard', version: '1' });
const authorities = Object.freeze(['declared', 'observed', 'verified', 'inferred'] as const);

const entities = Object.freeze([
  ['workspace', 'system'],
  ['repository', 'system'],
  ['project', 'system'],
  ['service', 'system'],
  ['module', 'source'],
  ['package', 'source'],
  ['file', 'source'],
  ['symbol', 'source'],
  ['branch', 'source'],
  ['revision', 'source'],
  ['api', 'interface'],
  ['endpoint', 'interface'],
  ['schema', 'interface'],
  ['event', 'messaging'],
  ['queue', 'messaging'],
  ['database', 'data'],
  ['container', 'runtime'],
  ['image', 'runtime'],
  ['deployment', 'runtime'],
  ['environment', 'runtime'],
  ['runtime', 'runtime'],
  ['pipeline', 'delivery'],
  ['workflow', 'delivery'],
  ['command', 'delivery'],
  ['test', 'delivery'],
  ['artifact', 'delivery'],
  ['gate', 'delivery'],
  ['owner', 'ownership'],
  ['team', 'ownership'],
  ['contract', 'governance'],
  ['policy', 'governance'],
  ['decision', 'governance'],
  ['document', 'governance'],
  ['agent-context', 'agent'],
  ['agent-action', 'agent'],
] as const).map(([kind, family]) => Object.freeze({ kind, family }));

type RelationSeed = readonly [
  string,
  GraphOntologyRelationDefinition['semantics'],
  readonly string[],
  readonly string[],
];
const seeds: readonly RelationSeed[] = [
  [
    'contains',
    'structural',
    ['system', 'source', 'runtime', 'delivery', 'governance'],
    [
      'system',
      'source',
      'interface',
      'messaging',
      'data',
      'runtime',
      'delivery',
      'governance',
      'agent',
    ],
  ],
  [
    'declares',
    'declarative',
    ['system', 'source', 'governance'],
    ['interface', 'messaging', 'data', 'runtime', 'delivery', 'governance'],
  ],
  ['exposes', 'structural', ['system', 'source'], ['interface', 'messaging']],
  ['imports', 'structural', ['source'], ['source']],
  ['exports', 'structural', ['source'], ['source', 'interface']],
  ['calls', 'behavioral', ['source', 'interface', 'system'], ['source', 'interface', 'system']],
  ['implements', 'structural', ['source', 'system'], ['interface', 'governance']],
  [
    'depends-on',
    'structural',
    ['system', 'source', 'interface', 'runtime', 'delivery'],
    ['system', 'source', 'interface', 'messaging', 'data', 'runtime', 'delivery'],
  ],
  ['reads-from', 'behavioral', ['system', 'source'], ['data', 'messaging']],
  ['writes-to', 'behavioral', ['system', 'source'], ['data', 'messaging']],
  [
    'consumes',
    'behavioral',
    ['system', 'source', 'agent'],
    ['interface', 'messaging', 'delivery', 'governance'],
  ],
  [
    'produces',
    'behavioral',
    ['system', 'source', 'delivery', 'agent'],
    ['interface', 'messaging', 'delivery'],
  ],
  ['routes-to', 'behavioral', ['interface', 'runtime'], ['system', 'interface', 'runtime']],
  ['deployed-as', 'declarative', ['system'], ['runtime']],
  ['runs-on', 'declarative', ['system', 'runtime'], ['runtime']],
  ['configured-by', 'declarative', ['system', 'runtime', 'delivery'], ['source', 'governance']],
  [
    'owned-by',
    'declarative',
    ['system', 'source', 'interface', 'data', 'runtime', 'delivery'],
    ['ownership'],
  ],
  ['reviewed-by', 'declarative', ['system', 'source', 'governance'], ['ownership']],
  [
    'constrained-by',
    'declarative',
    ['system', 'source', 'interface', 'runtime', 'delivery', 'agent'],
    ['governance'],
  ],
  ['decided-by', 'declarative', ['system', 'source', 'interface', 'runtime'], ['governance']],
  [
    'observed-by',
    'derived',
    ['system', 'source', 'interface', 'runtime', 'delivery'],
    ['source', 'delivery', 'agent'],
  ],
  [
    'supported-by',
    'derived',
    ['system', 'source', 'interface', 'runtime'],
    ['source', 'delivery', 'governance'],
  ],
  [
    'verified-by',
    'derived',
    ['system', 'source', 'interface', 'runtime', 'delivery'],
    ['delivery', 'governance'],
  ],
  [
    'documented-by',
    'declarative',
    ['system', 'source', 'interface', 'runtime', 'delivery'],
    ['governance'],
  ],
  [
    'requires',
    'declarative',
    ['system', 'source', 'interface', 'runtime', 'delivery', 'governance'],
    ['system', 'source', 'interface', 'runtime', 'delivery', 'governance'],
  ],
  [
    'invalidates',
    'behavioral',
    ['system', 'source', 'interface', 'runtime', 'delivery'],
    ['system', 'source', 'interface', 'runtime', 'delivery', 'governance'],
  ],
  [
    'renews',
    'behavioral',
    ['system', 'source', 'delivery'],
    ['system', 'source', 'interface', 'runtime', 'delivery', 'governance'],
  ],
  [
    'blocks',
    'declarative',
    ['system', 'source', 'interface', 'runtime', 'delivery', 'governance'],
    ['system', 'source', 'interface', 'runtime', 'delivery', 'agent'],
  ],
  [
    'allows',
    'declarative',
    ['governance', 'delivery'],
    ['system', 'source', 'runtime', 'delivery', 'agent'],
  ],
  ['rolls-back', 'behavioral', ['delivery', 'runtime'], ['runtime', 'delivery']],
  ['grounds', 'declarative', ['agent'], ['system', 'source', 'interface', 'governance']],
  ['consumed-by', 'behavioral', ['system', 'source', 'interface', 'governance'], ['agent']],
  ['produced-by', 'behavioral', ['system', 'source', 'interface', 'governance'], ['agent']],
];

const relations = Object.freeze(
  seeds.map(([kind, semantics, subjectFamilies, objectFamilies]) =>
    Object.freeze({
      kind,
      semantics,
      subjectFamilies,
      objectFamilies,
      symmetric: false,
      transitive: false,
      allowedAuthorities: authorities,
      proofPolicy,
    })
  )
);

export const CORE_GRAPH_ONTOLOGY_PROFILE: Readonly<GraphOntologyProfile> = Object.freeze({
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.core',
  version: '0.1.0-candidate',
  entities,
  relations,
});
