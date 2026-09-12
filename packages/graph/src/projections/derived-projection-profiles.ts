import {
  GRAPH_DERIVED_PROJECTION_PROFILE_CONTRACT,
  type GraphDerivedProjectionProfile,
} from '../contracts/projection.js';

function derivedProfile(
  id: string,
  kind: GraphDerivedProjectionProfile['kind'],
  algorithmId: string,
  seed: string,
  limitations: readonly string[]
): GraphDerivedProjectionProfile {
  return Object.freeze({
    id,
    version: GRAPH_DERIVED_PROJECTION_PROFILE_CONTRACT.version,
    kind,
    algorithm: Object.freeze({
      id: algorithmId,
      version: '1',
      seed,
    }),
    proofThreshold: 'supported',
    limitations: Object.freeze(limitations),
    redactionPolicy: 'portable-default',
  });
}

/** Deterministic derived analytics declared by G5 and DERIVED_INTELLIGENCE_GOVERNANCE. */
export const GRAPH_DERIVED_PROJECTION_PROFILES = Object.freeze({
  community: derivedProfile(
    'workspai.graph.derived-projection.community',
    'community',
    'workspai.graph.algorithm.community.connected-components',
    'derived-community-v1',
    Object.freeze([
      'Communities are inferred from structural connectivity only.',
      'Inferred groups are advisory and never become canonical relations.',
      'Isolated entities may form singleton communities.',
    ])
  ),
  flow: derivedProfile(
    'workspai.graph.derived-projection.flow',
    'flow',
    'workspai.graph.algorithm.flow.entry-rank',
    'derived-flow-v1',
    Object.freeze([
      'Flow ranking uses observed structural and behavioral edges only.',
      'Computed routes and dynamic dispatch are out of scope.',
      'Rankings are advisory execution-flow hints, not runtime truth.',
    ])
  ),
  reviewRisk: derivedProfile(
    'workspai.graph.derived-projection.review-risk',
    'review-risk',
    'workspai.graph.algorithm.review-risk.coupling',
    'derived-review-risk-v1',
    Object.freeze([
      'Review risk scores coupling and proof weakness; they are not merge-conflict verdicts.',
      'Shared-community and shared-file overlap remain advisory findings only.',
      'Unknown or unsupported zones increase advisory risk but do not prove conflict.',
    ])
  ),
  architectureSummary: derivedProfile(
    'workspai.graph.derived-projection.architecture-summary',
    'architecture-summary',
    'workspai.graph.algorithm.architecture.summary',
    'derived-architecture-summary-v1',
    Object.freeze([
      'Metrics are graph-derived summaries over one immutable generation.',
      'Hotspots use structural degree only and exclude gate authority.',
      'Architecture rules and conformance violations are queried separately.',
    ])
  ),
} satisfies Record<string, GraphDerivedProjectionProfile>);

export type GraphDerivedProjectionProfileId = keyof typeof GRAPH_DERIVED_PROJECTION_PROFILES;
