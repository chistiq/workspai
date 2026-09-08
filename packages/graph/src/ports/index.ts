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
