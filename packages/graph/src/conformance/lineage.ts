import type { GraphDerivationLineage, GraphEvidenceIndependence } from '../contracts/index.js';

function ancestors(id: string, byId: ReadonlyMap<string, GraphDerivationLineage>): Set<string> {
  const found = new Set<string>();
  const pending = [...(byId.get(id)?.parentFactIds ?? [])];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (!parent || found.has(parent)) continue;
    found.add(parent);
    pending.push(...(byId.get(parent)?.parentFactIds ?? []));
  }
  return found;
}

export function assessGraphEvidenceIndependence(
  lineages: readonly GraphDerivationLineage[]
): GraphEvidenceIndependence {
  const byId = new Map(lineages.map((lineage) => [lineage.factId, lineage]));
  const rejectedPairs: GraphEvidenceIndependence['rejectedPairs'][number][] = [];
  const roots = new Set(lineages.flatMap((lineage) => lineage.evidenceRoots));
  for (let leftIndex = 0; leftIndex < lineages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lineages.length; rightIndex += 1) {
      const left = lineages[leftIndex];
      const right = lineages[rightIndex];
      const commonRoot = left.evidenceRoots.some((root) => right.evidenceRoots.includes(root));
      const ancestral =
        ancestors(left.factId, byId).has(right.factId) ||
        ancestors(right.factId, byId).has(left.factId);
      if (ancestral)
        rejectedPairs.push({ left: left.factId, right: right.factId, reason: 'ancestor' });
      else if (commonRoot && left.derivation === 'generated' && right.derivation === 'generated')
        rejectedPairs.push({ left: left.factId, right: right.factId, reason: 'generated-sibling' });
      else if (commonRoot)
        rejectedPairs.push({ left: left.factId, right: right.factId, reason: 'same-root' });
    }
  }
  return Object.freeze({
    independent: rejectedPairs.length === 0,
    roots: Object.freeze([...roots].sort()),
    rejectedPairs: Object.freeze(rejectedPairs),
  });
}
