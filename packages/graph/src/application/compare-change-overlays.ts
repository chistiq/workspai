import type {
  GraphChangeOverlay,
  GraphChangeOverlayOverlapResult,
  GraphDiagnostic,
} from '../contracts/index.js';

import type { GraphChangeOverlayOverlapRequest } from './proposed-change-types.js';

const OVERLAP_LIMITATIONS = Object.freeze([
  'Shared inputs or providers indicate scheduling overlap only.',
  'No textual, semantic or runtime merge-conflict claim is made.',
  'Observed canonical graph truth remains bound to the shared base generation.',
] as const);

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return Object.freeze({ code, severity, path, message });
}

function changedLocators(overlay: GraphChangeOverlay): Set<string> {
  const locators = new Set<string>();
  for (const change of overlay.predictedDelta.changedInputs) {
    locators.add(change.locator);
    if (change.renameCandidate) {
      locators.add(change.renameCandidate.priorLocator);
      locators.add(change.renameCandidate.nextLocator);
    }
  }
  return locators;
}

/**
 * Compares two overlays on the same base generation and returns advisory overlap
 * signals without claiming proven merge conflicts.
 */
export function compareChangeOverlays(
  request: GraphChangeOverlayOverlapRequest
): GraphChangeOverlayOverlapResult {
  const diagnostics: GraphDiagnostic[] = [];
  const left = request.left;
  const right = request.right;

  if (left.baseGeneration.id !== right.baseGeneration.id) {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_OVERLAP_BASE_MISMATCH',
        'error',
        '/baseGeneration/id',
        'Overlay overlap comparison requires the same base generation identity.'
      )
    );
    return Object.freeze({
      sharedChangedLocators: Object.freeze([]),
      sharedAffectedProviders: Object.freeze([]),
      advisoryMergeOrderRisk: 'none',
      limitations: Object.freeze([...OVERLAP_LIMITATIONS]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  if (left.baseGeneration.contentDigest.value !== right.baseGeneration.contentDigest.value) {
    diagnostics.push(
      diagnostic(
        'GRAPH_OVERLAY_OVERLAP_BASE_DIGEST_MISMATCH',
        'error',
        '/baseGeneration/contentDigest',
        'Overlay overlap comparison requires the same base generation digest.'
      )
    );
    return Object.freeze({
      sharedChangedLocators: Object.freeze([]),
      sharedAffectedProviders: Object.freeze([]),
      advisoryMergeOrderRisk: 'none',
      limitations: Object.freeze([...OVERLAP_LIMITATIONS]),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const leftLocators = changedLocators(left);
  const rightLocators = changedLocators(right);
  const sharedChangedLocators = Object.freeze(
    [...leftLocators].filter((locator) => rightLocators.has(locator)).sort()
  );

  const leftProviders = new Set(left.predictedDelta.affectedProviders);
  const sharedAffectedProviders = Object.freeze(
    [...right.predictedDelta.affectedProviders]
      .filter((provider) => leftProviders.has(provider))
      .sort()
  );

  let advisoryMergeOrderRisk: GraphChangeOverlayOverlapResult['advisoryMergeOrderRisk'] = 'none';
  if (sharedChangedLocators.length > 0) {
    advisoryMergeOrderRisk = 'shared-inputs';
  } else if (sharedAffectedProviders.length > 0) {
    advisoryMergeOrderRisk = 'shared-providers';
  }

  return Object.freeze({
    sharedChangedLocators,
    sharedAffectedProviders,
    advisoryMergeOrderRisk,
    limitations: Object.freeze([...OVERLAP_LIMITATIONS]),
    diagnostics: Object.freeze(diagnostics),
  });
}
