import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = [
  { path: 'dist/contracts/index.js', gzipBytes: 8 * 1024 },
  { path: 'dist/compatibility/index.js', gzipBytes: 50 * 1024 },
  { path: 'dist/registry/index.js', gzipBytes: 8 * 1024 },
  { path: 'dist/validation/index.js', gzipBytes: 45 * 1024 },
  { path: 'dist/index.js', gzipBytes: 50 * 1024 },
];

const failures = [];
for (const budget of budgets) {
  const target = path.join(packageRoot, budget.path);
  if (!fs.existsSync(target)) {
    failures.push(`${budget.path} is missing; run npm run build first`);
    continue;
  }
  const bundled = await build({
    entryPoints: [target],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const code = bundled.outputFiles
    .map((output) => output.contents)
    .reduce((combined, output) => Buffer.concat([combined, output]), Buffer.alloc(0));
  const bytes = gzipSync(code, { level: 9 }).byteLength;
  if (bytes > budget.gzipBytes) {
    failures.push(`${budget.path} is ${bytes} gzip bytes; budget is ${budget.gzipBytes}`);
  } else {
    console.log(`${budget.path}: ${bytes}/${budget.gzipBytes} transitive gzip bytes`);
  }
  for (const output of Object.values(bundled.metafile.outputs)) {
    if (output.imports.length > 0) {
      failures.push(`${budget.path} browser bundle contains unresolved runtime imports`);
    }
  }
  if (/\b(?:eval|Function)\s*\(/u.test(code.toString('utf8'))) {
    failures.push(`${budget.path} contains forbidden dynamic code evaluation`);
  }
}

if (failures.length > 0) {
  console.error('Shared bundle budget failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
