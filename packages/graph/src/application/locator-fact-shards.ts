/**
 * Session-scoped immutable per-locator fact shards. Keys bind locator identity,
 * content digest, provider identity, input index, and the current inventory
 * membership so resolution-sensitive facts cannot leak across trees.
 *
 * Stored facts are the admitted frozen snapshots. Callers may alias them only
 * while the owning session is alive; disposal drops the registry.
 *
 * Membership changes drop every shard. Locator+content shards still survive
 * in-place file edits. Add/delete forces recompute so membership-sensitive
 * aggregates cannot leak. A changed extraction-environment boundary (scope,
 * policy, ontology, providers) also drops every shard and composition/fact-digest
 * anchor. Entry and byte budgets are explicit; overflow evicts the entire store
 * deterministically.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { WisDigestReference } from '@workspai/shared/contracts';

import type {
  GraphCanonicalGraph,
  GraphEntityReference,
  GraphFactBatch,
  GraphObservationOrigin,
  GraphQualityReport,
  GraphUnknownZone,
  GraphWorkspaceFact,
} from '../contracts/index.js';
import type {
  GraphCompositionReceipt,
  GraphCompositionSource,
  GraphReferenceCompositionTaskOutput,
} from './composition-types.js';
import { recordGraphRetainedBytes } from './data-movement.js';

export const GRAPH_LOCATOR_FACT_SHARD_SCHEMA = 'workspai.graph.locator-fact-shard.v1' as const;
export const GRAPH_LOCATOR_FACT_SHARD_LIMIT_ENTRIES = 250_000;
export const GRAPH_LOCATOR_FACT_SHARD_LIMIT_FACTS = 2_000_000;
export const GRAPH_LOCATOR_FACT_SHARD_LIMIT_BYTES = 256 * 1024 * 1024;

export interface GraphLocatorFactShardLimits {
  readonly maxEntries: number;
  readonly maxFacts: number;
  readonly maxBytes: number;
}

export interface GraphLocatorFactShardStats {
  readonly entries: number;
  readonly facts: number;
  readonly estimatedBytes: number;
  readonly evictions: number;
}

export interface GraphLocatorFactShardKey {
  readonly providerId: string;
  readonly locator: string;
  readonly inputDigest: string;
  readonly inputIndex: number;
}

export interface GraphLocatorFactShard extends GraphLocatorFactShardKey {
  readonly schema: typeof GRAPH_LOCATOR_FACT_SHARD_SCHEMA;
  readonly providerVersion: string;
  readonly facts: readonly GraphWorkspaceFact[];
  readonly observationOrigins: readonly (readonly [string, GraphObservationOrigin])[];
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly processing: GraphFactBatch['processing'][number];
  readonly callEnvironmentDigest: string;
  readonly extras?: unknown;
}

export interface GraphSessionCompositionAnchor {
  readonly sources: readonly GraphCompositionSource[];
  readonly graph: GraphCanonicalGraph;
  readonly quality: GraphQualityReport;
  readonly receipt: GraphCompositionReceipt;
  readonly extractionEnvironmentDigest: string;
  /**
   * Canonical lineage digest of the generation that produced this anchor.
   * Empty means the generation was published without a verified lineage and
   * must not reuse prior edges.
   */
  readonly lineageDigest: string;
  /**
   * Published completeness of the remembered generation. Honest unsupported
   * partial results are reusable; failed, cancelled, or truncated results are
   * never stored as anchors.
   */
  readonly incomplete: boolean;
}

/**
 * Preparation staged by a successful compose. It becomes visible only when
 * `rememberComposition` publishes it in the same record as the matching anchor.
 */
export interface GraphCompositionPreparationStage {
  readonly prepared: GraphReferenceCompositionTaskOutput;
  readonly factSetDigest: WisDigestReference;
  readonly proofPolicyDigest: WisDigestReference;
  readonly lineageDigest: string;
}

export interface GraphSessionFactDigestEntry {
  readonly fact: GraphWorkspaceFact;
  readonly key: string;
  readonly index: number;
}

export interface GraphSessionFactDigestAnchor {
  readonly facts: readonly GraphWorkspaceFact[];
  readonly sortedEntries: readonly GraphSessionFactDigestEntry[];
  readonly digest: WisDigestReference;
}

