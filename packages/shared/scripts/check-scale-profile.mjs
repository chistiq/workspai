import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { negotiateWisCoreResultEnvelope } from '../dist/compatibility/index.js';
import { validateWisCoreResultEnvelope } from '../dist/validation/index.js';
import { buildScaleEnvelope, toPreviousScaleEnvelope } from './lib/scale-workloads.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'fixtures/scale/workload-manifest.v1.json'), 'utf8')
);
const failures = [];

function fail(message) {
  failures.push(message);
}

function percentile(samples, percentage) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[index];
}

function round(value) {
  return Number(value.toFixed(3));
}

function measureValidation(workload, input) {
  const options = { limits: workload.limits };
  for (let index = 0; index < workload.warmups; index += 1) {
    if (!validateWisCoreResultEnvelope(input, options).valid) {
      throw new Error(`${workload.id} warmup did not validate`);
    }
  }
  const samples = [];
  for (let index = 0; index < workload.iterations; index += 1) {
    const startedAt = performance.now();
    const result = validateWisCoreResultEnvelope(input, options);
    samples.push(performance.now() - startedAt);
    if (!result.valid) throw new Error(`${workload.id} iteration did not validate`);
  }
  return {
    minMs: round(Math.min(...samples)),
    p50Ms: round(percentile(samples, 50)),
    p95Ms: round(percentile(samples, 95)),
    p99Ms: round(percentile(samples, 99)),
    maxMs: round(Math.max(...samples)),
  };
}

