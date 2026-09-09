import {
  GRAPH_CHANGE_OVERLAY_CONTRACT,
  GRAPH_PROPOSED_CHANGE_SET_CONTRACT,
  GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
  GRAPH_QUALITY_CONTRACT,
  type GraphChangeOverlay,
  type GraphChangeOverlayStatus,
  type GraphDiagnostic,
  type GraphProposedChangeSet,
  type GraphProposedGraphDelta,
  type GraphQualityVerdict,
} from '../contracts/index.js';

import type { GraphChangeOverlayRequest } from './proposed-change-types.js';
import { planIncrementalGraphBuild } from './plan-incremental-graph-build.js';

const OVERLAY_RELEASE_CLAIMS = Object.freeze([
  'predicted-change-only',
  'non-canonical-overlay',
  'no-merge-conflict-claim',
  'no-latest-advancement',
] as const);

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

function overlayIntegrity(status: GraphChangeOverlayStatus): GraphQualityVerdict {
  if (status === 'failed') {
    return 'blocked';
  }
  if (status === 'partial') {
    return 'attention';
  }
  return 'pass';
}

function emptyProposedGraphDelta(
  overlayId: string,
  baseGenerationId: string,
  failed: boolean
): GraphProposedGraphDelta {
  return Object.freeze({
    contract: GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
    baseGeneration: baseGenerationId,
    targetOverlay: overlayId,
    changedInputs: Object.freeze([]),
    affectedProviders: Object.freeze([]),
    facts: Object.freeze({
      added: Object.freeze([]),
      renewed: Object.freeze([]),
      removed: Object.freeze([]),
      invalidated: Object.freeze([]),
    }),
    graph: Object.freeze({
      addedNodes: Object.freeze([]),
      removedNodes: Object.freeze([]),
      changedEdges: Object.freeze([]),
    }),
    affectedProjections: Object.freeze([]),
    downstreamInvalidations: Object.freeze([]),
    execution: Object.freeze({
      detected: 0,
      scanned: 0,
      parsed: 0,
      recomputed: 0,
      skippedByDigest: 0,
      unsupported: 0,
      failed: failed ? 1 : 0,
      truncation: Object.freeze([]),
      processing: Object.freeze([]),
    }),
    equivalence: 'not-assessed',
  });
}

function overlayQuality(
  request: GraphChangeOverlayRequest,
  status: GraphChangeOverlayStatus
): GraphChangeOverlay['quality'] {
  return Object.freeze({
    contract: GRAPH_QUALITY_CONTRACT,
    generation: request.baseGeneration,
    integrity: overlayIntegrity(status),
    determinism: 'pass',
    incrementalEquivalence: 'not-assessed',
    coverage: Object.freeze([]),
    proofStates: Object.freeze({
      supported: 0,
      corroborated: 0,
      verified: 0,
      disputed: 0,
      insufficient: 0,
      unresolved: 0,
    }),
    unknownZones: Object.freeze([]),
    unsupportedZones: Object.freeze([]),
    staleZones: Object.freeze([]),
    conflicts: Object.freeze([]),
    orphans: Object.freeze([]),
    providerFailures: Object.freeze([]),
    releaseClaims: Object.freeze([...OVERLAY_RELEASE_CLAIMS]),
  });
}

function toProposedChangeSet(
  request: GraphChangeOverlayRequest,
  changeSetId: string,
  inputs: GraphProposedChangeSet['inputs'],
  causes: GraphProposedChangeSet['causes']
): GraphProposedChangeSet {
  return Object.freeze({
    contract: GRAPH_PROPOSED_CHANGE_SET_CONTRACT,
    id: changeSetId,
    baseGeneration: request.baseGeneration.id,
    inputs,
    causes,
    proposal: request.proposal,
    assumptions: Object.freeze([...request.assumptions]),
  });
}

