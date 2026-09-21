import path from 'node:path';

import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  WORKSPACE_IDENTITY_INPUT_LOCATOR,
  buildRepoGraph,
  createNodeGraphProductHostPorts,
  createScopeContainmentProvider,
  createStandardRepositoryProviders,
  runWithOwnedGraphProductBuildSession,
  type GraphProductBuildSession,
} from './graph-package-runtime.js';

import type { PackageGraphShadowInput } from './graph-shadow-parity.js';

export interface PreparedPackageProjectBuildContext {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly workspaceId: string;
}

export interface PreparedPackageProjectBuildResult {
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly inputFiles: number;
  readonly omittedFiles: number;
  readonly omittedBytes: number;
  readonly providerFacts: number;
  readonly comparison?: PackageGraphShadowInput;
  readonly semanticBinding?: {
    readonly sourceFixtureDigest: string;
    readonly providerProfileDigest: string;
    readonly graphPolicyDigest: string;
  };
}

const PORTABLE_PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;

function bundledReferenceWorkerUrl(): URL | undefined {
  return import.meta.url.endsWith('/dist/internal/graph-package-shadow-bridge.js')
    ? new URL('./graph-reference-worker-entry.js', import.meta.url)
    : undefined;
}

function renderIdentityPreimage(
  input: Uint8Array,
  digest: string
): readonly [string, string] | null {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    return null;
  }
  const parts = decoded.split('\0');
  if (parts.length !== 3) return null;
  const [namespace, kind, locator] = parts;
  if (!namespace || !kind || !locator) return null;
  return [
    `entity:${namespace}:${kind}:sha256:${digest}`,
    `entity:${namespace}:${kind}:${encodeURIComponent(locator)}`,
  ];
}

function packageComparisonInput(
  result: {
    readonly graph?: PackageGraphShadowInput['graph'];
    readonly quality: {
      readonly unknownZones: PackageGraphShadowInput['quality']['unknownZones'];
      readonly unsupportedZones: PackageGraphShadowInput['quality']['unsupportedZones'];
      readonly omittedSubtrees?: PackageGraphShadowInput['quality']['omittedSubtrees'];
      readonly graph?: { readonly coverage: PackageGraphShadowInput['quality']['coverage'] };
    };
    readonly compositionSources?: readonly {
      readonly batch: {
        readonly facts: readonly {
          readonly evidence: readonly { readonly relativeLocator?: string }[];
        }[];
      };
    }[];
  },
  identityRenderings: ReadonlyMap<string, string>
): PackageGraphShadowInput | undefined {
  if (!result.graph) return undefined;
  const rendered = Object.fromEntries(
    result.graph.nodes.map((node) => {
      const identity = identityRenderings.get(node.id);
      if (!identity)
        throw new Error('Canonical Graph identity was not observed at its digest port.');
      return [node.id, identity];
    })
  );
  return {
    graph: result.graph,
    quality: {
      unknownZones: result.quality.unknownZones,
      unsupportedZones: result.quality.unsupportedZones,
      coverage: result.quality.graph?.coverage ?? [],
      omittedSubtrees: result.quality.omittedSubtrees,
    },
    evidenceLocators: [
      ...new Set(
        (result.compositionSources ?? []).flatMap((source) =>
          source.batch.facts.flatMap((fact) =>
            fact.evidence.flatMap((evidence) =>
              evidence.relativeLocator ? [evidence.relativeLocator] : []
            )
          )
        )
      ),
    ].sort((left, right) => left.localeCompare(right)),
    identityRenderings: rendered,
  };
}

/**
 * Builds a read-only package Graph for a prepared project. This never writes
 * artifacts, never becomes CLI authority, and never falls back to the legacy
 * composer.
 *
 * Call-path ownership (one CLI command / request):
 *
 * | surface | session owner | builds / session | cache lifetime | reusable work | current benefit |
 * | standalone inspect | Graph CLI owned session via buildNodeRepoGraph | 1 | command | inventory+extract+compose | full-build path |
 * | query | none (reads an already built graph) | 0 | none | n/a | no rebuild |
 * | workspace graph shadow | this wrapper owns a session | 1 package build | command | full package build | no same-session warm |
 * | package-primary-with-compare | not admitted; fail-closed | 0 | none | n/a | G8 blocked |
 * | prepared project build | this wrapper, or a caller-owned session | 1 | command | full package build | share only when the caller owns multiple related builds |
 * | incremental build | caller-owned session from the base build | 1+ | command | locator shards + skip-reread | product incremental path |
 * | repeated consumers in one command | caller must pass one owned session | N | command | extraction environment reuse | only when N>1 and environment matches |
 * | installed CLI execution | command process | typically 1 | process | none across processes | improve cold/full build, not synthetic warm |
 *
 * A daemon or on-disk cache is not introduced. Caller-owned sessions are never
 * disposed here. Owned sessions are disposed on success, failure, cancellation,
 * and thrown errors.
 */
