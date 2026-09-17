import {
  admitGraphProviderOutput,
  validateGraphProviderDetectionRequest,
  validateGraphProviderDetectionResult,
  validateGraphProviderManifest,
} from '../conformance/index.js';
import { createMemoizedIdentityResolver } from '../conformance/identity.js';
import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphProviderRunSummary,
  GraphValidationIssue,
} from '../contracts/index.js';
import {
  inventoryOmissionAccounting,
  inventorySurfaceExcludedDirectoryNames,
} from '../domain/inventory-surface.js';
import { structurizeUnknownZone } from '../domain/unknown-cause.js';
import type { GraphFileInventoryResult } from '../ports/index.js';

import { composeGraph } from './compose-graph.js';
import { GRAPH_STANDARD_COMPOSITION_POLICY } from './composition-types.js';
import type { GraphCompositionSource } from './composition-types.js';
import type { GraphRepoBuildCompositionReuse } from './repo-build-types.js';
import type {
  GraphRepoBuildPolicy,
  GraphRepoBuildRequest,
  GraphRepoBuildResult,
} from './repo-build-types.js';

export const GRAPH_STANDARD_REPO_BUILD_POLICY: Readonly<GraphRepoBuildPolicy> = Object.freeze({
  network: 'deny',
  redactionProfile: 'portable-default',
  limits: Object.freeze({
    maxFiles: 100_000,
    maxTotalBytes: 512 * 1024 * 1024,
    maxFileBytes: 8 * 1024 * 1024,
    maxProviderReadBytes: 64 * 1024 * 1024,
    maxDepth: 64,
    maxDirectoryEntries: 100_000,
  }),
  excludedDirectories: inventorySurfaceExcludedDirectoryNames(),
  sensitiveFiles: 'omit-known',
  composition: GRAPH_STANDARD_COMPOSITION_POLICY,
});

function diagnostic(
  code: string,
  severity: GraphDiagnostic['severity'],
  path: string,
  message: string
): GraphDiagnostic {
  return { code, severity, path, message };
}

function issueDiagnostics(
  providerId: string,
  issues: readonly GraphValidationIssue[]
): GraphDiagnostic[] {
  return issues.map((issue) =>
    diagnostic(
      issue.code,
      'error',
      `/providers/${encodeURIComponent(providerId)}${issue.path}`,
      issue.message
    )
  );
}

class GraphProviderDeadlineError extends Error {
  constructor() {
    super('Provider exceeded its admitted execution deadline.');
    this.name = 'GraphProviderDeadlineError';
  }
}

async function runProviderPhase<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T> | T
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(new GraphProviderDeadlineError());
      reject(new GraphProviderDeadlineError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
  }
}

function validateBuildPolicy(policy: GraphRepoBuildPolicy): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  const limits = Object.entries(policy.limits);
  if (
    limits.some(
      ([, value]) => !Number.isSafeInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER
    )
  ) {
    diagnostics.push(
      diagnostic(
        'GRAPH_REPO_POLICY_LIMIT_INVALID',
        'error',
        '/policy/limits',
        'Repository build limits must be positive safe integers.'
      )
    );
  }
  if (
    !policy.redactionProfile.trim() ||
    policy.excludedDirectories.some(
      (entry) =>
        !entry || entry === '.' || entry === '..' || entry.includes('/') || entry.includes('\\')
    ) ||
    new Set(policy.excludedDirectories).size !== policy.excludedDirectories.length
  ) {
    diagnostics.push(
      diagnostic(
        'GRAPH_REPO_POLICY_BOUNDARY_INVALID',
        'error',
        '/policy',
        'Repository build policy requires a redaction profile and unique directory basenames.'
      )
    );
  }
  return diagnostics;
}