function toProposedGraphDelta(
  overlayId: string,
  baseGenerationId: string,
  delta: ReturnType<typeof planIncrementalGraphBuild>['delta']
): GraphProposedGraphDelta {
  return Object.freeze({
    contract: GRAPH_PROPOSED_GRAPH_DELTA_CONTRACT,
    baseGeneration: baseGenerationId,
    targetOverlay: overlayId,
    changedInputs: delta.changedInputs,
    affectedProviders: delta.affectedProviders,
    facts: delta.facts,
    graph: delta.graph,
    affectedProjections: delta.affectedProjections,
    downstreamInvalidations: delta.downstreamInvalidations,
    execution: delta.execution,
    equivalence: delta.equivalence,
  });
}

function failedOverlay(
  request: GraphChangeOverlayRequest,
  diagnostics: readonly GraphDiagnostic[]
): GraphChangeOverlay {
  const proposedChangeSet = toProposedChangeSet(
    request,
    `proposal:${request.overlayId}`,
    Object.freeze([]),
    Object.freeze([])
  );
  return Object.freeze({
    contract: GRAPH_CHANGE_OVERLAY_CONTRACT,
    id: request.overlayId,
    baseGeneration: request.baseGeneration,
    proposal: request.proposal,
    status: 'failed',
    proposedChangeSet,
    predictedDelta: emptyProposedGraphDelta(request.overlayId, request.baseGeneration.id, true),
    quality: overlayQuality(request, 'failed'),
    unknownZones: Object.freeze([]),
    diagnostics: Object.freeze([...diagnostics]),
    generatedAt: request.generatedAt,
    expiresAt: request.expiresAt,
  });
}

/**
 * Builds a non-canonical change overlay from proposed content state without
 * advancing canonical generation truth or fabricating observed fact identifiers.
 */
export function buildGraphChangeOverlay(request: GraphChangeOverlayRequest): GraphChangeOverlay {
  const diagnostics: GraphDiagnostic[] = [];

  if (request.proposal.digest !== request.proposedManifest.merkleRoot.value) {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_PROPOSAL_DIGEST_MISMATCH',
        'error',
        '/proposal/digest',
        'Proposal digest must match the proposed content-state Merkle root.'
      )
    );
  }

  if (request.baseGeneration.contentDigest.value !== request.baseManifest.merkleRoot.value) {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_BASE_GENERATION_MISMATCH',
        'error',
        '/baseGeneration/contentDigest',
        'Base generation content digest must match the base content-state Merkle root.'
      )
    );
  }

  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return failedOverlay(request, diagnostics);
  }

  const plan = planIncrementalGraphBuild({
    baseGeneration: request.baseGeneration.id,
    targetGeneration: `overlay:${request.overlayId}`,
    baseManifest: request.baseManifest,
    targetManifest: request.proposedManifest,
    requiredSemanticDependencies: request.requiredSemanticDependencies,
    authorizedShardIds: request.authorizedShardIds,
    comparisonBudget: request.comparisonBudget,
  });

  const overlayStatus: GraphChangeOverlayStatus =
    plan.status === 'failed' ? 'failed' : plan.status === 'partial' ? 'partial' : 'complete';

  return Object.freeze({
    contract: GRAPH_CHANGE_OVERLAY_CONTRACT,
    id: request.overlayId,
    baseGeneration: request.baseGeneration,
    proposal: request.proposal,
    status: overlayStatus,
    proposedChangeSet: toProposedChangeSet(
      request,
      `proposal:${request.overlayId}`,
      plan.changeSet.inputs,
      plan.changeSet.causes
    ),
    predictedDelta: toProposedGraphDelta(request.overlayId, request.baseGeneration.id, plan.delta),
    quality: overlayQuality(request, overlayStatus),
    unknownZones: Object.freeze([]),
    diagnostics: Object.freeze([...diagnostics, ...plan.diagnostics]),
    generatedAt: request.generatedAt,
    expiresAt: request.expiresAt,
  });
}
