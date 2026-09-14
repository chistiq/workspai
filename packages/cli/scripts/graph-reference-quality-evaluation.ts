/**
 * Read-only G8 reference quality evaluation. Not a published CLI command.
 * Evaluates pinned repository trees in place. Dirty worktrees are reported and
 * evaluated from a detached HEAD worktree so copy-budget truncation is not used.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNodeIncrementalRepoGraph, buildNodeRepoGraph } from '@workspai/graph/adapters/node';

import {
  inventoryOmissionIsResourceTruncation,
  summarizeGraphInventoryOmissions,
} from '../../graph/src/application/classify-inventory-omissions.js';

import { runPreparedProjectGraphShadow } from '../src/graph-package-shadow-bridge.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
} from '../src/graph-shadow-parity.js';
import { buildWorkspaceKnowledgeGraph } from '../src/workspace-knowledge-graph.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../src/contracts/workspace-intelligence-runtime-registry.js';
import { replaceFileAtomically } from '../src/utils/atomic-file-replace.js';
import { hashCanonicalJson } from '../src/workspace-model-hash.js';

const PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;
const FIXED_GENERATED_AT = '2026-09-12T00:00:00.000Z';

function parseArgs(args: readonly string[]): {
  readonly referenceRoot: string;
  readonly projects: readonly string[];
  readonly output?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error('All evaluation arguments must be named.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  const referenceRoot = values.get('--reference-root');
  if (!referenceRoot || !path.isAbsolute(referenceRoot)) {
    throw new Error('--reference-root must be an absolute directory.');
  }
  const projects = (values.get('--projects') ?? 'grpc,opentelemetry-demo,pnpm')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const output = values.get('--output');
  return {
    referenceRoot,
    projects,
    ...(output ? { output } : {}),
  };
}

function git(root: string, gitArgs: readonly string[]): string {
  const result = spawnSync('git', [...gitArgs], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return (result.stdout ?? '').trim();
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function uniqueCodes(codes: readonly string[]): {
  readonly unique: readonly string[];
  readonly total: number;
} {
  return {
    unique: [...new Set(codes)].sort((left, right) => left.localeCompare(right)),
    total: codes.length,
  };
}

function isInventoryOmissionCode(code: string): boolean {
  return (
    code.startsWith('graph.repository-') ||
    code.startsWith('graph.git-') ||
    code.startsWith('GRAPH_FILE_') ||
    code === 'graph.sensitive-input-omitted' ||
    code === 'graph.unicode-locator-collision'
  );
}

type GraphDigestComparison = 'equal' | 'different' | 'not-assessed';

function graphDigestComparison(
  left: Awaited<ReturnType<typeof buildNodeRepoGraph>>,
  right: Awaited<ReturnType<typeof buildNodeRepoGraph>>
): GraphDigestComparison {
  const leftInputs = left.graph?.generation.inputsDigest.value;
  const rightInputs = right.graph?.generation.inputsDigest.value;
  const leftProviders = left.graph?.generation.providerSetDigest.value;
  const rightProviders = right.graph?.generation.providerSetDigest.value;
  if (
    typeof leftInputs !== 'string' ||
    typeof rightInputs !== 'string' ||
    typeof leftProviders !== 'string' ||
    typeof rightProviders !== 'string'
  ) {
    return 'not-assessed';
  }
  return leftInputs === rightInputs && leftProviders === rightProviders ? 'equal' : 'different';
}

function incrementalDigestComparison(
  base: Awaited<ReturnType<typeof buildNodeRepoGraph>>,
  incremental: {
    readonly graph?: {
      readonly generation: {
        readonly inputsDigest: { readonly value?: string };
        readonly providerSetDigest: { readonly value?: string };
      };
    };
  }
): GraphDigestComparison {
  const leftInputs = base.graph?.generation.inputsDigest.value;
  const rightInputs = incremental.graph?.generation.inputsDigest.value;
  const leftProviders = base.graph?.generation.providerSetDigest.value;
  const rightProviders = incremental.graph?.generation.providerSetDigest.value;
  if (
    typeof leftInputs !== 'string' ||
    typeof rightInputs !== 'string' ||
    typeof leftProviders !== 'string' ||
    typeof rightProviders !== 'string'
  ) {
    return 'not-assessed';
  }
  return leftInputs === rightInputs && leftProviders === rightProviders ? 'equal' : 'different';
}

function pinnedCheckout(
  repo: string,
  dirty: boolean
): { readonly root: string; readonly cleanup?: () => void } {
  if (!dirty) return { root: repo };
  const worktree = path.join(os.tmpdir(), `g8-ref-${randomUUID()}`);
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (added.status !== 0) {
    throw new Error('Pinned commit checkout for a dirty reference worktree failed.');
  }
  return {
    root: worktree,
    cleanup: () => {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: repo,
        encoding: 'utf8',
        timeout: 60_000,
      });
      rmSync(worktree, { recursive: true, force: true });
    },
  };
}

async function directionalDelta(project: string, root: string): Promise<unknown> {
  const inventoryDigest = hashCanonicalJson({ id: project, projectId: project });
  const placeholder = {
    sourceFixtureDigest: inventoryDigest.startsWith('sha256:')
      ? inventoryDigest
      : `sha256:${'d'.repeat(64)}`,
    scopeDigest: createGraphShadowProjectScopeDigest(project),
    providerProfileDigest: `sha256:${'d'.repeat(64)}`,
    graphPolicyDigest: `sha256:${'d'.repeat(64)}`,
    redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
    resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
    legacyCli: { version: '0.75.1', commit: 'a'.repeat(40) },
    graphPackage: { version: '0.0.0-development', commit: 'b'.repeat(40) },
  };
  const legacy = async () =>
    buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: { name: project },
      projects: [{ id: project, path: '.', absolutePath: root }],
      projectTopology: {
        schemaVersion: 'workspace-dependency-graph.v1',
        generatedAt: FIXED_GENERATED_AT,
        nodes: [{ id: project, path: '.' }],
        edges: [],
        stats: {
          nodeCount: 1,
          edgeCount: 0,
          inferredEdges: 0,
          contractEdges: 0,
          manualEdges: 0,
          authoritativeEdges: 0,
          lowConfidenceEdges: 0,
          orphanCount: 1,
          connectedNodeCount: 0,
          density: 0,
          edgeCoverageRatio: 0,
          evidenceCoverageRatio: 0,
          hotspotCount: 0,
          hasCycle: false,
        },
      },
      now: new Date(FIXED_GENERATED_AT),
      inventoryFileLimitPerProject: 500_000,
      maxFilesPerProject: 100_000,
      semanticFilesPerProject: 100_000,
      sourceFilesPerProject: 100_000,
      source: {
        kind: 'workspace-model',
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        hashAlgorithm: 'sha256',
        hash: inventoryDigest,
      },
    });
  const request = {
    context: { projectId: project, projectRoot: root, workspaceId: project },
    profile: 'g8-reference-quality.v1',
    binding: placeholder,
    limits: GRAPH_SHADOW_DEFAULT_LIMITS,
    legacy,
  };
  const discovery = await runPreparedProjectGraphShadow(request);
  const semantic = discovery.packageExecution.semanticBinding;
  if (!semantic) {
    return {
      status: 'failed',
      reason: 'partial-package-execution',
      packageExecution: discovery.packageExecution.status,
    };
  }
  const compared = await runPreparedProjectGraphShadow({
    ...request,
    binding: {
      ...placeholder,
      sourceFixtureDigest: semantic.sourceFixtureDigest,
      providerProfileDigest: semantic.providerProfileDigest,
      graphPolicyDigest: semantic.graphPolicyDigest,
    },
  });
  return {
    status: compared.report.status,
    regressions: compared.report.metrics.regressions,
    differenceCodes: [...new Set(compared.report.differences.map((item) => item.code))].sort(),
    falsePositiveSamples: compared.report.differences
      .filter((item) => item.code.endsWith('_PACKAGE_ONLY'))
      .slice(0, 8)
      .map((item) => ({ code: item.code, key: item.key })),
    falseNegativeSamples: compared.report.differences
      .filter((item) => item.code.endsWith('_LEGACY_ONLY'))
      .slice(0, 8)
      .map((item) => ({ code: item.code, key: item.key })),
  };
}

async function evaluateOne(referenceRoot: string, project: string): Promise<unknown> {
  const repo = path.join(referenceRoot, project);
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const porcelain = git(repo, ['status', '--porcelain']);
  const dirty = porcelain.length > 0;
  const checkout = pinnedCheckout(repo, dirty);
  try {
    const started = performance.now();
    const memoryBefore = process.memoryUsage().heapUsed;
    const first = await buildNodeRepoGraph({
      root: checkout.root,
      scope: { kind: 'project', projectIds: [project] },
    });
    const coldMs = Math.round(performance.now() - started);
    const warmStarted = performance.now();
    const second = await buildNodeRepoGraph({
      root: checkout.root,
      scope: { kind: 'project', projectIds: [project] },
    });
    const warmMs = Math.round(performance.now() - warmStarted);
    const third = await buildNodeRepoGraph({
      root: checkout.root,
      scope: { kind: 'project', projectIds: [project] },
    });
    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelled = await buildNodeRepoGraph({
      root: checkout.root,
      scope: { kind: 'project', projectIds: [project] },
      signal: cancelledController.signal,
    });
    const timed = AbortSignal.timeout(1);
    const timedOut = await buildNodeRepoGraph({
      root: checkout.root,
      scope: { kind: 'project', projectIds: [project] },
      signal: timed,
    });
    const omitted = first.metrics.omittedFiles;
    const inventoryCodes = [
      ...first.quality.unknownZones.map((zone) => zone.code),
      ...first.quality.unsupportedZones.map((zone) => zone.code),
    ].filter((code) => isInventoryOmissionCode(code));
    const inventoryOmissionClasses = summarizeGraphInventoryOmissions(inventoryCodes);
    const truncated = inventoryCodes.some((code) => inventoryOmissionIsResourceTruncation(code));
    const unclassifiedOmissions = inventoryOmissionClasses.find(
      (item) => item.class === 'unclassified'
    );
    let directional: unknown = { status: 'not-assessed' };
    try {
      directional = await directionalDelta(project, checkout.root);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'directional-delta-failed';
      directional = {
        status: 'failed',
        reason: 'directional-delta-failed',
        code:
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined,
        message: PATH_LEAK.test(message) ? 'directional-delta-failed' : message,
      };
    }
    let incrementalSkipReread: unknown = {
      assessed: false,
      reason: 'base-generation-unavailable',
    };
    if (first.graph && first.compositionSources) {
      try {
        const incremental = await buildNodeIncrementalRepoGraph({
          root: checkout.root,
          scope: { kind: 'project', projectIds: [project] },
          base: first,
        });
        incrementalSkipReread = {
          assessed: true,
          skipRereadTrusted: incremental.inventoryReread.trust === 'trusted',
          inventoryRereadTrust: incremental.inventoryReread.trust,
          status: incremental.status,
          digestComparison: incrementalDigestComparison(first, incremental),
          digestEqualToBase: incrementalDigestComparison(first, incremental) === 'equal',
          equivalence: incremental.equivalence,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'incremental-failed';
        incrementalSkipReread = {
          assessed: true,
          skipRereadTrusted: false,
          status: 'failed',
          reason: PATH_LEAK.test(message) ? 'incremental-failed' : message,
        };
      }
    }
    return {
      id: project,
      commit: /^[a-f0-9]{40}$/u.test(commit) ? commit : 'unknown',
      clean: !dirty,
      dirtyEntries: dirty ? porcelain.split('\n').length : 0,
      evaluatedFrom: dirty ? 'pinned-commit-worktree' : 'clean-worktree',
      packageExecution: first.status,
      repeatedStatus: second.status,
      unchangedRebuildDigestEqual: graphDigestComparison(first, third) === 'equal',
      unchangedRebuildDigest: graphDigestComparison(first, third),
      incrementalSkipReread,
      deterministicDigest: graphDigestComparison(first, second) === 'equal',
      deterministicDigestComparison: graphDigestComparison(first, second),
      inventory: {
        inputFiles: first.metrics.inputFiles,
        inputBytes: first.metrics.inputBytes,
        omittedFiles: omitted,
        truncated,
        completeness: truncated
          ? 'partial'
          : first.status === 'failed' || first.status === 'cancelled'
            ? first.status
            : 'complete',
        omissionClasses: inventoryOmissionClasses,
        unclassifiedOmissionCount: unclassifiedOmissions?.count ?? 0,
      },
      languages: (first.graph?.nodes ?? []).filter((node) => node.kind === 'language').length,
      runtimes: (first.graph?.nodes ?? []).filter((node) => node.kind === 'runtime').length,
      providers: (first.providers ?? []).map((item) => ({
        id: item.provider.id,
        detection: item.detection,
        collection: item.collection,
        factCount: item.factCount,
      })),
      providerFacts: first.metrics.providerFacts,
      nodeKinds: countBy((first.graph?.nodes ?? []).map((node) => node.kind)),
      relationKinds: countBy((first.graph?.edges ?? []).map((edge) => edge.relation)),
      proofCoverage: countBy((first.graph?.edges ?? []).map((edge) => edge.proof.state)),
      unknownZones: uniqueCodes(first.quality.unknownZones.map((zone) => zone.code)),
      unsupportedZones: uniqueCodes(first.quality.unsupportedZones.map((zone) => zone.code)),
      providerFailures: first.quality.providerFailures.map((item) => item.code).sort(),
      compositionErrors: [
        ...new Set(
          first.diagnostics.filter((item) => item.severity === 'error').map((item) => item.code)
        ),
      ].sort(),
      cancellation: { status: cancelled.status },
      timeout: { status: timedOut.status },
      directionalDelta: directional,
      performance: {
        coldMs,
        warmMs,
        heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
      },
      admitted: false,
    };
  } finally {
    checkout.cleanup?.();
  }
}

export async function runGraphReferenceQualityEvaluation(
  args: readonly string[]
): Promise<{ readonly exitCode: number; readonly payload: unknown }> {
  const options = parseArgs(args);
  const observations = [];
  for (const project of options.projects) {
    observations.push(await evaluateOne(options.referenceRoot, project));
  }
  const payload = {
    schemaVersion: 'workspai.graph-reference-quality.v1-candidate',
    admitted: false,
    currentGraphAuthority: 'official-internal-graph-capability',
    copyBudget: 'not-used-in-place-or-pinned-commit-worktree',
    observations,
  };
  const serialized = JSON.stringify(payload);
  if (PATH_LEAK.test(serialized)) {
    throw new Error('Reference quality report leaked a machine path.');
  }
  if (options.output) {
    await replaceFileAtomically(options.output, `${JSON.stringify(payload, null, 2)}\n`);
  }
  return { payload, exitCode: evaluationExitCode(observations) };
}

export interface GraphReferenceQualityObservation {
  readonly packageExecution?: string;
  readonly compositionErrors?: readonly string[];
  readonly directionalDelta?: { readonly status?: string };
  readonly deterministicDigest?: boolean;
  readonly deterministicDigestComparison?: GraphDigestComparison;
  readonly unchangedRebuildDigestEqual?: boolean;
  readonly unchangedRebuildDigest?: GraphDigestComparison;
  readonly cancellation?: { readonly status?: string };
  readonly timeout?: { readonly status?: string };
  readonly providerFailures?: readonly string[];
  readonly incrementalSkipReread?: {
    readonly assessed?: boolean;
    readonly status?: string;
    readonly digestComparison?: GraphDigestComparison;
    readonly digestEqualToBase?: boolean;
    readonly equivalence?: string;
    readonly inventoryRereadTrust?: string;
  };
  readonly inventory?: {
    readonly truncated?: boolean;
    readonly unclassifiedOmissionCount?: number;
    readonly completeness?: string;
  };
}

function observationFailed(observation: unknown): boolean {
  if (!observation || typeof observation !== 'object') return true;
  const row = observation as GraphReferenceQualityObservation;
  if (row.packageExecution === 'failed' || row.packageExecution === 'cancelled') return true;
  if (Array.isArray(row.compositionErrors) && row.compositionErrors.length > 0) return true;
  if (row.directionalDelta?.status === 'failed') return true;
  if (
    row.deterministicDigestComparison === 'different' ||
    (row.deterministicDigestComparison === undefined && row.deterministicDigest === false)
  ) {
    return true;
  }
  if (
    row.unchangedRebuildDigest === 'different' ||
    (row.unchangedRebuildDigest === undefined && row.unchangedRebuildDigestEqual === false)
  ) {
    return true;
  }
  if (row.cancellation?.status !== 'cancelled') return true;
  if (row.timeout?.status !== 'cancelled') return true;
  if ((row.providerFailures?.length ?? 0) > 0) return true;
  if ((row.inventory?.unclassifiedOmissionCount ?? 0) > 0) return true;
  const incremental = row.incrementalSkipReread;
  if (!incremental || incremental.assessed !== true) return true;
  if (incremental.status === 'failed') return true;
  if (
    incremental.digestComparison === 'different' ||
    (incremental.digestComparison === undefined && incremental.digestEqualToBase === false)
  ) {
    return true;
  }
  if (incremental.equivalence === 'blocked') return true;
  return false;
}

export function evaluationExitCode(observations: readonly unknown[]): number {
  if (observations.some(observationFailed)) return 3;
  const partial = observations.some((observation) => {
    if (!observation || typeof observation !== 'object') return false;
    const row = observation as GraphReferenceQualityObservation;
    return (
      row.packageExecution === 'partial' ||
      row.inventory?.truncated === true ||
      row.deterministicDigestComparison === 'not-assessed' ||
      row.unchangedRebuildDigest === 'not-assessed' ||
      row.incrementalSkipReread?.digestComparison === 'not-assessed'
    );
  });
  if (partial) return 2;
  return 0;
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invoked) {
  runGraphReferenceQualityEvaluation(process.argv.slice(2))
    .then(({ payload, exitCode }) => {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(
        `${JSON.stringify({ schemaVersion: 'workspai.graph-reference-quality-error.v1', error: 'Reference quality evaluation failed before a report could be produced.' })}\n`
      );
      process.exitCode = 4;
    });
}
