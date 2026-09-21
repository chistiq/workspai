import type { WisDigestReference } from '@workspai/shared/contracts';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  GraphWorkerPoolPort,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../ports/index.js';
import type {
  GraphProductHostPorts,
  GraphGitWorktreeBaseline,
  GraphIncrementalSnapshotProbePort,
} from '../../ports/index.js';
import {
  GRAPH_PRODUCT_SCAN_PROFILE_ID,
  GRAPH_REFERENCE_COMPOSITION_TASK,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  collectGraphSemanticDependencies,
  contentStateLeavesFromProviderInputs,
  executeGraphReferenceCompositionTask,
  freezeGitWorktreeBaseline,
  type GraphIncrementalRepoBuildResult,
  type GraphRepoBuildPolicy,
  type GraphRepoBuildResult,
} from '../../application/index.js';
import type { GraphCompositionRequest } from '../../application/composition-types.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphOntologyProfile,
  type GraphProviderRuntime,
  type GraphScope,
} from '../../contracts/index.js';
import { createStandardRepositoryProviders } from '../../providers/index.js';

import { createNodeGraphFileSource } from './repository-file-source.js';
import { createNodeGitChangeJournalPort } from './git-change-journal.js';
import {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
} from './rust-wasm-engine.js';
import type { GraphNativePort } from '../../ports/index.js';
import { createHashedContentCache, type HashedContentCache } from './hashed-content-cache.js';
import {
  createContentAddressedFactSession,
  runWithContentAddressedFactSession,
  type ContentAddressedFactSession,
} from '../../providers/content-addressed-facts.js';
import {
  createLocatorFactShardStore,
  runWithLocatorFactShardStore,
  type LocatorFactShardStore,
} from '../../application/locator-fact-shards.js';

export { createNodeGraphFileSource } from './repository-file-source.js';
export {
  GRAPH_HASHED_CONTENT_CACHE_LIMIT_BYTES,
  consumeHashedContentCacheStats,
  createHashedContentCache,
  hashedContentCacheStats,
  type HashedContentCache,
  type HashedContentCacheStats,
} from './hashed-content-cache.js';
export {
  createContentAddressedFactSession,
  disposeContentAddressedFactSession,
  runWithContentAddressedFactSession,
  runWithOwnedContentAddressedFactSession,
  type ContentAddressedFactSession,
} from '../../providers/content-addressed-facts.js';
export { createNodeGitChangeJournalPort } from './git-change-journal.js';
export { createNodeProjectArtifactStore } from './project-artifact-store.js';
export { createNodeWorkspaceArtifactStore } from './workspace-artifact-store.js';
export {
  GraphNativeAdapterLoadError,
  createNodeRustWasmGraphNativePort,
  reclaimBundledEngineBuffers,
  type GraphNativeAdapterLoadErrorCode,
} from './rust-wasm-engine.js';
export {
  extractPublishedMatrixDeclarations,
  routeGraphNativeDeclarations,
  type GraphNativeDeclarationRoute,
  type GraphPublishedDeclarationRoute,
} from '../../providers/route-native-declarations.js';
export {
  referenceGraphNativeTraversal,
  routeGraphNativeTraversal,
  type GraphNativeTraversalRoute,
} from '../../application/route-native-traversal.js';

let bundledNativePort: Promise<GraphNativePort | undefined> | undefined;

/** Loads the product-bundled engine once per process. Missing artifacts stay TypeScript-only. */
export function loadNodeBundledGraphNativePort(): Promise<GraphNativePort | undefined> {
  bundledNativePort ??= (async () => {
    try {
      return await createNodeRustWasmGraphNativePort();
    } catch (error) {
      if (error instanceof GraphNativeAdapterLoadError) return undefined;
      throw error;
    }
  })();
  return bundledNativePort;
}