export interface LocatorFactShardStore {
  setExtractionEnvironment(digest: string): void;
  extractionEnvironment(): string;
  setMembership(locators: readonly string[]): void;
  membership(): string;
  get(key: GraphLocatorFactShardKey): GraphLocatorFactShard | undefined;
  set(shard: GraphLocatorFactShard): void;
  rebind(providerId: string, facts: readonly GraphWorkspaceFact[]): void;
  rememberComposition(anchor: GraphSessionCompositionAnchor): void;
  lastComposition(): GraphSessionCompositionAnchor | undefined;
  stagePreparation(stage: GraphCompositionPreparationStage): void;
  discardStagedPreparation(): void;
  stagedLineageDigest(): string;
  lastPreparation(): GraphReferenceCompositionTaskOutput | undefined;
  rememberFactDigest(anchor: GraphSessionFactDigestAnchor): void;
  lastFactDigest(): GraphSessionFactDigestAnchor | undefined;
  rememberInternedNode(internKey: string, node: GraphEntityReference): void;
  internedNode(internKey: string): GraphEntityReference | undefined;
  stats(): GraphLocatorFactShardStats;
  dispose(): void;
}

const sessions = new AsyncLocalStorage<LocatorFactShardStore>();

const DEFAULT_LIMITS: GraphLocatorFactShardLimits = Object.freeze({
  maxEntries: GRAPH_LOCATOR_FACT_SHARD_LIMIT_ENTRIES,
  maxFacts: GRAPH_LOCATOR_FACT_SHARD_LIMIT_FACTS,
  maxBytes: GRAPH_LOCATOR_FACT_SHARD_LIMIT_BYTES,
});

function membershipSignature(locators: readonly string[]): string {
  return [...locators].sort((left, right) => left.localeCompare(right)).join('\0');
}

function shardMapKey(key: GraphLocatorFactShardKey): string {
  // Membership is stored once on the registry. setMembership clears this map
  // when the signature changes, so the key must not repeat that signature.
  return [
    GRAPH_LOCATOR_FACT_SHARD_SCHEMA,
    key.providerId,
    key.locator,
    key.inputDigest,
    String(key.inputIndex),
  ].join('\0');
}

function digestRefEqual(left: WisDigestReference, right: WisDigestReference): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function preparationStageMatchesAnchor(
  anchor: GraphSessionCompositionAnchor,
  stage: GraphCompositionPreparationStage
): boolean {
  return (
    anchor.lineageDigest.length > 0 &&
    anchor.lineageDigest === stage.lineageDigest &&
    anchor.extractionEnvironmentDigest.length > 0 &&
    digestRefEqual(anchor.receipt.factSetDigest, stage.factSetDigest) &&
    digestRefEqual(anchor.receipt.proofPolicySetDigest, stage.proofPolicyDigest)
  );
}

function samePublishedCompositionIdentity(
  previous: GraphSessionCompositionAnchor,
  next: GraphSessionCompositionAnchor
): boolean {
  return (
    previous.lineageDigest.length > 0 &&
    previous.extractionEnvironmentDigest === next.extractionEnvironmentDigest &&
    (next.lineageDigest.length === 0 || next.lineageDigest === previous.lineageDigest) &&
    digestRefEqual(previous.receipt.factSetDigest, next.receipt.factSetDigest) &&
    digestRefEqual(previous.receipt.proofPolicySetDigest, next.receipt.proofPolicySetDigest)
  );
}

function estimateShardBytes(shard: GraphLocatorFactShard): number {
  return (
    256 + shard.facts.length * 384 + shard.unknownZones.length * 128 + shard.locator.length * 2
  );
}

class LocatorFactShardRegistry implements LocatorFactShardStore {
  private readonly shards = new Map<string, GraphLocatorFactShard>();
  private readonly internedNodes = new Map<string, GraphEntityReference>();
  private readonly limits: GraphLocatorFactShardLimits;
  private membershipToken = '';
  private environmentDigest = '';
  private publishedComposition:
    | {
        readonly anchor: GraphSessionCompositionAnchor;
        readonly preparation?: GraphReferenceCompositionTaskOutput;
      }
    | undefined;
  private stagedPreparation: GraphCompositionPreparationStage | undefined;
  private factDigestAnchor: GraphSessionFactDigestAnchor | undefined;
  private estimatedBytes = 0;
  private factCount = 0;
  private evictions = 0;
  private disposed = false;

