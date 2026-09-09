import {
  admitGraphProviderOutput,
  resolveGraphEntityIdentity,
  validateGraphProviderDetectionRequest,
  validateGraphProviderDetectionResult,
  validateGraphProviderManifest,
} from '../conformance/index.js';
import type {
  GraphDiagnostic,
  GraphProviderInput,
  GraphProviderRunSummary,
  GraphValidationIssue,
} from '../contracts/index.js';

import { composeGraph } from './compose-graph.js';
import { GRAPH_STANDARD_COMPOSITION_POLICY } from './composition-types.js';
import type { GraphCompositionSource } from './composition-types.js';
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
  excludedDirectories: Object.freeze([
    '.git',
    '.workspai',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'target',
    'bin',
    'obj',
    '.venv',
    'venv',
  ]),
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

function emptyResult(
  status: 'failed' | 'cancelled',
  diagnostics: readonly GraphDiagnostic[],
  providerSummaries: readonly GraphProviderRunSummary[],
  inputCount: number,
  inputBytes: number,
  omittedFiles: number,
  zones: {
    readonly unknownZones: GraphRepoBuildResult['quality']['unknownZones'];
    readonly unsupportedZones: GraphRepoBuildResult['quality']['unsupportedZones'];
  } = { unknownZones: [], unsupportedZones: [] }
): GraphRepoBuildResult {
  return {
    status,
    quality: {
      unknownZones: zones.unknownZones,
      unsupportedZones: zones.unsupportedZones,
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
      inputFiles: inputCount,
      inputBytes,
      providerFacts: providerSummaries.reduce((sum, summary) => sum + summary.factCount, 0),
      omittedFiles,
    },
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
  const diagnostics: GraphDiagnostic[] = [];
  const summaries: GraphProviderRunSummary[] = [];
  const sources: GraphCompositionSource[] = [];
  let inventory;

  if (!request.root.trim()) {
    return emptyResult(
      'failed',
      [diagnostic('GRAPH_REPO_ROOT_INVALID', 'error', '/root', 'Repository root is required.')],
      summaries,
      0,
      0,
      0
    );
  }
  const policyDiagnostics = validateBuildPolicy(request.policy);
  if (policyDiagnostics.length > 0) {
    return emptyResult('failed', policyDiagnostics, summaries, 0, 0, 0);
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
      0,
      0,
      0
    );
  }
  const scope = deepFreeze(structuredClone(request.scope));

  try {
    request.ports.cancellation.throwIfAborted();
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
      0,
      0,
      0
    );
  }

  diagnostics.push(...inventory.diagnostics);
  const inventoryZones = {
    unknownZones: inventory.unknownZones,
    unsupportedZones: inventory.unsupportedZones,
  };
  const inventoryValidation = validateInventory(inventory.inputs, request.policy);
  if (inventoryValidation.length > 0) {
    diagnostics.push(...inventoryValidation);
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      inventory.inputs.length,
      0,
      inventory.omittedFiles,
      inventoryZones
    );
  }
  const inputBytes = inventory.inputs.reduce((sum, input) => sum + input.byteLength, 0);
  if (inventory.status === 'cancelled') {
    return emptyResult(
      'cancelled',
      diagnostics,
      summaries,
      inventory.inputs.length,
      inputBytes,
      inventory.omittedFiles,
      inventoryZones
    );
  }
  if (inventory.status === 'failed') {
    return emptyResult(
      'failed',
      diagnostics,
      summaries,
      inventory.inputs.length,
      inputBytes,
      inventory.omittedFiles,
      inventoryZones
    );
  }

  const admittedInputs = Object.freeze(inventory.inputs.map(immutableInput));
  const inputByLocator = new Map(admittedInputs.map((input) => [input.locator, input]));
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
      admittedInputs.length,
      inputBytes,
      inventory.omittedFiles,
      inventoryZones
    );
  }
  const observedAt = request.ports.clock.now().toISOString();

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
        inventory.inputs.length,
        inputBytes,
        inventory.omittedFiles,
        inventoryZones
      );
    }
    const identity = providerIdentity(provider.manifest.id, provider.manifest.version);
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
      availableInputs: admittedInputs.map((input) => input.locator),
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
      });
      continue;
    }
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
      });
      continue;
    }

    let collected: unknown;
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
            resolveIdentity: (input) => resolveGraphEntityIdentity(input, request.ports.digest),
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
              return request.ports.fileSource.read(request.root, admitted, {
                maxBytes,
                signal: options.signal ?? providerSignal,
              });
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
          inventory.inputs.length,
          inputBytes,
          inventory.omittedFiles,
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
      });
      continue;
    }

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
    });
    if (['complete', 'partial'].includes(admission.batch.status)) {
      sources.push({ manifest: admission.manifest, batch: admission.batch });
    }
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
      inventory.inputs.length,
      inputBytes,
      inventory.omittedFiles,
      inventoryZones
    );
  }

  const composed = await composeGraph(
    {
      ontology: request.ontology,
      sources,
      policy: request.policy.composition,
    },
    request.ports
  );
  if (!composed.accepted) {
    diagnostics.push(...issueDiagnostics('composition', composed.issues));
    return emptyResult(
      composed.code === 'cancelled' ? 'cancelled' : 'failed',
      diagnostics,
      summaries,
      inventory.inputs.length,
      inputBytes,
      inventory.omittedFiles,
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
    quality: {
      graph: composed.value.quality,
      unknownZones: [
        ...inventory.unknownZones,
        ...sources.flatMap((source) => source.batch.unknownZones),
      ],
      unsupportedZones: [
        ...inventory.unsupportedZones,
        ...sources.flatMap((source) => source.batch.unsupportedZones),
      ],
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
    },
  };
}
