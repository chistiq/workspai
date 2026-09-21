/**
 * Isolated-process Graph producer benchmark. Not a published CLI command.
 * Package and legacy producers run in separate child processes. Incremental
 * samples use a clean pinned-commit worktree, reject untrusted or inequivalent
 * runs, and never admit dirty in-place checkouts. Filesystem page cache is not
 * controlled (`filesystemCold: not-controlled`). Output never includes host paths.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  buildNodeIncrementalRepoGraph,
  buildNodeRepoGraph,
  createGraphProductBuildSession,
} from '@workspai/graph/adapters/node';

import {
  GRAPH_PRODUCER_BENCHMARK_SCHEMA,
  GRAPH_REFERENCE_CORPUS_PROTOCOL,
  applyIncrementalMutation,
  createCopiedEvaluationTree,
  createPinnedCommitWorktree,
  implementationSourceDigest,
  prepareIncrementalBase,
  resetPinnedWorktree,
  type GraphBenchmarkIncrementalKind,
} from '../src/graph-producer-benchmark-support.js';
import { buildWorkspaceKnowledgeGraph } from '../src/workspace-knowledge-graph.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../src/contracts/workspace-intelligence-runtime-registry.js';
import { hashCanonicalJson } from '../src/workspace-model-hash.js';

const PATH_LEAK = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\\\\)/u;
const FIXED_GENERATED_AT = '2026-09-12T00:00:00.000Z';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INCREMENTAL_KINDS = [
  'no-change',
  'one-file-edit',
  'file-create',
  'file-delete',
  'module-invalidation',
  'framework-binding',
  'configuration-change',
] as const satisfies readonly GraphBenchmarkIncrementalKind[];

function parseArgs(args: readonly string[]): {
  readonly referenceRoot?: string;
  readonly projects: readonly string[];
  readonly iterations: number;
  readonly includeCommitted: boolean;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error('All benchmark arguments must be named.');
    if (key === '--include-committed') {
      values.set(key, 'true');
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  const referenceRoot = values.get('--reference-root');
  if (referenceRoot && !path.isAbsolute(referenceRoot)) {
    throw new Error('--reference-root must be an absolute directory.');
  }
  const projects = (values.get('--projects') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const iterations = Number.parseInt(values.get('--iterations') ?? '5', 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error('--iterations must be an integer from 1 to 20.');
  }
  return {
    ...(referenceRoot ? { referenceRoot } : {}),
    projects,
    iterations,
    includeCommitted: values.get('--include-committed') === 'true' || projects.length === 0,
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

function peakRssBytes(): number {
  return process.resourceUsage().maxRSS * 1024;
}

function portableProjectId(id: string): string {
  return (
    id
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 128) || 'project'
  );
}

function topology(projectId: string) {
  return {
    schemaVersion: 'workspace-dependency-graph.v1' as const,
    generatedAt: FIXED_GENERATED_AT,
    nodes: [{ id: projectId, path: '.' }],
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
  };
}

type ChildFullMode =
  | 'package-process-cold-full'
  | 'package-process-warm-full'
  | 'legacy-process-cold-full'
  | 'legacy-process-warm-full';

interface ChildRequest {
  readonly mode: ChildFullMode | 'package-incremental';
  readonly root: string;
  readonly projectId: string;
  readonly incrementalKind?: GraphBenchmarkIncrementalKind;
}

interface ChildResult {
  readonly mode: ChildRequest['mode'];
  readonly wallMs: number;
  readonly processStartupMs: number;
  readonly processLifetimeMs?: number;
  readonly peakRssBytes: number;
  readonly providerMs?: number;
  readonly compositionMs?: number;
  readonly factCanonicalizationMs?: number;
  readonly graphIndexConstructionMs?: number;
  readonly contentDigestMs?: number;
  readonly inventoryMs?: number;
  readonly inputFiles?: number;
  readonly inputBytes?: number;
  readonly providerFacts?: number;
  readonly hashedFiles?: number;
  readonly enumeratedFiles?: number;
  readonly filesRead?: number;
  readonly filesParsed?: number;
  readonly filesExtracted?: number;
  readonly cacheHits?: number;
  readonly cacheMisses?: number;
  readonly phaseTimings?: readonly {
    readonly phase: string;
    readonly wallMs: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
  }[];
  readonly digest?: string;
  readonly incrementalTrust?: string;
  readonly digestEqualToCurrentTree?: boolean;
  readonly equivalence?: string;
  readonly snapshotConsistency?: string;
  readonly executionPath?: string;
  readonly admitted?: boolean;
  readonly rejection?: string;
  readonly incrementalKind?: GraphBenchmarkIncrementalKind;
}

function summarizePhases(metrics: {
  readonly durationMs?: number;
  readonly providerMs?: number;
  readonly compositionMs?: number;
  readonly inventoryMs?: number;
  readonly inputBytes?: number;
  readonly providerFacts?: number;
  readonly hashedFiles?: number;
  readonly enumeratedFiles?: number;
  readonly filesRead?: number;
  readonly filesParsed?: number;
  readonly filesExtracted?: number;
  readonly cacheHits?: number;
  readonly cacheMisses?: number;
  readonly compositionTimings?: {
    readonly semanticDigestMs: number;
    readonly edgeProofMs: number;
    readonly contentDigestMs: number;
  };
  readonly phaseTimings?: readonly {
    readonly phase: string;
    readonly wallMs: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
  }[];
}): Partial<ChildResult> {
  const factCanonicalizationMs =
    metrics.compositionTimings?.semanticDigestMs ??
    metrics.phaseTimings?.find((timing) => timing.phase === 'factCanonicalization')?.wallMs;
  const graphIndexConstructionMs =
    metrics.compositionTimings?.edgeProofMs ??
    metrics.phaseTimings?.find((timing) => timing.phase === 'graphIndexConstruction')?.wallMs;
  const contentDigestMs =
    metrics.compositionTimings?.contentDigestMs ??
    metrics.phaseTimings?.find((timing) => timing.phase === 'contentDigest')?.wallMs;
  return {
    ...(typeof metrics.providerMs === 'number' ? { providerMs: metrics.providerMs } : {}),
    ...(typeof metrics.compositionMs === 'number' ? { compositionMs: metrics.compositionMs } : {}),
    ...(typeof factCanonicalizationMs === 'number' ? { factCanonicalizationMs } : {}),
    ...(typeof graphIndexConstructionMs === 'number' ? { graphIndexConstructionMs } : {}),
    ...(typeof contentDigestMs === 'number' ? { contentDigestMs } : {}),
    ...(typeof metrics.inventoryMs === 'number' ? { inventoryMs: metrics.inventoryMs } : {}),
    ...(typeof metrics.inputBytes === 'number' ? { inputBytes: metrics.inputBytes } : {}),
    ...(typeof metrics.providerFacts === 'number' ? { providerFacts: metrics.providerFacts } : {}),
    ...(typeof metrics.hashedFiles === 'number' ? { hashedFiles: metrics.hashedFiles } : {}),
    ...(typeof metrics.enumeratedFiles === 'number'
      ? { enumeratedFiles: metrics.enumeratedFiles }
      : {}),
    ...(typeof metrics.filesRead === 'number' ? { filesRead: metrics.filesRead } : {}),
    ...(typeof metrics.filesParsed === 'number' ? { filesParsed: metrics.filesParsed } : {}),
    ...(typeof metrics.filesExtracted === 'number'
      ? { filesExtracted: metrics.filesExtracted }
      : {}),
    ...(typeof metrics.cacheHits === 'number' ? { cacheHits: metrics.cacheHits } : {}),
    ...(typeof metrics.cacheMisses === 'number' ? { cacheMisses: metrics.cacheMisses } : {}),
    ...(metrics.phaseTimings
      ? {
          phaseTimings: metrics.phaseTimings.map((timing) => ({
            phase: timing.phase,
            wallMs: timing.wallMs,
            cacheHits: timing.cacheHits,
            cacheMisses: timing.cacheMisses,
          })),
        }
      : {}),
  };
}

async function runChild(request: ChildRequest): Promise<ChildResult> {
  const startedAt = performance.now();
  const processStartupMs = Math.round(startedAt);
  if (
    request.mode === 'package-process-cold-full' ||
    request.mode === 'package-process-warm-full'
  ) {
    if (request.mode === 'package-process-warm-full') {
      const session = createGraphProductBuildSession();
      try {
        await buildNodeRepoGraph({
          root: request.root,
          scope: { kind: 'project', projectIds: [request.projectId] },
          session,
        });
        const timedStart = performance.now();
        const result = await buildNodeRepoGraph({
          root: request.root,
          scope: { kind: 'project', projectIds: [request.projectId] },
          session,
        });
        const wallMs = Math.round(performance.now() - timedStart);
        const graphJson = result.graph ? JSON.stringify(result.graph) : '';
        if (PATH_LEAK.test(graphJson)) throw new Error('Package graph contained a host path.');
        return {
          mode: request.mode,
          wallMs,
          processStartupMs,
          peakRssBytes: peakRssBytes(),
          ...summarizePhases(result.metrics),
          inputFiles: result.metrics.inputFiles,
          digest: result.graph?.generation.reference.contentDigest.value,
        };
      } finally {
        session.dispose();
      }
    }
    const timedStart = performance.now();
    const result = await buildNodeRepoGraph({
      root: request.root,
      scope: { kind: 'project', projectIds: [request.projectId] },
    });
    const wallMs = Math.round(performance.now() - timedStart);
    const graphJson = result.graph ? JSON.stringify(result.graph) : '';
    if (PATH_LEAK.test(graphJson)) throw new Error('Package graph contained a host path.');
    return {
      mode: request.mode,
      wallMs,
      processStartupMs,
      peakRssBytes: peakRssBytes(),
      ...summarizePhases(result.metrics),
      inputFiles: result.metrics.inputFiles,
      digest: result.graph?.generation.reference.contentDigest.value,
    };
  }
  if (request.mode === 'package-incremental') {
    const kind = request.incrementalKind ?? 'no-change';
    await prepareIncrementalBase(request.root, kind);
    const hostSession = createGraphProductBuildSession();
    const referenceSession = createGraphProductBuildSession();
    try {
      const base = await buildNodeRepoGraph({
        root: request.root,
        scope: { kind: 'project', projectIds: [request.projectId] },
        session: hostSession,
      });
      if (!base.graph || !base.compositionSources || !base.admittedInputs) {
        return {
          mode: request.mode,
          wallMs: 0,
          processStartupMs,
          peakRssBytes: peakRssBytes(),
          admitted: false,
          rejection: 'incomplete-base',
          incrementalKind: kind,
        };
      }
      await applyIncrementalMutation(request.root, kind);
      const current = await buildNodeRepoGraph({
        root: request.root,
        scope: { kind: 'project', projectIds: [request.projectId] },
        session: referenceSession,
      });
      const timedStart = performance.now();
      const incremental = await buildNodeIncrementalRepoGraph({
        root: request.root,
        scope: { kind: 'project', projectIds: [request.projectId] },
        base,
        currentTreeReferenceDigest: current.graph?.generation.reference.contentDigest,
        session: hostSession,
      });
      const wallMs = Math.round(performance.now() - timedStart);
      const digestEqual =
        incremental.graph?.generation.reference.contentDigest.value ===
        current.graph?.generation.reference.contentDigest.value;
      const admitted =
        incremental.inventoryReread.trust === 'trusted' &&
        incremental.equivalence === 'pass' &&
        digestEqual === true &&
        incremental.snapshotConsistency !== 'unstable';
      return {
        mode: request.mode,
        wallMs,
        processStartupMs,
        peakRssBytes: peakRssBytes(),
        ...summarizePhases(incremental.metrics),
        digest: incremental.graph?.generation.reference.contentDigest.value,
        incrementalTrust: incremental.inventoryReread.trust,
        digestEqualToCurrentTree: digestEqual,
        equivalence: incremental.equivalence,
        snapshotConsistency: incremental.snapshotConsistency,
        executionPath: incremental.executionPath,
        admitted,
        ...(admitted
          ? {}
          : {
              rejection: [
                incremental.inventoryReread.trust !== 'trusted' ? 'untrusted' : undefined,
                incremental.equivalence !== 'pass' ? 'equivalence' : undefined,
                digestEqual ? undefined : 'digest',
                incremental.snapshotConsistency === 'unstable' ? 'snapshot' : undefined,
              ]
                .filter((item): item is string => item !== undefined)
                .join(','),
            }),
        incrementalKind: kind,
      };
    } finally {
      hostSession.dispose();
      referenceSession.dispose();
    }
  }
  const inventoryDigest = hashCanonicalJson({
    id: request.projectId,
    projectId: request.projectId,
  });
  const runLegacy = () =>
    buildWorkspaceKnowledgeGraph({
      workspacePath: request.root,
      workspace: { name: request.projectId },
      projects: [{ id: request.projectId, path: '.', absolutePath: request.root }],
      projectTopology: topology(request.projectId),
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
  if (request.mode === 'legacy-process-warm-full') await runLegacy();
  const timedStart = performance.now();
  await runLegacy();
  return {
    mode: request.mode,
    wallMs: Math.round(performance.now() - timedStart),
    processStartupMs,
    peakRssBytes: peakRssBytes(),
  };
}

function spawnChild(request: ChildRequest): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const spawnedAt = performance.now();
    const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT_PATH, '--child'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WORKSPAI_GRAPH_BENCH_CHILD: '1' },
    });
    const stdout: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Isolated benchmark child failed.'));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString('utf8')) as ChildResult;
        const withLifetime = {
          ...parsed,
          processLifetimeMs: Math.round(performance.now() - spawnedAt),
        };
        if (PATH_LEAK.test(JSON.stringify(withLifetime))) {
          reject(new Error('Isolated benchmark child leaked a host path.'));
          return;
        }
        resolve(withLifetime);
      } catch {
        reject(new Error('Isolated benchmark child returned invalid output.'));
      }
    });
    child.stdin?.end(JSON.stringify({ ...request, root: request.root }));
  });
}

function summarize(
  samples: readonly ChildResult[],
  field: 'wallMs' | 'processLifetimeMs' = 'wallMs'
): {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly peakRssMb: number;
  readonly admittedSamples: number;
  readonly rejectedSamples: number;
  readonly last?: ChildResult;
} {
  const values = samples.map((sample) =>
    field === 'processLifetimeMs' ? (sample.processLifetimeMs ?? sample.wallMs) : sample.wallMs
  );
  if (values.length === 0) {
    return {
      p50Ms: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
      peakRssMb: 0,
      admittedSamples: 0,
      rejectedSamples: 0,
    };
  }
  return {
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    peakRssMb: Math.round(
      Math.max(...samples.map((sample) => sample.peakRssBytes)) / (1024 * 1024)
    ),
    admittedSamples: samples.length,
    rejectedSamples: 0,
    last: samples[samples.length - 1],
  };
}

function sourceCommit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
    encoding: 'utf8',
    timeout: 5_000,
  });
  const sha = (result.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/u.test(sha) ? sha : 'unspecified';
}

function timingBlock(
  summary: ReturnType<typeof summarize>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    minMs: summary.minMs,
    maxMs: summary.maxMs,
    peakRssMb: summary.peakRssMb,
    admittedSamples: summary.admittedSamples,
    rejectedSamples: summary.rejectedSamples,
    ...extra,
  };
}

async function measureOne(input: {
  readonly id: string;
  readonly root: string;
  readonly iterations: number;
  readonly pin: boolean;
}): Promise<unknown> {
  const projectId = portableProjectId(input.id);
  const corpusDigest = createHash('sha256').update(projectId).digest('hex');
  const pin = input.pin
    ? await createPinnedCommitWorktree(input.root)
    : await createCopiedEvaluationTree(input.root);
  const root = pin.root;
  const reset = async () => {
    if (pin.kind === 'copied-fixture') await pin.reset();
    else await resetPinnedWorktree(root);
  };
  try {
    const packageCold: ChildResult[] = [];
    const packageWarm: ChildResult[] = [];
    const legacyCold: ChildResult[] = [];
    const legacyWarm: ChildResult[] = [];
    const incremental = new Map<GraphBenchmarkIncrementalKind, ChildResult[]>();
    const incrementalRejected = new Map<GraphBenchmarkIncrementalKind, number>();
    const incrementalRejection = new Map<GraphBenchmarkIncrementalKind, string>();
    for (const kind of INCREMENTAL_KINDS) {
      incremental.set(kind, []);
      incrementalRejected.set(kind, 0);
    }
    for (let index = 0; index < input.iterations; index += 1) {
      await reset();
      const packageFirst = index % 2 === 0;
      const packageModes = ['package-process-cold-full', 'package-process-warm-full'] as const;
      const legacyModes = ['legacy-process-cold-full', 'legacy-process-warm-full'] as const;
      const order = packageFirst
        ? [...packageModes, ...legacyModes]
        : [...legacyModes, ...packageModes];
      for (const mode of order) {
        await reset();
        const sample = await spawnChild({ mode, root, projectId });
        if (mode === 'package-process-cold-full') packageCold.push(sample);
        if (mode === 'package-process-warm-full') packageWarm.push(sample);
        if (mode === 'legacy-process-cold-full') legacyCold.push(sample);
        if (mode === 'legacy-process-warm-full') legacyWarm.push(sample);
      }
      for (const kind of INCREMENTAL_KINDS) {
        await reset();
        const sample = await spawnChild({
          mode: 'package-incremental',
          root,
          projectId,
          incrementalKind: kind,
        });
        if (sample.admitted === false) {
          incrementalRejected.set(kind, (incrementalRejected.get(kind) ?? 0) + 1);
          incrementalRejection.set(kind, sample.rejection ?? sample.incrementalTrust ?? 'rejected');
          continue;
        }
        incremental.get(kind)?.push(sample);
      }
    }
    const packageColdSummary = summarize(packageCold, 'processLifetimeMs');
    const packageColdBuild = summarize(packageCold, 'wallMs');
    const packageWarmSummary = summarize(packageWarm, 'wallMs');
    const legacyColdSummary = summarize(legacyCold, 'processLifetimeMs');
    const legacyColdBuild = summarize(legacyCold, 'wallMs');
    const legacyWarmSummary = summarize(legacyWarm, 'wallMs');
    const lastPackage = packageWarmSummary.last ?? packageColdSummary.last;
    const incrementalReport = Object.fromEntries(
      INCREMENTAL_KINDS.map((kind) => {
        const admitted = incremental.get(kind) ?? [];
        const rejected = incrementalRejected.get(kind) ?? 0;
        const summary = summarize(admitted, 'wallMs');
        return [
          kind,
          {
            ...timingBlock(summary, {
              rejectedSamples: rejected,
              lastRejection: incrementalRejection.get(kind),
              inventoryRereadTrust: summary.last?.incrementalTrust,
              digestEqualToCurrentTree: summary.last?.digestEqualToCurrentTree === true,
              equivalence: summary.last?.equivalence,
              snapshotConsistency: summary.last?.snapshotConsistency,
              executionPath: summary.last?.executionPath,
              timing: 'incremental-after-untimed-base-and-current-full',
              peakRssIncludesWarmup: true,
              claim:
                admitted.length >= 5
                  ? 'trusted-pinned-worktree'
                  : 'insufficient-admitted-samples-no-performance-claim',
            }),
          },
        ];
      })
    );
    return {
      id: input.id,
      corpusDigest,
      evaluatedFrom: pin.kind,
      commit: pin.commit,
      sourceDirty: pin.dirty,
      dirtyCount: pin.dirtyCount,
      filesystemCold: 'not-controlled',
      claim:
        input.iterations >= 5
          ? 'isolated-process-p50-p95'
          : 'insufficient-iterations-no-performance-claim',
      package: {
        processCold: {
          ...timingBlock(packageColdSummary, {
            buildCallP50Ms: packageColdBuild.p50Ms,
            buildCallP95Ms: packageColdBuild.p95Ms,
            timing: 'spawn-to-exit',
          }),
        },
        processWarm: {
          ...timingBlock(packageWarmSummary, {
            timing: 'build-call-after-warmup',
            peakRssIncludesWarmup: true,
          }),
        },
        incremental: incrementalReport,
        inputFiles: lastPackage?.inputFiles,
        inputBytes: lastPackage?.inputBytes,
        providerFacts: lastPackage?.providerFacts,
        hashedFiles: lastPackage?.hashedFiles,
        enumeratedFiles: lastPackage?.enumeratedFiles,
        filesRead: lastPackage?.filesRead,
        filesParsed: lastPackage?.filesParsed,
        filesExtracted: lastPackage?.filesExtracted,
        cacheHits: lastPackage?.cacheHits,
        cacheMisses: lastPackage?.cacheMisses,
        providerMs: lastPackage?.providerMs,
        compositionMs: lastPackage?.compositionMs,
        factCanonicalizationMs: lastPackage?.factCanonicalizationMs,
        graphIndexConstructionMs: lastPackage?.graphIndexConstructionMs,
        contentDigestMs: lastPackage?.contentDigestMs,
        inventoryMs: lastPackage?.inventoryMs,
        phaseTimings: lastPackage?.phaseTimings,
      },
      legacy: {
        processCold: {
          ...timingBlock(legacyColdSummary, {
            buildCallP50Ms: legacyColdBuild.p50Ms,
            buildCallP95Ms: legacyColdBuild.p95Ms,
            timing: 'spawn-to-exit',
          }),
        },
        processWarm: {
          ...timingBlock(legacyWarmSummary, {
            timing: 'build-call-after-warmup',
            peakRssIncludesWarmup: true,
          }),
        },
      },
      ratio: {
        processWarmP95PackageOverLegacy:
          legacyWarmSummary.p95Ms === 0
            ? null
            : Math.round((packageWarmSummary.p95Ms / legacyWarmSummary.p95Ms) * 100) / 100,
      },
    };
  } finally {
    await pin.cleanup();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--child')) {
    const request = JSON.parse(await readStdin()) as ChildRequest;
    const result = await runChild(request);
    const payload = JSON.stringify(result);
    if (PATH_LEAK.test(payload)) throw new Error('Child output contained a host path.');
    process.stdout.write(`${payload}\n`);
    return;
  }
  const args = parseArgs(process.argv.filter((value) => value !== '--child').slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const implementation = implementationSourceDigest(repoRoot);
  const corpora: { readonly id: string; readonly root: string; readonly pin: boolean }[] = [];
  if (args.includeCommitted) {
    corpora.push({
      id: 'committed-node-service',
      root: path.join(repoRoot, 'packages/cli/test-data/graph-shadow/real-workspace-corpus.v1'),
      pin: false,
    });
  }
  if (args.referenceRoot) {
    for (const project of args.projects) {
      corpora.push({ id: project, root: path.join(args.referenceRoot, project), pin: true });
    }
  }
  const results = [];
  for (const corpus of corpora) {
    results.push(await measureOne({ ...corpus, iterations: args.iterations }));
  }
  const payload = JSON.stringify(
    {
      schemaVersion: GRAPH_PRODUCER_BENCHMARK_SCHEMA,
      iterations: args.iterations,
      node: process.version,
      os: process.platform,
      arch: process.arch,
      sourceCommit: sourceCommit(),
      implementationDigest: implementation.workingTreeDigest,
      implementationHead: implementation.head,
      isolation: 'child-process',
      filesystemCold: 'not-controlled',
      installedCli: 'not-measured',
      corpusProtocol: GRAPH_REFERENCE_CORPUS_PROTOCOL,
      timingNotes: {
        processCold:
          'spawn-to-exit includes Node start, --import tsx, module evaluation, the build, and the child JSON serialization/stdout write',
        processWarm:
          'build-call after untimed warmup in the same process; peak RSS includes warmup',
        incremental:
          'trusted incremental on a pinned-commit worktree; independent current-tree full build uses a separate fact-cache session and is outside the timed window; untrusted or inequivalent samples are rejected',
      },
      results,
    },
    null,
    2
  );
  if (PATH_LEAK.test(payload)) {
    throw new Error('Benchmark output contained a host path.');
  }
  process.stdout.write(`${payload}\n`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

await main();
