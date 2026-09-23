import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');

function rustSources() {
  const root = path.join(repositoryRoot, 'crates/graph-engine/src');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.rs')) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

const SOURCE_INPUTS = Object.freeze([
  ['workspace-manifest', path.join(repositoryRoot, 'Cargo.toml')],
  ['workspace-lock', path.join(repositoryRoot, 'Cargo.lock')],
  ['engine-manifest', path.join(repositoryRoot, 'crates/graph-engine/Cargo.toml')],
  ['engine-build-script', path.join(repositoryRoot, 'crates/graph-engine/build.rs')],
  ...rustSources().map((file) => [
    path.relative(repositoryRoot, file).split(path.sep).join('/'),
    file,
  ]),
  ['wasm-build-policy', path.join(packageRoot, 'scripts/build-rust-wasm.mjs')],
]);

/**
 * Returns a machine-independent digest for the exact source and build-policy
 * inputs that define the bundled engine. Absolute paths are never serialized.
 */
export function nativeEngineSourceEvidence() {
  const inputs = SOURCE_INPUTS.map(([id, file]) => {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      throw new Error(`Native engine source input is missing: ${id}`);
    }
    return {
      id,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    };
  });
  const canonical = JSON.stringify(inputs);
  return Object.freeze({
    algorithm: 'sha256',
    scope: 'graph-engine-sources-and-build-policy',
    inputCount: inputs.length,
    digest: crypto.createHash('sha256').update(canonical).digest('hex'),
  });
}
