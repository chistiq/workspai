import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createNodeGraphProductHostPorts,
  loadNodeBundledGraphNativePort,
} from '../src/adapters/node/index.ts';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  collectGraphSemanticDependencies,
  contentStateLeavesFromProviderInputs,
  summarizeCanonicalGraphDelta,
} from '../src/application/index.ts';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../src/contracts/index.ts';
import { createStandardRepositoryProviders } from '../src/providers/index.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerUrl = pathToFileURL(
  path.join(packageRoot, 'dist', 'adapters', 'node', 'reference-worker-entry.js')
);
const scanProfileDigest = Object.freeze({
  algorithm: 'sha256',
  value: createHash('sha256')
    .update('workspai.graph.reference-incremental-qualification.v1')
    .digest('hex'),
});
const scope = Object.freeze({
  kind: 'project',
  projectIds: Object.freeze(['project:reference-incremental-qualification']),
});

function parseArguments(argv) {
  const rootIndex = argv.indexOf('--root');
  const outputIndex = argv.indexOf('--output');
  if (rootIndex < 0 || !argv[rootIndex + 1] || outputIndex < 0 || !argv[outputIndex + 1]) {
    throw new Error('Usage: qualify-incremental-repository --root <path> --output <path>');
  }
  return {
    root: path.resolve(argv[rootIndex + 1]),
    output: path.resolve(argv[outputIndex + 1]),
  };
}

function providers() {
  return createStandardRepositoryProviders({ loadNative: loadNodeBundledGraphNativePort });
}

function ports(journal) {
  return {
    ...createNodeGraphProductHostPorts({ workerUrl }),
    ...(journal
      ? {
          changeJournal: {
            inspect: async () =>
              Object.freeze({
                trust: 'trusted',
                source: 'change-journal',
                records: Object.freeze(journal.map((record) => Object.freeze(record))),
                diagnostics: Object.freeze([]),
              }),
          },
        }
      : {}),
  };
}

async function fullBuild(root) {
  return buildRepoGraph({
    root,
    scope,
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: providers(),
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports: ports(),
  });
}

async function inventory(root, hostPorts) {
  return hostPorts.fileSource.inventory({
    root,
    maxFiles: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxFiles,
    maxTotalBytes: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxTotalBytes,
    maxFileBytes: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxFileBytes,
    maxDepth: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxDepth,
    maxDirectoryEntries: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxDirectoryEntries,
    excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
    sensitiveFiles: GRAPH_STANDARD_REPO_BUILD_POLICY.sensitiveFiles,
  });
}

async function findMutationTargets(root) {
  const candidates = [
    'src/react-native-app/utils/Localhost.ts',
    'src/frontend/utils/Request.ts',
    'src/checkout/money/money.go',
  ];
  for (const locator of candidates) {
    try {
      await fs.access(path.join(root, locator));
      return { source: locator, config: 'package.json' };
    } catch {
      // Try the next deterministic candidate.
    }
  }
  throw new Error('No admitted mutation target was found.');
}

