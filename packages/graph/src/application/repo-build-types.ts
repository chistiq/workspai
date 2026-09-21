import type {
  GraphCanonicalGraph,
  GraphContentStateManifest,
  GraphDiagnostic,
  GraphOntologyProfile,
  GraphProviderInput,
  GraphProviderRunSummary,
  GraphProviderRuntime,
  GraphQualityReport,
  GraphScope,
  GraphUnsupportedZone,
  GraphUnknownZone,
} from '../contracts/index.js';
import type { GraphOmittedSubtree } from '../contracts/inventory-surface.js';
import type { GraphGitWorktreeBaseline, GraphProductHostPorts } from '../ports/index.js';

import type {
  GraphCompositionPolicy,
  GraphCompositionReceipt,
  GraphCompositionSource,
  GraphCompositionTimings,
} from './composition-types.js';
import type { GraphInventoryMembershipSnapshot } from './inventory-membership.js';
import type { GraphRepoPhaseTiming } from './phase-metrics.js';

export interface GraphRepoBuildCompositionReuse {
  readonly reusedSources: readonly GraphCompositionSource[];
  readonly providersToRecompute: readonly string[];
}

export interface GraphRepoBuildPolicy {
  readonly network: 'deny' | 'allow';
  readonly redactionProfile: string;
  readonly limits: {
    readonly maxFiles: number;
    readonly maxTotalBytes: number;
    readonly maxFileBytes: number;
    readonly maxProviderReadBytes: number;
    readonly maxDepth: number;
    readonly maxDirectoryEntries: number;
  };
  readonly excludedDirectories: readonly string[];
  readonly sensitiveFiles: 'omit-known';
  readonly composition: GraphCompositionPolicy;
}

export interface GraphRepoBuildRequest {
  readonly root: string;
  readonly scope: GraphScope;
  readonly ontology: GraphOntologyProfile;
  readonly providers: readonly GraphProviderRuntime[];
  readonly policy: GraphRepoBuildPolicy;
  readonly ports: GraphProductHostPorts;
  readonly compositionReuse?: GraphRepoBuildCompositionReuse;
  /**
   * Prior canonical graph plus the proof-carrying composition receipt that
   * bound it. Reuse is allowed only when a freshly admitted semantic receipt
   * matches this receipt independently of live object identity.
   */
  readonly reuseCanonicalBuild?: {
    readonly graph: GraphCanonicalGraph;
    readonly quality?: GraphQualityReport;
    readonly receipt?: GraphCompositionReceipt;
  };
  /** Pre-admitted inventory; when set the host file source is not reread. */
  readonly admittedInputs?: readonly GraphProviderInput[];
}

export interface GraphRepoBuildMetrics {
  readonly inputFiles: number;
  readonly inputBytes: number;
  readonly providerFacts: number;
  readonly omittedFiles: number;
  readonly omittedBytes: number;
  readonly omittedFileAccounting?: 'enumerated' | 'unknown-subtrees';
  readonly omittedByteAccounting?: 'measured' | 'unknown-subtrees';
  readonly omittedSubtrees?: readonly GraphOmittedSubtree[];
  readonly durationMs?: number;
  readonly providerMs?: number;
  readonly compositionMs?: number;
  readonly inventoryMs?: number;
  readonly gitObservationMs?: number;
  readonly snapshotMs?: number;
  /** Adapter semantic-stamp collection before the incremental build. */
  readonly preambleMs?: number;
  /** Base content-state manifest built from the prior generation. */
  readonly baseManifestMs?: number;
  /** Semantic-stamp collection inside the incremental build. */
  readonly semanticStampsMs?: number;
  /** Target manifest, shard dependencies, and the final incremental plan. */
  readonly postManifestMs?: number;
  /** Filesystem walk that confirms incremental membership before provider reuse. */
  readonly inventoryWalkMs?: number;
  /** Projected manifest used to choose providers. Zero when the base manifest is reused. */
  readonly projectedManifestMs?: number;
  readonly hashedFiles?: number;
  readonly enumeratedFiles?: number;
  readonly filesRead?: number;
  readonly filesParsed?: number;
  readonly filesExtracted?: number;
  readonly cacheHits?: number;
  readonly cacheMisses?: number;
  readonly phaseTimings?: readonly GraphRepoPhaseTiming[];
  readonly compositionTimings?: GraphCompositionTimings;
  readonly providerTimings?: readonly {
    readonly providerId: string;
    readonly detectionMs: number;
    readonly collectionMs: number;
    readonly factCount: number;
  }[];
  readonly dataMovement?: import('./data-movement.js').GraphDataMovementSnapshot;
  /** End-of-build process snapshot. Not a stage series by itself. */
  readonly memory?: import('./build-memory.js').GraphBuildMemorySnapshot;
  /** Observational RSS/heap snapshots at named stages. Excluded from graph identity. */
  readonly memoryStages?: readonly import('./build-memory.js').GraphBuildMemorySnapshot[];
  /** Maximum RSS observed across recorded stages for this build. Not OS lifetime peak. */
  readonly peakObservedRssBytes?: number;
  /**
   * Process-lifetime peak RSS from the OS. Includes prior work in this process
   * and is not estimated retained bytes.
   */
  readonly processLifetimePeakRssBytes?: number;
}

export interface GraphRepoBuildQuality {
  readonly graph?: GraphQualityReport;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
  readonly omittedSubtrees?: readonly GraphOmittedSubtree[];
  readonly providerFailures: readonly { readonly providerId: string; readonly code: string }[];
}

export interface GraphRepoBuildResult {
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly graph?: GraphCanonicalGraph;
  readonly quality: GraphRepoBuildQuality;
  readonly providers: readonly GraphProviderRunSummary[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly metrics: GraphRepoBuildMetrics;
  readonly compositionSources?: readonly GraphCompositionSource[];
  /**
   * Proof-carrying receipt that binds the published graph and quality report
   * to admitted provider batches. Reuse without this receipt is forbidden.
   */
  readonly compositionReceipt?: GraphCompositionReceipt;
  /**
   * Admitted inventory leaves for in-process incremental rebuild. Omitted from
   * portable CLI output so host paths and file bytes are not published.
   */
  readonly admittedInputs?: readonly GraphProviderInput[];
  /**
   * Versioned Git worktree receipt for in-process incremental skip-reread.
   * Omitted from portable CLI output so host paths are not published.
   */
  readonly gitBaseline?: GraphGitWorktreeBaseline;
  /**
   * Filesystem membership observed for this generation. Git is never the sole
   * authority for added or removed inventory members.
   */
  readonly inventoryMembership?: GraphInventoryMembershipSnapshot;
  /**
   * In-process content-state manifest for a later incremental rebuild. It is
   * not part of the published graph digest. Portable CLI output must omit it.
   */
  readonly contentStateManifest?: GraphContentStateManifest;
}