function collectHeap() {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

function measureObservedHeap(workload, input, serializedBytes) {
  let observedAdditionalBytes = 0;
  for (let index = 0; index < 5; index += 1) {
    const baseline = collectHeap();
    const result = validateWisCoreResultEnvelope(input, { limits: workload.limits });
    if (!result.valid) throw new Error(`${workload.id} heap measurement did not validate`);
    observedAdditionalBytes = Math.max(
      observedAdditionalBytes,
      process.memoryUsage().heapUsed - baseline
    );
  }
  return {
    observedAdditionalBytes: Math.max(0, observedAdditionalBytes),
    observedAmplification: round(Math.max(0, observedAdditionalBytes) / serializedBytes),
    method: 'post-checkpoint-heapUsed-with-forced-gc-baseline',
  };
}

function runWorker(workload, iterations, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scale-worker.mjs', import.meta.url), {
      workerData: { workload, iterations },
    });
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`worker exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    worker.once('message', (message) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

const workloadById = new Map(manifest.workloads.map((workload) => [workload.id, workload]));
const workloadResults = [];
const inputs = new Map();
for (const workload of manifest.workloads) {
  const input = buildScaleEnvelope(workload);
  inputs.set(workload.id, input);
  const serializedBytes = Buffer.byteLength(JSON.stringify(input));
  if (serializedBytes > workload.maxSerializedBytes) {
    fail(`${workload.id} is ${serializedBytes} bytes; ceiling is ${workload.maxSerializedBytes}`);
  }
  const timings = measureValidation(workload, input);
  if (timings.p95Ms > workload.p95BudgetMs) {
    fail(`${workload.id} p95 ${timings.p95Ms}ms exceeds ${workload.p95BudgetMs}ms`);
  }
  if (timings.p99Ms > workload.p99BudgetMs) {
    fail(`${workload.id} p99 ${timings.p99Ms}ms exceeds ${workload.p99BudgetMs}ms`);
  }
  const memory = ['normal', 'large-node'].includes(workload.id)
    ? measureObservedHeap(workload, input, serializedBytes)
    : undefined;
  if (memory && memory.observedAmplification > manifest.memory.maxObservedHeapAmplification) {
    fail(
      `${workload.id} observed heap amplification ${memory.observedAmplification} exceeds ${manifest.memory.maxObservedHeapAmplification}`
    );
  }
  workloadResults.push({
    id: workload.id,
    serializedBytes,
    evidenceCount: workload.evidenceCount,
    iterations: workload.iterations,
    timings,
    ...(memory ? { memory } : {}),
  });
}

const compatibilityWorkload = workloadById.get(manifest.compatibility.sourceWorkload);
if (!compatibilityWorkload) throw new Error('compatibility workload is missing');
const previousInput = toPreviousScaleEnvelope(inputs.get(compatibilityWorkload.id));
for (let index = 0; index < manifest.compatibility.warmups; index += 1) {
  if (!negotiateWisCoreResultEnvelope(previousInput).compatible) {
    throw new Error('compatibility warmup failed');
  }
}
const compatibilitySamples = [];
for (let index = 0; index < manifest.compatibility.iterations; index += 1) {
  const startedAt = performance.now();
  const result = negotiateWisCoreResultEnvelope(previousInput);
  compatibilitySamples.push(performance.now() - startedAt);
  if (!result.compatible || result.status !== 'migrated') {
    throw new Error('compatibility iteration failed');
  }
}
const compatibilityResult = {
  iterations: manifest.compatibility.iterations,
  p50Ms: round(percentile(compatibilitySamples, 50)),
  p95Ms: round(percentile(compatibilitySamples, 95)),
  p99Ms: round(percentile(compatibilitySamples, 99)),
};
if (compatibilityResult.p95Ms > manifest.compatibility.p95BudgetMs) {
  fail('compatibility p95 budget exceeded');
}
if (compatibilityResult.p99Ms > manifest.compatibility.p99BudgetMs) {
  fail('compatibility p99 budget exceeded');
}

const extensionInput = structuredClone(inputs.get('small'));
extensionInput.extensions = Object.fromEntries(
  Array.from({ length: 32 }, (_, index) => [
    `vendor.ext${index}`,
    JSON.parse('{"opaque":{"__proto__":{"polluted":true},"values":[1,2,3]}}'),
  ])
);
const extensionRoundTrip = JSON.parse(JSON.stringify(extensionInput));
const extensionResult = validateWisCoreResultEnvelope(extensionRoundTrip);
if (!extensionResult.valid || Object.prototype.polluted !== undefined) {
  fail('maximum unknown-extension round trip failed or polluted Object.prototype');
}
const extensionOverflow = structuredClone(extensionInput);
extensionOverflow.extensions['vendor.overflow'] = true;
if (validateWisCoreResultEnvelope(extensionOverflow).valid) {
  fail('extension namespace overflow was accepted');
}

const cancelled = validateWisCoreResultEnvelope(inputs.get('large-node'), {
  limits: workloadById.get('large-node').limits,
  signal: { aborted: true },
});
if (cancelled.valid || cancelled.diagnostics[0]?.code !== 'WIS_RESOURCE_CANCELLED') {
  fail('pre-cancelled large validation did not stop at the resource checkpoint');
}

const adversarialDepth = {};
let cursor = adversarialDepth;
for (let depth = 0; depth < 128; depth += 1) {
  cursor.child = {};
  cursor = cursor.child;
}
const depthResult = validateWisCoreResultEnvelope(adversarialDepth);
if (
  depthResult.valid ||
  !depthResult.diagnostics.some((entry) => entry.code === 'WIS_RESOURCE_DEPTH_LIMIT')
) {
  fail('extreme-depth input was not rejected by the iterative guard');
}

const soakWorkload = workloadById.get(manifest.soak.sourceWorkload);
const soakInput = inputs.get(soakWorkload.id);
const soakBefore = collectHeap();
for (let index = 0; index < manifest.soak.iterations; index += 1) {
  if (!validateWisCoreResultEnvelope(soakInput).valid) throw new Error('soak validation failed');
}
const soakAfter = collectHeap();
const retainedHeapBytes = Math.max(0, soakAfter - soakBefore);
if (retainedHeapBytes > manifest.soak.maxRetainedHeapBytes) {
  fail(`soak retained ${retainedHeapBytes} heap bytes`);
}

const concurrencyWorkload = workloadById.get(manifest.concurrency.sourceWorkload);
const concurrencyStartedAt = performance.now();
const workerResults = await Promise.all(
  Array.from({ length: manifest.concurrency.workers }, () =>
    runWorker(
      concurrencyWorkload,
      manifest.concurrency.iterationsPerWorker,
      manifest.concurrency.maxDurationMs
    )
  )
);
const concurrencyDurationMs = round(performance.now() - concurrencyStartedAt);
if (
  concurrencyDurationMs > manifest.concurrency.maxDurationMs ||
  workerResults.some((result) => !result.passed)
) {
  fail('concurrent validation did not complete deterministically within budget');
}

const coldWorkload = workloadById.get(manifest.coldLoad.sourceWorkload);
const coldSamples = [];
for (let index = 0; index < manifest.coldLoad.iterations; index += 1) {
  const child = spawnSync(
    process.execPath,
    [path.join(packageRoot, 'scripts/scale-cold-process.mjs'), JSON.stringify(coldWorkload)],
    { cwd: packageRoot, encoding: 'utf8' }
  );
  if (child.status !== 0 || !child.stdout.trim()) {
    throw new Error(
      `cold-load process failed (status=${child.status}, signal=${child.signal}, error=${child.error?.message ?? 'none'}): ${child.stderr}`
    );
  }
  coldSamples.push(JSON.parse(child.stdout).durationMs);
}
const coldLoadResult = {
  iterations: manifest.coldLoad.iterations,
  p95Ms: round(percentile(coldSamples, 95)),
};
if (coldLoadResult.p95Ms > manifest.coldLoad.p95BudgetMs) {
  fail(`cold-load p95 ${coldLoadResult.p95Ms}ms exceeds budget`);
}

const report = {
  schemaVersion: 'workspai-shared-scale-report.v1',
  profile: manifest.profile,
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? 'passed' : 'failed',
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    exposedGc: typeof globalThis.gc === 'function',
  },
  workloads: workloadResults,
  compatibility: compatibilityResult,
  extensions: {
    namespaces: 32,
    roundTrip: extensionResult.valid,
    overflowRejected: !validateWisCoreResultEnvelope(extensionOverflow).valid,
    prototypePollution: Object.prototype.polluted !== undefined,
  },
  cancellation: { preCancelledLargeRejected: !cancelled.valid },
  adversarial: { extremeDepthRejected: !depthResult.valid },
  soak: { iterations: manifest.soak.iterations, retainedHeapBytes },
  concurrency: {
    workers: manifest.concurrency.workers,
    validations: manifest.concurrency.workers * manifest.concurrency.iterationsPerWorker,
    durationMs: concurrencyDurationMs,
    deterministic: workerResults.every((result) => result.passed),
  },
  coldLoad: coldLoadResult,
  limitations: [
    'browser-safe-proxy is bundled for browser/CSP but timed locally under Node; real browser-device timing remains remote evidence',
    'heap amplification is sampled at synchronous post-validation checkpoints; remote profilers must confirm true peak RSS before admission',
    'cancellation is cooperative at bounded resource-traversal checkpoints and cannot interrupt a single precompiled structural-validator call',
  ],
  failures,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`Shared scale profile: ${report.status}\n`);
  for (const workload of workloadResults) {
    process.stdout.write(
      `- ${workload.id}: ${workload.serializedBytes} bytes; p95 ${workload.timings.p95Ms}ms; p99 ${workload.timings.p99Ms}ms\n`
    );
  }
  process.stdout.write(
    `- compatibility: p95 ${compatibilityResult.p95Ms}ms; concurrency ${concurrencyDurationMs}ms; retained heap ${retainedHeapBytes} bytes\n`
  );
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
}

if (failures.length > 0) process.exitCode = 1;
