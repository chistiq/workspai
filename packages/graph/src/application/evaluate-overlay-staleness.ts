import type { GraphDiagnostic, GraphOverlayStalenessResult } from '../contracts/index.js';

import type { GraphOverlayStalenessRequest } from './proposed-change-types.js';

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

/** Determines whether a stored overlay is stale relative to current base/proposal state. */
export function evaluateGraphChangeOverlayStaleness(
  request: GraphOverlayStalenessRequest
): GraphOverlayStalenessResult {
  const reasons: GraphOverlayStalenessResult['reasons'][number][] = [];
  const diagnostics: GraphDiagnostic[] = [];

  if (
    request.overlay.baseGeneration.id !== request.currentBaseGeneration.id ||
    request.overlay.baseGeneration.contentDigest.value !==
      request.currentBaseGeneration.contentDigest.value
  ) {
    reasons.push('base-generation-changed');
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_STALE_BASE_GENERATION',
        'warning',
        '/baseGeneration',
        'Overlay base generation no longer matches the current canonical generation.'
      )
    );
  }

  if (request.overlay.proposal.digest !== request.currentProposalDigest) {
    reasons.push('proposal-changed');
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_STALE_PROPOSAL',
        'warning',
        '/proposal/digest',
        'Overlay proposal digest no longer matches the current proposed content state.'
      )
    );
  }

  if (request.overlay.expiresAt && request.evaluatedAt >= request.overlay.expiresAt) {
    reasons.push('overlay-expired');
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_EXPIRED',
        'warning',
        '/expiresAt',
        'Overlay validity window has elapsed.'
      )
    );
  }

  return Object.freeze({
    stale: reasons.length > 0,
    reasons: Object.freeze(reasons),
    diagnostics: Object.freeze(diagnostics),
  });
}
