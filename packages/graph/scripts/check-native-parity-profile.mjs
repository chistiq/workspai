import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const artifactPath = path.join(packageRoot, 'dist/native/graph-engine.wasm');
const { createNodeRustWasmGraphNativePort } = await import(
  pathToFileURL(path.join(packageRoot, 'dist/adapters/node/index.js')).href
);

function percentile(values, value) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * value))] ?? 0;
}

function createFixture(nodeCount, edgeCount) {
  const edges = [];
  for (let node = 1; node < nodeCount; node += 1) edges.push([node - 1, node]);
  let state = 0x6a09e667;
  while (edges.length < edgeCount) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const from = state % nodeCount;
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    edges.push([from, state % nodeCount]);
  }
  return { nodeCount, edges, start: 0, maxDepth: nodeCount };
}

function referenceTraversal(request) {
  const adjacency = Array.from({ length: request.nodeCount }, () => []);
  for (const [from, to] of request.edges) adjacency[from].push(to);
  for (const neighbors of adjacency) {
    neighbors.sort((left, right) => left - right);
    let write = 0;
    for (const neighbor of neighbors) {
      if (write === 0 || neighbors[write - 1] !== neighbor) neighbors[write++] = neighbor;
    }
    neighbors.length = write;
  }
  const depths = new Uint32Array(request.nodeCount);
  depths.fill(0xffff_ffff);
  depths[request.start] = 0;
  const queue = new Uint32Array(request.nodeCount);
  queue[0] = request.start;
  let read = 0;
  let write = 1;
  while (read < write) {
    const node = queue[read++];
    const depth = depths[node];
    if (depth >= request.maxDepth) continue;
    for (const neighbor of adjacency[node]) {
      if (depths[neighbor] === 0xffff_ffff) {
        depths[neighbor] = depth + 1;
        queue[write++] = neighbor;
      }
    }
  }
  return Array.from(queue.subarray(0, write));
}

function measure(run, iterations) {
  const durations = [];
  let output;
  for (let iteration = 0; iteration < iterations + 1; iteration += 1) {
    const startedAt = performance.now();
    output = run();
    const duration = performance.now() - startedAt;
    if (iteration > 0) durations.push(duration);
  }
  return { output, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) };
}

const port = await createNodeRustWasmGraphNativePort();
const profiles = [
  { id: 'small', nodes: 1_000, edges: 4_000, iterations: 7 },
  { id: 'normal', nodes: 10_000, edges: 50_000, iterations: 5 },
  { id: 'large', nodes: 50_000, edges: 250_000, iterations: 3 },
];
const results = [];
const failures = [];
for (const profile of profiles) {
  const fixture = createFixture(profile.nodes, profile.edges);
  const reference = measure(() => referenceTraversal(fixture), profile.iterations);
  const native = measure(() => port.traverseReachable(fixture), profile.iterations);
  const nativeNodes = native.output.status === 'complete' ? native.output.nodes : [];
  const parity =
    native.output.status === 'complete' &&
    reference.output.length === nativeNodes.length &&
    reference.output.every((node, index) => node === nativeNodes[index]);
  if (!parity) failures.push(`${profile.id} traversal parity failed`);
  if (native.p95Ms > 5_000) failures.push(`${profile.id} native p95 exceeded safety ceiling`);
  results.push({
    id: profile.id,
    nodes: profile.nodes,
    edges: profile.edges,
    parity,
    reference: { p50Ms: reference.p50Ms, p95Ms: reference.p95Ms },
    native: { p50Ms: native.p50Ms, p95Ms: native.p95Ms },
    p95Ratio: reference.p95Ms === 0 ? null : native.p95Ms / reference.p95Ms,
  });
}

const artifact = fs.readFileSync(artifactPath);
const report = {
  schemaVersion: 'workspai.graph.native-parity-profile.v1',
  evidenceClass: 'local-unsigned-candidate',
  engine: port.descriptor,
  artifact: {
    bytes: artifact.byteLength,
    sha256: crypto.createHash('sha256').update(artifact).digest('hex'),
  },
  activation: 'prohibited-until-cross-platform-admission',
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    sourceCommit: process.env.WORKSPAI_ADMISSION_SOURCE_COMMIT ?? 'local-unbound',
  },
  results,
  failures,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const requested = process.argv[outputIndex + 1];
  if (!requested) throw new Error('--output requires a repository-relative path');
  const output = path.resolve(repositoryRoot, requested);
  const relative = path.relative(repositoryRoot, output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--output must remain within the repository');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, 'utf8');
}
process.stdout.write(serialized);
if (failures.length > 0) process.exitCode = 1;