export async function buildPreparedProjectPackageGraph(input: {
  readonly context: PreparedPackageProjectBuildContext;
  readonly signal?: AbortSignal;
  readonly workerUrl?: URL;
  readonly session?: GraphProductBuildSession;
}): Promise<PreparedPackageProjectBuildResult> {
  if (
    typeof input.context.projectId !== 'string' ||
    typeof input.context.workspaceId !== 'string' ||
    !PORTABLE_PROJECT_ID.test(input.context.projectId) ||
    !PORTABLE_PROJECT_ID.test(input.context.workspaceId) ||
    !path.isAbsolute(input.context.projectRoot)
  ) {
    throw new Error('Prepared Graph project context is invalid.');
  }
  return runWithOwnedGraphProductBuildSession(input.session, async (session) => {
    const basePorts = createNodeGraphProductHostPorts({
      signal: input.signal,
      workerUrl: input.workerUrl ?? bundledReferenceWorkerUrl(),
      hashedContent: session.hashedContent,
    });
    const identityBytes = new TextEncoder().encode(
      JSON.stringify({ workspaceId: input.context.workspaceId })
    );
    const identityDigest = await basePorts.digest.digest(identityBytes);
    const identityInput = {
      locator: WORKSPACE_IDENTITY_INPUT_LOCATOR,
      mediaType: 'application/json',
      byteLength: identityBytes.byteLength,
      digest: { algorithm: 'sha256' as const, value: identityDigest },
    };
    const identityRenderings = new Map<string, string>();
    const result = await buildRepoGraph({
      root: path.resolve(input.context.projectRoot),
      scope: { kind: 'project', projectIds: [input.context.projectId] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: Object.freeze([
        ...createStandardRepositoryProviders(),
        createScopeContainmentProvider(),
      ]),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: {
        ...basePorts,
        digest: {
          algorithm: 'sha256',
          digest: async (bytes) => {
            const digest = await basePorts.digest.digest(bytes);
            const observation = renderIdentityPreimage(bytes, digest);
            if (observation) identityRenderings.set(...observation);
            return digest;
          },
          digestSync: (bytes) => {
            if (!basePorts.digest.digestSync) {
              throw new Error('Graph digest port must implement synchronous SHA-256.');
            }
            const digest = basePorts.digest.digestSync(bytes);
            const observation = renderIdentityPreimage(bytes, digest);
            if (observation) identityRenderings.set(...observation);
            return digest;
          },
          createStreamingDigest: () => {
            const inner = basePorts.digest.createStreamingDigest?.();
            if (!inner) {
              throw new Error('Graph digest port must implement streaming SHA-256.');
            }
            return inner;
          },
        },
        fileSource: {
          inventory: async (inventoryRequest) => {
            const inventory = await basePorts.fileSource.inventory(inventoryRequest);
            return {
              ...inventory,
              inputs: [...inventory.inputs, identityInput],
            };
          },
          read: async (root, fileInput, options) => {
            if (fileInput.locator === WORKSPACE_IDENTITY_INPUT_LOCATOR) {
              if (fileInput.digest.value !== identityDigest) {
                throw new Error('Host workspace identity digest drifted.');
              }
              return identityBytes;
            }
            return basePorts.fileSource.read(root, fileInput, options);
          },
        },
      },
    });
    const comparison = packageComparisonInput(result, identityRenderings);
    return {
      status: result.status,
      inputFiles: result.metrics.inputFiles,
      omittedFiles: result.metrics.omittedFiles,
      omittedBytes: result.metrics.omittedBytes,
      providerFacts: result.metrics.providerFacts,
      ...(comparison ? { comparison } : {}),
      ...(result.graph
        ? {
            semanticBinding: {
              sourceFixtureDigest: `sha256:${result.graph.generation.inputsDigest.value}`,
              providerProfileDigest: `sha256:${result.graph.generation.providerSetDigest.value}`,
              graphPolicyDigest: `sha256:${result.graph.generation.compositionPolicyDigest.value}`,
            },
          }
        : {}),
    };
  });
}
