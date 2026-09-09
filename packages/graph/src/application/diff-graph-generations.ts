import type {
  GraphCanonicalGraph,
  GraphDiagnostic,
  GraphGenerationRef,
} from '../contracts/index.js';

export interface GraphGenerationDiff {
  readonly from: GraphGenerationRef;
  readonly to: GraphGenerationRef;
  readonly addedNodes: readonly string[];
  readonly removedNodes: readonly string[];
  readonly addedEdges: readonly string[];
  readonly removedEdges: readonly string[];
  readonly changedEdges: readonly string[];
  readonly addedAssertions: readonly string[];
  readonly removedAssertions: readonly string[];
  readonly limitations: readonly string[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

const DIFF_LIMITATIONS = Object.freeze([
  'Generation diff is a comparison primitive, not an event ledger.',
  'No Time Machine replay, merge or publication claim is made.',
] as const);

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

/**
 * Compares two immutable canonical graphs by identity. Does not invent fact
 * identifiers or claim temporal ledger semantics.
 */
export function diffGraphGenerations(request: {
  readonly from: GraphCanonicalGraph;
  readonly to: GraphCanonicalGraph;
}): GraphGenerationDiff {
  const diagnostics: GraphDiagnostic[] = [];
  if (request.from.generation.reference.id === request.to.generation.reference.id) {
    diagnostics.push(
      diagnostic(
        'GRAPH_GENERATION_DIFF_SAME_IDENTITY',
        'warning',
        '/generation',
        'Compared graphs share the same generation identity.'
      )
    );
  }

  const fromNodes = new Set(request.from.nodes.map((node) => node.id));
  const toNodes = new Set(request.to.nodes.map((node) => node.id));
  const fromEdges = new Map(request.from.edges.map((edge) => [edge.id, edge]));
  const toEdges = new Map(request.to.edges.map((edge) => [edge.id, edge]));
  const fromAssertions = new Set(request.from.assertions.map((assertion) => assertion.id));
  const toAssertions = new Set(request.to.assertions.map((assertion) => assertion.id));

  const changedEdges = [...toEdges.entries()]
    .filter(([id, edge]) => {
      const prior = fromEdges.get(id);
      return (
        prior !== undefined &&
        (prior.relation !== edge.relation ||
          prior.state !== edge.state ||
          prior.from !== edge.from ||
          prior.to !== edge.to ||
          prior.proof.state !== edge.proof.state)
      );
    })
    .map(([id]) => id)
    .sort();

  return Object.freeze({
    from: request.from.generation.reference,
    to: request.to.generation.reference,
    addedNodes: Object.freeze([...toNodes].filter((id) => !fromNodes.has(id)).sort()),
    removedNodes: Object.freeze([...fromNodes].filter((id) => !toNodes.has(id)).sort()),
    addedEdges: Object.freeze([...toEdges.keys()].filter((id) => !fromEdges.has(id)).sort()),
    removedEdges: Object.freeze([...fromEdges.keys()].filter((id) => !toEdges.has(id)).sort()),
    changedEdges: Object.freeze(changedEdges),
    addedAssertions: Object.freeze(
      [...toAssertions].filter((id) => !fromAssertions.has(id)).sort()
    ),
    removedAssertions: Object.freeze(
      [...fromAssertions].filter((id) => !toAssertions.has(id)).sort()
    ),
    limitations: Object.freeze([...DIFF_LIMITATIONS]),
    diagnostics: Object.freeze(diagnostics),
  });
}
