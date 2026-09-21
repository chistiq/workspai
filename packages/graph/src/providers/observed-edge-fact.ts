import type {
  GraphEntityReference,
  GraphProviderCollectionRequest,
  GraphProviderInput,
  GraphUnknownZone,
  GraphWorkspaceFact,
} from '../contracts/index.js';

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
    evidence: [
      {
        id: input.evidenceId,
        sourceKind: input.sourceKind,
        relativeLocator: input.source.locator,
        digest: input.source.digest,
      },
    ],
    provenance: { id: input.provider.id, version: input.provider.version },
    derivation: input.derivation,
    authority: input.authority,
    confidence: input.confidence,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
    observedAt: input.request.observedAt,
    inputDigest: input.source.digest,
    unknownZones: [...(input.unknownZones ?? [])],
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