function validRepoScope(scope: GraphRepoBuildRequest['scope']): boolean {
  return (
    scope.kind === 'project' &&
    Array.isArray(scope.projectIds) &&
    scope.projectIds.length > 0 &&
    scope.projectIds.length <= 1_000 &&
    scope.projectIds.every(
      (id) => /^[a-z0-9][a-z0-9._:/#@+-]{0,511}$/u.test(id) && id.length <= 512
    ) &&
    new Set(scope.projectIds).size === scope.projectIds.length
  );
}

function providerIdentity(providerId: string, providerVersion: string) {
  return {
    id: typeof providerId === 'string' && providerId ? providerId : 'invalid-provider',
    version:
      typeof providerVersion === 'string' && providerVersion ? providerVersion : 'invalid-version',
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableInput(input: GraphProviderInput): Readonly<GraphProviderInput> {
  return Object.freeze({
    locator: input.locator,
    mediaType: input.mediaType,
    byteLength: input.byteLength,
    digest: Object.freeze({ ...input.digest }),
  });
}

function validateInventory(
  inputs: readonly GraphProviderInput[],
  policy: GraphRepoBuildPolicy
): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  const locators = new Set<string>();
  let totalBytes = 0;
  if (inputs.length > policy.limits.maxFiles) {
    diagnostics.push(
      diagnostic(
        'GRAPH_REPO_INVENTORY_FILE_LIMIT_EXCEEDED',
        'error',
        '/inventory/inputs',
        'Repository inventory exceeded the admitted file-count budget.'
      )
    );
  }
  for (const [index, input] of inputs.entries()) {
    const inputPath = `/inventory/inputs/${index}`;
    const portable =
      typeof input.locator === 'string' &&
      input.locator.length > 0 &&
      input.locator.length <= 4096 &&
      !input.locator.startsWith('/') &&
      !input.locator.includes('\\') &&
      !/^[A-Za-z]:/u.test(input.locator) &&
      !input.locator.split('/').includes('..');
    if (!portable || locators.has(input.locator)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INVENTORY_LOCATOR_INVALID',
          'error',
          `${inputPath}/locator`,
          'Inventory locators must be unique portable repository-relative paths.'
        )
      );
    }
    locators.add(input.locator);
    if (
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 0 ||
      input.byteLength > policy.limits.maxFileBytes
    ) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INVENTORY_SIZE_INVALID',
          'error',
          `${inputPath}/byteLength`,
          'Inventory input size exceeds the admitted per-file budget.'
        )
      );
    } else totalBytes += input.byteLength;
    if (
      typeof input.mediaType !== 'string' ||
      input.mediaType.length === 0 ||
      input.digest?.algorithm !== 'sha256' ||
      !/^[a-f0-9]{64}$/u.test(input.digest.value)
    ) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INVENTORY_METADATA_INVALID',
          'error',
          inputPath,
          'Inventory inputs require media type and a lowercase SHA-256 content digest.'
        )
      );
    }
  }
  if (totalBytes > policy.limits.maxTotalBytes) {
    diagnostics.push(
      diagnostic(
        'GRAPH_REPO_INVENTORY_BYTE_LIMIT_EXCEEDED',
        'error',
        '/inventory/inputs',
        'Repository inventory exceeded the admitted total-byte budget.'
      )
    );
  }
  return diagnostics;
}

