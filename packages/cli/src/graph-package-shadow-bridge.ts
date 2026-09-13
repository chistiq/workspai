import path from 'node:path';

import { buildRepoGraph, GRAPH_STANDARD_REPO_BUILD_POLICY } from '@workspai/graph';
import { createNodeGraphProductHostPorts } from '@workspai/graph/adapters/node';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '@workspai/graph/contracts';
import { createStandardRepositoryProviders } from '@workspai/graph/providers';

import type {
  GraphShadowComparisonBinding,
  GraphShadowComparisonPolicy,
  GraphShadowParityReport,
} from './contracts/graph-shadow-parity-contract.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  runGraphShadowComparison,
  type LegacyGraphShadowInput,
  type PackageGraphShadowInput,
} from './graph-shadow-parity.js';

export interface PreparedProjectGraphShadowContext {
  readonly projectId: string;
  readonly projectRoot: string;
}

export interface PreparedProjectGraphShadowRequest {
  readonly context: PreparedProjectGraphShadowContext;
  readonly profile: string;
  readonly binding: GraphShadowComparisonBinding;
  readonly policy?: GraphShadowComparisonPolicy;
  readonly legacy: () => Promise<LegacyGraphShadowInput>;
  readonly package?: () => Promise<PackageGraphShadowInput | undefined>;
  readonly signal?: AbortSignal;
  readonly limits?: typeof GRAPH_SHADOW_DEFAULT_LIMITS;
}

export interface PreparedProjectGraphShadowResult {
  readonly report: GraphShadowParityReport;
  readonly packageExecution: {
    readonly status: 'complete' | 'partial' | 'failed' | 'cancelled' | 'not-executed';
    readonly inputFiles: number;
    readonly providerFacts: number;
    readonly semanticBinding?: {
      readonly sourceFixtureDigest: string;
      readonly providerProfileDigest: string;
      readonly graphPolicyDigest: string;
    };
  };
}

const PORTABLE_PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;

function packageComparisonInput(
  result: {
    readonly graph?: PackageGraphShadowInput['graph'];
    readonly quality: {
      readonly unknownZones: PackageGraphShadowInput['quality']['unknownZones'];
      readonly unsupportedZones: PackageGraphShadowInput['quality']['unsupportedZones'];
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

/**
 * Executes the admitted package against an already prepared project context.
 * The result is comparison evidence only: it never writes package artifacts,
 * changes CLI Graph authority, retries through legacy, or reads process cwd.
 */
export async function runPreparedProjectGraphShadow(
  request: PreparedProjectGraphShadowRequest
): Promise<PreparedProjectGraphShadowResult> {
  let packageExecution: PreparedProjectGraphShadowResult['packageExecution'] = {
    status: 'not-executed',
    inputFiles: 0,
    providerFacts: 0,
  };

  const packagePath = async (): Promise<PackageGraphShadowInput | undefined> => {
    if (
      !PORTABLE_PROJECT_ID.test(request.context.projectId) ||
      !path.isAbsolute(request.context.projectRoot)
    ) {
      throw new Error('Prepared Graph shadow context is invalid.');
    }
    if (request.package) {
      const input = await request.package();
      if (!input?.graph) {
        packageExecution = { status: 'partial', inputFiles: 0, providerFacts: 0 };
        return undefined;
      }
      packageExecution = {
        status: 'complete',
        inputFiles: input.evidenceLocators?.length ?? 1,
        providerFacts: 1,
        semanticBinding: {
          sourceFixtureDigest: `sha256:${input.graph.generation.inputsDigest.value}`,
          providerProfileDigest: `sha256:${input.graph.generation.providerSetDigest.value}`,
          graphPolicyDigest: `sha256:${input.graph.generation.compositionPolicyDigest.value}`,
        },
      };
      return input;
    }
    const basePorts = createNodeGraphProductHostPorts({
      signal: request.signal,
      workerUrl: bundledReferenceWorkerUrl(),
    });
    const identityRenderings = new Map<string, string>();
    const result = await buildRepoGraph({
      root: path.resolve(request.context.projectRoot),
      scope: { kind: 'project', projectIds: [request.context.projectId] },
      ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
      providers: createStandardRepositoryProviders(),
      policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
      ports: {
        ...basePorts,
        digest: {
          algorithm: 'sha256',
          digest: async (input) => {
            const digest = await basePorts.digest.digest(input);
            const observation = renderIdentityPreimage(input, digest);
            if (observation) identityRenderings.set(...observation);
            return digest;
          },
        },
      },
    });
    packageExecution = {
      status: result.status,
      inputFiles: result.metrics.inputFiles,
      providerFacts: result.metrics.providerFacts,
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
    return packageComparisonInput(result, identityRenderings);
  };

  const report = await runGraphShadowComparison({
    profile: request.profile,
    binding: request.binding,
    policy: request.policy,
    limits: request.limits ?? GRAPH_SHADOW_DEFAULT_LIMITS,
    signal: request.signal,
    expectedBinding: {
      scopeDigest: createGraphShadowProjectScopeDigest(request.context.projectId),
      redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
    },
    legacy: request.legacy,
    package: packagePath,
  });
  return { report, packageExecution };
}
