import path from 'node:path';

import { buildRepoGraph, GRAPH_STANDARD_REPO_BUILD_POLICY } from '@workspai/graph';
import { createNodeGraphProductHostPorts } from '@workspai/graph/adapters/node';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '@workspai/graph/contracts';
import {
  WORKSPACE_IDENTITY_INPUT_LOCATOR,
  createScopeContainmentProvider,
  createStandardRepositoryProviders,
} from '@workspai/graph/providers';

import type { PackageGraphShadowInput } from './graph-shadow-parity.js';

export interface PreparedPackageProjectBuildContext {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly workspaceId: string;
}

export interface PreparedPackageProjectBuildResult {
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly inputFiles: number;
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
 */
export async function buildPreparedProjectPackageGraph(input: {
  readonly context: PreparedPackageProjectBuildContext;
  readonly signal?: AbortSignal;
  readonly workerUrl?: URL;
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
  const basePorts = createNodeGraphProductHostPorts({
    signal: input.signal,
    workerUrl: input.workerUrl ?? bundledReferenceWorkerUrl(),
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
}
