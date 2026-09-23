import type {
  GraphEntityReference,
  GraphProviderCollectionRequest,
  GraphProviderInput,
  GraphUnknownZone,
  GraphWorkspaceFact,
} from '../contracts/index.js';

const CURRENT_FRESHNESS = Object.freeze({ status: 'current' as const });
const DEFAULT_TRUTH_LIFECYCLE = Object.freeze({
  invalidatedBy: Object.freeze(['input-change', 'deletion'] as const),
});
const EMPTY_UNKNOWN_ZONES = Object.freeze([] as GraphUnknownZone[]);
const EVIDENCE_CACHE_LIMIT = 50_000;
const evidenceCache = new Map<string, GraphWorkspaceFact['evidence']>();
const provenanceCache = new Map<string, GraphWorkspaceFact['provenance']>();

function sharedEvidence(input: {
  readonly evidenceId: string;
  readonly sourceKind: string;
  readonly locator: string;
  readonly digest: GraphProviderInput['digest'];
}): GraphWorkspaceFact['evidence'] {
  const key = `${input.evidenceId}\0${input.sourceKind}\0${input.locator}\0${input.digest.algorithm}\0${input.digest.value}`;
  const cached = evidenceCache.get(key);
  if (cached) return cached;
  const evidence = Object.freeze([
    Object.freeze({
      id: input.evidenceId,
      sourceKind: input.sourceKind,
      relativeLocator: input.locator,
      digest: input.digest,
    }),
  ]);
  if (evidenceCache.size >= EVIDENCE_CACHE_LIMIT) evidenceCache.clear();
  evidenceCache.set(key, evidence);
  return evidence;
}

function sharedProvenance(provider: {
  readonly id: string;
  readonly version: string;
}): GraphWorkspaceFact['provenance'] {
  const key = `${provider.id}\0${provider.version}`;
  const cached = provenanceCache.get(key);
  if (cached) return cached;
  const provenance = Object.freeze({ id: provider.id, version: provider.version });
  provenanceCache.set(key, provenance);
  return provenance;
}

export function createObservedEdgeFact(input: {
  readonly factId: string;
  readonly factType: string;
  readonly subject: GraphEntityReference;
  readonly predicate: string;
  readonly object: GraphEntityReference;
  readonly request: GraphProviderCollectionRequest;
  readonly source: GraphProviderInput;
  readonly provider: { readonly id: string; readonly version: string };
  readonly evidenceId: string;
  readonly sourceKind: string;
  readonly derivation: GraphWorkspaceFact['derivation'];
  readonly authority: GraphWorkspaceFact['authority'];
  readonly confidence: number;
  readonly unknownZones?: readonly GraphUnknownZone[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}): GraphWorkspaceFact {
  return {
    factId: input.factId,
    factType: input.factType,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    scope: input.request.scope,
    evidence: sharedEvidence({
      evidenceId: input.evidenceId,
      sourceKind: input.sourceKind,
      locator: input.source.locator,
      digest: input.source.digest,
    }),
    provenance: sharedProvenance(input.provider),
    derivation: input.derivation,
    authority: input.authority,
    confidence: input.confidence,
    freshness: CURRENT_FRESHNESS,
    truthLifecycle: DEFAULT_TRUTH_LIFECYCLE,
    observedAt: input.request.observedAt,
    partitionOwner: {
      locator: input.source.locator,
      observationOrigin: 'build-clock',
    },
    inputDigest: input.source.digest,
    unknownZones:
      input.unknownZones && input.unknownZones.length > 0
        ? [...input.unknownZones]
        : EMPTY_UNKNOWN_ZONES,
    ...(input.extensions ? { extensions: input.extensions } : {}),
  };
}

export function extensionOf(locator: string): string {
  const name = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}
