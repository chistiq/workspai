import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  createNodeRustWasmGraphNativePort,
  routeGraphNativeDeclarations,
} from '../dist/adapters/node/index.js';
import { GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE } from '../dist/contracts/index.js';

// Read-only local corpus parity check, not a cross-platform admission receipt.
const roots = process.argv.slice(2);
assert.ok(roots.length > 0, 'Pass at least one repository root.');
const languages = new Map(
  GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.flatMap((entry) =>
    entry.extensions.map((extension) => [extension, entry.language])
  )
);
const excluded = new Set([
  '.git',
  'node_modules',
  '.workspai',
  '.agents',
  '.amazonq',
  'dist',
  'build',
  'target',
  '.venv',
]);
const native = await createNodeRustWasmGraphNativePort();
for (const root of roots) {
  let checked = 0;
  let rejected = 0;
  const mismatches = [];
  const corpus = createHash('sha256');
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) walk(file);
        continue;
      }
      const language = languages.get(path.extname(file).toLowerCase());
      if (!entry.isFile() || !language || statSync(file).size > 4 * 1024 * 1024) continue;
      const bytes = readFileSync(file);
      const locator = path.relative(root, file).split(path.sep).join('/');
      corpus.update(JSON.stringify([locator, createHash('sha256').update(bytes).digest('hex')]));
      let source;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        source = new TextDecoder('latin1').decode(bytes);
      }
      const result = routeGraphNativeDeclarations(source, language, native);
      checked++;
      if (result.reason === 'native-mismatch') mismatches.push(locator);
      if (result.reason === 'native-failed') rejected++;
    }
  }
  walk(root);
  process.stdout.write(
    `${JSON.stringify({ root, checked, rejected, mismatches, corpusSha256: corpus.digest('hex') })}\n`
  );
  if (checked === 0 || mismatches.length > 0 || rejected > 0) process.exitCode = 1;
}
