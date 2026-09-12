import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryGraph } from '../dist/index.js';
import { GRAPH_RETRIEVAL_BENCHMARK_CLAIM } from '../dist/contracts/index.js';
import { scoreGraphRetrievalBenchmark } from '../dist/testing/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(packageRoot, 'fixtures/g7/retrieval-corpus.v1.json');
const digest = {
  algorithm: 'sha256',
  digest: async (input) => createHash('sha256').update(input).digest('hex'),
};

function resultIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string')
    .sort();
}

async function observe(corpus, fixture) {
  const started = performance.now();
  const result = await queryGraph(corpus.graph, fixture.query, digest);
  const elapsedMs = performance.now() - started;
  if (!result.accepted) {
    return {
      id: fixture.id,
      accepted: false,
      resultIds: [],
      pathNodeIds: [],
      truncated: false,
      issueCodes: result.issues.map((issue) => issue.code),
      unknownCodes: [],
      elapsedMs,
    };
  }
  return {
    id: fixture.id,
    accepted: true,
    resultIds: resultIds(result.value.result),
    pathNodeIds: result.value.paths[0]?.nodes.map((node) => node.id) ?? [],
    truncated: Boolean(result.value.truncation?.truncated),
    selectedStrategy: result.value.retrievalPlan?.selected,
    queryDigest: result.value.queryDigest?.value,
    issueCodes: [],
    unknownCodes: result.value.unknownBoundaries.map((zone) => zone.code),
    elapsedMs,
  };
}

function identity(observation) {
  const { elapsedMs: _elapsedMs, ...rest } = observation;
  return JSON.stringify(rest);
}

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const first = [];
const second = [];
for (const fixture of corpus.cases) {
  first.push(await observe(corpus, fixture));
  second.push(await observe(corpus, fixture));
}
for (const [index, observation] of first.entries()) {
  if (identity(observation) !== identity(second[index])) {
    throw new Error(`${observation.id} retrieval benchmark output is nondeterministic`);
  }
}

const report = scoreGraphRetrievalBenchmark(corpus, first);
if (report.publicAccuracyClaimPermitted !== false) {
  throw new Error('Retrieval benchmark must not permit a public accuracy claim');
}
if (report.accuracyClaim !== GRAPH_RETRIEVAL_BENCHMARK_CLAIM.accuracyClaim) {
  throw new Error('Retrieval benchmark accuracy claim drifted');
}
if (report.failures.length > 0) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  throw new Error(`Retrieval benchmark failed: ${report.failures.join('; ')}`);
}

const raw = {
  schemaVersion: 'workspai.graph.retrieval-benchmark-result.v1',
  ...report,
  observations: first.map((item) => ({
    id: item.id,
    accepted: item.accepted,
    truncated: item.truncated,
    selectedStrategy: item.selectedStrategy,
    queryDigest: item.queryDigest,
    resultIds: item.resultIds,
    pathNodeIds: item.pathNodeIds,
    issueCodes: item.issueCodes,
    unknownCodes: item.unknownCodes,
  })),
};
process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`);
