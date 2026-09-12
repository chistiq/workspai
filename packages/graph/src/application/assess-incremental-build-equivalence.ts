import type { WisDigestReference } from '@workspai/shared/contracts';

import type { GraphDiagnostic, GraphQualityVerdict } from '../contracts/index.js';

export interface GraphIncrementalBuildEquivalenceRequest {
  readonly referenceDigest?: WisDigestReference;
  readonly candidateDigest?: WisDigestReference;
}

export interface GraphIncrementalBuildEquivalenceResult {
  readonly equivalence: GraphQualityVerdict | 'not-assessed';
  readonly diagnostics: readonly GraphDiagnostic[];
}

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

/**
 * Compares canonical generation digests between a full reference build and an
 * incremental candidate build without claiming success on missing evidence.
 */
export function assessIncrementalBuildEquivalence(
  request: GraphIncrementalBuildEquivalenceRequest
): GraphIncrementalBuildEquivalenceResult {
  const diagnostics: GraphDiagnostic[] = [];
  if (!request.referenceDigest || !request.candidateDigest) {
    diagnostics.push(
      diagnostic(
        'GRAPH_INCREMENTAL_EQUIVALENCE_NOT_ASSESSED',
        'warning',
        '/equivalence',
        'Incremental equivalence requires both reference and candidate generation digests.'
      )
    );
    return Object.freeze({ equivalence: 'not-assessed', diagnostics: Object.freeze(diagnostics) });
  }

  if (request.referenceDigest.value === request.candidateDigest.value) {
    return Object.freeze({ equivalence: 'pass', diagnostics: Object.freeze(diagnostics) });
  }

  diagnostics.push(
    diagnostic(
      'GRAPH_INCREMENTAL_EQUIVALENCE_MISMATCH',
      'error',
      '/equivalence',
      'Incremental candidate generation digest does not match the full-build reference.'
    )
  );
  return Object.freeze({ equivalence: 'blocked', diagnostics: Object.freeze(diagnostics) });
}
