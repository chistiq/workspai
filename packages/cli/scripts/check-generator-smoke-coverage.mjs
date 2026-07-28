import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const contract = JSON.parse(
  readFileSync(path.join(repoRoot, 'contracts', 'create-planner-capabilities.v1.json'), 'utf8')
);

const expectedOfficial = (contract.officialCreate ?? [])
  .filter((entry) => entry.status === 'available' && entry.canExecuteCreate === true)
  .map((entry) => entry.id)
  .sort();
const officialProbe = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts', 'smoke-official-generators.mjs'), '--list'],
  { cwd: repoRoot, encoding: 'utf8' }
);
if (officialProbe.status !== 0) {
  fail(`official smoke discovery failed:\n${officialProbe.stderr}`);
}
const actualOfficial = JSON.parse(officialProbe.stdout);
assertSameSet('available official generators', expectedOfficial, actualOfficial);

const expectedNative = (contract.nativeCreate ?? []).map((entry) => entry.id).sort();
const nativeProbe = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts', 'runtime-acceptance-matrix.mjs'), '--list-kits'],
  { cwd: repoRoot, encoding: 'utf8' }
);
if (nativeProbe.status !== 0) {
  fail(`native runtime acceptance discovery failed:\n${nativeProbe.stderr}`);
}
const actualNative = JSON.parse(nativeProbe.stdout);
assertSameSet('native runtime acceptance generators', expectedNative, actualNative);

const enterpriseSmokeSource = readFileSync(
  path.join(repoRoot, 'scripts', 'enterprise-package-smoke.mjs'),
  'utf8'
);
if (!/\bkit:\s*['"]rust\.axum['"]/.test(enterpriseSmokeSource)) {
  fail('Rust Axum must have an enterprise package create smoke scenario');
}

console.log(
  `Generator smoke coverage aligned: ${expectedOfficial.length} official + ${expectedNative.length} native generator(s).`
);

function assertSameSet(label, expected, actual) {
  const uniqueActual = [...new Set(actual)].sort();
  const missing = expected.filter((value) => !uniqueActual.includes(value));
  const unexpected = uniqueActual.filter((value) => !expected.includes(value));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      `${label} drifted from the canonical create contract` +
        `${missing.length > 0 ? `\n- missing: ${missing.join(', ')}` : ''}` +
        `${unexpected.length > 0 ? `\n- unexpected: ${unexpected.join(', ')}` : ''}`
    );
  }
}

function fail(message) {
  console.error(`[generator-smoke-coverage] ${message}`);
  process.exit(1);
}