export interface NodeRepoGraphBuildRequest {
  readonly root: string;
  readonly scope?: GraphScope;
  readonly ontology?: GraphOntologyProfile;
  readonly providers?: readonly GraphProviderRuntime[];
  readonly policy?: GraphRepoBuildPolicy;
  readonly signal?: AbortSignal;
  /** Overrides the packaged reference worker location for bundled executable hosts. */
  readonly workerUrl?: URL;
  /**
   * Caller-owned extraction session. When omitted the product API creates and
   * disposes a session for this call. Pass the same session from a base build
   * into incremental rebuilds in the same command/request lifecycle. Reuse is
   * bound to the extraction environment (scope, root, inventory, manifests,
   * policy). Never keep a session alive beyond the owner that created it.
   */
  readonly session?: GraphProductBuildSession;
}

function inheritedWorkerExecArgv(workerUrl: URL): string[] {
  const javascriptWorker = workerUrl.pathname.endsWith('.js');
  const args: string[] = [];
  const source = process.execArgv.filter((argument) => !argument.startsWith('--input-type'));
  for (let index = 0; index < source.length; index += 1) {
    const argument = source[index];
    const next = source[index + 1];
    if (javascriptWorker && argument === '--import' && next === 'tsx') {
      index += 1;
      continue;
    }
    args.push(argument);
  }
  return args;
}

function packagedReferenceWorkerUrl(): URL {
  try {
    const adapterEntry = import.meta.resolve('@workspai/graph/adapters/node');
    return new URL('./reference-worker-entry.js', adapterEntry);
  } catch {
    // Source-level and non-package consumers retain the adjacent-entry fallback.
    return new URL('./reference-worker-entry.js', import.meta.url);
  }
}

function emptyResult<TOutput>(
  status: 'failed' | 'cancelled' | 'resource-limit',
  code: string,
  message: string,
  durationMs: number
): GraphWorkerTaskResult<TOutput> {
  return {
    status,
    diagnostics: [
      {
        code,
        severity: status === 'cancelled' ? 'info' : 'error',
        path: '/workers/node',
        message,
      },
    ],
    metrics: { durationMs, inputBytes: 0, outputBytes: 0 },
  };
}

/**
 * Creates a bounded one-task-per-worker Node adapter for the portable Graph
 * reference task protocol. Worker isolation is an execution concern only and
 * cannot redefine composition semantics. Product inspect/build hosts run the
 * same task in-process so large graphs are not serialized into a worker.
 */
