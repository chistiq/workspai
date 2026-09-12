import type { GraphChangeOverlay, GraphDiagnostic, GraphInputChange } from '../contracts/index.js';

export interface GraphChangeOverlayQuery {
  readonly kind: 'impact';
  readonly subject: string;
}

export interface GraphChangeOverlayQueryRequest {
  readonly overlay: GraphChangeOverlay;
  readonly query: GraphChangeOverlayQuery;
}

export interface GraphChangeOverlayQueryResult {
  readonly observed: 'base-generation-bound';
  readonly predicted: {
    readonly changedInputs: readonly GraphInputChange[];
    readonly affectedProviders: readonly string[];
    readonly downstreamInvalidations: readonly string[];
  };
  readonly limitations: readonly string[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

const QUERY_LIMITATIONS = Object.freeze([
  'Overlay queries report predicted change only and never mutate canonical graph truth.',
  'Observed fact identifiers remain bound to the immutable base generation.',
  'No merge-conflict, freshness or publication claim is made from overlay queries.',
] as const);

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

function subjectMatches(subject: string, overlay: GraphChangeOverlay): boolean {
  if (overlay.predictedDelta.affectedProviders.includes(subject)) {
    return true;
  }
  if (overlay.predictedDelta.changedInputs.some((change) => change.locator === subject)) {
    return true;
  }
  if (
    overlay.predictedDelta.changedInputs.some(
      (change) =>
        change.renameCandidate?.priorLocator === subject ||
        change.renameCandidate?.nextLocator === subject
    )
  ) {
    return true;
  }
  return overlay.predictedDelta.downstreamInvalidations.some((entry) => entry.includes(subject));
}

/**
 * Answers read-only overlay queries with predicted impact scoped to the bound
 * base generation. Never publishes or advances canonical graph truth.
 */
export function queryChangeOverlay(
  request: GraphChangeOverlayQueryRequest
): GraphChangeOverlayQueryResult {
  const diagnostics: GraphDiagnostic[] = [...request.overlay.diagnostics];

  if (request.overlay.status === 'stale') {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_QUERY_STALE',
        'error',
        '/status',
        'Stale overlays cannot be queried without refreshing prediction state.'
      )
    );
    return Object.freeze({
      observed: 'base-generation-bound',
      predicted: Object.freeze({
        changedInputs: Object.freeze([]),
        affectedProviders: Object.freeze([]),
        downstreamInvalidations: Object.freeze([]),
      }),
      limitations: Object.freeze([...QUERY_LIMITATIONS]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  if (request.query.kind !== 'impact') {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_QUERY_UNSUPPORTED',
        'error',
        '/query/kind',
        'Only impact overlay queries are admitted in this profile.'
      )
    );
    return Object.freeze({
      observed: 'base-generation-bound',
      predicted: Object.freeze({
        changedInputs: Object.freeze([]),
        affectedProviders: Object.freeze([]),
        downstreamInvalidations: Object.freeze([]),
      }),
      limitations: Object.freeze([...QUERY_LIMITATIONS]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const matches = subjectMatches(request.query.subject, request.overlay);
  if (!matches) {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_QUERY_NO_PREDICTED_IMPACT',
        'info',
        '/query/subject',
        'The subject is not referenced by the overlay predicted delta.'
      )
    );
  }

  const predicted = matches
    ? Object.freeze({
        changedInputs: request.overlay.predictedDelta.changedInputs,
        affectedProviders: request.overlay.predictedDelta.affectedProviders,
        downstreamInvalidations: request.overlay.predictedDelta.downstreamInvalidations,
      })
    : Object.freeze({
        changedInputs: Object.freeze([]),
        affectedProviders: Object.freeze([]),
        downstreamInvalidations: Object.freeze([]),
      });

  return Object.freeze({
    observed: 'base-generation-bound',
    predicted,
    limitations: Object.freeze([...QUERY_LIMITATIONS]),
    diagnostics: Object.freeze(diagnostics),
  });
}
