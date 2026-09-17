export { createNodeGraphProductHostPorts } from './graph-package-runtime.js';

import type {
  GraphShadowComparisonBinding,
  GraphShadowComparisonPolicy,
  GraphShadowParityReport,
} from './contracts/graph-shadow-parity-contract.js';
import { buildPreparedProjectPackageGraph } from './graph-package-project-build.js';
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
  readonly workspaceId: string;
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
    readonly omittedFiles: number;
    readonly omittedBytes: number;
    readonly providerFacts: number;
    readonly workspaceId: string;
    readonly semanticBinding?: {
      readonly sourceFixtureDigest: string;
      readonly providerProfileDigest: string;
      readonly graphPolicyDigest: string;
    };
  };
}

function bundledReferenceWorkerUrl(): URL | undefined {
  return import.meta.url.endsWith('/dist/internal/graph-package-shadow-bridge.js')
    ? new URL('./graph-reference-worker-entry.js', import.meta.url)
    : undefined;
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
    omittedFiles: 0,
    omittedBytes: 0,
    providerFacts: 0,
    workspaceId: request.context.workspaceId,
  };

  const packagePath = async (): Promise<PackageGraphShadowInput | undefined> => {
    if (request.package) {
      const input = await request.package();
      if (!input?.graph) {
        packageExecution = {
          status: 'partial',
          inputFiles: 0,
          omittedFiles: 0,
          omittedBytes: 0,
          providerFacts: 0,
          workspaceId: request.context.workspaceId,
        };
        return undefined;
      }
      packageExecution = {
        status: 'complete',
        inputFiles: input.evidenceLocators?.length ?? 1,
        omittedFiles: 0,
        omittedBytes: 0,
        providerFacts: 1,
        workspaceId: request.context.workspaceId,
        semanticBinding: {
          sourceFixtureDigest: `sha256:${input.graph.generation.inputsDigest.value}`,
          providerProfileDigest: `sha256:${input.graph.generation.providerSetDigest.value}`,
          graphPolicyDigest: `sha256:${input.graph.generation.compositionPolicyDigest.value}`,
        },
      };
      return input;
    }
    const built = await buildPreparedProjectPackageGraph({
      context: request.context,
      signal: request.signal,
      workerUrl: bundledReferenceWorkerUrl(),
    });
    packageExecution = {
      status: built.status,
      inputFiles: built.inputFiles,
      omittedFiles: built.omittedFiles,
      omittedBytes: built.omittedBytes,
      providerFacts: built.providerFacts,
      workspaceId: request.context.workspaceId,
      ...(built.semanticBinding ? { semanticBinding: built.semanticBinding } : {}),
    };
    return built.comparison;
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