export function createNodeGraphReferenceWorkerPool(
  workerUrl: URL = packagedReferenceWorkerUrl(),
  options: { readonly isolate?: boolean } = {}
): GraphWorkerPoolPort {
  const isolate = options.isolate ?? true;
  return {
    serializesTasks: isolate,
    execute<TInput, TOutput>(
      request: GraphWorkerTaskRequest<TInput>
    ): Promise<GraphWorkerTaskResult<TOutput>> {
      const startedAt = performance.now();
      if (request.signal?.aborted) {
        return Promise.resolve(
          emptyResult('cancelled', 'GRAPH_NODE_WORKER_CANCELLED', 'Task was already cancelled.', 0)
        );
      }
      if (
        !Number.isInteger(request.timeoutMs) ||
        request.timeoutMs <= 0 ||
        !Number.isInteger(request.maxOutputBytes) ||
        request.maxOutputBytes <= 0
      ) {
        return Promise.resolve(
          emptyResult(
            'resource-limit',
            'GRAPH_NODE_WORKER_BUDGET_INVALID',
            'Worker timeout and output budgets must be positive integers.',
            0
          )
        );
      }
      if (
        !isolate &&
        request.task.id === GRAPH_REFERENCE_COMPOSITION_TASK.id &&
        request.task.version === GRAPH_REFERENCE_COMPOSITION_TASK.version
      ) {
        try {
          const output = executeGraphReferenceCompositionTask(
            request.input as GraphCompositionRequest
          ) as TOutput;
          return Promise.resolve({
            status: 'complete',
            output,
            diagnostics: [],
            metrics: {
              durationMs: performance.now() - startedAt,
              // Sentinel: composeGraph skips worker JSON byte measurement.
              inputBytes: 0,
              outputBytes: 1,
            },
          });
        } catch (error) {
          return Promise.resolve(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_EXECUTION_FAILED',
              error instanceof Error ? error.message : 'Graph worker execution failed.',
              performance.now() - startedAt
            )
          );
        }
      }

      return new Promise((resolve) => {
        let worker: Worker;
        try {
          worker = new Worker(workerUrl, {
            // Eval/STDIN-only flags inherited from a host process make file-backed
            // workers fail before startup. Bare `--import tsx` also fails after the
            // host chdirs away from the package, so JavaScript workers drop it.
            execArgv: inheritedWorkerExecArgv(workerUrl),
          });
        } catch (error) {
          resolve(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_START_FAILED',
              error instanceof Error ? error.message : 'Worker could not be started.',
              performance.now() - startedAt
            )
          );
          return;
        }
        let settled = false;
        const finish = (result: GraphWorkerTaskResult<TOutput>): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          request.signal?.removeEventListener('abort', cancel);
          void worker.terminate();
          resolve(result);
        };
        const cancel = (): void => {
          finish(
            emptyResult(
              'cancelled',
              'GRAPH_NODE_WORKER_CANCELLED',
              'Task was cancelled before completion.',
              performance.now() - startedAt
            )
          );
        };
        const timeout = setTimeout(() => {
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_TIMEOUT',
              `Task exceeded its ${request.timeoutMs}ms execution budget.`,
              performance.now() - startedAt
            )
          );
        }, request.timeoutMs);
        timeout.unref();
        request.signal?.addEventListener('abort', cancel, { once: true });
        worker.once('message', (result: GraphWorkerTaskResult<TOutput>) => finish(result));
        worker.once('error', (error) =>
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_CRASHED',
              error.message,
              performance.now() - startedAt
            )
          )
        );
        worker.once('exit', (code) => {
          if (code !== 0)
            finish(
              emptyResult(
                'failed',
                'GRAPH_NODE_WORKER_EXITED',
                `Worker exited with code ${code}.`,
                performance.now() - startedAt
              )
            );
        });
        const { signal: _signal, ...portableRequest } = request;
        try {
          worker.postMessage(portableRequest);
        } catch (error) {
          finish(
            emptyResult(
              'failed',
              'GRAPH_NODE_WORKER_INPUT_NOT_PORTABLE',
              error instanceof Error ? error.message : 'Worker input could not be transferred.',
              performance.now() - startedAt
            )
          );
        }
      });
    },
  };
}

const productSessionShards = new WeakMap<GraphProductBuildSession, LocatorFactShardStore>();

export interface GraphProductBuildSession {
  readonly facts: ContentAddressedFactSession;
  readonly hashedContent: HashedContentCache;
  dispose(): void;
}

export function createGraphProductBuildSession(): GraphProductBuildSession {
  const facts = createContentAddressedFactSession();
  const hashedContent = createHashedContentCache();
  const locatorShards = createLocatorFactShardStore();
  const session: GraphProductBuildSession = {
    facts,
    hashedContent,
    dispose() {
      facts.dispose();
      hashedContent.dispose();
      locatorShards.dispose();
    },
  };
  productSessionShards.set(session, locatorShards);
  return session;
}

export async function runWithOwnedGraphProductBuildSession<T>(
  session: GraphProductBuildSession | undefined,
  fn: (session: GraphProductBuildSession) => Promise<T> | T
): Promise<T> {
  const owned = session ?? createGraphProductBuildSession();
  const created = session === undefined;
  const locatorShards = productSessionShards.get(owned) ?? createLocatorFactShardStore();
  if (!productSessionShards.has(owned)) productSessionShards.set(owned, locatorShards);
  try {
    return await runWithLocatorFactShardStore(locatorShards, () =>
      runWithContentAddressedFactSession(owned.facts, () => fn(owned))
    );
  } finally {
    if (created) owned.dispose();
  }
}

