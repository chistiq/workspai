export interface GraphClockPort {
  now(): Date;
}

export interface GraphDigestPort {
  readonly algorithm: 'sha256';
  digest(input: Uint8Array): Promise<string>;
}

export interface GraphCancellationPort {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

/** Schedules bounded work without coupling the domain to a host event loop. */
export interface GraphSchedulerPort {
  yield(): Promise<void>;
}

/**
 * Runs CPU-heavy deterministic operations outside the caller's hot path.
 * Implementations may use a worker thread, native host, WASM worker or an
 * external process, but must preserve input/output semantics and cancellation.
 */
export interface GraphWorkerTaskRequest<TInput> {
  readonly task: { readonly id: string; readonly version: string };
  readonly input: TInput;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface GraphWorkerTaskResult<TOutput> {
  readonly status: 'complete' | 'failed' | 'cancelled' | 'unsupported' | 'resource-limit';
  readonly output?: TOutput;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly path: string;
    readonly message: string;
  }[];
  readonly metrics: {
    readonly durationMs: number;
    readonly inputBytes: number;
    readonly outputBytes: number;
  };
}

export interface GraphWorkerPoolPort {
  execute<TInput, TOutput>(
    request: GraphWorkerTaskRequest<TInput>
  ): Promise<GraphWorkerTaskResult<TOutput>>;
}

export interface GraphExecutionPorts {
  readonly clock: GraphClockPort;
  readonly digest: GraphDigestPort;
  readonly cancellation: GraphCancellationPort;
  readonly scheduler: GraphSchedulerPort;
  readonly workers: GraphWorkerPoolPort;
  readonly signal?: AbortSignal;
}

export interface GraphFileInventoryRequest {
  readonly root: string;
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxFileBytes: number;
  readonly maxDepth: number;
  readonly maxDirectoryEntries: number;
  readonly excludedDirectories: readonly string[];
  readonly sensitiveFiles: 'omit-known';
  readonly signal?: AbortSignal;
  /**
   * When set, only these locators are content-hashed. `undefined` inventories
   * the whole tree; `[]` hashes no files. Used for trusted skip-reread.
   */
  readonly onlyLocators?: readonly string[];
}

export interface GraphFileInventoryResult {
  readonly status: 'complete' | 'partial' | 'cancelled' | 'failed';
  readonly inputs: readonly GraphProviderInput[];
  readonly diagnostics: readonly GraphDiagnostic[];
  readonly omittedFiles: number;
  readonly omittedBytes: number;
  readonly unknownZones: readonly GraphUnknownZone[];
  readonly unsupportedZones: readonly GraphUnsupportedZone[];
}

/** Host adapter for bounded repository reads. The engine never imports a filesystem API. */
export interface GraphFileSourcePort {
  inventory(request: GraphFileInventoryRequest): Promise<GraphFileInventoryResult>;
  read(
    root: string,
    input: GraphProviderInput,
    options: { readonly maxBytes: number; readonly signal?: AbortSignal }
  ): Promise<Uint8Array>;
}

export type GraphChangeJournalTrust = 'trusted' | 'untrusted' | 'absent';
export type GraphChangeJournalSource = 'git' | 'watcher' | 'change-journal' | 'none';
export type GraphChangeJournalRecordKind =
  'unchanged' | 'changed' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown';

/** Host-observed locator change. Git/mtime/path semantics never become reuse authority. */
export interface GraphChangeJournalRecord {
  readonly locator: string;
  readonly kind: GraphChangeJournalRecordKind;
  readonly gitStatus?: string;
  readonly priorLocator?: string;
}

export interface GraphChangeJournalInspection {
  readonly trust: GraphChangeJournalTrust;
  readonly source: GraphChangeJournalSource;
  readonly records: readonly GraphChangeJournalRecord[];
  readonly diagnostics: readonly GraphDiagnostic[];
}

/**
 * Optional Git/watcher/change-journal adapter. Untrusted or absent inspections
 * force a conservative full reread; portable content digests remain correctness.
 */
export interface GraphChangeJournalPort {
  inspect(request: {
    readonly root: string;
    readonly signal?: AbortSignal;
  }): Promise<GraphChangeJournalInspection>;
}

export interface GraphProductHostPorts extends GraphExecutionPorts {
  readonly fileSource: GraphFileSourcePort;
  readonly changeJournal?: GraphChangeJournalPort;
}

export type GraphProjectArtifactName =
  'canonical-graph' | 'quality' | 'provider-runs' | 'publication';

export interface GraphProjectArtifact {
  readonly name: GraphProjectArtifactName;
  readonly mediaType: 'application/json';
  readonly bytes: Uint8Array;
  readonly digest: { readonly algorithm: 'sha256'; readonly value: string };
}

export interface GraphProjectPublicationRequest {
  readonly generationKey: string;
  readonly artifacts: readonly GraphProjectArtifact[];
  readonly signal?: AbortSignal;
}

export interface GraphProjectPublicationResult {
  readonly status: 'committed' | 'already-current';
  readonly pointer: string;
  readonly artifacts: Readonly<Record<GraphProjectArtifactName, string>>;
}

/** Atomically publishes immutable project artifacts and advances one validated pointer last. */
export interface GraphProjectArtifactStorePort {
  publish(request: GraphProjectPublicationRequest): Promise<GraphProjectPublicationResult>;
}
import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../contracts/index.js';