function validateCompositionReuse(
  providers: readonly { manifest: { id: string } }[],
  compositionReuse: GraphRepoBuildCompositionReuse
): GraphDiagnostic[] {
  const diagnostics: GraphDiagnostic[] = [];
  const registered = new Set(providers.map((provider) => provider.manifest.id));
  const recompute = new Set(compositionReuse.providersToRecompute);
  const reusedIds = new Set(compositionReuse.reusedSources.map((source) => source.manifest.id));

  for (const providerId of recompute) {
    if (!registered.has(providerId)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INCREMENTAL_PROVIDER_UNKNOWN',
          'error',
          '/compositionReuse/providersToRecompute',
          `Provider ${providerId} is not registered for this build.`
        )
      );
    }
    if (reusedIds.has(providerId)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INCREMENTAL_PROVIDER_DOUBLE_COVERED',
          'error',
          '/compositionReuse',
          `Provider ${providerId} cannot be both reused and recomputed.`
        )
      );
    }
  }

  for (const providerId of registered) {
    if (!recompute.has(providerId) && !reusedIds.has(providerId)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INCREMENTAL_PROVIDER_UNCOVERED',
          'error',
          '/compositionReuse',
          `Provider ${providerId} must be reused or explicitly recomputed.`
        )
      );
    }
  }

  const reusedProviders = new Set<string>();
  for (const source of compositionReuse.reusedSources) {
    if (reusedProviders.has(source.manifest.id)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_INCREMENTAL_REUSED_PROVIDER_DUPLICATE',
          'error',
          '/compositionReuse/reusedSources',
          `Provider ${source.manifest.id} appears more than once in reused sources.`
        )
      );
    }
    reusedProviders.add(source.manifest.id);
  }

  return diagnostics;
}

function emptyResult(
  status: 'failed' | 'cancelled',
  diagnostics: readonly GraphDiagnostic[],
  providerSummaries: readonly GraphProviderRunSummary[],
  metrics: {
    readonly inputFiles: number;
    readonly inputBytes: number;
    readonly omittedFiles: number;
    readonly omittedBytes: number;
    readonly omittedFileAccounting?: GraphRepoBuildResult['metrics']['omittedFileAccounting'];
    readonly omittedByteAccounting?: GraphRepoBuildResult['metrics']['omittedByteAccounting'];
  },
  zones: {
    readonly unknownZones: GraphRepoBuildResult['quality']['unknownZones'];
    readonly unsupportedZones: GraphRepoBuildResult['quality']['unsupportedZones'];
    readonly omittedSubtrees?: GraphRepoBuildResult['quality']['omittedSubtrees'];
  } = { unknownZones: [], unsupportedZones: [] }
): GraphRepoBuildResult {
  const omittedSubtrees = Object.freeze([...(zones.omittedSubtrees ?? [])]);
  return {
    status,
    quality: {
      unknownZones: zones.unknownZones,
      unsupportedZones: zones.unsupportedZones,
      omittedSubtrees,
      providerFailures: providerSummaries
        .filter(
          (summary) =>
            ['failed', 'invalid'].includes(summary.detection) ||
            ['failed', 'cancelled', 'invalid'].includes(summary.collection)
        )
        .map((summary) => ({
          providerId: summary.provider.id,
          code: 'GRAPH_PROVIDER_UNAVAILABLE',
        })),
    },
    providers: providerSummaries,
    diagnostics,
    metrics: {
      inputFiles: metrics.inputFiles,
      inputBytes: metrics.inputBytes,
      providerFacts: providerSummaries.reduce((sum, summary) => sum + summary.factCount, 0),
      omittedFiles: metrics.omittedFiles,
      omittedBytes: metrics.omittedBytes,
      omittedFileAccounting: metrics.omittedFileAccounting,
      omittedByteAccounting: metrics.omittedByteAccounting,
      omittedSubtrees,
    },
  };
}

const EMPTY_INVENTORY_METRICS = Object.freeze({
  inputFiles: 0,
  inputBytes: 0,
  omittedFiles: 0,
  omittedBytes: 0,
  omittedFileAccounting: 'enumerated' as const,
  omittedByteAccounting: 'measured' as const,
});

function metricsFromInventory(
  inventory: {
    readonly inputs: readonly { readonly byteLength: number }[];
    readonly omittedFiles: number;
    readonly omittedBytes: number;
    readonly omittedSubtrees?: Parameters<typeof inventoryOmissionAccounting>[0];
  },
  inputBytes?: number
) {
  return {
    inputFiles: inventory.inputs.length,
    inputBytes: inputBytes ?? inventory.inputs.reduce((sum, input) => sum + input.byteLength, 0),
    omittedFiles: inventory.omittedFiles,
    omittedBytes: inventory.omittedBytes,
    ...inventoryOmissionAccounting(inventory.omittedSubtrees ?? []),
  };
}