export function createNodeGraphProductHostPorts(
  options: {
    readonly signal?: AbortSignal;
    readonly workerUrl?: URL;
    readonly isolateComposition?: boolean;
    readonly snapshotProbe?: GraphIncrementalSnapshotProbePort;
    readonly hashedContent?: HashedContentCache;
  } = {}
): GraphProductHostPorts {
  const signal = options.signal;
  return {
    clock: { now: () => new Date() },
    digest: {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      digestSync: (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => {
        const hash = createHash('sha256');
        return {
          update: (chunk: Uint8Array) => {
            hash.update(chunk);
          },
          digest: async () => hash.digest('hex'),
        };
      },
    },
    cancellation: {
      get aborted() {
        return signal?.aborted === true;
      },
      throwIfAborted: () => signal?.throwIfAborted(),
    },
    scheduler: { yield: () => waitForImmediate() },
    workers: createNodeGraphReferenceWorkerPool(options.workerUrl, {
      isolate: options.isolateComposition ?? false,
    }),
    fileSource: createNodeGraphFileSource(
      options.hashedContent ? { hashedContent: options.hashedContent } : {}
    ),
    changeJournal: createNodeGitChangeJournalPort(),
    signal,
    ...(options.snapshotProbe ? { snapshotProbe: options.snapshotProbe } : {}),
  };
}

const NODE_INCREMENTAL_SCAN_PROFILE = Object.freeze({
  algorithm: 'sha256' as const,
  value: createHash('sha256').update(GRAPH_PRODUCT_SCAN_PROFILE_ID).digest('hex'),
});

function overlayNodeGitBaseline<T extends GraphRepoBuildResult>(
  result: T,
  captured: GraphGitWorktreeBaseline | undefined
): T {
  if (!captured || !result.admittedInputs) return result;
  return Object.freeze({
    ...result,
    gitBaseline: freezeGitWorktreeBaseline({
      ...captured,
      scanProfileDigest: NODE_INCREMENTAL_SCAN_PROFILE.value,
      inventoryDigest: inventoryDigest(result.admittedInputs),
    }),
  });
}

function inventoryDigest(
  inputs: readonly { readonly locator: string; readonly digest: { readonly value: string } }[]
): string {
  const hash = createHash('sha256');
  for (const input of [...inputs].sort((left, right) =>
    left.locator.localeCompare(right.locator)
  )) {
    hash.update(input.locator);
    hash.update('\0');
    hash.update(input.digest.value);
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Runs the package-owned, offline repository preview with secure Node host adapters.
 * It does not create Workspai metadata, execute project code or persist a graph.
 */
export async function buildNodeRepoGraph(
  request: NodeRepoGraphBuildRequest
): Promise<GraphRepoBuildResult> {
  return runWithOwnedGraphProductBuildSession(request.session, async (session) => {
    const ports = createNodeGraphProductHostPorts({
      signal: request.signal,
      workerUrl: request.workerUrl,
      hashedContent: session.hashedContent,
    });
    const result = await buildRepoGraph({
      root: request.root,
      scope: request.scope ?? {
        kind: 'project',
        projectIds: ['project:implicit-single-repository'],
      },
      ontology: request.ontology ?? CORE_GRAPH_ONTOLOGY_PROFILE,
      providers:
        request.providers ??
        createStandardRepositoryProviders({ loadNative: loadNodeBundledGraphNativePort }),
      policy: request.policy ?? GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports,
    });
    const inspection = await ports.changeJournal?.inspect({
      root: request.root,
      signal: request.signal,
    });
    return overlayNodeGitBaseline(result, inspection?.baseline);
  });
}

export interface NodeIncrementalRepoGraphBuildRequest extends NodeRepoGraphBuildRequest {
  readonly base: GraphRepoBuildResult;
  /**
   * Independent current-tree full-build digest. Equivalence is never assessed
   * against the base generation.
   */
  readonly currentTreeReferenceDigest?: WisDigestReference;
  readonly snapshotProbe?: GraphIncrementalSnapshotProbePort;
  readonly snapshotAttempts?: number;
}

/**
 * Runs skip-reread incremental rebuild through the Node product host.
 * Git skip-reread is trusted when the base generation has an admitted
 * worktree receipt. Dirty bases must record dirty locators so restores reread.
 * Equivalence is assessed only against an independently supplied current-tree
 * full build.
 */
export async function buildNodeIncrementalRepoGraph(
  request: NodeIncrementalRepoGraphBuildRequest
): Promise<GraphIncrementalRepoBuildResult> {
  if (!request.base.graph || !request.base.compositionSources || !request.base.admittedInputs) {
    throw new Error(
      'Incremental Node Graph build requires a complete base generation with composition sources and admitted inventory.'
    );
  }
  const baseGraph = request.base.graph;
  const baseSources = request.base.compositionSources;
  const admittedInputs = request.base.admittedInputs;
  return runWithOwnedGraphProductBuildSession(request.session, async (session) => {
    const scope = request.scope ?? {
      kind: 'project',
      projectIds: ['project:implicit-single-repository'],
    };
    const ontology = request.ontology ?? CORE_GRAPH_ONTOLOGY_PROFILE;
    const providers =
      request.providers ??
      createStandardRepositoryProviders({ loadNative: loadNodeBundledGraphNativePort });
    const policy = request.policy ?? GRAPH_STANDARD_REPO_BUILD_POLICY;
    const ports = createNodeGraphProductHostPorts({
      signal: request.signal,
      workerUrl: request.workerUrl,
      hashedContent: session.hashedContent,
      ...(request.snapshotProbe ? { snapshotProbe: request.snapshotProbe } : {}),
    });
    const stamps = await collectGraphSemanticDependencies({
      ontology,
      compositionPolicy: policy.composition,
      redactionProfile: policy.redactionProfile,
      providerManifests: providers.map((provider) => provider.manifest),
      digest: ports.digest,
    });
    const baseManifest = buildContentStateManifest({
      scope,
      generatedAt: baseGraph.generation.reference.generatedAt,
      scanProfileDigest: NODE_INCREMENTAL_SCAN_PROFILE,
      leaves: contentStateLeavesFromProviderInputs(admittedInputs, NODE_INCREMENTAL_SCAN_PROFILE),
      shardDependencies: buildShardDependenciesFromSources(baseSources, stamps),
    });
    const reconstructedInventory = inventoryDigest(admittedInputs);
    const baseGitBaseline =
      request.base.gitBaseline &&
      request.base.gitBaseline.scanProfileDigest === NODE_INCREMENTAL_SCAN_PROFILE.value &&
      request.base.gitBaseline.inventoryDigest === reconstructedInventory
        ? request.base.gitBaseline
        : undefined;
    return buildIncrementalRepoGraph({
      root: request.root,
      scope,
      ontology,
      providers,
      policy,
      ports,
      baseManifest,
      baseGeneration: baseGraph.generation.reference.id,
      targetGeneration: `${baseGraph.generation.reference.id}:incremental`,
      baseSources,
      providersToRecompute: [],
      scanProfileDigest: NODE_INCREMENTAL_SCAN_PROFILE,
      ...(request.currentTreeReferenceDigest
        ? { referenceGenerationDigest: request.currentTreeReferenceDigest }
        : {}),
      ...(baseGitBaseline ? { baseGitBaseline } : {}),
      ...(request.snapshotAttempts ? { snapshotAttempts: request.snapshotAttempts } : {}),
      baseGraph,
      ...(request.base.quality.graph ? { baseQuality: request.base.quality.graph } : {}),
      ...(request.base.compositionReceipt
        ? { baseCompositionReceipt: request.base.compositionReceipt }
        : {}),
    });
  });
}
