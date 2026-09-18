import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { createNodeRustWasmGraphNativePort } from '../dist/adapters/node/index.js';
import { routeGraphNativeDeclarations } from '../dist/providers/index.js';

// Usage: node scripts/profile-declaration-pipeline.mjs report.json [repository ...]
// Each repository measurement starts a fresh CLI process. The OS file cache is
// uncontrolled; these are process-cold observations, not disk-cold benchmarks.
const [output, ...roots] = process.argv.slice(2);
if (!output) throw new Error('Expected output report path and optional repository roots.');
const iterations = 10;
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
const nativeLoadStartedAt = performance.now();
const native = await createNodeRustWasmGraphNativePort();
const nativeLoadMs = performance.now() - nativeLoadStartedAt;
const declarations = [];
for (const [id, lines, calls] of [
  ['small-files', 10, 1_000],
  ['large-file', 10_000, 1],
  ['comment-heavy', 10_000, 1],
]) {
  const source = Array.from({ length: lines }, (_, i) =>
    id === 'comment-heavy'
      ? `/* comment ${i} */ export function symbol${i}() {}\n`
      : `export function symbol${i}() {}\n`
  ).join('');
  const samples = { typescript: [], rustWasm: [] };
  let lastDeclarations;
  const measureDeclarations = (engine) => {
    const startedAt = performance.now();
    for (let call = 0; call < calls; call++) {
      if (engine === 'rust-wasm') {
        const result = native.extractDeclarations({ source, language: 'node' });
        assert.equal(result.status, 'complete');
        lastDeclarations = result.declarations;
      } else {
        lastDeclarations = routeGraphNativeDeclarations(source, 'node', undefined).declarations;
      }
    }
    return performance.now() - startedAt;
  };
  for (let iteration = 0; iteration <= iterations; iteration++) {
    const order = iteration % 2 === 0 ? ['typescript', 'rust-wasm'] : ['rust-wasm', 'typescript'];
    for (const engine of order) {
      const elapsed = measureDeclarations(engine);
      assert.equal(lastDeclarations.length, lines);
      if (iteration > 0) {
        if (engine === 'rust-wasm') samples.rustWasm.push(elapsed);
        else samples.typescript.push(elapsed);
      }
    }
  }
  for (let i = 0; i < lines; i++) {
    assert.deepEqual(lastDeclarations[i], {
      name: `symbol${i}`,
      detail: 'function',
      line: i + 1,
    });
  }
  const typescript = percentiles(samples.typescript);
  const rustWasm = percentiles(samples.rustWasm);
  declarations.push({
    id,
    calls,
    bytesPerCall: Buffer.byteLength(source),
    typescript,
    rustWasm,
    p50Ratio: typescript.p50Ms === 0 ? null : rustWasm.p50Ms / typescript.p50Ms,
  });
}
const repositories = [];
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const resourceHook = new URL('./profile-cli-resources.mjs', import.meta.url).href;
for (const root of roots) {
  const samples = [];
  const providerSamples = [];
  const compositionSamples = [];
  const peakRssSamples = [];
  let summary;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const start = performance.now();
    const run = spawnSync(
      process.execPath,
      ['--import', resourceHook, cli, 'inspect', root, '--mode', 'project-only', '--json'],
      {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: 120_000,
      }
    );
    if (run.error) throw run.error;
    assert.ok([0, 2].includes(run.status), run.stderr || run.stdout);
    samples.push(performance.now() - start);
    const result = JSON.parse(run.stdout);
    const build = result.data.build;
    const resourceLine = run.stderr
      .split('\n')
      .find((line) => line.startsWith('GRAPH_PROFILE_RESOURCES='));
    assert.ok(resourceLine, 'CLI peak RSS measurement is required');
    peakRssSamples.push(JSON.parse(resourceLine.slice('GRAPH_PROFILE_RESOURCES='.length)).maxRSS);
    providerSamples.push(build.metrics.providerMs);
    compositionSamples.push(build.metrics.compositionMs);
    const current = {
      status: build.status,
      graphSha256: build.graph.generation.reference.contentDigest.value,
      nodes: build.graph.nodes.length,
      edges: build.graph.edges.length,
      metrics: build.metrics,
    };
    if (summary)
      assert.equal(current.graphSha256, summary.graphSha256, 'Graph must be deterministic');
    summary = current;
  }
  repositories.push({
    root,
    ...percentiles(samples),
    provider: percentiles(providerSamples),
    composition: percentiles(compositionSamples),
    peakRssKiB: Math.max(...peakRssSamples),
    ...summary,
  });
}
const report = {
  schemaVersion: 'workspai.graph.declaration-pipeline-profile.v2',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  cache: 'process-cold repository CLI; uncontrolled OS cache; warmed native microbenchmarks',
  artifactSha256: createHash('sha256')
    .update(readFileSync(new URL('../dist/native/graph-engine.wasm', import.meta.url)))
    .digest('hex'),
  nativeLoadMs,
  declarations,
  repositories,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