  constructor(limits: GraphLocatorFactShardLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  private publishRetained(): void {
    recordGraphRetainedBytes('locatorFactShards', this.estimatedBytes);
  }

  private recount(): void {
    let facts = 0;
    let bytes = 0;
    for (const shard of this.shards.values()) {
      facts += shard.facts.length;
      bytes += estimateShardBytes(shard);
    }
    this.factCount = facts;
    this.estimatedBytes = bytes;
    this.publishRetained();
  }

  private dropAnchors(): void {
    this.internedNodes.clear();
    this.publishedComposition = undefined;
    this.stagedPreparation = undefined;
    this.factDigestAnchor = undefined;
  }

  private clearShards(): void {
    this.shards.clear();
    this.factCount = 0;
    this.estimatedBytes = 0;
    this.publishRetained();
  }

  setExtractionEnvironment(digest: string): void {
    if (this.disposed) return;
    if (digest === this.environmentDigest) return;
    this.clearShards();
    this.dropAnchors();
    this.membershipToken = '';
    this.environmentDigest = digest;
  }

  extractionEnvironment(): string {
    return this.environmentDigest;
  }

  setMembership(locators: readonly string[]): void {
    if (this.disposed) return;
    const next = membershipSignature(locators);
    if (next === this.membershipToken) return;
    this.clearShards();
    this.dropAnchors();
    this.membershipToken = next;
  }

  membership(): string {
    return this.membershipToken;
  }

  get(key: GraphLocatorFactShardKey): GraphLocatorFactShard | undefined {
    if (this.disposed) return undefined;
    return this.shards.get(shardMapKey(key));
  }

  set(shard: GraphLocatorFactShard): void {
    if (this.disposed) return;
    const key = shardMapKey(shard);
    const existing = this.shards.get(key);
    const nextFacts = this.factCount - (existing?.facts.length ?? 0) + shard.facts.length;
    const nextBytes =
      this.estimatedBytes -
      (existing ? estimateShardBytes(existing) : 0) +
      estimateShardBytes(shard);
    const nextEntries = this.shards.size + (existing ? 0 : 1);
    if (
      nextEntries > this.limits.maxEntries ||
      nextFacts > this.limits.maxFacts ||
      nextBytes > this.limits.maxBytes
    ) {
      this.clearShards();
      this.dropAnchors();
      this.evictions += 1;
      const soloBytes = estimateShardBytes(shard);
      if (
        shard.facts.length > this.limits.maxFacts ||
        soloBytes > this.limits.maxBytes ||
        this.limits.maxEntries < 1
      ) {
        return;
      }
      this.shards.set(key, Object.freeze(shard));
      this.factCount = shard.facts.length;
      this.estimatedBytes = soloBytes;
      this.publishRetained();
      return;
    }
    this.shards.set(key, Object.freeze(shard));
    this.factCount = nextFacts;
    this.estimatedBytes = nextBytes;
    this.publishRetained();
  }

  rebind(providerId: string, facts: readonly GraphWorkspaceFact[]): void {
    if (this.disposed) return;
    const byId = new Map(facts.map((fact) => [fact.factId, fact]));
    let changed = false;
    for (const [key, shard] of this.shards) {
      if (shard.providerId !== providerId) continue;
      let differs = false;
      for (const fact of shard.facts) {
        const next = byId.get(fact.factId);
        if (next && next !== fact) {
          differs = true;
          break;
        }
      }
      if (!differs) continue;
      changed = true;
      const rebound = shard.facts.map((fact) => byId.get(fact.factId) ?? fact);
      this.shards.set(key, Object.freeze({ ...shard, facts: Object.freeze(rebound) }));
    }
    if (changed) this.recount();
  }

  rememberComposition(anchor: GraphSessionCompositionAnchor): void {
    if (this.disposed) return;
    const staged = this.stagedPreparation;
    this.stagedPreparation = undefined;
    const previous = this.publishedComposition;
    if (staged && preparationStageMatchesAnchor(anchor, staged)) {
      this.publishedComposition = {
        anchor: Object.freeze({ ...anchor, lineageDigest: staged.lineageDigest }),
        preparation: staged.prepared,
      };
      return;
    }
    if (staged) {
      this.publishedComposition = {
        anchor: Object.freeze({ ...anchor, lineageDigest: '' }),
      };
      return;
    }
    if (previous?.preparation && samePublishedCompositionIdentity(previous.anchor, anchor)) {
      this.publishedComposition = {
        anchor: Object.freeze({
          ...anchor,
          lineageDigest: previous.anchor.lineageDigest,
        }),
        preparation: previous.preparation,
      };
      return;
    }
    this.publishedComposition = {
      anchor: Object.freeze({ ...anchor, lineageDigest: '' }),
    };
  }

  lastComposition(): GraphSessionCompositionAnchor | undefined {
    return this.disposed ? undefined : this.publishedComposition?.anchor;
  }

  stagePreparation(stage: GraphCompositionPreparationStage): void {
    if (this.disposed) return;
    this.stagedPreparation = stage;
  }

  discardStagedPreparation(): void {
    this.stagedPreparation = undefined;
  }

  stagedLineageDigest(): string {
    return this.disposed ? '' : (this.stagedPreparation?.lineageDigest ?? '');
  }

  lastPreparation(): GraphReferenceCompositionTaskOutput | undefined {
    return this.disposed ? undefined : this.publishedComposition?.preparation;
  }

  rememberFactDigest(anchor: GraphSessionFactDigestAnchor): void {
    if (this.disposed) return;
    this.factDigestAnchor = anchor;
  }

  lastFactDigest(): GraphSessionFactDigestAnchor | undefined {
    return this.disposed ? undefined : this.factDigestAnchor;
  }

  rememberInternedNode(internKey: string, node: GraphEntityReference): void {
    if (this.disposed || internKey.length === 0) return;
    this.internedNodes.set(internKey, node);
  }

  internedNode(internKey: string): GraphEntityReference | undefined {
    return this.disposed ? undefined : this.internedNodes.get(internKey);
  }

  stats(): GraphLocatorFactShardStats {
    return Object.freeze({
      entries: this.shards.size,
      facts: this.factCount,
      estimatedBytes: this.estimatedBytes,
      evictions: this.evictions,
    });
  }

  dispose(): void {
    this.clearShards();
    this.dropAnchors();
    this.membershipToken = '';
    this.environmentDigest = '';
    this.disposed = true;
  }
}

export function createLocatorFactShardStore(
  limits: GraphLocatorFactShardLimits = DEFAULT_LIMITS
): LocatorFactShardStore {
  return new LocatorFactShardRegistry(limits);
}

export function runWithLocatorFactShardStore<T>(store: LocatorFactShardStore, fn: () => T): T {
  return sessions.run(store, fn);
}

export function currentLocatorFactShardStore(): LocatorFactShardStore | undefined {
  return sessions.getStore();
}

export function setLocatorFactShardExtractionEnvironment(digest: string): void {
  sessions.getStore()?.setExtractionEnvironment(digest);
}

export function setLocatorFactShardMembership(locators: readonly string[]): void {
  sessions.getStore()?.setMembership(locators);
}

export function lookupLocatorFactShard(
  key: GraphLocatorFactShardKey
): GraphLocatorFactShard | undefined {
  return sessions.getStore()?.get(key);
}

export function rememberLocatorFactShard(shard: GraphLocatorFactShard): void {
  sessions.getStore()?.set(shard);
}

export function rebindLocatorFactShards(
  providerId: string,
  facts: readonly GraphWorkspaceFact[]
): void {
  sessions.getStore()?.rebind(providerId, facts);
}

export function rememberSessionCompositionAnchor(anchor: GraphSessionCompositionAnchor): void {
  sessions.getStore()?.rememberComposition(anchor);
}

export function lastSessionCompositionAnchor(): GraphSessionCompositionAnchor | undefined {
  return sessions.getStore()?.lastComposition();
}

export function stageSessionCompositionPreparation(stage: GraphCompositionPreparationStage): void {
  sessions.getStore()?.stagePreparation(stage);
}

export function discardStagedCompositionPreparation(): void {
  sessions.getStore()?.discardStagedPreparation();
}

export function stagedCompositionLineageDigest(): string {
  return sessions.getStore()?.stagedLineageDigest() ?? '';
}

export function lastCompositionPreparation(): GraphReferenceCompositionTaskOutput | undefined {
  return sessions.getStore()?.lastPreparation();
}

export function rememberSessionFactDigestAnchor(anchor: GraphSessionFactDigestAnchor): void {
  sessions.getStore()?.rememberFactDigest(anchor);
}

export function lastSessionFactDigestAnchor(): GraphSessionFactDigestAnchor | undefined {
  return sessions.getStore()?.lastFactDigest();
}

export function rememberInternedCompositionNode(
  internKey: string,
  node: GraphEntityReference
): void {
  sessions.getStore()?.rememberInternedNode(internKey, node);
}

export function internedCompositionNode(internKey: string): GraphEntityReference | undefined {
  return sessions.getStore()?.internedNode(internKey);
}

export function compositionSourcesAreIdenticalFacts(
  current: readonly GraphCompositionSource[],
  previous: readonly GraphCompositionSource[]
): boolean {
  if (current.length !== previous.length) return false;
  const previousById = new Map(previous.map((source) => [source.manifest.id, source]));
  for (const source of current) {
    const match = previousById.get(source.manifest.id);
    if (!match || match.batch.facts.length !== source.batch.facts.length) return false;
    for (let index = 0; index < source.batch.facts.length; index += 1) {
      if (source.batch.facts[index] !== match.batch.facts[index]) return false;
    }
  }
  return true;
}

const MAX_CALL_ENVIRONMENT_LOCATORS = 100_000;

/**
 * Direct imports, same-directory peers, and every locator reached by following
 * re-export edges. Importers must invalidate when a re-exported callee's
 * exports change even if the importing file bytes did not.
 */
export function expandCallEnvironmentLocators(
  dependencyLocators: readonly string[],
  reexportsByFile: ReadonlyMap<string, readonly { readonly locator: string }[]> = new Map()
): readonly string[] {
  const seen = new Set<string>();
  const stack = [...dependencyLocators];
  while (stack.length > 0) {
    const locator = stack.pop();
    if (!locator || seen.has(locator)) continue;
    seen.add(locator);
    if (seen.size > MAX_CALL_ENVIRONMENT_LOCATORS) break;
    for (const reexport of reexportsByFile.get(locator) ?? []) {
      if (reexport.locator && !seen.has(reexport.locator)) stack.push(reexport.locator);
    }
  }
  const ordered = [...seen].sort((left, right) => left.localeCompare(right));
  if (seen.size > MAX_CALL_ENVIRONMENT_LOCATORS) {
    return Object.freeze(['\0truncated', ...ordered]);
  }
  return Object.freeze(ordered);
}

export function locatorCallEnvironmentDigest(
  dependencyLocators: readonly string[],
  exportSignatures: ReadonlyMap<string, string>,
  reexportsByFile: ReadonlyMap<string, readonly { readonly locator: string }[]> = new Map()
): string {
  return expandCallEnvironmentLocators(dependencyLocators, reexportsByFile)
    .map((locator) => `${locator}\0${exportSignatures.get(locator) ?? ''}`)
    .join('\n');
}

export function appendReusedLocatorFacts(
  key: GraphLocatorFactShardKey,
  expectedCallEnvironmentDigest: string,
  facts: GraphWorkspaceFact[],
  processing: GraphFactBatch['processing'][number][],
  unknownZones: GraphUnknownZone[]
): boolean {
  const shard = lookupLocatorFactShard(key);
  if (!shard) return false;
  if (shard.callEnvironmentDigest !== expectedCallEnvironmentDigest) return false;
  facts.push(...materializeLocatorFactShardFacts(shard));
  processing.push(shard.processing);
  unknownZones.push(...shard.unknownZones);
  return true;
}

export function materializeLocatorFactShardFacts(
  shard: GraphLocatorFactShard
): readonly GraphWorkspaceFact[] {
  const origins = new Map(shard.observationOrigins);
  return shard.facts.map((fact) => ({
    ...fact,
    partitionOwner: {
      locator: shard.locator,
      observationOrigin: origins.get(fact.factId) ?? 'build-clock',
    },
  }));
}