async function applyMutation(root, scenario, targets) {
  const source = path.join(root, targets.source);
  if (scenario === 'edit') {
    await fs.appendFile(source, '\nexport const graphQualificationEdit = (): boolean => true;\n');
    return [{ locator: targets.source, kind: 'changed' }];
  }
  if (scenario === 'add') {
    const locator = path.posix.join(
      path.posix.dirname(targets.source),
      'graph-qualification-added.ts'
    );
    await fs.writeFile(
      path.join(root, locator),
      'export function graphQualificationAdded(): string { return "added"; }\n'
    );
    return [{ locator, kind: 'added' }];
  }
  if (scenario === 'delete') {
    await fs.rm(source);
    return [{ locator: targets.source, kind: 'deleted' }];
  }
  if (scenario === 'rename') {
    const locator = path.posix.join(
      path.posix.dirname(targets.source),
      `graph-qualification-renamed${path.posix.extname(targets.source)}`
    );
    await fs.rename(source, path.join(root, locator));
    return [{ locator, priorLocator: targets.source, kind: 'renamed' }];
  }
  const config = path.join(root, targets.config);
  const parsed = JSON.parse(await fs.readFile(config, 'utf8'));
  parsed.graphQualification = true;
  await fs.writeFile(config, `${JSON.stringify(parsed, null, 2)}\n`);
  return [{ locator: targets.config, kind: 'changed' }];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const targets = await findMutationTargets(options.root);
  const baseStarted = performance.now();
  const base = await fullBuild(options.root);
  if (!base.graph || !base.compositionSources) throw new Error('Base graph build failed.');
  const baseMs = Math.round(performance.now() - baseStarted);
  const basePorts = ports();
  const baseInventory = await inventory(options.root, basePorts);
  if (baseInventory.status === 'failed' || baseInventory.status === 'cancelled') {
    throw new Error(`Base inventory failed: ${baseInventory.status}`);
  }
  const providerSet = providers();
  const stamps = await collectGraphSemanticDependencies({
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    compositionPolicy: GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
    redactionProfile: GRAPH_STANDARD_REPO_BUILD_POLICY.redactionProfile,
    providerManifests: providerSet.map((provider) => provider.manifest),
    digest: basePorts.digest,
  });
  const baseManifest = buildContentStateManifest({
    scope,
    generatedAt: base.graph.generation.reference.generatedAt,
    scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(baseInventory.inputs, scanProfileDigest),
    shardDependencies: buildShardDependenciesFromSources(base.compositionSources, stamps),
  });

  const observations = [];
  for (const scenario of ['edit', 'add', 'delete', 'rename', 'config']) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `workspai-graph-${scenario}-`));
    try {
      await fs.cp(options.root, temporary, { recursive: true });
      const journal = await applyMutation(temporary, scenario, targets);
      const referenceStarted = performance.now();
      const reference = await fullBuild(temporary);
      const referenceMs = Math.round(performance.now() - referenceStarted);
      if (!reference.graph) throw new Error(`${scenario}: reference build failed.`);
      const incrementalStarted = performance.now();
      const incremental = await buildIncrementalRepoGraph({
        root: temporary,
        scope,
        ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
        providers: providerSet,
        policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
        ports: ports(journal),
        baseManifest,
        baseGeneration: base.graph.generation.reference.id,
        targetGeneration: `${base.graph.generation.reference.id}:${scenario}`,
        baseSources: base.compositionSources,
        providersToRecompute: [],
        scanProfileDigest,
        referenceGenerationDigest: reference.graph.generation.reference.contentDigest,
        baseGraph: base.graph,
      });
      const incrementalMs = Math.round(performance.now() - incrementalStarted);
      const parityDelta = incremental.graph
        ? summarizeCanonicalGraphDelta(reference.graph, incremental.graph)
        : undefined;
      observations.push({
        scenario,
        journal,
        referenceMs,
        incrementalMs,
        speedup: referenceMs / Math.max(1, incrementalMs),
        status: incremental.status,
        equivalence: incremental.equivalence,
        digestMatch:
          incremental.graph?.generation.reference.contentDigest.value ===
          reference.graph.generation.reference.contentDigest.value,
        referenceDigest: reference.graph.generation.reference.contentDigest.value,
        incrementalDigest: incremental.graph?.generation.reference.contentDigest.value,
        inventoryTrust: incremental.inventoryReread.trust,
        affectedProviders: incremental.plan.delta.affectedProviders,
        changedInputs: incremental.plan.delta.changedInputs,
        parityDelta: parityDelta
          ? {
              graph: Object.fromEntries(
                Object.entries(parityDelta.graph).map(([key, values]) => [key, values.length])
              ),
              facts: Object.fromEntries(
                Object.entries(parityDelta.facts).map(([key, values]) => [key, values.length])
              ),
            }
          : undefined,
        accounting: incremental.plan.accounting,
      });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  const report = {
    schemaVersion: 'workspai.graph.reference-incremental-qualification.v1',
    rootRevision: await fs.readFile(path.join(options.root, '.git', 'HEAD'), 'utf8'),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    base: {
      status: base.status,
      durationMs: baseMs,
      files: base.metrics.inputFiles,
      nodes: base.graph.nodes.length,
      edges: base.graph.edges.length,
      digest: base.graph.generation.reference.contentDigest.value,
    },
    targets,
    observations,
  };
  await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (observations.some((item) => item.equivalence !== 'pass' || !item.digestMatch)) {
    process.exitCode = 1;
  }
}

await main();
