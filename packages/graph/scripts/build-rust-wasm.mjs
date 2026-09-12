import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const source = path.join(
  repositoryRoot,
  'target',
  'wasm32-unknown-unknown',
  'release',
  'workspai_graph_engine.wasm'
);
const destination = path.join(packageRoot, 'dist', 'native', 'graph-engine.wasm');
const environment = { ...process.env };
const memoryLimitFlag = '-C link-arg=--max-memory=268435456';
// Debian can provide target libraries without rustup. This explicit development
// override is never embedded in the artifact and is unnecessary in pinned CI.
if (process.env.WORKSPAI_RUST_WASM_SYSROOT) {
  const sysrootFlag = `--sysroot=${process.env.WORKSPAI_RUST_WASM_SYSROOT}`;
  environment.RUSTFLAGS = [process.env.RUSTFLAGS, memoryLimitFlag, sysrootFlag]
    .filter(Boolean)
    .join(' ');
} else {
  environment.RUSTFLAGS = [process.env.RUSTFLAGS, memoryLimitFlag].filter(Boolean).join(' ');
}

const build = spawnSync(
  'cargo',
  [
    'build',
    '--locked',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '--package',
    'workspai-graph-engine',
  ],
  { cwd: repositoryRoot, encoding: 'utf8', env: environment, windowsHide: true }
);
if (build.error || build.status !== 0) {
  throw new Error(
    `Rust Graph WASM build failed${build.error ? `: ${build.error.message}` : ''}\n${build.stdout ?? ''}\n${build.stderr ?? ''}`.trim()
  );
}

const bytes = readFileSync(source);
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module);
if (imports.length !== 0) {
  throw new Error(`Rust Graph WASM must be self-contained; found ${imports.length} import(s)`);
}
const exports = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name));
for (const required of [
  'memory',
  'graph_engine_abi_version',
  'graph_engine_memory_limit_bytes',
  'graph_engine_max_nodes',
  'graph_engine_max_edges',
  'graph_engine_alloc_u32',
  'graph_engine_dealloc_u32',
  'graph_engine_reachable',
]) {
  if (!exports.has(required)) throw new Error(`Rust Graph WASM omits required export ${required}`);
}

const instance = new WebAssembly.Instance(module, {});
const api = instance.exports;
const limits = {
  abiVersion: api.graph_engine_abi_version(),
  maxNodes: api.graph_engine_max_nodes(),
  maxEdges: api.graph_engine_max_edges(),
  maxMemoryBytes: api.graph_engine_memory_limit_bytes(),
};
if (
  limits.abiVersion !== 1 ||
  limits.maxNodes !== 1_000_000 ||
  limits.maxEdges !== 5_000_000 ||
  limits.maxMemoryBytes !== 268_435_456
) {
  throw new Error(`Rust Graph WASM resource contract drifted: ${JSON.stringify(limits)}`);
}

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
process.stdout.write(`Graph Rust WASM built: ${statSync(destination).size} bytes\n`);