/**
 * Builds one repository graph from host-inventoried inputs and admitted provider batches.
 * The function owns orchestration only: filesystem access remains behind the injected port,
 * and canonical truth is produced exclusively by the reference composer.
 */
export async function buildRepoGraph(
  request: GraphRepoBuildRequest
): Promise<GraphRepoBuildResult> {
  const startedAt = performance.now();
  const diagnostics: GraphDiagnostic[] = [];
  const summaries: GraphProviderRunSummary[] = [];
  const sources: GraphCompositionSource[] = [];
  let inventory: GraphFileInventoryResult;

  if (!request.root.trim()) {
    return emptyResult(
      'failed',
      [diagnostic('GRAPH_REPO_ROOT_INVALID', 'error', '/root', 'Repository root is required.')],
      summaries,
      EMPTY_INVENTORY_METRICS
    );
  }
  const policyDiagnostics = validateBuildPolicy(request.policy);
  if (policyDiagnostics.length > 0) {
    return emptyResult('failed', policyDiagnostics, summaries, EMPTY_INVENTORY_METRICS);
  }
  if (!validRepoScope(request.scope)) {
    return emptyResult(
      'failed',
      [
        diagnostic(
          'GRAPH_REPO_SCOPE_INVALID',
          'error',
          '/scope',
          'Repository graph builds require a bounded project scope with portable identifiers.'
        ),
      ],
      summaries,
      EMPTY_INVENTORY_METRICS
    );
  }
  const scope = deepFreeze(structuredClone(request.scope));

  try {
    request.ports.cancellation.throwIfAborted();
    if (request.admittedInputs !== undefined) {
      inventory = {
        status: 'complete',
        inputs: request.admittedInputs,
        diagnostics: [],
        omittedFiles: 0,
        omittedBytes: 0,
        omittedFileAccounting: 'enumerated',
        omittedByteAccounting: 'measured',
        omittedSubtrees: Object.freeze([]),
        unknownZones: [],
        unsupportedZones: [],
      };
    } else {
      inventory = await request.ports.fileSource.inventory({
        root: request.root,
        maxFiles: request.policy.limits.maxFiles,
        maxTotalBytes: request.policy.limits.maxTotalBytes,
        maxFileBytes: request.policy.limits.maxFileBytes,
        maxDepth: request.policy.limits.maxDepth,
        maxDirectoryEntries: request.policy.limits.maxDirectoryEntries,
        excludedDirectories: request.policy.excludedDirectories,
        sensitiveFiles: request.policy.sensitiveFiles,
        signal: request.ports.signal,
      });
    }
  } catch {
    const cancelled = request.ports.cancellation.aborted || request.ports.signal?.aborted === true;
    return emptyResult(
      cancelled ? 'cancelled' : 'failed',
      [
        diagnostic(
          cancelled ? 'GRAPH_REPO_INVENTORY_CANCELLED' : 'GRAPH_REPO_INVENTORY_FAILED',
          cancelled ? 'info' : 'error',
          '/inventory',
          cancelled
            ? 'Repository inventory was cancelled.'
            : 'Repository inventory failed at the admitted host boundary.'
        ),
      ],
      summaries,
      EMPTY_INVENTORY_METRICS
    );
  }

  diagnostics.push(...inventory.diagnostics);
  const inventoryOmittedSubtrees = Object.freeze([...(inventory.omittedSubtrees ?? [])]);
  const inventoryAccounting = inventoryOmissionAccounting(inventoryOmittedSubtrees);
  const inventoryZones = {
    unknownZones: inventory.unknownZones.map((zone) =>
      structurizeUnknownZone(zone, { provider: 'graph.repository-inventory', stage: 'inventory' })
    ),
    unsupportedZones: inventory.unsupportedZones.map((zone) =>
      structurizeUnknownZone(zone, { provider: 'graph.repository-inventory', stage: 'inventory' })
    ),
    omittedSubtrees: inventoryOmittedSubtrees,
  };
  const inventoryValidation = validateInventory(inventory.inputs, request.policy);
  if (inventoryValidation.length > 0) {
    diagnostics.push(...inventoryValidation);
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, 0),
      inventoryZones
    );
  }
  const inputBytes = inventory.inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (inventory.status === 'cancelled') {
    return emptyResult(
      'cancelled',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }
  if (inventory.status === 'failed') {
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }

  const admittedInputs = Object.freeze(inventory.inputs.map(immutableInput));
  const inputByLocator = new Map(admittedInputs.map((input) => [input.locator, input]));
  const compositionReuse = request.compositionReuse;
  const providers = [...request.providers].sort((left, right) => {
    const byId = String(left.manifest?.id ?? '').localeCompare(String(right.manifest?.id ?? ''));
    return (
      byId ||
      String(left.manifest?.version ?? '').localeCompare(String(right.manifest?.version ?? ''))
    );
  });
  const providerIdentities = new Set<string>();
  for (const provider of providers) {
    const key = `${String(provider.manifest?.id ?? '')}\u0000${String(provider.manifest?.version ?? '')}`;
    if (providerIdentities.has(key)) {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_PROVIDER_DUPLICATE',
          'error',
          '/providers',
          'Repository builds require unique provider identity and version pairs.'
        )
      );
    }
    providerIdentities.add(key);
  }
  if (diagnostics.some((entry) => entry.code === 'GRAPH_REPO_PROVIDER_DUPLICATE')) {
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }
  if (compositionReuse) {
    diagnostics.push(...validateCompositionReuse(providers, compositionReuse));
    if (diagnostics.some((entry) => entry.severity === 'error')) {
      return emptyResult(
        'failed',
        diagnostics,
        summaries,
        metricsFromInventory(inventory, inputBytes),
        inventoryZones
      );
    }
  }
  const observedAt = request.ports.clock.now().toISOString();
  const resolveIdentity = createMemoizedIdentityResolver(request.ports.digest);
  const fileBytes = new Map<string, Promise<Uint8Array>>();
  const providersToRecompute = compositionReuse
    ? new Set(compositionReuse.providersToRecompute)
    : null;
  const reusedByProvider = compositionReuse
    ? new Map(compositionReuse.reusedSources.map((source) => [source.manifest.id, source]))
    : null;
  const availableInputLocators = Object.freeze(admittedInputs.map((input) => input.locator));
  const providersStartedAt = performance.now();

  for (const provider of providers) {
    try {
      request.ports.cancellation.throwIfAborted();
    } catch {
      diagnostics.push(
        diagnostic(
          'GRAPH_REPO_BUILD_CANCELLED',
          'info',
          '/providers',
          'Repository graph build was cancelled.'
        )
      );
      return emptyResult(
        'cancelled',
        diagnostics,
        summaries,
        metricsFromInventory(inventory, inputBytes),
        inventoryZones
      );
    }
    const identity = providerIdentity(provider.manifest.id, provider.manifest.version);
    if (providersToRecompute && !providersToRecompute.has(identity.id)) {
      const reused = reusedByProvider?.get(identity.id);
      if (!reused) {
        diagnostics.push(
          diagnostic(
            'GRAPH_REPO_INCREMENTAL_REUSED_SOURCE_MISSING',
            'error',
            `/providers/${encodeURIComponent(identity.id)}`,
            'Incremental builds require reused provider output for skipped providers.'
          )
        );
        continue;
      }
      sources.push(reused);
      summaries.push({
        provider: identity,
        detection: 'not-applicable',
        collection: 'not-run',
        factCount: reused.batch.facts.length,
        diagnostics: [
          diagnostic(
            'GRAPH_PROVIDER_REUSED_FROM_PRIOR_GENERATION',
            'info',
            `/providers/${encodeURIComponent(identity.id)}`,
            'Provider output was reused without re-execution.'
          ),
        ],
      });
      continue;
    }
    let manifestSnapshot: unknown;
    try {
      manifestSnapshot = deepFreeze(structuredClone(provider.manifest));
    } catch {
      manifestSnapshot = null;
    }
    const manifest = validateGraphProviderManifest(manifestSnapshot);
    if (!manifest.accepted) {
      const providerDiagnostics = issueDiagnostics(identity.id, manifest.issues);
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'invalid',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
      });
      continue;
    }

    if (request.policy.network === 'deny' && manifest.value.permissions.network === 'allow') {
      const providerDiagnostics = [
        diagnostic(
          'GRAPH_PROVIDER_NETWORK_DENIED',
          'warning',
          `/providers/${encodeURIComponent(identity.id)}`,
          'Provider requires network access but the repository build policy denies it.'
        ),
      ];
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'blocked',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
      });
      continue;
    }
    if (manifest.value.permissions.process === 'allow') {
      const providerDiagnostics = [
        diagnostic(
          'GRAPH_PROVIDER_PROCESS_DENIED',
          'warning',
          `/providers/${encodeURIComponent(identity.id)}`,
          'Standalone repository builds do not grant process execution to providers.'
        ),
      ];
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'blocked',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
      });
      continue;
    }

    const detectionRequest = {
      availableInputs: availableInputLocators,
      scopeKind: 'project',
      networkAllowed: request.policy.network === 'allow',
    } as const;
    const validDetectionRequest = validateGraphProviderDetectionRequest(detectionRequest);
    if (!validDetectionRequest.accepted) {
      const providerDiagnostics = issueDiagnostics(identity.id, validDetectionRequest.issues);
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'invalid',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
      });
      continue;
    }

    let detected: unknown;
    const detectionStartedAt = performance.now();
    try {
      detected = await runProviderPhase(
        manifest.value.limits.maxDurationMs,
        request.ports.signal,
        () => provider.detect(validDetectionRequest.value)
      );
    } catch (error) {
      const timedOut = error instanceof GraphProviderDeadlineError;
      const providerDiagnostics = [
        diagnostic(
          timedOut ? 'GRAPH_PROVIDER_DETECTION_TIMEOUT' : 'GRAPH_PROVIDER_DETECTION_FAILED',
          'error',
          `/providers/${encodeURIComponent(identity.id)}/detection`,
          timedOut
            ? 'Provider detection exceeded its admitted execution deadline.'
            : 'Provider detection failed within its admitted boundary.'
        ),
      ];
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'failed',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
        detectionMs: Math.max(0, Math.round(performance.now() - detectionStartedAt)),
      });
      continue;
    }
    const detectionMs = Math.max(0, Math.round(performance.now() - detectionStartedAt));
    const detection = validateGraphProviderDetectionResult(detected, manifest.value);
    if (!detection.accepted) {
      const providerDiagnostics = issueDiagnostics(identity.id, detection.issues);
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: 'invalid',
        collection: 'not-run',
        factCount: 0,
        diagnostics: providerDiagnostics,
        detectionMs,
      });
      continue;
    }
    if (detection.value.status !== 'applicable') {
      summaries.push({
        provider: identity,
        detection: detection.value.status,
        collection: 'not-run',
        factCount: 0,
        diagnostics: [],
        detectionMs,
      });
      continue;
    }

    let collected: unknown;
    const collectionStartedAt = performance.now();
    try {
      let providerReadBytes = 0;
      collected = await runProviderPhase(
        manifest.value.limits.maxDurationMs,
        request.ports.signal,
        (providerSignal) =>
          provider.collect({
            scope,
            inputs: admittedInputs,
            observedAt,
            signal: providerSignal,
            resolveIdentity,
            readInput: async (input: GraphProviderInput, options) => {
              const admitted = inputByLocator.get(input.locator);
              if (!admitted || admitted.digest.value !== input.digest.value) {
                throw new Error('Provider requested an input outside the admitted inventory.');
              }
              const totalBudget = Math.min(
                request.policy.limits.maxProviderReadBytes,
                manifest.value.limits.maxInputBytes ?? Number.MAX_SAFE_INTEGER
              );
              const maxBytes = Math.min(options.maxBytes, totalBudget);
              if (!Number.isInteger(maxBytes) || maxBytes <= 0 || admitted.byteLength > maxBytes) {
                throw new Error('Provider input read exceeds the admitted byte budget.');
              }
              providerReadBytes += admitted.byteLength;
              if (providerReadBytes > totalBudget) {
                throw new Error('Provider cumulative reads exceed the admitted byte budget.');
              }
              const cacheKey = `${admitted.locator}\u0000${admitted.digest.value}`;
              const cached = fileBytes.get(cacheKey);
              if (cached) return cached;
              const pending = request.ports.fileSource.read(request.root, admitted, {
                maxBytes,
                signal: options.signal ?? providerSignal,
              });
              fileBytes.set(cacheKey, pending);
              return pending;
            },
          })
      );
    } catch (error) {
      const cancelled =
        request.ports.cancellation.aborted || request.ports.signal?.aborted === true;
      if (cancelled) {
        diagnostics.push(
          diagnostic(
            'GRAPH_REPO_BUILD_CANCELLED',
            'info',
            `/providers/${encodeURIComponent(identity.id)}/collection`,
            'Repository graph build was cancelled during provider collection.'
          )
        );
        return emptyResult(
          'cancelled',
          diagnostics,
          summaries,
          metricsFromInventory(inventory, inputBytes),
          inventoryZones
        );
      }
      const timedOut = error instanceof GraphProviderDeadlineError;
      const providerDiagnostics = [
        diagnostic(
          timedOut ? 'GRAPH_PROVIDER_COLLECTION_TIMEOUT' : 'GRAPH_PROVIDER_COLLECTION_FAILED',
          'error',
          `/providers/${encodeURIComponent(identity.id)}/collection`,
          timedOut
            ? 'Provider collection exceeded its admitted execution deadline.'
            : 'Provider collection failed within its admitted boundary.'
        ),
      ];
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: detection.value.status,
        collection: 'invalid',
        factCount: 0,
        diagnostics: providerDiagnostics,
        detectionMs,
        collectionMs: Math.max(0, Math.round(performance.now() - collectionStartedAt)),
      });
      continue;
    }
    const collectionMs = Math.max(0, Math.round(performance.now() - collectionStartedAt));

    const admission = admitGraphProviderOutput(manifest.value, collected);
    if (!admission.accepted) {
      const providerDiagnostics = issueDiagnostics(identity.id, admission.issues);
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: detection.value.status,
        collection: 'invalid',
        factCount: 0,
        diagnostics: providerDiagnostics,
        detectionMs,
        collectionMs,
      });
      continue;
    }
    if (admission.batch.redaction.policy !== request.policy.redactionProfile) {
      const providerDiagnostics = [
        diagnostic(
          'GRAPH_PROVIDER_REDACTION_POLICY_MISMATCH',
          'error',
          `/providers/${encodeURIComponent(identity.id)}/redaction`,
          'Provider output does not attest the repository build redaction profile.'
        ),
      ];
      diagnostics.push(...providerDiagnostics);
      summaries.push({
        provider: identity,
        detection: detection.value.status,
        collection: 'invalid',
        factCount: 0,
        diagnostics: providerDiagnostics,
        detectionMs,
        collectionMs,
      });
      continue;
    }
    diagnostics.push(...admission.batch.diagnostics);
    summaries.push({
      provider: identity,
      detection: detection.value.status,
      collection: admission.batch.status,
      factCount: admission.batch.facts.length,
      diagnostics: admission.batch.diagnostics,
      detectionMs,
      collectionMs,
    });
    if (['complete', 'partial'].includes(admission.batch.status)) {
      sources.push({ manifest: admission.manifest, batch: admission.batch });
    }
  }
  const providerMs = Math.max(0, Math.round(performance.now() - providersStartedAt));

  if (
    diagnostics.some(
      (entry) => entry.severity === 'error' && entry.code.startsWith('GRAPH_REPO_INCREMENTAL')
    )
  ) {
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }

  if (sources.length === 0) {
    diagnostics.push(
      diagnostic(
        'GRAPH_REPO_NO_ADMITTED_PROVIDER_OUTPUT',
        'error',
        '/providers',
        'No applicable provider produced an admitted fact batch.'
      )
    );
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }

  const compositionStartedAt = performance.now();
  const composed = await composeGraph(
    {
      ontology: request.ontology,
      sources,
      policy: request.policy.composition,
    },
    request.ports
  );
  const compositionMs = Math.max(0, Math.round(performance.now() - compositionStartedAt));
  if (!composed.accepted) {
    diagnostics.push(...issueDiagnostics('composition', composed.issues));
    return emptyResult(
      composed.code === 'cancelled' ? 'cancelled' : 'failed',
      diagnostics,
      summaries,
      metricsFromInventory(inventory, inputBytes),
      inventoryZones
    );
  }

  const incomplete =
    inventory.status === 'partial' ||
    summaries.some((summary) =>
      ['partial', 'failed', 'cancelled', 'invalid'].includes(summary.collection)
    ) ||
    summaries.some((summary) =>
      ['blocked', 'unknown', 'failed', 'invalid'].includes(summary.detection)
    );
  return {
    status: incomplete ? 'partial' : 'complete',
    graph: composed.value.graph,
    compositionSources: Object.freeze([...sources]),
    quality: {
      graph: composed.value.quality,
      unknownZones: [
        ...inventory.unknownZones,
        ...sources.flatMap((source) => source.batch.unknownZones),
      ].map((zone) => structurizeUnknownZone(zone, { stage: 'repository-build' })),
      unsupportedZones: [
        ...inventory.unsupportedZones,
        ...sources.flatMap((source) => source.batch.unsupportedZones),
      ].map((zone) => structurizeUnknownZone(zone, { stage: 'repository-build' })),
      omittedSubtrees: inventoryOmittedSubtrees,
      providerFailures: summaries
        .filter(
          (summary) =>
            ['failed', 'invalid'].includes(summary.detection) ||
            ['failed', 'cancelled', 'invalid'].includes(summary.collection)
        )
        .map((summary) => ({
          providerId: summary.provider.id,
          code: 'GRAPH_PROVIDER_UNAVAILABLE',
        })),
    },
    providers: summaries,
    diagnostics: [...diagnostics, ...composed.value.graph.diagnostics],
    metrics: {
      inputFiles: inventory.inputs.length,
      inputBytes,
      providerFacts: summaries.reduce((sum, summary) => sum + summary.factCount, 0),
      omittedFiles: inventory.omittedFiles,
      omittedBytes: inventory.omittedBytes,
      omittedFileAccounting: inventoryAccounting.omittedFileAccounting,
      omittedByteAccounting: inventoryAccounting.omittedByteAccounting,
      omittedSubtrees: inventoryOmittedSubtrees,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      providerMs,
      compositionMs,
      ...(composed.timings ? { compositionTimings: composed.timings } : {}),
      providerTimings: Object.freeze(
        summaries
          .filter((summary) => summary.detectionMs !== undefined)
          .map((summary) => ({
            providerId: summary.provider.id,
            detectionMs: summary.detectionMs ?? 0,
            collectionMs: summary.collectionMs ?? 0,
            factCount: summary.factCount,
          }))
      ),
    },
  };
}
