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

export interface GraphProductHostPorts extends GraphExecutionPorts {
  readonly fileSource: GraphFileSourcePort;
}
import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphUnknownZone,
  GraphUnsupportedZone,
} from '../contracts/index.js';
