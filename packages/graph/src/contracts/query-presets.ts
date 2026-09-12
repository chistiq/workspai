import {
  GRAPH_BINDING_PROFILE_CONTRACT,
  GRAPH_QUERY_CONTRACT,
  type GraphBindingProfile,
  type GraphQuery,
  type GraphQueryKind,
} from './query.js';

export interface GraphQueryPreset {
  readonly id: string;
  readonly version: string;
  readonly kind: GraphQueryKind;
  readonly query: Omit<GraphQuery, 'subject' | 'target'>;
}

const preset = (
  id: string,
  kind: GraphQueryKind,
  query: Omit<GraphQuery, 'contract' | 'kind' | 'subject' | 'target'>
): Readonly<GraphQueryPreset> =>
  Object.freeze({
    id,
    version: '0.1.0-candidate',
    kind,
    query: Object.freeze({ contract: GRAPH_QUERY_CONTRACT, kind, ...query }),
  });

export const GRAPH_QUERY_PRESETS = Object.freeze({
  dependencies: preset('workspai.graph.query.dependencies', 'dependencies', {
    strategy: 'graph',
    relations: ['depends-on', 'imports', 'requires'],
  }),
  owners: preset('workspai.graph.query.owners', 'owners', {
    strategy: 'direct',
    relations: ['owned-by', 'reviewed-by'],
  }),
  impact: preset('workspai.graph.query.impact', 'impact', {
    strategy: 'graph',
    direction: 'incoming',
  }),
  entryPoints: preset('workspai.graph.query.entry-points', 'entry-points', {
    strategy: 'direct',
  }),
  contractTopology: preset('workspai.graph.query.contract-topology', 'contract-topology', {
    strategy: 'graph',
    direction: 'both',
  }),
  architectureConformance: preset(
    'workspai.graph.query.architecture-conformance',
    'architecture-conformance',
    { strategy: 'hybrid' }
  ),
  operationalRisk: preset('workspai.graph.query.operational-risk', 'operational-risk', {
    strategy: 'hybrid',
  }),
  reviewContext: preset('workspai.graph.query.review-context', 'architecture-conformance', {
    strategy: 'hybrid',
    direction: 'both',
    budget: { maxDepth: 3, maxNodes: 150, maxEdges: 300, maxEvidence: 150 },
    page: { size: 150 },
  }),
});

const apiImplementationVerification: GraphBindingProfile = Object.freeze({
  contract: GRAPH_BINDING_PROFILE_CONTRACT,
  id: 'workspai.graph.binding.api-implementation-verification',
  version: '0.1.0-candidate',
  sourceKinds: Object.freeze(['api', 'endpoint']),
  minimumProof: 'supported',
  steps: Object.freeze([
    Object.freeze({
      relations: Object.freeze(['implements']),
      direction: 'incoming',
      semantics: Object.freeze(['structural'] as const),
      targetKinds: Object.freeze(['symbol', 'module', 'service']),
    }),
    Object.freeze({
      relations: Object.freeze(['verified-by']),
      direction: 'outgoing',
      semantics: Object.freeze(['derived'] as const),
      targetKinds: Object.freeze(['test', 'gate']),
    }),
  ]),
});
const serviceDeploymentOwnership: GraphBindingProfile = Object.freeze({
  contract: GRAPH_BINDING_PROFILE_CONTRACT,
  id: 'workspai.graph.binding.service-deployment-ownership',
  version: '0.1.0-candidate',
  sourceKinds: Object.freeze(['service']),
  minimumProof: 'supported',
  steps: Object.freeze([
    Object.freeze({
      relations: Object.freeze(['deployed-as']),
      direction: 'outgoing',
      semantics: Object.freeze(['declarative'] as const),
      targetKinds: Object.freeze(['container', 'deployment', 'image']),
    }),
    Object.freeze({
      relations: Object.freeze(['owned-by']),
      direction: 'outgoing',
      semantics: Object.freeze(['declarative'] as const),
      targetKinds: Object.freeze(['owner', 'team']),
    }),
  ]),
});

export const GRAPH_STANDARD_BINDING_PROFILES: Readonly<{
  apiImplementationVerification: GraphBindingProfile;
  serviceDeploymentOwnership: GraphBindingProfile;
}> = Object.freeze({
  apiImplementationVerification,
  serviceDeploymentOwnership,
});
